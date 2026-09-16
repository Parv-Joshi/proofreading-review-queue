# Setup and deployment

## Prerequisites

- A Google account permitted to use Apps Script, Sheets, Docs, and Drive.
- A dedicated blank Google Sheet.
- A canonical Google Doc with stable logical unit structure.
- A disposable pilot copy of the source document.
- Optional: Node.js 18+ and `clasp` for Git-based deployments.

## Apps Script installation

1. From the blank Sheet, open **Extensions → Apps Script**.
2. Create files matching all names under `src/` and paste their contents.
3. Replace the default manifest with `src/appsscript.json` after enabling manifest visibility in project settings.
4. Run `setupProject()` from the editor.
5. Review and grant the requested permissions.
6. Return to the Sheet and inspect the created tabs and headers.

`setupProject()` stores the queue spreadsheet ID in Apps Script Script Properties. The repository never contains that ID.

## Settings

Set these values in the `Settings` sheet:

| Key | Initial value | Purpose |
|---|---|---|
| `source_document_id` | your Doc ID | Canonical live source |
| `pilot_document_id` | disposable copy ID | Safe application target |
| `application_mode` | `PILOT` | Selects pilot or live target |
| `apply_enabled` | `FALSE` | Global application kill switch |
| `live_apply_enabled` | `FALSE` | Independent live-only gate |
| `allowed_email` | reviewer account | Server-side web-app access restriction |
| `preparation_enabled` | `FALSE` | Remains false unless an adapter is installed |

IDs belong only in the live Sheet or Script Properties. Do not commit them.

## Deploy the web app

1. Choose **Deploy → New deployment → Web app**.
2. Execute as the account that owns or can edit the Sheet and Docs.
3. Restrict access to the smallest viable audience.
4. Open the deployment URL while signed in as `allowed_email`.
5. Confirm the target banner says Pilot and application is disabled.

Treat the deployment URL as environment configuration and do not commit it.

## Pilot validation

1. Inspect fictional rows with `seedDemoData()`, then import a small, correctly anchored test batch targeting the pilot Doc for end-to-end UI testing.
2. Exercise Accept, Reject, Modify, Discussion, Undo, filters, search, and keyboard navigation.
3. Confirm Audit rows are appended for each mutation.
4. Set `apply_enabled=TRUE` while keeping `application_mode=PILOT`.
5. Apply one fully resolved paragraph.
6. Verify the backup copy, exact paragraph output, application timestamps, and idempotent retry behavior.
7. Return `apply_enabled` to `FALSE`.

## Live promotion

Promote only after pilot validation and a fresh source snapshot. Verify the document IDs, import rows prepared for the live source, set both gates, and require explicit browser confirmation. Disable the gates immediately afterward.

## Optional clasp workflow

1. Install and authenticate `clasp` locally.
2. Copy `.clasp.json.example` to `.clasp.json`.
3. Put the Apps Script project ID in the local `.clasp.json` only; it is gitignored.
4. Run `clasp push`, review the diff, and create a deployment version.

Do not put OAuth tokens, Script Properties, document IDs, spreadsheet IDs, web-app URLs, or real correction exports in the repository.

## Troubleshooting

- **Run setup first**: execute `setupProject()` from the container Sheet.
- **Access denied**: verify the signed-in account matches `allowed_email`.
- **No rows visible**: confirm rows target the currently selected pilot/live document ID and their run is not quarantined.
- **Validation blocked**: fix the listed duplicate, overlap, anchor, status, or metadata issue; do not bypass validation.
- **Paragraph conflict**: the target text changed or became ambiguous. Reprepare or safely re-anchor the correction.
- **Preparation unavailable**: expected in the template. Use the read-only estimator or implement the documented adapter.
