'use strict';
// Run: npm test   (uses PDFs in /samples if present, plus a synthetic multi-product invoice)
const fs = require('fs'), path = require('path'), assert = require('assert');
const { processPdf, parseInvoiceText, buildRecords } = require('../src/extractor');
const { validateAll } = require('../src/validator');
const { exportRecords } = require('../src/exporter');

const multi = (sku3 = 'GAMMA-2', cgst3 = '₹10.00 ₹10.00') => `Order Number: 404-1111111-2222222 Invoice Number : PGWN-2000
Order Date: 01.11.2026 Invoice Date : 01.11.2026
Billing Address :
ACME TRADERS
PUNE, MH, 411001
IN
GST Registration No: 27AAMFH1562J1Z5
Shipping Address :
ACME TRADERS
12 Main Road
PUNE, MAHARASHTRA, 411001
IN
State/UT Code: 27
Place of supply: MH
Place of delivery: MAHARASHTRA
Sl.
No Description UnitPrice Qty NetAmount Tax Rate Tax Type Tax Amount Total Amount
1 Product Alpha Widget | B0AAAAAAA1 ( ALPHA-1 ) HSN:1905
₹475.24 1 ₹475.24 2.5% 2.5% CGST SGST ₹11.88 ₹11.88 ₹499.00
2 Product Beta (Large) Pack | B0BBBBBBB2 ( BETA-4 ) HSN:1905
₹404.76 4 ₹1,619.04 2.5% 2.5% CGST SGST ₹40.48 ₹40.48 ₹1,700.00
3 Product Gamma Deluxe | B0CCCCCCC3 ( ${sku3} ) HSN:1905
₹200.00 2 ₹400.00 2.5% 2.5% CGST SGST ${cgst3} ₹420.00
4 Shipping Charges
₹40.00 ₹40.00 9% 9% CGST SGST ₹3.60 ₹3.60 ₹47.20
TOTAL: ₹131.92 ₹2,666.20`;

let fail = 0;
const check = (name, fn) => { try { fn(); console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message); } };

(async () => {
  const files = [];
  const dir = path.join(__dirname, '..', 'samples');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(x => /\.pdf$/i.test(x))) {
    files.push(await processPdf(fs.readFileSync(path.join(dir, f)), f));
  }
  console.log('Sample PDFs:', files.length);
  files.forEach(f => console.log(' ', f.file, f.status, f.message));

  console.log('Synthetic multi-product invoice:');
  const inv = parseInvoiceText(multi(), 'multi.pdf');
  const recs = buildRecords(inv);
  files.push({ file: 'multi.pdf', status: 'ok', message: '', records: recs });
  check('3 products -> 3 records', () => assert.strictEqual(recs.length, 3));
  check('shipping not a product', () => assert.strictEqual(inv.shippingLines.length, 1));
  check('names clean', () => assert.deepStrictEqual(recs.map(r => r.fields['product-name']), ['Product Alpha Widget', 'Product Beta (Large) Pack', 'Product Gamma Deluxe']));
  check('SKUs', () => assert.deepStrictEqual(recs.map(r => r.fields.sku), ['ALPHA-1', 'BETA-4', 'GAMMA-2']));
  check('quantities/rates', () => { assert.deepStrictEqual(recs.map(r => r.fields['quantity-purchased']), [1, 4, 2]); assert.strictEqual(recs[1].fields['item-rate'], 404.76); assert.strictEqual(recs[1].fields['item-price-gst'], 1619.04); });
  check('per-product GST/total', () => { assert.strictEqual(recs[1].fields.cgst, 40.48); assert.strictEqual(recs[1].fields.sgst, 40.48); assert.strictEqual(recs[1].fields['item-price'], 1700); });

  check('shipping kept in its own columns, not in rate/basic/qty', () => {
    const g = recs[2].fields;
    assert.strictEqual(g['item-rate'], 200); assert.strictEqual(g['item-price-gst'], 400); assert.strictEqual(g['quantity-purchased'], 2);
    assert.strictEqual(g['shipping-amount'], 40); assert.strictEqual(g['shipping-cgst'], 3.6); assert.strictEqual(g['shipping-sgst'], 3.6); assert.strictEqual(g['shipping-igst'], 0);
    assert.strictEqual(g['item-price'], 467.2);
    assert.ok(recs[0].fields['shipping-amount'] === 0 && recs[1].fields['shipping-amount'] === 0, 'shipping duplicated onto other products');
  });
  const real = files.find(f => /^IN-14948/.test(f.file));
  if (real) {
    console.log('Real invoice IN-14948 (2 products, each with shipping):');
    const r = real.records.map(x => x.fields);
    const row = (i, exp) => Object.entries(exp).forEach(([k, v]) => assert.strictEqual(r[i][k], v, `${k}: got ${r[i][k]}, expected ${v}`));
    check('2 records', () => assert.strictEqual(r.length, 2));
    check('names clean (no serial/ASIN/SKU/HSN/shipping)', () => assert.ok(r.every(x => !/^\d /.test(x['product-name']) && !/B0G|HSN|KMALA|Shipping/i.test(x['product-name']))));
    check('product 1 matches your table', () => row(0, { 'quantity-purchased': 1, 'item-rate': 475.24, 'item-price-gst': 475.24, igst: 23.76, 'shipping-amount': 76.19, 'shipping-igst': 3.81, 'item-price': 579, sku: 'KMALABLBRFILL1' }));
    check('product 2 matches your table', () => row(1, { 'quantity-purchased': 4, 'item-rate': 404.76, 'item-price-gst': 1619.04, igst: 80.96, 'shipping-amount': 304.76, 'shipping-igst': 15.24, 'item-price': 2020, sku: 'KMALASTWFILL1' }));
    check('product totals reconcile with invoice value 2599', () => assert.strictEqual(r[0]['item-price'] + r[1]['item-price'], 2599));
    check('ship state/postal', () => { assert.strictEqual(r[0]['ship-state'], 'Himachal Pradesh'); assert.strictEqual(r[0]['ship-postal-code'], 175123); });
  }
  const pg = files.find(f => /^PGWN-1064/.test(f.file));
  if (pg) check('PGWN-1064: no shipping -> shipping columns 0, total 378.50', () => { const x = pg.records[0].fields; assert.strictEqual(x['shipping-amount'], 0); assert.strictEqual(x['item-price'], 378.5); assert.strictEqual(x['item-rate'], 360.48); });

  console.log('Common (unallocated) shipping must be flagged, not duplicated:');
  const commonTxt = multi().replace(/(Total Amount\n)/, '$1Shipping Charges\n₹40.00 ₹40.00 9% 9% CGST SGST ₹3.60 ₹3.60 ₹47.20\n').replace(/4 Shipping Charges\n₹40.00[^\n]*\n/, '');
  const ci = parseInvoiceText(commonTxt, 'common.pdf');
  const crec = buildRecords(ci);
  check('3 products, shipping not allocated', () => { assert.strictEqual(crec.length, 3); assert.ok(crec.every(x => x.fields['shipping-amount'] === 0)); });
  files.push({ file: 'common.pdf', status: 'ok', message: '', records: crec });

  console.log('Defective invoices (must be flagged):');
  const bad = buildRecords(parseInvoiceText(multi('', '₹10.00 ₹12.00').replace('₹420.00', '₹425.00'), 'bad.pdf'));
  files.push({ file: 'bad.pdf', status: 'ok', message: '', records: bad });
  files.push({ file: 'dup.pdf', status: 'ok', message: '', records: buildRecords(inv).map(r => ({ ...r, file: 'dup.pdf' })) });
  files.push({ file: 'broken.pdf', status: 'failed', message: 'Damaged or unreadable PDF', records: [] });
  const broken = await processPdf(Buffer.from('not a pdf'), 'broken.pdf');
  check('damaged PDF reported', () => assert.strictEqual(broken.status, 'failed'));

  const all = validateAll(files);
  const by = f => all.filter(r => r.file === f);
  check('multi.pdf all valid', () => assert.ok(by('multi.pdf').every(r => r.valid), JSON.stringify(by('multi.pdf').map(r => r.errors))));
  check('common shipping flagged for review on all its records', () => assert.ok(by('common.pdf').every(r => !r.valid && r.errors.some(e => /common shipping/i.test(e.message)))));
  check('missing SKU flagged', () => assert.ok(by('bad.pdf')[2].errors.some(e => /SKU is missing/.test(e.message))));
  check('GST/total mismatch flagged', () => assert.ok(by('bad.pdf')[2].errors.some(e => /does not match|reconcile/.test(e.message))));
  check('duplicate invoice flagged', () => assert.ok(by('dup.pdf').every(r => r.errors.some(e => /Duplicate invoice/.test(e.message)))));
  check('failed file in invalid list', () => assert.ok(by('broken.pdf')[0] && !by('broken.pdf')[0].valid));

  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  for (const t of ['valid', 'invalid', 'complete']) fs.writeFileSync(path.join(__dirname, 'out', `${t}.xlsx`), await exportRecords(t, all));
  console.log('Excel files written to test/out');
  console.log(fail ? `\n${fail} FAILED` : '\nAll tests passed');
  process.exit(fail ? 1 : 0);
})();
