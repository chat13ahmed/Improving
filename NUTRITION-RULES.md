# Onward — nutrition rules, in plain language

**Purpose of this document.** Every rule the app uses to decide how many calories
and grams of protein to show a user, written so a registered dietitian or doctor
can review it in about an hour without reading any code.

**Status: NOT clinically reviewed.** No dietitian, doctor, or other qualified
professional has reviewed any of this. It was written by a software engineer
(an AI assistant) working from published formulas and general sports-nutrition
literature. It should not be treated as validated until someone qualified signs
off on it.

**What we are asking a reviewer for.** Please tell us which rules are wrong,
which numbers should change, and which groups we should be refusing to serve that
we currently serve. The sections flagged **⚠️ JUDGEMENT CALL** have no citation
behind them at all — they are engineering guesses and are the most likely to be
wrong.

---

## 1. What the app shows the user

A daily calorie target, split into protein / carbohydrate / fat, and divided
across their chosen number of meals. The target **adjusts itself over time** based
on the user's logged bodyweight and logged food intake.

Users log: bodyweight (whenever they like), food (per day, optional), workouts.

---

## 2. Starting estimate

**Resting metabolic rate** — Mifflin-St Jeor equation:

```
male:    (10 × kg) + (6.25 × cm) − (5 × age) + 5
female:  (10 × kg) + (6.25 × cm) − (5 × age) − 161
```

**Total daily energy expenditure** — RMR multiplied by an activity factor the
user selects:

| User selects | Multiplier |
|---|---|
| Sedentary — little or no exercise | 1.2 |
| Light — 1–3 days/week | 1.375 |
| Moderate — 3–5 days/week | 1.55 |
| Active — 6–7 days/week | 1.725 |
| Very active — hard daily / physical job | 1.9 |

**Goal adjustment** applied to that number:

| Goal | Adjustment |
|---|---|
| Lose fat | −20% |
| Maintain | 0 |
| Build muscle | +12% |

> Known limitation: Mifflin-St Jeor has an error of roughly ±10% and is less
> accurate at the extremes of body composition. Only two sexes are offered, which
> is a limitation of the equation itself, and we would welcome guidance on how to
> handle users who don't fit either.

---

## 3. How the target adjusts itself

This is the part most in need of review.

### 3.1 Current weight

Bodyweight is taken as the **average of all weigh-ins in the last 7 days**, not the
most recent reading. If there are no readings in 7 days, the most recent single
reading is used. If there are none at all, the weight typed during setup is used.

*Reason: day-to-day bodyweight moves 1–2 kg on water, glycogen and gut contents,
and feeding that into the RMR equation would make the target jump around daily.*

### 3.2 Rate of change

A **least-squares regression** over all weigh-ins in the last 21 days gives a
slope in kg/week.

Requires at least **4 readings spanning at least 10 days**. Below that the app
declares it does not know the trend and makes no adjustment.

### 3.3 Target rate of change

Scaled to bodyweight rather than a flat figure:

| Goal | Target rate | Clamped to |
|---|---|---|
| Lose | −0.70% of bodyweight per week | between −0.25 and −1.0 kg/wk |
| Build muscle | +0.25% of bodyweight per week | between +0.10 and +0.50 kg/wk |
| Maintain | 0 | — |

*Basis: 0.5–1%/week loss appears in sports-nutrition literature as protective of
lean mass. **Note for reviewer:** that guidance comes from studies of trained
athletes, not the general population, and we do not know whether it transfers.*

### 3.4 Estimating what the user actually burns

If the user has **at least 10 days of logged food** in the last 21 days *and* a
confident weight trend, the app estimates expenditure by energy balance:

```
estimated burn = average calories eaten − (kg per week × 7700 ÷ 7)
```

So: someone eating 2,600/day whose weight is flat is estimated to burn 2,600/day.

The daily target then becomes:

```
target = estimated burn + (target rate × 7700 ÷ 7)
```

**Constant used: 7,700 kcal per kg of body mass.**

> ⚠️ Known limitation we would like reviewed. This constant (the "3,500 kcal per
> pound" rule) assumes all mass change is fat, and ignores metabolic adaptation.
> Published work indicates it overestimates long-run weight change. We do not know
> whether the error is large enough to matter over the 3-week windows we use.

**Under-reporting guard.** The estimate is clamped to within **±40%** of the
formula estimate. Without this, a user logging 900 cal/day while holding weight
would produce an absurdly low expenditure figure and then be told to eat less
still. Under-reporting of intake is common and this is our only defence against it.
**⚠️ JUDGEMENT CALL — the ±40% figure has no source.**

**Days with no food logged are skipped entirely**, never counted as zero calories.

### 3.5 If food logs are too thin

With a weight trend but under 10 days of food logs, the app nudges the formula
figure instead:

```
adjustment = (target rate − actual rate) × 7700 ÷ 7
```

### 3.6 Deadband

No change is made while the actual rate is within **30% of the target rate**
(or within 0.20 kg/wk for maintenance). *Reason: to avoid teaching users to chase
normal scale fluctuation.* **⚠️ JUDGEMENT CALL — 30% is a guess.**

---

## 4. Safety limits

All of these are **⚠️ JUDGEMENT CALLS** except where noted.

| Limit | Value | Purpose | Type |
|---|---|---|---|
| Max single cut | 400 cal/day | Avoid large lurches downward | smoothing |
| Max drift from formula | 25% | Bound how far self-adjustment can wander | smoothing |
| Max deficit | 25% below estimated burn | Hard cap on aggressiveness | **safety** |
| Calorie floor | **the higher of** resting metabolic rate, **or** 1,500 (male) / 1,200 (female) | Never prescribe below resting metabolism | **safety** |
| Fast-loss warning | above 1.5% bodyweight/week | Warn and raise calories | **safety** |

The two **safety** limits override the two smoothing limits. A consequence worth
stating explicitly for review:

> **Neither safety limit can ever lower a user's target — both can only raise it.**
> So the "max 400 cal change" figure bounds cuts only. A user losing dangerously
> fast can have their calories raised by more than 400 in one step, because
> smoothing should not delay a correction in the safe direction.

The floor is the limit we are least confident about. It previously was a flat
1,200 for every user, which we judged indefensible; the RMR-based floor is our
replacement. **The 1,200 / 1,500 sex-based minimums are consumer-app convention,
not a clinical threshold, and we would like a proper number here.**

When any limit binds, the app tells the user it has been applied rather than
hiding it.

---

## 5. Who the app refuses to serve

If any of the following applies, the self-adjusting target is **switched off**.
The user is shown **maintenance calories only**, told why, and pointed to a doctor
or registered dietitian. All other tracking continues to work.

**User declares (checkboxes at setup):**
- Pregnant or trying to conceive
- Breastfeeding
- History of an eating disorder
- Diabetes on insulin or glucose-lowering medication
- Kidney or liver disease
- Following a diet set by a doctor or dietitian

**Detected automatically:**
- Age under 18 — *adult RMR equations are not validated for them and a deficit can
  cost growth; paediatric assessment needed*
- BMI below 16.0 (WHO severe thinness) — all adaptation off
- BMI below 18.5 (WHO underweight) — **weight-loss targets refused**; maintenance
  or gain still permitted, since gaining is the healthy direction

**Warned but not blocked:**
- BMI at or above 40 — suggests clinical supervision
- Age over 79
- Losing more than 1.5% of bodyweight per week

### The specific risk driving all of this

The feature **lowers calories when weight stalls**. For a user with a restrictive
eating disorder that is precisely the wrong response, and nothing in a weight log
distinguishes a plateau from a person who should not be dieting at all. The app
therefore does not try to make that judgement.

**Reviewer question we most want answered:** is self-declaration enough here, or
should more be gated? We are aware that someone with an active eating disorder may
not tick the box.

---

## 6. Protein

| Strategy | Protein |
|---|---|
| Muscle-building | 2.0 g/kg bodyweight (male), 1.8 g/kg (female) |
| Balanced | 30% of calories |

Protein is calculated from **current** bodyweight, so it tracks as the user's
weight changes.

> These figures sit within sports-nutrition ranges for resistance-trained people
> but are well above the 0.8 g/kg general population RDA. **They are
> contraindicated in kidney disease** — which is why kidney disease is on the
> blocking list above.

---

## 7. Things a reviewer should know we have NOT done

- No clinical validation of any kind.
- No micronutrient tracking, so no deficiency detection.
- No account of medications affecting weight or appetite.
- No account of menstrual-cycle water-weight variation, which can exceed the
  weekly signal we measure and may bias the trend for menstruating users. **We
  believe this is a real weakness and would like advice.**
- No region-specific eating-disorder helpline signposting. We refer users to "a
  doctor or registered dietitian" generically. **Tell us what should appear here.**
- Only male/female options, inherited from the underlying equation.
- The app has been tested against a simulation the same engineer wrote, which
  demonstrates internal arithmetic consistency and **nothing about physiological
  correctness.**

---

## 8. Where this lives in the code

For an engineer accompanying the reviewer:

| Rule | Location in `public/app.js` |
|---|---|
| Starting estimate | `computeNutrition()` |
| Activity and goal factors | `ACTIVITY_FACTORS`, `NUTRITION_GOALS` |
| Safety thresholds | `SAFETY`, `SAFETY_FLAGS` |
| Refusal logic | `nutritionSafety()` |
| Calorie floor | `calorieFloor()` |
| Current weight and trend | `weightTrend()` |
| Intake averaging | `avgIntake()` |
| Energy-balance estimate | `estimateTDEE()` |
| Target and limits | `adaptiveTarget()`, `ADAPT` |
| Orchestration | `nutritionPlan()` |
| What the user sees | `renderAdaptCard()` |

Behaviour is covered by assertions in `tests/run.js` (search `Adaptive nutrition`
and `Nutrition safety gate`). Changing a threshold in `SAFETY` or `ADAPT` changes
the whole app's behaviour — those two objects are the intended tuning surface.
