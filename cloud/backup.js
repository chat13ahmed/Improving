#!/usr/bin/env node
/* Onward — logical backup / restore.
 *
 *   node cloud/backup.js dump  > backup.json
 *   node cloud/backup.js restore backup.json          (refuses to clobber data)
 *   node cloud/backup.js restore backup.json --force  (wipes, then restores)
 *
 * Why this exists: Render's FREE Postgres has no backups and no recovery — and
 * it is deleted 30 days after creation (+14 days' grace). A paid tier's
 * point-in-time recovery is the real safety net; this is the zero-install
 * fallback, and it runs on Windows without the PostgreSQL client tools.
 *
 * Rows are copied VERBATIM, so `user_data.data` stays encrypted exactly as
 * stored. That means the dump is only readable by a server holding the same
 * DATA_ENCRYPTION_KEY — keep that key safe and separate, or the backup is junk.
 *
 * Engine follows the app: DATABASE_URL → Postgres, otherwise local SQLite.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Parent tables first: restore inserts in this order so foreign keys resolve,
// and deletes in reverse so children go before their parents.
const TABLES = [
  'users', 'user_data', 'push_subscriptions', 'shared_meals', 'community_posts',
  'reading_groups', 'group_members', 'notes', 'note_replies', 'note_likes',
  'note_confusions', 'notifications'
];

async function openEngine() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const ssl = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) || process.env.PGSSL === 'off'
      ? false : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
    return {
      kind: 'postgres',
      all: async (sql) => (await pool.query(sql)).rows,
      run: async (sql, params) => { await pool.query(sql, params); },
      ph: (i) => '$' + i,
      quote: (id) => '"' + id + '"',
      close: () => pool.end()
    };
  }
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.SQLITE_FILE || path.join(__dirname, 'data.db');
  const db = new DatabaseSync(file);
  return {
    kind: 'sqlite (' + file + ')',
    all: async (sql) => db.prepare(sql).all(),
    run: async (sql, params) => { db.prepare(sql).run(...(params || [])); },
    ph: () => '?',
    quote: (id) => '"' + id + '"',
    close: () => db.close()
  };
}

// A table may not exist yet on an older deploy — skip it rather than abort the
// whole backup, but say so on stderr so the omission is never silent.
async function dump(eng) {
  const out = { onwardBackup: 1, engine: eng.kind, takenAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    try {
      out.tables[t] = await eng.all('SELECT * FROM ' + eng.quote(t));
    } catch (e) {
      out.tables[t] = null;
      process.stderr.write('skipped ' + t + ' (' + (e.message || 'unreadable') + ')\n');
    }
  }
  const counts = TABLES.map(t => t + '=' + (out.tables[t] ? out.tables[t].length : 'n/a')).join(' ');
  process.stderr.write('dumped from ' + eng.kind + ': ' + counts + '\n');
  return out;
}

async function restore(eng, file, force) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || raw.onwardBackup !== 1 || !raw.tables) throw new Error('not an Onward backup file');

  // Never silently overwrite a live database.
  let existing = 0;
  for (const t of TABLES) {
    try { existing += (await eng.all('SELECT COUNT(*) AS n FROM ' + eng.quote(t)))[0].n | 0; } catch (e) {}
  }
  if (existing > 0 && !force) {
    throw new Error('target already holds ' + existing + ' rows — re-run with --force to wipe and restore');
  }
  if (existing > 0) {
    for (const t of TABLES.slice().reverse()) {
      try { await eng.run('DELETE FROM ' + eng.quote(t)); } catch (e) {}
    }
  }

  let total = 0;
  for (const t of TABLES) {
    const rows = raw.tables[t];
    if (!Array.isArray(rows) || !rows.length) continue;
    for (const row of rows) {
      const cols = Object.keys(row);
      const sql = 'INSERT INTO ' + eng.quote(t) + ' (' + cols.map(eng.quote).join(',') + ') VALUES (' +
        cols.map((_, i) => eng.ph(i + 1)).join(',') + ')';
      // SQLite's driver rejects undefined/objects; JSON columns arrive as objects
      // from Postgres, so normalise both engines to a storable scalar.
      const vals = cols.map(c => {
        const v = row[c];
        if (v === undefined) return null;
        if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'boolean') return v ? 1 : 0;
        return v;
      });
      await eng.run(sql, vals);
      total++;
    }
  }
  process.stderr.write('restored ' + total + ' rows into ' + eng.kind + '\n');
  return total;
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  const eng = await openEngine();
  try {
    if (cmd === 'dump') {
      process.stdout.write(JSON.stringify(await dump(eng), null, 2) + '\n');
    } else if (cmd === 'restore') {
      if (!arg) throw new Error('usage: node cloud/backup.js restore <file.json> [--force]');
      await restore(eng, arg, process.argv.includes('--force'));
    } else {
      process.stderr.write('usage: node cloud/backup.js dump > backup.json\n' +
                           '       node cloud/backup.js restore backup.json [--force]\n');
      process.exitCode = 2;
    }
  } catch (e) {
    process.stderr.write('FAILED: ' + (e.message || e) + '\n');
    process.exitCode = 1;
  } finally {
    await eng.close();
  }
})();
