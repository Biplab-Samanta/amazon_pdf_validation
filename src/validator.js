'use strict';
const { FIELDS, DEFAULTS } = require('./schema');
const TOL = DEFAULTS.amountTolerance;
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const GSTIN_RE = /^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const isEmpty = v => v === undefined || v === null || String(v).trim() === '';
const isNum = v => typeof v === 'number' && isFinite(v);
const label = k => (FIELDS.find(f => f.key === k) || {}).label || k;

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function validateRecord(rec) {
  const f = rec.fields, m = rec.meta || {}, errors = [], warnings = [];
  const err = (field, message) => errors.push({ field, message });

  for (const fd of FIELDS.filter(x => x.required)) {
    if (isEmpty(f[fd.key])) err(fd.key, `${fd.label} is missing.`);
  }
  for (const fd of FIELDS.filter(x => x.type === 'money' || x.type === 'number')) {
    const v = f[fd.key];
    if (isEmpty(v)) continue;
    if (!isNum(v)) { err(fd.key, `${fd.label} "${v}" is not a valid number.`); continue; }
    if (v < 0) err(fd.key, `${fd.label} is negative (${v}).`);
  }
  if (isNum(f['quantity-purchased']) && (!Number.isInteger(f['quantity-purchased']) || f['quantity-purchased'] <= 0))
    err('quantity-purchased', `Item Quantity must be a whole number greater than 0 (found ${f['quantity-purchased']}).`);
  if (isNum(f['item-price']) && f['item-price'] <= 0) err('item-price', 'Total bill Value must be greater than 0.');
  if (isEmpty(f['purchase-date'])) err('purchase-date', 'Purchase Date is missing.');
  else if (!validDate(f['purchase-date'])) err('purchase-date', `Purchase Date "${f['purchase-date']}" is not a valid date.`);
  if (isEmpty(f['voucher-number'])) err('voucher-number', 'Voucher Number (invoice number) is missing.');
  if (!isEmpty(f['ship-postal-code']) && !/^\d{6}$/.test(String(f['ship-postal-code'])))
    err('ship-postal-code', `Ship Postal Code "${f['ship-postal-code']}" must be a 6-digit number.`);
  if (!isEmpty(f.gstin) && !GSTIN_RE.test(String(f.gstin).toUpperCase()))
    err('gstin', `GSTIN "${f.gstin}" has an invalid format.`);

  // calculation checks
  const q = f['quantity-purchased'], rate = f['item-rate'], basic = f['item-price-gst'];
  const gst = r2((f.sgst || 0) + (f.cgst || 0) + (f.igst || 0));
  const shipAmt = f['shipping-amount'] || 0;
  const shipGst = r2((f['shipping-sgst'] || 0) + (f['shipping-cgst'] || 0) + (f['shipping-igst'] || 0));
  if (isNum(q) && isNum(rate) && isNum(basic) && Math.abs(q * rate - basic) > q * 0.005 + 0.011)
    err('item-price-gst', `Item Basic Amount ${basic} does not equal Quantity × Rate (${q} × ${rate} = ${r2(q * rate)}).`);
  if (isNum(rate) && isNum(basic) && isNum(q) && q > 1 && Math.abs(rate - basic) < 0.005)
    err('item-rate', `Item Rate ${rate} equals the whole line amount; it must be the per-unit rate.`);
  if (isNum(basic) && isNum(f['item-price']) && Math.abs(r2(basic + gst + shipAmt + shipGst) - f['item-price']) > TOL)
    err('item-price', `Product total ${f['item-price']} does not match basic ${basic} + GST ${gst} + shipping ${shipAmt} + shipping GST ${shipGst} = ${r2(basic + gst + shipAmt + shipGst)}.`);
  if (isNum(basic) && m.hasTaxInfo && Math.abs(m.expectedGst - gst) > TOL)
    err('igst', `GST ${gst} does not match the tax rate(s) printed on the product line (expected ${m.expectedGst}).`);
  if (!m.hasTaxInfo && isNum(basic)) warnings.push('No tax rate/type found on the product line; GST fields are 0.');
  if (shipAmt > 0 && Math.abs((m.expectedShipGst || 0) - shipGst) > TOL)
    err('shipping-igst', `Shipping GST ${shipGst} does not match the tax rate printed on the shipping line (expected ${m.expectedShipGst}).`);
  if (m.shippingMentionedNoAmount)
    err('shipping-amount', 'The product line mentions shipping charges but no shipping amount could be extracted.');
  if (m.commonShipping)
    err('shipping-amount', `Invoice has a common shipping charge of ${m.commonShipping} that is not tied to any product. It was not spread across products. Review and allocate it manually.`);
  if (m.invoiceTotal != null) {
    const sum = r2((m.allocatedSum || 0) + (m.commonShipping || 0));
    if (Math.abs(sum - m.invoiceTotal) > TOL)
      err('item-price', `Sum of extracted product totals (${sum}) does not reconcile with the invoice TOTAL ${m.invoiceTotal}.`);
  } else warnings.push('Invoice TOTAL line was not found, so reconciliation could not be checked.');
  return { errors, warnings };
}

// files: [{file,status,message,records}] -> flat validated records (+ failed-file placeholders)
function validateAll(files) {
  const out = [];
  const invoiceOwner = new Map();   // voucher -> file
  let id = 0;
  for (const fr of files) {
    if (fr.status !== 'ok') {
      out.push({ id: ++id, file: fr.file, placeholder: true, fields: {}, errors: [{ field: null, message: 'Extraction failed: ' + fr.message }], warnings: [], valid: false });
      continue;
    }
    const voucher = fr.records[0] && fr.records[0].fields['voucher-number'];
    let dupMsg = '';
    if (voucher) {
      if (invoiceOwner.has(voucher) && invoiceOwner.get(voucher) !== fr.file) dupMsg = `Duplicate invoice ${voucher}: already extracted from file ${invoiceOwner.get(voucher)}.`;
      else invoiceOwner.set(voucher, fr.file);
    }
    const seen = new Map();
    for (const rec of fr.records) {
      const { errors, warnings } = validateRecord(rec);
      if (dupMsg) errors.push({ field: 'voucher-number', message: dupMsg });
      const key = [rec.fields['order-id'], rec.fields.sku].join('|');
      if (rec.fields.sku && seen.has(key)) warnings.push(`SKU ${rec.fields.sku} appears on more than one line of this invoice.`);
      seen.set(key, true);
      out.push({ id: ++id, file: rec.file, fields: rec.fields, errors, warnings, valid: errors.length === 0 });
    }
  }
  return out;
}

module.exports = { validateAll, validateRecord, label };
