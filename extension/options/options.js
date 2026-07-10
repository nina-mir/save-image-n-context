"use strict";

async function getRecords() {
  const { records } = await chrome.storage.local.get({ records: [] });
  return records;
}

/* ---------- JSON export ---------- */

async function downloadJSON() {
  const records = await getRecords();
  const jsonTxt = JSON.stringify(records, null, 2);

  const blob = new Blob([jsonTxt], { type: "application/json" });
  const blobUrl = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url: blobUrl,
      filename: "img-citation-logs.json",
      saveAs: false
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
      }
      // Revoke after the download has had time to start.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    }
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

function recordsToCSV(records) {
  const headers = [
    "id",
    "createdAt",
    "ok",
    "reason",
    "pageTitle",
    "pageUrl",
    "canonicalUrl",
    "imageUrl",
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
  const headerRow = headers.join(",");

  const rows = records.map((record) =>
    headers.map((header) => escapeCSV(record[header])).join(",")
  );

  return [headerRow, ...rows].join("\n");
}

async function downloadCSV() {
  const records = await getRecords();
  const csvText = recordsToCSV(records);

  const BOM = "\uFEFF"; // Helps Excel detect UTF-8.

  const blob = new Blob([BOM + csvText], { type: "text/csv;charset=utf-8;" });
  const blobUrl = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url: blobUrl,
      filename: "img-citation-logs.csv",
      saveAs: false
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    }
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
  await renderLast20();
}

/* ---------- Record list ---------- */

async function renderLast20() {
  const records = await getRecords();
  const last20 = records.slice(-20).reverse();

  document.querySelector("#log-count").textContent =
    `Total records: ${records.length} (showing ${last20.length})`;

  const emptyState = document.querySelector("#empty-state");
  emptyState.hidden = records.length > 0;

  const ul = document.querySelector("#records");
  ul.innerHTML = "";

  for (const r of last20) {
    const li = document.createElement("li");

    const status = document.createElement("span");
    status.textContent = r.ok ? "\u2705" : "\u26A0\uFE0F";
    status.title = r.ok
      ? "Image and page context captured"
      : "Image saved, but page context could not be fully captured";
    status.style.marginRight = "0.5rem";

    const when = document.createElement("span");
    when.textContent = new Date(r.createdAt).toLocaleString();
    when.style.marginRight = "0.5rem";

    const page = document.createElement("a");
    page.href = r.pageUrl || "#";
    page.textContent = r.pageTitle || r.pageUrl || "(no page url)";
    page.target = "_blank";
    page.rel = "noreferrer";
    page.style.marginRight = "0.5rem";

    const img = document.createElement("a");
    img.href = r.imageUrl || "#";
    img.textContent = "image";
    img.target = "_blank";
    img.rel = "noreferrer";

    li.append(status, when, page, img);

    if (!r.ok) {
      const note = document.createElement("p");
      note.classList.add("capture-note");
      note.textContent =
        "Image saved, but page context could not be fully captured.";
      li.append(note);
    }

    li.append(buildCapturedContext(r));
    ul.appendChild(li);
  }
}

// Build the expandable "Captured context" block for a record.
function buildCapturedContext(record) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.innerText = "Captured context";
  details.appendChild(summary);

  const keys = [
    "caption",
    "alt",
    "ogTitle",
    "ogDescription",
    "nearestHeading",
    "nearestParagraph"
  ];

  for (const item of keys) {
    const paragraph = document.createElement("p");
    const keyText = document.createElement("em");
    keyText.textContent = item + ":";
    const textInfo = document.createElement("span");
    textInfo.classList.add("captured-txt");
    textInfo.innerText = record[item] || "";
    paragraph.append(keyText, " ", textInfo);
    details.appendChild(paragraph);
  }

  return details;
}

/* ---------- Wiring ---------- */

document.getElementById("export-json").addEventListener("click", downloadJSON);
document.getElementById("export-csv").addEventListener("click", downloadCSV);
document.getElementById("clear-records").addEventListener("click", clearRecords);
document.getElementById("view-last-20").addEventListener("click", renderLast20);

document.addEventListener("DOMContentLoaded", renderLast20);
