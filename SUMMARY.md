# Onward — Project Summary

**Onward** is one simple app to build habits and track your whole life — fitness, money, reading, nutrition, business — in about 30 seconds a day, with an AI coach that keeps you accountable and shows how it all connects.

Installable PWA · works on phone and desktop · light + dark mode.

---

## Status

- **Built, polished, and secured** — feature-rich, professionally designed, unit-tested.
- **Not yet live / 0 users.** The remaining work is *distribution*, not features: deploy to Render, set the env vars below, and get the first handful of real people using it.
- Test suite: **492 assertions**, all passing (`npm test`).

---

## What's inside (feature map)

### Daily core
- **Dashboard** — a greeting "summit" hero, *Today's One Move* (the single best next action), weekly progress score, per-pillar cards, and a quick-jump grid.
- **Log Today** — a 30-second guided flow (one question at a time) *and* a full form.
- **Stats live inside each hub** — the separate Statistics page is retired; every overview (Health / Business / Knowledge) opens with **animated stat rings** (pillar-coloured progress rings, count-up numbers, week-over-week arrows, a glow pulse at 100%), and the charts moved to their natural tabs (gym chart → Health·Training, 12-week money chart → Finances, money circle → Business).
- **Checklist & reminders** — recurring tasks and web-push reminders.

### Health hub (Training · Nutrition · Body)
- **Workout tracker** — a **197-exercise library** across 7 groups, 13 ready-made programs, a wall-clock **rest timer**, set/rep/volume logging, and body **muscle-map** visualisations.
- **Nutrition** — bodyweight-based calorie + macro targets, per-meal logging, macro bars, a meal plan.
- **Gym × Nutrition "Fuel" card** — cross-references your training frequency with your protein intake and tells you if your eating matches your training (with a concrete food fix). Post-workout toast nudges you to refuel.

### Business hub (Overview · Finances · Ideas · Contacts)
- **Finances (personal-CFO dashboard)** — Net Worth + trend chart, Savings Rate, Emergency Fund, **Financial Independence** number & progress, portfolio-allocation donut, active-vs-passive income, business **P&L** (revenue/profit/margin), and **debt payoff** in avalanche order with computed debt-free dates. One editor captures a monthly snapshot.
- **Ideas** — idea scoring, a Lean-Startup validation module, and an AI validation coach.
- **Contacts** — a lightweight CRM with a weighted sales pipeline and "going cold" detection.

### Knowledge hub (Overview · Reading · Vocabulary)
- **Reading** — a **255-book** curated library (auto cover art), reading streak, a **pace projection** ("finish by …"), per-book **chapters**, and notes grouped **Book → Chapter → note** with page + highlighted quote.
- **Key Takeaways** — capture lessons; they **resurface** for review over time, plus a **takeaway quiz** (active recall: finish the lesson from memory, graded on the same Leitner schedule).
- **Vocabulary** — capture a word with its source sentence + page, then **spaced-repetition flashcard review** (Leitner) so words stick permanently.
- **Year in Knowledge** — a shareable recap card: books finished, pages read, best streak, words learned/mastered, lessons saved.

### Money
- Income (weekly/monthly/daily cadence), spending, net, savings goal, money circle.

### Community & social
- A shared community feed (thoughts / programs / meals).
- A normalised **collective-knowledge backend** (reading groups, group notes with upvotes, threaded replies, confusion flags → group notifications). *Backend/API only — no UI yet.*

### AI Coach
- **Bring-your-own-key**, multi-provider: **Anthropic (Claude), OpenAI (GPT), Google (Gemini),** or **any OpenAI-compatible** endpoint (OpenRouter, Groq, …). Auto-detects the provider from the key.
- Powers coach chat, full-life audit, daily insight, game plan, cross-domain patterns, weekly review, and food estimates.

### Admin console (owner-only)
- A dedicated, gated dashboard: total/active users, growth, engagement (DAU/WAU/MAU, stickiness, retention), feature-adoption bars, revenue & reach, a users table, plus broadcast-push and grant-Pro tools.

---

## Design system

- **Inter** typeface + tabular figures, antialiased rendering.
- Soft, layered elevation (no neon glows); rounder radii; confident large titles.
- **Dark mode** — Auto / Light / Dark, follows the OS, per-device.
- **Native mobile feel** — fixed frosted header + bottom bar, instant taps, smooth page transitions, a cohesive line-icon set, and a branded auth hero.

---

## Security & privacy

- **Passwords** — scrypt with a random salt and constant-time comparison.
- **Sessions** — JWT; the secret falls back to a *random per-boot* value (never a public hardcoded one).
- **At-rest encryption** — when `DATA_ENCRYPTION_KEY` is set, every user's data blob is **AES-256-GCM** encrypted before it's written to the database. A leaked DB dump is unreadable ciphertext; the server still decrypts to run analytics/nudges. (At-rest with a server key — not zero-knowledge, so features keep working and password reset stays possible.)
- **HTTP hardening** — Content-Security-Policy + `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` on every response.
- **Rate limiting** — per-IP on login/signup (brute-force / spam) and on AI endpoints.
- **Owner endpoints** are gated server-side (`requireAuth` + owner check), not just hidden in the UI.

---

## Architecture

- **Frontend** — a single-file vanilla-JS PWA (`public/app.js`), string-template rendering into `#main`, `public/style.css`, `public/index.html`. No framework.
- **Backend** — Node.js + Express (`cloud/server.js`), a hand-rolled repository (`cloud/db.js`) that **dual-targets SQLite (dev) and Postgres (prod / Neon)** — no ORM.
- **Storage model** — private per-user data lives as one JSON blob in `user_data`; shared/social data (community, groups, notes) lives in normalised tables.
- **Encryption** — `cloud/crypto.js`. **Web push** — `cloud/push.js` (VAPID). **Multi-provider AI** — fetch-based `aiComplete` / `aiStream` in `cloud/server.js`.
- **Tests** — `tests/run.js` (`npm test`) loads the client in a mocked DOM and boots the server; pure helpers are unit-tested.

> Note: there is a legacy desktop `server.js` at the repo root that is **not** part of the cloud app and must not be committed with cloud changes.

---

## Deployment (Render + Neon)

Set these environment variables on the host. **Generate secrets yourself — never commit real values.**

```bash
# Generate a JWT secret and a data-encryption key (32 bytes each):
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('DATA_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

**Required**
- `DATABASE_URL` — your Neon Postgres connection string.
- `JWT_SECRET` — random 32-byte hex (above). Keeps sessions valid across restarts.
- `DATA_ENCRYPTION_KEY` — random 32-byte key (above). **Set it before you have real users, and never lose or change it** — it's the only thing that can decrypt the data.
- `OWNER_USERNAMES` — comma-separated admin usernames (unlocks the Admin console for those accounts).

**Push notifications** (motivation / streak / protein / vocab nudges)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:you@example.com`).
  Generate with `npx web-push generate-vapid-keys`.

**Optional**
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — a *server-side* AI key for server-initiated jobs. (The per-user AI coach uses each user's own bring-your-own key, so this is only needed for background AI.)
- `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL` — override the default AI provider/model.
- `PRICE_LABEL`, `STRIPE_PAYMENT_LINK` — Pro pricing/checkout.

Then run a cron (e.g. cron-job.org) hitting the server's push-tick endpoint so the daily nudges fire.

---

## What's next

1. **Go live** — deploy, set the env vars above, smoke-test signup/login/log, and set your admin username.
2. **First users** — put it in front of 3–5 real people for two weeks; let their behaviour drive the roadmap. Retention is the one metric no amount of polish can answer.
3. **Optional follow-ups already scoped** — training-day calorie adjustment, the collective-knowledge UI (the backend exists), finance extras (ROI-vs-benchmark, dividends, time-wealth), and cross-book concept links (needs a tag system first). *(The "Year in Knowledge" recap and the takeaways quiz shipped.)*
