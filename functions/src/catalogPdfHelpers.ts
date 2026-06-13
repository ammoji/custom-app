/**
 * PR-NEXT-BUNDLE-L §A/§F — pure helpers for the printable catalog
 * PDF (the "paper workflow" for catalog onboarding).
 *
 * Everything here is pure: NO firebase-admin, NO firebase-functions,
 * NO Firestore. Just pdfkit + qrcode + string formatting, so the
 * whole module is unit-testable in plain Node. The callable
 * (`generateCatalogPdf` in `index.ts`) wires these together with the
 * auth gate + quota + Storage upload.
 *
 * Output: one page per category that has items, in the canonical
 * `CATEGORY_LABELS_ORDERED` order. Each row prints the product name,
 * brand, pack, MRP and a blank "Your price" box for the shopkeeper
 * to fill in by hand. A small grey "Item ID" line under each row +
 * a footer QR code let the OCR pipeline (`extractCatalogPagePrices`)
 * map handwriting back to a `productId` even when pages are
 * photographed in random order.
 *
 * Currency note: pdfkit's built-in Helvetica uses WinAnsi encoding,
 * which CANNOT encode the ₹ (U+20B9) glyph — emitting it throws at
 * render time. We deliberately print "Rs." instead of "₹" to stay
 * on the standard font and avoid bundling a Unicode TTF. The price
 * the shopkeeper writes is what matters; the MRP is reference only.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { CATEGORY_LABELS, CATEGORY_LABELS_ORDERED } from './categoryConstants';

export type CatalogPdfItem = {
  id: string;
  name: string;
  brand?: string | null;
  packLabel: string;
  mrp: number;
  category: string;
};

// Max characters of the product name printed on a row before we
// truncate with an ellipsis. Keeps the row on one line so the
// price box never wraps off the right margin.
export const MAX_ROW_NAME_CHARS = 60;

/**
 * Bin items into their categories, preserving the canonical
 * `CATEGORY_LABELS_ORDERED` order and DROPPING categories with no
 * items (so a shop that only sells dairy doesn't print 9 blank
 * pages). Items whose category isn't in the whitelist are ignored.
 */
export function groupItemsByCategory(
  items: ReadonlyArray<CatalogPdfItem>,
): Map<string, CatalogPdfItem[]> {
  const byCategory = new Map<string, CatalogPdfItem[]>();
  for (const { id } of CATEGORY_LABELS_ORDERED) {
    const inCat = items.filter(it => it.category === id);
    if (inCat.length > 0) byCategory.set(id, inCat);
  }
  return byCategory;
}

/**
 * Render the human-readable product label for one row, exactly as
 * it appears on the PDF. Pulled out so a snapshot test can pin the
 * format without rendering a whole PDF.
 *
 *   - brand present:  "Aashirvaad Atta (Aashirvaad · 10 kg)"
 *   - brand missing:  "Aashirvaad Atta (10 kg)"
 *   - long name:      truncated at MAX_ROW_NAME_CHARS with "…"
 */
export function formatItemRow(item: CatalogPdfItem): string {
  const name =
    item.name.length > MAX_ROW_NAME_CHARS
      ? `${item.name.slice(0, MAX_ROW_NAME_CHARS - 1).trimEnd()}…`
      : item.name;
  const brand = item.brand && item.brand.trim() ? item.brand.trim() : null;
  const parens = brand ? `${brand} · ${item.packLabel}` : item.packLabel;
  return `${name} (${parens})`;
}

/**
 * The JSON string encoded into a page's QR code. Deterministic
 * (stable key order) so the unit test can pin exact output and so
 * the same page always produces the same payload.
 */
export function buildQrPayload(
  shopId: string,
  pageNumber: number,
  categoryId: string,
  productIds: ReadonlyArray<string>,
): string {
  return JSON.stringify({
    shopId,
    pageNumber,
    categoryId,
    productIds: [...productIds],
  });
}

/**
 * PR-NEXT-BUNDLE-L §A — resolve the requested category list. Empty
 * (or undefined) means "all categories", in canonical order.
 * Anything not in the whitelist is dropped. Returned order always
 * follows `CATEGORY_LABELS_ORDERED`.
 */
export function resolveCategoryIdsForPdf(
  requested?: ReadonlyArray<string>,
): string[] {
  const all = CATEGORY_LABELS_ORDERED.map(c => c.id);
  if (!requested || requested.length === 0) return all;
  const wanted = new Set(requested);
  return all.filter(id => wanted.has(id));
}

const PAGE_MARGIN = 40;
const ROW_HEIGHT = 30;
const COL_NUM_X = PAGE_MARGIN;
const COL_NAME_X = PAGE_MARGIN + 28;
const COL_MRP_X = 340;
const COL_PRICE_X = 430;

/**
 * Build the printable catalog PDF as a Buffer. One page per
 * non-empty category, in canonical order.
 *
 * Throws `Error('no items')` on empty input — the callable maps
 * this to an `invalid-argument` HttpsError. Callers must filter to
 * a non-empty approved set before calling.
 *
 * Async because (a) pdfkit streams output and (b) the per-page QR
 * code is generated via `QRCode.toBuffer`.
 */
export async function buildCatalogPdfBuffer(
  items: ReadonlyArray<CatalogPdfItem>,
  shopName: string,
  generatedAt: Date,
  shopId = '',
): Promise<Buffer> {
  if (!items || items.length === 0) {
    throw new Error('no items: cannot build a catalog PDF with zero items');
  }

  const grouped = groupItemsByCategory(items);
  if (grouped.size === 0) {
    throw new Error('no items: no items fell into a known category');
  }

  // Pre-render every page's QR code first (async) so the synchronous
  // pdfkit drawing loop below can stay simple.
  const categoryIds = [...grouped.keys()];
  const pageCount = categoryIds.length;
  const qrByCategory = new Map<string, Buffer>();
  for (let i = 0; i < categoryIds.length; i += 1) {
    const catId = categoryIds[i];
    const rows = grouped.get(catId) ?? [];
    const payload = buildQrPayload(
      shopId,
      i + 1,
      catId,
      rows.map(r => r.id),
    );
    // eslint-disable-next-line no-await-in-loop -- small, fixed (≤10) page count
    const qrBuf = await QRCode.toBuffer(payload, {
      type: 'png',
      margin: 1,
      width: 90,
    });
    qrByCategory.set(catId, qrBuf);
  }

  const generatedLabel = formatGeneratedDate(generatedAt);

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      categoryIds.forEach((catId, pageIdx) => {
        if (pageIdx > 0) doc.addPage();
        const rows = grouped.get(catId) ?? [];
        drawPage({
          doc,
          shopName,
          generatedLabel,
          categoryId: catId,
          rows,
          pageNumber: pageIdx + 1,
          pageCount,
          qrBuffer: qrByCategory.get(catId),
        });
      });

      doc.end();
    } catch (e) {
      reject(e as Error);
    }
  });
}

// ──────────────────────────────────────────────────────────────
// Internal drawing helpers (not exported — exercised via
// buildCatalogPdfBuffer's Buffer output in tests)
// ──────────────────────────────────────────────────────────────

type DrawPageArgs = {
  doc: PDFKit.PDFDocument;
  shopName: string;
  generatedLabel: string;
  categoryId: string;
  rows: ReadonlyArray<CatalogPdfItem>;
  pageNumber: number;
  pageCount: number;
  qrBuffer?: Buffer;
};

function drawPage(args: DrawPageArgs): void {
  const {
    doc,
    shopName,
    generatedLabel,
    categoryId,
    rows,
    pageNumber,
    pageCount,
    qrBuffer,
  } = args;
  const label = CATEGORY_LABELS[categoryId] ?? categoryId;
  const right = doc.page.width - PAGE_MARGIN;

  // ── Header ──
  doc.font('Helvetica-Bold').fontSize(16);
  doc.text('HamaraSetu — Build your catalog', PAGE_MARGIN, PAGE_MARGIN, {
    continued: false,
  });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Page ${pageNumber} of ${pageCount}`, COL_MRP_X, PAGE_MARGIN + 4, {
    width: right - COL_MRP_X,
    align: 'right',
  });

  doc.font('Helvetica').fontSize(11);
  doc.text(shopName, PAGE_MARGIN, PAGE_MARGIN + 22);
  doc.fontSize(9).fillColor('#555555');
  doc.text(`Generated ${generatedLabel}`, COL_MRP_X, PAGE_MARGIN + 24, {
    width: right - COL_MRP_X,
    align: 'right',
  });
  doc.fillColor('#000000');

  // ── Category title ──
  doc.font('Helvetica-Bold').fontSize(13);
  doc.text(
    `CATEGORY: ${label}   (${rows.length} item${rows.length === 1 ? '' : 's'})`,
    PAGE_MARGIN,
    PAGE_MARGIN + 50,
  );

  // ── Column headings ──
  let y = PAGE_MARGIN + 76;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333');
  doc.text('#', COL_NUM_X, y);
  doc.text('Product (brand · pack)', COL_NAME_X, y);
  doc.text('MRP', COL_MRP_X, y);
  doc.text('Your price', COL_PRICE_X, y);
  doc.fillColor('#000000');
  y += 14;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(right, y)
    .strokeColor('#cccccc')
    .stroke()
    .strokeColor('#000000');
  y += 8;

  // ── Rows ──
  rows.forEach((item, idx) => {
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    doc.text(String(idx + 1), COL_NUM_X, y, { width: 24 });
    doc.text(formatItemRow(item), COL_NAME_X, y, {
      width: COL_MRP_X - COL_NAME_X - 8,
    });
    doc.text(`Rs.${item.mrp}`, COL_MRP_X, y, { width: COL_PRICE_X - COL_MRP_X - 8 });
    // Blank handwriting box for "Your price".
    doc
      .moveTo(COL_PRICE_X, y + 11)
      .lineTo(right, y + 11)
      .strokeColor('#999999')
      .stroke()
      .strokeColor('#000000');
    // Small grey Item ID line so OCR can map handwriting → productId.
    doc.font('Helvetica').fontSize(7).fillColor('#999999');
    doc.text(`Item ID (do not edit): ${item.id}`, COL_NAME_X, y + 13, {
      width: COL_MRP_X - COL_NAME_X - 8,
    });
    doc.fillColor('#000000');
    y += ROW_HEIGHT;
  });

  // ── Footer note + QR ──
  const footerY = doc.page.height - PAGE_MARGIN - 60;
  doc.font('Helvetica').fontSize(8).fillColor('#555555');
  doc.text(
    "Skip items you don't sell — leave the price box blank.",
    PAGE_MARGIN,
    footerY,
    { width: COL_PRICE_X - PAGE_MARGIN },
  );
  doc.text(
    'Snap a photo of each filled page and upload via "Scan filled catalog".',
    PAGE_MARGIN,
    footerY + 12,
    { width: COL_PRICE_X - PAGE_MARGIN },
  );
  doc.fillColor('#000000');

  if (qrBuffer) {
    doc.image(qrBuffer, right - 80, footerY - 10, { width: 80 });
  }
}

function formatGeneratedDate(d: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
