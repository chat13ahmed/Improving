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
1. Render → **New +** → **Postgres** → create.
2. Open it → copy the **Internal Database URL**.
3. Add it as `DATABASE_URL` below.
> Do this **before** anyone signs up. Accounts made on the fallback store are lost on the next deploy.

### ⚠️ Do not launch on the FREE Postgres tier
Free is fine while you're testing alone. It is **not** safe to put real users on,
for two reasons that both end in total data loss:

| | Free | Paid (Hobby+) |
|---|---|---|
| Automatic backups | **None** | Continuous |
| Point-in-time recovery | **None** — *"Render does not provide recovery capabilities for databases on the Free instance type"* | Yes — 3 days (Hobby), 7 days (Pro+) |
| Lifetime | **Deleted 30 days after creation** (+14-day grace to upgrade, then *"Render deletes the database (along with all of its data)"*) | Persistent |
| Storage | 1 GB | Per plan |

So a free-tier launch means every account and everything anyone logged is
**permanently deleted about 6 weeks later, with no recovery path**.

**Before you share the link with anyone: upgrade the database to a paid tier.**
That single step buys you continuous point-in-time recovery, which is worth more
than any script below.

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

## 5. Backups & restore

**Layer 1 — Render's own recovery (the one that matters).** On a paid tier this
is automatic and continuous. To use it: Render → your Postgres → **Recovery** →
pick a timestamp. Render spins up a **new** instance at that point in time, so you
can inspect it before repointing `DATABASE_URL` at it. Nothing to set up — but it
only exists on paid tiers (see the warning in step 2).

**Layer 2 — your own off-site copy.** Render's recovery is gone if the account
itself is lost, so keep a copy you control. No PostgreSQL tools needed:

```bash
DATABASE_URL="<External Database URL>" node cloud/backup.js dump > onward-backup-2026-08-06.json
```

Restore into an empty database:

```bash
DATABASE_URL="<target External URL>" node cloud/backup.js restore onward-backup-2026-08-06.json
```

Notes that matter:
- Use the **External** URL (not Internal) when running this from your own machine.
- Restore **refuses** to run against a database that still has rows. Add `--force`
  to wipe and replace — only when you mean it.
- `user_data.data` stays **encrypted** in the dump. It is restorable **only** by a
  server with the same `DATA_ENCRYPTION_KEY`. Store that key somewhere separate
  from the backups, or the backup is unreadable junk.
- `tests/backup.js` proves the dump → wipe → restore round-trip on every CI run.

**Recommended rhythm:** run the dump before each risky change (schema edits,
migrations) and on a monthly reminder. Keep the last few files off-machine.

**Test your restore once, now, before you need it.** Create a second free
Postgres, restore into it, log in against it. An unverified backup is a guess.

## 6. Marketing note
The landing page + explainer CTAs point at `https://improving-rn2y.onrender.com`.
**Don't drive real traffic there until steps 2–3 are done**, or early sign-ups get
wiped on the next deploy. Once the DB + `JWT_SECRET` are set, you're safe to share.

---

### Why the mobile (App Store / Play) build is separate
The `mobile/` folder wraps this same deployed backend in a native shell (Capacitor).
See `mobile/README.md`. Android is buildable on Windows; iOS needs a Mac.
