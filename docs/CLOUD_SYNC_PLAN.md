# Business Escalate — Cloud Sync & Mobile Plan

How to take the app from a local desktop tool (~8.5/10) to a real
cloud-synced, mobile-accessible product (~9/10).

---

## 0. The key insight: this is more tractable than it looks

The app is **already a client/server app**. The frontend (`public/app.js`)
talks to an Express backend (`server.js`) over `fetch` with **Bearer token
auth** and per-account data. Going cloud is therefore mostly:

1. **Move the Express server to a host** (it already exists).
2. **Swap the local JSON files for a database.**
3. **Move the AI key server-side** so the coach works without users bringing their own.
4. **Point the client at the cloud URL** (or, simpler, let the cloud server serve the client → the client code barely changes).
5. **Add a PWA wrapper** so it installs on phones. (The responsive layout is already done.)

No rewrite — a lift-and-harden.

---

## 1. Target architecture

```
              ┌──────────────────────────────┐
  Phone PWA ─▶│   HTTPS host (Render/Railway/ │
  Laptop web ▶│   Fly.io)                     │
  (Electron) ─▶│   • Express API (from server.js)
              │   • serves the static client  │
              │   • Anthropic key in env      │──▶ Claude API
              └──────────────┬───────────────┘
                             │
                     ┌───────▼────────┐
                     │  Postgres (Neon │
                     │  /Supabase)     │
                     │  users + data   │
                     └────────────────┘
```

- **Backend:** Node + Express (reuse `server.js` logic). Deploy to **Render / Railway / Fly.io** (managed, HTTPS included, ~$0–7/mo to start).
- **Database:** **Postgres** (managed: **Neon** or **Supabase**, free tier to start).
- **Auth:** keep username + password (scrypt — already implemented); issue a **JWT** or keep a `sessions` table. Add **email** (optional) to enable real "reset link" recovery.
- **AI:** move the Anthropic key to a **server environment variable** → coach, daily insight, and food-estimate work for everyone with **no user key**. Add per-user rate limits.
- **Mobile:** ship as an **installable PWA** (manifest + service worker). Optional later: wrap with **Capacitor** for the App Store / Play Store.

---

## 2. Data & sync model

Each user already has exactly one data document (the `data` object:
`profile`, `days`, `weeks`, `ideas`, `contacts`, `books`, `weights`).

**Start simple — one JSONB document per user:**

```sql
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username     text UNIQUE NOT NULL,
  email        text UNIQUE,
  pw_salt      text NOT NULL,
  pw_hash      text NOT NULL,
  sec_question text,
  sec_salt     text,
  sec_hash     text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE user_data (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,   -- for multi-device conflict guard
  updated_at timestamptz DEFAULT now()
);
```

This mirrors today's `data-<id>.json` exactly, so the endpoint shapes don't
change. (Normalize into per-collection tables later only if you need
server-side queries/analytics.)

**Multi-device conflict handling (the only genuinely new logic):**
- `GET /api/data` returns `{ data, version }`.
- `POST /api/data` sends the `version` it loaded. Server saves only if it
  matches, bumps `version`, else returns **409** → client says
  "your data changed on another device — reload?" and re-fetches.
- This last-write-wins-with-guard is plenty for one user on a few devices
  (you rarely edit the same day on two phones at once). Per-day merge can
  come later.

**Offline (PWA, phase 3):** cache the app shell; queue writes while offline,
flush on reconnect.

---

## 3. What actually changes in the current code

| Area | Today | Cloud |
|---|---|---|
| Data store | `readJson/writeJson` on `data-<id>.json` | swap those two helpers for Postgres queries — **endpoints unchanged** |
| Auth tokens | `sessions.json` file | `sessions` table or JWT |
| AI key | `settings.json` (per machine) | server env var `ANTHROPIC_API_KEY` + rate limit |
| Client → server | `fetch('/api/...')` relative | **unchanged** if the cloud server serves the client (same origin) |
| Password reset | security question | keep it, or add email reset |
| Install | Electron `.exe` | PWA (`manifest.webmanifest` + `sw.js`) |

Because the backend can **serve the static client**, the front-end code is
essentially untouched — the same `/api/...` calls just hit the cloud.

---

## 4. Phased rollout

- **Phase 0 — in-repo prep (no host needed, I can do now):**
  - Add a configurable API base URL (so the client can target localhost *or* cloud).
  - Add the PWA scaffolding: `manifest.webmanifest`, icons, a basic service worker.
- **Phase 1 — stand up the backend:**
  - Provision Postgres; port `server.js` data + auth to the DB; AI key → env; deploy.
- **Phase 2 — go live + migrate:**
  - Point the client at the cloud (or serve it from the backend); ship the PWA.
  - **Migration tool already exists:** users **Export backup (JSON)** from the
    desktop app and **Import** it into their new cloud account. No data lost.
- **Phase 3 — sync hardening:** version guard, offline write queue, optional email reset.
- **Phase 4 — app stores (optional):** Capacitor wrapper for iOS/Android.

---

## 5. Cost & operations (honest)

- **Hosting:** ~**$0–7/mo** to start (Render/Railway/Fly small instance).
- **Database:** **$0** on Neon/Supabase free tiers; a few $/mo as you grow.
- **AI:** now on **your** key, server-side → **you pay per request.** This is the
  main recurring cost. Controls:
  - Per-user **daily caps** (e.g. 1 insight/day is already cached; limit coach calls).
  - Optional **"bring your own key"** for power users.
  - Consider freemium (free tracking, paid AI) if it ever has real users.
- **Security:** HTTPS (host-provided), passwords hashed (done), secrets in env,
  rate limiting, input validation (mostly in place already).

---

## 6. Decisions you need to make

1. **Who pays for AI?** You (simplest UX) vs bring-your-own-key vs freemium.
2. **Password recovery:** keep security question, or add email reset (needs an email service like Resend/SES).
3. **Keep the Electron desktop app**, or go web/PWA-only?
4. **Data model:** JSONB document (recommended to start) vs normalized tables.
5. **Host preference:** Render and Railway are the easiest; Fly.io if you want edge/regions.

---

## 7. Smallest next step

I can do **Phase 0 right now, inside this repo, with no host required:**
add the API-base config + PWA manifest/service worker so the app becomes
installable on a phone and is "cloud-ready." After that, the only external
step is **you picking a host + database**, and then I port `server.js` to the
DB and we deploy.
