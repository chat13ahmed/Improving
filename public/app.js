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
// The user's own Claude key, stored in this browser (bring-your-own-key).
function aiKey() { try { return localStorage.getItem('onward_ai_key') || ''; } catch { return ''; } }
function aiProvider() { try { return localStorage.getItem('onward_ai_provider') || 'auto'; } catch { return 'auto'; } }
function aiModel() { try { return localStorage.getItem('onward_ai_model') || ''; } catch { return ''; } }
function aiBase() { try { return localStorage.getItem('onward_ai_base') || ''; } catch { return ''; } }
// A safe preview of the saved key — enough to spot a truncated/partial paste.
// A real Anthropic key is ~108 chars and starts with "sk-ant-api03-".
function maskKey(k) { k = String(k || ''); if (!k) return ''; const tail = k.length > 8 ? k.slice(-4) : ''; return k.slice(0, 12) + '…' + tail + ' · ' + k.length + ' chars'; }
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (state.token) h.Authorization = 'Bearer ' + state.token;
  const k = aiKey();
  if (k) {
    h['X-Api-Key'] = k;   // server uses this if no server-side key is set
    const prov = aiProvider(); if (prov && prov !== 'auto') h['X-Ai-Provider'] = prov;
    const model = aiModel(); if (model) h['X-Ai-Model'] = model;
    const base = aiBase(); if (base) h['X-Ai-Base'] = base;
  }
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
  gym:        { type: 'boolean', cls: 'gym',     defaultLabel: 'Gym',        defaultIcon: '', goalKey: 'gymDaysPerWeek',   measures: 'Did you do it? — builds a daily streak' },
  food:       { type: 'rating',  cls: 'food',    defaultLabel: 'Food',       defaultIcon: '', goalKey: null,               measures: 'Quality rating from 1 to 5' },
  networking: { type: 'count',   cls: 'network', defaultLabel: 'Networking', defaultIcon: '', goalKey: 'weeklyNetworkGoal', measures: 'How many today? — a daily count' },
  money:      { type: 'amount',  cls: 'money',   defaultLabel: 'Income',     defaultIcon: '', goalKey: 'weeklyIncomeGoal', measures: 'A dollar amount + what you did' },
  reading:    { type: 'reading', cls: 'read',    defaultLabel: 'Reading',    defaultIcon: '', goalKey: 'weeklyReadGoal',   measures: 'Pages read + a summary, with a book tracker' }
};
const PILLAR_IDS = ['gym', 'food', 'networking', 'money', 'reading'];

const PILLAR_PRESETS = {
  sales: {
    name: 'Sales Hustler', desc: 'Gym · Food · Networking · Income · Reading',
    pillars: {
      gym:        { enabled: true, label: 'Gym',        icon: '' },
      food:       { enabled: true, label: 'Food',       icon: '' },
      networking: { enabled: true, label: 'Networking', icon: '' },
      money:      { enabled: true, label: 'Income',     icon: '' },
      reading:    { enabled: true, label: 'Reading',    icon: '' }
    }
  },
  student: {
    name: 'Student', desc: 'Study · Sleep · Practice · — · Reading',
    pillars: {
      gym:        { enabled: true,  label: 'Study Session', icon: '' },
      food:       { enabled: true,  label: 'Sleep Quality', icon: '' },
      networking: { enabled: true,  label: 'Practice Qs',   icon: '' },
      money:      { enabled: false, label: 'Income',        icon: '' },
      reading:    { enabled: true,  label: 'Reading',       icon: '' }
    }
  },
  creator: {
    name: 'Creator', desc: 'Create · Energy · Posts · Revenue · Learning',
    pillars: {
      gym:        { enabled: true, label: 'Create',   icon: '' },
      food:       { enabled: true, label: 'Energy',   icon: '' },
      networking: { enabled: true, label: 'Posts Out', icon: '' },
      money:      { enabled: true, label: 'Revenue',  icon: '' },
      reading:    { enabled: true, label: 'Learning', icon: '' }
    }
  },
  health: {
    name: 'Health & Wellness', desc: 'Exercise · Diet · Water · — · Reading',
    pillars: {
      gym:        { enabled: true,  label: 'Exercise',  icon: '' },
      food:       { enabled: true,  label: 'Diet',      icon: '' },
      networking: { enabled: true,  label: 'Water (glasses)', icon: '' },
      money:      { enabled: false, label: 'Income',    icon: '' },
      reading:    { enabled: true,  label: 'Reading',   icon: '' }
    }
  },
  custom: {
    name: 'Build My Own', desc: 'Start from the defaults and rename everything',
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
    id: 'overall', icon: '', title: 'My Full Life Audit',
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
    id: 'gym', icon: '', title: 'Optimize My Training',
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
    id: 'network', icon: '', title: 'Network Into Opportunities',
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
    id: 'money', icon: '', title: 'Stack More Income',
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
// Attribute-safe (also escapes quotes) — for placing user text in value="…"
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
  { min: 0,    label: 'Base Camp',   color: '#94A3B8' },
  { min: 100,  label: 'Foothills',   color: '#3B82F6' },
  { min: 300,  label: 'Treeline',    color: '#10B981' },
  { min: 600,  label: 'The Ridge',   color: '#F59E0B' },
  { min: 1000, label: 'High Camp',   color: '#A78BFA' },
  { min: 1800, label: 'Summit Push', color: '#EF4444' },
  { min: 3000, label: 'Summit',      color: '#F97316' }
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
      <span class="xp-label" style="color:${lvl.color}">Lv.${lvl.level} ${lvl.label}</span>
      <span class="xp-pts">${xp.toLocaleString()} XP</span>
    </div>
    <div class="xp-track"><div class="xp-fill" style="width:${lvl.pct}%;background:${lvl.color};box-shadow:0 0 8px ${lvl.color}44"></div></div>
    <div class="xp-next">${toNext > 0 ? toNext + ' XP to ' + lvl.nextLabel : 'MAX LEVEL'}</div>
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
    '<div class="quote-author">— ' + q.author + ' &nbsp;·&nbsp; <span style="color:var(--text-muted)">Today\'s Fuel </span></div>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────
// ACHIEVEMENTS
// ─────────────────────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { id: 'first_log',    icon: '', title: 'First Step',      desc: 'Log your first day',                    cat: 'general', check: d => d.days.length >= 1 },
  { id: 'days_7',       icon: '', title: 'Tracker',         desc: 'Log 7 days total',                      cat: 'general', check: d => d.days.length >= 7 },
  { id: 'days_30',      icon: '', title: 'Dedicated',       desc: 'Log 30 days total',                     cat: 'general', check: d => d.days.length >= 30 },
  { id: 'days_100',     icon: '', title: 'Unstoppable',     desc: 'Log 100 days total',                    cat: 'general', check: d => d.days.length >= 100 },
  { id: 'first_gym',    icon: '', title: 'First Rep',       desc: 'Log your first workout',                cat: 'gym',     check: d => d.days.some(x => x.gym?.done) },
  { id: 'streak_3',     icon: '', title: 'Streak Starter',  desc: '3-day gym streak',                      cat: 'gym',     check: d => getGymStreakFromData(d.days) >= 3 },
  { id: 'streak_7',     icon: '', title: 'Week Warrior',    desc: '7-day gym streak',                      cat: 'gym',     check: d => getGymStreakFromData(d.days) >= 7 },
  { id: 'streak_14',    icon: '', title: 'Iron Will',       desc: '14-day gym streak',                     cat: 'gym',     check: d => getGymStreakFromData(d.days) >= 14 },
  { id: 'workouts_30',  icon: '', title: 'Gym Royalty',     desc: '30 workouts logged',                    cat: 'gym',     check: d => d.days.filter(x => x.gym?.done).length >= 30 },
  { id: 'clean_5',      icon: '', title: 'Clean Eater',     desc: 'Food 4+ for 5 days straight',           cat: 'food',    check: d => hasFoodStreakOf(d.days, 4, 5) },
  { id: 'log_7',        icon: '', title: 'Fuel Machine',    desc: 'Log 7 consecutive days',                cat: 'food',    check: d => hasLogStreakOf(d.days, 7) },
  { id: 'net_10',       icon: '', title: 'Connector',       desc: '10 total connections',                  cat: 'network', check: d => d.days.reduce((s,x)=>s+(x.networking?.count||0),0) >= 10 },
  { id: 'net_25',       icon: '', title: 'Networker',       desc: '25 total connections',                  cat: 'network', check: d => d.days.reduce((s,x)=>s+(x.networking?.count||0),0) >= 25 },
  { id: 'net_50',       icon: '', title: 'Power Player',    desc: '50 total connections',                  cat: 'network', check: d => d.days.reduce((s,x)=>s+(x.networking?.count||0),0) >= 50 },
  { id: 'first_income', icon: '', title: 'First Win',       desc: 'Log your first weekly income',          cat: 'money',   check: d => d.weeks.some(w => w.income > 0) },
  { id: 'hit_goal',     icon: '', title: 'Goal Crusher',    desc: 'Hit your weekly income goal',           cat: 'money',   check: d => d.profile.weeklyIncomeGoal > 0 && d.weeks.some(w => w.income >= d.profile.weeklyIncomeGoal) },
  { id: 'hit_goal_3',   icon: '', title: 'On a Roll',       desc: 'Hit income goal 3 times',               cat: 'money',   check: d => d.profile.weeklyIncomeGoal > 0 && d.weeks.filter(w => w.income >= d.profile.weeklyIncomeGoal).length >= 3 },
  { id: 'ideas_3',      icon: '', title: 'Visionary',       desc: 'Add 3+ business ideas',                cat: 'general', check: d => d.ideas.length >= 3 },
  { id: 'idea_active',  icon: '', title: 'Builder',         desc: 'Have an active business idea',          cat: 'general', check: d => d.ideas.some(i => i.status === 'active') }
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
    '<div class="ach-icon">' + (isLocked ? '' : a.icon) + '</div>' +
    '<div class="ach-name">' + a.title + '</div>' +
    '<div class="ach-desc">' + a.desc + '</div>' +
    '</div>';

  return '<div class="card">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
    '<h3 class="card-title" style="margin-bottom:0">Achievements</h3>' +
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

// Make cards tilt in 3D toward the cursor (with a light-following sheen).
// Touch devices have no pointer hover, so they just get the CSS entrance/float.
// Honors reduced-motion. Safe to call repeatedly (guards per element).
function wireCardTilt(selector, maxDeg) {
  if (typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const md = maxDeg || 9;
  document.querySelectorAll(selector).forEach(card => {
    if (card._tilt) return; card._tilt = true;
    card.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 … 0.5
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', (px * md).toFixed(2) + 'deg');
      card.style.setProperty('--rx', (-py * md).toFixed(2) + 'deg');
      card.style.setProperty('--lift', '-6px');
      card.style.setProperty('--gx', (px * 90 + 50).toFixed(1) + '%');
      card.style.setProperty('--gy', (py * 90 + 50).toFixed(1) + '%');
      card.style.setProperty('--sheen', '1');
    }, { passive: true });
    const reset = () => {
      card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--lift', '0px'); card.style.setProperty('--sheen', '0');
    };
    card.addEventListener('pointerleave', reset);
  });
}

// ─────────────────────────────────────────────────────────────
// WEEKLY REVIEW MODAL  (shows on Sunday)
// ─────────────────────────────────────────────────────────────
// Auto-show the recap on Sunday (once). The recap itself works any day — see
// openWeekRecap(), reachable from the dashboard + the Stats "Weekly Recap" card.
function showWeeklyReview() {
  if (new Date().getDay() !== 0) return;
  const key = 'wkReview_' + todayStr();
  if (localStorage.getItem(key)) return;
  if (!(state.data.days || []).length) return;
  localStorage.setItem(key, '1');
  setTimeout(openWeekRecap, 1800);
}
// A client-side week recap (no AI key needed) — goals %, the week's headline
// numbers, the votes you cast and your balance, with a one-tap share.
function openWeekRecap() {
  if (typeof document === 'undefined') return;
  document.getElementById('weekly-modal')?.remove();
  const { days, profile } = state.data;
  const stats = getWeekStats();
  const ws = getWeekStart(todayStr());
  const daysLogged = (days || []).filter(d => d.date >= ws).length;
  const on = { gym: isPillarOn('gym'), networking: isPillarOn('networking'), reading: isPillarOn('reading'), money: isPillarOn('money') };
  const moneyNet = (typeof getMoneyPeriod === 'function') ? (getMoneyPeriod().net || 0) : 0;
  const goalsPct = weeklyGoalsReached(stats, profile, moneyNet, on);
  const balance = sharpenScore(sharpenInputs()).balance;
  const votes = identityVotes(days, { gym: on.gym, reading: on.reading, networking: on.networking }, 7).filter(v => v.votes > 0);
  const color = goalsPct >= 80 ? '#10B981' : goalsPct >= 60 ? '#F59E0B' : goalsPct >= 40 ? '#F97316' : '#EF4444';
  const label = goalsPct >= 80 ? 'Crushing it' : goalsPct >= 60 ? 'Solid week' : goalsPct >= 40 ? 'Room to grow' : 'Time to push';
  const grid = [];
  if (on.gym) grid.push('<div class="rv-item"><span>' + escapeHtml(pillar('gym').label) + '</span><strong>' + (stats.gymDays || 0) + '/' + (profile.gymDaysPerWeek || 5) + '</strong></div>');
  if (on.reading) grid.push('<div class="rv-item"><span>' + escapeHtml(pillar('reading').label) + '</span><strong>' + (stats.readPages || 0) + ' pg</strong></div>');
  if (on.networking) grid.push('<div class="rv-item"><span>' + escapeHtml(pillar('networking').label) + '</span><strong>' + (stats.networkCount || 0) + '</strong></div>');
  grid.push('<div class="rv-item"><span>Balance</span><strong>' + balance + '%</strong></div>');
  grid.push('<div class="rv-item"><span>Days logged</span><strong>' + daysLogged + '/7</strong></div>');
  const votesLine = votes.length ? '<div class="wr-votes">You voted for ' + votes.map(v => v.icon + ' <b>' + escapeHtml(v.label) + '</b> ×' + v.votes).join(' · ') + '</div>' : '';
  const tips = [
    'You showed up this week — that\'s what separates you from most people.',
    'Every connection is a seed. Water it with a follow-up next week.',
    'Consistency beats intensity. One more week logged is one more vote for who you\'re becoming.',
    'Look at the balance — feed your weakest side next week and the rest lifts with it.',
    'Small days still count. The climb is made of them.'
  ];
  const el = document.createElement('div');
  el.className = 'modal-overlay'; el.id = 'weekly-modal';
  el.innerHTML =
    '<div class="modal-box wr-box">' +
    '<div class="modal-badge">Your week · ' + formatWeekRange(ws, true) + '</div>' +
    '<div class="modal-score" style="color:' + color + '">' + goalsPct + '<span>%</span></div>' +
    '<div class="modal-score-label">' + label + ' · of your weekly goals</div>' +
    '<div class="review-grid">' + grid.join('') + '</div>' +
    votesLine +
    '<div class="review-tip">' + tips[Math.floor(Math.random() * tips.length)] + '</div>' +
    '<div class="wr-actions">' +
    '<button class="btn btn-primary" onclick="document.getElementById(\'weekly-modal\').remove(); shareMyWeek();">📲 Share my week</button>' +
    '<button class="btn-link" onclick="document.getElementById(\'weekly-modal\').remove()">Close</button>' +
    '</div></div>';
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
}

// ─────────────────────────────────────────────────────────────
// STREAK CELEBRATION
// ─────────────────────────────────────────────────────────────
function showStreakCelebration(streak) {
  const milestones = {
    3:  { title: '3-Day Streak!',  sub: 'The habit is forming. Don\'t break it now!' },
    7:  { title: '7-Day Streak!',  sub: 'A full week of discipline. You\'re built different.' },
    14: { title: '14-Day Streak!', sub: 'Two weeks. This is who you are now.' },
    21: { title: '21-Day Streak!', sub: '21 days — the habit is permanently yours.' },
    30: { title: '30-Day Streak!', sub: 'A full month. You are UNSTOPPABLE.' }
  };
  const m = milestones[streak];
  if (!m) return;

  const emojis = ['','','','','','','','','',''];
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

// Celebrate hitting 100% momentum — you reached the summit of "Your Climb"
function showSummitCelebration() {
  const cols = ['#fb923c', '#ef4444', '#a855f7', '#fbbf24', '#3b82f6'];
  let conf = '';
  for (let i = 0; i < 34; i++) {
    const left = Math.random() * 100, delay = Math.random() * 1.8, dur = 2.2 + Math.random() * 2.2, w = 7 + Math.random() * 8;
    conf += '<div class="conf-p" style="left:' + left + '%;width:' + w + 'px;height:' + (w * 1.5) + 'px;background:' + cols[i % cols.length] + ';border-radius:2px;animation-delay:' + delay + 's;animation-duration:' + dur + 's"></div>';
  }
  const el = document.createElement('div');
  el.className = 'celebration-overlay';
  el.onclick = () => el.remove();
  el.innerHTML = conf +
    '<div class="celeb-box">' +
    '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;display:block"><path d="M5 21V4l11 3.5L5 11"/></svg>' +
    '<div class="celeb-title">Summit reached</div>' +
    '<div class="celeb-sub">100% momentum — every pillar firing at once. This is the top of your game.</div>' +
    '<div class="celeb-tap">tap anywhere to continue</div>' +
    '</div>';
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 6000);
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
// Entry point — gate the app behind a login session
async function init() {
  applyTheme();      // resolve Auto/Light/Dark and wire the OS-change listener
  paintNavIcons();   // fill the sidebar's line icons
  buildScene3d();   // animated 3D backdrop, behind every screen
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
    state.hasApiKey = ks.hasKey || !!aiKey();   // server env key OR a key saved in this browser
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
  if (!state.data.vocab)    state.data.vocab    = [];
  if (!state.data.weights)  state.data.weights  = [];
  ensureChecklistData();
  if (!state.data.profile.pillars) state.data.profile.pillars = defaultPillars();
  if (backfillBookData()) saveData(); // fill missing author/pages on saved books

  applyChartTheme();   // on-brand, theme-aware chart styling (guarded if Chart didn't load)

  wireNav();
  renderUserChip();
  applyNavVisibility();
  renderXPBar();
  if (!state.data.profile.onboarded && state.data.days.length === 0) showOnboarding();
  navigate('dashboard');
  maybeOpenPlanFromLink();   // tapped the "plan tomorrow's workout" push → open the planner
  showWeeklyReview();
  startReminderLoop();
}
// If the app was opened from the plan-tomorrow notification (./?plan=1), pop the planner.
function maybeOpenPlanFromLink() {
  try {
    const sp = new URLSearchParams(location.search);
    if (sp.get('plan') === '1') {
      history.replaceState(null, '', location.pathname);   // clean the URL so a refresh doesn't reopen it
      if (isPillarOn('gym')) setTimeout(openWorkoutPlanner, 450);
    }
  } catch {}
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
    '<div class="auth-card auth-card--hero">' +
    '<div class="auth-hero">' +
    '<div class="auth-hero-sun"></div>' +
    '<svg class="auth-hero-mtn" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">' +
    '<polygon points="0,120 70,58 130,96 200,40 270,92 340,54 400,88 400,120" fill="#34C48E" opacity="0.5"></polygon>' +
    '<polygon points="0,120 60,84 140,107 220,72 300,105 370,82 400,99 400,120" fill="#0F8A63"></polygon>' +
    '<line x1="200" y1="42" x2="200" y2="23" stroke="#0B3D2E" stroke-width="3"></line>' +
    '<polygon points="200,23 227,30 200,37" fill="#F97316"></polygon>' +
    '</svg>' +
    '<div class="auth-hero-top"><span class="auth-logo-mark">▲</span><span class="auth-logo-word">Onward</span></div>' +
    '<div class="auth-hero-copy">' +
    '<h1 class="auth-headline">Build the life<br>you want.</h1>' +
    '<p class="auth-tagline">Fitness, money, reading &amp; habits — tracked in 30 seconds a day, with an AI coach.</p>' +
    '</div></div>' +
    '<div class="auth-body">' +
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
      ? '<details class="auth-recovery"><summary>+ Add password recovery <span>(optional)</span></summary>' +
        '<div class="auth-field"><label>Security question</label>' +
        '<select id="auth-secq">' + SECURITY_QUESTIONS.map(q => '<option value="' + escapeHtml(q) + '">' + escapeHtml(q) + '</option>').join('') + '</select></div>' +
        '<div class="auth-field"><label>Your answer</label>' +
        '<input type="text" id="auth-seca" autocomplete="off" placeholder="So you can reset your password later"></div>' +
        '<div class="auth-recovery-note">Lets you reset your password if you forget it. You can also add this anytime in Settings.</div>' +
        '</details>'
      : '') +
    '<div class="auth-error" id="auth-error"></div>' +
    '<div class="auth-status" id="auth-status" style="display:none"></div>' +
    '<button type="submit" class="btn btn-primary auth-submit">' + (isSignup ? 'Create Account' : '→ Log In') + '</button>' +
    (!isSignup ? '<div class="auth-forgot"><button type="button" class="btn-link" onclick="renderForgotScreen()">Forgot password?</button></div>' : '') +
    '</form>' +
    '<div class="auth-foot">' +
    (isSignup ? 'Already have an account? <button class="btn-link" onclick="renderAuthScreen(\'login\')">Log in</button>'
              : 'New here? <button class="btn-link" onclick="renderAuthScreen(\'signup\')">Create an account</button>') +
    '<div class="auth-note">Your account is private — only you can see your data.</div>' +
    '<div style="margin-top:10px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap">' +
    '<button type="button" class="btn-link" onclick="startDemo()">See a live demo</button>' +
    '<a class="btn-link" href="about.html">What is Onward? →</a></div>' +
    '</div>' +
    '</div></div>';
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
  const slow = setTimeout(() => authStatus('Waking up the server… the first visit can take up to a minute on the free plan. Hang tight.'), 3500);
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
        if (attempt < 2) { authStatus('Still waking up… retrying.'); await new Promise(r => setTimeout(r, 2000)); }
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
    showToast('Welcome back, ' + j.username + '! ', 'success');
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
  // Password recovery is optional — no blocking popup. You can add it later in Settings.
  authError(''); if (btn) btn.disabled = true;
  try {
    const res = await authFetch('/api/signup', { username, password, email, phone, securityQuestion, securityAnswer });
    const j = await res.json();
    if (!res.ok) { authError(j.error || 'Sign up failed.'); return; }
    state.token = j.token; state.user = j.username; state.hasSecurity = !!j.hasSecurity; localStorage.setItem('be_token', j.token);
    await startApp();
    showToast('Account created — welcome, ' + j.username + '! ', 'success');
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
    '<div class="auth-brand"><span class="brand-icon"></span><div>' +
    '<div class="auth-title">Reset Password</div><div class="auth-sub">Answer your security question</div></div></div>' +
    (f.step === 1
      ? '<form id="auth-form" onsubmit="forgotFindAccount(event)">' +
        '<div class="auth-field"><label>Username</label>' +
        '<input type="text" id="forgot-username" autocomplete="username" placeholder="Your username" autofocus></div>' +
        '<div class="auth-error" id="auth-error"></div>' +
        '<button type="submit" class="btn btn-primary auth-submit">Continue →</button>' +
        '</form>'
      : '<form id="auth-form" onsubmit="forgotReset(event)">' +
        '<div class="forgot-q">' + escapeHtml(f.question) + '</div>' +
        '<div class="auth-field"><label>Your answer</label>' +
        '<input type="text" id="forgot-answer" autocomplete="off" placeholder="Your answer" autofocus></div>' +
        '<div class="auth-field"><label>New password</label>' +
        '<input type="password" id="forgot-newpass" autocomplete="new-password" placeholder="At least 6 characters"></div>' +
        '<div class="auth-error" id="auth-error"></div>' +
        '<button type="submit" class="btn btn-primary auth-submit">Reset Password</button>' +
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
    showToast('Password reset! Log in with your new password. ', 'success');
  } catch { authError('Could not reach the server.'); }
}

// ─────────────────────────────────────────────────────────────
// SECURITY CARD (Settings) — change password + set security question
// ─────────────────────────────────────────────────────────────
function renderSecurityCard() {
  const hasSec = state.hasSecurity;
  return '<div class="card">' +
    '<h3 class="card-title">Security & Password</h3>' +
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
    showToast('Password updated ', 'success');
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
    showToast('Security question saved ', 'success');
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
    '<button class="user-logout" onclick="logout()" title="Log out"></button>';
  footer.prepend(chip);
}

// Hide nav items whose pillar is turned off (Knowledge ↔ reading pillar)
function applyNavVisibility() {
  const knowledgeNav = document.querySelector('.nav-item[data-page="knowledge"]');
  if (knowledgeNav) knowledgeNav.style.display = isPillarOn('reading') ? '' : 'none';
  const adminNav = document.querySelector('.nav-item[data-page="admin"]');   // owner-only console
  if (adminNav) adminNav.style.display = state.isOwner ? '' : 'none';
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────
// Cohesive line-icon set for the sidebar + mobile "More" sheet (stroke = currentColor,
// so they inherit the theme and the active-item colour automatically).
const NAV_ICONS = {
  dashboard: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  stats:     '<path d="M3 20h18"/><path d="M6 20v-6"/><path d="M12 20V6"/><path d="M18 20v-9"/>',
  log:       '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 9v6M9 12h6"/>',
  checklist: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l2.6 2.6L16 9"/>',
  health:    '<path d="M20.8 8.6a5 5 0 0 0-8.8-2.6A5 5 0 0 0 3.2 8.6C3.2 14 12 20 12 20s8.8-6 8.8-11.4z"/>',
  business:  '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  knowledge: '<path d="M12 6.4C10.5 5.4 8 5 4 5v13c4 0 6.5.4 8 1.6"/><path d="M12 6.4C13.5 5.4 16 5 20 5v13c-4 0-6.5.4-8 1.6z"/>',
  community: '<circle cx="9" cy="8" r="3.2"/><path d="M3.6 20a5.6 5.6 0 0 1 10.8 0"/><path d="M16.5 5.3a3.2 3.2 0 0 1 0 6"/><path d="M18.6 20a5.6 5.6 0 0 0-2.4-4.4"/>',
  coach:     '<path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.6L3 21l1.9-5.8A8.5 8.5 0 1 1 21 11.5z"/>',
  history:   '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  settings:  '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.5M12 19v2.5M4.4 7l2.1 1.2M17.5 15.8l2.1 1.2M4.4 17l2.1-1.2M17.5 8.2l2.1-1.2"/>',
  admin:     '<path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4.5"/>'
};
function navIconSVG(page) {
  const p = NAV_ICONS[page];
  return p ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>' : '';
}
function paintNavIcons() {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(a => {
    const ic = a.querySelector('.nav-icon');
    if (ic && !ic.firstChild) ic.innerHTML = navIconSVG(a.dataset.page);
  });
}

function navigate(page) {
  if (page === 'admin' && !state.isOwner) page = 'dashboard';   // owner-only console (the server also enforces this)
  state.page = page;
  if (page !== 'workout') document.body.classList.remove('wo-fullscreen');   // restore the bottom nav when leaving the workout
  state._openIdea = null;   // leaving to any page closes an open idea workspace
  if (page !== 'log') { state._editDayId = null; state._fullLog = false; state._guided = null; }
  Object.values(charts).forEach(c => c.destroy());
  charts = {};
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  // Sync the mobile bottom bar — highlight the matching tab, else "More"
  document.querySelectorAll('.bnav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  const moreBtn = document.getElementById('bnav-more');
  if (moreBtn) moreBtn.classList.toggle('active', !['dashboard', 'log', 'coach'].includes(page));
  document.getElementById('more-sheet')?.remove();
  // Ideas + Contacts live under the Business hub, so keep that nav item lit on their tabs
  if (['business', 'ideas', 'contacts'].includes(page)) document.querySelector('.nav-item[data-page="business"]')?.classList.add('active');
  // Reading lives under the Knowledge hub, so keep that nav item lit on its tab
  if (['knowledge', 'reading'].includes(page)) document.querySelector('.nav-item[data-page="knowledge"]')?.classList.add('active');
  const pages = { dashboard: renderDashboard, stats: renderStatsPage, log: renderLogEntry, workout: renderWorkout, business: renderBusinessPage, health: renderHealthPage, checklist: renderChecklistPage, contacts: renderContactsPage, ideas: renderIdeasPage, knowledge: renderKnowledgePage, reading: renderReadingPage, community: renderCommunityPage, coach: renderCoachPage, history: renderHistoryPage, settings: renderSettingsPage, admin: renderAdminPage };
  injectFAB();
  (pages[page] || renderDashboard)();
  // Subtle fade-up so section changes feel like a native screen transition
  const mainEl = document.getElementById('main');
  if (mainEl) { mainEl.classList.remove('page-anim'); void mainEl.offsetWidth; mainEl.classList.add('page-anim'); }
}

// Bind nav clicks once (sidebar + mobile bottom bar + the More button). Called
// from both the normal app start and the demo, so navigation works in both.
function wireNav() {
  if (state._navWired) return;
  state._navWired = true;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.page); }));
  document.querySelectorAll('.bnav-item[data-page]').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.page); }));
  document.getElementById('bnav-more')?.addEventListener('click', e => { e.preventDefault(); openMoreSheet(); });
}

// Mobile "More" sheet — the rest of the destinations (built from the live nav,
// so it respects which pillars are enabled), plus log out.
function openMoreSheet() {
  document.getElementById('more-sheet')?.remove();
  const items = [...document.querySelectorAll('.sidebar-nav .nav-item')]
    .filter(el => el.style.display !== 'none')
    .map(el => { const l = el.querySelector('span:not(.nav-icon):not(.nav-badge)'); return { page: el.dataset.page, label: (l || el).textContent.trim() }; });
  const sheet = document.createElement('div');
  sheet.id = 'more-sheet';
  sheet.className = 'more-sheet-overlay';
  sheet.innerHTML = '<div class="more-sheet">' +
    '<div class="more-sheet-grip"></div>' +
    '<div class="more-sheet-title">Go to</div>' +
    '<div class="more-grid">' +
    items.map(i => '<button type="button" class="more-item' + (i.page === state.page ? ' active' : '') + '" data-page="' + i.page + '"><span class="more-ico">' + navIconSVG(i.page) + '</span>' + escapeHtml(i.label) + '</button>').join('') +
    '</div>' +
    (state.user ? '<button type="button" class="more-logout" onclick="logout()">Log out</button>' : '') +
    '</div>';
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheet.addEventListener('click', e => {
    if (e.target === sheet) { sheet.remove(); return; }
    const btn = e.target.closest('.more-item');
    if (btn) navigate(btn.dataset.page); // navigate() removes the sheet
  });
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
    '<div class="auth-brand" style="justify-content:center"><span class="brand-icon"></span><div>' +
    '<div class="auth-title">Your free trial has ended</div><div class="auth-sub">Onward Pro</div></div></div>' +
    '<p style="color:var(--text-muted);line-height:1.6;margin:6px 0 18px">Keep your streak, your AI coach, and all your progress. Subscribe to unlock the full app.</p>' +
    '<div style="font-size:32px;font-weight:900;color:var(--text);line-height:1.1">' + escapeHtml(state.priceLabel || '$7.99/mo') + '</div>' +
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:20px">Cancel anytime</div>' +
    '<button class="btn btn-primary auth-submit" onclick="goSubscribe()">Subscribe</button>' +
    '<div class="auth-foot"><button class="btn-link" onclick="location.reload()">I just subscribed — refresh</button>' +
    '<div style="margin-top:10px"><button class="btn-link" onclick="logout()">Log out</button></div></div>' +
    '</div>';
  document.body.appendChild(s);
}
function renderTrialBanner() {
  const s = subStatus();
  if (!s.trialing) return '';
  return '<div class="trial-banner"><strong>' + s.daysLeft + ' day' + (s.daysLeft === 1 ? '' : 's') + ' left</strong> in your free trial' +
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
    '<h3 class="card-title">This ' + c.label + ' — money flow</h3>' +
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
// Convert a logged amount to grams. mL/L assume a liquid (≈ water density); oz is a weight ounce.
const FOOD_UNIT_G = { g: 1, ml: 1, l: 1000, oz: 28.35 };
function unitToGrams(qty, unit, food) {
  if (unit === 'serving') return qty * ((food && food.sg) || 100);
  return qty * (FOOD_UNIT_G[unit] || 1);
}
function foodUnitLabel(u) { return ({ g: 'g', ml: 'mL', l: 'L', oz: 'oz', serving: 'serving', meal: 'meal' })[u] || 'g'; }
function foodAmountLabel(x) {
  const u = x.unit || 'g';
  if (u === 'g') return x.grams + ' g';
  const qty = (x.qty != null ? x.qty : x.grams);
  // mL/L/meal (or anything with no gram weight) just show the count + unit
  return (u === 'ml' || u === 'l' || u === 'meal' || !x.grams)
    ? (qty + ' ' + foodUnitLabel(u))
    : (qty + ' ' + foodUnitLabel(u) + ' · ' + x.grams + 'g');
}
// Mobile-friendly food search — custom suggestion dropdown (native <datalist>
// barely works on phones). Filters by name, shows macros, taps to fill.
function searchFoods(query, limit) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const starts = [], incl = [];
  for (const f of FOOD_DB) {
    const n = f.n.toLowerCase();
    if (n.startsWith(q)) starts.push(f);
    else if (n.includes(q)) incl.push(f);
  }
  return starts.concat(incl).slice(0, limit || 8);
}
let _foodSuggestMatches = [];
function renderFoodSuggest() {
  const wrap = document.getElementById('food-suggest');
  if (!wrap) return;
  const q = (document.getElementById('food-pick')?.value || '').trim();
  const matches = q ? searchFoods(q, 8) : [];
  _foodSuggestMatches = matches;
  if (!matches.length) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  wrap.innerHTML = matches.map((f, i) =>
    '<button type="button" class="bs-row" onclick="pickFoodSuggestion(' + i + ')">' +
    '<span class="bs-info"><span class="bs-title">' + escapeHtml(f.n) + '</span>' +
    '<span class="bs-author">' + f.k + ' cal · ' + f.p + 'g P · ' + f.c + 'g C · ' + f.f + 'g F <span style="opacity:.65">per 100g</span></span></span>' +
    '</button>'
  ).join('');
  wrap.style.display = 'block';
}
function pickFoodSuggestion(i) {
  const f = _foodSuggestMatches && _foodSuggestMatches[i];
  if (!f) return;
  const pick = document.getElementById('food-pick');
  const qty = document.getElementById('food-qty');
  const unit = document.getElementById('food-unit');
  if (pick) pick.value = f.n;
  if (unit) unit.value = 'g';
  if (qty && !qty.value) qty.value = f.sg || 100; // sensible default = one serving
  hideFoodSuggest();
  if (qty) { qty.focus(); try { qty.select(); } catch (e) {} }
}
function hideFoodSuggest() {
  const wrap = document.getElementById('food-suggest');
  if (wrap) { wrap.innerHTML = ''; wrap.style.display = 'none'; }
}
function onFoodSearch() { renderFoodSuggest(); }
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
// Calories in one typical serving of a food (sg grams at k cal/100g)
function foodByName(n) { return FOOD_DB.find(f => f.n === n); }
function servingCal(f) { return f ? Math.round(f.k * f.sg / 100) : 0; }
// Build a concrete example plate for a meal: real foods (whole servings) from
// FOOD_DB chosen to land near the calorie target, each with its own calories.
// Protein-first (the app's muscle bias). Returns { items:[{name,servings,cal}], total }.
// Pure + testable.
function mealExample(label, targetCal) {
  const l = (label || '').toLowerCase();
  const target = Math.max(120, +targetCal || 0);
  let groups;
  if (/breakfast/.test(l)) {
    groups = [['Egg, whole', 'Greek yogurt, nonfat', 'Whey protein powder'], ['Oats, dry', 'Bread, whole wheat', 'Bagel'], ['Banana', 'Blueberries', 'Strawberries'], ['Peanut butter', 'Almonds']];
  } else if (/snack/.test(l)) {
    groups = [['Greek yogurt, nonfat', 'Cottage cheese, low-fat', 'String cheese (mozzarella)', 'Whey protein powder'], ['Apple', 'Banana', 'Grapes'], ['Almonds', 'Peanuts', 'Hummus']];
  } else { // lunch / dinner / generic
    groups = [['Chicken breast (cooked)', 'Salmon (cooked)', 'Lean beef steak (cooked)', 'Tilapia (cooked)'], ['Rice, brown (cooked)', 'Potato (baked)', 'Sweet potato (cooked)', 'Quinoa (cooked)'], ['Broccoli (cooked)', 'Green beans (cooked)', 'Spinach (raw)'], ['Avocado', 'Olive oil']];
  }
  const items = [];
  let total = 0;
  for (const g of groups) {                       // one serving from each block, in order
    const f = g.map(foodByName).find(Boolean);
    if (!f) continue;
    const c = servingCal(f);
    if (total + c > target * 1.15 && items.length >= 2) break;
    items.push({ name: f.n, servings: 1, cal: c });
    total += c;
  }
  const order = [0, 1, 0, 1, 2];                   // top up protein, then carb, then produce
  for (let oi = 0; oi < order.length && total < target * 0.9; oi++) {
    const it = items[order[oi]];
    if (!it || it.servings >= 3) continue;
    const c = servingCal(foodByName(it.name));
    if (total + c > target * 1.12) continue;
    it.servings += 1; it.cal += c; total += c;
  }
  return { items, total };
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

// Healthiest split by meal: Breakfast ~25–30% (morning energy), Lunch ~35–40%
// (the day's main fuel), Dinner ~30–35% (recovery, not too heavy at night),
// snacks light. Calories + every macro follow the same share, so each meal's
// targets are consistent and add up to the day. Returns a per-meal plan.
function mealCalWeight(label) {
  const l = (label || '').toLowerCase();
  if (/breakfast/.test(l)) return 0.28;
  if (/lunch/.test(l)) return 0.38;
  if (/dinner/.test(l)) return 0.34;
  if (/snack/.test(l)) return 0.12;
  return 1; // generic "Meal N" → even share
}
function distributeMeals(totalCal, totalP, totalC, totalF, labels) {
  const ls = (labels && labels.length) ? labels : ['Meal 1'];
  const w = ls.map(mealCalWeight);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return ls.map((label, i) => {
    const frac = w[i] / sum;
    return {
      label,
      calories: Math.round(totalCal * frac),
      protein: Math.round(totalP * frac),
      carbs: Math.round(totalC * frac),
      fat: Math.round(totalF * frac)
    };
  });
}
// What to actually put on the plate at each meal (the plate method)
function mealPlateHint(label) {
  const l = (label || '').toLowerCase();
  if (/breakfast/.test(l)) return '25–30g protein + fruit + whole-grain carb';
  if (/lunch/.test(l)) return '½ plate veggies · ¼ protein · ¼ carbs';
  if (/dinner/.test(l)) return 'Like lunch, a little lighter';
  if (/snack/.test(l)) return 'Protein + fruit or nuts';
  return 'Protein + veg/fruit + healthy carb + healthy fat';
}
// Friendly "what should I be eating right now" hint from the meal plan + clock.
// Returns '' when nutrition isn't set up. Reuses currentMealIndex (windows 7–21)
// so it matches the Log page's meal focus. Used in the guided log + Quick Log.
function mealNowHint(now) {
  const nut = getNutrition();
  if (!nut || !nut.meals || !nut.meals.plan || !nut.meals.plan.length) return '';
  const d = now || new Date();
  const hour = d.getHours();
  const i = currentMealIndex(nut.meals.count, hour);
  const m = nut.meals.plan[i];
  if (!m) return '';
  const eyebrow = hour < 7 ? 'Up next' : hour >= 21 ? 'Last meal — keep it light' : 'Eat now';
  const eg = mealExample(m.label, m.calories);
  const clean = n => n.replace(/\s*\(.*?\)/g, '');     // drop "(cooked)" etc. for display
  const rows = eg.items.map(it =>
    '<div class="mn-eg-row"><span>' + escapeHtml(clean(it.name)) + (it.servings > 1 ? ' <em>×' + it.servings + '</em>' : '') +
    '</span><span>' + it.cal.toLocaleString() + ' cal</span></div>').join('');
  return '<div class="meal-now">' +
    '<div class="mn-eyebrow">🍽️ ' + eyebrow + '</div>' +
    '<div class="mn-meal">' + escapeHtml(m.label) + '</div>' +
    '<div class="mn-macros">Aim ~' + (m.calories || 0).toLocaleString() + ' cal · ' + (m.protein || 0) + 'g protein</div>' +
    (rows ? '<div class="mn-eg">' + rows +
      '<div class="mn-eg-row mn-eg-total"><span>Example plate</span><span>≈ ' + eg.total.toLocaleString() + ' cal</span></div></div>' : '') +
    '<div class="mn-plate">' + escapeHtml(mealPlateHint(m.label)) + '</div>' +
    '</div>';
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
  const mealsPerDay = Math.max(1, Math.min(12, parseInt(n.mealsPerDay) || 3)); // any number of meals

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
    plan: distributeMeals(calories, protein.g, carbs.g, fat.g, mealLabels(mealsPerDay)),
    // even-split fallbacks (kept for older callers)
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
// The daily calorie + macro target, split across the number of meals they chose
function renderMealPlan(nut) {
  if (!nut || !nut.meals || !nut.meals.plan) return '';
  const m = nut.meals;
  return '<div class="meal-plan">' +
    '<div class="meal-plan-head">Your ' + m.count + '-meal plan — lunch is the biggest (main fuel), breakfast lighter, dinner moderate</div>' +
    '<div class="meal-plan-grid">' +
    m.plan.map(function (mm) {
      return '<div class="meal-plan-card">' +
        '<div class="mpc-name">' + escapeHtml(mm.label) + '</div>' +
        '<div class="mpc-cal">' + mm.calories.toLocaleString() + ' <span>cal</span></div>' +
        '<div class="mpc-macros"><b class="mp">' + mm.protein + 'g</b> P · <b class="mc">' + mm.carbs + 'g</b> C · <b class="mf">' + mm.fat + 'g</b> F</div>' +
        '<div class="mpc-plate">' + mealPlateHint(mm.label) + '</div>' +
        '</div>';
    }).join('') +
    '</div>' +
    '<div class="meal-plan-note">At <b>every</b> meal: a palm of <b>protein</b>, ½ plate <b>veg or fruit</b>, a fist of <b>healthy carbs</b> (rice, oats, potatoes, whole grains), a thumb of <b>healthy fats</b> (nuts, olive oil, avocado).</div>' +
    '</div>';
}
// Which meal is "now" — spread the meals across the waking window (testable)
function currentMealIndex(count, hour, startHour, endHour) {
  const c = count || 1;
  const s = (startHour == null) ? 7 : startHour, e = (endHour == null) ? 21 : endHour;
  if (hour < s) return 0;
  if (hour >= e) return c - 1;
  const slot = Math.floor((hour - s) / ((e - s) / c));
  return Math.max(0, Math.min(c - 1, slot));
}
// Time-aware "what to eat right now" banner on the Log page
function renderMealFocus(nut) {
  if (!nut || !nut.meals || !nut.meals.plan || !nut.meals.plan.length) return '';
  const count = nut.meals.count;
  const i = currentMealIndex(count, new Date().getHours());
  const pm = nut.meals.plan[i];
  const label = pm.label;
  const today = state.data.days.find(d => d.date === todayStr());
  const log = (state.page === 'log' && state._foodLog) ? state._foodLog : ((today && today.foodLog) || []);
  const t = foodLogTotals(log.filter(x => Math.min(Math.max(0, x.meal || 0), count - 1) === i));
  const calLeft = Math.max(0, pm.calories - Math.round(t.kcal));
  const pLeft = Math.max(0, pm.protein - Math.round(t.p));
  const done = t.kcal >= pm.calories * 0.9;
  const body = done
    ? escapeHtml(label) + ' is on point — ' + Math.round(t.kcal).toLocaleString() + ' / ' + pm.calories.toLocaleString() + ' cal logged. Nice.'
    : (t.kcal > 0
      ? '<b>' + calLeft.toLocaleString() + ' cal</b> and <b>' + pLeft + 'g protein</b> left for ' + escapeHtml(label.toLowerCase()) + ' — ' + mealPlateHint(label) + '.'
      : 'Aim for <b>' + pm.calories.toLocaleString() + ' cal · ' + pm.protein + 'g protein</b> — ' + mealPlateHint(label) + '.');
  return '<div class="meal-focus">' +
    '<div class="mf-now">Right now · ' + escapeHtml(label) + '</div>' +
    '<div class="mf-line">' + body + '</div>' +
    (done ? '' : '<button type="button" class="btn btn-primary btn-sm mf-btn" onclick="focusMeal(' + i + ')">Log ' + escapeHtml(label.toLowerCase()) + '</button>') +
    '</div>';
}
function focusMeal(i) {
  const sel = document.getElementById('food-meal');
  if (sel) sel.value = String(i);
  document.querySelector('.food-logger')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const pick = document.getElementById('food-pick');
  if (pick) setTimeout(() => pick.focus(), 300);
}
function renderLogNutritionSection(eatenVal) {
  const nut = getNutrition();
  if (!nut) {
    return '<div class="nut-target-banner nut-target-empty">' +
      '<span>Set up your calorie & macro targets to track what you eat</span>' +
      '<button type="button" class="btn-link" onclick="navigate(\'settings\')">Set up →</button>' +
      '</div>';
  }
  const totals = foodLogTotals(state._foodLog);
  const initEaten = totals.kcal > 0 ? Math.round(totals.kcal) : (parseFloat(eatenVal) || 0);
  // Which meal new foods are added to (each meal is logged on its own below)
  if (state._activeMeal == null || state._activeMeal < 0 || state._activeMeal >= nut.meals.count) state._activeMeal = currentMealIndex(nut.meals.count, new Date().getHours());
  const activeMealName = nut.meals.labels[state._activeMeal] || ('Meal ' + (state._activeMeal + 1));
  // Food search uses a custom suggestion dropdown (renderFoodSuggest), not a native datalist
  // Quick-add chips from foods you've logged before
  state._recentFoods = getRecentFoods(8);
  const recentRow = state._recentFoods.length
    ? '<div class="recent-foods"><span class="recent-foods-label">Quick add</span>' +
      state._recentFoods.map((f, i) => '<button type="button" class="recent-chip" onclick="quickAddRecent(' + i + ')">' + escapeHtml(f.name) + ' <b>' + f.grams + 'g</b></button>').join('') +
      '</div>'
    : '';

  return '<div class="today-section nut-section">' +
    '<div class="today-section-header nut-header">Nutrition</div>' +
    '<div class="nut-target-line">' +
    '<span><b>Target:</b> ' + nut.calories.toLocaleString() + ' cal · ' +
    '<b class="mp">' + nut.protein.g + 'g</b> P · <b class="mc">' + nut.carbs.g + 'g</b> C · <b class="mf">' + nut.fat.g + 'g</b> F · ' +
    nut.meals.count + ' meals (~' + nut.meals.calories.toLocaleString() + ' cal each)</span>' +
    '<button type="button" class="btn-link" onclick="navigate(\'settings\')">Edit</button>' +
    '</div>' +
    renderMealPlan(nut) +
    renderMealFocus(nut) +

    // Food logger
    '<div class="food-logger">' +
    '<label class="food-logger-label">What did you eat? <span style="font-weight:400;color:var(--text-muted)">Log each meal on its own — we\'ll total it all at the end</span></label>' +
    '<div class="food-active-line">Adding to <b id="food-active-meal">' + escapeHtml(activeMealName) + '</b> · pick a meal with “+ Add food” below</div>' +
    '<div class="food-add-row">' +
    '<input type="text" id="food-pick" placeholder="Search a food (e.g. chicken breast)…" autocomplete="off" oninput="onFoodSearch()" onfocus="onFoodSearch()" onblur="setTimeout(hideFoodSuggest, 200)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();document.getElementById(\'food-qty\').focus();}">' +
    '<input type="number" id="food-qty" min="0" step="1" placeholder="amount" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addFoodToLog();}">' +
    '<select id="food-unit"><option value="g">grams</option><option value="ml">mL</option><option value="l">litres</option><option value="oz">oz</option><option value="serving">serving(s)</option></select>' +
    '<button type="button" class="btn btn-outline food-add-btn" onclick="addFoodToLog()">+ Add</button>' +
    '<button type="button" class="btn btn-outline food-ai-btn" id="food-ai-btn" onclick="estimateFoodWithAI()" title="Estimate macros with AI for any food">AI</button>' +
    '</div>' +
    '<div id="food-suggest" class="book-suggest"></div>' +
    '<div class="food-ai-hint">Not in the list? Type any food (e.g. "homemade chicken burrito") and hit AI to estimate it.</div>' +
    recentRow +
    renderMyMealsRow() +
    '<div id="food-log-list">' + renderFoodLogByMeal() + '</div>' +
    '<div id="food-log-totals">' + renderFoodLogTotals() + '</div>' +
    '</div>' +

    '<div class="form-group" style="margin-top:14px"><label>Calories eaten today <span style="font-weight:400;color:var(--text-muted)">(auto-filled from foods above — or type your own)</span></label>' +
    '<input type="number" id="calories-eaten" min="0" step="10" placeholder="e.g. 2200" value="' + (initEaten || '') + '" oninput="updateCaloriesRemaining()" style="font-size:20px;font-weight:800;max-width:200px"></div>' +
    '<div id="cal-remaining">' + calRemainingHtml(initEaten, nut.calories) + '</div>' +
    '</div>';
}

// Which meal the add-row is currently targeting (each meal is logged separately)
function currentMeal() {
  if (typeof state._activeMeal === 'number' && state._activeMeal >= 0) return state._activeMeal;
  const nut = getNutrition();
  return nut && nut.meals ? currentMealIndex(nut.meals.count, new Date().getHours()) : 0;
}
// Focus a specific meal to log foods into it, then scroll to the search box
function setActiveMeal(i) {
  state._activeMeal = i;
  refreshFoodLog();
  const nut = getNutrition();
  const nm = document.getElementById('food-active-meal');
  if (nm && nut) nm.textContent = (nut.meals.labels[i] || ('Meal ' + (i + 1)));
  const pick = document.getElementById('food-pick');
  if (pick) { try { pick.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {} setTimeout(() => pick.focus(), 220); }
}
// One food row
function foodItemRow(x) {
  return '<div class="food-item">' +
    '<div class="fi-name">' + escapeHtml(x.name) + '</div>' +
    '<div class="fi-amt">' + foodAmountLabel(x) + '</div>' +
    '<div class="fi-macros"><b>' + x.kcal + '</b> cal · <b class="mp">' + x.p + 'g</b> · <b class="mc">' + x.c + 'g</b> · <b class="mf">' + x.f + 'g</b></div>' +
    '<button type="button" class="fi-remove" onclick="removeFoodFromLog(\'' + x.id + '\')" title="Remove">✕</button>' +
    '</div>';
}
// Render the food log grouped into the meals the user chose (Breakfast, Lunch…),
// each meal showing its own foods + running total vs that meal's target.
function renderFoodLogByMeal() {
  const log = state._foodLog || [];
  const nut = getNutrition();
  const count = (nut && nut.meals && nut.meals.count) ? nut.meals.count : 1;
  const labels = (nut && nut.meals) ? nut.meals.labels : ['Meals'];
  const plan = (nut && nut.meals && nut.meals.plan) ? nut.meals.plan : null;
  const slotOf = x => Math.min(Math.max(0, x.meal || 0), count - 1);
  let html = '';
  for (let i = 0; i < count; i++) {
    const foods = log.filter(x => slotOf(x) === i);
    const t = foodLogTotals(foods);
    const pm = plan ? plan[i] : null; // this meal's own target (healthiest split)
    const calStr = Math.round(t.kcal) + (pm ? ' / ' + pm.calories : '') + ' cal';
    const pStr = Math.round(t.p) + (pm ? ' / ' + pm.protein : '') + 'g P';
    const over = pm && t.kcal > pm.calories * 1.05;
    const name = labels[i] || ('Meal ' + (i + 1));
    const active = i === state._activeMeal;
    html += '<div class="meal-slot' + (active ? ' meal-slot-active' : '') + '">' +
      '<div class="meal-slot-head">' +
      '<span class="ms-name">' + escapeHtml(name) + (active ? ' <span class="ms-adding">adding</span>' : '') + '</span>' +
      '<span class="ms-total' + (over ? ' is-over' : '') + '">' + calStr + ' · <b class="mp">' + pStr + '</b></span>' +
      '</div>' +
      (foods.length
        ? '<div class="meal-slot-foods">' + foods.map(foodItemRow).join('') + '</div>'
        : '<div class="meal-slot-empty">Nothing logged for ' + escapeHtml(name) + ' yet.</div>') +
      '<button type="button" class="ms-add" onclick="setActiveMeal(' + i + ')">+ Add food to ' + escapeHtml(name) + '</button>' +
      '</div>';
  }
  return html;
}

// Instant, rule-based nutrition coaching based on what they've eaten vs. their targets
function nutritionAdvice(eaten, nut) {
  if (!nut || !nut.calories) return '';
  const kcal = eaten.kcal || 0, p = eaten.p || 0, c = eaten.c || 0, f = eaten.f || 0;
  const pG = nut.protein.g, cG = nut.carbs.g, fG = nut.fat.g;
  const calLeft = Math.round(nut.calories - kcal);
  const pLeft = Math.round(pG - p);
  const calPct = kcal / nut.calories;
  const pPct = pG ? p / pG : 1;
  if (calPct >= 1.08) return '' + Math.abs(calLeft) + ' cal over your target today — keep anything else light, and get a walk in.';
  if (calPct >= 0.95 && pPct >= 1) return 'Targets hit — calories and protein both on point. Strong day!';
  if (pPct >= 1 && calLeft > 50) return 'Protein goal hit (' + Math.round(p) + 'g)! You have ' + calLeft + ' cal left — keep it clean.';
  if (calPct >= 0.6 && pPct < 0.6) return 'Low on protein — only ' + Math.round(p) + 'g of ' + pG + 'g. Make your next bite protein-heavy: chicken, eggs, Greek yogurt, or a shake.';
  if (fG && f > fG * 1.25) return 'Over on fat (' + Math.round(f) + 'g of ' + fG + 'g) — favor lean protein & veggies the rest of the day.';
  if (cG && c > cG * 1.25 && pPct < 0.9) return 'Carbs are high (' + Math.round(c) + 'g) and protein is lagging — swap a carb for protein next meal.';
  if (calLeft > 0) return '' + calLeft + ' cal and ' + Math.max(0, pLeft) + 'g protein to go — aim for ~' + Math.max(5, Math.round(Math.max(0, pLeft) / 2)) + 'g protein next meal.';
  return '';
}
function renderFoodLogTotals() {
  const t = foodLogTotals(state._foodLog);
  if (!t.kcal) return '';
  const nut = getNutrition();
  const pTarget = nut ? nut.protein.g : 0;
  const advice = nutritionAdvice(t, nut);
  const nMeals = new Set((state._foodLog || []).map(x => x.meal || 0)).size;
  return '<div class="food-day-total">' +
    '<div class="fdt-label">Day total · ' + nMeals + ' meal' + (nMeals === 1 ? '' : 's') + ' logged</div>' +
    '<div class="fdt-nums"><b>' + Math.round(t.kcal).toLocaleString() + '</b>' + (nut ? ' / ' + nut.calories.toLocaleString() : '') + ' cal · ' +
    '<b class="mp">' + Math.round(t.p) + 'g</b> P' + (pTarget ? ' / ' + pTarget + 'g' : '') + ' · ' +
    '<b class="mc">' + Math.round(t.c) + 'g</b> C · <b class="mf">' + Math.round(t.f) + 'g</b> F</div>' +
    '</div>' +
    (advice ? '<div class="food-advice">' + advice + '</div>' : '');
}

function addFoodToLog() {
  const pick = document.getElementById('food-pick');
  const food = findFood(pick?.value);
  const qty = parseFloat(document.getElementById('food-qty')?.value) || 0;
  const unit = document.getElementById('food-unit')?.value || 'g';
  if (!food) { showToast('Pick a food from the list.', 'error'); return; }
  if (qty <= 0) { showToast('Enter an amount.', 'error'); return; }
  const grams = unitToGrams(qty, unit, food);
  const m = foodMacros(food, grams);
  if (!state._foodLog) state._foodLog = [];
  state._foodLog.push({ id: uid(), name: food.n, grams: Math.round(grams), unit, qty, kcal: m.kcal, p: m.p, c: m.c, f: m.f, meal: currentMeal() });
  if (pick) pick.value = '';
  const q = document.getElementById('food-qty'); if (q) q.value = '';
  refreshFoodLog();
  persistFoodNudgeState();
  if (pick) pick.focus();
}

async function estimateFoodWithAI() {
  const pick = document.getElementById('food-pick');
  const desc = (pick?.value || '').trim();
  if (!desc) { showToast('Type what you ate first (e.g. "homemade chicken burrito").', 'error'); return; }
  const btn = document.getElementById('food-ai-btn');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '…'; }
  // Fold any quantity the user entered into the description for the AI
  const qty = parseFloat(document.getElementById('food-qty')?.value) || 0;
  const unit = document.getElementById('food-unit')?.value || 'g';
  const description = qty > 0 ? desc + ' (' + qty + (unit === 'g' ? ' grams' : ' serving(s)') + ')' : desc;
  try {
    const res = await fetch('/api/estimate-food', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ description }) });
    const j = await res.json();
    if (!res.ok) {
      showToast(j.error === 'NO_KEY' ? 'Add your AI key in Settings to use AI estimates.' : (j.error || 'Estimate failed.'), 'error');
      return;
    }
    if (!state._foodLog) state._foodLog = [];
    state._foodLog.push({ id: uid(), name: j.name, grams: j.grams || 0, unit: 'g', qty: j.grams || 0, kcal: j.kcal, p: j.p, c: j.c, f: j.f, ai: true, meal: currentMeal() });
    if (pick) pick.value = '';
    const q = document.getElementById('food-qty'); if (q) q.value = '';
    refreshFoodLog();
    persistFoodNudgeState();
    showToast('Added "' + j.name + '" (AI estimate) ', 'success');
  } catch {
    showToast('Could not reach the server.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

function removeFoodFromLog(id) {
  state._foodLog = (state._foodLog || []).filter(x => x.id !== id);
  refreshFoodLog();
  persistFoodNudgeState();
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
  state._foodLog.push({ id: uid(), name: f.name, grams: f.grams, unit: f.unit, qty: f.qty, kcal: f.kcal, p: f.p, c: f.c, f: f.f, ai: f.ai, meal: currentMeal() });
  refreshFoodLog();
  persistFoodNudgeState();
  showToast('Added ' + f.name, 'success');
}

function refreshFoodLog() {
  const listEl = document.getElementById('food-log-list');
  const totEl = document.getElementById('food-log-totals');
  if (listEl) listEl.innerHTML = renderFoodLogByMeal();
  if (totEl) totEl.innerHTML = renderFoodLogTotals();
  const t = foodLogTotals(state._foodLog);
  const calEl = document.getElementById('calories-eaten');
  if (calEl && t.kcal > 0) calEl.value = Math.round(t.kcal);
  updateCaloriesRemaining();
}

// Keep a tiny, always-current snapshot of today's protein progress in the saved
// data, so the server can send an evening "you're short on protein" push even
// when the app is closed (and before the user does a full day-save).
function persistFoodNudgeState() {
  if (!state.data) return;
  const nut = getNutrition();
  const t = foodLogTotals(state._foodLog);
  state.data._todayNutrition = {
    date: todayStr(),
    eatenP: Math.round(t.p),
    targetP: nut ? nut.protein.g : 0,
    loggedFood: (state._foodLog || []).length > 0
  };
  // On the Log page, autosave persists the food log into today's entry too;
  // otherwise just save the snapshot.
  if (state.page === 'log' && document.getElementById('day-form')) scheduleAutosave();
  else saveData();
}

// ─────────────────────────────────────────────────────────────
// MY MEALS (personal saved meals) + COMMUNITY MEALS (shared feed)
// ─────────────────────────────────────────────────────────────
function macroLine(m) {
  return '<b>' + Math.round(m.kcal || 0) + '</b> cal · <b class="mp">' + Math.round(m.p || 0) + 'g</b> P · ' +
    '<b class="mc">' + Math.round(m.c || 0) + 'g</b> C · <b class="mf">' + Math.round(m.f || 0) + 'g</b> F';
}
// The "My meals" strip inside the food logger
function renderMyMealsRow() {
  const meals = state.data.meals || [];
  const chips = meals.slice(0, 12).map(m =>
    '<button type="button" class="meal-chip' + (m.photo ? ' has-photo' : '') + '" onclick="logMyMeal(\'' + m.id + '\')" title="Tap to log this meal">' +
    (m.photo ? '<img class="meal-chip-img" src="' + m.photo + '" alt="">' : '') +
    '<span class="meal-chip-text"><span class="meal-chip-name">' + escapeHtml(m.name) + '</span>' +
    '<span class="meal-chip-macros">' + Math.round(m.kcal || 0) + ' cal · ' + Math.round(m.p || 0) + 'p</span></span>' +
    '</button>').join('');
  return '<div class="my-meals" id="my-meals-row">' +
    '<div class="my-meals-head"><span class="recent-foods-label">My meals</span>' +
    '<div class="my-meals-actions">' +
    '<button type="button" class="btn-link" onclick="openMyMealForm()">＋ New</button>' +
    '<button type="button" class="btn-link" onclick="openCommunityMeals()">Community</button>' +
    (meals.length ? '<button type="button" class="btn-link" onclick="openManageMeals()">Manage</button>' : '') +
    '</div></div>' +
    (meals.length
      ? '<div class="meal-chips">' + chips + '</div>'
      : '<div class="my-meals-empty">Save a meal once (name + macros) and log it with one tap. Tap <b>＋ New</b>, or browse <b>Community</b>.</div>') +
    '</div>';
}
function refreshMyMeals() { const el = document.getElementById('my-meals-row'); if (el) el.outerHTML = renderMyMealsRow(); }

// Log a saved meal straight into today's food log
function logMyMeal(id) {
  const m = (state.data.meals || []).find(x => x.id === id);
  if (!m) return;
  if (!state._foodLog) state._foodLog = [];
  state._foodLog.push({ id: uid(), name: m.name, grams: 0, unit: 'meal', qty: 1, kcal: m.kcal, p: m.p, c: m.c, f: m.f, meal: currentMeal() });
  refreshFoodLog();
  persistFoodNudgeState();
  showToast('Logged ' + m.name, 'success');
}

// ── Meal builder: ingredient rows that auto-sum to the meal's macros ──
function blankIng() { return { id: uid(), name: '', amount: '', kcal: 0, p: 0, c: 0, f: 0 }; }
function mealDraftTotals() {
  return (state._mealDraft || []).reduce((t, x) => ({
    kcal: t.kcal + (+x.kcal || 0), p: t.p + (+x.p || 0), c: t.c + (+x.c || 0), f: t.f + (+x.f || 0)
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}
function renderIngredientRows() {
  return (state._mealDraft || []).map(x =>
    '<div class="ing-row">' +
    '<input class="ing-name" type="text" placeholder="Ingredient (e.g. banana)" value="' + escapeAttr(x.name) + '" oninput="updateIng(\'' + x.id + '\',\'name\',this.value)">' +
    '<input class="ing-amt" type="text" placeholder="amount" value="' + escapeAttr(x.amount) + '" oninput="updateIng(\'' + x.id + '\',\'amount\',this.value)">' +
    '<input class="ing-m" type="number" min="0" inputmode="numeric" placeholder="cal" value="' + (x.kcal || '') + '" oninput="updateIng(\'' + x.id + '\',\'kcal\',this.value)">' +
    '<input class="ing-m" type="number" min="0" inputmode="numeric" placeholder="P" value="' + (x.p || '') + '" oninput="updateIng(\'' + x.id + '\',\'p\',this.value)">' +
    '<input class="ing-m" type="number" min="0" inputmode="numeric" placeholder="C" value="' + (x.c || '') + '" oninput="updateIng(\'' + x.id + '\',\'c\',this.value)">' +
    '<input class="ing-m" type="number" min="0" inputmode="numeric" placeholder="F" value="' + (x.f || '') + '" oninput="updateIng(\'' + x.id + '\',\'f\',this.value)">' +
    '<button type="button" class="ing-x" title="Remove ingredient" onclick="removeIng(\'' + x.id + '\')">✕</button>' +
    '</div>').join('');
}
function updateIng(id, field, val) {
  const it = (state._mealDraft || []).find(x => x.id === id); if (!it) return;
  if (field === 'name' || field === 'amount') it[field] = val;
  else it[field] = Math.max(0, parseFloat(val) || 0);
  updateMealTotalLine();
}
function updateMealTotalLine() {
  const el = document.getElementById('mm-total'); if (!el) return;
  const t = mealDraftTotals();
  el.innerHTML = 'Meal total: <b>' + Math.round(t.kcal) + '</b> cal · <b class="mp">' + Math.round(t.p) + 'g</b> P · <b class="mc">' + Math.round(t.c) + 'g</b> C · <b class="mf">' + Math.round(t.f) + 'g</b> F';
}
function addIng() {
  state._mealDraft = state._mealDraft || [];
  state._mealDraft.push(blankIng());
  const el = document.getElementById('ing-rows'); if (el) el.innerHTML = renderIngredientRows();
  updateMealTotalLine();
}
function removeIng(id) {
  state._mealDraft = (state._mealDraft || []).filter(x => x.id !== id);
  if (!state._mealDraft.length) state._mealDraft.push(blankIng());
  const el = document.getElementById('ing-rows'); if (el) el.innerHTML = renderIngredientRows();
  updateMealTotalLine();
}
// Read an image File and downscale it to a small JPEG data URL, so meal photos
// stay tiny (~15–30 KB) — no file server needed, light to store and sync.
function fileToThumb(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('not an image')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const md = maxDim || 320;
        let w = img.width, h = img.height;
        if (w > h && w > md) { h = Math.round(h * md / w); w = md; }
        else if (h > md) { w = Math.round(w * md / h); h = md; }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL('image/jpeg', quality || 0.6)); } catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function renderMealPhotoControl() {
  if (state._mealPhoto) {
    return '<div class="mm-photo-preview"><img src="' + state._mealPhoto + '" alt="meal photo">' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="clearMealPhoto()">✕ Remove photo</button></div>';
  }
  return '<label class="btn btn-outline btn-sm mm-photo-btn">Add a photo' +
    '<input type="file" accept="image/*" style="display:none" onchange="onMealPhotoPick(this)"></label>';
}
async function onMealPhotoPick(input) {
  const file = input.files && input.files[0]; if (!file) return;
  try {
    showToast('Processing photo…', 'success');
    state._mealPhoto = await fileToThumb(file, 320, 0.6);
    const el = document.getElementById('mm-photo'); if (el) el.innerHTML = renderMealPhotoControl();
  } catch { showToast('Could not read that image — try another.', 'error'); }
}
function clearMealPhoto() {
  state._mealPhoto = null;
  const el = document.getElementById('mm-photo'); if (el) el.innerHTML = renderMealPhotoControl();
}
// Create-a-meal form (ingredient-by-ingredient; macros auto-sum)
function openMyMealForm() {
  document.getElementById('my-meal-modal')?.remove();
  state._mealDraft = [blankIng(), blankIng()];
  state._mealPhoto = null;
  const modal = document.createElement('div');
  modal.id = 'my-meal-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box meal-builder-box" style="max-width:600px;text-align:left">' +
    '<div class="modal-badge">New meal</div>' +
    '<p style="font-size:14px;color:var(--text-muted);margin-bottom:14px">Build a meal from its ingredients — we add up the macros for you. Put in the amount (e.g. "1 banana", "20 g") and fill in whatever you know; blanks count as zero.</p>' +
    '<div class="form-group"><label>Meal name <span style="color:var(--danger)">*</span></label>' +
    '<input type="text" id="mm-name" placeholder="e.g. Açaí bowl" autocomplete="off"></div>' +
    '<div id="ing-rows">' + renderIngredientRows() + '</div>' +
    '<button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="addIng()">＋ Add ingredient</button>' +
    '<div id="mm-total" class="mm-total"></div>' +
    '<div id="mm-photo" class="mm-photo">' + renderMealPhotoControl() + '</div>' +
    '<label class="mm-share"><input type="checkbox" id="mm-share"> Also share to Community so other members can use it</label>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'my-meal-modal\').remove()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveMyMeal()">Save meal</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  updateMealTotalLine();
  setTimeout(() => document.getElementById('mm-name')?.focus(), 50);
}
async function saveMyMeal() {
  const name = (document.getElementById('mm-name')?.value || '').trim();
  if (!name) { showToast('Give the meal a name.', 'error'); return; }
  const ings = (state._mealDraft || []).map(x => ({
    name: (x.name || '').trim().slice(0, 60), amount: (x.amount || '').trim().slice(0, 30),
    kcal: Math.max(0, Math.round(+x.kcal || 0)), p: Math.max(0, Math.round(+x.p || 0)),
    c: Math.max(0, Math.round(+x.c || 0)), f: Math.max(0, Math.round(+x.f || 0))
  })).filter(x => x.name || x.kcal || x.p || x.c || x.f);
  if (!ings.length) { showToast('Add at least one ingredient.', 'error'); return; }
  const t = ings.reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  const meal = { id: uid(), name: name.slice(0, 80), ingredients: ings, kcal: t.kcal, p: t.p, c: t.c, f: t.f, photo: state._mealPhoto || '' };
  const share = document.getElementById('mm-share')?.checked;
  if (!state.data.meals) state.data.meals = [];
  state.data.meals.unshift(meal);
  await saveData();
  document.getElementById('my-meal-modal')?.remove();
  showToast('Saved "' + meal.name + '" to My Meals', 'success');
  refreshMyMeals();
  if (share) shareMyMeal(meal.id);
}
async function deleteMyMeal(id) {
  state.data.meals = (state.data.meals || []).filter(x => x.id !== id);
  await saveData();
  document.getElementById('manage-meals-modal')?.remove();
  refreshMyMeals();
  showToast('Deleted.', 'success');
}
// Manage saved meals (share / delete)
function openManageMeals() {
  document.getElementById('manage-meals-modal')?.remove();
  const meals = state.data.meals || [];
  const modal = document.createElement('div');
  modal.id = 'manage-meals-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box" style="max-width:500px;text-align:left">' +
    '<div class="modal-badge">My meals</div>' +
    (meals.length ? '<div class="manage-list">' + meals.map(m =>
      '<div class="comm-item">' + (m.photo ? '<img class="comm-photo" src="' + m.photo + '" alt="">' : '') +
      '<div class="comm-main"><div class="comm-name">' + escapeHtml(m.name) + '</div>' +
      '<div class="comm-macros">' + macroLine(m) + '</div>' + ingredientLines(m) + '</div>' +
      '<div class="comm-actions">' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="shareMyMeal(\'' + m.id + '\')">Share</button>' +
      '<button type="button" class="comm-x" title="Delete" onclick="deleteMyMeal(\'' + m.id + '\')">✕</button>' +
      '</div></div>').join('') + '</div>'
      : '<p style="color:var(--text-muted);font-size:14px">No saved meals yet.</p>') +
    '<div style="display:flex;gap:10px;justify-content:space-between;margin-top:16px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'manage-meals-modal\').remove();openMyMealForm()">＋ New meal</button>' +
    '<button class="btn btn-primary" onclick="document.getElementById(\'manage-meals-modal\').remove()">Done</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
// Share one of my meals to the community feed (cloud only)
async function shareMyMeal(id) {
  const m = (state.data.meals || []).find(x => x.id === id);
  if (!m) return;
  try {
    const author = (state.data.profile && (state.data.profile.firstName || state.data.profile.name)) || state.user || '';
    const res = await fetch('/api/community/meals', { method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: m.name, kcal: m.kcal, p: m.p, c: m.c, f: m.f, ingredients: m.ingredients || [], photo: m.photo || '', author }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(j.error || 'Could not share — are you signed in and online?', 'error'); return; }
    showToast('Shared "' + m.name + '" to Community ', 'success');
  } catch { showToast('Could not reach the community (needs to be online).', 'error'); }
}

// ── Community feed ──
let _commTimer = null;
function debouncedCommunitySearch() { clearTimeout(_commTimer); _commTimer = setTimeout(loadCommunityMeals, 300); }
function openCommunityMeals() {
  document.getElementById('community-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'community-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box community-box" style="max-width:560px;text-align:left">' +
    '<div class="modal-badge">Community meals</div>' +
    '<p style="font-size:13px;color:var(--text-muted);margin:6px 0 12px">Meals shared by other members. Tap <b>Add</b> to copy one into your own meals, then log it any day. These are member-submitted — give the numbers a sanity check.</p>' +
    '<div class="food-add-row" style="margin-bottom:10px">' +
    '<input type="text" id="comm-q" placeholder="Search meals (e.g. oatmeal)…" autocomplete="off" oninput="debouncedCommunitySearch()">' +
    '<button type="button" class="btn btn-outline" onclick="loadCommunityMeals()">Search</button>' +
    '</div>' +
    '<div id="comm-list"><div class="my-meals-empty">Loading…</div></div>' +
    '<div style="display:flex;justify-content:flex-end;margin-top:14px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'community-modal\').remove()">Close</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  loadCommunityMeals();
}
async function loadCommunityMeals() {
  const listEl = document.getElementById('comm-list');
  if (!listEl) return;
  const q = (document.getElementById('comm-q')?.value || '').trim();
  listEl.innerHTML = '<div class="my-meals-empty">Loading…</div>';
  try {
    const res = await fetch('/api/community/meals?q=' + encodeURIComponent(q), { headers: authHeaders() });
    if (!res.ok) { listEl.innerHTML = '<div class="my-meals-empty">' + (res.status === 401 ? 'Please sign in to see community meals.' : 'Could not load — try again.') + '</div>'; return; }
    const j = await res.json();
    state._community = j.meals || [];
    listEl.innerHTML = renderCommunityList(state._community);
  } catch { listEl.innerHTML = '<div class="my-meals-empty">You appear to be offline.</div>'; }
}
// Expandable recipe breakdown (ingredient + amount + whatever macros are known)
function ingredientLines(m) {
  if (!m.ingredients || !m.ingredients.length) return '';
  const rows = m.ingredients.map(ig => {
    const parts = [];
    if (ig.kcal) parts.push(ig.kcal + ' cal');
    if (ig.p) parts.push(ig.p + 'g P');
    if (ig.c) parts.push(ig.c + 'g C');
    if (ig.f) parts.push(ig.f + 'g F');
    const amt = ig.amount ? ' <span class="ing-amt-tag">' + escapeHtml(ig.amount) + '</span>' : '';
    return '<li><b>' + escapeHtml(ig.name || 'item') + '</b>' + amt + (parts.length ? ' — ' + parts.join(' · ') : '') + '</li>';
  }).join('');
  const n = m.ingredients.length;
  return '<details class="comm-recipe"><summary>Recipe · ' + n + ' ingredient' + (n > 1 ? 's' : '') + '</summary><ul>' + rows + '</ul></details>';
}
function renderCommunityList(meals) {
  if (!meals.length) return '<div class="my-meals-empty">No shared meals yet. Be the first — save a meal and tick "share".</div>';
  return meals.map(m =>
    '<div class="comm-item">' +
    (m.photo ? '<img class="comm-photo" src="' + m.photo + '" alt="">' : '') +
    '<div class="comm-main"><div class="comm-name">' + escapeHtml(m.name) + '</div>' +
    '<div class="comm-macros">' + macroLine(m) + '</div>' +
    '<div class="comm-meta">by ' + escapeHtml(m.author || 'Someone') + (m.uses ? ' · used by ' + m.uses : '') + '</div>' +
    ingredientLines(m) + '</div>' +
    '<div class="comm-actions">' +
    '<button type="button" class="btn btn-primary btn-sm" onclick="addCommunityMeal(' + m.id + ')">＋ Add</button>' +
    (m.mine
      ? '<button type="button" class="comm-x" title="Remove" onclick="removeCommunityMeal(' + m.id + ')">✕</button>'
      : '<button type="button" class="comm-x comm-report" title="Report" onclick="reportCommunityMeal(' + m.id + ')">Report</button>') +
    '</div></div>'
  ).join('');
}
async function addCommunityMeal(id) {
  const m = (state._community || []).find(x => x.id === id);
  if (!m) return;
  if (!state.data.meals) state.data.meals = [];
  if (state.data.meals.some(x => (x.name || '').toLowerCase() === (m.name || '').toLowerCase())) { showToast('Already in your meals.', 'success'); return; }
  state.data.meals.unshift({ id: uid(), name: m.name, kcal: m.kcal, p: m.p, c: m.c, f: m.f, ingredients: m.ingredients || [], photo: m.photo || '', fromCommunity: true });
  await saveData();
  fetch('/api/community/meals/' + id + '/use', { method: 'POST', headers: authHeaders() }).catch(() => {});
  showToast('Added "' + m.name + '" to My Meals', 'success');
  refreshMyMeals();
}
async function reportCommunityMeal(id) {
  if (!confirm('Report this meal as wrong or inappropriate? It gets hidden automatically once enough members report it.')) return;
  fetch('/api/community/meals/' + id + '/report', { method: 'POST', headers: authHeaders() }).catch(() => {});
  showToast('Reported — thanks for keeping it clean.', 'success');
}
async function removeCommunityMeal(id) {
  if (!confirm('Remove this shared meal from the community?')) return;
  try {
    const res = await fetch('/api/community/meals/' + id, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) { showToast('Removed.', 'success'); loadCommunityMeals(); }
    else showToast('Could not remove.', 'error');
  } catch { showToast('Could not reach the server.', 'error'); }
}

// ─────────────────────────────────────────────────────────────
// COMMUNITY FEED — thoughts / training programs / meals
// ─────────────────────────────────────────────────────────────
const POST_TYPE_LABELS = { thought: 'Thought', program: 'Training program', meal: 'Meal' };
function composerFields(type) {
  if (type === 'program') {
    return '<input type="text" id="cf-title" class="cf-input" placeholder="Program name — e.g. Push / Pull / Legs" maxlength="120">' +
      '<div class="cf-row">' +
      '<input type="text" id="cf-goal" class="cf-input" placeholder="Goal — gain, lose, strength…" maxlength="40">' +
      '<input type="number" id="cf-days" class="cf-input" placeholder="Days/week" min="1" max="7">' +
      '</div>' +
      '<textarea id="cf-body" class="cf-input cf-area" placeholder="The program — days, exercises, sets × reps, notes…"></textarea>';
  }
  if (type === 'meal') {
    return '<input type="text" id="cf-title" class="cf-input" placeholder="Meal name — e.g. High-protein oats" maxlength="120">' +
      '<div class="cf-row cf-macros">' +
      '<input type="number" id="cf-kcal" class="cf-input" placeholder="Cal" min="0">' +
      '<input type="number" id="cf-p" class="cf-input" placeholder="Protein" min="0">' +
      '<input type="number" id="cf-c" class="cf-input" placeholder="Carbs" min="0">' +
      '<input type="number" id="cf-f" class="cf-input" placeholder="Fat" min="0">' +
      '</div>' +
      '<textarea id="cf-body" class="cf-input cf-area" placeholder="How to make it, why you like it, when you eat it…"></textarea>';
  }
  return '<textarea id="cf-body" class="cf-input cf-area" placeholder="Share a thought, a win, a question for the community…"></textarea>';
}
function setComposerType(type) {
  state._composerType = type;
  document.querySelectorAll('.cf-type').forEach(el => el.classList.toggle('active', el.dataset.t === type));
  const f = document.getElementById('cf-fields');
  if (f) f.innerHTML = composerFields(type);
}
async function submitCommunityPost() {
  const type = state._composerType || 'thought';
  const body = { type, author: state.user || '' };
  body.body = (document.getElementById('cf-body')?.value || '').trim();
  if (type !== 'thought') body.title = (document.getElementById('cf-title')?.value || '').trim();
  if (type === 'program') { body.goal = document.getElementById('cf-goal')?.value || ''; body.daysPerWeek = document.getElementById('cf-days')?.value || ''; }
  if (type === 'meal') { body.kcal = document.getElementById('cf-kcal')?.value || 0; body.p = document.getElementById('cf-p')?.value || 0; body.c = document.getElementById('cf-c')?.value || 0; body.f = document.getElementById('cf-f')?.value || 0; }
  if (!body.body && !body.title) { showToast('Write something first.', 'error'); return; }
  try {
    const res = await fetch('/api/community/posts', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); showToast(j.error || 'Could not post.', 'error'); return; }
    showToast('Posted to the community', 'success');
    const b = document.getElementById('cf-body'); if (b) b.value = '';
    ['cf-title', 'cf-goal', 'cf-days', 'cf-kcal', 'cf-p', 'cf-c', 'cf-f'].forEach(idv => { const e = document.getElementById(idv); if (e) e.value = ''; });
    loadCommunityFeed();
  } catch { showToast('You appear to be offline.', 'error'); }
}
async function loadCommunityFeed() {
  const listEl = document.getElementById('feed-list');
  if (!listEl) return;
  const type = state._feedFilter || '';
  listEl.innerHTML = '<div class="my-meals-empty">Loading…</div>';
  try {
    const res = await fetch('/api/community/posts' + (type ? '?type=' + type : ''), { headers: authHeaders() });
    if (!res.ok) { listEl.innerHTML = '<div class="my-meals-empty">' + (res.status === 401 ? 'Please sign in to see the community.' : 'Could not load — try again.') + '</div>'; return; }
    const j = await res.json();
    state._feed = j.posts || [];
    listEl.innerHTML = renderFeedList(state._feed);
  } catch { listEl.innerHTML = '<div class="my-meals-empty">You appear to be offline.</div>'; }
}
function setCommunityFilter(type) {
  state._feedFilter = type;
  document.querySelectorAll('.cf-filter').forEach(el => el.classList.toggle('active', el.dataset.f === type));
  loadCommunityFeed();
}
function feedMetaLine(p) {
  const d = p.data || {};
  if (p.type === 'program') {
    const bits = [];
    if (d.goal) bits.push(escapeHtml(d.goal));
    if (d.daysPerWeek) bits.push(d.daysPerWeek + ' days/week');
    return bits.length ? '<div class="fp-meta">' + bits.join(' · ') + '</div>' : '';
  }
  if (p.type === 'meal') {
    const bits = [];
    if (d.kcal) bits.push(d.kcal + ' cal');
    if (d.p) bits.push(d.p + 'g P');
    if (d.c) bits.push(d.c + 'g C');
    if (d.f) bits.push(d.f + 'g F');
    return bits.length ? '<div class="fp-meta fp-macros">' + bits.join(' · ') + '</div>' : '';
  }
  return '';
}
function renderFeedList(posts) {
  if (!posts.length) return '<div class="my-meals-empty">Nothing here yet — be the first to post.</div>';
  return posts.map(p =>
    '<div class="feed-post">' +
    '<div class="fp-head"><span class="fp-badge fp-' + p.type + '">' + (POST_TYPE_LABELS[p.type] || 'Post') + '</span>' +
    '<span class="fp-author">' + escapeHtml(p.author || 'Someone') + '</span></div>' +
    (p.title ? '<div class="fp-title">' + escapeHtml(p.title) + '</div>' : '') +
    feedMetaLine(p) +
    (p.body ? '<div class="fp-body">' + escapeHtml(p.body) + '</div>' : '') +
    '<div class="fp-actions">' +
    '<button type="button" class="fp-like' + (p.likedByMe ? ' liked' : '') + '" onclick="likeCommunityPost(' + p.id + ')">' + (p.likedByMe ? '♥' : '♡') + ' <span>' + (p.likeCount || 0) + '</span></button>' +
    (p.mine
      ? '<button type="button" class="fp-x" onclick="deleteCommunityPost(' + p.id + ')">Delete</button>'
      : '<button type="button" class="fp-x" onclick="reportCommunityPost(' + p.id + ')">Report</button>') +
    '</div></div>'
  ).join('');
}
async function likeCommunityPost(id) {
  try {
    const res = await fetch('/api/community/posts/' + id + '/like', { method: 'POST', headers: authHeaders() });
    if (!res.ok) return;
    const j = await res.json();
    const post = (state._feed || []).find(p => p.id === id);
    if (post) { post.likedByMe = j.liked; post.likeCount = j.count; }
    const listEl = document.getElementById('feed-list');
    if (listEl) listEl.innerHTML = renderFeedList(state._feed);
  } catch {}
}
async function reportCommunityPost(id) {
  if (!confirm('Report this post as inappropriate? It gets hidden automatically once enough members report it.')) return;
  fetch('/api/community/posts/' + id + '/report', { method: 'POST', headers: authHeaders() }).catch(() => {});
  showToast('Reported — thanks for keeping it clean.', 'success');
}
async function deleteCommunityPost(id) {
  if (!confirm('Delete your post?')) return;
  try {
    const res = await fetch('/api/community/posts/' + id, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) { showToast('Deleted.', 'success'); loadCommunityFeed(); }
    else showToast('Could not delete.', 'error');
  } catch { showToast('Could not reach the server.', 'error'); }
}
function renderCommunityPage() {
  if (!state._composerType) state._composerType = 'thought';
  if (state._feedFilter == null) state._feedFilter = '';
  const filters = [['', 'All'], ['thought', 'Thoughts'], ['program', 'Programs'], ['meal', 'Meals']];
  document.getElementById('main').innerHTML =
    '<div class="page-header">' +
    '<h2 class="page-title">Community</h2>' +
    '<p class="page-sub">Share thoughts, training programs, and meals — and see what others post</p>' +
    '</div>' +
    '<div class="card">' +
    '<h3 class="card-title">Share something</h3>' +
    '<div class="cf-typetabs">' +
    ['thought', 'program', 'meal'].map(t => '<button type="button" class="cf-type' + (t === state._composerType ? ' active' : '') + '" data-t="' + t + '" onclick="setComposerType(\'' + t + '\')">' + POST_TYPE_LABELS[t] + '</button>').join('') +
    '</div>' +
    '<div id="cf-fields">' + composerFields(state._composerType) + '</div>' +
    '<button class="btn btn-primary" style="margin-top:12px" onclick="submitCommunityPost()">Post</button>' +
    '</div>' +
    '<div class="cf-filters">' +
    filters.map(([v, l]) => '<button type="button" class="cf-filter' + (v === state._feedFilter ? ' active' : '') + '" data-f="' + v + '" onclick="setCommunityFilter(\'' + v + '\')">' + l + '</button>').join('') +
    '</div>' +
    '<div id="feed-list"><div class="my-meals-empty">Loading…</div></div>';
  loadCommunityFeed();
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
    ? '' + streak + '-day ' + escapeHtml(pillar('gym').label) + ' streak at risk — log today to keep it alive!'
    : 'You haven\'t logged today yet.';
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
    '<div><div class="focus-label">Focus This Week</div>' +
    '<div class="focus-area">' + lowest.icon + ' ' + lowest.name + ' — ' + Math.round(lowest.pct) + '% of goal</div></div>' +
    '<div class="focus-bar-wrap"><div class="focus-bar" style="width:' + Math.min(100, lowest.pct) + '%;background:' + color + '"></div></div>' +
    '</div>' +
    '<div class="focus-tip">' + lowest.tip + '</div>' +
    '</div>';
}

function updateNavBadges() {
  const count = getFollowUpCount();
  const badge = document.getElementById('business-badge');
  if (badge) {
    if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }
}

function getFollowUpCount() {
  const today = todayStr();
  return (state.data.contacts || []).filter(c => c.followUpDate && c.followUpDate <= today && c.status !== 'closed' && c.status !== 'dropped').length;
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
    '<span class="hyd-icon"></span>' +
    '<div class="hyd-info">' +
    '<div class="hyd-title">Hydration</div>' +
    '<div class="hyd-sub">' + (today > 0 ? '<strong>' + today + ' gal</strong> today' : 'Not logged today') +
      (avg > 0 ? ' · avg ' + avg.toFixed(2) + ' gal/day this week' : '') + '</div>' +
    '</div>' +
    '<div class="hyd-bar-wrap"><div class="hyd-bar" style="width:' + pct + '%"></div></div>' +
    '<button class="btn btn-outline hyd-btn" onclick="navigate(\'log\')">Log water</button>' +
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
    if (d.reading?.summary)   bits.push('<span class="rn-tag"></span> ' + escapeHtml(clip(d.reading.summary, 160)));
    if (d.money?.activities)  bits.push('<span class="rn-tag"></span> ' + escapeHtml(clip(d.money.activities, 120)));
    return '<div class="rn-item">' +
      '<div class="rn-date">' + fmtDate(d.date) + (d.water > 0 ? '<span class="rn-water">' + d.water + ' gal</span>' : '') + '</div>' +
      '<div class="rn-text">' + bits.join('<br>') + '</div>' +
      '</div>';
  }).join('');
  return '<div class="card recent-notes-card">' +
    '<h3 class="card-title">Looking Back — Your Recent Notes</h3>' +
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
    return '<div class="card insight-daily"><div class="di-head"><span class="di-icon"></span><span class="di-title">Your Daily Coach Insight</span></div><div class="di-body" id="di-body">' + body + '</div></div>';
  }
  if (cached && cached.date === today && cached.text) body = '<div class="di-text">' + escapeHtml(cached.text) + '</div>';
  else body = '<div class="di-loading"><div class="spinner"></div><span>Reading your data…</span></div>';
  return '<div class="card insight-daily">' +
    '<div class="di-head"><span class="di-icon"></span><span class="di-title">Your Daily Coach Insight</span>' +
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
  if (!state.hasApiKey) { showToast('Connect an AI key in Settings first.', 'error'); return; }
  state._insightLoading = true;
  const setBody = (html) => { const b = document.getElementById('di-body'); if (b) b.innerHTML = html; };
  if (force) setBody('<div class="di-loading"><div class="spinner"></div><span>Thinking…</span></div>');
  try {
    const r = await fetch('/api/insight', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData() }) });
    const j = await r.json();
    if (!r.ok || !j.insight) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect an AI key in Settings to get daily insights.' : 'Couldn\'t generate — tap ↻ to retry.') + '</div>');
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
    '<div class="di-head"><span class="di-icon"></span><span class="di-title">Today\'s Game Plan</span>' +
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
  if (!state.hasApiKey) { showToast('Connect an AI key in Settings first.', 'error'); return; }
  state._planLoading = true;
  const setBody = (html) => { const b = document.getElementById('plan-body'); if (b) b.innerHTML = html; };
  if (force) setBody('<div class="di-loading"><div class="spinner"></div><span>Thinking…</span></div>');
  try {
    const r = await fetch('/api/plan', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData() }) });
    const j = await r.json();
    if (!r.ok || !j.plan) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect an AI key in Settings to get your plan.' : 'Couldn\'t build it — tap ↻ to retry.') + '</div>');
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
    '<div class="di-head"><span class="di-icon"></span><span class="di-title">Patterns — what connects in your life</span>' +
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
  if (!state.hasApiKey) { showToast('Connect an AI key in Settings first.', 'error'); return; }
  state._patLoading = true;
  const setBody = (html) => { const b = document.getElementById('pat-body'); if (b) b.innerHTML = html; };
  if (force) setBody('<div class="di-loading"><div class="spinner"></div><span>Finding a connection…</span></div>');
  try {
    const r = await fetch('/api/patterns', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData() }) });
    const j = await r.json();
    if (!r.ok || !j.pattern) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect an AI key in Settings to unlock Patterns.' : 'Couldn\'t find one — tap ↻ to retry.') + '</div>');
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
  const days = state.data.days || [];
  if (!days.length) return '';
  // No AI key (e.g. live before keys are set): still offer the client-side recap.
  if (!state.hasApiKey) {
    return '<div class="card review-card">' +
      '<div class="di-head"><span class="di-icon"></span><span class="di-title">Weekly Recap</span>' +
      '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="shareMyWeek()">Share</button></div>' +
      '<div class="di-body"><p class="review-sub">Your week across every pillar — goals hit, the votes you cast, and your balance.</p>' +
      '<button class="btn btn-primary" onclick="openWeekRecap()">Open week recap</button></div></div>';
  }
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
      '</p><button class="btn btn-primary" onclick="fetchReview(true)">Generate this week\'s review</button></div>';
  }
  return '<div class="card review-card' + (isSunday && !hasThisWeek ? ' review-due' : '') + '">' +
    '<div class="di-head"><span class="di-icon"></span><span class="di-title">Weekly Story Recap</span>' +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="shareMyWeek()">Share</button></div>' +
    '<div class="di-body" id="rev-body">' + body + '</div></div>';
}
async function fetchReview() {
  if (state._revLoading) return;
  if (!state.hasApiKey) { showToast('Connect an AI key in Settings first.', 'error'); return; }
  state._revLoading = true;
  const setBody = (html) => { const b = document.getElementById('rev-body'); if (b) b.innerHTML = html; };
  setBody('<div class="di-loading"><div class="spinner"></div><span>Reviewing your whole week…</span></div>');
  try {
    const r = await fetch('/api/review', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data: enrichedData(), weekLabel: formatWeekRange(getWeekStart(todayStr())) }) });
    const j = await r.json();
    if (!r.ok || !j.review) {
      setBody('<div class="di-empty">' + (j.error === 'NO_KEY' ? 'Connect an AI key in Settings to unlock this.' : 'Couldn\'t generate — try again.') + '</div>');
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
    msg = cur >= 2 ? '' + cur + ' days strong — keep the chain going!' : 'Logged today! Come back tomorrow to build your streak.';
  } else if (cur >= 1) {
    msg = 'Log today to keep your ' + cur + '-day streak alive!'; urgent = true;
  } else {
    msg = best >= 3 ? 'You reached ' + best + ' days before — start a new streak today!' : 'Log today to start your streak '; urgent = true;
  }
  return '<div class="card streak-card' + (urgent ? ' streak-urgent' : '') + '">' +
    '<div class="streak-flame"></div>' +
    '<div class="streak-main"><div class="streak-num">' + cur + '</div><div class="streak-unit">day' + (cur === 1 ? '' : 's') + ' streak</div></div>' +
    '<div class="streak-msg">' + msg + (best > 0 ? '<div class="streak-best">Best: ' + best + ' day' + (best === 1 ? '' : 's') + '</div>' : '') + '</div>' +
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
// Goal-progress rows for the share card — value vs. weekly target per enabled
// pillar (no $ amounts). The Strava-style "how much of my goals I hit" view.
function weekGoalRows() {
  const p = state.data.profile || {}, s = weekShareStats();
  const rows = [];
  const add = (on, icon, label, value, target, color) => {
    if (on && target > 0) rows.push({ icon, label, value, target, color, pct: Math.min(100, Math.round(value / target * 100)), hit: value >= target });
  };
  add(isPillarOn('gym'), '🏋️', 'Workouts', s.workouts, p.gymDaysPerWeek || 5, '#10B981');
  add(isPillarOn('reading'), '📚', 'Pages', s.pages, +p.weeklyReadGoal || 0, '#22D3EE');
  add(isPillarOn('networking'), '🤝', 'Connections', s.connections, p.weeklyNetworkGoal || 3, '#60A5FA');
  return rows.slice(0, 4);
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
    const range = (baseY, peaks, height, color) => {
      x.fillStyle = color; x.beginPath(); x.moveTo(0, baseY - peaks[0] * height);
      for (let i = 1; i < peaks.length; i++) x.lineTo((i / (peaks.length - 1)) * W, baseY - peaks[i] * height);
      x.lineTo(W, H); x.lineTo(0, H); x.closePath(); x.fill();
    };
    const FONT = '-apple-system,Segoe UI,Roboto,sans-serif';
    // Background: night-mountain gradient + glows
    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#10131C'); bg.addColorStop(0.55, '#141A2A'); bg.addColorStop(1, '#1A1530');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    let g = x.createRadialGradient(cx, 360, 60, cx, 360, 980);
    g.addColorStop(0, 'rgba(45,212,191,0.20)'); g.addColorStop(1, 'rgba(45,212,191,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createRadialGradient(cx, 1480, 60, cx, 1480, 980);
    g.addColorStop(0, 'rgba(167,139,250,0.18)'); g.addColorStop(1, 'rgba(167,139,250,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // Stars (upper half only)
    for (let i = 0; i < 70; i++) { x.globalAlpha = Math.random() * 0.6 + 0.2; x.fillStyle = '#dbe6ff'; const r = Math.random() * 2 + 0.5; x.beginPath(); x.arc(Math.random() * W, Math.random() * 980, r, 0, 7); x.fill(); }
    x.globalAlpha = 1;

    // Brand mark (little mountain) + wordmark
    x.beginPath(); x.moveTo(cx - 132, 296); x.lineTo(cx - 106, 244); x.lineTo(cx - 80, 296); x.closePath(); x.fillStyle = '#9FE1CB'; x.fill();
    x.beginPath(); x.moveTo(cx - 112, 296); x.lineTo(cx - 78, 232); x.lineTo(cx - 44, 296); x.closePath(); x.fillStyle = '#1D9E75'; x.fill();
    x.textAlign = 'left'; x.fillStyle = '#eef1f7'; x.font = '800 58px ' + FONT; x.fillText('Onward', cx - 28, 292);
    x.textAlign = 'center';
    x.fillStyle = '#7C8BA5'; x.font = '700 30px ' + FONT; x.fillText('W E E K L Y   R E C A P', cx, 366);
    x.fillStyle = '#9aa3b2'; x.font = '500 38px ' + FONT; x.fillText(formatWeekRange(getWeekStart(todayStr())), cx, 418);

    // Goal progress — hero ring (overall %) + per-goal bars, Strava-style
    const s = weekShareStats();
    const rows = weekGoalRows();
    const overall = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : Math.min(100, Math.round(s.daysLogged / 7 * 100));

    const rcy = 648, rad = 188;
    x.lineCap = 'round'; x.lineWidth = 36;
    x.strokeStyle = 'rgba(255,255,255,0.08)'; x.beginPath(); x.arc(cx, rcy, rad, 0, Math.PI * 2); x.stroke();
    const ring = x.createLinearGradient(cx - rad, rcy - rad, cx + rad, rcy + rad);
    ring.addColorStop(0, '#2dd4bf'); ring.addColorStop(1, '#7AA2FF');
    x.strokeStyle = ring; x.beginPath(); x.arc(cx, rcy, rad, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, overall / 100) * Math.PI * 2); x.stroke();
    x.lineCap = 'butt';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#ffffff'; x.font = '900 170px ' + FONT; x.fillText(overall + '%', cx, rcy - 4);
    x.fillStyle = '#9aa3b2'; x.font = '700 36px ' + FONT; x.fillText('OF MY GOALS', cx, rcy + 88);
    x.textBaseline = 'alphabetic';

    if (s.streak >= 2) { x.textAlign = 'center'; x.fillStyle = '#F59E0B'; x.font = '700 42px ' + FONT; x.fillText('🔥 ' + s.streak + '-day streak', cx, 922); }

    let gy = 1012;
    rows.forEach(r => {
      x.textAlign = 'left'; x.fillStyle = '#eef1f7'; x.font = '600 46px sans-serif'; x.fillText(r.icon, 92, gy + 6);
      x.fillStyle = '#e2e8f0'; x.font = '700 44px ' + FONT; x.fillText(r.label, 172, gy + 4);
      x.textAlign = 'right'; x.fillStyle = r.hit ? r.color : '#cbd5e1'; x.font = '800 44px ' + FONT;
      x.fillText(r.value + ' / ' + r.target + (r.hit ? '  ✓' : ''), W - 92, gy + 4);
      const bx = 92, bw = W - 184, by = gy + 34, bh = 22;
      x.fillStyle = 'rgba(255,255,255,0.08)'; rr(bx, by, bw, bh, 11); x.fill();
      if (r.pct > 0) { x.fillStyle = r.color; rr(bx, by, Math.max(bh, bw * r.pct / 100), bh, 11); x.fill(); }
      gy += 128;
    });

    // Marketing payload — what it is + where to find it (kept in the safe zone)
    x.textAlign = 'center';
    x.fillStyle = '#eef1f7'; x.font = '800 52px ' + FONT; x.fillText('Track your whole life — free', cx, 1496);
    x.fillStyle = '#2dd4bf'; x.font = '700 44px ' + FONT; x.fillText(location.host || 'Onward', cx, 1560);

    // Mountain range (back then front), then a flag planted on the visible summit
    range(1840, [0.15, 0.45, 0.25, 0.6, 0.4, 0.7, 0.5, 0.6, 0.35, 0.55, 0.3], 130, '#222d44');
    range(1892, [0.1, 0.3, 0.18, 0.4, 0.25, 0.36, 0.2, 0.32, 0.12], 110, '#1D6B50');
    const fx = (3 / 8) * W, fy = 1892 - 0.4 * 110;   // tallest front-range peak
    x.strokeStyle = '#cbd5e1'; x.lineWidth = 5; x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx, fy - 64); x.stroke();
    x.fillStyle = '#E8633A'; x.beginPath(); x.moveTo(fx, fy - 64); x.lineTo(fx + 44, fy - 51); x.lineTo(fx, fy - 38); x.closePath(); x.fill();

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
      await navigator.share({ files: [file], title: 'My week on Onward', text: 'See what connects your life ' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'my-week.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Card saved — post it to your story ', 'success');
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user dismissed the share sheet
    showToast('Could not share the card.', 'error');
  }
}

// ── Milestone share-prompt: at an emotional peak (a streak milestone or a
// perfect-goals week) invite the user to post their card. Once per milestone. ──
// Returns the milestone to celebrate, or null. Pure-ish (reads state). Testable.
function pendingShareMilestone() {
  const p = state.data.profile || {};
  const seen = p._sharePrompts || {};
  const streak = loggingStreak();
  for (const t of [100, 50, 30, 21, 14, 7]) {          // highest reached & unseen wins
    if (streak >= t && !seen['s' + t]) return { key: 's' + t, kind: 'streak', n: t };
  }
  const rows = weekGoalRows();                          // a perfect week — all weekly goals hit
  if (rows.length >= 2 && rows.every(r => r.hit)) {
    const wk = getWeekStart(todayStr());
    if (seen.goalsWeek !== wk) return { key: 'goalsWeek', kind: 'goals', week: wk };
  }
  return null;
}
function maybeShowShareMilestone() {
  if (state._previewMode) return;                       // don't nag in the demo (nothing persists)
  if (document.querySelector('.modal-overlay, .celebration-overlay')) return; // never stack on another dialog
  const m = pendingShareMilestone();
  if (!m) return;
  const p = state.data.profile = state.data.profile || {};
  const seen = p._sharePrompts = p._sharePrompts || {};
  if (m.kind === 'streak') seen['s' + m.n] = true; else seen.goalsWeek = m.week;  // mark before showing
  saveData();
  showShareMilestone(m);
}
function showShareMilestone(m) {
  if (document.getElementById('milestone-overlay')) return;
  const emoji = m.kind === 'streak' ? '🔥' : '🎯';
  const title = m.kind === 'streak' ? m.n + '-day streak!' : 'Perfect week!';
  const sub = m.kind === 'streak'
    ? "You've shown up " + m.n + " days straight. That's the climb — share it and pull someone up with you."
    : 'You hit 100% of your weekly goals. Take the victory lap — post your card.';
  const o = document.createElement('div');
  o.id = 'milestone-overlay'; o.className = 'modal-overlay';
  o.innerHTML = '<div class="modal-box milestone-box">' +
    '<div class="ms-emoji">' + emoji + '</div>' +
    '<div class="ms-title">' + title + '</div>' +
    '<div class="ms-sub">' + sub + '</div>' +
    '<div class="ms-actions">' +
    '<button class="btn btn-primary" onclick="milestoneShare()">Share my week</button>' +
    '<button class="btn-link" onclick="closeMilestone()">Maybe later</button>' +
    '</div></div>';
  o.addEventListener('click', e => { if (e.target === o) closeMilestone(); });
  document.body.appendChild(o);
}
function milestoneShare() { closeMilestone(); shareMyWeek(); }
function closeMilestone() { document.getElementById('milestone-overlay')?.remove(); }

// Weight trend card — current weight + change + a line chart over time
function renderWeightTrend() {
  const ws = [...(state.data.weights || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!ws.length) return '';
  const unit = weightUnitPref();
  const cur = kgToDisplay(ws[ws.length - 1].kg);
  if (ws.length === 1) {
    return '<div class="card weight-card"><h3 class="card-title" style="margin-bottom:8px">Weight</h3>' +
      '<div class="weight-now">' + cur.toFixed(1) + ' ' + unit + '</div>' +
      '<div class="weight-sub">Log your weight again to start seeing your trend.</div></div>';
  }
  const change = cur - kgToDisplay(ws[0].kg);
  const chCls = change < 0 ? 'weight-down' : change > 0 ? 'weight-up' : '';
  const chTxt = (change > 0 ? '+' : '') + change.toFixed(1) + ' ' + unit + ' since ' + fmtDateShort(ws[0].date);
  return '<div class="card weight-card">' +
    '<div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">Weight Trend</h3>' +
    '<div><span class="weight-now-inline">' + cur.toFixed(1) + ' ' + unit + '</span> <span class="' + chCls + '">' + chTxt + '</span></div>' +
    '</div>' +
    '<div class="chart-wrap" style="margin-top:14px"><canvas id="weightChart"></canvas></div></div>';
}

// ── Body-shape visual: a silhouette that gets thinner as you lose weight and
// wider as you gain. Width is driven by BMI when height is known, otherwise by
// how far you are from your starting weight. All pure/deterministic. ──
function weightToBodyFactor(kg, heightCm, baselineKg) {
  if (!(+kg > 0)) return 1;
  const clamp = v => Math.max(0.7, Math.min(1.7, v));
  if (+heightCm > 0) { const m = +heightCm / 100; return clamp((+kg / (m * m)) / 22); } // BMI 22 → average build
  const base = +baselineKg > 0 ? +baselineKg : +kg;
  return clamp(1 + (+kg - base) / base * 3); // no height: amplify change vs. start so it's visible
}
function bmiBand(b) { return b < 18.5 ? 'lean' : b < 25 ? 'healthy' : b < 30 ? 'above ideal' : 'higher'; }
function bodyShapeStats(weights, profile) {
  const ws = [...(weights || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!ws.length) return null;
  const startKg = ws[0].kg, curKg = ws[ws.length - 1].kg;
  const heightCm = +(profile && profile.nutrition && profile.nutrition.heightCm) || 0;
  const out = {
    startKg, curKg, deltaKg: curKg - startKg, startDate: ws[0].date, single: ws.length < 2,
    startFactor: weightToBodyFactor(startKg, heightCm, startKg),
    curFactor: weightToBodyFactor(curKg, heightCm, startKg),
    bmi: 0, bmiLabel: ''
  };
  if (heightCm > 0) { const m = heightCm / 100; out.bmi = curKg / (m * m); out.bmiLabel = bmiBand(out.bmi); }
  return out;
}
// Half-widths/thicknesses of the body at a given build factor (1 = average)
function bodyDims(f) {
  return {
    neckHalf: 11,
    shoulderHalf: 30 + (f - 1) * 20,
    chestHalf:    28 + (f - 1) * 30,
    waistHalf:    26 + (f - 1) * 40,   // belly is the most sensitive to weight
    hipHalf:      30 + (f - 1) * 30,
    headR:        22 + (f - 1) * 7,
    armThick:     15 + (f - 1) * 12,
    legThick:     26 + (f - 1) * 28
  };
}
// Smooth, symmetric torso outline (neck → shoulders → chest → belly → hips),
// ending at a rounded pelvis so the thighs flow out of the hips. At factor f.
function bodySilhouettePath(f) {
  const cx = 100, d0 = bodyDims(f);
  const stops = [[70, d0.neckHalf], [96, d0.shoulderHalf], [140, d0.chestHalf], [182, d0.waistHalf], [214, d0.hipHalf], [238, d0.hipHalf * 0.86]];
  const L = stops.map(s => [+(cx - s[1]).toFixed(1), s[0]]);
  const R = stops.map(s => [+(cx + s[1]).toFixed(1), s[0]]).reverse();
  let d = 'M ' + L[0][0] + ',' + L[0][1];
  for (let i = 1; i < L.length; i++) { const my = ((L[i - 1][1] + L[i][1]) / 2).toFixed(1); d += ' C ' + L[i - 1][0] + ',' + my + ' ' + L[i][0] + ',' + my + ' ' + L[i][0] + ',' + L[i][1]; }
  d += ' C ' + L[L.length - 1][0] + ',' + (L[L.length - 1][1] + 8) + ' ' + R[0][0] + ',' + (R[0][1] + 8) + ' ' + R[0][0] + ',' + R[0][1]; // rounded pelvis
  for (let i = 1; i < R.length; i++) { const my = ((R[i - 1][1] + R[i][1]) / 2).toFixed(1); d += ' C ' + R[i - 1][0] + ',' + my + ' ' + R[i][0] + ',' + my + ' ' + R[i][0] + ',' + R[i][1]; }
  return d + ' Z';
}
// A tapered limb (arm/leg): wide at the top, narrower at the bottom, rounded foot/hand.
function taperLimb(x1, y1, w1, x2, y2, w2) {
  const r1 = w1 / 2, r2 = w2 / 2;
  return 'M ' + (x1 - r1).toFixed(1) + ',' + y1 +
    ' L ' + (x2 - r2).toFixed(1) + ',' + y2 +
    ' Q ' + (x2 - r2).toFixed(1) + ',' + (y2 + r2).toFixed(1) + ' ' + x2.toFixed(1) + ',' + (y2 + r2).toFixed(1) +
    ' Q ' + (x2 + r2).toFixed(1) + ',' + (y2 + r2).toFixed(1) + ' ' + (x2 + r2).toFixed(1) + ',' + y2 +
    ' L ' + (x1 + r1).toFixed(1) + ',' + y1 + ' Z';
}
// Full body — neck, tapered legs + feet, tapered arms, torso, head — at factor f
function bodyGroupSvg(f) {
  const cx = 100, d = bodyDims(f), F = 'fill="url(#bodyGrad)"';
  const headRy = 23 + (f - 1) * 5, headRx = headRy * 0.82;
  const thighW = d.legThick, ankleW = Math.max(8, d.legThick * 0.36);
  const legX = thighW / 2 + 1.5;                       // thighs sit together to form the hips
  const upperArmW = d.armThick, wristW = Math.max(6, d.armThick * 0.55);
  const torsoEdge = Math.max(d.waistHalf, d.hipHalf);
  const armTopX = d.shoulderHalf * 0.82, armBotX = torsoEdge + wristW / 2 + 1;
  const foot = x => '<ellipse cx="' + (x).toFixed(1) + '" cy="376" rx="' + (ankleW * 0.9).toFixed(1) + '" ry="' + (ankleW * 0.5).toFixed(1) + '" ' + F + '/>';
  return (
    '<rect x="' + (cx - d.neckHalf).toFixed(1) + '" y="58" width="' + (d.neckHalf * 2).toFixed(1) + '" height="34" rx="6" ' + F + '/>' +
    '<path d="' + taperLimb(cx - legX, 202, thighW, cx - legX, 372, ankleW) + '" ' + F + '/>' +
    '<path d="' + taperLimb(cx + legX, 202, thighW, cx + legX, 372, ankleW) + '" ' + F + '/>' +
    foot(cx - legX) + foot(cx + legX) +
    '<path d="' + taperLimb(cx - armTopX, 100, upperArmW, cx - armBotX, 236, wristW) + '" ' + F + '/>' +
    '<path d="' + taperLimb(cx + armTopX, 100, upperArmW, cx + armBotX, 236, wristW) + '" ' + F + '/>' +
    '<path d="' + bodySilhouettePath(f) + '" ' + F + '/>' +
    '<ellipse cx="' + cx + '" cy="40" rx="' + headRx.toFixed(1) + '" ry="' + headRy.toFixed(1) + '" ' + F + '/>'
  );
}
function renderBodyShapeCard() {
  const st = bodyShapeStats(state.data.weights, state.data.profile);
  if (!st) return '';
  const unit = weightUnitPref();
  const curDisp = kgToDisplay(st.curKg), deltaDisp = kgToDisplay(st.curKg) - kgToDisplay(st.startKg);
  const lost = deltaDisp < -0.05, gained = deltaDisp > 0.05;
  const gainGoal = (state.data.profile && state.data.profile.nutrition && state.data.profile.nutrition.goal) === 'gain';
  const headline = st.single ? 'Your starting shape — log again to watch it change'
    : lost ? "Leaner than when you started — keep going"
    : gained ? (gainGoal ? 'Building up — nice work' : 'Up since you started')
    : 'Holding steady';
  const showGhost = !st.single && Math.abs(st.curFactor - st.startFactor) > 0.02;
  const chCls = lost ? 'weight-down' : gained ? 'weight-up' : '';
  const arrow = lost ? '▼' : gained ? '▲' : '•';
  return '<div class="card body-shape-card">' +
    '<div class="bsc-head"><h3 class="card-title" style="margin-bottom:2px">Your shape</h3>' +
    '<span class="bsc-sub">' + headline + '</span></div>' +
    '<div class="bsc-stage"><svg viewBox="0 0 200 384" class="bsc-svg" aria-hidden="true">' +
    // Per-part radial gradient = light from the upper-left, so every limb, the
    // torso and the head read as rounded 3D forms instead of flat shapes.
    '<defs><radialGradient id="bodyGrad" cx="0.37" cy="0.3" r="0.9" fx="0.31" fy="0.24">' +
    '<stop offset="0" stop-color="#CDBEFF"/><stop offset="0.4" stop-color="#9A85F1"/>' +
    '<stop offset="0.75" stop-color="#6E59DE"/><stop offset="1" stop-color="#4C3BB2"/></radialGradient></defs>' +
    (showGhost ? '<g class="bsc-ghost">' + bodyGroupSvg(st.startFactor) + '</g>' : '') +
    '<g id="body-live" data-start="' + st.startFactor.toFixed(3) + '" data-cur="' + st.curFactor.toFixed(3) + '">' +
    bodyGroupSvg(st.single ? st.curFactor : st.startFactor) + '</g></svg></div>' +
    '<div class="bsc-stats">' +
    '<div class="bsc-stat"><div class="bsc-v">' + curDisp.toFixed(1) + '<span>' + unit + '</span></div><div class="bsc-l">now</div></div>' +
    (st.single ? '' : '<div class="bsc-stat"><div class="bsc-v ' + chCls + '">' + arrow + ' ' + Math.abs(deltaDisp).toFixed(1) + '<span>' + unit + '</span></div><div class="bsc-l">since ' + fmtDateShort(st.startDate) + '</div></div>') +
    (st.bmi ? '<div class="bsc-stat"><div class="bsc-v">' + st.bmi.toFixed(1) + '</div><div class="bsc-l">BMI · ' + st.bmiLabel + '</div></div>' : '') +
    '</div>' +
    (showGhost ? '<div class="bsc-legend">The faint figure is where you started — ' + (lost ? "you've slimmed down since." : 'how far you’ve come.') + '</div>' : '') +
    '</div>';
}
// Animate the live body from its start shape to its current shape on load
function playBodyMorph() {
  const live = document.getElementById('body-live'); if (!live) return;
  const sF = parseFloat(live.dataset.start), cF = parseFloat(live.dataset.cur);
  if (!isFinite(sF) || !isFinite(cF)) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { live.innerHTML = bodyGroupSvg(cF); return; }
  const t0 = performance.now(), dur = 1500;
  function tick(now) {
    const p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
    live.innerHTML = bodyGroupSvg(sF + (cF - sF) * e);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
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
      '<div class="pillar-sub">this week' + (streak > 1 ? ' · <strong>' + streak + ' day streak </strong>' : '') + ' ' + wowArrow(stats.gymDays, lastStats.gymDays) + '</div>' +
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
      '<div class="pillar-sub">' + stats.readDays + ' days this week' + (streak > 1 ? ' · <strong>' + streak + ' day streak </strong>' : '') + '</div>' +
      (ab ? '<div class="pillar-sub" style="margin-top:4px;font-style:italic;color:var(--read-color)">' + escapeHtml(ab.title.length > 22 ? ab.title.slice(0, 22) + '…' : ab.title) + '</div>' : '') +
      '</div></div>';
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// GOAL — one thing to work toward; the app shows progress + pace
// ─────────────────────────────────────────────────────────────
function currentGoalValue(goal) {
  if (!goal) return 0;
  if (goal.kind === 'weight') {
    const ws = (state.data.weights || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    return ws.length ? Math.round(kgToDisplay(ws[0].kg) * 10) / 10 : (+goal.start || 0);
  }
  if (goal.kind === 'savings') return getMoneyCircle().savedTotal;
  if (goal.kind === 'streak') return loggingStreak();
  return +goal.current || 0; // custom
}
// Pure: progress + pace for a goal (testable). current is supplied by the caller.
function goalStatus(goal, current, todayMs) {
  if (!goal || goal.target == null) return null;
  const start = +goal.start || 0, target = +goal.target, total = target - start, done = current - start;
  const pct = total === 0 ? (current >= target ? 100 : 0) : Math.max(0, Math.min(100, Math.round(done / total * 100)));
  const reached = total >= 0 ? current >= target : current <= target;
  const remaining = target - current;
  let daysLeft = null, onTrack = true, expectedPct = null;
  if (goal.deadline) {
    const dMs = Date.parse(goal.deadline + 'T23:59:59');
    daysLeft = Math.max(0, Math.ceil((dMs - todayMs) / 86400000));
    const createdMs = Date.parse((goal.createdAt || goal.deadline) + 'T00:00:00');
    const totalDays = Math.max(1, Math.round((dMs - createdMs) / 86400000));
    const elapsed = Math.max(0, Math.min(totalDays, Math.round((todayMs - createdMs) / 86400000)));
    expectedPct = Math.round(elapsed / totalDays * 100);
    onTrack = reached || pct >= expectedPct - 5;
  }
  return { pct, reached, remaining, daysLeft, onTrack, expectedPct };
}
function goalPaceLine(goal, s) {
  if (!s) return '';
  if (s.reached) return 'You hit it — set a new goal to keep the momentum.';
  const rem = Math.abs(s.remaining);
  const wk = (s.daysLeft && s.daysLeft > 0) ? rem / s.daysLeft * 7 : null;
  if (goal.kind === 'weight') {
    const dir = (goal.target < goal.start) ? 'to lose' : 'to gain';
    return (Math.round(rem * 10) / 10) + ' ' + (goal.unit || 'lb') + ' ' + dir + (wk ? ' · about ' + (Math.round(wk * 10) / 10) + ' ' + (goal.unit || 'lb') + '/week to hit your date' : '');
  }
  if (goal.kind === 'savings') return formatCurrency(rem) + ' to go' + (wk ? ' · save ~' + formatCurrency(Math.round(wk)) + '/week to stay on pace' : '');
  if (goal.kind === 'streak') return rem + ' more day' + (rem === 1 ? '' : 's') + ' in a row — log today to keep it going';
  return (Math.round(rem * 10) / 10) + (goal.unit ? ' ' + goal.unit : '') + ' to go';
}
function renderGoalCard() {
  const goal = state.data.profile && state.data.profile.goal;
  if (!goal || goal.target == null) {
    return '<div class="card goal-card goal-empty">' +
      '<div><div class="goal-empty-title">Set your goal</div>' +
      '<div class="goal-empty-sub">Pick one thing to work toward — Onward guides you there and shows your pace.</div></div>' +
      '<button type="button" class="btn btn-primary btn-sm" onclick="openGoalForm()">Set a goal</button></div>';
  }
  const cur = currentGoalValue(goal);
  const s = goalStatus(goal, cur, Date.now());
  const unit = goal.unit || '';
  const fmt = v => unit === '$' ? formatCurrency(v) : (Math.round(v * 10) / 10) + (unit && unit !== '$' ? ' ' + unit : '');
  const chip = s.reached ? '<span class="goal-chip done">Goal reached</span>'
    : (s.daysLeft != null ? (s.onTrack ? '<span class="goal-chip ok">On track</span>' : '<span class="goal-chip behind">Behind pace</span>') : '');
  const barColor = s.reached ? 'var(--success)' : (s.onTrack ? 'var(--primary)' : 'var(--warning)');
  return '<div class="card goal-card">' +
    '<div class="goal-head"><div class="goal-title">' + escapeHtml(goal.title) + '</div>' + chip + '</div>' +
    '<div class="goal-bar-lg"><div class="goal-bar-lg-fill" style="width:' + s.pct + '%;background:' + barColor + '"></div></div>' +
    '<div class="goal-meta"><span><b>' + fmt(cur) + '</b> of ' + fmt(goal.target) + '</span>' +
    (s.daysLeft != null ? '<span>' + (s.daysLeft === 0 ? 'due today' : s.daysLeft + ' days left') + '</span>' : '') + '</div>' +
    '<div class="goal-pace">' + goalPaceLine(goal, s) + '</div>' +
    '<div class="goal-actions">' +
    (goal.kind === 'custom' ? '<button type="button" class="btn-link" onclick="updateGoalProgress()">Update progress</button>' : '') +
    '<button type="button" class="btn-link" onclick="openGoalForm()">Edit goal</button>' +
    '<button type="button" class="btn-link" onclick="clearGoal()">Remove</button>' +
    '</div></div>';
}
function goalKindChanged() {
  const k = document.getElementById('goal-kind').value;
  const show = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; };
  show('goal-start-wrap', k === 'weight' || k === 'custom');
  show('goal-unit-wrap', k === 'custom');
  const tl = document.getElementById('goal-target-label');
  if (tl) tl.textContent = k === 'savings' ? 'Target amount ($)' : k === 'streak' ? 'Target streak (days)' : k === 'weight' ? 'Target weight (' + (weightUnitPref() === 'lbs' ? 'lb' : 'kg') + ')' : 'Target number';
  const sl = document.getElementById('goal-start-label');
  if (sl) sl.textContent = k === 'weight' ? 'Current weight' : 'Starting value';
}
function openGoalForm() {
  document.getElementById('goal-modal')?.remove();
  const g = (state.data.profile && state.data.profile.goal) || {};
  const latestW = (state.data.weights || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const curW = latestW ? Math.round(kgToDisplay(latestW.kg) * 10) / 10 : '';
  const opt = (v, lbl) => '<option value="' + v + '"' + (g.kind === v ? ' selected' : '') + '>' + lbl + '</option>';
  const modal = document.createElement('div');
  modal.id = 'goal-modal'; modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box" style="max-width:440px;text-align:left">' +
    '<div class="modal-badge">Your goal</div>' +
    '<p style="font-size:14px;color:var(--text-muted);margin-bottom:16px">One thing to work toward — we track your pace and tell you what to do each day.</p>' +
    '<div class="form-group"><label>Goal type</label><select id="goal-kind" onchange="goalKindChanged()">' +
    opt('weight', 'Reach a weight') + opt('savings', 'Save money') + opt('streak', 'Build a logging streak') + opt('custom', 'Custom goal') + '</select></div>' +
    '<div class="form-group"><label>Name <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label><input type="text" id="goal-title" maxlength="60" placeholder="e.g. Summer cut" value="' + escapeAttr(g.title || '') + '"></div>' +
    '<div class="form-group" id="goal-start-wrap"><label id="goal-start-label">Current weight</label><input type="number" id="goal-current-start" step="0.1" value="' + (g.start != null ? g.start : curW) + '"></div>' +
    '<div class="form-group" id="goal-unit-wrap" style="display:none"><label>Unit</label><input type="text" id="goal-unit" maxlength="12" placeholder="e.g. books, miles" value="' + escapeAttr(g.unit || '') + '"></div>' +
    '<div class="form-group"><label id="goal-target-label">Target</label><input type="number" id="goal-target" step="0.1" placeholder="e.g. 165" value="' + (g.target != null ? g.target : '') + '"></div>' +
    '<div class="form-group"><label>By when <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label><input type="date" id="goal-deadline" value="' + (g.deadline || '') + '"></div>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'goal-modal\').remove()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveGoal()">Save goal</button></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  goalKindChanged();
}
async function saveGoal() {
  const num = id => parseFloat(document.getElementById(id)?.value);
  const kind = document.getElementById('goal-kind').value;
  const target = num('goal-target');
  if (isNaN(target)) { showToast('Enter a target number.', 'error'); return; }
  let title = (document.getElementById('goal-title').value || '').trim();
  const deadline = document.getElementById('goal-deadline').value || '';
  const goal = { id: uid(), kind, target, deadline, createdAt: todayStr() };
  if (kind === 'weight') { goal.unit = weightUnitPref() === 'lbs' ? 'lb' : 'kg'; goal.start = num('goal-current-start') || target; if (!title) title = 'Reach ' + target + ' ' + goal.unit; }
  else if (kind === 'savings') { goal.unit = '$'; goal.start = getMoneyCircle().savedTotal; if (!title) title = 'Save ' + formatCurrency(target); }
  else if (kind === 'streak') { goal.unit = 'days'; goal.start = 0; if (!title) title = target + '-day streak'; }
  else { goal.unit = (document.getElementById('goal-unit').value || '').trim(); goal.start = num('goal-current-start') || 0; goal.current = goal.start; if (!title) title = 'My goal'; }
  goal.title = title.slice(0, 60);
  state.data.profile = state.data.profile || {};
  state.data.profile.goal = goal;
  await saveData();
  document.getElementById('goal-modal')?.remove();
  showToast('Goal set — let\'s get after it.', 'success');
  if (state.page === 'dashboard') renderDashboard();
}
async function clearGoal() {
  if (!confirm('Remove your goal?')) return;
  if (state.data.profile) delete state.data.profile.goal;
  await saveData();
  showToast('Goal removed.', 'success');
  if (state.page === 'dashboard') renderDashboard();
}
async function updateGoalProgress() {
  const g = state.data.profile && state.data.profile.goal; if (!g) return;
  const v = prompt('Update your progress (' + (g.unit || '') + '):', g.current != null ? g.current : g.start);
  if (v == null) return;
  g.current = parseFloat(v) || 0;
  await saveData();
  showToast('Progress updated.', 'success');
  if (state.page === 'dashboard') renderDashboard();
}

// ─────────────────────────────────────────────────────────────
// NEXT STEP — the single most important thing to do right now
// ─────────────────────────────────────────────────────────────
// Pure: pick the one next action from a snapshot of signals (testable)
function pickNextStep(s) {
  if (s.goalReached) return { tone: 'good', title: 'You reached your goal!', sub: 'Huge. Set your next one to keep climbing.', ctaLabel: 'Set a new goal', ctaAction: 'openGoalForm()' };
  if (!s.loggedToday) return { title: 'Log today', sub: 'Takes 30 seconds — keep your streak alive and your data honest.', ctaLabel: 'Log today', ctaAction: "navigate('log')" };
  if (s.nutOn && s.anyFood && s.proteinLeft != null && s.proteinLeft >= 30) return { title: "You're " + s.proteinLeft + 'g short on protein', sub: (s.emptyMeal ? 'Make ' + s.emptyMeal.toLowerCase() + ' protein-heavy' : 'Add a protein-heavy bite') + ' — chicken, eggs, Greek yogurt, or a shake.', ctaLabel: 'Log food', ctaAction: "navigate('log')" };
  if (s.gymOn && !s.gymDone) return { title: "Haven't trained yet today", sub: 'Even 20 minutes counts — log it when you do.', ctaLabel: 'Open log', ctaAction: "navigate('log')" };
  if (s.nutOn && s.emptyMeal) return { title: 'Log your ' + s.emptyMeal.toLowerCase(), sub: 'Keep your meals on track for the day.', ctaLabel: 'Log food', ctaAction: "navigate('log')" };
  if (s.moneyOn && s.moneyOver) return { tone: 'warn', title: "You're over budget this period", sub: 'Spending has passed your income — ease off where you can.', ctaLabel: 'See money', ctaAction: "navigate('log')" };
  if (s.goalBehind) return { tone: 'warn', title: 'Behind on "' + (s.goalTitle || 'your goal') + '"', sub: 'Pick one action today that moves it forward.', ctaLabel: 'View goal', ctaAction: 'openGoalForm()' };
  return { tone: 'good', title: "You're on track today", sub: 'Logged and on pace — keep the chain going.', ctaLabel: '', ctaAction: '' };
}
function renderNextStep() {
  if (!state.data || !state.data.days) return '';
  const today = state.data.days.find(d => d.date === todayStr());
  const nut = getNutrition();
  const fLog = (today && today.foodLog) || [];
  const eaten = foodLogTotals(fLog);
  const goal = state.data.profile && state.data.profile.goal;
  const gStat = goal ? goalStatus(goal, currentGoalValue(goal), Date.now()) : null;
  let emptyMeal = null;
  if (nut && nut.meals && fLog.length) {
    const count = nut.meals.count;
    for (let i = 0; i < count; i++) { if (!fLog.some(x => Math.min(Math.max(0, x.meal || 0), count - 1) === i)) { emptyMeal = nut.meals.labels[i]; break; } }
  }
  const mc = getMoneyCircle();
  const step = pickNextStep({
    loggedToday: !!today,
    goalReached: !!(gStat && gStat.reached),
    goalBehind: !!(gStat && gStat.daysLeft != null && !gStat.onTrack),
    goalTitle: goal && goal.title,
    nutOn: !!nut,
    proteinLeft: nut ? Math.round(nut.protein.g - eaten.p) : null,
    anyFood: fLog.length > 0,
    emptyMeal,
    gymOn: isPillarOn('gym'),
    gymDone: !!(today && today.gym && today.gym.done),
    moneyOn: isPillarOn('money'),
    moneyOver: mc.available > 0 && mc.spent > mc.available
  });
  if (!step) return '';
  return '<div class="card nextstep ' + (step.tone || '') + '">' +
    '<div class="ns-label">Today\'s one move</div>' +
    '<div class="ns-title">' + escapeHtml(step.title) + '</div>' +
    (step.sub ? '<div class="ns-sub">' + escapeHtml(step.sub) + '</div>' : '') +
    (step.ctaLabel ? '<button type="button" class="btn btn-primary btn-sm ns-cta" onclick="' + step.ctaAction + '">' + escapeHtml(step.ctaLabel) + '</button>' : '') +
    '</div>';
}

// Quest Mode turns the tracker into a short mission board. It uses the same
// data as Today's one move, but makes the day feel intentional and finishable.
function dailyQuests() {
  const today = state.data.days.find(d => d.date === todayStr());
  const nut = getNutrition();
  const fLog = (today && today.foodLog) || [];
  const eaten = foodLogTotals(fLog);
  const stats = getWeekStats();
  const quests = [];

  quests.push({
    title: today ? 'Daily record secured' : 'Log the day',
    sub: today ? 'Your chain has a mark for today.' : 'Capture the day before it disappears.',
    done: !!today,
    action: 'navigate(\'log\')',
    cta: today ? 'Review' : 'Log now'
  });

  if (isPillarOn('gym')) {
    const done = !!(today && today.gym && today.gym.done);
    quests.push({
      title: done ? pillar('gym').label + ' done' : 'Move the body',
      sub: done ? 'Training is already feeding the rest of the system.' : 'One session, walk, or recovery block keeps momentum alive.',
      done,
      action: 'navigate(\'log\')',
      cta: done ? 'View' : 'Train'
    });
  }

  if (nut) {
    const left = Math.round(nut.protein.g - eaten.p);
    quests.push({
      title: left <= 10 ? 'Protein target protected' : 'Protein rescue',
      sub: left <= 10 ? 'You are close enough for today.' : 'Add about ' + left + 'g protein to support the climb.',
      done: left <= 10,
      action: 'navigate(\'log\')',
      cta: 'Food'
    });
  } else if (isPillarOn('food')) {
    const done = !!(today && today.food && today.food.rating);
    quests.push({
      title: done ? 'Nutrition rated' : 'Rate the fuel',
      sub: done ? 'Food signal is logged.' : 'A simple 1-5 score gives the coach more pattern data.',
      done,
      action: 'navigate(\'log\')',
      cta: 'Rate'
    });
  }

  if (isPillarOn('networking')) {
    const goal = state.data.profile.weeklyNetworkGoal || 3;
    const done = stats.networkCount >= goal;
    quests.push({
      title: done ? 'Network goal hit' : 'Open one door',
      sub: done ? stats.networkCount + ' connections this week.' : Math.max(0, goal - stats.networkCount) + ' left for the week. One message counts.',
      done,
      action: 'navigate(\'contacts\')',
      cta: 'Contacts'
    });
  }

  if (isPillarOn('reading')) {
    const goal = state.data.profile.weeklyReadGoal || 0;
    const done = goal > 0 ? stats.readPages >= goal : !!(today && today.reading && today.reading.pages > 0);
    quests.push({
      title: done ? 'Reading signal logged' : 'Bank ten pages',
      sub: done ? stats.readPages + ' pages this week.' : (goal > 0 ? Math.max(0, goal - stats.readPages) + ' pages left for the weekly goal.' : 'Ten pages keeps the mind in the system.'),
      done,
      action: 'navigate(\'reading\')',
      cta: 'Read'
    });
  }

  if (isPillarOn('money')) {
    const mc = getMoneyCircle();
    const done = mc.available <= 0 || mc.spent <= mc.available;
    quests.push({
      title: done ? 'Money circle stable' : 'Close the spending leak',
      sub: done ? 'Income and spending are inside the current circle.' : formatCurrency(mc.spent - mc.available) + ' over plan. Log the reason while it is fresh.',
      done,
      action: 'navigate(\'log\')',
      cta: 'Money'
    });
  }

  return quests.slice(0, 4);
}

function renderQuestCard() {
  const quests = dailyQuests();
  if (!quests.length) return '';
  const complete = quests.filter(q => q.done).length;
  const rows = quests.map(q => '<button type="button" class="quest-row' + (q.done ? ' done' : '') + '" onclick="' + q.action + '">' +
    '<span class="quest-check">' + (q.done ? 'OK' : '') + '</span>' +
    '<span class="quest-copy"><b>' + escapeHtml(q.title) + '</b><small>' + escapeHtml(q.sub) + '</small></span>' +
    '<span class="quest-cta">' + escapeHtml(q.cta) + '</span>' +
    '</button>').join('');
  return '<div class="card quest-card">' +
    '<div class="quest-top"><div><div class="quest-label">Quest mode</div><div class="quest-title">Today\'s mission board</div></div>' +
    '<div class="quest-score">' + complete + '/' + quests.length + '</div></div>' +
    '<div class="quest-list">' + rows + '</div>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────
// THIS WEEK IN NUTRITION — zoom-out adherence over the last 7 days
// ─────────────────────────────────────────────────────────────
function nutritionWeekStats(days, targetCal, targetProtein, today) {
  const start = new Date(today + 'T00:00:00'); start.setDate(start.getDate() - 6);
  const startStr = start.toISOString().split('T')[0];
  const win = (days || []).filter(d => d.date >= startStr && d.date <= today && ((d.calories || 0) > 0 || (d.eaten && d.eaten.protein > 0)));
  const logged = win.length;
  if (!logged) return { logged: 0 };
  const sumCal = win.reduce((s, d) => s + (d.calories || 0), 0);
  const sumP = win.reduce((s, d) => s + ((d.eaten && d.eaten.protein) || 0), 0);
  const proteinHit = win.filter(d => targetProtein && ((d.eaten && d.eaten.protein) || 0) >= targetProtein * 0.9).length;
  const calOnTarget = win.filter(d => targetCal && Math.abs((d.calories || 0) - targetCal) <= targetCal * 0.12).length;
  return { logged, avgCal: Math.round(sumCal / logged), avgProtein: Math.round(sumP / logged), proteinHit, calOnTarget };
}
function renderNutritionWeekCard() {
  const nut = getNutrition();
  if (!nut) return '';
  const s = nutritionWeekStats(state.data.days, nut.calories, nut.protein.g, todayStr());
  if (!s.logged) return '';
  const verdict = s.proteinHit >= Math.ceil(s.logged * 0.7)
    ? 'Protein on point — strong week. Keep it rolling.'
    : (s.proteinHit >= Math.ceil(s.logged * 0.4)
      ? 'Decent week — nudge protein up to hit it more days.'
      : 'Protein slipped this week — make it the priority at every meal.');
  return '<div class="card nutweek-card">' +
    '<div class="card-title">This week in nutrition</div>' +
    '<div class="nutweek-stats">' +
    '<div class="nw-stat"><div class="nw-num">' + s.avgCal.toLocaleString() + '</div><div class="nw-lbl">avg cal/day <span>target ' + nut.calories.toLocaleString() + '</span></div></div>' +
    '<div class="nw-stat"><div class="nw-num mp">' + s.avgProtein + 'g</div><div class="nw-lbl">avg protein <span>target ' + nut.protein.g + 'g</span></div></div>' +
    '<div class="nw-stat"><div class="nw-num">' + s.proteinHit + '<span class="nw-of">/' + s.logged + '</span></div><div class="nw-lbl">days protein hit</div></div>' +
    '</div>' +
    '<div class="nutweek-verdict">' + verdict + '</div>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────
// YOUR CLIMB — a signature SVG ascent: momentum → how far up the mountain
// ─────────────────────────────────────────────────────────────
// Momentum 0-100 from streak + this week's consistency + goal progress (testable)
function momentumScore(streak, weeklyScore, goalPct) {
  const s = Math.min(100, (streak || 0) * 6);        // ~17-day streak = full
  const w = Math.max(0, Math.min(100, weeklyScore || 0));
  if (goalPct == null) return Math.round(s * 0.5 + w * 0.5);
  const g = Math.max(0, Math.min(100, goalPct));
  return Math.round(s * 0.4 + w * 0.35 + g * 0.25);
}
// The mountain trail — switchback waypoints from base (bottom-left) to summit
// One 3D-shaded, snow-capped peak — a sunlit face, a shadow face (ridge leans
// right, light from the upper-left) and a two-tone snow cap. Returns SVG. (testable)
function peak3d(ax, ay, blx, brx, baseY, pal) {
  ax = +ax; ay = +ay; blx = +blx; brx = +brx; baseY = +baseY;
  const f = n => (+n).toFixed(1);
  const seamX = ax + (brx - ax) * 0.16;                 // ridgeline foot (shadow side)
  const snowY = ay + (baseY - ay) * 0.30;               // snow line ~30% down
  const snL = ax + (blx - ax) * 0.30, snR = ax + (brx - ax) * 0.30, snSeam = ax + (snR - ax) * 0.16;
  return (
    '<polygon points="' + f(ax) + ',' + f(ay) + ' ' + f(blx) + ',' + f(baseY) + ' ' + f(brx) + ',' + f(baseY) + '" fill="' + pal.lit + '"/>' +
    '<polygon points="' + f(ax) + ',' + f(ay) + ' ' + f(seamX) + ',' + f(baseY) + ' ' + f(brx) + ',' + f(baseY) + '" fill="' + pal.shadow + '"/>' +
    '<polygon points="' + f(ax) + ',' + f(ay) + ' ' + f(snL) + ',' + f(snowY) + ' ' + f(snR) + ',' + f(snowY) + '" fill="' + pal.snowLit + '"/>' +
    '<polygon points="' + f(ax) + ',' + f(ay) + ' ' + f(snSeam) + ',' + f(snowY) + ' ' + f(snR) + ',' + f(snowY) + '" fill="' + pal.snowShadow + '"/>' +
    (pal.edge ? '<line x1="' + f(ax) + '" y1="' + f(ay) + '" x2="' + f(seamX) + '" y2="' + f(baseY) + '" stroke="' + pal.edge + '" stroke-width="1" opacity="0.4"/>' : '')
  );
}
function climbTrail() { return [[26, 176], [98, 150], [60, 122], [150, 104], [108, 74], [212, 60], [176, 38], [292, 26]]; }
function trailTotal(pts) { let t = 0; for (let i = 1; i < pts.length; i++) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return t; }
// The point a fraction t (0..1) of the way along the trail (testable)
function pointAlong(pts, t) {
  const total = trailTotal(pts);
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (target <= len || i === pts.length - 1) { const f = len ? target / len : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; }
    target -= len;
  }
  return pts[pts.length - 1];
}
// The inner mountain scene (peaks, trail, milestone flags, summit, climber).
// Reused by the live card AND the shareable image, so they always match.
function climbScene(pts, m, streak, animated) {
  const d = 'M' + pts.map(p => p[0] + ' ' + p[1]).join(' L ');
  const total = Math.round(trailTotal(pts));
  const climbed = Math.round(total * m / 100);
  const frac = Math.max(0, Math.min(1, m / 100)).toFixed(3);
  const c = pointAlong(pts, m / 100);
  const s = pts[pts.length - 1];
  const milestones = [{ t: 0.34, days: 7 }, { t: 0.7, days: 30 }];
  const ms = milestones.map(k => {
    const p = pointAlong(pts, k.t);
    const reached = (streak || 0) >= k.days;
    return '<g class="climb-ms' + (reached ? ' reached' : ' pending') + '">' +
      '<line x1="' + p[0].toFixed(1) + '" y1="' + p[1].toFixed(1) + '" x2="' + p[0].toFixed(1) + '" y2="' + (p[1] - 11).toFixed(1) + '" stroke="#94a3b8" stroke-width="1.4"/>' +
      '<polygon points="' + p[0].toFixed(1) + ',' + (p[1] - 11).toFixed(1) + ' ' + (p[0] + 8).toFixed(1) + ',' + (p[1] - 8.5).toFixed(1) + ' ' + p[0].toFixed(1) + ',' + (p[1] - 6).toFixed(1) + '" fill="' + (reached ? '#ef4444' : '#cbd5e1') + '"/>' +
      '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 10).toFixed(1) + '" text-anchor="middle" font-size="7" font-weight="800" fill="#64748b">' + k.days + 'd</text>' +
      '</g>';
  }).join('');
  const cbk = { lit: '#9fbcc8', shadow: '#7f9eac', snowLit: '#eef5f7', snowShadow: '#cad9df' };
  const cfg = { lit: '#5fa98a', shadow: '#3b7a62', snowLit: '#ffffff', snowShadow: '#dae8ef', edge: '#cdeede' };
  return '<circle cx="264" cy="36" r="15" fill="#fff" opacity="0.7"/>' +
    '<polygon class="climb-peak-back" points="0,190 0,124 52,108 104,124 156,104 214,122 268,104 320,120 320,190" fill="#cdd9e6" opacity="0.6"/>' +
    '<polygon points="0,190 0,140 44,128 92,142 150,126 206,140 262,126 320,140 320,190" fill="#aebfd2" opacity="0.55"/>' +
    peak3d(248, 78, 150, 332, 190, cbk) +
    peak3d(104, 60, -12, 214, 190, cfg) +
    '<path d="' + d + '" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7" opacity="0.6"/>' +
    '<path d="' + d + '" class="climb-trail-done" fill="none" stroke="url(#climbDone)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="' + climbed + ' 9999" style="--len:' + climbed + '"/>' +
    ms +
    '<line x1="' + s[0] + '" y1="' + s[1] + '" x2="' + s[0] + '" y2="' + (s[1] - 15) + '" stroke="#475569" stroke-width="2"/>' +
    '<polygon points="' + s[0] + ',' + (s[1] - 15) + ' ' + (s[0] + 13) + ',' + (s[1] - 11) + ' ' + s[0] + ',' + (s[1] - 7) + '" fill="#ef4444"/>' +
    (animated
      ? '<g class="climber-walk"><circle r="8" fill="#fff"/><circle r="5.5" fill="url(#climbDone)"/>' +
        '<animateMotion dur="1.7s" begin="0s" fill="freeze" calcMode="spline" keyTimes="0;1" keyPoints="0;' + frac + '" keySplines="0.42 0 0.2 1" path="' + d + '"/></g>'
      : '<circle class="climber-ring" cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="8" fill="#fff"/>' +
        '<circle class="climber" cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="5.5" fill="url(#climbDone)"/>');
}
function climbCaption(m) {
  return m >= 80 ? 'Near the summit — incredible momentum.'
    : m >= 50 ? 'Strong climb. Keep stacking days.'
      : m >= 20 ? "You're moving up — one log at a time."
        : 'Every climb starts with one step. Log today.';
}
function climbMomentum() {
  const goal = state.data.profile && state.data.profile.goal;
  const gp = goal ? goalStatus(goal, currentGoalValue(goal), Date.now()) : null;
  return momentumScore(loggingStreak(), getWeeklyScore(), gp ? gp.pct : null);
}
function renderClimbCard() {
  const streak = loggingStreak();
  const m = climbMomentum();
  const goal = state.data.profile && state.data.profile.goal;
  const svg =
    '<svg viewBox="0 0 320 190" class="climb-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Your climb, ' + m + ' percent">' +
    '<defs>' +
    '<linearGradient id="climbSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f0ff"/><stop offset="1" stop-color="#ffe9d8"/></linearGradient>' +
    '<linearGradient id="climbDone" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fb923c"/><stop offset="0.5" stop-color="#ef4444"/><stop offset="1" stop-color="#a855f7"/></linearGradient>' +
    '</defs>' +
    '<rect x="0" y="0" width="320" height="190" rx="12" fill="url(#climbSky)"/>' +
    climbScene(climbTrail(), m, streak, !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) +
    '</svg>';
  return '<div class="card climb-card">' +
    '<div class="climb-head"><div><div class="climb-title">Your climb</div>' +
    '<div class="climb-sub">' + streak + '-day streak · toward ' + escapeHtml(goal ? goal.title : 'your peak') + '</div></div>' +
    '<div class="climb-pct">' + m + '%</div></div>' +
    svg +
    '<div class="climb-caption">' + escapeHtml(climbCaption(m)) + '</div>' +
    '<button type="button" class="btn btn-outline btn-sm climb-share-btn" onclick="shareMyClimb()">Share my climb</button>' +
    '</div>';
}
// Build a square shareable PNG of the climb (SVG → image → canvas)
function climbShareSvg(size) {
  const pts = climbTrail();
  const streak = loggingStreak();
  const m = climbMomentum();
  const goal = state.data.profile && state.data.profile.goal;
  const goalLabel = escapeHtml(goal ? goal.title : 'my peak');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 1080 1080">' +
    '<defs>' +
    '<linearGradient id="climbDone" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fb923c"/><stop offset="0.5" stop-color="#ef4444"/><stop offset="1" stop-color="#a855f7"/></linearGradient>' +
    '<linearGradient id="shareBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#1c1233"/></linearGradient>' +
    '<linearGradient id="climbSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#243049"/><stop offset="1" stop-color="#3a2a40"/></linearGradient>' +
    '</defs>' +
    '<rect width="1080" height="1080" fill="url(#shareBg)"/>' +
    '<text x="540" y="148" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="800" letter-spacing="4" fill="#94a3b8">YOUR CLIMB</text>' +
    '<text x="540" y="320" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="200" font-weight="900" fill="url(#climbDone)">' + m + '%</text>' +
    '<text x="540" y="392" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="600" fill="#cbd5e1">' + streak + '-day streak · toward ' + goalLabel + '</text>' +
    '<svg x="110" y="450" width="860" height="510" viewBox="0 0 320 190"><rect width="320" height="190" rx="14" fill="url(#climbSky)"/>' + climbScene(pts, m, streak, false) + '</svg>' +
    '<text x="540" y="1008" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700" fill="#e2e8f0">' + escapeHtml(climbCaption(m)) + '  ·  Onward</text>' +
    '</svg>';
}
function buildClimbShareBlob(size) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { const cv = document.createElement('canvas'); cv.width = cv.height = size; cv.getContext('2d').drawImage(img, 0, 0, size, size); cv.toBlob(b => resolve(b), 'image/png'); };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(climbShareSvg(size));
  });
}
async function shareMyClimb() {
  try {
    showToast('Building your climb…', 'success');
    const blob = await buildClimbShareBlob(1080);
    if (!blob) { showToast('Could not create the image.', 'error'); return; }
    const file = new File([blob], 'my-climb.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My climb on Onward', text: 'Onward, across my whole life.' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'my-climb.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Saved — post your climb!', 'success');
    }
  } catch { showToast('Could not share.', 'error'); }
}

// ─────────────────────────────────────────────────────────────
// GYM PLAN — training recommendation by goal (lose / gain / maintain) + weight
// ─────────────────────────────────────────────────────────────
function gymPlan(goal, weightKg) {
  const g = (goal === 'lose' || goal === 'gain') ? goal : 'maintain';
  // ~30 min of moderate cardio (~7 METs) — kcal scales with bodyweight
  const cardioBurn30 = weightKg ? Math.round((7 * 3.5 * weightKg / 200) * 30) : 0;
  const plans = {
    lose: {
      headline: 'Train for fat loss', days: '4–5 days/week',
      split: 'Full-body strength 3× + 2 cardio / conditioning days',
      strength: 'Compound lifts — 3–4 sets of 8–12 reps',
      cardio: '20–40 min moderate cardio or intervals, 2–3×/week',
      tip: 'Lift to keep your muscle while the deficit burns fat — protein high, steps up.',
      diet: {
        cals: 'Eat in a ~20% calorie deficit',
        protein: 'High protein — ~1.8–2.2 g per kg of bodyweight',
        rules: ['Protein at every meal — chicken, fish, eggs, Greek yogurt', 'Fill half your plate with veg + fiber to stay full', 'Cut liquid calories and snacking first']
      }
    },
    gain: {
      headline: 'Train for muscle gain', days: '4–5 days/week',
      split: 'Push / Pull / Legs or Upper / Lower',
      strength: 'Progressive overload — 3–5 sets of 6–12 reps, add weight weekly',
      cardio: 'Light cardio 1–2×/week for health — don\'t burn the surplus',
      tip: 'Hit each muscle ~2×/week and push the big lifts. Eat in a surplus.',
      diet: {
        cals: 'Eat in a ~10–15% calorie surplus',
        protein: '~1.8–2.2 g of protein per kg to build',
        rules: ['Eat enough — the surplus is what builds muscle', 'Put most of your carbs around training', 'Don\'t skip meals; add a shake if you fall short']
      }
    },
    maintain: {
      headline: 'Train to stay strong', days: '3–4 days/week',
      split: 'Balanced full-body or Upper / Lower',
      strength: '3–4 sets of 8–12 reps',
      cardio: '2–3 cardio sessions for heart health',
      tip: 'Mix strength and cardio, keep protein steady, stay consistent.',
      diet: {
        cals: 'Eat around your maintenance calories',
        protein: 'Keep protein ~1.6–2 g per kg',
        rules: ['Mostly whole foods, minimal processed', 'Protein with every meal', 'Stay consistent week to week']
      }
    }
  };
  return Object.assign({ goal: g, cardioBurn30 }, plans[g]);
}
function renderGymPlanCard() {
  if (!isPillarOn('gym')) return '';
  const n = state.data.profile && state.data.profile.nutrition;
  if (!n || !n.weightKg || !n.goal) return ''; // needs weight + goal (from nutrition setup)
  const p = gymPlan(n.goal, n.weightKg);
  const nut = getNutrition();
  const wDisp = Math.round(kgToDisplay(n.weightKg)) + ' ' + (weightUnitPref() === 'lbs' ? 'lb' : 'kg');
  const row = (k, v) => '<div class="gp-row"><span class="gp-k">' + k + '</span><span class="gp-v">' + v + '</span></div>';
  return '<div class="card gymplan-card">' +
    '<div class="card-title">' + escapeHtml(p.headline) + '</div>' +
    '<div class="card-sub">Tailored to your goal (' + p.goal + ') and weight (' + wDisp + ')</div>' +
    '<div class="gp-grid">' +
    row('Frequency', escapeHtml(p.days)) +
    row('Split', escapeHtml(p.split)) +
    row('Strength', escapeHtml(p.strength)) +
    row('Cardio', escapeHtml(p.cardio) + (p.cardioBurn30 ? ' · ~' + p.cardioBurn30 + ' kcal / 30 min at your weight' : '')) +
    '</div>' +
    '<div class="gp-diet">' +
    '<div class="gp-diet-head">How to eat for this goal</div>' +
    '<div class="gp-grid">' +
    (nut
      ? row('Calories', nut.calories.toLocaleString() + ' / day') + row('Protein', nut.protein.g + 'g / day')
      : row('Calories', escapeHtml(p.diet.cals)) + row('Protein', escapeHtml(p.diet.protein))) +
    '</div>' +
    '<ul class="gp-diet-rules">' + p.diet.rules.map(r => '<li>' + escapeHtml(r) + '</li>').join('') + '</ul>' +
    (nut ? '<button class="btn-link gp-diet-link" onclick="navigate(\'log\')">Log today\'s food →</button>' : '<button class="btn-link gp-diet-link" onclick="navigate(\'settings\')">Set up your nutrition →</button>') +
    '</div>' +
    '<div class="gp-tip">' + escapeHtml(p.tip) + '</div>' +
    '</div>';
}
// Compact training hint shown right in the gym log section
function renderGymPlanHint() {
  if (!isPillarOn('gym')) return '';
  const n = state.data.profile && state.data.profile.nutrition;
  if (!n || !n.weightKg || !n.goal) return '';
  const p = gymPlan(n.goal, n.weightKg);
  const nut = getNutrition();
  return '<div class="gym-plan-hint"><b>For ' + p.goal + ':</b> ' + escapeHtml(p.split) + ' · ' + escapeHtml(p.strength) +
    (p.cardioBurn30 ? ' · ~' + p.cardioBurn30 + ' kcal/30 min cardio' : '') +
    (nut ? ' · eat ~' + nut.calories.toLocaleString() + ' cal / ' + nut.protein.g + 'g protein' : '') + '</div>';
}

// ─────────────────────────────────────────────────────────────
// WORKOUT TRACKER — exercise library, set/rep logging, rest timer
// A day's workout lives on day.gym.exercises = [{ name, muscle, sets:[{reps,weight}] }].
// Everything else about day.gym (done/muscleGroup/duration/notes) is preserved, so
// this is purely additive to the existing boolean "did you train?" pillar.
// ─────────────────────────────────────────────────────────────
const EXERCISE_LIBRARY = {
  Chest: ['Barbell Bench Press', 'Incline Barbell Bench Press', 'Decline Bench Press', 'Flat Dumbbell Press', 'Incline Dumbbell Press',
    'Machine Chest Press', 'Smith Machine Bench Press', 'Push-Up', 'Incline Push-Up', 'Dips',
    'Chest Fly', 'Pec Deck Machine', 'Cable Crossover', 'Low Cable Fly', 'High Cable Fly',
    'Landmine Press', 'Dumbbell Pullover', 'Svend Press'],
  Back: ['Pull-Up', 'Chin-Up', 'Lat Pulldown', 'Wide-Grip Lat Pulldown', 'Straight-Arm Pulldown',
    'Bent-Over Row', 'Pendlay Row', 'T-Bar Row', 'Seated Cable Row', 'Chest-Supported Row',
    'Dumbbell Row', 'Meadows Row', 'Inverted Row', 'Deadlift', 'Rack Pull',
    'Trap Bar Deadlift', 'Back Extension', 'Face Pull'],
  Legs: ['Back Squat', 'Front Squat', 'Goblet Squat', 'Hack Squat', 'Leg Press',
    'Bulgarian Split Squat', 'Walking Lunge', 'Reverse Lunge', 'Step-Up', 'Romanian Deadlift',
    'Sumo Deadlift', 'Leg Extension', 'Leg Curl', 'Seated Leg Curl', 'Hip Thrust',
    'Glute Bridge', 'Calf Raise', 'Seated Calf Raise', 'Adductor Machine', 'Box Jump'],
  Shoulders: ['Overhead Press', 'Dumbbell Shoulder Press', 'Machine Shoulder Press', 'Arnold Press', 'Behind-the-Neck Press',
    'Bradford Press', 'Landmine Shoulder Press', 'Pike Push-Up', 'Lateral Raise', 'Cable Lateral Raise',
    'Front Raise', 'Cable Front Raise', 'Plate Front Raise', 'Rear Delt Fly', 'Reverse Pec Deck',
    'Upright Row', 'Shrug'],
  Arms: ['Barbell Curl', 'EZ-Bar Curl', 'Dumbbell Curl', 'Incline Dumbbell Curl', 'Hammer Curl',
    'Preacher Curl', 'Concentration Curl', 'Cable Curl', 'Spider Curl', 'Zottman Curl',
    'Triceps Pushdown', 'Rope Triceps Pushdown', 'Skull Crusher', 'Overhead Triceps Extension', 'Triceps Kickback',
    'Close-Grip Bench Press', 'Bench Dip', 'Diamond Push-Up', 'Wrist Curl', 'Reverse Wrist Curl'],
  Core: ['Plank', 'Side Plank', 'Hollow Hold', 'Crunch', 'Bicycle Crunch',
    'Cable Crunch', 'Sit-Up', 'Decline Sit-Up', 'Hanging Leg Raise', 'Lying Leg Raise',
    'Russian Twist', 'Cable Woodchop', 'Pallof Press', 'Ab Wheel Rollout', 'Mountain Climber',
    'Dead Bug', 'Flutter Kicks', 'V-Up'],
  Cardio: ['Treadmill Run', 'Sprints', 'Incline Walk', 'Hiking', 'Cycling',
    'Assault Bike', 'Rowing Machine', 'Stair Climber', 'Elliptical', 'Jump Rope',
    'Burpees', 'Battle Ropes', 'Kettlebell Swing', 'Sled Push', 'Shadow Boxing',
    'Swimming', 'HIIT Intervals']
};
// Ready-made workouts — each is a list of library exercises. Pick one and just
// log your sets/reps, instead of building the workout from scratch.
const WORKOUT_PROGRAMS = {
  'Full Body': ['Back Squat', 'Barbell Bench Press', 'Bent-Over Row', 'Overhead Press', 'Plank'],
  'Push Day': ['Barbell Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Lateral Raise', 'Triceps Pushdown'],
  'Pull Day': ['Pull-Up', 'Bent-Over Row', 'Lat Pulldown', 'Face Pull', 'Barbell Curl'],
  'Leg Day': ['Back Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Calf Raise'],
  'Upper Body': ['Barbell Bench Press', 'Bent-Over Row', 'Overhead Press', 'Lat Pulldown', 'Barbell Curl', 'Triceps Pushdown'],
  'Core & Abs': ['Plank', 'Hanging Leg Raise', 'Cable Crunch', 'Russian Twist', 'Ab Wheel Rollout']
};
// Which body group a library exercise belongs to (for its card label + muscle map).
function exerciseGroup(name) {
  for (const g of Object.keys(EXERCISE_LIBRARY)) if (EXERCISE_LIBRARY[g].indexOf(name) !== -1) return g;
  return '';
}
// Pure: the set/rep/rest scheme to suggest for a training goal. Drives the rep
// hint AND the default rest timer, so the workout matches what they're after. (testable)
function repSchemeForGoal(goal) {
  if (goal === 'gain') return { label: 'Build muscle', sets: '4–5 sets', reps: '6–10 reps', rest: 120, tip: 'Heavier weight — add load when you hit the top of the rep range.' };
  if (goal === 'lose') return { label: 'Lose fat', sets: '3–4 sets', reps: '12–15 reps', rest: 60, tip: 'Lighter weight, short rests, plus a quick conditioning finisher.' };
  return { label: 'Stay strong', sets: '3–4 sets', reps: '8–12 reps', rest: 90, tip: 'Balanced volume — steady and consistent.' };
}
// Pure: nudge a program toward the goal. Fat loss gets a conditioning finisher;
// muscle gain leans on the heavier rep scheme rather than extra exercises. (testable)
function tailorProgram(list, goal) {
  const out = (list || []).slice();
  if (goal === 'lose' && out.length && out.indexOf('HIIT Intervals') === -1) out.push('HIIT Intervals');
  return out;
}
// Pure: is this exercise measured by time held/done, not reps? All cardio, plus
// isometric holds (planks, hollow hold, wall sit). Those log a duration. (testable)
function isTimedExercise(name, muscle) {
  if (muscle === 'Cardio') return true;
  const n = String(name || '').toLowerCase();
  return /plank|hollow hold|wall sit|dead hang|l-sit|superman hold/.test(n);
}
// Pure: roll up a workout into headline numbers. Rep sets add reps + volume;
// timed sets add seconds. Any set with something logged counts. (testable)
function workoutTotals(exercises) {
  const list = Array.isArray(exercises) ? exercises : [];
  let sets = 0, reps = 0, volume = 0, secs = 0;
  for (const ex of list) {
    const ss = (ex && Array.isArray(ex.sets)) ? ex.sets : [];
    for (const s of ss) {
      const r = Math.max(0, +(s && s.reps) || 0), w = Math.max(0, +(s && s.weight) || 0), sc = Math.max(0, +(s && s.secs) || 0);
      if (r > 0 || w > 0 || sc > 0) { sets++; reps += r; volume += r * w; secs += sc; }
    }
  }
  return { exercises: list.length, sets, reps, volume: Math.round(volume), secs };
}
// Pure: search the library by name or muscle group. Empty query → everything. (testable)
function searchExercises(query, muscle) {
  const q = String(query || '').trim().toLowerCase();
  const mf = muscle && muscle !== 'All' ? muscle : '';
  const out = [];
  for (const m of Object.keys(EXERCISE_LIBRARY)) {
    if (mf && m !== mf) continue;
    for (const name of EXERCISE_LIBRARY[m]) {
      if (!q || name.toLowerCase().includes(q) || m.toLowerCase().includes(q)) out.push({ name, muscle: m });
    }
  }
  return out;
}
// Pure: seconds → "M:SS". (testable)
function formatClock(seconds) {
  const s = Math.max(0, Math.round(+seconds || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
// Pure: the most-trained muscle group in a workout, for the day's label. (testable)
function topMuscle(exercises) {
  const count = {};
  (Array.isArray(exercises) ? exercises : []).forEach(e => { if (e && e.muscle) count[e.muscle] = (count[e.muscle] || 0) + 1; });
  let best = '', n = 0;
  for (const k of Object.keys(count)) if (count[k] > n) { n = count[k]; best = k; }
  return best;
}

// ─────────────────────────────────────────────────────────────
// MUSCLE MAP — which muscles an exercise hits, on a front/back body
// ─────────────────────────────────────────────────────────────
const MUSCLE_NAMES = {
  chest: 'Chest', frontDelts: 'Front Delts', sideDelts: 'Side Delts', rearDelts: 'Rear Delts',
  biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', traps: 'Traps', lats: 'Lats',
  lowerBack: 'Lower Back', abs: 'Abs', obliques: 'Obliques', glutes: 'Glutes',
  quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves', cardio: 'Full Body · Cardio'
};
// Pure: the primary + secondary muscles an exercise trains. Starts from the body
// group, then refines by keywords in the name (so the 128-item library needs no
// per-exercise table). (testable)
function musclesForExercise(name, group) {
  const n = String(name || '').toLowerCase();
  let P = [], S = [];
  switch (group) {
    case 'Chest':
      if (/dip|push-up|close-grip/.test(n)) { P = ['chest', 'triceps']; S = ['frontDelts']; }
      else if (/pullover/.test(n)) { P = ['chest', 'lats']; S = ['frontDelts']; }
      else { P = ['chest']; S = ['frontDelts', 'triceps']; }
      break;
    case 'Back':
      if (/deadlift|rack pull|good morning/.test(n)) { P = ['lowerBack', 'glutes', 'hamstrings']; S = ['traps', 'lats']; }
      else if (/back extension/.test(n)) { P = ['lowerBack']; S = ['glutes', 'hamstrings']; }
      else if (/face pull/.test(n)) { P = ['rearDelts', 'traps']; S = []; }
      else if (/straight-arm/.test(n)) { P = ['lats']; S = []; }
      else if (/pull-up|chin-up|pulldown/.test(n)) { P = ['lats']; S = ['biceps', 'rearDelts']; }
      else if (/row/.test(n)) { P = ['lats', 'traps']; S = ['biceps', 'rearDelts']; }
      else { P = ['lats']; S = ['biceps', 'rearDelts', 'traps']; }
      break;
    case 'Legs':
      if (/calf|calves/.test(n)) { P = ['calves']; S = []; }
      else if (/leg extension/.test(n)) { P = ['quads']; S = []; }
      else if (/curl/.test(n)) { P = ['hamstrings']; S = ['glutes']; }
      else if (/romanian|sumo deadlift|hip thrust|glute bridge/.test(n)) { P = ['glutes', 'hamstrings']; S = ['lowerBack']; }
      else if (/box jump/.test(n)) { P = ['quads', 'calves']; S = ['glutes']; }
      else { P = ['quads', 'glutes']; S = ['hamstrings']; }
      break;
    case 'Shoulders':
      if (/lateral raise|upright/.test(n)) { P = ['sideDelts']; S = ['traps']; }
      else if (/front raise/.test(n)) { P = ['frontDelts']; S = []; }
      else if (/rear delt|reverse pec/.test(n)) { P = ['rearDelts']; S = ['traps']; }
      else if (/shrug/.test(n)) { P = ['traps']; S = []; }
      else { P = ['frontDelts', 'sideDelts']; S = ['triceps', 'traps']; }
      break;
    case 'Arms':
      if (/wrist/.test(n)) { P = ['forearms']; S = []; }
      else if (/triceps|pushdown|skull|kickback|close-grip|dip|diamond|overhead/.test(n)) { P = ['triceps']; S = []; }
      else { P = ['biceps']; S = (/hammer|zottman/.test(n) ? ['forearms'] : []); }
      break;
    case 'Core':
      if (/twist|woodchop|side plank|pallof|oblique/.test(n)) { P = ['obliques']; S = ['abs']; }
      else { P = ['abs']; S = ['obliques']; }
      break;
    case 'Cardio':
      P = ['cardio']; S = []; break;
    default:
      P = []; S = [];
  }
  return { primary: P, secondary: S };
}
// A stylized front + back body that shades the targeted muscles. Not photoreal —
// it's the shaded anatomical figure fitness apps use, drawn as lightweight SVG.
function muscleMapSVG(primary, secondary) {
  const pri = new Set(primary || []), sec = new Set(secondary || []);
  const cardio = pri.has('cardio');
  const BASE = '#AEB9CA', BONE = '#C7CFDC', STROKE = 'rgba(2,6,23,.08)';
  const f = (...ids) => {
    if (cardio) return 'rgba(16,185,129,.34)';
    if (ids.some(i => pri.has(i))) return '#10B981';
    if (ids.some(i => sec.has(i))) return 'rgba(16,185,129,.42)';
    return BASE;
  };
  const E = (cx, cy, rx, ry, fl) => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + fl + '"/>';
  const R = (x, y, w, h, r, fl) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '" fill="' + fl + '"/>';
  const P = (d, fl) => '<path d="' + d + '" fill="' + fl + '"/>';
  const base = cx =>
    '<circle cx="' + cx + '" cy="22" r="12" fill="' + BONE + '"/>' + R(cx - 5, 32, 10, 8, 3, BONE) +
    R(cx - 15, 44, 30, 62, 12, BASE) + R(cx - 13, 104, 26, 14, 6, BASE) +
    R(cx - 32, 52, 9, 34, 4, BASE) + R(cx + 23, 52, 9, 34, 4, BASE) +
    R(cx - 35, 86, 8, 32, 4, BASE) + R(cx + 27, 86, 8, 32, 4, BASE) +
    R(cx - 13, 116, 12, 52, 6, BASE) + R(cx + 1, 116, 12, 52, 6, BASE) +
    R(cx - 11, 168, 9, 46, 4, BASE) + R(cx + 2, 168, 9, 46, 4, BASE);
  const front =
    E(35, 53, 10, 8, f('frontDelts', 'sideDelts')) + E(85, 53, 10, 8, f('frontDelts', 'sideDelts')) +
    P('M58 48 Q47 47 46 56 Q46 65 58 66 Z', f('chest')) + P('M62 48 Q73 47 74 56 Q74 65 62 66 Z', f('chest')) +
    E(31, 75, 6, 13, f('biceps')) + E(89, 75, 6, 13, f('biceps')) +
    E(28, 104, 5, 13, f('forearms')) + E(92, 104, 5, 13, f('forearms')) +
    R(52, 68, 16, 34, 4, f('abs')) +
    P('M51 70 Q45 80 49 100 L52 100 L52 70 Z', f('obliques')) + P('M69 70 Q75 80 71 100 L68 100 L68 70 Z', f('obliques')) +
    E(53, 140, 8, 24, f('quads')) + E(67, 140, 8, 24, f('quads')) +
    E(53, 188, 6, 17, f('calves')) + E(67, 188, 6, 17, f('calves'));
  const back =
    P('M168 45 L192 45 L186 62 L180 67 L174 62 Z', f('traps')) +
    E(155, 53, 10, 8, f('rearDelts')) + E(205, 53, 10, 8, f('rearDelts')) +
    E(151, 75, 6, 13, f('triceps')) + E(209, 75, 6, 13, f('triceps')) +
    E(148, 104, 5, 13, f('forearms')) + E(212, 104, 5, 13, f('forearms')) +
    P('M171 64 Q162 80 172 98 L176 96 L176 64 Z', f('lats')) + P('M189 64 Q198 80 188 98 L184 96 L184 64 Z', f('lats')) +
    R(173, 92, 14, 14, 4, f('lowerBack')) +
    E(173, 116, 8, 9, f('glutes')) + E(187, 116, 8, 9, f('glutes')) +
    E(173, 145, 8, 22, f('hamstrings')) + E(187, 145, 8, 22, f('hamstrings')) +
    E(173, 188, 6, 17, f('calves')) + E(187, 188, 6, 17, f('calves'));
  return '<svg viewBox="0 0 240 240" class="mm-svg" xmlns="http://www.w3.org/2000/svg">' +
    '<g>' + base(60) + base(180) + '</g>' +
    '<g stroke="' + STROKE + '" stroke-width="0.6">' + front + back + '</g>' +
    '<text x="60" y="232" class="mm-cap" text-anchor="middle">Front</text>' +
    '<text x="180" y="232" class="mm-cap" text-anchor="middle">Back</text>' +
    '</svg>';
}
function showMuscleMap(name, group) { state._mm = { name: name, muscle: group }; renderWorkout(); }
function closeMuscleMap() { state._mm = null; renderWorkout(); }
function renderMuscleOverlay(name, group) {
  const mm = musclesForExercise(name, group);
  const chip = (id, cls) => '<span class="mm-chip ' + cls + '">' + escapeHtml(MUSCLE_NAMES[id] || id) + '</span>';
  const prim = mm.primary.map(id => chip(id, 'mm-prim')).join('');
  const sec = mm.secondary.map(id => chip(id, 'mm-sec')).join('');
  const a = JSON.stringify(name).replace(/"/g, '&quot;'), b = JSON.stringify(group).replace(/"/g, '&quot;');
  return '<div class="mm-overlay" onclick="if(event.target===this)closeMuscleMap()"><div class="mm-card">' +
    '<div class="mm-head"><div class="mm-title">' + escapeHtml(name) + '</div><button type="button" class="mm-close" onclick="closeMuscleMap()">✕</button></div>' +
    muscleMapSVG(mm.primary, mm.secondary) +
    '<div class="mm-legend">' +
    (prim ? '<div class="mm-leg-row"><span class="mm-leg-label mm-prim-label">Primary</span><div class="mm-chips">' + prim + '</div></div>' : '') +
    (sec ? '<div class="mm-leg-row"><span class="mm-leg-label">Also works</span><div class="mm-chips">' + sec + '</div></div>' : '') +
    '</div>' +
    '<button type="button" class="btn-workout mm-add" onclick="woAddExercise(' + a + ',' + b + ');closeMuscleMap()">＋ Add to workout</button>' +
    '</div></div>';
}

// ── Rest-over alert: notification + vibrate + beep, so it reaches them mid-set ──
function restBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const blip = (at, freq) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      o.start(at); o.stop(at + 0.24);
    };
    blip(ctx.currentTime, 880); blip(ctx.currentTime + 0.28, 1175);
    setTimeout(() => { try { ctx.close(); } catch {} }, 900);
  } catch {}
}
function restNotify() {
  try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([200, 90, 200]); } catch {}
  restBeep();
  try {
    if ('Notification' in window && Notification.permission === 'granted')
      new Notification('Rest over — next set! 💪', { body: 'Time to get back under the bar.', icon: 'icons/icon-192.png', tag: 'rest-timer', renotify: true });
  } catch {}
  showToast('Rest over — next set! 💪', 'success');
}

// ── Open / save the workout session ──
function openWorkout(ret, presetMuscle) {
  state._workoutReturn = ret || 'log';
  // If they picked a body part in the gym log, open the library straight to it
  const preset = normalizeLibMuscle(presetMuscle || document.getElementById('gym-group')?.value || '');
  // Make sure anything typed in the full Log form is saved before we leave it
  if (document.getElementById('day-form')) { try { commitDayFromForm(); } catch {} }
  const day = (state.data.days || []).find(x => x.date === todayStr());
  const ex = (day && day.gym && Array.isArray(day.gym.exercises)) ? day.gym.exercises : [];
  state._workout = { exercises: ex.map(e => ({ name: e.name, muscle: e.muscle || '', sets: (e.sets || []).map(s => ({ reps: +s.reps || 0, weight: +s.weight || 0, secs: +s.secs || 0 })) })) };
  state._lib = { open: false, q: '', muscle: preset };
  state._mm = null;
  state._woProgram = false;
  state._wPlanned = '';
  state._restDefault = repSchemeForGoal(trainingGoal() || 'maintain').rest;   // goal-appropriate default rests
  // If they planned this session in advance, load it straight away.
  // Otherwise an empty workout asks "program or your own?"; a resumed one goes in.
  const plan = getPlannedWorkout();
  let openLib = false;
  if (state._workout.exercises.length > 0) {
    state._woChoose = false;
  } else if (plan && plan.program && WORKOUT_PROGRAMS[plan.program]) {
    const goal = trainingGoal();
    state._workout.exercises = tailorProgram(WORKOUT_PROGRAMS[plan.program], goal).map(n => ({ name: n, muscle: exerciseGroup(n), sets: [] }));
    state._restDefault = repSchemeForGoal(goal || 'maintain').rest;
    state._wPlanned = plan.program;
    state._woChoose = false;
    clearPlannedWorkout();           // the plan has been used
    saveWorkout();
  } else if (plan && plan.own) {
    state._woChoose = false; openLib = true;
    clearPlannedWorkout();
  } else {
    state._woChoose = state._workout.exercises.length === 0;
  }
  state.page = 'workout';
  renderWorkout();
  if (openLib) woOpenLibrary();
}
function saveWorkout() {
  if (!state._workout) return;
  const date = todayStr();
  const days = state.data.days = state.data.days || [];
  let day = days.find(x => x.date === date);
  if (!day) { day = { id: uid(), date }; days.push(day); }
  const exercises = state._workout.exercises.map(e => ({ name: e.name, muscle: e.muscle || '', sets: e.sets.map(s => ({ reps: +s.reps || 0, weight: +s.weight || 0, secs: +s.secs || 0 })) }));
  const tot = workoutTotals(exercises);
  const prev = day.gym || {};
  day.gym = {
    done: tot.sets > 0 ? true : !!prev.done,
    muscleGroup: (topMuscle(exercises) || prev.muscleGroup || '').toLowerCase(),
    duration: prev.duration || 0,
    notes: prev.notes || '',
    exercises
  };
  if (!Array.isArray(day._logged)) day._logged = [];
  if (tot.sets > 0 && !day._logged.includes('gym')) day._logged.push('gym');
  saveData();
}
function closeWorkout() {
  woStopRest();
  saveWorkout();
  const tot = workoutTotals(state._workout ? state._workout.exercises : []);
  state._workout = null; state._lib = null; state._mm = null; state._woChoose = false; state._woProgram = false;
  navigate(state._workoutReturn || 'log');
  if (tot.sets > 0) showToast('Workout saved — ' + tot.sets + ' sets · ' + tot.reps + ' reps 💪', 'success');
}

// ── Exercises + sets ──
function woAddExercise(name, muscle) {
  if (!state._workout || !name) return;
  state._workout.exercises.push({ name: name, muscle: muscle || '', sets: [] });
  state._lib.open = false;
  saveWorkout(); renderWorkout();
}
function woAddCustomExercise() {
  const v = (document.getElementById('wo-lib-search')?.value || '').trim();
  if (!v) return;
  woAddExercise(v, state._lib.muscle && state._lib.muscle !== 'All' ? state._lib.muscle : '');
}
function woRemoveExercise(i) {
  if (!state._workout) return;
  state._workout.exercises.splice(i, 1);
  saveWorkout(); renderWorkout();
}
function woAddSet(i) {
  const ex = state._workout && state._workout.exercises[i]; if (!ex) return;
  if (isTimedExercise(ex.name, ex.muscle)) {
    const min = parseInt(document.getElementById('wo-min-' + i)?.value) || 0;
    const sec = parseInt(document.getElementById('wo-sec-' + i)?.value) || 0;
    const secs = min * 60 + sec;
    if (secs <= 0) { showToast('Enter a time (minutes and/or seconds)', 'error'); return; }
    ex.sets.push({ secs });
    saveWorkout(); renderWorkout();          // no rest clock for timed work
    return;
  }
  const reps = parseInt(document.getElementById('wo-reps-' + i)?.value) || 0;
  const weight = parseFloat(document.getElementById('wo-weight-' + i)?.value) || 0;
  if (reps <= 0 && weight <= 0) { showToast('Enter reps (and weight, if any)', 'error'); return; }
  ex.sets.push({ reps, weight });
  saveWorkout();
  woStartRest(state._restDefault || 90);   // auto-start the rest clock after each set (also re-renders)
}
function woRemoveSet(i, j) {
  const ex = state._workout && state._workout.exercises[i]; if (!ex) return;
  ex.sets.splice(j, 1);
  saveWorkout(); renderWorkout();
}

// ── Rest timer ── counts real wall-clock time (via an absolute end timestamp),
// so it stays accurate even when the phone throttles/pauses timers between sets.
function woStartRest(sec) {
  woStopRest();
  const total = Math.max(5, Math.round(+sec) || 90);
  state._restDefault = total;
  state._restTimer = { total, left: total, endAt: Date.now() + total * 1000, running: true, id: 0 };
  state._restTimer.id = setInterval(woRestTick, 500);
  renderWorkout();
}
function woRestTick() {
  const t = state._restTimer; if (!t || !t.running) return;
  if (state.page !== 'workout') { woStopRest(); return; }   // left the workout — don't leak or buzz later
  const left = Math.max(0, Math.round((t.endAt - Date.now()) / 1000));
  t.left = left;
  if (left <= 0) { woStopRest(); restNotify(); renderWorkout(); return; }
  const clock = document.getElementById('wo-rest-clock'); if (clock) clock.textContent = formatClock(left);
  const fill = document.getElementById('wo-rest-fill'); if (fill) fill.style.width = Math.round((left / t.total) * 100) + '%';
}
function woAddRest(delta) {
  const t = state._restTimer; if (!t || !t.running) return;
  t.endAt += delta * 1000;
  t.left = Math.max(1, Math.round((t.endAt - Date.now()) / 1000));
  t.total = Math.max(t.total, t.left);
  const clock = document.getElementById('wo-rest-clock'); if (clock) clock.textContent = formatClock(t.left);
  const fill = document.getElementById('wo-rest-fill'); if (fill) fill.style.width = Math.round((t.left / t.total) * 100) + '%';
}
function woCancelRest() { woStopRest(); renderWorkout(); }
function woStopRest() { const t = state._restTimer; if (t && t.id) { try { clearInterval(t.id); } catch {} } state._restTimer = null; }

// ── Exercise library overlay — body-part first ──
// Map a free-text muscle label (e.g. from the gym log) to a library group, if it
// matches one exactly. Push / Pull / Full Body have no single group → '' (picker).
function normalizeLibMuscle(g) {
  if (!g) return '';
  const key = String(g).trim().toLowerCase();
  for (const m of Object.keys(EXERCISE_LIBRARY)) if (m.toLowerCase() === key) return m;
  return '';
}
function woOpenLibrary() { state._lib = state._lib || { q: '', muscle: '' }; state._lib.open = true; state._lib.q = ''; renderWorkout(); }
function closeLibrary() { if (state._lib) state._lib.open = false; renderWorkout(); }
function woLibFilter(m) { state._lib.muscle = m; state._lib.q = ''; const s = document.getElementById('wo-lib-search'); if (s) s.value = ''; woLibRefresh(); }   // pick a body part
function woLibBack() { state._lib.muscle = ''; state._lib.q = ''; const s = document.getElementById('wo-lib-search'); if (s) s.value = ''; woLibRefresh(); }       // back to the body-part list
function woLibSearch() { state._lib.q = document.getElementById('wo-lib-search')?.value || ''; woLibRefresh(); }
function woLibRefresh() { const el = document.getElementById('wo-lib-list'); if (el) el.innerHTML = renderLibBody(); }
const BODY_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 7.5v7M12 9.5l-5 2M12 9.5l5 2M9.5 21l2.5-6 2.5 6"/></svg>';
function libItemHtml(e) {
  const a = JSON.stringify(e.name).replace(/"/g, '&quot;'), b = JSON.stringify(e.muscle).replace(/"/g, '&quot;');
  return '<div class="wo-lib-row">' +
    '<button type="button" class="wo-lib-item wo-lib-pick" onclick="woAddExercise(' + a + ',' + b + ')">' +
    '<span class="wo-lib-name">' + escapeHtml(e.name) + '</span><span class="wo-lib-tag">' + escapeHtml(e.muscle) + '</span></button>' +
    '<button type="button" class="wo-lib-info" onclick="showMuscleMap(' + a + ',' + b + ')" aria-label="Muscles worked" title="See muscles worked">' + BODY_ICON + '</button>' +
    '</div>';
}
// The library body switches between three views: a typed search (across all
// parts), a chosen body part (only its exercises), or the body-part picker.
function renderLibBody() {
  const q = (state._lib.q || '').trim();
  if (q) {
    const res = searchExercises(q, 'All');
    const rows = res.map(libItemHtml).join('') || '<div class="wo-lib-empty">No matches in the library.</div>';
    return '<div class="wo-lib-sec">Results for &ldquo;' + escapeHtml(q) + '&rdquo;</div>' + rows +
      '<button type="button" class="wo-lib-item wo-lib-custom" onclick="woAddCustomExercise()">＋ Add &ldquo;' + escapeHtml(q) + '&rdquo; as a custom exercise</button>';
  }
  const m = state._lib.muscle;
  if (!m || m === 'All') {
    return '<div class="wo-lib-sec">Choose a body part</div>' +
      '<div class="wo-bp-grid">' + Object.keys(EXERCISE_LIBRARY).map(part =>
        '<button type="button" class="wo-bp" onclick="woLibFilter(\'' + part + '\')">' +
        '<span class="wo-bp-name">' + part + '</span>' +
        '<span class="wo-bp-count">' + EXERCISE_LIBRARY[part].length + ' exercises ›</span></button>').join('') +
      '</div>';
  }
  const res = searchExercises('', m);
  return '<button type="button" class="wo-lib-back" onclick="woLibBack()">‹ All body parts</button>' +
    '<div class="wo-lib-part-title">' + escapeHtml(m) + ' · ' + res.length + ' exercises</div>' +
    res.map(libItemHtml).join('');
}

// ── Start choice: a ready-made program, or build your own ──
// The user's training goal (lose/gain/maintain) from nutrition, or '' if unset.
function trainingGoal() {
  const n = state.data.profile && state.data.profile.nutrition;
  return (n && (n.goal === 'lose' || n.goal === 'gain' || n.goal === 'maintain')) ? n.goal : '';
}
function programGoalBanner() {
  const goal = trainingGoal();
  const s = repSchemeForGoal(goal || 'maintain');
  if (goal) return '<div class="wo-goal-banner">' +
    '<div class="wo-goal-top">Tailored to your goal · <b>' + s.label + '</b></div>' +
    '<div class="wo-goal-rx">Aim ' + s.sets + ' · ' + s.reps + '</div>' +
    '<div class="wo-goal-tip">' + escapeHtml(s.tip) + '</div></div>';
  return '<div class="wo-goal-banner wo-goal-generic">' +
    '<div class="wo-goal-rx">Aim ' + s.sets + ' · ' + s.reps + '</div>' +
    '<div class="wo-goal-tip">Set your goal in Nutrition to tailor the reps, rests and finisher.</div></div>';
}
function woChooseProgram() { state._woProgram = true; renderWorkout(); }
function woChooseOwn() { state._woChoose = false; state._woProgram = false; woOpenLibrary(); }
function woProgramBack() { state._woProgram = false; renderWorkout(); }
function woLoadProgram(name) {
  const goal = trainingGoal();
  const list = tailorProgram(WORKOUT_PROGRAMS[name] || [], goal);
  state._workout.exercises = list.map(n => ({ name: n, muscle: exerciseGroup(n), sets: [] }));
  state._restDefault = repSchemeForGoal(goal || 'maintain').rest;   // goal-appropriate rests
  state._woChoose = false; state._woProgram = false;
  saveWorkout(); renderWorkout();
}
function renderWoChooser() {
  if (state._woProgram) {
    return '<button type="button" class="wo-lib-back" onclick="woProgramBack()">‹ Back</button>' +
      '<div class="wo-choose-h">Pick a workout</div>' +
      '<div class="wo-choose-sub">Tap one to load it — then just log your sets and reps.</div>' +
      programGoalBanner() +
      '<div class="wo-prog-grid">' + Object.keys(WORKOUT_PROGRAMS).map(name => {
        const exs = WORKOUT_PROGRAMS[name];
        return '<button type="button" class="wo-prog" onclick="woLoadProgram(' + JSON.stringify(name).replace(/"/g, '&quot;') + ')">' +
          '<div class="wo-prog-top"><span class="wo-prog-name">' + escapeHtml(name) + '</span><span class="wo-prog-count">' + exs.length + ' exercises</span></div>' +
          '<div class="wo-prog-list">' + exs.map(escapeHtml).join(' · ') + '</div>' +
          '<span class="wo-prog-go">Start this workout ›</span></button>';
      }).join('') + '</div>';
  }
  return '<div class="wo-choose-h">How do you want to train?</div>' +
    '<div class="wo-choose-opts">' +
    '<button type="button" class="wo-opt" onclick="woChooseProgram()">' +
    '<div class="wo-opt-ic">📋</div><div class="wo-opt-t">Give me a program</div>' +
    '<div class="wo-opt-s">Pick a ready-made workout — then just tap your sets &amp; reps.</div></button>' +
    '<button type="button" class="wo-opt" onclick="woChooseOwn()">' +
    '<div class="wo-opt-ic">✏️</div><div class="wo-opt-t">Choose my own</div>' +
    '<div class="wo-opt-s">Build it yourself from 128 exercises across every body part.</div></button>' +
    '</div>';
}

// ── Plan your NEXT workout in advance (before you get to the gym) ──
function getPlannedWorkout() { return (state.data.profile && state.data.profile.plannedWorkout) || null; }
function plannedWorkoutLabel(plan) { return !plan ? '' : (plan.program || (plan.own ? 'Choose at the gym' : '')); }   // pure/testable
function clearPlannedWorkout() { const p = state.data.profile = state.data.profile || {}; p.plannedWorkout = null; saveData(); }
function clearPlanned() { clearPlannedWorkout(); renderDashboard(); }
function planWorkout(name) {
  const p = state.data.profile = state.data.profile || {};
  p.plannedWorkout = { program: name }; saveData();
  closeWorkoutPlanner(); showToast(name + ' is ready for your next session 💪', 'success'); renderDashboard();
}
function planWorkoutOwn() {
  const p = state.data.profile = state.data.profile || {};
  p.plannedWorkout = { own: true }; saveData();
  closeWorkoutPlanner(); showToast("Noted — you'll pick at the gym", 'success'); renderDashboard();
}
function closeWorkoutPlanner() { document.getElementById('wplan-sheet')?.remove(); }
function openWorkoutPlanner() {
  closeWorkoutPlanner();
  const goal = trainingGoal(), s = repSchemeForGoal(goal || 'maintain');
  const sheet = document.createElement('div');
  sheet.id = 'wplan-sheet';
  sheet.className = 'wplan-overlay';
  sheet.innerHTML = '<div class="wplan-card">' +
    '<div class="wplan-head"><div class="wplan-title">Plan your next workout</div><button type="button" class="wplan-close" onclick="closeWorkoutPlanner()">✕</button></div>' +
    '<div class="wplan-sub">Pick it now so it\'s loaded and ready when you get to the gym.</div>' +
    (goal ? '<div class="wplan-goal">' + s.label + ' · aim ' + s.sets + ' · ' + s.reps + '</div>' : '') +
    '<div class="wplan-list">' + Object.keys(WORKOUT_PROGRAMS).map(name =>
      '<button type="button" class="wplan-prog" onclick="planWorkout(' + JSON.stringify(name).replace(/"/g, '&quot;') + ')">' +
      '<span class="wplan-prog-name">' + escapeHtml(name) + '</span><span class="wplan-prog-ex">' + WORKOUT_PROGRAMS[name].length + ' exercises ›</span></button>').join('') +
    '</div>' +
    '<button type="button" class="wplan-own" onclick="planWorkoutOwn()">I\'ll choose at the gym</button>' +
    '</div>';
  sheet.addEventListener('click', e => { if (e.target === sheet) closeWorkoutPlanner(); });
  document.body.appendChild(sheet);
}
// Dashboard card: the "ask before the gym" surface
function renderNextWorkoutCard() {
  if (!isPillarOn('gym')) return '';
  const plan = getPlannedWorkout();
  if (plan && (plan.program || plan.own)) {
    const label = plan.program || "You'll pick at the gym";
    return '<div class="card nextwo-card"><div class="nextwo-row">' +
      '<div><div class="nextwo-label">Next workout' + (plan.program ? ' — ready' : '') + '</div><div class="nextwo-prog">🏋️ ' + escapeHtml(label) + '</div></div>' +
      '<div class="nextwo-acts"><button type="button" class="btn-sm" onclick="openWorkoutPlanner()">Change</button><button type="button" class="btn-sm" onclick="clearPlanned()">Clear</button></div>' +
      '</div></div>';
  }
  return '<button type="button" class="card nextwo-card nextwo-empty" onclick="openWorkoutPlanner()">' +
    '<div class="nextwo-row"><div><div class="nextwo-label">🏋️ Plan your next workout</div>' +
    '<div class="nextwo-hint">Pick a program now so it\'s ready at the gym.</div></div>' +
    '<span class="nextwo-go">Plan ›</span></div></button>';
}
function renderWorkout() {
  if (!state._workout) { navigate('dashboard'); return; }
  document.body.classList.add('wo-fullscreen');   // hide the bottom nav so it can't cover the timer/exercises
  if (state._woChoose) {
    document.getElementById('main').innerHTML =
      '<div class="wo-wrap">' +
      '<div class="wo-top"><button type="button" class="wo-back" onclick="closeWorkout()">‹ Done</button><div class="wo-title">Workout</div><span style="width:54px"></span></div>' +
      renderWoChooser() + '</div>';
    return;
  }
  const unit = weightUnitPref() === 'lbs' ? 'lb' : 'kg';
  const exs = state._workout.exercises;
  const tot = workoutTotals(exs);
  const t = state._restTimer;

  const totals =
    '<div class="wo-totals">' +
    '<div class="wo-tot"><span class="wo-tot-n">' + tot.exercises + '</span><span class="wo-tot-l">exercises</span></div>' +
    '<div class="wo-tot"><span class="wo-tot-n">' + tot.sets + '</span><span class="wo-tot-l">sets</span></div>' +
    '<div class="wo-tot"><span class="wo-tot-n">' + tot.reps + '</span><span class="wo-tot-l">reps</span></div>' +
    '<div class="wo-tot"><span class="wo-tot-n">' + (tot.volume ? tot.volume.toLocaleString() : (tot.secs ? formatClock(tot.secs) : '0')) + '</span><span class="wo-tot-l">' + (!tot.volume && tot.secs ? 'time' : unit + ' lifted') + '</span></div>' +
    '</div>';

  const _goal = trainingGoal();
  const _scheme = repSchemeForGoal(_goal || 'maintain');
  const schemeHint = '<div class="wo-scheme" title="' + escapeAttr(_scheme.tip) + '">' +
    (_goal ? '<span class="wo-scheme-tag">' + _scheme.label + '</span>' : '') +
    '<span class="wo-scheme-rx">Aim ' + _scheme.sets + ' · ' + _scheme.reps + '</span></div>';
  const plannedBanner = state._wPlanned ? '<div class="wo-planned">✓ Your planned session · ' + escapeHtml(state._wPlanned) + '</div>' : '';

  const exCards = exs.length ? exs.map((ex, i) => {
    const timed = isTimedExercise(ex.name, ex.muscle);
    const last = ex.sets[ex.sets.length - 1];
    const setRows = ex.sets.map((s, j) =>
      '<div class="wo-set"><span class="wo-set-n">' + (j + 1) + '</span>' +
      '<span class="wo-set-v">' + (timed ? formatClock(s.secs || 0) : ((s.reps || 0) + ' reps' + (s.weight ? ' × ' + s.weight + ' ' + unit : ''))) + '</span>' +
      '<button type="button" class="wo-set-del" onclick="woRemoveSet(' + i + ',' + j + ')" title="Remove set">✕</button></div>').join('');
    const exA = JSON.stringify(ex.name).replace(/"/g, '&quot;'), exB = JSON.stringify(ex.muscle || '').replace(/"/g, '&quot;');
    const lastSecs = last && last.secs ? last.secs : 0;
    const addRow = timed
      ? '<div class="wo-set-add">' +
        '<input id="wo-min-' + i + '" class="wo-set-in" type="number" inputmode="numeric" placeholder="min" value="' + (lastSecs >= 60 ? Math.floor(lastSecs / 60) : '') + '">' +
        '<span class="wo-x">:</span>' +
        '<input id="wo-sec-' + i + '" class="wo-set-in" type="number" inputmode="numeric" placeholder="sec" value="' + (lastSecs ? (lastSecs % 60) : '') + '">' +
        '<button type="button" class="wo-set-btn" onclick="woAddSet(' + i + ')">＋ Set</button></div>'
      : '<div class="wo-set-add">' +
        '<input id="wo-reps-' + i + '" class="wo-set-in" type="number" inputmode="numeric" placeholder="reps" value="' + (last ? last.reps : '') + '">' +
        '<span class="wo-x">×</span>' +
        '<input id="wo-weight-' + i + '" class="wo-set-in" type="number" inputmode="decimal" placeholder="' + unit + '" value="' + (last && last.weight ? last.weight : '') + '">' +
        '<button type="button" class="wo-set-btn" onclick="woAddSet(' + i + ')">＋ Set</button></div>';
    return '<div class="wo-ex">' +
      '<div class="wo-ex-head"><div><div class="wo-ex-name">' + escapeHtml(ex.name) + '</div>' +
      (ex.muscle ? '<div class="wo-ex-muscle">' + escapeHtml(ex.muscle) + (timed ? ' · timed' : '') + '</div>' : '') + '</div>' +
      '<div class="wo-ex-acts">' +
      '<button type="button" class="wo-ex-info" onclick="showMuscleMap(' + exA + ',' + exB + ')" title="Muscles worked">' + BODY_ICON + '</button>' +
      '<button type="button" class="wo-ex-del" onclick="woRemoveExercise(' + i + ')" title="Remove exercise">✕</button></div></div>' +
      (setRows ? '<div class="wo-sets">' + setRows + '</div>' : '<div class="wo-sets-empty">' + (timed ? 'No sets yet — log your time below.' : 'No sets yet — log your first below.') + '</div>') +
      addRow + '</div>';
  }).join('') : '<div class="wo-empty">🏋️<div class="wo-empty-t">No exercises yet</div><div class="wo-empty-s">Add one from the library and start logging your sets.</div></div>';

  // Rest timer: live bar while running, preset buttons otherwise
  const restBlock = (t && t.running)
    ? '<div class="wo-rest wo-rest-live">' +
      '<div class="wo-rest-top"><span class="wo-rest-label">Resting</span><span class="wo-rest-clock" id="wo-rest-clock">' + formatClock(t.left) + '</span></div>' +
      '<div class="wo-rest-track"><div class="wo-rest-fill" id="wo-rest-fill" style="width:' + Math.round((t.left / t.total) * 100) + '%"></div></div>' +
      '<div class="wo-rest-btns"><button type="button" onclick="woAddRest(15)">+15s</button><button type="button" onclick="woAddRest(30)">+30s</button><button type="button" class="wo-rest-stop" onclick="woCancelRest()">Stop</button></div>' +
      '</div>'
    : '<div class="wo-rest"><div class="wo-rest-top"><span class="wo-rest-label">Rest timer</span><span class="wo-rest-hint">starts after each set</span></div>' +
      '<div class="wo-rest-presets">' + [60, 90, 120, 180].map(n => '<button type="button"' + ((state._restDefault || 90) === n ? ' class="on"' : '') + ' onclick="woStartRest(' + n + ')">' + formatClock(n) + '</button>').join('') + '</div></div>';

  const lib = (state._lib && state._lib.open)
    ? '<div class="wo-lib-overlay" onclick="if(event.target===this)closeLibrary()"><div class="wo-lib">' +
      '<div class="wo-lib-head"><input id="wo-lib-search" class="wo-lib-search" placeholder="Search all exercises…" oninput="woLibSearch()" value="' + escapeAttr(state._lib.q || '') + '"><button type="button" class="wo-lib-close" onclick="closeLibrary()">✕</button></div>' +
      '<div class="wo-lib-list" id="wo-lib-list">' + renderLibBody() + '</div>' +
      '</div></div>'
    : '';

  document.getElementById('main').innerHTML =
    '<div class="wo-wrap">' +
    '<div class="wo-top"><button type="button" class="wo-back" onclick="closeWorkout()">‹ Done</button><div class="wo-title">Workout</div><span style="width:54px"></span></div>' +
    plannedBanner + totals + schemeHint +
    '<div class="wo-ex-list">' + exCards + '</div>' +
    '<button type="button" class="wo-add" onclick="woOpenLibrary()">＋ Add exercise</button>' +
    restBlock +
    '</div>' + lib + (state._mm ? renderMuscleOverlay(state._mm.name, state._mm.muscle) : '');
  if (state._mm) { /* muscle map open on top */ }
  else if (state._lib && state._lib.open) setTimeout(() => document.getElementById('wo-lib-search')?.focus(), 60);
}
// Compact entry point shown inside the Log form's gym section (today only)
function renderWorkoutEntry(day) {
  const tot = workoutTotals(day && day.gym && day.gym.exercises);
  const unit = weightUnitPref() === 'lbs' ? 'lb' : 'kg';
  const parts = [tot.exercises + ' exercise' + (tot.exercises === 1 ? '' : 's'), tot.sets + ' sets'];
  if (tot.reps) parts.push(tot.reps + ' reps');
  if (tot.volume) parts.push(tot.volume.toLocaleString() + ' ' + unit);
  if (tot.secs) parts.push(formatClock(tot.secs) + ' time');
  return '<div class="wo-entry">' +
    (tot.sets ? '<div class="wo-entry-sum">🏋️ ' + parts.join(' · ') + '</div>' : '') +
    '<button type="button" class="btn-workout" onclick="openWorkout()">' + (tot.sets ? '✏️ Edit workout — sets, reps & rest timer' : '🏋️ Track exercises — sets, reps & rest timer') + '</button>' +
    '</div>';
}
function glOpenWorkout() {
  const g = state._guided; if (!g) { openWorkout('log'); return; }
  glCapture();
  g.draft.gymDone = true; g.draft._gymAnswered = true;
  persistStep('gym');           // lock in "trained today" + group/duration before leaving
  openWorkout('log', g.draft.gymGroup || '');   // open the library to the body part they picked, if any
}

// ── Connection of the Week — the cross-pillar "wow" (rule-based, no AI needed) ──
// Compares a numeric metric on days you trained vs days you didn't and surfaces the
// biggest honest gap. This is the one insight no single-purpose app can give you.
function weekConnection(days) {
  const logged = (days || []).filter(Boolean);
  if (logged.length < 6) return null;
  const gymDays = logged.filter(d => d.gym && d.gym.done);
  const restDays = logged.filter(d => !(d.gym && d.gym.done));
  if (gymDays.length < 2 || restDays.length < 2) return null;
  const avg = (arr, fn) => { const v = arr.map(fn); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
  const metrics = [
    { key: 'read', get: d => (d.reading && d.reading.pages) || 0, phrase: (m, up) => 'read ' + m + '% ' + (up ? 'more' : 'fewer') + ' pages' },
    { key: 'food', get: d => (d.food && d.food.rating) || 0, phrase: (m, up) => 'rate your nutrition ' + m + '% ' + (up ? 'higher' : 'lower') },
    { key: 'net', get: d => (d.networking && d.networking.count) || 0, phrase: (m, up) => 'reach out to ' + m + '% ' + (up ? 'more' : 'fewer') + ' people' }
  ];
  // Prefer a positive synergy (training lifts something) — that's the motivating
  // hook. Only fall back to the strongest negative link if no positive one exists.
  let best = null, bestUp = null;
  for (const mt of metrics) {
    const on = avg(gymDays, mt.get), off = avg(restDays, mt.get);
    const base = (on + off) / 2;
    if (base <= 0) continue;
    const pct = Math.round((on - off) / base * 100);
    if (Math.abs(pct) < 18) continue; // not a meaningful gap
    if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { mt, pct };
    if (pct > 0 && (!bestUp || pct > bestUp.pct)) bestUp = { mt, pct };
  }
  best = bestUp || best;
  if (!best) return null;
  const up = best.pct > 0;
  const mag = Math.min(200, Math.abs(best.pct));
  return {
    kind: best.mt.key,
    pct: best.pct,
    headline: 'On days you train, you ' + best.mt.phrase(mag, up) + '.',
    sub: up ? 'Your training lifts the rest of your life with it.' : 'They pull on each other — worth noticing.'
  };
}
function renderConnectionCard() {
  const c = weekConnection(state.data.days || []);
  if (!c) {
    if ((state.data.days || []).length < 3) return '';
    return '<div class="card conn-card conn-building">' +
      '<div class="conn-tag">Life Connection</div>' +
      '<div class="conn-headline">Your first life connection is forming.</div>' +
      '<div class="conn-sub">Keep logging — in a week or two, Onward shows how your pillars pull on each other. No single-purpose app can do that.</div>' +
      '</div>';
  }
  const hl = escapeHtml(c.headline).replace(/(\d+%)/, '<span class="conn-pct">$1</span>');
  return '<div class="card conn-card">' +
    '<div class="conn-tag">Life Connection</div>' +
    '<div class="conn-headline">' + hl + '</div>' +
    '<div class="conn-sub">' + escapeHtml(c.sub) + '</div>' +
    '<button class="btn-link conn-share" onclick="shareConnection()">Share this</button>' +
    '</div>';
}
async function shareConnection() {
  const c = weekConnection(state.data.days || []);
  if (!c) return;
  const text = 'Onward spotted this in my life — ' + c.headline + ' One app that connects your whole life.';
  try { if (navigator.share) { await navigator.share({ title: 'Onward', text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); showToast('Copied — paste it anywhere.', 'success'); } catch { showToast('Share not available here.', 'error'); }
}
// ── The Climb Ahead — a momentum forecast of your future self (no AI needed) ──
// Takes your recent pace and projects it forward, so the app points UP the
// mountain, not just back down it. Pure + dated for testability.
function projectFuture(days, horizonDays, today) {
  horizonDays = horizonDays || 90;
  const t = today || todayStr();
  const list = (days || []).filter(d => d && d.date);
  if (list.length < 5) return null;
  const cutoffMs = Date.parse(t + 'T00:00:00') - 55 * 86400000;
  const win = list.filter(d => Date.parse(d.date + 'T00:00:00') >= cutoffMs);
  if (win.length < 5) return null;
  const earliest = win.reduce((m, d) => d.date < m ? d.date : m, t);
  const coverDays = Math.max(7, (Date.parse(t + 'T00:00:00') - Date.parse(earliest + 'T00:00:00')) / 86400000 + 1);
  const weeks = coverDays / 7;
  const scale = (horizonDays / 7) / weeks;
  const sum = fn => win.reduce((s, d) => s + (fn(d) || 0), 0);
  const pages = Math.round(sum(d => d.reading && d.reading.pages) * scale);
  let winXp = 0;
  win.forEach(d => {
    if (d.gym && d.gym.done) winXp += 10;
    if (d.food && d.food.rating > 0) winXp += 5;
    winXp += ((d.networking && d.networking.count) || 0) * 3;
    if (d.reading && d.reading.pages > 0) winXp += 8;
  });
  return {
    days: horizonDays,
    pages,
    books: Math.round(pages / 300 * 10) / 10,
    workouts: Math.round(win.filter(d => d.gym && d.gym.done).length * scale),
    contacts: Math.round(sum(d => d.networking && d.networking.count) * scale),
    xpPerWeek: Math.round(winXp / weeks)
  };
}
function renderFutureCard() {
  const proj = projectFuture(state.data.days, 90);
  if (!proj) return '';
  const lines = [];
  if (isPillarOn('reading') && proj.pages > 0) lines.push('<li><b>' + proj.pages.toLocaleString() + '</b> more pages read — about <b>' + proj.books + '</b> book' + (proj.books === 1 ? '' : 's') + '</li>');
  if (isPillarOn('gym') && proj.workouts > 0) lines.push('<li><b>' + proj.workouts + '</b> workouts in the bank</li>');
  if (isPillarOn('networking') && proj.contacts > 0) lines.push('<li><b>' + proj.contacts + '</b> new people met</li>');
  const curXp = computeXP();
  const lvl = getLevel(curXp);
  let levelLine = '';
  if (lvl.nextMin && lvl.nextLabel && proj.xpPerWeek > 0) {
    const weeksToNext = Math.max(1, Math.ceil((lvl.nextMin - curXp) / proj.xpPerWeek));
    levelLine = '<div class="fut-level">You reach <b>' + escapeHtml(lvl.nextLabel) + '</b> in about <b>' + weeksToNext + ' week' + (weeksToNext === 1 ? '' : 's') + '</b> at this pace.</div>';
  }
  if (!lines.length && !levelLine) return '';
  const snapshotBits = [];
  if (proj.workouts > 0) snapshotBits.push(proj.workouts + ' training sessions');
  if (proj.pages > 0) snapshotBits.push(proj.pages.toLocaleString() + ' pages');
  if (proj.contacts > 0) snapshotBits.push(proj.contacts + ' new conversations');
  const snapshot = snapshotBits.length
    ? 'Ninety days from now, future you is carrying ' + snapshotBits.slice(0, 3).join(', ') + ' from the choices you are repeating now.'
    : 'Ninety days from now, future you is mostly shaped by what you repeat this week.';
  return '<div class="card fut-card">' +
    '<div class="fut-tag">Future Self Simulator</div>' +
    '<div class="fut-headline">Keep this pace for ' + proj.days + ' days:</div>' +
    '<div class="fut-snapshot">' + escapeHtml(snapshot) + '</div>' +
    (lines.length ? '<ul class="fut-list">' + lines.join('') + '</ul>' : '') +
    levelLine +
    '<div class="fut-foot">Consistency compounds — this is where today\'s pace is taking you.</div>' +
    '</div>';
}
// ── The Life Web — the brand promise made visual: how every pillar pulls on
// every other. Pairwise Pearson correlation across your days → a constellation. ──
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  if (dx <= 0 || dy <= 0) return 0;
  return num / Math.sqrt(dx * dy);
}
function lifeWeb(days, pillarIds) {
  const list = (days || []).filter(d => d && d.date);
  if (list.length < 6) return null;
  const metricFns = {
    gym: d => (d.gym && d.gym.done) ? 1 : 0,
    food: d => (d.food && d.food.rating) || 0,
    reading: d => (d.reading && d.reading.pages) || 0,
    networking: d => (d.networking && d.networking.count) || 0
  };
  const ids = (pillarIds && pillarIds.length ? pillarIds : Object.keys(metricFns)).filter(id => metricFns[id]);
  const series = {};
  ids.forEach(id => { const arr = list.map(metricFns[id]); if (Math.max.apply(null, arr) > Math.min.apply(null, arr)) series[id] = arr; });
  const nodes = Object.keys(series);
  if (nodes.length < 2) return null;
  const edges = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const r = pearson(series[nodes[i]], series[nodes[j]]);
    if (Math.abs(r) >= 0.15) edges.push({ a: nodes[i], b: nodes[j], r: Math.round(r * 100) / 100, strength: Math.abs(r) });
  }
  edges.sort((x, y) => y.strength - x.strength);
  return { nodes, edges, strongest: edges[0] || null };
}
function renderLifeWeb() {
  const ids = PILLAR_IDS.filter(id => isPillarOn(id) && ['gym', 'food', 'reading', 'networking'].includes(id));
  const web = lifeWeb(state.data.days, ids);
  if (!web || !web.edges.length) return '';
  const colorVar = { gym: 'var(--gym-color)', food: 'var(--food-color)', reading: 'var(--read-color)', networking: 'var(--network-color)' };
  const N = web.nodes.length, cx = 160, cy = 140, R = 95;
  const pos = {};
  web.nodes.forEach((id, i) => { const ang = (-90 + i * 360 / N) * Math.PI / 180; pos[id] = { x: Math.round(cx + R * Math.cos(ang)), y: Math.round(cy + R * Math.sin(ang)) }; });
  const edgesSvg = web.edges.map(e => {
    const A = pos[e.a], B = pos[e.b];
    const w = (1.2 + e.strength * 6).toFixed(1), op = (0.18 + e.strength * 0.6).toFixed(2);
    return '<line x1="' + A.x + '" y1="' + A.y + '" x2="' + B.x + '" y2="' + B.y + '" stroke="' + (e.r >= 0 ? '#16a34a' : '#ef4444') + '" stroke-width="' + w + '" opacity="' + op + '" stroke-linecap="round"/>';
  }).join('');
  const nodesSvg = web.nodes.map(id => {
    const p = pos[id], lbl = escapeHtml(pillar(id).label);
    const ly = p.y < cy ? p.y - 17 : p.y + 28;
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="10" style="fill:' + (colorVar[id] || 'var(--accent)') + '"/>' +
      '<text x="' + p.x + '" y="' + ly + '" text-anchor="middle" font-size="12.5" font-weight="700" style="fill:var(--text)">' + lbl + '</text>';
  }).join('');
  const s = web.strongest;
  const strongLine = s ? '<div class="lw-strong"><b>Strongest link:</b> ' + escapeHtml(pillar(s.a).label) + ' ↔ ' + escapeHtml(pillar(s.b).label) + ' — ' + (s.r >= 0 ? 'they rise together' : 'one trades off the other') + '</div>' : '';
  return '<div class="card lw-card">' +
    '<div class="card-title">Your life web</div>' +
    '<div class="card-sub">How your pillars pull on each other — thicker lines mean a stronger link.</div>' +
    '<svg class="lw-svg" viewBox="0 0 320 280" width="100%" role="img" aria-label="A web showing how your tracked areas connect">' + edgesSvg + nodesSvg + '</svg>' +
    strongLine +
    '<div class="lw-legend"><span class="lw-key"><span class="lw-dot lw-pos"></span>rise together</span><span class="lw-key"><span class="lw-dot lw-neg"></span>trade off</span></div>' +
    '</div>';
}
// The picture's 7-day dots — this week at a glance (filled = logged, ring = today).
function renderWeekStrip() {
  if (!state.data || !state.data.days) return '';
  const start = getWeekStart(todayStr());
  const today = todayStr();
  const logged = new Set((state.data.days || []).map(d => d.date));
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const base = new Date(start + 'T00:00:00');
  let dots = '', count = 0;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base); dt.setDate(base.getDate() + i);
    const ds = dt.toISOString().split('T')[0];
    const done = logged.has(ds);
    if (done && ds <= today) count++;
    const cls = 'wk-dot' + (done ? ' wk-done' : '') + (ds === today ? ' wk-today' : '') + (ds > today ? ' wk-future' : '');
    dots += '<div class="wk-day"><span class="' + cls + '"></span><span class="wk-lbl">' + labels[i] + '</span></div>';
  }
  return '<div class="card wk-card">' +
    '<div class="wk-head"><span class="wk-title">This week</span><span class="wk-count">' + count + ' / 7 logged</span></div>' +
    '<div class="wk-strip">' + dots + '</div></div>';
}
// The picture's compact pillar row — your focus areas, one tap to log.
function renderPillarNav() {
  const ids = PILLAR_IDS.filter(id => isPillarOn(id));
  if (!ids.length) return '';
  const pills = ids.map(id => '<button type="button" class="pnav-pill" onclick="navigate(\'log\')">' + escapeHtml(pillar(id).label) + '</button>').join('');
  return '<div class="pnav">' + pills + '<button type="button" class="pnav-pill pnav-more" onclick="openMoreSheet()">More</button></div>';
}
// ── Your Year as a Range — every week becomes a peak; your history as a
// mountain range. Pure + dated for testability. ──
function yearRange(days, weeksBack, today) {
  weeksBack = weeksBack || 52;
  const t = today || todayStr();
  const list = (days || []).filter(d => d && d.date);
  if (!list.length) return null;
  const dayVal = d => (d.gym && d.gym.done ? 1 : 0) + (d.reading && d.reading.pages > 0 ? 1 : 0) + (d.food && d.food.rating > 0 ? 1 : 0) + ((d.networking && d.networking.count) ? 1 : 0);
  const buckets = {};
  list.forEach(d => { const ws = getWeekStart(d.date); buckets[ws] = (buckets[ws] || 0) + dayVal(d); });
  const cursor = new Date(getWeekStart(t) + 'T00:00:00');
  const weeks = [];
  for (let i = 0; i < weeksBack; i++) {
    const ws = cursor.toISOString().split('T')[0];
    weeks.unshift({ weekStart: ws, value: buckets[ws] || 0 });
    cursor.setDate(cursor.getDate() - 7);
  }
  const firstNonZero = weeks.findIndex(w => w.value > 0);
  const trimmed = firstNonZero >= 0 ? weeks.slice(firstNonZero) : [];
  if (trimmed.length < 3) return null;
  const max = Math.max(1, ...trimmed.map(w => w.value));
  let best = trimmed[0];
  trimmed.forEach(w => { if (w.value > best.value) best = w; });
  return { weeks: trimmed, max, activeWeeks: trimmed.filter(w => w.value > 0).length, best, totalWeeks: trimmed.length };
}
// Build the layered ridge paths for a given canvas size — shared by the live
// card and the shareable image so they always match.
function yearRangeRidge(weeks, max, W, H) {
  const base = H - 4, top = 16, n = weeks.length;
  const xAt = i => n === 1 ? W / 2 : Math.round(6 + i * (W - 12) / (n - 1));
  const yAt = v => Math.round(base - (v / max) * (base - top));
  const half = n > 1 ? (xAt(1) - xAt(0)) / 2 : (W - 12) / 2;
  const cap = (x, y) => '<polygon points="' + x + ',' + y + ' ' + (x + 5) + ',' + (y + 9) + ' ' + (x - 5) + ',' + (y + 9) + '" fill="#ffffff" opacity="0.92"/>';
  const peakY = weeks.map(w => yAt(w.value));
  const backY = weeks.map(w => Math.round(base - 0.7 * (base - yAt(w.value))) - 6);
  let near = 'M ' + Math.max(0, Math.round(xAt(0) - half)) + ' ' + base + ' L ' + xAt(0) + ' ' + peakY[0];
  let back = 'M 0 ' + base + ' L ' + xAt(0) + ' ' + backY[0];
  let caps = weeks[0].value >= max * 0.75 ? cap(xAt(0), peakY[0]) : '';
  for (let i = 1; i < n; i++) {
    const vx = Math.round((xAt(i - 1) + xAt(i)) / 2);
    const vyN = Math.round(base - 0.42 * (((base - peakY[i - 1]) + (base - peakY[i])) / 2));
    const vyB = Math.round(base - 0.5 * (((base - backY[i - 1]) + (base - backY[i])) / 2));
    near += ' L ' + vx + ' ' + vyN + ' L ' + xAt(i) + ' ' + peakY[i];
    back += ' L ' + vx + ' ' + vyB + ' L ' + xAt(i) + ' ' + backY[i];
    if (weeks[i].value >= max * 0.75) caps += cap(xAt(i), peakY[i]);
  }
  near += ' L ' + Math.min(W, Math.round(xAt(n - 1) + half)) + ' ' + base + ' Z';
  back += ' L ' + W + ' ' + base + ' Z';
  return { near, back, caps };
}
function renderYearRange() {
  const data = yearRange(state.data.days, 52);
  if (!data) return '';
  const r = yearRangeRidge(data.weeks, data.max, 400, 150);
  const svg = '<svg class="yr-svg" viewBox="0 0 400 150" role="img" aria-label="Your year as a mountain range">' +
    '<defs><linearGradient id="yrFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9FE1CB"/><stop offset="1" stop-color="#9FE1CB" stop-opacity="0.35"/></linearGradient>' +
    '<linearGradient id="yrNear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D9E75"/><stop offset="1" stop-color="#0F6E56"/></linearGradient></defs>' +
    '<path d="' + r.back + '" fill="url(#yrFar)"/><path d="' + r.near + '" fill="url(#yrNear)"/>' + r.caps + '</svg>';
  return '<div class="card yr-card">' +
    '<div class="card-title">Your year as a range</div>' +
    '<div class="card-sub">Every week you log becomes a peak. This is the range you\'ve built so far.</div>' +
    svg +
    '<div class="yr-stats"><span><b>' + data.activeWeeks + '</b> active week' + (data.activeWeeks === 1 ? '' : 's') + '</span><span>Tallest peak: <b>week of ' + escapeHtml(fmtDateShort(data.best.weekStart)) + '</b></span></div>' +
    '<button class="btn-link yr-share" onclick="shareYearRange()">Share my range</button>' +
    '</div>';
}
function yearRangeShareSvg(size, data) {
  const r = yearRangeRidge(data.weeks, data.max, 400, 200);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 1080 1080">' +
    '<defs>' +
    '<linearGradient id="yShareBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe6ff"/><stop offset="1" stop-color="#eef7ee"/></linearGradient>' +
    '<linearGradient id="yShareNear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D9E75"/><stop offset="1" stop-color="#0F6E56"/></linearGradient>' +
    '<linearGradient id="yShareFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9FE1CB"/><stop offset="1" stop-color="#9FE1CB" stop-opacity="0.4"/></linearGradient>' +
    '</defs>' +
    '<rect width="1080" height="1080" fill="url(#yShareBg)"/>' +
    '<text x="540" y="170" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="800" letter-spacing="5" fill="#0F6E56">MY YEAR AS A RANGE</text>' +
    '<text x="540" y="362" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="200" font-weight="900" fill="#1D9E75">' + data.activeWeeks + '</text>' +
    '<text x="540" y="432" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="600" fill="#334155">weeks climbed — every one a peak</text>' +
    '<svg x="0" y="520" width="1080" height="540" viewBox="0 0 400 200" preserveAspectRatio="none">' +
    '<path d="' + r.back + '" fill="url(#yShareFar)"/><path d="' + r.near + '" fill="url(#yShareNear)"/>' + r.caps + '</svg>' +
    '<text x="540" y="1024" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="36" font-weight="700" fill="#ffffff">Tallest peak: week of ' + escapeHtml(fmtDateShort(data.best.weekStart)) + '  ·  Onward</text>' +
    '</svg>';
}
function buildYearShareBlob(size, data) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { const cv = document.createElement('canvas'); cv.width = cv.height = size; cv.getContext('2d').drawImage(img, 0, 0, size, size); cv.toBlob(b => resolve(b), 'image/png'); };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(yearRangeShareSvg(size, data));
  });
}
async function shareYearRange() {
  const data = yearRange(state.data.days, 52);
  if (!data) return;
  try {
    showToast('Building your range…', 'success');
    const blob = await buildYearShareBlob(1080, data);
    if (blob) {
      const file = new File([blob], 'my-year.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My year on Onward', text: 'Every week a peak.' }); return; }
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'my-year.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); showToast('Saved — post your range!', 'success'); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const text = 'My year on Onward — ' + data.activeWeeks + ' weeks logged, each one a peak in my range. ↗';
  try { if (navigator.share) { await navigator.share({ title: 'Onward', text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); showToast('Copied — paste it anywhere.', 'success'); } catch { showToast('Share not available here.', 'error'); }
}
// A living mountain sky that greets you — time-of-day gradient, drifting clouds,
// a glowing sun (or twinkling stars at night), parallax peaks. Pure atmosphere.
function renderMountainHero() {
  const name = (state.data.profile && (state.data.profile.firstName || (state.data.profile.name || '').split(' ')[0])) || '';
  const h = new Date().getHours();
  let greet, sky1, sky2, night = false, dusk = false;
  if (h >= 5 && h < 8)        { greet = 'Good morning';   sky1 = '#fbd9a5'; sky2 = '#acd0f0'; }
  else if (h >= 8 && h < 12)  { greet = 'Good morning';   sky1 = '#bfe6ff'; sky2 = '#eaf6ff'; }
  else if (h >= 12 && h < 17) { greet = 'Good afternoon'; sky1 = '#a9dbff'; sky2 = '#e3f2ff'; }
  else if (h >= 17 && h < 20) { greet = 'Good evening';   sky1 = '#ff9e64'; sky2 = '#6f6aa6'; dusk = true; }
  else                        { greet = 'Good evening';   sky1 = '#141d3f'; sky2 = '#33335f'; night = true; }
  const sub = climbCaption(climbMomentum());
  const cloudEll = (s) => '<ellipse cx="0" cy="0" rx="' + (24 * s) + '" ry="' + (12 * s) + '"/><ellipse cx="' + (20 * s) + '" cy="' + (-5 * s) + '" rx="' + (17 * s) + '" ry="' + (11 * s) + '"/><ellipse cx="' + (-18 * s) + '" cy="' + (2 * s) + '" rx="' + (15 * s) + '" ry="' + (9 * s) + '"/>';
  const cloud = (y, s, dur, op) => '<g fill="#ffffff" opacity="' + op + '" transform="translate(0 ' + y + ')">' +
    '<g>' + cloudEll(s) + '<animateTransform attributeName="transform" type="translate" from="-120 0" to="520 0" dur="' + dur + 's" repeatCount="indefinite"/></g></g>';
  const celestial = night
    ? '<circle class="mtn-celestial" cx="330" cy="40" r="15" fill="#eef2ff"/>'
    : '<circle class="mtn-celestial" cx="' + (dusk ? 300 : 332) + '" cy="' + (dusk ? 62 : 42) + '" r="18" fill="' + (dusk ? '#ffcf7a' : '#ffd86b') + '"/>';
  const stars = night
    ? '<g class="mtn-stars" fill="#ffffff">' + [[40, 30], [85, 52], [135, 24], [185, 44], [235, 30], [270, 56], [300, 22], [365, 38]].map((p, i) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.6" style="animation-delay:' + (i * 0.37).toFixed(2) + 's"/>').join('') + '</g>'
    : '';
  // Time-of-day mountain palettes: foreground (fg), mid-distance back peak (bk),
  // and the two hazy ridges that fade into the distance.
  const fg = night ? { lit: '#2c3b5f', shadow: '#1b2742', snowLit: '#c9d4ee', snowShadow: '#8893bb', edge: '#5667a4' }
    : dusk ? { lit: '#6b6a8f', shadow: '#474564', snowLit: '#ffe6cf', snowShadow: '#c8a7bd', edge: '#ffd6ad' }
      : { lit: '#46946f', shadow: '#2c6450', snowLit: '#ffffff', snowShadow: '#d7e7f0', edge: '#bfe7d1' };
  const bk = night ? { lit: '#34436d', shadow: '#283457', snowLit: '#b9c4e0', snowShadow: '#7e89b3' }
    : dusk ? { lit: '#8c7a9f', shadow: '#6a5b81', snowLit: '#ffeede', snowShadow: '#caa9c2' }
      : { lit: '#74a9a0', shadow: '#5b8c84', snowLit: '#eaf3f3', snowShadow: '#c4d9d6' };
  const haze = night ? { far: '#2f3e68', mid: '#27325a', fo: 0.6, mo: 0.72 }
    : dusk ? { far: '#b58fae', mid: '#8f6f96', fo: 0.5, mo: 0.58 }
      : { far: '#a9cfca', mid: '#8fbcb3', fo: 0.55, mo: 0.62 };
  const mountains =
    '<polygon points="0,150 0,96 44,86 92,100 140,82 196,96 244,80 300,96 352,84 400,92 400,150" fill="' + haze.far + '" opacity="' + haze.fo + '"/>' +
    '<polygon points="0,150 0,114 54,102 104,116 156,100 210,114 262,102 318,116 372,104 400,112 400,150" fill="' + haze.mid + '" opacity="' + haze.mo + '"/>' +
    peak3d(298, 70, 192, 404, 150, bk) +
    '<rect x="0" y="104" width="400" height="46" fill="url(#mtnMist)"/>' +
    peak3d(120, 44, -4, 244, 150, fg) +
    peak3d(258, 86, 176, 404, 150, fg);
  const svg =
    '<svg class="mtn-hero-svg" viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<defs><linearGradient id="mtnSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sky1 + '"/><stop offset="1" stop-color="' + sky2 + '"/></linearGradient>' +
    '<linearGradient id="mtnMist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + (night ? '#141d3f' : '#ffffff') + '" stop-opacity="0"/><stop offset="1" stop-color="' + (night ? '#141d3f' : '#ffffff') + '" stop-opacity="' + (night ? 0.28 : 0.22) + '"/></linearGradient></defs>' +
    '<rect width="400" height="150" fill="url(#mtnSky)"/>' + stars + celestial +
    cloud(40, 1, 44, night ? 0.22 : 0.85) + cloud(70, 0.7, 64, night ? 0.15 : 0.6) +
    mountains +
    '</svg>';
  return '<div class="mtn-hero">' + svg +
    '<div class="mtn-hero-text"><div class="mtn-greet">' + greet + (name ? ', ' + escapeHtml(name) : '') + '</div>' +
    '<div class="mtn-sub">' + escapeHtml(sub) + '</div></div></div>';
}
// How much of this week's goals you've reached — average % across active weekly
// goals (gym days, networking, reading pages, savings). Pure + testable.
function weeklyGoalsReached(stats, profile, moneyNet, on) {
  stats = stats || {}; profile = profile || {}; on = on || {};
  const pctOf = (c, g) => g > 0 ? Math.min(100, Math.round((c || 0) / g * 100)) : 0;
  const pcts = [];
  if (on.gym) pcts.push(pctOf(stats.gymDays, profile.gymDaysPerWeek || 5));
  if (on.networking) pcts.push(pctOf(stats.networkCount, profile.weeklyNetworkGoal || 3));
  if (on.reading && profile.weeklyReadGoal > 0) pcts.push(pctOf(stats.readPages, profile.weeklyReadGoal));
  if (on.money && (profile.savingsGoal || 0) > 0) pcts.push(pctOf(Math.max(0, moneyNet || 0), profile.savingsGoal));
  return pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
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

  // How much of this week's goals you've reached — the dashboard's hero number
  const goalsReachedPct = weeklyGoalsReached(stats, profile, getMoneyPeriod().net, { gym: isPillarOn('gym'), networking: isPillarOn('networking'), reading: isPillarOn('reading'), money: isPillarOn('money') });
  const scoreColor = goalsReachedPct >= 80 ? 'var(--success)' : goalsReachedPct >= 60 ? 'var(--accent)' : goalsReachedPct >= 40 ? 'var(--warning)' : 'var(--danger)';
  const scoreLabel = goalsReachedPct >= 80 ? 'Crushing your goals ' : goalsReachedPct >= 60 ? 'On track ' : goalsReachedPct >= 40 ? 'Getting there ' : 'Time to push ';

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
      goalRows.push('<div class="sg-item"><div class="sg-item-top"><span>Save this ' + mp.label + '</span>' +
        '<strong>' + formatCurrency(Math.max(0, net)) + ' / ' + formatCurrency(sGoal) + '</strong></div>' +
        goalBar(Math.max(0, net), sGoal) +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + detail +
        (net >= sGoal ? ' · goal hit!' : ' · ' + formatCurrency(sGoal - net) + ' to go') + '</div></div>');
    } else if (mp.income > 0 || mp.spent > 0) {
      const net = mp.net;
      goalRows.push('<div class="sg-item"><div class="sg-item-top"><span>' + pc.icon + ' Net this ' + mp.label + '</span>' +
        '<strong style="color:' + (net >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + formatCurrency(net) +
        (mp.income > 0 ? ' · ' + mp.rate + '% saved' : '') + '</strong></div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + detail + '</div>' +
        '<button class="btn-link-inline" onclick="navigate(\'settings\')" style="margin-top:4px">Set a savings goal</button></div>');
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
    '<span class="score-num">' + goalsReachedPct + '</span><span class="score-pct">%</span>' +
    '</div>' +
    '</div>' +
    '<div class="score-right">' +
    '<div class="score-label">' + scoreLabel + '</div>' +
    '<div class="score-sub">of your weekly goals reached, across ' + onCount + ' active pillar' + (onCount === 1 ? '' : 's') + '</div>' +
    '<button class="btn btn-outline" style="margin-top:12px;padding:7px 14px;font-size:13px" onclick="navigate(\'log\')">Log Today</button>' +
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
    chartsHtml = '<div class="empty-state"><div class="empty-icon empty-mtn">' + obMountainSvg() + '</div>' +
      '<h3>Your mountain is waiting</h3>' +
      '<p>Log your first day to take the first step up — even 30 seconds counts. Every day you log moves your climber higher.</p>' +
      '<div class="empty-actions">' +
      '<button class="btn btn-primary" onclick="navigate(\'log\')">Log my first day</button>' +
      '</div></div>';
  }

  const achievementsHtml = hasDays ? renderAchievementsSection() : '';

  const focusHtml = renderFocusCard(stats, lastStats);

  // Group the cards into scannable sections — a label only shows if its group has content
  const sec = (label, html) => html && html.trim() ? '<div class="dash-section">' + label + '</div>' + html : '';
  // Light, goal-focused home — all the analytics live on the Statistics page.
  const gHero  = renderNeverMissTwice() + renderWhyCard() + renderNextStep() + renderWeekStrip() + renderPillarNav();
  const gGoals = renderGoalCard() + scoreHtml;
  const gLight = renderNextWorkoutCard() + renderChecklistCard() + renderTrialBanner() + renderStreakCard() + renderReminderBanner() + renderQuoteCard();
  document.getElementById('main').innerHTML =
    renderMountainHero() +
    '<div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><h2 class="page-title">Dashboard</h2>' +
    '<p class="page-sub">Week of ' + formatWeekRange(getWeekStart(todayStr())) + '</p></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    (hasDays ? '<button class="btn btn-outline btn-sm" onclick="navigate(\'stats\')">All stats</button>' : '') +
    (hasDays ? '<button class="btn btn-outline btn-sm" onclick="openWeekRecap()">Week recap</button>' : '') +
    (hasDays ? '<button class="btn btn-outline btn-sm" onclick="shareMyWeek()">Share</button>' : '') +
    '</div></div>' +
    gHero +
    sec('Your goals', gGoals) +
    gLight +
    (hasDays ? '<button class="btn btn-primary dash-stats-cta" onclick="navigate(\'stats\')">See all your stats →</button>' : chartsHtml);

  setTimeout(animateCounters, 120);
  // Summit celebration once when momentum hits 100% (resets if it drops)
  const _mom = climbMomentum();
  if (_mom >= 100) { if (!state._summitShown) { state._summitShown = true; setTimeout(showSummitCelebration, 700); } } else { state._summitShown = false; }
  setTimeout(maybeShowShareMilestone, 1100);   // nudge a share at streak / perfect-week milestones
}

// ─────────────────────────────────────────────────────────────
// WHOLE-LIFE BALANCE  (inspired by the four dimensions of renewal —
// body, mind, heart, spirit — and a personal "why" / mission)
// ─────────────────────────────────────────────────────────────
// Score each of the four dimensions 0–100 from the week, and a "balance" that
// rewards the weakest side (a saw dull in one area drags the whole). Pure/testable.
function sharpenScore(inp) {
  inp = inp || {};
  const pct = (c, g) => g > 0 ? Math.min(100, Math.round((+c || 0) / g * 100)) : ((+c || 0) > 0 ? 100 : 0);
  const body = pct(inp.gymDays, inp.gymGoal || 5);
  const mind = inp.readGoal > 0 ? pct(inp.readPages, inp.readGoal) : ((+inp.readPages || 0) > 0 ? 100 : 0);
  const heart = pct(inp.networkCount, inp.networkGoal || 3);
  const reflect = Math.min(100, Math.round((+inp.reflectDays || 0) / 7 * 100));
  const spirit = Math.min(100, reflect + (inp.hasMission ? 25 : 0));
  const dims = { body, mind, heart, spirit }, keys = ['body', 'mind', 'heart', 'spirit'];
  const vals = keys.map(k => dims[k]);
  const avg = vals.reduce((a, b) => a + b, 0) / 4, min = Math.min.apply(null, vals);
  const balance = Math.round(avg * 0.6 + min * 0.4);     // balance, not just total
  let weakest = keys[0]; keys.forEach(k => { if (dims[k] < dims[weakest]) weakest = k; });
  return { body, mind, heart, spirit, balance, weakest };
}
function sharpenInputs() {
  const s = getWeekStats(), p = state.data.profile || {};
  const wkStart = getWeekStart(todayStr());
  const reflectDays = (state.data.days || []).filter(d => d.date >= wkStart && d.notes && String(d.notes).trim()).length;
  return {
    gymDays: s.gymDays, gymGoal: p.gymDaysPerWeek || 5,
    readPages: s.readPages, readGoal: +p.weeklyReadGoal || 0,
    networkCount: s.networkCount, networkGoal: p.weeklyNetworkGoal || 3,
    reflectDays, hasMission: !!(p.mission && String(p.mission).trim())
  };
}
function renderSharpenCard() {
  const sc = sharpenScore(sharpenInputs());
  const dims = [
    { k: 'body', icon: '💪', label: 'Body', sub: 'Move & fuel', color: '#10B981' },
    { k: 'mind', icon: '🧠', label: 'Mind', sub: 'Read & learn', color: '#22D3EE' },
    { k: 'heart', icon: '❤️', label: 'Heart', sub: 'Connect', color: '#F472B6' },
    { k: 'spirit', icon: '✨', label: 'Spirit', sub: 'Reflect', color: '#A78BFA' }
  ];
  const tips = { body: 'train or log a meal', mind: 'read a few pages', heart: 'reach out to someone', spirit: 'jot a note on what mattered today' };
  const allHigh = dims.every(d => sc[d.k] >= 70);
  const weak = dims.find(d => d.k === sc.weakest);
  const insight = allHigh ? 'Beautifully balanced — all four parts of you are sharp this week.'
    : 'Your <b>' + weak.label.toLowerCase() + '</b> needs love — ' + tips[sc.weakest] + '.';
  const rows = dims.map(d =>
    '<div class="ss-row"><div class="ss-name"><span class="ss-ic">' + d.icon + '</span><span class="ss-lbl"><b>' + d.label + '</b><em>' + d.sub + '</em></span></div>' +
    '<div class="ss-bar"><div class="ss-fill" style="width:' + sc[d.k] + '%;background:' + d.color + '"></div></div>' +
    '<div class="ss-pct">' + sc[d.k] + '%</div></div>').join('');
  return '<div class="card sharpen-card">' +
    '<div class="ss-head"><div><h3 class="card-title" style="margin-bottom:2px">Stay sharp</h3>' +
    '<span class="ss-sub">Keep all four parts of you in balance</span></div>' +
    '<div class="ss-balance"><div class="ss-bal-n">' + sc.balance + '%</div><div class="ss-bal-l">balance</div></div></div>' +
    '<div class="ss-rows">' + rows + '</div>' +
    '<div class="ss-insight">' + insight + '</div></div>';
}
// Personal "why" / mission — the reason behind the climb
function getMission() { return (state.data.profile && state.data.profile.mission) ? String(state.data.profile.mission) : ''; }
function renderWhyEditorCard() {
  const m = getMission();
  if (!m) {
    return '<div class="card why-card why-empty">' +
      '<div class="why-eyebrow">✦ YOUR WHY</div>' +
      '<p class="why-prompt">Behind every climb is a reason. In a sentence or two — who are you becoming, and why does it matter?</p>' +
      '<button class="btn btn-primary btn-sm" onclick="showMissionEditor()">Write my why</button></div>';
  }
  return '<div class="card why-card">' +
    '<div class="why-eyebrow">✦ YOUR WHY</div>' +
    '<p class="why-text">' + escapeHtml(m) + '</p>' +
    '<button class="btn-link" onclick="showMissionEditor()">Edit</button></div>';
}
// Compact dashboard anchor — only appears once a why is set
function renderWhyCard() {
  const m = getMission();
  if (!m) return '';
  return '<div class="card why-mini" onclick="navigate(\'stats\')"><span class="why-mini-label">YOUR WHY</span>' +
    '<span class="why-mini-text">' + escapeHtml(m) + '</span></div>';
}
function showMissionEditor() {
  if (document.getElementById('mission-overlay')) return;
  const o = document.createElement('div');
  o.id = 'mission-overlay'; o.className = 'modal-overlay';
  o.innerHTML = '<div class="modal-box mission-box">' +
    '<h3 class="card-title" style="margin-bottom:4px">Your Why</h3>' +
    '<p class="card-sub">The reason behind the climb. Keep it short and true — you\'ll see it every day.</p>' +
    '<textarea id="mission-input" class="mission-ta" maxlength="240" placeholder="e.g. To grow stronger, sharper and more present — so I can show up fully for the people and work I care about."></textarea>' +
    '<div class="mission-actions"><button class="btn-link" onclick="closeMissionEditor()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveMission()">Save my why</button></div></div>';
  o.addEventListener('click', e => { if (e.target === o) closeMissionEditor(); });
  document.body.appendChild(o);
  const ta = document.getElementById('mission-input'); if (ta) { ta.value = getMission(); setTimeout(() => ta.focus(), 60); }
}
async function saveMission() {
  const v = (document.getElementById('mission-input')?.value || '').trim();
  state.data.profile = state.data.profile || {};
  state.data.profile.mission = v;
  await saveData();
  closeMissionEditor();
  showToast(v ? 'Your why is set ✦' : 'Cleared', 'success');
  navigate(state.page || 'dashboard');
}
function closeMissionEditor() { document.getElementById('mission-overlay')?.remove(); }

// ── Identity & votes ("every action is a vote for who you're becoming") and
// "never miss twice" — the two ideas from the small-habits playbook the app
// didn't yet have. Both pure/testable. ──
function identityVotes(days, on, windowDays, today) {
  on = on || {}; windowDays = windowDays || 30;
  const end = today || todayStr();
  const s = new Date(end + 'T00:00:00'); s.setDate(s.getDate() - (windowDays - 1));
  const start = s.toISOString().split('T')[0];
  const inWin = (days || []).filter(d => d.date >= start && d.date <= end);
  const cnt = fn => inWin.filter(fn).length;
  const out = [{ id: 'show', icon: '🧗', label: 'someone who shows up', votes: inWin.length, color: '#7C3AED' }];
  if (on.gym) out.push({ id: 'athlete', icon: '💪', label: 'an athlete', votes: cnt(d => d.gym && d.gym.done), color: '#10B981' });
  if (on.reading) out.push({ id: 'reader', icon: '📚', label: 'a reader', votes: cnt(d => d.reading && d.reading.pages > 0), color: '#22D3EE' });
  if (on.networking) out.push({ id: 'connector', icon: '🤝', label: 'a connector', votes: cnt(d => d.networking && d.networking.count > 0), color: '#F472B6' });
  return out;
}
function renderIdentityCard() {
  const votes = identityVotes(state.data.days, { gym: isPillarOn('gym'), reading: isPillarOn('reading'), networking: isPillarOn('networking') }, 30)
    .filter(v => v.votes > 0);
  if (!votes.length) return '';
  const rows = votes.map(v =>
    '<div class="iv-row"><span class="iv-ic">' + v.icon + '</span><span class="iv-lbl">' + escapeHtml(v.label) + '</span>' +
    '<span class="iv-votes" style="color:' + v.color + '">' + v.votes + ' <em>vote' + (v.votes === 1 ? '' : 's') + '</em></span></div>').join('');
  return '<div class="card identity-card">' +
    '<div class="iv-eyebrow">🗳️ YOU\'RE BECOMING</div>' +
    '<p class="iv-hero">Every action is a vote for the person you\'re becoming.</p>' +
    '<div class="iv-rows">' + rows + '</div>' +
    '<div class="iv-foot">Votes cast in the last 30 days — keep them coming.</div></div>';
}
// "Never miss twice": fired only on a single fresh miss (logged the day before
// yesterday, not yesterday, not yet today) — catch the slip before it's a habit.
function missedYesterday(days, today) {
  const end = today || todayStr();
  const set = new Set((days || []).map(d => d.date));
  const shift = n => { const d = new Date(end + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; };
  return !set.has(end) && !set.has(shift(-1)) && set.has(shift(-2));
}
function renderNeverMissTwice() {
  if (!missedYesterday(state.data.days)) return '';
  return '<div class="card nmt-banner" onclick="navigate(\'log\')">' +
    '<span class="nmt-ic">⚡</span><div class="nmt-body"><b>You missed yesterday — don\'t miss twice.</b>' +
    '<div class="nmt-sub">Missing once is an accident. Log today and you\'re right back on.</div></div>' +
    '<span class="nmt-go">Log →</span></div>';
}

// Which identities today's entry voted for — the bridge from a logged action to
// who you're becoming (used in the end-of-log moment). Pure/testable.
function todaysVotes(day, on) {
  on = on || {}; day = day || {};
  const v = [];
  if (on.gym && day.gym && day.gym.done) v.push({ icon: '💪', who: 'the athlete' });
  if (on.reading && day.reading && day.reading.pages > 0) v.push({ icon: '📚', who: 'the reader' });
  if (on.networking && day.networking && day.networking.count > 0) v.push({ icon: '🤝', who: 'the connector' });
  if (on.food && day.food && day.food.rating >= 4) v.push({ icon: '🥗', who: 'someone who fuels well' });
  return v;
}
// The end-of-day moment where it all comes together: the day is logged (the
// system), it casts votes for who you're becoming (identity), it's a step up the
// climb (progress), and it ties back to your why (meaning).
function showDayComplete(day) {
  const on = { gym: isPillarOn('gym'), reading: isPillarOn('reading'), networking: isPillarOn('networking'), food: isPillarOn('food') };
  const votes = todaysVotes(day, on);
  const streak = loggingStreak();
  const voteLine = (votes.length ? votes : [{ icon: '🧗', who: 'someone who shows up' }])
    .map(v => '<span class="dc-vote">' + v.icon + ' a vote for <b>' + v.who + '</b></span>').join('');
  const firstEver = (state.data.days || []).filter(d => Array.isArray(d._logged) && d._logged.length).length <= 1;
  const title = firstEver ? 'You\'re on the board! 🧗' : 'Day logged' + (streak > 1 ? ' · ' + streak + '-day streak 🔥' : '');
  const close = firstEver ? 'Day 1 of your climb. Come back tomorrow — that\'s where it compounds.'
    : (getMission() ? 'One step closer to your why.' : 'Every vote builds the person you\'re becoming.');
  const cols = ['#10B981', '#22D3EE', '#F472B6', '#A78BFA', '#fbbf24'];
  let conf = '';
  for (let i = 0; i < 26; i++) { const left = Math.random() * 100, delay = Math.random() * 1.4, dur = 2 + Math.random() * 2, w = 6 + Math.random() * 7; conf += '<div class="conf-p" style="left:' + left + '%;width:' + w + 'px;height:' + (w * 1.5) + 'px;background:' + cols[i % cols.length] + ';border-radius:2px;animation-delay:' + delay + 's;animation-duration:' + dur + 's"></div>'; }
  const el = document.createElement('div');
  el.className = 'celebration-overlay';
  el.onclick = () => el.remove();
  el.innerHTML = conf +
    '<div class="celeb-box">' +
    '<div class="dc-check">✓</div>' +
    '<div class="celeb-title">' + title + '</div>' +
    '<div class="dc-votes">' + voteLine + '</div>' +
    '<div class="celeb-sub">' + close + '</div>' +
    '<div class="celeb-tap">tap to continue</div>' +
    '</div>';
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 5200);
}

// ── Statistics — all the numbers, insights, charts and trends in one place,
// so the dashboard can stay light and goal-focused. ──
function renderStatsPage() {
  const { days, weeks, profile } = state.data;
  updateNavBadges();
  const hasDays = days.length > 0, hasWeeks = weeks.length > 0;
  const header = '<div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><h2 class="page-title">Statistics</h2><p class="page-sub">Your numbers, insights, and trends</p></div>' +
    '<button class="btn btn-outline btn-sm" onclick="navigate(\'dashboard\')">← Dashboard</button></div>';
  if (!hasDays) {
    document.getElementById('main').innerHTML = header +
      '<div class="empty-state"><div class="empty-icon empty-mtn">' + obMountainSvg() + '</div><h3>No stats yet</h3>' +
      '<p>Log a few days and your charts, insights, and trends will appear here.</p>' +
      '<div class="empty-actions"><button class="btn btn-primary" onclick="navigate(\'log\')">Log my first day</button></div></div>';
    return;
  }
  const stats = getWeekStats(), lastStats = getLastWeekStats();
  const sortedDays = [...days].sort((a, b) => new Date(b.date) - new Date(a.date));
  const sortedWeeks = [...weeks].sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));
  const cardCtx = { stats, lastStats, profile, avgIncome: getWeeklyAvg(weeks, 4), gymStreak: getGymStreak(), readStreak: getReadingStreak() };
  const pillarsHtml = '<div class="pillar-grid">' + PILLAR_IDS.map(id => pillarCardHtml(id, cardCtx)).join('') + '</div>';
  const anySpend = days.some(d => (d.spent || 0) > 0);
  const showIncomeChart = isPillarOn('money') && (hasWeeks || anySpend);
  const showGymChart = isPillarOn('gym');
  const chartCards =
    (showIncomeChart ? '<div class="card"><h3 class="card-title">Money (last 12 weeks)</h3><div class="chart-wrap"><canvas id="incomeChart"></canvas></div></div>' : '') +
    (showGymChart ? '<div class="card"><h3 class="card-title">' + escapeHtml(pillar('gym').label) + ' Days per Week</h3><div class="chart-wrap"><canvas id="gymChart"></canvas></div></div>' : '');
  const chartsHtml = (chartCards ? '<div class="charts-row">' + chartCards + '</div>' : '');
  const sec = (label, html) => html && html.trim() ? '<div class="dash-section">' + label + '</div>' + html : '';
  // Simplified: just the numbers, the trends and the history — the deeper "wow"
  // cards (life web, why/identity, projections, AI coach, body morph) live on the
  // Dashboard and Coach pages, so the stats page stays scannable.
  document.getElementById('main').innerHTML = header +
    sec('This week', pillarsHtml + renderHydrationStrip(stats) + renderFocusCard(stats, lastStats)) +
    sec('Health & money', renderNutritionWeekCard() + renderWeightTrend() + renderMoneyCircleCard()) +
    sec('Trends & history', chartsHtml + renderAchievementsSection());
  setTimeout(animateCounters, 120);
  setTimeout(() => wireCardTilt('.pillar-card'), 60);
  if (showIncomeChart) initIncomeChart(sortedWeeks);
  if (showGymChart) initGymChart(days);
  if ((state.data.weights || []).length >= 2) initWeightChart();
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
      '<td data-label="Date"><strong>' + fmtDate(d.date) + '</strong></td>' +
      '<td data-label="' + escapeHtml(pillar('gym').label) + '">' + gymCell + '</td>' +
      '<td data-label="' + escapeHtml(pillar('food').label) + '">' + foodCell + '</td>' +
      '<td data-label="' + escapeHtml(pillar('networking').label) + '">' + netCell + '</td>' +
      '<td data-label="' + escapeHtml(pillar('money').label) + '">' + moneyCell + '</td>' +
      '<td class="action-cell">' +
      '<button class="btn-sm" onclick="editDay(\'' + d.id + '\')"></button>' +
      '<button class="btn-sm btn-sm-danger" onclick="deleteDay(\'' + d.id + '\')"></button>' +
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
  return '<div class="prev-note-banner"><strong>' + when + ' you wrote:</strong> ' + escapeHtml(txt) + '</div>';
}

// ─────────────────────────────────────────────────────────────
// LOG TODAY
// ─────────────────────────────────────────────────────────────
// ── Guided log — one light question at a time (phone-first) ──────────────
// The Log tab opens here by default; "Full form" drops to the detailed page.
function renderLogEntry() {
  if (state._editDayId || state._fullLog) {
    renderLogToday(state._editDayId ? state.data.days.find(d => d.id === state._editDayId) : undefined);
    if (!state._editDayId) {
      const main = document.getElementById('main');
      const ph = main.querySelector('.page-header') || main.firstElementChild;
      if (ph) ph.insertAdjacentHTML('beforebegin', '<button type="button" class="btn-link gl-toguided" onclick="backToGuided()">← Quick log, one question at a time</button>');
    }
    return;
  }
  if (guidedStepKeys().length === 0) { renderAllLoggedToday(); return; }   // everything's already in for today
  startGuidedLog();
}
function showFullLog() { state._fullLog = true; state._guided = null; renderLogEntry(); }
function backToGuided() { state._fullLog = false; state._editDayId = null; renderLogEntry(); }
// Which parts of today you've already logged (they drop off the flow until tomorrow)
function loggedKeysToday() {
  const day = (state.data.days || []).find(d => d.date === todayStr());
  return (day && Array.isArray(day._logged)) ? day._logged : [];
}
// Food becomes one step per meal when a meal plan exists, so each meal logs
// itself (and drops off as you eat it through the day). Otherwise: one food step.
function mealStepKeys() {
  if (!isPillarOn('food')) return [];
  if (isFirstEverLog()) return ['food'];   // keep the very first log simple — per-meal kicks in from day 2
  const nut = getNutrition();
  if (nut && nut.meals && nut.meals.plan && nut.meals.plan.length > 1) return nut.meals.plan.map((m, i) => 'meal:' + i);
  return ['food'];
}
// A brand-new user (no history yet) gets a shorter first log — just the core +
// water — so the first win is quick. Weight/notes return once they're rolling.
function isFirstEverLog() { return !(state.data.days || []).some(d => d.date < todayStr()); }
function guidedStepKeys() {
  const done = loggedKeysToday();
  const keys = [];
  if (isPillarOn('gym') && !done.includes('gym')) keys.push('gym');
  mealStepKeys().forEach(k => { if (!done.includes(k)) keys.push(k); });
  ['reading', 'networking', 'money'].forEach(id => { if (isPillarOn(id) && !done.includes(id)) keys.push(id); });
  (isFirstEverLog() ? ['water'] : ['water', 'weight', 'notes']).forEach(k => { if (!done.includes(k)) keys.push(k); });
  return keys;
}
// Shown when everything's already logged today — fresh again tomorrow
function renderAllLoggedToday() {
  const streak = loggingStreak();
  document.getElementById('main').innerHTML =
    '<div class="gl-wrap gl-alldone">' +
    '<div class="gld-check">✓</div>' +
    '<div class="gld-title">All logged for today</div>' +
    '<div class="gld-sub">' + (streak > 1 ? '<b>' + streak + '-day streak</b> 🔥 · ' : '') +
    'Your day is in. Come back tomorrow to keep the chain going.</div>' +
    '<div class="gld-actions">' +
    '<button type="button" class="btn btn-primary" onclick="navigate(\'dashboard\')">Back to dashboard</button>' +
    '<button type="button" class="btn-link" onclick="showFullLog()">Edit today’s entry</button>' +
    '</div></div>';
}
function startGuidedLog() {
  state._fullLog = false; state._editDayId = null;
  const keys = guidedStepKeys();
  if (!keys.length) { renderAllLoggedToday(); return; }   // nothing left to log today
  const date = todayStr();
  const prior = (state.data.days || []).find(d => d.date === date) || {};
  const w = (state.data.weights || []).find(x => x.date === date);
  state._guided = {
    step: 0, keys: keys,
    draft: {
      _gymAnswered: !!prior.id, gymDone: !!(prior.gym && prior.gym.done),
      gymGroup: (prior.gym && prior.gym.muscleGroup) || '',
      food: (prior.food && prior.food.rating) || 0, cals: prior.calories || '', meals: [],
      readPages: (prior.reading && prior.reading.pages) || '',
      net: (prior.networking && prior.networking.count) || '',
      spent: prior.spent || '', moneyActs: (prior.money && prior.money.activities) || '',
      water: prior.water || '', weight: w ? (Math.round(kgToDisplay(w.kg) * 10) / 10 || '') : '',
      notes: prior.notes || ''
    }
  };
  renderGuidedLog();
}
function renderGuidedLog() {
  const g = state._guided; if (!g) return;
  const key = g.keys[g.step], total = g.keys.length, d = g.draft;
  const ab = (state.data.books || []).find(b => b.status === 'reading');
  let q = '', sub = '', body = '', optional = false;
  if (key === 'gym') {
    q = 'Did you train today?';
    body = '<div class="gl-yesno">' +
      '<button type="button" class="gl-big' + (d._gymAnswered && d.gymDone ? ' gl-on' : '') + '" onclick="glSetGym(true)">Yes, I trained</button>' +
      '<button type="button" class="gl-big' + (d._gymAnswered && !d.gymDone ? ' gl-on' : '') + '" onclick="glSetGym(false)">Rest day</button></div>' +
      '<div id="gl-gym-extra" class="gl-extra"' + (d.gymDone ? '' : ' style="display:none"') + '>' +
      '<div class="gl-sub2">What did you train?</div>' +
      '<div class="gl-muscles">' + ['Push', 'Pull', 'Legs', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Full Body', 'Cardio'].map(grp => '<button type="button" class="gl-muscle' + (d.gymGroup === grp ? ' gl-muscle-on' : '') + '" onclick="glSetMuscle(\'' + grp + '\')">' + grp + '</button>').join('') + '</div>' +
      '<button type="button" class="btn-workout gl-workout" onclick="glOpenWorkout()">🏋️ Track sets, reps &amp; rest timer →</button></div>';
  } else if (key.indexOf('meal:') === 0) {
    const idx = parseInt(key.split(':')[1], 10);
    const nut = getNutrition();
    const m = (nut && nut.meals && nut.meals.plan[idx]) || { label: 'Meal ' + (idx + 1), calories: 0, protein: 0 };
    const dm = (d.meals && d.meals[idx]) || {};
    q = m.label + ' — how did it go?';
    sub = m.calories ? 'Aim ~' + m.calories.toLocaleString() + ' cal · ' + m.protein + 'g protein' : '';
    optional = true;
    body = '<div class="gl-meal-opts">' +
      [['ate', 'Ate it ✓'], ['light', 'Light'], ['skip', 'Skipped']].map(o =>
        '<button type="button" class="gl-meal-opt' + (dm.status === o[0] ? ' gl-on' : '') + '" onclick="glSetMeal(' + idx + ',\'' + o[0] + '\')">' + o[1] + '</button>').join('') +
      '</div>' +
      '<input id="gl-meal-cals" class="gl-input gl-num" type="number" inputmode="numeric" placeholder="Calories (optional)" value="' + (dm.cals || '') + '">' +
      (m.calories ? '<div class="gl-hint">Pick one — we\'ll count ~' + m.calories.toLocaleString() + ' cal if you don\'t enter a number.</div>' : '');
  } else if (key === 'food') {
    q = 'How did you eat today?'; sub = 'Rate it, then log your calories'; optional = true;
    const nut = getNutrition();
    body = mealNowHint() +
      '<div class="gl-stars">' + [1, 2, 3, 4, 5].map(n => '<button type="button" class="gl-star' + ((d.food || 0) >= n ? ' gl-star-on' : '') + '" onclick="glSetFood(' + n + ')">' + ((d.food || 0) >= n ? '★' : '☆') + '</button>').join('') + '</div>' +
      '<input id="gl-cals" class="gl-input gl-num" type="number" inputmode="numeric" placeholder="Calories eaten" value="' + (d.cals || '') + '">' +
      (nut ? '<div class="gl-hint">Target ' + nut.calories.toLocaleString() + ' cal · ' + nut.protein.g + 'g protein</div>' : '') +
      '<button type="button" class="gl-link-full" onclick="showFullLog()">Log foods one by one →</button>';
  } else if (key === 'reading') {
    q = 'Pages read today?'; sub = ab ? 'in ' + escapeHtml(ab.title) : ''; optional = true;
    body = '<input id="gl-read" class="gl-input gl-num" type="number" inputmode="numeric" placeholder="0" value="' + (d.readPages || '') + '">';
  } else if (key === 'networking') {
    q = 'New people you connected with?'; optional = true;
    body = '<input id="gl-net" class="gl-input gl-num" type="number" inputmode="numeric" placeholder="0" value="' + (d.net || '') + '">';
  } else if (key === 'money') {
    q = 'Spent today?'; optional = true;
    body = '<input id="gl-spent" class="gl-input gl-num" type="number" inputmode="decimal" placeholder="0" value="' + (d.spent || '') + '">' +
      '<input id="gl-money-acts" class="gl-input" placeholder="On what? (optional)" value="' + escapeAttr(d.moneyActs || '') + '">';
  } else if (key === 'water') {
    q = 'Water today?'; optional = true;
    body = '<input id="gl-water" class="gl-input gl-num" type="number" inputmode="decimal" placeholder="gallons" value="' + (d.water || '') + '">' +
      '<div class="gl-chips">' + [0.25, 0.5, 1].map(x => '<button type="button" class="gl-chip" onclick="glWater(' + x + ')">+' + x + '</button>').join('') + '</div>';
  } else if (key === 'weight') {
    q = "Today's weight?"; sub = 'optional'; optional = true;
    body = '<input id="gl-weight" class="gl-input gl-num" type="number" inputmode="decimal" placeholder="' + (weightUnitPref() === 'lbs' ? 'lbs' : 'kg') + '" value="' + (d.weight || '') + '">';
  } else {
    q = 'Anything about today?'; sub = 'optional'; optional = true;
    body = '<textarea id="gl-notes" class="gl-input gl-area" placeholder="Wins, struggles, ideas — anything">' + escapeHtml(d.notes || '') + '</textarea>';
  }
  const isLast = g.step === total - 1;
  const welcome = (isFirstEverLog() && g.step === 0)
    ? '<div class="gl-welcome">🧗 <b>Your first log.</b> Tap through — about 15 seconds — and you\'re officially on the board.</div>' : '';
  document.getElementById('main').innerHTML =
    '<div class="gl-wrap">' +
    welcome +
    '<div class="gl-head"><span class="gl-step-label">Log today · ' + (g.step + 1) + ' of ' + total + '</span><button type="button" class="gl-full" onclick="showFullLog()">Full form</button></div>' +
    '<div class="gl-progress">' + g.keys.map((k, i) => '<span class="gl-dot' + (i <= g.step ? ' gl-dot-on' : '') + '"></span>').join('') + '</div>' +
    '<div class="gl-step"><div class="gl-q">' + q + '</div>' + (sub ? '<div class="gl-sub">' + sub + '</div>' : '') + '<div class="gl-body">' + body + '</div></div>' +
    '<div class="gl-actions">' +
    (g.step > 0 ? '<button type="button" class="gl-back" onclick="glBack()">← Back</button>' : '<span></span>') +
    (optional ? '<button type="button" class="gl-skip" onclick="glSkip()">Skip</button>' : '<span></span>') +
    '<button type="button" class="btn btn-primary gl-next" onclick="glNext()">' + (isLast ? 'Save my day' : 'Next →') + '</button>' +
    '</div></div>';
  setTimeout(() => { const inp = document.querySelector('.gl-body input:not([type=button]), .gl-body textarea'); if (inp) inp.focus(); }, 60);
}
function glCapture() {
  const g = state._guided; if (!g) return;
  const key = g.keys[g.step], d = g.draft;
  if (key === 'gym') { /* muscle group is captured on tap; nothing to read here */ }
  else if (key.indexOf('meal:') === 0) { const idx = parseInt(key.split(':')[1], 10); d.meals = d.meals || []; d.meals[idx] = d.meals[idx] || {}; d.meals[idx].cals = parseFloat(document.getElementById('gl-meal-cals')?.value) || ''; }
  else if (key === 'food') d.cals = parseFloat(document.getElementById('gl-cals')?.value) || '';
  else if (key === 'reading') d.readPages = parseInt(document.getElementById('gl-read')?.value) || '';
  else if (key === 'networking') d.net = parseInt(document.getElementById('gl-net')?.value) || '';
  else if (key === 'money') { d.spent = parseFloat(document.getElementById('gl-spent')?.value) || ''; d.moneyActs = (document.getElementById('gl-money-acts')?.value || '').trim(); }
  else if (key === 'water') d.water = parseFloat(document.getElementById('gl-water')?.value) || '';
  else if (key === 'weight') d.weight = parseFloat(document.getElementById('gl-weight')?.value) || '';
  else if (key === 'notes') d.notes = (document.getElementById('gl-notes')?.value || '').trim();
}
function glSetGym(v) { glCapture(); state._guided.draft.gymDone = v; state._guided.draft._gymAnswered = true; renderGuidedLog(); }
function glSetFood(n) { glCapture(); state._guided.draft.food = n; renderGuidedLog(); }
function glSetMeal(idx, status) { glCapture(); const d = state._guided.draft; d.meals = d.meals || []; d.meals[idx] = d.meals[idx] || {}; d.meals[idx].status = status; renderGuidedLog(); }
function glSetMuscle(g) { glCapture(); const d = state._guided.draft; d.gymGroup = (d.gymGroup === g ? '' : g); renderGuidedLog(); }
function glWater(inc) { const el = document.getElementById('gl-water'); if (el) el.value = Math.round(((parseFloat(el.value) || 0) + inc) * 100) / 100; }
function glNext() {
  glCapture();
  const g = state._guided;
  persistStep(g.keys[g.step]);   // save this part of the day immediately, so it sticks and drops off the flow
  if (g.step < g.keys.length - 1) { g.step++; renderGuidedLog(); }
  else finishGuidedLog();
}
function glBack() { glCapture(); if (state._guided.step > 0) { state._guided.step--; renderGuidedLog(); } }
function glSkip() { glNext(); }
// Saves one part of today's entry and marks it logged, so it sticks even if you
// leave mid-flow — and that step drops off the list until tomorrow.
function writeStepToDay(day, key, d) {
  if (key === 'gym') { if (isPillarOn('gym')) day.gym = { done: !!d.gymDone, muscleGroup: d.gymGroup || '', duration: (day.gym && day.gym.duration) || 0, notes: (day.gym && day.gym.notes) || '', exercises: (day.gym && day.gym.exercises) || [] }; }
  else if (key.indexOf('meal:') === 0) {
    const idx = parseInt(key.split(':')[1], 10);
    const dm = (d.meals && d.meals[idx]) || {};
    const nut = getNutrition();
    const m = (nut && nut.meals && nut.meals.plan[idx]) || { label: 'Meal ' + (idx + 1), calories: 0 };
    let cals = +dm.cals || 0;
    if (!cals && dm.status) cals = dm.status === 'ate' ? m.calories : dm.status === 'light' ? Math.round(m.calories * 0.6) : 0;
    day.mealLog = day.mealLog || {};
    day.mealLog[idx] = { label: m.label, status: dm.status || '', cals };
    const logged = Object.keys(day.mealLog).map(k => day.mealLog[k]);   // recompute the day's totals from logged meals
    day.calories = logged.reduce((s, mm) => s + (mm.cals || 0), 0);
    const rated = logged.filter(mm => mm.status);
    if (rated.length) { const sc = rated.reduce((s, mm) => s + (mm.status === 'ate' ? 5 : mm.status === 'light' ? 3 : 1), 0) / rated.length; day.food = day.food || {}; day.food.rating = Math.round(sc); }
  }
  else if (key === 'food') { if (isPillarOn('food')) { day.food = { rating: d.food || 0, notes: (day.food && day.food.notes) || '' }; if (d.cals) day.calories = d.cals; } }
  else if (key === 'reading') { if (isPillarOn('reading')) { const ab = (state.data.books || []).find(b => b.status === 'reading'); day.reading = { pages: d.readPages || 0, bookId: (ab && ab.id) || (day.reading && day.reading.bookId) || '', bookTitle: (ab && ab.title) || (day.reading && day.reading.bookTitle) || '', summary: (day.reading && day.reading.summary) || '' }; } }
  else if (key === 'networking') { if (isPillarOn('networking')) day.networking = { count: d.net || 0, notes: (day.networking && day.networking.notes) || '' }; }
  else if (key === 'money') { if (isPillarOn('money')) { day.spent = d.spent || 0; day.money = { activities: d.moneyActs || '', income: (day.money && day.money.income) || 0 }; } }
  else if (key === 'water') day.water = d.water || 0;
  else if (key === 'weight') { if (d.weight) { const kg = Math.round(displayToKg(d.weight) * 10) / 10; upsertWeight(day.date, kg); if (state.data.profile.nutrition && state.data.profile.nutrition.heightCm) state.data.profile.nutrition.weightKg = kg; } }
  else if (key === 'notes') day.notes = d.notes || '';
}
function persistStep(key) {
  const date = todayStr();
  const days = state.data.days = state.data.days || [];
  let day = days.find(x => x.date === date);
  if (!day) { day = { id: uid(), date }; days.push(day); }
  if (!Array.isArray(day._logged)) day._logged = [];
  writeStepToDay(day, key, state._guided.draft);
  if (!day._logged.includes(key)) day._logged.push(key);
  saveData();
  return day;
}
function finishGuidedLog() {
  // Every step was already saved by glNext; just celebrate the finished day.
  const day = (state.data.days || []).find(x => x.date === todayStr());
  state._guided = null;
  navigate('dashboard');
  if (day) setTimeout(() => showDayComplete(day), 250);   // votes + streak + your why
}
function renderLogToday(editDay) {
  const isEditing = !!editDay;
  // When not editing a past day, resume today's entry so the form shows what's
  // already logged (and autosave updates it instead of wiping it).
  const existingTodayEntry = !isEditing ? state.data.days.find(x => x.date === todayStr()) : null;
  const d = editDay || existingTodayEntry || {};
  const dateVal = d.date || todayStr();
  const gymDone = d.gym?.done ?? null;  // null = not set, true/false = set
  const gymGroup = d.gym?.muscleGroup || '';
  const gymNotes = d.gym?.notes || '';
  const foodRating = d.food?.rating || 0;
  const foodNotes = d.food?.notes || '';
  const netCount = d.networking?.count || '';
  const netNotes = d.networking?.notes || '';
  const moneyActs = d.money?.activities || '';
  const daySpent = (d.spent !== undefined && d.spent !== null && d.spent !== 0) ? d.spent : '';
  const waterVal = (d.water !== undefined && d.water !== null && d.water !== 0) ? d.water : '';
  const caloriesEaten = (d.calories !== undefined && d.calories !== null && d.calories !== 0) ? d.calories : '';
  // Seed the in-progress food log from the day being edited / today's entry
  state._foodLog = ((d.foodLog) || []).map(x => ({ ...x }));
  const globalNotes = d.notes || '';
  // Weigh-in prefill: existing weight entry for this date (shown in the user's unit)
  const existingWeight = (state.data.weights || []).find(w => w.date === dateVal);
  const weighInVal = existingWeight ? Math.round(kgToDisplay(existingWeight.kg) * 10) / 10 : '';

  const editBanner = isEditing
    ? '<div class="edit-banner">Editing ' + fmtDate(d.date) + '<button class="btn-link" onclick="navigate(\'history\')">Cancel</button></div>'
    : '';

  // Gentle continuity: remind them what they wrote yesterday while logging
  const prevNoteBanner = isEditing ? '' : renderPrevNoteBanner();

  // Boolean ("did you do it?") pillar — uses the gym slot
  const gymP = pillar('gym');
  const gymIsDefault = gymP.label === 'Gym';

  const gymToggle =
    '<div class="gym-toggle">' +
    '<button type="button" class="gym-btn' + (gymDone === true ? ' active gym-yes' : '') + '" onclick="setGymDone(true)">' + (gymIsDefault ? 'I Worked Out' : 'Did it') + '</button>' +
    '<button type="button" class="gym-btn' + (gymDone === false ? ' active gym-no' : '') + '" onclick="setGymDone(false)">' + (gymIsDefault ? 'Rest Day' : 'Not today') + '</button>' +
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
    '</div>' +
    '<div class="form-group"><label>Notes</label>' +
    '<textarea id="gym-notes" rows="2" placeholder="How it went, anything to remember…">' + gymNotes + '</textarea></div>' +
    (isEditing ? '' : renderWorkoutEntry(d)) +
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
    '<form id="day-form" onsubmit="submitDay(event)" oninput="scheduleAutosave()" onchange="scheduleAutosave()">' +
    '<div class="form-group" style="max-width:220px">' +
    '<label>Date</label>' +
    '<input type="date" id="day-date" value="' + dateVal + '" required>' +
    '</div>' +

    renderLogNutritionSection(caloriesEaten) +

    // BOOLEAN PILLAR (gym slot)
    (isPillarOn('gym') ?
      '<div class="today-section gym-section">' +
      '<div class="today-section-header gym-header">' + gymP.icon + ' ' + escapeHtml(gymP.label) + '</div>' +
      renderGymPlanHint() +
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
        '<div class="form-group"><label>Spent today <span style="font-weight:400;color:var(--text-muted)">($ — what you spent today)</span></label>' +
        '<input type="number" id="money-spent" min="0" step="0.01" placeholder="0" value="' + daySpent + '" oninput="updateNetHint()" style="font-size:20px;font-weight:800;border-color:var(--danger)"></div>' +
        // This period's income (set once, not asked when editing a past day)
        (!isEditing ?
          (isSet ? '<div id="period-income-set" class="period-set"><span>' + escapeHtml(pc.label) + ' this ' + label + ': <strong>' + formatCurrency(income) + '</strong></span>' +
                   '<button type="button" class="btn-link" onclick="editPeriodIncome()">Update</button></div>' : '') +
          '<div class="form-group" id="period-income-wrap"' + (isSet ? ' style="display:none"' : '') + '>' +
          '<label>' + escapeHtml(pc.label) + ' this ' + label + ' <span style="font-weight:400;color:var(--text-muted)">($ — set once, update when you get paid)</span></label>' +
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
          ? '<div class="current-book-label">' + escapeHtml(ab.title) + (ab.author ? ' · ' + escapeHtml(ab.author) : '') + '</div>' +
            '<div class="form-row">' +
            '<div class="form-group"><label>Pages read today</label>' +
            '<input type="number" id="read-pages" min="0" step="1" placeholder="0" value="' + rPages + '" style="font-size:20px;font-weight:800"></div>' +
            '<div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:16px">' +
            '<button type="button" class="btn btn-outline" style="font-size:12px" onclick="showAddBookModal(true)">Change Book</button>' +
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
    '<div class="today-section-header water-header">Water</div>' +
    '<div class="form-group">' +
    '<label>How much water did you drink today? <span style="font-weight:400;color:var(--text-muted)">(gallons)</span></label>' +
    '<div class="water-input-row">' +
    '<input type="number" id="water-gallons" min="0" step="0.25" placeholder="e.g. 0.5" value="' + waterVal + '" style="font-size:20px;font-weight:800;max-width:160px">' +
    '<span class="water-unit">gal</span>' +
    '<div class="water-quick">' +
    [0.25, 0.5, 0.75, 1].map(g => '<button type="button" class="water-chip" onclick="setWater(' + g + ')">' + g + '</button>').join('') +
    '</div>' +
    '</div>' +
    '<div class="water-hint">A common daily target is about ½–1 gallon.</div>' +
    '</div></div>' +

    // WEIGH-IN (optional — tracks bodyweight over time)
    '<div class="today-section weigh-section">' +
    '<div class="today-section-header weigh-header">Weigh-in</div>' +
    '<div class="form-group"><label>Today\'s weight <span style="font-weight:400;color:var(--text-muted)">(optional — builds your weight trend)</span></label>' +
    '<div class="weigh-row">' +
    '<input type="number" id="weigh-in" min="0" step="0.1" placeholder="' + (weightUnitPref() === 'lbs' ? '170' : '77') + '" value="' + weighInVal + '" style="font-size:20px;font-weight:800;max-width:160px">' +
    '<span class="weigh-unit">' + weightUnitPref() + '</span>' +
    '</div></div></div>' +

    '<div class="form-group" style="margin-top:8px"><label>Overall notes for today <span style="font-weight:400;color:var(--text-muted)">(what happened, how you felt — anything)</span></label>' +
    '<textarea id="day-notes" rows="3" placeholder="Share everything about your day — wins, struggles, ideas, how you felt…">' + escapeHtml(globalNotes) + '</textarea></div>' +

    '<div class="form-actions">' +
    '<span id="autosave-status" class="autosave-status"></span>' +
    (isEditing ? '<button type="button" class="btn btn-outline" onclick="navigate(\'history\')" style="margin-right:12px">Cancel</button>' : '') +
    '<button type="submit" class="btn btn-primary btn-lg">' + (isEditing ? 'Update Day' : 'Done for today') + '</button>' +
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
  scheduleAutosave();
}

function setFoodRating(n) {
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('sel'));
  document.querySelector('.rating-btn.r' + n)?.classList.add('sel');
  const inp = document.getElementById('food-rating');
  if (inp) inp.value = n;
  scheduleAutosave();
}

// Water quick-fill: add the chip amount to the current gallons value
function setWater(gal) {
  const inp = document.getElementById('water-gallons');
  if (!inp) return;
  const cur = parseFloat(inp.value) || 0;
  inp.value = Math.round((cur + gal) * 100) / 100;
  if (inp.oninput) inp.oninput();
  scheduleAutosave();
}

// Build a day entry from the current Log form. Shared by the explicit Save and
// the silent autosave. Pillars whose sections aren't on screen keep their prior
// values (so a disabled pillar isn't zeroed out).
function readDayForm(date, prior) {
  prior = prior || {};
  const gymDoneBtn = document.querySelector('.gym-btn.active');
  const gymDone = gymDoneBtn ? gymDoneBtn.classList.contains('gym-yes') : null;
  const foodEl = document.getElementById('food-rating');
  const entry = {
    id: state._editDayId || prior.id || uid(),
    date,
    gym: document.querySelector('.gym-btn') ? {
      done: gymDone === true,
      muscleGroup: document.getElementById('gym-group')?.value || '',
      duration: (prior.gym && prior.gym.duration) || 0,
      notes: document.getElementById('gym-notes')?.value?.trim() || '',
      exercises: (prior.gym && prior.gym.exercises) || []   // logged in the workout tracker, kept across saves
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
    entry.foodLog = prior.foodLog || [];
    entry.calories = prior.calories || 0;
    entry.eaten = prior.eaten || null;
  }
  // Reading — section is present whenever the reading pillar is on
  if (document.querySelector('.read-section')) {
    const ab = (state.data.books || []).find(b => b.status === 'reading');
    entry.reading = { pages: parseInt(document.getElementById('read-pages')?.value) || 0, bookId: ab?.id || '', bookTitle: ab?.title || '', summary: document.getElementById('read-summary')?.value?.trim() || '' };
  } else {
    entry.reading = prior.reading || { pages: 0, bookId: '', bookTitle: '', summary: '' };
  }
  return entry;
}

// Persist the current Log form (day entry + period income + weigh-in + nutrition
// snapshot). Used by both the explicit Save and the silent autosave.
async function commitDayFromForm() {
  const dateEl = document.getElementById('day-date');
  if (!dateEl) return null;
  const date = dateEl.value;
  const prior = (state._editDayId
    ? state.data.days.find(d => d.id === state._editDayId)
    : state.data.days.find(d => d.date === date)) || {};
  const entry = readDayForm(date, prior);
  const idx = state._editDayId
    ? state.data.days.findIndex(d => d.id === state._editDayId)
    : state.data.days.findIndex(d => d.date === date);
  if (idx !== -1) state.data.days[idx] = entry; else state.data.days.push(entry);
  // Period income (weekly/monthly, per the chosen cadence)
  const periodIncomeEl = document.getElementById('period-income');
  if (periodIncomeEl) { const cad = moneyCadence(); setPeriodIncome(cad, periodKeyFor(date, cad), parseFloat(periodIncomeEl.value) || 0); }
  // Weigh-in (stored in kg) + keep nutrition weight current
  const weighEl = document.getElementById('weigh-in');
  if (weighEl) {
    const wv = parseFloat(weighEl.value) || 0;
    if (wv > 0) { const kg = Math.round(displayToKg(wv) * 10) / 10; upsertWeight(date, kg); if (state.data.profile.nutrition && state.data.profile.nutrition.heightCm) state.data.profile.nutrition.weightKg = kg; }
  }
  // Keep the protein-nudge snapshot fresh
  const nut = getNutrition(); const t = foodLogTotals(state._foodLog);
  state.data._todayNutrition = { date: todayStr(), eatenP: Math.round(t.p), targetP: nut ? nut.protein.g : 0, loggedFood: (state._foodLog || []).length > 0 };
  await saveData();
  return entry;
}

async function submitDay(e) {
  e.preventDefault();
  const wasEditing = !!state._editDayId;
  const entry = await commitDayFromForm();
  if (!entry) return;
  state._editDayId = null;
  if (entry.gym && entry.gym.done) {
    const newStreak = getGymStreak();
    if ([3, 7, 14, 21, 30].includes(newStreak)) setTimeout(() => showStreakCelebration(newStreak), 600);
  }
  showToast(wasEditing ? 'Day updated!' : 'Saved — see you tomorrow!', 'success');
  navigate('dashboard');
}

// Silent autosave while filling in the Log, so nothing is ever lost
let _autosaveTimer = null;
function scheduleAutosave() {
  if (state.page !== 'log' || !document.getElementById('day-form')) return;
  setAutosaveStatus('saving');
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(autosaveDay, 700);
}
async function autosaveDay() {
  if (state.page !== 'log' || !document.getElementById('day-form')) return;
  try { await commitDayFromForm(); setAutosaveStatus('saved'); }
  catch { setAutosaveStatus(''); }
}
function setAutosaveStatus(s) {
  const el = document.getElementById('autosave-status');
  if (!el) return;
  el.textContent = s === 'saving' ? 'Saving…' : (s === 'saved' ? '✓ Saved' : '');
  el.className = 'autosave-status' + (s === 'saving' ? ' is-saving' : (s === 'saved' ? ' is-saved' : ''));
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
// ── Idea scoring: rate each idea 1–5 on four dimensions → a 0–100 "pursue" score,
// weighted toward money + speed since these are income ideas. All pure/testable. ──
const IDEA_DIMS = [
  { key: 'income',  label: 'Income potential', short: '$',     hint: 'How much could this realistically make?', w: 1.3 },
  { key: 'speed',   label: 'Speed to first $', short: 'Speed', hint: 'How fast could it earn its first dollar?', w: 1.1 },
  { key: 'ease',    label: 'Ease to start',    short: 'Ease',  hint: 'Low cost / low complexity to begin?',      w: 1 },
  { key: 'passion', label: 'Passion & fit',    short: 'Fit',   hint: 'How suited to you — and do you care?',      w: 1 }
];
function ideaScore(scores) {
  scores = scores || {};
  let sum = 0, max = 0;
  for (const d of IDEA_DIMS) { const v = Math.min(5, Math.max(0, +scores[d.key] || 0)); sum += v * d.w; max += 5 * d.w; }
  return max ? Math.round(sum / max * 100) : 0;
}
function ideaRated(scores) { scores = scores || {}; return IDEA_DIMS.every(d => (+scores[d.key] || 0) > 0); }
function ideaScoreLabel(score) { return score >= 78 ? 'Strong bet' : score >= 58 ? 'Promising' : score >= 38 ? 'Worth a look' : 'Long shot'; }
function topIdea(ideas) {
  const rated = (ideas || []).filter(i => i && i.status !== 'dropped' && ideaRated(i.scores));
  return rated.length ? rated.slice().sort((a, b) => ideaScore(b.scores) - ideaScore(a.scores))[0] : null;
}
// Pure: where an idea sits in the Build-Measure-Learn loop (The Lean Startup),
// from an untested guess to validated / pivot. Drives the card badge. (testable)
function validationStage(v) {
  v = v || {};
  const has = k => !!(v[k] && String(v[k]).trim());
  if (has('result') && v.decision === 'persevere') return { key: 'validated', label: 'Validated ✓', pct: 100 };
  if (has('result') && v.decision === 'pivot') return { key: 'pivot', label: 'Pivot', pct: 100 };
  if (has('result')) return { key: 'measuring', label: 'Results in — decide', pct: 85 };
  if (has('experiment') && has('metric')) return { key: 'experiment', label: 'Experiment ready', pct: 60 };
  if (has('customer') && has('valueHyp')) return { key: 'hypothesis', label: 'Hypotheses set', pct: 33 };
  if (has('customer') || has('valueHyp') || has('growthHyp')) return { key: 'started', label: 'Getting clear', pct: 15 };
  return { key: 'untested', label: 'Untested', pct: 0 };
}
function renderIdeasPage() {
  const { ideas } = state.data;
  const byScore = list => list.slice().sort((a, b) => ideaScore(b.scores) - ideaScore(a.scores));
  const active    = byScore(ideas.filter(i => i.status === 'active'));
  const exploring = byScore(ideas.filter(i => i.status === 'exploring'));
  const dropped   = ideas.filter(i => i.status === 'dropped');
  const top = topIdea(ideas);

  const bucket = s => s >= 78 ? 'strong' : s >= 58 ? 'good' : s >= 38 ? 'ok' : 'low';
  const ideaCard = (idea) => {
    const sc = idea.scores || {};
    const score = ideaScore(sc), rated = ideaRated(sc);
    const dims = '<div class="idea-dims">' + IDEA_DIMS.map(d => {
      const v = Math.min(5, Math.max(0, +sc[d.key] || 0));
      return '<div class="idim" title="' + escapeAttr(d.label) + '"><span class="idim-l">' + d.short + '</span><span class="idim-bar"><i style="width:' + (v * 20) + '%"></i></span></div>';
    }).join('') + '</div>';
    const pros = (idea.pros || []).length, cons = (idea.cons || []).length, cp = ideaTaskProgress(idea.checklist);
    const pcMini = (pros || cons || cp.total) ? '<div class="pc-mini">👍 ' + pros + ' · 👎 ' + cons + (cp.total ? ' · ✓ ' + cp.done + '/' + cp.total : '') + (idea.notes && idea.notes.trim() ? ' · 📝 notes' : '') + '</div>' : '';
    return '<div class="idea-card' + (top && top.id === idea.id ? ' idea-top' : '') + '">' +
      '<div class="idea-card-top">' +
      '<div class="idea-title" onclick="openIdea(\'' + idea.id + '\')" style="cursor:pointer">' + escapeHtml(idea.title) + '</div>' +
      (rated
        ? '<span class="idea-score s-' + bucket(score) + '">' + score + '<em>' + ideaScoreLabel(score) + '</em></span>'
        : '<span class="idea-score idea-unrated">Rate it</span>') +
      '</div>' +
      '<span class="idea-status-badge ' + idea.status + '">' + (idea.status === 'active' ? 'Active' : idea.status === 'exploring' ? 'Exploring' : 'Dropped') + '</span>' +
      (idea.description ? '<div class="idea-desc">' + escapeHtml(idea.description) + '</div>' : '') +
      dims +
      (() => { const vs = validationStage(idea.validation); return '<div class="idea-val"><span class="iv-badge iv-' + vs.key + '">' + vs.label + '</span><span class="iv-bar"><i style="width:' + vs.pct + '%"></i></span></div>'; })() +
      pcMini +
      (idea.nextStep ? '<div class="idea-next">→ <b>Next:</b> ' + escapeHtml(idea.nextStep) + '</div>' : '') +
      '<div class="idea-actions">' +
      '<button class="btn-sm btn-open" onclick="openIdea(\'' + idea.id + '\')">Open ›</button>' +
      (idea.status !== 'active'    ? '<button class="btn-sm" onclick="setIdeaStatus(\'' + idea.id + '\',\'active\')">Go Active</button>' : '') +
      (idea.status !== 'exploring' ? '<button class="btn-sm" onclick="setIdeaStatus(\'' + idea.id + '\',\'exploring\')">Exploring</button>' : '') +
      (idea.status !== 'dropped'   ? '<button class="btn-sm btn-sm-danger" onclick="setIdeaStatus(\'' + idea.id + '\',\'dropped\')">Drop</button>' : '') +
      '<button class="btn-sm btn-sm-danger" onclick="deleteIdea(\'' + idea.id + '\')">Delete</button>' +
      '</div></div>';
  };

  const section = (title, list) => list.length === 0 ? '' :
    '<h3 class="ideas-section-title">' + title + '</h3>' +
    '<div class="ideas-grid">' + list.map(ideaCard).join('') + '</div>';

  document.getElementById('main').innerHTML =
    '<div class="page-header">' +
    '<h2 class="page-title">Business Ideas</h2>' +
    '<p class="page-sub">Score every idea, then chase the one worth chasing</p>' +
    '</div>' +
    businessTabs('ideas') +

    (top
      ? '<div class="idea-focus"><div class="if-label">🎯 Your strongest bet</div>' +
        '<div class="if-title">' + escapeHtml(top.title) + ' <span class="if-score s-' + bucket(ideaScore(top.scores)) + '">' + ideaScore(top.scores) + '</span></div>' +
        (top.nextStep ? '<div class="if-next">Next step: ' + escapeHtml(top.nextStep) + '</div>' : '<div class="if-next if-muted">Add its next step under “Evaluate” →</div>') +
        '</div>'
      : '') +

    '<div class="card">' +
    '<h3 class="card-title">Add New Idea</h3>' +
    '<form id="idea-form" onsubmit="addIdea(event)">' +
    '<div class="form-group"><label>Idea title <span style="color:var(--danger)">*</span></label>' +
    '<input type="text" id="idea-title" placeholder="e.g. Start a referral program at the gym · Sell solar panels on weekends · Launch an online sales course" required></div>' +
    '<div class="form-group"><label>Description / notes</label>' +
    '<textarea id="idea-desc" rows="2" placeholder="How it works, estimated income, what you need to start…"></textarea></div>' +
    '<div class="form-group"><label>Status</label>' +
    '<select id="idea-status">' +
    '<option value="exploring">Exploring — thinking about it</option>' +
    '<option value="active">Active — already working on it</option>' +
    '</select></div>' +
    '<button type="submit" class="btn btn-primary">+ Add Idea</button>' +
    '</form></div>' +

    (ideas.length === 0
      ? '<div class="empty-state small"><p>No ideas yet. Add your first one above, or ask the AI Coach for income stream ideas.</p></div>'
      : section('Active', active) + section('Exploring', exploring) + section('Dropped', dropped)) +

    (state.hasApiKey && ideas.length > 0
      ? '<div class="card" style="margin-top:4px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><h3 class="card-title" style="margin-bottom:4px">Analyze My Ideas</h3>' +
        '<p style="font-size:13px;color:var(--text-muted)">Ask your AI coach which idea has the best potential for your situation</p></div>' +
        '<button class="btn btn-primary" id="btn-ideas-ai" onclick="analyzeIdeas()">Ask Coach</button></div>' +
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
    createdAt: todayStr(), notes: '', scores: {}, nextStep: '', validation: {}, pros: [], cons: [], checklist: []
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
  refreshIdeasView();
}

async function deleteIdea(id) {
  if (!confirm('Delete this idea?')) return;
  state.data.ideas = state.data.ideas.filter(i => i.id !== id);
  state._openIdea = null;
  await saveData();
  showToast('Idea deleted.', 'success');
  renderIdeasPage();
}

// ── Idea workspace: the whole picture for one idea in one place ──
function openIdea(id) { state._openIdea = id; renderIdeaDetail(id); }
function backToIdeas() { state._openIdea = null; renderIdeasPage(); }
function refreshIdeasView() { if (state._openIdea && state.data.ideas.some(i => i.id === state._openIdea)) renderIdeaDetail(state._openIdea); else renderIdeasPage(); }
function addIdeaPro(id) { const el = document.getElementById('pro-input-' + id); const v = (el && el.value || '').trim(); if (!v) return; const idea = state.data.ideas.find(i => i.id === id); if (!idea) return; idea.pros = idea.pros || []; idea.pros.push(v); saveData(); renderIdeaDetail(id); document.getElementById('pro-input-' + id)?.focus(); }
function addIdeaCon(id) { const el = document.getElementById('con-input-' + id); const v = (el && el.value || '').trim(); if (!v) return; const idea = state.data.ideas.find(i => i.id === id); if (!idea) return; idea.cons = idea.cons || []; idea.cons.push(v); saveData(); renderIdeaDetail(id); document.getElementById('con-input-' + id)?.focus(); }
function removeIdeaPro(id, i) { const idea = state.data.ideas.find(x => x.id === id); if (!idea || !idea.pros) return; idea.pros.splice(i, 1); saveData(); renderIdeaDetail(id); }
function removeIdeaCon(id, i) { const idea = state.data.ideas.find(x => x.id === id); if (!idea || !idea.cons) return; idea.cons.splice(i, 1); saveData(); renderIdeaDetail(id); }
function setIdeaField(id, key, val) { const idea = state.data.ideas.find(i => i.id === id); if (!idea) return; idea[key] = val; saveData(); }
// Pure: checklist progress for an idea. (testable)
function ideaTaskProgress(list) { const a = Array.isArray(list) ? list : []; const total = a.length, done = a.filter(t => t && t.done).length; return { done, total, pct: total ? Math.round(done / total * 100) : 0 }; }
function addIdeaTask(id) { const el = document.getElementById('task-input-' + id); const v = (el && el.value || '').trim(); if (!v) return; const idea = state.data.ideas.find(i => i.id === id); if (!idea) return; idea.checklist = idea.checklist || []; idea.checklist.push({ id: uid(), text: v, done: false }); saveData(); renderIdeaDetail(id); document.getElementById('task-input-' + id)?.focus(); }
function toggleIdeaTask(id, tid) { const idea = state.data.ideas.find(i => i.id === id); if (!idea || !idea.checklist) return; const t = idea.checklist.find(x => x.id === tid); if (t) { t.done = !t.done; saveData(); renderIdeaDetail(id); } }
function removeIdeaTask(id, tid) { const idea = state.data.ideas.find(i => i.id === id); if (!idea || !idea.checklist) return; idea.checklist = idea.checklist.filter(x => x.id !== tid); saveData(); renderIdeaDetail(id); }
function renderIdeaDetail(id) {
  const idea = state.data.ideas.find(i => i.id === id);
  if (!idea) { backToIdeas(); return; }
  idea.pros = idea.pros || []; idea.cons = idea.cons || [];
  const sc = idea.scores || {}, score = ideaScore(sc), rated = ideaRated(sc);
  const bucket = score >= 78 ? 'strong' : score >= 58 ? 'good' : score >= 38 ? 'ok' : 'low';
  const vs = validationStage(idea.validation);
  const statusLabel = idea.status === 'active' ? 'Active' : idea.status === 'exploring' ? 'Exploring' : 'Dropped';
  const pcList = (arr, kind) => arr.length
    ? '<ul class="pc-list">' + arr.map((t, i) => '<li><span>' + escapeHtml(t) + '</span><button type="button" onclick="removeIdea' + kind + '(\'' + id + '\',' + i + ')" aria-label="Remove">✕</button></li>').join('') + '</ul>'
    : '<div class="pc-empty">None yet.</div>';
  document.getElementById('main').innerHTML =
    '<div class="idw-wrap">' +
    '<div class="idw-top"><button type="button" class="wo-back" onclick="backToIdeas()">‹ All ideas</button>' +
    '<span class="idea-status-badge ' + idea.status + '">' + statusLabel + '</span></div>' +
    '<h2 class="idw-title">' + escapeHtml(idea.title) + '</h2>' +
    '<div class="idw-badges">' +
    (rated ? '<span class="idea-score s-' + bucket + '">' + score + '<em>' + ideaScoreLabel(score) + '</em></span>' : '<span class="idea-score idea-unrated">Rate it</span>') +
    '<span class="iv-badge iv-' + vs.key + '">' + vs.label + '</span></div>' +
    '<div class="idw-tools">' +
    '<button type="button" class="btn btn-outline btn-sm" onclick="showIdeaEval(\'' + id + '\')">Score it</button>' +
    '<button type="button" class="btn btn-outline btn-sm" onclick="showIdeaValidate(\'' + id + '\')">Validate</button>' +
    (state.hasApiKey ? '<button type="button" class="btn btn-primary btn-sm" onclick="openIdeaCoach(\'' + id + '\')">🎯 Interview me</button>' : '') +
    '</div>' +
    '<div class="idw-sec-h">What it is</div>' +
    '<textarea class="idw-ta" placeholder="Describe the idea in a line or two…" onchange="setIdeaField(\'' + id + '\',\'description\',this.value)">' + escapeHtml(idea.description || '') + '</textarea>' +
    '<div class="idw-pc">' +
    '<div class="pc-col"><div class="pc-h pc-pros-h">👍 Pros</div>' + pcList(idea.pros, 'Pro') +
    '<div class="pc-add"><input id="pro-input-' + id + '" placeholder="Add a pro…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addIdeaPro(\'' + id + '\');}"><button type="button" onclick="addIdeaPro(\'' + id + '\')">+</button></div></div>' +
    '<div class="pc-col"><div class="pc-h pc-cons-h">👎 Cons</div>' + pcList(idea.cons, 'Con') +
    '<div class="pc-add"><input id="con-input-' + id + '" placeholder="Add a con…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addIdeaCon(\'' + id + '\');}"><button type="button" onclick="addIdeaCon(\'' + id + '\')">+</button></div></div>' +
    '</div>' +
    (() => {
      const list = idea.checklist || [], cp = ideaTaskProgress(list);
      return '<div class="idw-sec-h">Checklist' + (cp.total ? ' · ' + cp.done + '/' + cp.total + ' done' : '') + '</div>' +
        (cp.total ? '<div class="idw-cl-bar"><i style="width:' + cp.pct + '%"></i></div>' : '') +
        (list.length ? '<div class="idw-cl">' + list.map(t =>
          '<div class="clx-row' + (t.done ? ' clx-done' : '') + '">' +
          '<button type="button" class="clx-box" onclick="toggleIdeaTask(\'' + id + '\',\'' + t.id + '\')">' + (t.done ? '✓' : '') + '</button>' +
          '<span class="clx-text">' + escapeHtml(t.text) + '</span>' +
          '<button type="button" class="clx-del" onclick="removeIdeaTask(\'' + id + '\',\'' + t.id + '\')" aria-label="Remove">✕</button></div>').join('') + '</div>' : '') +
        '<div class="pc-add"><input id="task-input-' + id + '" placeholder="Add a task — e.g. Call 3 gyms" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addIdeaTask(\'' + id + '\');}"><button type="button" onclick="addIdeaTask(\'' + id + '\')">+</button></div>';
    })() +
    (idea.nextStep ? '<div class="idw-sec-h">Next step</div><div class="idea-next">→ ' + escapeHtml(idea.nextStep) + '</div>' : '') +
    '<div class="idw-sec-h">Notes</div>' +
    '<textarea class="idw-ta idw-notes" placeholder="Everything else — research, contacts, numbers, links, thoughts…" onchange="setIdeaField(\'' + id + '\',\'notes\',this.value)">' + escapeHtml(idea.notes || '') + '</textarea>' +
    '<div class="idw-actions">' +
    (idea.status !== 'active' ? '<button type="button" class="btn-sm" onclick="setIdeaStatus(\'' + id + '\',\'active\')">Go Active</button>' : '') +
    (idea.status !== 'exploring' ? '<button type="button" class="btn-sm" onclick="setIdeaStatus(\'' + id + '\',\'exploring\')">Exploring</button>' : '') +
    (idea.status !== 'dropped' ? '<button type="button" class="btn-sm btn-sm-danger" onclick="setIdeaStatus(\'' + id + '\',\'dropped\')">Drop</button>' : '') +
    '<button type="button" class="btn-sm btn-sm-danger" onclick="deleteIdea(\'' + id + '\')">Delete</button>' +
    '</div></div>';
}

// ── Evaluate an idea: rate the four dimensions + set its next step ──
function showIdeaEval(id) {
  const idea = state.data.ideas.find(i => i.id === id); if (!idea) return;
  idea.scores = idea.scores || {};
  document.getElementById('idea-eval-overlay')?.remove();
  const o = document.createElement('div');
  o.id = 'idea-eval-overlay'; o.className = 'modal-overlay';
  o.innerHTML = renderIdeaEval(idea);
  o.addEventListener('click', e => { if (e.target === o) closeIdeaEval(); });
  document.body.appendChild(o);
}
function renderIdeaEval(idea) {
  const sc = idea.scores || {};
  const score = ideaScore(sc), rated = ideaRated(sc);
  const bkt = score >= 78 ? 'strong' : score >= 58 ? 'good' : score >= 38 ? 'ok' : 'low';
  const rows = IDEA_DIMS.map(d => {
    const v = Math.min(5, Math.max(0, +sc[d.key] || 0));
    const dots = [1, 2, 3, 4, 5].map(n => '<button type="button" class="ie-dot' + (v >= n ? ' on' : '') + '" onclick="setIdeaDim(\'' + idea.id + '\',\'' + d.key + '\',' + n + ')">' + n + '</button>').join('');
    return '<div class="ie-row"><div class="ie-dim"><b>' + d.label + '</b><span>' + escapeHtml(d.hint) + '</span></div><div class="ie-dots">' + dots + '</div></div>';
  }).join('');
  return '<div class="modal-box idea-eval-box">' +
    '<h3 class="card-title" style="margin-bottom:2px">Evaluate: ' + escapeHtml(idea.title) + '</h3>' +
    '<p class="card-sub">Rate each 1–5 — we\'ll score the idea so you know which to chase.</p>' +
    '<div class="ie-score-big s-' + bkt + '">' + (rated ? score + '<em>' + ideaScoreLabel(score) + '</em>' : '<em>Rate all four</em>') + '</div>' +
    rows +
    '<div class="form-group" style="margin-top:12px"><label>Next step — the one action that moves this forward</label>' +
    '<input type="text" id="idea-next-input" placeholder="e.g. Call 3 gyms and pitch the referral deal" value="' + escapeAttr(idea.nextStep || '') + '" oninput="setIdeaNext(\'' + idea.id + '\', this.value)"></div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button type="button" class="btn btn-primary" onclick="closeIdeaEval()">Done</button></div>' +
    '</div>';
}
function setIdeaDim(id, key, val) {
  const idea = state.data.ideas.find(i => i.id === id); if (!idea) return;
  idea.scores = idea.scores || {};
  idea.scores[key] = (idea.scores[key] === val ? val - 1 : val);   // tap the same dot again to lower it
  const o = document.getElementById('idea-eval-overlay'); if (o) o.innerHTML = renderIdeaEval(idea);
}
function setIdeaNext(id, val) { const idea = state.data.ideas.find(i => i.id === id); if (idea) idea.nextStep = val; }
function closeIdeaEval() { document.getElementById('idea-eval-overlay')?.remove(); saveData(); refreshIdeasView(); }

// ── Lean Startup validation: test the risky guesses before you build ──
function showIdeaValidate(id) {
  const idea = state.data.ideas.find(i => i.id === id); if (!idea) return;
  idea.validation = idea.validation || {};
  document.getElementById('idea-validate-overlay')?.remove();
  const o = document.createElement('div');
  o.id = 'idea-validate-overlay'; o.className = 'modal-overlay';
  o.innerHTML = renderIdeaValidate(idea);
  o.addEventListener('click', e => { if (e.target === o) closeIdeaValidate(); });
  document.body.appendChild(o);
}
function renderIdeaValidate(idea) {
  const v = idea.validation || {};
  const st = validationStage(v);
  const ta = (key, label, hint, ph, rows) =>
    '<div class="iv-field"><label>' + label + '</label>' +
    '<div class="iv-hint">' + hint + '</div>' +
    '<textarea rows="' + (rows || 2) + '" placeholder="' + escapeAttr(ph) + '" oninput="setIdeaVal(\'' + idea.id + '\',\'' + key + '\',this.value)">' + escapeHtml(v[key] || '') + '</textarea></div>';
  const aiBlock = state.hasApiKey
    ? '<button type="button" class="btn btn-primary" onclick="openIdeaCoach(\'' + idea.id + '\')" style="margin-top:10px;width:100%">🎯 Interview me — the validation coach</button>' +
      '<div class="iv-ai-hint">A step-by-step stress-test drawn from The Mom Test, Running Lean, Zero to One &amp; more.</div>'
    : '<div class="iv-ai-hint">Add your AI key in Settings and a validation coach will interview and stress-test this idea — Mom Test style.</div>';
  return '<div class="modal-box iv-box">' +
    '<div class="iv-head"><div><h3 class="card-title" style="margin-bottom:2px">Validate: ' + escapeHtml(idea.title) + '</h3>' +
    '<p class="card-sub" style="margin-bottom:0">The Lean Startup way — test the risky guesses before you build.</p></div>' +
    '<button type="button" class="mm-close" onclick="closeIdeaValidate()">✕</button></div>' +
    '<div class="iv-stage"><span class="iv-badge iv-' + st.key + '">' + st.label + '</span><span class="iv-bar"><i style="width:' + st.pct + '%"></i></span></div>' +
    '<div class="iv-sec">1 · Get out of the building</div>' +
    ta('customer', 'Who exactly is the customer?', 'Be specific — “new members in their first month”, not “everyone”.', 'e.g. New gym members who want fast results', 2) +
    ta('valueHyp', 'Value hypothesis — why will they want it?', 'The job it does that they would actually pay for.', 'They’ll want it because…', 2) +
    ta('growthHyp', 'Growth hypothesis — how will it spread?', 'Where new customers come from (referrals, ads, word of mouth).', 'New customers will come from…', 2) +
    '<div class="iv-sec">2 · The riskiest assumption</div>' +
    ta('riskiest', 'If this one belief is wrong, the idea dies. Which is it?', 'Test the scariest assumption first — not the easiest.', 'The thing that would kill this is…', 2) +
    '<div class="iv-sec">3 · Build — the smallest experiment (MVP)</div>' +
    ta('experiment', 'The cheapest test that gives real evidence in a week', 'Pre-sell it · a one-page site · do it by hand for 5 people · a fake “buy” button.', 'To test it cheaply I will…', 2) +
    '<div class="iv-sec">4 · Measure — the number that proves it</div>' +
    ta('metric', 'One actionable metric + your pass mark', 'Avoid vanity metrics (likes, views). Use “10 of 20 pre-order”.', 'Success = …', 2) +
    '<div class="iv-sec">5 · Learn — what happened, then decide</div>' +
    ta('result', 'What actually happened when you ran it?', 'Real evidence beats opinion — including yours.', 'The result was…', 2) +
    '<div class="iv-decide"><span>Verdict:</span>' +
    '<button type="button" class="iv-dec' + (v.decision === 'persevere' ? ' on' : '') + '" data-dec="persevere" onclick="setIdeaDecision(\'' + idea.id + '\',\'persevere\')">Persevere ✓</button>' +
    '<button type="button" class="iv-dec' + (v.decision === 'pivot' ? ' on' : '') + '" data-dec="pivot" onclick="setIdeaDecision(\'' + idea.id + '\',\'pivot\')">Pivot ↺</button>' +
    '</div>' +
    aiBlock +
    '<div style="display:flex;justify-content:flex-end;margin-top:12px"><button type="button" class="btn btn-primary" onclick="closeIdeaValidate()">Done</button></div>' +
    '</div>';
}
function setIdeaVal(id, key, val) { const idea = state.data.ideas.find(i => i.id === id); if (!idea) return; idea.validation = idea.validation || {}; idea.validation[key] = val; }
function setIdeaDecision(id, val) {
  const idea = state.data.ideas.find(i => i.id === id); if (!idea) return;
  idea.validation = idea.validation || {};
  idea.validation.decision = (idea.validation.decision === val ? '' : val);
  document.querySelectorAll('.iv-dec').forEach(b => b.classList.toggle('on', b.dataset.dec === idea.validation.decision));
}
function closeIdeaValidate() { document.getElementById('idea-validate-overlay')?.remove(); saveData(); refreshIdeasView(); }
async function validateIdeaWithAI(id) {
  const idea = state.data.ideas.find(i => i.id === id); if (!idea) return;
  const v = idea.validation || {};
  const btn = document.getElementById('iv-ai-btn');
  const resultEl = document.getElementById('iv-ai-result');
  const q = 'Act as a Lean Startup coach in the spirit of Eric Ries. Pressure-test this business idea and its validation plan — be direct and practical.\n\n' +
    'IDEA: ' + idea.title + (idea.description ? ' — ' + idea.description : '') + '\n' +
    'Customer: ' + (v.customer || '(not set)') + '\n' +
    'Value hypothesis: ' + (v.valueHyp || '(not set)') + '\n' +
    'Growth hypothesis: ' + (v.growthHyp || '(not set)') + '\n' +
    'Their riskiest assumption: ' + (v.riskiest || '(not set)') + '\n' +
    'Planned experiment / MVP: ' + (v.experiment || '(not set)') + '\n' +
    'Success metric: ' + (v.metric || '(not set)') + '\n\n' +
    '## 1. The real riskiest assumption\nIs their stated riskiest assumption truly the one that could kill this? If not, name the real one.\n\n' +
    '## 2. The cheapest experiment\nDesign the smallest, fastest test (concierge MVP, smoke-test landing page, pre-sell) to get real evidence in under a week — give concrete steps.\n\n' +
    '## 3. Vanity vs actionable metric\nIs their metric actionable? Give the single number and a pass/fail threshold to hold to.\n\n' +
    '## 4. Pivot signals\nWhat result would mean pivot rather than persevere?';
  await streamAnalysis(q, resultEl, btn, '🧪 Pressure-test with the coach');
}

// ── Interactive validation-coach interview (multi-turn chat, one idea) ──
function openIdeaCoach(id) {
  const idea = state.data.ideas.find(i => i.id === id); if (!idea) return;
  if (!state.hasApiKey) { showToast('Add your AI key in Settings to use the validation coach.', 'error'); return; }
  closeIdeaValidate();
  const seeded = (Array.isArray(idea.coachChat) && idea.coachChat.length)
    ? idea.coachChat.slice()
    : [{ role: 'assistant', content: "I'm your validation coach — here to stress-test this, not cheer for it. One question at a time, and I want **evidence**, not opinions.\n\n**Stage 1 — the problem.**\nIn one sentence: what problem does **" + (idea.title || 'this idea') + "** solve, and *for whom*? (No features yet — describe the wound.)" }];
  state._ideaCoach = { id, messages: seeded, busy: false };
  renderIdeaCoach();
}
function renderIdeaCoachThread() {
  const c = state._ideaCoach || { messages: [] };
  return c.messages.map(m => '<div class="chat-msg ' + (m.role === 'user' ? 'chat-user' : 'chat-bot') + '">' + (m.role === 'user' ? escapeHtml(m.content) : renderMarkdown(m.content)) + '</div>').join('') +
    (c.busy ? '<div class="chat-msg chat-bot chat-typing"><span></span><span></span><span></span></div>' : '');
}
function refreshIdeaCoachThread() { const el = document.getElementById('ic-thread'); if (el) { el.innerHTML = renderIdeaCoachThread(); el.scrollTop = el.scrollHeight; } }
function renderIdeaCoach() {
  const c = state._ideaCoach; if (!c) return;
  const idea = state.data.ideas.find(i => i.id === c.id) || {};
  document.getElementById('idea-coach-overlay')?.remove();
  const o = document.createElement('div');
  o.id = 'idea-coach-overlay'; o.className = 'modal-overlay';
  o.innerHTML = '<div class="modal-box ic-box">' +
    '<div class="iv-head"><div><h3 class="card-title" style="margin-bottom:2px">Validation coach 🎯</h3>' +
    '<p class="card-sub" style="margin-bottom:0">' + escapeHtml(idea.title || 'Your idea') + '</p></div>' +
    '<button type="button" class="mm-close" onclick="closeIdeaCoach()">✕</button></div>' +
    '<div id="ic-thread" class="coach-thread ic-thread">' + renderIdeaCoachThread() + '</div>' +
    '<div class="coach-input-row"><textarea id="ic-input" rows="1" placeholder="Answer honestly…" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendIdeaChat();}"></textarea>' +
    '<button type="button" class="btn btn-primary" onclick="sendIdeaChat()">Send</button></div>' +
    '</div>';
  o.addEventListener('click', e => { if (e.target === o) closeIdeaCoach(); });
  document.body.appendChild(o);
  const th = document.getElementById('ic-thread'); if (th) th.scrollTop = th.scrollHeight;
  setTimeout(() => document.getElementById('ic-input')?.focus(), 80);
}
async function sendIdeaChat() {
  const c = state._ideaCoach; if (!c || c.busy) return;
  const inp = document.getElementById('ic-input'); const text = (inp && inp.value || '').trim();
  if (!text) return;
  const idea = state.data.ideas.find(i => i.id === c.id) || {};
  c.messages.push({ role: 'user', content: text });
  if (inp) inp.value = '';
  c.busy = true; refreshIdeaCoachThread();
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ messages: c.messages, mode: 'ideacoach', idea: { title: idea.title, description: idea.description, scores: idea.scores, validation: idea.validation } }) });
    const j = await res.json().catch(() => ({}));
    c.busy = false;
    if (!res.ok) c.messages.push({ role: 'assistant', content: j.error === 'NO_KEY' ? 'Add your AI key in Settings to use the coach.' : (j.error || 'Something went wrong — try again.') });
    else c.messages.push({ role: 'assistant', content: j.reply || 'Try rephrasing that.' });
  } catch { c.busy = false; c.messages.push({ role: 'assistant', content: 'Could not reach the coach — check your connection.' }); }
  refreshIdeaCoachThread();
}
function closeIdeaCoach() {
  const c = state._ideaCoach;
  if (c) { const idea = state.data.ideas.find(i => i.id === c.id); if (idea) { idea.coachChat = c.messages; saveData(); } }
  document.getElementById('idea-coach-overlay')?.remove();
  state._ideaCoach = null;
  refreshIdeasView();
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
  await streamAnalysis(question, resultEl, btn, 'Ask Coach');
}

// ─────────────────────────────────────────────────────────────
// CONTACTS  (mini-CRM for networking → commission)
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// HEALTH HUB — training + nutrition + body, in one smart place
// ─────────────────────────────────────────────────────────────
function healthTabs(active) {
  const tab = (id, label) => '<button type="button" class="biz-tab' + (active === id ? ' on' : '') + '" onclick="setHealthTab(\'' + id + '\')">' + label + '</button>';
  return '<div class="biz-tabs">' + tab('overview', 'Overview') + tab('training', 'Training') + tab('nutrition', 'Nutrition') + '</div>';
}
function setHealthTab(t) { state._healthTab = t; renderHealthPage(); }
function renderHealthPage() {
  const tab = state._healthTab || 'overview';
  const stats = getWeekStats();
  const nut = getNutrition();
  const profile = state.data.profile || {};
  const gymGoal = profile.gymDaysPerWeek || 5;
  const gymDays = stats.gymDays || 0;
  const streak = getGymStreak();
  const td = (state.data.days || []).find(d => d.date === todayStr()) || {};
  const eatenCal = td.calories || 0;
  const eatenP = (td.eaten && td.eaten.protein) || 0;
  const weights = (state.data.weights || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const latestW = weights.length ? weights[weights.length - 1] : null;
  const wDisp = latestW ? Math.round(kgToDisplay(latestW.kg) * 10) / 10 : null;
  const wUnit = weightUnitPref() === 'lbs' ? 'lb' : 'kg';

  let body;
  if (tab === 'training') body = renderHealthTraining(gymDays, gymGoal, streak);
  else if (tab === 'nutrition') body = renderHealthNutrition(nut, td, eatenCal, eatenP);
  else body = renderHealthOverview(nut, gymDays, gymGoal, streak, eatenCal, eatenP, wDisp, wUnit);

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">Health</h2>' +
    '<p class="page-sub">Training, nutrition and your body — in one place.</p></div>' +
    healthTabs(tab) + body;
  if (tab === 'nutrition' && (state.data.weights || []).length >= 2) initWeightChart();
}
function renderHealthOverview(nut, gymDays, gymGoal, streak, eatenCal, eatenP, wDisp, wUnit) {
  const gymLeft = Math.max(0, gymGoal - gymDays);
  const pTarget = nut ? nut.protein.g : 0;
  const pLeft = pTarget ? Math.max(0, pTarget - Math.round(eatenP)) : 0;
  let insight;
  if (gymLeft > 0) insight = '🏔️ ' + gymLeft + ' more workout' + (gymLeft === 1 ? '' : 's') + ' to hit your weekly goal of ' + gymGoal + '.';
  else if (pTarget && pLeft >= 20) insight = '🍗 ' + pLeft + 'g of protein to go today — make your next meal count.';
  else if (gymDays >= gymGoal) insight = '💪 Weekly training goal smashed — recover well and keep eating for your goal.';
  else insight = 'Log your training and food to see how your week is shaping up.';
  const card = (inner, onclick) => '<button type="button" class="biz-card" onclick="' + onclick + '">' + inner + '</button>';
  return '<div class="biz-insight">' + insight + '</div>' +
    '<div class="biz-grid">' +
    card('<div class="biz-k">Training this week</div><div class="biz-big">' + gymDays + ' / ' + gymGoal + '</div><div class="biz-sub">' + (streak > 1 ? streak + '-day streak 🔥' : 'days trained') + '</div>', "setHealthTab('training')") +
    card('<div class="biz-k">Calories today</div><div class="biz-big">' + eatenCal.toLocaleString() + '</div><div class="biz-sub">' + (nut ? 'of ' + nut.calories.toLocaleString() + ' target' : 'set up nutrition') + '</div>', "setHealthTab('nutrition')") +
    card('<div class="biz-k">Protein today</div><div class="biz-big">' + Math.round(eatenP) + 'g</div><div class="biz-sub">' + (pTarget ? 'of ' + pTarget + 'g target' : 'set a target') + '</div>', "setHealthTab('nutrition')") +
    card('<div class="biz-k">Weight</div><div class="biz-big">' + (wDisp != null ? wDisp + ' <span style="font-size:14px">' + wUnit + '</span>' : '—') + '</div><div class="biz-sub">' + (wDisp != null ? 'latest weigh-in' : 'log your weight') + '</div>', "setHealthTab('nutrition')") +
    '</div>' +
    '<button type="button" class="wo-add" style="margin-top:4px" onclick="openWorkout(\'health\')">🏋️ Track a workout — sets, reps & rest timer</button>';
}
function renderHealthTraining(gymDays, gymGoal, streak) {
  const list = (state.data.days || []).filter(d => d.gym && d.gym.done).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 6);
  const recent = list.length ? '<div class="idw-sec-h">Recent workouts</div>' + list.map(d => {
    const tot = workoutTotals(d.gym.exercises);
    const label = d.gym.muscleGroup ? d.gym.muscleGroup.charAt(0).toUpperCase() + d.gym.muscleGroup.slice(1) : 'Workout';
    const meta = tot.sets ? tot.sets + ' sets · ' + tot.reps + ' reps' : (tot.secs ? formatClock(tot.secs) + ' logged' : 'done ✓');
    return '<div class="hl-workout"><span class="hl-w-date">' + fmtDate(d.date) + '</span><span class="hl-w-label">' + escapeHtml(label) + '</span><span class="hl-w-meta">' + meta + '</span></div>';
  }).join('') : '<div class="pc-empty" style="margin-top:8px">No workouts logged yet — track your first above.</div>';
  return '<div class="biz-insight">' + gymDays + ' / ' + gymGoal + ' workouts this week' + (streak > 1 ? ' · ' + streak + '-day streak 🔥' : '') + '</div>' +
    '<button type="button" class="wo-add" onclick="openWorkout(\'health\')">🏋️ Track a workout</button>' +
    renderGymPlanCard() + recent;
}
function renderHealthNutrition(nut, td, eatenCal, eatenP) {
  if (!nut) return '<div class="empty-state small"><p>Set up your calorie & protein targets to track nutrition.</p><div class="empty-actions"><button class="btn btn-primary" onclick="navigate(\'settings\')">Set up nutrition →</button></div></div>';
  const eaten = td.eaten || {};
  const bar = (val, target, label, unit, color) => '<div class="hl-macro"><div class="hl-macro-top"><span>' + label + '</span><span>' + val.toLocaleString() + ' / ' + target.toLocaleString() + unit + '</span></div><div class="hl-macro-bar"><i style="width:' + Math.min(100, target ? Math.round(val / target * 100) : 0) + '%;background:' + color + '"></i></div></div>';
  const today = '<div class="idw-sec-h">Today</div><div class="hl-today">' +
    bar(eatenCal, nut.calories, 'Calories', '', 'var(--gym-color)') +
    bar(Math.round(eatenP), nut.protein.g, 'Protein', 'g', 'var(--success)') +
    bar(Math.round(eaten.carbs || 0), nut.carbs.g, 'Carbs', 'g', 'var(--accent)') +
    bar(Math.round(eaten.fat || 0), nut.fat.g, 'Fat', 'g', '#A78BFA') +
    '</div><button type="button" class="wo-add" onclick="navigate(\'log\')">＋ Log today\'s food</button>';
  return today + renderMealPlan(nut) + renderNutritionWeekCard() + renderWeightTrend();
}

// ─────────────────────────────────────────────────────────────
// BUSINESS HUB — ideas + pipeline + money, in one smart place
// ─────────────────────────────────────────────────────────────
function businessTabs(active) {
  const tab = (id, target, label) => '<button type="button" class="biz-tab' + (active === id ? ' on' : '') + '" onclick="navigate(\'' + target + '\')">' + label + '</button>';
  return '<div class="biz-tabs">' + tab('overview', 'business', 'Overview') + tab('ideas', 'ideas', 'Ideas') + tab('contacts', 'contacts', 'Contacts') + '</div>';
}
function renderBusinessPage() {
  updateNavBadges();
  const ideas = state.data.ideas || [];
  const contacts = state.data.contacts || [];
  const today = todayStr();
  const openC = c => !['closed', 'dropped'].includes(c.status);
  const top = topIdea(ideas);
  const pv = pipelineValue(contacts);
  const dueCount = contacts.filter(c => openC(c) && c.followUpDate && c.followUpDate <= today).length;
  const cold = contacts.filter(c => isGoingCold(c, today));
  const warm = contacts.filter(c => c.status === 'warm' || c.status === 'closing').length;
  const activeIdeas = ideas.filter(i => i.status === 'active').length;
  const exploringIdeas = ideas.filter(i => i.status === 'exploring').length;
  const moneyOn = isPillarOn('money');
  const money = getMoneyPeriod() || { label: '', income: 0, spent: 0, net: 0, rate: 0 };

  // One smart headline — the single most useful next move
  let insight;
  if (!ideas.length && !contacts.length) insight = '🚀 Add your first idea or contact to start building your business pipeline.';
  else if (cold.length) insight = '❄️ ' + cold.length + ' lead' + (cold.length === 1 ? '' : 's') + ' going cold — reach out before they forget you.';
  else if (dueCount) insight = '📆 ' + dueCount + ' follow-up' + (dueCount === 1 ? '' : 's') + ' due — clear them today.';
  else if (top && top.nextStep) insight = '🎯 Move your strongest idea forward: ' + escapeHtml(top.nextStep);
  else insight = '✅ Pipeline looks healthy — keep the momentum going.';

  const card = (cls, inner, target) => '<button type="button" class="biz-card' + (cls ? ' ' + cls : '') + '" onclick="navigate(\'' + target + '\')">' + inner + '</button>';
  const grid =
    '<div class="biz-grid">' +
    card('', '<div class="biz-k">Sales pipeline</div><div class="biz-big">$' + pv.open.toLocaleString() + '</div><div class="biz-sub">$' + pv.weighted.toLocaleString() + ' expected · ' + warm + ' warm</div>', 'contacts') +
    card((cold.length || dueCount) ? 'biz-alert' : '', '<div class="biz-k">Reach out</div><div class="biz-big">' + (dueCount + cold.length) + '</div><div class="biz-sub">' + dueCount + ' due · ' + cold.length + ' going cold</div>', 'contacts') +
    (moneyOn ? card('', '<div class="biz-k">Money · ' + escapeHtml(money.label || 'this period') + '</div><div class="biz-big">$' + Math.round(money.net).toLocaleString() + '</div><div class="biz-sub">$' + Math.round(money.income).toLocaleString() + ' in · $' + Math.round(money.spent).toLocaleString() + ' out · ' + money.rate + '% saved</div>', 'log') : '') +
    card('', '<div class="biz-k">Ideas</div><div class="biz-big">' + ideas.length + '</div><div class="biz-sub">' + activeIdeas + ' active · ' + exploringIdeas + ' exploring</div>', 'ideas') +
    '</div>';

  const spotlight = top
    ? '<button type="button" class="biz-top" onclick="openIdea(\'' + top.id + '\')">' +
      '<div class="biz-k">🎯 Your strongest bet</div>' +
      '<div class="biz-top-title">' + escapeHtml(top.title) + ' <span>' + ideaScore(top.scores) + '</span></div>' +
      (top.nextStep ? '<div class="biz-sub">Next: ' + escapeHtml(top.nextStep) + '</div>' : '<div class="biz-sub biz-muted">Set its next step in the idea →</div>') +
      '</button>'
    : '';

  const reachList = contacts.filter(c => openC(c) && ((c.followUpDate && c.followUpDate <= today) || isGoingCold(c, today)))
    .sort((a, b) => (+b.dealValue || 0) - (+a.dealValue || 0)).slice(0, 5);
  const reach = reachList.length
    ? '<div class="biz-k" style="margin-top:20px">Who to contact next</div>' +
      '<div class="biz-reach">' + reachList.map(c => '<button type="button" class="biz-reach-row" onclick="navigate(\'contacts\')">' +
        '<span class="brr-name">' + escapeHtml(c.name) + '</span>' +
        '<span class="brr-meta">' + ((+c.dealValue) ? '$' + (+c.dealValue).toLocaleString() + ' · ' : '') + (isGoingCold(c, today) ? '❄️ going cold' : 'follow-up due') + '</span></button>').join('') + '</div>'
    : '';

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">Business</h2>' +
    '<p class="page-sub">Your ideas, pipeline and money — in one place.</p></div>' +
    businessTabs('overview') +
    '<div class="biz-insight">' + insight + '</div>' +
    grid + spotlight + reach;
}

// ── Contacts CRM intelligence (all pure/testable) ──
// A deal's chance of closing by pipeline stage — powers the weighted pipeline.
const CONTACT_STAGE_PROB = { new: 0.1, contacted: 0.25, warm: 0.5, closing: 0.8, closed: 1, dropped: 0 };
function stageProbability(status) { const p = CONTACT_STAGE_PROB[status]; return p == null ? 0.1 : p; }
// Open pipeline (sum of live deals), expected (weighted by stage), and won.
function pipelineValue(contacts) {
  let open = 0, weighted = 0, won = 0;
  for (const c of (Array.isArray(contacts) ? contacts : [])) {
    const v = Math.max(0, +(c && c.dealValue) || 0);
    if (!v) continue;
    if (c.status === 'closed') won += v;
    else if (c.status !== 'dropped') { open += v; weighted += v * stageProbability(c.status); }
  }
  return { open: Math.round(open), weighted: Math.round(weighted), won: Math.round(won) };
}
function daysBetween(a, b) { const t1 = Date.parse(a + 'T00:00:00Z'), t2 = Date.parse(b + 'T00:00:00Z'); return (isNaN(t1) || isNaN(t2)) ? 0 : Math.round((t2 - t1) / 86400000); }
function contactLastTouch(c) { return (c && (c.lastContact || c.addedDate)) || ''; }
// A live contact with no follow-up scheduled that you haven't talked to in a while.
function isGoingCold(c, today, coldDays) {
  coldDays = coldDays || 14;
  if (!c || ['closed', 'dropped'].includes(c.status)) return false;
  if (c.followUpDate) return false;                 // already has a follow-up planned
  const last = contactLastTouch(c);
  return !!last && daysBetween(last, today) >= coldDays;
}
async function logTouch(id) {
  const c = state.data.contacts.find(x => x.id === id); if (!c) return;
  c.lastContact = todayStr();
  await saveData();
  showToast('Logged — nice. Keep it warm.', 'success');
  renderContactsPage();
}
function onContactSearch(val) {
  state._contactSearch = val;
  renderContactsPage();
  const el = document.getElementById('contact-search');
  if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }   // keep focus, caret at end
}
function renderContactsPage() {
  updateNavBadges();
  const all = state.data.contacts || [];
  const today = todayStr();
  const q = (state._contactSearch || '').trim().toLowerCase();
  let contacts = all.slice().sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
  if (q) contacts = contacts.filter(c => [c.name, c.role, c.met, c.notes, c.phone, c.social, c.category, c.status].some(f => String(f || '').toLowerCase().includes(q)));
  const openC = c => !['closed', 'dropped'].includes(c.status);
  const overdue = contacts.filter(c => openC(c) && c.followUpDate && c.followUpDate < today);
  const dueToday= contacts.filter(c => openC(c) && c.followUpDate && c.followUpDate === today);
  const upcoming= contacts.filter(c => openC(c) && c.followUpDate && c.followUpDate > today);
  const cold     = contacts.filter(c => isGoingCold(c, today));
  const rest     = contacts.filter(c => openC(c) && !c.followUpDate && !isGoingCold(c, today));
  const closed   = contacts.filter(c => ['closed', 'dropped'].includes(c.status));

  const statusColors = { new: 'var(--text-muted)', contacted: 'var(--network-color)', warm: 'var(--warning)', closing: 'var(--accent)', closed: 'var(--success)', dropped: 'var(--danger)' };
  const catColors = { prospect: 'var(--money-color)', client: 'var(--success)', referral: 'var(--gym-color)', friend: 'var(--network-color)', partner: 'var(--accent)' };

  function contactCard(c) {
    const open = openC(c);
    const isOverdue = open && c.followUpDate && c.followUpDate < today;
    const isToday   = open && c.followUpDate && c.followUpDate === today;
    const cold = isGoingCold(c, today);
    const followUpBadge = isOverdue
      ? '<span class="fu-badge fu-overdue">Follow-up overdue</span>'
      : isToday
        ? '<span class="fu-badge fu-today">Follow up today</span>'
        : c.followUpDate
          ? '<span class="fu-badge fu-upcoming">Follow up ' + fmtDate(c.followUpDate) + '</span>'
          : cold ? '<span class="fu-badge fu-cold">❄️ Going cold</span>' : '';
    const sColor = statusColors[c.status] || 'var(--text-muted)', cColor = catColors[c.category] || 'var(--text-muted)';
    const statusStyle = 'background:' + sColor + '22;color:' + sColor + ';border:1px solid ' + sColor + '44';
    const catStyle = 'background:' + cColor + '22;color:' + cColor;
    const deal = Math.max(0, +c.dealValue || 0);
    const dealLine = deal ? '<div class="contact-deal">💰 $' + deal.toLocaleString() + (open ? ' <span>· ' + Math.round(stageProbability(c.status) * 100) + '% likely</span>' : '') + '</div>' : '';
    const last = contactLastTouch(c), d = last ? daysBetween(last, today) : null;
    const lastLine = (open && d != null) ? '<div class="contact-last' + (cold ? ' is-cold' : '') + '">Last talked ' + (d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago') + '</div>' : '';
    const tel = String(c.phone || '').replace(/[^\d+]/g, '');
    const phoneLink = c.phone ? '<a href="tel:' + escapeAttr(tel) + '" class="contact-link">📞 ' + escapeHtml(c.phone) + '</a>' : '';
    const s = String(c.social || '').trim();
    const socialUrl = s.startsWith('http') ? s : s.startsWith('@') ? ('https://instagram.com/' + s.slice(1)) : '';
    const socialLink = s ? (socialUrl ? '<a href="' + escapeAttr(socialUrl) + '" target="_blank" rel="noopener" class="contact-link">' + escapeHtml(s) + '</a>' : '<span class="contact-link">' + escapeHtml(s) + '</span>') : '';
    return '<div class="contact-card' + (isOverdue ? ' contact-overdue' : isToday ? ' contact-today' : cold ? ' contact-cold' : '') + (c.starred ? ' contact-starred' : '') + '">' +
      '<div class="contact-top">' +
      '<div class="contact-name">' +
      '<button class="star-btn' + (c.starred ? ' starred' : '') + '" onclick="toggleStar(\'' + c.id + '\')" title="' + (c.starred ? 'Unpin contact' : 'Pin contact') + '">' + (c.starred ? '★' : '☆') + '</button>' +
      escapeHtml(c.name) + '</div>' +
      '<div class="contact-badges">' +
      '<span class="contact-badge" style="' + catStyle + '">' + escapeHtml(c.category || 'contact') + '</span>' +
      '<span class="contact-badge" style="' + statusStyle + '">' + escapeHtml(c.status || 'new') + '</span>' +
      '</div>' +
      '</div>' +
      (c.role ? '<div class="contact-role">' + escapeHtml(c.role) + '</div>' : '') +
      (c.met  ? '<div class="contact-met">' + escapeHtml(c.met) + '</div>' : '') +
      ((phoneLink || socialLink) ? '<div class="contact-info">' + phoneLink + (phoneLink && socialLink ? ' · ' : '') + socialLink + '</div>' : '') +
      dealLine + lastLine +
      (c.notes ? '<div class="contact-notes">' + escapeHtml(c.notes) + '</div>' : '') +
      followUpBadge +
      '<div class="contact-actions">' +
      (open ? '<button class="btn-sm btn-touch" onclick="logTouch(\'' + c.id + '\')">✓ Reached out</button>' : '') +
      (c.status !== 'closed' ? '<select class="contact-status-select" onchange="updateContactStatus(\'' + c.id + '\',this.value)">' +
        ['new','contacted','warm','closing','closed','dropped'].map(st =>
          '<option value="' + st + '"' + (c.status === st ? ' selected' : '') + '>' + st.charAt(0).toUpperCase() + st.slice(1) + '</option>'
        ).join('') + '</select>' : '') +
      '<button class="btn-sm" onclick="showSetFollowUp(\'' + c.id + '\')">Follow-up</button>' +
      '<button class="btn-sm" onclick="editContact(\'' + c.id + '\')">Edit</button>' +
      '<button class="btn-sm btn-sm-danger" onclick="deleteContact(\'' + c.id + '\')">Delete</button>' +
      '</div></div>';
  }

  const section = (title, list, cls) => list.length === 0 ? '' :
    '<div class="contacts-section-title' + (cls ? ' ' + cls : '') + '">' + title + ' <span>(' + list.length + ')</span></div>' +
    '<div class="contacts-grid">' + list.map(contactCard).join('') + '</div>';

  // Stats bar — now money-aware: open pipeline + expected (stage-weighted) value
  const pv = pipelineValue(all);
  const dueCount = all.filter(c => openC(c) && c.followUpDate && c.followUpDate <= today).length;
  const statsBar = all.length > 0
    ? '<div class="contacts-stats">' +
      '<div class="cs-item"><span>Contacts</span><strong>' + all.length + '</strong></div>' +
      '<div class="cs-item"><span>Due now</span><strong style="color:' + (dueCount > 0 ? 'var(--danger)' : 'var(--success)') + '">' + dueCount + '</strong></div>' +
      '<div class="cs-item" title="Total value of all live deals"><span>Pipeline</span><strong>$' + pv.open.toLocaleString() + '</strong></div>' +
      '<div class="cs-item" title="Deal values weighted by how likely each stage is to close"><span>Expected</span><strong style="color:var(--accent)">$' + pv.weighted.toLocaleString() + '</strong></div>' +
      (pv.won ? '<div class="cs-item"><span>Won</span><strong style="color:var(--success)">$' + pv.won.toLocaleString() + '</strong></div>' : '') +
      '</div>'
    : '';
  const searchBar = all.length > 0
    ? '<input type="search" id="contact-search" class="contact-search" placeholder="Search name, role, status…" value="' + escapeAttr(state._contactSearch || '') + '" oninput="onContactSearch(this.value)">'
    : '';

  // Add contact form
  const addForm =
    '<div class="card" id="add-contact-wrap">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
    '<h3 class="card-title" style="margin-bottom:0">Add Contact</h3>' +
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
    '<select id="c-cat"><option value="prospect">Prospect</option><option value="referral">Referral source</option><option value="client">Client</option><option value="partner">Partner</option><option value="friend">Friend</option></select>' +
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
    '<p class="page-sub">Your network is your pipeline. Nurture it — never let a warm lead go cold.</p></div>' +
    businessTabs('contacts') +
    statsBar + searchBar + addForm +
    (all.length === 0
      ? '<div class="empty-state small"><p>No contacts yet. Add your first one above — start with someone you met this week.</p></div>'
      : (contacts.length === 0
          ? '<div class="empty-state small"><p>No contacts match “' + escapeHtml(q) + '”.</p></div>'
          : section('⏰ Overdue follow-ups', overdue, 'cst-danger') +
            section('📆 Follow up today', dueToday, 'cst-today') +
            section('❄️ Going cold — reach out', cold, 'cst-danger') +
            section('Upcoming follow-ups', upcoming, '') +
            section('Other contacts', rest, '') +
            section('Closed / dropped', closed, 'cst-muted')));
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
  showToast(name + ' added to contacts! ', 'success');
  renderContactsPage();
}

async function updateContactStatus(id, status) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!c) return;
  c.status = status;
  if (['contacted', 'warm', 'closing', 'closed'].includes(status)) c.lastContact = todayStr();   // moving a deal forward is a touch
  await saveData();
  updateNavBadges();
  if (status === 'closed') showToast('Marked as client! Great work!', 'success');
  else showToast('Status updated.', 'success');
  renderContactsPage();
}

function showSetFollowUp(id) {
  const c = state.data.contacts.find(x => x.id === id);
  if (!c) return;
  document.getElementById('fup-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'fup-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:340px;text-align:left">
    <div class="modal-badge">Set Follow-Up Date</div>
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
  showToast('Follow-up set for ' + fmtDate(date) + ' ', 'success');
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
    showToast(c.name + ' updated ', 'success');
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
      '<div class="hs-item"><span>Gym Workouts</span><strong>' + gymTotal + ' days </strong></div>' +
      '<div class="hs-item"><span>Avg Food Rating</span><strong>' + (foodAvg > 0 ? foodAvg.toFixed(1) + '/5 ' : '—') + '</strong></div>' +
      '<div class="hs-item"><span>Total Connections</span><strong>' + netTotal + ' </strong></div>' +
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
    '<button class="view-btn' + (view==='list'?' view-active':'') + '" onclick="switchHistoryView(\'list\')">List</button>' +
    '<button class="view-btn' + (view==='calendar'?' view-active':'') + '" onclick="switchHistoryView(\'calendar\')">Calendar</button>' +
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
      ? '<span class="pill pill-gym">' + (d.gym.muscleGroup ? d.gym.muscleGroup.charAt(0).toUpperCase() + d.gym.muscleGroup.slice(1) : 'Workout') + '</span>'
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
      '<td data-label="Date"><strong>' + fmtDate(d.date) + '</strong>' + noteCell + '</td>' +
      '<td data-label="' + escapeHtml(pillar('gym').label) + '">' + gymCell + '</td>' +
      '<td data-label="' + escapeHtml(pillar('food').label) + '">' + foodCell + '</td>' +
      '<td data-label="' + escapeHtml(pillar('networking').label) + '">' + netCell + '</td>' +
      '<td data-label="' + escapeHtml(pillar('money').label) + '">' + moneyCell + '</td>' +
      '<td class="action-cell">' +
      '<button class="btn-sm" onclick="editDay(\'' + d.id + '\')">Edit</button>' +
      '<button class="btn-sm btn-sm-danger" onclick="deleteDay(\'' + d.id + '\')"></button>' +
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
    ? '<div class="api-key-banner"><span class="api-key-icon"></span><div style="flex:1">' +
      '<h3>Connect an AI model to unlock your coach</h3>' +
      '<p style="margin-bottom:4px">Bring your own key — works with Claude, OpenAI (GPT), Gemini, or any OpenAI-compatible API.</p>' +
      apiKeyFields() + '</div></div>'
    : '<div style="background:var(--success-bg);border:1px solid #b8e0cc;border-radius:var(--radius-sm);padding:10px 16px;margin-bottom:20px;font-size:13px;color:var(--success);display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      '<span>AI Coach is ready' + (aiKey() ? ' · <span style="font-family:monospace;color:var(--text-muted)">' + escapeHtml(maskKey(aiKey())) + '</span>' : ' · using the server key') + '</span>' +
      '<button onclick="clearApiKey()" style="background:none;border:none;font-size:12px;color:var(--text-muted);cursor:pointer;flex:none">Change key</button></div>';

  const cards = ANALYSES.map(a =>
    '<div class="insight-card card">' +
    '<div class="insight-card-header"><span class="insight-icon">' + a.icon + '</span><div>' +
    '<h3>' + a.title + '</h3><p>' + a.desc + '</p></div></div>' +
    '<button class="btn btn-primary" id="btn-' + a.id + '" onclick="runAnalysis(\'' + a.id + '\')"' + (!state.hasApiKey ? ' disabled' : '') + '>Ask Coach</button>' +
    '<div class="insight-result hidden" id="result-' + a.id + '"></div>' +
    '</div>'
  ).join('');

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">AI Coach</h2>' +
    '<p class="page-sub">Your personal life & income coach — powered by the AI you connect</p></div>' +
    keyBanner +
    '<div class="insights-grid">' + cards + '</div>' +
    '<div class="card coach-chat-card">' +
    '<h3 class="card-title">Chat with your coach</h3>' +
    '<p class="card-sub">It knows all your data and your goal. Ask anything — "what should I eat tonight to hit my macros?", "am I on track for my goal?", "why is my income inconsistent?"</p>' +
    '<div id="coach-thread" class="coach-thread">' + renderChatThread() + '</div>' +
    '<div class="coach-input-row">' +
    '<textarea id="chat-input" rows="1" placeholder="Message your coach…"' + (!state.hasApiKey ? ' disabled' : '') + ' onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendChat();}"></textarea>' +
    '<button class="btn btn-primary" onclick="sendChat()"' + (!state.hasApiKey ? ' disabled' : '') + '>Send</button>' +
    '</div></div>';
}

// ── Conversational coach (chat thread, in-memory) ──
function renderChatThread() {
  const chat = state._chat || [];
  if (!chat.length && !state._chatBusy) {
    return '<div class="coach-empty">Your coach has all your numbers and your goal. Ask it anything to get started.</div>';
  }
  return chat.map(m => '<div class="chat-msg ' + (m.role === 'user' ? 'chat-user' : 'chat-bot') + '">' +
    (m.role === 'user' ? escapeHtml(m.content) : renderMarkdown(m.content)) + '</div>').join('') +
    (state._chatBusy ? '<div class="chat-msg chat-bot chat-typing"><span></span><span></span><span></span></div>' : '');
}
function refreshChatThread() {
  const el = document.getElementById('coach-thread');
  if (el) { el.innerHTML = renderChatThread(); el.scrollTop = el.scrollHeight; }
}
async function sendChat() {
  const inp = document.getElementById('chat-input');
  const text = (inp && inp.value || '').trim();
  if (!text || state._chatBusy) return;
  if (!state.hasApiKey) { showToast('Add your AI key in Settings to chat.', 'error'); return; }
  state._chat = state._chat || [];
  state._chat.push({ role: 'user', content: text });
  if (inp) inp.value = '';
  state._chatBusy = true;
  refreshChatThread();
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ messages: state._chat, data: enrichedData() }) });
    const j = await res.json().catch(() => ({}));
    state._chatBusy = false;
    if (!res.ok) state._chat.push({ role: 'assistant', content: j.error === 'NO_KEY' ? 'Add your AI key in Settings to chat with your coach.' : (j.error || 'Something went wrong — try again.') });
    else state._chat.push({ role: 'assistant', content: j.reply || 'Hmm — try rephrasing that.' });
  } catch {
    state._chatBusy = false;
    state._chat.push({ role: 'assistant', content: 'Could not reach your coach — check your connection.' });
  }
  refreshChatThread();
}

// ─────────────────────────────────────────────────────────────
// STREAMING AI HELPER
// ─────────────────────────────────────────────────────────────
async function streamAnalysis(question, resultEl, btn, btnText) {
  btn.disabled = true;
  btn.textContent = 'Streaming…';
  resultEl.className = 'insight-result stream-active';
  resultEl.innerHTML = '<div class="stream-output"></div><span class="stream-cursor"></span>';
  const outputEl = resultEl.querySelector('.stream-output');
  let fullText = '';

  try {
    const resp = await fetch('/api/analyze-stream', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ data: enrichedData(), question })
    });

    if (!resp.ok) {
      const j = await resp.json().catch(() => ({ error: 'Request failed' }));
      resultEl.className = 'insight-result error';
      resultEl.innerHTML = '<p class="error-msg">' + (j.error === 'NO_KEY' ? 'No API key — add one in Settings.' : (j.error || 'Request failed')) + '</p>';
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
            resultEl.innerHTML = '<p class="error-msg">' + (json.error === 'NO_KEY' ? 'No API key — add one in Settings.' : json.error) + '</p>';
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
    resultEl.innerHTML = '<p class="error-msg">Connection error.</p>';
  } finally {
    btn.disabled = false; btn.textContent = btnText;
  }
}

async function runAnalysis(type) {
  const a = ANALYSES.find(x => x.id === type);
  if (!a) return;
  const btn = document.getElementById('btn-' + type);
  const res = document.getElementById('result-' + type);
  await streamAnalysis(a.prompt(), res, btn, 'Ask Coach');
}

async function runCustomAnalysis() {
  const q = document.getElementById('custom-question').value.trim();
  if (!q) { showToast('Type your question first.', 'error'); return; }
  const res = document.getElementById('result-custom');
  const btn = document.querySelector('.custom-question-card .btn');
  await streamAnalysis(q, res, btn, 'Ask Coach');
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
    nutritionTargets: nut ? {
      calories: nut.calories, proteinG: nut.protein.g, carbsG: nut.carbs.g, fatG: nut.fat.g,
      goal: nut.goal, strategy: nut.strategy, mealsPerDay: nut.meals.count,
      // per-meal targets (breakfast ~28%, lunch ~38%, dinner ~34%) + what to put on the plate
      mealPlan: (nut.meals.plan || []).map(m => ({ meal: m.label, calories: m.calories, proteinG: m.protein, carbsG: m.carbs, fatG: m.fat, plate: mealPlateHint(m.label) }))
    } : null,
    mealsEatenToday: groupFoodsByMeal(state.data.days.find(d => d.date === todayStr())?.foodLog || [])
      .map(g => ({ meal: g.label, calories: g.kcal, proteinG: g.p, foods: g.foods.map(f => f.name) })),
    // gym training plan recommended for their goal + weight
    trainingPlan: (isPillarOn('gym') && nut && nut.goal) ? (() => { const gp = gymPlan(nut.goal, state.data.profile?.nutrition?.weightKg); return { goal: gp.goal, frequency: gp.days, split: gp.split, strength: gp.strength, cardio: gp.cardio, cardioBurnPer30min: gp.cardioBurn30 }; })() : null,
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
    '<button type="submit" class="btn btn-primary btn-lg">Save Goals</button>' +
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
  showToast('Saved! ', 'success');
  navigate('dashboard');
}

// ─────────────────────────────────────────────────────────────
// API KEY
// ─────────────────────────────────────────────────────────────
// The BYO-key form: provider selector + key (+ base/model for custom providers).
// Reused by the Coach page and Settings so they stay in sync.
function apiKeyFields() {
  const prov = aiProvider();
  const opt = (v, label) => '<option value="' + v + '"' + (prov === v ? ' selected' : '') + '>' + label + '</option>';
  return '<div class="ak-form">' +
    '<label class="ak-label">AI provider</label>' +
    '<select id="ai-provider" class="ak-input" onchange="onProviderChange()">' +
    opt('auto', 'Auto-detect from key') + opt('anthropic', 'Anthropic — Claude') + opt('openai', 'OpenAI — GPT') +
    opt('google', 'Google — Gemini') + opt('other', 'Other (OpenAI-compatible)') + '</select>' +
    '<div id="ai-advanced" class="ak-advanced"' + (prov === 'other' ? '' : ' style="display:none"') + '>' +
    '<label class="ak-label">API base URL</label>' +
    '<input type="text" id="ai-base" class="ak-input" placeholder="https://openrouter.ai/api/v1" value="' + escapeAttr(aiBase()) + '">' +
    '<label class="ak-label">Model</label>' +
    '<input type="text" id="ai-model" class="ak-input" placeholder="e.g. meta-llama/llama-3.1-70b-instruct" value="' + escapeAttr(aiModel()) + '">' +
    '</div>' +
    '<label class="ak-label">API key</label>' +
    '<div class="ak-row">' +
    '<input type="password" id="api-key-input" class="ak-input ak-key" placeholder="' + providerKeyHint(prov) + '" autocomplete="off" spellcheck="false">' +
    '<button type="button" class="btn btn-primary" onclick="saveApiKey()">Save</button></div>' +
    '<p class="ak-hint" id="ak-hint">' + providerHint(prov) + '</p>' +
    '</div>';
}
function providerKeyHint(prov) {
  return { auto: 'Paste your API key…', anthropic: 'sk-ant-api03-…', openai: 'sk-…', google: 'AIza…', other: 'your API key' }[prov] || 'Paste your API key…';
}
function providerHint(prov) {
  const map = {
    anthropic: 'Get a key at <b>console.anthropic.com</b> → API Keys.',
    openai: 'Get a key at <b>platform.openai.com</b> → API keys.',
    google: 'Get a key at <b>aistudio.google.com</b> → Get API key.',
    other: 'Works with any OpenAI-compatible API — OpenRouter, Groq, Together, a local model… Set the base URL + model above.',
    auto: 'Works with Claude, OpenAI (GPT) or Gemini — we detect the provider from your key.'
  };
  return (map[prov] || map.auto) + ' Stored only on this device.';
}
function onProviderChange() {
  const prov = document.getElementById('ai-provider')?.value || 'auto';
  const adv = document.getElementById('ai-advanced'); if (adv) adv.style.display = prov === 'other' ? '' : 'none';
  const hint = document.getElementById('ak-hint'); if (hint) hint.innerHTML = providerHint(prov);
  const inp = document.getElementById('api-key-input'); if (inp) inp.placeholder = providerKeyHint(prov);
}
async function saveApiKey() {
  const k = (document.getElementById('api-key-input')?.value || '').trim();
  if (!k) { showToast('Paste your API key first.', 'error'); return; }
  const prov = document.getElementById('ai-provider')?.value || 'auto';
  const base = (document.getElementById('ai-base')?.value || '').trim();
  const model = (document.getElementById('ai-model')?.value || '').trim();
  if (prov === 'anthropic' && !k.startsWith('sk-ant-')) { showToast('Anthropic keys start with sk-ant-', 'error'); return; }
  if (prov === 'google' && !k.startsWith('AIza')) { showToast('Google keys usually start with AIza', 'error'); return; }
  if (prov === 'other' && !base) { showToast('Add the API base URL for a custom provider.', 'error'); return; }
  try {
    localStorage.setItem('onward_ai_key', k);
    localStorage.setItem('onward_ai_provider', prov);
    localStorage.setItem('onward_ai_model', model);
    localStorage.setItem('onward_ai_base', base);
  } catch {}
  state.hasApiKey = true;
  showToast('AI Coach unlocked!', 'success');
  if (state.page === 'settings') renderSettingsPage(); else renderCoachPage();
}

async function clearApiKey() {
  if (!confirm('Remove your API key?')) return;
  try { ['onward_ai_key', 'onward_ai_provider', 'onward_ai_model', 'onward_ai_base'].forEach(x => localStorage.removeItem(x)); } catch {}
  state.hasApiKey = false;
  showToast('Key removed.', 'success');
  if (state.page === 'settings') renderSettingsPage(); else renderCoachPage();
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
  buildScene3d();
  state._previewMode = true;
  state.token = null;
  state.user = 'Demo';
  state.data = buildDemoData();
  try { const ks = await fetch('/api/settings').then(r => r.json()); state.hasApiKey = !!ks.hasKey; } catch { state.hasApiKey = false; }
  document.getElementById('auth-screen')?.remove();
  document.body.classList.remove('auth-active');
  wireNav();
  applyNavVisibility();
  injectFAB();
  navigate('dashboard');
  if (!document.getElementById('preview-banner')) {
    const b = document.createElement('div');
    b.id = 'preview-banner';
    b.innerHTML = '<strong>Demo preview</strong> — sample data, nothing is saved. ' +
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
  // Redundant during the guided log and distracting in the immersive workout — skip it there
  if (state.page === 'log' || state.page === 'workout') return;
  const fab = document.createElement('button');
  fab.className = 'fab-btn';
  fab.innerHTML = '＋';
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
    '<div class="modal-badge">Quick Log — Today, ' + new Date().toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'}) + '</div>' +
    (streak > 1 ? '<div class="ql-streak">' + streak + '-day streak — keep it going!</div>' : '') +
    renderPrevNoteBanner() +
    (smartFilled ? '<div class="ql-smart">Smart-filled from your recent days — tweak anything, then Save.</div>' : '') +

    (isPillarOn('gym') ?
    '<div class="ql-section">' +
    '<div class="ql-label">' + gymP.icon + ' ' + escapeHtml(gymP.label) + ' today?</div>' +
    '<div class="ql-gym-row">' +
    '<button type="button" class="ql-gym-btn' + (existing?.gym?.done===true?' ql-active-yes':'') + '" id="ql-gym-yes" onclick="qlSetGym(true)">' + (gymIsDefault ? 'Yes, I worked out' : 'Yes, did it') + '</button>' +
    '<button type="button" class="ql-gym-btn' + (existing?.gym?.done===false?' ql-active-no':'') + '" id="ql-gym-no"  onclick="qlSetGym(false)">' + (gymIsDefault ? 'Rest day' : 'Not today') + '</button>' +
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
    '<div class="ql-label">Spent today — $</div>' +
    '<input type="number" id="ql-spent" class="ql-input" min="0" step="0.01" placeholder="0" value="' + ((existing && existing.spent) || '') + '">' +
    '</div>' : '') +

    '<div class="ql-section">' +
    '<div class="ql-label">Water — gallons today</div>' +
    '<input type="number" id="ql-water" class="ql-input" min="0" step="0.25" placeholder="e.g. 0.5" value="' + waterVal + '">' +
    '</div>' +

    (getNutrition() ?
    '<div class="ql-section">' +
    mealNowHint() +
    '<div class="ql-label">Calories eaten today <span style="font-weight:400;color:var(--text-muted)">(target ' + getNutrition().calories.toLocaleString() + ')</span></div>' +
    '<input type="number" id="ql-calories" class="ql-input" min="0" step="10" placeholder="e.g. 2200" value="' + (existing?.calories || '') + '">' +
    '</div>' : '') +

    '<div class="ql-section">' +
    '<div class="ql-label">Weigh-in <span style="font-weight:400;color:var(--text-muted)">(' + weightUnitPref() + ', optional)</span></div>' +
    '<input type="number" id="ql-weigh" class="ql-input" min="0" step="0.1" placeholder="' + (weightUnitPref()==='lbs'?'170':'77') + '" value="' + weighVal + '">' +
    '</div>' +

    '<div class="ql-actions">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'quick-log-overlay\').remove()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="submitQuickLog()">Save Log</button>' +
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

  showToast('Logged! ', 'success');
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
// A book cover: the resolved image if we have one, else a lettered placeholder.
function bookCoverHtml(b, cls) {
  const letter = escapeHtml(((b.title || '?').trim().charAt(0) || '?').toUpperCase());
  const img = b.cover ? '<img src="' + escapeAttr(b.cover) + '" alt="' + escapeAttr(b.title) + ' cover" loading="lazy" onerror="this.remove()">' : '';
  return '<div class="book-cover ' + (cls || '') + '" data-letter="' + letter + '">' + img + '</div>';
}
// Resolve missing covers from the free Open Library API (cached per book).
async function ensureBookCovers() {
  const pending = (state.data.books || []).filter(b => b.cover === undefined && b.title);
  if (!pending.length) return;
  let changed = false;
  for (const b of pending) {
    try {
      const q = 'title=' + encodeURIComponent(b.title) + (b.author ? '&author=' + encodeURIComponent(b.author) : '');
      const res = await fetch('https://openlibrary.org/search.json?' + q + '&limit=1&fields=cover_i');
      const j = await res.json();
      const id = j && j.docs && j.docs[0] && j.docs[0].cover_i;
      b.cover = id ? 'https://covers.openlibrary.org/b/id/' + id + '-M.jpg' : '';
    } catch { b.cover = ''; }
    changed = true;
  }
  if (changed) { saveData(); if (state.page === 'reading' || state.page === 'knowledge') renderKnowledgePage(); }
}
// ── Vocabulary — capture words from books, their meaning, then use each in a
// sentence. Active recall beats passive highlighting. ──
function vocabStats(vocab) {
  const list = Array.isArray(vocab) ? vocab : [];
  const practiced = list.filter(w => w.sentence && w.sentence.trim()).length;
  return { total: list.length, practiced, needSentence: list.length - practiced };
}
function renderVocabCard() {
  const vocab = state.data.vocab || [];
  const s = vocabStats(vocab);
  const form =
    '<div class="vocab-form">' +
    '<input type="text" id="vocab-word" class="vocab-input" placeholder="New word" maxlength="60" autocomplete="off">' +
    '<input type="text" id="vocab-meaning" class="vocab-input" placeholder="What it means" maxlength="240" autocomplete="off">' +
    '<input type="text" id="vocab-context" class="vocab-input" placeholder="The sentence you found it in (optional — context makes it stick)" maxlength="300" autocomplete="off">' +
    '<div class="vocab-form-row">' +
    '<input type="text" id="vocab-book" class="vocab-input" placeholder="From which book? (optional)" maxlength="80" autocomplete="off">' +
    '<input type="text" id="vocab-page" class="vocab-input vocab-page" inputmode="numeric" placeholder="Page" maxlength="6" autocomplete="off">' +
    '</div>' +
    '<button class="btn btn-primary" onclick="addVocabWord()">Add word</button>' +
    '</div>';
  const list = vocab.length
    ? '<div class="vocab-list">' + [...vocab].reverse().map(w => {
      const hasS = w.sentence && w.sentence.trim();
      const hasCtx = w.context && w.context.trim();
      return '<div class="vocab-item">' +
        '<div class="vocab-top"><span class="vocab-word">' + escapeHtml(w.word) + '</span>' +
        (w.book ? '<span class="vocab-bk">' + escapeHtml(w.book) + '</span>' : '') +
        (w.page ? '<span class="vocab-pg">p.' + escapeHtml(String(w.page)) + '</span>' : '') +
        '<button class="vocab-x" title="Remove" onclick="deleteVocabWord(\'' + w.id + '\')">✕</button></div>' +
        (w.meaning ? '<div class="vocab-mean">' + escapeHtml(w.meaning) + '</div>' : '') +
        (hasCtx ? '<div class="vocab-context">“' + escapeHtml(w.context.trim()) + '”</div>' : '') +
        (hasS
          ? '<div class="vocab-sentence">“' + escapeHtml(w.sentence) + '” <span class="vocab-done">✓ used it</span></div>'
          : '<div class="vocab-ask"><div class="vocab-ask-q">Can you use <b>' + escapeHtml(w.word) + '</b> in a sentence?</div>' +
            '<div class="vocab-ask-row"><input type="text" id="vs-' + w.id + '" class="vocab-input" placeholder="Write your sentence…" maxlength="240" onkeydown="if(event.key===\'Enter\'){saveVocabSentence(\'' + w.id + '\')}">' +
            '<button class="btn-sm" onclick="saveVocabSentence(\'' + w.id + '\')">Save</button></div></div>') +
        '</div>';
    }).join('') + '</div>'
    : '<div class="my-meals-empty">No words yet — add one you picked up from a book, with the sentence you found it in.</div>';
  return '<div class="card vocab-card">' +
    '<h3 class="card-title">Words I\'m learning</h3>' +
    '<p class="card-sub">Capture a new word with the sentence you met it in — seeing it in context is what makes it stick — then put it to work in your own sentence.' +
    (s.total ? ' · <b>' + s.total + '</b> word' + (s.total === 1 ? '' : 's') + ' · <b>' + s.practiced + '</b> used in a sentence' : '') + '</p>' +
    form + list +
    '<label class="vocab-remind"><input type="checkbox" onchange="toggleVocabNudge(this)"' + (state.data.profile && state.data.profile.vocabNudge !== false ? ' checked' : '') + '> Surprise me with a word to practice — send me a notification to use one in a sentence</label>' +
    '</div>';
}
async function toggleVocabNudge(el) {
  if (!state.data.profile) state.data.profile = {};
  state.data.profile.vocabNudge = !!el.checked;
  await saveData();
  showToast(el.checked ? 'On — we\'ll surprise you with a word to practice.' : 'Off — no practice reminders.', 'success');
}
async function addVocabWord() {
  const word = (document.getElementById('vocab-word')?.value || '').trim();
  const meaning = (document.getElementById('vocab-meaning')?.value || '').trim();
  const book = (document.getElementById('vocab-book')?.value || '').trim();
  const context = (document.getElementById('vocab-context')?.value || '').trim();
  const pageRaw = (document.getElementById('vocab-page')?.value || '').trim();
  const page = pageRaw ? (parseInt(pageRaw, 10) || '') : '';
  if (!word) { showToast('Type the word first.', 'error'); return; }
  if (!state.data.vocab) state.data.vocab = [];
  state.data.vocab.push({ id: uid(), word, meaning, book, page, context, sentence: '', createdAt: todayStr() });
  await saveData();
  showToast('Added “' + word + '” — now use it in a sentence!', 'success');
  renderKnowledgePage();
}
async function saveVocabSentence(id) {
  const el = document.getElementById('vs-' + id);
  const sentence = ((el && el.value) || '').trim();
  if (!sentence) { showToast('Write a sentence using the word.', 'error'); return; }
  const w = (state.data.vocab || []).find(x => x.id === id);
  if (!w) return;
  w.sentence = sentence;
  await saveData();
  showToast('Nice — you used “' + w.word + '”.', 'success');
  renderKnowledgePage();
}
async function deleteVocabWord(id) {
  if (!confirm('Remove this word?')) return;
  state.data.vocab = (state.data.vocab || []).filter(x => x.id !== id);
  await saveData();
  renderKnowledgePage();
}
function readingBody() {
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

  const booksByTitle = {};
  (state.data.books || []).forEach(b => { booksByTitle[b.title] = b; });
  const noteGroups = groupReadingByBook(state.data.days);

  const statsBar = readingDays.length > 0
    ? '<div class="reading-stats">' +
      '<div class="rs-item"><span>Total Pages</span><strong>' + totalPages.toLocaleString() + '</strong></div>' +
      '<div class="rs-item"><span>Days Read</span><strong>' + readingDays.length + '</strong></div>' +
      '<div class="rs-item"><span>Avg / Day</span><strong>' + avgPages + ' pages</strong></div>' +
      '<div class="rs-item"><span>Streak</span><strong>' + (streak > 0 ? streak + ' days' : '—') + '</strong></div>' +
      '</div>'
    : '';

  const bookCard = activeBook
    ? '<div class="card reading-book-card">' +
      '<div class="rbc-header">' +
      bookCoverHtml(activeBook, 'bc-lg') +
      '<div class="rbc-info">' +
      '<div class="rbc-label">Currently Reading</div>' +
      '<div class="rbc-title">' + escapeHtml(activeBook.title) + '</div>' +
      (activeBook.author ? '<div class="rbc-author">by ' + escapeHtml(activeBook.author) + '</div>' : '') +
      '</div>' +
      '<div class="rbc-actions">' +
      '<button class="btn-sm" onclick="showAddBookModal(true)">Change Book</button>' +
      '<button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="finishBook(\'' + activeBook.id + '\')">I Finished It!</button>' +
      '</div></div>' +
      '<div class="rbc-progress">' +
      '<div class="rbc-progress-top">' +
      '<span>' + bookPagesRead.toLocaleString() + ' pages read' + (activeBook.totalPages ? ' of ' + activeBook.totalPages.toLocaleString() : '') + '</span>' +
      (bookPct !== null ? '<span style="font-weight:800;color:var(--read-color);font-size:15px">' + bookPct + '%</span>' : '') +
      '</div>' +
      (bookPct !== null ? '<div class="rbc-bar-track"><div class="rbc-bar-fill" style="width:' + bookPct + '%"></div></div>' : '') +
      '</div></div>'
    : '<div class="card reading-start-card">' +
      '<div class="rsc-icon"></div>' +
      '<h3>What are you reading?</h3>' +
      '<p>Set your current book to track pages, build a reading streak, and get AI insights on your reading habit.</p>' +
      '<button class="btn btn-primary" onclick="showAddBookModal(false)">Set My Current Book</button>' +
      '</div>';

  const historyCard = noteGroups.length > 0
    ? '<div class="card">' +
      '<h3 class="card-title">Reading Notes</h3>' +
      '<p class="muted" style="font-size:13px;margin:-4px 0 14px">Grouped by book — tap a title to show or hide its notes.</p>' +
      noteGroups.map(g => {
        const collapsed = _collapsedBookNotes.has(g.title);
        return '<div class="rlog-group' + (collapsed ? ' collapsed' : '') + '" data-key="' + escapeAttr(g.title) + '">' +
          '<button type="button" class="rlog-book-head" onclick="toggleBookNotes(this)">' +
          bookCoverHtml(booksByTitle[g.title] || { title: g.title }, 'bc-sm') +
          '<span class="rlog-book-meta">' +
          '<span class="rlog-book-name">' + escapeHtml(g.title) + '</span>' +
          '<span class="rlog-book-sub">' + g.entries.length + ' session' + (g.entries.length > 1 ? 's' : '') + ' · ' + g.pages.toLocaleString() + ' pages' + (g.notes ? ' · ' + g.notes + ' note' + (g.notes > 1 ? 's' : '') : '') + '</span>' +
          '</span>' +
          '<span class="rlog-chev">›</span>' +
          '</button>' +
          '<div class="rlog-book-body">' +
          g.entries.map(d =>
            '<div class="rlog-entry">' +
            '<div class="rlog-entry-top"><span class="rlog-date">' + fmtDate(d.date) + '</span><span class="pill pill-read">+' + d.reading.pages + ' pg</span></div>' +
            ((d.reading.summary || '').trim() ? '<div class="rlog-note">' + escapeHtml(d.reading.summary.trim()) + '</div>' : '') +
            '</div>'
          ).join('') +
          '</div>' +
          '</div>';
      }).join('') +
      '</div>'
    : '';

  const finishedCard = finished.length > 0
    ? '<div class="card">' +
      '<h3 class="card-title">Books Finished (' + finished.length + ')</h3>' +
      '<div class="finished-books-grid">' +
      finished.map(b =>
        '<div class="finished-book">' +
        bookCoverHtml(b, 'bc-sm') +
        '<div><div class="fb-title">' + escapeHtml(b.title) + '</div>' +
        (b.author ? '<div class="fb-date" style="color:var(--text-muted);font-size:12px">' + escapeHtml(b.author) + '</div>' : '') +
        (b.totalPages ? '<div class="fb-date">' + b.totalPages + ' pages</div>' : '') +
        (b.finishedDate ? '<div class="fb-date">' + fmtDate(b.finishedDate) + '</div>' : '') +
        '</div></div>'
      ).join('') +
      '</div></div>'
    : '';

  return statsBar + bookCard + renderTakeawaysCard() + historyCard + finishedCard;
}

// ---- Knowledge hub (Reading + Vocabulary) ----------------------------------
function knowledgeTabs(active) {
  const tab = (id, label) =>
    '<button type="button" class="biz-tab' + (active === id ? ' on' : '') +
    '" onclick="setKnowledgeTab(\'' + id + '\')">' + label + '</button>';
  return '<div class="biz-tabs">' +
    tab('overview', 'Overview') + tab('reading', 'Reading') + tab('vocabulary', 'Vocabulary') +
    '</div>';
}
function setKnowledgeTab(t) { state._knowledgeTab = t; renderKnowledgePage(); }

function renderKnowledgeOverview() {
  const stats    = getWeekStats();
  const books    = state.data.books || [];
  const active   = books.find(b => b.status === 'reading');
  const finished = books.filter(b => b.status === 'finished').length;
  const streak   = getReadingStreak();
  const vs       = vocabStats(state.data.vocab || []);
  const readPages = stats.readPages || 0;

  let bookPct = null, bookTitle = '', bookPagesRead = 0;
  if (active) {
    bookTitle = active.title;
    bookPagesRead = state.data.days.filter(d => d.reading?.bookId === active.id)
      .reduce((s, d) => s + (d.reading?.pages || 0), 0);
    bookPct = (active.totalPages && active.totalPages > 0)
      ? Math.min(100, Math.round((bookPagesRead / active.totalPages) * 100)) : null;
  }

  let insight;
  if (!active && !(state.data.vocab || []).length && !finished)
    insight = '📚 Pick your current book — a few pages a day compounds fast.';
  else if (vs.needSentence > 0)
    insight = '📝 ' + vs.needSentence + ' new word' + (vs.needSentence === 1 ? '' : 's') +
      ' waiting to be used in a sentence — lock them in.';
  else if (readPages === 0)
    insight = '📖 No pages logged this week yet — open your book and read a little today.';
  else
    insight = '🔥 ' + readPages.toLocaleString() + ' pages this week' +
      (streak > 1 ? ' · ' + streak + '-day streak' : '') + ' — keep the momentum going.';

  const card = (inner, onclick) =>
    '<button type="button" class="biz-card" onclick="' + onclick + '">' + inner + '</button>';
  const shortTitle = bookTitle.length > 26 ? escapeHtml(bookTitle.slice(0, 25)) + '…' : escapeHtml(bookTitle);

  return '<div class="biz-insight">' + insight + '</div>' +
    renderReviewCard() +
    '<div class="biz-grid">' +
    card('<div class="biz-k">Pages this week</div><div class="biz-big">' + readPages.toLocaleString() +
      '</div><div class="biz-sub">' + (streak > 1 ? streak + '-day streak 🔥' : 'read a little daily') + '</div>',
      "setKnowledgeTab('reading')") +
    card('<div class="biz-k">Current book</div><div class="biz-big">' +
      (bookPct != null ? bookPct + '%' : (active ? (bookPagesRead ? bookPagesRead.toLocaleString() : '—') : '—')) +
      '</div><div class="biz-sub">' + (active ? shortTitle + (bookPct == null && bookPagesRead ? ' · pages in' : '') : 'set your book') + '</div>',
      "setKnowledgeTab('reading')") +
    card('<div class="biz-k">Words learning</div><div class="biz-big">' + vs.total +
      '</div><div class="biz-sub">' + (vs.needSentence > 0 ? vs.needSentence + ' to practice' : (vs.total ? 'all practiced ✓' : 'add from books')) + '</div>',
      "setKnowledgeTab('vocabulary')") +
    card('<div class="biz-k">Books finished</div><div class="biz-big">' + finished +
      '</div><div class="biz-sub">' + (finished ? 'nice work' : 'finish your first') + '</div>',
      "setKnowledgeTab('reading')") +
    '</div>';
}

function renderKnowledgePage() {
  const tab = state._knowledgeTab || 'overview';
  let body;
  if (tab === 'reading') body = readingBody();
  else if (tab === 'vocabulary') body = renderVocabCard();
  else body = renderKnowledgeOverview();
  document.getElementById('main').innerHTML =
    '<div class="page-header">' +
    '<h2 class="page-title">Knowledge</h2>' +
    '<p class="page-sub">Read, learn and remember — grow your mind, one page at a time</p>' +
    '</div>' +
    knowledgeTabs(tab) + body;
  if (tab === 'reading') ensureBookCovers(); // resolve any missing covers, then re-render
}
function renderReadingPage() { state._knowledgeTab = 'reading'; renderKnowledgePage(); }

// ---- Key takeaways: capture a lesson, then resurface it later --------------
// Priority for resurfacing: never-revisited first, then least-recently revisited.
function sortTakeawaysByPriority(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  return arr.sort((a, b) => {
    const sa = a.seenAt || '', sb = b.seenAt || '';
    if (sa === sb) return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    if (!sa) return -1;   // a never revisited → surfaces first
    if (!sb) return 1;
    return sa < sb ? -1 : 1;
  });
}
function renderReviewCard() {
  const list = sortTakeawaysByPriority(state.data.takeaways || []);
  if (!list.length) return '';
  const idx = (((state._reviewIdx || 0) % list.length) + list.length) % list.length;
  const t = list[idx];
  return '<div class="km-review">' +
    '<div class="km-review-label">💡 A lesson worth revisiting</div>' +
    '<div class="km-quote">“' + escapeHtml(t.text) + '”</div>' +
    (t.book ? '<div class="km-book">— ' + escapeHtml(t.book) + '</div>' : '') +
    '<div class="km-actions">' +
    '<button type="button" class="btn-sm" onclick="markTakeawayReviewed(\'' + t.id + '\')">Still using this ✓</button>' +
    (list.length > 1 ? '<button type="button" class="km-another" onclick="reviewNextTakeaway()">Show another</button>' : '') +
    '</div></div>';
}
function reviewNextTakeaway() {
  const n = (state.data.takeaways || []).length;
  if (!n) return;
  state._reviewIdx = ((state._reviewIdx || 0) + 1) % n;
  renderKnowledgePage();
}
async function markTakeawayReviewed(id) {
  const t = (state.data.takeaways || []).find(x => x.id === id);
  if (!t) return;
  t.seenAt = todayStr();
  await saveData();
  showToast('Love it — keep living it. 💪', 'success');
  const n = (state.data.takeaways || []).length;
  state._reviewIdx = ((state._reviewIdx || 0) + 1) % Math.max(1, n); // move on to another
  renderKnowledgePage();
}
function renderTakeawaysCard() {
  const list   = state.data.takeaways || [];
  const active = (state.data.books || []).find(b => b.status === 'reading');
  const form =
    '<div class="tk-form">' +
    '<input type="text" id="tk-input" class="vocab-input" placeholder="A lesson worth remembering…" maxlength="240" autocomplete="off" onkeydown="if(event.key===\'Enter\'){addTakeaway()}">' +
    '<button class="btn btn-primary" onclick="addTakeaway()">Save</button>' +
    '</div>' +
    (active ? '<div class="tk-attach">Saving to <b>' + escapeHtml(active.title) + '</b></div>' : '');
  const items = list.length
    ? '<div class="tk-list">' + [...list].reverse().map(t =>
        '<div class="tk-item">' +
        '<div class="tk-text">“' + escapeHtml(t.text) + '”</div>' +
        '<div class="tk-meta">' +
        (t.book
          ? '<span class="tk-book">' + escapeHtml(t.book) + '</span>'
          : '<span class="tk-book tk-book-none">General</span>') +
        (t.seenAt ? '<span class="tk-seen">revisited ' + fmtDate(t.seenAt) + '</span>' : '') +
        '<button class="tk-x" title="Remove" onclick="deleteTakeaway(\'' + t.id + '\')">✕</button>' +
        '</div></div>').join('') + '</div>'
    : '<div class="my-meals-empty">No lessons saved yet — capture one idea worth keeping from your book.</div>';
  return '<div class="card tk-card">' +
    '<h3 class="card-title">Key takeaways</h3>' +
    '<p class="card-sub">Distill the ideas worth remembering. We\'ll bring one back to you now and then so it actually sticks.' +
    (list.length ? ' · <b>' + list.length + '</b> saved' : '') + '</p>' +
    form + items +
    '</div>';
}
async function addTakeaway() {
  const el = document.getElementById('tk-input');
  const text = ((el && el.value) || '').trim();
  if (!text) { showToast('Write the lesson first.', 'error'); return; }
  const active = (state.data.books || []).find(b => b.status === 'reading');
  if (!state.data.takeaways) state.data.takeaways = [];
  state.data.takeaways.push({
    id: uid(), text,
    book: (active && active.title) || '', bookId: (active && active.id) || '',
    createdAt: todayStr(), seenAt: ''
  });
  await saveData();
  showToast('Saved — we\'ll resurface it later.', 'success');
  renderKnowledgePage();
}
async function deleteTakeaway(id) {
  if (!confirm('Remove this lesson?')) return;
  state.data.takeaways = (state.data.takeaways || []).filter(x => x.id !== id);
  await saveData();
  renderKnowledgePage();
}

// Curated list of popular growth/business/self-development books with page counts,
// so people pick instead of typing title + author + pages. Custom entries still work.
const BOOK_DB = [
  { t: 'Atomic Habits', a: 'James Clear', p: 320 },
  { t: 'The 7 Habits of Highly Effective People', a: 'Stephen R. Covey', p: 432 },
  { t: 'Rich Dad Poor Dad', a: 'Robert Kiyosaki', p: 336 },
  { t: 'Think and Grow Rich', a: 'Napoleon Hill', p: 238 },
  { t: 'The Psychology of Money', a: 'Morgan Housel', p: 256 },
  { t: 'How to Win Friends and Influence People', a: 'Dale Carnegie', p: 288 },
  { t: 'Deep Work', a: 'Cal Newport', p: 296 },
  { t: 'The Lean Startup', a: 'Eric Ries', p: 336 },
  { t: 'Zero to One', a: 'Peter Thiel', p: 224 },
  { t: 'The 4-Hour Workweek', a: 'Tim Ferriss', p: 308 },
  { t: 'Start with Why', a: 'Simon Sinek', p: 256 },
  { t: "Can't Hurt Me", a: 'David Goggins', p: 364 },
  { t: 'The Subtle Art of Not Giving a F*ck', a: 'Mark Manson', p: 224 },
  { t: 'Mindset', a: 'Carol S. Dweck', p: 320 },
  { t: 'Grit', a: 'Angela Duckworth', p: 352 },
  { t: 'Outliers', a: 'Malcolm Gladwell', p: 336 },
  { t: 'The Power of Habit', a: 'Charles Duhigg', p: 416 },
  { t: "Man's Search for Meaning", a: 'Viktor E. Frankl', p: 184 },
  { t: 'The Alchemist', a: 'Paulo Coelho', p: 208 },
  { t: 'Sapiens', a: 'Yuval Noah Harari', p: 464 },
  { t: 'The Millionaire Next Door', a: 'Thomas J. Stanley', p: 272 },
  { t: 'The Intelligent Investor', a: 'Benjamin Graham', p: 640 },
  { t: 'The 10X Rule', a: 'Grant Cardone', p: 256 },
  { t: 'Never Split the Difference', a: 'Chris Voss', p: 288 },
  { t: 'Influence', a: 'Robert B. Cialdini', p: 336 },
  { t: 'Good to Great', a: 'Jim Collins', p: 320 },
  { t: 'The E-Myth Revisited', a: 'Michael E. Gerber', p: 288 },
  { t: 'Eat That Frog!', a: 'Brian Tracy', p: 144 },
  { t: 'The Compound Effect', a: 'Darren Hardy', p: 176 },
  { t: 'The Magic of Thinking Big', a: 'David J. Schwartz', p: 320 },
  { t: 'Awaken the Giant Within', a: 'Tony Robbins', p: 544 },
  { t: 'The 5 AM Club', a: 'Robin Sharma', p: 336 },
  { t: 'Daring Greatly', a: 'Brené Brown', p: 320 },
  { t: 'Ego Is the Enemy', a: 'Ryan Holiday', p: 256 },
  { t: 'The Obstacle Is the Way', a: 'Ryan Holiday', p: 224 },
  { t: 'Meditations', a: 'Marcus Aurelius', p: 256 },
  { t: 'Extreme Ownership', a: 'Jocko Willink', p: 320 },
  { t: 'The 48 Laws of Power', a: 'Robert Greene', p: 480 },
  { t: 'Mastery', a: 'Robert Greene', p: 352 },
  { t: 'The 12 Week Year', a: 'Brian P. Moran', p: 208 },
  { t: 'Essentialism', a: 'Greg McKeown', p: 272 },
  { t: 'The One Thing', a: 'Gary Keller', p: 240 },
  { t: 'Getting Things Done', a: 'David Allen', p: 352 },
  { t: 'The Almanack of Naval Ravikant', a: 'Eric Jorgenson', p: 244 },
  { t: 'Shoe Dog', a: 'Phil Knight', p: 400 },
  { t: 'Principles', a: 'Ray Dalio', p: 592 },
  { t: 'The Hard Thing About Hard Things', a: 'Ben Horowitz', p: 304 },
  { t: '$100M Offers', a: 'Alex Hormozi', p: 174 },
  { t: 'The Mom Test', a: 'Rob Fitzpatrick', p: 136 },
  { t: 'Building a StoryBrand', a: 'Donald Miller', p: 240 },
  { t: 'The 80/20 Principle', a: 'Richard Koch', p: 288 },
  { t: "So Good They Can't Ignore You", a: 'Cal Newport', p: 304 },
  { t: 'Drive', a: 'Daniel H. Pink', p: 272 },
  { t: 'The Richest Man in Babylon', a: 'George S. Clason', p: 144 },
  { t: 'Rework', a: 'Jason Fried', p: 288 },
  { t: 'The Laws of Human Nature', a: 'Robert Greene', p: 608 },
  { t: 'The 33 Strategies of War', a: 'Robert Greene', p: 496 },
  { t: 'The Art of Seduction', a: 'Robert Greene', p: 480 },
  { t: 'The Daily Laws', a: 'Robert Greene', p: 416 },
  { t: 'Blink', a: 'Malcolm Gladwell', p: 320 },
  { t: 'The Tipping Point', a: 'Malcolm Gladwell', p: 304 },
  { t: 'Talking to Strangers', a: 'Malcolm Gladwell', p: 400 },
  { t: 'David and Goliath', a: 'Malcolm Gladwell', p: 352 },
  { t: 'The Daily Stoic', a: 'Ryan Holiday', p: 416 },
  { t: 'Stillness Is the Key', a: 'Ryan Holiday', p: 288 },
  { t: 'Courage Is Calling', a: 'Ryan Holiday', p: 304 },
  { t: 'Discipline Is Destiny', a: 'Ryan Holiday', p: 336 },
  { t: "Trust Me, I'm Lying", a: 'Ryan Holiday', p: 288 },
  { t: 'Digital Minimalism', a: 'Cal Newport', p: 304 },
  { t: 'A World Without Email', a: 'Cal Newport', p: 320 },
  { t: 'Slow Productivity', a: 'Cal Newport', p: 256 },
  { t: 'Tools of Titans', a: 'Tim Ferriss', p: 736 },
  { t: 'Tribe of Mentors', a: 'Tim Ferriss', p: 624 },
  { t: 'The 4-Hour Body', a: 'Tim Ferriss', p: 592 },
  { t: 'Homo Deus', a: 'Yuval Noah Harari', p: 464 },
  { t: '21 Lessons for the 21st Century', a: 'Yuval Noah Harari', p: 400 },
  { t: 'Leaders Eat Last', a: 'Simon Sinek', p: 368 },
  { t: 'The Infinite Game', a: 'Simon Sinek', p: 272 },
  { t: 'Dare to Lead', a: 'Brené Brown', p: 320 },
  { t: 'Atlas of the Heart', a: 'Brené Brown', p: 336 },
  { t: 'The Gifts of Imperfection', a: 'Brené Brown', p: 160 },
  { t: 'Money: Master the Game', a: 'Tony Robbins', p: 688 },
  { t: 'Unshakeable', a: 'Tony Robbins', p: 256 },
  { t: 'Cashflow Quadrant', a: 'Robert Kiyosaki', p: 376 },
  { t: 'Everything Is F*cked', a: 'Mark Manson', p: 288 },
  { t: 'To Sell Is Human', a: 'Daniel H. Pink', p: 272 },
  { t: 'A Whole New Mind', a: 'Daniel H. Pink', p: 304 },
  { t: 'When', a: 'Daniel H. Pink', p: 272 },
  { t: 'Built to Last', a: 'Jim Collins', p: 368 },
  { t: 'Great by Choice', a: 'Jim Collins', p: 320 },
  { t: 'This Is Marketing', a: 'Seth Godin', p: 288 },
  { t: 'Purple Cow', a: 'Seth Godin', p: 160 },
  { t: 'Linchpin', a: 'Seth Godin', p: 256 },
  { t: 'The Dip', a: 'Seth Godin', p: 96 },
  { t: 'Give and Take', a: 'Adam Grant', p: 320 },
  { t: 'Originals', a: 'Adam Grant', p: 336 },
  { t: 'Think Again', a: 'Adam Grant', p: 320 },
  { t: 'Hooked', a: 'Nir Eyal', p: 256 },
  { t: 'Indistractable', a: 'Nir Eyal', p: 288 },
  { t: 'Steve Jobs', a: 'Walter Isaacson', p: 656 },
  { t: 'Elon Musk', a: 'Walter Isaacson', p: 688 },
  { t: 'Einstein: His Life and Universe', a: 'Walter Isaacson', p: 704 },
  { t: 'Leonardo da Vinci', a: 'Walter Isaacson', p: 624 },
  { t: '$100M Leads', a: 'Alex Hormozi', p: 320 },
  { t: 'Same as Ever', a: 'Morgan Housel', p: 272 },
  { t: 'Thinking, Fast and Slow', a: 'Daniel Kahneman', p: 499 },
  { t: 'The Power of Now', a: 'Eckhart Tolle', p: 236 },
  { t: 'A New Earth', a: 'Eckhart Tolle', p: 336 },
  { t: 'The Four Agreements', a: 'Don Miguel Ruiz', p: 160 },
  { t: 'As a Man Thinketh', a: 'James Allen', p: 64 },
  { t: 'The Art of War', a: 'Sun Tzu', p: 273 },
  { t: 'Smarter Faster Better', a: 'Charles Duhigg', p: 400 },
  { t: 'First Things First', a: 'Stephen R. Covey', p: 384 },
  { t: 'Hyperfocus', a: 'Chris Bailey', p: 272 },
  { t: 'The Productivity Project', a: 'Chris Bailey', p: 304 },
  { t: 'Effortless', a: 'Greg McKeown', p: 272 },
  { t: 'Never Finished', a: 'David Goggins', p: 336 },
  { t: 'Discipline Equals Freedom', a: 'Jocko Willink', p: 208 },
  { t: 'Leadership Strategy and Tactics', a: 'Jocko Willink', p: 304 },
  { t: 'Be Obsessed or Be Average', a: 'Grant Cardone', p: 256 },
  { t: 'Pre-Suasion', a: 'Robert B. Cialdini', p: 432 },
  { t: "Poor Charlie's Almanack", a: 'Charlie Munger', p: 560 },
  { t: 'What You Do Is Who You Are', a: 'Ben Horowitz', p: 276 },
  { t: 'The 5 Second Rule', a: 'Mel Robbins', p: 240 },
  { t: 'The High 5 Habit', a: 'Mel Robbins', p: 320 },
  { t: 'Make Your Bed', a: 'William H. McRaven', p: 144 },
  { t: 'The War of Art', a: 'Steven Pressfield', p: 190 },
  { t: 'Do the Work', a: 'Steven Pressfield', p: 112 },
  { t: 'Turning Pro', a: 'Steven Pressfield', p: 146 },
  { t: 'Flow', a: 'Mihaly Csikszentmihalyi', p: 336 },
  { t: 'Stolen Focus', a: 'Johann Hari', p: 368 },
  { t: 'Lost Connections', a: 'Johann Hari', p: 322 },
  { t: 'Quiet', a: 'Susan Cain', p: 368 },
  { t: 'Bittersweet', a: 'Susan Cain', p: 352 },
  { t: 'The Happiness Hypothesis', a: 'Jonathan Haidt', p: 320 },
  { t: 'The Righteous Mind', a: 'Jonathan Haidt', p: 528 },
  { t: 'The Anxious Generation', a: 'Jonathan Haidt', p: 400 },
  { t: 'Predictably Irrational', a: 'Dan Ariely', p: 384 },
  { t: 'Stumbling on Happiness', a: 'Daniel Gilbert', p: 336 },
  { t: 'The Paradox of Choice', a: 'Barry Schwartz', p: 304 },
  { t: 'Emotional Intelligence', a: 'Daniel Goleman', p: 352 },
  { t: 'Focus', a: 'Daniel Goleman', p: 311 },
  { t: 'Peak', a: 'Anders Ericsson', p: 336 },
  { t: 'Range', a: 'David Epstein', p: 352 },
  { t: 'The Talent Code', a: 'Daniel Coyle', p: 288 },
  { t: 'The Culture Code', a: 'Daniel Coyle', p: 304 },
  { t: 'Ultralearning', a: 'Scott H. Young', p: 304 },
  { t: 'Switch', a: 'Chip Heath & Dan Heath', p: 320 },
  { t: 'Made to Stick', a: 'Chip Heath & Dan Heath', p: 336 },
  { t: 'Decisive', a: 'Chip Heath & Dan Heath', p: 336 },
  { t: 'The Power of Moments', a: 'Chip Heath & Dan Heath', p: 320 },
  { t: 'The Millionaire Fastlane', a: 'MJ DeMarco', p: 336 },
  { t: 'Unscripted', a: 'MJ DeMarco', p: 480 },
  { t: 'I Will Teach You to Be Rich', a: 'Ramit Sethi', p: 352 },
  { t: 'The Simple Path to Wealth', a: 'JL Collins', p: 286 },
  { t: 'Your Money or Your Life', a: 'Vicki Robin', p: 368 },
  { t: 'The Total Money Makeover', a: 'Dave Ramsey', p: 256 },
  { t: 'The Little Book of Common Sense Investing', a: 'John C. Bogle', p: 304 },
  { t: 'A Random Walk Down Wall Street', a: 'Burton G. Malkiel', p: 448 },
  { t: 'Die With Zero', a: 'Bill Perkins', p: 256 },
  { t: 'Profit First', a: 'Mike Michalowicz', p: 224 },
  { t: 'The Personal MBA', a: 'Josh Kaufman', p: 416 },
  { t: 'Crushing It!', a: 'Gary Vaynerchuk', p: 288 },
  { t: 'Jab, Jab, Jab, Right Hook', a: 'Gary Vaynerchuk', p: 224 },
  { t: 'The 1-Page Marketing Plan', a: 'Allan Dib', p: 236 },
  { t: 'Traction', a: 'Gino Wickman', p: 224 },
  { t: 'Blue Ocean Strategy', a: 'W. Chan Kim', p: 320 },
  { t: 'Crossing the Chasm', a: 'Geoffrey A. Moore', p: 288 },
  { t: "The Innovator's Dilemma", a: 'Clayton M. Christensen', p: 288 },
  { t: 'How Will You Measure Your Life?', a: 'Clayton M. Christensen', p: 240 },
  { t: 'Measure What Matters', a: 'John Doerr', p: 336 },
  { t: 'High Output Management', a: 'Andrew S. Grove', p: 272 },
  { t: 'The Effective Executive', a: 'Peter F. Drucker', p: 208 },
  { t: 'The Everything Store', a: 'Brad Stone', p: 400 },
  { t: 'Bad Blood', a: 'John Carreyrou', p: 352 },
  { t: 'The Ride of a Lifetime', a: 'Robert Iger', p: 272 },
  { t: 'No Rules Rules', a: 'Reed Hastings', p: 320 },
  { t: 'Letters from a Stoic', a: 'Seneca', p: 254 },
  { t: 'On the Shortness of Life', a: 'Seneca', p: 106 },
  { t: 'Discourses and Selected Writings', a: 'Epictetus', p: 336 },
  { t: 'A Guide to the Good Life', a: 'William B. Irvine', p: 336 },
  { t: 'How to Think Like a Roman Emperor', a: 'Donald Robertson', p: 304 },
  { t: 'A Brief History of Time', a: 'Stephen Hawking', p: 212 },
  { t: 'Cosmos', a: 'Carl Sagan', p: 432 },
  { t: 'The Selfish Gene', a: 'Richard Dawkins', p: 360 },
  { t: 'Astrophysics for People in a Hurry', a: 'Neil deGrasse Tyson', p: 224 },
  { t: 'The Gene', a: 'Siddhartha Mukherjee', p: 608 },
  { t: 'The Emperor of All Maladies', a: 'Siddhartha Mukherjee', p: 608 },
  { t: 'Guns, Germs, and Steel', a: 'Jared Diamond', p: 528 },
  { t: 'A Short History of Nearly Everything', a: 'Bill Bryson', p: 544 },
  { t: 'The Body', a: 'Bill Bryson', p: 464 },
  { t: 'Why We Sleep', a: 'Matthew Walker', p: 368 },
  { t: 'Breath', a: 'James Nestor', p: 304 },
  { t: 'Behave', a: 'Robert M. Sapolsky', p: 790 },
  { t: 'Educated', a: 'Tara Westover', p: 352 },
  { t: 'Born a Crime', a: 'Trevor Noah', p: 304 },
  { t: 'The Devil in the White City', a: 'Erik Larson', p: 464 },
  { t: 'The Wright Brothers', a: 'David McCullough', p: 336 },
  { t: '1776', a: 'David McCullough', p: 386 },
  { t: 'Team of Rivals', a: 'Doris Kearns Goodwin', p: 944 },
  { t: 'Crucial Conversations', a: 'Kerry Patterson', p: 288 },
  { t: 'Difficult Conversations', a: 'Douglas Stone', p: 352 },
  { t: 'Nonviolent Communication', a: 'Marshall B. Rosenberg', p: 264 },
  { t: 'The 5 Love Languages', a: 'Gary Chapman', p: 208 },
  { t: 'Attached', a: 'Amir Levine', p: 304 },
  { t: 'How to Talk to Anyone', a: 'Leil Lowndes', p: 348 },
  { t: 'Surrounded by Idiots', a: 'Thomas Erikson', p: 304 },
  { t: 'Models', a: 'Mark Manson', p: 296 },
  { t: 'The Great Gatsby', a: 'F. Scott Fitzgerald', p: 180 },
  { t: '1984', a: 'George Orwell', p: 328 },
  { t: 'Animal Farm', a: 'George Orwell', p: 112 },
  { t: 'Brave New World', a: 'Aldous Huxley', p: 288 },
  { t: 'To Kill a Mockingbird', a: 'Harper Lee', p: 336 },
  { t: 'The Catcher in the Rye', a: 'J.D. Salinger', p: 277 },
  { t: 'Fahrenheit 451', a: 'Ray Bradbury', p: 256 },
  { t: 'The Hobbit', a: 'J.R.R. Tolkien', p: 310 },
  { t: 'The Lord of the Rings', a: 'J.R.R. Tolkien', p: 1178 },
  { t: 'Crime and Punishment', a: 'Fyodor Dostoevsky', p: 671 },
  { t: 'The Brothers Karamazov', a: 'Fyodor Dostoevsky', p: 824 },
  { t: 'War and Peace', a: 'Leo Tolstoy', p: 1225 },
  { t: 'Pride and Prejudice', a: 'Jane Austen', p: 432 },
  { t: 'Atlas Shrugged', a: 'Ayn Rand', p: 1168 },
  { t: 'The Fountainhead', a: 'Ayn Rand', p: 752 },
  { t: 'Dune', a: 'Frank Herbert', p: 688 },
  { t: 'Siddhartha', a: 'Hermann Hesse', p: 152 },
  { t: 'The Old Man and the Sea', a: 'Ernest Hemingway', p: 127 }
];
// Group the library by author (sorted) for the "browse by author" picker.
function booksByAuthor() {
  const map = {};
  for (const b of BOOK_DB) { (map[b.a] = map[b.a] || []).push(b); }
  return Object.keys(map)
    .sort((x, y) => x.localeCompare(y))
    .map(a => ({ author: a, books: map[a].slice().sort((m, n) => m.t.localeCompare(n.t)) }));
}
let _authorGroups = null;
// Group reading sessions by book (most-recently-active book first) for the notes log.
function groupReadingByBook(days) {
  const order = [], map = {};
  [...(days || [])]
    .filter(d => d.reading && d.reading.pages > 0)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .forEach(d => {
      const t = (d.reading.bookTitle || 'Untitled').trim() || 'Untitled';
      if (!map[t]) { map[t] = []; order.push(t); }
      map[t].push(d);
    });
  return order.map(title => ({
    title,
    entries: map[title],
    pages: map[title].reduce((s, d) => s + (d.reading.pages || 0), 0),
    notes: map[title].filter(d => (d.reading.summary || '').trim()).length
  }));
}
// Remembers which book note-groups are collapsed, across re-renders.
const _collapsedBookNotes = new Set();
function toggleBookNotes(btn) {
  const grp = btn && btn.closest('.rlog-group');
  if (!grp) return;
  const key = grp.getAttribute('data-key');
  const isCollapsed = grp.classList.toggle('collapsed');
  if (isCollapsed) _collapsedBookNotes.add(key); else _collapsedBookNotes.delete(key);
}
// Fill in any missing author / total pages on the user's saved books from the
// curated library — older entries were saved before we captured that data.
function backfillBookData() {
  if (!state.data || !Array.isArray(state.data.books)) return false;
  let changed = false;
  state.data.books.forEach(b => {
    if (!b || !b.title || (b.author && b.totalPages)) return;
    const m = BOOK_DB.find(x => x.t.toLowerCase() === b.title.trim().toLowerCase());
    if (!m) return;
    if (!b.author) { b.author = m.a; changed = true; }
    if (!b.totalPages) { b.totalPages = m.p; changed = true; }
  });
  return changed;
}
function findBook(title) {
  if (!title) return null;
  const q = title.trim().toLowerCase();
  return BOOK_DB.find(b => b.t.toLowerCase() === q) ||
    BOOK_DB.find(b => b.t.toLowerCase().startsWith(q)) ||
    BOOK_DB.find(b => b.t.toLowerCase().includes(q)) || null;
}
// Mobile-friendly book search — a custom suggestion dropdown, because the native
// <datalist> barely works on phones. Shows popular picks on focus, then filters
// by title and author as you type.
function searchBooks(query, limit) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const starts = [], incl = [], byAuthor = [];
  for (const b of BOOK_DB) {
    const t = b.t.toLowerCase(), a = b.a.toLowerCase();
    if (t.startsWith(q)) starts.push(b);
    else if (t.includes(q)) incl.push(b);
    else if (a.includes(q)) byAuthor.push(b);
  }
  return starts.concat(incl, byAuthor).slice(0, limit || 8);
}
let _bookSuggestMatches = [];
function renderBookSuggest() {
  const wrap = document.getElementById('book-suggest');
  if (!wrap) return;
  const q = (document.getElementById('book-title-input')?.value || '').trim();
  const matches = q ? searchBooks(q, 8) : BOOK_DB.slice(0, 6);
  _bookSuggestMatches = matches;
  if (!matches.length) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  const head = q ? '' : '<div class="bs-head">Popular picks</div>';
  wrap.innerHTML = head + matches.map((b, i) =>
    '<button type="button" class="bs-row" onclick="pickSuggestion(' + i + ')">' +
    bookCoverHtml({ title: b.t }, 'bc-sm') +
    '<span class="bs-info"><span class="bs-title">' + escapeHtml(b.t) + '</span>' +
    '<span class="bs-author">' + escapeHtml(b.a) + ' · ' + b.p + ' pages</span></span>' +
    '</button>'
  ).join('');
  wrap.style.display = 'block';
}
function pickSuggestion(i) {
  const b = _bookSuggestMatches && _bookSuggestMatches[i];
  if (!b) return;
  const t = document.getElementById('book-title-input');
  const a = document.getElementById('book-author-input');
  const p = document.getElementById('book-pages-total-input');
  if (t) t.value = b.t;
  if (a) a.value = b.a;
  if (p) p.value = b.p;
  hideBookSuggest();
  updateBookPreview();
}
function hideBookSuggest() {
  const wrap = document.getElementById('book-suggest');
  if (wrap) { wrap.innerHTML = ''; wrap.style.display = 'none'; }
}
function onBookSearch() {
  renderBookSuggest();
  onBookPick();
}
// When the title exactly matches a known book (i.e. picked from the list), fill author + pages
function onBookPick() {
  const raw = (document.getElementById('book-title-input')?.value || '').trim();
  const b = BOOK_DB.find(x => x.t.toLowerCase() === raw.toLowerCase());
  if (b) {
    const a = document.getElementById('book-author-input');
    const p = document.getElementById('book-pages-total-input');
    if (a) a.value = b.a;
    if (p) p.value = b.p;
  }
  updateBookPreview();
}
// Live cover preview in the picker as you type/select (Open Library, debounced)
let _coverPreviewTimer = null;
function updateBookPreview() {
  const wrap = document.getElementById('book-cover-preview');
  if (!wrap) return;
  const title = (document.getElementById('book-title-input')?.value || '').trim();
  if (!title) { wrap.className = 'book-pick-cover'; wrap.innerHTML = ''; wrap.removeAttribute('data-letter'); return; }
  wrap.className = 'book-pick-cover book-cover bc-lg';
  wrap.setAttribute('data-letter', title.charAt(0).toUpperCase());
  wrap.innerHTML = ''; // lettered placeholder while we resolve
  clearTimeout(_coverPreviewTimer);
  _coverPreviewTimer = setTimeout(async () => {
    const author = (document.getElementById('book-author-input')?.value || '').trim();
    try {
      const res = await fetch('https://openlibrary.org/search.json?title=' + encodeURIComponent(title) + (author ? '&author=' + encodeURIComponent(author) : '') + '&limit=1&fields=cover_i');
      const j = await res.json();
      const id = j && j.docs && j.docs[0] && j.docs[0].cover_i;
      const w = document.getElementById('book-cover-preview');
      if (!w || (document.getElementById('book-title-input')?.value || '').trim() !== title) return; // changed since
      if (id) w.innerHTML = '<img src="https://covers.openlibrary.org/b/id/' + id + '-M.jpg" alt="cover" onerror="this.remove()">';
    } catch {}
  }, 450);
}
// ── "Browse by author" picker ──────────────────────────────
function switchBookTab(which) {
  const search = document.getElementById('book-search');
  const browse = document.getElementById('book-browse');
  if (!search || !browse) return;
  const isAuthor = which === 'author';
  search.style.display = isAuthor ? 'none' : 'block';
  browse.style.display = isAuthor ? 'block' : 'none';
  document.getElementById('tab-search')?.classList.toggle('active', !isAuthor);
  document.getElementById('tab-author')?.classList.toggle('active', isAuthor);
  if (isAuthor) renderAuthorList();
}
function renderAuthorList() {
  const wrap = document.getElementById('book-author-list');
  if (!wrap) return;
  _authorGroups = booksByAuthor();
  wrap.innerHTML = _authorGroups.map((g, i) =>
    '<button type="button" class="author-row" onclick="showAuthorBooks(' + i + ')">' +
    '<span class="author-name">' + escapeHtml(g.author) + '</span>' +
    '<span class="author-count">' + g.books.length + ' book' + (g.books.length > 1 ? 's' : '') + ' ›</span>' +
    '</button>'
  ).join('');
}
function showAuthorBooks(i) {
  const wrap = document.getElementById('book-author-list');
  const g = _authorGroups && _authorGroups[i];
  if (!wrap || !g) return;
  wrap.innerHTML =
    '<button type="button" class="author-back" onclick="renderAuthorList()">‹ All authors</button>' +
    '<div class="author-head">' + escapeHtml(g.author) + '</div>' +
    g.books.map((b, j) =>
      '<button type="button" class="abook-row" onclick="pickBrowsedBook(' + i + ',' + j + ')">' +
      bookCoverHtml({ title: b.t }, 'bc-sm') +
      '<span class="abook-info"><span class="abook-title">' + escapeHtml(b.t) + '</span>' +
      '<span class="abook-pages">' + b.p + ' pages</span></span>' +
      '<span class="abook-go">›</span>' +
      '</button>'
    ).join('');
}
function pickBrowsedBook(i, j) {
  const g = _authorGroups && _authorGroups[i];
  const b = g && g.books[j];
  if (!b) return;
  const t = document.getElementById('book-title-input');
  const a = document.getElementById('book-author-input');
  const p = document.getElementById('book-pages-total-input');
  if (t) t.value = b.t;
  if (a) a.value = b.a;
  if (p) p.value = b.p;
  switchBookTab('search');
  updateBookPreview();
}
function showAddBookModal(isChanging) {
  document.getElementById('add-book-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'add-book-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box" style="text-align:left">' +
    '<div class="modal-badge">' + (isChanging ? 'Change Book' : 'Start Reading') + '</div>' +
    '<p style="font-size:14px;color:var(--text-muted);margin-bottom:16px">' + (isChanging ? 'What are you reading now?' : 'Pick from the library, browse by author, or type your own.') + '</p>' +
    '<div class="book-tabs">' +
    '<button type="button" id="tab-search" class="book-tab active" onclick="switchBookTab(\'search\')">Search a book</button>' +
    '<button type="button" id="tab-author" class="book-tab" onclick="switchBookTab(\'author\')">Browse by author</button>' +
    '</div>' +
    '<div id="book-search">' +
    '<div id="book-cover-preview" class="book-pick-cover"></div>' +
    '<div class="form-group"><label>Book Title <span style="color:var(--danger)">*</span> <span style="font-weight:400;color:var(--text-muted)">— pick from the list or type your own</span></label>' +
    '<input type="text" id="book-title-input" placeholder="Search by title or author…" autocomplete="off" oninput="onBookSearch()" onfocus="renderBookSuggest()" onblur="setTimeout(hideBookSuggest, 200)"></div>' +
    '<div id="book-suggest" class="book-suggest"></div>' +
    '<div class="form-group"><label>Author <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>' +
    '<input type="text" id="book-author-input" placeholder="e.g. Robert Kiyosaki"></div>' +
    '<div class="form-group"><label>Total Pages <span style="font-weight:400;color:var(--text-muted)">(optional — tracks your % progress)</span></label>' +
    '<input type="number" id="book-pages-total-input" min="1" placeholder="e.g. 336"></div>' +
    '</div>' + // end #book-search
    '<div id="book-browse" style="display:none"><div id="book-author-list" class="author-list"></div></div>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'add-book-modal\').remove()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveBook()">Start Reading</button>' +
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
  backfillBookData(); // if they typed a known title, fill author/pages from the library
  await saveData();
  document.getElementById('add-book-modal')?.remove();
  showToast('Now reading: ' + title, 'success');
  renderReadingPage();
}

async function finishBook(id) {
  const book = (state.data.books || []).find(b => b.id === id);
  if (!book) return;
  if (!confirm('Mark "' + book.title + '" as finished? \n\n+50 XP bonus!')) return;
  book.status = 'finished';
  book.finishedDate = todayStr();
  await saveData();
  showToast('Finished: ' + book.title + '! +50 XP!', 'success');
  showStreakCelebration(0); // re-use celebration UI
  showAddBookModal(false);
}

// ─────────────────────────────────────────────────────────────
// DAY DETAIL POPUP  (from calendar)
// ─────────────────────────────────────────────────────────────
// Group a saved day's food log into its meals, each with its own calories (testable)
function groupFoodsByMeal(foodLog) {
  const log = (foodLog || []).filter(x => x && (x.kcal || x.name));
  if (!log.length) return [];
  const count = log.reduce((m, x) => Math.max(m, (x.meal || 0)), 0) + 1;
  const labels = mealLabels(Math.max(3, count));
  const out = [];
  for (let i = 0; i < count; i++) {
    const foods = log.filter(x => (x.meal || 0) === i);
    if (!foods.length) continue;
    const t = foodLogTotals(foods);
    out.push({ index: i, label: labels[i] || ('Meal ' + (i + 1)), kcal: Math.round(t.kcal), p: Math.round(t.p), foods });
  }
  return out;
}
function foodLogMealSummary(foodLog) {
  return groupFoodsByMeal(foodLog).map(g =>
    '<div class="dd-meal"><div class="dd-meal-top"><span class="dd-meal-name">' + escapeHtml(g.label) + '</span>' +
    '<span class="dd-meal-cal">' + g.kcal.toLocaleString() + ' cal · ' + g.p + 'g P</span></div>' +
    '<div class="dd-meal-foods">' + g.foods.map(x => escapeHtml(x.name) + ' <span>' + x.kcal + '</span>').join(' · ') + '</div></div>'
  ).join('');
}
function showDayDetail(dateStr) {
  const day = state.data.days.find(d => d.date === dateStr);
  if (!day) { navigate('log'); return; }
  document.getElementById('day-detail-modal')?.remove();

  const gymLabel = day.gym?.done
    ? (day.gym.muscleGroup ? day.gym.muscleGroup.charAt(0).toUpperCase() + day.gym.muscleGroup.slice(1) : 'Done ✓')
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
    '<div class="modal-badge">' + fmtDate(dateStr) + '</div>' +
    '<div class="dd-grid">' +
    ddItem('gym',        gymLabel,   day.gym?.notes,        day.gym?.done) +
    ddItem('food',       foodLabel,  day.food?.notes,       day.food?.rating >= 4) +
    ddItem('networking', netLabel,   day.networking?.notes, day.networking?.count > 0) +
    ddItem('money',      moneyLabel, (day.spent > 0 ? formatCurrency(day.spent) + ' spent' : '') + (day.money?.activities ? (day.spent > 0 ? ' · ' : '') + day.money.activities : ''), day.spent > 0 || !!day.money?.activities) +
    ddItem('reading',    readLabel,  day.reading?.summary,  day.reading?.pages > 0) +
    '<div class="dd-item water' + (day.water > 0 ? ' dd-done' : '') + '">' +
    '<span class="dd-icon"></span><div>' +
    '<div class="dd-label" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Water</div>' +
    '<div class="dd-label">' + waterLabel + '</div></div></div>' +
    '<div class="dd-item food' + (day.calories > 0 ? ' dd-done' : '') + '">' +
    '<span class="dd-icon"></span><div>' +
    '<div class="dd-label" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Calories eaten</div>' +
    '<div class="dd-label">' + calLabel + '</div>' +
    ((day.foodLog && day.foodLog.length) ? '<div class="dd-meals">' + foodLogMealSummary(day.foodLog) + '</div>' : '') +
    '</div></div>' +
    '</div>' +
    (day.notes ? '<div class="dd-global-notes">' + escapeHtml(day.notes) + '</div>' : '') +
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'day-detail-modal\').remove()">Close</button>' +
    '<button class="btn btn-primary" onclick="editDay(\'' + day.id + '\');document.getElementById(\'day-detail-modal\').remove()">Edit</button>' +
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
    '<h3 class="card-title">Customize Your Pillars</h3>' +
    '<p class="card-sub">Track what matters to <em>you</em>. Pick a starting point below, then rename, re-icon, or switch off any pillar. Each slot measures a fixed kind of input (shown on the right) — so you can make it about anything.</p>' +
    '<div class="preset-grid">' + presetBtns + '</div>' +
    '<div class="pc-list-head"><span>On</span><span>Icon</span><span>Name</span><span>What it measures</span></div>' +
    '<div class="pc-list">' + rows + '</div>' +
    '<button type="button" class="btn btn-primary" style="margin-top:8px" onclick="savePillars()">Save Pillars</button>' +
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
  showToast('Pillars saved! ', 'success');
  renderSettingsPage();
}

// ─────────────────────────────────────────────────────────────
// FIRST-RUN ONBOARDING WIZARD
//   Step 1: about you (name, age, sex)
//   Step 2: pick the development areas you want to work on
//   Step 3: tailored goals + nutrition details (if you chose Nutrition)
// ─────────────────────────────────────────────────────────────
const ONBOARD_AREAS = [
  { id: 'gym',        icon: '', label: 'Fitness',          desc: 'Workouts & training consistency' },
  { id: 'food',       icon: '', label: 'Nutrition & Diet', desc: 'Food quality, calories & macros' },
  { id: 'networking', icon: '', label: 'Networking',       desc: 'Meeting people & building connections' },
  { id: 'money',      icon: '', label: 'Income',           desc: 'Earnings & money-making activity' },
  { id: 'reading',    icon: '', label: 'Reading',          desc: 'Daily reading habit & learning' }
];

// A small flat mountain used in the onboarding hero + the "your climb begins" moment.
function obMountainSvg() {
  return '<svg viewBox="0 0 320 140" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<polygon points="0,140 80,46 140,92 210,30 270,74 320,52 320,140" fill="#9FE1CB"></polygon>' +
    '<polygon points="0,140 52,92 112,112 170,78 230,104 300,82 320,96 320,140" fill="#1D9E75"></polygon>' +
    '<polyline points="36,128 92,100 70,82 150,76 132,60 210,34" fill="none" stroke="#712B13" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"></polyline>' +
    '<circle cx="132" cy="60" r="5" fill="#D85A30"></circle>' +
    '<line x1="210" y1="34" x2="210" y2="12" stroke="#0F6E56" stroke-width="2"></line>' +
    '<polygon points="210,13 228,18 210,23" fill="#D85A30"></polygon>' +
    '</svg>';
}
function showOnboarding() {
  const p = state.data.profile || {};
  state._onboard = {
    step: 0,
    firstName: p.firstName || '', lastName: p.lastName || '', age: p.age || '', sex: p.sex || 'male',
    email: p.email || '', phone: p.phone || '',
    areas: { gym: true, food: false, networking: false, money: true, reading: true },
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

  if (f.step === 0) {
    const m0 = document.createElement('div');
    m0.id = 'onboarding-modal';
    m0.className = 'modal-overlay';
    m0.innerHTML =
      '<div class="modal-box onboard-wizard onboard-hero">' +
      '<div class="ob-hero-art">' + obMountainSvg() + '</div>' +
      '<h2 class="onboard-title">One life. One climb.</h2>' +
      '<p class="onboard-sub">Onward is the only app that shows how your whole life moves together — your body, your money, your mind, all pulling on each other. Let\'s find your summit.</p>' +
      '<div class="onboard-actions onboard-actions-center">' +
      '<button type="button" class="btn btn-primary" onclick="onboardNext()">Begin your climb →</button>' +
      '</div>' +
      '<button type="button" class="ob-skip-link" onclick="skipOnboarding()">Skip for now</button>' +
      '</div>';
    document.body.appendChild(m0);
    return;
  }

  let title = '', sub = '', body = '';

  if (f.step === 1) {
    title = 'First, the basics';
    sub = 'A couple of details so your plan fits you — about 20 seconds.';
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
    title = 'What are you climbing toward?';
    sub = 'Pick your focus — start with a few, add more anytime. A focused climb beats a scattered one.';
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
    title = 'Plant your first flags';
    sub = 'Targets to climb toward — leave any blank if you\'re not sure yet.';
    const parts = [];
    if (f.areas.gym) parts.push('<div class="form-group"><label>Fitness — gym days per week</label><input type="number" id="ob-gym" min="1" max="7" value="' + (f.goals.gymDaysPerWeek || 5) + '"></div>');
    if (f.areas.networking) parts.push('<div class="form-group"><label>Networking — new connections per week</label><input type="number" id="ob-net" min="0" value="' + (f.goals.weeklyNetworkGoal || 3) + '"></div>');
    if (f.areas.money) parts.push(
      '<div class="form-group"><label>How do you get paid?</label>' +
      '<select id="ob-cadence">' +
      '<option value="monthly"' + (f.cadence === 'monthly' ? ' selected' : '') + '>Monthly</option>' +
      '<option value="weekly"' + (f.cadence === 'weekly' ? ' selected' : '') + '>Weekly</option>' +
      '<option value="daily"' + (f.cadence === 'daily' ? ' selected' : '') + '>Daily</option>' +
      '</select>' +
      '<span style="font-size:12px;color:var(--text-muted);display:block;margin-top:5px">We\'ll ask your income on that schedule — and you\'ll log spending every day.</span></div>' +
      '<div class="form-row">' +
      '<div class="form-group"><label>Income goal ($) <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label><input type="number" id="ob-income" min="0" step="50" placeholder="e.g. 1200" value="' + (f.goals.weeklyIncomeGoal || '') + '"></div>' +
      '<div class="form-group"><label>Your job / role <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label><input type="text" id="ob-job" placeholder="e.g. Sales Rep" value="' + escapeHtml(f.jobTitle) + '"></div>' +
      '</div>');
    if (f.areas.reading) parts.push('<div class="form-group"><label>Reading — pages per week</label><input type="number" id="ob-read" min="0" step="10" placeholder="e.g. 100" value="' + (f.goals.weeklyReadGoal || '') + '"></div>');
    if (f.areas.food) {
      const n = f.nut;
      const ftTotal = n.heightCm ? n.heightCm / IN_TO_CM : 0;
      const ftVal = (n.heightUnit === 'ft' && ftTotal) ? Math.floor(ftTotal / 12) : '';
      const inVal = (n.heightUnit === 'ft' && ftTotal) ? Math.round(ftTotal % 12) : '';
      const cmVal = (n.heightUnit === 'cm' && n.heightCm) ? Math.round(n.heightCm) : '';
      const wVal = n.weightKg ? (n.weightUnit === 'lbs' ? Math.round(n.weightKg / LBS_TO_KG) : Math.round(n.weightKg)) : '';
      parts.push(
        '<div class="onboard-nut"><div class="onboard-section-label">Nutrition details <span style="font-weight:400;color:var(--text-muted)">(for your calorie & macro targets — optional)</span></div>' +
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
        '<div class="form-group"><label>Meals per day</label><select id="ob-meals">' + [3, 4, 5, 6, 7, 8].map(m => '<option value="' + m + '"' + (n.mealsPerDay === m ? ' selected' : '') + '>' + m + ' meals</option>').join('') + '</select></div>' +
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
    (isLast ? '<button type="button" class="btn btn-primary" onclick="onboardFinish()">Finish</button>'
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
  if (f.step === 0) { f.step = 1; renderOnboardStep(); return; }
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
  navigate('dashboard');
  showClimbStart(p.firstName);
}

function showClimbStart(name) {
  document.getElementById('climb-start-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'climb-start-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML =
    '<div class="modal-box onboard-wizard onboard-hero">' +
    '<div class="ob-hero-art">' + obMountainSvg() + '</div>' +
    '<h2 class="onboard-title">Your summit is set' + (name ? ', ' + escapeHtml(name) : '') + '.</h2>' +
    '<p class="onboard-sub">Every day you log, your climber takes a step up the mountain. Let\'s take the first one — it takes about 30 seconds.</p>' +
    '<div class="onboard-actions onboard-actions-center">' +
    '<button type="button" class="btn btn-primary" onclick="startClimbLog()">Log my first day →</button>' +
    '</div>' +
    '<button type="button" class="ob-skip-link" onclick="startClimbExplore()">I\'ll explore first</button>' +
    '</div>';
  document.body.appendChild(modal);
}
function startClimbLog() { document.getElementById('climb-start-modal')?.remove(); navigate('log'); }
function startClimbExplore() { document.getElementById('climb-start-modal')?.remove(); navigate('dashboard'); }

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
    '<div class="meal-plan-head">Split into ' + m.count + ' meals — about <strong>' + m.calories.toLocaleString() + ' cal</strong> each</div>' +
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
    '<div class="nut-disclaimer">Estimated with the Mifflin-St Jeor formula. Use it as a starting point and adjust to how your body responds.</div>' +
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
    '<h3 class="card-title">Nutrition & Calorie Targets</h3>' +
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
    [3, 4, 5, 6, 7, 8].map(m => '<option value="' + m + '"' + ((+(n.mealsPerDay) || 3) === m ? ' selected' : '') + '>' + m + ' meals a day</option>').join('') +
    '</select></div>' +
    '<button type="submit" class="btn btn-primary">Calculate & Save</button>' +
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
  showToast('Nutrition targets updated! ', 'success');
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
  showToast('Backup downloaded ', 'success');
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
  showToast('Daily log CSV downloaded ', 'success');
}

function triggerImport() { document.getElementById('import-file')?.click(); }

async function importData(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const data = (parsed && parsed.data) ? parsed.data : parsed; // accept wrapped or raw
    if (!data || typeof data !== 'object' || !('days' in data) || !('profile' in data)) {
      showToast('That doesn\'t look like a Onward backup.', 'error'); input.value = ''; return;
    }
    if (!confirm('Import this backup? It will REPLACE all current data for this account.')) { input.value = ''; return; }
    data.profile = data.profile || {};
    ['days', 'weeks', 'ideas', 'contacts', 'books', 'weights', 'checklist', 'reminders'].forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
    if (!data.checkDone || typeof data.checkDone !== 'object') data.checkDone = {};
    if (!data.profile.pillars) data.profile.pillars = defaultPillars();
    state.data = data;
    await saveData();
    input.value = '';
    showToast('Backup imported! ', 'success');
    applyNavVisibility(); renderXPBar(); navigate('dashboard');
  } catch {
    showToast('Could not read that file — is it a valid backup?', 'error');
    input.value = '';
  }
}

function renderBackupCard() {
  const n = state.data.days.length;
  return '<div class="card">' +
    '<h3 class="card-title">Backup & Data</h3>' +
    '<p class="card-sub">Your data is stored only on this computer. Export a backup regularly so you never lose it — you have <strong>' + n + '</strong> day' + (n === 1 ? '' : 's') + ' logged.</p>' +
    '<div class="backup-btns">' +
    '<button class="btn btn-primary" onclick="exportData()">Export backup (JSON)</button>' +
    '<button class="btn btn-outline" onclick="exportDaysCSV()">Export log (CSV)</button>' +
    '<button class="btn btn-outline" onclick="triggerImport()">Import backup</button>' +
    '<input type="file" id="import-file" accept="application/json,.json" style="display:none" onchange="importData(this)">' +
    '</div>' +
    '<div class="backup-note">Importing replaces this account\'s current data. Export first if you want a safety copy.</div>' +
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
  const repeat = !!document.getElementById('rem-repeat')?.checked;
  const date = repeat ? '' : (document.getElementById('rem-date')?.value || todayStr()); // defaults to today; blank (repeat) = daily
  if (!label || !time) { showToast('Add a label and a time.', 'error'); return; }
  if (date && date < todayStr()) { showToast('Pick today or a future date.', 'error'); return; }
  ensureChecklistData();
  state.data.reminders.push({ id: uid(), label, time, date, enabled: true, _lastFired: '' });
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
      showToast(pushed ? 'Notifications on — you\'ll get reminders even when the app is closed ' : 'Notifications on ', 'success');
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
  // If subscribed to server push, test the real path that works when the app is closed.
  if (isPushSubscribed()) {
    try {
      const r = await fetch('/api/push/test', { method: 'POST', headers: authHeaders() });
      const j = await r.json();
      if (r.ok && j.sent > 0) { showToast('Test push sent — check your notifications.', 'success'); return; }
    } catch {}
  }
  // Otherwise fire a local notification right now — works on desktop (and phone)
  // while Onward is open, with no server setup needed.
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification('Onward 🧗', { body: 'Test notification — it works on this device!', icon: 'icons/icon-192.png', tag: 'escalate-test' });
      n.onclick = () => { window.focus(); n.close(); };
      showToast('Sent a test — look at the corner of your screen.', 'success');
      return;
    } catch {}
  }
  if ('Notification' in window && Notification.permission !== 'denied') { await enableNotifications(); return; }
  showToast('Notifications are blocked — allow them in your browser settings.', 'error');
}

// Pure: is this reminder due to fire right now? (testable)
// r.date (optional) = one-time reminder for that day; no date = daily.
function reminderDue(r, hhmm, today) {
  if (!r || !r.enabled || r._lastFired === today) return false;
  if (r.date && today < r.date) return false;     // scheduled for a future day
  return (r.time || '99:99') <= hhmm;
}
function isPushSubscribed() { return !!(state.data && state.data.profile && state.data.profile.pushSubscribed); }
function fireReminder(r) {
  const name = state.data.profile && state.data.profile.firstName;
  showToast('' + r.label, 'success');
  // If the device is subscribed to server push, the cron already delivers this
  // reminder — don't also raise a local system notification (would double-notify).
  if (!isPushSubscribed() && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('' + (name ? name + ', ' : '') + r.label, { body: 'Onward', tag: r.id }); } catch {}
  }
}
function checkReminders() {
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const today = todayStr();
  let changed = false;
  (state.data.reminders || []).forEach(r => { if (reminderDue(r, hhmm, today)) { r._lastFired = today; if (r.date) r.enabled = false; changed = true; fireReminder(r); } });
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
    '<h3 class="card-title" style="margin-bottom:0">Today\'s Checklist</h3>' +
    '<span style="font-size:13px;color:var(--text-muted)">' + prog.done + '/' + prog.total + '</span></div>' +
    '<div class="chk-progress"><div style="width:' + pct + '%"></div></div>' +
    '<div class="chk-list">' + rows + '</div></div>';
}

// Daily streak nudge control (server sends it; this just sets the preference)
function renderNudgeCard() {
  const p = state.data.profile || {};
  const on = p.dailyNudge !== false; // default ON
  const proteinOn = p.proteinNudge !== false; // default ON
  const motivationOn = p.dailyMotivation !== false; // default ON
  const planOn = p.planWorkoutNudge !== false; // default ON
  const hour = Number.isFinite(+p.nudgeHour) ? +p.nudgeHour : 19;
  const mHour = Number.isFinite(+p.motivationHour) ? +p.motivationHour : 8;
  const fmt = h => ((h % 12) || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
  const opts = Array.from({ length: 24 }, (_, h) => '<option value="' + h + '"' + (h === hour ? ' selected' : '') + '>' + fmt(h) + '</option>').join('');
  const mopts = Array.from({ length: 24 }, (_, h) => '<option value="' + h + '"' + (h === mHour ? ' selected' : '') + '>' + fmt(h) + '</option>').join('');
  return '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">Daily streak nudge</h3>' +
    '<label class="pc-toggle"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleDailyNudge()"><span class="pc-slider"></span></label></div>' +
    '<p class="card-sub">If you haven\'t logged by this time, we\'ll send one friendly push to your phone — so you never break your streak.</p>' +
    '<div class="rem-add"><label style="align-self:center;color:var(--text-muted);font-size:14px;white-space:nowrap">Remind me at</label>' +
    '<select id="nudge-hour" onchange="setNudgeHour(this.value)"' + (on ? '' : ' disabled') + '>' + opts + '</select></div>' +
    '<div class="rem-note">Needs notifications enabled (above). Sent at most once a day, only if you haven\'t logged yet.</div>' +
    '<div style="height:1px;background:var(--border);margin:16px 0"></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<h3 class="card-title" style="margin-bottom:0">Protein reminder</h3>' +
    '<label class="pc-toggle"><input type="checkbox" ' + (proteinOn ? 'checked' : '') + ' onchange="toggleProteinNudge()"><span class="pc-slider"></span></label></div>' +
    '<p class="card-sub">Logged food but came up short on protein? Around your reminder time we\'ll let you know there\'s still time for a shake — so you hit your target. (Needs nutrition set up.)</p>' +
    '<div style="height:1px;background:var(--border);margin:16px 0"></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<h3 class="card-title" style="margin-bottom:0">Daily motivation ⛰️</h3>' +
    '<label class="pc-toggle"><input type="checkbox" ' + (motivationOn ? 'checked' : '') + ' onchange="toggleMotivation()"><span class="pc-slider"></span></label></div>' +
    '<p class="card-sub">A short hit of motivation every morning — one line to get you moving. Goes out whether or not you\'ve logged. No streak required.</p>' +
    '<div class="rem-add"><label style="align-self:center;color:var(--text-muted);font-size:14px;white-space:nowrap">Send at</label>' +
    '<select id="motivation-hour" onchange="setMotivationHour(this.value)"' + (motivationOn ? '' : ' disabled') + '>' + mopts + '</select></div>' +
    (isPillarOn('gym') ?
      '<div style="height:1px;background:var(--border);margin:16px 0"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<h3 class="card-title" style="margin-bottom:0">Plan tomorrow\'s workout 🏋️</h3>' +
      '<label class="pc-toggle"><input type="checkbox" ' + (planOn ? 'checked' : '') + ' onchange="togglePlanNudge()"><span class="pc-slider"></span></label></div>' +
      '<p class="card-sub" style="margin-bottom:0">In the evening, if you haven\'t picked your next session, we\'ll nudge you to plan it — so it\'s loaded and ready when you get to the gym.</p>'
      : '') +
    '</div>';
}
async function togglePlanNudge() {
  const p = state.data.profile = state.data.profile || {};
  p.planWorkoutNudge = !(p.planWorkoutNudge !== false);
  if (p.planWorkoutNudge) p.tz = -new Date().getTimezoneOffset();
  await saveData();
  renderChecklistPage();
}
async function toggleMotivation() {
  const p = state.data.profile = state.data.profile || {};
  p.dailyMotivation = !(p.dailyMotivation !== false);
  if (p.dailyMotivation) p.tz = -new Date().getTimezoneOffset(); // so the server knows your morning
  await saveData();
  renderChecklistPage();
}
async function setMotivationHour(v) {
  const p = state.data.profile = state.data.profile || {};
  const h = parseInt(v, 10);
  p.motivationHour = Number.isFinite(h) ? h : 8;
  await saveData();
}
async function toggleProteinNudge() {
  const p = state.data.profile = state.data.profile || {};
  p.proteinNudge = !(p.proteinNudge !== false);
  if (p.proteinNudge) p.tz = -new Date().getTimezoneOffset();
  await saveData();
  renderChecklistPage();
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
        '<button type="button" class="chk-del" onclick="deleteCheckItem(\'' + i.id + '\')" title="Remove">✕</button>' +
        '</div>').join('')
    : '<div class="chk-empty">No checklist items yet — add your daily must-dos below.</div>';

  const reminders = state.data.reminders;
  const remRows = reminders.length
    ? reminders.map(r => '<div class="rem-row' + (r.enabled ? '' : ' rem-off') + '">' +
        '<span class="rem-time">' + escapeHtml(r.time) + '</span>' +
        '<span class="rem-label">' + escapeHtml(r.label) + (r.date ? ' <span class="rem-when">' + fmtDateShort(r.date) + '</span>' : '') + '</span>' +
        '<label class="pc-toggle"><input type="checkbox" ' + (r.enabled ? 'checked' : '') + ' onchange="toggleReminder(\'' + r.id + '\')"><span class="pc-slider"></span></label>' +
        '<button type="button" class="chk-del" onclick="deleteReminder(\'' + r.id + '\')" title="Remove">✕</button>' +
        '</div>').join('')
    : '<div class="chk-empty">No reminders yet — add one below.</div>';

  const notifBtn = ('Notification' in window && Notification.permission === 'granted')
    ? '<span class="rem-notif-on">On</span> <button type="button" class="btn-link" onclick="sendTestPush()">Send test</button>'
    : '<button type="button" class="btn btn-outline" onclick="enableNotifications()">Enable notifications</button>';

  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">Checklist & Reminders</h2>' +
    '<p class="page-sub">Your daily must-dos and nudges to stay on track</p></div>' +
    '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">Today\'s Checklist</h3>' +
    '<span style="font-size:13px;color:var(--text-muted)">' + prog.done + '/' + prog.total + ' done</span></div>' +
    '<div class="chk-progress"><div style="width:' + pct + '%"></div></div>' +
    '<div class="chk-list">' + checklistRows + '</div>' +
    '<div class="chk-add"><input type="text" id="chk-new" placeholder="Add a daily task… (e.g. Take vitamins)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addCheckItem();}">' +
    '<button type="button" class="btn btn-primary" onclick="addCheckItem()">+ Add</button></div>' +
    '</div>' +
    '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
    '<h3 class="card-title" style="margin-bottom:0">Reminders</h3>' + notifBtn + '</div>' +
    '<div class="rem-list">' + remRows + '</div>' +
    '<div class="rem-add">' +
    '<input type="text" id="rem-label" placeholder="Reminder (e.g. Call the dentist)">' +
    '<input type="time" id="rem-time" value="20:00">' +
    '<input type="date" id="rem-date" value="' + todayStr() + '" min="' + todayStr() + '" title="The day for this reminder — tap to pick another day (defaults to today)">' +
    '<button type="button" class="btn btn-primary" onclick="addReminder()">+ Add</button>' +
    '</div>' +
    '<label class="rem-repeat-row"><input type="checkbox" id="rem-repeat" onchange="document.getElementById(\'rem-date\').disabled=this.checked"> Repeat every day</label>' +
    '<div class="rem-note">Defaults to <strong>today</strong> — tap the date to pick any day ahead. Or check <strong>Repeat every day</strong> for a daily reminder.</div>' +
    '<div class="rem-note">Reminders nudge you while the app is open. On a phone, add it to your home screen and allow notifications for the best results.</div>' +
    '</div>' +
    renderNudgeCard();
}

// Appearance — toggle the animated 3D parallax background (per device)
function renderAppearanceCard() {
  const on = bg3dEnabled();
  const pref = themePref();
  const seg = (v, label) => '<button type="button" class="theme-seg-btn' + (pref === v ? ' on' : '') + '" onclick="setTheme(\'' + v + '\')">' + label + '</button>';
  return '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">Theme</h3>' +
    '<div class="theme-seg">' + seg('system', 'Auto') + seg('light', 'Light') + seg('dark', 'Dark') + '</div></div>' +
    '<p class="card-sub" style="margin-bottom:0">Auto follows your phone’s light/dark setting. Choose Light or Dark to lock it. Set per device.</p>' +
    '<div style="height:1px;background:var(--border);margin:16px 0"></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<h3 class="card-title" style="margin-bottom:0">3D background</h3>' +
    '<label class="pc-toggle"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="setBg3d(this.checked)"><span class="pc-slider"></span></label></div>' +
    '<p class="card-sub" style="margin-bottom:0">A gentle, animated mountain scene with floating particles drifts behind your screens and follows your cursor or phone tilt. Turn it off for a flat background. Set per device; movement is reduced automatically if your system prefers less motion.</p>' +
    '</div>';
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

    // Customize pillars (first — it's the headline feature)
    pillarCustomizerCard() +

    // Appearance — animated 3D background toggle
    renderAppearanceCard() +

    // Goals — labels follow your pillar names; only enabled pillars shown
    '<div class="card">' +
    '<h3 class="card-title">Weekly Goals</h3>' +
    '<form id="goals-form" onsubmit="saveGoals(event)">' +
    '<div class="form-row">' +
    (isPillarOn('gym') ? '<div class="form-group"><label>' + gymP.icon + ' ' + escapeHtml(gymP.label) + ' days per week</label>' +
      '<input type="number" id="g-gym" min="1" max="7" value="' + (p.gymDaysPerWeek||5) + '"></div>' : '<input type="hidden" id="g-gym" value="' + (p.gymDaysPerWeek||5) + '">') +
    (isPillarOn('money') ? '<div class="form-group"><label>' + moneyP.icon + ' Weekly ' + escapeHtml(moneyP.label) + ' goal ($)</label>' +
      '<input type="number" id="g-income" min="0" step="50" placeholder="e.g. 1200" value="' + (p.weeklyIncomeGoal||'') + '"></div>' : '<input type="hidden" id="g-income" value="' + (p.weeklyIncomeGoal||0) + '">') +
    '</div>' +
    (isPillarOn('money') ? '<div class="form-row"><div class="form-group"><label>How often do you get paid?</label>' +
      '<select id="g-cadence"><option value="monthly"' + (moneyCadence()==='monthly'?' selected':'') + '>Monthly — set income once a month</option>' +
      '<option value="weekly"' + (moneyCadence()==='weekly'?' selected':'') + '>Weekly — set income once a week</option>' +
      '<option value="daily"' + (moneyCadence()==='daily'?' selected':'') + '>Daily — set income each day</option></select></div>' +
      '<div class="form-group"><label>Savings goal per ' + moneyPeriodLabel() + ' ($)</label>' +
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
    '<button type="submit" class="btn btn-primary">Save Goals</button>' +
    '</form></div>' +

    // Nutrition & calorie targets
    renderNutritionSettingsCard() +

    // Profile
    '<div class="card">' +
    '<h3 class="card-title">Work Profile</h3>' +
    '<p class="card-sub">This is what the AI coach uses to give you personalized advice.</p>' +
    '<form id="profile-form" onsubmit="saveProfileSettings(event)">' +
    '<div class="form-group"><label>What is your job / role?</label>' +
    '<input type="text" id="s-title" placeholder="e.g. Solar Panel Sales Rep" value="' + (p.jobTitle||'') + '"></div>' +
    '<div class="form-group"><label>How does your commission work?</label>' +
    '<textarea id="s-desc" rows="3" placeholder="Describe what you sell, your commission rate, how deals work…">' + (p.jobDescription||'') + '</textarea></div>' +
    '<div class="form-group"><label>Commission rate (%)</label>' +
    '<input type="number" id="s-rate" min="0" max="100" step="0.1" placeholder="e.g. 3" value="' + (p.commissionRate||'') + '"></div>' +
    '<button type="submit" class="btn btn-primary">Save Profile</button>' +
    '</form></div>' +

    // AI Key
    '<div class="card">' +
    '<h3 class="card-title">AI Coach — connect any AI</h3>' +
    (hasKey
      ? '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--success-bg);border:1px solid rgba(16,185,129,0.3);border-radius:var(--radius-sm);margin-bottom:12px">' +
        '<span style="color:var(--success);font-weight:600">API key connected — AI Coach is active</span>' +
        '<button class="btn-link" onclick="clearApiKey()">Remove key</button></div>'
      : '<p class="card-sub">Bring your own key from Claude, OpenAI (GPT), Gemini, or any OpenAI-compatible API.</p>' +
        apiKeyFields()) +
    '</div>' +

    // Security & password
    renderSecurityCard() +

    // Backup & data
    renderBackupCard() +

    // Notifications info
    '<div class="card">' +
    '<h3 class="card-title">Notifications & Reminders</h3>' +
    '<div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-sm);padding:14px 16px;font-size:14px;color:var(--text-muted);line-height:1.7;margin-bottom:12px">' +
    'Get your reminders and a daily <strong style="color:var(--text)">streak nudge</strong> — <strong style="color:var(--text)">on your desktop or phone</strong>. ' +
    'Turn them on in <strong style="color:var(--text)">Checklist → Reminders → Enable notifications</strong>, then add your own reminder times and set the nudge.' +
    '<br><br><strong style="color:var(--text)">On desktop</strong> (Chrome, Edge, Firefox): click Enable notifications and you\'ll get system pop-ups while Onward is open in a tab — try the <strong style="color:var(--text)">Send test</strong> button to see one. For reminders when the browser is fully closed, the server\'s push keys need to be set.' +
    '<br><strong style="color:var(--text)">On iPhone:</strong> add the app to your Home Screen first (Share → Add to Home Screen), then allow notifications.' +
    '</div>' +
    '<button class="btn btn-outline" onclick="navigate(\'checklist\')">Open Checklist & Reminders →</button>' +
    '</div>';
}

// Owner-only card: type a message → push it to everyone's phone. Returns '' for normal users.
function renderOwnerCard() {
  if (!state.isOwner) return '';
  return '<div class="card" style="border:1px solid rgba(124,92,255,0.4)">' +
    '<h3 class="card-title">Send a notification to everyone</h3>' +
    '<p class="card-sub">Owner tool — pushes a notification to every person who turned on notifications, right on their phone. <span id="bc-reach"></span></p>' +
    '<div class="form-group"><label>Title</label>' +
    '<input type="text" id="bc-title" maxlength="80" placeholder="e.g. New feature added "></div>' +
    '<div class="form-group"><label>Message</label>' +
    '<textarea id="bc-body" rows="2" maxlength="300" placeholder="e.g. Don\'t forget to log your day — keep the streak alive!"></textarea></div>' +
    '<button type="button" class="btn btn-primary" onclick="sendBroadcast()">Send to everyone</button>' +
    '<hr style="border:none;border-top:1px solid var(--border);margin:18px 0">' +
    '<h3 class="card-title" style="margin-bottom:6px">Activate a subscriber</h3>' +
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
    if (r.ok) { showToast('' + j.username + ' is now Pro.', 'success'); document.getElementById('pro-user').value = ''; }
    else showToast(j.error || 'Could not update.', 'error');
  } catch { showToast('Could not update.', 'error'); }
}

// Owner-only live analytics — so you can SEE if people actually use it
// ── Owner-only Admin console: a professional dashboard of the whole app ──
function renderAdminPage() {
  if (!state.isOwner) { navigate('dashboard'); return; }   // defence in depth (server also 403s)
  document.getElementById('main').innerHTML =
    '<div class="page-header"><h2 class="page-title">Admin</h2>' +
    '<p class="page-sub">Your command center — everything happening across Onward, in one place.</p></div>' +
    '<div class="adm-toolbar"><span class="adm-owner-badge">🔒 Owner only</span>' +
    '<button class="btn btn-outline btn-sm" onclick="loadAdminConsole()">↻ Refresh</button></div>' +
    '<div id="adm-body"><div class="di-loading"><div class="spinner"></div><span>Loading your numbers…</span></div></div>';
  loadAdminConsole();
}
async function loadAdminConsole() {
  const body = document.getElementById('adm-body');
  if (body) body.innerHTML = '<div class="di-loading"><div class="spinner"></div><span>Loading your numbers…</span></div>';
  try {
    const j = await fetch('/api/admin/stats', { headers: authHeaders() }).then(r => r.json());
    if (!j || j.error) throw new Error(j && j.error);
    renderAdminConsole(j);
  } catch {
    if (body) body.innerHTML = '<div class="card"><p class="card-sub">Couldn\'t load your numbers — check your connection and hit Refresh.</p></div>';
  }
}
function admSection(title, sub, inner) {
  return '<div class="card adm-card"><div class="adm-card-head"><h3 class="card-title" style="margin-bottom:0">' + title + '</h3>' +
    (sub ? '<span class="adm-card-sub">' + sub + '</span>' : '') + '</div>' + inner + '</div>';
}
function admMini(label, val, hint) {
  return '<div class="adm-mini-item"><div class="adm-mini-n">' + val + '</div><div class="adm-mini-l">' + label + '</div>' +
    (hint ? '<div class="adm-mini-h">' + hint + '</div>' : '') + '</div>';
}
function renderAdminConsole(j) {
  const body = document.getElementById('adm-body');
  if (!body) return;
  const total = j.totalUsers || 0;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  const kpi = (n, label, hint, tone) => '<div class="adm-kpi ' + (tone || '') + '"><div class="adm-kpi-n">' + n + '</div>' +
    '<div class="adm-kpi-l">' + label + '</div>' + (hint ? '<div class="adm-kpi-h">' + hint + '</div>' : '') + '</div>';
  const kpis = '<div class="adm-kpis">' +
    kpi(total, 'Total users', j.new7 ? '▲ ' + j.new7 + ' this week' : 'no new signups yet', 'blue') +
    kpi(j.active7 || 0, 'Active this week', pct(j.active7) + '% of users', 'green') +
    kpi(j.loggedToday || 0, 'Logged today', pct(j.loggedToday) + '% of users', 'amber') +
    kpi('$' + (j.estRevenue || 0), 'Est. revenue / mo', (j.proUsers || 0) + ' Pro', 'violet') +
    '</div>';

  const maxS = Math.max(1, ...(j.signups || []).map(s => s.count));
  const spark = '<div class="adm-spark">' + (j.signups || []).map(s =>
    '<div class="adm-spark-col" title="' + s.date + ': ' + s.count + ' signup' + (s.count === 1 ? '' : 's') + '">' +
    '<div class="adm-spark-bar' + (s.count ? '' : ' empty') + '" style="height:' + (s.count ? Math.max(8, Math.round(s.count / maxS * 100)) : 4) + '%"></div></div>').join('') + '</div>';
  const growth = admSection('Growth', 'New signups · last 14 days',
    spark + '<div class="adm-mini">' + admMini('Today', j.newToday || 0) + admMini('7 days', j.new7 || 0) +
    admMini('30 days', j.new30 || 0) + admMini('All time', total) + '</div>');

  const eng = admSection('Engagement', 'How sticky the habit is',
    '<div class="adm-mini">' +
    admMini('Daily active', j.loggedToday || 0) + admMini('Weekly active', j.active7 || 0) + admMini('Monthly active', j.active30 || 0) +
    admMini('Stickiness', (j.stickiness || 0) + '%', 'DAU / MAU') +
    admMini('Avg days / wk', j.avgDaysWeek != null ? j.avgDaysWeek : '—', 'weekly users') +
    admMini('7-day retention', j.retention7 != null ? j.retention7 + '%' : '—', 'new cohort') +
    '</div>');

  const barRow = (label, n, color) => { const p = pct(n); return '<div class="adm-bar-row"><span class="adm-bar-label">' + label +
    '</span><span class="adm-bar-track"><span class="adm-bar-fill" style="width:' + p + '%;background:' + color + '"></span></span>' +
    '<span class="adm-bar-val">' + n + ' · ' + p + '%</span></div>'; };
  const P = j.pillars || {}, F = j.features || {};
  const adoption = admSection('Feature adoption', 'What people actually turn on and use',
    '<div class="adm-sub-label">Pillars enabled</div>' +
    barRow('Gym', P.gym || 0, 'var(--gym-color)') + barRow('Nutrition', P.food || 0, 'var(--food-color)') +
    barRow('Networking', P.networking || 0, 'var(--network-color)') + barRow('Money', P.money || 0, 'var(--money-color)') +
    barRow('Reading', P.reading || 0, 'var(--read-color)') +
    '<div class="adm-sub-label" style="margin-top:16px">Modules used</div>' +
    barRow('Books', F.books || 0, 'var(--read-color)') + barRow('Business ideas', F.ideas || 0, 'var(--primary)') +
    barRow('Contacts', F.contacts || 0, 'var(--network-color)') + barRow('Vocabulary', F.vocab || 0, 'var(--read-color)') +
    barRow('Key takeaways', F.takeaways || 0, 'var(--accent)'));

  const money = admSection('Revenue & reach', 'Estimated from Pro members × your price',
    '<div class="adm-mini">' +
    admMini('Pro members', j.proUsers || 0) + admMini('Est. / month', '$' + (j.estRevenue || 0)) + admMini('Price', j.priceLabel || '—') +
    admMini('Push devices', j.pushDevices || 0) + admMini('Reachable', j.pushUsers || 0, 'people') + admMini('Total logs', j.totalDays || 0) +
    '</div><p class="adm-note">Your exact revenue lives in your Stripe dashboard.</p>');

  const rows = (j.recent || []).map(r =>
    '<tr><td>' + escapeHtml(r.username) + (r.pro ? ' <span class="adm-pro">PRO</span>' : '') + '</td>' +
    '<td style="text-align:center">' + r.days + '</td>' +
    '<td style="text-align:right;color:var(--text-muted)">' + (r.joined ? fmtDateShort(r.joined) : '—') + '</td>' +
    '<td style="text-align:right;color:var(--text-muted)">' + (r.last ? fmtDateShort(r.last) : '—') + '</td></tr>').join('');
  const usersTable = admSection('Users', total ? 'Most recently active first' : '',
    total ? '<div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>User</th><th style="text-align:center">Days</th>' +
      '<th style="text-align:right">Joined</th><th style="text-align:right">Last active</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="card-sub">No signups yet — share your link to get your first users.</p>');

  body.innerHTML = kpis + growth + eng + adoption + money + usersTable + renderOwnerCard();
  loadBroadcastReach();
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
      showToast('Sent to ' + (j.sent || 0) + ' device' + (j.sent === 1 ? '' : 's') + ' ', 'success');
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
  showToast('Profile saved! ', 'success');
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

// ─────────────────────────────────────────────────────────────
// 3D PARALLAX BACKGROUND
// A layered mountain scene with floating particles that drifts behind
// everything and follows the cursor / phone tilt / scroll. Pure CSS-3D —
// no WebGL — so it stays light on load and battery. Honors reduced-motion.
// ─────────────────────────────────────────────────────────────
function bg3dEnabled() {
  try { return localStorage.getItem('be_bg3d') !== 'off'; } catch { return true; } // default ON
}
function buildScene3d() {
  if (typeof document === 'undefined' || !document.body) return;   // headless/test guard
  if (!bg3dEnabled()) { document.getElementById('scene3d')?.remove(); return; }
  if (document.getElementById('scene3d')) return;                  // built once — persists across pages
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const mtn = (cls, pts) => '<svg class="s3-mtn ' + cls + '" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true"><polygon points="' + pts + '"/></svg>';
  // Three overlapping ranges — back is paler & flatter, front darker & taller
  const far  = mtn('s3-far',  '0,400 0,250 150,180 320,240 480,150 650,225 820,140 1000,215 1200,165 1200,400');
  const mid  = mtn('s3-mid',  '0,400 0,300 180,215 360,285 540,195 720,275 900,185 1080,265 1200,215 1200,400');
  const near = mtn('s3-near', '0,400 0,340 220,265 430,335 620,255 820,325 1010,255 1200,305 1200,400');

  // Floating particles — size + blur + opacity fake depth-of-field (bokeh).
  // --o is the particle's base brightness; the float keyframe twinkles around it.
  let dots = '';
  const N = reduce ? 0 : 32;
  for (let i = 0; i < N; i++) {
    const depth = Math.random();                       // 0 = far/small/blurred, 1 = near
    const size = (3.5 + depth * 11).toFixed(1);
    const left = (Math.random() * 100).toFixed(2);
    const top  = (Math.random() * 96).toFixed(2);
    const dur  = (13 + Math.random() * 18).toFixed(1);
    const delay = (-Math.random() * 35).toFixed(1);
    const blur = ((1 - depth) * 2.6).toFixed(2);
    const op   = (0.16 + depth * 0.40).toFixed(2);     // brighter, esp. the near bokeh
    dots += '<span class="p3" style="left:' + left + '%;top:' + top + '%;width:' + size + 'px;height:' + size +
      'px;filter:blur(' + blur + 'px);--o:' + op + ';opacity:' + op +
      ';animation-duration:' + dur + 's;animation-delay:' + delay + 's"></span>';
  }

  const scene = document.createElement('div');
  scene.id = 'scene3d';
  scene.setAttribute('aria-hidden', 'true');
  if (reduce) scene.classList.add('s3-still');
  scene.innerHTML = '<div class="s3-sky"></div>' +
    '<div class="s3-stage">' + far + mid + near +
    '<div class="s3-particles">' + dots + '</div></div>';
  document.body.appendChild(scene);                    // z-index:-1 keeps it behind regardless of DOM order

  if (!reduce) scene3dParallax(scene);
}
// Pointer / tilt / scroll → CSS custom properties (CSS transitions do the easing)
function scene3dParallax(scene) {
  if (scene._wired) return; scene._wired = true;
  let mx = 0, my = 0, sc = 0, raf = 0;
  const flush = () => {
    raf = 0;
    scene.style.setProperty('--mx', mx.toFixed(3));
    scene.style.setProperty('--my', my.toFixed(3));
    scene.style.setProperty('--sc', sc.toFixed(3));
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };
  window.addEventListener('mousemove', e => {
    mx = ((e.clientX / (window.innerWidth || 1)) - 0.5) * 2;   // -1 … 1
    my = ((e.clientY / (window.innerHeight || 1)) - 0.5) * 2;
    schedule();
  }, { passive: true });
  window.addEventListener('deviceorientation', e => {
    if (e.gamma == null && e.beta == null) return;             // tilt: left/right + front/back
    mx = Math.max(-1, Math.min(1, (e.gamma || 0) / 30));
    my = Math.max(-1, Math.min(1, ((e.beta || 0) - 45) / 40));
    schedule();
  }, { passive: true });
  window.addEventListener('scroll', () => {
    sc = Math.min(1, (window.scrollY || 0) / 700);             // mountains sink slightly as you scroll
    schedule();
  }, { passive: true });
}
// Settings toggle — per device (instant, works before login)
function setBg3d(on) {
  try { localStorage.setItem('be_bg3d', on ? 'on' : 'off'); } catch {}
  if (on) buildScene3d(); else document.getElementById('scene3d')?.remove();
}

// ── Theme (Auto / Light / Dark) — per device, resolved to a data-theme on <html> ──
function themePref() { try { return localStorage.getItem('onward_theme') || 'system'; } catch { return 'system'; } }
function effectiveTheme(pref) {
  pref = pref || themePref();
  if (pref === 'system') return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  return pref;
}
function applyTheme() {
  const root = document.documentElement;
  if (!root || !root.setAttribute) return;
  const eff = effectiveTheme();
  root.setAttribute('data-theme', eff);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', eff === 'dark' ? '#0B1120' : '#F4F6FB');
  applyChartTheme();
  // Follow the OS when on Auto — wire the listener once
  if (!window.__themeWired && window.matchMedia) {
    window.__themeWired = true;
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themePref() === 'system') applyTheme(); }); } catch {}
  }
}
// On-brand Chart.js styling — Inter labels, subtle gridlines, clean tooltips,
// theme-aware so graphs read right in both light and dark.
function applyChartTheme() {
  if (typeof Chart === 'undefined' || !Chart.defaults || !Chart.defaults.font) return;
  const dark = effectiveTheme() === 'dark';
  const fam = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.font.family = fam;
  Chart.defaults.font.weight = 600;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = dark ? '#8A9AB5' : '#64748B';
  Chart.defaults.borderColor = dark ? 'rgba(255,255,255,0.06)' : 'rgba(16,24,40,0.06)';
  if (Chart.defaults.elements) {
    if (Chart.defaults.elements.line)  { Chart.defaults.elements.line.tension = 0.38; Chart.defaults.elements.line.borderWidth = 2.5; }
    if (Chart.defaults.elements.point) { Chart.defaults.elements.point.radius = 0; Chart.defaults.elements.point.hoverRadius = 5; Chart.defaults.elements.point.hitRadius = 12; }
    if (Chart.defaults.elements.bar)   { Chart.defaults.elements.bar.borderRadius = 6; }
  }
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = dark ? '#0B1120' : '#0F172A';
  tt.titleColor = '#F1F5F9';
  tt.bodyColor = '#CBD5E1';
  tt.borderColor = 'rgba(255,255,255,0.10)';
  tt.borderWidth = 1;
  tt.padding = 10;
  tt.cornerRadius = 10;
  tt.displayColors = false;
  tt.titleFont = { family: fam, weight: 700, size: 13 };
  tt.bodyFont = { family: fam, weight: 600, size: 12 };
  if (Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {
    Chart.defaults.plugins.legend.labels.font = { family: fam, weight: 600, size: 12 };
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
  }
}
function setTheme(pref) {
  try { localStorage.setItem('onward_theme', pref); } catch {}
  applyTheme();
  if (bg3dEnabled() && typeof buildScene3d === 'function') { document.getElementById('scene3d')?.remove(); buildScene3d(); } // recolour the 3D scene
  if (state && state.page === 'settings') renderSettingsPage();
  showToast('Theme set to ' + (pref === 'system' ? 'Auto' : pref[0].toUpperCase() + pref.slice(1)), 'success');
}

init();
