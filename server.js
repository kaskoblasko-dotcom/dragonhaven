// Dragon Haven server: static client + accounts + cloud saves.
// Uses Postgres when DATABASE_URL is set (Render), otherwise a local JSON file.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ---------- storage ----------
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false }
  });
  store = {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS players (
        username TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        token_hash TEXT,
        save JSONB,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`);
    },
    async get(u) { const r = await pool.query('SELECT * FROM players WHERE username=$1', [u]); return r.rows[0] || null; },
    async byToken(th) { const r = await pool.query('SELECT * FROM players WHERE token_hash=$1', [th]); return r.rows[0] || null; },
    async create(u, salt, ph, th) { await pool.query('INSERT INTO players(username,salt,pass_hash,token_hash) VALUES($1,$2,$3,$4)', [u, salt, ph, th]); },
    async setToken(u, th) { await pool.query('UPDATE players SET token_hash=$2 WHERE username=$1', [u, th]); },
    async setSave(u, save) { await pool.query('UPDATE players SET save=$2, updated_at=now() WHERE username=$1', [u, save]); }
  };
  console.log('Storage: Postgres');
} else {
  const file = path.join(__dirname, 'data', 'players.json');
  let db = {};
  const flush = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db)); };
  store = {
    async init() { try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = {}; } },
    async get(u) { return db[u] || null; },
    async byToken(th) { return Object.values(db).find(p => p.token_hash === th) || null; },
    async create(u, salt, ph, th) { db[u] = { username: u, salt, pass_hash: ph, token_hash: th, save: null }; flush(); },
    async setToken(u, th) { db[u].token_hash = th; flush(); },
    async setSave(u, save) { db[u].save = save; db[u].updated_at = new Date().toISOString(); flush(); }
  };
  console.log('Storage: local JSON file (set DATABASE_URL for Postgres)');
}

// ---------- helpers ----------
const hashPass = (pass, salt) => new Promise((res, rej) =>
  crypto.scrypt(pass, salt, 64, (e, k) => e ? rej(e) : res(k.toString('hex'))));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const validName = u => typeof u === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(u);
const validPass = p => typeof p === 'string' && p.length >= 6 && p.length <= 100;

// Very small rate limiter for auth routes
const hits = new Map();
function limit(req, res, next) {
  const key = req.ip; const now = Date.now();
  const h = (hits.get(key) || []).filter(t => now - t < 60000);
  h.push(now); hits.set(key, h);
  if (h.length > 20) return res.status(429).json({ error: 'Too many attempts, wait a minute.' });
  next();
}

async function auth(req, res, next) {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'Not logged in' });
  const p = await store.byToken(sha(m[1]));
  if (!p) return res.status(401).json({ error: 'Session expired, log in again' });
  req.player = p; next();
}
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

// ---------- routes ----------
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.post('/api/register', limit, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!validName(username)) return res.status(400).json({ error: 'Name: 3-20 letters, numbers or _' });
  if (!validPass(password)) return res.status(400).json({ error: 'Password: at least 6 characters' });
  const u = username.toLowerCase();
  if (await store.get(u)) return res.status(409).json({ error: 'That name is taken' });
  const salt = crypto.randomBytes(16).toString('hex');
  const token = newToken();
  await store.create(u, salt, await hashPass(password, salt), sha(token));
  res.json({ token, username: u, save: null });
}));

app.post('/api/login', limit, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!validName(username) || typeof password !== 'string') return res.status(400).json({ error: 'Wrong name or password' });
  const u = username.toLowerCase();
  const p = await store.get(u);
  if (!p) return res.status(401).json({ error: 'Wrong name or password' });
  const h = await hashPass(password, p.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(p.pass_hash, 'hex')))
    return res.status(401).json({ error: 'Wrong name or password' });
  const token = newToken();
  await store.setToken(u, sha(token));
  res.json({ token, username: u, save: p.save || null });
}));

app.get('/api/save', wrap(async (req, res) => auth(req, res, () => res.json({ username: req.player.username, save: req.player.save || null, time: Date.now() }))));

app.put('/api/save', wrap(async (req, res) => auth(req, res, async () => {
  const save = req.body && req.body.save;
  if (!save || typeof save !== 'object') return res.status(400).json({ error: 'Bad save' });
  // Reject saves older than what's stored (another device saved later)
  const cur = req.player.save;
  if (cur && cur.savedAt && save.savedAt && save.savedAt < cur.savedAt - 5000 && !req.body.force)
    return res.status(409).json({ error: 'A newer save exists on the server', save: cur });
  await store.setSave(req.player.username, save);
  res.json({ ok: true, time: Date.now() });
})));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

store.init().then(() => app.listen(PORT, () => console.log(`Dragon Haven running on port ${PORT}`)))
  .catch(e => { console.error('Storage init failed', e); process.exit(1); });
