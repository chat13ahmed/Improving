/*
 * Onward — automated test suite.
 * Run with:  npm test   (from resources/app)
 *
 * Loads public/app.js inside a mocked DOM and exercises the core logic,
 * then loads the exported server helpers. No browser or network required.
 */
'use strict';
// Pin the signing secret BEFORE cloud/server.js is required, so tests can mint
// their own tokens for fixture users. Without it the server generates a random
// secret per boot and nothing can sign a matching token.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-in-production-0123456789';
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
    Date, Math, JSON, Object, Array, parseInt, parseFloat, isNaN, String, Number, RegExp, URL, __exports__: {}
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  let code = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '\n');
  code += '\n;Object.assign(__exports__, { state, computeNutrition, mealLabels, foodMacros, findFood, foodLogTotals, unitToGrams, nutritionAdvice, goalStatus, pickNextStep, distributeMeals, groupFoodsByMeal, currentMealIndex, nutritionWeekStats, BOOK_DB, findBook, booksByAuthor, groupReadingByBook, backfillBookData, searchBooks, searchFoods, weekConnection, projectFuture, pearson, lifeWeb, yearRange, vocabStats, weeklyGoalsReached, gymPlan, momentumScore, pointAlong, peak3d, weightToBodyFactor, bodyShapeStats, sharpenScore, identityVotes, missedYesterday, todaysVotes, guidedStepKeys,' +
    ' defaultPillars, pillar, isPillarOn, enabledPillars, getLevel, computeXP, displayToKg, kgToDisplay, upsertWeight,' +
    ' recentDefaults, getRecentFoods, getWeeklyScore, getWeekStats, lastNoteEntry, renderPrevNoteBanner,' +
    ' reminderDue, isChecked, checklistProgress, ensureChecklistData,' +
    ' loggingStreak, bestStreak, computeStreak, freezeToUse, freezeAward, streakBreak, growthStage, terrainHeight, terrainGrid, currentStreakBreak, renderStreakRecoveryCard, weekStoryData, weekStorySlides, weekShareStats, weekGoalRows, pendingShareMilestone, getWeekStats, getWeekStart, daysSince,' +
    ' getMoneyPeriod, periodKeyFor, setPeriodIncome, periodSpending, getCarryover, getMoneyCircle, buildDemoData, subStatus,' +
    ' workoutTotals, searchExercises, formatClock, topMuscle, normalizeLibMuscle, isTimedExercise, EXERCISE_LIBRARY,' +
    ' ideaScore, ideaRated, ideaScoreLabel, topIdea, IDEA_DIMS, validationStage, ideaTaskProgress, stageProbability, pipelineValue, isGoingCold, daysBetween,' +
    ' musclesForExercise, muscleMapSVG, MUSCLE_NAMES, WORKOUT_PROGRAMS, exerciseGroup, repSchemeForGoal, tailorProgram, plannedWorkoutLabel, sortTakeawaysByPriority, fuelStatus, proteinFoodForGap, financeMetrics, debtPayoffMonths, yearsToFI, nextReviewBox, reviewIntervalDays, vocabDue, vocabMastered, readingPacePerDay, knowledgeYearStats, moneyMentorLessons, compoundProjection, snapshotAgeDays, wowArrow, getLastWeekStats, setupProgress, applyFinishRitual,' +
    ' todayStr, weeklyTrainingSplit, lastExercisePerformance, exerciseBestWeightEver, dealPlay, dealPlayPriority, ideaNextMove,' +
    ' knowledgeQuizPool, groupProgress, allCheckItems, healthBriefing, businessBriefing, knowledgeBriefing, weeklyGamePlan, libFilter,' +
    ' MUSCLE_PARTS, exercisePart, partMeta, exercisesByPart, libraryCount, PROGRAM_GROUPS, programSections, programPartLabel,' +
    ' safeUrl, linkHost, libGroups, hubEnabled, HUB_PILLARS, dayXp, dayCompleteStats, getLevel,' +
    ' RESET_AREAS, clearPillarData, isDayEmpty,' +
    ' ADAPT, targetWeeklyRate, weightTrend, avgIntake, estimateTDEE, adaptiveTarget, nutritionPlan,' +
    ' SAFETY, SAFETY_FLAGS, bmiOf, calorieFloor, nutritionSafety, renderAdaptCard });';
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
// applyFinishRitual — the finish-a-book ritual's pure core
(() => {
  const mk = () => ({ books: [{ id: 'b1', title: 'Atomic Habits', status: 'reading', questions: [{ id: 'q1', text: 'Why?', answered: false }, { id: 'q2', text: 'How?', answered: false }] }], takeaways: [] });
  const d1 = mk();
  const r1 = A.applyFinishRitual(d1, 'b1', { teach: 'Tiny habits compound.', action: 'Never miss twice.', verdict: 'yes', answered: [true, false], date: '2026-07-16', tid: 't1' });
  ok('ritual: finishes the book with date/teach/verdict', r1.book.status === 'finished' && r1.book.finishedDate === '2026-07-16' && r1.book.teachBack === 'Tiny habits compound.' && r1.book.verdict === 'yes');
  ok('ritual: the action becomes a Key Takeaway tied to the book', d1.takeaways.length === 1 && d1.takeaways[0].text === 'Never miss twice.' && d1.takeaways[0].book === 'Atomic Habits' && d1.takeaways[0].seenAt === '');
  ok('ritual: question answered flags recorded', r1.book.questions[0].answered === true && r1.book.questions[1].answered === false);
  const d2 = mk();
  A.applyFinishRitual(d2, 'b1', { date: '2026-07-16' });
  ok('ritual: skipping everything still finishes cleanly, no takeaway', d2.books[0].status === 'finished' && d2.takeaways.length === 0 && !d2.books[0].teachBack);
  ok('ritual: unknown book → null, nothing breaks', A.applyFinishRitual(mk(), 'nope', {}) === null);
})();
// setupProgress — the Getting Started card checks itself off against real data
(() => {
  const empty = A.setupProgress({}, { notif: 'default' });
  ok('setup: fresh account → nothing done, steps present', empty.done === 0 && empty.total >= 5 && empty.steps.every(s => s.label && s.action));
  ok('setup: first log flips its step', A.setupProgress({ days: [{ date: '2026-07-16' }] }, { notif: 'default' }).steps.find(s => s.id === 'log').done);
  ok('setup: a real goal flips the goals step', A.setupProgress({ profile: { weeklyReadGoal: 100 } }, { notif: 'default' }).steps.find(s => s.id === 'goals').done);
  ok('setup: reading pillar off → no book step', !A.setupProgress({ profile: { pillars: { reading: { enabled: false } } } }, { notif: 'default' }).steps.some(s => s.id === 'book'));
  ok('setup: unsupported notifications → step hidden', !A.setupProgress({}, { notif: 'unsupported' }).steps.some(s => s.id === 'notif'));
  ok('setup: granted notifications → step done', A.setupProgress({}, { notif: 'granted' }).steps.find(s => s.id === 'notif').done);
  ok('setup: finance snapshot flips the money step', A.setupProgress({ finance: { assets: { cash: 100 } } }, { notif: 'default' }).steps.find(s => s.id === 'finance').done);
  const full = A.setupProgress({
    days: [{ date: '2026-07-16' }], books: [{ status: 'reading' }],
    profile: { weeklyReadGoal: 100, nutrition: { age: 28, heightCm: 180, weightKg: 80, sex: 'male' } },
    finance: { monthlyIncome: 4000 }
  }, { notif: 'granted' });
  ok('setup: everything configured → 100% complete', full.done === full.total && full.pct === 100);
})();
// wowArrow — week-over-week arrows must be NaN-proof (a missing week once rendered "▼ -100%")
ok('wowArrow: undefined last week → treated as 0 → up arrow', /wow-up/.test(A.wowArrow(27, undefined)) && /\+100%/.test(A.wowArrow(27, undefined)));
ok('wowArrow: both zero → empty', A.wowArrow(0, 0) === '');
ok('wowArrow: 3 vs 2 → +50%', /\+50%/.test(A.wowArrow(3, 2)));
ok('wowArrow: 1 vs 2 → -50%', /wow-down/.test(A.wowArrow(1, 2)) && /-50%/.test(A.wowArrow(1, 2)));
ok('wowArrow: NaN now → coerced to 0 → down arrow, never NaN text', !/NaN/.test(A.wowArrow(NaN, 5)) && /wow-down/.test(A.wowArrow(NaN, 5)));
ok('getLastWeekStats: includes readPages (Knowledge ring compares against it)', typeof A.getLastWeekStats().readPages === 'number');
// Money Mentor — Psychology-of-Money lessons ranked by what to fix first
(() => {
  const F = (over) => Object.assign({
    assets: { cash: 12000, investments: 30000, property: 0, business: 0, other: 0 },
    liabilities: { mortgage: 0, loans: 0, credit: 0, other: 0 },
    monthlyIncome: 4000, monthlyExpenses: 2500, monthlySavings: 1000, passiveIncome: 0,
    business: { revenue: 0, expenses: 0 }, debts: [], withdrawalRate: 4
  }, over);
  const lessons = (f, ctx) => A.moneyMentorLessons(A.financeMetrics(f), f, Object.assign({ hasData: true }, ctx));
  eq('mentor: no data → the "start" lesson only', A.moneyMentorLessons({}, { debts: [] }, { hasData: false }).map(l => l.id), ['start']);
  ok('mentor: expensive debt is always lesson #1', lessons(F({ debts: [{ name: 'Visa', balance: 3000, apr: 22, payment: 200 }] }))[0].id === 'debt');
  ok('mentor: no cushion → Room for Error leads (no expensive debt)', lessons(F({ assets: { cash: 500, investments: 0, property: 0, business: 0, other: 0 } }))[0].id === 'efund');
  ok('mentor: low savings rate → Wealth Is What You Don’t See', lessons(F({ monthlySavings: 200 })).some(l => l.id === 'rate'));
  ok('mentor: strong finances → Enough appears', lessons(F({ monthlySavings: 1200 })).some(l => l.id === 'enough'));
  ok('mentor: an idea + solid base → a survivable venture budget', lessons(F({}), { ideaTitle: 'Car detailing' }).some(l => l.id === 'venture'));
  ok('mentor: freedom lesson closes the list when FI is computable', (() => { const L = lessons(F({})); return L.length && L[L.length - 1].id === 'freedom'; })());
  ok('mentor: every lesson is complete (principle/chapter/why/move)', lessons(F({ debts: [{ name: 'V', balance: 3000, apr: 22, payment: 200 }] }), { ideaTitle: 'X' }).every(l => l.principle && l.chapter && l.why && l.move));
})();
// Snapshot freshness — the mentor must not coach on stale numbers
eq('snapshotAgeDays: no snapshots → null', A.snapshotAgeDays([], '2026-07-13'), null);
eq('snapshotAgeDays: same day → 0', A.snapshotAgeDays([{ date: '2026-07-13', net: 1 }], '2026-07-13'), 0);
eq('snapshotAgeDays: 40 days old', A.snapshotAgeDays([{ date: '2026-06-03', net: 1 }], '2026-07-13'), 40);
(() => {
  const f = { assets: { cash: 12000, investments: 30000, property: 0, business: 0, other: 0 },
    liabilities: { mortgage: 0, loans: 0, credit: 0, other: 0 },
    monthlyIncome: 4000, monthlyExpenses: 2500, monthlySavings: 1000, passiveIncome: 0,
    business: { revenue: 0, expenses: 0 }, debts: [{ name: 'Visa', balance: 3000, apr: 22, payment: 200 }], withdrawalRate: 4 };
  const m = A.financeMetrics(f);
  const stale = A.moneyMentorLessons(m, f, { hasData: true, ageDays: 60 });
  ok('mentor: stale numbers lead — even ahead of expensive debt', stale[0].id === 'stale' && stale[1].id === 'debt');
  ok('mentor: stale lesson carries an update CTA', !!stale[0].cta && /snapshot/i.test(stale[0].ctaLabel || stale[0].move));
  ok('mentor: fresh numbers → no stale lesson', !A.moneyMentorLessons(m, f, { hasData: true, ageDays: 5 }).some(l => l.id === 'stale'));
})();
ok('compoundProjection: zero monthly → 0', A.compoundProjection(0, 0.07, 10) === 0);
ok('compoundProjection: 0% rate → simple sum', A.compoundProjection(100, 0, 10) === 12000);
ok('compoundProjection: $100/mo at 7% for 10y ≈ $17.3k', (() => { const v = A.compoundProjection(100, 0.07, 10); return v > 16800 && v < 17800; })());
ok('compoundProjection: more years compounds superlinearly', A.compoundProjection(100, 0.07, 30) > 3 * A.compoundProjection(100, 0.07, 10));
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
ok('ensureChecklistData creates the fields', Array.isArray(A.state.data.checklistGroups) && Array.isArray(A.state.data.reminders) && typeof A.state.data.checkDone === 'object');

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

// ── Streak protection (freezes) — the "don't rage-quit" safety net ──
const _fSet = (arr) => new Set(arr);
// computeStreak: frozen days count as present
eq('computeStreak: 3 straight incl today', A.computeStreak(_fSet(['2026-06-08','2026-06-09','2026-06-10']), _fSet([]), '2026-06-10'), 3);
eq('computeStreak: through yesterday when today blank', A.computeStreak(_fSet(['2026-06-08','2026-06-09']), _fSet([]), '2026-06-10'), 2);
eq('computeStreak: a frozen day bridges the gap', A.computeStreak(_fSet(['2026-06-08','2026-06-10']), _fSet(['2026-06-09']), '2026-06-10'), 3);
eq('computeStreak: a real (unfrozen) gap breaks it', A.computeStreak(_fSet(['2026-06-08','2026-06-10']), _fSet([]), '2026-06-10'), 1);
eq('computeStreak: no data → 0', A.computeStreak(_fSet([]), _fSet([]), '2026-06-10'), 0);
// freezeToUse: bridges only a single missed yesterday, only when a streak existed
eq('freezeToUse: bridges yesterday when day-before was logged', A.freezeToUse(_fSet(['2026-06-08']), _fSet([]), 1, '2026-06-10'), '2026-06-09');
eq('freezeToUse: no freeze available → ""', A.freezeToUse(_fSet(['2026-06-08']), _fSet([]), 0, '2026-06-10'), '');
eq('freezeToUse: yesterday already logged → "" (no gap)', A.freezeToUse(_fSet(['2026-06-08','2026-06-09']), _fSet([]), 1, '2026-06-10'), '');
eq('freezeToUse: two days missed → "" (never spans a 2-day gap)', A.freezeToUse(_fSet(['2026-06-07']), _fSet([]), 1, '2026-06-10'), '');
eq('freezeToUse: idempotent — yesterday already frozen → ""', A.freezeToUse(_fSet(['2026-06-08']), _fSet(['2026-06-09']), 1, '2026-06-10'), '');
eq('freezeToUse: brand-new user (no prior streak) → ""', A.freezeToUse(_fSet([]), _fSet([]), 2, '2026-06-10'), '');
// freezeAward: one per 7-day multiple, never twice for the same streak
ok('freezeAward: earned at 7', A.freezeAward(7, 0) === true);
ok('freezeAward: earned at 14', A.freezeAward(14, 7) === true);
ok('freezeAward: not at 8', A.freezeAward(8, 7) === false);
ok('freezeAward: not re-earned at the same streak length', A.freezeAward(7, 7) === false);
ok('freezeAward: nothing at streak 0', A.freezeAward(0, 0) === false);
// ── streakBreak: the churn moment. Must fire on a real loss and stay quiet otherwise ──
const _sbToday = '2026-08-20';
const _sbSet = (arr) => new Set(arr);
// A 5-day chain ending 08-18, today 08-20. `missed` is 1, not 2: only 08-19 was
// missed — today isn't a missed day until it's over.
ok('streakBreak: a broken 5-day chain is detected with the right day count',
  (() => { const r = A.streakBreak(_sbSet(['2026-08-18','2026-08-17','2026-08-16','2026-08-15','2026-08-14']), _sbSet([]), _sbToday);
    return r && r.broken === 5 && r.missed === 1; })());
ok('streakBreak: two missed days are counted as two',
  (() => { const r = A.streakBreak(_sbSet(['2026-08-17','2026-08-16','2026-08-15']), _sbSet([]), _sbToday);
    return r && r.broken === 3 && r.missed === 2; })());
ok('streakBreak: silent when today is already logged',
  A.streakBreak(_sbSet([_sbToday,'2026-08-18','2026-08-17','2026-08-16']), _sbSet([]), _sbToday) === null);
ok('streakBreak: silent when yesterday was logged (streak alive)',
  A.streakBreak(_sbSet(['2026-08-19','2026-08-18','2026-08-17']), _sbSet([]), _sbToday) === null);
ok('streakBreak: silent for a chain shorter than 3 days (no funeral for a blip)',
  A.streakBreak(_sbSet(['2026-08-18','2026-08-17']), _sbSet([]), _sbToday) === null);
ok('streakBreak: silent for a long-dormant account (no poke two months later)',
  A.streakBreak(_sbSet(['2026-06-01','2026-05-31','2026-05-30','2026-05-29']), _sbSet([]), _sbToday) === null);
ok('streakBreak: a frozen day counts toward the broken chain',
  (() => { const r = A.streakBreak(_sbSet(['2026-08-18','2026-08-16','2026-08-15']), _sbSet(['2026-08-17']), _sbToday);
    return r && r.broken === 4; })());
// ── the recovery card itself: fires, says the right things, and can be dismissed ──
const _rcToday = A.todayStr();
const _rcShift = (n) => { const x = new Date(_rcToday + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const _rcBase = (over) => Object.assign({
  profile: { pillars: dp }, days: [], weeks: [], weights: [], books: [], vocab: [],
  takeaways: [], library: [], ideas: [], contacts: [], finance: {}
}, over || {});
A.state.data = _rcBase({ days: [2, 3, 4, 5, 6, 7].map(n => ({ date: _rcShift(-n) })) });
const _rcBreak = A.currentStreakBreak();
ok('recovery: a 6-day chain broken 2 days ago is detected live',
  _rcBreak && _rcBreak.broken === 6 && _rcBreak.missed === 1, JSON.stringify(_rcBreak));
const _rcHtml = A.renderStreakRecoveryCard();
ok('recovery: the card renders', _rcHtml.length > 0);
ok('recovery: it names the streak that lapsed', /6-day streak needs water/.test(_rcHtml));
ok('recovery: it points at evidence the habit is real (total days logged)', /6 days<\/b> in total/.test(_rcHtml));
ok('recovery: it makes the next step small and explicit', /it starts growing again/.test(_rcHtml) && /30 seconds/.test(_rcHtml));
ok('recovery: it explicitly removes the pressure to catch up', /do not need to make up the days/.test(_rcHtml));
ok('recovery: it reassures that nothing logged was destroyed', /nothing you built is gone/i.test(_rcHtml));
ok('recovery: it offers a log action and a decline', /dismissRecovery\(true\)/.test(_rcHtml) && /dismissRecovery\(false\)/.test(_rcHtml));
ok('recovery: no shame language', !/fail|lost|broke your|shame|disappoint/i.test(_rcHtml));
// ── growth stages: a number resets to zero, a growing thing can be watered ──
eq('growth: nothing logged yet → ready to plant', A.growthStage(0).name, 'Ready to plant');
eq('growth: day 1 already shows something alive', A.growthStage(1).name, 'Planted');
eq('growth: 3 days sprouts', A.growthStage(3).name, 'Sprouting');
eq('growth: a full week is Growing', A.growthStage(7).name, 'Growing');
eq('growth: 30 days is Rooted', A.growthStage(30).name, 'Rooted');
eq('growth: 100 days is the final stage', A.growthStage(100).name, 'Flourishing');
ok('growth: mid-stage keeps the lower stage (day 5 is still Sprouting)', A.growthStage(5).name === 'Sprouting');
ok('growth: it names the next stage and the days to reach it',
  A.growthStage(3).next === 'Growing' && A.growthStage(3).toNext === 4);
ok('growth: the final stage has no "next" to chase', A.growthStage(500).next === null && A.growthStage(500).pct === 100);
ok('growth: progress through a stage is a sane 0–100', [0, 1, 4, 10, 20, 60].every(n => { const p = A.growthStage(n).pct; return p >= 0 && p <= 100; }));
ok('growth: a negative or junk streak degrades to the first stage',
  A.growthStage(-5).name === 'Ready to plant' && A.growthStage(undefined).name === 'Ready to plant');
// dismissing for the day hides it
A.state.data.profile._recoveryDismissed = _rcToday;
ok('recovery: dismissing hides the card for the rest of the day', A.renderStreakRecoveryCard() === '');
// an active streak never sees it
A.state.data = _rcBase({ days: [0, 1, 2, 3].map(n => ({ date: _rcShift(-n) })) });
ok('recovery: someone with an active streak never sees the card', A.renderStreakRecoveryCard() === '');
// loggingStreak honours frozen days end-to-end
A.state.data = { profile: { pillars: dp, frozen: [_sd1] }, weeks: [], weights: [], days: [{ date: _sd2 }, { date: _sd0 }] };
eq('loggingStreak: a stored frozen day keeps the chain at 3', A.loggingStreak(), 3);
A.state.data.profile.frozen = [];
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

// ── Onward Story — the weekly recap slideshow assembles from real data ──
(() => {
  const _wk = A.getWeekStart(new Date().toISOString().split('T')[0]);
  const d0 = new Date().toISOString().split('T')[0];
  const d1 = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  A.state.data = { profile: { pillars: dp, gymDaysPerWeek: 5, weeklyReadGoal: 100 }, weeks: [], weights: [], books: [], contacts: [], days: [
    { date: d1, gym: { done: true }, reading: { pages: 30 } },
    { date: d0, gym: { done: true }, reading: { pages: 20 }, networking: { count: 2 } }
  ] };
  const sd = A.weekStoryData();
  // Expectations are DERIVED, not hardcoded: when today is the first day of the
  // week, yesterday belongs to the previous week and is correctly excluded. The
  // old fixed values (2 days / 50 pages) failed one day in seven — silently, since
  // CI only noticed on whichever weekday it happened to run.
  const _wkStart = A.getWeekStart(d0);
  const _inWeek = [{ d: d1, pages: 30 }, { d: d0, pages: 20 }].filter(x => x.d >= _wkStart);
  const _expDays = _inWeek.length;
  const _expPages = _inWeek.reduce((n, x) => n + x.pages, 0);
  ok('weekStoryData: counts days logged this week', sd.daysLogged === _expDays,
    'got ' + sd.daysLogged + ' expected ' + _expDays + ' (week starts ' + _wkStart + ')');
  ok('weekStoryData: only enabled pillars appear in the stats', sd.stats.every(s => ['Training', 'Reading', 'Networking'].includes(s.label)) && sd.stats.length >= 1,
    sd.stats.map(s => s.label).join(','));
  ok('weekStoryData: reading pages summed for the week', (sd.stats.find(s => s.label === 'Reading') || {}).value === _expPages,
    'expected ' + _expPages);
  ok('weekStoryData: goals % is a 0–100 number with a label + colour', typeof sd.goalsPct === 'number' && sd.goalsPct >= 0 && sd.goalsPct <= 100 && !!sd.goalsLabel && /^#/.test(sd.goalsColor));
  const slides = A.weekStorySlides(sd);
  ok('weekStorySlides: always has an intro and a final share slide', slides.length >= 3 && slides[0].html.indexOf('Your week in review') > -1 && slides[slides.length - 1].last === true);
  ok('weekStorySlides: every slide carries an auto-advance duration', slides.every(s => typeof s.dur === 'number' && s.dur > 0));
  ok('weekStorySlides: the counting slides declare a count target', slides.filter(s => s.count).length >= 1 && slides.filter(s => s.count).every(s => typeof s.count.to === 'number'));
  // an empty week still produces a valid, non-crashing story
  A.state.data = { profile: { pillars: dp }, weeks: [], weights: [], books: [], contacts: [], days: [] };
  const empty = A.weekStorySlides(A.weekStoryData());
  ok('weekStorySlides: an empty week still yields intro + outro (never crashes)', empty.length >= 2 && empty[empty.length - 1].last === true);
})();

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
// Anchored to the 1st: on the 29th–31st, setMonth(-1) overflows into the
// following month (June 31 → July 1), so "last month" came back equal to this
// month and this whole block silently tested nothing. Caught on the 31st.
const _lm = (() => { const d = new Date(_cm + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
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
// INTELLIGENCE ENGINES — the rules that decide what the app tells you.
// All pure-ish (read state.data, return data). These encode the product's
// judgement, so a silent regression here is the costliest kind.
// ─────────────────────────────────────────────────────────────
const _iToday = A.todayStr();
const _iAgo = (n) => { const d = new Date(_iToday + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const _iBase = (over) => Object.assign({
  profile: { pillars: A.defaultPillars(), gymDaysPerWeek: 5, weeklyNetworkGoal: 3, weeklyReadGoal: 100 },
  days: [], weeks: [], weights: [], books: [], vocab: [], takeaways: [], library: [], ideas: [], contacts: [], finance: {}
}, over || {});

// ── Coach's weekly training split ──
eq('split: 3 days → push/pull/legs', A.weeklyTrainingSplit('gain', 3), ['Push Day', 'Pull Day', 'Leg Day']);
eq('split: 6 days → PPL twice', A.weeklyTrainingSplit('gain', 6).length, 6);
ok('split: fat-loss swaps the last day for conditioning', A.weeklyTrainingSplit('lose', 5).slice(-1)[0] === 'HIIT Cardio (Fat Burn)');
ok('split: gain keeps the last day as lifting', A.weeklyTrainingSplit('gain', 5).slice(-1)[0] !== 'HIIT Cardio (Fat Burn)');
eq('split: missing/0 days falls back to the 3-day default', A.weeklyTrainingSplit('gain', 0).length, 3);
eq('split: undefined days falls back to the 3-day default', A.weeklyTrainingSplit('gain').length, 3);
eq('split: 1 day clamps up to Full Body', A.weeklyTrainingSplit('gain', 1), ['Full Body']);
eq('split: 9 days clamps down to 7', A.weeklyTrainingSplit('gain', 9).length, 7);
ok('split: every session maps to a real program', A.weeklyTrainingSplit('maintain', 4).every(k => !!A.WORKOUT_PROGRAMS[k]));

// ── Muscle parts: every muscle split into the regions you train separately ──
// The two structural guarantees. If either breaks, the library silently drops
// exercises out of the UI — they'd exist in the data and be unreachable.
ok('parts: every exercise in the library resolves to a real part of its muscle', (() => {
  const bad = [];
  Object.keys(A.EXERCISE_LIBRARY).forEach(g => A.EXERCISE_LIBRARY[g].forEach(n => {
    if (!A.partMeta(g, A.exercisePart(n, g))) bad.push(g + '/' + n);
  }));
  if (bad.length) failures.push('  unclassified: ' + bad.join(', '));
  return bad.length === 0;
})());
ok('parts: grouping by part loses no exercises', Object.keys(A.EXERCISE_LIBRARY).every(g =>
  A.exercisesByPart(g).reduce((n, s) => n + s.exercises.length, 0) === A.EXERCISE_LIBRARY[g].length));
ok('parts: every declared part has at least one exercise', Object.keys(A.MUSCLE_PARTS).every(g => {
  const filled = new Set(A.exercisesByPart(g).map(s => s.part.key));
  return A.MUSCLE_PARTS[g].every(p => filled.has(p.key));
}));
ok('parts: every muscle group declares its parts', Object.keys(A.EXERCISE_LIBRARY).every(g => (A.MUSCLE_PARTS[g] || []).length >= 3));
ok('parts: each part carries a name, a sub-label and a coach note', Object.keys(A.MUSCLE_PARTS).every(g =>
  A.MUSCLE_PARTS[g].every(p => p.key && p.name && p.sub && p.why && p.why.length > 20)));
eq('parts: chest splits upper / middle / lower', A.MUSCLE_PARTS.Chest.map(p => p.key), ['upper', 'middle', 'lower']);
// The classifications a lifter would argue about — pinned so they stay right.
eq('chest: incline bench is upper chest', A.exercisePart('Incline Barbell Bench Press', 'Chest'), 'upper');
eq('chest: flat bench is middle chest', A.exercisePart('Barbell Bench Press', 'Chest'), 'middle');
eq('chest: decline + dips are lower chest', A.exercisePart('Decline Bench Press', 'Chest'), 'lower');
eq('chest: dips count as lower chest', A.exercisePart('Dips', 'Chest'), 'lower');
eq('chest: low cable fly travels low-to-high → upper', A.exercisePart('Low Cable Fly', 'Chest'), 'upper');
eq('chest: high cable fly travels high-to-low → lower', A.exercisePart('High Cable Fly', 'Chest'), 'lower');
// Push-ups invert the bench naming — hands elevated is the EASIER, lower-chest version.
eq('chest: incline push-up (hands up) is lower chest, not upper', A.exercisePart('Incline Push-Up', 'Chest'), 'lower');
eq('chest: decline push-up (feet up) is upper chest', A.exercisePart('Decline Push-Up', 'Chest'), 'upper');
eq('back: pulldowns build lat width', A.exercisePart('Wide-Grip Lat Pulldown', 'Back'), 'lats');
eq('back: rows build thickness', A.exercisePart('Pendlay Row', 'Back'), 'upper');
eq('back: deadlifts load the erectors', A.exercisePart('Deadlift', 'Back'), 'lower');
eq('back: rack pull is a hinge, not a pull-up', A.exercisePart('Rack Pull', 'Back'), 'lower');
eq('legs: RDL is hamstrings, not quads', A.exercisePart('Romanian Deadlift', 'Legs'), 'hams');
eq('legs: hip thrust is glutes', A.exercisePart('Hip Thrust', 'Legs'), 'glutes');
eq('legs: leg extension is quads', A.exercisePart('Leg Extension', 'Legs'), 'quads');
eq('legs: calf raise is calves', A.exercisePart('Seated Calf Raise', 'Legs'), 'calves');
eq('shoulders: lateral raise is side delts (the width builder)', A.exercisePart('Lateral Raise', 'Shoulders'), 'side');
eq('shoulders: overhead press is front delts', A.exercisePart('Overhead Press', 'Shoulders'), 'front');
eq('shoulders: reverse pec deck is rear delts', A.exercisePart('Reverse Pec Deck', 'Shoulders'), 'rear');
eq('shoulders: shrugs are traps', A.exercisePart('Barbell Shrug', 'Shoulders'), 'traps');
eq('arms: skull crusher is triceps', A.exercisePart('Skull Crusher', 'Arms'), 'triceps');
eq('arms: overhead cable extension is triceps', A.exercisePart('Overhead Cable Extension', 'Arms'), 'triceps');
eq('arms: barbell curl is biceps', A.exercisePart('Barbell Curl', 'Arms'), 'biceps');
eq('arms: reverse curl works the forearm, not the bicep', A.exercisePart('Reverse Curl', 'Arms'), 'forearms');
eq('core: hanging leg raise is lower abs', A.exercisePart('Hanging Leg Raise', 'Core'), 'lower');
eq('core: side plank is obliques, not deep core', A.exercisePart('Side Plank', 'Core'), 'obliques');
eq('core: plank is anti-movement deep core', A.exercisePart('Plank', 'Core'), 'deep');
eq('core: cable crunch is upper abs', A.exercisePart('Cable Crunch', 'Core'), 'upper');
eq('cardio: sprints are intervals', A.exercisePart('Hill Sprints', 'Cardio'), 'hiit');
eq('cardio: zone 2 run is steady state', A.exercisePart('Zone 2 Run', 'Cardio'), 'steady');
eq('cardio: sled push is athletic power', A.exercisePart('Sled Push', 'Cardio'), 'power');
eq('exercisePart infers the group when not given', A.exercisePart('Incline Dumbbell Press'), 'upper');
eq('exercisePart: unknown exercise → ""', A.exercisePart('Zercher Carry Thing', ''), '');
ok('library count is the real total', A.libraryCount() === Object.keys(A.EXERCISE_LIBRARY).reduce((n, g) => n + A.EXERCISE_LIBRARY[g].length, 0) && A.libraryCount() > 150);

// ── Programs: one per muscle covering every part, plus part-focus days ──
ok('programs: every exercise in every program exists in the library', (() => {
  const bad = [];
  Object.keys(A.WORKOUT_PROGRAMS).forEach(p => A.WORKOUT_PROGRAMS[p].forEach(ex => { if (!A.exerciseGroup(ex)) bad.push(p + ' → ' + ex); }));
  if (bad.length) failures.push('  phantom exercises: ' + bad.join(', '));
  return bad.length === 0;
})());
['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'].forEach(g => {
  const name = g + ' — Every Part';
  ok('program "' + name + '" exists', !!A.WORKOUT_PROGRAMS[name]);
  const covered = new Set(A.WORKOUT_PROGRAMS[name].map(ex => A.exercisePart(ex, A.exerciseGroup(ex))));
  ok(name + ' really does hit every part of ' + g, A.MUSCLE_PARTS[g].every(p => covered.has(p.key)),
    'missing ' + A.MUSCLE_PARTS[g].filter(p => !covered.has(p.key)).map(p => p.name).join(', '));
});
eq('programPartLabel names the parts a program covers', A.programPartLabel('Chest — Every Part').sort(), ['Lower Chest', 'Middle Chest', 'Upper Chest']);
ok('a focus program stays on its one part', A.programPartLabel('Upper Chest Focus').indexOf('Upper Chest') > -1);
eq('Calf Focus is calves only', A.programPartLabel('Calf Focus'), ['Calves']);
ok('programSections: every program is filed somewhere (none hidden from the UI)', (() => {
  const shown = new Set(); A.programSections().forEach(s => s.keys.forEach(k => shown.add(k)));
  const missing = Object.keys(A.WORKOUT_PROGRAMS).filter(k => !shown.has(k));
  if (missing.length) failures.push('  unfiled programs: ' + missing.join(', '));
  return missing.length === 0;
})());
ok('programSections: no program is listed twice', (() => {
  const seen = []; A.programSections().forEach(s => s.keys.forEach(k => seen.push(k)));
  return seen.length === new Set(seen).size;
})());
ok('programSections: no empty section', A.programSections().every(s => s.keys.length > 0 && s.name && s.hint));

// ── Progressive overload: last time + all-time best ──
A.state.data = _iBase({ days: [
  { date: _iAgo(9), gym: { done: true, exercises: [{ name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }] }] } },
  { date: _iAgo(3), gym: { done: true, exercises: [{ name: 'Barbell Bench Press', sets: [{ reps: 5, weight: 82.5 }] }] } }
] });
const _lp = A.lastExercisePerformance('Barbell Bench Press');
eq('last time: picks the most recent prior session', _lp.date, _iAgo(3));
eq('last time: best set of that session', _lp.best.weight, 82.5);
eq('last time: name match is case-insensitive', A.lastExercisePerformance('barbell bench press').date, _iAgo(3));
eq('last time: unknown exercise → null', A.lastExercisePerformance('Zercher Squat'), null);
eq('PR bar = heaviest ever across all days', A.exerciseBestWeightEver('Barbell Bench Press'), 85);
eq('PR bar for a never-done lift is 0 (so a first set is never a "PR")', A.exerciseBestWeightEver('Zercher Squat'), 0);
ok('last time: best set breaks ties on reps', (() => {
  A.state.data = _iBase({ days: [{ date: _iAgo(2), gym: { done: true, exercises: [{ name: 'Row', sets: [{ reps: 5, weight: 60 }, { reps: 9, weight: 60 }] }] } }] });
  return A.lastExercisePerformance('Row').best.reps === 9;
})());

// ── Deal playbook (Contacts) ──
A.state.data = _iBase();
ok('deal play: overdue follow-up is prefixed as overdue', A.dealPlay({ status: 'warm', followUpDate: _iAgo(2) }, _iToday).indexOf('overdue') > -1);
ok('deal play: new contact → open with a question, not a pitch', A.dealPlay({ status: 'new' }, _iToday).toLowerCase().indexOf('pitch') > -1);
ok('deal play: closing → ask for the decision', A.dealPlay({ status: 'closing' }, _iToday).toLowerCase().indexOf('decision') > -1);
ok('deal priority: overdue outranks a fresh closing deal',
  A.dealPlayPriority({ status: 'warm', followUpDate: _iAgo(1) }, _iToday) > A.dealPlayPriority({ status: 'closing' }, _iToday));
ok('deal priority: bigger deal edges out an equal-stage smaller one',
  A.dealPlayPriority({ status: 'warm', dealValue: 5000 }, _iToday) > A.dealPlayPriority({ status: 'warm', dealValue: 100 }, _iToday));

// ── Idea validation playbook ──
eq('idea move: untested → talk to people first', A.ideaNextMove({ validation: {} }).stage.key, 'untested');
eq('idea move: hypotheses set → experiment stage', A.ideaNextMove({ validation: { customer: 'gyms', valueHyp: 'saves time' } }).stage.key, 'hypothesis');
ok('idea move: experiment ready → decide go/no-go BEFORE running',
  A.ideaNextMove({ validation: { customer: 'a', valueHyp: 'b', experiment: 'landing page', metric: 'signups' } }).move.indexOf('GO') > -1);
eq('idea move: results + persevere → validated', A.ideaNextMove({ validation: { result: '20 signups', decision: 'persevere' } }).stage.key, 'validated');
ok('idea move: results in, undecided → forces the call',
  A.ideaNextMove({ validation: { result: 'flat' } }).move.toLowerCase().indexOf('pivot') > -1);

// ── Knowledge games pool ──
A.state.data = _iBase({
  library: [{ id: 'a', type: 'person', title: 'Marcus Aurelius', body: 'Stoic emperor.' }, { id: 'b', type: 'theory', title: 'Compounding', body: 'Growth on growth.' }, { id: 'c', type: 'fact', title: 'No note', body: '' }],
  vocab: [{ id: 'w', word: 'Ephemeral', meaning: 'Lasting a short time' }, { id: 'w2', word: 'NoMeaning', meaning: '' }]
});
const _pool = A.knowledgeQuizPool();
eq('quiz pool: merges library + vocab, skips entries with no clue', _pool.length, 3);
ok('quiz pool: a library entry is asked by its note', _pool.find(p => p.answer === 'Marcus Aurelius').clue.indexOf('Stoic') > -1);
ok('quiz pool: a word is asked by its meaning', _pool.find(p => p.answer === 'Ephemeral').clue.indexOf('short time') > -1);
ok('quiz pool: de-dupes answers so a distractor is never also correct', (() => {
  A.state.data = _iBase({ library: [{ id: '1', title: 'Dup', body: 'x' }, { id: '2', title: 'dup', body: 'y' }] });
  return A.knowledgeQuizPool().length === 1;
})());

// ── Grouped checklists (incl. one-way migration) ──
A.state.data = _iBase({ checklist: [{ id: 'i1', text: 'Vitamins' }, { id: 'i2', text: 'Walk' }] });
A.ensureChecklistData();
eq('checklist: old flat list migrates into one group', A.state.data.checklistGroups.length, 1);
eq('checklist: migrated group keeps every item', A.state.data.checklistGroups[0].items.length, 2);
ok('checklist: the old flat array is removed after migrating', A.state.data.checklist === undefined);
A.state.data.checkDone = {}; A.state.data.checkDone[_iToday] = ['i1'];
eq('checklist: overall progress counts across groups', A.checklistProgress(), { done: 1, total: 2 });
eq('checklist: per-group progress', A.groupProgress(A.state.data.checklistGroups[0]), { done: 1, total: 2 });
eq('checklist: allCheckItems flattens groups', A.allCheckItems().length, 2);

// ── Expert briefings: shape + the rules that must fire ──
A.state.data = _iBase({ days: [0, 1, 2, 3, 4, 5, 6].map(n => ({ date: _iAgo(n), gym: { done: true, muscleGroup: 'Push' } })) });
const _hb = A.healthBriefing();
ok('health briefing: returns triaged items', Array.isArray(_hb) && _hb.length > 0);
ok('health briefing: every item has a severity and a concrete move', _hb.every(i => typeof i.sev === 'number' && i.move && i.title));
ok('health briefing: 7 straight training days raises a recovery flag',
  _hb.some(i => i.sev >= 3 && (i.title + i.why).toLowerCase().indexOf('rest') > -1));
ok('health briefing: push-only month flags the pull imbalance',
  _hb.some(i => (i.title + i.why).toLowerCase().indexOf('pull') > -1));
// calorie adherence vs the plan (new nutritionist rule): well under target → flag + a concrete make-up amount
A.state.data = _iBase({
  profile: { gymDaysPerWeek: 5, nutrition: { age: 30, heightCm: 180, weightKg: 80, sex: 'male', goal: 'maintain', activity: 'moderate' } },
  days: [0, 1, 2, 3, 4].map(n => ({ date: _iAgo(n), calories: 1500 }))
});
const _hbCal = A.healthBriefing();
ok('health briefing: eating well under the calorie target is flagged',
  _hbCal.some(i => (i.title + i.why).toLowerCase().indexOf('below your plan') > -1));
ok('health briefing: the calorie flag names a concrete make-up amount',
  _hbCal.some(i => i.title.indexOf('below your plan') > -1 && /add ~[\d,]+ cal/i.test(i.move)));
// eating on plan → a calm, positive nutritionist note (not a false alarm)
A.state.data = _iBase({
  profile: { gymDaysPerWeek: 5, nutrition: { age: 30, heightCm: 180, weightKg: 80, sex: 'male', goal: 'maintain', activity: 'moderate' } },
  days: [0, 1, 2, 3, 4].map(n => ({ date: _iAgo(n), calories: 2759 }))
});
ok('health briefing: hitting the target reads as "on plan", not a warning',
  A.healthBriefing().some(i => i.sev === 0 && i.title.toLowerCase().indexOf('on plan') > -1));
A.state.data = _iBase({ contacts: [{ id: 'c1', name: 'Jordan', status: 'warm', dealValue: 9000, followUpDate: _iAgo(3) }] });
const _bb = A.businessBriefing();
ok('business briefing: an overdue follow-up is the top call', _bb[0].sev >= 3 && _bb[0].title.toLowerCase().indexOf('overdue') > -1);
// mentor focus rule (new): 3+ "active" ideas at once → a WIP/focus flag naming the one to push
A.state.data = _iBase({ ideas: [
  { id: 'i1', title: 'Alpha', status: 'active', scores: { income: 5, speed: 5, ease: 5, passion: 5 } },
  { id: 'i2', title: 'Beta', status: 'active', scores: {} },
  { id: 'i3', title: 'Gamma', status: 'active', scores: {} }
] });
const _bbFocus = A.businessBriefing();
ok('business briefing: 3+ active ideas raises a focus flag',
  _bbFocus.some(i => (i.expert || '').toLowerCase().indexOf('focus') > -1 && (i.title + i.why).toLowerCase().indexOf('active') > -1));
ok('business briefing: the focus flag names the strongest idea to push',
  _bbFocus.some(i => (i.expert || '').toLowerCase().indexOf('focus') > -1 && i.move.indexOf('Alpha') > -1));
// no false alarm: 2 active ideas is normal, not a focus problem
A.state.data = _iBase({ ideas: [
  { id: 'i1', title: 'Alpha', status: 'active', scores: {} },
  { id: 'i2', title: 'Beta', status: 'active', scores: {} }
] });
ok('business briefing: 2 active ideas does NOT trip the focus flag',
  !A.businessBriefing().some(i => (i.expert || '').toLowerCase().indexOf('focus') > -1));
A.state.data = _iBase({ books: [], takeaways: [{ id: 't1', text: 'A', createdAt: _iAgo(5) }, { id: 't2', text: 'B', createdAt: _iAgo(6) }] });
const _kb = A.knowledgeBriefing();
ok('knowledge briefing: unrevisited lessons surface for retrieval practice',
  _kb.some(i => (i.title + i.why).toLowerCase().indexOf('revisit') > -1));
// spaced-repetition rule (new): cards due today surface for review
A.state.data = _iBase({
  books: [{ id: 'b1', title: 'Deep Work', status: 'reading' }],
  vocab: [1, 2, 3].map(n => ({ id: 'v' + n, word: 'w' + n, meaning: 'm' + n }))  // no review set → due now
});
ok('knowledge briefing: due spaced-repetition cards surface for review',
  A.knowledgeBriefing().some(i => (i.expert || '').toLowerCase().indexOf('spaced') > -1 && /due/i.test(i.title)));
// no false alarm: cards scheduled in the future are NOT nagged today
A.state.data = _iBase({
  books: [{ id: 'b1', title: 'Deep Work', status: 'reading' }],
  vocab: [1, 2, 3].map(n => ({ id: 'v' + n, word: 'w' + n, meaning: 'm' + n, review: { box: 3, due: _iAgo(-30) } }))
});
ok('knowledge briefing: cards scheduled for later do NOT nag today',
  !A.knowledgeBriefing().some(i => (i.expert || '').toLowerCase().indexOf('spaced') > -1));
ok('briefings: never empty — always give the user something', A.healthBriefing().length > 0 && A.businessBriefing().length > 0 && A.knowledgeBriefing().length > 0);

// ── 3D terrain height field — the data behind the GPU view ──
// The renderer needs a GPU, but the data shaping is pure, so it's tested here.
eq('terrain: a missing day is flat', A.terrainHeight(undefined, 'gym'), 0);
eq('terrain: a completed workout is a full peak', A.terrainHeight({ gym: { done: true } }, 'gym'), 1);
eq('terrain: an unlogged workout is a valley', A.terrainHeight({ gym: { done: false } }, 'gym'), 0);
eq('terrain: food rating scales 0..1 off a 5-point scale', A.terrainHeight({ food: { rating: 4 } }, 'food'), 0.8);
eq('terrain: reading pages cap at the 30-page ceiling', A.terrainHeight({ reading: { pages: 90 } }, 'reading'), 1);
eq('terrain: partial reading scales', A.terrainHeight({ reading: { pages: 15 } }, 'reading'), 0.5);
eq('terrain: networking scales off 3 contacts', A.terrainHeight({ networking: { count: 3 } }, 'networking'), 1);
ok('terrain: every pillar is clamped to 0..1 even with junk input',
  ['gym', 'food', 'money', 'networking', 'reading'].every(p => {
    const v = A.terrainHeight({ food: { rating: 999 }, reading: { pages: -5 }, networking: { count: 99 }, income: -3 }, p);
    return v >= 0 && v <= 1;
  }));
ok('terrain: an unknown pillar is flat, not NaN', A.terrainHeight({ gym: { done: true } }, 'nope') === 0);
// The grid must always be the right shape — the renderer indexes it directly.
const _tg = A.terrainGrid([{ date: A.todayStr(), gym: { done: true } }], 30);
eq('terrain grid: 30 columns requested, 30 returned', _tg.cols, 30);
eq('terrain grid: one row per pillar', _tg.rows, 5);
ok('terrain grid: every column has a value for every pillar',
  _tg.grid.length === 30 && _tg.grid.every(col => col.length === 5 && col.every(v => typeof v === 'number')));
ok('terrain grid: today lands in the LAST column (time runs left to right)',
  _tg.grid[29][4] === 1 && _tg.grid[0][4] === 0);
ok('terrain grid: an empty history is a flat plain, not an error',
  (() => { const g = A.terrainGrid([], 12); return g.cols === 12 && g.grid.every(c => c.every(v => v === 0)); })());
ok('terrain grid: a silly column count is clamped to something drawable',
  A.terrainGrid([], 0).cols >= 2 && A.terrainGrid([], 1).cols >= 2);

// ── Adaptive nutrition — the weight log drives the calorie target ──
// This tells people how much to eat. Every branch is pinned, and the safety
// rails are tested by trying to breach them.
const _anDay = (n) => { const d = new Date(Date.UTC(2026, 3, 1)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const _anToday = _anDay(30);
// A clean 21-day run of weigh-ins losing 0.5 kg/week from 90kg.
const _anWeights = (perWeek, start, n, everyN) => {
  const out = []; const step = everyN || 3;
  for (let i = 0; i <= n; i += step) out.push({ id: 'w' + i, date: _anDay(30 - n + i), kg: +(start + (perWeek / 7) * i).toFixed(2) });
  return out;
};
const _anDays = (cal, n) => {
  const out = []; for (let i = 0; i <= (n || 20); i++) out.push({ id: 'd' + i, date: _anDay(30 - (n || 20) + i), calories: cal });
  return out;
};
const _anProfile = (goal) => ({ nutrition: { age: 30, sex: 'male', heightCm: 180, weightKg: 95, activity: 'moderate', goal: goal || 'lose', strategy: 'muscle', mealsPerDay: 4 } });

// Bodyweight-scaled goal rates: a percentage, not a flat half-kilo for everyone.
ok('target rate: losing is negative, gaining positive, maintaining zero',
  A.targetWeeklyRate('lose', 90) < 0 && A.targetWeeklyRate('gain', 90) > 0 && A.targetWeeklyRate('maintain', 90) === 0);
ok('target rate: a heavier person gets a larger absolute loss target',
  Math.abs(A.targetWeeklyRate('lose', 120)) > Math.abs(A.targetWeeklyRate('lose', 60)));
ok('target rate: loss never exceeds 1kg/wk however heavy you are',
  Math.abs(A.targetWeeklyRate('lose', 300)) <= 1.0);
ok('target rate: a very light person still gets a usable floor',
  Math.abs(A.targetWeeklyRate('lose', 40)) >= 0.25);
eq('target rate: no weight means no target', A.targetWeeklyRate('lose', 0), 0);

// Trend detection.
const _tr = A.weightTrend(_anWeights(-0.5, 90, 21), _anToday);
ok('trend: detects a 0.5kg/wk loss from a clean run', Math.abs(_tr.kgPerWeek - (-0.5)) < 0.06);
ok('trend: is confident with 8 readings over 21 days', _tr.confident);
ok('trend: current weight is a 7-day average, not the newest reading',
  _tr.current !== _tr.latest && _tr.current > 0);
ok('trend: two readings a day apart is NOT confident',
  !A.weightTrend([{ date: _anDay(29), kg: 90 }, { date: _anDay(30), kg: 89 }], _anToday).confident);
eq('trend: no weigh-ins is handled, not crashed', A.weightTrend([], _anToday).readings, 0);
eq('trend: a single reading gives no slope', A.weightTrend([{ date: _anDay(30), kg: 90 }], _anToday).kgPerWeek, 0);
ok('trend: a single reading still reports a current weight',
  A.weightTrend([{ date: _anDay(30), kg: 90 }], _anToday).current === 90);
ok('trend: readings older than the lookback are ignored',
  A.weightTrend([{ date: _anDay(-200), kg: 130 }].concat(_anWeights(-0.5, 90, 21)), _anToday).current < 95);
ok('trend: garbage weigh-ins are filtered out',
  A.weightTrend([{ date: 'nope', kg: 'x' }, { date: _anDay(30), kg: 0 }, { date: _anDay(28), kg: -5 }], _anToday).readings === 0);
ok('trend: gaining weight reads as a positive rate',
  A.weightTrend(_anWeights(0.3, 80, 21), _anToday).kgPerWeek > 0.2);

// Intake averaging — unlogged days must not read as fasting.
const _in = A.avgIntake(_anDays(2200, 20).concat([{ date: _anDay(30), calories: 0 }]), _anToday);
eq('intake: a zero-calorie (unlogged) day is skipped, not averaged in', _in.avg, 2200);
ok('intake: counts only days inside the lookback', A.avgIntake(_anDays(2200, 60), _anToday).days <= 22);
eq('intake: no food logs is zero days, not NaN', A.avgIntake([], _anToday).days, 0);

// TDEE from energy balance: ate 2,200 and lost 0.5kg/wk => burned ~2,750.
const _td = A.estimateTDEE(2800, { days: 20, avg: 2200 }, { kgPerWeek: -0.5, confident: true });
eq('TDEE: measured from intake + weight change', _td.source, 'measured');
ok('TDEE: ate 2200 losing 0.5kg/wk reads as ~2750 burn', Math.abs(_td.tdee - 2750) <= 30);
eq('TDEE: falls back to the formula without enough food logs',
  A.estimateTDEE(2800, { days: 3, avg: 2200 }, { kgPerWeek: -0.5, confident: true }).source, 'formula');
eq('TDEE: falls back to the formula without a confident trend',
  A.estimateTDEE(2800, { days: 20, avg: 2200 }, { kgPerWeek: -0.5, confident: false }).source, 'formula');
// Under-reporting guard: claiming 900 cal/day while holding weight would imply an
// absurd burn, so the estimate is clamped toward the formula.
const _tdBad = A.estimateTDEE(2800, { days: 20, avg: 900 }, { kgPerWeek: 0, confident: true });
ok('TDEE: wildly under-reported intake is clamped, not believed',
  _tdBad.clamped && _tdBad.tdee >= Math.round(2800 * 0.6));

// The three tiers.
const _pLose = A.nutritionPlan(_anProfile('lose'), _anWeights(-0.5, 90, 21), _anDays(2200, 20), _anToday);
eq('plan: with weight + food logs the tier is "measured"', _pLose.adapt.tier, 'measured');
ok('plan: uses the LOGGED weight, not the stale onboarding number',
  _pLose.weightKg < 95 && _pLose.weightIsLogged);
ok('plan: a measured plan reports a measured TDEE', _pLose.adapt.tdeeSource === 'measured');
ok('plan: losing at target keeps the target near maintenance-minus-deficit',
  _pLose.calories > 1200 && _pLose.calories < _pLose.adapt.tdee);

const _pStart = A.nutritionPlan(_anProfile('lose'), [], [], _anToday);
eq('plan: no weigh-ins yet means the "starting" tier', _pStart.adapt.tier, 'starting');
eq('plan: the starting tier never adjusts calories', _pStart.adapt.deltaKcal, 0);
ok('plan: the starting tier says what to do next', /log your weight/i.test(_pStart.adapt.reason));
ok('plan: with no weigh-ins it falls back to the profile weight', _pStart.weightKg === 95 && !_pStart.weightIsLogged);

const _pCorr = A.nutritionPlan(_anProfile('lose'), _anWeights(-0.5, 90, 21), [], _anToday);
eq('plan: weigh-ins but no food logs means the "corrected" tier', _pCorr.adapt.tier, 'corrected');

// Direction is the thing that must never be wrong.
const _pStall = A.nutritionPlan(_anProfile('lose'), _anWeights(0, 90, 21), [], _anToday);
ok('plan: stalled on a loss goal CUTS calories', _pStall.adapt.deltaKcal < 0);
// A stall is the commonest reason to read this card, so it must not say "Trending 0".
ok('plan: a flat trend reads as "holding flat", not "Trending 0 kg/wk"',
  /holding flat/i.test(_pStall.adapt.reason) && !/trending 0/i.test(_pStall.adapt.reason));
const _pFast = A.nutritionPlan(_anProfile('lose'), _anWeights(-1.4, 90, 21), [], _anToday);
ok('plan: losing dangerously fast ADDS calories back', _pFast.adapt.deltaKcal > 0);
const _pGainStall = A.nutritionPlan(_anProfile('gain'), _anWeights(0, 80, 21), [], _anToday);
ok('plan: stalled on a muscle-gain goal ADDS calories', _pGainStall.adapt.deltaKcal > 0);
const _pGainFast = A.nutritionPlan(_anProfile('gain'), _anWeights(1.2, 80, 21), [], _anToday);
ok('plan: gaining too fast (mostly fat) CUTS calories', _pGainFast.adapt.deltaKcal < 0);
const _pMaintDrift = A.nutritionPlan(_anProfile('maintain'), _anWeights(0.6, 80, 21), [], _anToday);
ok('plan: drifting up while maintaining CUTS calories', _pMaintDrift.adapt.deltaKcal < 0);

// The deadband: close enough is left alone, so people aren't chasing the scale.
const _pOn = A.nutritionPlan(_anProfile('lose'), _anWeights(-0.63, 90, 21), [], _anToday);
ok('plan: hitting the goal rate leaves the target alone', _pOn.adapt.onTrack && _pOn.adapt.deltaKcal === 0);
ok('plan: an on-track plan says so plainly', /on track/i.test(_pOn.adapt.reason));
// Succeeding but with a measured burn: the number may still shift, and the copy
// must read as a refinement rather than scolding someone who is doing it right.
const _pOnMeasured = A.nutritionPlan(_anProfile('lose'), _anWeights(-0.6, 90, 21), _anDays(2200, 20), _anToday);
ok('plan: on track + measured burn still refines the target', _pOnMeasured.adapt.onTrack);
ok('plan: a refinement never reads as "cut" when you are on track',
  /on track/i.test(_pOnMeasured.adapt.reason) && !/\bcut\b/i.test(_pOnMeasured.adapt.reason));

// Safety rails, tested by trying to break them.
// maxStepKcal bounds how far a correction may CUT. It does not bound upward moves,
// because the deficit cap and the calorie floor are allowed to override it — a
// safety limit that yielded to a smoothing preference would be worthless.
ok('rails: a downward correction never exceeds maxStepKcal',
  (() => { const d = A.nutritionPlan(_anProfile('lose'), _anWeights(3.5, 90, 21), [], _anToday).adapt.deltaKcal;
    return d >= -A.ADAPT.maxStepKcal; })());
// The invariant that actually matters: the two safety limits can only ever RAISE
// the target. Neither can be the reason someone is told to eat less.
ok('rails: safety limits only ever raise calories, never lower them',
  (() => {
    const cases = [
      A.nutritionPlan(_anProfile('lose'), _anWeights(-1.8, 70, 21), _anDays(1600, 20), _anToday),
      A.nutritionPlan(_anProfile('lose'), _anWeights(0, 90, 21), _anDays(2600, 20), _anToday),
      A.nutritionPlan(_anProfile('lose'), _anWeights(3.5, 90, 21), [], _anToday)
    ];
    return cases.every(p => p.calories >= Math.min(p.adapt.baseline, Math.round(p.adapt.tdee * (1 - A.SAFETY.maxDeficitPct)))
      && p.calories >= p.adapt.floor);
  })());
ok('rails: someone losing far too fast is raised ABOVE the step cap if safety needs it',
  (() => { const p = A.nutritionPlan(_anProfile('lose'), _anWeights(-1.8, 70, 21), _anDays(1600, 20), _anToday);
    return p.adapt.deltaKcal > A.ADAPT.maxStepKcal && p.calories >= Math.round(p.adapt.tdee * (1 - A.SAFETY.maxDeficitPct)); })());
ok('rails: the target never drifts past maxDriftPct from the formula',
  (() => { const p = A.nutritionPlan(_anProfile('lose'), _anWeights(3.5, 90, 21), [], _anToday);
    return Math.abs(p.adapt.deltaKcal) <= Math.round(p.adapt.baseline * A.ADAPT.maxDriftPct); })());
ok('rails: a held-back change is flagged, not hidden',
  A.nutritionPlan(_anProfile('lose'), _anWeights(3.5, 90, 21), [], _anToday).adapt.railHit === true);
// A held-back change and a safety-raised one can BOTH be true at once: the maths
// wanted more than the step cap allows, then the deficit cap pushed the result back
// up past that cap. What matters is that the card explains the outcome the user can
// see, so the safety message must win — never "held to a smaller change" beside a
// change larger than the cap.
const _pRaised = A.nutritionPlan(_anProfile('lose'), _anWeights(-1.8, 70, 21), _anDays(1600, 20), _anToday);
ok('rails: a safety-raised result is flagged as such', _pRaised.adapt.safetyRaised === true);
ok('rails: a safety raise can exceed the step cap', _pRaised.adapt.deltaKcal > A.ADAPT.maxStepKcal);
ok('rails: the card explains a safety raise, not a cap it did not apply',
  (() => { const html = A.renderAdaptCard(_pRaised);
    return /Raised to keep you within a safe deficit/.test(html) && !/Held to a smaller change/.test(html); })());
ok('rails: a genuinely held-back change still says so',
  (() => { const p = A.nutritionPlan(_anProfile('lose'), _anWeights(3.5, 90, 21), [], _anToday);
    return p.adapt.railHit && !p.adapt.safetyRaised
      ? /Held to a smaller change/.test(A.renderAdaptCard(p))
      : true; })());
ok('rails: calories never fall below the 1200 floor',
  A.nutritionPlan({ nutrition: { age: 70, sex: 'female', heightCm: 150, weightKg: 45, activity: 'sedentary', goal: 'lose', strategy: 'balanced', mealsPerDay: 3 } },
    _anWeights(0, 45, 21), [], _anToday).calories >= 1200);

// Macros must follow the adapted calories and the live weight.
ok('macros: protein is set from the CURRENT weight, not the onboarding weight',
  (() => { const heavy = A.nutritionPlan(_anProfile('gain'), _anWeights(0, 110, 21), [], _anToday);
    const light = A.nutritionPlan(_anProfile('gain'), _anWeights(0, 70, 21), [], _anToday);
    return heavy.protein.g > light.protein.g; })());
ok('macros: the split still adds up to the adapted calorie total',
  (() => { const p = _pStall; const sum = p.protein.cal + p.carbs.cal + p.fat.cal;
    return Math.abs(sum - p.calories) <= 12; })());
eq('plan: no nutrition profile returns null rather than guessing', A.nutritionPlan({}, [], [], _anToday), null);
// The formula path must be untouched — every existing caller depends on it.
ok('computeNutrition without an override is unchanged',
  A.computeNutrition({ age: 30, sex: 'male', heightCm: 180, weightKg: 90, activity: 'moderate', goal: 'lose', strategy: 'muscle', mealsPerDay: 4 }).calories > 1200);
eq('computeNutrition honours an explicit calorie override',
  A.computeNutrition({ age: 30, sex: 'male', heightCm: 180, weightKg: 90, activity: 'moderate', goal: 'lose', strategy: 'muscle', mealsPerDay: 4 }, 2000).calories, 2000);

// ── Nutrition safety gate — the refusals matter more than the feature ──
// This engine lowers calories when the scale stalls. For several groups that is
// the wrong response and the algorithm cannot tell them apart, so it must decline
// rather than guess. Every branch below is a case where declining is correct.
const _safeP = (over) => ({ nutrition: Object.assign({
  age: 32, sex: 'female', heightCm: 165, weightKg: 62, activity: 'moderate',
  goal: 'lose', strategy: 'balanced', mealsPerDay: 3
}, over || {}) });
const _safeW = (kg) => { const o = []; for (let i = 21; i >= 0; i -= 3) o.push({ date: _anDay(30 - i), kg: kg }); return o; };

eq('bmi: standard formula', A.bmiOf(180, 81), 25);
eq('bmi: missing inputs give 0 rather than Infinity', A.bmiOf(0, 80), 0);

// The floor is no longer a flat 1200 for every human being.
ok('floor: never below resting metabolic rate',
  A.calorieFloor({ sex: 'male' }, 2100) === 2100);
ok('floor: a large man gets a higher floor than a small woman',
  A.calorieFloor({ sex: 'male' }, 1900) > A.calorieFloor({ sex: 'female' }, 1150));
eq('floor: sex minimum applies when BMR is very low', A.calorieFloor({ sex: 'female' }, 900), A.SAFETY.floorFemale);

// Declared conditions block adaptive targets outright.
Object.keys(A.SAFETY_FLAGS).forEach(flag => {
  const s = A.nutritionSafety(_safeP({ flags: { [flag]: true } }).nutrition, null);
  ok('safety: "' + flag + '" blocks adaptive targets', s.blocked && s.reasons.length > 0);
});
const _pFlag = A.nutritionPlan(_safeP({ flags: { pregnant: true } }), _safeW(62), _anDays(1900, 20), _anToday);
eq('safety: a blocked account gets the "blocked" tier', _pFlag.adapt.tier, 'blocked');
eq('safety: a blocked account is never given a deficit', _pFlag.adapt.deltaKcal, 0);
eq('safety: a blocked account is forced to maintenance', _pFlag.adapt.goal, 'maintain');
ok('safety: a blocked account is pointed at a professional', /dietitian|doctor/i.test(_pFlag.adapt.reason));
ok('safety: a blocked account still shows a usable number', _pFlag.calories > 1200);

// Under-18s need paediatric assessment, not an adult BMR equation.
ok('safety: under 18 is blocked', A.nutritionSafety(_safeP({ age: 15 }).nutrition, null).blocked);
ok('safety: 18 and over is not blocked on age alone', !A.nutritionSafety(_safeP({ age: 18 }).nutrition, null).blocked);

// The eating-disorder-shaped risk: underweight + a loss goal.
const _sUnder = A.nutritionSafety(_safeP({ heightCm: 170, weightKg: 50 }).nutrition, null);
ok('safety: an underweight BMI refuses the loss path', !_sUnder.allowLoss && _sUnder.warnings.length > 0);
const _pUnder = A.nutritionPlan(_safeP({ heightCm: 170, weightKg: 50 }), _safeW(50), [], _anToday);
eq('safety: "lose" while underweight is overridden to maintain', _pUnder.adapt.goal, 'maintain');
ok('safety: the override is reported, not silent', _pUnder.adapt.goalOverridden === true);
ok('safety: an underweight user is never told to cut calories', _pUnder.adapt.deltaKcal >= 0);
// Severely underweight blocks everything, not just the loss path.
ok('safety: a severely underweight BMI blocks all adaptation',
  A.nutritionSafety(_safeP({ heightCm: 175, weightKg: 45 }).nutrition, null).blocked);
// Gaining while underweight must still be allowed — that is the healthy direction.
ok('safety: "gain" while underweight is still permitted',
  A.nutritionPlan(_safeP({ heightCm: 170, weightKg: 50, goal: 'gain' }), _safeW(50), [], _anToday).adapt.goal === 'gain');

// Losing dangerously fast gets a warning regardless of the stated goal.
const _fastTrend = A.weightTrend(_anWeights(-1.6, 70, 21), _anToday);
ok('safety: warns when losing faster than is safe for bodyweight',
  A.nutritionSafety(_safeP({ heightCm: 170, weightKg: 70 }).nutrition, _fastTrend)
    .warnings.some(w => /faster than is usually safe/i.test(w)));

// The deficit cap is measured against real burn, so a bad trend can't starve someone.
ok('safety: the deficit never exceeds maxDeficitPct of measured burn',
  (() => { const p = A.nutritionPlan(_anProfile('lose'), _anWeights(0, 90, 21), _anDays(2600, 20), _anToday);
    return p.calories >= Math.round(p.adapt.tdee * (1 - A.SAFETY.maxDeficitPct)); })());
ok('safety: the applied floor is reported so the UI can explain it',
  A.nutritionPlan(_anProfile('lose'), _anWeights(0, 90, 21), _anDays(2600, 20), _anToday).adapt.floor > 0);
ok('safety: a healthy adult with no flags is NOT blocked or overridden',
  (() => { const p = A.nutritionPlan(_anProfile('lose'), _anWeights(-0.6, 90, 21), _anDays(2200, 20), _anToday);
    return p.adapt.tier === 'measured' && !p.adapt.goalOverridden && !p.safety.blocked; })());

// The card must carry a disclaimer in every state — including blocked.
['starting', 'measured', 'blocked'].forEach(tier => {
  const p = tier === 'blocked' ? _pFlag
    : tier === 'starting' ? A.nutritionPlan(_anProfile('lose'), [], [], _anToday)
    : A.nutritionPlan(_anProfile('lose'), _anWeights(0, 90, 21), _anDays(2600, 20), _anToday);
  const html = A.renderAdaptCard(p);
  ok('card (' + tier + '): carries a not-medical-advice disclaimer', /not medical advice/i.test(html));
});

// ── Data reset — clearing one area must not touch the others ──
// This backs the Settings "Reset my data" button. Health and business live in
// the SAME day record, so a bug here silently destroys the wrong pillar.
const _rsDay = () => ({
  id: 'd1', date: '2026-04-05', notes: 'felt good',
  gym: { done: true, muscleGroup: 'Chest', duration: 45, notes: 'heavy' },
  food: { rating: 4, notes: 'clean' }, water: 2.5, calories: 2400,
  eaten: { protein: 140, carbs: 250, fat: 70 },
  foodLog: [{ id: 'f1', name: 'Egg', grams: 100 }],
  money: { activities: 'sent proposals', income: 300 },
  networking: { count: 3, notes: 'met Marcus' }, spent: 40,
  reading: { pages: 25, bookId: 'b1', bookTitle: 'Rich Dad Poor Dad', summary: 'assets' }
});
const _rsData = () => ({
  profile: { weeklyIncomeGoal: 1200, weeklyReadGoal: 100, nutrition: { age: 28, weightKg: 80 } },
  days: [_rsDay()], weights: [{ id: 'w1', kg: 84 }], weeks: [{ id: 'k1', income: 1073 }],
  ideas: [{ id: 'i1', title: 'referrals' }], contacts: [{ id: 'c1', name: 'Marcus' }],
  books: [{ id: 'b1', title: 'Rich Dad Poor Dad' }]
});

const _rsH = A.clearPillarData(_rsData(), { health: true });
eq('reset health: gym is blanked', _rsH.data.days[0].gym.done, false);
eq('reset health: gym muscle group cleared', _rsH.data.days[0].gym.muscleGroup, '');
eq('reset health: food rating cleared', _rsH.data.days[0].food.rating, 0);
eq('reset health: water cleared', _rsH.data.days[0].water, 0);
eq('reset health: calories cleared', _rsH.data.days[0].calories, 0);
eq('reset health: weigh-ins dropped', _rsH.data.weights.length, 0);
// The whole point of the split — business and reading must survive untouched.
eq('reset health leaves business income alone', _rsH.data.days[0].money.income, 300);
eq('reset health leaves networking alone', _rsH.data.days[0].networking.count, 3);
eq('reset health leaves reading pages alone', _rsH.data.days[0].reading.pages, 25);
eq('reset health leaves books alone', _rsH.data.books.length, 1);
eq('reset health leaves the day note alone', _rsH.data.days[0].notes, 'felt good');

const _rsB = A.clearPillarData(_rsData(), { business: true });
eq('reset business: income cleared', _rsB.data.days[0].money.income, 0);
eq('reset business: activities cleared', _rsB.data.days[0].money.activities, '');
eq('reset business: networking count cleared', _rsB.data.days[0].networking.count, 0);
eq('reset business: weekly income totals dropped', _rsB.data.weeks.length, 0);
eq('reset business: ideas dropped', _rsB.data.ideas.length, 0);
eq('reset business: contacts dropped', _rsB.data.contacts.length, 0);
eq('reset business leaves the workout alone', _rsB.data.days[0].gym.done, true);
eq('reset business leaves calories alone', _rsB.data.days[0].calories, 2400);
eq('reset business leaves reading alone', _rsB.data.days[0].reading.pages, 25);

// The exact combination asked for here: wipe health + business, keep reading.
const _rsHB = A.clearPillarData(_rsData(), { health: true, business: true });
ok('reset health+business: reading survives intact',
  _rsHB.data.days[0].reading.pages === 25 && _rsHB.data.books.length === 1);
ok('reset health+business: every health and business field is empty',
  _rsHB.data.days[0].gym.done === false && _rsHB.data.days[0].calories === 0 &&
  _rsHB.data.days[0].money.income === 0 && _rsHB.data.days[0].networking.count === 0 &&
  _rsHB.data.weights.length === 0 && _rsHB.data.weeks.length === 0 &&
  _rsHB.data.ideas.length === 0 && _rsHB.data.contacts.length === 0);
eq('reset health+business: the day record itself is kept', _rsHB.data.days.length, 1);

// Settings are not logged history — a reset must not wipe goals or body stats,
// or you get forced back through onboarding every time you start over.
eq('reset keeps the income goal', _rsHB.data.profile.weeklyIncomeGoal, 1200);
eq('reset keeps the nutrition profile', _rsHB.data.profile.nutrition.age, 28);

// Purity: the caller must be able to preview a reset without committing it.
const _rsOrig = _rsData();
A.clearPillarData(_rsOrig, { health: true, business: true, reading: true });
ok('reset is pure — the input object is never mutated',
  _rsOrig.days[0].gym.done === true && _rsOrig.weights.length === 1 && _rsOrig.books.length === 1);

// Don't invent fields on records that never had them.
const _rsSparse = A.clearPillarData({ days: [{ id: 'd', date: '2026-04-05', gym: { done: true } }] }, { health: true });
ok('reset does not add fields a day never had',
  !('foodLog' in _rsSparse.data.days[0]) && !('eaten' in _rsSparse.data.days[0]));
eq('reset with no areas selected changes nothing', A.clearPillarData(_rsData(), {}).counts.fields, 0);
eq('reset survives empty data', A.clearPillarData({}, { health: true }).counts.days, 0);
ok('reset counts what it touched, for an honest confirmation message',
  _rsHB.counts.days === 1 && _rsHB.counts.fields > 0 && _rsHB.counts.lists.weights === 1);

// Shell detection — used to offer pruning after a partial reset.
ok('isDayEmpty: a bare id+date row is a shell', A.isDayEmpty({ id: 'd', date: '2026-04-05' }));
ok('isDayEmpty: a day with only reading is NOT a shell', !A.isDayEmpty({ reading: { pages: 5 } }));
ok('isDayEmpty: a day with only a note is NOT a shell', !A.isDayEmpty({ notes: 'thinking' }));
// Clearing every pillar still leaves the free-text note, and that note alone is
// enough to keep the day alive — notes belong to no pillar, so no reset removes them.
const _rsAll = A.clearPillarData({ days: [_rsDay()] }, { health: true, business: true, reading: true });
ok('isDayEmpty: an all-pillar reset keeps the day alive via its note',
  !A.isDayEmpty(_rsAll.data.days[0]) && _rsAll.data.days[0].notes === 'felt good');
ok('isDayEmpty: an all-pillar reset with no note IS a shell',
  A.isDayEmpty(A.clearPillarData({ days: [Object.assign(_rsDay(), { notes: '' })] },
    { health: true, business: true, reading: true }).data.days[0]));

// ── Cross-hub game plan ──
A.state.data = _iBase({ contacts: [{ id: 'c1', name: 'Jordan', status: 'warm', followUpDate: _iAgo(4) }] });
const _plan = A.weeklyGamePlan();
ok('game plan: one row per enabled area', _plan.length >= 1 && _plan.length <= 3);
ok('game plan: sorted most-urgent first', _plan.every((r, i) => i === 0 || _plan[i - 1].sev >= r.sev));
ok('game plan: each row deep-links to a hub', _plan.every(r => ['health', 'business', 'knowledge'].includes(r.page)));

// ── Community: safe link display (mirrors the server's own validation) ──
eq('safeUrl passes a real https link', A.safeUrl('https://youtube.com/watch?v=1'), 'https://youtube.com/watch?v=1');
eq('safeUrl passes a real http link', A.safeUrl('http://example.com/'), 'http://example.com/');
eq('safeUrl blocks javascript: (XSS)', A.safeUrl('javascript:alert(1)'), '');
eq('safeUrl blocks data: URLs', A.safeUrl('data:text/html,<script>'), '');
eq('safeUrl blocks a bare word', A.safeUrl('example.com'), '');
eq('safeUrl blocks empty / null', A.safeUrl(''), '');
eq('linkHost strips the scheme and www', A.linkHost('https://www.youtube.com/watch?v=1'), 'youtube.com');
eq('linkHost of a bad url is ""', A.linkHost('not a url'), '');

// ── Library search + filter ──
A.state.data = _iBase({ library: [
  { id: '1', type: 'person', title: 'Marcus Aurelius', body: 'Stoic emperor', tags: ['stoicism'] },
  { id: '2', type: 'history', title: 'Berlin Wall', body: 'Fell in 1989', tags: [] }
] });
A.state._libQ = ''; A.state._libType = '';
eq('library: no filter returns everything', A.libFilter(A.state.data.library).length, 2);
A.state._libQ = 'berlin';
eq('library: search matches the title', A.libFilter(A.state.data.library).length, 1);
A.state._libQ = 'stoicism';
eq('library: search also matches tags', A.libFilter(A.state.data.library)[0].id, '1');
A.state._libQ = '1989';
eq('library: search also matches the note body', A.libFilter(A.state.data.library)[0].id, '2');
A.state._libQ = ''; A.state._libType = 'person';
eq('library: type filter narrows to that type', A.libFilter(A.state.data.library).length, 1);
A.state._libQ = ''; A.state._libType = '';

// ── Library user-defined categories (groups) ──
A.state.data = _iBase({ library: [
  { id: '1', type: 'person', title: 'Marcus Aurelius', body: 'Stoic emperor', group: 'Philosophy' },
  { id: '2', type: 'theory', title: 'Stoicism', body: 'Control what you can', group: 'philosophy' },   // case-variant of same category
  { id: '3', type: 'history', title: 'Berlin Wall', body: 'Fell in 1989', group: 'History' },
  { id: '4', type: 'fact', title: 'Loose note', body: 'no category' }                                  // uncategorized
] });
A.state._libQ = ''; A.state._libType = ''; A.state._libGroup = undefined;
eq('libGroups: distinct categories, case-folded, alphabetical', A.libGroups(), ['History', 'Philosophy']);
eq('library: no category filter returns everything', A.libFilter(A.state.data.library).length, 4);
A.state._libGroup = 'Philosophy';
eq('library: category filter narrows to that category', A.libFilter(A.state.data.library).length, 1);
A.state._libGroup = '';
eq('library: "" category filter shows only uncategorized', A.libFilter(A.state.data.library).map(e => e.id), ['4']);
A.state._libGroup = 'Philosophy'; A.state._libQ = 'berlin';
eq('library: category + search combine (no match across categories)', A.libFilter(A.state.data.library).length, 0);
A.state._libQ = 'philosophy'; A.state._libGroup = undefined;
ok('library: search also matches the category name', A.libFilter(A.state.data.library).some(e => e.id === '1'));
A.state._libQ = ''; A.state._libType = ''; A.state._libGroup = undefined;

// ── Focus areas → which hubs show in the nav (onboarding "what do you want") ──
const _pill = (on) => { const p = {}; ['gym', 'food', 'networking', 'money', 'reading'].forEach(id => p[id] = { enabled: on.includes(id) }); return p; };
A.state.data = _iBase(); A.state.data.profile.pillars = _pill(['gym', 'food', 'networking', 'money', 'reading']);
ok('hubs: everything chosen → all three hubs show', A.hubEnabled('health') && A.hubEnabled('business') && A.hubEnabled('knowledge'));
A.state.data.profile.pillars = _pill(['reading']);
ok('hubs: only Knowledge → Knowledge shows', A.hubEnabled('knowledge') === true);
ok('hubs: only Knowledge → Health hidden', A.hubEnabled('health') === false);
ok('hubs: only Knowledge → Business hidden', A.hubEnabled('business') === false);
A.state.data.profile.pillars = _pill(['gym']);
ok('hubs: Fitness alone lights the Health hub', A.hubEnabled('health') === true && A.hubEnabled('business') === false && A.hubEnabled('knowledge') === false);
A.state.data.profile.pillars = _pill(['food']);
ok('hubs: Nutrition alone still lights Health (either pillar counts)', A.hubEnabled('health') === true);
A.state.data.profile.pillars = _pill(['money']);
ok('hubs: Income alone lights the Business hub', A.hubEnabled('business') === true && A.hubEnabled('health') === false);
A.state.data.profile.pillars = _pill(['networking']);
ok('hubs: Networking alone lights the Business hub', A.hubEnabled('business') === true);
ok('hubs: a non-hub page (Log/Coach) is never gated', A.hubEnabled('log') === true && A.hubEnabled('coach') === true);
A.state.data = _iBase();

// ── Day-complete celebration stats (the daily "you climbed" moment) ──
eq('dayXp: gym+food+reading+networking uses the right weights',
  A.dayXp({ gym: { done: true }, food: { rating: 4 }, reading: { pages: 12 }, networking: { count: 2 } }), 10 + 5 + 8 + 2 * 3);
eq('dayXp: a rest day with nothing logged earns 0', A.dayXp({ gym: { done: false } }), 0);
eq('dayXp: missing/blank day → 0', A.dayXp(null), 0);
(() => {
  const day = { gym: { done: true }, reading: { pages: 10 } };   // 18 XP
  const st = A.dayCompleteStats(day, 200, 5);
  eq('dayCompleteStats: earned = the day\'s XP', st.earned, 18);
  eq('dayCompleteStats: total carries through', st.total, 200);
  eq('dayCompleteStats: streak carries through', st.streak, 5);
  ok('dayCompleteStats: exposes the level + colour for the bar', typeof st.level === 'number' && !!st.color);
})();
ok('dayCompleteStats: 7-day streak surfaces a milestone', !!A.dayCompleteStats({}, 100, 7).milestone);
ok('dayCompleteStats: an ordinary streak has no milestone', A.dayCompleteStats({}, 100, 6).milestone === '');
// Levels: Base Camp 0, Foothills 100, Treeline 300… A day that carries the total
// across the 100 boundary should flag a level-up; one that stays put should not.
ok('dayCompleteStats: crossing the Foothills (100) boundary flags leveledUp',
  A.dayCompleteStats({ gym: { done: true } }, 105, 3).leveledUp === true);   // total 105, earned 10 → 95→105
ok('dayCompleteStats: staying inside a level → leveledUp false',
  A.dayCompleteStats({ gym: { done: true } }, 200, 3).leveledUp === false);  // 190→200, both Foothills
A.state.data = _iBase();

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
    // flag-spam guard: one malicious user reporting 5× must NOT be able to hide a meal
    for (let i = 0; i < 5; i++) await DBm.flagSharedMeal(mid, 777);
    ok('DB one user reporting 5× counts once (meal still visible)', (await DBm.listSharedMeals('oatmeal')).length === 1);
    // but 5 DISTINCT reporters legitimately hides it
    for (let u = 1; u <= 5; u++) await DBm.flagSharedMeal(mid, u);
    ok('DB flagged meal (5 distinct reporters) hidden from feed', (await DBm.listSharedMeals('oatmeal')).length === 0);
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
    // flag-spam guard: one malicious user reporting 5× must NOT be able to hide a post
    for (let i = 0; i < 5; i++) await DBm.flagPost(pid, 777);
    ok('DB one user reporting 5× counts once (post still visible)', (await DBm.listPosts('')).some(p => p.id === pid));
    // but 5 DISTINCT reporters legitimately hides it
    for (let u = 1; u <= 5; u++) await DBm.flagPost(pid, u);
    ok('DB flagged post (5 distinct reporters) hidden from feed', !(await DBm.listPosts('')).some(p => p.id === pid));
    ok('DB deletePost blocks non-author', (await DBm.deletePost(pid, 99999, false)) === false);
    ok('DB deletePost author removes own', (await DBm.deletePost(pid, id, false)) === true);
    // server-side post sanitizer
    ok('cleanPost defaults unknown type to the open post', C.cleanPost({ type: 'spam', body: 'hi' }).type === 'update');
    ok('cleanPost keeps program goal + days/week', (() => { const p = C.cleanPost({ type: 'program', title: 'X', daysPerWeek: '6', goal: 'gain' }); return p.data.daysPerWeek === 6 && p.data.goal === 'gain'; })());
    ok('cleanPost coerces meal macros to numbers', (() => { const p = C.cleanPost({ type: 'meal', title: 'Oats', kcal: '450', p: 'x' }); return p.data.kcal === 450 && p.data.p === 0; })());
    ok('cleanPost caps very long bodies', C.cleanPost({ type: 'thought', body: 'a'.repeat(5000) }).body.length === 4000);
    // ── open "share anything" post: topic + link + photo, all sanitized ──
    ok('cleanPost: open post keeps a whitelisted topic', C.cleanPost({ type: 'update', body: 'hi', topic: 'money' }).data.topic === 'money');
    ok('cleanPost: unknown topic falls back to general (stored as undefined)', C.cleanPost({ type: 'update', body: 'hi', topic: 'crypto-shill' }).data.topic === undefined);
    ok('cleanPost: general topic is not stored', C.cleanPost({ type: 'update', body: 'hi', topic: 'general' }).data.topic === undefined);
    ok('cleanPost: keeps a real https link', C.cleanPost({ type: 'update', body: 'x', link: 'https://example.com/a' }).data.link === 'https://example.com/a');
    ok('cleanPost: keeps a real http link', !!C.cleanPost({ type: 'update', body: 'x', link: 'http://example.com' }).data.link);
    ok('cleanPost: DROPS a javascript: link (XSS)', C.cleanPost({ type: 'update', body: 'x', link: 'javascript:alert(1)' }).data.link === undefined);
    ok('cleanPost: DROPS a data: link', C.cleanPost({ type: 'update', body: 'x', link: 'data:text/html,<script>' }).data.link === undefined);
    ok('cleanPost: DROPS a mailto: / bare-word link', C.cleanPost({ type: 'update', body: 'x', link: 'mailto:a@b.com' }).data.link === undefined && C.cleanPost({ type: 'update', body: 'x', link: 'notaurl' }).data.link === undefined);
    ok('cleanPost: keeps an image data-URL photo', !!C.cleanPost({ type: 'update', body: 'x', photo: 'data:image/jpeg;base64,QQ==' }).data.photo);
    ok('cleanPost: DROPS a non-image data URL as a "photo"', C.cleanPost({ type: 'update', body: 'x', photo: 'data:text/html;base64,PHNjcmlwdD4=' }).data.photo === undefined);
    ok('cleanPost: DROPS a remote-URL photo (no external fetch in the feed)', C.cleanPost({ type: 'update', body: 'x', photo: 'https://evil.example/track.gif' }).data.photo === undefined);
    ok('cleanPost: DROPS an over-cap photo', C.cleanPost({ type: 'update', body: 'x', photo: 'data:image/png;base64,' + 'A'.repeat(900000) }).data.photo === undefined);
    ok('cleanPost: a photo-only post survives sanitizing (body can be empty)', (() => { const p = C.cleanPost({ type: 'update', photo: 'data:image/png;base64,QQ==' }); return !!p.data.photo && p.body === ''; })());
    ok('cleanPost: program/meal never carry a link or photo', (() => { const a = C.cleanPost({ type: 'program', title: 'P', link: 'https://x.com', photo: 'data:image/png;base64,QQ==' }); return a.data.link === undefined && a.data.photo === undefined; })());
    // ── billing fields are server-owned (paywall bypass) ──
    // subStatus() trusts profile.pro, and /api/data persists the client's blob,
    // so without this guard any account could POST {profile:{pro:true}}.
    ok('billing: a client cannot promote itself to Pro', (() => {
      const out = C.preserveBillingFields({ profile: { pro: true, name: 'X' } }, { profile: { pro: false, trialEnds: 111 } });
      return out.profile.pro === false;
    })());
    ok('billing: a client cannot extend its own trial', (() => {
      const out = C.preserveBillingFields({ profile: { trialEnds: 9e15 } }, { profile: { pro: false, trialEnds: 111 } });
      return out.profile.trialEnds === 111;
    })());
    ok('billing: an owner-granted Pro survives the user\'s next save', (() => {
      const out = C.preserveBillingFields({ profile: { pro: false } }, { profile: { pro: true, trialEnds: 222 } });
      return out.profile.pro === true && out.profile.trialEnds === 222;
    })());
    ok('billing: the rest of the blob is untouched', (() => {
      const out = C.preserveBillingFields({ days: [1, 2], profile: { pro: true, name: 'Alex' } }, { profile: { pro: false, trialEnds: 5 } });
      return out.days.length === 2 && out.profile.name === 'Alex';
    })());
    ok('billing: first-ever save keeps its seeded trial', (() => {
      const out = C.preserveBillingFields({ profile: { trialEnds: 777 } }, null);
      return out.profile.trialEnds === 777 && out.profile.pro === false;
    })());
    ok('billing: a blob with no profile still gets billing fields', (() => {
      const out = C.preserveBillingFields({ days: [] }, { profile: { pro: true, trialEnds: 9 } });
      return out.profile.pro === true && out.profile.trialEnds === 9;
    })());
    // ── password-reset per-account answer lockout (hardening the recovery flow) ──
    // These counters now live in the DATABASE (they used to be in-memory Maps
    // that a deploy wiped and a second instance couldn't see), so they're async.
    const _ru = 'resetuser-' + Date.now();
    ok('reset lockout: a fresh account is not locked', (await C.resetLocked(_ru)) === false);
    await C.recordResetFail(_ru); await C.recordResetFail(_ru); await C.recordResetFail(_ru); await C.recordResetFail(_ru);
    ok('reset lockout: still open after 4 wrong answers', (await C.resetLocked(_ru)) === false);
    await C.recordResetFail(_ru);
    ok('reset lockout: locked at the 5th wrong answer', (await C.resetLocked(_ru)) === true);
    ok('reset lockout: CHECKING the lock does not itself count as an attempt',
      (await C.resetLocked(_ru)) === true && (await DBm.rateCount('reset:' + _ru, 900000)) === 5);
    await C.clearResetFails(_ru);
    ok('reset lockout: a correct answer clears the lock', (await C.resetLocked(_ru)) === false);
    // ── per-account write rate limit on /api/data (complements the size cap) ──
    const _wu = 'writeuser-' + Date.now();
    let anyBlockedEarly = false;
    for (let i = 0; i < 120; i++) { if (await C.saveRateLimited(_wu)) anyBlockedEarly = true; }
    ok('write limit: first 120 saves in a window all pass', anyBlockedEarly === false);
    ok('write limit: the 121st save in the window is throttled', (await C.saveRateLimited(_wu)) === true);
    ok('write limit: a different account is unaffected', (await C.saveRateLimited('other-' + Date.now())) === false);
    // ── the counters are DB-backed: they must outlive a process restart ──
    // Simulated by reading the stored counter directly, which is exactly what a
    // second instance (or the same box after a deploy) would see.
    ok('rate limits: the count is persisted in the database, not process memory',
      (await DBm.rateCount('save:' + _wu, 60000)) >= 120);
    ok('rate limits: an expired window resets the counter',
      (await DBm.rateHit('windowtest-' + Date.now(), 1000, Date.now())) === 1);
    const _kx = 'expiry-' + Date.now();
    await DBm.rateHit(_kx, 1000, 1000000);                       // long-past window
    ok('rate limits: a hit after the window has passed starts a fresh count',
      (await DBm.rateHit(_kx, 1000, 9000000)) === 1);
    ok('rate limits: prune removes expired counters',
      (await (async () => { await DBm.ratePrune(0, 9999999999); return await DBm.rateCount(_kx, 1000, 9000000); })()) === 0);
    // ── account deletion (App Store / Play requirement) — must remove the user AND cascade ──
    const delId = await DBm.createUser({ username: 'todelete', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null });
    await DBm.saveData(delId, { profile: { name: 'Bye' }, days: [1, 2] }, 1);
    await DBm.savePushSub(delId, { endpoint: 'https://push.example/del', keys: { p256dh: 'x', auth: 'y' } });
    await DBm.createPost({ user_id: delId, author_name: 'todelete', type: 'update', title: '', body: 'my post', data: {} });
    ok('pre-delete: the user, their data + push sub all exist', !!(await DBm.findUserById(delId)) && !!(await DBm.getData(delId)) && (await DBm.allPushSubs()).some(s => String(s.user_id) === String(delId)));
    const delOk = await DBm.deleteUser(delId);
    ok('deleteUser reports success', delOk === true);
    ok('after delete: the user row is gone', (await DBm.findUserById(delId)) === null);
    ok('after delete: their data blob is gone (cascade)', (await DBm.getData(delId)) === null);
    ok('after delete: their push subs are gone (cascade)', !(await DBm.allPushSubs()).some(s => String(s.user_id) === String(delId)));
    ok('after delete: their community posts are gone (cascade)', !(await DBm.listPosts('')).some(p => String(p.user_id) === String(delId)));
    ok('deleteUser on a missing id returns false', (await DBm.deleteUser(9999999)) === false);
    // ── token version (session revocation) ──
    const tvId = await DBm.createUser({ username: 'tvuser', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null });
    ok('new user starts at token version 0', (await DBm.getTokenVersion(tvId)) === 0);
    await DBm.bumpTokenVersion(tvId);
    ok('bumpTokenVersion increments (logout/password-change revokes old tokens)', (await DBm.getTokenVersion(tvId)) === 1);
    await DBm.bumpTokenVersion(tvId);
    ok('bumpTokenVersion is monotonic', (await DBm.getTokenVersion(tvId)) === 2);
    ok('getTokenVersion of a missing user is null (treated as revoked)', (await DBm.getTokenVersion(9999999)) === null);
  } catch (e) { failures.push('cloud DB (sqlite) — ' + e.message); }

  // ── static gzip layer (real HTTP round-trip) ──
  // The safety-critical property is that it compresses static assets but never
  // touches /api — the AI coach streams, and buffering that would break it.
  try {
    const srv = C.app.listen(0);
    srv.unref();   // never hold the process open
    await new Promise(r => srv.once('listening', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    const gz = (p, h) => fetch(base + p, { headers: Object.assign({ 'accept-encoding': 'gzip' }, h || {}) });

    const js = await gz('/app.js');
    ok('gzip: app.js is served compressed', js.headers.get('content-encoding') === 'gzip');
    ok('gzip: sets Vary: Accept-Encoding (safe for caches/CDNs)', /accept-encoding/i.test(js.headers.get('vary') || ''));
    const wire = +(js.headers.get('content-length') || 0);
    const decoded = Buffer.from(await js.arrayBuffer()).length;
    ok('gzip: the wire payload is far smaller than the file', wire > 0 && decoded > wire * 2,
      'wire ' + wire + ' vs decoded ' + decoded);
    ok('gzip: decoded bytes are the real, runnable file', decoded > 100000);

    // a client that cannot gzip still gets a valid, uncompressed file
    const plain = await fetch(base + '/app.js', { headers: { 'accept-encoding': 'identity' } });
    ok('gzip: identity clients still get uncompressed JS', !plain.headers.get('content-encoding'));
    ok('gzip: identity body is the full file', Buffer.from(await plain.arrayBuffer()).length === decoded);

    // API routes must never be intercepted (streaming safety)
    const api = await gz('/api/settings');
    ok('gzip: /api responses are NOT intercepted (streaming stays safe)', !api.headers.get('content-encoding'));

    // conditional requests still 304
    const et = js.headers.get('etag');
    const again = await gz('/app.js', { 'if-none-match': et });
    ok('gzip: matching ETag returns 304', !!et && again.status === 304);

    // deploys must land immediately for the shell + service worker
    const idx = await gz('/index.html');
    ok('gzip: index.html stays no-cache so a deploy lands immediately', /no-cache/.test(idx.headers.get('cache-control') || ''));
    const sw = await gz('/sw.js');
    ok('gzip: sw.js stays no-cache', /no-cache/.test(sw.headers.get('cache-control') || ''));

    // path traversal must never leak server source
    const trav = await gz('/../cloud/server.js');
    const travBody = await trav.text();
    ok('gzip: path traversal cannot leak server source', !/JWT_SECRET|DATABASE_URL|require\(/.test(travBody));

    // ── per-user storage cap on /api/data (disk-exhaustion guard) ──
    // Sign up over HTTP to get a real session token, then prove a normal save
    // lands but an oversized blob is rejected with 413 (not silently stored).
    const suUser = 'capuser-' + Date.now();
    const suRes = await fetch(base + '/api/signup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: suUser, password: 'testpw123', email: suUser + '@ex.com' })
    });
    const suBody = await suRes.json();
    ok('data cap: signup issues a session token', suRes.status === 200 && !!suBody.token);
    const authHdr = { 'content-type': 'application/json', authorization: 'Bearer ' + suBody.token };
    const saveData = (blob) => fetch(base + '/api/data', { method: 'POST', headers: authHdr, body: JSON.stringify(blob) });
    const okSave = await saveData({ profile: { name: 'Cap' }, days: [1, 2, 3] });
    ok('data cap: a normal-sized blob saves (200)', okSave.status === 200);
    const bigSave = await saveData({ profile: { name: 'Cap' }, junk: 'A'.repeat(2 * 1024 * 1024 + 5000) });
    ok('data cap: an oversized blob is rejected with 413', bigSave.status === 413);
    const stillThere = await fetch(base + '/api/data', { headers: authHdr });
    const stillBody = await stillThere.json();
    ok('data cap: the rejected save did NOT overwrite good data', stillThere.status === 200 && !stillBody.junk && stillBody.profile.name === 'Cap');

    // ── Private reading groups: outsiders must not reach group content ──
    // The membership gate existed on GET /api/groups/:id/notes and POST /api/notes
    // but was missing from every note SUBroute, and join never checked the invite
    // code — so sequential ids let anyone walk into any private group.
    const DBg = require(path.join(__dirname, '..', 'cloud', 'db.js'));
    const mkUser = async (name) => {
      const id = await DBg.createUser({ username: name, email: name + '@ex.com', pw_salt: 's', pw_hash: 'h', sec_question: null, sec_salt: null, sec_hash: null });
      return { id, h: { 'content-type': 'application/json', authorization: 'Bearer ' + C.signJwt({ sub: id, username: name, tv: 0 }, process.env.JWT_SECRET) } };
    };
    const _sfx = Date.now();
    const gOwner = await mkUser('gowner-' + _sfx);
    const gMember = await mkUser('gmember-' + _sfx);
    const gOutsider = await mkUser('goutsider-' + _sfx);
    const grp = await (await fetch(base + '/api/groups', { method: 'POST', headers: gOwner.h, body: JSON.stringify({ name: 'Private club' }) })).json();
    const gNote = await (await fetch(base + '/api/notes', { method: 'POST', headers: gOwner.h, body: JSON.stringify({ groupId: grp.id, body: 'private note' }) })).json();
    ok('groups: creating a group returns an invite code', !!grp.id && !!grp.invite_code);

    // joining requires the code
    const joinNoCode = await fetch(base + '/api/groups/' + grp.id + '/join', { method: 'POST', headers: gOutsider.h, body: '{}' });
    ok('groups: joining WITHOUT an invite code is refused', joinNoCode.status === 400, 'got ' + joinNoCode.status);
    const joinBadCode = await fetch(base + '/api/groups/' + grp.id + '/join', { method: 'POST', headers: gOutsider.h, body: JSON.stringify({ invite: 'deadbeef00' }) });
    ok('groups: joining with a WRONG invite code is refused', joinBadCode.status === 403, 'got ' + joinBadCode.status);
    const joinGood = await fetch(base + '/api/groups/' + grp.id + '/join', { method: 'POST', headers: gMember.h, body: JSON.stringify({ invite: grp.invite_code }) });
    ok('groups: joining with the CORRECT invite code works', joinGood.status === 200, 'got ' + joinGood.status);

    // every note subroute is gated, and denial is 404 (not 403) so ids can't be probed
    const outsiderHits = [];
    for (const [method, p] of [['GET', '/replies'], ['POST', '/replies'], ['POST', '/like'], ['POST', '/confuse']]) {
      const r = await fetch(base + '/api/notes/' + gNote.id + p, {
        method, headers: gOutsider.h, body: method === 'POST' ? JSON.stringify({ body: 'intrusion' }) : undefined
      });
      outsiderHits.push(method + p + ':' + r.status);
    }
    ok('groups: an outsider is blocked from EVERY note subroute',
      outsiderHits.every(s => s.endsWith(':404')), outsiderHits.join(' '));
    ok('groups: the outsider\'s reply was NOT stored', (await DBg.listReplies(gNote.id)).length === 0);
    const outsiderNotes = await fetch(base + '/api/groups/' + grp.id + '/notes', { headers: gOutsider.h });
    ok('groups: an outsider cannot list the group notes', outsiderNotes.status === 403, 'got ' + outsiderNotes.status);
    const outsiderNotify = await fetch(base + '/api/groups/' + grp.id + '/notify', { method: 'POST', headers: gOutsider.h, body: '{}' });
    ok('groups: an outsider cannot toggle group notifications', outsiderNotify.status === 403, 'got ' + outsiderNotify.status);

    // …and the legitimate member flow still works (a fix that breaks the feature is not a fix)
    const memberOk = [];
    memberOk.push((await fetch(base + '/api/groups/' + grp.id + '/notes', { headers: gMember.h })).status);
    memberOk.push((await fetch(base + '/api/notes/' + gNote.id + '/replies', { method: 'POST', headers: gMember.h, body: JSON.stringify({ body: 'real reply' }) })).status);
    memberOk.push((await fetch(base + '/api/notes/' + gNote.id + '/replies', { headers: gMember.h })).status);
    memberOk.push((await fetch(base + '/api/notes/' + gNote.id + '/like', { method: 'POST', headers: gMember.h, body: '{}' })).status);
    memberOk.push((await fetch(base + '/api/notes/' + gNote.id + '/confuse', { method: 'POST', headers: gMember.h, body: '{}' })).status);
    ok('groups: a real member can still read, reply, like and flag',
      memberOk.join(',') === '200,201,200,200,200', memberOk.join(','));

    // ── Note/reply fields must be CAPPED (they weren't) ──
    // /api/data is one row per user, overwritten. Notes INSERT forever, so an
    // uncapped body was a storage-exhaustion vector: measured 49MB from one
    // account in ~1s against 1GB of free-tier capacity.
    const huge = await (await fetch(base + '/api/notes', {
      method: 'POST', headers: gOwner.h,
      body: JSON.stringify({ groupId: grp.id, body: 'A'.repeat(50000), quote: 'B'.repeat(50000) })
    })).json();
    const hugeRow = await DBg.getNote(huge.id);
    ok('notes: an oversized note body is truncated, not stored whole',
      hugeRow.body.length === 4000, 'stored ' + hugeRow.body.length);
    ok('notes: an oversized quote is truncated too',
      (hugeRow.quote || '').length === 1000, 'stored ' + (hugeRow.quote || '').length);
    const hugeReply = await (await fetch(base + '/api/notes/' + gNote.id + '/replies', {
      method: 'POST', headers: gOwner.h, body: JSON.stringify({ body: 'C'.repeat(50000) })
    })).json();
    const replyRow = (await DBg.listReplies(gNote.id)).find(x => String(x.id) === String(hugeReply.id));
    ok('notes: an oversized reply body is truncated', replyRow && replyRow.body.length === 2000,
      replyRow ? 'stored ' + replyRow.body.length : 'reply missing');

    // a personal note (no group) stays private to its author
    const pNote = await (await fetch(base + '/api/notes', { method: 'POST', headers: gOwner.h, body: JSON.stringify({ body: 'personal' }) })).json();
    ok('groups: the author can reach their own personal note',
      (await fetch(base + '/api/notes/' + pNote.id + '/replies', { headers: gOwner.h })).status === 200);
    ok('groups: nobody else can reach a personal note',
      (await fetch(base + '/api/notes/' + pNote.id + '/replies', { headers: gMember.h })).status === 404);

    // ── Error log: failures must be recorded, and GROUPED not flooded ──
    // Same singleton the running server uses, so these assertions see its writes.
    const DBm = require(path.join(__dirname, '..', 'cloud', 'db.js'));
    await DBm.clearErrors();
    await DBm.logError({ sig: 'route|GET /api/x|boom', kind: 'route', route: 'GET /api/x', message: 'boom', stack: 'at foo', userId: null });
    ok('errors: a logged error is stored', (await DBm.errorCount()) === 1);
    await DBm.logError({ sig: 'route|GET /api/x|boom', kind: 'route', route: 'GET /api/x', message: 'boom', stack: 'at foo' });
    await DBm.logError({ sig: 'route|GET /api/x|boom', kind: 'route', route: 'GET /api/x', message: 'boom', stack: 'at foo' });
    ok('errors: repeats GROUP into one row instead of flooding', (await DBm.errorCount()) === 1);
    const grouped = (await DBm.listErrors(10))[0];
    ok('errors: the group counts every occurrence', grouped.count === 3, 'count=' + grouped.count);
    ok('errors: the group keeps route, message and stack', grouped.route === 'GET /api/x' && grouped.message === 'boom' && /at foo/.test(grouped.stack || ''));
    // Explicit timestamps: logging twice in the same millisecond would otherwise
    // make "newest first" a coin flip rather than a real assertion.
    const _tNew = Date.now() + 5000;
    await DBm.logError({ sig: 'route|GET /api/y|other', kind: 'route', route: 'GET /api/y', message: 'other', at: _tNew });
    ok('errors: a different failure is its own group', (await DBm.errorCount()) === 2);
    ok('errors: newest group is listed first', (await DBm.listErrors(10))[0].message === 'other');
    await DBm.pruneErrors(0, _tNew + 1000);
    ok('errors: prune clears out old groups', (await DBm.errorCount()) === 0);

    // The error log is owner-only: a normal account must not read stacks.
    const errRes = await fetch(base + '/api/admin/errors', { headers: authHdr });
    ok('errors: a non-owner account cannot read the error log', errRes.status === 403, 'got ' + errRes.status);
    const errAnon = await fetch(base + '/api/admin/errors');
    ok('errors: an anonymous caller cannot read the error log', errAnon.status === 401, 'got ' + errAnon.status);
    // Client crash reporting also requires an account (no anonymous writes).
    const cerrAnon = await fetch(base + '/api/client-error', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x' })
    });
    ok('errors: client crash reporting requires an account', cerrAnon.status === 401, 'got ' + cerrAnon.status);
    await DBm.clearErrors();
    const cerrAuthed = await fetch(base + '/api/client-error', {
      method: 'POST', headers: authHdr, body: JSON.stringify({ message: 'TypeError: x is not a function', stack: 'at render' })
    });
    ok('errors: an authenticated client crash IS recorded', cerrAuthed.status === 200 && (await DBm.errorCount()) === 1);
    ok('errors: the client crash is tagged as a client error',
      (await DBm.listErrors(5))[0].kind === 'client');
    await DBm.clearErrors();

    // ── AI cost telemetry: who is expensive must be answerable ──
    const _d1 = '2026-08-01', _d2 = '2026-08-02';
    await DBm.recordAIUsage(9001, _d1, 100, 50);
    await DBm.recordAIUsage(9001, _d1, 200, 80);      // same user+day → rolls up
    await DBm.recordAIUsage(9002, _d2, 10, 5);
    const tot = await DBm.aiUsageTotals('2026-08-01');
    ok('ai usage: calls are counted', tot.calls === 3, 'calls=' + tot.calls);
    ok('ai usage: tokens are summed', tot.in_tokens === 310 && tot.out_tokens === 135,
      tot.in_tokens + '/' + tot.out_tokens);
    ok('ai usage: distinct users counted', tot.users === 2, 'users=' + tot.users);
    ok('ai usage: same user+day rolls into ONE row, not one per call',
      (await DBm.aiTopUsers('2026-08-01', 10)).filter(r => String(r.user_id) === '9001').length === 1);
    const top = await DBm.aiTopUsers('2026-08-01', 10);
    ok('ai usage: the heaviest user ranks first', String(top[0].user_id) === '9001',
      'first=' + top[0].user_id);
    ok('ai usage: a later window excludes older days',
      (await DBm.aiUsageTotals('2026-08-02')).calls === 1);
    // usageFrom() must read all three providers' shapes
    ok('ai usage: reads the Anthropic usage shape',
      (() => { const u = C.usageFrom('anthropic', { usage: { input_tokens: 7, output_tokens: 3 } }); return u && u.in === 7 && u.out === 3; })());
    ok('ai usage: reads the OpenAI usage shape',
      (() => { const u = C.usageFrom('openai', { usage: { prompt_tokens: 11, completion_tokens: 4 } }); return u && u.in === 11 && u.out === 4; })());
    ok('ai usage: reads the Google usage shape',
      (() => { const u = C.usageFrom('google', { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }); return u && u.in === 5 && u.out === 2; })());
    ok('ai usage: a response with no usage block is ignored, not zero-recorded',
      C.usageFrom('anthropic', {}) === null);

    // ── AI provider defaults: pin the model so it can't silently go stale ──
    const cfgA = C.getAIConfig({ headers: { 'x-api-key': 'sk-ant-test' } });
    ok('AI model: Anthropic default is a current Claude 5 model',
      cfgA.provider === 'anthropic' && cfgA.model === 'claude-sonnet-5', cfgA.provider + '/' + cfgA.model);
    const cfgH = C.getAIConfig({ headers: { 'x-api-key': 'sk-ant-test', 'x-ai-model': 'claude-opus-5' } });
    ok('AI model: an explicit x-ai-model header still overrides the default', cfgH.model === 'claude-opus-5');

    // ── AI endpoints must require an account (cost-exhaustion guard) ──
    // Every one of these bills OUR provider key. Before requireAuth, a stranger
    // with a proxy pool could spend the whole AI budget with no account at all.
    const AI_ROUTES = ['/api/analyze', '/api/analyze-stream', '/api/chat', '/api/estimate-food',
                       '/api/insight', '/api/plan', '/api/patterns', '/api/review'];
    const anonCodes = [];
    for (const p of AI_ROUTES) {
      const r = await fetch(base + p, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], data: {} })
      });
      anonCodes.push(p + ':' + r.status);
    }
    ok('AI auth: every AI endpoint rejects an anonymous caller with 401',
      anonCodes.every(s => s.endsWith(':401')), anonCodes.join(' '));
    // …and the guard did not simply break them: an AUTHENTICATED caller gets past
    // requireAuth and reaches aiGuard, which answers NO_KEY (400) with no key set.
    const authedAi = await fetch(base + '/api/chat', {
      method: 'POST', headers: authHdr,
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], data: {} })
    });
    ok('AI auth: an authenticated caller passes auth and reaches the AI guard',
      authedAi.status !== 401, 'got ' + authedAi.status);

    // Node's fetch keeps sockets alive; leaving them open when the suite calls
    // process.exit trips a libuv assertion on Windows. Drop them explicitly, then
    // yield a tick so the handles are fully released before the report exits —
    // closing alone still left a ~1-in-4 race.
    try { srv.closeAllConnections(); } catch (e) {}
    await new Promise(r => srv.close(r));
    await new Promise(r => setTimeout(r, 60));
  } catch (e) { failures.push('static gzip layer — ' + e.message); }

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
