/*
 * Business Escalate — automated test suite.
 * Run with:  npm test   (from resources/app)
 *
 * Loads public/app.js inside a mocked DOM and exercises the core logic,
 * then loads the exported server helpers. No browser or network required.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ── tiny assert library ──
let passed = 0; const failures = [];
function ok(label, cond, detail) { if (cond) passed++; else failures.push(label + (detail ? ' — ' + detail : '')); }
function eq(label, got, exp) { ok(label, JSON.stringify(got) === JSON.stringify(exp), 'got ' + JSON.stringify(got) + ' expected ' + JSON.stringify(exp)); }
function approx(label, got, exp, tol) { ok(label, Math.abs(got - exp) <= (tol || 0.1), 'got ' + got + ' expected ~' + exp); }
function noThrow(label, fn) { try { fn(); passed++; } catch (e) { failures.push(label + ' — threw ' + e.message); } }

// ── mocked DOM ──
function makeEl(presets, id) {
  const fn = function () { return makeEl(presets); }; fn.__v = {};
  if (id && presets && presets[id] !== undefined) fn.__v.value = presets[id];
  return new Proxy(fn, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'then') return undefined;
      if (typeof t.__v[p] === 'function') return t.__v[p];
      if (['innerHTML', 'outerHTML', 'value', 'textContent', 'placeholder', 'href', 'download'].includes(p)) return t.__v[p] ?? '';
      if (['style', 'classList', 'dataset'].includes(p)) return makeEl(presets);
      if (['attributes', 'childNodes'].includes(p)) return [];
      if (p === 'nodeType') return 1; if (p === 'tagName') return 'DIV';
      if (p === 'parentNode') return null; if (p === 'length') return 0;
      if (p === 'getContext') return () => ({});
      return () => makeEl(presets);
    },
    set(t, p, v) { t.__v[p] = v; return true; }, apply() { return makeEl(presets); }
  });
}

function loadApp(fieldValues) {
  const presets = fieldValues || {};
  const ChartStub = function () {}; ChartStub.prototype.destroy = function () {}; ChartStub.defaults = { color: '', borderColor: '', plugins: { tooltip: {} } };
  const sandbox = {
    console, setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    document: { getElementById: (id) => makeEl(presets, id), querySelector: () => makeEl(presets), querySelectorAll: () => [], createElement: () => makeEl(presets), body: makeEl(presets), addEventListener: () => {} },
    Chart: ChartStub, marked: { parse: (s) => s },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    performance: { now: () => 0 }, requestAnimationFrame: () => 0,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, confirm: () => true, prompt: () => '', alert: () => {},
    Blob: function (p) { this.parts = p; }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Date, Math, JSON, Object, Array, parseInt, parseFloat, isNaN, String, Number, RegExp, __exports__: {}
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  let code = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '\n');
  code += '\n;Object.assign(__exports__, { state, computeNutrition, mealLabels, foodMacros, findFood, foodLogTotals,' +
    ' defaultPillars, pillar, isPillarOn, enabledPillars, getLevel, computeXP, displayToKg, kgToDisplay, upsertWeight,' +
    ' recentDefaults, getRecentFoods, getWeeklyScore, getWeekStats, lastNoteEntry, renderPrevNoteBanner,' +
    ' reminderDue, isChecked, checklistProgress, ensureChecklistData,' +
    ' loggingStreak, weekShareStats, weekShareTiles, getWeekStats, getWeekStart, daysSince,' +
    ' getMoneyPeriod, periodKeyFor, setPeriodIncome, periodSpending });';
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app.js' });
  return sandbox.__exports__;
}

console.log('Running Business Escalate test suite…\n');

// ─────────────────────────────────────────────────────────────
// APP LOGIC
// ─────────────────────────────────────────────────────────────
let A;
try { A = loadApp(); } catch (e) { console.log('❌ app.js failed to load: ' + e.stack); process.exit(1); }

// Nutrition
const nut = A.computeNutrition({ age: 28, sex: 'male', heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain', strategy: 'muscle', mealsPerDay: 5 });
approx('BMR (Mifflin male 180/80/28)', nut.bmr, 1790, 1);
approx('maintenance calories ≈ TDEE', nut.calories, 2775, 3);
eq('protein by bodyweight (2g/kg)', nut.protein.g, 160);
approx('macro calories ≈ total', nut.protein.cal + nut.carbs.cal + nut.fat.cal, nut.calories, 6);
eq('5-meal split labels', nut.meals.labels, ['Breakfast', 'Snack', 'Lunch', 'Snack', 'Dinner']);
approx('per-meal calories = total/5', nut.meals.calories, Math.round(nut.calories / 5), 1);
const cut = A.computeNutrition({ age: 28, sex: 'male', heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'lose' });
const bulk = A.computeNutrition({ age: 28, sex: 'male', heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'gain' });
ok('lose < maintain < gain', cut.calories < nut.calories && nut.calories < bulk.calories);
const bal = A.computeNutrition({ age: 30, sex: 'female', heightCm: 165, weightKg: 60, activity: 'light', goal: 'maintain', strategy: 'balanced' });
ok('balanced split 30/40/30', bal.protein.pct === 30 && bal.carbs.pct === 40 && bal.fat.pct === 30);
eq('incomplete nutrition → null', A.computeNutrition({ age: 0 }), null);
eq('mealLabels fallback length', A.mealLabels(2).length, 2);

// Food DB + macros (the banana + 80g rice + 120g chicken example)
const banana = A.findFood('banana'), rice = A.findFood('rice, white'), chicken = A.findFood('chicken breast');
ok('food DB finds banana/rice/chicken', !!(banana && rice && chicken));
const mC = A.foodMacros(chicken, 120);
approx('120g chicken protein ≈ 37g', mC.p, 37.2, 0.5);
const tot = A.foodLogTotals([A.foodMacros(banana, banana.sg), A.foodMacros(rice, 80), mC]);
approx('example total calories ~407', tot.kcal, 407, 4);
approx('example total protein ~40.7g', tot.p, 40.7, 0.6);
eq('foodLogTotals empty', A.foodLogTotals([]), { kcal: 0, p: 0, c: 0, f: 0 });

// Pillars
const dp = A.defaultPillars();
ok('defaultPillars has 5 enabled', Object.keys(dp).length === 5 && Object.values(dp).every(p => p.enabled));
A.state.data = { profile: { pillars: { gym: { enabled: true, label: 'Lift', icon: '🏋️' }, food: { enabled: false }, networking: { enabled: true }, money: { enabled: false }, reading: { enabled: true } } }, days: [], weeks: [], weights: [] };
eq('pillar() custom label', A.pillar('gym').label, 'Lift');
eq('isPillarOn respects disabled', A.isPillarOn('food'), false);
eq('enabledPillars count', A.enabledPillars().length, 3);

// XP / levels
A.state.data = { profile: { pillars: dp }, days: [{ gym: { done: true }, food: { rating: 4 }, networking: { count: 2 } }], weeks: [{ income: 100 }], weights: [] };
ok('computeXP positive', A.computeXP() > 0);
ok('getLevel returns label', typeof A.getLevel(A.computeXP()).label === 'string');

// Weight conversions + upsert
A.state.data = { profile: { nutrition: { weightUnit: 'lbs' } }, days: [], weeks: [], weights: [] };
approx('lbs→kg→lbs round-trip', A.kgToDisplay(A.displayToKg(176)), 176, 0.01);
A.upsertWeight('2026-06-01', 80); A.upsertWeight('2026-06-01', 79.5);
ok('upsertWeight dedups by date', A.state.data.weights.length === 1 && A.state.data.weights[0].kg === 79.5);

// Recent foods + defaults
A.state.data = { profile: { pillars: dp, nutrition: { weightUnit: 'kg' } }, weights: [], days: [
  { date: '2026-05-30', food: { rating: 4 }, water: 0.75, foodLog: [{ name: 'Banana', grams: 118, kcal: 105, p: 1, c: 27, f: 0 }] },
  { date: '2026-05-31', food: { rating: 4 }, water: 0.5, foodLog: [{ name: 'Rice, white (cooked)', grams: 200, kcal: 260, p: 5, c: 56, f: 1 }] },
  { date: '2026-06-01', food: { rating: 5 }, water: 1.0, foodLog: [{ name: 'Banana', grams: 100, kcal: 89, p: 1, c: 23, f: 0 }] }
] };
eq('recentDefaults food mode = 4', A.recentDefaults().food, 4);
eq('recentDefaults water avg = 0.75', A.recentDefaults().water, 0.75);
const rf = A.getRecentFoods(8);
ok('getRecentFoods dedups by name', new Set(rf.map(f => f.name)).size === rf.length);
const bn = rf.find(f => f.name === 'Banana');
ok('recent food remembers latest grams + count', bn.grams === 100 && bn.count === 2);

// Previous-day note recall
const _yday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const _older = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
A.state.data = { profile: { pillars: dp }, weeks: [], weights: [], days: [
  { date: _older, notes: 'old note' },
  { date: _yday, notes: 'crushed leg day, felt strong' }
] };
ok('lastNoteEntry prefers yesterday', (() => { const n = A.lastNoteEntry(); return n && n.isYesterday && /leg day/.test(n.text); })());
ok('prev-note banner says "Yesterday you wrote"', /Yesterday you wrote/.test(A.renderPrevNoteBanner()) && /leg day/.test(A.renderPrevNoteBanner()));
A.state.data.days = [{ date: _older, notes: 'old note' }];
ok('falls back to most recent note (not yesterday)', (() => { const n = A.lastNoteEntry(); return n && !n.isYesterday && n.text === 'old note'; })());
A.state.data.days = [{ date: _older, notes: '' }];
eq('no notes → null', A.lastNoteEntry(), null);
eq('no notes → empty banner', A.renderPrevNoteBanner(), '');

// Checklist + reminders
const _t = new Date().toISOString().split('T')[0];
A.state.data = { profile: {}, days: [], weeks: [], weights: [], checklist: [{ id: 'a', text: 'X' }, { id: 'b', text: 'Y' }], checkDone: { [_t]: ['a'] }, reminders: [] };
ok('checklist progress = 1/2 today', (() => { const p = A.checklistProgress(); return p.done === 1 && p.total === 2; })());
ok('isChecked true/false', A.isChecked('a') === true && A.isChecked('b') === false);
ok('reminderDue: due (past time, enabled, unfired)', A.reminderDue({ enabled: true, _lastFired: '', time: '08:00' }, '09:00', _t) === true);
ok('reminderDue: not due (future time)', A.reminderDue({ enabled: true, _lastFired: '', time: '23:00' }, '09:00', _t) === false);
ok('reminderDue: already fired today', A.reminderDue({ enabled: true, _lastFired: _t, time: '08:00' }, '09:00', _t) === false);
ok('reminderDue: disabled', A.reminderDue({ enabled: false, _lastFired: '', time: '08:00' }, '09:00', _t) === false);
A.state.data = { profile: {}, days: [], weeks: [], weights: [] };
A.ensureChecklistData();
ok('ensureChecklistData creates the fields', Array.isArray(A.state.data.checklist) && Array.isArray(A.state.data.reminders) && typeof A.state.data.checkDone === 'object');

// Shareable week card — streak + stats (pure; canvas itself needs a real browser)
const _sd0 = new Date().toISOString().split('T')[0];
const _sd1 = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const _sd2 = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
A.state.data = { profile: { pillars: dp }, weeks: [], weights: [], days: [
  { date: _sd2, gym: { done: true } }, { date: _sd1, gym: { done: true } }, { date: _sd0, gym: { done: true } }
] };
ok('loggingStreak counts consecutive incl today', A.loggingStreak() === 3);
A.state.data.days = [{ date: _sd2, gym: { done: true } }, { date: _sd1, gym: { done: true } }]; // today not logged yet
ok('loggingStreak counts through yesterday when today blank', A.loggingStreak() === 2);
A.state.data.days = [{ date: _sd0, gym: { done: true }, reading: { pages: 15 }, networking: { count: 3 }, water: 1.5 }];
const _ws = A.weekShareStats();
ok('weekShareStats reads today', _ws.daysLogged === 1 && _ws.workouts === 1 && _ws.pages === 15 && _ws.connections === 3);
const _tiles = A.weekShareTiles(_ws);
ok('weekShareTiles ≤4 and leads with Days logged', _tiles.length <= 4 && _tiles[0].label === 'Days logged' && _tiles.some(t => t.label === 'Workouts'));

// Money: weekly net = income − summed DAILY spend (spending is logged per day now)
const _wkS = A.getWeekStart(new Date().toISOString().split('T')[0]);
const _td0 = new Date().toISOString().split('T')[0];
A.state.data = { profile: { pillars: dp }, weights: [], days: [{ date: _td0, spent: 300 }], weeks: [{ weekStart: _wkS, income: 1000 }] };
const _m = A.getWeekStats();
ok('weekStats net = income − daily spend', _m.weekIncome === 1000 && _m.weekExpenses === 300 && _m.weekNet === 700);
A.state.data = { profile: { pillars: dp }, weights: [], days: [{ date: _td0, spent: 800 }], weeks: [{ weekStart: _wkS, income: 500 }] };
ok('weekStats net goes negative when overspending', A.getWeekStats().weekNet === -300);

// Patterns AI-cost throttle helper
ok('daysSince today ≈ 0', A.daysSince(new Date().toISOString().split('T')[0]) < 1);
ok('daysSince 5 days ago ≈ 5', Math.round(A.daysSince(new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0])) === 5);
ok('daysSince empty = Infinity', A.daysSince('') === Infinity);

// Money redesign: daily spending + periodic income (weekly or monthly)
ok('periodKeyFor monthly = YYYY-MM', A.periodKeyFor('2026-06-15', 'monthly') === '2026-06');
ok('periodKeyFor weekly = weekStart', A.periodKeyFor('2026-06-15', 'weekly') === A.getWeekStart('2026-06-15'));
const _today = new Date().toISOString().split('T')[0];
const _mKey = _today.slice(0, 7);
A.state.data = { profile: { pillars: dp, incomeCadence: 'monthly' }, weeks: [], weights: [], incomes: {}, days: [{ date: _today, spent: 40 }] };
A.setPeriodIncome('monthly', _mKey, 3000);
ok('setPeriodIncome monthly → incomes map', A.state.data.incomes[_mKey] === 3000);
const _mp = A.getMoneyPeriod();
ok('getMoneyPeriod monthly net = income − daily spend', _mp.label === 'month' && _mp.income === 3000 && _mp.spent === 40 && _mp.net === 2960 && _mp.rate === 99);
const _wKey = A.getWeekStart(_today);
A.state.data = { profile: { pillars: dp, incomeCadence: 'weekly' }, weeks: [], weights: [], days: [{ date: _today, spent: 25 }] };
A.setPeriodIncome('weekly', _wKey, 800);
ok('setPeriodIncome weekly → weeks[]', (A.state.data.weeks.find(w => w.weekStart === _wKey) || {}).income === 800);
const _wp = A.getMoneyPeriod();
ok('getMoneyPeriod weekly net', _wp.label === 'week' && _wp.income === 800 && _wp.spent === 25 && _wp.net === 775);

// Weekly score only counts enabled pillars (no crash, 0..100)
A.state.data = { profile: { pillars: dp, gymDaysPerWeek: 5, weeklyNetworkGoal: 3, weeklyIncomeGoal: 1000, weeklyReadGoal: 100 }, days: [], weeks: [], weights: [] };
const score = A.getWeeklyScore();
ok('weekly score in 0..100', score >= 0 && score <= 100);

// ─────────────────────────────────────────────────────────────
// SERVER HELPERS
// ─────────────────────────────────────────────────────────────
process.env.PORT = '0';                         // ask OS for any free port (avoids conflicts)
process.env.USER_DATA = fs.mkdtempSync(path.join(require('os').tmpdir(), 'be-test-'));
let S;
try { S = require(path.join(__dirname, '..', 'server.js')); } catch (e) { failures.push('server.js failed to load — ' + e.message); }
if (S) {
  eq('parseFoodEstimate plain JSON', S.parseFoodEstimate('{"name":"Burrito","grams":300,"calories":650,"protein":30,"carbs":70,"fat":25}'),
    { name: 'Burrito', grams: 300, kcal: 650, p: 30, c: 70, f: 25 });
  eq('parseFoodEstimate code-fenced', S.parseFoodEstimate('```json\n{"name":"Apple","grams":182,"calories":95,"protein":0.5,"carbs":25,"fat":0.3}\n```'),
    { name: 'Apple', grams: 182, kcal: 95, p: 0.5, c: 25, f: 0.3 });
  eq('parseFoodEstimate alt keys', S.parseFoodEstimate('{"food":"Oatmeal","serving_grams":234,"kcal":158,"protein_g":6,"carbohydrates":27,"fat_g":3}'),
    { name: 'Oatmeal', grams: 234, kcal: 158, p: 6, c: 27, f: 3 });
  eq('parseFoodEstimate refusal → null', S.parseFoodEstimate('I cannot estimate that.'), null);
  eq('parseFoodEstimate all-zero → null', S.parseFoodEstimate('{"name":"Water","grams":250,"calories":0,"protein":0,"carbs":0,"fat":0}'), null);
  const sys = S.buildSystemPrompt({ pillars: { gym: { enabled: true, label: 'Lifting', icon: '🏋️' }, food: { enabled: true }, networking: { enabled: false }, money: { enabled: false }, reading: { enabled: false } }, gymDaysPerWeek: 5 });
  ok('buildSystemPrompt uses custom pillar label', /LIFTING/.test(sys));
  ok('buildSystemPrompt mentions water', /WATER/.test(sys));
}

// ─────────────────────────────────────────────────────────────
// CLOUD BACKEND (pure helpers — no DB connection)
// ─────────────────────────────────────────────────────────────
let C;
try { C = require(path.join(__dirname, '..', 'cloud', 'server.js')); } catch (e) { failures.push('cloud/server.js failed to load — ' + e.message); }
if (C) {
  const tok = C.signJwt({ sub: 7, username: 'alice' }, 'secret');
  const dec = C.verifyJwt(tok, 'secret');
  ok('cloud JWT round-trips', dec && dec.sub === 7 && dec.username === 'alice');
  eq('cloud JWT wrong secret → null', C.verifyJwt(tok, 'other-secret'), null);
  eq('cloud JWT tampered → null', C.verifyJwt(tok.slice(0, -3) + 'xyz', 'secret'), null);
  eq('cloud JWT expired → null', C.verifyJwt(C.signJwt({ sub: 1 }, 'secret', -10), 'secret'), null);
  const h = C.hashPassword('hunter2');
  ok('cloud verifyPassword correct', C.verifyPassword('hunter2', h.salt, h.hash) === true);
  ok('cloud verifyPassword wrong', C.verifyPassword('nope', h.salt, h.hash) === false);
  eq('cloud parseFoodEstimate', C.parseFoodEstimate('{"name":"Egg","grams":50,"calories":72,"protein":6,"carbs":0.4,"fat":5}'), { name: 'Egg', grams: 50, kcal: 72, p: 6, c: 0.4, f: 5 });
  ok('cloud buildSystemPrompt mentions water', /WATER/.test(C.buildSystemPrompt({ pillars: { gym: { enabled: true } } })));
  eq('cloud defaultData shape', Object.keys(C.defaultData()).sort(), ['books', 'contacts', 'days', 'ideas', 'profile', 'weeks', 'weights']);
  // Owner gate for the broadcast tool (reads OWNER_USERNAMES env dynamically)
  process.env.OWNER_USERNAMES = 'Ahmed, partner';
  ok('isOwner matches (case-insensitive)', C.isOwner('ahmed') === true && C.isOwner('AHMED') === true);
  ok('isOwner second name', C.isOwner('partner') === true);
  ok('isOwner rejects others', C.isOwner('randomuser') === false);
  ok('isOwner rejects empty', C.isOwner('') === false && C.isOwner(null) === false);
  delete process.env.OWNER_USERNAMES;
  ok('isOwner false when env unset', C.isOwner('ahmed') === false);
}

// Push helpers (pure, no web-push needed)
let P;
try { P = require(path.join(__dirname, '..', 'cloud', 'push.js')); } catch (e) { failures.push('cloud/push.js failed to load — ' + e.message); }
if (P) {
  ok('push due (past time)', P.isReminderDue({ enabled: true, _lastFired: '', time: '08:00' }, '09:00', '2026-06-03') === true);
  ok('push not due (future time)', P.isReminderDue({ enabled: true, _lastFired: '', time: '10:00' }, '09:00', '2026-06-03') === false);
  ok('push not due (fired today)', P.isReminderDue({ enabled: true, _lastFired: '2026-06-03', time: '08:00' }, '09:00', '2026-06-03') === false);
  const ul = P.userLocal(120, Date.UTC(2026, 5, 3, 18, 30)); // 18:30 UTC + 2h → 20:30 local
  ok('push userLocal applies tz offset', ul.hhmm === '20:30' && ul.date === '2026-06-03');
  ok('push configured() false without VAPID env', P.configured() === false);
  // Daily streak nudge gate
  const D = '2026-06-03';
  ok('nudge due (evening, not logged, not nudged)', P.isNudgeDue({ hhmm: '19:30', date: D, loggedToday: false, lastNudge: '', enabled: true }) === true);
  ok('nudge not due before the hour', P.isNudgeDue({ hhmm: '12:00', date: D, loggedToday: false, lastNudge: '' }) === false);
  ok('nudge not due if logged today', P.isNudgeDue({ hhmm: '21:00', date: D, loggedToday: true, lastNudge: '' }) === false);
  ok('nudge not due if already nudged today', P.isNudgeDue({ hhmm: '21:00', date: D, loggedToday: false, lastNudge: D }) === false);
  ok('nudge disabled when off', P.isNudgeDue({ hhmm: '21:00', date: D, loggedToday: false, lastNudge: '', enabled: false }) === false);
  ok('nudge respects custom hour', P.isNudgeDue({ hhmm: '08:00', date: D, loggedToday: false, lastNudge: '', nudgeHour: 8 }) === true);
  ok('nudge default hour is 19', P.isNudgeDue({ hhmm: '18:59', date: D, loggedToday: false, lastNudge: '' }) === false);
}

// ─────────────────────────────────────────────────────────────
// CLOUD DATABASE — real SQLite round-trip (in-memory, no install)
// ─────────────────────────────────────────────────────────────
(async () => {
  try {
    delete process.env.DATABASE_URL;
    process.env.SQLITE_FILE = ':memory:';
    const DBm = require(path.join(__dirname, '..', 'cloud', 'db.js'));
    await DBm.init();
    ok('DB uses sqlite by default', DBm.kind() === 'sqlite');
    const id = await DBm.createUser({ username: 'tuser', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null });
    ok('DB createUser returns id', !!id);
    const found = await DBm.findUserByName('TUSER');
    ok('DB findUserByName case-insensitive', !!found && found.username === 'tuser');
    await DBm.saveData(id, { profile: { name: 'X' }, days: [1] }, 1);
    const d1 = await DBm.getData(id);
    ok('DB saveData/getData round-trip', !!d1 && d1.version === 1 && d1.data.profile.name === 'X' && d1.data.days.length === 1);
    await DBm.saveData(id, { profile: { name: 'Y' } }, 2);
    const d2 = await DBm.getData(id);
    ok('DB upsert updates row + bumps version', d2.version === 2 && d2.data.profile.name === 'Y');
    await DBm.updatePassword(id, 's2', 'h2');
    const u2 = await DBm.findUserById(id);
    ok('DB updatePassword persists', u2.pw_hash === 'h2');
    await DBm.setSecurity(id, 'Pet?', 'ss', 'hh');
    ok('DB setSecurity persists', (await DBm.findUserById(id)).sec_question === 'Pet?');
    // push subscriptions
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } };
    await DBm.savePushSub(id, sub);
    let subs = await DBm.allPushSubs();
    ok('DB push sub round-trips', subs.length === 1 && subs[0].sub.endpoint === sub.endpoint && String(subs[0].user_id) === String(id));
    await DBm.savePushSub(id, sub);
    ok('DB push sub upserts by endpoint', (await DBm.allPushSubs()).length === 1);
    await DBm.deletePushSub(sub.endpoint);
    ok('DB deletePushSub works', (await DBm.allPushSubs()).length === 0);
    // analytics reads
    const allU = await DBm.allUsers();
    ok('DB allUsers returns rows with created_at', allU.length === 1 && allU[0].username === 'tuser' && !!allU[0].created_at);
    const allD = await DBm.allUserData();
    ok('DB allUserData returns parsed data', allD.length === 1 && String(allD[0].user_id) === String(id) && typeof allD[0].data === 'object');
    // conditional metadata save (cron path): writes only on version match, never bumps, never clobbers
    await DBm.saveData(id, { days: ['real'] }, 5);
    const okMeta = await DBm.saveDataMeta(id, { days: ['real'], _lastNudge: '2026-06-06' }, 5);
    const afterMeta = await DBm.getData(id);
    ok('saveDataMeta writes at matching version (no bump)', okMeta === true && afterMeta.version === 5 && afterMeta.data._lastNudge === '2026-06-06');
    const badMeta = await DBm.saveDataMeta(id, { days: ['STALE'] }, 99);
    const afterBad = await DBm.getData(id);
    ok('saveDataMeta refuses on version mismatch (no clobber)', badMeta === false && afterBad.data.days[0] === 'real');
  } catch (e) { failures.push('cloud DB (sqlite) — ' + e.message); }

  // ── report ──
  console.log('');
  if (failures.length) {
    console.log('❌ ' + failures.length + ' failed, ' + passed + ' passed:\n');
    failures.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
  } else {
    console.log('✅ All ' + passed + ' assertions passed.');
    process.exit(0);
  }
})();
