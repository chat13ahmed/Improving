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
module.exports = { sendPush, configured, isReminderDue, userLocal, isNudgeDue };
