/*
 * Web Push helper (VAPID). Sends notifications that reach a user's phone
 * even when the app is closed. Lazy-requires 'web-push' so the module can be
 * loaded for tests without the dependency installed.
 */
'use strict';
let _wp = null;
function wp() {
  if (!_wp) {
    _wp = require('web-push');
    _wp.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }
  return _wp;
}
function configured() { return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY); }
async function sendPush(subscription, payload) {
  return wp().sendNotification(subscription, JSON.stringify(payload));
}
// Pure: should this reminder fire at the given local time/date? (testable)
// r.date (optional, 'YYYY-MM-DD') = a one-time reminder scheduled for that day;
// no date = daily recurring.
function isReminderDue(r, hhmm, date) {
  if (!r || !r.enabled || r._lastFired === date) return false;
  if (r.date && date < r.date) return false;       // scheduled for a future day — not yet
  return (r.time || '99:99') <= hhmm;
}
// The user's local wall-clock, given a tz offset in minutes (local = UTC + tz)
function userLocal(tzMin, nowMs) {
  const t = Number.isFinite(tzMin) ? tzMin : 0;
  const d = new Date((nowMs || Date.now()) + t * 60000);
  return {
    hhmm: String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'),
    date: d.toISOString().split('T')[0]
  };
}
// Pure: should the daily streak nudge fire? Once/day, in the evening, only if
// the user hasn't logged today and hasn't already been nudged today. (testable)
function isNudgeDue(opts) {
  const o = opts || {};
  if (o.enabled === false) return false;        // user turned it off (default on)
  if (o.loggedToday) return false;              // already logged — no nudge needed
  if (o.lastNudge === o.date) return false;     // already nudged today
  const hour = Number.isFinite(+o.nudgeHour) ? +o.nudgeHour : 19;
  return (o.hhmm || '00:00') >= (String(hour).padStart(2, '0') + ':00');
}
// Pure: should the evening protein nudge fire? Once/day, in the evening, only if
// the user logged food today but is meaningfully short on their protein target.
// Short = under 80% of target AND at least 25g away (so we don't nag when close
// or when the target is tiny). (testable)
function isProteinNudgeDue(opts) {
  const o = opts || {};
  if (o.enabled === false) return false;          // user turned it off (default on)
  if (!o.loggedFood) return false;                // logged nothing — the streak nudge covers that
  if (o.lastNudge === o.date) return false;       // already nudged today
  const target = +o.targetProtein || 0;
  const eaten = +o.eatenProtein || 0;
  if (target <= 0) return false;                  // no protein target set up yet
  const hour = Number.isFinite(+o.hour) ? +o.hour : 19;
  if ((o.hhmm || '00:00') < String(hour).padStart(2, '0') + ':00') return false;
  return (target - eaten) >= 25 && eaten < target * 0.8;
}
// Pure: should a vocabulary practice nudge fire? Once/day, past the hour, only if
// the user has saved words — with a random roll so it lands at a surprising
// moment rather than the same minute every day. (testable)
function isVocabNudgeDue(opts) {
  const o = opts || {};
  if (o.enabled === false) return false;          // user turned it off (default on)
  if (!(+o.wordCount > 0)) return false;          // nothing to practice
  if (o.lastNudge === o.date) return false;       // already nudged today
  const hour = Number.isFinite(+o.hour) ? +o.hour : 13;
  if ((o.hhmm || '00:00') < String(hour).padStart(2, '0') + ':00') return false;
  const roll = Number.isFinite(+o.roll) ? +o.roll : 1;       // server passes Math.random()
  const chance = Number.isFinite(+o.chance) ? +o.chance : 0.5;
  return roll < chance;
}
// Pure: should the daily motivation push fire? Once/day, past a morning hour,
// for everyone (no streak/logging condition — it's pure encouragement). (testable)
function isMotivationDue(opts) {
  const o = opts || {};
  if (o.enabled === false) return false;          // user turned it off (default on)
  if (o.lastSent === o.date) return false;        // already sent today
  const hour = Number.isFinite(+o.hour) ? +o.hour : 8;
  return (o.hhmm || '00:00') >= (String(hour).padStart(2, '0') + ':00');
}
// On-brand motivation lines: build habits, cast identity votes, never miss twice,
// keep the climb going. Short enough to land as a phone notification.
const MOTIVATION = [
  { t: 'One small step', b: "You don't have to be great today — just don't skip. One log keeps the climb going." },
  { t: 'Cast your vote', b: "Every action is a vote for who you're becoming. Log one thing today." },
  { t: 'Never miss twice', b: "Missed yesterday? That's human. Missing twice is how habits die — get back on today." },
  { t: 'Show up', b: "Motivation gets you started. Showing up when you don't feel like it is what makes you." },
  { t: 'Future you', b: "The person you want to be is built on the boring days. Today is one of them. Show up." },
  { t: 'Thirty seconds', b: "You're thirty seconds from keeping your streak alive. That's the whole ask. Go." },
  { t: 'Small and steady', b: "Small steps repeated beat big plans abandoned. Take one step today." },
  { t: 'Remember your why', b: "Remember why you started — then do one thing today that honors it." },
  { t: 'Progress over perfect', b: "You don't need a perfect day. You need a logged one. Done beats ideal." },
  { t: 'The climb', b: "Mountains aren't climbed in one leap — one foothold at a time. Find today's." },
  { t: 'Be that person', b: "You're not trying to get fit. You're someone who shows up. Prove it today." },
  { t: 'It compounds', b: "Today feels small. A year of todays is unrecognizable. Stack one more." },
  { t: 'Just for you', b: "No one is watching but you. That's exactly why it counts. Log it." },
  { t: 'Start ugly', b: "It doesn't have to be impressive. It has to be done. Start ugly — just start." },
  { t: 'Win the morning', b: "Win one small thing early and the day tends to follow. What's your one thing?" },
  { t: 'Discipline is freedom', b: "The discipline you build today is the freedom you'll feel tomorrow." },
  { t: "Don't break the chain", b: "Every logged day is a link in the chain. Don't be the one who breaks it." },
  { t: 'Beat yesterday', b: "Forget everyone else. Just beat yesterday by one percent. That's the whole game." },
  { t: 'Sharpen the saw', b: "Take five minutes for what recharges you. You can't pour from an empty cup." },
  { t: "Don't quit today", b: "The only way to fail at this is to quit. So don't quit today. Onward." },
  { t: 'One percent', b: "One percent better is invisible today and undeniable in a year. Go get it." },
  { t: 'Trust the reps', b: "You won't feel the change day to day. Trust the reps — they're adding up." },
  { t: 'Tell the truth', b: "Track the real numbers, not the flattering ones. Honesty is where growth starts." },
  { t: 'Onward', b: "Whatever yesterday was, today is a fresh climb. One step. Onward." }
];
// Pure: the motivation message for a given date. Deterministic by date so every
// user gets the same line that day and it cycles without repeating for weeks.
function motivationFor(date, name) {
  const day = Math.floor(Date.parse((date || '1970-01-01') + 'T00:00:00Z') / 86400000);
  const i = Number.isFinite(day) ? ((day % MOTIVATION.length) + MOTIVATION.length) % MOTIVATION.length : 0;
  const m = MOTIVATION[i] || MOTIVATION[0];
  const who = name ? String(name).trim() : '';
  return { title: m.t, body: who ? who + ' — ' + m.b : m.b };
}
// Pure: should the "plan tomorrow's workout" nudge fire? Evening, once/day, only
// for people who actually train and haven't already planned their next session. (testable)
function isPlanWorkoutDue(opts) {
  const o = opts || {};
  if (o.enabled === false) return false;        // user turned it off (default on)
  if (!o.trains) return false;                  // not an active gym-goer — skip
  if (o.hasPlan) return false;                  // already planned — nothing to nudge
  if (o.lastNudge === o.date) return false;     // already nudged today
  const hour = Number.isFinite(+o.hour) ? +o.hour : 20;   // 8pm
  return (o.hhmm || '00:00') >= (String(hour).padStart(2, '0') + ':00');
}
module.exports = { sendPush, configured, isReminderDue, userLocal, isNudgeDue, isProteinNudgeDue, isVocabNudgeDue, isMotivationDue, motivationFor, isPlanWorkoutDue };
