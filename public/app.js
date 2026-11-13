'use strict';
const $ = s => document.querySelector(s);
const PAGE = 50, CONCURRENCY = 3;
let FIELDS = [], results = [], records = [], statuses = new Map(), tab = 'valid', page = 0, selected = null, busy = false;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (f, v) => v === '' || v == null ? '' : f.type === 'money' ? Number(v).toFixed(2) : f.type === 'date' ? v.split('-').reverse().join('-') : v;

async function init() {
  FIELDS = await (await fetch('/api/schema')).json();
  $('#chips').innerHTML = FIELDS.map((f, i) => `<span class="chip ${f.required ? 'req' : ''}" title="${f.key}${f.required ? ' (required)' : ''}">${i + 1}. ${esc(f.label)}</span>`).join('');
  render();
}

function setMsg(kind, text) { const m = $('#msg'); m.hidden = !text; m.className = 'msg ' + kind; m.textContent = text || ''; }

async function addFiles(list) {
  if (busy) return setMsg('warn', 'Please wait for the current batch to finish.');
  const pdfs = [...list].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  const skipped = list.length - pdfs.length;
  if (!pdfs.length) return setMsg('bad', 'No PDF files selected.');
  busy = true; setMsg('', ''); $('#progress').hidden = false;
  let done = 0;
  const queue = pdfs.filter(f => { if (statuses.has(f.name) && statuses.get(f.name).state === 'done') { return false; } return true; });
  const total = queue.length;
  queue.forEach(f => statuses.set(f.name, { state: 'queued', message: 'Waiting…' })); render();
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      statuses.set(f.name, { state: 'running', message: 'Extracting…' }); renderStatus();
      let r;
      try {
        const resp = await fetch('/api/extract', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(f.name) }, body: await f.arrayBuffer() });
        r = await resp.json();
        if (r.error) r = { file: f.name, status: 'failed', message: r.error, records: [] };
      } catch (e) { r = { file: f.name, status: 'failed', message: 'Upload failed: ' + e.message, records: [] }; }
      results = results.filter(x => x.file !== f.name); results.push(r);
      statuses.set(f.name, { state: 'done', ok: r.status === 'ok', message: r.message });
      $('#bar').style.width = (++done / total * 100) + '%'; renderStatus();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  try { records = await (await fetch('/api/validate', { method: 'POST', body: JSON.stringify({ files: results }) })).json(); }
  catch (e) { setMsg('bad', 'Validation failed: ' + e.message); }
  busy = false; $('#progress').hidden = true; $('#bar').style.width = '0';
  page = 0; selected = null;
  render();
  const s = stats();
  if (!s.total) setMsg('bad', 'No product records could be extracted from the selected PDFs.');
  else if (s.invalid) setMsg('warn', `Processed ${s.pdfs} PDF file(s): ${s.valid} valid and ${s.invalid} invalid product record(s). Review the Invalid Data tab.${skipped ? ` (${skipped} non-PDF file(s) ignored.)` : ''}`);
  else setMsg('ok', `All ${s.valid} product record(s) from ${s.ok} PDF file(s) passed validation.`);
}

function stats() {
  const real = records.filter(r => !r.placeholder);
  return { pdfs: results.length, ok: results.filter(r => r.status === 'ok').length, total: real.length,
    valid: real.filter(r => r.valid).length, invalid: records.filter(r => !r.valid).length };
}

function render() { renderSummary(); renderStatus(); renderTable(); renderErrors(); }

function renderSummary() {
  const s = stats();
  const c = [['Total PDF Files', s.pdfs, ''], ['Successfully Processed PDFs', s.ok, 'ok'], ['Valid Product Records', s.valid, 'ok'], ['Invalid Product Records', s.invalid, s.invalid ? 'bad' : ''], ['Total Products Extracted', s.total, '']];
  $('#summary').innerHTML = c.map(([l, v, k]) => `<div class="stat ${k}"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#dl-valid').disabled = !s.valid; $('#dl-invalid').disabled = !s.invalid; $('#dl-complete').disabled = !records.length;
  $('#c-valid').textContent = s.valid; $('#c-invalid').textContent = s.invalid;
}

function renderStatus() {
  const rows = [...statuses.entries()].map(([name, s]) => {
    const cls = s.state === 'done' ? (s.ok ? 'st-ok' : 'st-bad') : 'st-run';
    const label = s.state === 'done' ? (s.ok ? 'Processed' : 'Failed') : s.state === 'running' ? 'Processing' : 'Queued';
    return `<tr><td>${esc(name)}</td><td class="${cls}">${label}</td><td>${esc(s.message)}</td></tr>`;
  });
  $('#status-table tbody').innerHTML = rows.join('') || '<tr><td colspan="3" class="muted">No files yet.</td></tr>';
}

const view = () => records.filter(r => tab === 'valid' ? r.valid : !r.valid);

function renderTable() {
  const list = view(), pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(page, pages - 1);
  const extra = tab === 'invalid' ? '<th>PDF file</th><th>Invoice</th><th>Product</th><th>Why it failed</th>' : '';
  $('#data-table thead').innerHTML = `<tr>${extra}${FIELDS.map(f => `<th>${esc(f.label)}</th>`).join('')}</tr>`;
  const slice = list.slice(page * PAGE, page * PAGE + PAGE);
  $('#data-table tbody').innerHTML = slice.map(r => {
    const bad = new Set(r.errors.map(e => e.field));
    const pre = tab === 'invalid' ? `<td>${esc(r.file)}</td><td>${esc(r.fields['voucher-number'])}</td><td>${esc(r.fields['product-name'])}</td><td class="errtxt">${esc(r.errors.map(e => e.message).join(' '))}</td>` : '';
    const cells = FIELDS.map(f => `<td class="${f.type === 'money' || f.type === 'number' ? 'num ' : ''}${bad.has(f.key) || (r.placeholder && false) ? 'err' : ''}" title="${esc(r.fields[f.key])}">${esc(fmt(f, r.fields[f.key])) || (bad.has(f.key) ? '—' : '')}</td>`).join('');
    return `<tr class="click ${selected === r.id ? 'sel' : ''}" data-id="${r.id}">${pre}${cells}</tr>`;
  }).join('') || `<tr><td class="muted" colspan="40">No ${tab} records.</td></tr>`;
  $('#page-info').textContent = `Page ${page + 1} of ${pages} · ${list.length} record(s)`;
  $('#prev').disabled = page === 0; $('#next').disabled = page >= pages - 1;
  renderDetail();
}

function renderDetail() {
  const r = records.find(x => x.id === selected), d = $('#detail');
  d.hidden = !r; if (!r) return;
  d.innerHTML = `<strong>${esc(r.file)}</strong> · Invoice ${esc(r.fields['voucher-number'] || '—')} · ${esc(r.fields['product-name'] || '(no product name)')}
    <ul>${r.errors.map(e => `<li style="color:var(--bad)">${esc(e.message)}</li>`).join('') || '<li style="color:var(--ok)">No errors.</li>'}</ul>
    ${r.warnings && r.warnings.length ? `<div style="margin-top:8px;color:var(--warn)">Warnings:<ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}`;
}

function renderErrors() {
  const items = [];
  records.forEach(r => r.errors.forEach(e => items.push({ r, e })));
  $('#c-errors').textContent = items.length;
  $('#errors').innerHTML = items.map(({ r, e }) => `<div class="item" data-id="${r.id}">
    <small>File:</small> ${esc(r.file)} &nbsp; <small>Invoice:</small> ${esc(r.fields['voucher-number'] || '—')} &nbsp; <small>Product:</small> ${esc(r.fields['product-name'] || '—')}<br>
    <span class="e">Error: ${esc(e.message)}</span></div>`).join('') || '<p class="muted">No errors.</p>';
}

async function download(type, name) {
  const body = type === 'valid' ? records.filter(r => r.valid && !r.placeholder) : type === 'invalid' ? records.filter(r => !r.valid) : records;
  const resp = await fetch('/api/export?type=' + type, { method: 'POST', body: JSON.stringify({ records: body }) });
  if (!resp.ok) return setMsg('bad', 'Export failed.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await resp.blob()); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

$('#pick').onclick = () => $('#file').click();
$('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', e => e.preventDefault());
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { tab = b.dataset.tab; page = 0; selected = null; document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b)); renderTable(); });
$('#prev').onclick = () => { page--; renderTable(); }; $('#next').onclick = () => { page++; renderTable(); };
$('#data-table').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) { selected = +tr.dataset.id; renderTable(); } });
$('#errors').addEventListener('click', e => {
  const it = e.target.closest('.item'); if (!it) return;
  const r = records.find(x => x.id === +it.dataset.id); tab = r.valid ? 'valid' : 'invalid'; selected = r.id;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  const idx = view().findIndex(x => x.id === r.id); page = Math.floor(idx / PAGE); renderTable();
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('#dl-valid').onclick = () => download('valid', 'valid_data.xlsx');
$('#dl-invalid').onclick = () => download('invalid', 'invalid_data.xlsx');
$('#dl-complete').onclick = () => download('complete', 'complete_report.xlsx');
$('#clear').onclick = () => { if (busy) return; results = []; records = []; statuses.clear(); selected = null; setMsg('', ''); render(); };
init();
