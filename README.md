# Amazon PDF Invoice Validator

Upload Amazon tax-invoice PDFs, extract **one record per product**, validate each record, and download
Tally Prime import-ready Excel files (exact 23-column schema).

## Install and run (Windows)
1. Install Node.js 18 or newer (https://nodejs.org, LTS).
2. Extract the ZIP, open **Command Prompt** in the folder, then run:

```
npm install
npm start
```
3. Open http://localhost:3000. Alternatively double-click `start.bat`, which installs, starts and opens the browser.

Run the tests (uses `samples/` plus a synthetic 3-product invoice):  `npm test`

## Project layout
| File | Purpose |
|---|---|
| `server.js` | Plain Node HTTP server: `/api/extract`, `/api/validate`, `/api/export` |
| `src/schema.js` | The 23 columns (order, keys, required flags) and editable defaults |
| `src/extractor.js` | PDF text extraction (pdfjs) and the product-wise invoice parser |
| `src/validator.js` | Per-record validation, calculation checks, duplicates |
| `src/xlsx.js`, `src/exporter.js` | Excel writer (numbers and dates are real cells) and the three reports |
| `public/` | Dashboard (HTML, CSS, JS) |

## How extraction works
Each invoice line is located by its numeric tail (unit price, qty, net amount, tax rate(s), tax type(s), tax amount(s), total).
The text before it is the product description, cleaned of serial number, HSN, ASIN and SKU. The SKU is read from the
`ASIN ( SKU )` pattern. IGST, or CGST+SGST, are assigned per product from the line itself. Rows described as
Shipping/Delivery/Handling charges are never treated as products.

## Assumptions you may want to change (`src/schema.js`)
- **Purchase Date** = the invoice's Order Date. **Voucher Number** = Invoice Number.
- **Party Name / GSTIN** = the billing party (buyer). **Ship State/Postal/Country** = shipping address; `IN` becomes `India`.
- **Per** defaults to `Nos`. **Sales Ledger** is not on the invoice, so it is generated from a template
  (`Sales IGST 5%`, `Sales GST 5%`). Edit `salesLedgerTemplate` to match your Tally ledger names, or set it to `''` to leave it blank.
- **Shipping** is extracted separately into four columns (Shipping Amount = taxable amount, Shipping SGST/CGST/IGST), placed just
  before Total bill Value. A shipping row printed under a product is mapped to that product's row only and never touches the
  product name, Item Rate, Item Basic Amount or Quantity. Total bill Value = Basic + SGST + CGST + IGST + Shipping Amount +
  Shipping SGST + CGST + IGST. A shipping row not tied to any product (common shipping) is never copied onto products;
  every record of that invoice is flagged Invalid ("review and allocate manually"). Products without shipping show 0.

## Validation
Required fields, numeric/negative checks, date, 6-digit postal code, GSTIN format, quantity, Qty x Rate = Basic Amount,
Basic + GST + Shipping + Shipping GST = Total, GST vs the line's tax rate, reconciliation of all lines to the invoice TOTAL, duplicate invoice numbers
across files, and damaged/unreadable/scanned PDFs. Failed files appear in Invalid Data with the reason.

## Limits
Text-based PDFs only (no OCR for scanned images). Layouts other than the standard Amazon.in tax invoice may need extractor
tweaks; failures are reported, never silently converted to valid records.
