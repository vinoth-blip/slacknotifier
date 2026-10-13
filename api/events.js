'use strict';
const store = require('../lib/store');
const { authorized, send } = require('../lib/auth');

// https://YOUR-APP.vercel.app/api/events?key=YOUR_POLL_KEY  -> the last 300 notifications (used by the web page)
module.exports = async (req, res) => {
  if (!authorized(req)) return send(res, 401, 'Unauthorized');
  try {
    const rows = (await store.cmd('LRANGE', 'events:log', 0, 299)) || [];
    const events = rows.map((r) => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean);
    return send(res, 200, { events });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
};
