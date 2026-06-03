# Business Escalate — Cloud Backend

Phase 1 of the cloud plan (`../docs/CLOUD_SYNC_PLAN.md`). A deployable,
multi-user backend: **Postgres + JWT auth + server-side AI**, with the same
API as the desktop app — so the existing client works against it unchanged.

## Database: zero-config local, Postgres in the cloud
The backend auto-selects its database (see `db.js`):
- **No `DATABASE_URL`** → **SQLite** (a real local `data.db`, via built-in `node:sqlite`,
  needs **nothing installed** — great for running it on your own machine right now).
- **`DATABASE_URL` set** → **Postgres** (for the deployed cloud version).

Same code, same API — you develop on SQLite and deploy on Postgres without changes.

## What it does
- Stores each user's data in the database (`users` + `user_data`) instead of local files.
- **JWT** login tokens (stateless) + scrypt-hashed passwords.
- The **Anthropic key lives on the server** → the coach, daily insight and food-AI
  work for every user with **no key to enter** (rate-limited per IP).
- Serves the web client itself, so it installs as a **PWA** on phones.
- `/api/data` is backward compatible (raw object) and also supports
  `{ data, version }` for conflict-guarded multi-device sync.

## Deploy in ~15 minutes

### 1. Database (free)
Create a Postgres DB on **[Neon](https://neon.tech)** or **[Supabase](https://supabase.com)**
(or your host's managed Postgres). Copy its connection string → `DATABASE_URL`.
Tables are created automatically on first boot (or run `schema.sql`).

### 2. Host the server (free tier)
On **[Render](https://render.com)** or **[Railway](https://railway.app)**:
1. New **Web Service** from this repo, **root directory = `cloud/`**.
2. Build command: `npm install` — Start command: `npm start`.
3. Add env vars (see `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`.
4. Deploy. You'll get a URL like `https://business-escalate.onrender.com`.

### 3. Ship the client
Two options:
- **Same origin (recommended, zero client change):** copy the desktop client into
  the server so it's served together —
  `cp -r ../public ./public` (or set `CLIENT_DIR`). Visitors open the server URL directly.
- **Separate static host:** host `public/` anywhere and, in the browser console once,
  run `localStorage.setItem('be_api_base','https://YOUR-SERVER-URL')` — the client's
  built-in API-base shim routes all `/api` calls there.

### 4. Migrate existing desktop data
In the desktop app: **Settings → Backup & Data → Export backup (JSON)**.
Then sign up on the cloud version and **Import backup**. Done — nothing lost.

## Local run
```
cd cloud
npm install
# set DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY (e.g. in a .env loaded by your shell)
npm start
```

## Cost & controls
- DB + host: free tiers to start; a few $/mo at scale.
- **AI is on your key** → you pay per request. `AI_HOURLY_LIMIT` caps calls per IP.
  Add per-user caps or a "bring your own key" option later if usage grows.

## Notes / future (Phase 3+)
- Logout is client-side token discard (JWT). For true revocation add a token denylist.
- Email-based password reset needs an email provider (Resend/SES) — the
  security-question flow works today without one.
- Offline write queue + turning on the version conflict guard in the client.
