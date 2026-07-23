# Onward — Complete Project Summary

**Onward** is one simple app to build habits and track your whole life — fitness, money, reading, nutrition, business — in about 30 seconds a day, with a resident team of "experts" (offline rules engines + optional AI coach) that read your real numbers and tell you the one thing that matters most.

Installable PWA · phone + desktop · light/dark/auto theme · works offline · no framework.

- **Live URL:** https://improving-rn2y.onrender.com (Render, auto-deploys from GitHub `main`)
- **GitHub:** https://github.com/chat13ahmed/Improving
- **Current asset versions:** `style.css?v=177`, `app.js?v=203` (bump BOTH query strings in `index.html` on every change — this is the cache-busting convention)

---

## Status

- Feature-complete, redesigned end-to-end, mobile-hardened, deployed.
- Test suite: `npm test` (tests/run.js — mocked-DOM client + server boot, ~492 assertions).
- The owner (admin) account = any username listed in the `OWNER_USERNAMES` env var on Render.

---

## Repo layout — WHERE THINGS ACTUALLY LIVE

The working app + git repo is **NOT at the folder root**. It's at:

```
pastry-dashboard/build7/Business Escalate-win32-x64/resources/app/   ← the git repo
├── public/                ← the ENTIRE frontend (shared by both servers)
│   ├── index.html         ← shell + sidebar/bottom-nav + asset version query strings
│   ├── app.js             ← the whole SPA (~700KB, single file, vanilla JS)
│   ├── style.css          ← all styles (~3700 lines)
│   ├── sw.js              ← service worker (network-first, cache "onward-shell-v3")
│   └── vendor/            ← chart.umd.min.js, marked.min.js
├── cloud/                 ← the DEPLOYED backend (what Render runs)
│   ├── server.js          ← Express API: auth, data, AI, community, admin, push, cron
│   ├── db.js              ← repository dual-targeting SQLite (dev) / Postgres (prod, Neon)
│   ├── crypto.js          ← AES-256-GCM at-rest encryption of user data blobs
│   └── push.js            ← web push (VAPID)
├── server.js              ← LEGACY local/desktop server. ⚠️ Has the founder's
│                            uncommitted community-backend WIP — do NOT commit/entangle it.
├── tests/run.js           ← npm test
└── SUMMARY.md             ← this file
```

Run locally: `node server.js` → http://localhost:4891 (the local legacy server serves the same `public/`). The deployed stack is `cloud/server.js`.

---

## Architecture

- **Frontend:** single-file vanilla-JS SPA. String-template rendering into `#main`. Navigation = `navigate(page)` → a `pages` map of `render*` functions (`renderDashboard`, `renderHealthPage`, `renderBusinessPage`, `renderKnowledgePage`, `renderChecklistPage`, `renderCoachPage`, `renderContactsPage`, `renderIdeasPage`, `renderFinancesPage`, `renderHistoryPage`, `renderCommunityPage`, `renderSettingsPage`, `renderAdminPage`, `renderWorkout`, `renderLogEntry`).
- **State:** global `state` object; `state.data` is the user's entire data blob; `saveData()` persists it (POST `/api/data`). `startDemo()` boots a demo account with sample data (used for all preview verification).
- **Backend:** Express. Private per-user data = ONE JSON blob per user in `user_data` (encrypted at rest when `DATA_ENCRYPTION_KEY` set). Shared/social data = normalized tables. `DB.getData/saveData/saveDataMeta/allUsers/allUserData` in `cloud/db.js` (both SQLite + Postgres implementations — keep them in sync).
- **`saveDataMeta`** updates a user's blob WITHOUT bumping its version — use for server-side writes (cron nudges, admin feedback-delete) so client saves are never clobbered.
- **AI:** bring-your-own-key, multi-provider (Claude / OpenAI / Gemini / any OpenAI-compatible) via `aiComplete`/`aiStream` in `cloud/server.js`. System prompt (`buildSystemPrompt`) speaks as the expert team.
- **PWA:** `sw.js` is network-first; registered with `{ updateViaCache: 'none' }` + `reg.update()` so deploys land without cache-clearing. Bump the `CACHE` constant (`onward-shell-vN`) if shell caching semantics ever change.

---

## Data model — `state.data` fields

| Field | Shape | Used by |
|---|---|---|
| `profile` | name, age, email, phone, gymDaysPerWeek, weeklyNetworkGoal, weeklyReadGoal, weeklyIncomeGoal, savingsGoal, incomeCadence (daily/weekly/monthly), nutrition {age,sex,heightCm,weightKg,activity,goal,strategy,mealsPerDay}, pillars {id:{enabled,label,icon}}, mission, plannedWorkout {program|own}, pro, jobTitle/jobDescription/commissionRate | everything |
| `days[]` | {id, date, gym:{done,muscleGroup,exercises:[{name,muscle,sets:[{reps,weight,secs,pr}]}]}, food:{rating}, calories, eaten:{protein,carbs,fat}, reading:{pages,bookId,bookTitle,summary,chapter,page,quote}, networking:{count}, money:{activities}, spent, water, notes, _logged[]} | logs, stats, streaks |
| `weeks[]` | {id, weekStart, income} (weekly income cadence) | money |
| `incomes{}` | {periodKey: amount} (monthly/daily cadence) | money |
| `finance` | assets/liabilities/portfolio/business/debts/monthlyIncome/…/snapshots | Finances + Money Mentor |
| `books[]` | {id,title,author,status(reading/finished),totalPages,chapters[],questions[],teachBack,planPace} | Reading |
| `vocab[]` | {id,word,meaning,book,page,sentence,review:{due,…}} | Vocabulary (Leitner) |
| `takeaways[]` | {id,text,book,createdAt,seenAt} | Key Takeaways resurfacing |
| `library[]` | {id,type(person/history/theory/concept/quote/fact),title,body,source,tags[],createdAt,seenAt,photos[dataURL≤3],audio(dataURL)} | Self-Knowledge Library + games |
| `checklistGroups[]` | {id,name,items:[{id,text}]} — ordered lists; old flat `checklist` auto-migrates | Checklist |
| `checkDone{}` | {date: [itemId]} per-day checked state | Checklist |
| `reminders[]` | {id,label,time,date,enabled} | Reminders/push |
| `weights[]` | {id,date,kg} | Health |
| `ideas[]` | {id,title,status,scores{income,speed,ease,passion},nextStep,validation{customer,valueHyp,growthHyp,experiment,metric,result,decision}} | Ideas |
| `contacts[]` | {id,name,role,status(new/contacted/warm/closing/closed/dropped),dealValue,followUpDate,lastContact,addedDate,starred,…} | Contacts CRM |
| `feedback[]` | {id,text,date} — rides in the SENDER's blob; owner reads via /api/admin/feedback | Feedback |

---

## Feature map (complete, current)

### Dashboard
- Mountain hero (`renderMountainHero`) with climber altitude = weekly momentum; XP bar (`renderXPBar`, injected in sidebar — **on phones it renders compact INSIDE the 54px header**, see Mobile rules).
- **"This week's game plan"** (`weeklyGamePlan`/`renderGamePlanCard`) — chief-of-staff card: top-severity call from each hub's expert engine, ranked, each row deep-links.
- Weekly score card, pillar quick-log nav, 2-col grid of secondary cards (next workout, checklist mini, streak, focus), "Get set up" onboarding card, why/mission card, achievements.

### Log Today
- Guided one-question-at-a-time flow (`startGuidedLog`) + full form (`renderLogToday`). First-ever log is shortened. Steps drop off as logged (`day._logged`).
- Reading step = **pages only** + pointer; notes moved to Knowledge → Reading. `readDayForm()` PRESERVES reading notes when those inputs aren't in the form (do not regress this).

### Health hub (Overview · Training · Nutrition)
- **Expert briefing** (`healthBriefing`) — doctor/nutritionist/coach rules: 7-days-no-rest, protein vs 1.6–2.2g/kg with gram gap + food fixes, weight-change rate (>1%/wk), volume vs goal, push/pull/legs balance (4wk), progressive-overload nudge, hydration.
- Stat rings; **Coach's weekly program** (`weeklyTrainingSplit`/`renderTrainingProgramCard`) — goal+days → session schedule from `WORKOUT_PROGRAMS`, one-tap "Start this session" (seeds via `woLoadProgram`, never clobbers an in-progress workout) + "Plan for next".
- **Workout logger** (immersive, `renderWorkout`): 197-exercise library, rest timer (wall-clock, auto-starts after each set; **fixed-position bar rendered OUTSIDE `.wo-wrap`** — see Gotchas), **"Last time" reference** (`lastExercisePerformance`) with beat-it/✓-beaten cue + input prefill, **PR detection** (`exerciseBestWeightEver`; badge + toast; never fires on a first-ever exercise), **session-complete summary** (`showWorkoutSummary`: volume hero, PRs, protein refuel).
- Nutrition: BMR/TDEE (Mifflin-St Jeor) targets, per-meal plan/logging, Fuel card, hydration, weight trend.

### Business hub (Overview · Finances · Ideas · Contacts)
- **Expert briefing** (`businessBriefing`) — CEO/manager/mentor: overdue follow-ups, cold leads, pipeline concentration (>50% one deal), thin pipeline, best idea without next step, networking cadence.
- **Finances**: net worth, savings rate, emergency fund, FI number/progress, debt avalanche, snapshots + **Money Mentor** (`moneyMentorLessons` — Psychology of Money rules engine).
- **Ideas**: scoring (`ideaScore`), Lean-Startup validation stages (`validationStage`), **🧪 "Next experiment" playbook** (`ideaNextMove`/`renderIdeaPlaybookCard` — Mom Test/pretotyping move per stage), AI validation coach.
- **Contacts**: CRM, weighted pipeline (`stageProbability`), going-cold detection, **🎯 deal playbook** (`dealPlay`/`renderDealPlaybookCard` — stage-specific next move per open deal, one-tap Reached-out/follow-up).

### Knowledge hub (Overview · Reading · Library · Vocabulary)
- **Expert briefing** (`knowledgeBriefing`) — professor: retrieval practice (unrevisited takeaways), pace→finish-date projection, stalled book, consistency, finish rate.
- **Reading**: 255-book curated library w/ covers, streak, **reading plan** (`renderReadingPlanCard` — pace chips 15/25/40/day → finish date, today's page goal), **"Log today's reading" card** (`renderReadingLogCard`/`saveReadingSession` — pages/chapter/quote/summary now captured HERE, not in Log Today), chapters, notes grouped book→chapter, Key Takeaways + quiz, Finish-a-Book ritual, Year in Knowledge.
- **Library (Self-Knowledge)**: `state.data.library` — save people/history/theories/concepts/quotes/facts. Typed colored badges, filter chips w/ counts, live search, "Worth revisiting" resurface (least-recently-seen), **📷 photos** (≤3, canvas-compressed ≤900px JPEG, lightbox) + **🎙 voice notes** (MediaRecorder, 60s cap) per entry. Attach handlers update previews only — never re-render the form.
- **🎮 Games** (`knowledgeQuizPool`/`startQuizGame`): Quiz (note=clue → pick the title/word among distractors from their own entries, de-duped; score+streak) and Flashcards (flip, knew-it/review). Playing stamps `seenAt` → feeds the resurface engine. Play button shows at pool≥3 (quiz needs ≥4).
- **Vocabulary**: Leitner spaced repetition.

### Checklist & Reminders
- **Grouped checklists**: named lists (`checklistGroups`), each with ordered items; ▲/▼ reorder items AND lists; inline rename; per-list progress; per-list add; "+ New list". Old flat list auto-migrates (one-way). Reminders: time/date/daily + web push. Nudge preferences card.

### Community
- Desktop 2-col (sticky composer rail + feed). Thoughts/programs/meals. (A richer normalized collective-knowledge backend exists server-side without UI.)

### AI Coach
- Chat is the hero (top of page) with 3 tappable starters; 6 "deep dive" analyses below. BYO key.

### History
- Pillar-colored summary tiles, list/calendar views, month filter, edit/delete (🗑) per day.

### Settings
- Sections: pillar customizer (full-width) · Goals & nutrition · AI Coach (work profile + key) · App & account (theme+3D toggle, notifications, security, backup) · **Send feedback** (hidden for owner).

### Feedback system
- Users: Settings → Send feedback → `state.data.feedback` (own blob, existing save path).
- Owner: Admin console top inbox — `GET /api/admin/feedback` aggregates all users' notes (id/username/text/date, newest first, escaped); ✕ per note → `DELETE /api/admin/feedback/:id` (rewrites owning blob via `saveDataMeta`).

### Admin console (owner-only, server-gated)
- KPIs, feedback inbox, growth spark, engagement (DAU/WAU/MAU/stickiness/retention), feature adoption, revenue/reach, users table, broadcast push, grant-Pro.

### 3D background
- CSS/SVG scene (`buildScene3d`): gradient mountain ranges (atmospheric perspective, themed via SVG `<stop>` classes), snow caps, breathing sun/moon, drifting mist, theme-aware bokeh particles, pointer/tilt/scroll parallax via `--mx/--my/--sc` (registered with `@property`). Honors reduced-motion. Toggle in Settings.

---

## The intelligence pattern (IMPORTANT — extend this, don't add AI calls)

All hub "smarts" are **pure, offline rules engines** reading the user's own data:
- `healthBriefing()` / `businessBriefing()` / `knowledgeBriefing()` → items `{icon, expert, sev 0-3, title, why(html), move, cta?, ctaLabel?}` → shared `_briefingCard({eyebrow,items,idxKey,rerender})`, severity-sorted, cycles via `next*Brief()`.
- `moneyMentorLessons()` (Psychology of Money), `dealPlay()` (consultative selling), `ideaNextMove()` (Lean Startup), `weeklyTrainingSplit()` (S&C programming), reading plan / forgetting-curve logic.
- `weeklyGamePlan()` synthesizes the top item from each into the dashboard card and the weekly recap's "focus for next week".
Quality bar: cite a real mechanism, then a concrete move — numbers from THEIR data, never invented.

---

## Design system & mobile rules

- Inter, tabular numerals; soft layered elevation; `--radius`; theme via `data-theme` on `<html>` (`onward_theme` in localStorage, auto follows OS). All new components must be verified in BOTH themes.
- Pillar colors: `--gym-color --food-color --network-color --money-color --read-color` + `--primary --accent --success --danger`.
- Section labels `.dash-section`; 2-col `.dash-grid` (collapses on mobile; `.form-row` inside it collapses to 1 col); severity dots `.plan-sev-0..3`.
- **Phone chrome:** sidebar becomes a fixed 54px frosted top bar (z-150) + frosted bottom nav; `.main` reserves `padding-top:66px` and `calc(96px + env(safe-area-inset-bottom))` at the bottom. **XP bar on phones is a compact absolute strip INSIDE the 54px header** (level+XP+4px track; `.xp-next` hidden).
- **Phone a11y rules (≤640px):** ALL form controls forced to `font-size:16px` (kills iOS zoom-on-focus); tap targets min 40px (btn-sm, tabs, selects, star, inline links).
- Workout mode (`body.wo-fullscreen`, ≤820px): hides top header AND bottom nav AND the quick-log FAB; `.wo-top` is its own fixed frosted bar (safe-area inset).

## Hard-won gotchas (DO NOT re-learn these)

1. **`position:fixed` breaks under transformed ancestors.** `#main.page-anim > *` animates `transform` on mobile — anything `fixed` inside gets trapped (the rest-timer bug). Fixed elements must be siblings OUTSIDE `.wo-wrap`/animated wrappers, and centered via `left:0;right:0;margin:auto` — NEVER `translateX(-50%)` (the animation clobbers element transforms).
2. **Same-specificity CSS overrides don't merge.** `.foo-box { max-width: 400px }` after `.modal-box { max-width: 90vw }` silently drops the responsive cap → use `max-width: min(400px, 90vw)` on every modal box.
3. **Service worker:** already network-first + `updateViaCache:'none'`; users may need ONE reload after a deploy that changes sw.js itself. Never re-introduce cache-first for the shell.
4. **`sticky` doesn't work on mobile** here (body has `overflow-x:hidden`) — use `fixed` for mobile chrome.
5. **Injected components need per-breakpoint rules for every container persona** (the XP-bar-covering-content bug).
6. **Demo verification:** `startDemo()` navigates asynchronously — sequence test steps with setTimeout; re-query DOM nodes after any re-render (rest-timer interval re-renders the workout view).
7. **Root `server.js` has uncommitted founder WIP** — stage files explicitly, never `git add -A`.
8. `escapeHtml`/`escapeAttr` on ALL user text (feedback inbox, library, community). Attachments are data URLs inside the blob — compress hard (photos ≤900px JPEG ≈ tens of KB; JSON body limit 10MB).

---

## Security

- scrypt passwords, JWT sessions, per-IP rate limits (auth + AI), CSP + hardening headers, owner endpoints gated server-side (`requireAuth` + `isOwner(req.username)`), AES-256-GCM at-rest blob encryption when `DATA_ENCRYPTION_KEY` set.

---

## Deploy (Render + Neon) — the update loop

1. Commit in the repo (`resources/app`), **push to `origin main`** → Render auto-deploys (~2–5 min).
2. **Bump `style.css?v=` and `app.js?v=` in index.html with every frontend change** or clients keep old assets.
3. Verify live in a private/incognito window (or fully relaunch the installed PWA once).

Env vars on Render: `DATABASE_URL` (Neon), `JWT_SECRET`, `DATA_ENCRYPTION_KEY` (set once, NEVER change/lose), `OWNER_USERNAMES`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`, `CRON_SECRET` (+ cron-job.org hitting `/api/cron/tick` every minute), optional `ANTHROPIC_API_KEY` (server-side AI), `PRICE_LABEL`/`STRIPE_PAYMENT_LINK`.

---

## Working conventions (how changes get made)

1. Read the existing pattern first; reuse engines/styles (`.play-*`, `.brief-*`, `.plan-sev-*`, modal system) before inventing new ones.
2. Every change: `node --check public/app.js` → bump BOTH asset versions → verify in the preview using `startDemo()` (structure via DOM queries, both themes, 375px no-horizontal-scroll, console clean) → commit with a detailed message → **push immediately** (push = deploy; the founder authorized autonomous push).
3. Match the app's voice: plain verbs, sentence case, encouraging but specific ("Log today's reading", not "Submit").
4. The founder is non-technical with a high design bar — expert, real-app-grade polish expected; verify like a QA, explain like a colleague.

## Roadmap candidates (scoped, not started)

- Library entry editing; quiz with photo clues; "due for review" count on Knowledge overview.
- One-tap actions on the dashboard game plan (e.g. set follow-ups on all cold leads).
- Collective-knowledge UI (normalized backend already exists server-side).
- Training-day calorie adjustment; finance extras (ROI vs benchmark, dividends).
- Real-device pass on voice recording (MediaRecorder path is standard but mic can't be granted in the dev preview).
