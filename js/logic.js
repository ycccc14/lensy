// Pure logic: dates, lens state, reminders, stats, calendar export. No DOM here, so node tests can import it.
import { CYCLES, CARE_TYPES, isDailyDrops, convert, curOf } from './catalog.js';

export const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (now) => isoDate(now || new Date());
export const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
export const diffDays = (from, to) => Math.round((parseDate(to) - parseDate(from)) / 86400000);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const DEFAULT_SETTINGS = {
  warnDays: 7, // remind this many days before a pair's suggested end
  soakDays: 3, // change the case solution this often while a pair is stored
  maxHours: 8, // suggested longest wear per day
  lowStock: 4, // pieces left before a stock reminder
  expiryWarn: 30, // days before a box's printed expiry
  careWarn: 7, // days before a care product runs out
  currency: 'MYR', // currency that totals are shown in (MYR / CNY / AUD)
  remindAt: '09:00', // time of day for date reminders on the phone
  push: null, // {id, secret}: this phone's registration with the Lensy Push server
  powerL: '0.00',
  powerR: '0.00',
  notify: false,
  snooze: {},
  notified: {},
  wearing: null, // {lensId, pairId, start}
  lastBackup: null,
};

export const isLong = (cycle) => cycle !== 'daily';
export const cycleDays = (cycle) => (CYCLES[cycle] ? CYCLES[cycle].days : 30);
export const lensName = (l) => `${l.brand || '未命名'}${l.color ? ' · ' + l.color : ''}`;

export const activePairs = (l) => (l.pairs || []).filter((p) => p.status === 'using');
export const pairEnd = (l, p) => p.endAt || addDays(p.openedAt, cycleDays(l.cycle));

// 'using' | 'stock' | 'done'
export function lensState(l) {
  if (l.archived) return 'done';
  if (isLong(l.cycle)) {
    if (activePairs(l).length) return 'using';
    return (l.qty || 0) > 0 ? 'stock' : 'done';
  }
  if ((l.qty || 0) <= 0) return 'done';
  return (l.wearCount || 0) > 0 ? 'using' : 'stock';
}

// Date the case solution of a stored pair was last refreshed.
export function lastSoak(p) {
  return [p.soakAt, p.openedAt, p.lastWorn].filter(Boolean).sort().pop();
}

export function dueLabel(days) {
  if (days < 0) return `已过 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}

// Everything that needs the user's attention, most urgent first.
// level: 'overdue' (red) | 'due' (today / act now) | 'soon' (coming up) | 'info'
export function reminders(data, settings, now) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const t = today(now);
  const out = [];
  const push = (r) => { if (!(s.snooze && s.snooze[r.key] && s.snooze[r.key] >= t)) out.push(r); };
  const wearing = s.wearing;

  for (const l of data.lenses || []) {
    if (l.archived) continue;
    const name = lensName(l);
    for (const p of activePairs(l)) {
      const end = pairEnd(l, p);
      const left = diffDays(t, end);
      const warn = Math.max(1, Math.min(s.warnDays, Math.floor(cycleDays(l.cycle) / 4)));
      if (left < 0) push({ key: `end:${p.id}:${end}`, kind: 'pair-end', level: 'overdue', date: end, lensId: l.id, pairId: p.id, title: `${name} 已超出建议使用期`, sub: `开封于 ${p.openedAt}，到期 ${end}（已过 ${-left} 天），请丢弃`, days: left });
      else if (left <= warn) push({ key: `end:${p.id}:${end}`, kind: 'pair-end', level: left <= 1 ? 'due' : 'soon', date: end, lensId: l.id, pairId: p.id, title: `${name} ${left === 0 ? '今天到期' : `还剩 ${left} 天`}`, sub: `${CYCLES[l.cycle].label} · 开封于 ${p.openedAt}，${end} 到期`, days: left });
      const isOn = wearing && wearing.pairId === p.id;
      const soakEvery = Number(l.soakDays) || s.soakDays;
      const last = lastSoak(p);
      const next = addDays(last, soakEvery);
      const since = diffDays(last, t);
      if (!isOn && left >= 0 && diffDays(t, next) <= 0) push({ key: `soak:${p.id}:${next}`, kind: 'soak', level: since > soakEvery ? 'overdue' : 'due', date: next, lensId: l.id, pairId: p.id, title: `${name} 该换护理液了`, sub: `上次换水 ${last}（${since} 天前），建议每 ${soakEvery} 天换一次`, days: diffDays(t, next) });
    }
    if ((l.qty || 0) > 0 && l.expiry) {
      const left = diffDays(t, l.expiry);
      if (left < 0) push({ key: `exp:${l.id}:${l.expiry}`, kind: 'lens-expiry', level: 'overdue', date: l.expiry, lensId: l.id, title: `${name} 库存已过有效期`, sub: `有效期至 ${l.expiry}，剩 ${l.qty} 片，过期请勿佩戴`, days: left });
      else if (left <= s.expiryWarn) push({ key: `exp:${l.id}:${l.expiry}`, kind: 'lens-expiry', level: 'soon', date: l.expiry, lensId: l.id, title: `${name} 快过有效期`, sub: `有效期至 ${l.expiry}（${dueLabel(left)}），还剩 ${l.qty} 片`, days: left });
    }
    if (!isLong(l.cycle) && (l.wearCount || 0) > 0 && l.qty > 0 && l.qty <= s.lowStock) {
      push({ key: `low:${l.id}:${l.qty}`, kind: 'low-stock', level: 'info', date: t, lensId: l.id, title: `${name} 只剩 ${l.qty} 片`, sub: '记得补货，或去心愿单看看下一副', days: 0 });
    }
  }

  for (const c of data.care || []) {
    if (c.finished) continue;
    if (isDailyDrops(c) && c.qty != null && c.qty !== '' && Number(c.qty) <= 5) {
      push({ key: `drops-low:${c.id}:${c.qty}`, kind: 'care-low', level: Number(c.qty) <= 0 ? 'due' : 'info', date: t, careId: c.id, title: `${c.name || '眼药水'} ${Number(c.qty) <= 0 ? '用完了' : `只剩 ${c.qty} 支`}`, sub: '日抛眼药水，记得补货', days: 0 });
    }
    const end = careEnd(c);
    if (!end) continue;
    const left = diffDays(t, end.date);
    const label = CARE_TYPES[c.type] ? CARE_TYPES[c.type].label : '护理品';
    const what = c.type === 'case' || c.type === 'tool' ? '该更换了' : '已过期';
    if (left < 0) push({ key: `care:${c.id}:${end.date}`, kind: 'care', level: 'overdue', date: end.date, careId: c.id, title: `${c.name || label} ${what}`, sub: `${end.why} ${end.date}（已过 ${-left} 天）`, days: left });
    else if (left <= s.careWarn) push({ key: `care:${c.id}:${end.date}`, kind: 'care', level: left <= 1 ? 'due' : 'soon', date: end.date, careId: c.id, title: `${c.name || label} ${left === 0 ? '今天到期' : `还剩 ${left} 天`}`, sub: `${end.why} ${end.date}`, days: left });
  }

  if (wearing && wearing.start) {
    const hours = ((now || new Date()) - new Date(wearing.start)) / 3600000;
    if (hours >= s.maxHours) push({ key: `wear:${wearing.start}`, kind: 'wear-long', level: 'due', date: t, lensId: wearing.lensId, title: `已经戴了 ${Math.floor(hours)} 小时`, sub: `建议每天不超过 ${s.maxHours} 小时，记得摘下让眼睛休息`, days: 0 });
  }

  const count = (data.lenses || []).length + (data.care || []).length;
  if (count >= 2 && (!s.lastBackup || diffDays(s.lastBackup.slice(0, 10), t) > 30)) {
    push({ key: `backup:${t.slice(0, 7)}`, kind: 'backup', level: 'info', date: t, title: '好久没备份啦', sub: '资料只存在这台手机上，建议导出一份备份', days: 0 });
  }

  const rank = { overdue: 0, due: 1, soon: 2, info: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.days - b.days);
}

// The earlier of: printed expiry, opened date + days usable after opening.
export function careEnd(c) {
  const opts = [];
  if (c.expiry) opts.push({ date: c.expiry, why: '有效期至' });
  const openDays = Number(c.openDays);
  // Daily (single-use) eye drops are thrown away after each use, so only the box's printed date counts.
  if (c.openedAt && openDays > 0 && !isDailyDrops(c)) opts.push({ date: addDays(c.openedAt, openDays), why: c.type === 'case' || c.type === 'tool' ? '建议更换日' : '开封后可用至' });
  return opts.sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}

// Stats for the "我的" page.
// Price of a lens / care product / wish converted to `to` (old records without a currency are MYR).
export const priceIn = (x, to) => convert(x && x.price, x && x.priceCur, to || 'MYR');

export function stats(data, now, cur) {
  cur = curOf(cur);
  const t = today(now);
  const month = t.slice(0, 7);
  const wears = data.wears || [];
  const lenses = data.lenses || [];
  const byLens = {};
  for (const w of wears) byLens[w.lensId] = (byLens[w.lensId] || 0) + 1;
  const monthDays = new Set(wears.filter((w) => w.date.startsWith(month)).map((w) => w.date)).size;
  const lensSpend = lenses.reduce((a, l) => a + priceIn(l, cur), 0);
  const spend = lensSpend + (data.care || []).reduce((a, c) => a + priceIn(c, cur), 0);
  const topId = Object.keys(byLens).sort((a, b) => byLens[b] - byLens[a])[0];
  const tones = {};
  for (const w of wears) { const l = lenses.find((x) => x.id === w.lensId); if (l) tones[l.tone || 'brown'] = (tones[l.tone || 'brown'] || 0) + 1; }
  const hours = wears.filter((w) => w.hours).map((w) => w.hours);
  return {
    monthDays,
    totalWears: wears.length,
    spend,
    perWear: wears.length ? lensSpend / wears.length : 0,
    top: topId ? { lens: lenses.find((l) => l.id === topId), count: byLens[topId] } : null,
    tones,
    avgHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0,
    byLens,
  };
}

// Calendar file (.ics) with an alarm for every upcoming reminder date.
export function buildIcs(data, settings, now) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const t = today(now);
  const ev = [];
  const add = (uidKey, date, title, desc, alarmDaysBefore) => {
    if (!date || date < t) return;
    const d = date.replace(/-/g, '');
    const next = addDays(date, 1).replace(/-/g, '');
    const alarms = [0, alarmDaysBefore].filter((x, i, a) => x != null && a.indexOf(x) === i)
      .map((x) => `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${esc(title)}\r\nTRIGGER:${x ? `-P${x}DT0H` : 'PT9H'}\r\nEND:VALARM`).join('\r\n');
    ev.push(`BEGIN:VEVENT\r\nUID:${uidKey}@lensy\r\nDTSTAMP:${stamp(now)}\r\nDTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${next}\r\nSUMMARY:${esc(title)}\r\nDESCRIPTION:${esc(desc)}\r\n${alarms}\r\nEND:VEVENT`);
  };
  for (const l of data.lenses || []) {
    if (l.archived) continue;
    for (const p of activePairs(l)) {
      const end = pairEnd(l, p);
      add(`end-${p.id}`, end, `👁 ${lensName(l)} 到期，请丢弃`, `${CYCLES[l.cycle].label}，开封于 ${p.openedAt}`, Math.min(s.warnDays, Math.floor(cycleDays(l.cycle) / 4)) || null);
      const every = Number(l.soakDays) || s.soakDays;
      let d = addDays(lastSoak(p), every);
      for (let i = 0; i < 12 && d < end; i++, d = addDays(d, every)) add(`soak-${p.id}-${d}`, d, `🫧 ${lensName(l)} 换护理液`, `每 ${every} 天换一次镜盒里的护理液`, null);
    }
    if ((l.qty || 0) > 0 && l.expiry) add(`exp-${l.id}`, l.expiry, `📦 ${lensName(l)} 有效期到`, `还剩 ${l.qty} 片`, s.expiryWarn > 7 ? 7 : null);
  }
  for (const c of data.care || []) {
    if (c.finished) continue;
    const end = careEnd(c);
    if (end) add(`care-${c.id}`, end.date, `🧴 ${c.name || '护理品'} 到期`, `${end.why} ${end.date}`, 3);
  }
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lensy//CN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Lensy 美瞳提醒\r\n${ev.join('\r\n')}${ev.length ? '\r\n' : ''}END:VCALENDAR\r\n`;
}
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const stamp = (now) => (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

// Google Calendar "add event" link for one reminder.
export function gcalLink(title, date, details) {
  const d = date.replace(/-/g, '');
  const n = addDays(date, 1).replace(/-/g, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${d}/${n}&details=${encodeURIComponent(details || '')}`;
}

// ---------- phone notifications (Lensy Push) ----------
// Upcoming reminders as exact times, for the push server to send while the app is closed.
// Date reminders go off at settings.remindAt on their day; "worn too long" at start + maxHours.
// Each item: {key, at (ms), title, body, url}. Only the future; soonest first.
export function pushSchedule(data, settings, now) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  now = now || new Date();
  const t = today(now);
  const [hh, mm] = String(s.remindAt || '09:00').split(':').map(Number);
  const at = (date) => { const d = parseDate(date); d.setHours(hh || 0, mm || 0, 0, 0); return d.getTime(); };
  const out = [];
  const snoozed = (rkey, date) => s.snooze && s.snooze[rkey] && s.snooze[rkey] >= date;
  const add = (key, date, title, body, url, rkey) => {
    if (!date || date < t || (rkey && snoozed(rkey, date))) return;
    out.push({ key, at: at(date), title, body, url: url || '#home' });
  };
  const wearing = s.wearing;
  for (const l of data.lenses || []) {
    if (l.archived) continue;
    const name = lensName(l);
    const url = `#lens/${l.id}`;
    for (const p of activePairs(l)) {
      const end = pairEnd(l, p);
      const rkey = `end:${p.id}:${end}`;
      const warn = Math.max(1, Math.min(s.warnDays, Math.floor(cycleDays(l.cycle) / 4)));
      if (warn > 1) add(`warn:${p.id}:${end}`, addDays(end, -warn), `⏳ ${name} 还剩 ${warn} 天`, `${end} 到期，记得准备下一副`, url, rkey);
      add(`end:${p.id}:${end}`, end, `⏳ ${name} 今天到期`, `开封于 ${p.openedAt}，今天戴完请丢弃`, url, rkey);
      add(`over:${p.id}:${end}`, addDays(end, 1), `⚠️ ${name} 已超出使用期`, '超期佩戴容易引起眼睛感染，请丢弃这副', url, rkey);
      if (wearing && wearing.pairId === p.id) continue; // taking them off refreshes the solution anyway
      const every = Number(l.soakDays) || s.soakDays;
      let d = addDays(lastSoak(p), every);
      if (d < t) d = t;
      for (let i = 0; i < 8 && d <= end; i++, d = addDays(d, every)) add(`soak:${p.id}:${d}`, d, `🫧 ${name} 该换护理液了`, `不戴的时候每 ${every} 天换一次镜盒里的护理液`, url, `soak:${p.id}:${d}`);
    }
    if ((l.qty || 0) > 0 && l.expiry) {
      const rkey = `exp:${l.id}:${l.expiry}`;
      if (s.expiryWarn > 0) add(`expwarn:${l.id}:${l.expiry}`, addDays(l.expiry, -Math.min(s.expiryWarn, 30)), `📦 ${name} 快过有效期`, `有效期至 ${l.expiry}，还剩 ${l.qty} 片`, url, rkey);
      add(rkey, l.expiry, `📦 ${name} 今天过有效期`, `还剩 ${l.qty} 片，过期请勿佩戴`, url, rkey);
    }
  }
  for (const c of data.care || []) {
    if (c.finished) continue;
    const end = careEnd(c);
    if (!end) continue;
    const label = c.name || (CARE_TYPES[c.type] ? CARE_TYPES[c.type].label : '护理品');
    const rkey = `care:${c.id}:${end.date}`;
    const change = c.type === 'case' || c.type === 'tool';
    if (s.careWarn > 0) add(`carewarn:${c.id}:${end.date}`, addDays(end.date, -s.careWarn), `🧴 ${label} 还剩 ${s.careWarn} 天`, `${end.why} ${end.date}`, '#lenses/care', rkey);
    add(rkey, end.date, `🧴 ${label} ${change ? '今天该更换了' : '今天到期'}`, `${end.why} ${end.date}`, '#lenses/care', rkey);
  }
  if (wearing && wearing.start) {
    const off = new Date(wearing.start).getTime() + s.maxHours * 3600000;
    const l = (data.lenses || []).find((x) => x.id === wearing.lensId);
    out.push({ key: `wear:${wearing.start}`, at: off, title: `👀 已经戴了 ${s.maxHours} 小时`, body: `${l ? lensName(l) + '，' : ''}记得摘下让眼睛休息`, url: '#home' });
  }
  return out.filter((x) => x.at > now.getTime()).sort((a, b) => a.at - b.at).slice(0, 60);
}
