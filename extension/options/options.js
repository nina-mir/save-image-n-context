"use strict";

// How many records the list shows at first, and how many each click of
// "Show more" adds.
const PAGE_SIZE = 20;

async function getRecords() {
  const { records } = await chrome.storage.local.get({ records: [] });
  return records;
}

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

// Records saved before local times were stored only have the UTC value.
// For exports, fill the local time in from it, using this browser's
// current time zone.
function withLocalTime(record) {
  if (record.createdAtLocal) return record;

  const date = new Date(record.createdAt);
  if (isNaN(date)) return record;

  return {
    ...record,
    createdAtLocal: formatLocalTimestamp(date),
    timeZone: record.timeZone || currentTimeZone()
  };
}

async function getRecordsForExport() {
  return (await getRecords()).map(withLocalTime);
}

/* ---------- JSON export ---------- */

function downloadBlob(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);

  chrome.downloads.download({ url: blobUrl, filename, saveAs: false }, () => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
    }
    // Revoke after the download has had time to start.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  });
}

async function downloadJSON() {
  const records = await getRecordsForExport();
  const jsonTxt = JSON.stringify(records, null, 2);

  downloadBlob(
    new Blob([jsonTxt], { type: "application/json" }),
    "img-citation-logs.json"
  );
}

/* ---------- CSV export ---------- */

// Note: if nested objects are added to records later (e.g. confidence
// scores), they must be flattened before CSV export.

function escapeCSV(value) {
  if (value === null || value === undefined) return "";

  let str = String(value);

  // Guard against CSV/formula injection: values scraped from web pages
  // may start with characters that Excel interprets as formulas.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

  // Escape internal quotes.
  str = str.replace(/"/g, '""');

  // Wrap in quotes if the value contains delimiters or line breaks.
  if (/[",\n\r]/.test(str)) {
    str = `"${str}"`;
  }

  return str;
}

const CSV_HEADERS = [
  "id",
  "createdAt",
  "createdAtLocal",
  "timeZone",
  "ok",
  "reason",
  "pageTitle",
  "pageUrl",
  "canonicalUrl",
  "imageUrl",
  "fileName",
  "sidecarFileName",
  "downloadState",
  "downloadError",
  "alt",
  "title",
  "ariaLabel",
  "caption",
  "referrerPolicy",
  "downloadId",
  "notes",
  "hostname",
  "metaDescription",
  "ogTitle",
  "ogDescription",
  "linkedHref",
  "linkedText",
  "nearestHeading",
  "nearestParagraph"
];

function recordsToCSV(records) {
  const headerRow = CSV_HEADERS.join(",");

  const rows = records.map((record) =>
    CSV_HEADERS.map((header) => escapeCSV(record[header])).join(",")
  );

  return [headerRow, ...rows].join("\n");
}

async function downloadCSV() {
  const records = await getRecordsForExport();
  const csvText = recordsToCSV(records);

  const BOM = "﻿"; // Helps Excel detect UTF-8.

  downloadBlob(
    new Blob([BOM + csvText], { type: "text/csv;charset=utf-8;" }),
    "img-citation-logs.csv"
  );
}

/* ---------- Clear local log ---------- */

async function clearRecords() {
  const records = await getRecords();

  if (records.length === 0) {
    window.alert("The local log is already empty.");
    return;
  }

  const confirmed = window.confirm(
    `Delete all ${records.length} saved records from this device? ` +
      "This cannot be undone. Consider exporting first."
  );

  if (!confirmed) return;

  await chrome.storage.local.set({ records: [] });
  await render();
}

/* =========================================================================
   Citations
   ========================================================================= */

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

function endWithPeriod(text) {
  return /[.!?…]$/.test(text) ? text : text + ".";
}

function hostnameFromRecord(r) {
  if (r.hostname) return r.hostname.replace(/^www\./, "");
  if (!isWebUrl(r.pageUrl)) return ""; // e.g. chrome:// pages have no site
  try {
    return new URL(r.pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatCitationDate(value) {
  const d = new Date(value);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function isWebUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function mdText(text) {
  return text.replace(/([\\\[\]])/g, "\\$1");
}

function mdUrl(url) {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

// The pieces a citation is built from. Only what was actually captured
// is used; nothing (such as an author) is guessed.
function citationParts(r) {
  return {
    description: truncate(firstText(r.caption, r.alt, r.title, r.ariaLabel), 300),
    pageTitle: firstText(r.pageTitle, r.ogTitle),
    site: hostnameFromRecord(r),
    url: firstText(r.canonicalUrl, r.pageUrl),
    imageUrl: isWebUrl(r.imageUrl) ? r.imageUrl : "",
    retrieved: formatCitationDate(r.createdAt)
  };
}

// format: "plain" (a credit line) or "markdown" (with links).
function buildCitation(record, format = "plain") {
  const p = citationParts(record);
  const description = endWithPeriod(p.description || "Image");
  const retrieved = p.retrieved ? `Retrieved ${p.retrieved}.` : "";

  if (format === "markdown") {
    const label = mdText(p.pageTitle || p.site || p.url);
    let source = "";

    if (p.url && isWebUrl(p.url)) {
      source = `Source: [${label}](${mdUrl(p.url)})`;
    } else if (label) {
      source = `Source: ${label}`;
    }

    if (p.imageUrl) {
      const imageLink = `[image](${mdUrl(p.imageUrl)})`;
      source = source ? `${source} (${imageLink})` : `Source: ${imageLink}`;
    }

    return [mdText(description), source ? source + "." : "", retrieved]
      .filter(Boolean)
      .join(" ");
  }

  let from = "";
  if (p.pageTitle) {
    from = `From “${p.pageTitle}”${p.site ? ` (${p.site})` : ""}.`;
  } else if (p.site) {
    from = `From ${p.site}.`;
  }

  return [description, from, p.url, retrieved].filter(Boolean).join(" ");
}

/* =========================================================================
   Search and file lookup
   ========================================================================= */

const SEARCH_FIELDS = [
  "pageTitle",
  "pageUrl",
  "hostname",
  "fileName",
  "notes",
  "caption",
  "alt",
  "title",
  "ogTitle",
  "ogDescription",
  "metaDescription",
  "nearestHeading",
  "nearestParagraph",
  "linkedText"
];

// Every word in the query must appear somewhere in the record.
function matchesQuery(record, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const parts = SEARCH_FIELDS.map((key) => record[key] || "");
  if (isWebUrl(record.imageUrl)) parts.push(record.imageUrl);
  const haystack = parts.join("\n").toLowerCase();

  return words.every((word) => haystack.includes(word));
}

// "photo (2).jpg" -> "photo.jpg": Chrome adds " (n)" when a name is taken,
// and so do file managers when a file is copied.
function stripCopyNumber(name) {
  return name.replace(/ \(\d+\)(?=(\.[^.]*)?$)/, "");
}

function urlFileName(url) {
  if (!isWebUrl(url)) return "";
  try {
    const last = new URL(url).pathname.split("/").pop() || "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
}

// Find the records for an image file on disk, by its name. Exact matches
// on the saved file name come first; if there are none, fall back to
// looser matches (copy numbers ignored, or the name in the image URL,
// which also covers records made before file names were stored).
function findByFileName(records, name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return [];

  const exact = records.filter(
    (r) => (r.fileName || "").toLowerCase() === wanted
  );
  if (exact.length > 0) return exact;

  const wantedLoose = stripCopyNumber(wanted);

  return records.filter((r) => {
    const saved = (r.fileName || "").toLowerCase();
    if (saved && stripCopyNumber(saved) === wantedLoose) return true;

    const fromUrl = urlFileName(r.imageUrl).toLowerCase();
    return Boolean(fromUrl) && (fromUrl === wanted || fromUrl === wantedLoose);
  });
}

/* =========================================================================
   Rendering helpers
   ========================================================================= */

// Small helper: create an element with optional class and text.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Compact, readable timestamp instead of the full locale string.
function formatTime(value) {
  const d = new Date(value);
  if (isNaN(d)) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function downloadFailed(r) {
  return r.downloadState === "failed" || r.downloadState === "interrupted";
}

// Status chip: green "Captured" when ok, amber "Partial" otherwise.
function buildChip(ok) {
  const chip = el("span", `chip ${ok ? "chip--ok" : "chip--warn"}`);
  chip.title = ok
    ? "Image and page context captured"
    : "Image saved, but page context could not be fully captured";
  chip.append(el("span", "dot"));
  chip.append(document.createTextNode(ok ? "Captured" : "Partial"));
  return chip;
}

// Thumbnail: real captured image, with a graceful fallback tile on error.
function buildThumb(r) {
  const wrap = el("div", "record__thumb");
  if (r.imageUrl) {
    const img = el("img", "record__img");
    img.src = r.imageUrl;
    img.alt = r.alt || "Captured image";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      img.remove();
      wrap.classList.add("record__thumb--empty");
    });
    wrap.append(img);
  } else {
    wrap.classList.add("record__thumb--empty");
  }
  return wrap;
}

/* ---------- Metadata grouping ----------
   Two groups, friendly labels, and a filter pipeline that:
     1. drops empty / whitespace-only values
     2. drops any value equal to the page title
     3. drops cross-field duplicates (keeps the first)
     4. hides a group entirely when nothing survives                       */

const GROUP_DEFS = [
  {
    title: "About the image",
    fields: [
      { key: "caption", label: "Caption" },
      { key: "alt", label: "Alt text" }
    ]
  },
  {
    title: "Source page",
    fields: [
      { key: "ogDescription", label: "Summary" },
      { key: "nearestHeading", label: "Heading" },
      { key: "nearestParagraph", label: "Nearby text" }
    ]
  }
];

function buildCapturedContext(record) {
  const container = el("div", "record__groups");
  const seen = new Set();
  const titleNorm = (record.pageTitle || "").trim().toLowerCase();

  for (const group of GROUP_DEFS) {
    const kept = [];

    for (const { key, label } of group.fields) {
      const raw = record[key];
      if (!raw) continue; // (1) empty
      const value = String(raw).trim();
      if (!value) continue; // (1) whitespace-only
      const norm = value.toLowerCase();
      if (norm === titleNorm) continue; // (2) echoes the title
      if (seen.has(norm)) continue; // (3) cross-field duplicate
      seen.add(norm);
      kept.push({ label, value });
    }

    if (kept.length === 0) continue; // (4) nothing to show

    const box = el("div", "mgroup");
    box.append(el("div", "mgroup__label", group.title));

    const dl = el("dl", "mgroup__list");
    for (const { label, value } of kept) {
      const row = el("div", "field");
      row.append(el("dt", "field__key", label));
      row.append(el("dd", "field__val", value));
      dl.append(row);
    }
    box.append(dl);
    container.append(box);
  }

  return container;
}

/* ---------- Copy citation ---------- */

function buildCopyButton(record, format, label) {
  const button = el("button", "btn btn-small", label);
  button.type = "button";

  button.addEventListener("click", async () => {
    let feedback = "Copied";
    try {
      await navigator.clipboard.writeText(buildCitation(record, format));
    } catch (err) {
      console.error("Copy failed:", err);
      feedback = "Copy failed";
    }
    button.textContent = feedback;
    setTimeout(() => (button.textContent = label), 1400);
  });

  return button;
}

/* ---------- Notes ---------- */

// Set while this page is saving a note, so its own storage change does
// not trigger a re-render underneath the person typing.
let savingNote = false;

// The most recent note save. The list waits for it before re-reading
// records, so a note typed just before a click is never shown stale.
let pendingNoteSave = Promise.resolve();

async function saveNote(recordId, text) {
  savingNote = true;
  try {
    const records = await getRecords();
    const record = records.find((r) => r.id === recordId);
    if (!record || (record.notes || "") === text) return false;

    record.notes = text;
    await chrome.storage.local.set({ records });
    return true;
  } finally {
    // The storage change event can arrive just after set() resolves.
    setTimeout(() => (savingNote = false), 300);
  }
}

function buildNotes(record) {
  const wrap = el("div", "record__notes");

  const textarea = el("textarea", "input notes__input");
  textarea.rows = 1;
  textarea.placeholder = "Add a note…";
  textarea.value = record.notes || "";
  textarea.setAttribute("aria-label", "Note for this capture");

  const status = el("span", "notes__status");

  // "change" fires when the field loses focus after an edit.
  textarea.addEventListener("change", async () => {
    try {
      const save = saveNote(record.id, textarea.value.trim());
      pendingNoteSave = save.catch(() => {});
      const saved = await save;
      if (saved) {
        record.notes = textarea.value.trim();
        status.textContent = "Saved";
      }
    } catch (err) {
      console.error("Failed to save note:", err);
      status.textContent = "Could not save";
    }
    setTimeout(() => (status.textContent = ""), 1600);
  });

  wrap.append(textarea, status);
  return wrap;
}

/* ---------- One record ---------- */

function buildRecordItem(r) {
  const li = el("li", "record");

  // 1 — thumbnail
  li.append(buildThumb(r));

  // 2 — body
  const body = el("div", "record__body");

  // title + status chip
  const head = el("div", "record__head");
  const title = el("a", "record__title", r.pageTitle || r.pageUrl || "(no page url)");
  title.href = r.pageUrl || "#";
  title.target = "_blank";
  title.rel = "noreferrer";
  head.append(title, buildChip(r.ok));
  body.append(head);

  // meta line: hostname · time · view image · saved file name
  const meta = el("div", "record__meta");
  const host = hostnameFromRecord(r);
  if (host) {
    meta.append(el("span", null, host));
    meta.append(el("span", "sep", "·"));
  }
  meta.append(el("span", null, formatTime(r.createdAt)));
  if (r.imageUrl) {
    meta.append(el("span", "sep", "·"));
    const imgLink = el("a", null, "view image ↗");
    imgLink.href = r.imageUrl;
    imgLink.target = "_blank";
    imgLink.rel = "noreferrer";
    meta.append(imgLink);
  }
  if (r.fileName) {
    meta.append(el("span", "sep", "·"));
    const file = el("span", "record__file", r.fileName);
    file.title = "Saved to your downloads folder as " + r.fileName;
    meta.append(file);
    if (r.sidecarFileName) {
      const sidecar = el("span", "record__file record__file--sidecar", "+ .json");
      sidecar.title = "Citation file saved as " + r.sidecarFileName;
      meta.append(sidecar);
    }
  }
  body.append(meta);

  // optional warnings
  if (downloadFailed(r)) {
    body.append(
      el(
        "p",
        "capture-note",
        "The image file did not finish downloading. The source details below were still recorded."
      )
    );
  } else if (!r.ok) {
    body.append(
      el(
        "p",
        "capture-note",
        "Image saved, but page context could not be fully captured."
      )
    );
  }

  // metadata groups
  body.append(buildCapturedContext(r));

  // notes + copy buttons
  const footer = el("div", "record__footer");
  footer.append(buildNotes(r));

  const actions = el("div", "record__actions");
  actions.append(
    buildCopyButton(r, "plain", "Copy citation"),
    buildCopyButton(r, "markdown", "Copy as Markdown")
  );
  footer.append(actions);
  body.append(footer);

  li.append(body);
  return li;
}

/* ---------- Record list ---------- */

// What the list is showing: recent captures, search results, or the
// records matching a file the person picked; and how many of them.
const view = { query: "", lookupName: "", limit: PAGE_SIZE };

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The records the current view could show, newest first, before the
// "Show more" limit is applied.
function recordsForView(records) {
  const newestFirst = records.slice().reverse();

  if (view.lookupName) return findByFileName(newestFirst, view.lookupName);
  if (view.query) return newestFirst.filter((r) => matchesQuery(r, view.query));
  return newestFirst;
}

// appendFrom: when set, the list already shows that many records and
// only the ones after them are added (used by "Show more", so the
// records already on screen are left untouched).
async function render({ appendFrom = null } = {}) {
  await pendingNoteSave;

  const records = await getRecords();
  const matches = recordsForView(records);
  const shown = matches.slice(0, view.limit);
  const remaining = matches.length - shown.length;
  const showingText = remaining > 0 ? ` · showing ${shown.length}` : "";

  let titleText = "Recent captures";
  let countText;
  let noMatchText = "";

  if (view.lookupName) {
    titleText = "Records for " + view.lookupName;
    countText =
      (matches.length === 1 ? "1 match" : `${matches.length} matches`) +
      showingText;
    noMatchText =
      `No record found for \u201C${view.lookupName}\u201D. ` +
      "It may have been renamed, saved before file names were recorded, " +
      "or saved another way.";
  } else if (view.query) {
    titleText = "Search results";
    countText =
      `${matches.length} of ${plural(records.length, "record")}` + showingText;
    noMatchText = `Nothing in your log matches \u201C${view.query}\u201D.`;
  } else {
    countText = `${plural(records.length, "record")} · showing ${shown.length}`;
  }

  const filtering = Boolean(view.lookupName || view.query);

  document.querySelector("#logs-title").textContent = titleText;
  document.querySelector("#log-count").textContent = countText;
  document.querySelector("#clear-filter").hidden = !filtering;
  document.querySelector("#empty-state").hidden = records.length > 0;

  const noMatches = document.querySelector("#no-matches");
  noMatches.hidden = !(filtering && records.length > 0 && shown.length === 0);
  noMatches.textContent = noMatchText;

  const ul = document.querySelector("#records");
  if (appendFrom !== null && ul.children.length === appendFrom) {
    ul.append(...shown.slice(appendFrom).map(buildRecordItem));
  } else {
    ul.replaceChildren(...shown.map(buildRecordItem));
  }

  const showMore = document.querySelector("#show-more");
  showMore.hidden = remaining <= 0;
  showMore.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more`;
}

// Each click reveals the next 20 records (or however many are left).
function showMore() {
  const alreadyShown = view.limit;
  view.limit += PAGE_SIZE;
  render({ appendFrom: alreadyShown });
}

/* ---------- Settings ---------- */

async function getSettings() {
  const { settings } = await chrome.storage.local.get({ settings: {} });
  return settings || {};
}

async function wireSettings() {
  const sidecar = document.getElementById("setting-sidecar");
  sidecar.checked = Boolean((await getSettings()).sidecar);

  sidecar.addEventListener("change", async () => {
    const settings = await getSettings();
    settings.sidecar = sidecar.checked;
    await chrome.storage.local.set({ settings });
  });
}

/* ---------- Search, lookup, and drag-and-drop wiring ---------- */

function setQuery(query) {
  view.query = query.trim();
  view.lookupName = "";
  view.limit = PAGE_SIZE;
  render();
}

function lookupFile(file) {
  if (!file) return;
  view.lookupName = file.name; // only the name is used; the file is not read
  view.query = "";
  view.limit = PAGE_SIZE;
  document.getElementById("search").value = "";
  render();
}

function clearFilter() {
  view.query = "";
  view.lookupName = "";
  view.limit = PAGE_SIZE;
  document.getElementById("search").value = "";
  render();
}

function draggingFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function wireDragAndDrop() {
  const overlay = document.getElementById("drop-overlay");
  let depth = 0;

  document.addEventListener("dragenter", (event) => {
    if (!draggingFiles(event)) return;
    depth += 1;
    overlay.hidden = false;
  });

  document.addEventListener("dragleave", (event) => {
    if (!draggingFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });

  // Without preventDefault, Chrome would navigate to the dropped image.
  document.addEventListener("dragover", (event) => {
    if (draggingFiles(event)) event.preventDefault();
  });

  document.addEventListener("drop", (event) => {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.hidden = true;
    lookupFile(event.dataTransfer.files[0]);
  });
}

function wire() {
  document.getElementById("export-json").addEventListener("click", downloadJSON);
  document.getElementById("export-csv").addEventListener("click", downloadCSV);
  document.getElementById("clear-records").addEventListener("click", clearRecords);
  document.getElementById("view-last-20").addEventListener("click", () => render());
  document.getElementById("show-more").addEventListener("click", showMore);
  document.getElementById("clear-filter").addEventListener("click", clearFilter);

  const search = document.getElementById("search");
  search.addEventListener("input", () => setQuery(search.value));

  const lookupInput = document.getElementById("lookup-input");
  document
    .getElementById("lookup-button")
    .addEventListener("click", () => lookupInput.click());
  lookupInput.addEventListener("change", () => {
    lookupFile(lookupInput.files[0]);
    lookupInput.value = ""; // allow picking the same file again
  });

  wireDragAndDrop();
  wireSettings();

  // Keep the list current while the page is open: new captures, and
  // file names arriving once a download finishes. Skipped while a note
  // is being edited or saved, so typing is never interrupted.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.records || savingNote) return;
    if (document.activeElement?.classList.contains("notes__input")) return;
    render();
  });

  render();
}

document.addEventListener("DOMContentLoaded", wire);
