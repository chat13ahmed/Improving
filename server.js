const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 4891;
// Bind address: defaults to localhost-only (safe, used by the desktop app).
// Set HOST=0.0.0.0 to make it reachable from other devices on your Wi-Fi (e.g. your phone).
const HOST = process.env.HOST || '127.0.0.1';

const BASE_DIR = process.env.USER_DATA
  ? path.join(process.env.USER_DATA, 'business-escalate')
  : path.join(__dirname, 'data');

const crypto = require('crypto');

const LEGACY_DATA_FILE = path.join(BASE_DIR, 'data.json'); // pre-accounts single-user data (migrated on first signup)
const SETTINGS_FILE    = path.join(BASE_DIR, 'settings.json'); // machine-level (shared API key)
const ACCOUNTS_FILE    = path.join(BASE_DIR, 'accounts.json');
const SESSIONS_FILE    = path.join(BASE_DIR, 'sessions.json');

if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ apiKey: '' }, null, 2));
if (!fs.existsSync(ACCOUNTS_FILE)) fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, JSON.stringify([], null, 2));

function defaultData() {
  return { profile: { name: '', gymDaysPerWeek: 5, weeklyIncomeGoal: 0, weeklyNetworkGoal: 3 }, days: [], weeks: [], ideas: [], contacts: [], books: [] };
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

function readAccounts()   { return readJson(ACCOUNTS_FILE, []); }
function writeAccounts(a) { writeJson(ACCOUNTS_FILE, a); }
function readSessions()   { return readJson(SESSIONS_FILE, []); }
function writeSessions(s) { writeJson(SESSIONS_FILE, s); }

function dataFileFor(id)  { return path.join(BASE_DIR, 'data-' + id + '.json'); }
function readData(id)     { return readJson(dataFileFor(id), defaultData()); }
function writeData(id, d) {
  const file = dataFileFor(id);
  // Auto-backup: keep a rolling copy of the previous save so a crash never wipes everything
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + '.backup'); } catch {}
  }
  writeJson(file, d);
}

function readSettings() { return readJson(SETTINGS_FILE, { apiKey: '' }); }
function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try { return readSettings().apiKey || null; } catch { return null; }
}

// ── Auth helpers (scrypt password hashing, file-backed sessions) ──
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function newId()    { return crypto.randomBytes(8).toString('hex'); }
function normalizeAnswer(a) { return String(a || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function tokenFrom(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return (req.body && req.body.token) || req.query.token || null;
}
function requireAuth(req, res, next) {
  const sess = readSessions().find(s => s.token === tokenFrom(req));
  if (!sess) return res.status(401).json({ error: 'NOT_AUTHED' });
  req.accountId = sess.accountId;
  next();
}

// Extracted so both endpoints share the same cached system prompt.
// The user can rename / disable pillars, so the prompt is built from
// their live pillar config — the coach always speaks in THEIR terms.
function buildSystemPrompt(p) {
  const order = ['gym', 'food', 'networking', 'money', 'reading'];
  const meta = {
    gym:        { icon: '💪', def: 'Gym',        line: (lbl) => `${lbl.toUpperCase()}: a daily "did I do it?" habit — goal is ${p.gymDaysPerWeek || 5} days/week (builds a streak)` },
    food:       { icon: '🥗', def: 'Food',       line: (lbl) => `${lbl.toUpperCase()}: rated daily from 1 to 5 (quality)` },
    networking: { icon: '🤝', def: 'Networking', line: (lbl) => `${lbl.toUpperCase()}: a daily count — goal is ${p.weeklyNetworkGoal || 3} per week` },
    money:      { icon: '💰', def: 'Income',     line: (lbl) => `${lbl.toUpperCase()}: spending is logged DAILY; income is set per ${p.incomeCadence === 'weekly' ? 'week' : 'month'}. Net (income − spending) and savings rate matter — connect spending to other pillars (e.g. stress, gym, mood) when you can.` },
    reading:    { icon: '📚', def: 'Reading',    line: (lbl) => `${lbl.toUpperCase()}: pages read each day + written summaries${p.weeklyReadGoal ? ` — goal is ${p.weeklyReadGoal} pages/week` : ''}` }
  };
  const pillars = p.pillars || null;
  const active = order.filter(id => !pillars || pillars[id] == null || pillars[id].enabled !== false);
  const lines = active.map(id => {
    const cfg = (pillars && pillars[id]) || {};
    const icon = cfg.icon || meta[id].icon;
    const label = cfg.label || meta[id].def;
    return `- ${icon} ${meta[id].line(label)}`;
  }).join('\n');
  const labels = active.map(id => ((pillars && pillars[id] && pillars[id].label) || meta[id].def));
  const areaList = labels.length > 1
    ? labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1]
    : labels[0] || 'their goals';

  return `You are a personal life coach helping someone level up across ${active.length} area${active.length === 1 ? '' : 's'} of their life simultaneously: ${areaList}.

The user is tracking daily:
${lines}
- 💧 WATER: daily hydration, tracked in gallons
- 📔 DAILY NOTES: a short written reflection each day about how the day went
${(p.nutrition && p.nutrition.age && p.nutrition.heightCm && p.nutrition.weightKg) ? `\nThey also have calculated daily nutrition targets — calories, protein/carbs/fat, and a split across ${p.nutrition.mealsPerDay || 3} meals/day (see "nutritionTargets"). They log the actual foods they eat with counted macros (see "foodsEatenToday", "caloriesEatenToday", "proteinEatenToday", and per-day "foodLog"/"eaten"). Compare what they actually ate to their targets and give specific, food-level advice (what to add or cut to hit their protein and calorie goals).` : ''}
${p.jobTitle ? `\nRole: ${p.jobTitle}` : ''}${p.jobDescription ? `\nWork/life context: ${p.jobDescription}` : ''}${p.commissionRate ? `\nCommission rate: ${p.commissionRate}%` : ''}

Rules for every response:
- Be SPECIFIC and ACTIONABLE — no generic motivational fluff
- Refer to each area by the user's own name for it (exactly as listed above)
- Connect the dots between the areas (e.g. how hydration and sleep affect energy, how discipline in one area carries into another)
- When relevant, reference patterns in their daily notes — show them you've read their reflections
- Use markdown: ## headers, **bold**, bullet points, tables
- End EVERY response with "## Your Next 3 Actions This Week" — three concrete steps to take right now
- Be direct, honest, and motivating`;
}

function buildUserMessage(data, question) {
  return `Here is my lifestyle tracking data:\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\n${question}`;
}

// Parse Claude's food-estimate reply into clean macro numbers. Tolerant of
// code fences, surrounding prose, and alternative key names.
function parseFoodEstimate(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const num = (v) => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; };
  const r1 = (v) => Math.round(num(v) * 10) / 10;
  const name = String(obj.name || obj.food || '').slice(0, 80).trim() || 'Food (AI estimate)';
  const grams = Math.round(num(obj.grams ?? obj.serving_grams ?? obj.servingGrams));
  const kcal = Math.round(num(obj.calories ?? obj.kcal ?? obj.cal));
  const p = r1(obj.protein ?? obj.protein_g ?? obj.proteinG);
  const c = r1(obj.carbs ?? obj.carbohydrates ?? obj.carbs_g ?? obj.carbsG);
  const f = r1(obj.fat ?? obj.fat_g ?? obj.fatG);
  if (kcal === 0 && p === 0 && c === 0 && f === 0) return null;
  return { name, grams, kcal, p, c, f };
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Accounts / auth ──
app.post('/api/signup', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const email = (req.body.email || '').trim().toLowerCase();
  const phone = (req.body.phone || '').trim();
  const securityQuestion = (req.body.securityQuestion || '').trim();
  const securityAnswer = (req.body.securityAnswer || '').trim();
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  // Security question is OPTIONAL — only validate it if an answer was provided
  if (securityAnswer && securityAnswer.length < 2) return res.status(400).json({ error: 'Your security answer is too short (or leave it blank).' });
  const accounts = readAccounts();
  // One account per person — username, email, and phone must each be unused
  if (accounts.some(a => a.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'That username is already taken.' });
  if (accounts.some(a => (a.email || '').toLowerCase() === email))
    return res.status(409).json({ error: 'An account already exists with that email.' });
  if (phone && accounts.some(a => a.phone === phone))
    return res.status(409).json({ error: 'An account already exists with that phone number.' });
  const id = newId();
  const { salt, hash } = hashPassword(password);
  const account = { id, username, email, phone, salt, hash, createdAt: new Date().toISOString() };
  if (securityQuestion && securityAnswer.length >= 2) {
    const sec = hashPassword(normalizeAnswer(securityAnswer));
    account.securityQuestion = securityQuestion; account.secSalt = sec.salt; account.secHash = sec.hash;
  }
  accounts.push(account);
  writeAccounts(accounts);

  // Seed data — migrate the old single-user data.json into the FIRST account so nothing is lost
  let seed = defaultData();
  if (accounts.length === 1 && fs.existsSync(LEGACY_DATA_FILE)) {
    try { seed = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8')); } catch {}
  }
  seed.profile = { ...(seed.profile || {}), email, phone };
  writeData(id, seed);

  const token = newToken();
  const sessions = readSessions(); sessions.push({ token, accountId: id, createdAt: Date.now() }); writeSessions(sessions);
  res.json({ token, username, hasSecurity: !!account.securityQuestion });
});

app.post('/api/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const account = readAccounts().find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!account || !verifyPassword(password, account.salt, account.hash))
    return res.status(401).json({ error: 'Wrong username or password.' });
  if (!fs.existsSync(dataFileFor(account.id))) writeData(account.id, defaultData());
  const token = newToken();
  const sessions = readSessions(); sessions.push({ token, accountId: account.id, createdAt: Date.now() }); writeSessions(sessions);
  res.json({ token, username: account.username, hasSecurity: !!account.securityQuestion });
});

// ── Password recovery (security question — works offline) ──
app.post('/api/forgot/question', (req, res) => {
  const account = readAccounts().find(a => a.username.toLowerCase() === (req.body.username || '').trim().toLowerCase());
  if (!account) return res.status(404).json({ error: 'No account with that username.' });
  if (!account.securityQuestion) return res.status(400).json({ error: 'This account has no security question set. Log in and add one in Settings → Security.' });
  res.json({ question: account.securityQuestion });
});

app.post('/api/forgot/reset', (req, res) => {
  const username = (req.body.username || '').trim();
  const answer = req.body.answer || '';
  const newPassword = req.body.newPassword || '';
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const accounts = readAccounts();
  const account = accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!account || !account.securityQuestion) return res.status(400).json({ error: 'Could not reset that account.' });
  if (!verifyPassword(normalizeAnswer(answer), account.secSalt, account.secHash))
    return res.status(401).json({ error: 'That answer is incorrect.' });
  const { salt, hash } = hashPassword(newPassword);
  account.salt = salt; account.hash = hash;
  writeAccounts(accounts);
  writeSessions(readSessions().filter(s => s.accountId !== account.id)); // log out everywhere
  res.json({ success: true });
});

// ── Account security (logged in) ──
app.post('/api/change-password', requireAuth, (req, res) => {
  const accounts = readAccounts();
  const account = accounts.find(a => a.id === req.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  if (!verifyPassword(req.body.currentPassword || '', account.salt, account.hash))
    return res.status(401).json({ error: 'Current password is incorrect.' });
  if ((req.body.newPassword || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const { salt, hash } = hashPassword(req.body.newPassword);
  account.salt = salt; account.hash = hash;
  writeAccounts(accounts);
  res.json({ success: true });
});

app.post('/api/set-security', requireAuth, (req, res) => {
  const accounts = readAccounts();
  const account = accounts.find(a => a.id === req.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  if (!verifyPassword(req.body.currentPassword || '', account.salt, account.hash))
    return res.status(401).json({ error: 'Current password is incorrect.' });
  const q = (req.body.securityQuestion || '').trim();
  const a = (req.body.securityAnswer || '').trim();
  if (!q || a.length < 2) return res.status(400).json({ error: 'Enter a question and an answer.' });
  const sec = hashPassword(normalizeAnswer(a));
  account.securityQuestion = q; account.secSalt = sec.salt; account.secHash = sec.hash;
  writeAccounts(accounts);
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  const token = tokenFrom(req);
  writeSessions(readSessions().filter(s => s.token !== token));
  res.json({ success: true });
});

app.get('/api/session', (req, res) => {
  const sess = readSessions().find(s => s.token === tokenFrom(req));
  if (!sess) return res.json({ authed: false });
  const account = readAccounts().find(a => a.id === sess.accountId);
  if (!account) return res.json({ authed: false });
  res.json({ authed: true, username: account.username, hasSecurity: !!account.securityQuestion });
});

// ── Per-account data (auth required) ──
// Single-user local server: no real conflicts, but it must accept the same wrapped
// { data, version } payload the shared client now sends, and unwrap it.
app.get('/api/data',  requireAuth, (req, res) => { try { res.set('X-Data-Version', '1'); res.json(readData(req.accountId)); } catch { res.status(500).json({ error: 'Failed to read data' }); } });
app.post('/api/data', requireAuth, (req, res) => {
  try {
    const wrapped = req.body && req.body.data && typeof req.body.data === 'object';
    writeData(req.accountId, wrapped ? req.body.data : req.body);
    res.json({ success: true, version: (wrapped && Number(req.body.version) || 0) + 1 });
  } catch { res.status(500).json({ error: 'Failed to save data' }); }
});
app.get('/api/key-status', (req, res) => { res.json({ hasKey: !!getApiKey() }); });

// ── Notification helpers (no auth — read-only, local-only) ──
// Checks if the first account logged today (for the 8 PM desktop reminder)
app.get('/api/reminder-check', (req, res) => {
  try {
    const accounts = readAccounts();
    if (!accounts.length) return res.json({ loggedToday: true }); // no accounts yet, stay quiet
    const data = readData(accounts[0].id);
    const today = new Date().toISOString().split('T')[0];
    res.json({ loggedToday: (data.days || []).some(d => d.date === today) });
  } catch { res.json({ loggedToday: true }); }
});

// Returns a short week-in-review message for the Sunday evening notification
app.get('/api/week-summary', (req, res) => {
  try {
    const accounts = readAccounts();
    if (!accounts.length) return res.json({ message: "Open the dashboard to review your week!" });
    const data = readData(accounts[0].id);
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekDays = (data.days || []).filter(d => d.date >= weekStartStr);
    const gymDays = weekDays.filter(d => d.gym?.done).length;
    const gymGoal = data.profile?.gymDaysPerWeek || 5;
    const networkCount = weekDays.reduce((s, d) => s + (d.networking?.count || 0), 0);
    const networkGoal = data.profile?.weeklyNetworkGoal || 3;
    const income = (data.weeks || []).find(w => w.weekStart === weekStartStr)?.income || 0;
    const incomeGoal = data.profile?.weeklyIncomeGoal || 0;
    const parts = [];
    parts.push(`💪 ${gymDays}/${gymGoal} gym days`);
    if (networkCount > 0 || networkGoal > 0) parts.push(`🤝 ${networkCount}/${networkGoal} connections`);
    if (income > 0 || incomeGoal > 0) parts.push(`💰 $${income}${incomeGoal > 0 ? '/$' + incomeGoal : ''} income`);
    const message = parts.length > 0
      ? `This week: ${parts.join(' · ')}. Open the app to review!`
      : "Time to reflect on your week — open the dashboard!";
    res.json({ message });
  } catch { res.json({ message: "Time to reflect on your week — open the dashboard!" }); }
});

app.get('/api/settings', (req, res) => {
  try { const s = readSettings(); res.json({ hasKey: !!s.apiKey, keyPreview: s.apiKey ? s.apiKey.slice(0, 10) + '…' : '' }); }
  catch { res.json({ hasKey: false, keyPreview: '' }); }
});

app.post('/api/settings', (req, res) => {
  try { const u = { ...readSettings(), ...req.body }; fs.writeFileSync(SETTINGS_FILE, JSON.stringify(u, null, 2)); res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Could not save settings' }); }
});

// Non-streaming fallback (kept for safety)
app.post('/api/analyze', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'NO_KEY' });
  const { data, question } = req.body;
  try {
    const client = new Anthropic({ apiKey });
    const p = data?.profile || {};
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: [{ type: 'text', text: buildSystemPrompt(p), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(data, question) }]
    });
    res.json({ analysis: message.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// Streaming endpoint — uses Server-Sent Events for real-time word-by-word output
app.post('/api/analyze-stream', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'NO_KEY' });
  const { data, question } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    const client = new Anthropic({ apiKey });
    const p = data?.profile || {};

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: [{ type: 'text', text: buildSystemPrompt(p), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(data, question) }]
    });

    stream.on('text', text => {
      if (!aborted) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    await stream.finalMessage();

    if (!aborted) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!aborted) {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Analysis failed' })}\n\n`);
      res.end();
    }
  }
});

// AI food-macro estimate — for foods not in the built-in database
app.post('/api/estimate-food', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'NO_KEY' });
  const description = String(req.body.description || '').trim();
  if (!description) return res.status(400).json({ error: 'Describe the food first.' });
  try {
    const client = new Anthropic({ apiKey });
    const system = `You are a nutrition estimation engine. Given a description of food someone ate (it may include a quantity), respond with ONLY a JSON object — no prose, no markdown fences — of exactly this form:
{"name": "<short food name>", "grams": <total grams as a number>, "calories": <integer>, "protein": <grams>, "carbs": <grams>, "fat": <grams>}
Estimate realistic values for the WHOLE described amount. If no quantity is given, assume one typical serving. Use your best nutrition knowledge for natural, whole, and common prepared/restaurant foods. Output the JSON object only.`;
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Food eaten: ' + description }]
    });
    const food = parseFoodEstimate(message.content && message.content[0] && message.content[0].text);
    if (!food) return res.status(502).json({ error: 'Could not estimate that — try describing it differently.' });
    res.json(food);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Estimate failed' });
  }
});

// Proactive daily insight — one short, specific coaching nudge from the user's data
app.post('/api/insight', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'NO_KEY' });
  const { data } = req.body;
  try {
    const client = new Anthropic({ apiKey });
    const system = `You are this person's personal life coach. Based on their recent tracking data, write ONE short, specific, motivating insight for today — at most 2 sentences (~45 words). Reference their real numbers or patterns when you can. Be warm and direct, and end with a tiny concrete action if it fits. Do NOT use markdown, headings, lists, or any preamble — output only the insight sentence(s).`;
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 160,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'My recent tracking data:\n\n```json\n' + JSON.stringify(data, null, 2) + '\n```\n\nGive me today\'s insight.' }]
    });
    const insight = ((message.content && message.content[0] && message.content[0].text) || '').trim();
    if (!insight) return res.status(502).json({ error: 'No insight generated.' });
    res.json({ insight });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Insight failed' });
  }
});

// ── Today's Game Plan: concrete next actions (works from day one — fixes cold start) ──
app.post('/api/plan', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'NO_KEY' });
  try {
    const client = new Anthropic({ apiKey });
    const system = `You are this person's personal coach and strategist. From their goals and tracking data, give them a short, concrete GAME PLAN for TODAY — the specific next actions that move them toward their goals.
Rules:
- Open with ONE short bold line naming today's #1 focus.
- Then 2–4 SPECIFIC actions they can do TODAY as a markdown bullet list; start each with a verb and tie it to their real goals/targets/numbers when possible.
- If they're brand new with little or no data, give an encouraging concrete starter plan for today.
- Practical and specific — never generic filler or motivational fluff. ~90 words total. Output only the focus line + the bullets (markdown).`;
    const message = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 320, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'My goals and tracking data:\n\n```json\n' + JSON.stringify(req.body.data, null, 2) + '\n```\n\nWhat is my game plan for today?' }] });
    const plan = ((message.content && message.content[0] && message.content[0].text) || '').trim();
    if (!plan) return res.status(502).json({ error: 'No plan generated.' });
    res.json({ plan });
  } catch (err) { res.status(500).json({ error: err.message || 'Plan failed' }); }
});

// ── Patterns: ONE cross-domain connection only a whole-life app could see ──
app.post('/api/patterns', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'NO_KEY' });
  try {
    const client = new Anthropic({ apiKey });
    const system = `You are this person's personal life coach with a rare advantage: you see EVERY area of their life at once — training, income/money, nutrition, weight, reading, networking, habits, mood notes. Find ONE genuine CROSS-DOMAIN connection in their data that a single-purpose app could never see: a way one area appears to affect another.
Rules:
- Connect TWO DIFFERENT areas (e.g. gym↔income, reading↔mood, protein↔weight, water↔workouts). Never an observation about a single area alone.
- Use their REAL numbers and be specific.
- Be honest — only claim a pattern the data actually supports. If there isn't enough data yet for a real cross-domain link, say so warmly in one sentence and name what to keep logging to unlock it.
- 1–2 sentences (~40 words), a little surprising; end with a tiny nudge if it fits.
- Output ONLY the sentence(s): no markdown, headings, lists, or preamble.`;
    const message = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 180, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'My tracking data across all areas:\n\n```json\n' + JSON.stringify(req.body.data, null, 2) + '\n```\n\nFind one real cross-domain pattern.' }] });
    const pattern = ((message.content && message.content[0] && message.content[0].text) || '').trim();
    if (!pattern) return res.status(502).json({ error: 'No pattern found.' });
    res.json({ pattern });
  } catch (err) { res.status(500).json({ error: err.message || 'Patterns failed' }); }
});

// ── Weekly Life Review: the Sunday ritual across every pillar ──
app.post('/api/review', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(400).json({ error: 'NO_KEY' });
  try {
    const client = new Anthropic({ apiKey });
    const system = `You are this person's personal chief-of-staff and coach. Write their WEEKLY LIFE REVIEW from their tracking data across every area of life. Make it feel personal and earned — reference their real numbers.
Use EXACTLY these three short markdown sections and nothing else:
**🏆 Wins this week** — 2–3 bullets of what genuinely went well.
**🔗 The pattern I noticed** — ONE cross-domain connection between two different areas (e.g. training↔income, reading↔focus, protein↔weight). This is the most important part.
**🎯 Focus for next week** — ONE concrete priority phrased as a single action.
Rules: warm, direct, no fluff or generic filler; use their actual data. If the week is thin on data, keep it short and honest. ~120 words total. Output only the three sections.`;
    const message = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 450, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'My tracking data:\n\n```json\n' + JSON.stringify(req.body.data, null, 2) + '\n```\n\nWrite my weekly review' + (req.body.weekLabel ? ' for the week of ' + req.body.weekLabel : '') + '.' }] });
    const review = ((message.content && message.content[0] && message.content[0].text) || '').trim();
    if (!review) return res.status(502).json({ error: 'No review generated.' });
    res.json({ review });
  } catch (err) { res.status(500).json({ error: err.message || 'Review failed' }); }
});

app.listen(PORT, HOST, () => {
  console.log(`Business Escalate server ready on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') console.log('LAN mode: open http://<your-computer-IP>:' + PORT + ' from a phone on the same Wi-Fi');
  console.log(`Data stored in: ${BASE_DIR}`);
});

module.exports = { parseFoodEstimate, buildSystemPrompt };
