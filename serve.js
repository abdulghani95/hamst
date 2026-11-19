#!/usr/bin/env node
/* Zero-dependency static server: `npm start` -> http://localhost:8080 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const PUBLIC = ['index.html', 'sw.js', 'manifest.webmanifest', 'css', 'js', 'icons'];

function handler(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(top)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

function start(port) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(port, () => resolve(server));
  });
}

module.exports = { start };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  start(port).then(() => console.log('همسة جاهز على http://localhost:' + port));
}
