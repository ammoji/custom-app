#!/usr/bin/env node
/**
 * Integrity audit — catches files Windsurf has truncated mid-statement.
 * Run after every Windsurf prompt that touches multiple files.
 *   npm run audit
 * Exits 0 if clean, 1 if any file looks corrupted.
 */
const fs = require('fs');
const path = require('path');

const SOURCE_DIRS = ['src', 'scripts', 'functions/src'];
const ROOT_FILES = ['App.js', 'App.tsx', 'package.json'];
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js']);
// A healthy source file ends with one of these characters (optionally followed by whitespace).
const VALID_TAIL = /[})\];,]\s*$/;

const truncated = [];
let total = 0;

function checkSource(file) {
  total++;
  const content = fs.readFileSync(file, 'utf8');
  if (!VALID_TAIL.test(content)) {
    const tail = content.slice(-60).replace(/\n/g, '\\n').replace(/^\s+/, '');
    truncated.push({ file, tail });
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (SOURCE_EXTS.has(path.extname(entry.name))) checkSource(full);
  }
}

SOURCE_DIRS.forEach(walk);

for (const f of ROOT_FILES) {
  if (!fs.existsSync(f)) continue;
  total++;
  const content = fs.readFileSync(f, 'utf8');
  if (f === 'package.json') {
    try {
      JSON.parse(content);
    } catch (e) {
      truncated.push({ file: f, tail: `INVALID JSON: ${e.message}` });
    }
  } else if (!VALID_TAIL.test(content)) {
    const tail = content.slice(-60).replace(/\n/g, '\\n').replace(/^\s+/, '');
    truncated.push({ file: f, tail });
  }
}

if (truncated.length === 0) {
  console.log(`✓ Audit passed: ${total} files checked, all end cleanly.`);
  process.exit(0);
}

console.error(`✗ Audit FAILED: ${truncated.length} of ${total} files appear truncated:\n`);
for (const t of truncated) {
  console.error(`  ${t.file}`);
  console.error(`    tail: …${t.tail}\n`);
}
console.error('Each "tail" shows the last ~60 chars of the file. A healthy file ends with } ) ] ; or ,');
process.exit(1);
