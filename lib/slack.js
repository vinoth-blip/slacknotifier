'use strict';

const INFO = {
  'pullrequest:created':   ['🆕', 'Pull request opened'],
  'pullrequest:fulfilled': ['✅', 'Pull request merged'],
  'pullrequest:rejected':  ['❌', 'Pull request declined'],
  'push':                  ['⬆️', 'Commits pushed'],
  'production':            ['🚀', 'Production update'],
  'branch:created':        ['🌿', 'Branch created'],
  'branch:deleted':        ['🗑️', 'Branch deleted'],
  'comment':               ['💬', 'New comment'],
  'approval':              ['👍', 'Pull request approved'],
  'reviewers':             ['👥', 'Reviewers changed'],
  'pipeline:success':      ['🟢', 'Pipeline passed'],
  'pipeline:failed':       ['🔴', 'Pipeline failed'],
};

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function trim(s, max) {
  s = String(s == null ? '' : s).trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

/** Optional animated emoji per event: set SLACK_EMOJI_PR_MERGED=:partyparrot: in Vercel (custom emoji from your Slack). */
function info(event) {
  const base = INFO[event] || ['🔔', event];
  const key = GIF_KEY[event];
  const custom = key && String(process.env['SLACK_EMOJI_' + key] || '').trim();
  return custom && /^:[A-Za-z0-9_+\-]+:$/.test(custom) ? [custom, base[1]] : base;
}

const COLOR = {
  'pullrequest:created': '#2684FF', 'pullrequest:fulfilled': '#36B37E', 'pullrequest:rejected': '#FF5630',
  'push': '#6554C0', 'production': '#FF8B00', 'branch:created': '#00B8D9', 'branch:deleted': '#97A0AF',
  'comment': '#FFAB00', 'approval': '#36B37E', 'reviewers': '#8777D9',
  'pipeline:success': '#36B37E', 'pipeline:failed': '#FF5630',
};
const FIELD_ICON = {
  Branch: '🌿', Author: '👤', 'Merged by': '🔀', 'Action by': '👤', 'Latest commit by': '👤', 'Last commit by': '👤',
  'Approved by': '👍', Commenter: '💬', 'Comment by': '💬', Reviewers: '👥', Result: '🏁', Duration: '⏱️',
};
const GIF_KEY = {
  'pullrequest:created': 'PR_OPENED', 'pullrequest:fulfilled': 'PR_MERGED', 'pullrequest:rejected': 'PR_DECLINED',
  'push': 'PUSH', 'production': 'PRODUCTION', 'branch:created': 'BRANCH_CREATED', 'branch:deleted': 'BRANCH_DELETED', 'comment': 'COMMENT',
  'approval': 'APPROVAL', 'reviewers': 'REVIEWERS', 'pipeline:success': 'PIPELINE_PASSED', 'pipeline:failed': 'PIPELINE_FAILED',
};
/** Optional animated picture per event: set SLACK_GIF_PR_MERGED=https://...gif in Vercel. */
function withGif(event, section) {
  const url = process.env['SLACK_GIF_' + GIF_KEY[event]];
  if (url && /^https:\/\//.test(url)) section.accessory = { type: 'image', image_url: url, alt_text: event };
  return section;
}
const meta = (text) => ({ type: 'mrkdwn', text });

function finish(event, fallback, blocks, url, buttonText, record) {
  // Every card ends with its own time stamp, so each notification reads as a separate message
  const now = Math.floor(Date.now() / 1000);
  blocks.push({ type: 'context', elements: [meta(`🕒 <!date^${now}^{date_short_pretty} at {time}|just now>`)] });
  if (url) {
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: buttonText || 'Open in Bitbucket' }, url }] });
  }
  const payload = { text: fallback, attachments: [{ color: COLOR[event] || '#5E6C84', blocks }] };
  // Structured copy for the web dashboard. Not enumerable, so it is never sent to Slack.
  Object.defineProperty(payload, 'record', { value: { type: event, url: url || '', ...record }, enumerable: false });
  return payload;
}

/** Message for pull request opened / merged / declined. */
function prMessage(e, reviewers, users) {
  const [emoji, label] = info(e.event);
  const title = esc(trim(e.title, 200));
  const blocks = [
    { type: 'context', elements: [meta(`${emoji} *${label.toUpperCase()}*`)] },
    withGif(e.event, { type: 'section', text: meta(`*${e.url ? `<${e.url}|#${e.prId} ${title}>` : `#${e.prId} ${title}`}*`) }),
    { type: 'section', text: meta('🌿 `' + esc(e.source) + '`  →  `' + esc(e.target) + '`') },
  ];
  const who = [`📦 \`${esc(e.repo)}\``, `👤 ${esc(e.author)}`];
  if (e.event === 'pullrequest:fulfilled' && e.actor) who.push(`🔀 merged by ${esc(e.actor)}`);
  else if (e.event === 'pullrequest:rejected' && e.actor) who.push(`🚫 declined by ${esc(e.actor)}`);
  blocks.push({ type: 'context', elements: who.map(meta) });
  if (e.commitBy || e.commitMsg) {
    blocks.push({ type: 'context', elements: [meta('📝 Last commit' + (e.commitBy ? ' by *' + esc(e.commitBy) + '*' : '') + (e.commitMsg ? ': ' + esc(trim(e.commitMsg, 120)) : ''))] });
  }

  if (e.event === 'pullrequest:created' && reviewers.length) {
    const parts = reviewers.map((n) => (users[n] ? `<@${users[n]}>` : esc(n)));
    blocks.push({ type: 'context', elements: [meta('👥 Reviewers: ' + parts.join(', '))] });
  }
  return finish(e.event, `${label}: ${e.title}`, blocks, e.url, 'View pull request', {
    repo: e.repo, title: `#${e.prId} ${e.title}`,
    pr: {
      id: e.prId, source: e.source, target: e.target, author: e.author, actor: e.actor,
      commitBy: e.commitBy || '', commitMsg: e.commitMsg || '', reviewers: reviewers || [],
      description: trim(e.description || '', 1500),
    },
  });
}

/** Message for every other kind of event. */
function generic(event, repo, headline, url, fields, detail, extra) {
  const [emoji, label] = info(event);
  const title = esc(trim(headline, 200));
  const blocks = [
    { type: 'context', elements: [meta(`${emoji} *${label.toUpperCase()}*`)] },
    withGif(event, { type: 'section', text: meta(`*${title}*`) }),
  ];
  if (detail && String(detail).trim()) {
    blocks.push({ type: 'section', text: meta(esc(trim(detail, 1500))) });
  }
  const line = [`📦 \`${esc(repo)}\``];
  for (const [name, value] of Object.entries(fields || {})) {
    if (name === 'Branch' && event.startsWith('branch:')) continue;
    if (value !== '' && value != null) {
      line.push(`${FIELD_ICON[name] || '▪️'} ${name === 'Branch' ? '' : esc(name) + ': '}${esc(trim(value, 300)).replace(/&#96;/g, '`')}`);
    }
  }
  blocks.push({ type: 'context', elements: line.slice(0, 10).map(meta) });
  const plainFields = {};
  for (const [name, value] of Object.entries(fields || {})) {
    if (value !== '' && value != null) plainFields[name] = String(value).replace(/`/g, '');
  }
  return finish(event, `${label}: ${headline}`, blocks, url,
    event === 'branch:created' ? 'View branch' : (event === 'push' || event === 'production') ? 'View commits' : undefined,
    { repo, title: headline, fields: plainFields, detail: String(detail || ''), ...(extra || {}) });
}

async function post(webhookUrl, payload) {
  if (!webhookUrl) return { ok: false, err: 'SLACK_WEBHOOK_URL is not set' };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (res.status === 200) return { ok: true, err: '' };
    return { ok: false, err: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
}

module.exports = { prMessage, generic, post, info, trim };
