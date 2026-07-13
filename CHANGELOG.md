# Changelog

All notable changes to Save Image 'n Context are documented here.
Versions correspond to Chrome Web Store releases and git tags.

## [Unreleased]

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
