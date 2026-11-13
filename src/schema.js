'use strict';
// Exact 23-column schema, in exact order. Do not add columns here.
const FIELDS = [
  { label: 'Purchase Date',        key: 'purchase-date',    type: 'date' },
  { label: 'Voucher Number',       key: 'voucher-number',   type: 'string' },
  { label: 'Amazon Order ID',      key: 'order-id',         type: 'string', required: true },
  { label: 'Party Name',           key: 'party-name',       type: 'string' },
  { label: 'Sales Ledger',         key: 'sales-ledger',     type: 'string' },
  { label: 'Item basic Name',      key: 'product-name',     type: 'string', required: true },
  { label: 'Item SKU',             key: 'sku',              type: 'string', required: true },
  { label: 'Item Quantity',        key: 'quantity-purchased', type: 'number', required: true },
  { label: 'Item Rate',            key: 'item-rate',        type: 'money' },
  { label: 'Per',                  key: 'per',              type: 'string' },
  { label: 'Item Basic Amount',    key: 'item-price-gst',   type: 'money' },
  { label: 'SGST',                 key: 'sgst',             type: 'money' },
  { label: 'CGST',                 key: 'cgst',             type: 'money' },
  { label: 'IGST',                 key: 'igst',             type: 'money' },
  { label: 'Shipping Amount',      key: 'shipping-amount',  type: 'money' },
  { label: 'Shipping SGST',        key: 'shipping-sgst',    type: 'money' },
  { label: 'Shipping CGST',        key: 'shipping-cgst',    type: 'money' },
  { label: 'Shipping IGST',        key: 'shipping-igst',    type: 'money' },
  { label: 'Total bill Value',     key: 'item-price',       type: 'money', required: true },
  { label: 'ship State',           key: 'ship-state',       type: 'string', required: true },
  { label: 'Ship Postal Code',     key: 'ship-postal-code', type: 'number', required: true },
  { label: 'Ship Country',         key: 'ship-country',     type: 'string', required: true },
  { label: 'GSTIN',                key: 'gstin',            type: 'string' }
];

// Editable defaults for values Amazon invoices do not carry.
const DEFAULTS = {
  per: 'Nos',                                     // Tally unit
  salesLedgerTemplate: 'Sales {taxType} {rate}%', // '' = leave Sales Ledger blank
  countryMap: { IN: 'India' },
  amountTolerance: 0.06                           // rupees, for rounding differences
};

module.exports = { FIELDS, DEFAULTS };
