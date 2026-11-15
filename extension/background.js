"use strict";

const MAX_RECORDS = 5000;
const MENU_ID = "save-image-and-context";
const EXTRACT_MESSAGE = "DOWNLOAD_EXTRACT_IMAGE_METADATA";

// How far back to look when matching a download event to a record.
// Chrome can reuse download IDs after history is cleared, so old
// records are never matched.
const DOWNLOAD_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ---------- Content script messaging ---------- */

// Send a message to the content script, retrying once after a short delay.
function sendMessageWithRetry(tabId, message, retryDelayMs = 350) {
  return new Promise((resolve) => {
    function attempt(retried) {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (!chrome.runtime.lastError) {
          resolve({ response, lastError: null });
          return;
        }

        if (!retried) {
          setTimeout(() => attempt(true), retryDelayMs);
        } else {
          resolve({ response: null, lastError: chrome.runtime.lastError });
        }
      });
    }

    attempt(false);
  });
}

// Inject the content script if it is not already present.
// content.js has its own load guard, so repeated injection is safe.
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (err) {
    console.warn("Failed to inject content.js:", err);
    return false;
  }
}

// Ask the page for the image's context. Returns { response, lastError }.
async function requestMetadata(tabId, imageUrl) {
  const message = { type: EXTRACT_MESSAGE, imageUrl };

  await ensureContentScript(tabId);
  let result = await sendMessageWithRetry(tabId, message);

  // If messaging still failed, try one more inject + retry.
  if (result.lastError && (await ensureContentScript(tabId))) {
    result = await sendMessageWithRetry(tabId, message);
  }

  return result;
}

/* ---------- Badge ---------- */

// Badge feedback: green check on full capture, amber "!" on a problem.
async function flashBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
  } catch (err) {
    console.warn("Badge update failed:", err);
  }
}

const flashOk = () => flashBadge("✓", "#2e7d32");
const flashWarn = () => flashBadge("!", "#b26a00");

/* ---------- Local time ---------- */

// "2026-11-14 21:31:07 -08:00": the time on the user's own clock, with
// its offset from UTC so the value is still unambiguous.
function formatLocalTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset(); // minutes ahead of UTC
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// The browser's time zone name, e.g. "America/Los_Angeles".
function currentTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/* ---------- Record storage ---------- */

// All writes to the record list go through this queue, so a capture and
// a download event arriving together cannot overwrite each other.
// `mutate` receives the records array and returns true if it changed it.
let writeChain = Promise.resolve();

function updateRecords(mutate) {
  const run = writeChain.then(async () => {
    const { records = [] } = await chrome.storage.local.get({ records: [] });
    const changed = await mutate(records);
    if (changed) await chrome.storage.local.set({ records });
    return changed;
  });

  writeChain = run.catch(() => {});
  return run;
}

// Build a record with the same set of fields whether or not the page
// context could be read, so exports always have a consistent shape.
function buildRecord({ createdAt, imageUrl, tab, response, reason, downloadId }) {
  const r = response || {};

  return {
    id: crypto.randomUUID(),
    createdAt, // UTC; the reference value for sorting and matching
    createdAtLocal: formatLocalTimestamp(new Date(createdAt)),
    timeZone: currentTimeZone(),
    ok: !reason,
    reason: reason || "",
    pageUrl: r.pageUrl ?? tab.url ?? null,
    pageTitle: r.pageTitle ?? tab.title ?? null,
    canonicalUrl: r.canonicalUrl ?? "",
    hostname: r.hostname ?? "",
    metaDescription: r.metaDescription ?? "",
    ogTitle: r.ogTitle ?? "",
    ogDescription: r.ogDescription ?? "",
    imageUrl: r.imageUrl ?? imageUrl ?? null,
    alt: r.alt ?? "",
    title: r.title ?? "",
    ariaLabel: r.ariaLabel ?? "",
    caption: r.caption ?? "",
    referrerPolicy: r.referrerPolicy ?? "",
    downloadId,
    fileName: "",
    sidecarFileName: "",
    downloadState: downloadId === null ? "failed" : "in_progress",
    downloadError: "",
    notes: "",
    linkedHref: r.linkedHref ?? "",
    linkedText: r.linkedText ?? "",
    nearestHeading: r.nearestHeading ?? "",
    nearestParagraph: r.nearestParagraph ?? ""
  };
}

// Treat a capture as a duplicate if the previous record has the same
// pageUrl + imageUrl and was created within the last 5 seconds.
function isProbablyDuplicate(records, newRecord) {
  const last = records[records.length - 1];
  if (!last) return false;

  const t1 = new Date(last.createdAt).getTime();
  const t2 = new Date(newRecord.createdAt).getTime();

  return (
    last.pageUrl === newRecord.pageUrl &&
    last.imageUrl === newRecord.imageUrl &&
    Math.abs(t2 - t1) < 5000
  );
}

/* ---------- Download tracking ---------- */

// Only the file name is kept, not the full path: the path usually
// contains the user's OS account name, which has no place in an export.
function baseName(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}

// Copy what Chrome knows about a download onto its record.
// Returns true if the record changed.
function applyDownloadInfo(record, { filename, state, error }) {
  let changed = false;

  const name = baseName(filename);
  if (name && record.fileName !== name) {
    record.fileName = name;
    changed = true;
  }

  if (state && record.downloadState !== state) {
    record.downloadState = state;
    changed = true;
  }

  if (error && record.downloadError !== error) {
    record.downloadError = error;
    changed = true;
  }

  return changed;
}

function findRecordByDownloadId(records, downloadId) {
  const cutoff = Date.now() - DOWNLOAD_MATCH_WINDOW_MS;

  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (new Date(record.createdAt).getTime() < cutoff) return null;
    if (record.downloadId === downloadId) return record;
  }

  return null;
}

/* ---------- Sidecar citation files (optional) ---------- */

// When the "sidecar" setting is on, each image gets a small JSON file
// saved beside it ("photo.jpg" -> "photo.jpg.json") holding its citation
// record, so the source travels with the file.
//
// Safe to call more than once for the same download: the record is
// claimed inside the write queue, so only the first call writes a file.
async function writeSidecarIfWanted(downloadId) {
  if (downloadId === null || downloadId === undefined) return;

  const { settings } = await chrome.storage.local.get({ settings: {} });
  if (!settings?.sidecar) return;

  let snapshot = null;

  await updateRecords((records) => {
    const record = findRecordByDownloadId(records, downloadId);

    if (
      !record ||
      record.downloadState !== "complete" ||
      !record.fileName ||
      record.sidecarFileName
    ) {
      return false;
    }

    record.sidecarFileName = record.fileName + ".json";
    snapshot = { ...record };
    return true;
  });

  if (!snapshot) return;

  // downloadId only means something inside this browser profile.
  const { downloadId: _unused, ...contents } = snapshot;
  const json = JSON.stringify(contents, null, 2);

  try {
    // Service workers cannot create blob URLs, so use a data URL.
    // A bare file name is saved to the default downloads folder, which
    // is where the image went unless the user chose another location.
    await chrome.downloads.download({
      url: "data:application/json;charset=utf-8," + encodeURIComponent(json),
      filename: snapshot.sidecarFileName,
      conflictAction: "uniquify",
      saveAs: false
    });
  } catch (err) {
    console.error("Failed to save sidecar file:", err);

    // Release the claim so the record does not point at a missing file.
    await updateRecords((records) => {
      const record = records.find((r) => r.id === snapshot.id);
      if (!record) return false;
      record.sidecarFileName = "";
      return true;
    });
  }
}

// Chrome decides the final file name, and reports success or failure,
// some time after the download starts. Keep the record in step.
chrome.downloads.onChanged.addListener((delta) => {
  const info = {
    filename: delta.filename?.current,
    state: delta.state?.current,
    error: delta.error?.current
  };

  if (!info.filename && !info.state && !info.error) return;

  updateRecords((records) => {
    const record = findRecordByDownloadId(records, delta.id);
    return record ? applyDownloadInfo(record, info) : false;
  })
    .then((changed) => {
      if (changed && info.state === "interrupted") flashWarn();
      return writeSidecarIfWanted(delta.id);
    })
    .catch((err) => console.error("Failed to update download info:", err));
});

/* ---------- Toolbar icon + context menu ---------- */

// Clicking the toolbar icon opens the log.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(() => {
  // onInstalled also fires on extension updates; remove any existing
  // menu items first so create() does not fail with a duplicate ID.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Save image + context",
      type: "normal",
      contexts: ["image"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  if (!tab?.id) {
    console.warn("No tab ID available");
    return;
  }

  const createdAt = new Date().toISOString();
  const imageUrl = info.srcUrl;

  // 1. Start the image download.
  let downloadId = null;
  let downloadError = "";

  try {
    downloadId = await chrome.downloads.download({
      url: imageUrl,
      conflictAction: "uniquify",
      saveAs: false
    });
  } catch (err) {
    downloadError = err?.message || "download_failed_to_start";
    console.error("Error starting download:", downloadError);
  }

  // 2. Read the image's context from the page.
  const { response, lastError } = await requestMetadata(tab.id, imageUrl);

  let reason = "";
  if (lastError) {
    // No content script receiver (e.g. restricted page): the record
    // falls back to what the tab alone can tell us.
    reason = "no_content_script";
  } else if (!response?.ok) {
    reason = response?.error || "metadata_extraction_failed";
  }

  const record = buildRecord({
    createdAt,
    imageUrl,
    tab,
    response: lastError ? null : response,
    reason,
    downloadId
  });
  record.downloadError = downloadError;

  // 3. Append the record to local storage.
  try {
    await updateRecords(async (records) => {
      if (isProbablyDuplicate(records, record)) return false;

      // The download may already have a file name, or have finished,
      // before this point; pick up whatever Chrome knows so far.
      if (downloadId !== null) {
        const [item] = await chrome.downloads.search({ id: downloadId });
        if (item) applyDownloadInfo(record, item);
      }

      records.push(record);

      // Prune oldest records beyond the cap.
      if (records.length > MAX_RECORDS) {
        records.splice(0, records.length - MAX_RECORDS);
      }

      return true;
    });
  } catch (err) {
    // Most likely a storage quota error; the image may have downloaded,
    // but the citation record was not saved.
    console.error("Failed to save citation record:", err);
    await flashWarn();
    return;
  }

  // Covers a download that had already finished before the record existed.
  writeSidecarIfWanted(downloadId).catch((err) =>
    console.error("Failed to save sidecar file:", err)
  );

  const downloadFailed =
    record.downloadState === "failed" || record.downloadState === "interrupted";

  if (record.ok && !downloadFailed) {
    await flashOk();
  } else {
    await flashWarn();
  }
});
