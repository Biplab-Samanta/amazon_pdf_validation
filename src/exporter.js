'use strict';
const { FIELDS } = require('./schema');
const { buildWorkbook } = require('./xlsx');
const base = FIELDS.map(f => ({ header: f.label, key: f.key, type: f.type, width: f.key === 'product-name' ? 60 : 18 }));
const flatten = r => ({ ...r.fields, _file: r.file, _errors: r.errors.map(e => e.message).join(' | '), _warnings: (r.warnings || []).join(' | '), _status: r.valid ? 'Valid' : 'Invalid' });

async function exportRecords(type, records) {
  const real = records.filter(r => !r.placeholder);
  let cols = base, rows, name;
  if (type === 'valid') { rows = real.filter(r => r.valid).map(flatten); name = 'Valid Data'; }
  else if (type === 'invalid') {
    rows = records.filter(r => !r.valid).map(flatten); name = 'Invalid Data';
    cols = [...base, { header: 'PDF File', key: '_file', type: 'string', width: 34 }, { header: 'Validation Errors', key: '_errors', type: 'string', width: 80 }];
  } else {
    rows = records.map(flatten); name = 'Complete Report';
    cols = [...base, { header: 'PDF File', key: '_file', type: 'string', width: 34 }, { header: 'Status', key: '_status', type: 'string', width: 10 },
      { header: 'Validation Errors', key: '_errors', type: 'string', width: 80 }, { header: 'Warnings', key: '_warnings', type: 'string', width: 60 }];
  }
  return buildWorkbook({ name, columns: cols, rows });
}
module.exports = { exportRecords };
