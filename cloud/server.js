/*
 * Business Escalate — CLOUD backend (Phase 1)
 * ------------------------------------------------------------------
 * Multi-user backend with a real database:
 *   • SQLite locally (zero install) → Postgres in the cloud (see db.js)
 *   • JWT auth (stateless) + scrypt password hashing
 *   • Server-side Anthropic key (no per-user key) + per-IP rate limiting
 *   • Same API as the desktop app, so the existing client works unchanged
 *   • Serves the static client (same origin → installable PWA, no CORS)
 *
 * Run locally:  npm start        (uses ./data.db via SQLite, no setup)
 * Deploy:       set DATABASE_URL → uses Postgres.  See README.md.
 */
'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const DB = require('./db');
const push = require('./push');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash('sha256').update('be-dev-secret-change-me').digest('hex');
const AI_HOURLY_LIMIT = Number(process.env.AI_HOURLY_LIMIT || 60);
const CLIENT_DIR = process.env.CLIENT_DIR || path.join(__dirname, '..', 'public');

// ── Shared helpers (mirrors the desktop server) ──
function defaultData() {
  return { profile: { name: '', gymDaysPerWeek: 5, weeklyIncomeGoal: 0, weeklyNetworkGoal: 3 }, days: [], weeks: [], ideas: [], contacts: [], books: [], weights: [] };
}
function normalizeAnswer(a) { return String(a || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, salt, hash) {
  try { return crypto.timingSafeEqual(Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'), 'hex'), Buffer.from(hash, 'hex')); }
  catch { return false; }
}

// ── JWT (self-contained HS256, no extra dependency) ──
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signJwt(payload, secret, expSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({ iat: now, exp: now + (expSec || 60 * 60 * 24 * 30) }, payload);
  const data = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify(body));
  return data + '.' + b64url(crypto.createHmac('sha256', secret).update(data).digest());
}
function verifyJwt(token, secret) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const data = parts[0] + '.' + parts[1];
    const expected = b64url(crypto.createHmac('sha256', secret).update(data).digest());
    const a = Buffer.from(parts[2]); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const body = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
    return body;
  } catch { return null; }
}

// ── AI prompt + parsing (copied from the desktop server) ──
function buildSystemPrompt(p) {
  const order = ['gym', 'food', 'networking', 'money', 'reading'];
  const meta = {
    gym:        { icon: '💪', def: 'Gym',        line: (l) => `${l.toUpperCase()}: a daily "did I do it?" habit — goal is ${p.gymDaysPerWeek || 5} days/week (builds a streak)` },
    food:       { icon: '🥗', def: 'Food',       line: (l) => `${l.toUpperCase()}: rated daily from 1 to 5 (quality)` },
    networking: { icon: '🤝', def: 'Networking', line: (l) => `${l.toUpperCase()}: a daily count — goal is ${p.weeklyNetworkGoal || 3} per week` },
    money:      { icon: '💰', def: 'Income',     line: (l) => `${l.toUpperCase()}: spending is logged DAILY; income is set per ${p.incomeCadence === 'weekly' ? 'week' : 'month'}. Net (income − spending) and savings rate matter — connect spending to other pillars (e.g. stress, gym, mood) when you can.` },
    reading:    { icon: '📚', def: 'Reading',    line: (l) => `${l.toUpperCase()}: pages read each day + written summaries${p.weeklyReadGoal ? ` — goal is ${p.weeklyReadGoal} pages/week` : ''}` }
  };
  const pillars = p.pillars || null;
  const active = order.filter(id => !pillars || pillars[id] == null || pillars[id].enabled !== false);
  const lines = active.map(id => { const c = (pillars && pillars[id]) || {}; return `- ${c.icon || meta[id].icon} ${meta[id].line(c.label || meta[id].def)}`; }).join('\n');
  const labels = active.map(id => ((pillars && pillars[id] && pillars[id].label) || meta[id].def));
  const areaList = labels.length > 1 ? labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1] : labels[0] || 'their goals';
  return `You are a personal life coach helping someone level up across ${active.length} area${active.length === 1 ? '' : 's'} of their life simultaneously: ${areaList}.

The user is tracking daily:
${lines}
- 💧 WATER: daily hydration, tracked in gallons
- 📔 DAILY NOTES: a short written reflection each day about how the day went
${(p.nutrition && p.nutrition.age && p.nutrition.heightCm && p.nutrition.weightKg) ? `\nThey also have calculated daily nutrition targets — calories, protein/carbs/fat, and a split across ${p.nutrition.mealsPerDay || 3} meals/day (see "nutritionTargets"). They log the actual foods they eat with counted macros (see "foodsEatenToday", "caloriesEatenToday", "proteinEatenToday", and per-day "foodLog"/"eaten"). Compare what they actually ate to their targets and give specific, food-level advice.` : ''}
${p.jobTitle ? `\nRole: ${p.jobTitle}` : ''}${p.jobDescription ? `\nWork/life context: ${p.jobDescription}` : ''}${p.commissionRate ? `\nCommission rate: ${p.commissionRate}%` : ''}

Rules for every response:
- Be SPECIFIC and ACTIONABLE — no generic motivational fluff
- Refer to each area by the user's own name for it (exactly as listed above)
- Connect the dots between the areas
- Use markdown: ## headers, **bold**, bullet points, tables
- End EVERY response with "## Your Next 3 Actions This Week" — three concrete steps to take right now
- Be direct, honest, and motivating`;
}
function buildUserMessage(data, question) {
  return `Here is my lifestyle tracking data:\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\n${question}`;
}
function parseFoodEstimate(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj; try { obj = JSON.parse(m[0]); } catch { return null; }
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
function getApiKey() { return process.env.ANTHROPIC_API_KEY || null; }

// ── Simple per-IP hourly AI rate limit ──
const aiHits = new Map();
function aiAllowed(key) {
  const now = Date.now(), win = 3600000;
  const arr = (aiHits.get(key) || []).filter(t => now - t < win);
  if (arr.length >= AI_HOURLY_LIMIT) { aiHits.set(key, arr); return false; }
  arr.push(now); aiHits.set(key, arr); return true;
}

// ── App ──
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(CLIENT_DIR));

function tokenFrom(req) {
  const a = req.headers.authorization || '';
  if (a.startsWith('Bearer ')) return a.slice(7);
  return (req.body && req.body.token) || req.query.token || null;
}
function requireAuth(req, res, next) {
  const p = verifyJwt(tokenFrom(req), JWT_SECRET);
  if (!p) return res.status(401).json({ error: 'NOT_AUTHED' });
  req.userId = p.sub; req.username = p.username; next();
}
// The app owner(s) — set OWNER_USERNAMES="me,partner" to grant the broadcast tool.
function isOwner(name) {
  if (!name) return false;
  const owners = (process.env.OWNER_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return owners.includes(String(name).toLowerCase());
}

// ── Accounts / auth ──
app.post('/api/signup', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';
    const securityQuestion = (req.body.securityQuestion || '').trim();
    const securityAnswer = (req.body.securityAnswer || '').trim();
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (securityAnswer && securityAnswer.length < 2) return res.status(400).json({ error: 'Your security answer is too short (or leave it blank).' });
    if (await DB.findUserByName(username)) return res.status(409).json({ error: 'That username is already taken.' });
    const { salt, hash } = hashPassword(password);
    let sq = null, ss = null, sh = null;
    if (securityQuestion && securityAnswer.length >= 2) { const s = hashPassword(normalizeAnswer(securityAnswer)); sq = securityQuestion; ss = s.salt; sh = s.hash; }
    const id = await DB.createUser({ username, pw_salt: salt, pw_hash: hash, sec_question: sq, sec_salt: ss, sec_hash: sh });
    await DB.saveData(id, defaultData(), 1);
    res.json({ token: signJwt({ sub: id, username }, JWT_SECRET), username, hasSecurity: !!sq });
  } catch (e) {
    // Backstop the unique-username check against a race (two signups at once)
    if (e && (e.code === '23505' || /unique/i.test(String(e.message || '')))) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    res.status(500).json({ error: 'Sign up failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';
    const u = await DB.findUserByName(username);
    if (!u || !verifyPassword(password, u.pw_salt, u.pw_hash)) return res.status(401).json({ error: 'Wrong username or password.' });
    if (!(await DB.getData(u.id))) await DB.saveData(u.id, defaultData(), 1);
    res.json({ token: signJwt({ sub: u.id, username: u.username }, JWT_SECRET), username: u.username, hasSecurity: !!u.sec_question });
  } catch (e) { res.status(500).json({ error: 'Login failed' }); }
});

// JWT is stateless — logout is client-side token discard
app.post('/api/logout', (req, res) => res.json({ success: true }));

app.get('/api/session', (req, res) => {
  const p = verifyJwt(tokenFrom(req), JWT_SECRET);
  if (!p) return res.json({ authed: false });
  DB.findUserById(p.sub)
    .then(u => u ? res.json({ authed: true, username: u.username, hasSecurity: !!u.sec_question, isOwner: isOwner(u.username) }) : res.json({ authed: false }))
    .catch(() => res.json({ authed: false }));
});

app.post('/api/forgot/question', async (req, res) => {
  try {
    const u = await DB.findUserByName((req.body.username || '').trim());
    if (!u) return res.status(404).json({ error: 'No account with that username.' });
    if (!u.sec_question) return res.status(400).json({ error: 'This account has no security question set. Log in and add one in Settings → Security.' });
    res.json({ question: u.sec_question });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/forgot/reset', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const answer = req.body.answer || '';
    const newPassword = req.body.newPassword || '';
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    const u = await DB.findUserByName(username);
    if (!u || !u.sec_question) return res.status(400).json({ error: 'Could not reset that account.' });
    if (!verifyPassword(normalizeAnswer(answer), u.sec_salt, u.sec_hash)) return res.status(401).json({ error: 'That answer is incorrect.' });
    const { salt, hash } = hashPassword(newPassword);
    await DB.updatePassword(u.id, salt, hash);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const u = await DB.findUserById(req.userId);
    if (!u) return res.status(404).json({ error: 'Account not found.' });
    if (!verifyPassword(req.body.currentPassword || '', u.pw_salt, u.pw_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
    if ((req.body.newPassword || '').length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    const { salt, hash } = hashPassword(req.body.newPassword);
    await DB.updatePassword(u.id, salt, hash);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/set-security', requireAuth, async (req, res) => {
  try {
    const u = await DB.findUserById(req.userId);
    if (!u) return res.status(404).json({ error: 'Account not found.' });
    if (!verifyPassword(req.body.currentPassword || '', u.pw_salt, u.pw_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
    const ques = (req.body.securityQuestion || '').trim();
    const ans = (req.body.securityAnswer || '').trim();
    if (!ques || ans.length < 2) return res.status(400).json({ error: 'Enter a question and an answer.' });
    const s = hashPassword(normalizeAnswer(ans));
    await DB.setSecurity(u.id, ques, s.salt, s.hash);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ── Per-account data (auth required). Backward compatible (raw object) AND
//    supports {data, version} for conflict-guarded multi-device sync. ──
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    let d = await DB.getData(req.userId);
    if (!d) { await DB.saveData(req.userId, defaultData(), 1); return res.json(defaultData()); }
    res.set('X-Data-Version', String(d.version));
    res.json(d.data);
  } catch (e) { res.status(500).json({ error: 'Failed to read data' }); }
});

app.post('/api/data', requireAuth, async (req, res) => {
  try {
    const wrapped = req.body && req.body.data && typeof req.body.data === 'object';
    const data = wrapped ? req.body.data : req.body;
    const clientVersion = wrapped ? req.body.version : undefined;
    const cur = await DB.getData(req.userId);
    const curV = cur ? cur.version : 0;
    if (clientVersion !== undefined && clientVersion !== curV) {
      return res.status(409).json({ error: 'CONFLICT', data: cur ? cur.data : defaultData(), version: curV });
    }
    const newV = curV + 1;
    await DB.saveData(req.userId, data, newV);
    res.json({ success: true, version: newV });
  } catch (e) { res.status(500).json({ error: 'Failed to save data' }); }
});

// ── AI (server-side key, rate-limited; no user key required) ──
app.get('/api/key-status', (req, res) => res.json({ hasKey: !!getApiKey() }));
app.get('/api/settings', (req, res) => res.json({ hasKey: !!getApiKey(), keyPreview: '' }));
app.post('/api/settings', (req, res) => res.json({ success: true }));

function aiGuard(req, res) {
  if (!getApiKey()) { res.status(400).json({ error: 'NO_KEY' }); return false; }
  if (!aiAllowed(req.ip || 'anon')) { res.status(429).json({ error: 'Rate limit reached — try again later.' }); return false; }
  return true;
}

app.post('/api/analyze', async (req, res) => {
  if (!aiGuard(req, res)) return;
  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: [{ type: 'text', text: buildSystemPrompt(req.body.data?.profile || {}), cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: buildUserMessage(req.body.data, req.body.question) }] });
    res.json({ analysis: msg.content[0].text });
  } catch (e) { res.status(500).json({ error: e.message || 'Analysis failed' }); }
});

app.post('/api/analyze-stream', async (req, res) => {
  if (!aiGuard(req, res)) return;
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  let aborted = false; req.on('close', () => { aborted = true; });
  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const stream = client.messages.stream({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: [{ type: 'text', text: buildSystemPrompt(req.body.data?.profile || {}), cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: buildUserMessage(req.body.data, req.body.question) }] });
    stream.on('text', t => { if (!aborted) res.write(`data: ${JSON.stringify({ text: t })}\n\n`); });
    await stream.finalMessage();
    if (!aborted) { res.write('data: [DONE]\n\n'); res.end(); }
  } catch (e) { if (!aborted) { res.write(`data: ${JSON.stringify({ error: e.message || 'Analysis failed' })}\n\n`); res.end(); } }
});

app.post('/api/estimate-food', async (req, res) => {
  if (!aiGuard(req, res)) return;
  const description = String(req.body.description || '').trim();
  if (!description) return res.status(400).json({ error: 'Describe the food first.' });
  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const system = `You are a nutrition estimation engine. Given a description of food someone ate (it may include a quantity), respond with ONLY a JSON object — no prose, no markdown fences — of exactly this form:
{"name": "<short food name>", "grams": <total grams as a number>, "calories": <integer>, "protein": <grams>, "carbs": <grams>, "fat": <grams>}
Estimate realistic values for the WHOLE described amount. If no quantity is given, assume one typical serving. Output the JSON object only.`;
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 300, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'Food eaten: ' + description }] });
    const food = parseFoodEstimate(msg.content && msg.content[0] && msg.content[0].text);
    if (!food) return res.status(502).json({ error: 'Could not estimate that — try describing it differently.' });
    res.json(food);
  } catch (e) { res.status(500).json({ error: e.message || 'Estimate failed' }); }
});

app.post('/api/insight', async (req, res) => {
  if (!aiGuard(req, res)) return;
  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const system = `You are this person's personal life coach. Based on their recent tracking data, write ONE short, specific, motivating insight for today — at most 2 sentences (~45 words). Reference their real numbers or patterns when you can. End with a tiny concrete action if it fits. Output only the insight sentence(s), no markdown or preamble.`;
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 160, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'My recent tracking data:\n\n```json\n' + JSON.stringify(req.body.data, null, 2) + '\n```\n\nGive me today\'s insight.' }] });
    const insight = ((msg.content && msg.content[0] && msg.content[0].text) || '').trim();
    if (!insight) return res.status(502).json({ error: 'No insight generated.' });
    res.json({ insight });
  } catch (e) { res.status(500).json({ error: e.message || 'Insight failed' }); }
});

// ── Today's Game Plan: concrete next actions (works from day one — fixes cold start) ──
app.post('/api/plan', async (req, res) => {
  if (!aiGuard(req, res)) return;
  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const system = `You are this person's personal coach and strategist. From their goals and tracking data, give them a short, concrete GAME PLAN for TODAY — the specific next actions that move them toward their goals.
Rules:
- Open with ONE short bold line naming today's #1 focus.
- Then 2–4 SPECIFIC actions they can do TODAY as a markdown bullet list; start each with a verb and tie it to their real goals/targets/numbers when possible.
- If they're brand new with little or no data, give an encouraging concrete starter plan for today.
- Practical and specific — never generic filler or motivational fluff. ~90 words total. Output only the focus line + the bullets (markdown).`;
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 320, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'My goals and tracking data:\n\n```json\n' + JSON.stringify(req.body.data, null, 2) + '\n```\n\nWhat is my game plan for today?' }] });
    const plan = ((msg.content && msg.content[0] && msg.content[0].text) || '').trim();
    if (!plan) return res.status(502).json({ error: 'No plan generated.' });
    res.json({ plan });
  } catch (e) { res.status(500).json({ error: e.message || 'Plan failed' }); }
});

// ── Patterns: ONE cross-domain connection only a whole-life app could see ──
app.post('/api/patterns', async (req, res) => {
  if (!aiGuard(req, res)) return;
  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const system = `You are this person's personal life coach with a rare advantage: you see EVERY area of their life at once — training, income/money, nutrition, weight, reading, networking, habits, mood notes. Find ONE genuine CROSS-DOMAIN connection in their data that a single-purpose app could never see: a way one area appears to affect another.
Rules:
- Connect TWO DIFFERENT areas (e.g. gym↔income, reading↔mood, protein↔weight, water↔workouts, sleep↔focus). Never an observation about a single area alone.
- Use their REAL numbers and be specific.
- Be honest — only claim a pattern the data actually supports. If there isn't enough data yet for a real cross-domain link, say so warmly in one sentence and name what to keep logging to unlock it.
- 1–2 sentences (~40 words), a little surprising; end with a tiny nudge if it fits.
- Output ONLY the sentence(s): no markdown, headings, lists, or preamble.`;
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 180, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'My tracking data across all areas:\n\n```json\n' + JSON.stringify(req.body.data, null, 2) + '\n```\n\nFind one real cross-domain pattern.' }] });
    const pattern = ((msg.content && msg.content[0] && msg.content[0].text) || '').trim();
    if (!pattern) return res.status(502).json({ error: 'No pattern found.' });
    res.json({ pattern });
  } catch (e) { res.status(500).json({ error: e.message || 'Patterns failed' }); }
});

// ── Weekly Life Review: the Sunday ritual across every pillar ──
app.post('/api/review', async (req, res) => {
  if (!aiGuard(req, res)) return;
  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const system = `You are this person's personal chief-of-staff and coach. Write their WEEKLY LIFE REVIEW from their tracking data across every area of life. Make it feel personal and earned — reference their real numbers.
Use EXACTLY these three short markdown sections and nothing else:
**🏆 Wins this week** — 2–3 bullets of what genuinely went well.
**🔗 The pattern I noticed** — ONE cross-domain connection between two different areas (e.g. training↔income, reading↔focus, protein↔weight). This is the most important part.
**🎯 Focus for next week** — ONE concrete priority phrased as a single action.
Rules: warm, direct, no fluff or generic filler; use their actual data. If the week is thin on data, keep it short and honest. ~120 words total. Output only the three sections.`;
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 450, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'My tracking data:\n\n```json\n' + JSON.stringify(req.body.data, null, 2) + '\n```\n\nWrite my weekly review' + (req.body.weekLabel ? ' for the week of ' + req.body.weekLabel : '') + '.' }] });
    const review = ((msg.content && msg.content[0] && msg.content[0].text) || '').trim();
    if (!review) return res.status(502).json({ error: 'No review generated.' });
    res.json({ review });
  } catch (e) { res.status(500).json({ error: e.message || 'Review failed' }); }
});

// ── Web push (reminders that reach the phone even when the app is closed) ──
app.get('/api/push/key', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || '' }));

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const sub = req.body.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Bad subscription' });
    await DB.savePushSub(req.userId, sub);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Could not save subscription' }); }
});

app.post('/api/push/test', requireAuth, async (req, res) => {
  if (!push.configured()) return res.status(400).json({ error: 'Push not configured on the server.' });
  try {
    const subs = (await DB.allPushSubs()).filter(s => String(s.user_id) === String(req.userId));
    let sent = 0;
    for (const s of subs) { try { await push.sendPush(s.sub, { title: '🔔 Test notification', body: 'Push is working — see you every day!', url: './' }); sent++; } catch (e) {} }
    res.json({ sent });
  } catch (e) { res.status(500).json({ error: 'Send failed' }); }
});

// Owner-only: how many devices a broadcast would reach.
app.get('/api/admin/reach', requireAuth, async (req, res) => {
  if (!isOwner(req.username)) return res.status(403).json({ error: 'Not allowed.' });
  try { const subs = await DB.allPushSubs(); res.json({ devices: subs.length, users: new Set(subs.map(s => String(s.user_id))).size }); }
  catch { res.json({ devices: 0, users: 0 }); }
});

// Owner-only: live usage numbers (how many people use it & how active they are).
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  if (!isOwner(req.username)) return res.status(403).json({ error: 'Not allowed.' });
  try {
    const [users, dataRows, subs] = await Promise.all([DB.allUsers(), DB.allUserData(), DB.allPushSubs()]);
    const byId = {}; dataRows.forEach(r => { byId[String(r.user_id)] = r.data || {}; });
    const DAY = 86400000;
    const today = new Date().toISOString().split('T')[0];
    const dayWithin = (ds, n) => { if (!ds) return false; const t = Date.parse(ds + 'T00:00:00Z'); return !isNaN(t) && Date.now() - t < n * DAY && Date.now() - t > -DAY; };
    const createdWithin = (c, n) => { if (!c) return false; const t = Date.parse(c); return !isNaN(t) && Date.now() - t < n * DAY; };
    let loggedToday = 0, active7 = 0, active30 = 0, totalDays = 0;
    const rows = users.map(u => {
      const days = Array.isArray((byId[String(u.id)] || {}).days) ? byId[String(u.id)].days : [];
      const dates = days.map(d => d && d.date).filter(Boolean);
      totalDays += days.length;
      if (dates.includes(today)) loggedToday++;
      if (dates.some(d => dayWithin(d, 7))) active7++;
      if (dates.some(d => dayWithin(d, 30))) active30++;
      return { username: u.username, days: days.length, last: dates.sort().slice(-1)[0] || null };
    });
    rows.sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')) || b.days - a.days);
    res.json({
      totalUsers: users.length, loggedToday, active7, active30, totalDays,
      avgDays: users.length ? +(totalDays / users.length).toFixed(1) : 0,
      pushDevices: subs.length,
      newToday: users.filter(u => createdWithin(u.created_at, 1)).length,
      new7: users.filter(u => createdWithin(u.created_at, 7)).length,
      recent: rows.slice(0, 20)
    });
  } catch (e) { res.status(500).json({ error: 'Stats failed' }); }
});

// Owner-only: push a custom notification to every subscribed device.
app.post('/api/admin/broadcast', requireAuth, async (req, res) => {
  if (!isOwner(req.username)) return res.status(403).json({ error: 'Not allowed.' });
  if (!push.configured()) return res.status(400).json({ error: 'Push not configured on the server.' });
  const title = String(req.body.title || '').trim().slice(0, 80);
  const body = String(req.body.body || '').trim().slice(0, 300);
  if (!title) return res.status(400).json({ error: 'A title is required.' });
  try {
    const subs = await DB.allPushSubs();
    let sent = 0, failed = 0;
    for (const s of subs) {
      try { await push.sendPush(s.sub, { title, body, url: './' }); sent++; }
      catch (e) { failed++; if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { await DB.deletePushSub(s.sub.endpoint); } catch {} } }
    }
    res.json({ sent, failed, devices: subs.length });
  } catch (e) { res.status(500).json({ error: 'Broadcast failed' }); }
});

// Called by an external cron (e.g. cron-job.org) every minute. Sends due reminders.
app.post('/api/cron/tick', async (req, res) => {
  const secret = req.query.secret || req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'bad secret' });
  if (!push.configured()) return res.json({ sent: 0, note: 'VAPID not configured' });
  try {
    const allSubs = await DB.allPushSubs();
    const byUser = {};
    allSubs.forEach(s => { (byUser[s.user_id] = byUser[s.user_id] || []).push(s.sub); });
    let sent = 0;
    for (const uid of Object.keys(byUser)) {
      const d = await DB.getData(uid);
      if (!d || !d.data) continue;
      const data = d.data;
      const profile = data.profile || {};
      const tz = Number(profile.tz);
      const local = push.userLocal(Number.isFinite(tz) ? tz : 0);
      let changed = false;

      // 1) Due reminders the user set
      for (const r of (data.reminders || [])) {
        if (!push.isReminderDue(r, local.hhmm, local.date)) continue;
        for (const sub of byUser[uid]) {
          try { await push.sendPush(sub, { title: '⏰ ' + r.label, body: 'Business Escalate', url: './', tag: r.id }); sent++; }
          catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { await DB.deletePushSub(sub.endpoint); } catch {} } }
        }
        r._lastFired = local.date; changed = true;
      }

      // 2) Daily streak nudge — once/day, evening, only if they haven't logged today
      const loggedToday = (data.days || []).some(x => x.date === local.date);
      if (push.isNudgeDue({ hhmm: local.hhmm, date: local.date, nudgeHour: profile.nudgeHour, loggedToday, lastNudge: data._lastNudge, enabled: profile.dailyNudge })) {
        const name = profile.firstName || profile.name || '';
        for (const sub of byUser[uid]) {
          try { await push.sendPush(sub, { title: '🔥 Keep your streak alive', body: (name ? name + ', ' : '') + "you haven't logged today — it takes 30 seconds.", url: './', tag: 'daily-nudge' }); sent++; }
          catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { await DB.deletePushSub(sub.endpoint); } catch {} } }
        }
        data._lastNudge = local.date; changed = true;
      }

      // Conditional metadata write: only if the client hasn't saved since we read.
      // Never bumps the version, so it can't clobber user data or force client conflicts.
      if (changed) await DB.saveDataMeta(uid, data, d.version);
    }
    res.json({ sent });
  } catch (e) { res.status(500).json({ error: 'cron failed' }); }
});

// SPA fallback → serve the client for any non-API route
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));

if (require.main === module) {
  DB.init()
    .then(() => app.listen(PORT, () => console.log('Business Escalate cloud server on :' + PORT + ' (db: ' + DB.kind() + ')')))
    .catch(err => { console.error('Startup failed:', err.message); process.exit(1); });
}

module.exports = { app, defaultData, normalizeAnswer, hashPassword, verifyPassword, signJwt, verifyJwt, buildSystemPrompt, parseFoodEstimate, isOwner };
