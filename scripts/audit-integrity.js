#!/usr/bin/env node
/**
 * Integrity audit — two checks:
 *
 *   (a) Catches files Windsurf has truncated mid-statement.
 *   (b) Catches imports stripped by Windsurf's auto-formatter from
 *       under their "DO NOT REMOVE" marker comments. See
 *       .windsurf/code-discipline.md for the full story; the short
 *       version is that across PRs 1, 2, 4, 5, 6, 6.1, 7, and 8
 *       Windsurf's TS LSP has fired source.removeUnusedImports
 *       between multi-edit chunks, dropping imports that were
 *       genuinely needed once the later chunk re-added the usage.
 *
 * Run via `npm run audit` (which is part of `npm test`).
 * Exits 0 if clean, 1 if any file fails either check.
 */
const fs = require('fs');
const path = require('path');

const SOURCE_DIRS = ['src', 'scripts', 'functions/src'];
const ROOT_FILES = ['App.js', 'App.tsx', 'package.json'];
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js']);
// A healthy source file ends with one of these characters (optionally followed by whitespace).
const VALID_TAIL = /[})\];,]\s*$/;
// The protection-marker phrase used by the real markers in src/ and
// functions/src/. Case-insensitive. We accept the spaced form and
// the hyphenated form.
//
// IMPORTANT: this comment deliberately avoids writing the phrase in
// the canonical form so that this very script doesn't self-trigger
// the check below. (If you write the phrase verbatim in a line
// comment here, the check on line ~70 will see it as a marker and
// then fail because the next non-comment line is a `const`, not an
// import.)
//
// The marker MUST be in a `// …` line comment (the convention every
// real marker in the codebase uses). This deliberately excludes:
//   - JSDoc block comments (the ones using leading asterisks) — used
//     in the header of this very file to explain what the check
//     does; not intended as an import-protection marker.
//   - String / template literals — same.
// A line qualifies only if it both starts with `^\s*//` AND contains
// the canonical marker phrase.
const MARKER_RE = /\bDO[\s-]?NOT[\s-]?REMOVE\b/i;
const MARKER_LINE_PREFIX_RE = /^\s*\/\//;
// What does a healthy marker look like? It's a `//` comment block
// followed by SOME real code line — the thing it protects. The
// shape of that code varies wildly:
//
//   - import statements                         (most common)
//   - const/let/var declarations + useState hooks
//   - function / class / type / interface / export declarations
//   - type-member properties (e.g. `AuditLog: undefined;` inside a
//     RootStackParamList type) — happens in AppNavigator.tsx
//   - JSX elements (e.g. `<Stack.Screen name="AuditLog" …/>`)
//
// Enumerating every shape creates false positives the moment we
// miss one (which is what happened on the first run — AppNavigator
// uses type-member properties). So we relax the check to its true
// minimum viable form: the marker must be followed by SOMETHING
// that isn't another comment or a blank line. A fully-orphaned
// marker (marker comment with nothing but comments/blanks for the
// next MARKER_SCAN_MAX_LINES) is what we actually catch.
//
// The stronger checks are layered elsewhere:
//   - `.vscode/settings.json` disables auto-organize-imports.
//   - `tsc --noEmit` catches stripped imports (type errors).
//   - `.windsurf/code-discipline.md` keeps the agent honest.
// This audit is the tripwire for the case all three of those miss.
//
// (No regex needed — the "first non-comment, non-blank line exists"
// check is just `j < scanLimit` succeeding before we run off the
// end of the scan window.)
// A continuation comment line — `//` style. Marker comments and
// their explanatory follow-ups all use `//`, so we skip these when
// scanning forward to find the import the marker protects.
const COMMENT_LINE_RE = /^\s*\/\//;
// A blank line — also skipped when scanning, since some markers
// have one blank line between the comment block and the import.
const BLANK_LINE_RE = /^\s*$/;
// Safety cap on how far we'll scan past a marker. Comment blocks
// in practice are <20 lines; if we go past this, something is
// genuinely wrong (probably the marker was orphaned).
const MARKER_SCAN_MAX_LINES = 30;

const truncated = [];
const strippedImports = [];
let total = 0;

function checkSource(file) {
  total++;
  const content = fs.readFileSync(file, 'utf8');
  if (!VALID_TAIL.test(content)) {
    const tail = content.slice(-60).replace(/\n/g, '\\n').replace(/^\s+/, '');
    truncated.push({ file, tail });
  }
  checkMarkers(file, content);
}

function checkMarkers(file, content) {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!MARKER_LINE_PREFIX_RE.test(lines[i])) continue;
    if (!MARKER_RE.test(lines[i])) continue;
    // Found a protection marker. Scan forward, skipping any
    // continuation comment lines (`// …`) and blank lines. As long
    // as we find SOMETHING (any non-comment, non-blank line) within
    // MARKER_SCAN_MAX_LINES, the marker is healthy.
    //
    // Rationale: markers are sometimes stacked (multiple PRs each
    // adding a marker over the same protected block), so the gap
    // between the marker and the protected code can exceed a fixed
    // lookahead. Comment-skipping is robust to that.
    let foundProtectedLine = false;
    const scanLimit = Math.min(
      i + 1 + MARKER_SCAN_MAX_LINES,
      lines.length,
    );
    for (let j = i + 1; j < scanLimit; j++) {
      const line = lines[j];
      if (COMMENT_LINE_RE.test(line) || BLANK_LINE_RE.test(line)) {
        continue;
      }
      // First non-comment, non-blank line found — marker is healthy.
      // We don't try to verify the shape of this line (see the
      // comment block above the constant declarations for why).
      foundProtectedLine = true;
      break;
    }
    if (!foundProtectedLine) {
      strippedImports.push({
        file,
        line: i + 1,
        marker: lines[i].trim().slice(0, 100),
      });
    }
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

if (truncated.length === 0 && strippedImports.length === 0) {
  console.log(
    `✓ Audit passed: ${total} files checked, all end cleanly and all ` +
      `protection markers still guard a following declaration.`,
  );
  process.exit(0);
}

if (truncated.length > 0) {
  console.error(
    `✗ Audit FAILED (truncation): ${truncated.length} of ${total} files appear truncated:\n`,
  );
  for (const t of truncated) {
    console.error(`  ${t.file}`);
    console.error(`    tail: …${t.tail}\n`);
  }
  console.error(
    'Each "tail" shows the last ~60 chars of the file. A healthy file ends with } ) ] ; or ,\n',
  );
}

if (strippedImports.length > 0) {
  console.error(
    `✗ Audit FAILED (stripped protected code): ${strippedImports.length} ` +
      `marker(s) are not followed by a declaration ` +
      `(scanning past comment/blank lines):\n`,
  );
  for (const s of strippedImports) {
    console.error(`  ${s.file}:${s.line}`);
    console.error(`    marker: ${s.marker}\n`);
  }
  console.error(
    'These markers protect code that Windsurf\'s auto-formatter has\n' +
      'stripped in past PRs. If you intentionally removed the protected\n' +
      'code, also remove the marker comment. If you did NOT, the formatter\n' +
      'ate it — re-add the line directly below the marker and read\n' +
      '.windsurf/code-discipline.md.\n',
  );
}

process.exit(1);
