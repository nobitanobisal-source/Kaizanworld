'use strict';
// Kaizan World server: serves the game page and relays multiplayer over WebSocket.
// No dependencies. Run with: node server.js   (needs Node 18 or newer)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'bricks.json');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';   // optional, e.g. https://namamu.onrender.com
const MAX_CLIENTS = 120, MAX_BRICKS = 3000, MAX_FRAME = 16 * 1024;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HEX = /^#[0-9a-fA-F]{6}$/, ID = /^[A-Za-z0-9_-]{1,24}$/;

/* ---------- saved bricks ---------- */
const bricks = new Map();
try { JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).forEach(([id, b]) => bricks.set(id, b)); console.log('Loaded', bricks.size, 'bricks'); } catch (e) {}
let saveT = null;
function saveSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify([...bricks])); fs.renameSync(DATA_FILE + '.tmp', DATA_FILE); }
    catch (e) { console.error('Could not save bricks:', e.message); }
  }, 1500);
}
function validBrick(d) {
  if (!d || typeof d !== 'object') return null;
  const { x, y, z, w, d: dd, c } = d;
  if (!(w === 2 || w === 4) || !(dd === 2 || dd === 4)) return null;
  if (![x, y, z].every(Number.isInteger) || Math.abs(x) > 98 || Math.abs(z) > 98 || y < 0 || y > 40) return null;
  if (typeof c !== 'string' || !HEX.test(c)) return null;
  return { x, y, z, w, d: dd, c };
}
function overlaps(a, b) {
  return a.x - a.w / 2 < b.x + b.w / 2 && a.x + a.w / 2 > b.x - b.w / 2 && a.z - a.d / 2 < b.z + b.d / 2 && a.z + a.d / 2 > b.z - b.d / 2 && a.y < b.y + 1 && a.y + 1 > b.y;
}

/* ---------- http ---------- */
const page = () => fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return res.end(page());
  }
  if (u === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
});

/* ---------- minimal WebSocket (RFC 6455) ---------- */
function frame(op, data) {
  const p = Buffer.isBuffer(data) ? data : Buffer.from(data), n = p.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, p]);
}
const clients = new Map(); let nextId = 1, dirty = false;
function wsSend(c, obj) {
  if (c.sock.destroyed) return;
  if (c.sock.writableLength > 1 << 20) { c.sock.destroy(); return; }
  c.sock.write(frame(1, JSON.stringify(obj)));
}
function broadcast(obj, except) { const f = frame(1, JSON.stringify(obj)); clients.forEach((c) => { if (c !== except && !c.sock.destroyed) c.sock.write(f); }); }

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  const bad = req.url.split('?')[0] !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key ||
    (ALLOWED_ORIGIN && req.headers.origin !== ALLOWED_ORIGIN);
  if (bad) { sock.destroy(); return; }
  if (clients.size >= MAX_CLIENTS) { sock.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  const acc = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: 'p' + nextId++, sock, buf: Buffer.alloc(0), frag: [], presence: {}, tokens: 60, last: Date.now() };
  clients.set(c.id, c);
  sock.on('data', (d) => {
    c.buf = Buffer.concat([c.buf, d]);
    if (c.buf.length > MAX_FRAME * 2) { sock.destroy(); return; }
    parse(c);
  });
  const drop = () => { if (clients.delete(c.id)) dirty = true; };
  sock.on('close', drop); sock.on('error', () => { drop(); sock.destroy(); });
  wsSend(c, { t: 'hello', id: c.id, bricks: [...bricks] });
});

function parse(c) {
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0; let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) { c.sock.destroy(); return; } len = Number(big); off = 10; }
    if (len > MAX_FRAME || !masked) { c.sock.destroy(); return; }
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    c.buf = b.subarray(off + 4 + len);
    if (op === 8) { c.sock.end(frame(8, payload.subarray(0, 2))); return; }
    if (op === 9) { c.sock.write(frame(10, payload)); continue; }
    if (op === 10) continue;
    if (op === 1 || op === 0) {
      c.frag.push(payload); if (c.frag.reduce((n, p) => n + p.length, 0) > MAX_FRAME) { c.sock.destroy(); return; }
      if (fin) { const text = Buffer.concat(c.frag).toString('utf8'); c.frag = []; onMessage(c, text); }
    }
  }
}

/* ---------- messages ---------- */
const clean = (s, n) => String(s).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
const num = (v, lim) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : null);
function applyPresence(c, patch) {
  if (!patch || typeof patch !== 'object') return;
  const p = c.presence;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === null) { delete p[k]; continue; }
    if (k === 'n' && typeof v === 'string') p.n = clean(v, 16) || 'Player';
    else if (k === 'c' && typeof v === 'string' && HEX.test(v)) p.c = v;
    else if (k === 'g' && (v === 'open' || v === 'climb')) p.g = v;
    else if (k === 'e' && Array.isArray(v)) p.e = v.slice(0, 5).map((s) => (typeof s === 'string' ? clean(s, 24) : ''));
    else if ((k === 'x' || k === 'z') && num(v, 400) !== null) p[k] = num(v, 400);
    else if ((k === 'y') && num(v, 400) !== null) p.y = num(v, 400);
    else if (k === 'r' && num(v, 20) !== null) p.r = num(v, 20);
    else if (k === 'm') p.m = v ? 1 : 0;
    else if (k === 'chat' && v && typeof v.i === 'string' && typeof v.t === 'string') p.chat = { i: clean(v.i, 16), t: clean(v.t, 120) };
  }
  dirty = true;
}
function onMessage(c, text) {
  const now = Date.now(); c.tokens = Math.min(60, c.tokens + (now - c.last) * 0.08); c.last = now;
  if (c.tokens < 1) return; c.tokens -= 1;
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'p') applyPresence(c, m.d);
  else if (m.t === 'bset') {
    const id = m.id, d = validBrick(m.d);
    if (typeof id !== 'string' || !ID.test(id) || id[0] === 's' || !d || bricks.has(id) || bricks.size >= MAX_BRICKS) return wsSend(c, { t: 'bnack', id: String(id).slice(0, 24) });
    for (const o of bricks.values()) if (overlaps(d, o)) return wsSend(c, { t: 'bnack', id });
    bricks.set(id, d); saveSoon(); broadcast({ t: 'bset', id, d }, c);
  } else if (m.t === 'bdel') {
    if (typeof m.id === 'string' && bricks.delete(m.id)) { saveSoon(); broadcast({ t: 'bdel', id: m.id }, c); }
  }
}
setInterval(() => {
  if (!dirty) return; dirty = false;
  const list = []; clients.forEach((c) => { if (c.presence.n) list.push({ id: c.id, p: c.presence }); });
  const f = frame(1, JSON.stringify({ t: 'peers', list }));
  clients.forEach((c) => { if (!c.sock.destroyed) c.sock.write(f); });
}, 66);
setInterval(() => clients.forEach((c) => { if (!c.sock.destroyed) c.sock.write(frame(9, '')); }), 25000);

server.listen(PORT, () => console.log('Kaizan World running on http://localhost:' + PORT));
process.on('SIGTERM', () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify([...bricks])); } catch (e) {} process.exit(0); });
