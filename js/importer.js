// Import from Apple Reminders (提醒事项).
// A web page can't read Reminders, so an iPhone Shortcut exports the list as text in this format:
//   @@ITEM
//   @@TITLE 拉拜诗 新晋 OL
//   @@NOTES 月
//   @@DONE 否
//   @@IMG <base64 jpeg>      (one per picture; wrapped lines are joined)
// Plain pasted text also works: one lens per line, an optional cycle line ("月" / "半" / "日") under it,
// and a heading containing 愿望/心愿 switches the following lines to the wishlist.
import { BRANDS, CYCLES, findBrand } from './catalog.js';

const TAG = /^@@(ITEM|TITLE|NOTES|DONE|IMG|END)\b\s?(.*)$/;
const YES = /^(yes|true|1|是|已完成|完成|✓)$/i;

export function parseExport(text) {
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/[​﻿]/g, '');
  if (!/@@ITEM/.test(text)) return parsePlain(text);
  const items = [];
  let cur = null;
  let field = null;
  for (const line of text.split('\n')) {
    const m = line.trim().match(TAG);
    if (m) {
      const [, tag, rest] = m;
      if (tag === 'ITEM') { cur = { title: '', notes: '', done: false, images: [], section: '' }; items.push(cur); field = null; continue; }
      if (!cur) continue;
      if (tag === 'TITLE') { cur.title = rest.trim(); field = 'title'; }
      else if (tag === 'NOTES') { cur.notes = rest; field = 'notes'; }
      else if (tag === 'DONE') { cur.done = YES.test(rest.trim()); field = null; }
      else if (tag === 'IMG') { cur.images.push(rest.trim()); field = 'img'; }
      else field = null;
      continue;
    }
    if (!cur) continue;
    if (field === 'notes') cur.notes += '\n' + line;
    else if (field === 'img') cur.images[cur.images.length - 1] += line.trim();
  }
  for (const it of items) {
    it.notes = it.notes.trim();
    it.images = it.images.map((b) => b.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')).filter((b) => b.length > 200 && /^[A-Za-z0-9+/=]+$/.test(b));
  }
  return items.filter((i) => i.title);
}

const CYCLE_ONLY = /^(日|月|季|年|半|半年|双周|两周|半月)(抛|抛弃)?$/;
const MARK = /^\s*(?:[-*•·]|\d+[.)、]|[☐○◯⚪︎]|\[\s?\]|[☑✓✔●◉]|\[x\])\s*/i;

function parsePlain(text) {
  const items = [];
  let section = '';
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (/愿望|心愿|wish/i.test(line) && line.length <= 12) { section = 'wish'; continue; }
    if (/美瞳柜|现有|库存|在用/.test(line) && line.length <= 10) { section = 'lens'; continue; }
    const done = /^\s*([☑✓✔●◉]|\[x\])/i.test(line);
    line = line.replace(MARK, '').trim();
    if (!line || !/[\p{L}\p{N}]/u.test(line)) continue; // emoji-only headings
    const last = items[items.length - 1];
    if (CYCLE_ONLY.test(line) && last && !last.notes) { last.notes = line; continue; }
    items.push({ title: line, notes: '', done, images: [], section });
  }
  return items;
}

// "月" -> monthly, "半" -> halfyear … (from a reminder's notes or title)
export function cycleFrom(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (/双周|两周|半月|2\s*-?\s*week/i.test(s)) return '2week';
  if (/半年|^半(抛)?$|半抛|half/i.test(s)) return 'halfyear';
  if (/季/.test(s)) return 'quarterly';
  if (/年/.test(s)) return 'yearly';
  if (/月|month/i.test(s)) return 'monthly';
  if (/^日|日抛|daily|1\s*day/i.test(s)) return 'daily';
  return '';
}

// Split "拉拜诗 新晋 OL" into brand + colour, preferring the longest brand name we know.
export function splitTitle(title, extraBrands) {
  const t = String(title || '').trim().replace(/\s+/g, ' ');
  const names = new Set();
  for (const b of BRANDS) { names.add(b.name); names.add(b.en); }
  for (const n of extraBrands || []) if (n) names.add(n);
  const hit = [...names].filter((n) => {
    const low = t.toLowerCase();
    const nl = n.toLowerCase();
    return low.startsWith(nl) && (t.length === n.length || /[\s·•\-_/｜|一-龥]/.test(t[n.length]) || /[一-龥]/.test(n.slice(-1)));
  }).sort((a, b) => b.length - a.length)[0];
  let brand;
  let color;
  if (hit) { brand = t.slice(0, hit.length); color = t.slice(hit.length); }
  else { const i = t.indexOf(' '); brand = i < 0 ? t : t.slice(0, i); color = i < 0 ? '' : t.slice(i + 1); }
  const known = findBrand(brand) || findBrand(hit || '');
  if (known) brand = known.name;
  else if (extraBrands) brand = extraBrands.find((n) => n.toLowerCase() === brand.toLowerCase()) || brand;
  return { brand: brand.trim(), color: color.replace(/^[\s·•\-_/｜|]+/, '').trim() };
}

// Turn parsed reminders into editable import rows.
// existing: [{brand, color}] already in Lensy, to skip duplicates.
export function toRows(items, { extraBrands, existing, wishExisting } = {}) {
  const have = new Set((existing || []).map((l) => `${l.brand}|${l.color}`.toLowerCase()));
  const haveWish = new Set((wishExisting || []).map((l) => `${l.brand}|${l.color}`.toLowerCase()));
  return items.map((it) => {
    const { brand, color } = splitTitle(it.title, extraBrands);
    const cycle = cycleFrom(it.notes) || cycleFrom((it.notes || '').split('\n')[0]);
    const notes = (it.notes || '').split('\n').filter((l) => !CYCLE_ONLY.test(l.trim())).join('\n').trim();
    const isLens = it.section ? it.section === 'lens' : !!cycle;
    const key = `${brand}|${color}`.toLowerCase();
    let dest = isLens ? 'lens' : 'wish';
    let why = '';
    if (dest === 'lens' && have.has(key)) { dest = 'skip'; why = 'Lensy 里已经有了'; }
    if (dest === 'wish' && haveWish.has(key)) { dest = 'skip'; why = '心愿单里已经有了'; }
    if (dest === 'wish' && it.done) { dest = 'skip'; why = '已勾选（应该买到了）'; }
    return {
      title: it.title, brand, color, cycle: cycle || (isLens ? 'daily' : ''), dest, why, done: !!it.done, notes, images: it.images || [],
      qty: it.done ? 0 : cycle && cycle !== 'daily' ? CYCLES[cycle].pack : 10, opened: false,
    };
  });
}
