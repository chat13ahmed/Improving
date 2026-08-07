/* Schema parity: the SQLite path and the Postgres path must define the SAME
 * tables and columns.
 *
 * cloud/db.js hand-maintains two engines. The real failure mode isn't exotic —
 * it's adding a column to one branch and forgetting the other, which works
 * perfectly in local dev (SQLite) and then 500s in production (Postgres), or
 * vice versa. That nearly happened while adding `flaggers`.
 *
 * A live Postgres isn't needed to catch it: both schemas are declared in the
 * source, so parse each branch and compare. Runs anywhere, including CI.
 *
 *   node tests/schema-parity.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'db.js'), 'utf8');

// Split on the two impl factories. If these markers ever move, this test fails
// loudly rather than silently checking nothing — which is the behaviour we want.
const sqliteAt = src.indexOf('function sqliteImpl()');
const pgAt = src.indexOf('function pgImpl()');
if (sqliteAt < 0 || pgAt < 0 || pgAt < sqliteAt) {
  console.log('❌ could not locate sqliteImpl()/pgImpl() in cloud/db.js — update tests/schema-parity.js');
  process.exit(1);
}
const sections = {
  sqlite: src.slice(sqliteAt, pgAt),
  postgres: src.slice(pgAt)
};

// Columns that only make sense for one engine (different type systems, not drift).
const IGNORE_COLUMNS = new Set(['primary', 'unique', 'foreign', 'constraint', 'check']);

function parseSchema(text) {
  const tables = {};

  // CREATE TABLE IF NOT EXISTS <name> ( <body> ) — body ends at the paren that
  // closes the one opened after the table name, so nested parens are handled.
  const createRe = /CREATE TABLE IF NOT EXISTS\s+"?([a-z_]+)"?\s*\(/gi;
  let m;
  while ((m = createRe.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    let depth = 1, i = createRe.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    const body = text.slice(createRe.lastIndex, i - 1);
    const cols = tables[name] = tables[name] || new Set();
    // Split on top-level commas only (skip commas inside e.g. DEFAULT (datetime('now'))).
    let d = 0, cur = '';
    const parts = [];
    for (const ch of body) {
      if (ch === '(') d++;
      else if (ch === ')') d--;
      if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const col = (p.trim().split(/\s+/)[0] || '').replace(/"/g, '').toLowerCase();
      if (col && !IGNORE_COLUMNS.has(col)) cols.add(col);
    }
  }

  // ALTER TABLE <name> ADD COLUMN [IF NOT EXISTS] <col>
  const alterRe = /ALTER TABLE\s+"?([a-z_]+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?/gi;
  while ((m = alterRe.exec(text)) !== null) {
    const t = m[1].toLowerCase();
    (tables[t] = tables[t] || new Set()).add(m[2].toLowerCase());
  }

  return tables;
}

const a = parseSchema(sections.sqlite);
const b = parseSchema(sections.postgres);

let pass = 0; const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

console.log('Schema parity: SQLite vs Postgres…\n');

// Sanity: if parsing produced nothing, the test is vacuous and must fail.
ok('parsed a non-trivial SQLite schema', Object.keys(a).length >= 8, Object.keys(a).length + ' tables');
ok('parsed a non-trivial Postgres schema', Object.keys(b).length >= 8, Object.keys(b).length + ' tables');

const onlySqlite = Object.keys(a).filter(t => !b[t]);
const onlyPg = Object.keys(b).filter(t => !a[t]);
ok('every SQLite table also exists in Postgres', onlySqlite.length === 0, onlySqlite.join(', '));
ok('every Postgres table also exists in SQLite', onlyPg.length === 0, onlyPg.join(', '));

for (const t of Object.keys(a).filter(t => b[t]).sort()) {
  const missingInPg = [...a[t]].filter(c => !b[t].has(c));
  const missingInSqlite = [...b[t]].filter(c => !a[t].has(c));
  ok('table "' + t + '" has the same columns in both engines',
    missingInPg.length === 0 && missingInSqlite.length === 0,
    [missingInPg.length ? 'missing in Postgres: ' + missingInPg.join(',') : '',
     missingInSqlite.length ? 'missing in SQLite: ' + missingInSqlite.join(',') : ''].filter(Boolean).join(' | '));
}

console.log('');
if (failures.length) {
  console.log('❌ ' + failures.length + ' failed, ' + pass + ' passed:\n');
  failures.forEach(f => console.log('   ✗ ' + f));
  console.log('\nAdd the missing column/table to the other engine in cloud/db.js.');
  process.exit(1);
}
console.log('✅ Schema parity holds — all ' + pass + ' checks passed.');
