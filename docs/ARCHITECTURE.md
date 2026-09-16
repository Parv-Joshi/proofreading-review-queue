# Architecture

## Components

| Component | Responsibility |
|---|---|
| Google Doc | Canonical source text and paragraph structure |
| Google Sheet | Queue database, settings, run metadata, rules, and audit log |
| Apps Script server | Validation, decisions, application planning, backups, and document writes |
| HTML web app | Reviewer workflow, filtering, keyboard controls, and explicit live confirmation |
| Preparation scaffold | Read-only native-list extraction and an extension seam for a future adapter |

## Data flow

1. A preparation process reads a specific source revision and emits exact correction spans.
2. Validated rows are inserted into `Corrections`; one `Runs` record describes each logical source unit.
3. The UI loads rows matching the current application target document ID.
4. Review decisions are persisted immediately and mirrored into `Audit`.
5. A paragraph becomes Ready only when all its rows are resolved.
6. Application preflight rereads the target, resolves the stored paragraph, verifies all spans, rejects overlap, and calculates the expected final paragraph.
7. The server creates a timestamped backup, then applies each paragraph from the last span to the first.
8. Applied rows receive timestamps and application keys; failures become visible conflicts.

## Decision state machine

`PENDING` may become `ACCEPTED`, `REJECTED`, `MODIFIED`, or `DISCUSS`. A reviewer can undo a resolved decision back to `PENDING`. Discussion is not a machine-assigned uncertainty class; it records an explicit reviewer request and accompanying audit note.

Application state is separate from decision state. Accepted and Modified rows may be unapplied, Applied, or Conflict. Rejected rows are never written to the document.

## Paragraph identity

The system stores several independent signals because paragraph text can repeat:

- `source_document_id`
- `source_revision_id`
- `document_tab_id`
- `document_order`
- `paragraph_fingerprint`
- `full_text_hash`
- `full_paragraph`
- `context_before` and `context_after`
- logical `unit_number` and `paragraph_number`

Application prefers the exact stored tab/order location. If that is stale, it performs conservative text and contextual resolution. Repeated text may be disambiguated using neighboring logical paragraph anchors; unresolved ambiguity stops the write.

## Target isolation

`application_mode` selects `pilot_document_id` or `source_document_id`. Queue loading and application both filter by the resolved target ID. This prevents rows anchored to one document from being applied to the other.

## Application safeguards

- Global script lock around mutations.
- Server-side user restriction from `allowed_email`.
- `apply_enabled` kill switch.
- Independent `live_apply_enabled` gate.
- Explicit live confirmation sent by the browser and rechecked by the server.
- Read-before-write source and paragraph validation.
- Duplicate-ID and overlapping-span rejection.
- Timestamped backup before edits.
- Small serialized application chunks.
- Stable idempotency keys.
- Post-write expected-text verification.
- Audit records for decisions, undo, and application.

## Trusted rules

Rules are exact source/replacement pairs. Eligible statuses are `TRUSTED`, `AUTO`, `APPROVED`, or `ACTIVE`; supported scopes are blank, `ALL`, `EXACT`, and `EXACT_TOKEN`. The generic scanner uses Unicode word boundaries and excludes quoted spans and paragraphs that look reference-sensitive.

The reviewer may also infer an exact trusted pair after at least three applied Level 1, High-confidence acceptances and zero rejected, modified, or discussed exceptions. Inference groups review cards; it does not preaccept them.

## Extensibility

Source extraction assumes that logical units correspond to the largest top-level native numbered list in the Doc. If a different document uses headings, tables, named ranges, or custom markers, replace only `extractUnitRangeV14_` and keep the row schema and validation/application contracts unchanged.
