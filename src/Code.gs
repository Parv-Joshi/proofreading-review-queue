const APP = Object.freeze({
  CORRECTIONS_SHEET: 'Corrections',
  RUNS_SHEET: 'Runs',
  RULES_SHEET: 'Rules',
  AUDIT_SHEET: 'Audit',
  SETTINGS_SHEET: 'Settings',
  PAGE_SIZE: 40,
  ALLOWED_DECISIONS: ['PENDING', 'ACCEPTED', 'REJECTED', 'MODIFIED', 'DISCUSS'],
  CORRECTION_HEADERS: [
    'correction_id', 'run_id', 'unit_number', 'paragraph_number', 'sequence',
    'level', 'category', 'confidence', 'original_text', 'proposed_text',
    'modified_text', 'context_before', 'context_after', 'full_paragraph',
    'explanation', 'status', 'selected', 'reviewed_at', 'applied_status',
    'applied_at', 'paragraph_fingerprint', 'source_document_id', 'source_revision_id',
    'created_at', 'updated_at', 'review_lane', 'document_tab_id', 'document_order',
    'full_text_hash', 'application_key', 'verification_status', 'verification_source',
    'verifier_notes', 'decision_group', 'decision_group_size', 'decision_group_index'
  ],
  RUN_HEADERS: [
    'run_id', 'unit_number', 'source_document_id', 'source_revision_id',
    'status', 'finding_count', 'created_at', 'validated_at', 'notes'
  ],
  RULE_HEADERS: [
    'rule_id', 'original_pattern', 'replacement_pattern', 'level', 'category',
    'scope', 'status', 'approved_at', 'notes'
  ],
  AUDIT_HEADERS: [
    'audit_id', 'timestamp', 'correction_id', 'action', 'old_value',
    'new_value', 'device_session', 'notes'
  ],
  SETTING_HEADERS: ['key', 'value', 'description']
});

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Proofreading Review Queue')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Run once from the Apps Script editor while the blank queue spreadsheet is open. */
function setupProject() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the Apps Script project from a Google Sheet before running setupProject.');

  ensureSheet_(ss, APP.CORRECTIONS_SHEET, APP.CORRECTION_HEADERS);
  ensureSheet_(ss, APP.RUNS_SHEET, APP.RUN_HEADERS);
  ensureSheet_(ss, APP.RULES_SHEET, APP.RULE_HEADERS);
  ensureSheet_(ss, APP.AUDIT_SHEET, APP.AUDIT_HEADERS);
  ensureSheet_(ss, APP.SETTINGS_SHEET, APP.SETTING_HEADERS);

  const settings = ss.getSheetByName(APP.SETTINGS_SHEET);
  if (settings.getLastRow() === 1) {
    settings.getRange(2, 1, 8, 3).setValues([
      ['source_document_id', '', 'Google Doc ID for the canonical source document'],
      ['pilot_document_id', '', 'Disposable Google Doc copy used for application testing'],
      ['apply_enabled', 'FALSE', 'Must remain FALSE during review-interface testing'],
      ['application_mode', 'PILOT', 'PILOT or LIVE; queue rows are isolated by target document ID'],
      ['live_apply_enabled', 'FALSE', 'Second independent gate required for LIVE mode'],
      ['allowed_email', Session.getEffectiveUser().getEmail() || '', 'Only this account should use the deployed web app'],
      ['queue_version', '1.0.0', 'Queue schema/interface version'],
      ['last_setup_at', new Date().toISOString(), 'Last successful setup time']
    ]);
  }

  formatWorkbook_(ss);
  PropertiesService.getScriptProperties().setProperty('QUEUE_SPREADSHEET_ID', ss.getId());
  SpreadsheetApp.flush();
  return {ok: true, spreadsheetId: ss.getId(), spreadsheetUrl: ss.getUrl()};
}

/** Optional: adds fictional rows for schema inspection; DEMO rows are never applicable. */
function seedDemoData() {
  const now = new Date().toISOString();
  const runId = 'DEMO-' + Utilities.getUuid().slice(0, 8);
  const rows = [
    makeCorrectionRow_({
      correction_id: 'DEMO-001', run_id: runId, unit_number: '1', paragraph_number: '1', sequence: 1,
      level: '1', category: 'Spelling', confidence: 'High', original_text: 'recieve', proposed_text: 'receive',
      context_before: 'We expect to ', context_after: ' the draft tomorrow.',
      full_paragraph: 'We expect to recieve the draft tomorrow.',
      explanation: 'Corrected a spelling error.', status: 'PENDING', created_at: now, updated_at: now
    }),
    makeCorrectionRow_({
      correction_id: 'DEMO-002', run_id: runId, unit_number: '1', paragraph_number: '2', sequence: 2,
      level: '2', category: 'Grammar', confidence: 'High', original_text: 'is', proposed_text: 'are',
      context_before: 'The results ', context_after: ' ready for review.', full_paragraph: 'The results is ready for review.',
      explanation: 'Corrected subject-verb agreement.', status: 'PENDING', created_at: now, updated_at: now
    }),
    makeCorrectionRow_({
      correction_id: 'DEMO-003', run_id: runId, unit_number: '2', paragraph_number: '1', sequence: 3,
      level: '3', category: 'Reference', confidence: 'Medium', original_text: 'Section 7', proposed_text: 'Section 8',
      context_before: 'See ', context_after: ' for the governing definition.',
      full_paragraph: 'See Section 7 for the governing definition.',
      explanation: 'Reference-sensitive proposal requiring human confirmation.', status: 'PENDING', created_at: now, updated_at: now
    })
  ];

  withLock_(function() {
    const ss = getQueueSpreadsheet_();
    appendRows_(ss.getSheetByName(APP.CORRECTIONS_SHEET), rows);
    appendRows_(ss.getSheetByName(APP.RUNS_SHEET), [[
      runId, 'DEMO', '', '', 'VALIDATED', rows.length, now, now, 'Interface-only demonstration data'
    ]]);
  });
  return {ok: true, count: rows.length};
}

function getQueuePage(request) {
  request = request || {};
  const page = Math.max(1, Number(request.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(request.pageSize || APP.PAGE_SIZE)));
  const filters = {
    status: String(request.status || 'PENDING').toUpperCase(),
    level: String(request.level || 'ALL').toUpperCase(),
    unit: String(request.unit || '').trim(),
    search: String(request.search || '').trim().toLocaleLowerCase()
  };

  const records = filterCorrectionRecords_(readRecords_(APP.CORRECTIONS_SHEET), filters)
    .sort(function(a, b) {
      return compareNatural_(a.unit_number, b.unit_number) ||
        compareNatural_(a.paragraph_number, b.paragraph_number) ||
        Number(a.sequence || 0) - Number(b.sequence || 0);
    });

  const start = (page - 1) * pageSize;
  return {
    ok: true,
    rows: records.slice(start, start + pageSize),
    total: records.length,
    page: page,
    pageSize: pageSize,
    pages: Math.max(1, Math.ceil(records.length / pageSize)),
    stats: getStats_()
  };
}

/** Loads the queue once. All routine filtering, sorting and paging is client-side. */
function getQueueData() {
  ensureV14Runtime_();
  const settings = getSettings_();
  const target = getApplicationTarget_(settings);
  const rows = visibleQueueRowsV14_(readRecords_(APP.CORRECTIONS_SHEET), settings).filter(function(row) {
    return String(row.source_document_id || '').trim() === target.documentId;
  }).sort(function(a, b) {
    return compareNatural_(a.unit_number, b.unit_number) ||
      compareNatural_(a.paragraph_number, b.paragraph_number) ||
      Number(a.sequence || 0) - Number(b.sequence || 0);
  });
  const trustedRules = getTrustedRules_();
  rows.forEach(function(row) { row.review_lane = reviewLane_(row, trustedRules); });
  decorateExactDecisionGroups_(rows);
  decorateRuleFamilies_(rows, trustedRules);
  const activeRows = rows.filter(function(row) {
    return String(row.applied_status || '').toUpperCase() !== 'APPLIED' && String(row.status || '').toUpperCase() !== 'REJECTED';
  });
  return {ok: true, version: '1.0.0', rows: rows, stats: getStats_(rows),
    lanes: getLaneStats_(rows), trustedRuleCount: trustedRules.length,
    validation: validateQueueRecords_(activeRows), application: target,
    preparation: getPreparationSummaryV14_()};
}

function isWordCharV15_(character) {
  return !!character && /[\p{L}\p{M}\p{N}_]/u.test(character);
}

function exactRuleIndexesV15_(text, pattern) {
  text = String(text || ''); pattern = String(pattern || '');
  if (!pattern) return [];
  const indexes = [];
  let at = 0;
  while ((at = text.indexOf(pattern, at)) !== -1) {
    const before = at ? text.charAt(at - 1) : '';
    const after = text.charAt(at + pattern.length);
    if (!isWordCharV15_(before) && !isWordCharV15_(after)) indexes.push(at);
    at += Math.max(1, pattern.length);
  }
  return indexes;
}

function quoteRangesV15_(text) {
  text = String(text || '');
  const pairs = {'"':'"', "'":"'", '\u201c':'\u201d', '\u2018':'\u2019', '\u00ab':'\u00bb'};
  const ranges = [];
  let open = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (!open && Object.prototype.hasOwnProperty.call(pairs, ch)) open = {start:i, close:pairs[ch]};
    else if (open && ch === open.close) { ranges.push([open.start, i + 1]); open = null; }
  }
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}

function overlapsRangesV15_(start, end, ranges) {
  return (ranges || []).some(function(range) { return start < range[1] && end > range[0]; });
}

function referenceContextV15_(text) {
  return /\b(reference|citation|source|quotation|quote|verse|chapter|section|page|table|figure|appendix)\b/i
    .test(String(text || ''));
}

/** Pure scanner used by manual batch preparation and tests. */
function scanTrustedRuleParagraphV15_(text, rules) {
  text = String(text || '');
  const quotes = quoteRangesV15_(text), reference = referenceContextV15_(text), matches = [], seen = {};
  (rules || []).forEach(function(rule) {
    if (['TRUSTED','AUTO','APPROVED','ACTIVE'].indexOf(String(rule.status || '').toUpperCase()) === -1) return;
    const scope = String(rule.scope || '').toUpperCase(), id = String(rule.rule_id || '');
    if (scope && ['ALL','EXACT','EXACT_TOKEN'].indexOf(scope) === -1) return;
    let surfaces = [];
    const original = String(rule.original_pattern || ''), replacement = String(rule.replacement_pattern || '');
    if (original && replacement && original !== replacement) {
      surfaces = exactRuleIndexesV15_(text, original).map(function(start) {
        return {rule_id:id, original_text:original, proposed_text:replacement,
          start:start, end:start + original.length};
      });
    }
    surfaces.forEach(function(surface) {
      const key = [surface.start,surface.end,surface.proposed_text].join('\u001f');
      if (seen[key]) return; seen[key] = true;
      const quoted = overlapsRangesV15_(surface.start, surface.end, quotes);
      const exclusion = quoted ? 'QUOTATION' : (reference ? 'REFERENCE_CONTEXT' : '');
      surface.eligible = !exclusion;
      surface.exclusion = exclusion;
      matches.push(surface);
    });
  });
  return matches.sort(function(a,b) { return a.start - b.start || String(a.rule_id).localeCompare(String(b.rule_id)); });
}

/**
 * No-charge preview for the next manual batch. It never edits the document or
 * queue; it exposes eligible and protected matches so preparation cannot miss
 * trusted rules or silently touch quotations/references.
 */
function previewTrustedRuleCoverageV15(request) {
  request = request || {};
  ensureV14Runtime_();
  const start = Number(request.startUnit), end = Number(request.endUnit || request.startUnit);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 9) {
    throw new Error('Choose a valid range of one to ten complete Units.');
  }
  const settings = getSettings_();
  const doc = DocumentApp.openById(requireText_(settings.source_document_id, 'source_document_id'));
  const source = extractUnitRangeV14_(doc, start, end), rules = getTrustedRules_(), matches = [];
  source.units.forEach(function(unit) {
    unit.paragraphs.forEach(function(paragraph) {
      scanTrustedRuleParagraphV15_(paragraph.text, rules).forEach(function(match) {
        match.unit_number = String(unit.unitNumber);
        match.paragraph_number = String(paragraph.paragraphNumber || paragraph.paragraph_number || '');
        match.document_order = String(paragraph.documentOrder || paragraph.document_order || '');
        matches.push(match);
      });
    });
  });
  return {ok:true, version:'1.0.0', startUnit:start, endUnit:end, ruleCount:rules.length,
    eligible:matches.filter(function(match){return match.eligible;}),
    protected:matches.filter(function(match){return !match.eligible;})};
}

/** Exact learned rules are resolved during batch preparation, before routine review. */
function preprocessTrustedRules(request) {
  request = request || {};
  ensureV13Runtime_();
  const runId = String(request.runId || '').trim();
  const rules = getTrustedRules_();
  const rows = readRecords_(APP.CORRECTIONS_SHEET).filter(function(row) {
    return (!runId || String(row.run_id) === runId) && String(row.status || 'PENDING').toUpperCase() === 'PENDING' &&
      reviewLane_(row, rules) === 'TRUSTED';
  });
  if (!rows.length) return {ok:true, changed:0, summary:'No pending corrections matched trusted rules.'};
  return mutateCorrections_(rows.map(function(row){return String(row.correction_id);}), 'ACCEPTED', '',
    request.sessionId || 'trusted-preprocessor', 'Automatically resolved by an exact approved rule.');
}

/** Uses the exact production planner without creating a backup or editing the document. */
function preflightRun(request) {
  request = request || {};
  ensureV13Runtime_();
  const runId = requireText_(request.runId, 'runId');
  const target = getApplicationTarget_(getSettings_());
  const allTargetRows = readRecords_(APP.CORRECTIONS_SHEET).filter(function(row) {
    return String(row.source_document_id || '').trim() === target.documentId;
  });
  const rows = allTargetRows.filter(function(row) {
    return String(row.run_id) === runId && String(row.applied_status || '').toUpperCase() !== 'APPLIED' &&
      String(row.status || '').toUpperCase() !== 'REJECTED';
  });
  if (!rows.length) throw new Error('No unapplied correction rows were found for ' + runId + '.');
  const validation = validateQueueRecords_(rows);
  if (!validation.ok) throw new Error('Run validation failed: ' + validation.errors.slice(0, 20).join(' | '));
  const doc = DocumentApp.openById(target.documentId);
  const plans = buildApplicationPlans_(getDocumentBodies_(doc), rows, allTargetRows);
  if (request.recordLocations !== false) recordPreflightLocations_(plans, runId);
  return {ok:true, runId:runId, corrections:rows.length, paragraphs:plans.length,
    locations:plans.map(function(plan){return {unit:plan.corrections[0].row.unit_number,
      paragraph:plan.corrections[0].row.paragraph_number, tabId:plan.tabId, documentOrder:plan.documentOrder};})};
}

function recordPreflightLocations_(plans, runId) {
  const byGroup = {};
  plans.forEach(function(plan) {
    const row = plan.corrections[0].row;
    byGroup[[row.run_id,row.unit_number,row.paragraph_number,row.full_paragraph].join('\u001f')] = plan;
  });
  withLock_(function() {
    const ss = getQueueSpreadsheet_(), sheet = ss.getSheetByName(APP.CORRECTIONS_SHEET);
    const values = sheet.getDataRange().getValues(), index = headerIndex_(values[0].map(String));
    const rules = getTrustedRules_(), changedRows = [];
    for (let r = 1; r < values.length; r += 1) {
      if (String(values[r][index.run_id]) !== runId) continue;
      const key = [values[r][index.run_id],values[r][index.unit_number],values[r][index.paragraph_number],values[r][index.full_paragraph]].join('\u001f');
      const plan = byGroup[key]; if (!plan) continue;
      const record = {}; Object.keys(index).forEach(function(header){record[header]=values[r][index[header]];});
      values[r][index.review_lane] = reviewLane_(record, rules);
      values[r][index.document_tab_id] = String(plan.tabId);
      values[r][index.document_order] = String(plan.documentOrder);
      values[r][index.full_text_hash] = fingerprint_(String(values[r][index.full_paragraph] || ''));
      changedRows.push(r);
    }
    writeCorrectionTextFields_(sheet, values, index, changedRows,
      ['review_lane','document_tab_id','document_order','full_text_hash']);
    appendRows_(ss.getSheetByName(APP.AUDIT_SHEET), [[Utilities.getUuid(),new Date().toISOString(),runId,
      'PRODUCTION_PREFLIGHT','','VALIDATED','batch-preparation',plans.length + ' paragraph locations validated and recorded.']]);
    SpreadsheetApp.flush();
  });
}

function getFilteredCorrectionIds(request) {
  request = request || {};
  const filters = {
    status: String(request.status || 'PENDING').toUpperCase(),
    level: String(request.level || 'ALL').toUpperCase(),
    unit: String(request.unit || '').trim(),
    search: String(request.search || '').trim().toLocaleLowerCase()
  };
  return {
    ok: true,
    ids: filterCorrectionRecords_(readRecords_(APP.CORRECTIONS_SHEET), filters)
      .map(function(row) { return String(row.correction_id); })
  };
}

function filterCorrectionRecords_(records, filters) {
  return records.filter(function(row) {
    if (filters.status !== 'ALL' && String(row.status).toUpperCase() !== filters.status) return false;
    if (filters.level !== 'ALL' && String(row.level).toUpperCase() !== filters.level) return false;
    if (filters.unit && String(row.unit_number) !== filters.unit) return false;
    if (filters.search) {
      const haystack = [row.original_text, row.proposed_text, row.modified_text, row.full_paragraph, row.category]
        .join(' ').toLocaleLowerCase();
      if (haystack.indexOf(filters.search) === -1) return false;
    }
    return true;
  });
}

function decideCorrection(request) {
  request = request || {};
  const id = requireText_(request.correctionId, 'correctionId');
  const status = requireDecision_(request.status);
  if (status === 'MODIFIED' && !String(request.modifiedText || '').trim()) {
    throw new Error('Modified text is required when the status is MODIFIED.');
  }
  return mutateCorrections_([id], status, request.modifiedText || '', request.sessionId || '', request.notes || '');
}

function bulkDecide(request) {
  request = request || {};
  const ids = Array.isArray(request.correctionIds) ? request.correctionIds.map(String) : [];
  if (!ids.length) throw new Error('Select at least one correction.');
  const status = requireDecision_(request.status);
  if (status === 'MODIFIED') throw new Error('Bulk modification is not supported. Modify each correction individually.');
  return mutateCorrections_(ids, status, '', request.sessionId || '', request.notes || '');
}

function undoDecision(request) {
  request = request || {};
  const ids = Array.isArray(request.correctionIds) ? request.correctionIds.map(String) :
    [requireText_(request.correctionId, 'correctionId')];
  return mutateCorrections_(ids, 'PENDING', '', request.sessionId || '', request.notes || 'Decision undone');
}

/** Applies every fully reviewed, unapplied paragraph in the requested Unit (or all Units). */
function applyReadyParagraphs(request) {
  request = request || {};
  ensureV13Runtime_();
  const replay = getCachedApplicationResult_(request.idempotencyKey || '');
  if (replay) return replay;
  const unit = String(request.unit || '').trim();
  const paragraph = String(request.paragraph || '').trim();
  const target = getApplicationTarget_(getSettings_());
  const rows = readRecords_(APP.CORRECTIONS_SHEET).filter(function(row) {
    return String(row.source_document_id || '').trim() === target.documentId;
  });
  const groups = groupRowsByParagraph_(rows);
  const readyGroups = Object.keys(groups).map(function(key) { return groups[key]; }).filter(function(group) {
    if (unit && String(group[0].unit_number) !== unit) return false;
    if (paragraph && String(group[0].paragraph_number) !== paragraph) return false;
    if (group.some(function(row) { return ['PENDING', 'DISCUSS'].indexOf(String(row.status).toUpperCase()) !== -1; })) return false;
    const actionable = group.filter(function(row) { return ['ACCEPTED', 'MODIFIED'].indexOf(String(row.status).toUpperCase()) !== -1; });
    return actionable.length && actionable.some(function(row) { return String(row.applied_status).toUpperCase() !== 'APPLIED'; });
  });
  if (!readyGroups.length) throw new Error('No fully reviewed paragraphs are ready to apply.');
  // Keep every execution comfortably below Apps Script's hard time limit.
  // Paragraphs remain atomic; a later client call resumes with the next group.
  const chunkGroups = readyGroups.slice(0, 10);
  const validationRows = [];
  chunkGroups.forEach(function(group) { group.forEach(function(row) {
    if (String(row.applied_status || '').toUpperCase() !== 'APPLIED' && String(row.status || '').toUpperCase() !== 'REJECTED') validationRows.push(row);
  }); });
  const validation = validateQueueRecords_(validationRows);
  if (!validation.ok) throw new Error('Queue validation failed for the ready paragraphs: ' + validation.errors.slice(0, 10).join(' | '));
  const ids = [];
  chunkGroups.forEach(function(group) {
    group.forEach(function(row) {
      if (['ACCEPTED', 'MODIFIED'].indexOf(String(row.status).toUpperCase()) !== -1 &&
          String(row.applied_status).toUpperCase() !== 'APPLIED') ids.push(String(row.correction_id));
    });
  });
  const response = applyReviewedCorrections({
    correctionIds: ids,
    sessionId: request.sessionId || '',
    idempotencyKey: request.idempotencyKey || '',
    targetMode: request.targetMode,
    targetDocumentId: request.targetDocumentId,
    confirmLive: request.confirmLive === true
  });
  response.chunkParagraphs = chunkGroups.length;
  response.remainingReadyParagraphs = Math.max(0, readyGroups.length - chunkGroups.length);
  return response;
}

/** Applies an explicit, immutable client chunk of complete ready paragraphs.
 * The correction IDs are part of the idempotency key, so a retry can never
 * advance silently to a different paragraph chunk.
 */
function applyReadyChunk(request) {
  request = request || {};
  ensureV13Runtime_();
  const replay = getCachedApplicationResult_(request.idempotencyKey || '');
  if (replay) return replay;
  const ids = Array.isArray(request.correctionIds) ? request.correctionIds.map(String) : [];
  if (!ids.length) throw new Error('The application chunk contains no corrections. Refresh and try again.');
  const target = getApplicationTarget_(getSettings_());
  const allRows = readRecords_(APP.CORRECTIONS_SHEET).filter(function(row) {
    return String(row.source_document_id || '').trim() === target.documentId;
  });
  const wanted = new Set(ids), groups = groupRowsByParagraph_(allRows), selectedGroups = {};
  Object.keys(groups).forEach(function(key) {
    if (groups[key].some(function(row) { return wanted.has(String(row.correction_id)); })) selectedGroups[key] = groups[key];
  });
  const expected = [];
  Object.keys(selectedGroups).forEach(function(key) {
    const group = selectedGroups[key];
    if (group.some(function(row) { return ['PENDING','DISCUSS'].indexOf(String(row.status || '').toUpperCase()) !== -1; })) {
      throw new Error('A requested paragraph is no longer fully reviewed. Refresh before applying.');
    }
    group.forEach(function(row) {
      if (['ACCEPTED','MODIFIED'].indexOf(String(row.status || '').toUpperCase()) !== -1 &&
          String(row.applied_status || '').toUpperCase() !== 'APPLIED') expected.push(String(row.correction_id));
    });
  });
  const expectedSet = new Set(expected);
  if (expected.length !== ids.length || ids.some(function(id) { return !expectedSet.has(id); })) {
    throw new Error('The ready-paragraph chunk changed after confirmation. Refresh before applying.');
  }
  return applyReviewedCorrections({
    correctionIds:ids, sessionId:request.sessionId || '', idempotencyKey:request.idempotencyKey || '',
    targetMode:request.targetMode, targetDocumentId:request.targetDocumentId, confirmLive:request.confirmLive === true
  });
}

function getApplicationTarget_(settings) {
  settings = settings || getSettings_();
  const mode = String(settings.application_mode || 'PILOT').trim().toUpperCase();
  if (['PILOT', 'LIVE'].indexOf(mode) === -1) throw new Error('Settings application_mode must be PILOT or LIVE.');
  const sourceId = String(settings.source_document_id || '').trim();
  const pilotId = String(settings.pilot_document_id || '').trim();
  const documentId = mode === 'LIVE' ? sourceId : pilotId;
  if (!documentId) throw new Error('No document ID is configured for ' + mode + ' mode.');
  if (sourceId && pilotId && sourceId === pilotId) throw new Error('Safety block: pilot and live document IDs are identical.');
  const file = DriveApp.getFileById(documentId);
  const applyEnabled = String(settings.apply_enabled || '').toUpperCase() === 'TRUE';
  const liveEnabled = String(settings.live_apply_enabled || '').toUpperCase() === 'TRUE';
  return {
    mode: mode,
    documentId: documentId,
    documentTitle: file.getName(),
    enabled: applyEnabled && (mode !== 'LIVE' || liveEnabled),
    liveConfirmationRequired: mode === 'LIVE'
  };
}

function groupRowsByParagraph_(rows) {
  const groups = {};
  rows.forEach(function(row) {
    if (/^DEMO-/i.test(String(row.correction_id || ''))) return;
    const key = [row.run_id, row.unit_number, row.paragraph_number, row.full_paragraph].join('\u001f');
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });
  return groups;
}

/** Queue integrity gate: invalid cards cannot reach document application. */
function validateQueueRecords_(rows) {
  const errors = [];
  const seen = {};
  rows.forEach(function(row) {
    const id = String(row.correction_id || '');
    if (!id) { errors.push('A row has no correction_id.'); return; }
    if (seen[id]) errors.push(id + ': duplicate correction_id.');
    seen[id] = true;
    if (/^DEMO-/i.test(id)) return;
    const paragraph = String(row.full_paragraph || '');
    if (!paragraph) { errors.push(id + ': missing full_paragraph.'); return; }
    const expectedHash = fingerprint_(paragraph);
    if (String(row.paragraph_fingerprint || '') !== expectedHash) errors.push(id + ': paragraph_fingerprint is invalid.');
    if (row.full_text_hash && String(row.full_text_hash) !== expectedHash && !row.applied_status) errors.push(id + ': full_text_hash is invalid.');
    if ((row.document_tab_id && !row.document_order) || (!row.document_tab_id && row.document_order)) {
      errors.push(id + ': stored paragraph location is incomplete.');
    }
    try { findCorrectionStart_(paragraph, row); }
    catch (error) { errors.push(id + ': anchor disagrees with full_paragraph (' + error.message + ')'); }
    if (String(row.status).toUpperCase() === 'MODIFIED' && !String(row.modified_text || '').trim()) {
      errors.push(id + ': MODIFIED has no modified_text.');
    }
  });
  const groups = groupRowsByParagraph_(rows);
  Object.keys(groups).forEach(function(key) {
    const spans = [];
    groups[key].forEach(function(row) {
      try {
        const start = findCorrectionStart_(String(row.full_paragraph), row);
        spans.push({id: row.correction_id, start: start, end: start + String(row.original_text).length - 1});
      } catch (ignored) {}
    });
    spans.sort(function(a, b) { return a.start - b.start; });
    for (let i = 1; i < spans.length; i += 1) {
      if (spans[i].start <= spans[i - 1].end) errors.push(spans[i - 1].id + '/' + spans[i].id + ': overlapping anchors.');
    }
  });
  return {ok: errors.length === 0, errors: errors};
}

/** One-time v6 migration. Removes only rows whose correction_id begins DEMO-. */
function removeDemoRows() {
  return withLock_(function() {
    const ss = getQueueSpreadsheet_();
    const sheet = ss.getSheetByName(APP.CORRECTIONS_SHEET);
    if (sheet.getMaxColumns() < APP.CORRECTION_HEADERS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), APP.CORRECTION_HEADERS.length - sheet.getMaxColumns());
    }
    const values = sheet.getDataRange().getValues();
    const index = headerIndex_(values[0].map(String));
    let removed = 0;
    for (let r = values.length - 1; r >= 1; r -= 1) {
      if (/^DEMO-/i.test(String(values[r][index.correction_id] || ''))) {
        sheet.deleteRow(r + 1); removed += 1;
      }
    }
    SpreadsheetApp.flush();
    return {ok: true, removed: removed};
  });
}

/** Applies reviewed corrections to the explicitly configured PILOT or LIVE target. */
function applyReviewedCorrections(request) {
  request = request || {};
  const ids = Array.isArray(request.correctionIds) ? request.correctionIds.map(String) : [];
  if (!ids.length) throw new Error('Select at least one accepted or modified correction.');

  return withLock_(function() {
    const settings = getSettings_();
    const sourceId = String(settings.source_document_id || '').trim();
    const pilotId = String(settings.pilot_document_id || '').trim();
    const target = getApplicationTarget_(settings);
    const applicationKey = String(request.idempotencyKey || '').trim() ||
      fingerprint_([target.documentId].concat(ids.slice().sort()).join('\u001f'));
    const resultProperty = applicationResultProperty_(applicationKey);
    const priorResult = getCachedApplicationResult_(applicationKey);
    if (priorResult) return priorResult;
    if (!target.enabled) {
      throw new Error('Application is disabled in Settings.');
    }
    if (String(request.targetMode || '').toUpperCase() !== target.mode ||
        String(request.targetDocumentId || '') !== target.documentId) {
      throw new Error('Target confirmation is stale. Refresh the webpage before applying.');
    }
    if (target.mode === 'LIVE' && request.confirmLive !== true) {
      throw new Error('Live application requires explicit confirmation.');
    }
    if (target.mode === 'PILOT' && target.documentTitle.toLocaleLowerCase().indexOf('pilot') === -1) {
      throw new Error('Safety block: the target document title must contain the word “Pilot”.');
    }

    const targetFile = DriveApp.getFileById(target.documentId);

    const selected = getCorrectionRecordsByIds_(ids);
    const allTargetRows = readRecords_(APP.CORRECTIONS_SHEET).filter(function(row) {
      return String(row.source_document_id || '').trim() === target.documentId;
    });
    selected.forEach(function(row) {
      const status = String(row.status || '').toUpperCase();
      if (status !== 'ACCEPTED' && status !== 'MODIFIED') {
        throw new Error(row.correction_id + ' is not accepted or modified.');
      }
      if (String(row.applied_status || '').toUpperCase() === 'APPLIED') {
        throw new Error(row.correction_id + ' has already been applied.');
      }
      if (!String(row.full_paragraph || '')) {
        throw new Error(row.correction_id + ' has no full-paragraph snapshot.');
      }
      if (String(row.source_document_id || '').trim() !== target.documentId) {
        throw new Error(row.correction_id + ' belongs to a different target document.');
      }
    });

    const noOps = selected.filter(function(row) { return replacementFor_(row) === String(row.original_text || ''); });
    const actionable = selected.filter(function(row) { return replacementFor_(row) !== String(row.original_text || ''); });
    const doc = actionable.length ? DocumentApp.openById(target.documentId) : null;
    const bodies = doc ? getDocumentBodies_(doc) : [];
    const plans = doc ? buildApplicationPlans_(bodies, actionable, allTargetRows) : [];
    const backup = actionable.length ? targetFile.makeCopy(
      targetFile.getName() + ' – ' + target.mode.toLowerCase() + ' backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss')
    ) : null;

    const results = noOps.map(function(row) {
      return {correctionId: row.correction_id, status: 'APPLIED', message: 'No document edit was needed because replacement equals original.'};
    });
    plans.forEach(function(plan) {
      try {
        applyParagraphPlan_(plan);
        plan.corrections.forEach(function(item) {
          results.push({correctionId: item.row.correction_id, status: 'APPLIED', message: '',
            tabId: plan.tabId, documentOrder: plan.documentOrder,
            fullTextHash: fingerprint_(plan.paragraph.getText())});
        });
      } catch (error) {
        plan.corrections.forEach(function(item) {
          results.push({correctionId: item.row.correction_id, status: 'CONFLICT', message: error.message});
        });
      }
    });
    if (doc) doc.saveAndClose();
    recordApplicationResults_(results, request.sessionId || '', backup ? backup.getId() : '', target, applicationKey);
    const response = {
      ok: results.every(function(result) { return result.status === 'APPLIED'; }),
      applied: results.filter(function(result) { return result.status === 'APPLIED'; }).length,
      conflicts: results.filter(function(result) { return result.status === 'CONFLICT'; }).length,
      backupName: backup ? backup.getName() : '',
      targetMode: target.mode,
      targetTitle: target.documentTitle,
      results: results
    };
    PropertiesService.getScriptProperties().setProperty(resultProperty, JSON.stringify({
      ok:response.ok, applied:response.applied, conflicts:response.conflicts,
      backupName:response.backupName, targetMode:response.targetMode,
      targetTitle:response.targetTitle, idempotentReplay:true, results:[]
    }));
    return response;
  });
}

function applicationResultProperty_(applicationKey) {
  return 'APPLICATION_RESULT_' + fingerprint_(String(applicationKey || '')).slice(0, 24);
}

function getCachedApplicationResult_(applicationKey) {
  if (!String(applicationKey || '').trim()) return null;
  const value = PropertiesService.getScriptProperties().getProperty(applicationResultProperty_(applicationKey));
  return value ? JSON.parse(value) : null;
}

function buildApplicationPlans_(bodies, records, allRows) {
  const paragraphIndex = indexDocumentParagraphs_(bodies);
  const groups = {};
  records.forEach(function(row) {
    const key = [row.run_id, row.unit_number, row.paragraph_number, row.full_paragraph].join('\u001f');
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });

  const allGroups = groupRowsByParagraph_(allRows || records);
  const descriptors = Object.keys(groups).map(function(key) {
    const rows = groups[key];
    const snapshotParagraph = String(rows[0].full_paragraph);
    if (rows[0].paragraph_fingerprint && fingerprint_(snapshotParagraph) !== rows[0].paragraph_fingerprint) {
      throw new Error('Stored paragraph fingerprint is invalid for ' + rows[0].correction_id + '.');
    }

    const currentSnapshot = reconstructAppliedSnapshot_(snapshotParagraph, allGroups[key] || rows);
    const storedMatch = findStoredParagraphInIndex_(paragraphIndex, rows, currentSnapshot);
    const exactScan = storedMatch.length ? {matches:storedMatch, scannedParagraphs:1, tabs:bodies.length} :
      findExactParagraphsInIndex_(paragraphIndex, currentSnapshot, bodies.length);
    const contextualScan = exactScan.matches.length ? null : findContextQualifiedParagraphsInIndex_(paragraphIndex, rows, bodies.length);
    return {key:key, rows:rows, snapshot:snapshotParagraph, currentSnapshot:currentSnapshot,
      matches:exactScan.matches.length ? exactScan.matches : contextualScan.matches,
      scanned:exactScan.scannedParagraphs, tabs:exactScan.tabs};
  });

  resolveDuplicateDescriptors_(descriptors, paragraphIndex, allGroups);
  return descriptors.map(function(descriptor) {
    const rows = descriptor.rows;
    const matches = descriptor.matches;
    if (matches.length !== 1) throw paragraphMatchError_(descriptor);
    const originalParagraph = matches[0].paragraph.getText();

    const corrections = rows.map(function(row) {
      let start;
      try { start = findCorrectionStart_(originalParagraph, row); }
      catch (contextError) { start = findUniqueOriginalStart_(originalParagraph, row); }
      const original = String(row.original_text);
      return {
        row: row,
        start: start,
        end: start + original.length - 1,
        replacement: replacementFor_(row)
      };
    }).sort(function(a, b) { return a.start - b.start; });

    for (let i = 1; i < corrections.length; i += 1) {
      if (corrections[i].start <= corrections[i - 1].end) {
        throw new Error('Overlapping correction units must be merged before application: ' +
          corrections[i - 1].row.correction_id + ' and ' + corrections[i].row.correction_id + '.');
      }
    }

    let expected = originalParagraph;
    corrections.slice().sort(function(a, b) { return b.start - a.start; }).forEach(function(item) {
      expected = expected.slice(0, item.start) + item.replacement + expected.slice(item.end + 1);
    });
    return {
      paragraph: matches[0].paragraph,
      tabId: matches[0].tabId,
      documentOrder: matches[0].order,
      original: originalParagraph,
      snapshot: descriptor.snapshot,
      expected: expected,
      corrections: corrections
    };
  });
}

function findStoredParagraphInIndex_(index, rows, expectedText) {
  const tabId = String(rows[0].document_tab_id || '').trim();
  const orderText = String(rows[0].document_order || '').trim();
  if (!tabId || !/^\d+$/.test(orderText)) return [];
  const order = Number(orderText);
  const item = index.filter(function(candidate) {
    return String(candidate.tabId) === tabId && candidate.order === order;
  })[0];
  if (!item) return [];
  if (item.text === expectedText) return [item];
  try {
    rows.forEach(function(row) { findCorrectionStart_(item.text, row); });
    return [item];
  } catch (ignored) { return []; }
}

function replacementFor_(row) {
  return String(row.status || '').toUpperCase() === 'MODIFIED' ? String(row.modified_text || '') : String(row.proposed_text || '');
}

function reconstructAppliedSnapshot_(snapshot, peers) {
  const edits = (peers || []).filter(function(row) {
    return String(row.applied_status || '').toUpperCase() === 'APPLIED' && ['ACCEPTED', 'MODIFIED'].indexOf(String(row.status || '').toUpperCase()) !== -1 && replacementFor_(row) !== String(row.original_text || '');
  }).map(function(row) {
    return {start:findCorrectionStart_(snapshot, row), original:String(row.original_text || ''), replacement:replacementFor_(row)};
  }).sort(function(a,b){return b.start-a.start;});
  edits.forEach(function(edit) { snapshot = snapshot.slice(0, edit.start) + edit.replacement + snapshot.slice(edit.start + edit.original.length); });
  return snapshot;
}

function editSignature_(descriptor) {
  return descriptor.rows.map(function(row) { return [String(row.original_text || ''), replacementFor_(row)].join('\u001e'); }).sort().join('\u001d');
}

function paragraphGroupCompare_(a, b) {
  const ar = a.rows[0], br = b.rows[0];
  return compareNatural_(ar.unit_number, br.unit_number) ||
    compareNatural_(ar.paragraph_number, br.paragraph_number) ||
    compareNatural_(ar.run_id, br.run_id);
}

function paragraphUniverse_(allGroups) {
  return Object.keys(allGroups || {}).map(function(key) {
    const rows = allGroups[key];
    const snapshot = String(rows[0].full_paragraph || '');
    let currentSnapshot = null;
    try {
      currentSnapshot = reconstructAppliedSnapshot_(snapshot, rows);
    } catch (ignored) {
      // A historical group that cannot reconstruct safely is not usable as a structural anchor.
    }
    return {key:key, rows:rows, currentSnapshot:currentSnapshot};
  }).sort(paragraphGroupCompare_);
}

function uniqueStructuralAnchor_(group, paragraphIndex, resolvedByKey, cache) {
  if (!group || group.currentSnapshot == null) return null;
  if (resolvedByKey[group.key]) return resolvedByKey[group.key];
  if (Object.prototype.hasOwnProperty.call(cache, group.key)) return cache[group.key];

  const stored = findStoredParagraphInIndex_(paragraphIndex, group.rows, group.currentSnapshot);
  if (stored.length === 1) {
    cache[group.key] = stored[0];
    return stored[0];
  }
  const exact = paragraphIndex.filter(function(item) { return item.text === group.currentSnapshot; });
  cache[group.key] = exact.length === 1 ? exact[0] : null;
  return cache[group.key];
}

function resolveDuplicateDescriptors_(descriptors, paragraphIndex, allGroups) {
  const universe = paragraphUniverse_(allGroups);
  const universePos = {};
  const byCurrentText = {};

  universe.forEach(function(group, i) {
    universePos[group.key] = i;
    if (group.currentSnapshot == null) return;
    if (!byCurrentText[group.currentSnapshot]) byCurrentText[group.currentSnapshot] = [];
    byCurrentText[group.currentSnapshot].push(group);
  });

  const resolvedByKey = {};
  descriptors.forEach(function(d) {
    if (d.matches.length === 1) resolvedByKey[d.key] = d.matches[0];
  });

  /*
   * Identical paragraph text may legitimately recur in many Units (for example,
   * the provenance/reference line). Pair physical occurrences to the complete
   * logical queue, not merely to whichever ten-paragraph browser chunk is active.
   */
  descriptors.filter(function(d) { return d.matches.length > 1; }).forEach(function(d) {
    const logical = byCurrentText[d.currentSnapshot] || [];
    const physical = d.matches.slice().sort(function(a, b) { return a.order - b.order; });
    if (logical.length !== physical.length) return;
    const rank = logical.findIndex(function(group) { return group.key === d.key; });
    if (rank < 0) return;
    d.matches = [physical[rank]];
    resolvedByKey[d.key] = d.matches[0];
  });

  /*
   * If extra identical text exists outside the queue, narrow with the nearest
   * safely resolved logical neighbors. If that still leaves ambiguity, stop.
   */
  const anchorCache = {};
  let progress = true;
  while (progress) {
    progress = false;
    descriptors.filter(function(d) { return d.matches.length > 1; }).forEach(function(d) {
      const pos = universePos[d.key];
      if (typeof pos !== 'number') return;
      let before = null, after = null;
      for (let i = pos - 1; i >= 0 && !before; i -= 1) {
        before = uniqueStructuralAnchor_(universe[i], paragraphIndex, resolvedByKey, anchorCache);
      }
      for (let i = pos + 1; i < universe.length && !after; i += 1) {
        after = uniqueStructuralAnchor_(universe[i], paragraphIndex, resolvedByKey, anchorCache);
      }
      const narrowed = d.matches.filter(function(match) {
        return (!before || match.order > before.order) && (!after || match.order < after.order);
      });
      if (narrowed.length === 1) {
        d.matches = narrowed;
        resolvedByKey[d.key] = narrowed[0];
        progress = true;
      }
    });
  }
}

function paragraphMatchError_(d) {
  return new Error('V13 could not safely resolve Unit ' + d.rows[0].unit_number + ', paragraph ' + d.rows[0].paragraph_number + ': found ' + d.matches.length + ' candidate paragraphs after stored-location validation and reconstruction of already-applied sibling changes. Scanned ' + d.scanned + ' paragraphs across ' + d.tabs + ' document tabs. Repeated text is resolved by logical Unit/paragraph occurrence and neighboring structural anchors; application stops if that identity is still ambiguous.');
}

function findUniqueOriginalStart_(paragraph, row) {
  const original = String(row.original_text || '');
  const first = paragraph.indexOf(original);
  const second = first < 0 ? -1 : paragraph.indexOf(original, first + 1);
  if (first < 0 || second >= 0) throw new Error(row.correction_id + ' original text is not unique in the resolved paragraph.');
  return first;
}

function indexDocumentParagraphs_(bodies) {
  const index = [];
  function visit(element, tabId) {
    const type = element.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
      index.push({paragraph: element, tabId: tabId, text: element.getText(), order: index.length});
      return;
    }
    if (typeof element.getNumChildren !== 'function') return;
    for (let i = 0; i < element.getNumChildren(); i += 1) visit(element.getChild(i), tabId);
  }
  bodies.forEach(function(entry) { visit(entry.body, entry.tabId); });
  return index;
}

function findExactParagraphsInIndex_(index, expectedText, tabs) {
  return {matches: index.filter(function(item) { return item.text === expectedText; }), scannedParagraphs: index.length, tabs: tabs};
}

function findContextQualifiedParagraphsInIndex_(index, rows, tabs) {
  const matches = index.filter(function(item) {
    try {
      const starts = rows.map(function(row) { return findCorrectionStart_(item.text, row); });
      const unique = {};
      starts.forEach(function(start, i) {
        const key = start + ':' + String(rows[i].original_text || '').length;
        if (unique[key]) throw new Error('Duplicate correction span.');
        unique[key] = true;
      });
      return true;
    } catch (ignored) { return false; }
  });
  return {matches: matches, scannedParagraphs: index.length, tabs: tabs};
}

function getDocumentBodies_(doc) {
  const bodies = [];
  function visit(tab) {
    if (tab.getType() === DocumentApp.TabType.DOCUMENT_TAB) {
      bodies.push({tabId: tab.getId(), body: tab.asDocumentTab().getBody()});
    }
    tab.getChildTabs().forEach(visit);
  }
  doc.getTabs().forEach(visit);
  if (!bodies.length) throw new Error('No document tabs were found in the pilot document.');
  return bodies;
}

function applyParagraphPlan_(plan) {
  if (plan.paragraph.getText() !== plan.original) throw new Error('Paragraph changed after preflight.');
  const text = plan.paragraph.editAsText();
  plan.corrections.slice().sort(function(a, b) { return b.start - a.start; }).forEach(function(item) {
    const attributes = text.getAttributes(item.start);
    text.deleteText(item.start, item.end);
    if (item.replacement) {
      text.insertText(item.start, item.replacement);
      text.setAttributes(item.start, item.start + item.replacement.length - 1, attributes);
    }
  });
  if (plan.paragraph.getText() !== plan.expected) throw new Error('Post-application paragraph verification failed.');
}

function findExactParagraphs_(bodies, expectedText) {
  const matches = [];
  let scannedParagraphs = 0;
  function visitElement(element, tabId) {
    const type = element.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
      scannedParagraphs += 1;
      if (element.getText() === expectedText) matches.push({paragraph: element, tabId: tabId});
      return;
    }
    if (typeof element.getNumChildren !== 'function') return;
    for (let i = 0; i < element.getNumChildren(); i += 1) {
      visitElement(element.getChild(i), tabId);
    }
  }
  bodies.forEach(function(entry) {
    visitElement(entry.body, entry.tabId);
  });
  return {matches: matches, scannedParagraphs: scannedParagraphs, tabs: bodies.length};
}

function findContextQualifiedParagraphs_(bodies, rows) {
  const matches = [];
  let scannedParagraphs = 0;
  function visitElement(element, tabId) {
    const type = element.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
      scannedParagraphs += 1;
      const paragraphText = element.getText();
      try {
        const starts = rows.map(function(row) { return findCorrectionStart_(paragraphText, row); });
        const uniqueStarts = {};
        starts.forEach(function(start, index) {
          const spanKey = start + ':' + String(rows[index].original_text || '').length;
          if (uniqueStarts[spanKey]) throw new Error('Duplicate correction span.');
          uniqueStarts[spanKey] = true;
        });
        matches.push({paragraph: element, tabId: tabId});
      } catch (ignored) {
        // Candidate paragraphs must contain every selected correction exactly
        // once with its recorded surrounding context.
      }
      return;
    }
    if (typeof element.getNumChildren !== 'function') return;
    for (let i = 0; i < element.getNumChildren(); i += 1) visitElement(element.getChild(i), tabId);
  }
  bodies.forEach(function(entry) { visitElement(entry.body, entry.tabId); });
  return {matches: matches, scannedParagraphs: scannedParagraphs, tabs: bodies.length};
}

function findCorrectionStart_(paragraph, row) {
  const original = String(row.original_text || '');
  if (!original) throw new Error(row.correction_id + ' has an empty original string.');
  const before = String(row.context_before || '');
  const after = String(row.context_after || '');
  const candidates = [];
  let position = paragraph.indexOf(original);
  while (position !== -1) {
    const beforeMatches = !before || paragraph.slice(Math.max(0, position - before.length), position) === before;
    const afterStart = position + original.length;
    const afterMatches = !after || paragraph.slice(afterStart, afterStart + after.length) === after;
    if (beforeMatches && afterMatches) candidates.push(position);
    position = paragraph.indexOf(original, position + 1);
  }
  if (candidates.length !== 1) {
    throw new Error(row.correction_id + ' expected one context-qualified match; found ' + candidates.length + '.');
  }
  return candidates[0];
}

function recordApplicationResults_(results, sessionId, backupId, target, applicationKey) {
  const ss = getQueueSpreadsheet_();
  const sheet = ss.getSheetByName(APP.CORRECTIONS_SHEET);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const index = headerIndex_(headers);
  const byId = {};
  results.forEach(function(result) { byId[result.correctionId] = result; });
  const now = new Date().toISOString();
  const audits = [];
  const changedRows = [];
  for (let r = 1; r < values.length; r += 1) {
    const id = String(values[r][index.correction_id]);
    const result = byId[id];
    if (!result) continue;
    changedRows.push(r);
    values[r][index.applied_status] = result.status;
    values[r][index.applied_at] = result.status === 'APPLIED' ? now : '';
    values[r][index.updated_at] = now;
    if (typeof index.document_tab_id === 'number' && result.tabId != null) values[r][index.document_tab_id] = String(result.tabId);
    if (typeof index.document_order === 'number' && result.documentOrder != null) values[r][index.document_order] = String(result.documentOrder);
    if (typeof index.full_text_hash === 'number' && result.fullTextHash) values[r][index.full_text_hash] = result.fullTextHash;
    if (typeof index.application_key === 'number') values[r][index.application_key] = String(applicationKey || '');
    audits.push([
      Utilities.getUuid(), now, id, 'APPLICATION', '', result.status, sessionId,
      [result.message, 'mode=' + (target ? target.mode : ''), 'target_id=' + (target ? target.documentId : ''), 'backup_id=' + backupId].filter(String).join(' | ')
    ]);
  }
  writeCorrectionTextFields_(sheet, values, index, changedRows,
    ['applied_status', 'applied_at', 'updated_at', 'document_tab_id', 'document_order', 'full_text_hash', 'application_key']);
  appendRows_(ss.getSheetByName(APP.AUDIT_SHEET), audits);
  SpreadsheetApp.flush();
}

function getCorrectionRecordsByIds_(ids) {
  const wanted = new Set(ids);
  const records = readRecords_(APP.CORRECTIONS_SHEET).filter(function(row) {
    if (!wanted.has(String(row.correction_id))) return false;
    wanted.delete(String(row.correction_id));
    return true;
  });
  if (wanted.size) throw new Error('Some correction IDs were not found: ' + Array.from(wanted).join(', '));
  return records;
}

function getSettings_() {
  const result = {};
  readRecords_(APP.SETTINGS_SHEET).forEach(function(row) { result[row.key] = row.value; });
  return result;
}

function fingerprint_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function ensureV13Runtime_() {
  ensureV12Schema_();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('V13_RUNTIME_READY') === 'TRUE') return;
  withLock_(function() {
    if (props.getProperty('V13_RUNTIME_READY') === 'TRUE') return;
    const ss = getQueueSpreadsheet_();
    const settings = ss.getSheetByName(APP.SETTINGS_SHEET);
    const values = settings.getDataRange().getValues();
    let found = false;
    for (let r = 1; r < values.length; r += 1) {
      if (String(values[r][0]) === 'queue_version') {
        settings.getRange(r + 1, 2).setValue('1.0.0');
        found = true;
        break;
      }
    }
    if (!found) settings.appendRow(['queue_version', '1.0.0', 'Queue schema/interface version']);
    SpreadsheetApp.flush();
    props.setProperty('V13_RUNTIME_READY', 'TRUE');
  });
}

function ensureV12Schema_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('V12_SCHEMA_READY') === 'TRUE') return;
  withLock_(function() {
    if (props.getProperty('V12_SCHEMA_READY') === 'TRUE') return;
    const ss = getQueueSpreadsheet_();
    const sheet = ss.getSheetByName(APP.CORRECTIONS_SHEET);
    if (sheet.getMaxColumns() < APP.CORRECTION_HEADERS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), APP.CORRECTION_HEADERS.length - sheet.getMaxColumns());
    }
    const lastColumn = Math.max(sheet.getLastColumn(), APP.CORRECTION_HEADERS.length);
    const existing = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
    APP.CORRECTION_HEADERS.forEach(function(header, i) {
      if (!existing[i]) sheet.getRange(1, i + 1).setValue(header);
      else if (existing[i] !== header) throw new Error('V12 schema conflict at Corrections column ' + (i + 1) + ': expected ' + header + '.');
    });
    if (sheet.getLastRow() > 1) {
      const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, APP.CORRECTION_HEADERS.length).getDisplayValues();
      const fp = [], full = [];
      values.forEach(function(row) {
        const paragraph = String(row[13] || '');
        const hash = paragraph ? fingerprint_(paragraph) : '';
        fp.push([String(row[20] || hash)]); full.push([String(row[28] || hash)]);
      });
      sheet.getRange(2, 21, fp.length, 1).setValues(fp);
      sheet.getRange(2, 29, full.length, 1).setValues(full);
    }
    const settings = ss.getSheetByName(APP.SETTINGS_SHEET);
    const settingValues = settings.getDataRange().getValues();
    let found = false;
    for (let r = 1; r < settingValues.length; r += 1) {
      if (String(settingValues[r][0]) === 'queue_version') {
        settings.getRange(r + 1, 2).setValue('12'); found = true; break;
      }
    }
    if (!found) settings.appendRow(['queue_version', '12', 'Queue schema version']);
    SpreadsheetApp.flush();
    props.setProperty('V12_SCHEMA_READY', 'TRUE');
  });
}

function getTrustedRules_() {
  const explicit = readRecords_(APP.RULES_SHEET).filter(function(rule) {
    return ['TRUSTED', 'AUTO', 'APPROVED', 'ACTIVE'].indexOf(String(rule.status || '').toUpperCase()) !== -1 &&
      String(rule.original_pattern || '') && String(rule.replacement_pattern || '');
  });
  const history = {};
  readRecords_(APP.CORRECTIONS_SHEET).forEach(function(row) {
    if (String(row.level) !== '1' || String(row.confidence || '').toUpperCase() !== 'HIGH' || hasSensitiveBoundary_(row)) return;
    const key = [String(row.original_text || ''),String(row.proposed_text || '')].join('\u001f');
    if (!history[key]) history[key] = {accepted:0, exceptions:0, row:row};
    const status = String(row.status || '').toUpperCase();
    if (status === 'ACCEPTED' && String(row.applied_status || '').toUpperCase() === 'APPLIED') history[key].accepted += 1;
    if (status === 'REJECTED' || status === 'MODIFIED' || status === 'DISCUSS') history[key].exceptions += 1;
  });
  Object.keys(history).forEach(function(key) {
    const item = history[key];
    if (item.accepted < 3 || item.exceptions) return;
    explicit.push({rule_id:'LEARNED-' + fingerprint_(key).slice(0,12),
      original_pattern:item.row.original_text,replacement_pattern:item.row.proposed_text,
      level:'1',category:item.row.category,scope:'EXACT',status:'TRUSTED',
      notes:'Learned from ' + item.accepted + ' applied acceptances with no exceptions.'});
  });
  const unique = {};
  return explicit.filter(function(rule) {
    const key = [rule.original_pattern,rule.replacement_pattern].join('\u001f');
    if (unique[key]) return false; unique[key] = true; return true;
  });
}

function hasSensitiveBoundary_(row) {
  const text = [row.original_text, row.proposed_text].join(' ');
  const before = String(row.context_before || '').slice(-18);
  const after = String(row.context_after || '').slice(0, 18);
  const category = String(row.category || '').toLowerCase();
  return /[A-Za-z0-9()[\]{}]/.test(text) || /[A-Za-z0-9)\]}]\s*$/.test(before) ||
    /^\s*[A-Za-z0-9([{]/.test(after) || /reference|quotation|terminology/.test(category);
}

function ruleSurfaceMatch_(row, rule) {
  const scope = String(rule.scope || '').toUpperCase();
  if (!scope || ['ALL','EXACT','EXACT_TOKEN'].indexOf(scope) !== -1) {
    return String(rule.original_pattern) === String(row.original_text) &&
      String(rule.replacement_pattern) === String(row.proposed_text);
  }
  return false;
}

function matchingRuleFamily_(row, rules, allowSensitive) {
  if (String(row.level) !== '1' || String(row.confidence || '').toUpperCase() !== 'HIGH') return null;
  const candidates = (rules || []).filter(function(rule) { return ruleSurfaceMatch_(row, rule); });
  if (!candidates.length) return null;
  if (!allowSensitive && hasSensitiveBoundary_(row)) return null;
  return candidates[0] || null;
}

function matchingTrustedRule_(row, rules) {
  return matchingRuleFamily_(row, rules, false);
}

function decorateRuleFamilies_(rows, rules) {
  const families = {};
  (rows || []).forEach(function(row) {
    if (String(row.applied_status || '').toUpperCase() === 'APPLIED' ||
        String(row.status || 'PENDING').toUpperCase() !== 'PENDING') return;
    const surface = matchingRuleFamily_(row, rules, true);
    if (!surface) return;
    const id = String(surface.rule_id || '');
    if (!id) return;
    if (!families[id]) families[id] = {eligible:[], excluded:[], rule:surface};
    const eligible = matchingTrustedRule_(row, rules) &&
      String(row.review_lane || '').toUpperCase() !== 'REFERENCE';
    (eligible ? families[id].eligible : families[id].excluded).push(row);
  });
  Object.keys(families).forEach(function(id) {
    const family = families[id];
    if (family.eligible.length < 2) return;
    family.eligible.forEach(function(row) {
      row.rule_family_id = id;
      row.rule_family_size = family.eligible.length;
      row.rule_family_excluded = family.excluded.length;
      row.rule_family_label = String(family.rule.original_pattern || id) + ' → ' +
        String(family.rule.replacement_pattern || '');
    });
  });
}

/** One reviewer decision covers every identical, high-confidence Level 1 repair.
 * Reference-sensitive and protected-boundary rows are deliberately excluded.
 */
function decorateExactDecisionGroups_(rows) {
  const groups = {};
  (rows || []).forEach(function(row) {
    if (String(row.applied_status || '').toUpperCase() === 'APPLIED' ||
        String(row.status || 'PENDING').toUpperCase() !== 'PENDING' ||
        String(row.level || '') !== '1' ||
        String(row.confidence || '').toUpperCase() !== 'HIGH' ||
        String(row.review_lane || '').toUpperCase() === 'REFERENCE' ||
        hasSensitiveBoundary_(row)) return;
    const original = String(row.original_text || ''), proposed = String(row.proposed_text || '');
    if (!original || original === proposed) return;
    const key = original + '\u001f' + proposed;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });
  Object.keys(groups).forEach(function(key) {
    const group = groups[key];
    if (group.length < 2) return;
    const id = 'EXACT-LEVEL1-' + key;
    group.forEach(function(row, index) {
      row.decision_group = id;
      row.decision_group_size = group.length;
      row.decision_group_index = index + 1;
    });
  });
}

function reviewLane_(row, rules) {
  if (matchingTrustedRule_(row, rules)) return 'TRUSTED';
  const category = String(row.category || '').toLowerCase();
  if (String(row.level) === '3' || /reference|quotation|terminology/.test(category)) return 'REFERENCE';
  if (String(row.level) === '1' && String(row.confidence || '').toUpperCase() === 'HIGH' && !hasSensitiveBoundary_(row)) return 'SAFE';
  return 'CONTEXTUAL';
}

function getLaneStats_(rows) {
  const result = {TRUSTED:0, SAFE:0, CONTEXTUAL:0, REFERENCE:0};
  (rows || []).forEach(function(row) {
    const lane = String(row.review_lane || 'CONTEXTUAL').toUpperCase();
    result[lane] = (result[lane] || 0) + 1;
  });
  return result;
}

function getStats_(records) {
  const counts = {ALL: 0, PENDING: 0, ACCEPTED: 0, REJECTED: 0, MODIFIED: 0, DISCUSS: 0, APPLIED: 0, CONFLICT: 0};
  (records || readRecords_(APP.CORRECTIONS_SHEET)).forEach(function(row) {
    counts.ALL += 1;
    const status = String(row.status || 'PENDING').toUpperCase();
    counts[status] = (counts[status] || 0) + 1;
    const applied = String(row.applied_status || '').toUpperCase();
    if (applied === 'APPLIED') counts.APPLIED += 1;
    if (applied === 'CONFLICT') counts.CONFLICT += 1;
  });
  return counts;
}

function mutateCorrections_(ids, status, modifiedText, sessionId, notes) {
  return withLock_(function() {
    const ss = getQueueSpreadsheet_();
    const sheet = ss.getSheetByName(APP.CORRECTIONS_SHEET);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const index = headerIndex_(headers);
    const wanted = new Set(ids);
    const now = new Date().toISOString();
    const audits = [];
    const changedRows = [];
    let changed = 0;

    for (let r = 1; r < values.length; r += 1) {
      const id = String(values[r][index.correction_id]);
      if (!wanted.has(id)) continue;
      changedRows.push(r);
      const oldStatus = String(values[r][index.status] || 'PENDING');
      values[r][index.status] = status;
      values[r][index.modified_text] = status === 'MODIFIED' ? modifiedText : values[r][index.modified_text];
      values[r][index.reviewed_at] = now;
      values[r][index.updated_at] = now;
      audits.push([Utilities.getUuid(), now, id, 'DECISION', oldStatus, status, sessionId, notes]);
      wanted.delete(id);
      changed += 1;
    }

    if (wanted.size) throw new Error('Some correction IDs were not found: ' + Array.from(wanted).join(', '));
    const fields = ['status', 'reviewed_at', 'updated_at'];
    if (status === 'MODIFIED') fields.push('modified_text');
    writeCorrectionTextFields_(sheet, values, index, changedRows, fields);
    appendRows_(ss.getSheetByName(APP.AUDIT_SHEET), audits);
    SpreadsheetApp.flush();
    return {ok: true, changed: changed, status: status, stats: getStats_()};
  });
}

/** Write only mutable text fields, grouping adjacent changed rows per column.
 * Rich text writes are literal: leading apostrophes and '=' are not parsed.
 * Source text, anchors, proposals and all unrelated rows are never rewritten.
 */
function writeCorrectionTextFields_(sheet, values, index, changedRows, fields) {
  const allowed = ['status', 'modified_text', 'reviewed_at', 'applied_status', 'applied_at', 'updated_at',
    'review_lane', 'document_tab_id', 'document_order', 'full_text_hash', 'application_key',
    'verification_status', 'verification_source', 'verifier_notes'];
  fields.forEach(function(field) {
    if (allowed.indexOf(field) === -1 || typeof index[field] !== 'number') {
      throw new Error('Invalid mutable correction field: ' + field);
    }
  });
  const rows = Array.from(new Set(changedRows)).sort(function(a, b) { return a - b; });
  rows.forEach(function(row) {
    if (!Number.isInteger(row) || row < 1 || row >= values.length) throw new Error('Invalid correction row.');
  });
  fields.forEach(function(field) {
    const column = index[field];
    let offset = 0;
    while (offset < rows.length) {
      let end = offset + 1;
      while (end < rows.length && rows[end] === rows[end - 1] + 1) end += 1;
      const rich = rows.slice(offset, end).map(function(row) {
        const value = values[row][column];
        return [SpreadsheetApp.newRichTextValue().setText(value == null ? '' : String(value)).build()];
      });
      sheet.getRange(rows[offset] + 1, column + 1, rich.length, 1).setRichTextValues(rich);
      offset = end;
    }
  });
}

function readRecords_(sheetName) {
  const sheet = getQueueSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift().map(String);
  return values.filter(function(row) { return row.some(function(cell) { return cell !== ''; }); })
    .map(function(row) {
      const record = {};
      headers.forEach(function(header, i) { record[header] = row[i]; });
      return record;
    });
}

function getQueueSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('QUEUE_SPREADSHEET_ID');
  if (!id) throw new Error('Run setupProject() once before opening the web app.');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  headers.forEach(function(header, i) {
    if (!actual[i]) sheet.getRange(1, i + 1).setValue(header);
    else if (actual[i] !== header) throw new Error('Unexpected header in ' + name + ' column ' + (i + 1) + '.');
  });
  return sheet;
}

function formatWorkbook_(ss) {
  [APP.CORRECTIONS_SHEET, APP.RUNS_SHEET, APP.RULES_SHEET, APP.AUDIT_SHEET, APP.SETTINGS_SHEET]
    .forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, sheet.getLastColumn())
        .setBackground('#17324d').setFontColor('#ffffff').setFontWeight('bold');
      sheet.autoResizeColumns(1, Math.min(sheet.getLastColumn(), 10));
    });
}

function appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function makeCorrectionRow_(record) {
  return APP.CORRECTION_HEADERS.map(function(header) { return record[header] === undefined ? '' : record[header]; });
}

function headerIndex_(headers) {
  const result = {};
  headers.forEach(function(header, i) { result[header] = i; });
  return result;
}

function requireDecision_(value) {
  const status = String(value || '').toUpperCase();
  if (APP.ALLOWED_DECISIONS.indexOf(status) === -1) {
    throw new Error('Unsupported decision: ' + status);
  }
  return status;
}

function requireText_(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(name + ' is required.');
  return text;
}

function compareNatural_(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {numeric: true, sensitivity: 'base'});
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) {
    throw new Error('Lock timeout: another process is saving or applying. This action was not lost; retry after the current operation finishes.');
  }
  try { return callback(); } finally { lock.releaseLock(); }
}
