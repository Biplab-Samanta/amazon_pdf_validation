'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { processPdf } = require('./src/extractor');
const { validateAll } = require('./src/validator');
const { exportRecords } = require('./src/exporter');
const { FIELDS } = require('./src/schema');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const readBody = (req, limit) => new Promise((res, rej) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { rej(new Error('Payload too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => res(Buffer.concat(chunks))); req.on('error', rej);
});
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/schema') return json(res, 200, FIELDS);
    if (req.method === 'POST' && url.pathname === '/api/extract') {
      const file = decodeURIComponent(req.headers['x-filename'] || 'unknown.pdf');
      return json(res, 200, await processPdf(await readBody(req, 100 * 1024 * 1024), file));
    }
    if (req.method === 'POST' && url.pathname === '/api/validate') {
      const body = JSON.parse((await readBody(req, 200 * 1024 * 1024)).toString());
      return json(res, 200, validateAll(body.files));
    }
    if (req.method === 'POST' && url.pathname === '/api/export') {
      const type = url.searchParams.get('type');
      if (!['valid', 'invalid', 'complete'].includes(type)) return json(res, 400, { error: 'bad type' });
      const body = JSON.parse((await readBody(req, 200 * 1024 * 1024)).toString());
      const buf = await exportRecords(type, body.records);
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return res.end(buf);
    }
    if (req.method === 'GET') {
      const p = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[\/\\])+/, '');
      const fp = path.join(PUB, p);
      if (fp.startsWith(PUB) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        return fs.createReadStream(fp).pipe(res);
      }
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`Amazon PDF Invoice Validator running at http://localhost:${PORT}`));
