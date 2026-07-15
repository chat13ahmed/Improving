/*
 * Onward — automated test suite.
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
  code += '\n;Object.assign(__exports__, { state, computeNutrition, mealLabels, foodMacros, findFood, foodLogTotals, unitToGrams, nutritionAdvice, goalStatus, pickNextStep, distributeMeals, groupFoodsByMeal, currentMealIndex, nutritionWeekStats, BOOK_DB, findBook, booksByAuthor, groupReadingByBook, backfillBookData, searchBooks, searchFoods, weekConnection, projectFuture, pearson, lifeWeb, yearRange, vocabStats, weeklyGoalsReached, gymPlan, momentumScore, pointAlong, peak3d, weightToBodyFactor, bodyShapeStats, sharpenScore, identityVotes, missedYesterday, todaysVotes, guidedStepKeys,' +
    ' defaultPillars, pillar, isPillarOn, enabledPillars, getLevel, computeXP, displayToKg, kgToDisplay, upsertWeight,' +
    ' recentDefaults, getRecentFoods, getWeeklyScore, getWeekStats, lastNoteEntry, renderPrevNoteBanner,' +
    ' reminderDue, isChecked, checklistProgress, ensureChecklistData,' +
    ' loggingStreak, bestStreak, weekShareStats, weekGoalRows, pendingShareMilestone, getWeekStats, getWeekStart, daysSince,' +
    ' getMoneyPeriod, periodKeyFor, setPeriodIncome, periodSpending, getCarryover, getMoneyCircle, buildDemoData, subStatus,' +
    ' workoutTotals, searchExercises, formatClock, topMuscle, normalizeLibMuscle, isTimedExercise, EXERCISE_LIBRARY,' +
    ' ideaScore, ideaRated, ideaScoreLabel, topIdea, IDEA_DIMS, validationStage, ideaTaskProgress, stageProbability, pipelineValue, isGoingCold, daysBetween,' +
    ' musclesForExercise, muscleMapSVG, MUSCLE_NAMES, WORKOUT_PROGRAMS, exerciseGroup, repSchemeForGoal, tailorProgram, plannedWorkoutLabel, sortTakeawaysByPriority, fuelStatus, proteinFoodForGap, financeMetrics, debtPayoffMonths, yearsToFI, nextReviewBox, reviewIntervalDays, vocabDue, vocabMastered, readingPacePerDay, knowledgeYearStats });';
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app.js' });
  return sandbox.__exports__;
}

console.log('Running Onward test suite…\n');

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
// Healthiest meal split — Breakfast ~28%, Lunch ~38% (main fuel), Dinner ~34%, snacks light
const _plan5 = A.distributeMeals(2100, 168, 210, 70, A.mealLabels(5)); // Breakfast, Snack, Lunch, Snack, Dinner
ok('split: one entry per meal', _plan5.length === 5);
ok('split: snack much lighter than a main', _plan5[1].calories < _plan5[0].calories * 0.6);
approx('split: calories sum to the day', _plan5.reduce((s, m) => s + m.calories, 0), 2100, 5);
approx('split: protein sums to the day', _plan5.reduce((s, m) => s + m.protein, 0), 168, 5);
const _plan3 = A.distributeMeals(2000, 150, 200, 67, ['Breakfast', 'Lunch', 'Dinner']);
ok('split: lunch is the biggest meal', _plan3[1].calories > _plan3[0].calories && _plan3[1].calories > _plan3[2].calories);
ok('split: breakfast is the lightest', _plan3[0].calories < _plan3[2].calories && _plan3[0].calories < _plan3[1].calories);
ok('split: breakfast ~28% (≈560 of 2000)', Math.abs(_plan3[0].calories - 560) <= 25);
ok('split: lunch ~38% (≈760 of 2000)', Math.abs(_plan3[1].calories - 760) <= 25);
ok('split: any number of meals (8) works', A.distributeMeals(2400, 180, 240, 80, A.mealLabels(8)).length === 8);
ok('computeNutrition exposes a meal plan', Array.isArray(nut.meals.plan) && nut.meals.plan.length === 5 && nut.meals.plan[0].calories > 0);
// Saved day → per-meal grouping (history view)
const _grp = A.groupFoodsByMeal([
  { name: 'Eggs', kcal: 140, p: 12, meal: 0 }, { name: 'Chicken', kcal: 330, p: 62, meal: 2 },
  { name: 'Rice', kcal: 200, p: 4, meal: 2 }, { name: 'Toast', kcal: 90, p: 4, meal: 0 }
]);
ok('groupFoodsByMeal: groups only used meals', _grp.length === 2 && _grp[0].index === 0 && _grp[1].index === 2);
ok('groupFoodsByMeal: per-meal calories sum', _grp[0].kcal === 230 && _grp[1].kcal === 530);
ok('groupFoodsByMeal: empty → []', A.groupFoodsByMeal([]).length === 0);
// Time-aware "which meal now"
ok('currentMealIndex: breakfast in the morning', A.currentMealIndex(3, 8) === 0);
ok('currentMealIndex: lunch midday', A.currentMealIndex(3, 13) === 1);
ok('currentMealIndex: dinner in the evening', A.currentMealIndex(3, 19) === 2);
ok('currentMealIndex: before waking → first meal', A.currentMealIndex(3, 5) === 0);
ok('currentMealIndex: late night → last meal', A.currentMealIndex(3, 23) === 2);
ok('currentMealIndex: 5 meals midday → lunch slot', A.currentMealIndex(5, 13) === 2);
// This week in nutrition
const _nwDays = [
  { date: '2026-06-09', calories: 2000, eaten: { protein: 160 } },
  { date: '2026-06-10', calories: 1800, eaten: { protein: 140 } },
  { date: '2026-06-11', calories: 2100, eaten: { protein: 120 } }
];
const _nw = A.nutritionWeekStats(_nwDays, 2000, 150, '2026-06-11');
ok('nutritionWeek: counts logged days in window', _nw.logged === 3);
ok('nutritionWeek: avg calories', _nw.avgCal === Math.round((2000 + 1800 + 2100) / 3));
ok('nutritionWeek: protein-hit days (≥90% of 150)', _nw.proteinHit === 2);
ok('nutritionWeek: empty → logged 0', A.nutritionWeekStats([], 2000, 150, '2026-06-11').logged === 0);
ok('nutritionWeek: excludes days older than 7', A.nutritionWeekStats([{ date: '2026-05-01', calories: 2000, eaten: { protein: 160 } }], 2000, 150, '2026-06-11').logged === 0);
// Book picker
ok('BOOK_DB is a sizable curated list', Array.isArray(A.BOOK_DB) && A.BOOK_DB.length >= 40);
ok('BOOK_DB entries have title/author/pages', A.BOOK_DB.every(b => b.t && b.a && b.p > 0));
ok('findBook exact match fills pages + author', A.findBook('Atomic Habits').p === 320 && A.findBook('Atomic Habits').a === 'James Clear');
ok('findBook fuzzy match', A.findBook('psychology of money').t === 'The Psychology of Money');
ok('findBook miss → null', A.findBook('zzz not a real book') === null);
// Book library + browse-by-author
ok('BOOK_DB is a substantial library (80+ books)', A.BOOK_DB.length >= 80);
ok('BOOK_DB entries are well-formed (title, author, pages>0)', A.BOOK_DB.every(b => b.t && b.a && b.p > 0));
ok('BOOK_DB has no duplicate titles', new Set(A.BOOK_DB.map(b => b.t.toLowerCase())).size === A.BOOK_DB.length);
const _byAuthor = A.booksByAuthor();
ok('booksByAuthor accounts for every book', _byAuthor.reduce((n, g) => n + g.books.length, 0) === A.BOOK_DB.length);
ok('booksByAuthor is sorted alphabetically', _byAuthor.map(g => g.author).join('|') === _byAuthor.map(g => g.author).slice().sort((x, y) => x.localeCompare(y)).join('|'));
ok('booksByAuthor surfaces multi-book authors', _byAuthor.filter(g => g.books.length >= 3).length >= 3);
ok('booksByAuthor groups Robert Greene together', (_byAuthor.find(g => g.author === 'Robert Greene') || { books: [] }).books.length >= 3);
// backfillBookData fills missing author + pages on saved books from the library
const _sdBooks = A.state.data;
A.state.data = { books: [{ title: 'Atomic Habits', author: '', totalPages: 0 }, { title: 'Some Unknown Zzz Book', author: '', totalPages: 0 }] };
const _bf = A.backfillBookData();
ok('backfillBookData fills author + pages from the library', _bf === true && A.state.data.books[0].author === 'James Clear' && A.state.data.books[0].totalPages === 320);
ok('backfillBookData leaves books not in the library untouched', A.state.data.books[1].author === '' && A.state.data.books[1].totalPages === 0);
A.state.data = _sdBooks;
// searchBooks — mobile picker suggestions (by title + author)
ok('searchBooks matches by title prefix', A.searchBooks('atomic', 8)[0].t === 'Atomic Habits');
ok('searchBooks matches by author name', A.searchBooks('greene', 8).length >= 3 && A.searchBooks('greene', 8).every(b => /Greene/.test(b.a)));
ok('searchBooks returns nothing for an empty query', A.searchBooks('', 8).length === 0);
ok('searchBooks respects the result limit', A.searchBooks('the', 5).length <= 5);
// searchFoods — mobile food picker suggestions
ok('searchFoods matches by food name', A.searchFoods('chicken', 8).length >= 1 && /chicken/i.test(A.searchFoods('chicken', 8)[0].n));
ok('searchFoods returns nothing for an empty query', A.searchFoods('', 8).length === 0);
ok('searchFoods respects the result limit', A.searchFoods('e', 4).length <= 4);
// Reading notes grouped by book
const _rg = A.groupReadingByBook([
  { date: '2026-06-10', reading: { bookTitle: 'Deep Work', pages: 20, summary: 'focus' } },
  { date: '2026-06-12', reading: { bookTitle: 'Deep Work', pages: 15, summary: '' } },
  { date: '2026-06-11', reading: { bookTitle: 'Grit', pages: 30, summary: 'effort' } },
  { date: '2026-06-09', reading: { pages: 0 } }
]);
ok('groupReadingByBook groups by title', _rg.length === 2);
ok('groupReadingByBook orders most-recent book first', _rg[0].title === 'Deep Work');
ok('groupReadingByBook sums pages per book', _rg[0].pages === 35);
ok('groupReadingByBook counts only non-empty notes', _rg[0].notes === 1);
ok('groupReadingByBook entries newest-first', _rg[0].entries[0].date === '2026-06-12');
ok('groupReadingByBook ignores zero-page days', _rg.reduce((n, g) => n + g.entries.length, 0) === 3);
// Connection of the Week — cross-pillar correlation (no AI)
const _cdays = [];
for (let i = 0; i < 4; i++) _cdays.push({ date: '2026-06-0' + (i + 1), gym: { done: true }, reading: { pages: 38 } });
for (let i = 0; i < 4; i++) _cdays.push({ date: '2026-06-1' + i, gym: { done: false }, reading: { pages: 9 } });
const _conn = A.weekConnection(_cdays);
ok('weekConnection finds the gym↔reading link', _conn && _conn.kind === 'read' && _conn.pct > 40);
ok('weekConnection phrases it as a sentence', _conn && /On days you train/.test(_conn.headline));
ok('weekConnection needs enough days (null on 3)', A.weekConnection(_cdays.slice(0, 3)) === null);
ok('weekConnection needs gym variation (null if every day is gym)', A.weekConnection(_cdays.map(d => ({ ...d, gym: { done: true } }))) === null);
// The Climb Ahead — future-self forecast
const _ft = '2026-06-14';
const _fdays = [];
for (let i = 0; i < 14; i++) { const dt = new Date('2026-06-14T00:00:00'); dt.setDate(dt.getDate() - i); _fdays.push({ date: dt.toISOString().split('T')[0], gym: { done: true }, reading: { pages: 20 } }); }
const _proj = A.projectFuture(_fdays, 90, _ft);
ok('projectFuture projects pages forward from recent pace', _proj && _proj.pages > 100);
ok('projectFuture estimates books from pages', _proj && _proj.books > 0);
ok('projectFuture projects workouts forward', _proj && _proj.workouts > 0);
ok('projectFuture gives an XP/week rate', _proj && _proj.xpPerWeek > 0);
ok('projectFuture needs enough data (null on too few days)', A.projectFuture(_fdays.slice(0, 3), 90, _ft) === null);
// The Life Web — pairwise correlation constellation
ok('pearson perfect positive = 1', Math.round(A.pearson([1, 2, 3, 4], [2, 4, 6, 8])) === 1);
ok('pearson perfect negative = -1', Math.round(A.pearson([1, 2, 3, 4], [8, 6, 4, 2])) === -1);
ok('pearson no variance = 0', A.pearson([5, 5, 5], [1, 2, 3]) === 0);
const _wdays = [];
for (let i = 0; i < 12; i++) { const on = i % 2 === 0; _wdays.push({ date: '2026-06-' + String(i + 1).padStart(2, '0'), gym: { done: on }, reading: { pages: on ? 30 : 5 }, networking: { count: on ? 3 : 2 } }); }
const _web = A.lifeWeb(_wdays, ['gym', 'reading', 'networking']);
ok('lifeWeb returns connected nodes', _web && _web.nodes.length >= 2);
ok('lifeWeb links gym & reading (they move together)', _web && _web.edges.some(e => ((e.a === 'gym' && e.b === 'reading') || (e.a === 'reading' && e.b === 'gym')) && e.r > 0.5));
ok('lifeWeb surfaces a strongest link', _web && _web.strongest && _web.strongest.strength >= 0.5);
ok('lifeWeb needs enough days (null on too few)', A.lifeWeb(_wdays.slice(0, 3), ['gym', 'reading']) === null);
// Your Year as a Range — weekly peaks
const _yd = [];
for (let i = 0; i < 28; i++) { const dt = new Date('2026-06-14T00:00:00'); dt.setDate(dt.getDate() - i); _yd.push({ date: dt.toISOString().split('T')[0], gym: { done: i % 3 === 0 }, reading: { pages: i % 2 === 0 ? 10 : 0 } }); }
const _yr = A.yearRange(_yd, 52, '2026-06-14');
ok('yearRange builds weekly peaks', _yr && _yr.weeks.length >= 3);
ok('yearRange counts active weeks', _yr && _yr.activeWeeks >= 3);
ok('yearRange finds the tallest peak', _yr && _yr.best && _yr.best.value === _yr.max);
ok('yearRange needs a few weeks (null on tiny history)', A.yearRange(_yd.slice(0, 2), 52, '2026-06-14') === null);
// Vocabulary — words from books
const _vs = A.vocabStats([{ word: 'a', sentence: 'I used a.' }, { word: 'b', sentence: '' }, { word: 'c' }]);
ok('vocabStats counts total + practiced + needSentence', _vs.total === 3 && _vs.practiced === 1 && _vs.needSentence === 2);
ok('vocabStats handles empty/null safely', A.vocabStats(null).total === 0 && A.vocabStats([]).practiced === 0);
// Key takeaways — resurfacing order: never-revisited first, then least-recently revisited
eq('sortTakeawaysByPriority: never-seen surfaces before revisited',
  A.sortTakeawaysByPriority([
    { id: 'x', createdAt: '2026-01-01', seenAt: '2026-07-01' },
    { id: 'y', createdAt: '2026-02-01', seenAt: '' }
  ]).map(t => t.id), ['y', 'x']);
eq('sortTakeawaysByPriority: among revisited, oldest seenAt first',
  A.sortTakeawaysByPriority([
    { id: 'a', createdAt: '2026-01-01', seenAt: '2026-07-05' },
    { id: 'b', createdAt: '2026-01-02', seenAt: '2026-06-01' }
  ]).map(t => t.id), ['b', 'a']);
eq('sortTakeawaysByPriority: two never-seen keep created order (oldest first)',
  A.sortTakeawaysByPriority([
    { id: 'new', createdAt: '2026-03-01', seenAt: '' },
    { id: 'old', createdAt: '2026-01-01', seenAt: '' }
  ]).map(t => t.id), ['old', 'new']);
ok('sortTakeawaysByPriority handles empty/null safely',
  A.sortTakeawaysByPriority(null).length === 0 && A.sortTakeawaysByPriority([]).length === 0);
// fuelStatus — the gym × nutrition connector
eq('fuelStatus: under-eating while training hard → warn',
  A.fuelStatus({ trainedToday: false, gymDays: 4, proteinTarget: 150, proteinToday: 0, avgProteinWeek: 90 }).tone, 'warn');
eq('fuelStatus: eating matches training → good',
  A.fuelStatus({ trainedToday: false, gymDays: 4, proteinTarget: 150, proteinToday: 0, avgProteinWeek: 145 }).tone, 'good');
ok('fuelStatus: trained today computes the protein gap', (() => {
  const r = A.fuelStatus({ trainedToday: true, gymDays: 1, proteinTarget: 150, proteinToday: 100, avgProteinWeek: 100 });
  return r.tone === 'today' && r.gap === 50;
})());
eq('fuelStatus: no training/data → neutral',
  A.fuelStatus({ trainedToday: false, gymDays: 0, proteinTarget: 0, proteinToday: 0, avgProteinWeek: 0 }).tone, 'neutral');
ok('fuelStatus: no gap when not trained today', A.fuelStatus({ trainedToday: false, gymDays: 1, proteinTarget: 150, proteinToday: 20, avgProteinWeek: 20 }).gap === 0);
ok('proteinFoodForGap: suggests food for a real gap, nothing for none',
  /whey|chicken/.test(A.proteinFoodForGap(40)) && A.proteinFoodForGap(0) === '');
// financeMetrics — the personal-CFO numbers
(() => {
  const f = { assets: { cash: 30000, investments: 120000, property: 0, business: 0, other: 0 },
    liabilities: { mortgage: 0, loans: 0, credit: 5000, other: 0 },
    monthlyIncome: 8000, monthlyExpenses: 4000, monthlySavings: 2000, passiveIncome: 800,
    business: { revenue: 10000, expenses: 6000 }, withdrawalRate: 4, debts: [{ balance: 5000 }] };
  const m = A.financeMetrics(f);
  eq('financeMetrics: net worth = assets − liabilities', m.netWorth, 145000);
  eq('financeMetrics: savings rate %', m.savingsRate, 25);
  eq('financeMetrics: emergency months from cash/expenses', m.emergencyMonths, 7.5);
  eq('financeMetrics: FI number = annual expenses × 25 (4% rule)', m.fiNumber, 1200000);
  eq('financeMetrics: FI progress % (investable / FI)', m.fiProgress, 13);
  eq('financeMetrics: passive income ratio %', m.passiveRatio, 10);
  eq('financeMetrics: business margin %', m.bizMargin, 40);
})();
ok('debtPayoffMonths: zero balance → 0', A.debtPayoffMonths(0, 20, 100) === 0);
ok('debtPayoffMonths: payment below interest → Infinity', A.debtPayoffMonths(10000, 24, 50) === Infinity);
ok('debtPayoffMonths: 0% APR → ceil(balance/payment)', A.debtPayoffMonths(1000, 0, 100) === 10);
ok('debtPayoffMonths: real APR pays off in finite months', (() => { const n = A.debtPayoffMonths(1000, 20, 100); return n > 10 && n < 14; })());
ok('yearsToFI: already there → 0', A.yearsToFI(1000000, 1000000, 0) === 0);
ok('yearsToFI: no FI number → null', A.yearsToFI(50000, 0, 1000) === null);
ok('yearsToFI: saving reaches FI in a finite, sensible time', (() => { const y = A.yearsToFI(100000, 1000000, 3000, 0.07); return y > 5 && y < 40; })());
// Vocabulary spaced repetition (Leitner)
eq('nextReviewBox: correct promotes the box', A.nextReviewBox(1, true), 2);
eq('nextReviewBox: wrong resets to box 0', A.nextReviewBox(4, false), 0);
eq('nextReviewBox: caps at the top box', A.nextReviewBox(5, true), 5);
eq('nextReviewBox: undefined box starts at 0 then promotes', A.nextReviewBox(undefined, true), 1);
ok('reviewIntervalDays: higher box = longer interval', A.reviewIntervalDays(0) < A.reviewIntervalDays(3) && A.reviewIntervalDays(0) === 1);
(() => {
  const vocab = [
    { id: 'a', word: 'new' },                                   // never reviewed → due
    { id: 'b', word: 'soon', review: { box: 1, due: '2020-01-01' } },   // past due
    { id: 'c', word: 'later', review: { box: 4, due: '2999-01-01' } },  // not due, mastered
  ];
  eq('vocabDue: never-reviewed + past-due are due, future is not', A.vocabDue(vocab, '2026-07-11').map(w => w.id), ['a', 'b']);
  eq('vocabMastered: box >= 4 counts as mastered', A.vocabMastered(vocab), 1);
})();
ok('readingPacePerDay: averages recent pages over 14 days', (() => {
  const iso = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); };
  const days = [{ date: iso(0), reading: { pages: 14 } }, { date: iso(1), reading: { pages: 14 } }, { date: iso(30), reading: { pages: 999 } }];
  const p = A.readingPacePerDay(days);   // (14+14)/14 = 2, old day excluded
  return Math.abs(p - 2) < 0.001;
})());
// knowledgeYearStats — the "Year in Knowledge" recap numbers
(() => {
  const data = {
    days: [
      { date: '2026-03-01', reading: { pages: 20 } },
      { date: '2026-03-02', reading: { pages: 10 } },
      { date: '2026-03-03', reading: { pages: 5 } },
      { date: '2026-03-10', reading: { pages: 15 } },
      { date: '2025-12-31', reading: { pages: 999 } },          // previous year — excluded
      { date: '2026-04-01' }                                    // no reading — ignored
    ],
    books: [
      { status: 'finished', finishedDate: '2026-02-10' },
      { status: 'finished', finishedDate: '2025-11-01' },       // previous year — excluded
      { status: 'reading' }
    ],
    vocab: [
      { word: 'a', createdAt: '2026-01-05' },
      { word: 'b', createdAt: '2025-06-01', review: { box: 5 } } // old word, but mastered counts all-time
    ],
    takeaways: [{ createdAt: '2026-05-01' }, { createdAt: '2025-05-01' }]
  };
  const s = A.knowledgeYearStats(data, 2026);
  eq('yearStats: pages sum only within the year', s.pages, 50);
  eq('yearStats: days read within the year', s.daysRead, 4);
  eq('yearStats: books finished within the year', s.booksFinished, 1);
  eq('yearStats: words added within the year', s.wordsAdded, 1);
  eq('yearStats: mastered counts all-time (box ≥ 4)', s.wordsMastered, 1);
  eq('yearStats: takeaways within the year', s.takeaways, 1);
  eq('yearStats: best streak = longest consecutive run', s.bestStreak, 3);
  ok('yearStats: empty data is safe', A.knowledgeYearStats({}, 2026).pages === 0 && A.knowledgeYearStats(null, 2026).bestStreak === 0);
})();
// At-rest encryption round-trip (cloud/crypto.js)
(() => {
  const ENC = require('../cloud/crypto');
  const saved = process.env.DATA_ENCRYPTION_KEY;
  const obj = { secret: 'net worth 319000', arr: [1, 2, 3], nested: { a: true } };
  delete process.env.DATA_ENCRYPTION_KEY;
  ok('crypto: no key → transparent pass-through', JSON.stringify(ENC.encryptData(obj)) === JSON.stringify(obj) && ENC.enabled() === false);
  process.env.DATA_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
  const env = ENC.encryptData(obj);
  ok('crypto: with key → AES-GCM envelope, plaintext not visible', env && env.__enc === 'a256gcm' && !JSON.stringify(env).includes('319000') && ENC.enabled());
  eq('crypto: envelope decrypts back to the original', ENC.decryptData(env), obj);
  let rejected = false;
  try { ENC.decryptData({ ...env, ct: Buffer.from('garbage-ciphertext').toString('base64') }); } catch { rejected = true; }
  ok('crypto: tampered ciphertext is rejected (GCM auth tag)', rejected);
  if (saved === undefined) delete process.env.DATA_ENCRYPTION_KEY; else process.env.DATA_ENCRYPTION_KEY = saved;
})();
// weeklyGoalsReached — dashboard's "% of goals reached" hero number
ok('weeklyGoalsReached averages active goals', A.weeklyGoalsReached({ gymDays: 4, readPages: 100 }, { gymDaysPerWeek: 4, weeklyReadGoal: 200 }, 0, { gym: true, reading: true }) === 75);
ok('weeklyGoalsReached caps each goal at 100', A.weeklyGoalsReached({ gymDays: 10 }, { gymDaysPerWeek: 5 }, 0, { gym: true }) === 100);
ok('weeklyGoalsReached ignores pillars that are off', A.weeklyGoalsReached({ gymDays: 0, readPages: 200 }, { gymDaysPerWeek: 5, weeklyReadGoal: 200 }, 0, { reading: true }) === 100);
ok('weeklyGoalsReached is 0 with no goals', A.weeklyGoalsReached({}, {}, 0, {}) === 0);
// weightToBodyFactor / bodyShapeStats — the morphing body silhouette
ok('bodyFactor: BMI 22 → ~average build (1.0)', Math.abs(A.weightToBodyFactor(71.3, 180, 71.3) - 1) < 0.05);
ok('bodyFactor: lighter is thinner than heavier (with height)', A.weightToBodyFactor(60, 180, 80) < A.weightToBodyFactor(100, 180, 80));
ok('bodyFactor: clamped to [0.7,1.7]', A.weightToBodyFactor(40, 150, 40) >= 0.7 && A.weightToBodyFactor(140, 150, 70) <= 1.7);
ok('bodyFactor: no height → gaining widens vs. start', A.weightToBodyFactor(110, 0, 100) > 1 && A.weightToBodyFactor(90, 0, 100) < 1);
ok('bodyShapeStats: losing weight shrinks the factor', (() => { const s = A.bodyShapeStats([{ date: '2026-01-01', kg: 90 }, { date: '2026-02-01', kg: 80 }], { nutrition: { heightCm: 180 } }); return s.curFactor < s.startFactor && s.deltaKg === -10; })());
ok('bodyShapeStats: null when no weigh-ins', A.bodyShapeStats([], {}) === null);
// sharpenScore — four dimensions of balance (body/mind/heart/spirit)
const _shBal = A.sharpenScore({ gymDays: 4, gymGoal: 5, readPages: 80, readGoal: 100, networkCount: 3, networkGoal: 3, reflectDays: 6, hasMission: true });
ok('sharpenScore: each dimension is a 0–100 percent', _shBal.body === 80 && _shBal.mind === 80 && _shBal.heart === 100);
const _shWeak = A.sharpenScore({ gymDays: 5, gymGoal: 5, readPages: 0, readGoal: 100, networkCount: 3, networkGoal: 3, reflectDays: 7, hasMission: true });
ok('sharpenScore: flags the weakest dimension', _shWeak.mind === 0 && _shWeak.weakest === 'mind');
ok('sharpenScore: imbalance drags the balance below the average', _shWeak.balance < (_shWeak.body + _shWeak.mind + _shWeak.heart + _shWeak.spirit) / 4);
ok('sharpenScore: a mission lifts the spirit dimension', A.sharpenScore({ reflectDays: 0, hasMission: true }).spirit === 25 && A.sharpenScore({ reflectDays: 0, hasMission: false }).spirit === 0);
// identityVotes — "every action is a vote for who you're becoming"
const _idDays = [{ date: '2026-06-20', gym: { done: true }, reading: { pages: 10 } }, { date: '2026-06-19', gym: { done: true } }, { date: '2026-05-01', gym: { done: true } }];
const _iv = A.identityVotes(_idDays, { gym: true, reading: true }, 30, '2026-06-20');
ok('identityVotes counts votes in the window per identity', (() => {
  const show = _iv.find(v => v.id === 'show'), ath = _iv.find(v => v.id === 'athlete'), rdr = _iv.find(v => v.id === 'reader');
  return show.votes === 2 && ath.votes === 2 && rdr.votes === 1;   // 05-01 is outside the 30-day window
})());
// missedYesterday — "never miss twice" only on a single fresh miss
ok('missedYesterday fires on one fresh miss', A.missedYesterday([{ date: '2026-06-19' }], '2026-06-21') === true);
ok('missedYesterday quiet if logged yesterday', A.missedYesterday([{ date: '2026-06-20' }], '2026-06-21') === false);
ok('missedYesterday quiet if already logged today', A.missedYesterday([{ date: '2026-06-21' }, { date: '2026-06-19' }], '2026-06-21') === false);
ok('missedYesterday quiet on a longer lapse', A.missedYesterday([{ date: '2026-06-10' }], '2026-06-21') === false);
// todaysVotes — the end-of-log moment maps today's actions to who you're becoming
const _tv = A.todaysVotes({ gym: { done: true }, reading: { pages: 12 }, networking: { count: 0 }, food: { rating: 5 } }, { gym: true, reading: true, networking: true, food: true });
ok('todaysVotes maps logged actions to identities', _tv.some(v => /athlete/.test(v.who)) && _tv.some(v => /reader/.test(v.who)) && _tv.some(v => /fuels/.test(v.who)) && !_tv.some(v => /connector/.test(v.who)));
// guidedStepKeys — logged parts of today drop off the flow, fresh again tomorrow
A.state.data = { profile: { pillars: A.defaultPillars() }, days: [], weeks: [], weights: [] };
ok('guidedStepKeys shows everything when nothing is logged today', A.guidedStepKeys().includes('gym') && A.guidedStepKeys().includes('water'));
A.state.data.days = [{ date: new Date().toISOString().split('T')[0], _logged: ['gym', 'food'] }];
ok('guidedStepKeys drops the parts already logged today', !A.guidedStepKeys().includes('gym') && !A.guidedStepKeys().includes('food') && A.guidedStepKeys().includes('reading'));
// food splits into one step per meal when a meal plan exists (after the first log)
A.state.data = { profile: { pillars: A.defaultPillars(), nutrition: { age: 28, sex: 'male', heightCm: 180, weightKg: 80, mealsPerDay: 3, activity: 'moderate', goal: 'maintain', strategy: 'muscle' } }, days: [{ date: '2020-01-01' }], weeks: [], weights: [] };
const _mk = A.guidedStepKeys();
ok('food becomes one step per meal with a plan', _mk.includes('meal:0') && _mk.includes('meal:2') && !_mk.includes('food'));
ok('first-ever log keeps food as one simple step + no weight/notes', (() => { A.state.data.days = []; const k = A.guidedStepKeys(); return k.includes('food') && !k.includes('meal:0') && !k.includes('weight') && !k.includes('notes'); })());
// Gym training plan by goal + weight
ok('gymPlan lose → fat loss + cardio', /fat loss/i.test(A.gymPlan('lose', 80).headline) && /cardio/i.test(A.gymPlan('lose', 80).cardio));
ok('gymPlan gain → progressive overload', /overload/i.test(A.gymPlan('gain', 80).strength));
ok('gymPlan unknown goal → maintain', A.gymPlan('whatever', 80).goal === 'maintain');
ok('gymPlan cardio burn scales with weight', A.gymPlan('lose', 100).cardioBurn30 > A.gymPlan('lose', 60).cardioBurn30);
ok('gymPlan includes diet guidance for the goal', A.gymPlan('lose', 80).diet && A.gymPlan('lose', 80).diet.rules.length >= 2 && /deficit/i.test(A.gymPlan('lose', 80).diet.cals));
ok('gymPlan gain diet calls for a surplus', /surplus/i.test(A.gymPlan('gain', 80).diet.cals));
ok('gymPlan maintain diet is maintenance', /maintenance/i.test(A.gymPlan('maintain', 80).diet.cals));
// Your Climb — momentum + trail geometry
ok('momentum: zero inputs → 0', A.momentumScore(0, 0, null) === 0);
ok('momentum: more streak climbs higher', A.momentumScore(15, 50, null) > A.momentumScore(2, 50, null));
ok('momentum: caps near 100', A.momentumScore(100, 100, 100) >= 95 && A.momentumScore(100, 100, 100) <= 100);
ok('momentum: goal progress factors in', A.momentumScore(5, 50, 90) > A.momentumScore(5, 50, 10));
ok('pointAlong: t=0 → first point', A.pointAlong([[0, 0], [10, 0]], 0)[0] === 0);
ok('pointAlong: t=1 → last point', A.pointAlong([[0, 0], [10, 0]], 1)[0] === 10);
ok('pointAlong: t=0.5 → midpoint', A.pointAlong([[0, 0], [10, 0]], 0.5)[0] === 5);
// 3D peak: a lit face, a shadow face and a two-tone snow cap
const _pk = A.peak3d(100, 20, 40, 160, 150, { lit: '#1', shadow: '#2', snowLit: '#3', snowShadow: '#4', edge: '#5' });
ok('peak3d: draws 4 shaded polygons (lit/shadow/snow×2)', (_pk.match(/<polygon/g) || []).length === 4);
ok('peak3d: uses all four shades', ['#1','#2','#3','#4'].every(c => _pk.indexOf('"' + c + '"') !== -1));
ok('peak3d: apex sits above the base', _pk.indexOf('100.0,20.0') !== -1);
ok('peak3d: a ridge edge line when an edge colour is given', /<line /.test(_pk) && A.peak3d(100,20,40,160,150,{lit:'#1',shadow:'#2',snowLit:'#3',snowShadow:'#4'}).indexOf('<line') === -1);

// Business-idea scoring
ok('ideaScore: all 5s → 100', A.ideaScore({ income: 5, speed: 5, ease: 5, passion: 5 }) === 100);
ok('ideaScore: unrated → 0', A.ideaScore({}) === 0 && A.ideaScore(null) === 0);
ok('ideaScore: income is weighted heavier than passion',
  A.ideaScore({ income: 5, speed: 1, ease: 1, passion: 1 }) > A.ideaScore({ income: 1, speed: 1, ease: 1, passion: 5 }));
ok('ideaScore: clamps out-of-range values', A.ideaScore({ income: 9, speed: 5, ease: 5, passion: 5 }) === 100);
ok('ideaRated: needs all four rated', A.ideaRated({ income: 5, speed: 5, ease: 5, passion: 5 }) === true && A.ideaRated({ income: 5, speed: 5, ease: 5 }) === false);
eq('ideaScoreLabel: strong', A.ideaScoreLabel(90), 'Strong bet');
eq('ideaScoreLabel: promising', A.ideaScoreLabel(60), 'Promising');
eq('ideaScoreLabel: worth a look', A.ideaScoreLabel(40), 'Worth a look');
eq('ideaScoreLabel: long shot', A.ideaScoreLabel(20), 'Long shot');
ok('IDEA_DIMS: four dimensions', A.IDEA_DIMS.length === 4);
const _ideas = [
  { id: 'a', status: 'exploring', scores: { income: 5, speed: 5, ease: 5, passion: 5 } },   // 100
  { id: 'b', status: 'active',    scores: { income: 2, speed: 2, ease: 2, passion: 2 } },   // 40
  { id: 'c', status: 'dropped',   scores: { income: 5, speed: 5, ease: 5, passion: 5 } },   // dropped — ignored
  { id: 'd', status: 'exploring', scores: { income: 3 } }                                     // unrated — ignored
];
ok('topIdea: picks highest-scoring non-dropped rated idea', A.topIdea(_ideas).id === 'a');
ok('topIdea: ignores dropped even if high', A.topIdea([{ id: 'x', status: 'dropped', scores: { income: 5, speed: 5, ease: 5, passion: 5 } }]) === null);
ok('topIdea: none rated → null', A.topIdea([{ id: 'y', status: 'active', scores: {} }]) === null);
// Lean Startup validation stage (Build-Measure-Learn)
eq('validationStage: empty → untested', A.validationStage({}).key, 'untested');
eq('validationStage: customer+value → hypotheses', A.validationStage({ customer: 'gym members', valueHyp: 'saves time' }).key, 'hypothesis');
eq('validationStage: +experiment+metric → experiment ready', A.validationStage({ customer: 'x', valueHyp: 'y', experiment: 'presell', metric: '10 of 20' }).key, 'experiment');
eq('validationStage: result but no verdict → measuring', A.validationStage({ customer: 'x', valueHyp: 'y', experiment: 'e', metric: 'm', result: '6 of 20 said yes' }).key, 'measuring');
eq('validationStage: result + persevere → validated', A.validationStage({ result: 'nailed it', decision: 'persevere' }).key, 'validated');
eq('validationStage: result + pivot → pivot', A.validationStage({ result: 'flopped', decision: 'pivot' }).key, 'pivot');
ok('validationStage: progress climbs with each step', A.validationStage({}).pct === 0 && A.validationStage({ customer: 'x', valueHyp: 'y' }).pct > 0 && A.validationStage({ result: 'r', decision: 'persevere' }).pct === 100);
// Idea checklist progress
ok('ideaTaskProgress: empty → 0/0', (() => { const p = A.ideaTaskProgress([]); return p.done === 0 && p.total === 0 && p.pct === 0; })());
ok('ideaTaskProgress: counts done + pct', (() => { const p = A.ideaTaskProgress([{ done: true }, { done: false }, { done: true }, { done: false }]); return p.done === 2 && p.total === 4 && p.pct === 50; })());
ok('ideaTaskProgress: all done → 100', A.ideaTaskProgress([{ done: true }, { done: true }]).pct === 100);
ok('ideaTaskProgress: handles junk', A.ideaTaskProgress(null).total === 0 && A.ideaTaskProgress(undefined).pct === 0);
// Contacts CRM intelligence
eq('stageProbability: warm = 50%', A.stageProbability('warm'), 0.5);
eq('stageProbability: closing = 80%', A.stageProbability('closing'), 0.8);
eq('stageProbability: dropped = 0', A.stageProbability('dropped'), 0);
eq('stageProbability: unknown → default 10%', A.stageProbability('xyz'), 0.1);
const _cts = [
  { status: 'warm', dealValue: 1000 },     // open 1000, weighted 500
  { status: 'closing', dealValue: 2000 },  // open 2000, weighted 1600
  { status: 'closed', dealValue: 5000 },   // won 5000
  { status: 'dropped', dealValue: 9000 },  // ignored
  { status: 'new' }                         // no deal
];
const _pv = A.pipelineValue(_cts);
eq('pipelineValue: open sums live deals', _pv.open, 3000);
eq('pipelineValue: weighted by stage', _pv.weighted, 2100);
eq('pipelineValue: won counts closed', _pv.won, 5000);
ok('pipelineValue: handles junk', A.pipelineValue(null).open === 0);
eq('daysBetween: 10 days', A.daysBetween('2026-06-01', '2026-06-11'), 10);
ok('isGoingCold: open + no follow-up + old touch → cold', A.isGoingCold({ status: 'warm', lastContact: '2026-06-01' }, '2026-06-20') === true);
ok('isGoingCold: recent touch → not cold', A.isGoingCold({ status: 'warm', lastContact: '2026-06-18' }, '2026-06-20') === false);
ok('isGoingCold: has a follow-up planned → not cold', A.isGoingCold({ status: 'warm', lastContact: '2026-06-01', followUpDate: '2026-06-25' }, '2026-06-20') === false);
ok('isGoingCold: closed → never cold', A.isGoingCold({ status: 'closed', lastContact: '2026-06-01' }, '2026-06-20') === false);

// Goal status (pure)
const _wg = { kind: 'weight', start: 180, target: 170, deadline: '2026-07-10', createdAt: '2026-06-10' };
const _gs = A.goalStatus(_wg, 175, Date.parse('2026-06-25T12:00:00'));
ok('goalStatus weight halfway + on track', _gs.pct === 50 && _gs.reached === false && _gs.onTrack === true);
ok('goalStatus reached', A.goalStatus({ kind: 'savings', start: 0, target: 1000 }, 1000, Date.now()).reached === true);
ok('goalStatus behind pace', A.goalStatus(_wg, 178, Date.parse('2026-06-25T12:00:00')).onTrack === false);
ok('goalStatus no goal → null', A.goalStatus(null, 0, Date.now()) === null);
// Next step (pure)
ok('nextStep: log when not logged', A.pickNextStep({ loggedToday: false }).title === 'Log today');
ok('nextStep: protein gap', /short on protein/.test(A.pickNextStep({ loggedToday: true, nutOn: true, anyFood: true, proteinLeft: 42 }).title));
ok('nextStep: gym when untrained', /trained/.test(A.pickNextStep({ loggedToday: true, nutOn: true, anyFood: true, proteinLeft: 5, gymOn: true, gymDone: false }).title));
ok('nextStep: goal reached wins', /reached your goal/.test(A.pickNextStep({ goalReached: true, loggedToday: false }).title));
ok('nextStep: on-track fallback', /on track/.test(A.pickNextStep({ loggedToday: true, nutOn: true, anyFood: true, proteinLeft: 5, gymOn: true, gymDone: true }).title));

// Food DB + macros (the banana + 80g rice + 120g chicken example)
const banana = A.findFood('banana'), rice = A.findFood('rice, white'), chicken = A.findFood('chicken breast');
ok('food DB finds banana/rice/chicken', !!(banana && rice && chicken));
const mC = A.foodMacros(chicken, 120);
approx('120g chicken protein ≈ 37g', mC.p, 37.2, 0.5);
const tot = A.foodLogTotals([A.foodMacros(banana, banana.sg), A.foodMacros(rice, 80), mC]);
approx('example total calories ~407', tot.kcal, 407, 4);
approx('example total protein ~40.7g', tot.p, 40.7, 0.6);
eq('foodLogTotals empty', A.foodLogTotals([]), { kcal: 0, p: 0, c: 0, f: 0 });
// Food amount units → grams
ok('unitToGrams g', A.unitToGrams(150, 'g') === 150);
ok('unitToGrams mL ≈ g (liquid)', A.unitToGrams(500, 'ml') === 500);
ok('unitToGrams litre = 1000 g', A.unitToGrams(1, 'l') === 1000);
ok('unitToGrams oz = 28.35 g', Math.abs(A.unitToGrams(2, 'oz') - 56.7) < 0.001);
ok('unitToGrams serving uses food.sg', A.unitToGrams(2, 'serving', { sg: 118 }) === 236);

// Nutrition advice (instant, rule-based coaching)
const _nt = { calories: 3000, protein: { g: 160 }, carbs: { g: 300 }, fat: { g: 80 } };
ok('advice: no target → empty', A.nutritionAdvice({ kcal: 500, p: 20 }, null) === '');
ok('advice: low protein when calories used', /protein-heavy/.test(A.nutritionAdvice({ kcal: 2000, p: 50, c: 250, f: 60 }, _nt)));
ok('advice: targets hit', /Targets hit/.test(A.nutritionAdvice({ kcal: 2900, p: 170, c: 280, f: 75 }, _nt)));
ok('advice: over calories warns', /over your target/.test(A.nutritionAdvice({ kcal: 3300, p: 160, c: 300, f: 80 }, _nt)));
ok('advice: protein hit with cals left', /Protein goal hit/.test(A.nutritionAdvice({ kcal: 1800, p: 165, c: 180, f: 50 }, _nt)));
ok('advice: early progress shows remaining', /to go/.test(A.nutritionAdvice({ kcal: 600, p: 30, c: 60, f: 20 }, _nt)));

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
ok('levels are mountain stations (Base Camp → Summit)', A.getLevel(0).label === 'Base Camp' && A.getLevel(5000).label === 'Summit');

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
ok('reminderDue: dated future not due', A.reminderDue({ enabled: true, _lastFired: '', time: '08:00', date: '2099-01-01' }, '09:00', _t) === false);
ok('reminderDue: dated today is due', A.reminderDue({ enabled: true, _lastFired: '', time: '08:00', date: _t }, '09:00', _t) === true);
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
// best streak = longest consecutive run ever (record), gap resets the run
A.state.data = { profile: { pillars: dp }, weeks: [], weights: [], days: [
  { date: '2026-06-01' }, { date: '2026-06-02' }, { date: '2026-06-03' }, { date: '2026-06-05' }, { date: '2026-06-06' } ] };
ok('bestStreak = longest run (3, gap resets)', A.bestStreak() === 3);
ok('bestStreak single day = 1', (() => { A.state.data.days = [{ date: '2026-06-01' }]; return A.bestStreak() === 1; })());
ok('bestStreak empty = 0', (() => { A.state.data.days = []; return A.bestStreak() === 0; })());
A.state.data.days = [{ date: _sd0, gym: { done: true }, reading: { pages: 15 }, networking: { count: 3 }, water: 1.5 }];
const _ws = A.weekShareStats();
ok('weekShareStats reads today', _ws.daysLogged === 1 && _ws.workouts === 1 && _ws.pages === 15 && _ws.connections === 3);
const _rows = A.weekGoalRows();
ok('weekGoalRows shows value vs weekly target per goal', _rows.length >= 1 &&
  _rows.some(r => r.label === 'Workouts' && r.value === 1 && r.target === 5 && r.hit === false) &&
  _rows.some(r => r.label === 'Connections' && r.value === 3 && r.target === 3 && r.hit === true));
// pendingShareMilestone — fires once per streak milestone, then is suppressed
const _ms7 = []; for (let i = 0; i < 7; i++) { const dt = new Date(); dt.setDate(dt.getDate() - i); _ms7.push({ date: dt.toISOString().split('T')[0], gym: { done: true } }); }
A.state.data = { profile: { pillars: dp }, weeks: [], weights: [], days: _ms7 };
ok('pendingShareMilestone fires at a 7-day streak', (() => { const m = A.pendingShareMilestone(); return m && m.kind === 'streak' && m.n === 7; })());
ok('pendingShareMilestone suppressed once that milestone is seen', (() => { A.state.data.profile._sharePrompts = { s7: true }; return A.pendingShareMilestone() === null; })());

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
ok('daysSince ~5 days ago (4–6, time-independent)', (() => { const v = A.daysSince(new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0]); return v >= 4 && v <= 6; })());
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
// daily cadence — income asked per day, keyed by full date
ok('periodKeyFor daily = full date', A.periodKeyFor(_today, 'daily') === _today);
A.state.data = { profile: { pillars: dp, incomeCadence: 'daily' }, weeks: [], weights: [], incomes: {}, days: [{ date: _today, spent: 20 }] };
A.setPeriodIncome('daily', _today, 150);
ok('setPeriodIncome daily → incomes[date]', A.state.data.incomes[_today] === 150);
const _dp = A.getMoneyPeriod();
ok('getMoneyPeriod daily net', _dp.label === 'day' && _dp.income === 150 && _dp.spent === 20 && _dp.net === 130);
// Carryover: prior period savings roll into the next period's available money
const _cm = new Date().toISOString().slice(0, 7);
const _lm = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
A.state.data = { profile: { pillars: dp, incomeCadence: 'monthly' }, weeks: [], weights: [],
  incomes: { [_lm]: 1000, [_cm]: 2000 },
  days: [{ date: _lm + '-15', spent: 400 }, { date: new Date().toISOString().split('T')[0], spent: 500 }] };
ok('carryover = prior period net (1000−400)', A.getCarryover() === 600);
const _circ = A.getMoneyCircle();
ok('money circle rolls savings forward', _circ.carryover === 600 && _circ.income === 2000 && _circ.spent === 500 && _circ.available === 2600 && _circ.savedTotal === 2100);
ok('money circle spent fraction', Math.abs(_circ.spentFrac - (500 / 2600)) < 0.001);
// demo preview data shape
const _demo = A.buildDemoData();
ok('buildDemoData shape (21 days, profile, income, books)', _demo.days.length === 21 && !!_demo.profile && Object.keys(_demo.incomes).length >= 1 && _demo.books.length === 2 && _demo.days.every(d => !!d.date));
// The live demo must leave NO section blank — every hub has content.
ok('demo: current book has chapters + totalPages; one finished book', (() => {
  const cur = _demo.books.find(b => b.status === 'reading'), fin = _demo.books.find(b => b.status === 'finished');
  return cur && cur.totalPages > 0 && Array.isArray(cur.chapters) && cur.chapters.length >= 3 && fin && !!fin.finishedDate;
})());
ok('demo: reading notes carry chapter/page/quote', _demo.days.some(d => d.reading && d.reading.pages > 0 && d.reading.chapter && d.reading.page > 0 && d.reading.quote));
ok('demo: workouts have real exercises + sets', _demo.days.some(d => d.gym && d.gym.done && Array.isArray(d.gym.exercises) && d.gym.exercises[0].sets.length > 0));
ok('demo: eaten macros present daily', _demo.days.every(d => d.eaten && d.eaten.protein > 0));
ok('demo: vocab seeded with context + a word due for review', _demo.vocab.length >= 3 && _demo.vocab.some(w => w.context) && A.vocabDue(_demo.vocab, _demo.days[20].date).length >= 1);
ok('demo: takeaways seeded and due for the quiz', _demo.takeaways.length >= 2 && A.vocabDue(_demo.takeaways, _demo.days[20].date).length >= 1);
ok('demo: finance snapshot complete (metrics compute)', (() => {
  const m = A.financeMetrics(_demo.finance); return m.netWorth === 49600 && m.savingsRate > 0 && _demo.finance.snapshots.length >= 2 && _demo.finance.debts.length >= 1;
})());
ok('demo: contacts form a pipeline with value + follow-ups', (() => {
  const pv = A.pipelineValue(_demo.contacts); return pv.open > 0 && pv.won > 0 && _demo.contacts.some(c => c.followUpDate);
})());
ok('demo: a scored idea with tasks + validation', _demo.ideas.some(i => i.scores && A.ideaScore(i.scores) > 0 && (i.tasks || []).length && i.validation && i.validation.customer));
ok('demo: checklist + reminders seeded', _demo.checklist.length >= 2 && _demo.reminders.length >= 1);

// subscription gate (free trial → paywall)
A.state.isOwner = false; A.state.paymentsLive = true;
A.state.data = { profile: { pro: false, trialEnds: Date.now() + 5 * 86400000 } };
ok('trial active → not locked, days left', (() => { const s = A.subStatus(); return s.trialing && s.daysLeft >= 4 && s.daysLeft <= 5 && !s.locked; })());
A.state.data = { profile: { pro: false, trialEnds: Date.now() - 86400000 } };
ok('trial expired + payments live → locked', A.subStatus().locked === true);
A.state.paymentsLive = false;
ok('expired but payments off → NOT locked (no lockout before Stripe)', A.subStatus().locked === false);
A.state.paymentsLive = true;
A.state.data = { profile: { pro: true, trialEnds: Date.now() - 86400000 } };
ok('pro user → never locked', A.subStatus().pro === true && A.subStatus().locked === false);
A.state.isOwner = true; A.state.data = { profile: { trialEnds: Date.now() - 999999999 } };
ok('owner → always pro/unlocked', A.subStatus().pro === true && A.subStatus().locked === false);
A.state.isOwner = false; A.state.paymentsLive = false;

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
  eq('cloud defaultData shape', Object.keys(C.defaultData()).sort(), ['books', 'contacts', 'days', 'ideas', 'meals', 'profile', 'weeks', 'weights']);
  // Community meal sanitizer
  const cm = C.cleanMeal({ name: '  Protein Bowl  ', kcal: '650.4', p: 55, c: '40', f: 20, servings: 2, notes: 'tasty' });
  ok('cleanMeal trims + rounds', cm.name === 'Protein Bowl' && cm.kcal === 650 && cm.c === 40 && cm.servings === 2);
  ok('cleanMeal clamps absurd values', C.cleanMeal({ name: 'x', kcal: 9e9, p: -5 }).kcal === 20000 && C.cleanMeal({ name: 'x', p: -5 }).p === 0);
  ok('cleanMeal caps long name to 80', C.cleanMeal({ name: 'a'.repeat(200) }).name.length === 80);
  ok('cleanMeal servings floor 1', C.cleanMeal({ name: 'x', servings: 0 }).servings === 1);
  // Recipe meals: totals are summed from ingredients (client-sent totals are ignored)
  const acai = C.cleanMeal({ name: 'Açaí bowl', kcal: 9999, p: 9999, ingredients: [
    { name: 'Açaí', amount: '250g', kcal: 250, p: 20, c: 10, f: 15 },
    { name: 'Banana', amount: '1', p: 10 },
    { name: 'Strawberry', amount: '3', kcal: 50 },
    { name: 'Blueberry', amount: '20 g', c: 13 }
  ] });
  ok('cleanMeal sums ingredient macros', acai.kcal === 300 && acai.p === 30 && acai.c === 23 && acai.f === 15);
  ok('cleanMeal keeps the ingredient list + amounts', acai.ingredients.length === 4 && acai.ingredients[0].name === 'Açaí' && acai.ingredients[0].amount === '250g');
  ok('cleanMeal drops fully-empty ingredient rows', C.cleanMeal({ name: 'x', ingredients: [{ name: '', kcal: 0 }, { name: 'Egg', kcal: 70 }] }).ingredients.length === 1);
  // Meal photo: only small image data URLs survive
  ok('cleanMeal keeps a small image data URL', C.cleanMeal({ name: 'x', kcal: 1, photo: 'data:image/jpeg;base64,' + 'A'.repeat(200) }).photo.indexOf('data:image/jpeg;base64,') === 0);
  ok('cleanMeal strips a non-image photo', C.cleanMeal({ name: 'x', kcal: 1, photo: 'https://evil.example/x.js' }).photo === '');
  ok('cleanMeal strips an oversized photo', C.cleanMeal({ name: 'x', kcal: 1, photo: 'data:image/png;base64,' + 'A'.repeat(200000) }).photo === '');
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
  ok('push dated reminder fires on its day', P.isReminderDue({ enabled: true, _lastFired: '', time: '08:00', date: '2026-06-03' }, '09:00', '2026-06-03') === true);
  ok('push dated reminder not before its day', P.isReminderDue({ enabled: true, _lastFired: '', time: '08:00', date: '2026-06-10' }, '09:00', '2026-06-03') === false);
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

  // Protein nudge gate (evening, logged food, short on protein)
  ok('protein nudge due (short by ≥25g, past hour)', P.isProteinNudgeDue({ hhmm: '19:30', date: D, loggedFood: true, eatenProtein: 90, targetProtein: 160, lastNudge: '' }) === true);
  ok('protein nudge not due before the hour', P.isProteinNudgeDue({ hhmm: '15:00', date: D, loggedFood: true, eatenProtein: 90, targetProtein: 160, lastNudge: '' }) === false);
  ok('protein nudge not due when close to target', P.isProteinNudgeDue({ hhmm: '20:00', date: D, loggedFood: true, eatenProtein: 140, targetProtein: 160, lastNudge: '' }) === false);
  ok('protein nudge not due if no food logged', P.isProteinNudgeDue({ hhmm: '20:00', date: D, loggedFood: false, eatenProtein: 0, targetProtein: 160, lastNudge: '' }) === false);
  ok('protein nudge not due without a target', P.isProteinNudgeDue({ hhmm: '20:00', date: D, loggedFood: true, eatenProtein: 0, targetProtein: 0, lastNudge: '' }) === false);
  ok('protein nudge not due if already nudged today', P.isProteinNudgeDue({ hhmm: '20:00', date: D, loggedFood: true, eatenProtein: 90, targetProtein: 160, lastNudge: D }) === false);
  ok('protein nudge disabled when off', P.isProteinNudgeDue({ hhmm: '20:00', date: D, loggedFood: true, eatenProtein: 90, targetProtein: 160, lastNudge: '', enabled: false }) === false);
  ok('protein nudge respects custom hour', P.isProteinNudgeDue({ hhmm: '17:00', date: D, loggedFood: true, eatenProtein: 90, targetProtein: 160, lastNudge: '', hour: 17 }) === true);
  // vocabulary practice nudge
  ok('vocab nudge due (has words, past hour, roll passes)', P.isVocabNudgeDue({ hhmm: '13:30', date: D, wordCount: 5, lastNudge: '', roll: 0.1, chance: 0.5 }) === true);
  ok('vocab nudge not due before the hour', P.isVocabNudgeDue({ hhmm: '09:00', date: D, wordCount: 5, lastNudge: '', roll: 0.1 }) === false);
  ok('vocab nudge not due with no saved words', P.isVocabNudgeDue({ hhmm: '15:00', date: D, wordCount: 0, lastNudge: '', roll: 0.1 }) === false);
  ok('vocab nudge not due if already nudged today', P.isVocabNudgeDue({ hhmm: '15:00', date: D, wordCount: 5, lastNudge: D, roll: 0.1 }) === false);
  ok('vocab nudge respects the random roll', P.isVocabNudgeDue({ hhmm: '15:00', date: D, wordCount: 5, lastNudge: '', roll: 0.9, chance: 0.5 }) === false);
  ok('vocab nudge disabled when off', P.isVocabNudgeDue({ hhmm: '15:00', date: D, wordCount: 5, lastNudge: '', roll: 0.1, enabled: false }) === false);

  // daily motivation push (unconditional encouragement, morning)
  ok('motivation due (past morning hour)', P.isMotivationDue({ hhmm: '08:30', date: D, lastSent: '' }) === true);
  ok('motivation not due before the hour', P.isMotivationDue({ hhmm: '06:00', date: D, lastSent: '' }) === false);
  ok('motivation not due if already sent today', P.isMotivationDue({ hhmm: '10:00', date: D, lastSent: D }) === false);
  ok('motivation disabled when off', P.isMotivationDue({ hhmm: '10:00', date: D, lastSent: '', enabled: false }) === false);
  ok('motivation respects custom hour', P.isMotivationDue({ hhmm: '07:00', date: D, lastSent: '', hour: 7 }) === true);
  ok('motivation fires regardless of logging (no loggedToday gate)', P.isMotivationDue({ hhmm: '09:00', date: D, lastSent: '', loggedToday: true }) === true);
  const m1 = P.motivationFor('2026-06-27');
  ok('motivationFor returns a title and body', !!(m1 && m1.title && m1.body));
  ok('motivationFor is deterministic for a date', P.motivationFor('2026-06-27').body === m1.body);
  ok('motivationFor differs across days', P.motivationFor('2026-06-27').body !== P.motivationFor('2026-06-28').body);
  ok('motivationFor cycles (same line 24 days apart)', P.motivationFor('2026-06-27').body === P.motivationFor('2026-07-21').body);
  ok('motivationFor prepends the name', P.motivationFor('2026-06-27', 'Ahmed').body.indexOf('Ahmed — ') === 0);
  ok('motivationFor without a name has no separator prefix', P.motivationFor('2026-06-27').body.indexOf(' — ') !== 0);

  // plan-tomorrow's-workout nudge (evening, active gym-goers, not yet planned)
  ok('plan nudge due (evening, trains, no plan)', P.isPlanWorkoutDue({ trains: true, hasPlan: false, hhmm: '20:30', date: D, lastNudge: '' }) === true);
  ok('plan nudge not due before the hour', P.isPlanWorkoutDue({ trains: true, hasPlan: false, hhmm: '17:00', date: D, lastNudge: '' }) === false);
  ok('plan nudge not due if they already planned', P.isPlanWorkoutDue({ trains: true, hasPlan: true, hhmm: '21:00', date: D, lastNudge: '' }) === false);
  ok('plan nudge not due for non-gym users', P.isPlanWorkoutDue({ trains: false, hasPlan: false, hhmm: '21:00', date: D, lastNudge: '' }) === false);
  ok('plan nudge not due if already nudged today', P.isPlanWorkoutDue({ trains: true, hasPlan: false, hhmm: '21:00', date: D, lastNudge: D }) === false);
  ok('plan nudge disabled when off', P.isPlanWorkoutDue({ trains: true, hasPlan: false, hhmm: '21:00', date: D, lastNudge: '', enabled: false }) === false);
  ok('plan nudge respects a custom hour', P.isPlanWorkoutDue({ trains: true, hasPlan: false, hhmm: '18:00', date: D, lastNudge: '', hour: 18 }) === true);
  ok('plan nudge default hour is 20 (8pm)', P.isPlanWorkoutDue({ trains: true, hasPlan: false, hhmm: '19:30', date: D, lastNudge: '' }) === false);
}

// ─────────────────────────────────────────────────────────────
// WORKOUT TRACKER — exercise library + set/rep totals + rest clock
// ─────────────────────────────────────────────────────────────
const _wo = [
  { name: 'Bench Press', muscle: 'Chest', sets: [{ reps: 10, weight: 60 }, { reps: 8, weight: 70 }] },
  { name: 'Push-Up', muscle: 'Chest', sets: [{ reps: 20, weight: 0 }] }
];
const _wt = A.workoutTotals(_wo);
eq('workoutTotals: exercise count', _wt.exercises, 2);
eq('workoutTotals: total sets', _wt.sets, 3);
eq('workoutTotals: total reps (10+8+20)', _wt.reps, 38);
eq('workoutTotals: volume (10*60 + 8*70)', _wt.volume, 1160);
ok('workoutTotals: bodyweight set counts (reps>0, weight 0)', _wt.sets === 3);
const _wtEmpty = A.workoutTotals([]);
ok('workoutTotals: empty workout → zeros', _wtEmpty.sets === 0 && _wtEmpty.reps === 0 && _wtEmpty.volume === 0);
// Timed exercises (cardio + isometric holds) log seconds, not reps/weight
ok('isTimedExercise: all cardio is timed', A.EXERCISE_LIBRARY.Cardio.every(n => A.isTimedExercise(n, 'Cardio')));
ok('isTimedExercise: Plank is timed', A.isTimedExercise('Plank', 'Core'));
ok('isTimedExercise: Side Plank is timed', A.isTimedExercise('Side Plank', 'Core'));
ok('isTimedExercise: Hollow Hold is timed', A.isTimedExercise('Hollow Hold', 'Core'));
ok('isTimedExercise: Bench Press is NOT timed', !A.isTimedExercise('Barbell Bench Press', 'Chest'));
ok('isTimedExercise: Back Squat is NOT timed', !A.isTimedExercise('Back Squat', 'Legs'));
ok('isTimedExercise: Crunch (reps) is NOT timed', !A.isTimedExercise('Crunch', 'Core'));
const _wtTimed = A.workoutTotals([{ name: 'Plank', muscle: 'Core', sets: [{ secs: 60 }, { secs: 45 }] }, { name: 'Treadmill Run', muscle: 'Cardio', sets: [{ secs: 1200 }] }]);
ok('workoutTotals: timed sets counted (3 sets)', _wtTimed.sets === 3);
ok('workoutTotals: timed adds seconds (60+45+1200)', _wtTimed.secs === 1305);
ok('workoutTotals: timed adds no reps or volume', _wtTimed.reps === 0 && _wtTimed.volume === 0);
const _wtMixed = A.workoutTotals([{ name: 'Bench', muscle: 'Chest', sets: [{ reps: 10, weight: 60 }] }, { name: 'Plank', muscle: 'Core', sets: [{ secs: 90 }] }]);
ok('workoutTotals: mixed reps + time', _wtMixed.sets === 2 && _wtMixed.reps === 10 && _wtMixed.volume === 600 && _wtMixed.secs === 90);
ok('workoutTotals: ignores a set with no reps and no weight', A.workoutTotals([{ name: 'x', sets: [{ reps: 0, weight: 0 }] }]).sets === 0);
ok('workoutTotals: handles junk input', A.workoutTotals(null).exercises === 0 && A.workoutTotals(undefined).sets === 0);
// Library search
ok('searchExercises: empty query returns the whole library', A.searchExercises('').length === Object.values(A.EXERCISE_LIBRARY).reduce((s, a) => s + a.length, 0));
ok('searchExercises: matches by name', A.searchExercises('squat').some(e => /Squat/.test(e.name)));
ok('searchExercises: name search is case-insensitive', A.searchExercises('BENCH').some(e => /Bench/.test(e.name)));
ok('searchExercises: filters by muscle group', A.searchExercises('', 'Back').every(e => e.muscle === 'Back'));
ok('searchExercises: "All" filter is the same as no filter', A.searchExercises('', 'All').length === A.searchExercises('').length);
ok('searchExercises: no match → empty', A.searchExercises('zzzznotreal').length === 0);
ok('EXERCISE_LIBRARY: has the 7 muscle groups', ['Chest','Back','Legs','Shoulders','Arms','Core','Cardio'].every(k => Array.isArray(A.EXERCISE_LIBRARY[k]) && A.EXERCISE_LIBRARY[k].length));
ok('EXERCISE_LIBRARY: 120+ exercises total', Object.values(A.EXERCISE_LIBRARY).reduce((s, a) => s + a.length, 0) >= 120);
ok('EXERCISE_LIBRARY: every group has 15+ exercises', Object.values(A.EXERCISE_LIBRARY).every(a => a.length >= 15));
ok('EXERCISE_LIBRARY: no duplicate names within a group', Object.values(A.EXERCISE_LIBRARY).every(a => new Set(a.map(n => n.toLowerCase())).size === a.length));
// Rest clock formatting
eq('formatClock: 90s → 1:30', A.formatClock(90), '1:30');
eq('formatClock: 60s → 1:00', A.formatClock(60), '1:00');
eq('formatClock: 5s → 0:05 (pads)', A.formatClock(5), '0:05');
eq('formatClock: 0 → 0:00', A.formatClock(0), '0:00');
eq('formatClock: clamps negatives', A.formatClock(-10), '0:00');
// Day label from the workout
eq('topMuscle: most-trained group wins', A.topMuscle(_wo), 'Chest');
eq('topMuscle: empty → ""', A.topMuscle([]), '');
// Ready-made programs + exercise→group lookup
eq('exerciseGroup: Back Squat → Legs', A.exerciseGroup('Back Squat'), 'Legs');
eq('exerciseGroup: Plank → Core', A.exerciseGroup('Plank'), 'Core');
eq('exerciseGroup: unknown → ""', A.exerciseGroup('Nonsense Lift'), '');
ok('EXERCISE_LIBRARY: HIIT + steady cardio additions present (and timed)', ['Bike Sprints', 'Wall Balls', 'Zone 2 Run', 'Rucking'].every(n => A.exerciseGroup(n) === 'Cardio' && A.isTimedExercise(n, 'Cardio')));
ok('EXERCISE_LIBRARY: chest additions present', ['Plyo Push-Up', 'Machine Fly', 'Weighted Push-Up'].every(n => A.exerciseGroup(n) === 'Chest'));
ok('WORKOUT_PROGRAMS: goal-based programs present (fat burn / HIIT / steady / muscle)', ['HIIT Cardio (Fat Burn)', 'Steady Cardio (Endurance)', 'Fat Burn — Full Body', 'Fat Burn — Chest Focus', 'Muscle Builder — Chest'].every(k => Array.isArray(A.WORKOUT_PROGRAMS[k]) && A.WORKOUT_PROGRAMS[k].length >= 4));
ok('WORKOUT_PROGRAMS: has several programs', Object.keys(A.WORKOUT_PROGRAMS).length >= 5);
ok('WORKOUT_PROGRAMS: every program has 4+ exercises', Object.values(A.WORKOUT_PROGRAMS).every(list => list.length >= 4));
ok('WORKOUT_PROGRAMS: every exercise is a real library exercise', Object.values(A.WORKOUT_PROGRAMS).every(list => list.every(n => A.exerciseGroup(n) !== '')));
ok('WORKOUT_PROGRAMS: a loaded program maps every exercise to a muscle', Object.values(A.WORKOUT_PROGRAMS).every(list => list.every(n => A.musclesForExercise(n, A.exerciseGroup(n)).primary.length > 0)));
// Goal-tailored rep scheme + rests
ok('repScheme: muscle gain = more sets, heavier, longer rest', A.repSchemeForGoal('gain').rest === 120 && /4–5/.test(A.repSchemeForGoal('gain').sets));
ok('repScheme: fat loss = higher reps, short rest', A.repSchemeForGoal('lose').rest === 60 && /12–15/.test(A.repSchemeForGoal('lose').reps));
ok('repScheme: maintain = balanced 90s rest', A.repSchemeForGoal('maintain').rest === 90 && /8–12/.test(A.repSchemeForGoal('maintain').reps));
ok('repScheme: each goal has a label and tip', ['gain','lose','maintain'].every(g => A.repSchemeForGoal(g).label && A.repSchemeForGoal(g).tip));
ok('repScheme: rest matches a timer preset', ['gain','lose','maintain'].every(g => [60,90,120,180].includes(A.repSchemeForGoal(g).rest)));
// tailorProgram: fat loss adds a conditioning finisher; others unchanged
const _base = A.WORKOUT_PROGRAMS['Push Day'];
ok('tailorProgram: fat loss appends a cardio finisher', A.tailorProgram(_base, 'lose').length === _base.length + 1 && A.exerciseGroup(A.tailorProgram(_base, 'lose').slice(-1)[0]) === 'Cardio');
ok('tailorProgram: muscle gain leaves the exercises as-is', A.tailorProgram(_base, 'gain').length === _base.length);
ok('tailorProgram: no double finisher if already present', A.tailorProgram(A.tailorProgram(_base, 'lose'), 'lose').filter(n => n === 'HIIT Intervals').length === 1);
ok('tailorProgram: handles empty input', A.tailorProgram(null, 'lose').length === 0);
// Plan-ahead label
eq('plannedWorkoutLabel: a program', A.plannedWorkoutLabel({ program: 'Push Day' }), 'Push Day');
eq('plannedWorkoutLabel: own choice', A.plannedWorkoutLabel({ own: true }), 'Choose at the gym');
eq('plannedWorkoutLabel: nothing planned', A.plannedWorkoutLabel(null), '');
// Muscle map: which muscles each exercise hits
const mfe = (n, g) => A.musclesForExercise(n, g);
ok('muscles: Bench Press → chest primary', mfe('Barbell Bench Press', 'Chest').primary.includes('chest'));
ok('muscles: Push-Up also hits triceps', mfe('Push-Up', 'Chest').primary.includes('triceps'));
ok('muscles: Barbell Curl → biceps, not triceps', mfe('Barbell Curl', 'Arms').primary.includes('biceps') && !mfe('Barbell Curl', 'Arms').primary.includes('triceps'));
ok('muscles: Triceps Pushdown → triceps', mfe('Triceps Pushdown', 'Arms').primary.includes('triceps'));
ok('muscles: Wrist Curl → forearms', mfe('Wrist Curl', 'Arms').primary.includes('forearms'));
ok('muscles: Hammer Curl adds forearms (secondary)', mfe('Hammer Curl', 'Arms').secondary.includes('forearms'));
ok('muscles: Lateral Raise → side delts', mfe('Lateral Raise', 'Shoulders').primary.includes('sideDelts'));
ok('muscles: Rear Delt Fly → rear delts', mfe('Rear Delt Fly', 'Shoulders').primary.includes('rearDelts'));
ok('muscles: Deadlift → posterior chain (lower back/glutes/hamstrings)', ['lowerBack','glutes','hamstrings'].every(m => mfe('Deadlift', 'Back').primary.includes(m)));
ok('muscles: Pull-Up → lats (biceps secondary)', mfe('Pull-Up', 'Back').primary.includes('lats') && mfe('Pull-Up', 'Back').secondary.includes('biceps'));
ok('muscles: Back Squat → quads + glutes', ['quads','glutes'].every(m => mfe('Back Squat', 'Legs').primary.includes(m)));
ok('muscles: Romanian Deadlift → hamstrings + glutes', ['hamstrings','glutes'].every(m => mfe('Romanian Deadlift', 'Legs').primary.includes(m)));
ok('muscles: Calf Raise → calves', mfe('Calf Raise', 'Legs').primary.includes('calves'));
ok('muscles: Russian Twist → obliques', mfe('Russian Twist', 'Core').primary.includes('obliques'));
ok('muscles: Plank → abs', mfe('Plank', 'Core').primary.includes('abs'));
ok('muscles: Treadmill Run → cardio/full body', mfe('Treadmill Run', 'Cardio').primary.includes('cardio'));
ok('muscles: every library exercise maps to at least one muscle',
  Object.keys(A.EXERCISE_LIBRARY).every(g => A.EXERCISE_LIBRARY[g].every(n => mfe(n, g).primary.length > 0)));
ok('muscles: every primary id has a display name', Object.keys(A.MUSCLE_NAMES).length >= 16);
// Body SVG highlights the targeted muscle in green, leaves an empty map neutral
ok('muscleMapSVG: returns an <svg>', /^<svg[\s>]/.test(A.muscleMapSVG(['chest'], [])));
ok('muscleMapSVG: targeted muscle is filled green', A.muscleMapSVG(['chest'], []).includes('#10B981'));
ok('muscleMapSVG: empty map has no green fill', !A.muscleMapSVG([], []).includes('#10B981'));
ok('muscleMapSVG: shows both Front and Back', A.muscleMapSVG([], []).includes('Front') && A.muscleMapSVG([], []).includes('Back'));
// Body-part filter: a chosen group shows ONLY that group's exercises
['Chest','Back','Legs','Shoulders','Arms','Core','Cardio'].forEach(part => {
  const only = A.searchExercises('', part);
  ok('library filter "' + part + '" returns only ' + part + ' exercises', only.length > 0 && only.every(e => e.muscle === part));
});
// Gym-log muscle label → library group (so picking a part in the log pre-filters)
eq('normalizeLibMuscle: exact group matches', A.normalizeLibMuscle('Chest'), 'Chest');
eq('normalizeLibMuscle: case-insensitive (from full form)', A.normalizeLibMuscle('legs'), 'Legs');
eq('normalizeLibMuscle: Push has no single group → ""', A.normalizeLibMuscle('Push'), '');
eq('normalizeLibMuscle: Full Body → "" (picker)', A.normalizeLibMuscle('Full Body'), '');
eq('normalizeLibMuscle: empty → ""', A.normalizeLibMuscle(''), '');

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
    let dupBlocked = false;
    try { await DBm.createUser({ username: 'tuser', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null }); }
    catch { dupBlocked = true; }
    ok('DB blocks duplicate username (unique constraint)', dupBlocked === true);
    // email + phone: one account per person
    await DBm.createUser({ username: 'emailer', email: 'a@b.com', phone: '+15551234', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null });
    ok('DB findUserByEmail (case-insensitive)', (await DBm.findUserByEmail('A@B.COM'))?.username === 'emailer');
    ok('DB findUserByPhone', (await DBm.findUserByPhone('+15551234'))?.username === 'emailer');
    ok('DB findUserByEmail missing → null', (await DBm.findUserByEmail('none@x.com')) === null);
    let dupEmail = false;
    try { await DBm.createUser({ username: 'emailer2', email: 'a@b.com', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null }); }
    catch { dupEmail = true; }
    ok('DB blocks duplicate email (unique constraint)', dupEmail === true);
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
    ok('DB allUsers returns rows with created_at', allU.length >= 1 && allU.some(u => u.username === 'tuser') && allU.every(u => !!u.created_at));
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
    // ── community shared meals ──
    const mid = await DBm.createSharedMeal({ user_id: id, author_name: 'Ahmed', name: 'Oatmeal Bowl', kcal: 520, p: 38, c: 60, f: 12, servings: 1, notes: '',
      ingredients: [{ name: 'Oats', amount: '80g', kcal: 300, p: 10, c: 50, f: 5 }, { name: 'Whey', amount: '1 scoop', kcal: 120, p: 24 }], photo: 'data:image/jpeg;base64,QQ==' });
    ok('DB createSharedMeal returns id', !!mid);
    const oat0 = (await DBm.listSharedMeals('oatmeal'))[0];
    ok('DB shared meal stores + returns ingredients', Array.isArray(oat0.ingredients) && oat0.ingredients.length === 2 && oat0.ingredients[0].name === 'Oats' && oat0.ingredients[0].amount === '80g');
    ok('DB shared meal stores + returns photo', oat0.photo === 'data:image/jpeg;base64,QQ==');
    await DBm.createSharedMeal({ user_id: id, author_name: 'Ahmed', name: 'Chicken Wrap', kcal: 600, p: 45, c: 50, f: 18 });
    let feed = await DBm.listSharedMeals('');
    ok('DB listSharedMeals returns shared meals', feed.length === 2 && feed.some(m => m.name === 'Oatmeal Bowl'));
    ok('DB listSharedMeals search filters by name', (await DBm.listSharedMeals('wrap')).length === 1);
    await DBm.incSharedMealUse(mid); await DBm.incSharedMealUse(mid);
    ok('DB incSharedMealUse counts uses', (await DBm.listSharedMeals('oatmeal'))[0].uses === 2);
    for (let i = 0; i < 5; i++) await DBm.flagSharedMeal(mid);
    ok('DB flagged meal (≥5) hidden from feed', (await DBm.listSharedMeals('oatmeal')).length === 0);
    const delMine = await DBm.deleteSharedMeal(mid, 99999, false); // wrong user → no delete
    ok('DB deleteSharedMeal blocks non-author', delMine === false);
    const delForce = await DBm.deleteSharedMeal(mid, id, false); // author → deletes
    ok('DB deleteSharedMeal author removes own', delForce === true && (await DBm.listSharedMeals('')).length === 1);
    // ── community posts (thoughts / training programs / meals) ──
    const pid = await DBm.createPost({ user_id: id, author_name: 'Ahmed', type: 'program', title: 'PPL 6-day', body: 'Push pull legs', data: { goal: 'gain', daysPerWeek: 6 } });
    ok('DB createPost returns id', !!pid);
    await DBm.createPost({ user_id: id, author_name: 'Ahmed', type: 'thought', body: 'Consistency beats intensity' });
    await DBm.createPost({ user_id: id, author_name: 'Sam', type: 'meal', title: 'Protein oats', data: { kcal: 450, p: 35 } });
    const allPosts = await DBm.listPosts('');
    ok('DB listPosts returns all, newest first', allPosts.length === 3 && allPosts[0].type === 'meal');
    ok('DB listPosts filters by type', (await DBm.listPosts('program')).length === 1);
    ok('DB listPosts parses the data object', (await DBm.listPosts('program'))[0].data.daysPerWeek === 6);
    const lk1 = await DBm.togglePostLike(pid, id);
    ok('DB togglePostLike adds a like', lk1.liked === true && lk1.count === 1);
    const lk2 = await DBm.togglePostLike(pid, id);
    ok('DB togglePostLike removes it again', lk2.liked === false && lk2.count === 0);
    for (let i = 0; i < 5; i++) await DBm.flagPost(pid);
    ok('DB flagged post (≥5) hidden from feed', !(await DBm.listPosts('')).some(p => p.id === pid));
    ok('DB deletePost blocks non-author', (await DBm.deletePost(pid, 99999, false)) === false);
    ok('DB deletePost author removes own', (await DBm.deletePost(pid, id, false)) === true);
    // server-side post sanitizer
    ok('cleanPost defaults unknown type to thought', C.cleanPost({ type: 'spam', body: 'hi' }).type === 'thought');
    ok('cleanPost keeps program goal + days/week', (() => { const p = C.cleanPost({ type: 'program', title: 'X', daysPerWeek: '6', goal: 'gain' }); return p.data.daysPerWeek === 6 && p.data.goal === 'gain'; })());
    ok('cleanPost coerces meal macros to numbers', (() => { const p = C.cleanPost({ type: 'meal', title: 'Oats', kcal: '450', p: 'x' }); return p.data.kcal === 450 && p.data.p === 0; })());
    ok('cleanPost caps very long bodies', C.cleanPost({ type: 'thought', body: 'a'.repeat(5000) }).body.length === 4000);
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
