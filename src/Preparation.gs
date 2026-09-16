/**
 * Optional preparation scaffold.
 *
 * The reviewer is fully usable with rows imported into Corrections and Runs.
 * Automated proposal generation is intentionally disabled in this template.
 * Implement an adapter only after following docs/AI_PREPARATION.md.
 */
const PREPARATION = Object.freeze({
  JOBS_SHEET: 'PreparationJobs',
  TASKS_SHEET: 'PreparationTasks',
  FINDINGS_SHEET: 'PreparationFindings',
  HISTORY_SHEET: 'PreparationHistory',
  JOB_HEADERS: ['job_id','requested_units','status','created_at','updated_at','last_error'],
  TASK_HEADERS: ['job_id','unit_number','document_tab_id','start_document_order','end_document_order','source_hash','status','updated_at'],
  FINDING_HEADERS: ['job_id','unit_number','paragraph_number','original_text','proposed_text','level','category','confidence','explanation','status','created_at'],
  HISTORY_HEADERS: ['job_id','history_snapshot','created_at']
});

function ensureV14Runtime_() {
  ensureV13Runtime_();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TEMPLATE_PREPARATION_READY') === 'TRUE') return;
  withLock_(function() {
    if (props.getProperty('TEMPLATE_PREPARATION_READY') === 'TRUE') return;
    const ss = getQueueSpreadsheet_();
    ensureSheet_(ss, PREPARATION.JOBS_SHEET, PREPARATION.JOB_HEADERS);
    ensureSheet_(ss, PREPARATION.TASKS_SHEET, PREPARATION.TASK_HEADERS);
    ensureSheet_(ss, PREPARATION.FINDINGS_SHEET, PREPARATION.FINDING_HEADERS);
    ensureSheet_(ss, PREPARATION.HISTORY_SHEET, PREPARATION.HISTORY_HEADERS);
    upsertPreparationSetting_(ss, 'queue_version', '1.0.0', 'Queue schema/interface version');
    upsertPreparationSetting_(ss, 'preparation_enabled', 'FALSE', 'Enable only after installing and validating a preparation adapter');
    upsertPreparationSetting_(ss, 'preparation_mode', 'MANUAL', 'MANUAL unless a reviewed adapter is installed');
    upsertPreparationSetting_(ss, 'preparation_quarantined_run_ids', '', 'Comma-separated run IDs hidden from routine review');
    [PREPARATION.JOBS_SHEET, PREPARATION.TASKS_SHEET, PREPARATION.FINDINGS_SHEET, PREPARATION.HISTORY_SHEET]
      .forEach(function(name) {
        const sheet = ss.getSheetByName(name);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold')
          .setBackground('#17324d').setFontColor('#ffffff');
      });
    SpreadsheetApp.flush();
    props.setProperty('TEMPLATE_PREPARATION_READY', 'TRUE');
  });
}

function upsertPreparationSetting_(ss, key, value, description) {
  const sheet = ss.getSheetByName(APP.SETTINGS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) !== key) continue;
    if (key === 'queue_version') sheet.getRange(r + 1, 2, 1, 2).setValues([[value, description]]);
    return;
  }
  sheet.appendRow([key, value, description]);
}

function visibleQueueRowsV14_(rows, settings) {
  const quarantined = new Set(String(settings.preparation_quarantined_run_ids || '')
    .split(',').map(function(value) { return value.trim(); }).filter(Boolean));
  const runStatuses = {};
  readRecords_(APP.RUNS_SHEET).forEach(function(run) {
    runStatuses[String(run.run_id || '')] = String(run.status || '').toUpperCase();
  });
  return (rows || []).filter(function(row) {
    const runId = String(row.run_id || '');
    return !quarantined.has(runId) && ['PUBLISHING','QUARANTINED','FAILED'].indexOf(runStatuses[runId] || '') === -1;
  });
}

function getPreparationSummaryV14_() {
  const enabled = String(getSettings_().preparation_enabled || '').toUpperCase() === 'TRUE';
  return {enabled: enabled, mode: String(getSettings_().preparation_mode || 'MANUAL'), activeJob: null};
}

function getPreparationDashboard() {
  ensureV14Runtime_();
  return {ok:true, version:'1.0.0', enabled:false, mode:'MANUAL', jobs:[],
    suggestedStartUnit:suggestedStartUnit_(), activeJob:null, quarantinedRunIds:[]};
}

function suggestedStartUnit_() {
  const numbers = readRecords_(APP.RUNS_SHEET).map(function(row) { return Number(row.unit_number || 0); })
    .filter(function(value) { return Number.isInteger(value) && value > 0; });
  return numbers.length ? Math.max.apply(null, numbers) + 1 : 1;
}

/** Read-only workload estimate. It never writes rows or calls an external API. */
function estimatePreparationBatch(request) {
  request = request || {};
  ensureV14Runtime_();
  const startUnit = Number(request.startUnit || suggestedStartUnit_());
  if (!Number.isInteger(startUnit) || startUnit < 1) throw new Error('startUnit must be a positive integer.');
  const settings = getSettings_();
  const sourceId = requireText_(settings.source_document_id, 'Settings.source_document_id');
  const doc = DocumentApp.openById(sourceId);
  let extracted = null, endUnit = startUnit + 9;
  while (!extracted && endUnit >= startUnit) {
    try { extracted = extractUnitRangeV14_(doc, startUnit, endUnit); }
    catch (error) {
      if (!/primary numbered list/i.test(String(error && error.message || error))) throw error;
      endUnit -= 1;
    }
  }
  if (!extracted || !extracted.units.length) throw new Error('No complete units were found from unit ' + startUnit + '.');
  const perUnit = extracted.units.map(function(unit) {
    const characters = unit.paragraphs.reduce(function(sum, paragraph) { return sum + paragraph.text.length; }, 0);
    const referenceParagraphs = unit.paragraphs.filter(function(paragraph) { return referenceContextV15_(paragraph.text); }).length;
    return {unitNumber:unit.unitNumber, paragraphs:unit.paragraphs.length, characters:characters,
      referenceParagraphs:referenceParagraphs, estimatedFindings:Math.max(1, Math.round(characters * 0.012))};
  });
  const summary = perUnit.reduce(function(result, item) {
    result.paragraphs += item.paragraphs; result.characters += item.characters;
    result.referenceParagraphs += item.referenceParagraphs; result.estimatedFindings += item.estimatedFindings;
    return result;
  }, {paragraphs:0, characters:0, referenceParagraphs:0, estimatedFindings:0});
  return {ok:true, startUnit:startUnit, recommendedEndUnit:perUnit[perUnit.length - 1].unitNumber,
    inspectedEndUnit:perUnit[perUnit.length - 1].unitNumber, perUnit:perUnit, summary:summary,
    estimatedFindingLow:Math.max(1, Math.round(summary.estimatedFindings * 0.7)),
    estimatedFindingHigh:Math.max(1, Math.round(summary.estimatedFindings * 1.3)),
    reviewSlices:buildReviewSlices_(perUnit),
    note:'The estimator inspects at most ten complete units. It does not generate or publish corrections.'};
}

function buildReviewSlices_(units) {
  const slices = [];
  (units || []).forEach(function(item) {
    slices.push({startUnit:item.unitNumber, endUnit:item.unitNumber, paragraphs:item.paragraphs,
      referenceParagraphs:item.referenceParagraphs, estimatedFindings:item.estimatedFindings});
  });
  return slices;
}

/** Maps one-based unit numbers to the largest top-level native numbered list. */
function extractUnitRangeV14_(doc, startUnit, endUnit) {
  const index = indexDocumentParagraphs_(getDocumentBodies_(doc));
  const listGroups = {};
  index.forEach(function(item) {
    if (item.paragraph.getType() !== DocumentApp.ElementType.LIST_ITEM) return;
    const listItem = item.paragraph.asListItem();
    if (listItem.getNestingLevel() !== 0) return;
    const listId = String(listItem.getListId() || '');
    if (!listGroups[listId]) listGroups[listId] = [];
    listGroups[listId].push(item);
  });
  const mainListId = Object.keys(listGroups).sort(function(a, b) { return listGroups[b].length - listGroups[a].length; })[0];
  const starts = mainListId ? listGroups[mainListId] : [];
  if (!mainListId || starts.length < endUnit) throw new Error('Could not map requested units to the document primary numbered list.');
  const units = [];
  for (let number = startUnit; number <= endUnit; number += 1) {
    const start = starts[number - 1], next = starts[number] || null;
    const members = index.filter(function(item) {
      return item.tabId === start.tabId && item.order >= start.order &&
        (!next || next.tabId !== start.tabId || item.order < next.order);
    }).filter(function(item) { return String(item.text || '').trim() !== ''; });
    if (!members.length || members[0].order !== start.order) throw new Error('Unit ' + number + ' could not be extracted atomically.');
    const paragraphs = members.map(function(item, paragraphIndex) {
      return {paragraphNumber:String(paragraphIndex + 1), paragraph_number:String(paragraphIndex + 1),
        text:String(item.text || ''), documentOrder:item.order, document_order:item.order};
    });
    units.push({unitNumber:number, tabId:start.tabId, startOrder:members[0].order,
      endOrder:members[members.length - 1].order,
      sourceHash:fingerprint_(paragraphs.map(function(p) { return p.text; }).join('\u001e')), paragraphs:paragraphs});
  }
  return {mainListId:mainListId, units:units};
}

function preparationAdapterDisabled_() {
  throw new Error('Automated preparation is intentionally disabled. Import validated PENDING rows or implement the adapter contract in docs/AI_PREPARATION.md.');
}

function startPreparationJob() { return preparationAdapterDisabled_(); }
function advancePreparationJob() { return preparationAdapterDisabled_(); }
function repairBlockedPreparationJob() { return preparationAdapterDisabled_(); }
function publishPreparationJob() { return preparationAdapterDisabled_(); }
