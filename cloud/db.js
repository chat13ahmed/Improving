/*
 * Database layer for the cloud backend.
 *   • No DATABASE_URL  → SQLite (built-in node:sqlite, a real local .db file, zero install)
 *   • DATABASE_URL set → Postgres (managed cloud DB)
 * Both expose the same small repository API, so server.js doesn't care which is used.
 */
'use strict';
const path = require('path');

let impl = null;

async function init() {
  if (impl) return impl;
  impl = process.env.DATABASE_URL ? pgImpl() : sqliteImpl();
  await impl.ensureSchema();
  return impl;
}

// ── SQLite (local, zero dependencies — requires Node 22.5+) ──
function sqliteImpl() {
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.SQLITE_FILE || path.join(__dirname, 'data.db');
  const db = new DatabaseSync(file);
  try { db.exec('PRAGMA journal_mode = WAL;'); } catch {}
  return {
    kind: 'sqlite',
    async ensureSchema() {
      db.exec(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL,
        sec_question TEXT, sec_salt TEXT, sec_hash TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS user_data (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        sub TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
    },
    async createUser(u) {
      const r = db.prepare('INSERT INTO users(username,pw_salt,pw_hash,sec_question,sec_salt,sec_hash) VALUES(?,?,?,?,?,?)')
        .run(u.username, u.pw_salt, u.pw_hash, u.sec_question, u.sec_salt, u.sec_hash);
      return Number(r.lastInsertRowid);
    },
    async findUserByName(name) { return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name) || null; },
    async findUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null; },
    async updatePassword(id, salt, hash) { db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, hash, id); },
    async setSecurity(id, q, salt, hash) { db.prepare('UPDATE users SET sec_question=?, sec_salt=?, sec_hash=? WHERE id=?').run(q, salt, hash, id); },
    async getData(userId) { const row = db.prepare('SELECT data, version FROM user_data WHERE user_id=?').get(userId); return row ? { data: JSON.parse(row.data), version: row.version } : null; },
    async saveData(userId, dataObj, version) {
      db.prepare(`INSERT INTO user_data(user_id,data,version,updated_at) VALUES(?,?,?,datetime('now'))
                  ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=datetime('now')`)
        .run(userId, JSON.stringify(dataObj), version);
    },
    async savePushSub(userId, sub) {
      db.prepare(`INSERT INTO push_subscriptions(user_id,endpoint,sub) VALUES(?,?,?)
                  ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sub=excluded.sub`)
        .run(userId, sub.endpoint, JSON.stringify(sub));
    },
    async deletePushSub(endpoint) { db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint); },
    async allPushSubs() { return db.prepare('SELECT user_id, sub FROM push_subscriptions').all().map(r => ({ user_id: r.user_id, sub: JSON.parse(r.sub) })); }
  };
}

// ── Postgres (managed cloud DB) ──
function pgImpl() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
  const q = (t, p) => pool.query(t, p);
  return {
    kind: 'postgres',
    async ensureSchema() {
      await q(`CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE,
               pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL, sec_question TEXT, sec_salt TEXT, sec_hash TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS user_data (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
               data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS push_subscriptions (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
               endpoint TEXT UNIQUE NOT NULL, sub JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
    },
    async createUser(u) {
      const r = await q('INSERT INTO users(username,pw_salt,pw_hash,sec_question,sec_salt,sec_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [u.username, u.pw_salt, u.pw_hash, u.sec_question, u.sec_salt, u.sec_hash]);
      return r.rows[0].id;
    },
    async findUserByName(name) { const r = await q('SELECT * FROM users WHERE lower(username)=lower($1)', [name]); return r.rows[0] || null; },
    async findUserById(id) { const r = await q('SELECT * FROM users WHERE id=$1', [id]); return r.rows[0] || null; },
    async updatePassword(id, salt, hash) { await q('UPDATE users SET pw_salt=$1, pw_hash=$2 WHERE id=$3', [salt, hash, id]); },
    async setSecurity(id, ques, salt, hash) { await q('UPDATE users SET sec_question=$1, sec_salt=$2, sec_hash=$3 WHERE id=$4', [ques, salt, hash, id]); },
    async getData(userId) { const r = await q('SELECT data, version FROM user_data WHERE user_id=$1', [userId]); return r.rowCount ? { data: r.rows[0].data, version: r.rows[0].version } : null; },
    async saveData(userId, dataObj, version) {
      await q(`INSERT INTO user_data(user_id,data,version,updated_at) VALUES($1,$2,$3,now())
               ON CONFLICT(user_id) DO UPDATE SET data=$2, version=$3, updated_at=now()`, [userId, JSON.stringify(dataObj), version]);
    },
    async savePushSub(userId, sub) {
      await q(`INSERT INTO push_subscriptions(user_id,endpoint,sub) VALUES($1,$2,$3)
               ON CONFLICT(endpoint) DO UPDATE SET user_id=$1, sub=$3`, [userId, sub.endpoint, JSON.stringify(sub)]);
    },
    async deletePushSub(endpoint) { await q('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]); },
    async allPushSubs() { const r = await q('SELECT user_id, sub FROM push_subscriptions', []); return r.rows.map(x => ({ user_id: x.user_id, sub: x.sub })); }
  };
}

module.exports = {
  init,
  kind: () => (impl ? impl.kind : 'uninitialized'),
  createUser: (u) => impl.createUser(u),
  findUserByName: (n) => impl.findUserByName(n),
  findUserById: (i) => impl.findUserById(i),
  updatePassword: (i, s, h) => impl.updatePassword(i, s, h),
  setSecurity: (i, q, s, h) => impl.setSecurity(i, q, s, h),
  getData: (i) => impl.getData(i),
  saveData: (i, d, v) => impl.saveData(i, d, v),
  savePushSub: (i, s) => impl.savePushSub(i, s),
  deletePushSub: (e) => impl.deletePushSub(e),
  allPushSubs: () => impl.allPushSubs()
};
