# Import format

The example CSV files contain fictional values and match the core Sheet headers. For production use, prefer a script that validates objects and appends rows in one operation; direct CSV import is suitable only after independent validation.

## Corrections

Use all 36 columns in the exact order shown in `examples/corrections.example.csv`. At minimum:

- use globally unique `correction_id` values;
- link every row to a `run_id`;
- identify the complete logical unit and paragraph;
- store exact `original_text`, proposal, contexts, and full paragraph;
- set `status=PENDING`;
- leave selection, review, and application fields blank;
- set the actual source document ID and revision at import time;
- include tab/order and cryptographic hashes produced from the current source;
- choose a review lane but do not use it to predecide the card.

Timestamps should be ISO 8601. Use consistent text normalization when hashing; the template hashes UTF-8 strings exactly as received.

## Runs

Create one record per unit. `finding_count` must equal the number of correction rows for that run, including zero if your publisher supports explicit clean-unit records. Use `VALIDATED` only after the full unit passes checks.

## Rules

Rules are exact original/replacement pairs. Use `EXACT` or `EXACT_TOKEN` scope. Activate a rule only after human approval and evidence from applied decisions. Rules group or preview eligible occurrences; they never justify automatic acceptance.

## Import transaction

Recommended order:

1. Validate all correction objects in memory.
2. Verify no IDs collide with existing rows.
3. Mark run records `PUBLISHING`.
4. Append correction rows in bounded chunks.
5. Read back and validate count, values, locations, hashes, and states.
6. Change runs to `VALIDATED` only after successful readback.
7. Quarantine the runs if any step fails.
