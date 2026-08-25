/**
 * Local dev/test server — TEST HARNESS ONLY.
 *
 * Routes requests to the same handler modules Vercel will invoke, and serves
 * `public/` as static files, so the whole app can be exercised end-to-end
 * without deploying. lib/db.js is pointed at a local Postgres via the test
 * client, since this sandbox has no npm access for the Neon driver.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestPool } from './pg-client.mjs';
import { __setClient } from '../lib/db.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

const ROUTES = {
  '/api/info': '../api/info.js',
  '/api/services': '../api/services.js',
  '/api/slots': '../api/slots.js',
  '/api/book': '../api/book.js',
  '/api/reviews': '../api/reviews.js',
  '/api/contact': '../api/contact.js',
  '/api/admin/login': '../api/admin/login.js',
  '/api/admin': '../api/admin/index.js',
};

export async function start(port = 8877) {
  __setClient(await createTestPool());

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (ROUTES[pathname]) {
      try {
        const mod = await import(ROUTES[pathname]);
        await mod.default(req, res);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, message: err.message }));
      }
      return;
    }

    // Static files out of public/
    let file = path.join(root, 'public', pathname === '/' ? 'index.html' : pathname);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((r) => server.listen(port, r));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 8877;
  await start(port);
  console.log(`test server on http://127.0.0.1:${port}`);
}
