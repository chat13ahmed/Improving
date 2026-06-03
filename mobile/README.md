# Business Escalate — Mobile (App Store & Google Play)

A [Capacitor](https://capacitorjs.com) wrapper that turns the web app into a
native iOS + Android app you can submit to the stores. One codebase, both
platforms.

> **Prerequisite:** the cloud backend must be **deployed first** (see
> `../cloud/README.md`) so you have a live HTTPS URL. The mobile app loads it.

---

## How the app loads the web UI — pick one

**Option A — load your live site (recommended, instant web updates).**
Add your deployed URL to `capacitor.config.json` under `server`:
```json
"server": { "androidScheme": "https", "url": "https://YOUR-APP.onrender.com" }
```
The native app becomes a managed shell around your live cloud site — `/api`
calls are same-origin, and web changes ship without resubmitting to the stores.

**Option B — bundle the client in the app.**
```bash
cp -r ../public ./www
```
Then in the app, point it at the API once: the client's built-in shim reads
`localStorage 'be_api_base'`, or hardcode `API_BASE` in `public/app.js` to your
cloud URL before copying. (`webDir` is already set to `www`.)

Most people use **Option A**.

---

## Build steps (on your machine)

You need **Node**, plus **Android Studio** (for Android) and a **Mac with Xcode**
(for iOS — Apple builds *cannot* be done on Windows/Linux).

```bash
cd mobile
npm install

# create www (Option B) or just make an empty folder if using Option A's server.url:
mkdir -p www && [ -f www/index.html ] || cp -r ../public/* www/ 2>/dev/null || true

# generate every app icon + splash screen from assets/logo.svg
npm run assets

# add native platforms
npm run add:android      # → ./android (Android Studio project)
npm run add:ios          # → ./ios     (Xcode project, Mac only)

# open in the native IDE to build / run / archive
npm run open:android
npm run open:ios
```

`assets/logo.svg` (1024×1024, brand bolt on the blue gradient) is the source for
all icons and splash screens. Replace it with your own art any time and re-run
`npm run assets`.

---

## Submitting to the stores

### Google Play  (easier, ~$25 one-time)
1. Create a **Google Play Console** account ($25 once).
2. In Android Studio: **Build → Generate Signed Bundle (.aab)**.
3. Upload the `.aab` in Play Console, fill the listing (see `STORE_CHECKLIST.md`),
   add the **privacy policy URL**, complete the **Data Safety** form, submit.
4. Review is usually 1–3 days.

> Tip: for a pure-PWA route without Capacitor, [PWABuilder](https://pwabuilder.com)
> can also generate a Play-ready package straight from your deployed URL.

### Apple App Store  (harder, needs a Mac, $99/year)
1. Enroll in the **Apple Developer Program** ($99/year).
2. In Xcode: set the team/signing, bump the bundle id `com.businessescalate.app`,
   **Product → Archive → Distribute App**.
3. In **App Store Connect**: create the app, upload the build, fill the listing,
   add the **privacy policy** + **App Privacy** answers, submit for review.
4. ⚠️ Apple **Guideline 4.2** rejects apps that are "just a website." This app has
   real, app-like functionality, which helps — but to be safe, lean on the native
   splash/icon and consider adding a small native touch (e.g. push notifications)
   if it's rejected. Review is typically a few days.

---

## What I can prepare vs. what's yours
- **Prepared here:** Capacitor config, build scripts, icon/splash source, this guide, `STORE_CHECKLIST.md`.
- **Yours:** developer accounts + fees, a Mac for iOS, running the builds, and the store submissions/review. (These can't be done from the repo.)
