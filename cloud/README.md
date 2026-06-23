# Onward — Cloud Backend

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

## Push notifications (reminders that reach phones when the app is closed)
The app can send each user's reminders as real push notifications. To turn it on:

1. **Generate VAPID keys** (identifies your server to the push services):
   ```
   node -e "const e=require('crypto').createECDH('prime256v1');e.generateKeys();console.log('VAPID_PUBLIC_KEY='+e.getPublicKey().toString('base64url'));console.log('VAPID_PRIVATE_KEY='+e.getPrivateKey().toString('base64url'))"
   ```
2. **Set env vars** on your host: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` you own), and a random `CRON_SECRET`.
   (`web-push` is already in dependencies — a redeploy installs it.)
3. **Set up a free cron** to deliver due reminders every minute. On
   [cron-job.org](https://cron-job.org) (free) create a job that does **POST** to:
   ```
   https://YOUR-APP.onrender.com/api/cron/tick?secret=YOUR_CRON_SECRET
   ```
   every 1 minute. (This also keeps the free Render instance awake.)
4. In the app: **Checklist → Reminders → Enable notifications** (the user grants
   permission and subscribes their device). Add reminders with a label + time.
   Tap **Send test** to confirm it works on the device.

**Platform notes:** works on Android/desktop Chrome & Edge broadly; on **iPhone** the
user must **Add to Home Screen** first (iOS 16.4+). Times use each user's own
timezone (captured automatically when they enable notifications).

### Broadcast to everyone (owner tool)
To push a one-off announcement (or a "don't forget to log!" nudge) to *all* users at
once: set `OWNER_USERNAMES` to your own app account username (comma-separated for
several owners). Then in the app, **Settings → 📣 Send a notification to everyone**
appears only for you — type a title + message and send. The server enforces this
(non-owners get 403), so it's safe to leave the code public.

## Notes / future (Phase 3+)
- Logout is client-side token discard (JWT). For true revocation add a token denylist.
- Email-based password reset needs an email provider (Resend/SES) — the
  security-question flow works today without one.
- Offline write queue + turning on the version conflict guard in the client.
