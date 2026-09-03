'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function startServer({ steps, meta, sessionName, port = 0 }) {
  const payload = JSON.stringify({ steps, meta, sessionName });

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/api/session') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(payload);
      return;
    }

    let filePath = url === '/' ? '/index.html' : url;
    filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(PUBLIC_DIR, filePath);

    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const ext = path.extname(fullPath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actualPort } = server.address();
      resolve({ server, port: actualPort, url: `http://127.0.0.1:${actualPort}` });
    });
  });
}

module.exports = { startServer };
