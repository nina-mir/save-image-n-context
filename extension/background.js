"use strict";

const MAX_RECORDS = 5000;
const MENU_ID = "save-image-and-context";

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

// Badge feedback: green check on full capture, amber "!" on partial capture.
async function flashBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
  } catch (err) {
    console.warn("Badge update failed:", err);
  }
}

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
  chrome.downloads.download(
    {
      url: imageUrl,
      conflictAction: "uniquify",
      saveAs: false
    },
    async (downloadId) => {
      const finalDownloadId = chrome.runtime.lastError ? null : downloadId;

      if (chrome.runtime.lastError) {
        console.error("Error starting download:", chrome.runtime.lastError.message);
      }

      // 2. Ensure the content script exists, then request metadata.
      await ensureContentScript(tab.id);

      let { response, lastError } = await sendMessageWithRetry(
        tab.id,
        { type: "DOWNLOAD_EXTRACT_IMAGE_METADATA", imageUrl },
        350
      );

      // If messaging still failed, try one more inject + retry.
      if (lastError) {
        const injected = await ensureContentScript(tab.id);

        if (injected) {
          const retryResult = await sendMessageWithRetry(
            tab.id,
            { type: "DOWNLOAD_EXTRACT_IMAGE_METADATA", imageUrl },
            350
          );

          response = retryResult.response;
          lastError = retryResult.lastError;
        }
      }

      let record;

      if (lastError) {
        // No content script receiver (e.g. restricted page): fall back
        // to the metadata available from the tab alone.
        record = {
          id: crypto.randomUUID(),
          createdAt,
          ok: false,
          reason: "no_content_script",
          pageUrl: tab.url || null,
          pageTitle: tab.title || null,
          canonicalUrl: "",
          hostname: "",
          metaDescription: "",
          ogTitle: "",
          ogDescription: "",
          imageUrl: imageUrl || null,
          caption: "",
          referrerPolicy: "",
          downloadId: finalDownloadId,
          notes: "",
          linkedHref: "",
          linkedText: "",
          nearestHeading: "",
          nearestParagraph: ""
        };
      } else if (!response?.ok) {
        // Content script responded but could not fully extract metadata.
        record = {
          id: crypto.randomUUID(),
          createdAt,
          ok: false,
          reason: response?.error || "metadata_extraction_failed",
          pageUrl: response?.pageUrl ?? tab.url ?? null,
          pageTitle: response?.pageTitle ?? tab.title ?? null,
          canonicalUrl: response?.canonicalUrl ?? "",
          hostname: response?.hostname ?? "",
          metaDescription: response?.metaDescription ?? "",
          ogTitle: response?.ogTitle ?? "",
          ogDescription: response?.ogDescription ?? "",
          imageUrl: response?.imageUrl ?? imageUrl ?? null,
          caption: response?.caption ?? "",
          referrerPolicy: response?.referrerPolicy ?? "",
          downloadId: finalDownloadId,
          notes: "",
          linkedHref: "",
          linkedText: "",
          nearestHeading: "",
          nearestParagraph: ""
        };
      } else {
        record = {
          id: crypto.randomUUID(),
          createdAt,
          ok: true,
          pageUrl: response?.pageUrl ?? tab.url ?? null,
          pageTitle: response?.pageTitle ?? tab.title ?? null,
          canonicalUrl: response?.canonicalUrl ?? "",
          hostname: response?.hostname ?? "",
          metaDescription: response?.metaDescription ?? "",
          ogTitle: response?.ogTitle ?? "",
          ogDescription: response?.ogDescription ?? "",
          imageUrl: response?.imageUrl ?? imageUrl ?? null,
          alt: response?.alt ?? "",
          title: response?.title ?? "",
          ariaLabel: response?.ariaLabel ?? "",
          caption: response?.caption ?? "",
          referrerPolicy: response?.referrerPolicy ?? "",
          downloadId: finalDownloadId,
          notes: "",
          linkedHref: response?.linkedHref ?? "",
          linkedText: response?.linkedText ?? "",
          nearestHeading: response?.nearestHeading ?? "",
          nearestParagraph: response?.nearestParagraph ?? ""
        };
      }

      if (record.ok) {
        await flashBadge("\u2713", "#2e7d32");
      } else {
        await flashBadge("!", "#b26a00");
      }

      // 3. Append the record to local storage.
      try {
        const { records = [] } = await chrome.storage.local.get({ records: [] });

        if (!isProbablyDuplicate(records, record)) {
          records.push(record);

          // Prune oldest records beyond the cap.
          if (records.length > MAX_RECORDS) {
            records.splice(0, records.length - MAX_RECORDS);
          }

          await chrome.storage.local.set({ records });
        }
      } catch (err) {
        // Most likely a storage quota error; the image download itself
        // has already succeeded, but the citation record was not saved.
        console.error("Failed to save citation record:", err);
        await flashBadge("!", "#b26a00");
      }
    }
  );
});

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
