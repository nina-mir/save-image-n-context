# Changelog

All notable changes to Save Image 'n Context are documented here.
Versions correspond to Chrome Web Store releases and git tags.

## [Unreleased]

### Changed
- New extension icon: rounded quotation marks with a landscape inside.
- Log page: extension icon in the header and browser tab, and larger
  text throughout, most noticeably the citation-file setting.

### Added
- Local capture time: records now store `createdAtLocal` (for example
  `2026-11-14 21:31:07 -08:00`) and `timeZone` (for example
  `America/Los_Angeles`) alongside the UTC `createdAt`. Both appear in
  JSON, CSV and sidecar files. Exports fill them in for older records
  using the browser's current time zone.
- Optional sidecar citation files: when the setting is on, each saved
  image gets a `<image name>.json` file beside it containing its
  citation record. Off by default. Records gain a `sidecarFileName`
  field.

## [0.6] — 2026-11-14

### Added
- Clicking the toolbar icon opens the log.
- Records now store the file name the image was saved under
  (`fileName`), shown in the log and included in JSON/CSV exports.
  Only the name is stored, never the full path.
- Download outcome tracking (`downloadState`, `downloadError`): a
  download that fails or is interrupted is flagged with the amber badge
  and a note in the log, instead of being reported as a success.
- Search across the whole log.
- "Where did this image come from?" lookup: choose or drop an image
  file to find its record by file name. The file itself is not read.
- Copy citation (plain text or Markdown) for any record.
- Editable notes on each record.
- Feedback link to the GitHub issue tracker.

### Changed
- Redesigned log page: thumbnails, status chips, grouped context.
- Fallback records now have the same fields as full records, so
  exports have a consistent shape.
- Record writes are queued so near-simultaneous captures and download
  updates cannot overwrite each other.

### Fixed
- `scripts/package.sh` checked for the wrong icon file name.

## [0.5] — 2026-07-09

Initial Chrome Web Store release candidate.

### Added
- Right-click "Save image + context" menu on any web image: downloads the
  image and records a local citation entry.
- Captured metadata: page URL/title, canonical URL, hostname, meta
  description, Open Graph title/description, image URL, alt text, title,
  aria-label, figure caption, referrer policy.
- Semantic context capture: nearest heading, nearest paragraph, linked
  URL and link text.
- Local storage of up to 5,000 records in `chrome.storage.local`.
- Options page with recent-captures viewer, JSON export, CSV export,
  and a "Clear local log" control with confirmation.
- Automatic content-script injection with retry, duplicate-capture
  detection, and success/warning badge feedback.

### Security
- CSV export guards against spreadsheet formula injection in scraped text.

### Changed (from development builds)
- Renamed extension to "Save Image 'n Context"; production manifest
  description.
- Replaced broad host access (`<all_urls>`) with `activeTab`: the
  extension can only access the page you invoke the right-click menu
  on, and only at that moment. Also removed the redundant `tabs`
  permission.
