// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
let state = {
  data: {
    profile: { name: '', gymDaysPerWeek: 5, weeklyIncomeGoal: 0, weeklyNetworkGoal: 3 },
    days: [],    // daily logs (gym, food, networking, money)
    weeks: [],   // weekly income totals
    ideas: []    // business ideas
  },
  page: 'dashboard',
  hasApiKey: false,
  token: null,
  user: null,
  _editDayId: null,
  _editWeekId: null
};
let charts = {};

// ─────────────────────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────────────────────
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (state.token) h.Authorization = 'Bearer ' + state.token;
  return h;
}

// API base — '' means same-origin (current default). Set a cloud URL with
//   localStorage.setItem('be_api_base', 'https://api.example.com')
// and every /api request is transparently routed there. No behavior change today.
const API_BASE = (typeof localStorage !== 'undefined' && localStorage.getItem('be_api_base')) || '';
if (API_BASE && typeof window !== 'undefined' && window.fetch && !window.__beFetchPatched) {
  const _origFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => _origFetch((typeof url === 'string' && url.startsWith('/api')) ? API_BASE + url : url, opts);
  window.__beFetchPatched = true;
}

const SECURITY_QUESTIONS = [
  'What was the name of your first pet?',
  'What city were you born in?',
  'What was your childhood nickname?',
  "What is your mother's maiden name?",
  'What was the name of your first school?',
  'What was the make of your first car?',
  'What is your favorite movie?'
];

// ─────────────────────────────────────────────────────────────
// CUSTOMIZABLE PILLARS
// Each pillar slot is a fixed INPUT TYPE — only the label, icon,
// goal and on/off state are user-configurable. This lets anyone
// reshape the app to their life without changing the data engine.
//   gym        → boolean  "Did you do it?"  (builds a daily streak)
//   food       → rating   "Rate it 1–5"
//   networking → count    "How many today?"
//   money      → amount   "A number / $ amount"
//   reading    → reading  "Pages + summary, with a book tracker"
// ─────────────────────────────────────────────────────────────
const PILLAR_META = {
  gym:        { type: 'boolean', cls: 'gym',     defaultLabel: 'Gym',        defaultIcon: '💪', goalKey: 'gymDaysPerWeek',   measures: 'Did you do it? — builds a daily streak' },
  food:       { type: 'rating',  cls: 'food',    defaultLabel: 'Food',       defaultIcon: '🥗', goalKey: null,               measures: 'Quality rating from 1 to 5' },
  networking: { type: 'count',   cls: 'network', defaultLabel: 'Networking', defaultIcon: '🤝', goalKey: 'weeklyNetworkGoal', measures: 'How many today? — a daily count' },
  money:      { type: 'amount',  cls: 'money',   defaultLabel: 'Income',     defaultIcon: '💰', goalKey: 'weeklyIncomeGoal', measures: 'A dollar amount + what you did' },
  reading:    { type: 'reading', cls: 'read',    defaultLabel: 'Reading',    defaultIcon: '📚', goalKey: 'weeklyReadGoal',   measures: 'Pages read + a summary, with a book tracker' }
};
const PILLAR_IDS = ['gym', 'food', 'networking', 'money', 'reading'];

const PILLAR_PRESETS = {
  sales: {
    name: '💼 Sales Hustler', desc: 'Gym · Food · Networking · Income · Reading',
    pillars: {
      gym:        { enabled: true, label: 'Gym',        icon: '💪' },
      food:       { enabled: true, label: 'Food',       icon: '🥗' },
      networking: { enabled: true, label: 'Networking', icon: '🤝' },
      money:      { enabled: true, label: 'Income',     icon: '💰' },
      reading:    { enabled: true, label: 'Reading',    icon: '📚' }
    }
  },
  student: {
    name: '🎓 Student', desc: 'Study · Sleep · Practice · — · Reading',
    pillars: {
      gym:        { enabled: true,  label: 'Study Session', icon: '📖' },
      food:       { enabled: true,  label: 'Sleep Quality', icon: '😴' },
      networking: { enabled: true,  label: 'Practice Qs',   icon: '✏️' },
      money:      { enabled: false, label: 'Income',        icon: '💰' },
      reading:    { enabled: true,  label: 'Reading',       icon: '📚' }
    }
  },
  creator: {
    name: '🎨 Creator', desc: 'Create · Energy · Posts · Revenue · Learning',
    pillars: {
      gym:        { enabled: true, label: 'Create',   icon: '🎨' },
      food:       { enabled: true, label: 'Energy',   icon: '⚡' },
      networking: { enabled: true, label: 'Posts Out', icon: '📣' },
      money:      { enabled: true, label: 'Revenue',  icon: '💰' },
      reading:    { enabled: true, label: 'Learning', icon: '📚' }
    }
  },
  health: {
    name: '🧘 Health & Wellness', desc: 'Exercise · Diet · Water · — · Reading',
    pillars: {
      gym:        { enabled: true,  label: 'Exercise',  icon: '🏃' },
      food:       { enabled: true,  label: 'Diet',      icon: '🥗' },
      networking: { enabled: true,  label: 'Water (glasses)', icon: '💧' },
      money:      { enabled: false, label: 'Income',    icon: '💰' },
      reading:    { enabled: true,  label: 'Reading',   icon: '📚' }
    }
  },
  custom: {
    name: '⚙️ Build My Own', desc: 'Start from the defaults and rename everything',
    pillars: null // means: keep current / defaults
  }
};

function defaultPillars() {
  return JSON.parse(JSON.stringify(PILLAR_PRESETS.sales.pillars));
}

// Merge stored config over the fixed meta. Always returns label/icon/enabled.
function pillar(id) {
  const meta = PILLAR_META[id];
  const cfg = (state.data.profile?.pillars && state.data.profile.pillars[id]) || {};
  return {
    id, type: meta.type, cls: meta.cls, goalKey: meta.goalKey, measures: meta.measures,
    label: cfg.label || meta.defaultLabel,
    icon:  cfg.icon  || meta.defaultIcon,
    enabled: cfg.enabled !== false
  };
}
function isPillarOn(id) { return pillar(id).enabled; }
function enabledPillars() { return PILLAR_IDS.map(pillar).filter(p => p.enabled); }

// ─────────────────────────────────────────────────────────────
// AI COACH PROMPTS
// ─────────────────────────────────────────────────────────────
const ANALYSES = [
  {
    id: 'overall', icon: '⚡', title: 'My Full Life Audit',
    desc: 'See how all your areas connect and what to focus on first',
    prompt: () => {
      const stats = getWeekStats();
      const parts = [];
      if (isPillarOn('gym'))        parts.push(stats.gymDays + ' ' + pillar('gym').label.toLowerCase() + ' days');
      if (isPillarOn('food'))       parts.push('avg ' + pillar('food').label.toLowerCase() + ' ' + stats.avgFood.toFixed(1) + '/5');
      if (isPillarOn('networking')) parts.push(stats.networkCount + ' ' + pillar('networking').label.toLowerCase());
      if (isPillarOn('money'))      parts.push('$' + stats.weekIncome + ' ' + pillar('money').label.toLowerCase());
      if (isPillarOn('reading'))    parts.push(stats.readPages + ' pages read');
      const n = enabledPillars().length;
      return 'Give me an honest audit of my progress across all ' + n + ' of my areas.\n\n' +
        'This week: ' + parts.join(', ') + '.\n\n' +
        '## 1. Overall Score\nRate me 1–10 in each area this week and explain why.\n\n' +
        '## 2. The Chain Reaction\nHow are my areas affecting each other right now? (e.g. is one area dragging down or lifting up the others?)\n\n' +
        '## 3. My Biggest Lever\nWhich single area, if improved this week, would have the biggest positive ripple effect on the others?\n\n' +
        '## 4. The 30-Day Plan\nIf I stay consistent across all my areas for 30 days, what realistically changes in my life?';
    }
  },
  {
    id: 'gym', icon: '💪', title: 'Optimize My Training',
    desc: 'Build more muscle faster based on your workout consistency and patterns',
    prompt: () => {
      const gymDays = state.data.days.filter(d => d.gym?.done).length;
      const total = state.data.days.length;
      return 'Help me build muscle faster and train smarter.\n\n' +
        'My gym data: ' + gymDays + ' workouts logged out of ' + total + ' days tracked.\n' +
        'Goal: ' + state.data.profile.gymDaysPerWeek + ' days/week.\n\n' +
        '## 1. Training Frequency Fix\nBased on my consistency, what specific split (e.g. PPL, Upper/Lower) should I be doing?\n\n' +
        '## 2. Muscle Building Priorities\nFor someone building muscle, what are the top 3 things most people get wrong? Am I making those mistakes?\n\n' +
        '## 3. Gym + Money Connection\nHow can I use my gym time and environment (gym contacts, energy, discipline) to also improve my income?\n\n' +
        '## 4. Recovery & Food\nWhat should I be eating to maximize my muscle gains based on my food rating history?';
    }
  },
  {
    id: 'network', icon: '🤝', title: 'Network Into Opportunities',
    desc: 'Turn your connections into real money, partnerships, and career growth',
    prompt: () => {
      const totalConnections = state.data.days.reduce((s, d) => s + (d.networking?.count || 0), 0);
      const ideas = state.data.ideas.filter(i => i.status !== 'dropped');
      return 'Help me turn my networking into real opportunities and income.\n\n' +
        'Total connections logged: ' + totalConnections + '. Active business ideas: ' + ideas.length + '.\n\n' +
        '## 1. The Right People to Meet\nFor someone in commission-based sales looking to grow income, who are the 5 types of people I should be meeting at the gym, events, or online?\n\n' +
        '## 2. The Follow-Up System\nWhat is the exact process to convert a new connection into a business opportunity within 7 days?\n\n' +
        '## 3. Networking Spots\nBeyond the gym, where are the best places for someone like me to meet high-value contacts?\n\n' +
        '## 4. Networking → Income\nGive me a specific example of how to turn 3 gym contacts into $1,000 in commission within 30 days.';
    }
  },
  {
    id: 'money', icon: '💰', title: 'Stack More Income',
    desc: 'Maximize your commission + find other income streams to build real wealth',
    prompt: () => {
      const avg = getWeeklyAvg(state.data.weeks, 4);
      const goal = state.data.profile.weeklyIncomeGoal || 0;
      const ideas = state.data.ideas;
      return 'Help me make significantly more money.\n\n' +
        '4-week income average: $' + Math.round(avg) + '. ' +
        (goal > 0 ? 'Goal: $' + goal + '/week. ' : '') +
        'Business ideas I\'m exploring: ' + (ideas.length > 0 ? ideas.map(i => i.title).join(', ') : 'none logged yet') + '.\n\n' +
        '## 1. Commission Maximizer\nGive me 5 specific tactics to increase my weekly commission this week. Real, actionable, no fluff.\n\n' +
        '## 2. Best Side Income for My Profile\nBased on my situation (commission sales, gym-going, active networker), what is the single best additional income stream to add right now? Include realistic earnings and startup time.\n\n' +
        '## 3. The $500 Extra Challenge\nHow would you make an extra $500 this week if you were me? Step by step.\n\n' +
        '## 4. 6-Month Money Vision\nIf I optimize all my areas of life, what does my financial situation realistically look like in 6 months?';
    }
  }
];

// ─────────────────────────────────────────────────────────────
// DAILY QUOTES  (rotates by day of year)
// ─────────────────────────────────────────────────────────────
const QUOTES = [
  { text: "Discipline is choosing between what you want now and what you want most.", author: "Abraham Lincoln" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Your body can stand almost anything. It's your mind you have to convince.", author: "Unknown" },
  { text: "Don't stop when you're tired. Stop when you're done.", author: "Unknown" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "The richest people build networks. Everyone else looks for work.", author: "Robert Kiyosaki" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Your network is your net worth.", author: "Porter Gale" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Train insane or remain the same.", author: "Unknown" },
  { text: "Champions are made from something they have deep inside — a desire, a dream, a vision.", author: "Muhammad Ali" },
  { text: "The body achieves what the mind believes.", author: "Unknown" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "To be successful, you must accept all challenges that come your way.", author: "Mike Tyson" },
  { text: "An investment in yourself pays the best interest.", author: "Benjamin Franklin" },
  { text: "Every rep, every set, every day builds the version of you that wins.", author: "Unknown" },
  { text: "Networking is connecting people with ideas and opportunities.", author: "Michele Jennae" },
  { text: "Rich people have big libraries. Poor people have big TVs.", author: "Zig Ziglar" },
  { text: "The difference between who you are and who you want to be is what you do.", author: "Unknown" },
  { text: "You don't get what you wish for. You get what you work for.", author: "Unknown" },
  { text: "Take care of your body. It's the only place you have to live.", author: "Jim Rohn" },
  { text: "Money is a tool. It will take you wherever you wish — but it won't replace you as the driver.", author: "Ayn Rand" },
  { text: "Champions keep playing until they get it right.", author: "Billie Jean King" },
  { text: "Success is walking from failure to failure with no loss of enthusiasm.", author: "Winston Churchill" },
  { text: "We become what we repeatedly do. Excellence is not an act — it's a habit.", author: "Aristotle" },
  { text: "What you do today can improve all of your tomorrows.", author: "Ralph Marston" },
  { text: "No pain, no gain. Shut up and train.", author: "Unknown" },
  { text: "Either you run the day or the day runs you.", author: "Jim Rohn" },
  { text: "A year from now you may wish you had started today.", author: "Karen Lamb" }
];

// ─────────────────────────────────────────────────────────────
// SECURITY — HTML SANITIZER  (prevents XSS from AI output)
// ─────────────────────────────────────────────────────────────
const SAFE_TAGS = new Set([
  'p','br','b','strong','i','em','u','s','h1','h2','h3','h4','h5','h6',
  'ul','ol','li','table','thead','tbody','tr','th','td','code','pre',
  'blockquote','hr','span','div','a'
]);
function sanitizeHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  function walk(node) {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }
      const tag = child.tagName.toLowerCase();
      if (!SAFE_TAGS.has(tag)) { child.replaceWith(...child.childNodes); walk(node); return; }
      [...child.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        if (tag === 'a' && n === 'href') { if (/^javascript:/i.test(attr.value)) child.removeAttribute(n); }
        else if (!['class','colspan','rowspan'].includes(n)) child.removeAttribute(n);
      });
      walk(child);
    });
  }
  walk(root);
  return root.innerHTML;
}
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Render markdown safely; falls back to plain text if the lib didn't load
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') return sanitizeHtml(marked.parse(text));
  return '<pre style="white-space:pre-wrap;font-family:inherit;margin:0">' + escapeHtml(text) + '</pre>';
}

// ─────────────────────────────────────────────────────────────
// XP & LEVEL SYSTEM
// ─────────────────────────────────────────────────────────────
const LEVELS = [
  { min: 0,    label: 'Rookie',   color: '#94A3B8' },
  { min: 100,  label: 'Hustler',  color: '#3B82F6' },
  { min: 300,  label: 'Grinder',  color: '#10B981' },
  { min: 600,  label: 'Player',   color: '#F59E0B' },
  { min: 1000, label: 'Closer',   color: '#A78BFA' },
  { min: 1800, label: 'Wolf',     color: '#EF4444' },
  { min: 3000, label: 'Legend',   color: '#F97316' }
];

function computeXP() {
  const { days, weeks, books } = state.data;
  let xp = 0;
  days.forEach(d => {
    if (d.gym?.done)            xp += 10;
    if (d.food?.rating > 0)     xp += 5;
    xp += (d.networking?.count || 0) * 3;
    if (d.reading?.pages > 0)   xp += 8;
  });
  weeks.forEach(w => { if (w.income > 0) xp += 15; });
  (books || []).filter(b => b.status === 'finished').forEach(() => { xp += 50; });
  return xp;
}

function getLevel(xp) {
  let idx = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) { if (xp >= LEVELS[i].min) { idx = i; break; } }
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1];
  const pct = next ? Math.min(100, Math.round(((xp - cur.min) / (next.min - cur.min)) * 100)) : 100;
  return { level: idx + 1, label: cur.label, color: cur.color, xp, pct, nextMin: next?.min, nextLabel: next?.label };
}

function renderXPBar() {
  const xp  = computeXP();
  const lvl = getLevel(xp);
  const toNext = lvl.nextMin ? lvl.nextMin - xp : 0;
  let el = document.getElementById('xp-bar-wrap');
  const html = `<div id="xp-bar-wrap" class="xp-bar-wrap">
    <div class="xp-top">
      <span class="xp-label" style="color:${lvl.color}">⚡ Lv.${lvl.level} ${lvl.label}</span>
      <span class="xp-pts">${xp.toLocaleString()} XP</span>
    </div>
    <div class="xp-track"><div class="xp-fill" style="width:${lvl.pct}%;background:${lvl.color};box-shadow:0 0 8px ${lvl.color}44"></div></div>
    <div class="xp-next">${toNext > 0 ? toNext + ' XP to ' + lvl.nextLabel : '🏆 MAX LEVEL'}</div>
  </div>`;
  if (el) { el.outerHTML = html; }
  else {
    const brand = document.querySelector('.sidebar-brand');
    if (brand) brand.insertAdjacentHTML('afterend', html);
  }
}

function getDailyQuote() {
  const d = new Date();
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return QUOTES[dayOfYear % QUOTES.length];
}

function renderQuoteCard() {
  const q = getDailyQuote();
  return '<div class="quote-card">' +
    '<span class="quote-mark">"</span>' +
    '<div class="quote-text">' + q.text + '</div>' +
    '<div class="quote-author">— ' + q.author + ' &nbsp;·&nbsp; <span style="color:var(--text-muted)">Today\'s Fuel ⚡</span></div>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────
// ACHIEVEMENTS
// ─────────────────────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { id: 'first_log',    icon: '📝', title: 'First Step',      desc: 'Log your first day',                    cat: 'general', check: d => d.days.length >= 1 },
  { id: 'days_7',       icon: '🌟', title: 'Tracker',         desc: 'Log 7 days total',                      cat: 'general', check: d => d.days.length >= 7 },
  { id: 'days_30',      icon: '🏅', title: 'Dedicated',       desc: 'Log 30 days total',                     cat: 'general', check: d => d.days.length >= 30 },
  { id: 'days_100',     icon: '⚡', title: 'Unstoppable',     desc: 'Log 100 days total',                    cat: 'general', check: d => d.days.length >= 100 },
  { id: 'first_gym',    icon: '🏋️', title: 'First Rep',       desc: 'Log your first workout',                cat: 'gym',     check: d => d.days.some(x => x.gym?.done) },
  { id: 'streak_3',     icon: '🔥', title: 'Streak Starter',  desc: '3-day gym streak',                      cat: 'gym',     check: d => getGymStreakFromData(d.days) >= 3 },
  { id: 'streak_7',     icon: '💪', title: 'Week Warrior',    desc: '7-day gym streak',                      cat: 'gym',     check: d => getGymStreakFromData(d.days) >= 7 },
  { id: 'streak_14',    icon: '🦾', title: 'Iron Will',       desc: '14-day gym streak',                     cat: 'gym',     check: d => getGymStreakFromData(d.days) >= 14 },
  { id: 'workouts_30',  icon: '👑', title: 'Gym Royalty',     desc: '30 workouts logged',                    cat: 'gym',     check: d => d.days.filter(x => x.gym?.done).length >= 30 },
  { id: 'clean_5',      icon: '🥗', title: 'Clean Eater',     desc: 'Food 4+ for 5 days straight',           cat: 'food',    check: d => hasFoodStreakOf(d.days, 4, 5) },
  { id: 'log_7',        icon: '🌿', title: 'Fuel Machine',    desc: 'Log 7 consecutive days',                cat: 'food',    check: d => hasLogStreakOf(d.days, 7) },
  { id: 'net_10',       icon: '🤝', title: 'Connector',       desc: '10 total connections',                  cat: 'network', check: d => d.days.reduce((s,x)=>s+(x.networking?.count||0),0) >= 10 },
  { id: 'net_25',       icon: '🌐', title: 'Networker',       desc: '25 total connections',                  cat: 'network', check: d => d.days.reduce((s,x)=>s+(x.networking?.count||0),0) >= 25 },
  { id: 'net_50',       icon: '🏆', title: 'Power Player',    desc: '50 total connections',                  cat: 'network', check: d => d.days.reduce((s,x)=>s+(x.networking?.count||0),0) >= 50 },
  { id: 'first_income', icon: '💰', title: 'First Win',       desc: 'Log your first weekly income',          cat: 'money',   check: d => d.weeks.some(w => w.income > 0) },
  { id: 'hit_goal',     icon: '🎯', title: 'Goal Crusher',    desc: 'Hit your weekly income goal',           cat: 'money',   check: d => d.profile.weeklyIncomeGoal > 0 && d.weeks.some(w => w.income >= d.profile.weeklyIncomeGoal) },
  { id: 'hit_goal_3',   icon: '🚀', title: 'On a Roll',       desc: 'Hit income goal 3 times',               cat: 'money',   check: d => d.profile.weeklyIncomeGoal > 0 && d.weeks.filter(w => w.income >= d.profile.weeklyIncomeGoal).length >= 3 },
  { id: 'ideas_3',      icon: '💡', title: 'Visionary',       desc: 'Add 3+ business ideas',                cat: 'general', check: d => d.ideas.length >= 3 },
  { id: 'idea_active',  icon: '🛠️', title: 'Builder',         desc: 'Have an active business idea',          cat: 'general', check: d => d.ideas.some(i => i.status === 'active') }
];

function computeAchievements() {
  return ACHIEVEMENT_DEFS.map(def => ({ ...def, earned: (() => { try { return def.check(state.data); } catch { return false; } })() }));
}

function getGymStreakFromData(days) {
  const sorted = [...days].sort((a, b) => new Date(b.date) - new Date(a.date));
  let streak = 0, prev = null;
  for (const d of sorted) {
    if (!d.gym?.done) { if (streak === 0) continue; break; }
    if (prev) {
      const diff = (new Date(prev + 'T00:00:00') - new Date(d.date + 'T00:00:00')) / 86400000;
      if (diff > 2) break;
    }
    streak++; prev = d.date;
  }
  return streak;
}

function hasFoodStreakOf(days, minRating, minDays) {
  const sorted = [...days].filter(d => d.food?.rating > 0).sort((a, b) => new Date(a.date) - new Date(b.date));
  let streak = 0, best = 0, prev = null;
  for (const d of sorted) {
    if (d.food.rating >= minRating) {
      if (prev) { const diff = (new Date(d.date+'T00:00:00') - new Date(prev+'T00:00:00')) / 86400000; streak = diff === 1 ? streak + 1 : 1; }
      else streak = 1;
      best = Math.max(best, streak);
    } else { streak = 0; }
    prev = d.date;
  }
  return best >= minDays;
}

function hasLogStreakOf(days, minDays) {
  const sorted = [...days].sort((a, b) => new Date(a.date) - new Date(b.date));
  let streak = 0, best = 0, prev = null;
  for (const d of sorted) {
    if (prev) { const diff = (new Date(d.date+'T00:00:00') - new Date(prev+'T00:00:00')) / 86400000; streak = diff === 1 ? streak + 1 : 1; }
    else streak = 1;
    best = Math.max(best, streak); prev = d.date;
  }
  return best >= minDays;
}

function renderAchievementsSection() {
  const all = computeAchievements();
  const earned = all.filter(a => a.earned);
  const locked = all.filter(a => !a.earned);
  const pct = Math.round((earned.length / all.length) * 100);

  const badge = (a, isLocked) =>
    '<div class="ach-badge ' + (isLocked ? 'ach-locked' : 'ach-earned') + '" title="' + a.desc + '">' +
    '<div class="ach-icon">' + (isLocked ? '🔒' : a.icon) + '</div>' +
    '<div class="ach-name">' + a.title + '</div>' +
    '<div class="ach-desc">' + a.desc + '</div>' +
    '</div>';

  return '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
    '<h3 class="card-title" style="margin-bottom:0">🏆 Achievements</h3>' +
    '<span style="font-size:13px;color:var(--text-muted)">' + earned.length + '/' + all.length + ' · ' + pct + '% complete</span>' +
    '</div>' +
    '<div class="ach-progress-bar"><div style="width:' + pct + '%;background:linear-gradient(90deg,var(--primary),var(--accent));height:100%;border-radius:4px;transition:width 1s ease"></div></div>' +
    '<div class="ach-grid">' +
    earned.map(a => badge(a, false)).join('') +
    locked.map(a => badge(a, true)).join('') +
    '</div></div>';
}

// ─────────────────────────────────────────────────────────────
// COUNTER ANIMATIONS
// ─────────────────────────────────────────────────────────────
function animateCounters() {
  document.querySelectorAll('.anim-count').forEach(el => {
    const target = parseFloat(el.dataset.val || '0');
    if (!target) return;
    const isDecimal = el.dataset.decimal === '1';
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const start = performance.now();
    const dur = 900;
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = eased * target;
      el.textContent = prefix + (isDecimal ? v.toFixed(1) : Math.round(v)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// ─────────────────────────────────────────────────────────────
// WEEKLY REVIEW MODAL  (shows on Sunday)
// ─────────────────────────────────────────────────────────────
function showWeeklyReview() {
  if (new Date().getDay() !== 0) return;
  const key = 'wkReview_' + todayStr();
  if (localStorage.getItem(key)) return;
  const { days, weeks, profile } = state.data;
  if (days.length === 0) return;
  localStorage.setItem(key, '1');

  const ws = getWeekStart(todayStr());
  const wd = days.filter(d => d.date >= ws);
  if (wd.length === 0) return;

  const gymDays = wd.filter(d => d.gym?.done).length;
  const fr = wd.filter(d => d.food?.rating > 0).map(d => d.food.rating);
  const avgFood = fr.length ? fr.reduce((a,b)=>a+b,0)/fr.length : 0;
  const net = wd.reduce((s,d)=>s+(d.networking?.count||0),0);
  const inc = weeks.find(w => w.weekStart === ws)?.income || 0;

  const scores = [];
  if (profile.gymDaysPerWeek > 0) scores.push(Math.min(100,(gymDays/profile.gymDaysPerWeek)*100));
  if (avgFood > 0) scores.push((avgFood/5)*100);
  if (profile.weeklyNetworkGoal > 0) scores.push(Math.min(100,(net/profile.weeklyNetworkGoal)*100));
  if (profile.weeklyIncomeGoal > 0) scores.push(Math.min(100,(inc/profile.weeklyIncomeGoal)*100));
  const score = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;

  const scoreColor = score>=80?'#10B981':score>=60?'#F59E0B':score>=40?'#F97316':'#EF4444';
  const scoreLabel = score>=80?'Crushing It 🔥':score>=60?'Solid Week 💪':score>=40?'Room to Grow 📈':'Time to Push ⚡';
  const tips = [
    'You showed up this week. That\'s what separates you from 90% of people.',
    'Every connection you made this week is a seed. Water it with follow-ups.',
    'The gym is where confidence is forged. Never skip the work.',
    'Your income goal isn\'t a ceiling — it\'s a floor. Push past it next week.',
    'Consistency beats intensity. One more week logged is one more week of data.',
    'What you do in the off days defines the champion. Rest smart, come back harder.'
  ];

  setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'weekly-modal';
    el.innerHTML =
      '<div class="modal-box">' +
      '<div class="modal-badge">📊 Weekly Review</div>' +
      '<div class="modal-score" style="color:' + scoreColor + '">' + score + '<span>%</span></div>' +
      '<div class="modal-score-label">' + scoreLabel + '</div>' +
      '<div class="review-grid">' +
      '<div class="rv-item"><span>💪 Gym</span><strong>' + gymDays + '/' + profile.gymDaysPerWeek + ' days</strong></div>' +
      '<div class="rv-item"><span>🥗 Food avg</span><strong>' + (avgFood>0?avgFood.toFixed(1)+'/5':'—') + '</strong></div>' +
      '<div class="rv-item"><span>🤝 Network</span><strong>' + net + ' contacts</strong></div>' +
      '<div class="rv-item"><span>💰 Income</span><strong>' + formatCurrency(inc) + '</strong></div>' +
      '</div>' +
      '<div class="review-tip">💡 ' + tips[Math.floor(Math.random()*tips.length)] + '</div>' +
      '<button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="document.getElementById(\'weekly-modal\').remove()">Start the New Week →</button>' +
      '</div>';
    document.body.appendChild(el);
  }, 1800);
}

// ─────────────────────────────────────────────────────────────
// STREAK CELEBRATION
// ─────────────────────────────────────────────────────────────
function showStreakCelebration(streak) {
  const milestones = {
    3:  { title: '🔥 3-Day Streak!',  sub: 'The habit is forming. Don\'t break it now!' },
    7:  { title: '💪 7-Day Streak!',  sub: 'A full week of discipline. You\'re built different.' },
    14: { title: '🦾 14-Day Streak!', sub: 'Two weeks. This is who you are now.' },
    21: { title: '👑 21-Day Streak!', sub: '21 days — the habit is permanently yours.' },
    30: { title: '⚡ 30-Day Streak!', sub: 'A full month. You are UNSTOPPABLE.' }
  };
  const m = milestones[streak];
  if (!m) return;

  const emojis = ['🔥','💪','⚡','🏆','✨','🎯','💥','🌟','👊','🦾'];
  let particles = '';
  for (let i = 0; i < 28; i++) {
    const e = emojis[Math.floor(Math.random()*emojis.length)];
    const left = Math.random() * 100;
    const delay = Math.random() * 2;
    const dur = 2 + Math.random() * 2;
    const size = 16 + Math.random() * 20;
    particles += '<div class="conf-p" style="left:' + left + '%;font-size:' + size + 'px;animation-delay:' + delay + 's;animation-duration:' + dur + 's">' + e + '</div>';
  }

  const el = document.createElement('div');
  el.className = 'celebration-overlay';
  el.onclick = () => el.remove();
  el.innerHTML = particles +
    '<div class="celeb-box">' +
    '<div class="celeb-title">' + m.title + '</div>' +
    '<div class="celeb-sub">' + m.sub + '</div>' +
    '<div class="celeb-tap">tap anywhere to continue</div>' +
    '</div>';
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
// Entry point — gate the app behind a login session
async function init() {
  state.token = localStorage.getItem('be_token');
  let session = { authed: false };
  if (state.token) {
    try { session = await fetch('/api/session', { headers: authHeaders() }).then(r => r.json()); } catch {}
  }
  if (!session.authed) { state.token = null; localStorage.removeItem('be_token'); renderAuthScreen(); return; }
  state.user = session.username;
  state.hasSecurity = session.hasSecurity;
  state.isOwner = !!session.isOwner;
  await startApp();
}

// Loads the signed-in account's data and renders the app
async function startApp() {
  document.getElementById('auth-screen')?.remove();
  document.body.classList.remove('auth-active');
  try {
    const [dataRes, ks] = await Promise.all([
      fetch('/api/data', { headers: authHeaders() }),
      fetch('/api/settings').then(r => r.json())
    ]);
    state.data = await dataRes.json();
    state._dataVersion = parseInt(dataRes.headers.get('X-Data-Version'), 10) || 1;
    state.hasApiKey = ks.hasKey;
    state.payLink = ks.payLink || '';
    state.priceLabel = ks.price || '$7.99/mo';
    state.paymentsLive = !!ks.payLink;       // paywall only turns on once a Stripe link is set
  } catch {
    state.data = { profile: { name: '', gymDaysPerWeek: 5, weeklyIncomeGoal: 0, weeklyNetworkGoal: 3 }, days: [], weeks: [], ideas: [] };
    state._dataVersion = 1;
  }
  // Subscription gate: once payments are live, lock the app after the free trial ends
  if (subStatus().locked) { renderPaywall(); return; }
  if (!state.data.profile)   state.data.profile   = { name: '', gymDaysPerWeek: 5, weeklyIncomeGoal: 0, weeklyNetworkGoal: 3 };
  if (!state.data.days)     state.data.days     = [];
  if (!state.data.weeks)    state.data.weeks    = [];
  if (!state.data.ideas)    state.data.ideas    = [];
  if (!state.data.contacts) state.data.contacts = [];
  if (!state.data.books)    state.data.books    = [];
  if (!state.data.weights)  state.data.weights  = [];
  ensureChecklistData();
  if (!state.data.profile.pillars) state.data.profile.pillars = defaultPillars();

  // Dark mode chart defaults (guarded — app still works if Chart didn't load)
  if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#64748B';
  Chart.defaults.borderColor = '#252D3D';
  Chart.defaults.plugins.tooltip.backgroundColor = '#1E2438';
  Chart.defaults.plugins.tooltip.titleColor = '#E2E8F0';
  Chart.defaults.plugins.tooltip.bodyColor = '#94A3B8';
  Chart.defaults.plugins.tooltip.borderColor = '#2E3A52';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  }

  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.page); })
  );
  renderUserChip();
  applyNavVisibility();
  renderXPBar();
  if (!state.data.profile.onboarded && state.data.days.length === 0) showOnboarding();
  navigate('dashboard');
  showWeeklyReview();
  startReminderLoop();
}

// ─────────────────────────────────────────────────────────────
// LOGIN / SIGN-UP SCREEN
// ─────────────────────────────────────────────────────────────
function renderAuthScreen(mode) {
  document.getElementById('auth-screen')?.remove();
  document.body.classList.add('auth-active');
  const isSignup = mode === 'signup';
  const screen = document.createElement('div');
  screen.id = 'auth-screen';
  screen.innerHTML =
    '<div class="auth-card">' +
    '<div class="auth-brand"><span class="brand-icon">⚡</span><div>' +
    '<div class="auth-title">Business Escalate</div><div class="auth-sub">Life Progress</div></div></div>' +
    '<div class="auth-hook">' +
    '<div class="auth-hook-title">🔗 See what connects your life</div>' +
    '<div class="auth-hook-sub">One place for your gym, money, nutrition, reading and habits — with an AI coach that watches every area at once and reveals how they pull on each other.</div>' +
    '</div>' +
    '<div class="auth-tabs">' +
    '<button class="auth-tab' + (!isSignup ? ' active' : '') + '" onclick="renderAuthScreen(\'login\')">Log In</button>' +
    '<button class="auth-tab' + (isSignup ? ' active' : '') + '" onclick="renderAuthScreen(\'signup\')">Sign Up</button>' +
    '</div>' +
    '<form id="auth-form" onsubmit="' + (isSignup ? 'doSignup' : 'doLogin') + '(event)">' +
    '<div class="auth-field"><label>Username</label>' +
    '<input type="text" id="auth-username" autocomplete="username" placeholder="Your username" autofocus></div>' +
    (isSignup
      ? '<div class="auth-field"><label>Email</label>' +
        '<input type="email" id="auth-email" autocomplete="email" placeholder="you@email.com"></div>' +
        '<div class="auth-field"><label>Phone <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>' +
        '<input type="tel" id="auth-phone" autocomplete="tel" placeholder="+1 555 123 4567"></div>'
      : '') +
    '<div class="auth-field"><label>Password</label>' +
    '<input type="password" id="auth-password" autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" placeholder="' + (isSignup ? 'At least 6 characters' : 'Your password') + '"></div>' +
    (isSignup
      ? '<div class="auth-field"><label>Security question <span style="font-weight:400;color:var(--text-muted)">(optional — lets you reset your password)</span></label>' +
        '<select id="auth-secq">' + SECURITY_QUESTIONS.map(q => '<option value="' + escapeHtml(q) + '">' + escapeHtml(q) + '</option>').join('') + '</select></div>' +
        '<div class="auth-field"><label>Your answer <span style="font-weight:400;color:var(--text-muted)">(recommended)</span></label>' +
        '<input type="text" id="auth-seca" autocomplete="off" placeholder="So you can reset your password later"></div>' +
        '<div class="auth-warn">⚠️ Without a security question, you can\'t recover your account if you forget your password.</div>'
      : '') +
    '<div class="auth-error" id="auth-error"></div>' +
    '<div class="auth-status" id="auth-status" style="display:none"></div>' +
    '<button type="submit" class="btn btn-primary auth-submit">' + (isSignup ? '✨ Create Account' : '→ Log In') + '</button>' +
    (!isSignup ? '<div class="auth-forgot"><button type="button" class="btn-link" onclick="renderForgotScreen()">Forgot password?</button></div>' : '') +
    '</form>' +
    '<div class="auth-foot">' +
    (isSignup ? 'Already have an account? <button class="btn-link" onclick="renderAuthScreen(\'login\')">Log in</button>'
              : 'New here? <button class="btn-link" onclick="renderAuthScreen(\'signup\')">Create an account</button>') +
    '<div class="auth-note">🔒 Your account is private — only you can see your data.</div>' +
    '<div style="margin-top:10px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap">' +
    '<button type="button" class="btn-link" onclick="startDemo()">👀 See a live demo</button>' +
    '<a class="btn-link" href="about.html">What is Business Escalate? →</a></div>' +
    '</div>' +
    '</div>';
  document.body.appendChild(screen);
  setTimeout(() => document.getElementById('auth-username')?.focus(), 50);
}

function authError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg || ''; el.classList.toggle('visible', !!msg); }
}
function authStatus(msg) {
  const el = document.getElementById('auth-status');
  if (el) { el.textContent = msg || ''; el.style.display = msg ? '' : 'none'; }
}
// Auth requests can hit a sleeping free-tier server (cold start ~30–60s).
// Show a friendly "waking up" note after a moment, and retry transient failures.
async function authFetch(url, body) {
  const slow = setTimeout(() => authStatus('⏳ Waking up the server… the first visit can take up to a minute on the free plan. Hang tight.'), 3500);
  try {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 65000);
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
        clearTimeout(to);
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) { authStatus('⏳ Still waking up… retrying.'); await new Promise(r => setTimeout(r, 2000)); }
      }
    }
    throw lastErr;
  } finally { clearTimeout(slow); authStatus(''); }
}

async function doLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!username || !password) { authError('Enter your username and password.'); return; }
  authError(''); if (btn) btn.disabled = true;
  try {
    const res = await authFetch('/api/login', { username, password });
    const j = await res.json();
    if (!res.ok) { authError(j.error || 'Login failed.'); return; }
    state.token = j.token; state.user = j.username; state.hasSecurity = j.hasSecurity; localStorage.setItem('be_token', j.token);
    await startApp();
    showToast('Welcome back, ' + j.username + '! 👋', 'success');
  } catch { authError('Could not reach the server — check your connection and try again.'); }
  finally { if (btn) btn.disabled = false; }
}

async function doSignup(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const email = (document.getElementById('auth-email')?.value || '').trim();
  const phone = (document.getElementById('auth-phone')?.value || '').trim();
  const securityQuestion = document.getElementById('auth-secq')?.value || '';
  const securityAnswer = document.getElementById('auth-seca')?.value.trim() || '';
  if (username.length < 3) { authError('Username must be at least 3 characters.'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { authError('Please enter a valid email — one account per email.'); return; }
  if (password.length < 6) { authError('Password must be at least 6 characters.'); return; }
  if (securityAnswer && securityAnswer.length < 2) { authError('Your security answer is too short (or leave it blank).'); return; }
  // Lockout nudge — make skipping a deliberate choice
  if (!securityAnswer) {
    const proceed = confirm("⚠️ No security question set.\n\nIf you forget your password, you won't be able to recover your account.\n\nPress OK to create it anyway, or Cancel to go back and add one.");
    if (!proceed) { document.getElementById('auth-seca')?.focus(); return; }
  }
  authError(''); if (btn) btn.disabled = true;
  try {
    const res = await authFetch('/api/signup', { username, password, email, phone, securityQuestion, securityAnswer });
    const j = await res.json();
    if (!res.ok) { authError(j.error || 'Sign up failed.'); return; }
    state.token = j.token; state.user = j.username; state.hasSecurity = !!j.hasSecurity; localStorage.setItem('be_token', j.token);
    await startApp();
    showToast('Account created — welcome, ' + j.username + '! 🎉', 'success');
  } catch { authError('Could not reach the server — check your connection and try again.'); }
  finally { if (btn) btn.disabled = false; }
}

// ─────────────────────────────────────────────────────────────
// FORGOT PASSWORD  (security-question flow)
// ─────────────────────────────────────────────────────────────
function renderForgotScreen() {
  state._forgot = state._forgot || { step: 1, username: '', question: '' };
  const f = state._forgot;
  document.getElementById('auth-screen')?.remove();
  document.body.classList.add('auth-active');
  const screen = document.createElement('div');
  screen.id = 'auth-screen';
  screen.innerHTML =
    '<div class="auth-card">' +
    '<div class="auth-brand"><span class="brand-icon">🔑</span><div>' +
    '<div class="auth-title">Reset Password</div><div class="auth-sub">Answer your security question</div></div></div>' +
    (f.step === 1
      ? '<form id="auth-form" onsubmit="forgotFindAccount(event)">' +
        '<div class="auth-field"><label>Username</label>' +
        '<input type="text" id="forgot-username" autocomplete="username" placeholder="Your username" autofocus></div>' +
        '<div class="auth-error" id="auth-error"></div>' +
        '<button type="submit" class="btn btn-primary auth-submit">Continue →</button>' +
        '</form>'
      : '<form id="auth-form" onsubmit="forgotReset(event)">' +
        '<div class="forgot-q">🔒 ' + escapeHtml(f.question) + '</div>' +
        '<div class="auth-field"><label>Your answer</label>' +
        '<input type="text" id="forgot-answer" autocomplete="off" placeholder="Your answer" autofocus></div>' +
        '<div class="auth-field"><label>New password</label>' +
        '<input type="password" id="forgot-newpass" autocomplete="new-password" placeholder="At least 6 characters"></div>' +
        '<div class="auth-error" id="auth-error"></div>' +
        '<button type="submit" class="btn btn-primary auth-submit">🔑 Reset Password</button>' +
        '</form>') +
    '<div class="auth-foot"><button class="btn-link" onclick="backToLogin()">← Back to log in</button></div>' +
    '</div>';
  document.body.appendChild(screen);
  setTimeout(() => document.getElementById(f.step === 1 ? 'forgot-username' : 'forgot-answer')?.focus(), 50);
}

function backToLogin() { state._forgot = null; renderAuthScreen('login'); }

async function forgotFindAccount(e) {
  e.preventDefault();
  const username = document.getElementById('forgot-username').value.trim();
  if (!username) { authError('Enter your username.'); return; }
  try {
    const res = await fetch('/api/forgot/question', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    const j = await res.json();
    if (!res.ok) { authError(j.error || 'Could not find that account.'); return; }
    state._forgot = { step: 2, username, question: j.question };
    renderForgotScreen();
  } catch { authError('Could not reach the server.'); }
}

async function forgotReset(e) {
  e.preventDefault();
  const answer = document.getElementById('forgot-answer').value;
  const newPassword = document.getElementById('forgot-newpass').value;
  if (!answer.trim()) { authError('Enter your answer.'); return; }
  if (newPassword.length < 6) { authError('New password must be at least 6 characters.'); return; }
  try {
    const res = await fetch('/api/forgot/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: state._forgot.username, answer, newPassword }) });
    const j = await res.json();
    if (!res.ok) { authError(j.error || 'Could not reset password.'); return; }
    state._forgot = null;
    renderAuthScreen('login');
    showToast('Password reset! Log in with your new password. ✅', 'success');
  } catch { authError('Could not reach the server.'); }
}

// ─────────────────────────────────────────────────────────────
// SECURITY CARD (Settings) — change password + set security question
// ─────────────────────────────────────────────────────────────
function renderSecurityCard() {
  const hasSec = state.hasSecurity;
  return '<div class="card">' +
    '<h3 class="card-title">🔒 Security & Password</h3>' +
    '<form id="pw-form" onsubmit="changePassword(event)" style="margin-bottom:20px">' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Current password</label><input type="password" id="pw-current" autocomplete="current-password" placeholder="Current password"></div>' +
    '<div class="form-group"><label>New password</label><input type="password" id="pw-new" autocomplete="new-password" placeholder="At least 6 characters"></div>' +
    '</div>' +
    '<button type="submit" class="btn btn-primary">Update Password</button>' +
    '</form>' +
    '<div style="border-top:1px solid var(--border);padding-top:18px">' +
    '<h4 style="font-size:14px;font-weight:700;margin-bottom:4px;color:var(--text)">Security question ' +
    (hasSec ? '<span style="color:var(--success);font-size:12px;font-weight:600">✓ set</span>'
            : '<span style="color:var(--warning);font-size:12px;font-weight:600">not set — add one to enable password reset</span>') + '</h4>' +
    '<p class="card-sub">Used to reset your password if you ever forget it.</p>' +
    '<form id="sec-form" onsubmit="setSecurity(event)">' +
    '<div class="form-group"><label>Question</label><select id="sec-question">' +
    SECURITY_QUESTIONS.map(q => '<option value="' + escapeHtml(q) + '">' + escapeHtml(q) + '</option>').join('') + '</select></div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Answer</label><input type="text" id="sec-answer" autocomplete="off" placeholder="Your answer"></div>' +
    '<div class="form-group"><label>Confirm current password</label><input type="password" id="sec-current" autocomplete="current-password" placeholder="Current password"></div>' +
    '</div>' +
    '<button type="submit" class="btn btn-primary">' + (hasSec ? 'Update Security Question' : 'Set Security Question') + '</button>' +
    '</form></div>' +
    '</div>';
}

async function changePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword = document.getElementById('pw-new').value;
  if (!currentPassword || newPassword.length < 6) { showToast('Enter your current password and a new one (6+ chars).', 'error'); return; }
  try {
    const res = await fetch('/api/change-password', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ currentPassword, newPassword }) });
    const j = await res.json();
    if (!res.ok) { showToast(j.error || 'Could not change password.', 'error'); return; }
    showToast('Password updated ✅', 'success');
    document.getElementById('pw-current').value = ''; document.getElementById('pw-new').value = '';
  } catch { showToast('Could not reach the server.', 'error'); }
}

async function setSecurity(e) {
  e.preventDefault();
  const securityQuestion = document.getElementById('sec-question').value;
  const securityAnswer = document.getElementById('sec-answer').value.trim();
  const currentPassword = document.getElementById('sec-current').value;
  if (securityAnswer.length < 2 || !currentPassword) { showToast('Enter an answer and confirm your current password.', 'error'); return; }
  try {
    const res = await fetch('/api/set-security', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ securityQuestion, securityAnswer, currentPassword }) });
    const j = await res.json();
    if (!res.ok) { showToast(j.error || 'Could not save.', 'error'); return; }
    state.hasSecurity = true;
    showToast('Security question saved ✅', 'success');
    renderSettingsPage();
  } catch { showToast('Could not reach the server.', 'error'); }
}

async function logout() {
  if (!confirm('Log out of ' + (state.user || 'your account') + '?')) return;
  try { await fetch('/api/logout', { method: 'POST', headers: authHeaders() }); } catch {}
  localStorage.removeItem('be_token');
  state.token = null; state.user = null;
  Object.values(charts).forEach(c => c.destroy()); charts = {};
  document.getElementById('main').innerHTML = '<div class="loading-screen"><div class="loading-spinner"></div><p>Logging out…</p></div>';
  renderAuthScreen('login');
}

// Username + log-out control in the sidebar footer
function renderUserChip() {
  document.getElementById('user-chip')?.remove();
  const footer = document.querySelector('.sidebar-footer');
  if (!footer) return;
  const chip = document.createElement('div');
  chip.id = 'user-chip';
  chip.className = 'user-chip';
  chip.innerHTML =
    '<div class="user-chip-info"><span class="user-avatar">' + (state.user ? state.user.charAt(0).toUpperCase() : '?') + '</span>' +
    '<span class="user-name">' + escapeHtml(state.user || '') + '</span></div>' +
    '<button class="user-logout" onclick="logout()" title="Log out">⎋</button>';
  footer.prepend(chip);
}

// Hide nav items whose pillar is turned off (Reading ↔ reading pillar)
function applyNavVisibility() {
  const readingNav = document.querySelector('.nav-item[data-page="reading"]');
  if (readingNav) readingNav.style.display = isPillarOn('reading') ? '' : 'none';
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────
function navigate(page) {
  state.page = page;
  if (page !== 'log') { state._editDayId = null; }
  Object.values(charts).forEach(c => c.destroy());
  charts = {};
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  const pages = { dashboard: renderDashboard, log: renderLogToday, checklist: renderChecklistPage, contacts: renderContactsPage, ideas: renderIdeasPage, reading: renderReadingPage, coach: renderCoachPage, history: renderHistoryPage, settings: renderSettingsPage };
  injectFAB();
  (pages[page] || renderDashboard)();
}

// ─────────────────────────────────────────────────────────────
// DATA HELPERS
// ─────────────────────────────────────────────────────────────
// Serialize saves: only one POST in flight at a time. Concurrent calls (e.g. the
// daily AI cards all caching at once) coalesce into a single follow-up save with the
// latest state + fresh version — preventing version races that caused false 409s
// (which reloaded the page and jumped you back to the top).
let _saving = false, _saveAgain = false;
async function saveData() {
  if (state._previewMode) return; // demo preview — never persist
  if (_saving) { _saveAgain = true; return; }
  _saving = true;
  try {
    const res = await fetch('/api/data', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ data: state.data, version: state._dataVersion })
    });
    if (res.status === 409) { await reloadAfterConflict(); }
    else if (res.ok) { const j = await res.json().catch(() => null); if (j && j.version) state._dataVersion = j.version; }
    // other errors: keep local changes; the next save will retry
  } catch { /* offline — local state preserved, retried on next save */ }
  _saving = false;
  renderXPBar();
  if (_saveAgain) { _saveAgain = false; saveData(); } // flush latest state with the updated version
}
// Another device (or the server) changed this account's data since we loaded it.
// Reload the latest instead of overwriting — prevents silent data loss.
async function reloadAfterConflict() {
  try {
    const res = await fetch('/api/data', { headers: authHeaders() });
    state.data = await res.json();
    state._dataVersion = parseInt(res.headers.get('X-Data-Version'), 10) || state._dataVersion;
    showToast('Your data changed on another device — reloaded the latest. Re-enter your last change if it’s missing.', 'error');
    navigate(state.page || 'dashboard');
  } catch { /* leave local state as-is */ }
}

// ── Free trial + subscription gate ──
function subStatus() {
  const p = (state.data && state.data.profile) || {};
  const pro = !!p.pro || !!state.isOwner;             // owner always has full access
  const trialEnds = Number(p.trialEnds) || 0;
  const trialing = !pro && trialEnds > Date.now();
  const daysLeft = trialing ? Math.max(1, Math.ceil((trialEnds - Date.now()) / 86400000)) : 0;
  const expired = !pro && trialEnds > 0 && trialEnds <= Date.now();
  const locked = !!state.paymentsLive && expired;     // only lock once a payment link is configured
  return { pro, trialing, daysLeft, expired, locked };
}
function goSubscribe() {
  if (state.payLink) window.open(state.payLink, '_blank');
  else showToast('Payments are being set up — hang tight!', 'error');
}
function renderPaywall() {
  document.getElementById('auth-screen')?.remove();
  document.body.classList.add('auth-active');
  const s = document.createElement('div');
  s.id = 'auth-screen';
  s.innerHTML =
    '<div class="auth-card" style="text-align:center">' +
    '<div class="auth-brand" style="justify-content:center"><span class="brand-icon">⚡</span><div>' +
    '<div class="auth-title">Your free trial has ended</div><div class="auth-sub">Business Escalate Pro</div></div></div>' +
    '<p style="color:var(--text-muted);line-height:1.6;margin:6px 0 18px">Keep your streak, your AI coach, and all your progress. Subscribe to unlock the full app.</p>' +
    '<div style="font-size:32px;font-weight:900;color:var(--text);line-height:1.1">' + escapeHtml(state.priceLabel || '$7.99/mo') + '</div>' +
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">Cancel anytime</div>' +
    '<button class="btn btn-primary auth-submit" onclick="goSubscribe()">⭐ Subscribe</button>' +
    '<div class="auth-foot"><button class="btn-link" onclick="location.reload()">I just subscribed — refresh</button>' +
    '<div style="margin-top:10px"><button class="btn-link" onclick="logout()">Log out</button></div></div>' +
    '</div>';
  document.body.appendChild(s);
}
function renderTrialBanner() {
  const s = subStatus();
  if (!s.trialing) return '';
  return '<div class="trial-banner">🎁 <strong>' + s.daysLeft + ' day' + (s.daysLeft === 1 ? '' : 's') + ' left</strong> in your free trial' +
    (state.paymentsLive ? ' · <button type="button" class="btn-link" onclick="goSubscribe()">Subscribe</button>' : '') + '</div>';
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function formatCurrency(n) { return '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtDateShort(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

function getWeekStart(dateStr) {
  const d = new Date((dateStr || todayStr()) + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

function getWeeklyAvg(weeks, n) {
  const sorted = [...weeks].sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));
  const slice = n ? sorted.slice(0, n) : sorted;
  if (!slice.length) return 0;
  return slice.reduce((s, w) => s + w.income, 0) / slice.length;
}

function getWeekStats() {
  const thisWeekStart = getWeekStart(todayStr());
  const weekDays = state.data.days.filter(d => d.date >= thisWeekStart);
  const gymDays = weekDays.filter(d => d.gym?.done).length;
  const foodRatings = weekDays.filter(d => d.food?.rating > 0).map(d => d.food.rating);
  const avgFood = foodRatings.length ? foodRatings.reduce((a, b) => a + b, 0) / foodRatings.length : 0;
  const networkCount = weekDays.reduce((s, d) => s + (d.networking?.count || 0), 0);
  const _wk = state.data.weeks.find(w => w.weekStart === thisWeekStart);
  const weekIncome = (_wk?.income) || 0;
  const weekExpenses = weekDays.reduce((s, d) => s + (Number(d.spent) || 0), 0); // spending is logged per day
  const weekNet = weekIncome - weekExpenses;
  const readPages = weekDays.reduce((s, d) => s + (d.reading?.pages || 0), 0);
  const readDays  = weekDays.filter(d => d.reading?.pages > 0).length;
  const waterDaysArr = weekDays.filter(d => d.water > 0).map(d => d.water);
  const waterTotal = waterDaysArr.reduce((a, b) => a + b, 0);
  const avgWater = waterDaysArr.length ? waterTotal / waterDaysArr.length : 0;
  const waterToday = state.data.days.find(d => d.date === todayStr())?.water || 0;
  return { gymDays, avgFood, networkCount, weekIncome, weekExpenses, weekNet, readPages, readDays, waterTotal, avgWater, waterToday };
}

// ── Money model: spending is logged daily (day.spent); income is set per period ──
// Cadence is the user's choice based on how they get paid — daily, weekly, or monthly.
function moneyCadence() { const c = state.data.profile && state.data.profile.incomeCadence; return (c === 'weekly' || c === 'daily') ? c : 'monthly'; }
function moneyPeriodLabel(cad) { cad = cad || moneyCadence(); return cad === 'weekly' ? 'week' : cad === 'daily' ? 'day' : 'month'; }
function periodKeyFor(dateStr, cad) {
  cad = cad || moneyCadence();
  if (cad === 'weekly') return getWeekStart(dateStr);
  if (cad === 'daily') return String(dateStr).slice(0, 10); // the day itself (YYYY-MM-DD)
  return String(dateStr).slice(0, 7);                       // the month (YYYY-MM)
}
function currentPeriodKey(cad) { return periodKeyFor(todayStr(), cad || moneyCadence()); }
function getPeriodIncome(cad, key) {
  cad = cad || moneyCadence();
  if (cad === 'weekly') return (state.data.weeks.find(w => w.weekStart === key)?.income) || 0;
  return (state.data.incomes && state.data.incomes[key]) || 0;
}
function setPeriodIncome(cad, key, amt) {
  cad = cad || moneyCadence();
  if (cad === 'weekly') {
    const wi = state.data.weeks.findIndex(w => w.weekStart === key);
    const prev = wi >= 0 ? state.data.weeks[wi] : null;
    const entry = { id: prev ? prev.id : uid(), weekStart: key, income: amt, notes: prev ? prev.notes || '' : '' };
    if (wi >= 0) state.data.weeks[wi] = entry; else state.data.weeks.push(entry);
  } else {
    state.data.incomes = state.data.incomes || {};
    if (amt > 0) state.data.incomes[key] = amt; else delete state.data.incomes[key];
  }
}
function periodSpending(cad, key) {
  cad = cad || moneyCadence();
  return (state.data.days || []).filter(d => periodKeyFor(d.date, cad) === key).reduce((s, d) => s + (Number(d.spent) || 0), 0);
}
// Current period's money snapshot for the dashboard + coach
function getMoneyPeriod() {
  const cad = moneyCadence();
  const key = currentPeriodKey(cad);
  const income = getPeriodIncome(cad, key);
  const spent = periodSpending(cad, key);
  return { cad, key, label: moneyPeriodLabel(cad), income, spent, net: income - spent, rate: income > 0 ? Math.round((income - spent) / income * 100) : 0 };
}
// Leftover savings from all PRIOR periods — this rolls forward into the next period's
// available money ("add the savings to the next income").
function getCarryover() {
  const cad = moneyCadence();
  const curKey = currentPeriodKey(cad);
  const keys = new Set();
  if (cad === 'weekly') (state.data.weeks || []).forEach(w => { if (w.income > 0) keys.add(w.weekStart); });
  else Object.keys(state.data.incomes || {}).forEach(k => { if (k.length === (cad === 'daily' ? 10 : 7)) keys.add(k); });
  (state.data.days || []).forEach(d => { if (d.spent > 0) keys.add(periodKeyFor(d.date, cad)); });
  let carry = 0;
  keys.forEach(k => { if (k < curKey) carry += getPeriodIncome(cad, k) - periodSpending(cad, k); });
  return Math.round(carry);
}
// Everything the money "circle" needs: this period + savings rolled forward
function getMoneyCircle() {
  const mp = getMoneyPeriod();
  const carryover = getCarryover();
  const available = carryover + mp.income;     // last savings + this period's income
  const savedTotal = available - mp.spent;     // total saved now (carryover + this period's net)
  const spentFrac = available > 0 ? Math.min(1, mp.spent / available) : (mp.spent > 0 ? 1 : 0);
  return { label: mp.label, income: mp.income, spent: mp.spent, net: mp.net, carryover, available, savedTotal, spentFrac };
}
// Donut: spending (red) vs savings (green) out of available money, with savings rolled forward
function renderMoneyCircleCard() {
  if (!isPillarOn('money')) return '';
  const c = getMoneyCircle();
  if (!(c.income > 0 || c.spent > 0 || c.carryover !== 0)) return '';
  const deg = Math.round(c.spentFrac * 360);
  const ring = 'conic-gradient(var(--danger) 0deg ' + deg + 'deg, var(--success) ' + deg + 'deg 360deg)';
  const neg = c.savedTotal < 0;
  return '<div class="card money-circle-card">' +
    '<h3 class="card-title">💰 This ' + c.label + ' — money flow</h3>' +
    '<div class="mc-ring" style="background:' + ring + '">' +
    '<div class="mc-hole"><div class="mc-saved' + (neg ? ' mc-neg' : '') + '">' + formatCurrency(c.savedTotal) + '</div>' +
    '<div class="mc-saved-label">' + (neg ? 'overspent' : 'saved') + '</div></div></div>' +
    '<div class="mc-legend">' +
    '<span><i class="mc-dot mc-red"></i>Spent ' + formatCurrency(c.spent) + '</span>' +
    '<span><i class="mc-dot mc-green"></i>Saved ' + formatCurrency(Math.max(0, c.savedTotal)) + '</span></div>' +
    '<div class="mc-caption">' + (c.carryover ? formatCurrency(c.carryover) + ' saved before + ' : '') +
    formatCurrency(c.income) + ' in − ' + formatCurrency(c.spent) + ' spent this ' + c.label + '</div>' +
    '</div>';
}

function getGymStreak() {
  const sorted = [...state.data.days].sort((a, b) => new Date(b.date) - new Date(a.date));
  let streak = 0;
  let prevDate = null;
  for (const d of sorted) {
    if (!d.gym?.done) {
      if (streak === 0) continue; // allow gap at start
      break;
    }
    if (prevDate) {
      const diff = (new Date(prevDate + 'T00:00:00') - new Date(d.date + 'T00:00:00')) / 86400000;
      if (diff > 2) break; // gap of more than 2 days breaks streak
    }
    streak++;
    prevDate = d.date;
  }
  return streak;
}

function getReadingStreak() {
  const sorted = [...state.data.days]
    .filter(d => d.reading?.pages > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  let streak = 0, prev = null;
  for (const d of sorted) {
    if (!prev) { streak = 1; prev = d.date; continue; }
    const diff = (new Date(prev + 'T00:00:00') - new Date(d.date + 'T00:00:00')) / 86400000;
    if (diff > 1) break;
    streak++; prev = d.date;
  }
  return streak;
}

function getWeeklyScore() {
  const stats = getWeekStats();
  const p = state.data.profile;
  const parts = [];
  if (isPillarOn('gym')        && p.gymDaysPerWeek   > 0) parts.push(Math.min(100, (stats.gymDays     / p.gymDaysPerWeek)   * 100));
  if (isPillarOn('food')       && stats.avgFood      > 0) parts.push((stats.avgFood / 5) * 100);
  if (isPillarOn('networking') && p.weeklyNetworkGoal > 0) parts.push(Math.min(100, (stats.networkCount / p.weeklyNetworkGoal) * 100));
  if (isPillarOn('money')      && p.weeklyIncomeGoal  > 0) parts.push(Math.min(100, (stats.weekIncome   / p.weeklyIncomeGoal)  * 100));
  if (isPillarOn('reading')    && p.weeklyReadGoal    > 0) parts.push(Math.min(100, (stats.readPages    / p.weeklyReadGoal)    * 100));
  if (!parts.length) return 0;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

// ─────────────────────────────────────────────────────────────
// NUTRITION — calories & macro targets
//   profile.nutrition = { age, sex, heightCm, weightKg,
//                         heightUnit, weightUnit, activity, goal, strategy }
// ─────────────────────────────────────────────────────────────
const LBS_TO_KG = 0.45359237;
const IN_TO_CM  = 2.54;
const ACTIVITY_FACTORS = {
  sedentary: { mult: 1.2,   label: 'Sedentary — little or no exercise' },
  light:     { mult: 1.375, label: 'Light — 1–3 days/week' },
  moderate:  { mult: 1.55,  label: 'Moderate — 3–5 days/week' },
  active:    { mult: 1.725, label: 'Active — 6–7 days/week' },
  athlete:   { mult: 1.9,   label: 'Very active — hard daily / physical job' }
};
const NUTRITION_GOALS = {
  lose:     { adj: -0.20, label: 'Lose fat', sub: '−20% calories' },
  maintain: { adj: 0,     label: 'Maintain', sub: 'maintenance calories' },
  gain:     { adj: 0.12,  label: 'Build muscle', sub: '+12% calories' }
};

// ─────────────────────────────────────────────────────────────
// FOOD DATABASE — common whole foods, per 100g.
//   n=name, k=kcal, p=protein, c=carbs, f=fat, sg=serving grams, sl=serving label
// ─────────────────────────────────────────────────────────────
const FOOD_DB = [
  // Poultry / meat (cooked)
  { n: 'Chicken breast (cooked)', k: 165, p: 31, c: 0, f: 3.6, sg: 120, sl: 'fillet' },
  { n: 'Chicken thigh (cooked)', k: 209, p: 26, c: 0, f: 10.9, sg: 90, sl: 'thigh' },
  { n: 'Turkey breast (cooked)', k: 135, p: 30, c: 0, f: 1, sg: 120, sl: 'serving' },
  { n: 'Lean beef steak (cooked)', k: 217, p: 26, c: 0, f: 12, sg: 120, sl: 'steak' },
  { n: 'Ground beef 90/10 (cooked)', k: 176, p: 20, c: 0, f: 10, sg: 100, sl: 'serving' },
  { n: 'Pork chop (cooked)', k: 231, p: 26, c: 0, f: 14, sg: 120, sl: 'chop' },
  { n: 'Bacon (cooked)', k: 541, p: 37, c: 1.4, f: 42, sg: 8, sl: 'slice' },
  { n: 'Ham, lean', k: 145, p: 21, c: 1.5, f: 6, sg: 30, sl: 'slice' },
  { n: 'Lamb (cooked)', k: 258, p: 25, c: 0, f: 17, sg: 120, sl: 'serving' },
  // Fish / seafood
  { n: 'Salmon (cooked)', k: 208, p: 20, c: 0, f: 13, sg: 120, sl: 'fillet' },
  { n: 'Tuna, canned in water', k: 116, p: 26, c: 0, f: 1, sg: 100, sl: 'can' },
  { n: 'Tilapia (cooked)', k: 129, p: 26, c: 0, f: 3, sg: 120, sl: 'fillet' },
  { n: 'Cod (cooked)', k: 105, p: 23, c: 0, f: 0.9, sg: 120, sl: 'fillet' },
  { n: 'Shrimp (cooked)', k: 99, p: 24, c: 0.2, f: 0.3, sg: 85, sl: 'serving' },
  // Eggs / dairy
  { n: 'Egg, whole', k: 143, p: 13, c: 1.1, f: 9.5, sg: 50, sl: 'large egg' },
  { n: 'Egg white', k: 52, p: 11, c: 0.7, f: 0.2, sg: 33, sl: 'white' },
  { n: 'Milk, 2%', k: 50, p: 3.4, c: 4.8, f: 2, sg: 244, sl: 'cup' },
  { n: 'Milk, skim', k: 34, p: 3.4, c: 5, f: 0.1, sg: 244, sl: 'cup' },
  { n: 'Milk, whole', k: 61, p: 3.2, c: 4.8, f: 3.3, sg: 244, sl: 'cup' },
  { n: 'Greek yogurt, nonfat', k: 59, p: 10, c: 3.6, f: 0.4, sg: 170, sl: 'container' },
  { n: 'Yogurt, plain whole', k: 61, p: 3.5, c: 4.7, f: 3.3, sg: 170, sl: 'serving' },
  { n: 'Cottage cheese, low-fat', k: 72, p: 12, c: 4, f: 1, sg: 113, sl: '1/2 cup' },
  { n: 'Cheddar cheese', k: 403, p: 25, c: 1.3, f: 33, sg: 30, sl: 'slice' },
  { n: 'Mozzarella', k: 280, p: 28, c: 3, f: 17, sg: 30, sl: 'serving' },
  { n: 'Butter', k: 717, p: 0.9, c: 0.1, f: 81, sg: 14, sl: 'tbsp' },
  // Grains / starch (cooked unless noted)
  { n: 'Rice, white (cooked)', k: 130, p: 2.7, c: 28, f: 0.3, sg: 158, sl: 'cup' },
  { n: 'Rice, brown (cooked)', k: 123, p: 2.7, c: 26, f: 1, sg: 195, sl: 'cup' },
  { n: 'Oats, dry', k: 389, p: 17, c: 66, f: 7, sg: 40, sl: '1/2 cup dry' },
  { n: 'Pasta (cooked)', k: 158, p: 6, c: 31, f: 0.9, sg: 140, sl: 'cup' },
  { n: 'Bread, whole wheat', k: 247, p: 13, c: 41, f: 4, sg: 28, sl: 'slice' },
  { n: 'Bread, white', k: 265, p: 9, c: 49, f: 3.2, sg: 25, sl: 'slice' },
  { n: 'Potato (baked)', k: 93, p: 2.5, c: 21, f: 0.1, sg: 173, sl: 'medium' },
  { n: 'Sweet potato (cooked)', k: 90, p: 2, c: 21, f: 0.1, sg: 150, sl: 'medium' },
  { n: 'Quinoa (cooked)', k: 120, p: 4.4, c: 21, f: 1.9, sg: 185, sl: 'cup' },
  { n: 'Tortilla, flour', k: 306, p: 8, c: 51, f: 7, sg: 45, sl: 'tortilla' },
  { n: 'Corn flakes', k: 357, p: 7, c: 84, f: 0.4, sg: 30, sl: 'serving' },
  { n: 'Granola', k: 471, p: 10, c: 64, f: 20, sg: 61, sl: '1/2 cup' },
  { n: 'Couscous (cooked)', k: 112, p: 3.8, c: 23, f: 0.2, sg: 157, sl: 'cup' },
  { n: 'Bagel', k: 250, p: 10, c: 49, f: 1.5, sg: 100, sl: 'bagel' },
  // Legumes / plant protein
  { n: 'Black beans (cooked)', k: 132, p: 8.9, c: 24, f: 0.5, sg: 172, sl: 'cup' },
  { n: 'Chickpeas (cooked)', k: 164, p: 8.9, c: 27, f: 2.6, sg: 164, sl: 'cup' },
  { n: 'Lentils (cooked)', k: 116, p: 9, c: 20, f: 0.4, sg: 198, sl: 'cup' },
  { n: 'Kidney beans (cooked)', k: 127, p: 8.7, c: 23, f: 0.5, sg: 177, sl: 'cup' },
  { n: 'Tofu', k: 76, p: 8, c: 1.9, f: 4.8, sg: 100, sl: 'serving' },
  { n: 'Edamame', k: 121, p: 12, c: 9, f: 5, sg: 155, sl: 'cup' },
  { n: 'Peanut butter', k: 588, p: 25, c: 20, f: 50, sg: 32, sl: '2 tbsp' },
  // Fruit
  { n: 'Banana', k: 89, p: 1.1, c: 23, f: 0.3, sg: 118, sl: 'medium' },
  { n: 'Apple', k: 52, p: 0.3, c: 14, f: 0.2, sg: 182, sl: 'medium' },
  { n: 'Orange', k: 47, p: 0.9, c: 12, f: 0.1, sg: 131, sl: 'medium' },
  { n: 'Strawberries', k: 32, p: 0.7, c: 7.7, f: 0.3, sg: 144, sl: 'cup' },
  { n: 'Blueberries', k: 57, p: 0.7, c: 14, f: 0.3, sg: 148, sl: 'cup' },
  { n: 'Grapes', k: 69, p: 0.7, c: 18, f: 0.2, sg: 151, sl: 'cup' },
  { n: 'Mango', k: 60, p: 0.8, c: 15, f: 0.4, sg: 165, sl: 'cup' },
  { n: 'Pineapple', k: 50, p: 0.5, c: 13, f: 0.1, sg: 165, sl: 'cup' },
  { n: 'Watermelon', k: 30, p: 0.6, c: 8, f: 0.2, sg: 152, sl: 'cup' },
  { n: 'Avocado', k: 160, p: 2, c: 9, f: 15, sg: 68, sl: 'half' },
  { n: 'Pear', k: 57, p: 0.4, c: 15, f: 0.1, sg: 178, sl: 'medium' },
  { n: 'Peach', k: 39, p: 0.9, c: 10, f: 0.3, sg: 150, sl: 'medium' },
  { n: 'Dates', k: 277, p: 1.8, c: 75, f: 0.2, sg: 24, sl: 'date' },
  // Vegetables
  { n: 'Broccoli (cooked)', k: 35, p: 2.4, c: 7, f: 0.4, sg: 156, sl: 'cup' },
  { n: 'Spinach (raw)', k: 23, p: 2.9, c: 3.6, f: 0.4, sg: 30, sl: 'cup' },
  { n: 'Carrot', k: 41, p: 0.9, c: 10, f: 0.2, sg: 61, sl: 'medium' },
  { n: 'Tomato', k: 18, p: 0.9, c: 3.9, f: 0.2, sg: 123, sl: 'medium' },
  { n: 'Cucumber', k: 15, p: 0.7, c: 3.6, f: 0.1, sg: 104, sl: 'half' },
  { n: 'Bell pepper', k: 31, p: 1, c: 6, f: 0.3, sg: 119, sl: 'medium' },
  { n: 'Onion', k: 40, p: 1.1, c: 9, f: 0.1, sg: 110, sl: 'medium' },
  { n: 'Green beans (cooked)', k: 35, p: 1.9, c: 8, f: 0.2, sg: 125, sl: 'cup' },
  { n: 'Mushrooms', k: 22, p: 3.1, c: 3.3, f: 0.3, sg: 70, sl: 'cup' },
  { n: 'Corn (cooked)', k: 96, p: 3.4, c: 21, f: 1.5, sg: 154, sl: 'cup' },
  { n: 'Peas (cooked)', k: 84, p: 5.4, c: 16, f: 0.2, sg: 160, sl: 'cup' },
  { n: 'Cauliflower', k: 25, p: 1.9, c: 5, f: 0.3, sg: 107, sl: 'cup' },
  // Nuts / seeds / fats / extras
  { n: 'Almonds', k: 579, p: 21, c: 22, f: 50, sg: 28, sl: 'oz (handful)' },
  { n: 'Walnuts', k: 654, p: 15, c: 14, f: 65, sg: 28, sl: 'oz' },
  { n: 'Cashews', k: 553, p: 18, c: 30, f: 44, sg: 28, sl: 'oz' },
  { n: 'Peanuts', k: 567, p: 26, c: 16, f: 49, sg: 28, sl: 'oz' },
  { n: 'Chia seeds', k: 486, p: 17, c: 42, f: 31, sg: 12, sl: 'tbsp' },
  { n: 'Olive oil', k: 884, p: 0, c: 0, f: 100, sg: 14, sl: 'tbsp' },
  { n: 'Honey', k: 304, p: 0.3, c: 82, f: 0, sg: 21, sl: 'tbsp' },
  { n: 'Whey protein powder', k: 375, p: 75, c: 10, f: 5, sg: 30, sl: 'scoop' },
  { n: 'Dark chocolate', k: 546, p: 5, c: 61, f: 31, sg: 28, sl: 'oz' },
  { n: 'Hummus', k: 166, p: 8, c: 14, f: 10, sg: 30, sl: '2 tbsp' },
  { n: 'Parmesan cheese', k: 431, p: 38, c: 4, f: 29, sg: 5, sl: 'tbsp' },
  { n: 'String cheese (mozzarella)', k: 300, p: 24, c: 2, f: 22, sg: 28, sl: 'stick' }
];

// Macros for a given food at a given gram amount
function foodMacros(food, grams) {
  const r = grams / 100;
  return {
    kcal: Math.round(food.k * r),
    p: Math.round(food.p * r * 10) / 10,
    c: Math.round(food.c * r * 10) / 10,
    f: Math.round(food.f * r * 10) / 10
  };
}
function findFood(name) {
  if (!name) return null;
  const q = name.trim().toLowerCase();
  return FOOD_DB.find(f => f.n.toLowerCase() === q) ||
         FOOD_DB.find(f => f.n.toLowerCase().startsWith(q)) ||
         FOOD_DB.find(f => f.n.toLowerCase().includes(q)) || null;
}
function foodLogTotals(log) {
  return (log || []).reduce((t, x) => ({
    kcal: t.kcal + (x.kcal || 0), p: t.p + (x.p || 0), c: t.c + (x.c || 0), f: t.f + (x.f || 0)
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}

// Meal names for a given count, so the split feels like a real plan.
function mealLabels(count) {
  const map = {
    3: ['Breakfast', 'Lunch', 'Dinner'],
    4: ['Breakfast', 'Lunch', 'Snack', 'Dinner'],
    5: ['Breakfast', 'Snack', 'Lunch', 'Snack', 'Dinner'],
    6: ['Breakfast', 'Snack', 'Lunch', 'Snack', 'Dinner', 'Snack']
  };
  return map[count] || Array.from({ length: count }, (_, i) => 'Meal ' + (i + 1));
}

// Compute calories (Mifflin-St Jeor BMR → TDEE → goal) and a macro split.
function computeNutrition(n) {
  if (!n) return null;
  const age = +n.age, heightCm = +n.heightCm, weightKg = +n.weightKg;
  if (!age || !heightCm || !weightKg || !n.sex) return null;
  const sex = n.sex;
  const activity = ACTIVITY_FACTORS[n.activity] ? n.activity : 'moderate';
  const goal = NUTRITION_GOALS[n.goal] ? n.goal : 'maintain';
  const strategy = n.strategy === 'balanced' ? 'balanced' : 'muscle';
  const mealsPerDay = [3, 4, 5, 6].includes(+n.mealsPerDay) ? +n.mealsPerDay : 3;

  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'female' ? -161 : 5);
  const tdee = bmr * ACTIVITY_FACTORS[activity].mult;
  let calories = Math.round(tdee * (1 + NUTRITION_GOALS[goal].adj));
  if (calories < 1200) calories = 1200; // safety floor

  let protein, carbs, fat;
  if (strategy === 'balanced') {
    // 30% protein / 40% carbs / 30% fat
    const pCal = calories * 0.30, cCal = calories * 0.40, fCal = calories * 0.30;
    protein = { g: Math.round(pCal / 4), cal: Math.round(pCal), pct: 30 };
    carbs   = { g: Math.round(cCal / 4), cal: Math.round(cCal), pct: 40 };
    fat     = { g: Math.round(fCal / 9), cal: Math.round(fCal), pct: 30 };
  } else {
    // Muscle-building: protein by bodyweight, fat 25%, carbs fill the rest
    const pG = Math.round((sex === 'female' ? 1.8 : 2.0) * weightKg);
    const pCal = pG * 4;
    const fCal = Math.round(calories * 0.25);
    const fG = Math.round(fCal / 9);
    const cCal = Math.max(0, calories - pCal - fCal);
    const cG = Math.round(cCal / 4);
    protein = { g: pG, cal: pCal, pct: Math.round((pCal / calories) * 100) };
    carbs   = { g: cG, cal: cCal, pct: Math.round((cCal / calories) * 100) };
    fat     = { g: fG, cal: fCal, pct: Math.round((fCal / calories) * 100) };
  }
  // Even split across meals
  const meals = {
    count: mealsPerDay,
    labels: mealLabels(mealsPerDay),
    calories: Math.round(calories / mealsPerDay),
    protein: Math.round(protein.g / mealsPerDay),
    carbs: Math.round(carbs.g / mealsPerDay),
    fat: Math.round(fat.g / mealsPerDay)
  };
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), calories, protein, carbs, fat, goal, strategy, activity, meals };
}

function getNutrition() { return computeNutrition(state.data.profile?.nutrition); }

// ── Bodyweight tracking (stored in kg; displayed in the user's unit) ──
function weightUnitPref() { return (state.data.profile && state.data.profile.nutrition && state.data.profile.nutrition.weightUnit) || 'lbs'; }
function kgToDisplay(kg) { return weightUnitPref() === 'lbs' ? kg / LBS_TO_KG : kg; }
function displayToKg(v) { return weightUnitPref() === 'lbs' ? v * LBS_TO_KG : v; }
function upsertWeight(date, kg) {
  if (!state.data.weights) state.data.weights = [];
  const i = state.data.weights.findIndex(w => w.date === date);
  if (i >= 0) state.data.weights[i].kg = kg;
  else state.data.weights.push({ id: uid(), date, kg });
}

// Progress bar + text comparing calories eaten to the daily target
function calRemainingHtml(eaten, target) {
  const over = eaten > target;
  const pct = target > 0 ? Math.min(100, Math.round((eaten / target) * 100)) : 0;
  let text;
  if (!eaten) text = 'Log what you ate to see your remaining calories.';
  else if (over) text = '<strong>' + eaten.toLocaleString() + '</strong> / ' + target.toLocaleString() + ' cal · <span class="cal-over-text">' + (eaten - target).toLocaleString() + ' over target</span>';
  else text = '<strong>' + eaten.toLocaleString() + '</strong> / ' + target.toLocaleString() + ' cal · ' + (target - eaten).toLocaleString() + ' remaining';
  return '<div class="cal-bar-wrap"><div class="cal-bar ' + (over ? 'cal-over' : '') + '" style="width:' + (over ? 100 : pct) + '%"></div></div>' +
    '<div class="cal-rem-text">' + text + '</div>';
}

// Live update as the user types calories eaten
function updateCaloriesRemaining() {
  const nut = getNutrition();
  if (!nut) return;
  const eaten = parseFloat(document.getElementById('calories-eaten')?.value) || 0;
  const el = document.getElementById('cal-remaining');
  if (el) el.innerHTML = calRemainingHtml(eaten, nut.calories);
}

// Log-page nutrition block: targets + food logger + calories eaten + remaining
function renderLogNutritionSection(eatenVal) {
  const nut = getNutrition();
  if (!nut) {
    return '<div class="nut-target-banner nut-target-empty">' +
      '🍎 <span>Set up your calorie & macro targets to track what you eat</span>' +
      '<button type="button" class="btn-link" onclick="navigate(\'settings\')">Set up →</button>' +
      '</div>';
  }
  const totals = foodLogTotals(state._foodLog);
  const initEaten = totals.kcal > 0 ? Math.round(totals.kcal) : (parseFloat(eatenVal) || 0);
  const datalist = '<datalist id="food-datalist">' + FOOD_DB.map(f => '<option value="' + escapeHtml(f.n) + '">').join('') + '</datalist>';
  // Quick-add chips from foods you've logged before
  state._recentFoods = getRecentFoods(8);
  const recentRow = state._recentFoods.length
    ? '<div class="recent-foods"><span class="recent-foods-label">⚡ Quick add</span>' +
      state._recentFoods.map((f, i) => '<button type="button" class="recent-chip" onclick="quickAddRecent(' + i + ')">' + escapeHtml(f.name) + ' <b>' + f.grams + 'g</b></button>').join('') +
      '</div>'
    : '';

  return '<div class="today-section nut-section">' +
    '<div class="today-section-header nut-header">🍎 Nutrition</div>' +
    '<div class="nut-target-line">' +
    '<span><b>Target:</b> ' + nut.calories.toLocaleString() + ' cal · ' +
    '<b class="mp">' + nut.protein.g + 'g</b> P · <b class="mc">' + nut.carbs.g + 'g</b> C · <b class="mf">' + nut.fat.g + 'g</b> F · ' +
    nut.meals.count + ' meals (~' + nut.meals.calories.toLocaleString() + ' cal each)</span>' +
    '<button type="button" class="btn-link" onclick="navigate(\'settings\')">Edit</button>' +
    '</div>' +

    // Food logger
    '<div class="food-logger">' +
    '<label class="food-logger-label">🍽️ What did you eat? <span style="font-weight:400;color:var(--text-muted)">Add foods and we\'ll count the macros</span></label>' +
    '<div class="food-add-row">' +
    '<input type="text" list="food-datalist" id="food-pick" placeholder="Search a food (e.g. chicken breast)…" autocomplete="off" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'food-qty\').focus();}">' +
    '<input type="number" id="food-qty" min="0" step="1" placeholder="amount" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addFoodToLog();}">' +
    '<select id="food-unit"><option value="g">grams</option><option value="serving">serving(s)</option></select>' +
    '<button type="button" class="btn btn-outline food-add-btn" onclick="addFoodToLog()">+ Add</button>' +
    '<button type="button" class="btn btn-outline food-ai-btn" id="food-ai-btn" onclick="estimateFoodWithAI()" title="Estimate macros with AI for any food">✨ AI</button>' +
    '</div>' + datalist +
    '<div class="food-ai-hint">Not in the list? Type any food (e.g. "homemade chicken burrito") and hit ✨ AI to estimate it.</div>' +
    recentRow +
    '<div id="food-log-list">' + renderFoodLogList() + '</div>' +
    '<div id="food-log-totals">' + renderFoodLogTotals() + '</div>' +
    '</div>' +

    '<div class="form-group" style="margin-top:14px"><label>Calories eaten today <span style="font-weight:400;color:var(--text-muted)">(auto-filled from foods above — or type your own)</span></label>' +
    '<input type="number" id="calories-eaten" min="0" step="10" placeholder="e.g. 2200" value="' + (initEaten || '') + '" oninput="updateCaloriesRemaining()" style="font-size:20px;font-weight:800;max-width:200px"></div>' +
    '<div id="cal-remaining">' + calRemainingHtml(initEaten, nut.calories) + '</div>' +
    '</div>';
}

// Render the list of foods added today (from state._foodLog)
function renderFoodLogList() {
  const log = state._foodLog || [];
  if (!log.length) return '<div class="food-log-empty">No foods added yet — search above to add what you ate.</div>';
  return '<div class="food-log-items">' + log.map(x =>
    '<div class="food-item">' +
    '<div class="fi-name">' + escapeHtml(x.name) + (x.ai ? ' <span class="fi-ai" title="Estimated with AI">✨</span>' : '') + '</div>' +
    '<div class="fi-amt">' + x.grams + ' g</div>' +
    '<div class="fi-macros"><b>' + x.kcal + '</b> cal · <b class="mp">' + x.p + 'g</b> · <b class="mc">' + x.c + 'g</b> · <b class="mf">' + x.f + 'g</b></div>' +
    '<button type="button" class="fi-remove" onclick="removeFoodFromLog(\'' + x.id + '\')" title="Remove">✕</button>' +
    '</div>'
  ).join('') + '</div>';
}

function renderFoodLogTotals() {
  const t = foodLogTotals(state._foodLog);
  if (!t.kcal) return '';
  const nut = getNutrition();
  const pTarget = nut ? nut.protein.g : 0;
  return '<div class="food-log-total">' +
    'Logged: <b>' + Math.round(t.kcal).toLocaleString() + ' cal</b> · ' +
    '<b class="mp">' + Math.round(t.p) + 'g</b> protein' + (pTarget ? ' / ' + pTarget + 'g' : '') + ' · ' +
    '<b class="mc">' + Math.round(t.c) + 'g</b> carbs · <b class="mf">' + Math.round(t.f) + 'g</b> fat' +
    '</div>';
}

function addFoodToLog() {
  const pick = document.getElementById('food-pick');
  const food = findFood(pick?.value);
  const qty = parseFloat(document.getElementById('food-qty')?.value) || 0;
  const unit = document.getElementById('food-unit')?.value || 'g';
  if (!food) { showToast('Pick a food from the list.', 'error'); return; }
  if (qty <= 0) { showToast('Enter an amount.', 'error'); return; }
  const grams = unit === 'serving' ? qty * food.sg : qty;
  const m = foodMacros(food, grams);
  if (!state._foodLog) state._foodLog = [];
  state._foodLog.push({ id: uid(), name: food.n, grams: Math.round(grams), unit, qty, kcal: m.kcal, p: m.p, c: m.c, f: m.f });
  if (pick) pick.value = '';
  const q = document.getElementById('food-qty'); if (q) q.value = '';
  refreshFoodLog();
  if (pick) pick.focus();
}

async function estimateFoodWithAI() {
  const pick = document.getElementById('food-pick');
  const desc = (pick?.value || '').trim();
  if (!desc) { showToast('Type what you ate first (e.g. "homemade chicken burrito").', 'error'); return; }
  const btn = document.getElementById('food-ai-btn');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳…'; }
  // Fold any quantity the user entered into the description for the AI
  const qty = parseFloat(document.getElementById('food-qty')?.value) || 0;
  const unit = document.getElementById('food-unit')?.value || 'g';
  const description = qty > 0 ? desc + ' (' + qty + (unit === 'g' ? ' grams' : ' serving(s)') + ')' : desc;
  try {
    const res = await fetch('/api/estimate-food', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ description }) });
    const j = await res.json();
    if (!res.ok) {
      showToast(j.error === 'NO_KEY' ? 'Add your Claude API key in Settings to use AI estimates.' : (j.error || 'Estimate failed.'), 'error');
      return;
    }
    if (!state._foodLog) state._foodLog = [];
    state._foodLog.push({ id: uid(), name: j.name, grams: j.grams || 0, unit: 'g', qty: j.grams || 0, kcal: j.kcal, p: j.p, c: j.c, f: j.f, ai: true });
    if (pick) pick.value = '';
    const q = document.getElementById('food-qty'); if (q) q.value = '';
    refreshFoodLog();
    showToast('Added "' + j.name + '" (AI estimate) ✨', 'success');
  } catch {
    showToast('Could not reach the server.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

function removeFoodFromLog(id) {
  state._foodLog = (state._foodLog || []).filter(x => x.id !== id);
  refreshFoodLog();
}

// Distinct foods you've logged before, most recent first (for quick-add chips)
function getRecentFoods(limit) {
  const seen = new Map();
  const days = [...state.data.days].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const d of days) {
    for (const it of (d.foodLog || [])) {
      const key = (it.name || '').toLowerCase();
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, { name: it.name, grams: it.grams, unit: it.unit || 'g', qty: it.qty, kcal: it.kcal, p: it.p, c: it.c, f: it.f, ai: it.ai, count: 1 });
      else seen.get(key).count++;
    }
  }
  return [...seen.values()].slice(0, limit || 8);
}

function quickAddRecent(i) {
  const f = (state._recentFoods || [])[i];
  if (!f) return;
  if (!state._foodLog) state._foodLog = [];
  state._foodLog.push({ id: uid(), name: f.name, grams: f.grams, unit: f.unit, qty: f.qty, kcal: f.kcal, p: f.p, c: f.c, f: f.f, ai: f.ai });
  refreshFoodLog();
  showToast('Added ' + f.name, 'success');
}

function refreshFoodLog() {
  const listEl = document.getElementById('food-log-list');
  const totEl = document.getElementById('food-log-totals');
  if (listEl) listEl.innerHTML = renderFoodLogList();
  if (totEl) totEl.innerHTML = renderFoodLogTotals();
  const t = foodLogTotals(state._foodLog);
  const calEl = document.getElementById('calories-eaten');
  if (calEl && t.kcal > 0) calEl.value = Math.round(t.kcal);
  updateCaloriesRemaining();
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD HELPERS
// ─────────────────────────────────────────────────────────────
function getLastWeekStats() {
  const thisWeekStart = getWeekStart(todayStr());
  const d = new Date(thisWeekStart + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  const lastWeekStart = d.toISOString().split('T')[0];
  const ld = state.data.days.filter(x => x.date >= lastWeekStart && x.date < thisWeekStart);
  const gymDays = ld.filter(x => x.gym?.done).length;
  const fr = ld.filter(x => x.food?.rating > 0).map(x => x.food.rating);
  const avgFood = fr.length ? fr.reduce((a,b)=>a+b,0)/fr.length : 0;
  const networkCount = ld.reduce((s,x)=>s+(x.networking?.count||0),0);
  const weekIncome = state.data.weeks.find(w => w.weekStart === lastWeekStart)?.income || 0;
  return { gymDays, avgFood, networkCount, weekIncome };
}

function wowArrow(now, then) {
  if (!then && !now) return '';
  const diff = now - then;
  if (Math.abs(diff) < 0.01) return '';
  const pct = then > 0 ? Math.abs(Math.round((diff / then) * 100)) : 100;
  return diff > 0
    ? '<span class="wow-up">▲ +' + pct + '%</span>'
    : '<span class="wow-down">▼ -' + pct + '%</span>';
}

function renderReminderBanner() {
  const today = todayStr();
  const todayLogged = state.data.days.some(d => d.date === today);
  if (todayLogged) return '';
  const streak = getGymStreak();
  const urgent = streak >= 3 && isPillarOn('gym');
  const msg = urgent
    ? '🔥 ' + streak + '-day ' + escapeHtml(pillar('gym').label) + ' streak at risk — log today to keep it alive!'
    : '📝 You haven\'t logged today yet.';
  return '<div class="reminder-banner' + (urgent ? ' reminder-urgent' : '') + '">' +
    '<span>' + msg + '</span>' +
    '<button class="btn btn-primary" onclick="navigate(\'log\')" style="padding:6px 18px;font-size:13px;flex-shrink:0">Log Now →</button>' +
    '</div>';
}

function renderFocusCard(thisWeek, lastWeek) {
  const p = state.data.profile;
  const tips = {
    gym:        'Treat it like an appointment — put it in your calendar and protect the time.',
    food:       'Small consistent choices beat occasional perfection. Plan ahead so it takes zero willpower.',
    networking: 'Reach out to just one today. Momentum compounds — every streak starts with one.',
    money:      'Block focused, distraction-free time for your highest-value activity. That\'s where results come from.',
    reading:    'Even 10 pages a day is over 3,600 pages a year. Keep the streak alive.'
  };
  const areas = [
    { id: 'gym',        pct: p.gymDaysPerWeek   > 0 ? (thisWeek.gymDays     / p.gymDaysPerWeek)   * 100 : -1 },
    { id: 'food',       pct: thisWeek.avgFood   > 0 ? (thisWeek.avgFood     / 5)                  * 100 : -1 },
    { id: 'networking', pct: p.weeklyNetworkGoal > 0 ? (thisWeek.networkCount / p.weeklyNetworkGoal) * 100 : -1 },
    { id: 'money',      pct: p.weeklyIncomeGoal  > 0 ? (thisWeek.weekIncome   / p.weeklyIncomeGoal)  * 100 : -1 },
    { id: 'reading',    pct: p.weeklyReadGoal    > 0 ? (thisWeek.readPages    / p.weeklyReadGoal)    * 100 : -1 }
  ].filter(a => a.pct >= 0 && isPillarOn(a.id))
   .map(a => { const pc = pillar(a.id); return { ...a, name: pc.label, icon: pc.icon, tip: tips[a.id] }; });

  if (!areas.length) return '';
  const lowest = areas.slice().sort((a, b) => a.pct - b.pct)[0];
  const color = lowest.pct >= 80 ? 'var(--success)' : lowest.pct >= 50 ? 'var(--warning)' : 'var(--danger)';

  return '<div class="focus-card card">' +
    '<div class="focus-header">' +
    '<div><div class="focus-label">🎯 Focus This Week</div>' +
    '<div class="focus-area">' + lowest.icon + ' ' + lowest.name + ' — ' + Math.round(lowest.pct) + '% of goal</div></div>' +
    '<div class="focus-bar-wrap"><div class="focus-bar" style="width:' + Math.min(100, lowest.pct) + '%;background:' + color + '"></div></div>' +
    '</div>' +
    '<div class="focus-tip">' + lowest.tip + '</div>' +
    '</div>';
}

function updateNavBadges() {
  const count = getFollowUpCount();
  const badge = document.getElementById('contacts-badge');
  if (badge) {
    if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }
}

function getFollowUpCount() {
  const today = todayStr();
  return state.data.contacts.filter(c => c.followUpDate && c.followUpDate <= today && c.status !== 'closed' && c.status !== 'dropped').length;
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
// Slim full-width hydration summary (water is tracked by everyone).
function renderHydrationStrip(stats) {
  const today = stats.waterToday || 0;
  const avg = stats.avgWater || 0;
  const pct = Math.min(100, Math.round((today / 1) * 100)); // 1 gal/day reference
  return '<div class="hydration-strip">' +
    '<span class="hyd-icon">💧</span>' +
    '<div class="hyd-info">' +
    '<div class="hyd-title">Hydration</div>' +
    '<div class="hyd-sub">' + (today > 0 ? '<strong>' + today + ' gal</strong> today' : 'Not logged today') +
      (avg > 0 ? ' · avg ' + avg.toFixed(2) + ' gal/day this week' : '') + '</div>' +
    '</div>' +
    '<div class="hyd-bar-wrap"><div class="hyd-bar" style="width:' + pct + '%"></div></div>' +
    '<button class="btn btn-outline hyd-btn" onclick="navigate(\'log\')">💧 Log water</button>' +
    '</div>';
}

// "Looking Back" — each day, show the user what they wrote on previous days.
function renderRecentNotesCard() {
  const recent = [...state.data.days]
    .filter(d => d.date < todayStr() && (d.notes || d.reading?.summary || d.money?.activities))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);
  if (!recent.length) return '';
  const clip = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
  const items = recent.map(d => {
    const bits = [];
    if (d.notes)              bits.push(escapeHtml(clip(d.notes, 220)));
    if (d.reading?.summary)   bits.push('<span class="rn-tag">📚</span> ' + escapeHtml(clip(d.reading.summary, 160)));
    if (d.money?.activities)  bits.push('<span class="rn-tag">💰</span> ' + escapeHtml(clip(d.money.activities, 120)));
    return '<div class="rn-item">' +
      '<div class="rn-date">' + fmtDate(d.date) + (d.water > 0 ? '<span class="rn-water">💧 ' + d.water + ' gal</span>' : '') + '</div>' +
      '<div class="rn-text">' + bits.join('<br>') + '</div>' +
      '</div>';
  }).join('');
  return '<div class="card recent-notes-card">' +
    '<h3 class="card-title">📔 Looking Back — Your Recent Notes</h3>' +
    '<p class="card-sub">What you wrote on previous days — so your story stays with you.</p>' +
    '<div class="rn-list">' + items + '</div>' +
    '</div>';
}

// ── Proactive daily AI insight (only shown when an API key is set) ──
function renderCoachInsightCard() {
  if (!state.hasApiKey) return '';
  const today = todayStr();
  const cached = state.data.coachInsight;
  let body;
  if (state.data.days.length === 0) {
    body = '<div class="di-empty">Log your first day and I\'ll start sharing a personalized insight here each morning.</div>';
    return '<div class="card insight-daily"><div class="di-head"><span class="di-icon">🧠</span><span class="di-title">Your Daily Coach Insight</span></div><div class="di-body" id="di-body">' + body + '</div></div>';
  }
  if (cached && cached.date === today && cached.text) body = '<div class="di-text">' + escapeHtml(cached.text) + '</div>';
  else body = '<div class="di-loading"><div class="spinner"></div><span>Reading your data…</span></div>';
  return '<div class="card insight-daily">' +
    '<div class="di-head"><span class="di-icon">🧠</span><span class="di-title">Your Daily Coach Insight</span>' +
    '<button class="di-refresh" onclick="fetchCoachInsight(true)" title="New insight">↻</button></div>' +
    '<div class="di-body" id="di-body">' + body + '</div></div>';
}

// Auto-generate once per day (cached in data.coachInsight); skips if already done
function maybeGenerateInsight() {
  if (!state.hasApiKey || state.data.days.length === 0) return;
  const c = state.data.coachInsight;
  if (c && c.date === todayStr() && c.text) return;
  return fetchCoachInsight(false);
}

async function fetchCoachInsight(force) {
  if (state._insightLoading) return;
  if (!state.hasApiKey) { showToast('Connect Claude in Settings first.', 'error'); return; }
  state._insightLoading = true;
  const setBody = (html) => { const b = document.getElementById('di-body'); if (b) b.innerHTML = html; };
  if (force) setBody('<div class="di-loading"><div class="spinner"></div><span>Thinking…</span></div>');
  try {
    const r = await fetch('/api/insight', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData() }) });
    const j = await r.json();
    if (!r.ok || !j.insight) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect Claude in Settings to get daily insights.' : 'Couldn\'t generate — tap ↻ to retry.') + '</div>');
      return;
    }
    state.data.coachInsight = { date: todayStr(), text: j.insight };
    await saveData();
    setBody('<div class="di-text">' + escapeHtml(j.insight) + '</div>');
  } catch {
    setBody('<div class="di-empty">Connection error — tap ↻ to retry.</div>');
  } finally {
    state._insightLoading = false;
  }
}

// ── Today's Game Plan: the coach tells you what to DO (works from day one) ──
function renderGamePlanCard() {
  if (!state.hasApiKey) return '';
  const cached = state.data.gamePlan;
  const body = (cached && cached.date === todayStr() && cached.text)
    ? '<div class="di-text plan-text">' + renderMarkdown(cached.text) + '</div>'
    : '<div class="di-loading"><div class="spinner"></div><span>Building today\'s plan…</span></div>';
  return '<div class="card insight-daily plan-card">' +
    '<div class="di-head"><span class="di-icon">🎯</span><span class="di-title">Today\'s Game Plan</span>' +
    '<button class="di-refresh" onclick="fetchGamePlan(true)" title="New plan">↻</button></div>' +
    '<div class="di-body" id="plan-body">' + body + '</div></div>';
}
// Auto-generate once per day (cached in data.gamePlan)
function maybeGeneratePlan() {
  if (!state.hasApiKey) return;
  const c = state.data.gamePlan;
  if (c && c.date === todayStr() && c.text) return;
  return fetchGamePlan(false);
}
async function fetchGamePlan(force) {
  if (state._planLoading) return;
  if (!state.hasApiKey) { showToast('Connect Claude in Settings first.', 'error'); return; }
  state._planLoading = true;
  const setBody = (html) => { const b = document.getElementById('plan-body'); if (b) b.innerHTML = html; };
  if (force) setBody('<div class="di-loading"><div class="spinner"></div><span>Thinking…</span></div>');
  try {
    const r = await fetch('/api/plan', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData() }) });
    const j = await r.json();
    if (!r.ok || !j.plan) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect Claude in Settings to get your plan.' : 'Couldn\'t build it — tap ↻ to retry.') + '</div>');
      return;
    }
    state.data.gamePlan = { date: todayStr(), text: j.plan };
    await saveData();
    setBody('<div class="di-text plan-text">' + renderMarkdown(j.plan) + '</div>');
  } catch {
    setBody('<div class="di-empty">Connection error — tap ↻ to retry.</div>');
  } finally {
    state._planLoading = false;
  }
}

// ── Patterns: the signature feature — one cross-pillar connection a day ──
const PATTERNS_MIN_DAYS = 3;
const PATTERNS_REFRESH_DAYS = 3; // auto-refresh cadence (controls AI cost); ↻ forces a fresh one anytime
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const t = Date.parse(dateStr + 'T00:00:00');
  return isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
}
function renderPatternsCard() {
  if (!state.hasApiKey) return '';
  const days = state.data.days || [];
  if (days.length === 0) return '';
  const cached = state.data.patternInsight;
  let body;
  if (cached && cached.text) {
    body = '<div class="di-text">' + escapeHtml(cached.text) + '</div>';
  } else if (days.length < PATTERNS_MIN_DAYS) {
    body = '<div class="di-empty">Log a few days and I\'ll start spotting connections across your pillars — like how your training affects your income.</div>';
  } else {
    body = '<div class="di-loading"><div class="spinner"></div><span>Connecting the dots across your life…</span></div>';
  }
  return '<div class="card insight-daily patterns-card">' +
    '<div class="di-head"><span class="di-icon">🔗</span><span class="di-title">Patterns — what connects in your life</span>' +
    (days.length >= PATTERNS_MIN_DAYS ? '<button class="di-refresh" onclick="fetchPatterns(true)" title="Find a new pattern">↻</button>' : '') +
    '</div><div class="di-body" id="pat-body">' + body + '</div></div>';
}
// Auto-generate at most every few days (cached in data.patternInsight) to control AI cost
function maybeGeneratePatterns() {
  if (!state.hasApiKey || (state.data.days || []).length < PATTERNS_MIN_DAYS) return;
  const c = state.data.patternInsight;
  if (c && c.text && daysSince(c.date) < PATTERNS_REFRESH_DAYS) return;
  return fetchPatterns(false);
}
async function fetchPatterns(force) {
  if (state._patLoading) return;
  if (!state.hasApiKey) { showToast('Connect Claude in Settings first.', 'error'); return; }
  state._patLoading = true;
  const setBody = (html) => { const b = document.getElementById('pat-body'); if (b) b.innerHTML = html; };
  if (force) setBody('<div class="di-loading"><div class="spinner"></div><span>Finding a connection…</span></div>');
  try {
    const r = await fetch('/api/patterns', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData() }) });
    const j = await r.json();
    if (!r.ok || !j.pattern) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect Claude in Settings to unlock Patterns.' : 'Couldn\'t find one — tap ↻ to retry.') + '</div>');
      return;
    }
    state.data.patternInsight = { date: todayStr(), text: j.pattern };
    await saveData();
    setBody('<div class="di-text">' + escapeHtml(j.pattern) + '</div>');
  } catch {
    setBody('<div class="di-empty">Connection error — tap ↻ to retry.</div>');
  } finally {
    state._patLoading = false;
  }
}

// ── Weekly Life Review: the Sunday ritual ──
function renderReviewCard() {
  if (!state.hasApiKey) return '';
  const days = state.data.days || [];
  if (days.length < PATTERNS_MIN_DAYS) return '';
  const wkStart = getWeekStart(todayStr());
  const saved = state.data.weeklyReview;
  const hasThisWeek = saved && saved.weekStart === wkStart && saved.text;
  const isSunday = new Date().getDay() === 0;
  let body;
  if (hasThisWeek) {
    body = '<div class="review-text">' + renderMarkdown(saved.text) + '</div>' +
      '<button class="btn btn-outline btn-sm" onclick="fetchReview(true)">↻ Regenerate</button>';
  } else {
    body = '<div class="review-cta"><p class="review-sub">' +
      (isSunday ? 'It\'s review day. See your week decoded across every pillar — wins, the one pattern that mattered, and your focus for next week.'
                : 'Get your week decoded across every pillar: your wins, the one pattern that mattered, and your single focus for next week.') +
      '</p><button class="btn btn-primary" onclick="fetchReview(true)">📋 Generate this week\'s review</button></div>';
  }
  return '<div class="card review-card' + (isSunday && !hasThisWeek ? ' review-due' : '') + '">' +
    '<div class="di-head"><span class="di-icon">📋</span><span class="di-title">Weekly Life Review</span>' +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="shareMyWeek()">📤 Share</button></div>' +
    '<div class="di-body" id="rev-body">' + body + '</div></div>';
}
async function fetchReview() {
  if (state._revLoading) return;
  if (!state.hasApiKey) { showToast('Connect Claude in Settings first.', 'error'); return; }
  state._revLoading = true;
  const setBody = (html) => { const b = document.getElementById('rev-body'); if (b) b.innerHTML = html; };
  setBody('<div class="di-loading"><div class="spinner"></div><span>Reviewing your whole week…</span></div>');
  try {
    const r = await fetch('/api/review', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData(), weekLabel: formatWeekRange(getWeekStart(todayStr())) }) });
    const j = await r.json();
    if (!r.ok || !j.review) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect Claude in Settings to unlock this.' : 'Couldn\'t generate — try again.') + '</div>');
      return;
    }
    state.data.weeklyReview = { weekStart: getWeekStart(todayStr()), text: j.review };
    await saveData();
    setBody('<div class="review-text">' + renderMarkdown(j.review) + '</div>' +
      '<button class="btn btn-outline btn-sm" onclick="fetchReview(true)">↻ Regenerate</button>');
  } catch {
    setBody('<div class="di-empty">Connection error — try again.</div>');
  } finally {
    state._revLoading = false;
  }
}

// ── One-tap shareable week card (the growth loop) ──
// Consecutive days logged up to today (today counts; if not logged yet, counts through yesterday)
function loggingStreak() {
  const set = new Set((state.data.days || []).map(d => d.date));
  let n = 0;
  const d = new Date(todayStr() + 'T00:00:00');
  if (!set.has(todayStr())) d.setDate(d.getDate() - 1);
  while (set.has(d.toISOString().split('T')[0])) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
// Longest run of consecutive logged days ever (computed from history — your record)
function bestStreak() {
  const dates = [...new Set((state.data.days || []).map(d => d.date))].sort();
  let best = 0, run = 0, prev = null;
  for (const ds of dates) {
    run = (prev && (Date.parse(ds + 'T00:00:00') - Date.parse(prev + 'T00:00:00')) === 86400000) ? run + 1 : 1;
    if (run > best) best = run;
    prev = ds;
  }
  return best;
}
// Prominent streak card — the 'don't break the chain' pressure (resets the count, never the data)
function renderStreakCard() {
  const days = state.data.days || [];
  if (days.length === 0) return '';
  const cur = loggingStreak();
  const best = bestStreak();
  const loggedToday = days.some(d => d.date === todayStr());
  let msg, urgent = false;
  if (loggedToday) {
    msg = cur >= 2 ? '🔥 ' + cur + ' days strong — keep the chain going!' : '✅ Logged today! Come back tomorrow to build your streak.';
  } else if (cur >= 1) {
    msg = '⚠️ Log today to keep your ' + cur + '-day streak alive!'; urgent = true;
  } else {
    msg = best >= 3 ? 'You reached ' + best + ' days before — start a new streak today!' : 'Log today to start your streak 🔥'; urgent = true;
  }
  return '<div class="card streak-card' + (urgent ? ' streak-urgent' : '') + '">' +
    '<div class="streak-flame">🔥</div>' +
    '<div class="streak-main"><div class="streak-num">' + cur + '</div><div class="streak-unit">day' + (cur === 1 ? '' : 's') + ' streak</div></div>' +
    '<div class="streak-msg">' + msg + (best > 0 ? '<div class="streak-best">🏆 Best: ' + best + ' day' + (best === 1 ? '' : 's') + '</div>' : '') + '</div>' +
    '</div>';
}
function weekShareStats() {
  const wkStart = getWeekStart(todayStr()), t = todayStr();
  const inWeek = (state.data.days || []).filter(d => d.date >= wkStart && d.date <= t);
  const sum = f => inWeek.reduce((s, d) => s + (Number(f(d)) || 0), 0);
  return {
    daysLogged: inWeek.length,
    workouts: inWeek.filter(d => d.gym && d.gym.done).length,
    pages: sum(d => d.reading && d.reading.pages),
    connections: sum(d => d.networking && d.networking.count),
    water: +sum(d => d.water).toFixed(1),
    streak: loggingStreak()
  };
}
// Up to 4 brag-worthy, non-sensitive stats from enabled pillars (no $ amounts)
function weekShareTiles(s) {
  const tiles = [{ icon: '✅', value: s.daysLogged + '/7', label: 'Days logged' }];
  if (isPillarOn('gym') && s.workouts) tiles.push({ icon: '🏋️', value: s.workouts, label: 'Workouts' });
  if (isPillarOn('reading') && s.pages) tiles.push({ icon: '📚', value: s.pages, label: 'Pages read' });
  if (isPillarOn('networking') && s.connections) tiles.push({ icon: '🤝', value: s.connections, label: 'Connections' });
  if (tiles.length < 4 && s.water) tiles.push({ icon: '💧', value: s.water, label: 'Gal water' });
  return tiles.slice(0, 4);
}
function buildWeekCardBlob() {
  return new Promise(resolve => {
    const W = 1080, H = 1920, cx = W / 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const rr = (px, py, w, h, r) => {
      x.beginPath();
      if (x.roundRect) x.roundRect(px, py, w, h, r);
      else { x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); }
    };
    const FONT = '-apple-system,Segoe UI,Roboto,sans-serif';
    // Background + glows
    x.fillStyle = '#0F1117'; x.fillRect(0, 0, W, H);
    let g = x.createRadialGradient(cx, 280, 60, cx, 280, 900);
    g.addColorStop(0, 'rgba(45,212,191,0.22)'); g.addColorStop(1, 'rgba(45,212,191,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createRadialGradient(cx, H - 220, 60, cx, H - 220, 900);
    g.addColorStop(0, 'rgba(167,139,250,0.20)'); g.addColorStop(1, 'rgba(167,139,250,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    x.textAlign = 'center';
    x.fillStyle = '#eef1f7'; x.font = '700 46px ' + FONT;
    x.fillText('⚡ Business Escalate', cx, 180);

    const s = weekShareStats();
    if (s.streak >= 2) {
      x.font = '800 110px sans-serif'; x.fillText('🔥', cx, 470);
      const ng = x.createLinearGradient(cx - 220, 0, cx + 220, 0);
      ng.addColorStop(0, '#2dd4bf'); ng.addColorStop(1, '#3b82f6');
      x.fillStyle = ng; x.font = '900 260px ' + FONT; x.fillText(String(s.streak), cx, 730);
      x.fillStyle = '#9aa3b2'; x.font = '700 52px ' + FONT; x.fillText('DAY STREAK', cx, 810);
    } else {
      const ng = x.createLinearGradient(cx - 280, 0, cx + 280, 0);
      ng.addColorStop(0, '#2dd4bf'); ng.addColorStop(1, '#a78bfa');
      x.fillStyle = ng; x.font = '900 150px ' + FONT; x.fillText('My Week', cx, 560);
      x.fillStyle = '#9aa3b2'; x.font = '500 46px ' + FONT; x.fillText(formatWeekRange(getWeekStart(todayStr())), cx, 660);
    }

    const tiles = weekShareTiles(s);
    const tileW = 430, tileH = 230, gap = 40, cols = 2;
    const gridW = cols * tileW + (cols - 1) * gap;
    const sx = (W - gridW) / 2, sy = 910;
    tiles.forEach((t, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const tx = sx + col * (tileW + gap), ty = sy + row * (tileH + gap);
      x.fillStyle = 'rgba(255,255,255,0.05)'; rr(tx, ty, tileW, tileH, 28); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.10)'; x.lineWidth = 2; rr(tx, ty, tileW, tileH, 28); x.stroke();
      const mx = tx + tileW / 2;
      x.fillStyle = '#eef1f7'; x.font = '700 62px sans-serif'; x.fillText(t.icon, mx, ty + 92);
      x.fillStyle = '#ffffff'; x.font = '900 78px ' + FONT; x.fillText(String(t.value), mx, ty + 165);
      x.fillStyle = '#9aa3b2'; x.font = '600 34px ' + FONT; x.fillText(t.label, mx, ty + 207);
    });

    const fg = x.createLinearGradient(cx - 320, 0, cx + 320, 0);
    fg.addColorStop(0, '#2dd4bf'); fg.addColorStop(1, '#3b82f6');
    x.fillStyle = fg; x.font = '800 54px ' + FONT; x.fillText('🔗 See what connects your life', cx, H - 240);
    x.fillStyle = '#9aa3b2'; x.font = '500 42px ' + FONT; x.fillText('One app for your whole life', cx, H - 165);
    x.fillStyle = '#eef1f7'; x.font = '700 44px ' + FONT; x.fillText('Business Escalate', cx, H - 95);

    cv.toBlob(b => resolve(b), 'image/png');
  });
}
async function shareMyWeek() {
  try {
    showToast('Building your card…', 'success');
    const blob = await buildWeekCardBlob();
    if (!blob) { showToast('Could not create the card.', 'error'); return; }
    const file = new File([blob], 'my-week.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My week on Business Escalate', text: 'See what connects your life 🔗' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'my-week.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Card saved — post it to your story 🔥', 'success');
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user dismissed the share sheet
    showToast('Could not share the card.', 'error');
  }
}

// Weight trend card — current weight + change + a line chart over time
function renderWeightTrend() {
  const ws = [...(state.data.weights || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!ws.length) return '';
  const unit = weightUnitPref();
  const cur = kgToDisplay(ws[ws.length - 1].kg);
  if (ws.length === 1) {
    return '<div class="card weight-card"><h3 class="card-title" style="margin-bottom:8px">⚖️ Weight</h3>' +
      '<div class="weight-now">' + cur.toFixed(1) + ' ' + unit + '</div>' +
      '<div class="weight-sub">Log your weight again to start seeing your trend.</div></div>';
  }
  const change = cur - kgToDisplay(ws[0].kg);
  const chCls = change < 0 ? 'weight-down' : change > 0 ? 'weight-up' : '';
  const chTxt = (change > 0 ? '+' : '') + change.toFixed(1) + ' ' + unit + ' since ' + fmtDateShort(ws[0].date);
  return '<div class="card weight-card">' +
    '<div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">⚖️ Weight Trend</h3>' +
    '<div><span class="weight-now-inline">' + cur.toFixed(1) + ' ' + unit + '</span> <span class="' + chCls + '">' + chTxt + '</span></div>' +
    '</div>' +
    '<div class="chart-wrap" style="margin-top:14px"><canvas id="weightChart"></canvas></div></div>';
}

function initWeightChart() {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('weightChart')?.getContext('2d');
  if (!ctx) return;
  const ws = [...(state.data.weights || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (ws.length < 2) return;
  const unit = weightUnitPref();
  charts.weight = new Chart(ctx, {
    type: 'line',
    data: { labels: ws.map(w => fmtDateShort(w.date)), datasets: [{ label: 'Weight (' + unit + ')', data: ws.map(w => Math.round(kgToDisplay(w.kg) * 10) / 10), borderColor: '#A78BFA', backgroundColor: 'rgba(167,139,250,0.12)', tension: 0.3, fill: true, pointBackgroundColor: '#7C3AED', pointRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => v + ' ' + unit } } } }
  });
}

// Builds one pillar card from the live config. Returns '' if the
// pillar is disabled. Each type renders its own value/badge.
function pillarCardHtml(id, ctx) {
  const pc = pillar(id);
  if (!pc.enabled) return '';
  const { stats, lastStats, profile, avgIncome } = ctx;
  const icon = pc.icon, label = escapeHtml(pc.label);

  if (id === 'gym') {
    const goal = profile.gymDaysPerWeek || 0;
    const streak = ctx.gymStreak;
    return '<div class="pillar-card gym">' +
      '<div class="pillar-icon">' + icon + '</div>' +
      '<div class="pillar-body">' +
      '<div class="pillar-title">' + label + '</div>' +
      '<div class="pillar-value"><span class="anim-count" data-val="' + stats.gymDays + '">0</span><span>' + (goal ? '/' + goal + ' days' : ' days') + '</span></div>' +
      '<div class="pillar-sub">this week' + (streak > 1 ? ' · <strong>' + streak + ' day streak 🔥</strong>' : '') + ' ' + wowArrow(stats.gymDays, lastStats.gymDays) + '</div>' +
      '</div>' +
      (goal ? '<div class="pillar-badge gym-badge anim-count" data-val="' + Math.round((stats.gymDays / goal) * 100) + '" data-suffix="%">0%</div>' : '') +
      '</div>';
  }
  if (id === 'food') {
    return '<div class="pillar-card food">' +
      '<div class="pillar-icon">' + icon + '</div>' +
      '<div class="pillar-body">' +
      '<div class="pillar-title">' + label + '</div>' +
      '<div class="pillar-value">' + (stats.avgFood > 0
        ? '<span class="anim-count" data-val="' + stats.avgFood.toFixed(1) + '" data-decimal="1">0</span>'
        : '—') + '<span>/5</span></div>' +
      '<div class="pillar-sub">avg rating this week ' + wowArrow(stats.avgFood, lastStats.avgFood) + '</div>' +
      '</div>' +
      '<div class="pillar-badge food-badge">' + renderStars(stats.avgFood) + '</div>' +
      '</div>';
  }
  if (id === 'networking') {
    const goal = profile.weeklyNetworkGoal || 0;
    return '<div class="pillar-card network">' +
      '<div class="pillar-icon">' + icon + '</div>' +
      '<div class="pillar-body">' +
      '<div class="pillar-title">' + label + '</div>' +
      '<div class="pillar-value"><span class="anim-count" data-val="' + stats.networkCount + '">0</span><span> total</span></div>' +
      '<div class="pillar-sub">this week' + (goal ? ' · goal ' + goal : '') + ' ' + wowArrow(stats.networkCount, lastStats.networkCount) + '</div>' +
      '</div>' +
      '<div class="pillar-badge network-badge anim-count" data-val="' + (goal > 0 ? Math.min(100, Math.round((stats.networkCount / goal) * 100)) : 0) + '" data-suffix="%">0%</div>' +
      '</div>';
  }
  if (id === 'money') {
    const goal = profile.weeklyIncomeGoal || 0;
    return '<div class="pillar-card money">' +
      '<div class="pillar-icon">' + icon + '</div>' +
      '<div class="pillar-body">' +
      '<div class="pillar-title">' + label + '</div>' +
      '<div class="pillar-value"><span class="anim-count" data-val="' + stats.weekIncome + '" data-prefix="$">$0</span></div>' +
      '<div class="pillar-sub">this week ' + wowArrow(stats.weekIncome, lastStats.weekIncome) + ' · avg <span class="anim-count" data-val="' + avgIncome.toFixed(0) + '" data-prefix="$">$0</span></div>' +
      '</div>' +
      (goal > 0 ? '<div class="pillar-badge money-badge anim-count" data-val="' + Math.min(100, Math.round((stats.weekIncome / goal) * 100)) + '" data-suffix="%">0%</div>' : '') +
      '</div>';
  }
  if (id === 'reading') {
    const ab = (state.data.books || []).find(b => b.status === 'reading');
    const streak = ctx.readStreak;
    return '<div class="pillar-card read">' +
      '<div class="pillar-icon">' + icon + '</div>' +
      '<div class="pillar-body">' +
      '<div class="pillar-title">' + label + '</div>' +
      '<div class="pillar-value"><span class="anim-count" data-val="' + stats.readPages + '">0</span><span> pages</span></div>' +
      '<div class="pillar-sub">' + stats.readDays + ' days this week' + (streak > 1 ? ' · <strong>' + streak + ' day streak 🔥</strong>' : '') + '</div>' +
      (ab ? '<div class="pillar-sub" style="margin-top:4px;font-style:italic;color:var(--read-color)">' + escapeHtml(ab.title.length > 22 ? ab.title.slice(0, 22) + '…' : ab.title) + '</div>' : '') +
      '</div></div>';
  }
  return '';
}

function renderDashboard() {
  const { days, weeks, profile } = state.data;
  const stats = getWeekStats();
  const lastStats = getLastWeekStats();
  const streak = getGymStreak();
  const score = getWeeklyScore();
  const sortedDays = [...days].sort((a, b) => new Date(b.date) - new Date(a.date));
  const sortedWeeks = [...weeks].sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));
  const avgIncome = getWeeklyAvg(weeks, 4);
  const hasDays = days.length > 0;
  const hasWeeks = weeks.length > 0;
  updateNavBadges();

  // Score color
  const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--accent)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
  const scoreLabel = score >= 80 ? 'Crushing It 🔥' : score >= 60 ? 'Solid Week 💪' : score >= 40 ? 'Room to Grow 📈' : 'Time to Push ⚡';

  // Pillar cards — generated from the live config (only enabled ones)
  const cardCtx = { stats, lastStats, profile, avgIncome, gymStreak: streak, readStreak: getReadingStreak() };
  const pillarsHtml =
    '<div class="pillar-grid">' +
    PILLAR_IDS.map(id => pillarCardHtml(id, cardCtx)).join('') +
    '</div>';

  // Weekly score card — goal rows with progress bars
  const goalRows = [];
  function goalBar(current, goal, color) {
    const pct = goal > 0 ? Math.min(100, Math.round(current / goal * 100)) : 0;
    const barColor = pct >= 100 ? 'var(--success)' : pct >= 60 ? 'var(--accent)' : color || 'var(--warning)';
    return '<div class="goal-bar"><div class="goal-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>';
  }
  if (isPillarOn('money')) {
    const pc = pillar('money');
    const mp = getMoneyPeriod(); // current week/month: income, spent, net
    const sGoal = profile.savingsGoal || 0;
    const detail = formatCurrency(mp.income) + ' in − ' + formatCurrency(mp.spent) + ' spent this ' + mp.label;
    if (sGoal > 0) {
      // Savings goal with a progress bar — net toward the target
      const net = mp.net;
      goalRows.push('<div class="sg-item"><div class="sg-item-top"><span>💰 Save this ' + mp.label + '</span>' +
        '<strong>' + formatCurrency(Math.max(0, net)) + ' / ' + formatCurrency(sGoal) + '</strong></div>' +
        goalBar(Math.max(0, net), sGoal) +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + detail +
        (net >= sGoal ? ' · 🎉 goal hit!' : ' · ' + formatCurrency(sGoal - net) + ' to go') + '</div></div>');
    } else if (mp.income > 0 || mp.spent > 0) {
      const net = mp.net;
      goalRows.push('<div class="sg-item"><div class="sg-item-top"><span>' + pc.icon + ' Net this ' + mp.label + '</span>' +
        '<strong style="color:' + (net >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + formatCurrency(net) +
        (mp.income > 0 ? ' · ' + mp.rate + '% saved' : '') + '</strong></div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + detail + '</div>' +
        '<button class="btn-link-inline" onclick="navigate(\'settings\')" style="margin-top:4px">🎯 Set a savings goal</button></div>');
    } else {
      goalRows.push('<div class="sg-item"><span>' + pc.icon + ' ' + escapeHtml(pc.label) + '</span>' +
        '<button class="btn-link-inline" onclick="navigate(\'log\')">Log spending →</button></div>');
    }
  }
  if (isPillarOn('gym')) {
    const pc = pillar('gym');
    const goal = profile.gymDaysPerWeek || 5;
    goalRows.push('<div class="sg-item"><div class="sg-item-top"><span>' + pc.icon + ' ' + escapeHtml(pc.label) + '</span>' +
      '<strong>' + stats.gymDays + ' / ' + goal + ' days</strong></div>' +
      goalBar(stats.gymDays, goal, 'var(--gym-color)') + '</div>');
  }
  if (isPillarOn('networking')) {
    const pc = pillar('networking');
    const goal = profile.weeklyNetworkGoal || 3;
    goalRows.push('<div class="sg-item"><div class="sg-item-top"><span>' + pc.icon + ' ' + escapeHtml(pc.label) + '</span>' +
      '<strong>' + stats.networkCount + ' / ' + goal + '</strong></div>' +
      goalBar(stats.networkCount, goal, 'var(--network-color)') + '</div>');
  }
  if (isPillarOn('reading') && profile.weeklyReadGoal > 0) {
    const pc = pillar('reading');
    const goal = profile.weeklyReadGoal;
    goalRows.push('<div class="sg-item"><div class="sg-item-top"><span>' + pc.icon + ' ' + escapeHtml(pc.label) + '</span>' +
      '<strong>' + stats.readPages + ' / ' + goal + ' pg</strong></div>' +
      goalBar(stats.readPages, goal) + '</div>');
  }
  const onCount = enabledPillars().length;
  const scoreHtml =
    '<div class="card score-card">' +
    '<div class="score-left">' +
    '<div class="score-circle" style="--score-color:' + scoreColor + '">' +
    '<span class="score-num">' + score + '</span><span class="score-pct">%</span>' +
    '</div>' +
    '</div>' +
    '<div class="score-right">' +
    '<div class="score-label">' + scoreLabel + '</div>' +
    '<div class="score-sub">Weekly consistency score across your ' + onCount + ' active pillar' + (onCount === 1 ? '' : 's') + '</div>' +
    '<button class="btn btn-outline" style="margin-top:12px;padding:7px 14px;font-size:13px" onclick="navigate(\'log\')">📝 Log Today</button>' +
    '</div>' +
    '<div class="score-goals">' +
    goalRows.join('') +
    '<div class="sg-item" style="grid-column:1/-1;display:flex;gap:12px">' +
    '<button class="btn-link" onclick="renderGoalSettings()">Edit goals</button>' +
    '<button class="btn-link" onclick="navigate(\'settings\')">Customize pillars</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  // Charts & recent (if data)
  const anySpend = (state.data.days || []).some(d => (d.spent || 0) > 0);
  const showIncomeChart = isPillarOn('money') && (hasWeeks || anySpend);
  const showGymChart    = hasDays  && isPillarOn('gym');
  let chartsHtml = '';
  if (hasDays || hasWeeks) {
    const incomeTitle = 'Money (last 12 weeks)';
    const gymTitle    = escapeHtml(pillar('gym').label) + ' Days per Week';
    const chartCards =
      (showIncomeChart ? '<div class="card"><h3 class="card-title">' + incomeTitle + '</h3><div class="chart-wrap"><canvas id="incomeChart"></canvas></div></div>' : '') +
      (showGymChart    ? '<div class="card"><h3 class="card-title">' + gymTitle + '</h3><div class="chart-wrap"><canvas id="gymChart"></canvas></div></div>' : '');
    chartsHtml =
      (chartCards ? '<div class="charts-row">' + chartCards + '</div>' : '') +
      '<div class="card"><h3 class="card-title">Recent Days</h3>' + renderRecentDaysTable(sortedDays.slice(0, 7)) + '</div>';
  } else {
    chartsHtml = '<div class="empty-state"><div class="empty-icon">⚡</div>' +
      '<h3>Start tracking your life progress</h3>' +
      '<p>Log your first day to start building data across your ' + enabledPillars().length + ' pillars.</p>' +
      '<div class="empty-actions">' +
      '<button class="btn btn-primary" onclick="navigate(\'log\')">📝 Log Today</button>' +
      '</div></div>';
  }

  const achievementsHtml = hasDays ? renderAchievementsSection() : '';

  const focusHtml = renderFocusCard(stats, lastStats);

  document.getElementById('main').innerHTML =
    '<div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><h2 class="page-title">Dashboard</h2>' +
    '<p class="page-sub">Week of ' + formatWeekRange(getWeekStart(todayStr())) + '</p></div>' +
    (hasDays ? '<button class="btn btn-outline btn-sm" onclick="shareMyWeek()">📤 Share my week</button>' : '') +
    '</div>' +
    renderTrialBanner() + renderStreakCard() + renderReminderBanner() + renderQuoteCard() + renderGamePlanCard() + renderCoachInsightCard() + renderPatternsCard() + pillarsHtml + renderHydrationStrip(stats) + scoreHtml + renderMoneyCircleCard() + renderChecklistCard() + focusHtml + renderRecentNotesCard() + renderReviewCard() + chartsHtml + renderWeightTrend() + achievementsHtml;

  setTimeout(animateCounters, 120);
  if (showIncomeChart) initIncomeChart(sortedWeeks);
  if (showGymChart)    initGymChart(days);
  if ((state.data.weights || []).length >= 2) initWeightChart();
  maybeGeneratePlan();
  maybeGenerateInsight();
  maybeGeneratePatterns();
}

function renderStars(rating) {
  if (!rating) return '—';
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function renderRecentDaysTable(days) {
  if (!days.length) return '<p class="muted">No days logged yet.</p>';
  const rows = days.map(d => {
    const gymCell = d.gym?.done
      ? '<span style="color:var(--gym-color);font-weight:700">✓ ' + (d.gym.muscleGroup || 'Workout') + '</span>'
      : '<span style="color:var(--text-muted)">Rest</span>';
    const foodCell = d.food?.rating
      ? '<span style="color:var(--food-color)">' + '★'.repeat(d.food.rating) + '</span>'
      : '—';
    const netCell = d.networking?.count > 0
      ? '<span style="color:var(--network-color);font-weight:700">+' + d.networking.count + '</span>'
      : '—';
    const moneyCell = d.money?.activities
      ? '<span style="font-size:12px;color:var(--text-muted)">' + d.money.activities.slice(0, 40) + (d.money.activities.length > 40 ? '…' : '') + '</span>'
      : '—';
    return '<tr>' +
      '<td><strong>' + fmtDate(d.date) + '</strong></td>' +
      '<td>' + gymCell + '</td>' +
      '<td>' + foodCell + '</td>' +
      '<td>' + netCell + '</td>' +
      '<td>' + moneyCell + '</td>' +
      '<td class="action-cell">' +
      '<button class="btn-sm" onclick="editDay(\'' + d.id + '\')">✏️</button>' +
      '<button class="btn-sm btn-sm-danger" onclick="deleteDay(\'' + d.id + '\')">🗑️</button>' +
      '</td></tr>';
  }).join('');
  return '<table class="table"><thead><tr><th>Date</th><th>' + pillar('gym').icon + ' ' + escapeHtml(pillar('gym').label) + '</th><th>' + pillar('food').icon + ' ' + escapeHtml(pillar('food').label) + '</th><th>' + pillar('networking').icon + ' ' + escapeHtml(pillar('networking').label) + '</th><th>' + pillar('money').icon + ' ' + escapeHtml(pillar('money').label) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function initIncomeChart() {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('incomeChart')?.getContext('2d');
  if (!ctx) return;
  // 12 week-start buckets ending with this week
  const thisWk = getWeekStart(todayStr());
  const buckets = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(thisWk + 'T00:00:00'); d.setDate(d.getDate() - i * 7); buckets.push(d.toISOString().split('T')[0]); }
  const spendByWeek = {};
  (state.data.days || []).forEach(day => { if (day.spent > 0) { const ws = getWeekStart(day.date); spendByWeek[ws] = (spendByWeek[ws] || 0) + Number(day.spent); } });
  const incomeByWeek = {};
  (state.data.weeks || []).forEach(w => { if (w.income > 0) incomeByWeek[w.weekStart] = w.income; });
  const weekly = moneyCadence() === 'weekly';
  const ds = [{ label: 'Spending', data: buckets.map(ws => spendByWeek[ws] || 0), borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.12)', tension: 0.3, fill: true, pointBackgroundColor: '#991B1B', pointRadius: 4 }];
  if (weekly) ds.unshift({ label: 'Income', data: buckets.map(ws => incomeByWeek[ws] || 0), borderColor: '#E8A838', backgroundColor: 'rgba(232,168,56,0.10)', tension: 0.3, fill: true, pointBackgroundColor: '#7B3F00', pointRadius: 4 });
  charts.income = new Chart(ctx, { type: 'line', data: { labels: buckets.map(ws => formatWeekRange(ws, true)), datasets: ds }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: weekly } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v } } } } });
}

function initGymChart(days) {
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('gymChart')?.getContext('2d');
  if (!ctx) return;
  // Group by week
  const byWeek = {};
  days.forEach(d => {
    const ws = getWeekStart(d.date);
    if (!byWeek[ws]) byWeek[ws] = 0;
    if (d.gym?.done) byWeek[ws]++;
  });
  const weeks = Object.keys(byWeek).sort().slice(-12);
  const goal = state.data.profile.gymDaysPerWeek;
  charts.gym = new Chart(ctx, {
    type: 'bar',
    data: { labels: weeks.map(w => formatWeekRange(w, true)), datasets: [{ label: 'Gym days', data: weeks.map(w => byWeek[w]), backgroundColor: weeks.map(w => byWeek[w] >= goal ? 'rgba(46,125,50,0.8)' : 'rgba(232,168,56,0.7)'), borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 7, ticks: { stepSize: 1 } } } }
  });
}

// ─────────────────────────────────────────────────────────────
// "What you wrote last time" — recall the previous day's note
// (prefers literally yesterday; falls back to the most recent note)
// ─────────────────────────────────────────────────────────────
function lastNoteEntry() {
  const prevs = [...state.data.days]
    .filter(x => x.date < todayStr() && (x.notes || (x.reading && x.reading.summary)))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!prevs.length) return null;
  const yday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const e = prevs.find(p => p.date === yday) || prevs[0];
  return { date: e.date, text: e.notes || (e.reading && e.reading.summary) || '', isYesterday: e.date === yday };
}
function renderPrevNoteBanner() {
  const n = lastNoteEntry();
  if (!n || !n.text) return '';
  const when = n.isYesterday ? 'Yesterday' : fmtDate(n.date);
  const txt = n.text.length > 220 ? n.text.slice(0, 220) + '…' : n.text;
  return '<div class="prev-note-banner">📔 <strong>' + when + ' you wrote:</strong> ' + escapeHtml(txt) + '</div>';
}

// ─────────────────────────────────────────────────────────────
// LOG TODAY
// ─────────────────────────────────────────────────────────────
function renderLogToday(editDay) {
  const isEditing = !!editDay;
  const d = editDay || {};
  const dateVal = d.date || todayStr();
  const gymDone = d.gym?.done ?? null;  // null = not set, true/false = set
  const gymGroup = d.gym?.muscleGroup || '';
  const gymDur = d.gym?.duration || '';
  const gymNotes = d.gym?.notes || '';
  const foodRating = d.food?.rating || 0;
  const foodNotes = d.food?.notes || '';
  const netCount = d.networking?.count || '';
  const netNotes = d.networking?.notes || '';
  const moneyActs = d.money?.activities || '';
  const daySpent = (d.spent !== undefined && d.spent !== null && d.spent !== 0) ? d.spent : '';
  const waterVal = (d.water !== undefined && d.water !== null && d.water !== 0) ? d.water : '';
  const caloriesEaten = (d.calories !== undefined && d.calories !== null && d.calories !== 0) ? d.calories : '';
  // Seed the in-progress food log from the day being edited (or today's entry)
  const existingTodayEntry = !isEditing ? state.data.days.find(x => x.date === todayStr()) : null;
  state._foodLog = ((d.foodLog) || (existingTodayEntry && existingTodayEntry.foodLog) || []).map(x => ({ ...x }));
  const globalNotes = d.notes || '';
  // Weigh-in prefill: existing weight entry for this date (shown in the user's unit)
  const existingWeight = (state.data.weights || []).find(w => w.date === dateVal);
  const weighInVal = existingWeight ? Math.round(kgToDisplay(existingWeight.kg) * 10) / 10 : '';

  const editBanner = isEditing
    ? '<div class="edit-banner">✏️ Editing ' + fmtDate(d.date) + '<button class="btn-link" onclick="navigate(\'history\')">Cancel</button></div>'
    : '';

  // Gentle continuity: remind them what they wrote yesterday while logging
  const prevNoteBanner = isEditing ? '' : renderPrevNoteBanner();

  // Boolean ("did you do it?") pillar — uses the gym slot
  const gymP = pillar('gym');
  const gymIsDefault = gymP.label === 'Gym';

  const gymToggle =
    '<div class="gym-toggle">' +
    '<button type="button" class="gym-btn' + (gymDone === true ? ' active gym-yes' : '') + '" onclick="setGymDone(true)">' + (gymIsDefault ? '💪 I Worked Out' : '✅ Did it') + '</button>' +
    '<button type="button" class="gym-btn' + (gymDone === false ? ' active gym-no' : '') + '" onclick="setGymDone(false)">' + (gymIsDefault ? '😴 Rest Day' : '⛔ Not today') + '</button>' +
    '</div>';

  const gymDetails =
    '<div id="gym-details" style="' + (gymDone === false ? 'display:none' : '') + '">' +
    '<div class="form-row">' +
    (gymIsDefault
      ? '<div class="form-group"><label>Muscle Group</label>' +
        '<select id="gym-group">' +
        ['', 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Full Body', 'Cardio'].map(g =>
          '<option value="' + g.toLowerCase() + '"' + (gymGroup === g.toLowerCase() ? ' selected' : '') + '>' + (g || '— Select —') + '</option>'
        ).join('') +
        '</select></div>'
      : '<div class="form-group"><label>Category <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>' +
        '<input type="text" id="gym-group" placeholder="e.g. type / topic / focus" value="' + escapeHtml(gymGroup) + '"></div>') +
    '<div class="form-group"><label>Duration (min)</label>' +
    '<input type="number" id="gym-dur" min="0" step="5" placeholder="60" value="' + gymDur + '"></div>' +
    '</div>' +
    '<div class="form-group"><label>Notes</label>' +
    '<textarea id="gym-notes" rows="2" placeholder="How it went, anything to remember…">' + gymNotes + '</textarea></div>' +
    '</div>';

  // Food rating buttons
  const ratingBtns =
    '<div class="rating-row">' +
    [1, 2, 3, 4, 5].map(n => {
      const labels = { 1: 'Bad', 2: 'Poor', 3: 'Okay', 4: 'Good', 5: 'Great' };
      return '<button type="button" class="rating-btn r' + n + (foodRating === n ? ' sel' : '') + '" onclick="setFoodRating(' + n + ')" title="' + labels[n] + '">' + n + '</button>';
    }).join('') +
    '<input type="hidden" id="food-rating" value="' + foodRating + '">' +
    '</div>';

  document.getElementById('main').innerHTML =
    '<div class="page-header">' +
    '<h2 class="page-title">' + (isEditing ? 'Edit Day' : 'Log Today') + '</h2>' +
    '<p class="page-sub">' + (isEditing ? 'Update this entry' : 'Share everything about your day — takes about 2 minutes') + '</p>' +
    '</div>' +
    editBanner + prevNoteBanner +
    '<div class="card">' +
    '<form id="day-form" onsubmit="submitDay(event)">' +
    '<div class="form-group" style="max-width:220px">' +
    '<label>Date</label>' +
    '<input type="date" id="day-date" value="' + dateVal + '" required>' +
    '</div>' +

    renderLogNutritionSection(caloriesEaten) +

    // BOOLEAN PILLAR (gym slot)
    (isPillarOn('gym') ?
      '<div class="today-section gym-section">' +
      '<div class="today-section-header gym-header">' + gymP.icon + ' ' + escapeHtml(gymP.label) + '</div>' +
      gymToggle + gymDetails +
      '</div>' : '') +

    // RATING PILLAR (food slot)
    (isPillarOn('food') ? (() => { const pc = pillar('food'); return
      '<div class="today-section food-section">' +
      '<div class="today-section-header food-header">' + pc.icon + ' ' + escapeHtml(pc.label) + '</div>' +
      '<div class="form-group">' +
      '<label>How would you rate today? (1 = worst, 5 = best)</label>' +
      ratingBtns +
      '</div>' +
      '<div class="form-group"><label>Notes <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>' +
      '<textarea id="food-notes" rows="2" placeholder="Anything worth noting about today…">' + foodNotes + '</textarea></div>' +
      '</div>'; })() : '') +

    // COUNT PILLAR (networking slot)
    (isPillarOn('networking') ? (() => { const pc = pillar('networking'); return
      '<div class="today-section network-section">' +
      '<div class="today-section-header network-header">' + pc.icon + ' ' + escapeHtml(pc.label) + '</div>' +
      '<div class="form-row">' +
      '<div class="form-group"><label>How many today?</label>' +
      '<input type="number" id="net-count" min="0" step="1" placeholder="0" value="' + netCount + '"></div>' +
      '</div>' +
      '<div class="form-group"><label>Details <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>' +
      '<textarea id="net-notes" rows="2" placeholder="Who / what / where…">' + netNotes + '</textarea></div>' +
      '</div>'; })() : '') +

    // MONEY PILLAR — daily spending + this period's income, together in one block
    (isPillarOn('money') ? (() => {
      const pc = pillar('money');
      const cad = moneyCadence(), key = currentPeriodKey(cad), label = moneyPeriodLabel(cad);
      const income = getPeriodIncome(cad, key), isSet = income > 0;
      return '<div class="today-section money-section">' +
        '<div class="today-section-header money-header">' + pc.icon + ' ' + escapeHtml(pc.label) + ' & Spending</div>' +
        '<div class="form-group"><label>💸 Spent today <span style="font-weight:400;color:var(--text-muted)">($ — what you spent today)</span></label>' +
        '<input type="number" id="money-spent" min="0" step="0.01" placeholder="0" value="' + daySpent + '" oninput="updateNetHint()" style="font-size:20px;font-weight:800;border-color:var(--danger)"></div>' +
        // This period's income (set once, not asked when editing a past day)
        (!isEditing ?
          (isSet ? '<div id="period-income-set" class="period-set"><span>💰 ' + escapeHtml(pc.label) + ' this ' + label + ': <strong>' + formatCurrency(income) + '</strong></span>' +
                   '<button type="button" class="btn-link" onclick="editPeriodIncome()">Update</button></div>' : '') +
          '<div class="form-group" id="period-income-wrap"' + (isSet ? ' style="display:none"' : '') + '>' +
          '<label>💰 ' + escapeHtml(pc.label) + ' this ' + label + ' <span style="font-weight:400;color:var(--text-muted)">($ — set once, update when you get paid)</span></label>' +
          '<input type="number" id="period-income" min="0" step="0.01" placeholder="0" value="' + (income || '') + '" oninput="updateNetHint()" style="font-size:20px;font-weight:800;border-color:var(--accent)"></div>' +
          '<div id="net-hint" class="net-hint"></div>'
          : '') +
        '<div class="form-group"><label>What did you do today? <span style="font-weight:400;color:var(--text-muted)">(money moves — optional)</span></label>' +
        '<textarea id="money-acts" rows="2" placeholder="e.g. closed a deal, sent invoices, picked up a shift…">' + moneyActs + '</textarea></div>' +
        '</div>'; })() : '') +

    // READING PILLAR (reading slot)
    (isPillarOn('reading') ? (() => {
      const pc = pillar('reading');
      const ab = (state.data.books || []).find(b => b.status === 'reading');
      const rPages = d.reading?.pages || '';
      const rSummary = d.reading?.summary || '';
      return '<div class="today-section read-section">' +
        '<div class="today-section-header read-header">' + pc.icon + ' ' + escapeHtml(pc.label) + '</div>' +
        (ab
          ? '<div class="current-book-label">📖 ' + escapeHtml(ab.title) + (ab.author ? ' · ' + escapeHtml(ab.author) : '') + '</div>' +
            '<div class="form-row">' +
            '<div class="form-group"><label>Pages read today</label>' +
            '<input type="number" id="read-pages" min="0" step="1" placeholder="0" value="' + rPages + '" style="font-size:20px;font-weight:800"></div>' +
            '<div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:16px">' +
            '<button type="button" class="btn btn-outline" style="font-size:12px" onclick="showAddBookModal(true)">✏️ Change Book</button>' +
            '</div></div>' +
            '<div class="form-group"><label>What did you read? <span style="font-weight:400;color:var(--text-muted)">(summary — helps you retain it)</span></label>' +
            '<textarea id="read-summary" rows="3" placeholder="e.g. Learned the difference between assets and liabilities. The author argues that buying your own home is a liability, not an asset…">' + escapeHtml(rSummary) + '</textarea></div>'
          : '<div class="no-book-prompt">' +
            '<span>No book set yet.</span>' +
            '<button type="button" class="btn-link-inline" onclick="showAddBookModal(false)">Set your current book →</button>' +
            '</div>') +
        '</div>';
    })() : '') +

    // WATER (always shown — everyone tracks hydration, in gallons)
    '<div class="today-section water-section">' +
    '<div class="today-section-header water-header">💧 Water</div>' +
    '<div class="form-group">' +
    '<label>How much water did you drink today? <span style="font-weight:400;color:var(--text-muted)">(gallons)</span></label>' +
    '<div class="water-input-row">' +
    '<input type="number" id="water-gallons" min="0" step="0.25" placeholder="e.g. 0.5" value="' + waterVal + '" style="font-size:20px;font-weight:800;max-width:160px">' +
    '<span class="water-unit">gal</span>' +
    '<div class="water-quick">' +
    [0.25, 0.5, 0.75, 1].map(g => '<button type="button" class="water-chip" onclick="setWater(' + g + ')">' + g + '</button>').join('') +
    '</div>' +
    '</div>' +
    '<div class="water-hint">💡 A common daily target is about ½–1 gallon.</div>' +
    '</div></div>' +

    // WEIGH-IN (optional — tracks bodyweight over time)
    '<div class="today-section weigh-section">' +
    '<div class="today-section-header weigh-header">⚖️ Weigh-in</div>' +
    '<div class="form-group"><label>Today\'s weight <span style="font-weight:400;color:var(--text-muted)">(optional — builds your weight trend)</span></label>' +
    '<div class="weigh-row">' +
    '<input type="number" id="weigh-in" min="0" step="0.1" placeholder="' + (weightUnitPref() === 'lbs' ? '170' : '77') + '" value="' + weighInVal + '" style="font-size:20px;font-weight:800;max-width:160px">' +
    '<span class="weigh-unit">' + weightUnitPref() + '</span>' +
    '</div></div></div>' +

    '<div class="form-group" style="margin-top:8px"><label>Overall notes for today <span style="font-weight:400;color:var(--text-muted)">(what happened, how you felt — anything)</span></label>' +
    '<textarea id="day-notes" rows="3" placeholder="Share everything about your day — wins, struggles, ideas, how you felt…">' + escapeHtml(globalNotes) + '</textarea></div>' +

    '<div class="form-actions">' +
    (isEditing ? '<button type="button" class="btn btn-outline" onclick="navigate(\'history\')" style="margin-right:12px">Cancel</button>' : '') +
    '<button type="submit" class="btn btn-primary btn-lg">' + (isEditing ? '💾 Update Day' : '💾 Save Today') + '</button>' +
    '</div>' +
    '</form></div>';
  updateNetHint(); // show the period income − spending net summary right away
}

// Reveal the income input when the user wants to update an already-set period
function editPeriodIncome() {
  const wrap = document.getElementById('period-income-wrap');
  const line = document.getElementById('period-income-set');
  if (wrap) wrap.style.display = '';
  if (line) line.style.display = 'none';
  const inp = document.getElementById('period-income');
  if (inp) { inp.focus(); inp.select && inp.select(); }
}
// Live "income − spending = net" hint for the current period
function updateNetHint() {
  const el = document.getElementById('net-hint'); if (!el) return;
  const cad = moneyCadence(); const key = currentPeriodKey(cad); const label = moneyPeriodLabel(cad);
  const incEl = document.getElementById('period-income');
  const income = incEl ? (parseFloat(incEl.value) || 0) : getPeriodIncome(cad, key);
  // period spending from saved days, swapping today's saved value for what's typed now
  const savedToday = (state.data.days.find(d => d.date === todayStr())?.spent) || 0;
  const typedToday = parseFloat(document.getElementById('money-spent')?.value) || 0;
  const spent = Math.max(0, periodSpending(cad, key) - savedToday + typedToday);
  if (!income && !spent) { el.innerHTML = ''; return; }
  const net = income - spent;
  const rate = income > 0 ? Math.round(net / income * 100) : 0;
  el.innerHTML = '<span style="color:var(--text-muted)">This ' + label + ':</span> ' + formatCurrency(income) + ' in − ' + formatCurrency(spent) + ' spent = ' +
    '<strong style="color:' + (net >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + formatCurrency(net) + ' net</strong>' +
    (income > 0 ? ' <span style="color:var(--text-muted)">· ' + rate + '% saved</span>' : '');
}

function setGymDone(val) {
  document.querySelectorAll('.gym-btn').forEach(b => b.classList.remove('active', 'gym-yes', 'gym-no'));
  const btn = val ? document.querySelector('.gym-btn:first-child') : document.querySelector('.gym-btn:last-child');
  if (btn) { btn.classList.add('active'); btn.classList.add(val ? 'gym-yes' : 'gym-no'); }
  document.getElementById('gym-details').style.display = val ? '' : 'none';
  state._gymDone = val;
}

function setFoodRating(n) {
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('sel'));
  document.querySelector('.rating-btn.r' + n)?.classList.add('sel');
  const inp = document.getElementById('food-rating');
  if (inp) inp.value = n;
}

// Water quick-fill: add the chip amount to the current gallons value
function setWater(gal) {
  const inp = document.getElementById('water-gallons');
  if (!inp) return;
  const cur = parseFloat(inp.value) || 0;
  inp.value = Math.round((cur + gal) * 100) / 100;
}

async function submitDay(e) {
  e.preventDefault();
  const date = document.getElementById('day-date').value;

  // Prior entry for this date (or the one being edited). Used to PRESERVE
  // data for pillars that are currently disabled — their fields aren't on
  // screen, so we carry the old values over instead of zeroing them out.
  const prior = (state._editDayId
    ? state.data.days.find(d => d.id === state._editDayId)
    : state.data.days.find(d => d.date === date)) || {};

  const gymDoneBtn = document.querySelector('.gym-btn.active');
  const gymDone = gymDoneBtn ? gymDoneBtn.classList.contains('gym-yes') : null;
  const foodEl = document.getElementById('food-rating');
  const entry = {
    id: state._editDayId || prior.id || uid(),
    date,
    gym: document.querySelector('.gym-btn') ? {
      done: gymDone === true,
      muscleGroup: document.getElementById('gym-group')?.value || '',
      duration: parseInt(document.getElementById('gym-dur')?.value) || 0,
      notes: document.getElementById('gym-notes')?.value?.trim() || ''
    } : (prior.gym || { done: false, muscleGroup: '', duration: 0, notes: '' }),
    food: foodEl ? {
      rating: parseInt(foodEl.value) || 0,
      notes: document.getElementById('food-notes')?.value?.trim() || ''
    } : (prior.food || { rating: 0, notes: '' }),
    networking: document.getElementById('net-count') ? {
      count: parseInt(document.getElementById('net-count')?.value) || 0,
      notes: document.getElementById('net-notes')?.value?.trim() || ''
    } : (prior.networking || { count: 0, notes: '' }),
    money: document.getElementById('money-acts') ? {
      activities: document.getElementById('money-acts')?.value?.trim() || '',
      income: 0
    } : (prior.money || { activities: '', income: 0 }),
    spent: document.getElementById('money-spent') ? (parseFloat(document.getElementById('money-spent').value) || 0) : (prior.spent || 0),
    water: document.getElementById('water-gallons') ? (parseFloat(document.getElementById('water-gallons').value) || 0) : (prior.water || 0),
    notes: document.getElementById('day-notes')?.value?.trim() || ''
  };

  // Food log + calories eaten (food total wins; else the manual field)
  const fLog = (state._foodLog || []);
  const fTot = foodLogTotals(fLog);
  if (document.querySelector('.nut-section')) {
    entry.foodLog = fLog.map(x => ({ ...x }));
    entry.calories = fLog.length ? Math.round(fTot.kcal) : (parseFloat(document.getElementById('calories-eaten')?.value) || 0);
    entry.eaten = fLog.length ? { protein: Math.round(fTot.p), carbs: Math.round(fTot.c), fat: Math.round(fTot.f) } : null;
  } else {
    // nutrition not set up → preserve whatever was there
    entry.foodLog = prior.foodLog || [];
    entry.calories = prior.calories || 0;
    entry.eaten = prior.eaten || null;
  }

  // Reading — section is present whenever the reading pillar is on
  if (document.querySelector('.read-section')) {
    const ab = (state.data.books || []).find(b => b.status === 'reading');
    const readPages = parseInt(document.getElementById('read-pages')?.value) || 0;
    const readSummary = document.getElementById('read-summary')?.value?.trim() || '';
    entry.reading = { pages: readPages, bookId: ab?.id || '', bookTitle: ab?.title || '', summary: readSummary };
  } else {
    entry.reading = prior.reading || { pages: 0, bookId: '', bookTitle: '', summary: '' };
  }

  if (state._editDayId) {
    const idx = state.data.days.findIndex(d => d.id === state._editDayId);
    if (idx !== -1) state.data.days[idx] = entry; else state.data.days.push(entry);
    state._editDayId = null;
  } else {
    const existing = state.data.days.findIndex(d => d.date === date);
    if (existing !== -1) {
      if (!confirm('You already have an entry for ' + fmtDate(date) + '. Replace it?')) return;
      state.data.days[existing] = entry;
    } else {
      state.data.days.push(entry);
    }
  }

  // Save income for the period (weekly or monthly, per the user's chosen cadence)
  const periodIncomeEl = document.getElementById('period-income');
  if (periodIncomeEl) {
    const cad = moneyCadence();
    setPeriodIncome(cad, periodKeyFor(date, cad), parseFloat(periodIncomeEl.value) || 0);
  }

  // Save weigh-in (stored in kg) + keep nutrition weight current
  const weighEl = document.getElementById('weigh-in');
  if (weighEl) {
    const wv = parseFloat(weighEl.value) || 0;
    if (wv > 0) {
      const kg = Math.round(displayToKg(wv) * 10) / 10;
      upsertWeight(date, kg);
      if (state.data.profile.nutrition && state.data.profile.nutrition.heightCm) state.data.profile.nutrition.weightKg = kg;
    }
  }

  await saveData();

  // Check for streak milestone
  if (entry.gym.done) {
    const newStreak = getGymStreak();
    if ([3, 7, 14, 21, 30].includes(newStreak)) {
      setTimeout(() => showStreakCelebration(newStreak), 600);
    }
  }

  showToast(state._editDayId ? 'Day updated! ✅' : 'Today logged! 🎉', 'success');
  navigate('dashboard');
}

function editDay(id) {
  const day = state.data.days.find(d => d.id === id);
  if (!day) return;
  state._editDayId = id;
  state.page = 'log';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === 'log'));
  renderLogToday(day);
}

async function deleteDay(id) {
  const day = state.data.days.find(d => d.id === id);
  if (!confirm('Delete entry for ' + (day ? fmtDate(day.date) : 'this day') + '?')) return;
  state.data.days = state.data.days.filter(d => d.id !== id);
  await saveData();
  showToast('Deleted.', 'success');
  if (state.page === 'history') renderHistoryPage();
  else renderDashboard();
}

// ─────────────────────────────────────────────────────────────
// BUSINESS IDEAS
// ─────────────────────────────────────────────────────────────
function renderIdeasPage() {
  const { ideas } = state.data;
  const active    = ideas.filter(i => i.status === 'active');
  const exploring = ideas.filter(i => i.status === 'exploring');
  const dropped   = ideas.filter(i => i.status === 'dropped');

  const ideaCard = (idea) =>
    '<div class="idea-card">' +
    '<div class="idea-card-top">' +
    '<div class="idea-title">' + idea.title + '</div>' +
    '<span class="idea-status-badge ' + idea.status + '">' +
    (idea.status === 'active' ? '🚀 Active' : idea.status === 'exploring' ? '🔍 Exploring' : '❌ Dropped') +
    '</span>' +
    '</div>' +
    (idea.description ? '<div class="idea-desc">' + idea.description + '</div>' : '') +
    (idea.notes ? '<div class="idea-notes">📝 ' + idea.notes + '</div>' : '') +
    '<div class="idea-actions">' +
    (idea.status !== 'active'    ? '<button class="btn-sm" onclick="setIdeaStatus(\'' + idea.id + '\',\'active\')">🚀 Go Active</button>' : '') +
    (idea.status !== 'exploring' ? '<button class="btn-sm" onclick="setIdeaStatus(\'' + idea.id + '\',\'exploring\')">🔍 Exploring</button>' : '') +
    (idea.status !== 'dropped'   ? '<button class="btn-sm btn-sm-danger" onclick="setIdeaStatus(\'' + idea.id + '\',\'dropped\')">Drop</button>' : '') +
    '<button class="btn-sm btn-sm-danger" onclick="deleteIdea(\'' + idea.id + '\')">🗑️</button>' +
    '</div></div>';

  const section = (title, list) => list.length === 0 ? '' :
    '<h3 class="ideas-section-title">' + title + '</h3>' +
    '<div class="ideas-grid">' + list.map(ideaCard).join('') + '</div>';

  document.getElementById('main').innerHTML =
    '<div class="page-header">' +
    '<h2 class="page-title">Business Ideas</h2>' +
    '<p class="page-sub">Track the income opportunities and side hustles you\'re building toward</p>' +
    '</div>' +

    '<div class="card">' +
    '<h3 class="card-title">💡 Add New Idea</h3>' +
    '<form id="idea-form" onsubmit="addIdea(event)">' +
    '<div class="form-group"><label>Idea title <span style="color:var(--danger)">*</span></label>' +
    '<input type="text" id="idea-title" placeholder="e.g. Start a referral program at the gym · Sell solar panels on weekends · Launch an online sales course" required></div>' +
    '<div class="form-group"><label>Description / notes</label>' +
    '<textarea id="idea-desc" rows="2" placeholder="How it works, estimated income, what you need to start…"></textarea></div>' +
    '<div class="form-group"><label>Status</label>' +
    '<select id="idea-status">' +
    '<option value="exploring">🔍 Exploring — thinking about it</option>' +
    '<option value="active">🚀 Active — already working on it</option>' +
    '</select></div>' +
    '<button type="submit" class="btn btn-primary">+ Add Idea</button>' +
    '</form></div>' +

    (ideas.length === 0
      ? '<div class="empty-state small"><p>No ideas yet. Add your first one above, or ask the AI Coach for income stream ideas.</p></div>'
      : section('🚀 Active', active) + section('🔍 Exploring', exploring) + section('❌ Dropped', dropped)) +

    (state.hasApiKey && ideas.length > 0
      ? '<div class="card" style="margin-top:4px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><h3 class="card-title" style="margin-bottom:4px">🤖 Analyze My Ideas</h3>' +
        '<p style="font-size:13px;color:var(--text-muted)">Ask Claude which idea has the best potential for your situation</p></div>' +
        '<button class="btn btn-primary" id="btn-ideas-ai" onclick="analyzeIdeas()">✨ Ask Coach</button></div>' +
        '<div class="insight-result hidden" id="result-ideas"></div></div>'
      : '');
}

async function addIdea(e) {
  e.preventDefault();
  const title = document.getElementById('idea-title').value.trim();
  if (!title) return;
  state.data.ideas.push({
    id: uid(), title,
    description: document.getElementById('idea-desc').value.trim(),
    status: document.getElementById('idea-status').value,
    createdAt: todayStr(), notes: ''
  });
  await saveData();
  showToast('Idea added!', 'success');
  renderIdeasPage();
}

async function setIdeaStatus(id, status) {
  const idea = state.data.ideas.find(i => i.id === id);
  if (!idea) return;
  idea.status = status;
  await saveData();
  showToast('Updated to ' + status + '!', 'success');
  renderIdeasPage();
}

async function deleteIdea(id) {
  if (!confirm('Delete this idea?')) return;
  state.data.ideas = state.data.ideas.filter(i => i.id !== id);
  await saveData();
  showToast('Idea deleted.', 'success');
  renderIdeasPage();
}

async function analyzeIdeas() {
  const btn = document.getElementById('btn-ideas-ai');
  const resultEl = document.getElementById('result-ideas');
  const question = 'Analyze my business ideas and tell me which to pursue.\n\n' +
    '## 1. Best Opportunity\nWhich idea has the highest income potential for someone in commission-based sales? Give real $ estimates.\n\n' +
    '## 2. Easiest to Start\nWhich idea could I start this week with minimal investment? What are the first 3 steps?\n\n' +
    '## 3. Best Long-Term Play\nWhich idea, if developed over 6–12 months, could become a significant second income?\n\n' +
    '## 4. Warning: Skip This One\nIs there any idea here that\'s unlikely to work for my situation? Why?\n\n' +
    '## 5. One Idea I\'m Missing\nBased on my profile and these ideas, what\'s one obvious income stream I haven\'t listed?';
  await streamAnalysis(question, resultEl, btn, '✨ Ask Coach');
}

// ─────────────────────────────────────────────────────────────
// CONTACTS  (mini-CRM for networking → commission)
// ─────────────────────────────────────────────────────────────
function renderContactsPage() {
  updateNavBadges();
  // Starred contacts always float to the top
  const { contacts } = state.data;
  contacts.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
  const today = todayStr();
  const overdue = contacts.filter(c => c.followUpDate && c.followUpDate < today  && !['closed','dropped'].includes(c.status));
  const dueToday= contacts.filter(c => c.followUpDate && c.followUpDate === today && !['closed','dropped'].includes(c.status));
  const upcoming= contacts.filter(c => c.followUpDate && c.followUpDate > today  && !['closed','dropped'].includes(c.status));
  const rest     = contacts.filter(c => !c.followUpDate                            && !['closed','dropped'].includes(c.status));
  const closed   = contacts.filter(c => ['closed','dropped'].includes(c.status));

  const statusColors = { new: 'var(--text-muted)', contacted: 'var(--network-color)', warm: 'var(--warning)', closing: 'var(--accent)', closed: 'var(--success)', dropped: 'var(--danger)' };
  const catColors = { prospect: 'var(--money-color)', client: 'var(--success)', referral: 'var(--gym-color)', friend: 'var(--network-color)', partner: 'var(--accent)' };

  function contactCard(c) {
    const isOverdue = c.followUpDate && c.followUpDate < today && !['closed','dropped'].includes(c.status);
    const isToday   = c.followUpDate && c.followUpDate === today && !['closed','dropped'].includes(c.status);
    const followUpBadge = isOverdue
      ? '<span class="fu-badge fu-overdue">⚠️ Follow-up overdue</span>'
      : isToday
        ? '<span class="fu-badge fu-today">📅 Follow up today</span>'
        : c.followUpDate
          ? '<span class="fu-badge fu-upcoming">🗓️ ' + fmtDate(c.followUpDate) + '</span>'
          : '';
    const statusStyle = 'background:' + (statusColors[c.status] || 'var(--text-muted)') + '22;color:' + (statusColors[c.status] || 'var(--text-muted)') + ';border:1px solid ' + (statusColors[c.status] || 'var(--text-muted)') + '44';
    const catStyle = 'background:' + (catColors[c.category] || 'var(--text-muted)') + '22;color:' + (catColors[c.category] || 'var(--text-muted)');

    return '<div class="contact-card' + (isOverdue ? ' contact-overdue' : isToday ? ' contact-today' : '') + (c.starred ? ' contact-starred' : '') + '">' +
      '<div class="contact-top">' +
      '<div class="contact-name">' +
      '<button class="star-btn' + (c.starred ? ' starred' : '') + '" onclick="toggleStar(\'' + c.id + '\')" title="' + (c.starred ? 'Unpin contact' : 'Pin contact') + '">' + (c.starred ? '⭐' : '☆') + '</button>' +
      c.name + '</div>' +
      '<div class="contact-badges">' +
      '<span class="contact-badge" style="' + catStyle + '">' + (c.category || 'contact') + '</span>' +
      '<span class="contact-badge" style="' + statusStyle + '">' + (c.status || 'new') + '</span>' +
      '</div>' +
      '</div>' +
      (c.role ? '<div class="contact-role">💼 ' + c.role + '</div>' : '') +
      (c.met  ? '<div class="contact-met">📍 ' + c.met + '</div>' : '') +
      (c.phone || c.social ? '<div class="contact-info">' + (c.phone ? '📞 ' + c.phone + '  ' : '') + (c.social ? '📲 ' + c.social : '') + '</div>' : '') +
      (c.notes ? '<div class="contact-notes">' + c.notes + '</div>' : '') +
      followUpBadge +
      '<div class="contact-actions">' +
      (c.status !== 'closed' ? '<select class="contact-status-select" onchange="updateContactStatus(\'' + c.id + '\',this.value)">' +
        ['new','contacted','warm','closing','closed','dropped'].map(s =>
          '<option value="' + s + '"' + (c.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>'
        ).join('') + '</select>' : '') +
      '<button class="btn-sm" onclick="showSetFollowUp(\'' + c.id + '\')">📅 Follow-up</button>' +
      '<button class="btn-sm" onclick="editContact(\'' + c.id + '\')">✏️ Edit</button>' +
      '<button class="btn-sm btn-sm-danger" onclick="deleteContact(\'' + c.id + '\')">🗑️</button>' +
      '</div></div>';
  }

  const section = (title, list, cls) => list.length === 0 ? '' :
    '<div class="contacts-section-title' + (cls ? ' ' + cls : '') + '">' + title + ' <span>(' + list.length + ')</span></div>' +
    '<div class="contacts-grid">' + list.map(contactCard).join('') + '</div>';

  // Stats bar
  const statsBar = contacts.length > 0
    ? '<div class="contacts-stats">' +
      '<div class="cs-item"><span>Total</span><strong>' + contacts.length + '</strong></div>' +
      '<div class="cs-item"><span>🔥 Follow-ups due</span><strong style="color:' + (overdue.length + dueToday.length > 0 ? 'var(--danger)' : 'var(--success)') + '">' + (overdue.length + dueToday.length) + '</strong></div>' +
      '<div class="cs-item"><span>🌡️ Warm leads</span><strong>' + contacts.filter(c=>c.status==='warm'||c.status==='closing').length + '</strong></div>' +
      '<div class="cs-item"><span>✅ Clients</span><strong>' + contacts.filter(c=>c.status==='closed').length + '</strong></div>' +
      '</div>'
    : '';

  // Add contact form
  const addForm =
    '<div class="card" id="add-contact-wrap">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
    '<h3 class="card-title" style="margin-bottom:0">➕ Add Contact</h3>' +
    '<button class="btn-link" onclick="toggleAddContact()">Hide form</button>' +
    '</div>' +
    '<form id="contact-form" onsubmit="addContact(event)">' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Name <span style="color:var(--danger)">*</span></label>' +
    '<input type="text" id="c-name" placeholder="John Smith" required></div>' +
    '<div class="form-group"><label>What they do</label>' +
    '<input type="text" id="c-role" placeholder="Restaurant owner · Solar contractor · Gym trainer"></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Where / how you met</label>' +
    '<input type="text" id="c-met" placeholder="At the gym · LinkedIn · Networking event"></div>' +
    '<div class="form-group"><label>Category</label>' +
    '<select id="c-cat"><option value="prospect">💰 Prospect</option><option value="referral">🤝 Referral source</option><option value="client">✅ Client</option><option value="partner">🚀 Partner</option><option value="friend">👋 Friend</option></select>' +
    '</div></div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Phone</label><input type="text" id="c-phone" placeholder="555-1234"></div>' +
    '<div class="form-group"><label>Instagram / Social</label><input type="text" id="c-social" placeholder="@handle"></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Follow-up date</label><input type="date" id="c-followup"></div>' +
    '<div class="form-group"><label>Potential deal value ($)</label><input type="number" id="c-deal" min="0" step="100" placeholder="0"></div>' +
    '</div>' +
    '<div class="form-group"><label>Notes</label><textarea id="c-notes" rows="2" placeholder="What they need · What you discussed · Next steps…"></textarea></div>' +
    '<button type="submit" class="btn btn-primary">+ Save Contact</button>' +
    '</form></div>';

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">Contacts</h2>' +
    '<p class="page-sub">Every person you meet is a potential commission. Track them here.</p></div>' +
    statsBar + addForm +
    (contacts.length === 0
      ? '<div class="empty-state small"><p>No contacts yet. Add your first one above — start with someone you met at the gym this week.</p></div>'
      : section('⚠️ Overdue Follow-ups', overdue, 'cst-danger') +
        section('📅 Follow Up Today', dueToday, 'cst-today') +
        section('📋 Upcoming Follow-ups', upcoming, '') +
        section('👥 Other Contacts', rest, '') +
        section('✅ Closed / Dropped', closed, 'cst-muted'));
}

function toggleAddContact() {
  const el = document.getElementById('add-contact-wrap');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function addContact(e) {
  e.preventDefault();
  const name = document.getElementById('c-name').value.trim();
  if (!name) return;
  const contact = {
    id: uid(), name,
    role: document.getElementById('c-role').value.trim(),
    met: document.getElementById('c-met').value.trim(),
    category: document.getElementById('c-cat').value,
    phone: document.getElementById('c-phone').value.trim(),
    social: document.getElementById('c-social').value.trim(),
    followUpDate: document.getElementById('c-followup').value || '',
    dealValue: parseFloat(document.getElementById('c-deal').value) || 0,
    notes: document.getElementById('c-notes').value.trim(),
    status: 'new',
    addedDate: todayStr()
  };
  state.data.contacts.push(contact);
  await saveData();
  showToast(name + ' added to contacts! 👥', 'success');
  renderContactsPage();
}

async function updateContactStatus(id, status) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!c) return;
  c.status = status;
  await saveData();
  updateNavBadges();
  if (status === 'closed') showToast('🎉 Marked as client! Great work!', 'success');
  else showToast('Status updated.', 'success');
}

function showSetFollowUp(id) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!c) return;
  document.getElementById('fup-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'fup-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:340px;text-align:left">
    <div class="modal-badge">📅 Set Follow-Up Date</div>
    <p style="font-size:14px;color:var(--text-muted);margin-bottom:16px">For <strong style="color:var(--text)">${escapeHtml(c.name)}</strong></p>
    <div class="form-group">
      <label>Date</label>
      <input type="date" id="fup-date-input" value="${c.followUpDate || todayStr()}" style="font-size:15px">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
      ${c.followUpDate ? `<button class="btn btn-outline" onclick="clearFollowUp('${id}')">Clear</button>` : ''}
      <button class="btn btn-outline" onclick="document.getElementById('fup-modal').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveFollowUp('${id}')">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => document.getElementById('fup-date-input')?.focus(), 50);
}

async function saveFollowUp(id) {
  const c = state.data.contacts.find(x => x.id === id);
  const date = document.getElementById('fup-date-input')?.value;
  if (!c || !date) return;
  c.followUpDate = date;
  await saveData();
  document.getElementById('fup-modal')?.remove();
  showToast('Follow-up set for ' + fmtDate(date) + ' ✅', 'success');
  renderContactsPage();
}

async function clearFollowUp(id) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!c) return;
  c.followUpDate = '';
  await saveData();
  document.getElementById('fup-modal')?.remove();
  showToast('Follow-up cleared.', 'success');
  renderContactsPage();
}

function editContact(id) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!c) return;
  // Pre-fill the add form and scroll to it
  document.getElementById('add-contact-wrap').style.display = '';
  document.getElementById('c-name').value    = c.name;
  document.getElementById('c-role').value    = c.role || '';
  document.getElementById('c-met').value     = c.met || '';
  document.getElementById('c-cat').value     = c.category || 'prospect';
  document.getElementById('c-phone').value   = c.phone || '';
  document.getElementById('c-social').value  = c.social || '';
  document.getElementById('c-followup').value= c.followUpDate || '';
  document.getElementById('c-deal').value    = c.dealValue || '';
  document.getElementById('c-notes').value   = c.notes || '';
  // Change form to update mode
  const form = document.getElementById('contact-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    c.name        = document.getElementById('c-name').value.trim();
    c.role        = document.getElementById('c-role').value.trim();
    c.met         = document.getElementById('c-met').value.trim();
    c.category    = document.getElementById('c-cat').value;
    c.phone       = document.getElementById('c-phone').value.trim();
    c.social      = document.getElementById('c-social').value.trim();
    c.followUpDate= document.getElementById('c-followup').value || '';
    c.dealValue   = parseFloat(document.getElementById('c-deal').value) || 0;
    c.notes       = document.getElementById('c-notes').value.trim();
    await saveData();
    showToast(c.name + ' updated ✅', 'success');
    renderContactsPage();
  };
  document.getElementById('add-contact-wrap').scrollIntoView({ behavior: 'smooth' });
}

async function deleteContact(id) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!confirm('Delete ' + (c?.name || 'this contact') + '?')) return;
  state.data.contacts = state.data.contacts.filter(x => x.id !== id);
  await saveData();
  showToast('Contact deleted.', 'success');
  renderContactsPage();
}

async function toggleStar(id) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!c) return;
  c.starred = !c.starred;
  await saveData();
  renderContactsPage();
}

// ─────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────
function renderHistoryPage() {
  const { days } = state.data;
  const sorted = [...days].sort((a, b) => new Date(b.date) - new Date(a.date));

  const gymTotal  = days.filter(d => d.gym?.done).length;
  const foodAvg   = (() => { const r = days.filter(d => d.food?.rating > 0); return r.length ? (r.reduce((s, d) => s + d.food.rating, 0) / r.length) : 0; })();
  const netTotal  = days.reduce((s, d) => s + (d.networking?.count || 0), 0);
  const streak    = getGymStreak();

  const summaryHtml = days.length > 0
    ? '<div class="history-summary">' +
      '<div class="hs-item"><span>Days Logged</span><strong>' + days.length + '</strong></div>' +
      '<div class="hs-item"><span>Gym Workouts</span><strong>' + gymTotal + ' days 💪</strong></div>' +
      '<div class="hs-item"><span>Avg Food Rating</span><strong>' + (foodAvg > 0 ? foodAvg.toFixed(1) + '/5 🥗' : '—') + '</strong></div>' +
      '<div class="hs-item"><span>Total Connections</span><strong>' + netTotal + ' 🤝</strong></div>' +
      '</div>'
    : '';

  const months = [...new Set(days.map(d => d.date.substring(0, 7)))].sort().reverse();
  const monthOpts = '<option value="">All Time</option>' +
    months.map(m => { const d = new Date(m + '-01T00:00:00'); return '<option value="' + m + '">' + d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + '</option>'; }).join('');

  const view = state._historyView || 'list';

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">History</h2>' +
    '<p class="page-sub">All your logged days</p></div>' +
    summaryHtml +
    '<div class="view-toggle-row">' +
    '<button class="view-btn' + (view==='list'?' view-active':'') + '" onclick="switchHistoryView(\'list\')">📋 List</button>' +
    '<button class="view-btn' + (view==='calendar'?' view-active':'') + '" onclick="switchHistoryView(\'calendar\')">📅 Calendar</button>' +
    '</div>' +
    (view === 'calendar'
      ? '<div id="cal-container">' + renderHistoryCalendar() + '</div>'
      : '<div class="card">' +
        '<div class="history-filters">' +
        '<select id="filter-month" onchange="applyHistoryFilter()">' + monthOpts + '</select>' +
        '<span class="history-count" id="history-count">' + days.length + ' days</span>' +
        '</div>' +
        '<div id="history-table-wrap">' + renderHistoryRows(sorted) + '</div>' +
        '</div>');
}

function renderHistoryRows(days) {
  if (!days.length) return '<div class="empty-state small"><p>No entries yet.</p></div>';
  const rows = days.map(d => {
    const gymCell = d.gym?.done
      ? '<span class="pill pill-gym">' + (d.gym.muscleGroup ? d.gym.muscleGroup.charAt(0).toUpperCase() + d.gym.muscleGroup.slice(1) : 'Workout') + (d.gym.duration ? ' · ' + d.gym.duration + 'm' : '') + '</span>'
      : '<span style="color:var(--text-muted);font-size:12px">Rest</span>';
    const foodCell = d.food?.rating
      ? '<span class="pill pill-food">' + '★'.repeat(d.food.rating) + ' ' + d.food.rating + '/5</span>'
      : '—';
    const netCell = d.networking?.count > 0
      ? '<span class="pill pill-network">+' + d.networking.count + ' contacts</span>'
      : '—';
    const moneyCell = d.money?.activities
      ? '<span style="font-size:12px;color:var(--text-muted)">' + d.money.activities.slice(0, 50) + (d.money.activities.length > 50 ? '…' : '') + '</span>'
      : '—';
    const noteCell = d.notes ? '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">' + d.notes.slice(0, 60) + '</div>' : '';
    return '<tr>' +
      '<td><strong>' + fmtDate(d.date) + '</strong>' + noteCell + '</td>' +
      '<td>' + gymCell + '</td>' +
      '<td>' + foodCell + '</td>' +
      '<td>' + netCell + '</td>' +
      '<td>' + moneyCell + '</td>' +
      '<td class="action-cell">' +
      '<button class="btn-sm" onclick="editDay(\'' + d.id + '\')">✏️ Edit</button>' +
      '<button class="btn-sm btn-sm-danger" onclick="deleteDay(\'' + d.id + '\')">🗑️</button>' +
      '</td></tr>';
  }).join('');
  return '<table class="table"><thead><tr><th>Date</th><th>' + pillar('gym').icon + ' ' + escapeHtml(pillar('gym').label) + '</th><th>' + pillar('food').icon + ' ' + escapeHtml(pillar('food').label) + '</th><th>' + pillar('networking').icon + ' ' + escapeHtml(pillar('networking').label) + '</th><th>' + pillar('money').icon + ' ' + escapeHtml(pillar('money').label) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function switchHistoryView(v) {
  state._historyView = v;
  renderHistoryPage();
}

function applyHistoryFilter() {
  const m = document.getElementById('filter-month')?.value || '';
  let filtered = state.data.days;
  if (m) filtered = filtered.filter(d => d.date.startsWith(m));
  const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));
  const c = document.getElementById('history-count');
  if (c) c.textContent = filtered.length + ' days';
  const w = document.getElementById('history-table-wrap');
  if (w) w.innerHTML = renderHistoryRows(sorted);
}

// ─────────────────────────────────────────────────────────────
// AI COACH
// ─────────────────────────────────────────────────────────────
function renderCoachPage() {
  const keyBanner = !state.hasApiKey
    ? '<div class="api-key-banner"><span class="api-key-icon">🔑</span><div style="flex:1">' +
      '<h3>Connect Claude AI to unlock your coach</h3>' +
      '<p>Get your free API key at <strong>console.anthropic.com</strong> → API Keys</p>' +
      '<div style="display:flex;gap:10px;margin-top:10px;align-items:center">' +
      '<input type="password" id="api-key-input" placeholder="sk-ant-api03-…" style="flex:1;padding:10px 14px;border:1.5px solid var(--accent);border-radius:8px;font-size:14px;font-family:monospace;background:#fff;outline:none">' +
      '<button class="btn btn-primary" onclick="saveApiKey()">💾 Save Key</button></div>' +
      '<p style="margin-top:8px;font-size:12px;color:var(--text-muted)">Stored only on your computer.</p></div></div>'
    : '<div style="background:var(--success-bg);border:1px solid #b8e0cc;border-radius:var(--radius-sm);padding:10px 16px;margin-bottom:20px;font-size:13px;color:var(--success);display:flex;justify-content:space-between;align-items:center">' +
      '<span>✅ AI Coach is ready</span>' +
      '<button onclick="clearApiKey()" style="background:none;border:none;font-size:12px;color:var(--text-muted);cursor:pointer">Change key</button></div>';

  const cards = ANALYSES.map(a =>
    '<div class="insight-card card">' +
    '<div class="insight-card-header"><span class="insight-icon">' + a.icon + '</span><div>' +
    '<h3>' + a.title + '</h3><p>' + a.desc + '</p></div></div>' +
    '<button class="btn btn-primary" id="btn-' + a.id + '" onclick="runAnalysis(\'' + a.id + '\')"' + (!state.hasApiKey ? ' disabled' : '') + '>✨ Ask Coach</button>' +
    '<div class="insight-result hidden" id="result-' + a.id + '"></div>' +
    '</div>'
  ).join('');

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">AI Coach</h2>' +
    '<p class="page-sub">Powered by Claude — your personal life & income coach</p></div>' +
    keyBanner +
    '<div class="insights-grid">' + cards + '</div>' +
    '<div class="card custom-question-card">' +
    '<h3 class="card-title">💬 Ask Anything</h3>' +
    '<p class="card-sub">Ask your coach anything — "How do I stay consistent at the gym?", "What side business fits my skills?", "Why is my income inconsistent?", "How do I meet more people?"</p>' +
    '<div class="form-group"><textarea id="custom-question" rows="3" placeholder="Type your question here…"></textarea></div>' +
    '<button class="btn btn-primary" onclick="runCustomAnalysis()"' + (!state.hasApiKey ? ' disabled' : '') + '>✨ Ask Coach</button>' +
    '<div class="insight-result hidden" id="result-custom"></div>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────
// STREAMING AI HELPER
// ─────────────────────────────────────────────────────────────
async function streamAnalysis(question, resultEl, btn, btnText) {
  btn.disabled = true;
  btn.textContent = '⏳ Streaming…';
  resultEl.className = 'insight-result stream-active';
  resultEl.innerHTML = '<div class="stream-output"></div><span class="stream-cursor"></span>';
  const outputEl = resultEl.querySelector('.stream-output');
  let fullText = '';

  try {
    const resp = await fetch('/api/analyze-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: enrichedData(), question })
    });

    if (!resp.ok) {
      const j = await resp.json().catch(() => ({ error: 'Request failed' }));
      resultEl.className = 'insight-result error';
      resultEl.innerHTML = '<p class="error-msg">⚠️ ' + (j.error === 'NO_KEY' ? 'No API key — add one in Settings.' : (j.error || 'Request failed')) + '</p>';
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          resultEl.className = 'insight-result visible';
          resultEl.innerHTML = renderMarkdown(fullText);
          btn.disabled = false; btn.textContent = btnText;
          return;
        }
        try {
          const json = JSON.parse(payload);
          if (json.error) {
            resultEl.className = 'insight-result error';
            resultEl.innerHTML = '<p class="error-msg">⚠️ ' + (json.error === 'NO_KEY' ? 'No API key — add one in Settings.' : json.error) + '</p>';
            btn.disabled = false; btn.textContent = btnText;
            return;
          }
          if (json.text && outputEl) { fullText += json.text; outputEl.textContent = fullText; resultEl.scrollTop = 99999; }
        } catch {}
      }
    }
    if (fullText) { resultEl.className = 'insight-result visible'; resultEl.innerHTML = renderMarkdown(fullText); }
  } catch {
    resultEl.className = 'insight-result error';
    resultEl.innerHTML = '<p class="error-msg">⚠️ Connection error.</p>';
  } finally {
    btn.disabled = false; btn.textContent = btnText;
  }
}

async function runAnalysis(type) {
  const a = ANALYSES.find(x => x.id === type);
  if (!a) return;
  const btn = document.getElementById('btn-' + type);
  const res = document.getElementById('result-' + type);
  await streamAnalysis(a.prompt(), res, btn, '✨ Ask Coach');
}

async function runCustomAnalysis() {
  const q = document.getElementById('custom-question').value.trim();
  if (!q) { showToast('Type your question first.', 'error'); return; }
  const res = document.getElementById('result-custom');
  const btn = document.querySelector('.custom-question-card .btn');
  await streamAnalysis(q, res, btn, '✨ Ask Coach');
}

function enrichedData() {
  const { days, weeks, ideas, books } = state.data;
  // Don't send contact details (email/phone) to the AI — strip them out
  const { email, phone, ...profile } = state.data.profile || {};
  const sortedDays  = [...days].sort((a, b) => new Date(b.date) - new Date(a.date));
  const sortedWeeks = [...weeks].sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));
  const stats = getWeekStats();
  const activeBook = (books || []).find(b => b.status === 'reading');
  const nut = getNutrition();
  const eatenDays = days.filter(d => d.calories > 0);
  return {
    profile, ideas,
    nutritionTargets: nut ? { calories: nut.calories, proteinG: nut.protein.g, carbsG: nut.carbs.g, fatG: nut.fat.g, goal: nut.goal, strategy: nut.strategy, mealsPerDay: nut.meals.count, perMealCalories: nut.meals.calories } : null,
    caloriesEatenToday: state.data.days.find(d => d.date === todayStr())?.calories || 0,
    proteinEatenToday: state.data.days.find(d => d.date === todayStr())?.eaten?.protein || 0,
    foodsEatenToday: (state.data.days.find(d => d.date === todayStr())?.foodLog || []).map(x => x.name + ' (' + x.grams + 'g)'),
    avgCaloriesEaten: eatenDays.length ? Math.round(eatenDays.reduce((s, d) => s + d.calories, 0) / eatenDays.length) : 0,
    currentBook: activeBook ? { title: activeBook.title, author: activeBook.author, pagesRead: sortedDays.filter(d => d.reading?.bookId === activeBook.id).reduce((s, d) => s + (d.reading?.pages || 0), 0) } : null,
    booksFinished: (books || []).filter(b => b.status === 'finished').length,
    recentDays: sortedDays.slice(0, 30),
    recentWeeks: sortedWeeks.slice(0, 12),
    summary: {
      daysLogged: days.length,
      gymWorkouts: days.filter(d => d.gym?.done).length,
      gymStreak: getGymStreak(),
      avgFoodRating: (() => { const r = days.filter(d => d.food?.rating > 0); return r.length ? +(r.reduce((s, d) => s + d.food.rating, 0) / r.length).toFixed(1) : 0; })(),
      totalConnections: days.reduce((s, d) => s + (d.networking?.count || 0), 0),
      totalPagesRead: days.reduce((s, d) => s + (d.reading?.pages || 0), 0),
      readingStreak: getReadingStreak(),
      avgDailySpend: (() => { const sp = days.filter(d => d.spent > 0); return sp.length ? Math.round(sp.reduce((s, d) => s + d.spent, 0) / sp.length) : 0; })(),
      money: (() => {
        const mp = getMoneyPeriod();
        const sg = (state.data.profile && state.data.profile.savingsGoal) || 0;
        if (!mp.income && !mp.spent && !sg) return null;
        return { cadence: mp.cad, thisPeriodIncome: mp.income, thisPeriodSpent: mp.spent, thisPeriodNet: mp.net, savingsRatePct: mp.rate, savingsGoal: sg || null, savingsGoalMet: sg ? mp.net >= sg : null };
      })(),
      avgWaterGallons: (() => { const w = days.filter(d => d.water > 0); return w.length ? +(w.reduce((s, d) => s + d.water, 0) / w.length).toFixed(2) : 0; })(),
      thisWeekStats: stats
    }
  };
}

// ─────────────────────────────────────────────────────────────
// GOALS SETTINGS
// ─────────────────────────────────────────────────────────────
function renderGoalSettings() {
  const p = state.data.profile;
  const gymP = pillar('gym'), netP = pillar('networking'), moneyP = pillar('money'), readP = pillar('reading');
  const onCount = enabledPillars().length;
  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">My Goals</h2>' +
    '<p class="page-sub">Set your weekly targets across your ' + onCount + ' active pillar' + (onCount === 1 ? '' : 's') + '</p></div>' +
    '<div class="card"><form id="goals-form" onsubmit="saveGoals(event)">' +
    '<div class="form-row">' +
    (isPillarOn('gym') ? '<div class="form-group"><label>' + gymP.icon + ' ' + escapeHtml(gymP.label) + ' days per week</label>' +
      '<input type="number" id="g-gym" min="1" max="7" value="' + (p.gymDaysPerWeek || 5) + '"></div>' : '<input type="hidden" id="g-gym" value="' + (p.gymDaysPerWeek || 5) + '">') +
    (isPillarOn('networking') ? '<div class="form-group"><label>' + netP.icon + ' ' + escapeHtml(netP.label) + ' per week</label>' +
      '<input type="number" id="g-net" min="0" value="' + (p.weeklyNetworkGoal || 3) + '"></div>' : '<input type="hidden" id="g-net" value="' + (p.weeklyNetworkGoal || 0) + '">') +
    '</div>' +
    '<div class="form-row">' +
    (isPillarOn('money') ? '<div class="form-group"><label>' + moneyP.icon + ' Weekly ' + escapeHtml(moneyP.label) + ' goal ($)</label>' +
      '<input type="number" id="g-income" min="0" step="50" placeholder="e.g. 1200" value="' + (p.weeklyIncomeGoal || '') + '"></div>' : '<input type="hidden" id="g-income" value="' + (p.weeklyIncomeGoal || 0) + '">') +
    (isPillarOn('reading') ? '<div class="form-group"><label>' + readP.icon + ' ' + escapeHtml(readP.label) + ' pages per week</label>' +
      '<input type="number" id="g-read" min="0" step="10" placeholder="e.g. 100" value="' + (p.weeklyReadGoal || '') + '"></div>' : '<input type="hidden" id="g-read" value="' + (p.weeklyReadGoal || 0) + '">') +
    '</div>' +
    '<div class="form-group"><label>Your name (optional)</label>' +
    '<input type="text" id="g-name" placeholder="Your name" value="' + escapeHtml(p.name || '') + '"></div>' +
    '<div class="form-actions">' +
    '<button type="button" class="btn btn-outline" onclick="navigate(\'dashboard\')" style="margin-right:12px">Cancel</button>' +
    '<button type="submit" class="btn btn-primary btn-lg">💾 Save Goals</button>' +
    '</div></form></div>';
}

function showGoalSetup() { renderGoalSettings(); }

async function saveGoals(e) {
  e.preventDefault();
  state.data.profile.gymDaysPerWeek = parseInt(document.getElementById('g-gym').value) || 5;
  state.data.profile.weeklyNetworkGoal = parseInt(document.getElementById('g-net').value) || 0;
  state.data.profile.weeklyIncomeGoal = parseFloat(document.getElementById('g-income').value) || 0;
  const readEl = document.getElementById('g-read');
  if (readEl) state.data.profile.weeklyReadGoal = parseInt(readEl.value) || 0;
  state.data.profile.name = document.getElementById('g-name').value.trim();
  const ageEl = document.getElementById('g-age');     if (ageEl)   state.data.profile.age = parseInt(ageEl.value) || '';
  const emailEl = document.getElementById('g-email'); if (emailEl) state.data.profile.email = emailEl.value.trim();
  const phoneEl = document.getElementById('g-phone'); if (phoneEl) state.data.profile.phone = phoneEl.value.trim();
  const cadEl = document.getElementById('g-cadence'); if (cadEl) state.data.profile.incomeCadence = ['weekly', 'daily', 'monthly'].includes(cadEl.value) ? cadEl.value : 'monthly';
  const savEl = document.getElementById('g-savings'); if (savEl) state.data.profile.savingsGoal = parseFloat(savEl.value) || 0;
  await saveData();
  showToast('Saved! 🎯', 'success');
  navigate('dashboard');
}

// ─────────────────────────────────────────────────────────────
// API KEY
// ─────────────────────────────────────────────────────────────
async function saveApiKey() {
  const k = (document.getElementById('api-key-input')?.value || '').trim();
  if (!k) { showToast('Paste your API key first.', 'error'); return; }
  if (!k.startsWith('sk-ant-')) { showToast('Key should start with sk-ant-', 'error'); return; }
  try {
    const j = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: k }) }).then(r => r.json());
    if (j.success) { state.hasApiKey = true; showToast('AI Coach unlocked! ✅', 'success'); renderCoachPage(); }
  } catch { showToast('Could not save key.', 'error'); }
}

async function clearApiKey() {
  if (!confirm('Remove your API key?')) return;
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: '' }) });
  state.hasApiKey = false;
  showToast('Key removed.', 'success');
  renderCoachPage();
}

// ─────────────────────────────────────────────────────────────
// DEMO PREVIEW  (show someone the app full of sample data — never saved)
// ─────────────────────────────────────────────────────────────
function buildDemoData() {
  const days = [], today = new Date();
  for (let i = 20; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const date = d.toISOString().split('T')[0];
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    days.push({
      id: uid(), date,
      gym: { done: Math.random() > 0.28, muscleGroup: ['Push', 'Pull', 'Legs', 'Full body'][i % 4], duration: 45 + Math.round(Math.random() * 30), notes: '' },
      food: { rating: 3 + Math.round(Math.random() * 2), notes: '' },
      networking: { count: weekend ? 0 : Math.round(Math.random() * 3), notes: '' },
      money: { activities: weekend ? '' : 'Followed up with leads', income: 0 },
      spent: Math.round(15 + Math.random() * (weekend ? 120 : 70)),
      reading: { pages: Math.random() > 0.4 ? 10 + Math.round(Math.random() * 30) : 0, bookId: 'demo', bookTitle: 'Rich Dad Poor Dad', summary: '' },
      water: Math.round((0.25 + Math.random() * 0.75) * 4) / 4,
      calories: 2000 + Math.floor(Math.random() * 800), notes: ''
    });
  }
  const incomes = {};
  incomes[today.toISOString().slice(0, 7)] = 4200;
  const pm = new Date(today); pm.setMonth(pm.getMonth() - 1);
  incomes[pm.toISOString().slice(0, 7)] = 3900;
  const weights = []; for (let i = 21; i >= 0; i -= 3) { const d = new Date(today); d.setDate(d.getDate() - i); weights.push({ date: d.toISOString().split('T')[0], kg: 80 - (21 - i) * 0.04 }); }
  return {
    profile: { name: 'Alex', firstName: 'Alex', pillars: defaultPillars(), gymDaysPerWeek: 5, weeklyNetworkGoal: 3, weeklyReadGoal: 100, savingsGoal: 800, incomeCadence: 'monthly',
      nutrition: { age: 28, sex: 'male', heightCm: 180, weightKg: 80, heightUnit: 'ft', weightUnit: 'lbs', activity: 'active', goal: 'gain', strategy: 'muscle', mealsPerDay: 4 } },
    days, weeks: [], incomes, weights,
    books: [{ id: 'demo', title: 'Rich Dad Poor Dad', author: 'Robert Kiyosaki', status: 'reading' }],
    contacts: [{ id: uid(), name: 'Jordan Lee', status: 'lead', starred: true, notes: 'Met at the gym' }],
    ideas: [{ id: uid(), title: 'Weekend car-detailing side hustle', status: 'active', notes: '' }]
  };
}
async function startDemo() {
  state._previewMode = true;
  state.token = null;
  state.user = 'Demo';
  state.data = buildDemoData();
  try { const ks = await fetch('/api/settings').then(r => r.json()); state.hasApiKey = !!ks.hasKey; } catch { state.hasApiKey = false; }
  document.getElementById('auth-screen')?.remove();
  document.body.classList.remove('auth-active');
  applyNavVisibility();
  injectFAB();
  navigate('dashboard');
  if (!document.getElementById('preview-banner')) {
    const b = document.createElement('div');
    b.id = 'preview-banner';
    b.innerHTML = '👀 <strong>Demo preview</strong> — sample data, nothing is saved. ' +
      '<button onclick="exitDemo()">Create your account →</button>';
    document.body.appendChild(b);
  }
}
function exitDemo() { state._previewMode = false; location.reload(); }

// ─────────────────────────────────────────────────────────────
// QUICK-LOG FAB  (floating button on all pages)
// ─────────────────────────────────────────────────────────────
function injectFAB() {
  document.querySelector('.fab-btn')?.remove();
  const fab = document.createElement('button');
  fab.className = 'fab-btn';
  fab.innerHTML = '⚡';
  fab.title = 'Quick log today';
  fab.onclick = showQuickLog;
  document.body.appendChild(fab);
}

// Smart defaults from the last few weeks (most common food rating, avg water)
function recentDefaults() {
  const days = [...state.data.days].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 21);
  const ratings = days.map(d => d.food && d.food.rating).filter(r => r > 0);
  let food = 0;
  if (ratings.length) { const c = {}; ratings.forEach(r => { c[r] = (c[r] || 0) + 1; }); food = parseInt(Object.keys(c).sort((a, b) => c[b] - c[a])[0]); }
  const waters = days.map(d => d.water).filter(w => w > 0);
  const water = waters.length ? Math.round((waters.reduce((a, b) => a + b, 0) / waters.length) * 4) / 4 : 0;
  return { food, water, hasAny: ratings.length > 0 || waters.length > 0 };
}

function showQuickLog() {
  document.getElementById('quick-log-overlay')?.remove();
  const today = todayStr();
  const existing = state.data.days.find(d => d.date === today);
  const streak = getGymStreak();

  const gymP = pillar('gym'), foodP = pillar('food'), netP = pillar('networking'), moneyP = pillar('money'), readP = pillar('reading');
  const gymIsDefault = gymP.label === 'Gym';

  // Pre-fill from recent history ONLY for a fresh day (so editing keeps real values)
  const dflt = existing ? null : recentDefaults();
  const foodSel = (existing && existing.food && existing.food.rating) || (dflt && dflt.food) || 0;
  const waterVal = (existing && existing.water) || (dflt && dflt.water) || '';
  const existingWeight = (state.data.weights || []).find(w => w.date === today);
  const weighVal = existingWeight ? Math.round(kgToDisplay(existingWeight.kg) * 10) / 10 : '';
  const smartFilled = dflt && dflt.hasAny;
  window._qlFood = foodSel || undefined;

  const overlay = document.createElement('div');
  overlay.id = 'quick-log-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box quick-log-box">' +
    '<div class="modal-badge">⚡ Quick Log — Today, ' + new Date().toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'}) + '</div>' +
    (streak > 1 ? '<div class="ql-streak">🔥 ' + streak + '-day streak — keep it going!</div>' : '') +
    renderPrevNoteBanner() +
    (smartFilled ? '<div class="ql-smart">✨ Smart-filled from your recent days — tweak anything, then Save.</div>' : '') +

    (isPillarOn('gym') ?
    '<div class="ql-section">' +
    '<div class="ql-label">' + gymP.icon + ' ' + escapeHtml(gymP.label) + ' today?</div>' +
    '<div class="ql-gym-row">' +
    '<button type="button" class="ql-gym-btn' + (existing?.gym?.done===true?' ql-active-yes':'') + '" id="ql-gym-yes" onclick="qlSetGym(true)">' + (gymIsDefault ? '✅ Yes, I worked out' : '✅ Yes, did it') + '</button>' +
    '<button type="button" class="ql-gym-btn' + (existing?.gym?.done===false?' ql-active-no':'') + '" id="ql-gym-no"  onclick="qlSetGym(false)">' + (gymIsDefault ? '😴 Rest day' : '⛔ Not today') + '</button>' +
    '</div></div>' : '') +

    (isPillarOn('food') ?
    '<div class="ql-section">' +
    '<div class="ql-label">' + foodP.icon + ' ' + escapeHtml(foodP.label) + ' — rate today (1–5)</div>' +
    '<div class="ql-rating-row">' +
    [1,2,3,4,5].map(n => '<button type="button" class="ql-r-btn' + (foodSel===n?' ql-r-sel':'') + '" data-r="' + n + '" onclick="qlSetFood(' + n + ')">' + n + '</button>').join('') +
    '</div></div>' : '') +

    (isPillarOn('networking') ?
    '<div class="ql-section">' +
    '<div class="ql-label">' + netP.icon + ' ' + escapeHtml(netP.label) + ' — how many today</div>' +
    '<input type="number" id="ql-net" class="ql-input" min="0" placeholder="0" value="' + (existing?.networking?.count||'') + '">' +
    '</div>' : '') +

    (isPillarOn('reading') ?
    '<div class="ql-section">' +
    '<div class="ql-label">' + readP.icon + ' ' + escapeHtml(readP.label) + ' — pages today</div>' +
    '<input type="number" id="ql-read" class="ql-input" min="0" placeholder="0" value="' + (existing?.reading?.pages||'') + '">' +
    '</div>' : '') +

    (isPillarOn('money') ?
    '<div class="ql-section">' +
    '<div class="ql-label">💸 Spent today — $</div>' +
    '<input type="number" id="ql-spent" class="ql-input" min="0" step="0.01" placeholder="0" value="' + ((existing && existing.spent) || '') + '">' +
    '</div>' : '') +

    '<div class="ql-section">' +
    '<div class="ql-label">💧 Water — gallons today</div>' +
    '<input type="number" id="ql-water" class="ql-input" min="0" step="0.25" placeholder="e.g. 0.5" value="' + waterVal + '">' +
    '</div>' +

    (getNutrition() ?
    '<div class="ql-section">' +
    '<div class="ql-label">🍽️ Calories eaten today <span style="font-weight:400;color:var(--text-muted)">(target ' + getNutrition().calories.toLocaleString() + ')</span></div>' +
    '<input type="number" id="ql-calories" class="ql-input" min="0" step="10" placeholder="e.g. 2200" value="' + (existing?.calories || '') + '">' +
    '</div>' : '') +

    '<div class="ql-section">' +
    '<div class="ql-label">⚖️ Weigh-in <span style="font-weight:400;color:var(--text-muted)">(' + weightUnitPref() + ', optional)</span></div>' +
    '<input type="number" id="ql-weigh" class="ql-input" min="0" step="0.1" placeholder="' + (weightUnitPref()==='lbs'?'170':'77') + '" value="' + weighVal + '">' +
    '</div>' +

    '<div class="ql-actions">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'quick-log-overlay\').remove()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="submitQuickLog()">💾 Save Log</button>' +
    '</div></div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function qlSetGym(val) {
  document.getElementById('ql-gym-yes')?.classList.toggle('ql-active-yes', val === true);
  document.getElementById('ql-gym-no')?.classList.toggle('ql-active-no', val === false);
  document.getElementById('ql-gym-yes').dataset.val = val ? '1' : '';
  document.getElementById('ql-gym-no').dataset.val = val ? '' : '1';
  window._qlGym = val;
}

function qlSetFood(n) {
  document.querySelectorAll('.ql-r-btn').forEach(b => b.classList.toggle('ql-r-sel', parseInt(b.dataset.r) === n));
  window._qlFood = n;
}

async function submitQuickLog() {
  const today = todayStr();
  const gymDone = window._qlGym;
  const foodRating = window._qlFood || parseInt(document.querySelector('.ql-r-btn.ql-r-sel')?.dataset.r) || 0;
  const netCount = parseInt(document.getElementById('ql-net')?.value) || 0;
  const spentEl = document.getElementById('ql-spent');
  const waterEl = document.getElementById('ql-water');

  const existing = state.data.days.find(d => d.date === today);
  const entry = {
    id: existing?.id || uid(), date: today,
    gym: { done: gymDone === true, muscleGroup: existing?.gym?.muscleGroup || '', duration: existing?.gym?.duration || 0, notes: existing?.gym?.notes || '' },
    food: { rating: foodRating, notes: existing?.food?.notes || '' },
    networking: { count: netCount, notes: existing?.networking?.notes || '' },
    money: { activities: existing?.money?.activities || '', income: existing?.money?.income || 0 },
    spent: spentEl ? (parseFloat(spentEl.value) || 0) : (existing?.spent || 0),
    reading: (() => {
      const base = existing?.reading || { pages: 0, bookId: '', bookTitle: '', summary: '' };
      const readEl = document.getElementById('ql-read');
      if (!readEl) return base;
      const ab = (state.data.books || []).find(b => b.status === 'reading');
      return { pages: parseInt(readEl.value) || 0, bookId: base.bookId || ab?.id || '', bookTitle: base.bookTitle || ab?.title || '', summary: base.summary || '' };
    })(),
    water: waterEl ? (parseFloat(waterEl.value) || 0) : (existing?.water || 0),
    calories: document.getElementById('ql-calories') ? (parseFloat(document.getElementById('ql-calories').value) || 0) : (existing?.calories || 0),
    foodLog: existing?.foodLog || [],
    eaten: existing?.eaten || null,
    notes: existing?.notes || ''
  };

  if (existing) {
    const idx = state.data.days.indexOf(existing);
    state.data.days[idx] = entry;
  } else {
    state.data.days.push(entry);
  }

  // Weigh-in from the quick log
  const weighEl = document.getElementById('ql-weigh');
  if (weighEl) {
    const wv = parseFloat(weighEl.value) || 0;
    if (wv > 0) {
      const kg = Math.round(displayToKg(wv) * 10) / 10;
      upsertWeight(today, kg);
      if (state.data.profile.nutrition && state.data.profile.nutrition.heightCm) state.data.profile.nutrition.weightKg = kg;
    }
  }

  await saveData();
  document.getElementById('quick-log-overlay')?.remove();
  window._qlGym = undefined; window._qlFood = undefined;

  // Check streak milestone
  if (entry.gym.done) {
    const newStreak = getGymStreak();
    if ([3,7,14,21,30].includes(newStreak)) setTimeout(() => showStreakCelebration(newStreak), 400);
  }

  showToast('Logged! ⚡', 'success');
  if (state.page === 'dashboard') renderDashboard();
}

// ─────────────────────────────────────────────────────────────
// CALENDAR VIEW  (inside History page)
// ─────────────────────────────────────────────────────────────
function renderHistoryCalendar() {
  const now = new Date();
  const year  = state._calYear  ?? now.getFullYear();
  const month = state._calMonth ?? now.getMonth();

  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const startDow = first.getDay(); // 0=Sun
  const offset = startDow === 0 ? 6 : startDow - 1; // Mon-first
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div class="cal-cell cal-empty"></div>';

  for (let d = 1; d <= last.getDate(); d++) {
    const ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const day = state.data.days.find(x => x.date === ds);
    const isToday = ds === todayStr();
    const isFuture = ds > todayStr();

    let dots = '';
    if (day) {
      if (day.gym?.done)              dots += '<span class="cdot cdot-gym"></span>';
      if (day.food?.rating >= 4)      dots += '<span class="cdot cdot-food-hi"></span>';
      else if (day.food?.rating >= 1) dots += '<span class="cdot cdot-food-lo"></span>';
      if (day.networking?.count > 0)  dots += '<span class="cdot cdot-net"></span>';
      if (day.money?.activities)      dots += '<span class="cdot cdot-money"></span>';
    }

    cells +=
      '<div class="cal-cell' + (isToday?' cal-today':'') + (day?' cal-has-data':'') + (isFuture?' cal-future':'') + '"' +
      ' onclick="' + (isFuture ? '' : day ? 'showDayDetail(\'' + ds + '\')' : 'navigate(\'log\')') + '" title="' + ds + '">' +
      '<span class="cal-num">' + d + '</span>' +
      (dots ? '<div class="cal-dots">' + dots + '</div>' : '') +
      '</div>';
  }

  return '<div class="cal-wrap">' +
    '<div class="cal-nav">' +
    '<button class="btn-sm" onclick="shiftCal(-1)">← Prev</button>' +
    '<h3 class="cal-month">' + monthLabel + '</h3>' +
    '<button class="btn-sm" onclick="shiftCal(1)">Next →</button>' +
    '</div>' +
    '<div class="cal-grid">' +
    '<div class="cal-dh">Mon</div><div class="cal-dh">Tue</div><div class="cal-dh">Wed</div>' +
    '<div class="cal-dh">Thu</div><div class="cal-dh">Fri</div><div class="cal-dh">Sat</div><div class="cal-dh">Sun</div>' +
    cells + '</div>' +
    '<div class="cal-legend">' +
    '<span class="cdot cdot-gym"></span> Gym &nbsp;' +
    '<span class="cdot cdot-food-hi"></span> Food 4+ &nbsp;' +
    '<span class="cdot cdot-food-lo"></span> Food 1-3 &nbsp;' +
    '<span class="cdot cdot-net"></span> Networking &nbsp;' +
    '<span class="cdot cdot-money"></span> Money' +
    '</div></div>';
}

function shiftCal(dir) {
  const now = new Date();
  const y = state._calYear  ?? now.getFullYear();
  const m = state._calMonth ?? now.getMonth();
  const d = new Date(y, m + dir, 1);
  state._calYear = d.getFullYear();
  state._calMonth = d.getMonth();
  document.getElementById('cal-container').innerHTML = renderHistoryCalendar();
}

// ─────────────────────────────────────────────────────────────
// READING PAGE
// ─────────────────────────────────────────────────────────────
function renderReadingPage() {
  const books      = state.data.books || [];
  const activeBook = books.find(b => b.status === 'reading');
  const finished   = books.filter(b => b.status === 'finished');

  const readingDays = state.data.days.filter(d => d.reading?.pages > 0);
  const totalPages  = readingDays.reduce((s, d) => s + (d.reading?.pages || 0), 0);
  const avgPages    = readingDays.length ? Math.round(totalPages / readingDays.length) : 0;
  const streak      = getReadingStreak();

  const bookPagesRead = activeBook
    ? state.data.days.filter(d => d.reading?.bookId === activeBook.id).reduce((s, d) => s + (d.reading?.pages || 0), 0)
    : 0;
  const bookPct = (activeBook?.totalPages && activeBook.totalPages > 0)
    ? Math.min(100, Math.round((bookPagesRead / activeBook.totalPages) * 100))
    : null;

  const recentLogs = [...state.data.days]
    .filter(d => d.reading?.pages > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 15);

  const statsBar = readingDays.length > 0
    ? '<div class="reading-stats">' +
      '<div class="rs-item"><span>📖 Total Pages</span><strong>' + totalPages.toLocaleString() + '</strong></div>' +
      '<div class="rs-item"><span>📅 Days Read</span><strong>' + readingDays.length + '</strong></div>' +
      '<div class="rs-item"><span>📊 Avg / Day</span><strong>' + avgPages + ' pages</strong></div>' +
      '<div class="rs-item"><span>🔥 Streak</span><strong>' + (streak > 0 ? streak + ' days' : '—') + '</strong></div>' +
      '</div>'
    : '';

  const bookCard = activeBook
    ? '<div class="card reading-book-card">' +
      '<div class="rbc-header">' +
      '<div class="rbc-icon">📚</div>' +
      '<div class="rbc-info">' +
      '<div class="rbc-label">Currently Reading</div>' +
      '<div class="rbc-title">' + escapeHtml(activeBook.title) + '</div>' +
      (activeBook.author ? '<div class="rbc-author">by ' + escapeHtml(activeBook.author) + '</div>' : '') +
      '</div>' +
      '<div class="rbc-actions">' +
      '<button class="btn-sm" onclick="showAddBookModal(true)">✏️ Change Book</button>' +
      '<button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="finishBook(\'' + activeBook.id + '\')">✅ I Finished It!</button>' +
      '</div></div>' +
      '<div class="rbc-progress">' +
      '<div class="rbc-progress-top">' +
      '<span>' + bookPagesRead.toLocaleString() + ' pages read' + (activeBook.totalPages ? ' of ' + activeBook.totalPages.toLocaleString() : '') + '</span>' +
      (bookPct !== null ? '<span style="font-weight:800;color:var(--read-color);font-size:15px">' + bookPct + '%</span>' : '') +
      '</div>' +
      (bookPct !== null ? '<div class="rbc-bar-track"><div class="rbc-bar-fill" style="width:' + bookPct + '%"></div></div>' : '') +
      '</div></div>'
    : '<div class="card reading-start-card">' +
      '<div class="rsc-icon">📚</div>' +
      '<h3>What are you reading?</h3>' +
      '<p>Set your current book to track pages, build a reading streak, and get AI insights on your reading habit.</p>' +
      '<button class="btn btn-primary" onclick="showAddBookModal(false)">📖 Set My Current Book</button>' +
      '</div>';

  const historyCard = recentLogs.length > 0
    ? '<div class="card">' +
      '<h3 class="card-title">📋 Reading Log</h3>' +
      '<table class="table">' +
      '<thead><tr><th>Date</th><th>Book</th><th>Pages</th><th>Summary</th></tr></thead><tbody>' +
      recentLogs.map(d =>
        '<tr>' +
        '<td><strong>' + fmtDate(d.date) + '</strong></td>' +
        '<td style="font-size:12px;color:var(--text-muted);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(d.reading.bookTitle || '') + '</td>' +
        '<td><span class="pill pill-read">+' + d.reading.pages + ' pg</span></td>' +
        '<td style="font-size:13px;color:var(--text-muted);max-width:320px">' + escapeHtml((d.reading.summary || '').slice(0, 90)) + (d.reading.summary?.length > 90 ? '…' : '') + '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table></div>'
    : '';

  const finishedCard = finished.length > 0
    ? '<div class="card">' +
      '<h3 class="card-title">🏆 Books Finished (' + finished.length + ')</h3>' +
      '<div class="finished-books-grid">' +
      finished.map(b =>
        '<div class="finished-book">' +
        '<span class="fb-icon">📗</span>' +
        '<div><div class="fb-title">' + escapeHtml(b.title) + '</div>' +
        (b.author ? '<div class="fb-date" style="color:var(--text-muted);font-size:12px">' + escapeHtml(b.author) + '</div>' : '') +
        (b.finishedDate ? '<div class="fb-date">✅ ' + fmtDate(b.finishedDate) + '</div>' : '') +
        '</div></div>'
      ).join('') +
      '</div></div>'
    : '';

  document.getElementById('main').innerHTML =
    '<div class="page-header">' +
    '<h2 class="page-title">Reading</h2>' +
    '<p class="page-sub">Track your books, build a daily reading habit, and retain what you learn</p>' +
    '</div>' +
    statsBar + bookCard + historyCard + finishedCard;
}

function showAddBookModal(isChanging) {
  document.getElementById('add-book-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'add-book-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box" style="max-width:400px;text-align:left">' +
    '<div class="modal-badge">📚 ' + (isChanging ? 'Change Book' : 'Start Reading') + '</div>' +
    '<p style="font-size:14px;color:var(--text-muted);margin-bottom:20px">' + (isChanging ? 'What are you reading now?' : 'What book are you starting?') + '</p>' +
    '<div class="form-group"><label>Book Title <span style="color:var(--danger)">*</span></label>' +
    '<input type="text" id="book-title-input" placeholder="e.g. Rich Dad Poor Dad" autocomplete="off"></div>' +
    '<div class="form-group"><label>Author <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>' +
    '<input type="text" id="book-author-input" placeholder="e.g. Robert Kiyosaki"></div>' +
    '<div class="form-group"><label>Total Pages <span style="font-weight:400;color:var(--text-muted)">(optional — tracks your % progress)</span></label>' +
    '<input type="number" id="book-pages-total-input" min="1" placeholder="e.g. 336"></div>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'add-book-modal\').remove()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveBook()">📚 Start Reading</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => document.getElementById('book-title-input')?.focus(), 50);
}

async function saveBook() {
  const title = document.getElementById('book-title-input')?.value.trim();
  if (!title) { showToast('Enter a book title first.', 'error'); return; }
  const author     = document.getElementById('book-author-input')?.value.trim() || '';
  const totalPages = parseInt(document.getElementById('book-pages-total-input')?.value) || 0;
  if (!state.data.books) state.data.books = [];
  // Pause any existing reading book
  state.data.books.forEach(b => { if (b.status === 'reading') b.status = 'paused'; });
  state.data.books.push({ id: uid(), title, author, totalPages, startDate: todayStr(), status: 'reading', finishedDate: null });
  await saveData();
  document.getElementById('add-book-modal')?.remove();
  showToast('📚 Now reading: ' + title, 'success');
  renderReadingPage();
}

async function finishBook(id) {
  const book = (state.data.books || []).find(b => b.id === id);
  if (!book) return;
  if (!confirm('Mark "' + book.title + '" as finished? 🎉\n\n+50 XP bonus!')) return;
  book.status = 'finished';
  book.finishedDate = todayStr();
  await saveData();
  showToast('🎉 Finished: ' + book.title + '! +50 XP!', 'success');
  showStreakCelebration(0); // re-use celebration UI
  showAddBookModal(false);
}

// ─────────────────────────────────────────────────────────────
// DAY DETAIL POPUP  (from calendar)
// ─────────────────────────────────────────────────────────────
function showDayDetail(dateStr) {
  const day = state.data.days.find(d => d.date === dateStr);
  if (!day) { navigate('log'); return; }
  document.getElementById('day-detail-modal')?.remove();

  const gymLabel = day.gym?.done
    ? (day.gym.muscleGroup ? day.gym.muscleGroup.charAt(0).toUpperCase() + day.gym.muscleGroup.slice(1) : 'Done ✓') + (day.gym.duration ? ' · ' + day.gym.duration + 'm' : '')
    : 'Not done';
  const foodLabel = day.food?.rating
    ? '★'.repeat(day.food.rating) + '☆'.repeat(5 - day.food.rating) + ' ' + day.food.rating + '/5'
    : 'Not logged';
  const netLabel  = day.networking?.count ? '+' + day.networking.count : 'None logged';
  const moneyLabel = day.money?.activities || 'Nothing logged';
  const readLabel = day.reading?.pages ? day.reading.pages + ' pages' : 'No reading';
  const waterLabel = day.water > 0 ? day.water + ' gal' : 'Not logged';
  const nutTarget = getNutrition();
  const calLabel = day.calories > 0
    ? day.calories.toLocaleString() + ' cal' + (nutTarget ? ' / ' + nutTarget.calories.toLocaleString() : '') + (day.eaten ? ' · ' + day.eaten.protein + 'g protein' : '')
    : 'Not logged';
  const foodsNote = (day.foodLog && day.foodLog.length)
    ? day.foodLog.map(x => x.name + ' (' + x.grams + 'g)').join(', ')
    : '';

  function ddItem(id, label, notes, isDone) {
    if (!isPillarOn(id)) return '';
    const pc = pillar(id);
    return '<div class="dd-item ' + pc.cls + (isDone ? ' dd-done' : '') + '">' +
      '<span class="dd-icon">' + pc.icon + '</span><div>' +
      '<div class="dd-label" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">' + escapeHtml(pc.label) + '</div>' +
      '<div class="dd-label">' + escapeHtml(label) + '</div>' +
      (notes ? '<div class="dd-notes">' + escapeHtml(notes) + '</div>' : '') +
      '</div></div>';
  }

  const modal = document.createElement('div');
  modal.id = 'day-detail-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box day-detail-box">' +
    '<div class="modal-badge">📋 ' + fmtDate(dateStr) + '</div>' +
    '<div class="dd-grid">' +
    ddItem('gym',        gymLabel,   day.gym?.notes,        day.gym?.done) +
    ddItem('food',       foodLabel,  day.food?.notes,       day.food?.rating >= 4) +
    ddItem('networking', netLabel,   day.networking?.notes, day.networking?.count > 0) +
    ddItem('money',      moneyLabel, (day.spent > 0 ? formatCurrency(day.spent) + ' spent' : '') + (day.money?.activities ? (day.spent > 0 ? ' · ' : '') + day.money.activities : ''), day.spent > 0 || !!day.money?.activities) +
    ddItem('reading',    readLabel,  day.reading?.summary,  day.reading?.pages > 0) +
    '<div class="dd-item water' + (day.water > 0 ? ' dd-done' : '') + '">' +
    '<span class="dd-icon">💧</span><div>' +
    '<div class="dd-label" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Water</div>' +
    '<div class="dd-label">' + waterLabel + '</div></div></div>' +
    '<div class="dd-item food' + (day.calories > 0 ? ' dd-done' : '') + '">' +
    '<span class="dd-icon">🍽️</span><div>' +
    '<div class="dd-label" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Calories eaten</div>' +
    '<div class="dd-label">' + calLabel + '</div>' +
    (foodsNote ? '<div class="dd-notes">' + escapeHtml(foodsNote) + '</div>' : '') +
    '</div></div>' +
    '</div>' +
    (day.notes ? '<div class="dd-global-notes">📝 ' + escapeHtml(day.notes) + '</div>' : '') +
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'day-detail-modal\').remove()">Close</button>' +
    '<button class="btn btn-primary" onclick="editDay(\'' + day.id + '\');document.getElementById(\'day-detail-modal\').remove()">✏️ Edit</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ─────────────────────────────────────────────────────────────
// CUSTOMIZE PILLARS
// ─────────────────────────────────────────────────────────────
function pillarCustomizerCard() {
  const presetBtns = Object.entries(PILLAR_PRESETS).map(([key, pre]) =>
    '<button type="button" class="preset-btn" onclick="applyPreset(\'' + key + '\')">' +
    '<span class="preset-name">' + pre.name + '</span>' +
    '<span class="preset-desc">' + pre.desc + '</span></button>'
  ).join('');

  const rows = PILLAR_IDS.map(id => {
    const pc = pillar(id);
    const meta = PILLAR_META[id];
    return '<div class="pc-row' + (pc.enabled ? '' : ' pc-off') + '" data-id="' + id + '">' +
      '<label class="pc-toggle"><input type="checkbox" ' + (pc.enabled ? 'checked' : '') + ' onchange="togglePillarRow(\'' + id + '\', this.checked)"><span class="pc-slider"></span></label>' +
      '<input type="text" class="pc-icon-input" id="pc-icon-' + id + '" value="' + escapeHtml(pc.icon) + '" maxlength="2" title="Emoji / icon">' +
      '<input type="text" class="pc-label-input" id="pc-label-' + id + '" value="' + escapeHtml(pc.label) + '" placeholder="Name">' +
      '<span class="pc-type">' + meta.measures + '</span>' +
      '</div>';
  }).join('');

  return '<div class="card">' +
    '<h3 class="card-title">🧩 Customize Your Pillars</h3>' +
    '<p class="card-sub">Track what matters to <em>you</em>. Pick a starting point below, then rename, re-icon, or switch off any pillar. Each slot measures a fixed kind of input (shown on the right) — so you can make it about anything.</p>' +
    '<div class="preset-grid">' + presetBtns + '</div>' +
    '<div class="pc-list-head"><span>On</span><span>Icon</span><span>Name</span><span>What it measures</span></div>' +
    '<div class="pc-list">' + rows + '</div>' +
    '<button type="button" class="btn btn-primary" style="margin-top:8px" onclick="savePillars()">💾 Save Pillars</button>' +
    '</div>';
}

function togglePillarRow(id, on) {
  const row = document.querySelector('.pc-row[data-id="' + id + '"]');
  if (row) row.classList.toggle('pc-off', !on);
}

async function applyPreset(key) {
  const pre = PILLAR_PRESETS[key];
  if (!pre) return;
  if (pre.pillars) state.data.profile.pillars = JSON.parse(JSON.stringify(pre.pillars));
  else if (!state.data.profile.pillars) state.data.profile.pillars = defaultPillars();
  state.data.profile.onboarded = true;
  await saveData();
  applyNavVisibility();
  showToast(pre.name + ' applied!', 'success');
  renderSettingsPage();
}

async function savePillars() {
  const pillars = {};
  PILLAR_IDS.forEach(id => {
    const enabled = document.querySelector('.pc-row[data-id="' + id + '"] input[type=checkbox]')?.checked !== false;
    const icon  = document.getElementById('pc-icon-' + id)?.value.trim()  || PILLAR_META[id].defaultIcon;
    const label = document.getElementById('pc-label-' + id)?.value.trim() || PILLAR_META[id].defaultLabel;
    pillars[id] = { enabled, icon, label };
  });
  if (!Object.values(pillars).some(p => p.enabled)) { showToast('Keep at least one pillar on.', 'error'); return; }
  state.data.profile.pillars = pillars;
  state.data.profile.onboarded = true;
  await saveData();
  applyNavVisibility();
  showToast('Pillars saved! 🧩', 'success');
  renderSettingsPage();
}

// ─────────────────────────────────────────────────────────────
// FIRST-RUN ONBOARDING WIZARD
//   Step 1: about you (name, age, sex)
//   Step 2: pick the development areas you want to work on
//   Step 3: tailored goals + nutrition details (if you chose Nutrition)
// ─────────────────────────────────────────────────────────────
const ONBOARD_AREAS = [
  { id: 'gym',        icon: '💪', label: 'Fitness',          desc: 'Workouts & training consistency' },
  { id: 'food',       icon: '🥗', label: 'Nutrition & Diet', desc: 'Food quality, calories & macros' },
  { id: 'networking', icon: '🤝', label: 'Networking',       desc: 'Meeting people & building connections' },
  { id: 'money',      icon: '💰', label: 'Income',           desc: 'Earnings & money-making activity' },
  { id: 'reading',    icon: '📚', label: 'Reading',          desc: 'Daily reading habit & learning' }
];

function showOnboarding() {
  const p = state.data.profile || {};
  state._onboard = {
    step: 1,
    firstName: p.firstName || '', lastName: p.lastName || '', age: p.age || '', sex: p.sex || 'male',
    email: p.email || '', phone: p.phone || '',
    areas: { gym: true, food: true, networking: true, money: true, reading: true },
    goals: { gymDaysPerWeek: p.gymDaysPerWeek || 5, weeklyNetworkGoal: p.weeklyNetworkGoal || 3, weeklyIncomeGoal: p.weeklyIncomeGoal || '', weeklyReadGoal: p.weeklyReadGoal || '' },
    jobTitle: p.jobTitle || '',
    cadence: p.incomeCadence || 'monthly',
    nut: { heightUnit: 'cm', weightUnit: 'lbs', heightCm: '', weightKg: '', activity: 'moderate', goal: 'gain', mealsPerDay: 3, strategy: 'muscle' }
  };
  renderOnboardStep();
}

function renderOnboardStep() {
  const f = state._onboard;
  document.getElementById('onboarding-modal')?.remove();
  let title = '', sub = '', body = '';

  if (f.step === 1) {
    title = 'Welcome! Let\'s set you up';
    sub = 'A few quick details so we can tailor everything to you.';
    body =
      '<div class="form-row">' +
      '<div class="form-group"><label>First name</label><input type="text" id="ob-first" value="' + escapeHtml(f.firstName) + '" placeholder="Alex"></div>' +
      '<div class="form-group"><label>Last name <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label><input type="text" id="ob-last" value="' + escapeHtml(f.lastName) + '" placeholder="Smith"></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="form-group"><label>Age</label><input type="number" id="ob-age" min="13" max="100" value="' + (f.age || '') + '" placeholder="28"></div>' +
      '<div class="form-group"><label>Sex <span style="font-weight:400;color:var(--text-muted)">(for nutrition math)</span></label>' +
      '<select id="ob-sex"><option value="male"' + (f.sex === 'male' ? ' selected' : '') + '>Male</option><option value="female"' + (f.sex === 'female' ? ' selected' : '') + '>Female</option></select></div>' +
      '</div>';
  } else if (f.step === 2) {
    title = 'What do you want to develop?';
    sub = 'Pick the areas you want to work on — you can change these anytime in Settings.';
    body = '<div class="ob-area-grid">' + ONBOARD_AREAS.map(a => {
      const on = f.areas[a.id];
      return '<button type="button" class="ob-area' + (on ? ' ob-area-on' : '') + '" onclick="onboardToggleArea(\'' + a.id + '\')">' +
        '<span class="ob-area-check">' + (on ? '✓' : '') + '</span>' +
        '<span class="ob-area-icon">' + a.icon + '</span>' +
        '<span class="ob-area-label">' + a.label + '</span>' +
        '<span class="ob-area-desc">' + a.desc + '</span>' +
        '</button>';
    }).join('') + '</div>';
  } else {
    title = 'Set your goals';
    sub = 'Targets for what you chose — leave any blank if you\'re not sure yet.';
    const parts = [];
    if (f.areas.gym) parts.push('<div class="form-group"><label>💪 Fitness — gym days per week</label><input type="number" id="ob-gym" min="1" max="7" value="' + (f.goals.gymDaysPerWeek || 5) + '"></div>');
    if (f.areas.networking) parts.push('<div class="form-group"><label>🤝 Networking — new connections per week</label><input type="number" id="ob-net" min="0" value="' + (f.goals.weeklyNetworkGoal || 3) + '"></div>');
    if (f.areas.money) parts.push(
      '<div class="form-group"><label>💰 How do you get paid?</label>' +
      '<select id="ob-cadence">' +
      '<option value="monthly"' + (f.cadence === 'monthly' ? ' selected' : '') + '>Monthly</option>' +
      '<option value="weekly"' + (f.cadence === 'weekly' ? ' selected' : '') + '>Weekly</option>' +
      '<option value="daily"' + (f.cadence === 'daily' ? ' selected' : '') + '>Daily</option>' +
      '</select>' +
      '<span style="font-size:12px;color:var(--text-muted);display:block;margin-top:5px">We\'ll ask your income on that schedule — and you\'ll log spending every day.</span></div>' +
      '<div class="form-row">' +
      '<div class="form-group"><label>💰 Income goal ($) <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label><input type="number" id="ob-income" min="0" step="50" placeholder="e.g. 1200" value="' + (f.goals.weeklyIncomeGoal || '') + '"></div>' +
      '<div class="form-group"><label>Your job / role <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label><input type="text" id="ob-job" placeholder="e.g. Sales Rep" value="' + escapeHtml(f.jobTitle) + '"></div>' +
      '</div>');
    if (f.areas.reading) parts.push('<div class="form-group"><label>📚 Reading — pages per week</label><input type="number" id="ob-read" min="0" step="10" placeholder="e.g. 100" value="' + (f.goals.weeklyReadGoal || '') + '"></div>');
    if (f.areas.food) {
      const n = f.nut;
      const ftTotal = n.heightCm ? n.heightCm / IN_TO_CM : 0;
      const ftVal = (n.heightUnit === 'ft' && ftTotal) ? Math.floor(ftTotal / 12) : '';
      const inVal = (n.heightUnit === 'ft' && ftTotal) ? Math.round(ftTotal % 12) : '';
      const cmVal = (n.heightUnit === 'cm' && n.heightCm) ? Math.round(n.heightCm) : '';
      const wVal = n.weightKg ? (n.weightUnit === 'lbs' ? Math.round(n.weightKg / LBS_TO_KG) : Math.round(n.weightKg)) : '';
      parts.push(
        '<div class="onboard-nut"><div class="onboard-section-label">🥗 Nutrition details <span style="font-weight:400;color:var(--text-muted)">(for your calorie & macro targets — optional)</span></div>' +
        '<div class="form-row">' +
        '<div class="form-group"><label>Height</label><div class="nut-unit-row">' +
        '<select id="ob-hunit" onchange="obToggleHeightUnit()" style="max-width:92px"><option value="cm"' + (n.heightUnit === 'cm' ? ' selected' : '') + '>cm</option><option value="ft"' + (n.heightUnit === 'ft' ? ' selected' : '') + '>ft/in</option></select>' +
        '<div id="ob-h-cm" style="flex:1;' + (n.heightUnit === 'cm' ? '' : 'display:none') + '"><input type="number" id="ob-hcm" placeholder="175" value="' + cmVal + '"></div>' +
        '<div id="ob-h-ft" style="gap:6px;flex:1;' + (n.heightUnit === 'ft' ? 'display:flex' : 'display:none') + '"><input type="number" id="ob-hft" placeholder="5 (ft)" value="' + ftVal + '"><input type="number" id="ob-hin" placeholder="9 (in)" value="' + inVal + '"></div>' +
        '</div></div>' +
        '<div class="form-group"><label>Weight</label><div class="nut-unit-row"><input type="number" id="ob-weight" placeholder="170" value="' + wVal + '" style="flex:1"><select id="ob-wunit" style="max-width:80px"><option value="lbs"' + (n.weightUnit === 'lbs' ? ' selected' : '') + '>lbs</option><option value="kg"' + (n.weightUnit === 'kg' ? ' selected' : '') + '>kg</option></select></div></div>' +
        '</div>' +
        '<div class="form-group"><label>Activity level</label><select id="ob-activity">' + Object.entries(ACTIVITY_FACTORS).map(([k, v]) => '<option value="' + k + '"' + (n.activity === k ? ' selected' : '') + '>' + v.label + '</option>').join('') + '</select></div>' +
        '<div class="form-row">' +
        '<div class="form-group"><label>Goal</label><select id="ob-ngoal">' + Object.entries(NUTRITION_GOALS).map(([k, v]) => '<option value="' + k + '"' + (n.goal === k ? ' selected' : '') + '>' + v.label + '</option>').join('') + '</select></div>' +
        '<div class="form-group"><label>Meals per day</label><select id="ob-meals">' + [3, 4, 5, 6].map(m => '<option value="' + m + '"' + (n.mealsPerDay === m ? ' selected' : '') + '>' + m + ' meals</option>').join('') + '</select></div>' +
        '</div></div>');
    }
    if (!parts.length) parts.push('<p style="color:var(--text-muted)">Nothing to configure — hit Finish and start logging!</p>');
    body = parts.join('');
  }

  const isLast = f.step === 3;
  const modal = document.createElement('div');
  modal.id = 'onboarding-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box onboard-wizard">' +
    '<div class="onboard-progress">' + [1, 2, 3].map(n => '<span class="ob-dot' + (n <= f.step ? ' ob-dot-on' : '') + '"></span>').join('') + '<span class="ob-step-label">Step ' + f.step + ' of 3</span></div>' +
    '<h2 class="onboard-title">' + title + '</h2>' +
    '<p class="onboard-sub">' + sub + '</p>' +
    '<div class="onboard-body">' + body + '</div>' +
    '<div class="onboard-actions">' +
    (f.step > 1 ? '<button type="button" class="btn btn-outline" onclick="onboardBack()">← Back</button>'
                : '<button type="button" class="btn btn-outline" onclick="skipOnboarding()">Skip setup</button>') +
    (isLast ? '<button type="button" class="btn btn-primary" onclick="onboardFinish()">🚀 Finish</button>'
            : '<button type="button" class="btn btn-primary" onclick="onboardNext()">Next →</button>') +
    '</div></div>';
  document.body.appendChild(modal);
  if (f.step === 1) setTimeout(() => document.getElementById('ob-first')?.focus(), 50);
}

function onboardToggleArea(id) {
  state._onboard.areas[id] = !state._onboard.areas[id];
  renderOnboardStep();
}

function obToggleHeightUnit() {
  const u = document.getElementById('ob-hunit').value;
  document.getElementById('ob-h-cm').style.display = u === 'cm' ? '' : 'none';
  document.getElementById('ob-h-ft').style.display = u === 'ft' ? 'flex' : 'none';
}

function captureOnboard() {
  const f = state._onboard;
  if (f.step === 1) {
    f.firstName = (document.getElementById('ob-first')?.value || '').trim();
    f.lastName = (document.getElementById('ob-last')?.value || '').trim();
    f.age = parseInt(document.getElementById('ob-age')?.value) || '';
    f.sex = document.getElementById('ob-sex')?.value || f.sex;
    // email & phone are now collected at signup (and seeded into the profile)
  } else if (f.step === 3) {
    if (document.getElementById('ob-gym'))    f.goals.gymDaysPerWeek = parseInt(document.getElementById('ob-gym').value) || 5;
    if (document.getElementById('ob-net'))    f.goals.weeklyNetworkGoal = parseInt(document.getElementById('ob-net').value) || 0;
    if (document.getElementById('ob-income')) f.goals.weeklyIncomeGoal = parseFloat(document.getElementById('ob-income').value) || '';
    if (document.getElementById('ob-cadence')) f.cadence = document.getElementById('ob-cadence').value || f.cadence;
    if (document.getElementById('ob-job'))    f.jobTitle = document.getElementById('ob-job').value.trim();
    if (document.getElementById('ob-read'))   f.goals.weeklyReadGoal = parseInt(document.getElementById('ob-read').value) || '';
    if (document.getElementById('ob-weight')) {
      const n = f.nut;
      n.heightUnit = document.getElementById('ob-hunit')?.value || 'cm';
      n.weightUnit = document.getElementById('ob-wunit')?.value || 'lbs';
      if (n.heightUnit === 'cm') n.heightCm = parseFloat(document.getElementById('ob-hcm')?.value) || '';
      else { const ft = parseFloat(document.getElementById('ob-hft')?.value) || 0; const inch = parseFloat(document.getElementById('ob-hin')?.value) || 0; n.heightCm = (ft || inch) ? (ft * 12 + inch) * IN_TO_CM : ''; }
      const w = parseFloat(document.getElementById('ob-weight')?.value) || 0;
      n.weightKg = w ? (n.weightUnit === 'lbs' ? w * LBS_TO_KG : w) : '';
      n.activity = document.getElementById('ob-activity')?.value || 'moderate';
      n.goal = document.getElementById('ob-ngoal')?.value || 'gain';
      n.mealsPerDay = parseInt(document.getElementById('ob-meals')?.value) || 3;
    }
  }
}

function onboardNext() {
  captureOnboard();
  const f = state._onboard;
  if (f.step === 1) {
    if (!f.firstName) { showToast('Please enter your first name.', 'error'); return; }
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { showToast('Enter a valid email (or leave it blank).', 'error'); return; }
    f.step = 2;
  } else if (f.step === 2) {
    if (!Object.values(f.areas).some(Boolean)) { showToast('Pick at least one area to work on.', 'error'); return; }
    f.step = 3;
  }
  renderOnboardStep();
}

function onboardBack() {
  captureOnboard();
  if (state._onboard.step > 1) state._onboard.step--;
  renderOnboardStep();
}

async function onboardFinish() {
  captureOnboard();
  const f = state._onboard;
  const p = state.data.profile;
  p.firstName = f.firstName;
  p.lastName = f.lastName;
  p.age = f.age || '';
  p.sex = f.sex;
  p.email = f.email || '';
  p.phone = f.phone || '';
  p.name = ((f.firstName || '') + ' ' + (f.lastName || '')).trim();
  if (!p.pillars) p.pillars = defaultPillars();
  PILLAR_IDS.forEach(id => { if (!p.pillars[id]) p.pillars[id] = {}; p.pillars[id].enabled = !!f.areas[id]; });
  p.gymDaysPerWeek = f.goals.gymDaysPerWeek || 5;
  p.weeklyNetworkGoal = f.goals.weeklyNetworkGoal || 0;
  p.weeklyIncomeGoal = f.goals.weeklyIncomeGoal || 0;
  if (f.areas.money) p.incomeCadence = ['weekly', 'daily', 'monthly'].includes(f.cadence) ? f.cadence : 'monthly';
  p.weeklyReadGoal = f.goals.weeklyReadGoal || 0;
  if (f.jobTitle) p.jobTitle = f.jobTitle;
  if (f.areas.food && f.nut.heightCm && f.nut.weightKg && f.age) {
    p.nutrition = {
      age: f.age, sex: f.sex,
      heightCm: Math.round(f.nut.heightCm * 10) / 10,
      weightKg: Math.round(f.nut.weightKg * 10) / 10,
      heightUnit: f.nut.heightUnit, weightUnit: f.nut.weightUnit,
      activity: f.nut.activity, goal: f.nut.goal, strategy: f.nut.strategy || 'muscle', mealsPerDay: f.nut.mealsPerDay || 3
    };
  }
  p.onboarded = true;
  state._onboard = null;
  await saveData();
  document.getElementById('onboarding-modal')?.remove();
  applyNavVisibility();
  renderXPBar();
  showToast('You\'re all set' + (p.firstName ? ', ' + p.firstName : '') + '! Let\'s get to work. 🚀', 'success');
  navigate('dashboard');
}

async function skipOnboarding() {
  state.data.profile.onboarded = true;
  state._onboard = null;
  await saveData();
  document.getElementById('onboarding-modal')?.remove();
  applyNavVisibility();
  navigate('dashboard');
}

// ─────────────────────────────────────────────────────────────
// NUTRITION UI
// ─────────────────────────────────────────────────────────────
function renderNutritionResults(nut) {
  if (!nut) return '<div class="nut-empty">Fill in the form above to see your daily calorie and macro targets.</div>';
  const g = NUTRITION_GOALS[nut.goal];
  const bar = '<div class="macro-bar">' +
    '<div class="macro-seg mp" style="width:' + nut.protein.pct + '%"></div>' +
    '<div class="macro-seg mc" style="width:' + nut.carbs.pct + '%"></div>' +
    '<div class="macro-seg mf" style="width:' + nut.fat.pct + '%"></div>' +
    '</div>';
  const macro = (cls, name, m) =>
    '<div class="macro-item ' + cls + '">' +
    '<div class="macro-g">' + m.g + 'g</div>' +
    '<div class="macro-name">' + name + '</div>' +
    '<div class="macro-meta">' + m.pct + '% · ' + m.cal + ' cal</div>' +
    '</div>';
  // Per-meal plan
  const m = nut.meals;
  const mealRows = m.labels.map(lbl =>
    '<div class="meal-row">' +
    '<div class="meal-name">' + lbl + '</div>' +
    '<div class="meal-cal">' + m.calories.toLocaleString() + ' cal</div>' +
    '<div class="meal-macros"><b class="mp">' + m.protein + 'g</b> · <b class="mc">' + m.carbs + 'g</b> · <b class="mf">' + m.fat + 'g</b></div>' +
    '</div>'
  ).join('');
  const mealPlan = '<div class="meal-plan">' +
    '<div class="meal-plan-head">🍽️ Split into ' + m.count + ' meals — about <strong>' + m.calories.toLocaleString() + ' cal</strong> each</div>' +
    '<div class="meal-list">' + mealRows + '</div>' +
    '<div class="meal-legend"><b class="mp">P</b> protein · <b class="mc">C</b> carbs · <b class="mf">F</b> fat &nbsp;(per meal)</div>' +
    '</div>';

  return '<div class="nutrition-results">' +
    '<div class="nut-cal-big"><span class="nut-cal-num">' + nut.calories.toLocaleString() + '</span><span class="nut-cal-unit">cal / day</span></div>' +
    '<div class="nut-cal-sub">' + g.label + ' · ' + g.sub + ' &nbsp;·&nbsp; BMR ' + nut.bmr.toLocaleString() + ' · maintenance ' + nut.tdee.toLocaleString() + '</div>' +
    bar +
    '<div class="macro-grid">' +
    macro('mp', 'Protein', nut.protein) +
    macro('mc', 'Carbs', nut.carbs) +
    macro('mf', 'Fat', nut.fat) +
    '</div>' +
    mealPlan +
    '<div class="nut-disclaimer">📐 Estimated with the Mifflin-St Jeor formula. Use it as a starting point and adjust to how your body responds.</div>' +
    '</div>';
}

function renderNutritionSettingsCard() {
  const n = state.data.profile.nutrition || {};
  const heightUnit = n.heightUnit || 'cm';
  const weightUnit = n.weightUnit || 'lbs';
  const cmVal = n.heightCm ? Math.round(n.heightCm) : '';
  const ftTotal = n.heightCm ? n.heightCm / IN_TO_CM : 0;
  const ftVal = ftTotal ? Math.floor(ftTotal / 12) : '';
  const inVal = ftTotal ? Math.round(ftTotal % 12) : '';
  const wVal = n.weightKg ? (weightUnit === 'lbs' ? Math.round(n.weightKg / LBS_TO_KG) : Math.round(n.weightKg)) : '';
  const sel = (v, opt) => v === opt ? ' selected' : '';

  return '<div class="card">' +
    '<h3 class="card-title">🍎 Nutrition & Calorie Targets</h3>' +
    '<p class="card-sub">Tell us a few things and we\'ll calculate how many calories you need each day — split into protein, carbs, and fat.</p>' +
    '<form id="nutrition-form" onsubmit="saveNutrition(event)">' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Age</label><input type="number" id="nut-age" min="13" max="100" placeholder="e.g. 28" value="' + (n.age || '') + '"></div>' +
    '<div class="form-group"><label>Sex <span style="font-weight:400;color:var(--text-muted)">(needed for the formula)</span></label>' +
    '<select id="nut-sex"><option value="male"' + sel(n.sex, 'male') + '>Male</option><option value="female"' + sel(n.sex, 'female') + '>Female</option></select></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Height</label>' +
    '<div class="nut-unit-row">' +
    '<select id="nut-height-unit" onchange="nutToggleHeightUnit()" style="max-width:104px">' +
    '<option value="cm"' + sel(heightUnit, 'cm') + '>cm</option><option value="ft"' + sel(heightUnit, 'ft') + '>ft / in</option></select>' +
    '<div id="nut-h-cm" style="flex:1;' + (heightUnit === 'cm' ? '' : 'display:none') + '"><input type="number" id="nut-height-cm" min="100" max="250" placeholder="175" value="' + cmVal + '"></div>' +
    '<div id="nut-h-ft" style="gap:8px;flex:1;' + (heightUnit === 'ft' ? 'display:flex' : 'display:none') + '">' +
    '<input type="number" id="nut-height-ft" min="3" max="8" placeholder="5 (ft)" value="' + ftVal + '">' +
    '<input type="number" id="nut-height-in" min="0" max="11" placeholder="9 (in)" value="' + inVal + '"></div>' +
    '</div></div>' +
    '<div class="form-group"><label>Weight</label>' +
    '<div class="nut-unit-row">' +
    '<input type="number" id="nut-weight" min="30" step="0.1" placeholder="' + (weightUnit === 'lbs' ? '170' : '77') + '" value="' + wVal + '" style="flex:1">' +
    '<select id="nut-weight-unit" style="max-width:86px"><option value="lbs"' + sel(weightUnit, 'lbs') + '>lbs</option><option value="kg"' + sel(weightUnit, 'kg') + '>kg</option></select>' +
    '</div></div>' +
    '</div>' +
    '<div class="form-group"><label>Activity level</label>' +
    '<select id="nut-activity">' + Object.entries(ACTIVITY_FACTORS).map(([k, v]) => '<option value="' + k + '"' + sel(n.activity || 'moderate', k) + '>' + v.label + '</option>').join('') + '</select></div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Goal</label>' +
    '<select id="nut-goal">' + Object.entries(NUTRITION_GOALS).map(([k, v]) => '<option value="' + k + '"' + sel(n.goal || 'gain', k) + '>' + v.label + ' (' + v.sub + ')</option>').join('') + '</select></div>' +
    '<div class="form-group"><label>Macro split</label>' +
    '<select id="nut-strategy">' +
    '<option value="muscle"' + sel(n.strategy || 'muscle', 'muscle') + '>Muscle-building (high protein)</option>' +
    '<option value="balanced"' + sel(n.strategy, 'balanced') + '>Balanced 30 / 40 / 30</option>' +
    '</select></div>' +
    '</div>' +
    '<div class="form-group"><label>Meals per day <span style="font-weight:400;color:var(--text-muted)">(we\'ll split your targets across them)</span></label>' +
    '<select id="nut-meals">' +
    [3, 4, 5, 6].map(m => '<option value="' + m + '"' + ((+(n.mealsPerDay) || 3) === m ? ' selected' : '') + '>' + m + ' meals a day</option>').join('') +
    '</select></div>' +
    '<button type="submit" class="btn btn-primary">🍎 Calculate & Save</button>' +
    '</form>' +
    '<div id="nutrition-results-wrap">' + renderNutritionResults(computeNutrition(n)) + '</div>' +
    '</div>';
}

function nutToggleHeightUnit() {
  const u = document.getElementById('nut-height-unit').value;
  document.getElementById('nut-h-cm').style.display = u === 'cm' ? '' : 'none';
  document.getElementById('nut-h-ft').style.display = u === 'ft' ? 'flex' : 'none';
}

async function saveNutrition(e) {
  e.preventDefault();
  const age = parseInt(document.getElementById('nut-age').value) || 0;
  const sex = document.getElementById('nut-sex').value;
  const heightUnit = document.getElementById('nut-height-unit').value;
  const weightUnit = document.getElementById('nut-weight-unit').value;
  let heightCm = 0;
  if (heightUnit === 'cm') heightCm = parseFloat(document.getElementById('nut-height-cm').value) || 0;
  else {
    const ft = parseFloat(document.getElementById('nut-height-ft').value) || 0;
    const inch = parseFloat(document.getElementById('nut-height-in').value) || 0;
    heightCm = (ft * 12 + inch) * IN_TO_CM;
  }
  const wRaw = parseFloat(document.getElementById('nut-weight').value) || 0;
  const weightKg = weightUnit === 'lbs' ? wRaw * LBS_TO_KG : wRaw;
  if (!age || !heightCm || !weightKg) { showToast('Fill in age, height and weight.', 'error'); return; }

  state.data.profile.nutrition = {
    age, sex,
    heightCm: Math.round(heightCm * 10) / 10,
    weightKg: Math.round(weightKg * 10) / 10,
    heightUnit, weightUnit,
    activity: document.getElementById('nut-activity').value,
    goal: document.getElementById('nut-goal').value,
    strategy: document.getElementById('nut-strategy').value,
    mealsPerDay: parseInt(document.getElementById('nut-meals').value) || 3
  };
  await saveData();
  showToast('Nutrition targets updated! 🍎', 'success');
  const wrap = document.getElementById('nutrition-results-wrap');
  if (wrap) wrap.innerHTML = renderNutritionResults(getNutrition());
}

// ─────────────────────────────────────────────────────────────
// BACKUP / EXPORT / IMPORT  (client-side, no server needed)
// ─────────────────────────────────────────────────────────────
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function exportData() {
  const payload = { app: 'business-escalate', version: 1, exportedAt: new Date().toISOString(), data: state.data };
  downloadFile('business-escalate-backup-' + todayStr() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  showToast('Backup downloaded ✅', 'success');
}

function exportDaysCSV() {
  const days = [...state.data.days].sort((a, b) => new Date(a.date) - new Date(b.date));
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = ['Date', 'Gym done', 'Muscle/Category', 'Duration(min)', 'Food rating', 'Networking count', 'Money activities', 'Spent', 'Reading pages', 'Reading summary', 'Water (gal)', 'Calories eaten', 'Notes'];
  const rows = days.map(d => [
    d.date, d.gym && d.gym.done ? 'yes' : 'no', d.gym && d.gym.muscleGroup || '', d.gym && d.gym.duration || '',
    d.food && d.food.rating || '', d.networking && d.networking.count || '', d.money && d.money.activities || '', d.spent || '',
    d.reading && d.reading.pages || '', d.reading && d.reading.summary || '', d.water || '', d.calories || '', d.notes || ''
  ].map(esc).join(','));
  downloadFile('business-escalate-log-' + todayStr() + '.csv', header.join(',') + '\n' + rows.join('\n'), 'text/csv');
  showToast('Daily log CSV downloaded ✅', 'success');
}

function triggerImport() { document.getElementById('import-file')?.click(); }

async function importData(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const data = (parsed && parsed.data) ? parsed.data : parsed; // accept wrapped or raw
    if (!data || typeof data !== 'object' || !('days' in data) || !('profile' in data)) {
      showToast('That doesn\'t look like a Business Escalate backup.', 'error'); input.value = ''; return;
    }
    if (!confirm('Import this backup? It will REPLACE all current data for this account.')) { input.value = ''; return; }
    data.profile = data.profile || {};
    ['days', 'weeks', 'ideas', 'contacts', 'books', 'weights', 'checklist', 'reminders'].forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
    if (!data.checkDone || typeof data.checkDone !== 'object') data.checkDone = {};
    if (!data.profile.pillars) data.profile.pillars = defaultPillars();
    state.data = data;
    await saveData();
    input.value = '';
    showToast('Backup imported! 🎉', 'success');
    applyNavVisibility(); renderXPBar(); navigate('dashboard');
  } catch {
    showToast('Could not read that file — is it a valid backup?', 'error');
    input.value = '';
  }
}

function renderBackupCard() {
  const n = state.data.days.length;
  return '<div class="card">' +
    '<h3 class="card-title">💾 Backup & Data</h3>' +
    '<p class="card-sub">Your data is stored only on this computer. Export a backup regularly so you never lose it — you have <strong>' + n + '</strong> day' + (n === 1 ? '' : 's') + ' logged.</p>' +
    '<div class="backup-btns">' +
    '<button class="btn btn-primary" onclick="exportData()">⬇️ Export backup (JSON)</button>' +
    '<button class="btn btn-outline" onclick="exportDaysCSV()">📄 Export log (CSV)</button>' +
    '<button class="btn btn-outline" onclick="triggerImport()">⬆️ Import backup</button>' +
    '<input type="file" id="import-file" accept="application/json,.json" style="display:none" onchange="importData(this)">' +
    '</div>' +
    '<div class="backup-note">⚠️ Importing replaces this account\'s current data. Export first if you want a safety copy.</div>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────
// CHECKLIST & REMINDERS
// ─────────────────────────────────────────────────────────────
function ensureChecklistData() {
  if (!state.data.checklist) state.data.checklist = [];
  if (!state.data.checkDone || typeof state.data.checkDone !== 'object') state.data.checkDone = {};
  if (!state.data.reminders) state.data.reminders = [];
}
function checkDoneToday() { return (state.data.checkDone && state.data.checkDone[todayStr()]) || []; }
function isChecked(id) { return checkDoneToday().includes(id); }
function checklistProgress() {
  const items = state.data.checklist || [];
  return { done: items.filter(i => isChecked(i.id)).length, total: items.length };
}

async function addCheckItem() {
  const inp = document.getElementById('chk-new');
  const text = (inp && inp.value || '').trim();
  if (!text) return;
  ensureChecklistData();
  state.data.checklist.push({ id: uid(), text });
  if (inp) inp.value = '';
  await saveData();
  renderChecklistPage();
}
async function deleteCheckItem(id) {
  state.data.checklist = (state.data.checklist || []).filter(i => i.id !== id);
  await saveData();
  if (state.page === 'checklist') renderChecklistPage(); else renderDashboard();
}
async function toggleCheck(id) {
  ensureChecklistData();
  const t = todayStr();
  if (!state.data.checkDone[t]) state.data.checkDone[t] = [];
  const arr = state.data.checkDone[t];
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  await saveData();
  if (state.page === 'checklist') renderChecklistPage(); else if (state.page === 'dashboard') renderDashboard();
}

async function addReminder() {
  const label = (document.getElementById('rem-label')?.value || '').trim();
  const time = document.getElementById('rem-time')?.value || '';
  if (!label || !time) { showToast('Add a label and a time.', 'error'); return; }
  ensureChecklistData();
  state.data.reminders.push({ id: uid(), label, time, enabled: true, _lastFired: '' });
  await saveData();
  renderChecklistPage();
}
async function deleteReminder(id) {
  state.data.reminders = (state.data.reminders || []).filter(r => r.id !== id);
  await saveData(); renderChecklistPage();
}
async function toggleReminder(id) {
  const r = (state.data.reminders || []).find(x => x.id === id);
  if (r) { r.enabled = !r.enabled; await saveData(); renderChecklistPage(); }
}
async function enableNotifications() {
  if (!('Notification' in window)) { showToast('Notifications aren\'t supported here.', 'error'); return; }
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') {
      const pushed = await subscribeToPush();
      showToast(pushed ? 'Notifications on — you\'ll get reminders even when the app is closed 🔔' : 'Notifications on 🔔', 'success');
      try { if (!pushed) new Notification('Reminders enabled', { body: "We'll nudge you while the app is open." }); } catch {}
    } else showToast('Notifications blocked — turn them on in your browser settings.', 'error');
  } catch { showToast('Could not enable notifications.', 'error'); }
  if (state.page === 'checklist') renderChecklistPage();
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Subscribe this device to web push so reminders arrive when the app is closed.
// Returns false (gracefully) if push isn't supported or the server isn't configured.
async function subscribeToPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const keyResp = await fetch('/api/push/key').then(r => r.json()).catch(() => ({}));
    if (!keyResp.key) return false; // server has no VAPID key set yet
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyResp.key) });
    state.data.profile.tz = -new Date().getTimezoneOffset(); // local = UTC + tz minutes
    const r = await fetch('/api/push/subscribe', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ subscription: sub }) });
    state.data.profile.pushSubscribed = !!r.ok; // server push now delivers reminders → avoid double-notifying
    await saveData(); // persist timezone + flag
    return r.ok;
  } catch { return false; }
}

async function sendTestPush() {
  try {
    const r = await fetch('/api/push/test', { method: 'POST', headers: authHeaders() });
    const j = await r.json();
    if (r.ok && j.sent > 0) showToast('Test sent — check your notifications 🔔', 'success');
    else showToast(j.error || 'Enable notifications first, then try again.', 'error');
  } catch { showToast('Could not send test.', 'error'); }
}

// Pure: is this reminder due to fire right now? (testable)
function reminderDue(r, hhmm, today) {
  return !!r && r.enabled && r._lastFired !== today && (r.time || '99:99') <= hhmm;
}
function isPushSubscribed() { return !!(state.data && state.data.profile && state.data.profile.pushSubscribed); }
function fireReminder(r) {
  const name = state.data.profile && state.data.profile.firstName;
  showToast('⏰ ' + r.label, 'success');
  // If the device is subscribed to server push, the cron already delivers this
  // reminder — don't also raise a local system notification (would double-notify).
  if (!isPushSubscribed() && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('⏰ ' + (name ? name + ', ' : '') + r.label, { body: 'Business Escalate', tag: r.id }); } catch {}
  }
}
function checkReminders() {
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const today = todayStr();
  let changed = false;
  (state.data.reminders || []).forEach(r => { if (reminderDue(r, hhmm, today)) { r._lastFired = today; changed = true; fireReminder(r); } });
  if (changed) saveData();
}
let _reminderTimer = null;
function startReminderLoop() {
  if (_reminderTimer) return;
  checkReminders();
  _reminderTimer = setInterval(checkReminders, 60000);
}

// Compact checklist card for the dashboard (hidden if no items)
function renderChecklistCard() {
  const items = state.data.checklist || [];
  if (!items.length) return '';
  const prog = checklistProgress();
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const rows = items.slice(0, 8).map(i =>
    '<div class="chk-row chk-row-sm' + (isChecked(i.id) ? ' chk-done' : '') + '">' +
    '<button type="button" class="chk-box" onclick="toggleCheck(\'' + i.id + '\')">' + (isChecked(i.id) ? '✓' : '') + '</button>' +
    '<span class="chk-text">' + escapeHtml(i.text) + '</span></div>').join('');
  return '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">✅ Today\'s Checklist</h3>' +
    '<span style="font-size:13px;color:var(--text-muted)">' + prog.done + '/' + prog.total + '</span></div>' +
    '<div class="chk-progress"><div style="width:' + pct + '%"></div></div>' +
    '<div class="chk-list">' + rows + '</div></div>';
}

// Daily streak nudge control (server sends it; this just sets the preference)
function renderNudgeCard() {
  const p = state.data.profile || {};
  const on = p.dailyNudge !== false; // default ON
  const hour = Number.isFinite(+p.nudgeHour) ? +p.nudgeHour : 19;
  const fmt = h => ((h % 12) || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
  const opts = Array.from({ length: 24 }, (_, h) => '<option value="' + h + '"' + (h === hour ? ' selected' : '') + '>' + fmt(h) + '</option>').join('');
  return '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">🔥 Daily streak nudge</h3>' +
    '<label class="pc-toggle"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleDailyNudge()"><span class="pc-slider"></span></label></div>' +
    '<p class="card-sub">If you haven\'t logged by this time, we\'ll send one friendly push to your phone — so you never break your streak.</p>' +
    '<div class="rem-add"><label style="align-self:center;color:var(--text-muted);font-size:14px;white-space:nowrap">Remind me at</label>' +
    '<select id="nudge-hour" onchange="setNudgeHour(this.value)"' + (on ? '' : ' disabled') + '>' + opts + '</select></div>' +
    '<div class="rem-note">📱 Needs notifications enabled (above). Sent at most once a day, only if you haven\'t logged yet.</div>' +
    '</div>';
}
async function toggleDailyNudge() {
  const p = state.data.profile = state.data.profile || {};
  const currentlyOn = p.dailyNudge !== false;
  p.dailyNudge = !currentlyOn;
  if (p.dailyNudge) p.tz = -new Date().getTimezoneOffset(); // make sure the server knows your local time
  await saveData();
  renderChecklistPage();
}
async function setNudgeHour(v) {
  const p = state.data.profile = state.data.profile || {};
  p.nudgeHour = parseInt(v, 10) || 19;
  await saveData();
}

function renderChecklistPage() {
  ensureChecklistData();
  const items = state.data.checklist;
  const prog = checklistProgress();
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  const checklistRows = items.length
    ? items.map(i => '<div class="chk-row' + (isChecked(i.id) ? ' chk-done' : '') + '">' +
        '<button type="button" class="chk-box" onclick="toggleCheck(\'' + i.id + '\')">' + (isChecked(i.id) ? '✓' : '') + '</button>' +
        '<span class="chk-text">' + escapeHtml(i.text) + '</span>' +
        '<button type="button" class="chk-del" onclick="deleteCheckItem(\'' + i.id + '\')" title="Remove">🗑️</button>' +
        '</div>').join('')
    : '<div class="chk-empty">No checklist items yet — add your daily must-dos below.</div>';

  const reminders = state.data.reminders;
  const remRows = reminders.length
    ? reminders.map(r => '<div class="rem-row' + (r.enabled ? '' : ' rem-off') + '">' +
        '<span class="rem-time">' + escapeHtml(r.time) + '</span>' +
        '<span class="rem-label">' + escapeHtml(r.label) + '</span>' +
        '<label class="pc-toggle"><input type="checkbox" ' + (r.enabled ? 'checked' : '') + ' onchange="toggleReminder(\'' + r.id + '\')"><span class="pc-slider"></span></label>' +
        '<button type="button" class="chk-del" onclick="deleteReminder(\'' + r.id + '\')" title="Remove">🗑️</button>' +
        '</div>').join('')
    : '<div class="chk-empty">No reminders yet — add one below.</div>';

  const notifBtn = ('Notification' in window && Notification.permission === 'granted')
    ? '<span class="rem-notif-on">🔔 On</span> <button type="button" class="btn-link" onclick="sendTestPush()">Send test</button>'
    : '<button type="button" class="btn btn-outline" onclick="enableNotifications()">🔔 Enable notifications</button>';

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">Checklist & Reminders</h2>' +
    '<p class="page-sub">Your daily must-dos and nudges to stay on track</p></div>' +
    '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">✅ Today\'s Checklist</h3>' +
    '<span style="font-size:13px;color:var(--text-muted)">' + prog.done + '/' + prog.total + ' done</span></div>' +
    '<div class="chk-progress"><div style="width:' + pct + '%"></div></div>' +
    '<div class="chk-list">' + checklistRows + '</div>' +
    '<div class="chk-add"><input type="text" id="chk-new" placeholder="Add a daily task… (e.g. Take vitamins)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addCheckItem();}">' +
    '<button type="button" class="btn btn-primary" onclick="addCheckItem()">+ Add</button></div>' +
    '</div>' +
    '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
    '<h3 class="card-title" style="margin-bottom:0">⏰ Reminders</h3>' + notifBtn + '</div>' +
    '<div class="rem-list">' + remRows + '</div>' +
    '<div class="rem-add">' +
    '<input type="text" id="rem-label" placeholder="Reminder (e.g. Log your day)">' +
    '<input type="time" id="rem-time" value="20:00">' +
    '<button type="button" class="btn btn-primary" onclick="addReminder()">+ Add</button>' +
    '</div>' +
    '<div class="rem-note">💡 Reminders nudge you while the app is open. On a phone, add it to your home screen and allow notifications for the best results.</div>' +
    '</div>' +
    renderNudgeCard();
}

// ─────────────────────────────────────────────────────────────
// SETTINGS PAGE
// ─────────────────────────────────────────────────────────────
function renderSettingsPage() {
  const p = state.data.profile;
  const hasKey = state.hasApiKey;

  const gymP = pillar('gym'), netP = pillar('networking'), moneyP = pillar('money'), readP = pillar('reading');

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">Settings</h2>' +
    '<p class="page-sub">Customize your pillars, goals, profile, and app preferences</p></div>' +

    // Owner-only tools (invisible to everyone else)
    renderAdminStatsCard() +
    renderOwnerCard() +

    // Customize pillars (first — it's the headline feature)
    pillarCustomizerCard() +

    // Goals — labels follow your pillar names; only enabled pillars shown
    '<div class="card">' +
    '<h3 class="card-title">🎯 Weekly Goals</h3>' +
    '<form id="goals-form" onsubmit="saveGoals(event)">' +
    '<div class="form-row">' +
    (isPillarOn('gym') ? '<div class="form-group"><label>' + gymP.icon + ' ' + escapeHtml(gymP.label) + ' days per week</label>' +
      '<input type="number" id="g-gym" min="1" max="7" value="' + (p.gymDaysPerWeek||5) + '"></div>' : '<input type="hidden" id="g-gym" value="' + (p.gymDaysPerWeek||5) + '">') +
    (isPillarOn('money') ? '<div class="form-group"><label>' + moneyP.icon + ' Weekly ' + escapeHtml(moneyP.label) + ' goal ($)</label>' +
      '<input type="number" id="g-income" min="0" step="50" placeholder="e.g. 1200" value="' + (p.weeklyIncomeGoal||'') + '"></div>' : '<input type="hidden" id="g-income" value="' + (p.weeklyIncomeGoal||0) + '">') +
    '</div>' +
    (isPillarOn('money') ? '<div class="form-row"><div class="form-group"><label>💰 How often do you get paid?</label>' +
      '<select id="g-cadence"><option value="monthly"' + (moneyCadence()==='monthly'?' selected':'') + '>Monthly — set income once a month</option>' +
      '<option value="weekly"' + (moneyCadence()==='weekly'?' selected':'') + '>Weekly — set income once a week</option>' +
      '<option value="daily"' + (moneyCadence()==='daily'?' selected':'') + '>Daily — set income each day</option></select></div>' +
      '<div class="form-group"><label>🎯 Savings goal per ' + moneyPeriodLabel() + ' ($)</label>' +
      '<input type="number" id="g-savings" min="0" step="50" placeholder="e.g. 500" value="' + (p.savingsGoal || '') + '"></div></div>' : '') +
    '<div class="form-row">' +
    (isPillarOn('networking') ? '<div class="form-group"><label>' + netP.icon + ' ' + escapeHtml(netP.label) + ' per week</label>' +
      '<input type="number" id="g-net" min="0" value="' + (p.weeklyNetworkGoal||3) + '"></div>' : '<input type="hidden" id="g-net" value="' + (p.weeklyNetworkGoal||0) + '">') +
    (isPillarOn('reading') ? '<div class="form-group"><label>' + readP.icon + ' ' + escapeHtml(readP.label) + ' pages per week</label>' +
      '<input type="number" id="g-read" min="0" step="10" placeholder="e.g. 100" value="' + (p.weeklyReadGoal||'') + '"></div>' : '<input type="hidden" id="g-read" value="' + (p.weeklyReadGoal||0) + '">') +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Your name</label>' +
    '<input type="text" id="g-name" placeholder="Your name" value="' + escapeHtml(p.name||'') + '"></div>' +
    '<div class="form-group"><label>Age</label>' +
    '<input type="number" id="g-age" min="13" max="100" placeholder="28" value="' + (p.age||'') + '"></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label>Email</label>' +
    '<input type="email" id="g-email" placeholder="you@email.com" value="' + escapeHtml(p.email||'') + '"></div>' +
    '<div class="form-group"><label>Phone</label>' +
    '<input type="tel" id="g-phone" placeholder="+1 555 123 4567" value="' + escapeHtml(p.phone||'') + '"></div>' +
    '</div>' +
    '<button type="submit" class="btn btn-primary">💾 Save Goals</button>' +
    '</form></div>' +

    // Nutrition & calorie targets
    renderNutritionSettingsCard() +

    // Profile
    '<div class="card">' +
    '<h3 class="card-title">💼 Work Profile</h3>' +
    '<p class="card-sub">This is what the AI coach uses to give you personalized advice.</p>' +
    '<form id="profile-form" onsubmit="saveProfileSettings(event)">' +
    '<div class="form-group"><label>What is your job / role?</label>' +
    '<input type="text" id="s-title" placeholder="e.g. Solar Panel Sales Rep" value="' + (p.jobTitle||'') + '"></div>' +
    '<div class="form-group"><label>How does your commission work?</label>' +
    '<textarea id="s-desc" rows="3" placeholder="Describe what you sell, your commission rate, how deals work…">' + (p.jobDescription||'') + '</textarea></div>' +
    '<div class="form-group"><label>Commission rate (%)</label>' +
    '<input type="number" id="s-rate" min="0" max="100" step="0.1" placeholder="e.g. 3" value="' + (p.commissionRate||'') + '"></div>' +
    '<button type="submit" class="btn btn-primary">💾 Save Profile</button>' +
    '</form></div>' +

    // AI Key
    '<div class="card">' +
    '<h3 class="card-title">🔑 AI Coach — Claude API Key</h3>' +
    (hasKey
      ? '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--success-bg);border:1px solid rgba(16,185,129,0.3);border-radius:var(--radius-sm);margin-bottom:12px">' +
        '<span style="color:var(--success);font-weight:600">✅ API key connected — AI Coach is active</span>' +
        '<button class="btn-link" onclick="clearApiKey()">Remove key</button></div>'
      : '<p class="card-sub">Get your free key at <strong>console.anthropic.com</strong> → API Keys</p>' +
        '<div style="display:flex;gap:10px">' +
        '<input type="password" id="api-key-input" placeholder="sk-ant-api03-…" style="flex:1;padding:10px 14px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:monospace;background:rgba(0,0,0,0.3);color:var(--text);outline:none">' +
        '<button class="btn btn-primary" onclick="saveApiKey()">Save Key</button></div>') +
    '</div>' +

    // Security & password
    renderSecurityCard() +

    // Backup & data
    renderBackupCard() +

    // Notifications info
    '<div class="card">' +
    '<h3 class="card-title">🔔 Notifications & Reminders</h3>' +
    '<div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:14px 16px;font-size:14px;color:var(--text-muted);line-height:1.7;margin-bottom:12px">' +
    'Get your reminders and a daily <strong style="color:var(--text)">streak nudge</strong> on your phone — <strong style="color:var(--text)">even when the app is closed</strong>. ' +
    'Turn them on in <strong style="color:var(--text)">Checklist → Reminders → Enable notifications</strong>, then add your own reminder times and set the nudge.' +
    '<br><br>📱 <strong style="color:var(--text)">On iPhone:</strong> add the app to your Home Screen first (Share → Add to Home Screen), then allow notifications.' +
    '</div>' +
    '<button class="btn btn-outline" onclick="navigate(\'checklist\')">Open Checklist & Reminders →</button>' +
    '</div>';

  if (state.isOwner) { loadBroadcastReach(); loadAdminStats(); }
}

// Owner-only card: type a message → push it to everyone's phone. Returns '' for normal users.
function renderOwnerCard() {
  if (!state.isOwner) return '';
  return '<div class="card" style="border:1px solid rgba(124,92,255,0.4)">' +
    '<h3 class="card-title">📣 Send a notification to everyone</h3>' +
    '<p class="card-sub">Owner tool — pushes a notification to every person who turned on notifications, right on their phone. <span id="bc-reach"></span></p>' +
    '<div class="form-group"><label>Title</label>' +
    '<input type="text" id="bc-title" maxlength="80" placeholder="e.g. New feature added 🎉"></div>' +
    '<div class="form-group"><label>Message</label>' +
    '<textarea id="bc-body" rows="2" maxlength="300" placeholder="e.g. Don\'t forget to log your day — keep the streak alive!"></textarea></div>' +
    '<button type="button" class="btn btn-primary" onclick="sendBroadcast()">📣 Send to everyone</button>' +
    '<hr style="border:none;border-top:1px solid var(--border);margin:18px 0">' +
    '<h3 class="card-title" style="margin-bottom:6px">⭐ Activate a subscriber</h3>' +
    '<p class="card-sub">After someone pays, enter their username here to unlock Pro for their account.</p>' +
    '<div class="rem-add"><input type="text" id="pro-user" placeholder="their username">' +
    '<button type="button" class="btn btn-primary" onclick="grantPro()">Grant Pro</button></div>' +
    '</div>';
}
async function grantPro() {
  const username = (document.getElementById('pro-user').value || '').trim();
  if (!username) { showToast('Enter a username.', 'error'); return; }
  try {
    const r = await fetch('/api/admin/grant-pro', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ username, pro: true }) });
    const j = await r.json();
    if (r.ok) { showToast('✅ ' + j.username + ' is now Pro.', 'success'); document.getElementById('pro-user').value = ''; }
    else showToast(j.error || 'Could not update.', 'error');
  } catch { showToast('Could not update.', 'error'); }
}

// Owner-only live analytics — so you can SEE if people actually use it
function renderAdminStatsCard() {
  if (!state.isOwner) return '';
  return '<div class="card" style="border:1px solid rgba(45,212,191,0.3)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<h3 class="card-title" style="margin-bottom:0">📊 Your app — live numbers</h3>' +
    '<button class="btn btn-outline btn-sm" onclick="loadAdminStats()">↻ Refresh</button></div>' +
    '<p class="card-sub">Owner only. How many people use Business Escalate and how active they are.</p>' +
    '<div id="admin-stats" class="admin-grid"><div class="di-loading"><div class="spinner"></div><span>Loading…</span></div></div>' +
    '<div id="admin-recent"></div></div>';
}
async function loadAdminStats() {
  const grid = document.getElementById('admin-stats');
  const recent = document.getElementById('admin-recent');
  if (grid) grid.innerHTML = '<div class="di-loading"><div class="spinner"></div><span>Loading…</span></div>';
  try {
    const j = await fetch('/api/admin/stats', { headers: authHeaders() }).then(r => r.json());
    if (!grid) return;
    const tile = (n, label, hint) => '<div class="admin-tile"><div class="admin-n">' + n + '</div><div class="admin-l">' + label + '</div>' + (hint ? '<div class="admin-h">' + hint + '</div>' : '') + '</div>';
    grid.innerHTML =
      tile(j.totalUsers, 'Total users', j.new7 ? '+' + j.new7 + ' this week' : '') +
      tile(j.loggedToday, 'Logged today', j.totalUsers ? Math.round(j.loggedToday / j.totalUsers * 100) + '% of users' : '') +
      tile(j.active7, 'Active · 7 days') +
      tile(j.active30, 'Active · 30 days') +
      tile(j.avgDays, 'Avg days / user') +
      tile(j.pushDevices, 'Push devices');
    if (recent) {
      const rowsHtml = (j.recent || []).map(r => '<tr><td>' + escapeHtml(r.username) + '</td><td style="text-align:center">' + r.days + '</td><td style="text-align:right;color:var(--text-muted)">' + (r.last ? fmtDateShort(r.last) : '—') + '</td></tr>').join('');
      recent.innerHTML = (j.recent && j.recent.length)
        ? '<table class="admin-table"><thead><tr><th>User</th><th style="text-align:center">Days</th><th style="text-align:right">Last active</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>'
        : '<p class="card-sub" style="margin-top:10px">No signups yet — share your link to get your first users.</p>';
    }
  } catch {
    if (grid) grid.innerHTML = '<p class="card-sub">Couldn\'t load stats — try Refresh.</p>';
  }
}

async function loadBroadcastReach() {
  try {
    const j = await fetch('/api/admin/reach', { headers: authHeaders() }).then(r => r.json());
    const el = document.getElementById('bc-reach');
    if (el && j && typeof j.devices === 'number') {
      el.textContent = j.devices ? ('Will reach ' + j.devices + ' device' + (j.devices === 1 ? '' : 's') + '.') : 'No one has enabled notifications yet.';
    }
  } catch {}
}

async function sendBroadcast() {
  const title = (document.getElementById('bc-title').value || '').trim();
  const body = (document.getElementById('bc-body').value || '').trim();
  if (!title) { showToast('Add a title first.', 'error'); return; }
  if (!confirm('Send this notification to everyone who enabled notifications?')) return;
  try {
    const r = await fetch('/api/admin/broadcast', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ title, body }) });
    const j = await r.json();
    if (r.ok) {
      showToast('Sent to ' + (j.sent || 0) + ' device' + (j.sent === 1 ? '' : 's') + ' 📣', 'success');
      document.getElementById('bc-title').value = '';
      document.getElementById('bc-body').value = '';
    } else showToast(j.error || 'Could not send.', 'error');
  } catch { showToast('Could not send.', 'error'); }
}

async function saveProfileSettings(e) {
  e.preventDefault();
  state.data.profile.jobTitle = document.getElementById('s-title').value.trim();
  state.data.profile.jobDescription = document.getElementById('s-desc').value.trim();
  state.data.profile.commissionRate = parseFloat(document.getElementById('s-rate').value) || 0;
  await saveData();
  showToast('Profile saved! ✅', 'success');
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────
function formatWeekRange(weekStart, short) {
  const s = new Date(weekStart + 'T00:00:00');
  const e = new Date(weekStart + 'T00:00:00');
  e.setDate(e.getDate() + 6);
  if (short) return s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const opts = { month: 'short', day: 'numeric' };
  if (s.getMonth() === e.getMonth()) return s.toLocaleDateString('en-US', opts) + ' – ' + e.getDate() + ', ' + e.getFullYear();
  return s.toLocaleDateString('en-US', opts) + ' – ' + e.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
}

function showToast(msg, type) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'success');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 3200);
}

init();
