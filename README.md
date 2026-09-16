# Proofreading Review Queue

A privacy-safe Google Apps Script review queue for paragraph-anchored proofreading decisions, audit history, guarded rule reuse, and backup-first application to Google Docs.

This repository is a reusable infrastructure template. It contains no production document IDs, spreadsheet IDs, correction history, source text, account details, credentials, or links to private files.

## What it provides

- A Google Sheets database with normalized `Corrections`, `Runs`, `Rules`, `Audit`, and `Settings` tabs.
- A responsive Apps Script web app for Accept, Reject, Modify, and Discuss decisions.
- Paragraph-level readiness: a paragraph cannot be applied while any sibling correction is unresolved.
- Exact source anchoring with document tab ID, document order, paragraph fingerprint, full-text hash, and surrounding text.
- Overlap, duplicate-ID, invalid-state, stale-source, and ambiguous-location validation.
- Pilot/live target isolation, an application kill switch, a second live gate, and an explicit browser confirmation.
- Timestamped source-document backup before application.
- Idempotency keys, serialized application chunks, conflict reporting, and an immutable audit trail.
- Trusted-rule grouping and conservative rule learning from repeated applied acceptances with no exceptions.
- A read-only native-list batch estimator plus a deliberately disabled automation adapter seam.
- Fictional CSV examples and a demo-data seeder.
- Repository structure and privacy validation scripts.

## Safety invariants

These are design requirements, not optional conventions:

1. Every imported or generated correction begins as `PENDING`.
2. `DISCUSS` represents a reviewer action; it is never the default for uncertain suggestions.
3. No correction is preaccepted, including trusted-rule matches.
4. A paragraph is ready only when every correction in that paragraph is resolved.
5. Application is paragraph-atomic and edits spans from end to start.
6. Ambiguous paragraph identity, stale text, overlapping spans, or target mismatch blocks application.
7. Live application requires `apply_enabled=TRUE`, `application_mode=LIVE`, `live_apply_enabled=TRUE`, and explicit UI confirmation.
8. A timestamped backup is created before any approved changes are written.
9. Trusted find-and-replace must protect quotations and reference-sensitive paragraphs unless a human has explicitly scoped the rule.
10. Accepted, modified, rejected, and discussion decisions remain attributable in `Audit`.

## Repository layout

```text
src/                     Apps Script source and web UI
docs/                    Architecture, schema, setup, workflow, and adapter contract
examples/                Fictional CSV imports
scripts/                 Repository and privacy validation
.clasp.json.example      Optional clasp configuration
package.json             Local validation commands
```

## Quick start

1. Create a blank Google Sheet dedicated to the queue.
2. Open **Extensions → Apps Script** from that Sheet.
3. Copy every file in `src/` into the Apps Script project, preserving filenames.
4. Run `setupProject()` once from the editor and authorize the requested Google scopes.
5. In the new `Settings` tab, set `source_document_id` to the ID of the canonical Google Doc.
6. Make a disposable copy of the source Doc, put its ID in `pilot_document_id`, and keep `application_mode=PILOT`.
7. Leave `apply_enabled=FALSE` until queue import, validation, and interface testing are complete.
8. Optionally run `seedDemoData()` to inspect fictional rows in the Sheet. `DEMO-` rows are deliberately excluded from application.
9. Deploy the Apps Script as a web app for the executing account. Restrict access to the intended reviewer account or domain.
10. Import a validated batch using the schemas in `examples/` and `docs/IMPORT_FORMAT.md`.

For the complete deployment and promotion checklist, read [docs/SETUP.md](docs/SETUP.md).

## Typical operating cycle

1. Define a batch by complete source units, not by a desired correction count.
2. Extract each numbered unit plus all continuation paragraphs up to the next top-level unit.
3. Build exact, non-overlapping correction spans from the current source revision.
4. Validate and publish every new row as `PENDING`.
5. Review the batch; use Discussion only when the reviewer chooses it.
6. Resolve all corrections in a paragraph before it becomes Ready.
7. Apply through the UI, initially against the pilot copy.
8. Mine applied decisions for repeatable rules, preserving exceptions as negative evidence.
9. Preview trusted-rule coverage, back up the source, perform guarded cleanup, and read back every change.
10. Snapshot the new source revision before preparing the next batch.

## Local validation

Node.js 18 or newer is sufficient; the repository has no runtime npm dependencies.

```bash
npm test
```

The tests verify the required repository files, Apps Script manifest, critical entry points, schema width, Pending-by-default contract, disabled automation scaffold, absence of private Google file URLs, common credential patterns, and forbidden project-specific terms.

## Automated preparation

The included `Preparation.gs` creates staging sheets and provides read-only unit extraction and workload estimates. It intentionally refuses to generate or publish correction proposals. This prevents a copied repository from silently inheriting provider credentials, source-specific prompts, authority lists, or automatic-decision behavior.

If you add an AI or rules-based adapter, follow [docs/AI_PREPARATION.md](docs/AI_PREPARATION.md). The adapter must publish only validated `PENDING` rows and must never autoaccept findings.

## License

MIT. See [LICENSE](LICENSE).
