# Privacy Policy — Save Image 'n Context

Last updated: July 9, 2026

**Save Image 'n Context does not collect, transmit, sell, or share any data. Everything it saves stays in your browser, on your device.**

## What the extension does

Save Image 'n Context lets you right-click an image on a webpage to (1) download the image file to your computer and (2) save a local "citation record" describing where the image came from: the page URL and title, the image URL, its caption and alt text, nearby headings and paragraph text, and standard page metadata such as the canonical URL and Open Graph tags.

## What data is stored, and where

Citation records are stored only in your browser's local extension storage (`chrome.storage.local`) on your device. Downloaded images are saved by Chrome to your normal downloads location. Nothing is sent to the developer or to any server or third party.

## When data is collected

Metadata is read from a page only at the moment you choose "Save image + context" from the right-click menu. The extension does not read, track, or record your browsing at any other time. This is enforced by Chrome's permission model: the extension uses the `activeTab` permission, which only grants access to the current page when you invoke the menu.

## What is never collected

The extension has no analytics, no telemetry, no advertising, no user accounts, and no remote servers. It does not collect personal information, browsing history, cookies, form data, or credentials, and it makes no network requests of its own.

## Your control over your data

All saved records can be viewed on the extension's options page, exported as JSON or CSV at any time, and permanently deleted with the "Clear local log" button. Uninstalling the extension also removes all stored records. Because the data never leaves your device, there is nothing for the developer to delete on your behalf.

## Permissions explained

| Permission | Why it is needed |
| --- | --- |
| `contextMenus` | Adds the right-click "Save image + context" menu item. |
| `downloads` | Saves the selected image and your JSON/CSV exports. |
| `storage` | Stores citation records locally in your browser. |
| `scripting` | Injects the metadata-extraction script into the current page when you use the menu. |
| `activeTab` | Grants temporary access to the current page only when you use the right-click "Save image + context" menu, so the extraction script can read the clicked image's context. The extension cannot access any other tabs, or any page at any other time. |

## Changes to this policy

If a future version changes how data is handled, this page will be updated and the change noted in the extension's changelog before that version is published.

## Contact

Questions about this policy can be raised on the project's GitHub issue tracker.
