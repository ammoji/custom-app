/**
 * PR 25 — Build static HTML for Privacy Policy and Terms of Service
 * from their markdown sources in /docs.
 *
 * Why a hand-rolled converter (no `marked` dep): the legal docs use a
 * deliberately small subset of markdown (headings, bold, italic,
 * lists, tables, hr, paragraphs, inline code, links). Adding a
 * markdown library just for two static pages is dependency churn we
 * don't need. The function `mdToHtml` below covers exactly what the
 * source files use.
 *
 * Output: dist/privacy.html and dist/terms.html. Mobile-friendly
 * (viewport meta + max-width 720px + system font), no external CSS,
 * no JS, light/dark via `prefers-color-scheme`.
 *
 * Run with `npm run build-legal`. Idempotent — safe to re-run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

type Page = {
  sourcePath: string;
  outPath: string;
  title: string;
  url: string;
};

const PAGES: Page[] = [
  {
    sourcePath: join(ROOT, 'docs', 'privacy-policy.md'),
    outPath: join(ROOT, 'dist', 'privacy.html'),
    title: 'Privacy Policy — HamaraSetu',
    url: 'https://grocery-mvp-dev.web.app/privacy',
  },
  {
    sourcePath: join(ROOT, 'docs', 'terms-of-service.md'),
    outPath: join(ROOT, 'dist', 'terms.html'),
    title: 'Terms of Service — HamaraSetu',
    url: 'https://grocery-mvp-dev.web.app/terms',
  },
  {
    // Required by Google Play Store (Data Safety form, account
    // deletion URL field). The URL is shown publicly on the Play
    // listing and must describe how users request account deletion
    // and what data is deleted vs retained.
    sourcePath: join(ROOT, 'docs', 'account-deletion.md'),
    outPath: join(ROOT, 'dist', 'account-deletion.html'),
    title: 'Account Deletion — HamaraSetu',
    url: 'https://grocery-mvp-dev.web.app/account-deletion',
  },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline markdown: bold, italic, code, links. Applied to already-escaped text. */
function inline(text: string): string {
  // Order matters: code spans first so their contents aren't re-parsed.
  let out = text.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  // Links [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
  // Bold **x**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *x* (single asterisk, not adjacent to another)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (!buf.length) return;
    const text = inline(escapeHtml(buf.join(' ').trim()));
    if (text) out.push(`<p>${text}</p>`);
    buf.length = 0;
  };

  let paraBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line — flush paragraph
    if (trimmed === '') {
      flushParagraph(paraBuf);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      flushParagraph(paraBuf);
      out.push('<hr />');
      i++;
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(paraBuf);
      const level = heading[1].length;
      const content = inline(escapeHtml(heading[2]));
      out.push(`<h${level}>${content}</h${level}>`);
      i++;
      continue;
    }

    // Tables (simple pipe tables): | a | b |\n|---|---|\n| 1 | 2 |
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(lines[i + 1])
    ) {
      flushParagraph(paraBuf);
      const header = trimmed
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(c => inline(escapeHtml(c.trim())));
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map(c => inline(escapeHtml(c.trim())));
        rows.push(row);
        i++;
      }
      out.push('<table>');
      out.push(
        '<thead><tr>' +
          header.map(c => `<th>${c}</th>`).join('') +
          '</tr></thead>',
      );
      out.push('<tbody>');
      for (const row of rows) {
        out.push(
          '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>',
        );
      }
      out.push('</tbody></table>');
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph(paraBuf);
      out.push('<ul>');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, '');
        // Continuation lines (indented further) join into the same item.
        let combined = itemText;
        let j = i + 1;
        while (
          j < lines.length &&
          /^\s{2,}\S/.test(lines[j]) &&
          !/^\s*[-*]\s+/.test(lines[j])
        ) {
          combined += ' ' + lines[j].trim();
          j++;
        }
        out.push(`<li>${inline(escapeHtml(combined))}</li>`);
        i = j;
      }
      out.push('</ul>');
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(paraBuf);
      out.push('<ol>');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '');
        let combined = itemText;
        let j = i + 1;
        while (
          j < lines.length &&
          /^\s{2,}\S/.test(lines[j]) &&
          !/^\s*\d+\.\s+/.test(lines[j])
        ) {
          combined += ' ' + lines[j].trim();
          j++;
        }
        out.push(`<li>${inline(escapeHtml(combined))}</li>`);
        i = j;
      }
      out.push('</ol>');
      continue;
    }

    // Regular paragraph text
    paraBuf.push(line);
    i++;
  }
  flushParagraph(paraBuf);

  return out.join('\n');
}

const CSS = `
:root {
  color-scheme: light dark;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  line-height: 1.6;
  background: #ffffff;
  color: #111827;
}
@media (prefers-color-scheme: dark) {
  html, body { background: #0f1115; color: #e5e7eb; }
  a { color: #4ade80; }
  hr { border-color: #374151; }
  code { background: #1f2937; }
  th { background: #1f2937; }
  td, th { border-color: #374151; }
  .footer-note { border-top-color: #374151; color: #9ca3af; }
  .hero { background: linear-gradient(135deg, #1e40af 0%, #0E7C3A 100%); }
  .card { background: #1f2937; border-color: #374151; }
}
main {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}
h1 { font-size: 1.8rem; margin: 0 0 16px; }
h2 { font-size: 1.3rem; margin: 32px 0 12px; }
h3 { font-size: 1.1rem; margin: 24px 0 8px; }
p { margin: 12px 0; }
ul, ol { padding-left: 22px; margin: 12px 0; }
li { margin: 6px 0; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 32px 0; }
a { color: #0E7C3A; }
code {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.95em;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 0.95rem;
}
th, td {
  border: 1px solid #e5e7eb;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
th { background: #f9fafb; }
.footer-note {
  margin-top: 48px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
  font-size: 0.85rem;
  color: #6B7280;
}
.footer-note a { color: inherit; text-decoration: underline; }

/* Landing-page-only styles. The hero gradient matches the
   HamaraSetu logo's blue-to-green progression (PR 39.1). */
.hero {
  background: linear-gradient(135deg, #1e40af 0%, #0E7C3A 100%);
  color: #ffffff;
  padding: 48px 24px;
  margin: -24px -20px 32px;
  text-align: center;
  border-radius: 0 0 12px 12px;
}
.hero h1 {
  margin: 0;
  font-size: 2.4rem;
  letter-spacing: 0.5px;
}
.hero .devanagari {
  margin: 4px 0 0;
  font-size: 1.4rem;
  opacity: 0.95;
}
.hero .tagline {
  margin: 12px 0 0;
  font-size: 1.05rem;
  opacity: 0.9;
}
.card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px 20px;
  margin: 16px 0;
}
.card h2 { margin-top: 0; }
.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.cta-row a {
  display: inline-block;
  padding: 8px 14px;
  border: 1px solid #0E7C3A;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
}
`.trim();

function buildHtml(page: Page, bodyHtml: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(page.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${bodyHtml}
<div class="footer-note">
  Last rendered: ${today} · View this document on web at
  <a href="${page.url}">${page.url}</a>
</div>
</main>
</body>
</html>
`;
}

/**
 * Landing page (dist/index.html).
 *
 * Pre-PR the root URL was the Expo web-export shell (`<div id="root">`
 * + a `/_expo/static/js/web/App-{hash}.js` script tag) which rendered
 * blank in production because the JS bundle wasn't deployed alongside
 * it. Reviewers (Razorpay KYC, App Store, Play Store) hit the URL and
 * saw nothing. A real React Native Web build is out of scope for the
 * pilot (RN components aren't all web-compatible) — a static landing
 * page is what reviewers actually want.
 *
 * Lives in this build script (not as a tracked dist/index.html) so
 * the page survives any accidental `expo export -p web` run that
 * would otherwise clobber it. Deploy pipeline: `npm run build-legal`
 * → `firebase deploy --only hosting`.
 *
 * Content is brand-locked from CLAUDE.md + src/constants/branding.ts:
 *   - App: HamaraSetu (हमारा सेतु)
 *   - Tagline: Shop Smart, Shop Local.
 *   - Entity: Sara Stack Labs
 *   - City: Ballabgarh, Faridabad, Haryana
 *   - Contact: sarastacklabs@gmail.com (pilot phase)
 *
 * If brand strings change, update `src/constants/branding.ts` AND this
 * function — server-side strings don't import the constants module
 * (per CLAUDE.md). The pin test in `tests/constants/branding.test.ts`
 * is the trip-wire for the in-app side; this script is the trip-wire
 * for the public-web side.
 */
const LANDING_BODY = `
<section class="hero">
  <h1>HamaraSetu</h1>
  <p class="devanagari">हमारा सेतु</p>
  <p class="tagline">Shop Smart, Shop Local.</p>
</section>

<section>
  <h2>What is HamaraSetu?</h2>
  <p>
    HamaraSetu connects neighborhood kirana shops with the customers
    who live around them. Customers order groceries through the app;
    shop owners fulfill orders from their own inventory; local
    delivery partners deliver. We help small, family-run stores serve
    their existing customers better — without forcing them onto a
    discount-driven marketplace.
  </p>
  <p>
    HamaraSetu is built and operated by <strong>Sara Stack Labs</strong>
    in Ballabgarh, Faridabad, Haryana, India.
  </p>
</section>

<section class="card">
  <h2>Get the app</h2>
  <p>
    HamaraSetu is currently in pilot. Public App Store and Google Play
    Store launches are scheduled within the coming weeks. If you'd
    like to join the closed pilot or learn more, please contact us.
  </p>
  <div class="cta-row">
    <a href="mailto:sarastacklabs@gmail.com?subject=HamaraSetu%20pilot%20access">Request pilot access</a>
  </div>
</section>

<section>
  <h2>For shop owners</h2>
  <p>
    Reach the customers already in your neighborhood. Manage your menu,
    set your own prices, accept orders, and get paid by Cash on
    Delivery, UPI, or online payment — all from one app. KYC and shop
    approval are handled in-app; once approved, you can start
    accepting orders immediately.
  </p>
</section>

<section>
  <h2>For delivery partners</h2>
  <p>
    Flexible work with transparent per-delivery earnings. Choose when
    you're online; we route nearby pickups to you based on your own
    notification radius. Each completed delivery is recorded with a
    proof photo so disputes can be resolved fairly.
  </p>
</section>

<section class="card">
  <h2>Contact</h2>
  <p>
    Support: <a href="mailto:sarastacklabs@gmail.com">sarastacklabs@gmail.com</a>
  </p>
  <p>
    Operating entity: <strong>Sara Stack Labs</strong><br />
    Operating city: Ballabgarh, Faridabad district, Haryana, India
  </p>
</section>

<section>
  <h2>Legal</h2>
  <ul>
    <li><a href="/privacy">Privacy Policy</a></li>
    <li><a href="/terms">Terms of Service</a></li>
    <li><a href="/account-deletion">Account Deletion</a></li>
  </ul>
</section>
`.trim();

function buildLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HamaraSetu — Shop Smart, Shop Local.</title>
<meta name="description" content="HamaraSetu connects neighborhood kirana shops with their customers. Built and operated by Sara Stack Labs in Ballabgarh, Faridabad." />
<style>${CSS}</style>
</head>
<body>
<main>
${LANDING_BODY}
<div class="footer-note">
  © ${new Date().getFullYear()} Sara Stack Labs · Ballabgarh, Faridabad ·
  <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
</div>
</main>
</body>
</html>
`;
}

function build() {
  for (const page of PAGES) {
    const md = readFileSync(page.sourcePath, 'utf8');
    const body = mdToHtml(md);
    const html = buildHtml(page, body);
    mkdirSync(dirname(page.outPath), { recursive: true });
    writeFileSync(page.outPath, html, 'utf8');
    console.log(`[build-legal] wrote ${page.outPath}`);
  }

  // Landing page lives alongside the legal pages so the same
  // `npm run build-legal` → `firebase deploy --only hosting` pipeline
  // covers everything. See the LANDING_BODY block above for rationale.
  const indexOutPath = join(ROOT, 'dist', 'index.html');
  const indexHtml = buildLandingPage();
  mkdirSync(dirname(indexOutPath), { recursive: true });
  writeFileSync(indexOutPath, indexHtml, 'utf8');
  console.log(`[build-legal] wrote ${indexOutPath}`);
}

build();
