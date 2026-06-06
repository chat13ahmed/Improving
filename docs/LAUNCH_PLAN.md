# Business Escalate — Launch Plan

The product is built. This is the plan to get it in front of real people and learn
whether they actually use it. **The goal of this first launch is NOT lots of users.
It's 10 real users for 2 weeks, and the truth about what happens.**

---

## The one mindset
You are no longer building — you are *learning*. 10 real people who use it (or quit)
will teach you more than 10 more features. Resist adding features until real users
tell you what's missing. Watch the numbers, talk to people, then decide.

---

## Week 0 — Flip everything on (½ a day)
Do these once, in Render → your service → **Environment**:

- [ ] `DATABASE_URL` is set (Neon) — **critical**, or data wipes on every deploy.
- [ ] `JWT_SECRET`, `ANTHROPIC_API_KEY` set.
- [ ] Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.
- [ ] `OWNER_USERNAMES` = your app username (unlocks 📊 stats + 📣 broadcast).
- [ ] **Manual Deploy → Deploy latest commit**, and turn **Auto-Deploy ON**.
- [ ] Set up **cron-job.org** → POST `https://YOUR-APP/api/cron/tick?secret=YOUR_CRON_SECRET` every minute.
- [ ] Open the app yourself, **sign up**, log a few days, enable notifications, send a test push.
- [ ] Confirm **Settings → 📊 Your app** shows numbers, and `/about.html` loads.

**Success check:** you get a push notification on your own phone, and the stats card works.

---

## Define success BEFORE you launch (so you can't lie to yourself)
After 2 weeks, the launch "worked" if:
- **≥ 10** people signed up, **and**
- **≥ 4** of them are still **active in the last 7 days** (Settings → 📊), **and**
- **≥ 2** people tell you, unprompted, that they like something specific.

If you hit that → you have a real signal, double down. If not → the product or the
pitch needs work, and the numbers will show you *where* people dropped off.

---

## Week 1 — Seed your first 10 (do it by hand)
Don't "announce to the world." Personally invite people who **fit the tribe**:
ambitious friends into the gym, money/side-hustles, and self-improvement.

**Channels, in order of what works:**
1. **Direct messages** to 15–20 friends who fit (expect ~half to try it). This is #1.
2. **Your story** (IG/Snap/WhatsApp): post a **share card** from the app + the link.
3. **Group chats** with your gym / hustle / school friends.
4. **One community** you're already in (a Discord, a subreddit like r/getdisciplined,
   a fitness/entrepreneur group) — share genuinely, not spammy.

Give everyone the **`/about.html`** link, not the bare app — it sells the idea first.

---

## Copy you can paste

**Friend DM:**
> Yo — I built an app I think you'd actually use. It's one place to track your gym,
> money, food and habits, and it has an AI coach that connects them — like "you close
> more deals the weeks you train." Mind trying it for a week and telling me what you
> honestly think? [your-link]/about.html

**Story / social caption:**
> Been building this: one app for your whole life, with a coach that shows you what
> connects 🔗 Gym, money, food, reading — all in one. Trying it free 👉 [your-link]

---

## Week 2 — Watch + talk (this is the real work)
- **Check 📊 daily.** Who signed up? Who logged today? Who logged once and vanished?
- **Message every signup personally** after a few days. Ask exactly 3 questions:
  1. What made you try it?
  2. What's confusing or annoying?
  3. What would make you use it every day?
- **Watch where they drop:** signup → first log → day 3 → day 7. The biggest fall-off
  is your #1 thing to fix.
- Use the **📣 broadcast** sparingly (a genuine "new thing / thanks for trying it").

---

## After 2 weeks — decide
- **Good signal** (hit the success bar) → pour into distribution: more content, a
  referral reward, post share-cards regularly, widen the communities.
- **Weak signal** → don't add features yet. Fix the #1 drop-off, sharpen the pitch,
  and re-test with 10 fresh people.

---

## Things to resist
- ❌ Adding features because they're fun. Earn them with user feedback.
- ❌ "Launching everywhere" before 10 people love it. Narrow beats wide now.
- ❌ Vanity: signups don't matter, **7-day active** matters.
- ❌ Spending on ads before retention is proven — you'd be paying to fill a leaky bucket.

The whole game right now: **get 10 people, keep 4, learn why.**
