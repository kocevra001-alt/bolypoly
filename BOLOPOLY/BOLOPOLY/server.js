// Serveur BOLOPOLY : sert le jeu (dossier public/) et relaie les messages entre l'hôte et l'invité.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8787, ROOT = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }   // pour garder le serveur éveillé
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, perMessageDeflate: { threshold: 1024 } });
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (rooms.has(c)); return c; };
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    if (raw.length > 2e6) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'host') { const c = newCode(); rooms.set(c, { host: ws, guest: null }); ws.room = c; ws.role = 'host'; return send(ws, { t: 'hosted', code: c }); }
    if (m.t === 'join') {
      const c = String(m.code || '').toUpperCase(), r = rooms.get(c);
      if (!r) return send(ws, { t: 'error', msg: 'Code introuvable.' });
      if (r.guest) return send(ws, { t: 'error', msg: 'Cette partie a déjà un invité.' });
      r.guest = ws; ws.room = c; ws.role = 'guest';
      send(ws, { t: 'joined' });
      return send(r.host, { t: 'guest-in', name: String(m.name || '').slice(0, 14), char: m.char });
    }
    const r = rooms.get(ws.room);
    if (r) send(ws.role === 'host' ? r.guest : r.host, m);
  });
  ws.on('close', () => {
    const r = rooms.get(ws.room);
    if (!r) return;
    if (ws.role === 'host') { send(r.guest, { t: 'peer-left' }); rooms.delete(ws.room); }
    else { r.guest = null; send(r.host, { t: 'peer-left' }); }
  });
});
setInterval(() => wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 25000);
server.listen(PORT, () => console.log(`BOLOPOLY sur http://localhost:${PORT}`));
