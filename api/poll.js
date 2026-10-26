'use strict';
const { runPoll } = require('../lib/poll');
const { authorized, send } = require('../lib/auth');
const store = require('../lib/store');
const { runReminders } = require('../lib/reminders');

// Call this URL every 1-2 minutes:  https://YOUR-APP.vercel.app/api/poll?key=YOUR_POLL_KEY
module.exports = async (req, res) => {
  if (!authorized(req)) return send(res, 401, 'Unauthorized');
  try {
    await runReminders().catch((e) => console.error('reminders failed:', e));
    const result = await runPoll();
    return send(res, 200, result);
  } catch (e) {
    console.error('poll failed:', e);
    // Remember the failure so /api/status can show it
    await store.cmd('SET', 'last:error', JSON.stringify({ error: String((e && e.message) || e), at: new Date().toISOString() })).catch(() => {});
    return send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
};
