'use strict';
// Personal reminders sent to Slack: login, logout and "end your break".
// Runs on every poll (cron-job.org calls /api/poll every minute), so it needs no extra setup.
const store = require('./store');
const { post } = require('./slack');

function settings() {
  const e = process.env;
  return {
    url: e.REMINDER_WEBHOOK_URL || e.SLACK_WEBHOOK_URL || '',
    tz: e.REMINDER_TZ || 'Asia/Dubai',
    login: e.LOGIN_TIME || '10:00',
    logout: e.LOGOUT_TIME || '19:00',
    days: (e.REMINDER_DAYS || '1,2,3,4,5').split(',').map((s) => Number(s.trim())), // 1=Mon ... 7=Sun
    user: (e.REMINDER_USER_ID || '').trim(), // optional Slack member ID, e.g. U01ABCDEF, to @mention you
    breakRepeat: Number(e.BREAK_REPEAT_MIN || 5), // repeat the break reminder every N minutes
    breakMax: Number(e.BREAK_MAX_REMINDERS || 4),
  };
}

// Current date/time parts in the chosen time zone
function localNow(tz, now = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now).forEach((x) => { p[x.type] = x.value; });
  const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), dow };
}
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}
function clock12(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function card(color, title, text, who) {
  return {
    text: `${who ? who + ' ' : ''}${title}`,
    attachments: [{ color, blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `${who ? who + '\n' : ''}*${title}*\n${text}` } },
    ] }],
  };
}

async function send(c, title, text, color) {
  const who = c.user ? `<@${c.user}>` : '';
  return post(c.url, card(color, title, text, who));
}

async function runReminders(now = new Date()) {
  const c = settings();
  if (!c.url) return [];
  const t = localNow(c.tz, now);
  const sent = [];

  // 1) Login and logout reminders (weekdays only, once per day, within 10 minutes of the set time)
  if (c.days.includes(t.dow)) {
    const jobs = [
      ['login', c.login, '⏰ Time to log in', `It's ${clock12(c.login)}. Start your day in Slack.`, '#36B37E'],
      ['logout', c.logout, '🏁 Time to log out', `It's ${clock12(c.logout)}. Log out in Slack before you go. If you're on a break, end it first.`, '#6554C0'],
    ];
    for (const [name, at, title, text, color] of jobs) {
      const diff = t.minutes - toMinutes(at);
      if (diff < 0 || diff > 10) continue;
      const first = await store.cmd('SET', `rem:${t.date}:${name}`, '1', 'NX', 'EX', 172800);
      if (first !== 'OK') continue;
      const r = await send(c, title, text, color);
      if (!r.ok) await store.cmd('DEL', `rem:${t.date}:${name}`).catch(() => {});
      else sent.push(name);
    }
  }

  // 2) Break timer: started from /api/break?min=30. Reminds when it ends, then repeats until you stop it.
  const raw = await store.cmd('GET', 'break:state');
  if (raw) {
    let b; try { b = JSON.parse(raw); } catch (e) { b = null; }
    if (b && b.end) {
      const nowMs = now.getTime();
      if (nowMs >= b.end) {
        const sinceMin = Math.floor((nowMs - b.end) / 60000);
        const due = Math.floor(sinceMin / Math.max(1, c.breakRepeat)); // 0 on the first minute, 1 after N min ...
        if (due < c.breakMax && (b.n || 0) <= due) {
          const over = sinceMin > 0 ? ` You are ${sinceMin} min over.` : '';
          const r = await send(c, '☕ Break time is over', `Your ${b.min}-minute break has finished.${over} Click *End break* in Slack.`, '#FF8B00');
          if (r.ok) {
            b.n = due + 1;
            await store.cmd('SET', 'break:state', JSON.stringify(b), 'EX', 6 * 3600);
            sent.push('break');
          }
        } else if (due >= c.breakMax) {
          await store.cmd('DEL', 'break:state');
        }
      }
    }
  }
  return sent;
}

async function startBreak(minutes) {
  const min = Math.min(240, Math.max(1, Math.round(Number(minutes) || 30)));
  const end = Date.now() + min * 60000;
  await store.cmd('SET', 'break:state', JSON.stringify({ end, min, n: 0 }), 'EX', 6 * 3600);
  return { min, end };
}
async function stopBreak() { await store.cmd('DEL', 'break:state'); }

module.exports = { runReminders, startBreak, stopBreak, localNow, toMinutes, clock12, settings };
