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
    money:      { icon: '💰', def: 'Income',     line: (l) => `${l.toUpperCase()}: a dollar amount + activities — weekly goal $${p.weeklyIncomeGoal || 'not set'}` },
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
  req.userId = p.sub; next();
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
  } catch (e) { res.status(500).json({ error: 'Sign up failed' }); }
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
    .then(u => u ? res.json({ authed: true, username: u.username, hasSecurity: !!u.sec_question }) : res.json({ authed: false }))
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

// SPA fallback → serve the client for any non-API route
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));

if (require.main === module) {
  DB.init()
    .then(() => app.listen(PORT, () => console.log('Business Escalate cloud server on :' + PORT + ' (db: ' + DB.kind() + ')')))
    .catch(err => { console.error('Startup failed:', err.message); process.exit(1); });
}

module.exports = { app, defaultData, normalizeAnswer, hashPassword, verifyPassword, signJwt, verifyJwt, buildSystemPrompt, parseFoodEstimate };
