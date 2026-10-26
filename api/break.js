'use strict';
// Start a break timer:   /api/break?key=YOUR_POLL_KEY&min=30
// End it (stops the reminders): /api/break?key=YOUR_POLL_KEY&stop=1
const { authorized, send } = require('../lib/auth');
const { startBreak, stopBreak, clock12 } = require('../lib/reminders');

module.exports = async (req, res) => {
  if (!authorized(req)) return send(res, 401, 'Unauthorized');
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    if (q.get('stop')) { await stopBreak(); return send(res, 200, { ok: true, message: 'Break ended. No more reminders.' }); }
    const b = await startBreak(q.get('min'));
    const tz = process.env.REMINDER_TZ || 'Asia/Dubai';
    const t = new Date(b.end).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    return send(res, 200, { ok: true, message: `Break started for ${b.min} minutes. You will be reminded at ${t}.` });
  } catch (e) {
    return send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};
