import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ignored = new Set(['.git','node_modules']);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full); else files.push(full);
  }
}
walk(root);

const checks = [
  ['private Google file URL', /https?:\/\/(?:docs|drive)\.google\.com\/(?:document|spreadsheets|drive|file)\//i],
  ['credential-shaped token', /\b(?:sk|AIza|ghp|xox[baprs])-?[A-Za-z0-9_-]{16,}\b/],
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['project-specific corpus term', /\bVaato?\b|વાતો|વચનામૃત|Swaminarayan|Vadtal|BAPS/i],
  ['private handoff artifact', /handoff|continuity[_ -]?file/i]
];

const violations = [];
for (const file of files) {
  const relative = path.relative(root, file);
  if (relative === 'scripts/privacy-scan.mjs') continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [label, regex] of checks) if (regex.test(text)) violations.push(`${relative}: ${label}`);
}
if (violations.length) throw new Error(`Privacy scan failed:\n${violations.join('\n')}`);
console.log(`Privacy scan passed (${files.length} files).`);
