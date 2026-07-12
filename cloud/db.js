/*
 * Database layer for the cloud backend.
 *   • No DATABASE_URL  → SQLite (built-in node:sqlite, a real local .db file, zero install)
 *   • DATABASE_URL set → Postgres (managed cloud DB)
 * Both expose the same small repository API, so server.js doesn't care which is used.
 */
'use strict';
const path = require('path');
const ENC = require('./crypto');   // at-rest encryption of the user data blob

let impl = null;
// Parse a JSON array column safely (ingredients); always returns an array.
function safeJsonArray(s) {
  if (Array.isArray(s)) return s;
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
// Parse a JSON object column safely (post `data`); always returns an object.
function safeJsonObject(s) {
  if (s && typeof s === 'object' && !Array.isArray(s)) return s;
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

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
        phone TEXT,
        pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL,
        sec_question TEXT, sec_salt TEXT, sec_hash TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      try { db.exec('ALTER TABLE users ADD COLUMN phone TEXT'); } catch {} // migrate older DBs
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
      db.exec(`CREATE TABLE IF NOT EXISTS shared_meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        author_name TEXT, name TEXT NOT NULL,
        kcal REAL DEFAULT 0, p REAL DEFAULT 0, c REAL DEFAULT 0, f REAL DEFAULT 0,
        servings INTEGER DEFAULT 1, notes TEXT, ingredients TEXT, photo TEXT,
        uses INTEGER DEFAULT 0, flags INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      try { db.exec('ALTER TABLE shared_meals ADD COLUMN ingredients TEXT'); } catch {} // migrate older DBs
      try { db.exec('ALTER TABLE shared_meals ADD COLUMN photo TEXT'); } catch {}
      db.exec(`CREATE TABLE IF NOT EXISTS community_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        author_name TEXT, type TEXT NOT NULL, title TEXT, body TEXT,
        data TEXT DEFAULT '{}', likes TEXT DEFAULT '[]', flags INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      // ── Collective-knowledge social layer (groups, notes, likes, replies, flags, notifications) ──
      db.exec(`CREATE TABLE IF NOT EXISTS reading_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        invite_code TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER REFERENCES reading_groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member', notify_enabled INTEGER NOT NULL DEFAULT 1,
        joined_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (group_id, user_id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, author_name TEXT,
        group_id INTEGER REFERENCES reading_groups(id) ON DELETE CASCADE, book_id INTEGER,
        page INTEGER, quote TEXT, body TEXT NOT NULL,
        confusion_count INTEGER NOT NULL DEFAULT 0, needs_clarification INTEGER NOT NULL DEFAULT 0,
        upvote_count INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS note_likes (
        note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (note_id, user_id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS note_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES note_replies(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, author_name TEXT, body TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS note_confusions (
        note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (note_id, user_id)
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, group_id INTEGER,
        read_at TEXT, created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_notes_group ON notes(group_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_replies_note ON note_replies(note_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at)');
    },
    async createUser(u) {
      const r = db.prepare('INSERT INTO users(username,email,phone,pw_salt,pw_hash,sec_question,sec_salt,sec_hash) VALUES(?,?,?,?,?,?,?,?)')
        .run(u.username, u.email || null, u.phone || null, u.pw_salt, u.pw_hash, u.sec_question, u.sec_salt, u.sec_hash);
      return Number(r.lastInsertRowid);
    },
    async findUserByName(name) { return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name) || null; },
    async findUserByEmail(email) { return email ? (db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) || null) : null; },
    async findUserByPhone(phone) { return phone ? (db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) || null) : null; },
    async findUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null; },
    async updatePassword(id, salt, hash) { db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, hash, id); },
    async setSecurity(id, q, salt, hash) { db.prepare('UPDATE users SET sec_question=?, sec_salt=?, sec_hash=? WHERE id=?').run(q, salt, hash, id); },
    async getData(userId) { const row = db.prepare('SELECT data, version FROM user_data WHERE user_id=?').get(userId); return row ? { data: ENC.decryptData(JSON.parse(row.data)), version: row.version } : null; },
    async saveData(userId, dataObj, version) {
      db.prepare(`INSERT INTO user_data(user_id,data,version,updated_at) VALUES(?,?,?,datetime('now'))
                  ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=datetime('now')`)
        .run(userId, JSON.stringify(ENC.encryptData(dataObj)), version);
    },
    // Server-side metadata write (e.g. cron _lastNudge): update only if the version
    // is unchanged, and do NOT bump it — so it never clobbers a client save or
    // invalidates a client's version. Returns true if it wrote.
    async saveDataMeta(userId, dataObj, expectedVersion) {
      const r = db.prepare(`UPDATE user_data SET data=?, updated_at=datetime('now') WHERE user_id=? AND version=?`)
        .run(JSON.stringify(ENC.encryptData(dataObj)), userId, expectedVersion);
      return r.changes > 0;
    },
    async savePushSub(userId, sub) {
      db.prepare(`INSERT INTO push_subscriptions(user_id,endpoint,sub) VALUES(?,?,?)
                  ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sub=excluded.sub`)
        .run(userId, sub.endpoint, JSON.stringify(sub));
    },
    async deletePushSub(endpoint) { db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint); },
    async allPushSubs() { return db.prepare('SELECT user_id, sub FROM push_subscriptions').all().map(r => ({ user_id: r.user_id, sub: JSON.parse(r.sub) })); },
    async allUsers() { return db.prepare('SELECT id, username, created_at FROM users').all(); },
    async allUserData() { return db.prepare('SELECT user_id, data FROM user_data').all().map(r => ({ user_id: r.user_id, data: ENC.decryptData(JSON.parse(r.data)) })); },
    // ── Community meals ──
    async createSharedMeal(m) {
      const r = db.prepare('INSERT INTO shared_meals(user_id,author_name,name,kcal,p,c,f,servings,notes,ingredients,photo) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(m.user_id, m.author_name || null, m.name, m.kcal || 0, m.p || 0, m.c || 0, m.f || 0, m.servings || 1, m.notes || null, JSON.stringify(m.ingredients || []), m.photo || null);
      return Number(r.lastInsertRowid);
    },
    async listSharedMeals(qstr) {
      const ql = (qstr || '').toLowerCase();
      return db.prepare(`SELECT id,user_id,author_name,name,kcal,p,c,f,servings,notes,ingredients,photo,uses,flags,created_at
        FROM shared_meals WHERE flags < 5 AND (? = '' OR lower(name) LIKE ?)
        ORDER BY uses DESC, id DESC LIMIT 120`).all(ql, '%' + ql + '%')
        .map(r => ({ ...r, ingredients: safeJsonArray(r.ingredients) }));
    },
    async incSharedMealUse(id) { db.prepare('UPDATE shared_meals SET uses = uses + 1 WHERE id=?').run(id); },
    async flagSharedMeal(id) { db.prepare('UPDATE shared_meals SET flags = flags + 1 WHERE id=?').run(id); },
    async deleteSharedMeal(id, userId, force) {
      const r = force ? db.prepare('DELETE FROM shared_meals WHERE id=?').run(id)
                      : db.prepare('DELETE FROM shared_meals WHERE id=? AND user_id=?').run(id, userId);
      return r.changes > 0;
    },
    // ── Community posts (thoughts / training programs / meals) ──
    async createPost(p) {
      const r = db.prepare('INSERT INTO community_posts(user_id,author_name,type,title,body,data,likes) VALUES(?,?,?,?,?,?,?)')
        .run(p.user_id, p.author_name || null, p.type, p.title || null, p.body || null, JSON.stringify(p.data || {}), '[]');
      return Number(r.lastInsertRowid);
    },
    async listPosts(type) {
      const t = (type || '').toLowerCase();
      return db.prepare(`SELECT id,user_id,author_name,type,title,body,data,likes,flags,created_at
        FROM community_posts WHERE flags < 5 AND (? = '' OR type = ?)
        ORDER BY id DESC LIMIT 100`).all(t, t)
        .map(r => ({ ...r, data: safeJsonObject(r.data), likes: safeJsonArray(r.likes) }));
    },
    async togglePostLike(id, userId) {
      const row = db.prepare('SELECT likes FROM community_posts WHERE id=?').get(id);
      if (!row) return null;
      const uid = String(userId);
      const likes = safeJsonArray(row.likes).map(String);
      const i = likes.indexOf(uid);
      if (i >= 0) likes.splice(i, 1); else likes.push(uid);
      db.prepare('UPDATE community_posts SET likes=? WHERE id=?').run(JSON.stringify(likes), id);
      return { liked: i < 0, count: likes.length };
    },
    async flagPost(id) { db.prepare('UPDATE community_posts SET flags = flags + 1 WHERE id=?').run(id); },
    async deletePost(id, userId, force) {
      const r = force ? db.prepare('DELETE FROM community_posts WHERE id=?').run(id)
                      : db.prepare('DELETE FROM community_posts WHERE id=? AND user_id=?').run(id, userId);
      return r.changes > 0;
    },
    // ── Groups + collective notes (social layer) ──
    async createGroup(g) {
      db.exec('BEGIN');
      try {
        const r = db.prepare('INSERT INTO reading_groups(name,owner_id,invite_code) VALUES(?,?,?)').run(g.name, g.owner_id, g.invite_code || null);
        const id = Number(r.lastInsertRowid);
        db.prepare("INSERT OR IGNORE INTO group_members(group_id,user_id,role) VALUES(?,?, 'owner')").run(id, g.owner_id);
        db.exec('COMMIT');
        return id;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async addGroupMember(groupId, userId, role) { db.prepare('INSERT OR IGNORE INTO group_members(group_id,user_id,role) VALUES(?,?,?)').run(groupId, userId, role || 'member'); },
    async getMembership(groupId, userId) { return db.prepare('SELECT group_id,user_id,role,notify_enabled FROM group_members WHERE group_id=? AND user_id=?').get(groupId, userId) || null; },
    async groupMembers(groupId) { return db.prepare('SELECT user_id, role, notify_enabled FROM group_members WHERE group_id=?').all(groupId); },
    async setNotifyEnabled(groupId, userId, enabled) { db.prepare('UPDATE group_members SET notify_enabled=? WHERE group_id=? AND user_id=?').run(enabled ? 1 : 0, groupId, userId); },
    async createNote(n) {
      const r = db.prepare('INSERT INTO notes(user_id,author_name,group_id,book_id,page,quote,body) VALUES(?,?,?,?,?,?,?)')
        .run(n.user_id, n.author_name || null, n.group_id || null, n.book_id || null, n.page ?? null, n.quote || null, n.body);
      return Number(r.lastInsertRowid);
    },
    async getNote(id) { return db.prepare('SELECT * FROM notes WHERE id=?').get(id) || null; },
    async listGroupNotes(groupId) {
      return db.prepare(`SELECT id,user_id,author_name,book_id,page,quote,body,upvote_count,confusion_count,needs_clarification,created_at
        FROM notes WHERE group_id=? ORDER BY id DESC LIMIT 200`).all(groupId);
    },
    async toggleNoteLike(noteId, userId) {
      db.exec('BEGIN');
      try {
        const exists = db.prepare('SELECT 1 FROM note_likes WHERE note_id=? AND user_id=?').get(noteId, userId);
        if (exists) db.prepare('DELETE FROM note_likes WHERE note_id=? AND user_id=?').run(noteId, userId);
        else db.prepare('INSERT INTO note_likes(note_id,user_id) VALUES(?,?)').run(noteId, userId);
        const count = db.prepare('SELECT count(*) AS n FROM note_likes WHERE note_id=?').get(noteId).n;
        db.prepare('UPDATE notes SET upvote_count=? WHERE id=?').run(count, noteId);
        db.exec('COMMIT');
        return { liked: !exists, count };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async createReply(r0) {
      const r = db.prepare('INSERT INTO note_replies(note_id,parent_id,user_id,author_name,body) VALUES(?,?,?,?,?)')
        .run(r0.note_id, r0.parent_id || null, r0.user_id, r0.author_name || null, r0.body);
      return Number(r.lastInsertRowid);
    },
    async listReplies(noteId) { return db.prepare('SELECT id,note_id,parent_id,user_id,author_name,body,created_at FROM note_replies WHERE note_id=? ORDER BY id ASC').all(noteId); },
    // Idempotent confusion flag → distinct-user count → trip needs_clarification once at 3.
    async confuseNote(noteId, userId) {
      db.exec('BEGIN');
      try {
        db.prepare('INSERT OR IGNORE INTO note_confusions(note_id,user_id) VALUES(?,?)').run(noteId, userId);
        const count = db.prepare('SELECT count(*) AS n FROM note_confusions WHERE note_id=?').get(noteId).n;
        const cur = db.prepare('SELECT needs_clarification, group_id FROM notes WHERE id=?').get(noteId);
        if (!cur) { db.exec('ROLLBACK'); return null; }
        let tripped = false;
        if (count >= 3 && !cur.needs_clarification) { db.prepare('UPDATE notes SET confusion_count=?, needs_clarification=1 WHERE id=?').run(count, noteId); tripped = true; }
        else { db.prepare('UPDATE notes SET confusion_count=? WHERE id=?').run(count, noteId); }
        db.exec('COMMIT');
        return { count, tripped, groupId: cur.group_id };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async createNotifications(rows) {
      const stmt = db.prepare('INSERT INTO notifications(user_id,type,title,body,link,group_id) VALUES(?,?,?,?,?,?)');
      for (const n of rows) stmt.run(n.user_id, n.type, n.title, n.body || null, n.link || null, n.group_id || null);
    },
    async listNotifications(userId, limit) {
      return db.prepare(`SELECT id,type,title,body,link,group_id,read_at,created_at FROM notifications
        WHERE user_id=? ORDER BY (read_at IS NULL) DESC, id DESC LIMIT ?`).all(userId, limit || 30);
    },
    async unreadCount(userId) { return db.prepare('SELECT count(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL').get(userId).n; },
    async markNotificationsRead(userId, ids) {
      if (ids && ids.length) db.prepare(`UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`).run(userId, ...ids);
      else db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL").run(userId);
    }
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
      await q(`CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE, phone TEXT,
               pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL, sec_question TEXT, sec_salt TEXT, sec_hash TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT'); // migrate older DBs
      await q(`CREATE TABLE IF NOT EXISTS user_data (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
               data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS push_subscriptions (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
               endpoint TEXT UNIQUE NOT NULL, sub JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS shared_meals (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
               author_name TEXT, name TEXT NOT NULL, kcal REAL DEFAULT 0, p REAL DEFAULT 0, c REAL DEFAULT 0, f REAL DEFAULT 0,
               servings INTEGER DEFAULT 1, notes TEXT, ingredients TEXT, photo TEXT, uses INTEGER DEFAULT 0, flags INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now())`);
      await q('ALTER TABLE shared_meals ADD COLUMN IF NOT EXISTS ingredients TEXT'); // migrate older DBs
      await q('ALTER TABLE shared_meals ADD COLUMN IF NOT EXISTS photo TEXT');
      await q(`CREATE TABLE IF NOT EXISTS community_posts (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
               author_name TEXT, type TEXT NOT NULL, title TEXT, body TEXT, data TEXT DEFAULT '{}', likes TEXT DEFAULT '[]', flags INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now())`);
      // ── Collective-knowledge social layer ──
      await q(`CREATE TABLE IF NOT EXISTS reading_groups (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL,
               owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE, invite_code TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS group_members (group_id BIGINT REFERENCES reading_groups(id) ON DELETE CASCADE,
               user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member',
               notify_enabled BOOLEAN NOT NULL DEFAULT TRUE, joined_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (group_id, user_id))`);
      await q(`CREATE TABLE IF NOT EXISTS notes (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
               author_name TEXT, group_id BIGINT REFERENCES reading_groups(id) ON DELETE CASCADE, book_id BIGINT,
               page INTEGER, quote TEXT, body TEXT NOT NULL, confusion_count INTEGER NOT NULL DEFAULT 0,
               needs_clarification BOOLEAN NOT NULL DEFAULT FALSE, upvote_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS note_likes (note_id BIGINT REFERENCES notes(id) ON DELETE CASCADE,
               user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (note_id, user_id))`);
      await q(`CREATE TABLE IF NOT EXISTS note_replies (id BIGSERIAL PRIMARY KEY, note_id BIGINT REFERENCES notes(id) ON DELETE CASCADE,
               parent_id BIGINT REFERENCES note_replies(id) ON DELETE CASCADE, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
               author_name TEXT, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS note_confusions (note_id BIGINT REFERENCES notes(id) ON DELETE CASCADE,
               user_id BIGINT REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (note_id, user_id))`);
      await q(`CREATE TABLE IF NOT EXISTS notifications (id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
               type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, group_id BIGINT, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())`);
      await q('CREATE INDEX IF NOT EXISTS idx_notes_group ON notes(group_id)');
      await q('CREATE INDEX IF NOT EXISTS idx_replies_note ON note_replies(note_id)');
      await q('CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at)');
    },
    async createUser(u) {
      const r = await q('INSERT INTO users(username,email,phone,pw_salt,pw_hash,sec_question,sec_salt,sec_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [u.username, u.email || null, u.phone || null, u.pw_salt, u.pw_hash, u.sec_question, u.sec_salt, u.sec_hash]);
      return r.rows[0].id;
    },
    async findUserByName(name) { const r = await q('SELECT * FROM users WHERE lower(username)=lower($1)', [name]); return r.rows[0] || null; },
    async findUserByEmail(email) { if (!email) return null; const r = await q('SELECT * FROM users WHERE lower(email)=lower($1)', [email]); return r.rows[0] || null; },
    async findUserByPhone(phone) { if (!phone) return null; const r = await q('SELECT * FROM users WHERE phone=$1', [phone]); return r.rows[0] || null; },
    async findUserById(id) { const r = await q('SELECT * FROM users WHERE id=$1', [id]); return r.rows[0] || null; },
    async updatePassword(id, salt, hash) { await q('UPDATE users SET pw_salt=$1, pw_hash=$2 WHERE id=$3', [salt, hash, id]); },
    async setSecurity(id, ques, salt, hash) { await q('UPDATE users SET sec_question=$1, sec_salt=$2, sec_hash=$3 WHERE id=$4', [ques, salt, hash, id]); },
    async getData(userId) { const r = await q('SELECT data, version FROM user_data WHERE user_id=$1', [userId]); return r.rowCount ? { data: ENC.decryptData(r.rows[0].data), version: r.rows[0].version } : null; },
    async saveData(userId, dataObj, version) {
      await q(`INSERT INTO user_data(user_id,data,version,updated_at) VALUES($1,$2,$3,now())
               ON CONFLICT(user_id) DO UPDATE SET data=$2, version=$3, updated_at=now()`, [userId, JSON.stringify(ENC.encryptData(dataObj)), version]);
    },
    async saveDataMeta(userId, dataObj, expectedVersion) {
      const r = await q('UPDATE user_data SET data=$1, updated_at=now() WHERE user_id=$2 AND version=$3', [JSON.stringify(ENC.encryptData(dataObj)), userId, expectedVersion]);
      return r.rowCount > 0;
    },
    async savePushSub(userId, sub) {
      await q(`INSERT INTO push_subscriptions(user_id,endpoint,sub) VALUES($1,$2,$3)
               ON CONFLICT(endpoint) DO UPDATE SET user_id=$1, sub=$3`, [userId, sub.endpoint, JSON.stringify(sub)]);
    },
    async deletePushSub(endpoint) { await q('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]); },
    async allPushSubs() { const r = await q('SELECT user_id, sub FROM push_subscriptions', []); return r.rows.map(x => ({ user_id: x.user_id, sub: x.sub })); },
    async allUsers() { const r = await q('SELECT id, username, created_at FROM users', []); return r.rows; },
    async allUserData() { const r = await q('SELECT user_id, data FROM user_data', []); return r.rows.map(x => ({ user_id: x.user_id, data: ENC.decryptData(x.data) })); },
    // ── Community meals ──
    async createSharedMeal(m) {
      const r = await q('INSERT INTO shared_meals(user_id,author_name,name,kcal,p,c,f,servings,notes,ingredients,photo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
        [m.user_id, m.author_name || null, m.name, m.kcal || 0, m.p || 0, m.c || 0, m.f || 0, m.servings || 1, m.notes || null, JSON.stringify(m.ingredients || []), m.photo || null]);
      return r.rows[0].id;
    },
    async listSharedMeals(qstr) {
      const ql = (qstr || '').toLowerCase();
      const r = await q(`SELECT id,user_id,author_name,name,kcal,p,c,f,servings,notes,ingredients,photo,uses,flags,created_at
        FROM shared_meals WHERE flags < 5 AND ($1 = '' OR lower(name) LIKE $2)
        ORDER BY uses DESC, id DESC LIMIT 120`, [ql, '%' + ql + '%']);
      return r.rows.map(x => ({ ...x, ingredients: safeJsonArray(x.ingredients) }));
    },
    async incSharedMealUse(id) { await q('UPDATE shared_meals SET uses = uses + 1 WHERE id=$1', [id]); },
    async flagSharedMeal(id) { await q('UPDATE shared_meals SET flags = flags + 1 WHERE id=$1', [id]); },
    async deleteSharedMeal(id, userId, force) {
      const r = force ? await q('DELETE FROM shared_meals WHERE id=$1', [id])
                      : await q('DELETE FROM shared_meals WHERE id=$1 AND user_id=$2', [id, userId]);
      return r.rowCount > 0;
    },
    // ── Community posts (thoughts / training programs / meals) ──
    async createPost(p) {
      const r = await q('INSERT INTO community_posts(user_id,author_name,type,title,body,data,likes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [p.user_id, p.author_name || null, p.type, p.title || null, p.body || null, JSON.stringify(p.data || {}), '[]']);
      return r.rows[0].id;
    },
    async listPosts(type) {
      const t = (type || '').toLowerCase();
      const r = await q(`SELECT id,user_id,author_name,type,title,body,data,likes,flags,created_at
        FROM community_posts WHERE flags < 5 AND ($1 = '' OR type = $1)
        ORDER BY id DESC LIMIT 100`, [t]);
      return r.rows.map(x => ({ ...x, data: safeJsonObject(x.data), likes: safeJsonArray(x.likes) }));
    },
    async togglePostLike(id, userId) {
      const r0 = await q('SELECT likes FROM community_posts WHERE id=$1', [id]);
      if (!r0.rowCount) return null;
      const uid = String(userId);
      const likes = safeJsonArray(r0.rows[0].likes).map(String);
      const i = likes.indexOf(uid);
      if (i >= 0) likes.splice(i, 1); else likes.push(uid);
      await q('UPDATE community_posts SET likes=$1 WHERE id=$2', [JSON.stringify(likes), id]);
      return { liked: i < 0, count: likes.length };
    },
    async flagPost(id) { await q('UPDATE community_posts SET flags = flags + 1 WHERE id=$1', [id]); },
    async deletePost(id, userId, force) {
      const r = force ? await q('DELETE FROM community_posts WHERE id=$1', [id])
                      : await q('DELETE FROM community_posts WHERE id=$1 AND user_id=$2', [id, userId]);
      return r.rowCount > 0;
    },
    // ── Groups + collective notes (social layer) ──
    async createGroup(g) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query('INSERT INTO reading_groups(name,owner_id,invite_code) VALUES($1,$2,$3) RETURNING id', [g.name, g.owner_id, g.invite_code || null]);
        const id = r.rows[0].id;
        await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING", [id, g.owner_id]);
        await client.query('COMMIT');
        return id;
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    },
    async addGroupMember(groupId, userId, role) { await q("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [groupId, userId, role || 'member']); },
    async getMembership(groupId, userId) { const r = await q('SELECT group_id,user_id,role,notify_enabled FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]); return r.rows[0] || null; },
    async groupMembers(groupId) { const r = await q('SELECT user_id, role, notify_enabled FROM group_members WHERE group_id=$1', [groupId]); return r.rows; },
    async setNotifyEnabled(groupId, userId, enabled) { await q('UPDATE group_members SET notify_enabled=$1 WHERE group_id=$2 AND user_id=$3', [!!enabled, groupId, userId]); },
    async createNote(n) {
      const r = await q('INSERT INTO notes(user_id,author_name,group_id,book_id,page,quote,body) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [n.user_id, n.author_name || null, n.group_id || null, n.book_id || null, n.page ?? null, n.quote || null, n.body]);
      return r.rows[0].id;
    },
    async getNote(id) { const r = await q('SELECT * FROM notes WHERE id=$1', [id]); return r.rows[0] || null; },
    async listGroupNotes(groupId) {
      const r = await q(`SELECT id,user_id,author_name,book_id,page,quote,body,upvote_count,confusion_count,needs_clarification,created_at
        FROM notes WHERE group_id=$1 ORDER BY id DESC LIMIT 200`, [groupId]);
      return r.rows;
    },
    async toggleNoteLike(noteId, userId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ex = await client.query('SELECT 1 FROM note_likes WHERE note_id=$1 AND user_id=$2', [noteId, userId]);
        if (ex.rowCount) await client.query('DELETE FROM note_likes WHERE note_id=$1 AND user_id=$2', [noteId, userId]);
        else await client.query('INSERT INTO note_likes(note_id,user_id) VALUES($1,$2)', [noteId, userId]);
        const c = await client.query('SELECT count(*)::int AS n FROM note_likes WHERE note_id=$1', [noteId]);
        await client.query('UPDATE notes SET upvote_count=$1 WHERE id=$2', [c.rows[0].n, noteId]);
        await client.query('COMMIT');
        return { liked: !ex.rowCount, count: c.rows[0].n };
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    },
    async createReply(r0) {
      const r = await q('INSERT INTO note_replies(note_id,parent_id,user_id,author_name,body) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [r0.note_id, r0.parent_id || null, r0.user_id, r0.author_name || null, r0.body]);
      return r.rows[0].id;
    },
    async listReplies(noteId) { const r = await q('SELECT id,note_id,parent_id,user_id,author_name,body,created_at FROM note_replies WHERE note_id=$1 ORDER BY id ASC', [noteId]); return r.rows; },
    async confuseNote(noteId, userId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO note_confusions(note_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [noteId, userId]);
        const c = await client.query('SELECT count(*)::int AS n FROM note_confusions WHERE note_id=$1', [noteId]);
        const cur = await client.query('SELECT needs_clarification, group_id FROM notes WHERE id=$1', [noteId]);
        if (!cur.rowCount) { await client.query('ROLLBACK'); return null; }
        const count = c.rows[0].n; let tripped = false;
        if (count >= 3 && !cur.rows[0].needs_clarification) { await client.query('UPDATE notes SET confusion_count=$1, needs_clarification=TRUE WHERE id=$2', [count, noteId]); tripped = true; }
        else { await client.query('UPDATE notes SET confusion_count=$1 WHERE id=$2', [count, noteId]); }
        await client.query('COMMIT');
        return { count, tripped, groupId: cur.rows[0].group_id };
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    },
    async createNotifications(rows) {
      for (const n of rows) await q('INSERT INTO notifications(user_id,type,title,body,link,group_id) VALUES($1,$2,$3,$4,$5,$6)', [n.user_id, n.type, n.title, n.body || null, n.link || null, n.group_id || null]);
    },
    async listNotifications(userId, limit) {
      const r = await q(`SELECT id,type,title,body,link,group_id,read_at,created_at FROM notifications
        WHERE user_id=$1 ORDER BY (read_at IS NULL) DESC, id DESC LIMIT $2`, [userId, limit || 30]);
      return r.rows;
    },
    async unreadCount(userId) { const r = await q('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [userId]); return r.rows[0].n; },
    async markNotificationsRead(userId, ids) {
      if (ids && ids.length) await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2::bigint[])', [userId, ids]);
      else await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [userId]);
    }
  };
}

module.exports = {
  init,
  kind: () => (impl ? impl.kind : 'uninitialized'),
  createUser: (u) => impl.createUser(u),
  findUserByName: (n) => impl.findUserByName(n),
  findUserByEmail: (e) => impl.findUserByEmail(e),
  findUserByPhone: (p) => impl.findUserByPhone(p),
  findUserById: (i) => impl.findUserById(i),
  updatePassword: (i, s, h) => impl.updatePassword(i, s, h),
  setSecurity: (i, q, s, h) => impl.setSecurity(i, q, s, h),
  getData: (i) => impl.getData(i),
  saveData: (i, d, v) => impl.saveData(i, d, v),
  saveDataMeta: (i, d, v) => impl.saveDataMeta(i, d, v),
  savePushSub: (i, s) => impl.savePushSub(i, s),
  deletePushSub: (e) => impl.deletePushSub(e),
  allPushSubs: () => impl.allPushSubs(),
  allUsers: () => impl.allUsers(),
  allUserData: () => impl.allUserData(),
  createSharedMeal: (m) => impl.createSharedMeal(m),
  listSharedMeals: (q) => impl.listSharedMeals(q),
  incSharedMealUse: (i) => impl.incSharedMealUse(i),
  flagSharedMeal: (i) => impl.flagSharedMeal(i),
  deleteSharedMeal: (i, u, f) => impl.deleteSharedMeal(i, u, f),
  createPost: (p) => impl.createPost(p),
  listPosts: (t) => impl.listPosts(t),
  togglePostLike: (i, u) => impl.togglePostLike(i, u),
  flagPost: (i) => impl.flagPost(i),
  deletePost: (i, u, f) => impl.deletePost(i, u, f),
  // ── Groups + collective notes (social layer) ──
  createGroup: (g) => impl.createGroup(g),
  addGroupMember: (g, u, r) => impl.addGroupMember(g, u, r),
  getMembership: (g, u) => impl.getMembership(g, u),
  groupMembers: (g) => impl.groupMembers(g),
  setNotifyEnabled: (g, u, e) => impl.setNotifyEnabled(g, u, e),
  createNote: (n) => impl.createNote(n),
  getNote: (i) => impl.getNote(i),
  listGroupNotes: (g) => impl.listGroupNotes(g),
  toggleNoteLike: (i, u) => impl.toggleNoteLike(i, u),
  createReply: (r) => impl.createReply(r),
  listReplies: (i) => impl.listReplies(i),
  confuseNote: (i, u) => impl.confuseNote(i, u),
  createNotifications: (rows) => impl.createNotifications(rows),
  listNotifications: (u, l) => impl.listNotifications(u, l),
  unreadCount: (u) => impl.unreadCount(u),
  markNotificationsRead: (u, ids) => impl.markNotificationsRead(u, ids)
};
