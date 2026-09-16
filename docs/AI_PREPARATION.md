# Automated preparation adapter contract

Automated proposal generation is disabled by design. `Preparation.gs` supplies staging sheets, a read-only unit extractor, an estimator, and explicit failure functions. This avoids shipping credentials, provider assumptions, private prompts, or source-specific authority rules.

## Required guarantees

Any adapter must:

1. Be disabled by default and require an explicit setting to run.
2. Read source text from the configured document at execution time.
3. Pin and record the source document ID and revision/token.
4. Stage output outside `Corrections` until the entire requested batch validates.
5. Generate exact source spans with complete paragraph snapshots and physical locations.
6. Merge interacting changes and reject overlapping siblings.
7. Reconstruct and reread every affected paragraph.
8. Publish every generated card as `PENDING`.
9. Publish zero default Discussion cards and zero preaccepted cards.
10. Never use trusted status to bypass human review.
11. Record provider/model/prompt versions without storing API keys or sensitive prompts in Sheet rows.
12. Stop on malformed output, missing units, changed source, ambiguous spans, or validation errors.
13. Publish correction and run rows atomically or use a recoverable `PUBLISHING`/quarantine protocol.
14. Read back and validate the published rows.

## Suggested adapter lifecycle

`CREATED → EXTRACTING → GENERATING → AUDITING → VALIDATING → READY_TO_PUBLISH → PUBLISHED`

Failures should become `NEEDS_REVIEW`, `FAILED`, or `QUARANTINED`; never partially expose uncertain rows in the normal reviewer.

## Interface functions

The UI expects these server functions:

- `getPreparationDashboard()`
- `estimatePreparationBatch({startUnit})`
- `startPreparationJob({startUnit,endUnit})`
- `advancePreparationJob({jobId})`
- `repairBlockedPreparationJob({jobId})`
- `publishPreparationJob({jobId})`

The template implements the first two and intentionally throws for the mutation functions. An adapter may replace those four functions while preserving the safety contract.

## Provider isolation

Store provider credentials only in Apps Script Script Properties or a dedicated secret manager. Do not store keys in source, Sheets, logs, audit notes, or Git. Keep provider calls in a separate file/module so the reviewer and application engine remain deterministic and testable without network access.

## Domain-specific policy

Authority lists, protected terminology, quotation rules, dialect rules, and source hierarchy belong in deployment configuration or a private policy module. Do not bake a specific organization, text corpus, person, or private source into this reusable repository.
