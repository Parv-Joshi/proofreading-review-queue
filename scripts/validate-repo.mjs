import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const required = [
  'README.md','LICENSE','src/Code.gs','src/Preparation.gs','src/Index.html',
  'src/JavaScript.html','src/Stylesheet.html','src/appsscript.json',
  'docs/ARCHITECTURE.md','docs/SCHEMA.md','docs/WORKFLOW.md','docs/SETUP.md',
  'docs/AI_PREPARATION.md','docs/IMPORT_FORMAT.md','docs/SECURITY_AND_PRIVACY.md',
  'examples/corrections.example.csv','examples/runs.example.csv','examples/rules.example.csv'
];

const fail = message => { throw new Error(message); };
for (const file of required) if (!fs.existsSync(path.join(root, file))) fail(`Missing required file: ${file}`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/appsscript.json'), 'utf8'));
if (manifest.runtimeVersion !== 'V8') fail('Apps Script manifest must use V8.');

const code = fs.readFileSync(path.join(root, 'src/Code.gs'), 'utf8');
const prep = fs.readFileSync(path.join(root, 'src/Preparation.gs'), 'utf8');
for (const name of ['setupProject','getQueueData','bulkDecide','undoDecision','applyReadyChunk','validateQueueRecords_']) {
  if (!new RegExp(`function\\s+${name}\\s*\\(`).test(code)) fail(`Missing server entry point: ${name}`);
}
for (const name of ['ensureV14Runtime_','getPreparationDashboard','estimatePreparationBatch','extractUnitRangeV14_']) {
  if (!new RegExp(`function\\s+${name}\\s*\\(`).test(prep)) fail(`Missing preparation entry point: ${name}`);
}

const headerMatch = code.match(/CORRECTION_HEADERS:\s*\[([\s\S]*?)\n\s*\],\n\s*RUN_HEADERS:/);
if (!headerMatch) fail('Could not locate Corrections schema.');
const correctionHeaders = [...headerMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
if (correctionHeaders.length !== 36) fail(`Expected 36 Corrections columns; found ${correctionHeaders.length}.`);
for (const name of ['correction_id','unit_number','full_paragraph','source_document_id','document_tab_id','document_order','full_text_hash','application_key']) {
  if (!correctionHeaders.includes(name)) fail(`Corrections schema is missing ${name}.`);
}

const demoSection = code.match(/function seedDemoData\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
const demoRows = [...demoSection.matchAll(/status:\s*'([^']+)'/g)].map(match => match[1]);
if (!demoRows.length || demoRows.some(status => status !== 'PENDING')) fail('Demo/generated rows must start PENDING.');
if (!/preparation_enabled',\s*'FALSE'/.test(prep)) fail('Preparation must be disabled by default.');
if (!/Automated preparation is intentionally disabled/.test(prep)) fail('Disabled adapter guard is missing.');

console.log('Structure validation passed.');
