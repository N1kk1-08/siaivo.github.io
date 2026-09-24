'use strict';

// A small account and synchronization service for the MyLampa client.
// It has no npm dependencies and keeps all account data in one private file.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 9120);
const DATA_FILE = process.env.DATA_FILE || '/data/accounts.json';
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
const ALLOW_NULL_ORIGIN = process.env.ALLOW_NULL_ORIGIN === '1';
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_BODY = 2 * 1024 * 1024;
const CATEGORIES = ['history', 'like', 'watch', 'wath', 'book', 'look', 'viewed', 'scheduled', 'continued', 'thrown'];
const attempts = new Map();

function freshFavorite() {
  const value = { card: [] };
  for (const category of CATEGORIES) value[category] = [];
  return value;
}

function readDatabase() {
  if (!fs.existsSync(DATA_FILE)) return { version: 1, users: {}, revoked: {}, archives: {} };
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data || data.version !== 1 || !data.users || !data.revoked) throw new Error('Invalid account database');
  if (!data.archives) data.archives = {};
  return data;
}

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });
let db = readDatabase();

function saveDatabase() {
  const temp = DATA_FILE + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(db));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, DATA_FILE);
}

function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function normalizedName(value) { return String(value || '').trim().toLowerCase(); }
function validName(name) {
  return /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(name) &&
    name !== '__proto__' && name !== 'constructor' && name !== 'prototype';
}
function validPassword(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 128; }
function hashPassword(password, salt) { return crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex'); }
function equalHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function send(res, status, value, origin) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {})
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => {
      try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); }
      catch (_) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function rateLimited(key) {
  const now = Date.now();
  const item = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (now > item.until) { item.count = 0; item.until = now + 15 * 60 * 1000; }
  item.count += 1;
  attempts.set(key, item);
  if (attempts.size > 10000) {
    for (const [name, entry] of attempts) if (entry.until < now) attempts.delete(name);
  }
  return item.count > 8;
}

function authorization(req) {
  const match = /^Bearer ([A-Za-z0-9_-]{30,100})$/.exec(String(req.headers.authorization || ''));
  if (!match) return { error: 'unauthorized' };
  const hash = tokenHash(match[1]);
  if (db.revoked[hash]) return { error: db.revoked[hash].reason };
  for (const user of Object.values(db.users)) {
    if (user.sessions && user.sessions[hash]) {
      const session = user.sessions[hash];
      if (Date.now() - session.createdAt > SESSION_MS) {
        delete user.sessions[hash];
        saveDatabase();
        return { error: 'expired' };
      }
      return { user, session, hash };
    }
  }
  return { error: 'unauthorized' };
}

function publicUser(user, session) {
  return {
    id: user.id,
    username: user.name,
    owner: !!session.owner,
    lastSyncAt: user.lastSyncAt || 0,
    revision: user.revision || 0
  };
}

function makeSession(user, owner) {
  const token = randomToken();
  if (!user.sessions) user.sessions = {};
  user.sessions[tokenHash(token)] = { createdAt: Date.now(), owner: !!owner };
  return token;
}

function revokeSession(hash, reason) {
  db.revoked[hash] = { reason, until: Date.now() + SESSION_MS };
}

function cleanRevoked() {
  const now = Date.now();
  for (const [hash, entry] of Object.entries(db.revoked)) {
    if (entry.until < now) delete db.revoked[hash];
  }
}

function cardId(value) {
  if (value === null || value === undefined) return '';
  const id = String(value);
  return /^[a-zA-Z0-9:_-]{1,80}$/.test(id) &&
    id !== '__proto__' && id !== 'constructor' && id !== 'prototype' ? id : '';
}

function safeCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
  if (!cardId(card.id)) return null;
  const json = JSON.stringify(card);
  return json.length <= 12000 ? JSON.parse(json) : null;
}

function applyChanges(user, input) {
  const favorite = structuredClone(user.favorite || freshFavorite());
  const timecodes = structuredClone(user.timecodes || {});
  let changed = false;
  const patches = input && input.categories && typeof input.categories === 'object' ? input.categories : {};
  const cards = input && input.cards && typeof input.cards === 'object' ? input.cards : {};
  const existing = new Map((Array.isArray(favorite.card) ? favorite.card : []).filter(Boolean).map(card => [String(card.id), card]));

  for (const category of CATEGORIES) {
    const patch = patches[category];
    if (!patch) continue;
    if (!Array.isArray(patch.add) || !Array.isArray(patch.remove) || patch.add.length > 1000 || patch.remove.length > 1000) {
      throw Object.assign(new Error('Invalid bookmark changes'), { status: 400 });
    }
    const list = Array.isArray(favorite[category]) ? favorite[category].slice() : [];
    const remove = new Set(patch.remove.map(cardId).filter(Boolean));
    const filtered = list.filter(id => !remove.has(String(id)));
    if (filtered.length !== list.length) changed = true;
    const have = new Set(filtered.map(String));
    const additions = [];
    for (const raw of patch.add) {
      const id = cardId(raw);
      if (!id) throw Object.assign(new Error('Invalid bookmark ID'), { status: 400 });
      if (have.has(id)) continue;
      const card = cards[id] === undefined ? null : safeCard(cards[id]);
      if (cards[id] !== undefined && (!card || String(card.id) !== id)) {
        throw Object.assign(new Error('Invalid bookmark card'), { status: 400 });
      }
      if (!card && !existing.has(id)) throw Object.assign(new Error('Bookmark card missing'), { status: 400 });
      if (card) existing.set(id, card);
      additions.push(raw);
      have.add(id);
      changed = true;
    }
    favorite[category] = additions.concat(filtered);
  }

  const referenced = new Set();
  for (const category of CATEGORIES) for (const id of favorite[category] || []) referenced.add(String(id));
  favorite.card = Array.from(existing.entries()).filter(([id]) => referenced.has(id)).map(([, card]) => card);

  const incomingCodes = input && input.timecodes && typeof input.timecodes === 'object' ? input.timecodes : {};
  if (Object.keys(incomingCodes).length > 2000) throw Object.assign(new Error('Too many timecodes'), { status: 400 });
  for (const [hash, road] of Object.entries(incomingCodes)) {
    if (!/^[^\u0000-\u001f]{1,200}$/.test(hash) ||
        hash === '__proto__' || hash === 'constructor' || hash === 'prototype' ||
        !road || typeof road !== 'object' || Array.isArray(road)) {
      throw Object.assign(new Error('Invalid timecode'), { status: 400 });
    }
    if (JSON.stringify(road).length > 6000) throw Object.assign(new Error('Timecode too large'), { status: 400 });
    const old = timecodes[hash];
    const newer = !old || Number(road.updated || 0) > Number(old.updated || 0) ||
      (Number(road.updated || 0) === Number(old.updated || 0) && Number(road.percent || 0) > Number(old.percent || 0));
    if (newer) { timecodes[hash] = road; changed = true; }
  }

  user.favorite = favorite;
  user.timecodes = timecodes;
  if (changed) user.revision = (user.revision || 0) + 1;
  user.lastSyncAt = Date.now();
  return changed;
}

async function handle(req, res) {
  const origin = req.headers.origin;
  const allowed = origin && (ALLOWED_ORIGINS.has(origin) || (origin === 'null' && ALLOW_NULL_ORIGIN));
  if (origin && !allowed) return send(res, 403, { error: 'origin_denied' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...(origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      } : {})
    });
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { ok: true }, allowed ? origin : null);
  if (!url.pathname.startsWith('/account/')) return send(res, 404, { error: 'not_found' }, allowed ? origin : null);
  const respond = (status, value) => send(res, status, value, allowed ? origin : null);

  if (url.pathname === '/account/register' && req.method === 'POST') {
    const body = await readBody(req);
    const username = normalizedName(body && body.username);
    if (!validName(username) || !body || !validPassword(body.password)) return respond(400, { error: 'invalid_credentials' });
    if (rateLimited('register:' + req.socket.remoteAddress)) return respond(429, { error: 'rate_limited' });
    if (db.users[username]) return respond(409, { error: 'name_taken' });
    const salt = crypto.randomBytes(16).toString('hex');
    const ownerProof = randomToken();
    const user = {
      id: crypto.randomBytes(16).toString('hex'),
      name: username, salt, passwordHash: hashPassword(body.password, salt),
      ownerHash: tokenHash(ownerProof), createdAt: Date.now(), sessions: {},
      favorite: freshFavorite(), timecodes: {}, revision: 0, lastSyncAt: 0
    };
    const token = makeSession(user, true);
    db.users[username] = user;
    saveDatabase();
    return respond(201, { token, ownerProof, user: publicUser(user, { owner: true }) });
  }

  if (url.pathname === '/account/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = normalizedName(body && body.username);
    if (rateLimited('login:' + req.socket.remoteAddress + ':' + username)) return respond(429, { error: 'rate_limited' });
    const user = db.users[username];
    const salt = user ? user.salt : '00000000000000000000000000000000';
    const actual = hashPassword(body && typeof body.password === 'string' && body.password.length <= 128 ? body.password : '', salt);
    if (!user || !equalHex(actual, user.passwordHash)) return respond(401, { error: 'bad_credentials' });
    const owner = body && typeof body.ownerProof === 'string' && equalHex(tokenHash(body.ownerProof), user.ownerHash);
    const token = makeSession(user, owner);
    saveDatabase();
    return respond(200, { token, user: publicUser(user, { owner }) });
  }

  const auth = authorization(req);
  if (auth.error) return respond(401, { error: auth.error });
  const { user, session, hash } = auth;

  if (url.pathname === '/account/me' && req.method === 'GET') return respond(200, { user: publicUser(user, session) });
  if (url.pathname === '/account/state' && req.method === 'GET') {
    return respond(200, { user: publicUser(user, session), favorite: user.favorite, timecodes: user.timecodes });
  }
  if (url.pathname === '/account/sync' && req.method === 'POST') {
    const body = await readBody(req);
    applyChanges(user, body);
    saveDatabase();
    return respond(200, { user: publicUser(user, session), favorite: user.favorite, timecodes: user.timecodes });
  }
  if (url.pathname === '/account/logout' && req.method === 'POST') {
    delete user.sessions[hash];
    saveDatabase();
    return respond(200, { ok: true });
  }
  if (url.pathname === '/account/logout-others' && req.method === 'POST') {
    if (!session.owner) return respond(403, { error: 'owner_only' });
    let count = 0;
    for (const other of Object.keys(user.sessions)) {
      if (other === hash) continue;
      revokeSession(other, 'owner_logout');
      delete user.sessions[other];
      count++;
    }
    cleanRevoked();
    saveDatabase();
    return respond(200, { ok: true, count });
  }
  if (url.pathname === '/account/delete' && req.method === 'POST') {
    if (!session.owner) return respond(403, { error: 'owner_only' });
    const body = await readBody(req);
    if (!body || !validPassword(body.password) || !equalHex(hashPassword(body.password, user.salt), user.passwordHash)) {
      return respond(401, { error: 'bad_credentials' });
    }
    if (body.changes) applyChanges(user, body.changes);
    for (const other of Object.keys(user.sessions)) revokeSession(other, 'account_deleted');
    const archiveId = crypto.randomBytes(16).toString('hex');
    db.archives[archiveId] = {
      deletedAt: Date.now(),
      favorite: user.favorite,
      timecodes: user.timecodes,
      lastSyncAt: user.lastSyncAt
    };
    delete db.users[user.name];
    cleanRevoked();
    saveDatabase();
    return respond(200, { ok: true, archiveId });
  }
  return respond(404, { error: 'not_found' });
}

http.createServer((req, res) => {
  handle(req, res).catch(error => {
    if (res.headersSent || res.destroyed) return;
    console.error('account request failed:', error.message);
    send(res, error.status || 500, { error: error.status ? 'bad_request' : 'server_error' });
  });
}).listen(PORT, '0.0.0.0', () => console.log('MyLampa account service listening on ' + PORT));
