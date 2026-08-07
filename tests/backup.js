/* Round-trip test for cloud/backup.js: seed → dump → wipe → restore → compare.
 *
 * An untested backup tool is worse than none — it buys false confidence. This
 * runs against a throwaway SQLite file with encryption ON, so it also proves the
 * dump keeps `user_data.data` as ciphertext and that it still decrypts with the
 * same DATA_ENCRYPTION_KEY after a restore.
 *
 *   node tests/backup.js
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const DB_PATH = path.join(APP, 'cloud', 'db.js').replace(/\\/g, '/');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onward-bk-'));
const dbFile = path.join(tmp, 'test.db');
const dumpFile = path.join(tmp, 'backup.json');

const env = Object.assign({}, process.env, {
  SQLITE_FILE: dbFile,
  DATA_ENCRYPTION_KEY: 'a'.repeat(64)   // 32 bytes of hex
});
delete env.DATABASE_URL;                // force the SQLite path

const node = (args) => execFileSync(process.execPath, args, {
  cwd: APP, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
});
const lastJson = (s) => JSON.parse(String(s).trim().split('\n').pop());

let pass = 0; const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name); }
};

console.log('Onward backup/restore round-trip…\n');

// 1. Seed through the app's own DB layer, so encryption is genuinely applied.
const seeded = lastJson(node(['-e', `
  const DB = require('${DB_PATH}');
  (async () => {
    await DB.init();
    const id = await DB.createUser({ username: 'backupuser', email: 'bk@ex.com', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null });
    await DB.saveData(id, { profile: { name: 'Ahmed', pro: true }, days: [{ date: '2026-08-01', calories: 2200 }] }, 7);
    await DB.createPost({ user_id: id, author_name: 'backupuser', type: 'update', title: 'T', body: 'hello world', data: {} });
    const d = await DB.getData(id);
    console.log(JSON.stringify({ name: d.data.profile.name, version: d.version }));
  })();
`]));
ok('seeded a user with encrypted data', seeded.name === 'Ahmed' && seeded.version === 7);

// 2. Dump.
const dumped = node(['cloud/backup.js', 'dump']);
fs.writeFileSync(dumpFile, dumped);
const parsed = JSON.parse(dumped);
ok('dump produces a valid Onward backup file', parsed.onwardBackup === 1 && !!parsed.tables);
ok('dump captured the user row', (parsed.tables.users || []).length === 1);
ok('dump captured the user_data row', (parsed.tables.user_data || []).length === 1);
ok('dump captured the community post', (parsed.tables.community_posts || []).length === 1);
const blob = String((parsed.tables.user_data || [{}])[0].data || '');
ok('the backed-up blob stays CIPHERTEXT (safe to store off-site)',
  blob.length > 0 && blob.indexOf('Ahmed') === -1, blob.slice(0, 60));

// 3. Restore must refuse to clobber a populated database.
let refused = false;
try { node(['cloud/backup.js', 'restore', dumpFile]); }
catch (e) { refused = /re-run with --force/.test(String(e.stderr || '')); }
ok('restore refuses to overwrite a non-empty database', refused);

// 4. Wipe, recreate the schema, restore.
fs.unlinkSync(dbFile);
['-shm', '-wal'].forEach(s => { try { fs.unlinkSync(dbFile + s); } catch (e) {} });
node(['-e', `require('${DB_PATH}').init().then(() => {});`]);
node(['cloud/backup.js', 'restore', dumpFile]);

// 5. Verify through the app layer that everything decrypts and matches.
const after = lastJson(node(['-e', `
  const DB = require('${DB_PATH}');
  (async () => {
    await DB.init();
    const u = await DB.findUserByName('backupuser');
    const d = u ? await DB.getData(u.id) : null;
    const posts = await DB.listPosts('');
    console.log(JSON.stringify({
      user: !!u, email: u && u.email,
      name: d && d.data.profile.name, pro: d && d.data.profile.pro,
      version: d && d.version, cals: d && d.data.days[0].calories,
      posts: posts.length, body: posts[0] && posts[0].body
    }));
  })();
`]));
ok('restored: the user account is back', after.user === true && after.email === 'bk@ex.com');
ok('restored: the encrypted blob DECRYPTS correctly', after.name === 'Ahmed' && after.cals === 2200);
ok('restored: server-owned billing field survived', after.pro === true);
ok('restored: the save version was preserved (no lost-update risk)', after.version === 7);
ok('restored: the community post came back intact', after.posts === 1 && after.body === 'hello world');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures.length) {
  console.log('❌ ' + failures.length + ' failed, ' + pass + ' passed:\n');
  failures.forEach(f => console.log('   ✗ ' + f));
  process.exit(1);
}
console.log('✅ All ' + pass + ' backup round-trip checks passed.');
