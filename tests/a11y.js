/* Accessibility guards — static checks on the shipped markup.
 *
 * These are the failures that actually lock someone out: a control announced as
 * just "button", an async update nothing announces, no way to tell which page
 * you're on. They regressed easily before because app.js builds markup from
 * string templates, so nothing flagged a missing label.
 *
 *   node tests/a11y.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(APP, 'public', 'app.js'), 'utf8');
const idx = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'public', 'style.css'), 'utf8');

let pass = 0; const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

console.log('Accessibility guards…\n');

// ── Every control must have an accessible name ──
// An <svg>/entity/emoji contributes no text, so a button containing only those
// and carrying no aria-label is announced as an unlabelled "button".
const visibleText = (inner) => inner
  .replace(/<svg[\s\S]*?<\/svg>/gi, '')
  .replace(/<[^>]*>/g, '')
  .replace(/&[a-z]+;|&#\d+;/gi, '')
  .replace(/[^A-Za-z0-9]/g, '');

const unnamed = [];
app.replace(/<button\b([^>]*?)>([\s\S]{0,400}?)<\/button>/g, (full, attrs, inner) => {
  if (!/aria-label|aria-labelledby/i.test(attrs) && visibleText(inner).length === 0) {
    unnamed.push((attrs.match(/onclick="([^"(]{0,30})/) || [, '?'])[1] + '()');
  }
  return full;
});
ok('every button has an accessible name (text or aria-label)', unnamed.length === 0,
  unnamed.length ? unnamed.slice(0, 6).join(', ') : '');

// ── Live regions: async work must be announced ──
ok('index.html declares a polite live region', /id="sr-live"[^>]*aria-live="polite"/.test(idx));
ok('index.html declares an assertive live region for errors', /id="sr-alert"[^>]*aria-live="assertive"/.test(idx));
ok('showToast() routes messages to the live region', /function showToast[\s\S]{0,400}announce\(/.test(app));
ok('announce() exists and targets both regions',
  /function announce\(/.test(app) && /sr-alert/.test(app) && /sr-live/.test(app));

// The live regions MUST stay in the accessibility tree — display:none or
// visibility:hidden would silence every announcement.
const srOnly = (css.match(/\.sr-only\s*\{[^}]*\}/) || [''])[0];
ok('.sr-only hides visually WITHOUT leaving the accessibility tree',
  srOnly.length > 0 && !/display\s*:\s*none/.test(srOnly) && !/visibility\s*:\s*hidden/.test(srOnly), srOnly.slice(0, 70));

// ── Orientation ──
ok('nav marks the active page with aria-current', /aria-current/.test(app));
ok('both nav landmarks are labelled',
  /<nav[^>]*aria-label="[^"]+"/.test(idx) && (idx.match(/<nav[^>]*aria-label=/g) || []).length >= 2);
ok('a skip link exists and targets the main landmark',
  /class="skip-link"[^>]*href="#main"/.test(idx) && /id="main"/.test(idx));
ok('the skip link becomes visible on focus', /\.skip-link:focus/.test(css));
ok('the document declares a language', /<html[^>]*lang="[a-z]{2}/i.test(idx));

// ── Inputs whose only hint is an abbreviation are unusable by ear ──
for (const [ph, why] of [['"P"', 'protein'], ['"C"', 'carbs'], ['"F"', 'fat'], ['"cal"', 'calories']]) {
  const re = new RegExp('placeholder=' + ph.replace(/"/g, '"') + '(?![^>]*aria-label)', 'g');
  ok('abbreviated placeholder ' + ph + ' (' + why + ') also carries an aria-label',
    !re.test(app));
}

// ── Toggle switches wrap only a visual slider, so they need an explicit name ──
const bareToggle = /<label class="pc-toggle"><input type="checkbox"(?![^>]*aria-label)/.test(app);
ok('toggle switches have an accessible name', !bareToggle);

console.log('');
if (failures.length) {
  console.log('❌ ' + failures.length + ' failed, ' + pass + ' passed:\n');
  failures.forEach(f => console.log('   ✗ ' + f));
  process.exit(1);
}
console.log('✅ All ' + pass + ' accessibility guards passed.');
