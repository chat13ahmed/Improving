# Onward — Deploy runbook (Render)

The app is a static front-end (`public/`) served by the Node backend in `cloud/`.
Everything below is done once in the Render dashboard. **Secrets are placeholders
here — never commit real values; paste them only into Render's Environment tab.**

---

## 1. Web Service settings
Render → your Web Service → **Settings**:

| Setting | Value | Why |
|---|---|---|
| **Root Directory** | `cloud` | Uses `cloud/package.json` (has `pg` + `web-push`, `start: node server.js`). `../public` still resolves for the static site. |
| **Build Command** | `npm install` | |
| **Start Command** | `npm start` | |

## 2. Database (required — without it, data is wiped on every deploy)
1. Render → **New +** → **Postgres** → create (free tier is fine to start).
2. Open it → copy the **Internal Database URL**.
3. Add it as `DATABASE_URL` below.
> Do this **before** anyone signs up. Accounts made on the fallback store are lost on the next deploy.

## 3. Environment variables
Web Service → **Environment** → add each → **Save Changes** (auto-redeploys).

**Required**
```
DATABASE_URL      = <Internal Database URL from step 2>
JWT_SECRET        = <48+ random chars — keeps people logged in across restarts>
OWNER_USERNAMES   = <your Onward username — grants you the Admin console>
```

**Push notifications** (turns the dead reminders back on)
```
VAPID_PUBLIC_KEY  = <run: npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY = <from the same command>
VAPID_SUBJECT     = mailto:you@yourdomain.com
```

**Data-at-rest encryption** (recommended, set ONCE and never change — changing it loses data)
```
DATA_ENCRYPTION_KEY = <32-byte key as hex — run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

**Optional**
```
ANTHROPIC_API_KEY = <only if you want the AI coach on by default; users can also bring their own key>
CRON_SECRET       = <only if you add a Render Cron Job that pings /api/cron/tick>
```

Do **not** set `PORT`, `HOST`, `CLIENT_DIR`, `PGSSL`, or `SQLITE_FILE` — Render provides the port and the defaults are correct.

## 4. Verify after redeploy
- Log in, trigger a redeploy → still logged in ⇒ `JWT_SECRET` took.
- Visit `/api/push/key` → `hasKey:true` (not false) ⇒ VAPID took.
- Post in Community with a photo + reload → still there ⇒ `DATABASE_URL` works.
- Your username sees the **Admin** nav item ⇒ `OWNER_USERNAMES` took.

## 5. Marketing note
The landing page + explainer CTAs point at `https://improving-rn2y.onrender.com`.
**Don't drive real traffic there until steps 2–3 are done**, or early sign-ups get
wiped on the next deploy. Once the DB + `JWT_SECRET` are set, you're safe to share.

---

### Why the mobile (App Store / Play) build is separate
The `mobile/` folder wraps this same deployed backend in a native shell (Capacitor).
See `mobile/README.md`. Android is buildable on Windows; iOS needs a Mac.
