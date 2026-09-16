# Spreadsheet schema

`setupProject()` creates the five core sheets. `ensureV14Runtime_()` adds four optional preparation-staging sheets.

## Corrections — 36 columns

| Column | Meaning |
|---|---|
| `correction_id` | Globally unique immutable correction key |
| `run_id` | Batch/run foreign key |
| `unit_number` | Logical top-level source unit |
| `paragraph_number` | One-based nonblank paragraph within the unit |
| `sequence` | Stable order of corrections within a run |
| `level` | Risk/complexity level, normally 1–3 |
| `category` | Human-readable correction type |
| `confidence` | Generator confidence such as High, Medium, Low |
| `original_text` | Exact source span |
| `proposed_text` | Proposed replacement |
| `modified_text` | Reviewer-authored final replacement when status is Modified |
| `context_before` | Stored left anchor around the span |
| `context_after` | Stored right anchor around the span |
| `full_paragraph` | Complete source paragraph snapshot |
| `explanation` | Concise rationale shown in the reviewer |
| `status` | `PENDING`, `ACCEPTED`, `REJECTED`, `MODIFIED`, or `DISCUSS` |
| `selected` | Optional UI selection persistence; normally blank/false |
| `reviewed_at` | Decision timestamp |
| `applied_status` | Blank, `APPLIED`, or `CONFLICT` |
| `applied_at` | Application timestamp |
| `paragraph_fingerprint` | Stable paragraph identity digest |
| `source_document_id` | Exact target Doc ID used during preparation |
| `source_revision_id` | Source revision/token recorded at preparation time |
| `created_at` | Row creation timestamp |
| `updated_at` | Last row mutation timestamp |
| `review_lane` | `TRUSTED`, `SAFE`, `CONTEXTUAL`, or `REFERENCE` |
| `document_tab_id` | Google Docs tab ID |
| `document_order` | Physical paragraph order in the indexed Doc |
| `full_text_hash` | Hash of the full paragraph text |
| `application_key` | Idempotency key from successful application |
| `verification_status` | Reference/source verification state |
| `verification_source` | Source used for verification, if any |
| `verifier_notes` | Verification explanation |
| `decision_group` | Exact repeated-decision grouping key |
| `decision_group_size` | Count in the decision group |
| `decision_group_index` | One-based position in the decision group |

Required for safe application: IDs, unit/paragraph identity, level/category/confidence, exact original and proposal, full paragraph, status, target document ID, tab/order, and hashes/anchors appropriate to the importer.

## Runs — 9 columns

`run_id`, `unit_number`, `source_document_id`, `source_revision_id`, `status`, `finding_count`, `created_at`, `validated_at`, `notes`.

Use one run record per complete logical unit. Publish a run as `VALIDATED` only after all its correction rows pass structural checks. Run status `PUBLISHING`, `QUARANTINED`, or `FAILED` hides its rows from routine review.

## Rules — 9 columns

`rule_id`, `original_pattern`, `replacement_pattern`, `level`, `category`, `scope`, `status`, `approved_at`, `notes`.

Rules should be narrow, exact, and evidence-backed. Record exceptions in notes and avoid promoting names, quotations, source-specific wording, or ambiguous semantic changes.

## Audit — 8 columns

`audit_id`, `timestamp`, `correction_id`, `action`, `old_value`, `new_value`, `device_session`, `notes`.

Audit is append-only. Do not rewrite historical events when correcting a later mistake; add a compensating decision or undo event.

## Settings — 3 columns

`key`, `value`, `description`.

Important keys: `source_document_id`, `pilot_document_id`, `apply_enabled`, `application_mode`, `live_apply_enabled`, `allowed_email`, `queue_version`, `preparation_enabled`, `preparation_mode`, and `preparation_quarantined_run_ids`.

## Preparation staging

- `PreparationJobs`: job identity and lifecycle.
- `PreparationTasks`: unit-level source boundaries and status.
- `PreparationFindings`: isolated candidate findings before publication.
- `PreparationHistory`: serialized checkpoints.

The template creates these sheets but does not populate them automatically.
