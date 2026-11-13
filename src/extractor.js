'use strict';
const { DEFAULTS } = require('./schema');

const NUM = '-?[\\d,]+\\.\\d{1,2}';
const CUR = '(?:₹|Rs\\.?|INR)?\\s*';
const TAXTYPE = '(?:IGST|CGST|SGST|UTGST)';
const TOKEN = `(?:\\d+(?:\\.\\d+)?%|${TAXTYPE}|-(?=\\s)|(?:(?:₹|Rs\\.?|INR)\\s*)?${NUM}(?![\\d%]))`;
// unit price, optional qty, net amount, then rate / tax type / amount tokens
const TAIL_SRC = `${CUR}(${NUM})\\s+(?:(\\d+)\\s+)?${CUR}(${NUM})\\s+((?:${TOKEN}\\s*)+)`;

const num = s => (s === undefined || s === null || s === '') ? null : Math.round(parseFloat(String(s).replace(/[,₹\s]|Rs\.?|INR/g, '')) * 100) / 100;
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

function parseTaxDetails(source) {
  const taxes = { IGST: 0, CGST: 0, SGST: 0 };
  const rates = [];
  const types = [];

  const re = /(?:(\d+(?:\.\d+)?)\s*%\s*(IGST|CGST|SGST|UTGST)|(IGST|CGST|SGST|UTGST)\s*(\d+(?:\.\d+)?)\s*%)\s*(?:₹|Rs\.?|INR)?\s*(-?[\d,]+\.\d{1,2})/gi;

  let match;

  while ((match = re.exec(source)) !== null) {
    const rate = Number(match[1] || match[4]);
    const type = (match[2] || match[3]).toUpperCase();
    const amount = num(match[5]);

    if (amount === null) continue;

    const key = type === 'UTGST' ? 'SGST' : type;

    taxes[key] = r2(taxes[key] + amount);
    rates.push(rate);
    if (!types.includes(type)) types.push(type);
  }

  return { taxes, rates, types };
}

function getActualItemRate(unitPrice, quantity, basicAmount) {
  if (Number.isFinite(unitPrice) && unitPrice > 0) {
    return r2(unitPrice);
  }

  if (
    Number.isFinite(quantity) &&
    quantity > 0 &&
    Number.isFinite(basicAmount) &&
    basicAmount > 0
  ) {
    return r2(basicAmount / quantity);
  }

  return null;
}

function calculateProductTotal(net, taxes) {
  return r2(
    net +
    taxes.SGST +
    taxes.CGST +
    taxes.IGST
  );
}

async function extractText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let lastY = null;
    for (const it of tc.items) {
      if (!it.str && !it.hasEOL) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) out += '\n';
      else if (out && !out.endsWith('\n')) out += ' ';
      out += it.str;
      if (it.hasEOL) out += '\n';
      lastY = y;
    }
    out += '\n';
  }
  return out;
}

function toIso(d) {
  const m = d && d.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
const title = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

function cleanDescription(raw, serial) {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/Page \d+ of \d+/gi, ' ');
  s = s.replace(new RegExp(`^${serial}\\s+(?=\\S)`), ''); // Sl. No column
  let sku = '';
  const asinSku = s.match(/\|?\s*\b(B[0-9A-Z]{9})\b\s*\(\s*([^)]*?)\s*\)/);
  if (asinSku) {
    sku = asinSku[2].trim();
    s = s.replace(asinSku[0], ' ');
  } else {
    const tailParen = s.match(/\(\s*([A-Za-z0-9_\-./ ]{2,40}?)\s*\)\s*(?:HSN[:\s]*\d*)?\s*$/i);
    if (tailParen) { sku = tailParen[1].trim(); s = s.replace(tailParen[0], ' '); }
    else s = s.replace(/\|?\s*\bB[0-9A-Z]{9}\b/, ' ');
  }
  let shippingRef = false;
  s = s.replace(/HSN\s*[:\-]?\s*\d*/gi, ' ');
  if (/\b(shipping|delivery|handling) charges?\s*$/i.test(s)) {
    shippingRef = true;
    s = s.replace(/\b(shipping|delivery|handling) charges?\s*$/i, ' ');
  }
  s = s.replace(/\s+/g, ' ').replace(/[\s|,\-–]+$/, '').replace(/^[\s|,\-–]+/, '').trim();
  return { name: s, sku, shippingRef };
}

function parseInvoiceText(text, file = '') {
  const flat = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  const one = flat.replace(/\s*\n\s*/g, ' ');
  const g = (re, src = one) => { const m = src.match(re); return m ? m[1].trim() : ''; };

  const orderId = g(/Order Number\s*:\s*([\d-]{10,})/i);
  const orderDate = toIso(g(/Order Date\s*:\s*(\d{2}[./-]\d{2}[./-]\d{4})/i));
  const invoiceNo = g(/Invoice Number\s*:\s*([A-Za-z0-9\-\/]+)/i);
  const invoiceDate = toIso(g(/Invoice Date\s*:\s*(\d{2}[./-]\d{2}[./-]\d{4})/i));

  const bi = flat.search(/Billing Address\s*:/i);
  const si = flat.search(/Shipping Address\s*:/i);
  const billing = bi >= 0 ? flat.slice(bi, si > bi ? si : bi + 600).replace(/Billing Address\s*:/i, '') : '';
  let shipping = '';
  if (si >= 0) {
    const rest = flat.slice(si).replace(/Shipping Address\s*:/i, '');
    const e = rest.search(/Place of delivery/i);
    if (e >= 0) {
      const nl = rest.indexOf('\n', e);
      shipping = rest.slice(0, nl >= 0 ? nl : rest.length);
    } else shipping = rest.slice(0, 700);
  }
  const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);
  const partyName = lines(billing)[0] || '';
  const gstinRe = /GST Registration No\s*:\s*([0-9A-Z]{15})/i;
  const gstin = (billing.match(gstinRe) || shipping.match(gstinRe) || [])[1] || '';

  let shipState = '', shipPostal = '', shipCountry = '';
  const sm = shipping.match(/,\s*([^,\n]+?)\s*,\s*(\d{6})\b\s*\n?\s*([A-Z]{2})?\b/);
  if (sm) { shipState = title(sm[1].trim()); shipPostal = sm[2]; shipCountry = sm[3] || ''; }
  else { const pm = shipping.match(/\b(\d{6})\b/); if (pm) shipPostal = pm[1]; }
  
  const INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
    'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
    'Haryana', 'Himachal Pradesh', 'Jharkhand',
    'Karnataka', 'Kerala', 'Madhya Pradesh',
    'Maharashtra', 'Manipur', 'Meghalaya',
    'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh',
    'Uttarakhand', 'West Bengal',
    'Delhi', 'Jammu and Kashmir',
    'Ladakh', 'Puducherry',
    'Chandigarh', 'Andaman and Nicobar Islands',
    'Dadra and Nagar Haveli and Daman and Diu',
    'Dadra and Nagar Haveli',
    'Lakshadweep'
];
  
  if (!shipState) {
    shipState = title(
      g(/Place of delivery\s*:\s*([A-Za-z &]+)/i, shipping)
    );
  }

  if (shipCountry) {
    shipCountry = DEFAULTS.countryMap[shipCountry] || shipCountry;
  }

  if (
    INDIAN_STATES.some(
      state => state.toLowerCase() === shipState.toLowerCase()
    )
  ) {
    shipCountry = 'India';
  }

  shipCountry = shipCountry || '';

  // ---- product table ----
  const tm = one.match(/TOTAL\s*:\s*(?:₹|Rs\.?)?\s*(-?[\d,]+\.\d{2})\s*(?:₹|Rs\.?)?\s*(-?[\d,]+\.\d{2})/i);
  const invoiceTaxTotal = tm ? num(tm[1]) : null;
  const invoiceTotal = tm ? num(tm[2]) : null;

  const items = [], shippingLines = [];
  const matches = [...one.matchAll(new RegExp(TAIL_SRC, 'g'))];
  let cursor = 0;
  const hdr = [...one.matchAll(/Total\s*Amount/gi)].filter(h => matches.length && h.index < matches[0].index).pop();
  if (hdr) cursor = hdr.index + hdr[0].length;
  let serial = 1;
  for (const m of matches) {
    if (m.index < cursor) continue;
    const toks = m[4].match(new RegExp(TOKEN, 'g')) || [];

    const taxData = parseTaxDetails(m[4]);

    const rates = taxData.rates;
    const types = taxData.types;
    const taxes = taxData.taxes;

    const amts = toks
      .filter(t => /\d\.\d{1,2}$/.test(t))
      .map(num)
      .filter(v => v !== null);

    if (!amts.length) continue;

    const total = amts[amts.length - 1];

    const taxAmts = amts.slice(0, -1);
    const raw = one.slice(cursor, m.index).replace(/Total\s*Amount/gi, ' ');
    cursor = m.index + m[0].length;
    const d = cleanDescription(raw, serial);
    const isShip = /^(shipping|delivery|handling|gift wrap)/i.test(d.name) || (!d.name && /shipping|delivery/i.test(raw));
    // const taxes = { IGST: 0, CGST: 0, SGST: 0 };
    // types.forEach((t, i) => { taxes[t === 'UTGST' ? 'SGST' : t] += taxAmts[i] || 0; });
    if (isShip) {
      shippingLines.push({
        description: d.name || 'Shipping Charges', net: num(m[3]), tax: r2(taxAmts.reduce((a, b) => a + b, 0)),
        total, taxes, rates, itemIndex: items.length - 1
      });   // -1 = not under any product
      continue;                                              // shipping rows have no Sl. No
    }
    const qty = m[2] ? parseInt(m[2], 10) : null;
    const net = num(m[3]);

    const unitPrice = getActualItemRate(
      num(m[1]),
      qty,
      net
    );

    const productTotal = calculateProductTotal(net, taxes);
    items.push({
      serial,
      name: d.name,
      sku: d.sku,
      shippingRef: d.shippingRef,
      unitPrice,
      qty,
      net,
      rates,
      types,
      taxes,
      total: productTotal
    });
    serial++;
  }
  return {
    file, orderId, orderDate, invoiceNo, invoiceDate, partyName, gstin,
    shipState, shipPostal, shipCountry, items, shippingLines, invoiceTaxTotal, invoiceTotal
  };
}

function ledgerFor(item) {
  const t = DEFAULTS.salesLedgerTemplate;
  if (!t) return '';
  const type = item.types.includes('IGST') ? 'IGST' : (item.types.length ? 'GST' : '');
  const rate = r2(item.rates.reduce((a, b) => a + b, 0));
  return t.replace('{taxType}', type).replace('{rate}', rate).replace(/\s+/g, ' ').trim();
}

// One invoice -> one record per product. No invoice-total row is ever created.
// A shipping row printed under a product goes into THAT product's four shipping columns only.
// It never touches name, rate, basic amount or quantity. A shipping row that is not under any product
// (common shipping) is NOT spread across products; it is reported so the invoice is flagged for review.
function buildRecords(inv) {
  const common = inv.shippingLines.filter(sl => sl.itemIndex < 0);
  const commonSum = r2(common.reduce((a, x) => a + x.total, 0));

  const rows = inv.items.map((it, idx) => {
    const ships = inv.shippingLines.filter(
      sl => sl.itemIndex === idx
    );

    const sum = fn => r2(
      ships.reduce((a, x) => a + fn(x), 0)
    );

    const shipNet = sum(x => x.net);

    const shipTaxes = {
      SGST: sum(x => x.taxes.SGST),
      CGST: sum(x => x.taxes.CGST),
      IGST: sum(x => x.taxes.IGST)
    };

    const shipTotal = r2(
      shipNet +
      shipTaxes.SGST +
      shipTaxes.CGST +
      shipTaxes.IGST
    );

    return {
      it,
      shipNet,
      shipTotal,
      shipTaxes,
      shipLines: ships.length,

      expectedShipGst: r2(
        ships.reduce(
          (a, x) => a + x.net *
            x.rates.reduce((p, q) => p + q, 0) / 100,
          0
        )
      ),

      total: r2(
        it.net +
        it.taxes.SGST +
        it.taxes.CGST +
        it.taxes.IGST +
        shipTotal
      )
    };
  });

  const allocatedSum = r2(rows.reduce((a, r) => a + r.total, 0));
  return rows.map(r => ({
    file: inv.file,
    fields: {
      'purchase-date': inv.orderDate || inv.invoiceDate,
      'voucher-number': inv.invoiceNo,
      'order-id': inv.orderId,
      'party-name': inv.partyName,
      'sales-ledger': ledgerFor(r.it),
      'product-name': r.it.name,
      'sku': r.it.sku,
      'quantity-purchased': r.it.qty,
      'item-rate': r.it.unitPrice,
      'per': DEFAULTS.per,
      'item-price-gst': r.it.net,
      'sgst': r2(r.it.taxes.SGST), 'cgst': r2(r.it.taxes.CGST), 'igst': r2(r.it.taxes.IGST),
      'shipping-amount': r.shipNet,
      'shipping-sgst': r.shipTaxes.SGST, 'shipping-cgst': r.shipTaxes.CGST, 'shipping-igst': r.shipTaxes.IGST,
      'item-price': r.total,
      'ship-state': inv.shipState,
      'ship-postal-code': inv.shipPostal ? parseInt(inv.shipPostal, 10) : '',
      'ship-country': inv.shipCountry,
      'gstin': inv.gstin
    },
    meta: {
      hasTaxInfo: r.it.rates.length > 0,
      expectedGst: r2(r.it.net * r.it.rates.reduce((a, b) => a + b, 0) / 100),
      expectedShipGst: r.expectedShipGst,
      shippingRowCount: r.shipLines,
      shippingMentionedNoAmount: r.it.shippingRef && !r.shipLines,
      commonShipping: commonSum,
      allocatedSum,
      invoiceTotal: inv.invoiceTotal
    }
  }));
}

async function processPdf(buffer, file) {
  let text;
  try { text = await extractText(buffer); }
  catch (e) { return { file, status: 'failed', message: 'Damaged or unreadable PDF: ' + e.message, records: [] }; }
  if (text.trim().length < 20) return { file, status: 'failed', message: 'No readable text found (scanned image PDF? OCR is not supported).', records: [] };
  const inv = parseInvoiceText(text, file);
  if (!inv.items.length) return { file, status: 'failed', message: 'No product lines could be extracted. This does not look like a supported Amazon tax invoice.', records: [], invoiceNo: inv.invoiceNo };
  return { file, status: 'ok', message: `${inv.items.length} product(s) extracted`, invoiceNo: inv.invoiceNo, records: buildRecords(inv) };
}

module.exports = { processPdf, parseInvoiceText, buildRecords, extractText };
