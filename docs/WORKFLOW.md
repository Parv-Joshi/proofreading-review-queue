# Operational workflow

## 1. Define a complete batch

Choose a fixed range of complete logical units. A unit starts at its top-level numbered-list item and includes every continuation paragraph until the next top-level item. Blank separators are excluded. Correction count is an output, never a batch boundary or quota.

Record the included unit range, paragraph count, source document ID, and source revision before proposing corrections.

## 2. Apply already-approved trusted cleanup

Before preparing new cards:

1. Learn only repeatable patterns supported by prior applied decisions.
2. Treat Reject, Modify, and Discussion outcomes as exceptions or negative guards.
3. Preview exact matches against the current source.
4. Exclude quotations and reference-sensitive contexts unless separately reviewed.
5. Back up the source.
6. Apply guarded replacements.
7. Read back and verify every edited occurrence.
8. Capture a fresh source snapshot and revision for the new batch.

## 3. Prepare correction rows

Read full paragraphs, not isolated tokens. Preserve authorial voice, intentional dialect/style, proper names, technical terms, quotations, references, numbering, links, lists, and paragraph boundaries unless the change is explicitly justified.

Each card must use an exact source span. Merge interacting edits. Do not create overlapping siblings. Reconstruct the entire paragraph after all proposed edits and reread it.

Uncertainty is not permission to guess and is not permission to preload Discussion. Either omit the uncertain proposal or create a normal `PENDING` card with a clear explanation for human review.

## 4. Validate before publication

At minimum verify:

- global correction-ID uniqueness;
- run IDs and exact unit boundaries;
- target document and source revision;
- complete paragraph snapshots;
- tab/order locations;
- exact and unique anchors within the resolved paragraph;
- Unicode/grapheme-safe boundaries;
- no sibling overlap;
- correct reconstructed paragraph;
- zero preaccepted rows;
- zero generated Discussion rows;
- blank application state;
- run finding counts equal actual rows.

Publish the correction rows and their run records as one controlled completion, then read the Sheet back.

## 5. Review

All cards begin in Review/Pending. The reviewer may Accept, Reject, Modify, or move a card to Discussion with a note. Discussion remains unresolved until the reviewer chooses a final decision.

The UI groups cards by physical paragraph. Accepted and Modified cards do not become applicable until every sibling card is resolved.

## 6. Apply

Use a disposable pilot copy first. Resolve all validation errors before enabling application. Apply small batches and inspect the result.

For live promotion:

1. Confirm the queue rows target the canonical document ID.
2. Set `application_mode=LIVE`.
3. Set `apply_enabled=TRUE` and `live_apply_enabled=TRUE` only for the application window.
4. Confirm the live warning in the UI.
5. Verify backup creation and application results.
6. Turn both gates back off after the batch.

Never work around a conflict by weakening the matcher. Refresh the source, determine why the anchor changed, and either update the card safely or supersede it with a newly prepared row.

## 7. Learn and continue

After application, compare original proposals with the reviewer’s actual final decisions. Promote only exact low-risk rules with enough repeated evidence and no contrary outcomes. Preserve contextual, reference, proper-name, quotation, and semantic decisions as human-reviewed patterns rather than blind replacements.

Then perform the guarded cleanup and prepare the next complete batch from the new source revision.
