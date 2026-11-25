// Checks a backup file before anything on the phone is touched. A backup is a JSON file that anyone can edit,
// and ids, dates and photos from it end up inside the page, so they may only hold the characters the app
// itself writes. Something that can't be right (a bad id, date or picture) refuses the whole file; harmless
// odd values (a number typed as text, an unknown colour family) are quietly fixed. No DOM: node tests import it.
import { CYCLES, TONES, CARE_TYPES, CURRENCIES } from './catalog.js';

export const STORES = ['lenses', 'care', 'wish', 'wears', 'learned', 'kv'];
const LABEL = { lenses: '美瞳', care: '护理品', wish: '心愿', wears: '佩戴记录', learned: '品牌资料', kv: '设置' };
const MAX_RECORDS = 20000; // per store
const MAX_PHOTOS = 60; // per record
export const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const IMG = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const TIME = /^\d{2}:\d{2}$/;
const POWER = /^[+-]?\d{1,2}\.\d{2}$/;

const NUMS = ['qty', 'boughtQty', 'pack', 'price', 'perWear', 'soakDays', 'dia', 'gdia', 'bc', 'water', 'wearCount', 'hours', 'pieces', 'priority', 'openDays', 'createdAt', 'updatedAt'];
const TEXTS = ['brand', 'series', 'color', 'shop', 'notes', 'name', 'volume', 'archiveWhy', 'link', 'specFrom', 'specSrc', 'powerL', 'powerR'];
const DATES = ['expiry', 'buyDate', 'date', 'openedAt', 'finishedAt'];

class BadBackup extends Error {}
const bad = (where, what) => { throw new BadBackup(`${where}${what}`); };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const empty = (v) => v === '' || v == null;

// '' / null stay; numbers and numeric text become numbers; anything else becomes ''.
function num(v) {
  if (empty(v)) return v;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : '';
}

function checkId(v, where, what) { if (typeof v !== 'string' || !ID.test(v)) bad(where, `的${what}不对`); }
function checkDate(v, where, what) { if (!empty(v) && !(typeof v === 'string' && DATE.test(v))) bad(where, `的${what}不是日期`); }

function cleanPhotos(list, where) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > MAX_PHOTOS) bad(where, '的照片列表不对');
  return list.map((p) => {
    if (!isObj(p)) bad(where, '有一张照片不对');
    for (const k of ['full', 'thumb']) if (!empty(p[k]) && !(typeof p[k] === 'string' && IMG.test(p[k]))) bad(where, '有一张照片不是图片');
    if (!p.full && !p.thumb) bad(where, '有一张照片是空的');
    const out = { ...p };
    if (out.kind !== 'mine' && out.kind !== 'web') delete out.kind;
    if ('w' in out) out.w = num(out.w);
    return out;
  });
}

// One record of a store, checked and tidied. Fields the app doesn't know are kept as they are (never shown).
function cleanRecord(store, r, where) {
  if (!isObj(r)) bad(where, '不是一条记录');
  const o = { ...r };
  if (store === 'learned') {
    if (typeof o.id !== 'string' || !o.id || o.id.length > 300) bad(where, '的编号不对');
  } else checkId(o.id, where, '编号');
  for (const k of NUMS) if (k in o) o[k] = num(o[k]);
  for (const k of TEXTS) if (k in o && !empty(o[k]) && typeof o[k] !== 'string') o[k] = String(o[k]);
  for (const k of DATES) if (k in o) checkDate(o[k], where, k === 'date' ? '日期' : '日期栏');
  if ('tone' in o && !TONES[o.tone]) o.tone = '';
  if ('priceCur' in o && !CURRENCIES[o.priceCur]) o.priceCur = 'MYR';
  if ('photos' in o) o.photos = cleanPhotos(o.photos, where);

  if (store === 'lenses' || store === 'learned') {
    if (!CYCLES[o.cycle]) bad(where, '的抛弃周期不对');
  }
  if (store === 'wish' && !empty(o.cycle) && !CYCLES[o.cycle]) o.cycle = '';
  if (store === 'wish' && 'priority' in o) o.priority = Math.max(0, Math.min(3, Math.round(Number(o.priority) || 0)));
  if (store === 'lenses') {
    if ('perWear' in o && !empty(o.perWear)) o.perWear = Number(o.perWear) === 1 ? 1 : 2;
    if (o.pairs == null) o.pairs = [];
    if (!Array.isArray(o.pairs)) bad(where, '的开封记录不对');
    o.pairs = o.pairs.map((p) => {
      if (!isObj(p)) bad(where, '有一条开封记录不对');
      checkId(p.id, where, '开封记录编号');
      for (const k of ['openedAt', 'soakAt', 'doneAt', 'endAt', 'lastWorn']) checkDate(p[k], where, '开封日期');
      if (!p.openedAt) bad(where, '有一副没有开封日期');
      const q = { ...p, status: p.status === 'using' ? 'using' : 'done' };
      if ('pieces' in q) q.pieces = num(q.pieces);
      for (const k of ['doneWhy']) if (k in q && !empty(q[k]) && typeof q[k] !== 'string') q[k] = String(q[k]);
      return q;
    });
    if (o.inspo == null) o.inspo = [];
    if (!Array.isArray(o.inspo)) bad(where, '的灵感收藏不对');
    o.inspo = o.inspo.map((x) => {
      if (!isObj(x)) bad(where, '有一条灵感收藏不对');
      if (!empty(x.id)) checkId(x.id, where, '灵感编号');
      if (!empty(x.img) && !(typeof x.img === 'string' && IMG.test(x.img))) bad(where, '的灵感截图不是图片');
      return { ...x, url: empty(x.url) ? '' : String(x.url), note: empty(x.note) ? '' : String(x.note) };
    });
  }
  if (store === 'care' && !CARE_TYPES[o.type] && o.type !== 'single') o.type = 'other';
  if (store === 'wears') {
    checkId(o.lensId, where, '美瞳编号');
    if (!empty(o.pairId)) checkId(o.pairId, where, '开封记录编号');
    if (!o.date) bad(where, '没有日期');
    for (const k of ['start', 'end']) if (!empty(o[k]) && !(typeof o[k] === 'string' && ISO.test(o[k]))) bad(where, '的时间不对');
  }
  return o;
}

// Settings from a backup: only the ones the app knows, each in its own shape. The push registration
// (id + secret) belongs to the phone, never to a file, so it is never taken from one.
export function cleanSettings(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const k of ['warnDays', 'soakDays', 'maxHours', 'lowStock', 'expiryWarn', 'careWarn']) {
    const n = num(v[k]);
    if (typeof n === 'number' && n >= 0 && n <= 365) out[k] = n;
  }
  for (const k of ['currency', 'lastCur']) if (CURRENCIES[v[k]]) out[k] = v[k];
  if (TIME.test(v.remindAt)) out.remindAt = v.remindAt;
  for (const k of ['powerL', 'powerR']) if (POWER.test(v[k]) || v[k] === '0.00') out[k] = v[k];
  for (const k of ['notify', 'hideInstall']) if (typeof v[k] === 'boolean') out[k] = v[k];
  if (typeof v.lastBackup === 'string' && ISO.test(v.lastBackup)) out.lastBackup = v.lastBackup;
  for (const k of ['snooze', 'notified']) {
    if (!isObj(v[k])) continue;
    out[k] = {};
    for (const [key, d] of Object.entries(v[k])) if (key.length <= 200 && typeof d === 'string' && DATE.test(d)) out[k][key] = d;
  }
  const w = v.wearing;
  if (isObj(w) && ID.test(w.lensId) && ID.test(w.wearId) && (empty(w.pairId) || ID.test(w.pairId)) && typeof w.start === 'string' && ISO.test(w.start)) {
    out.wearing = { lensId: w.lensId, pairId: w.pairId || null, start: w.start, wearId: w.wearId };
  }
  return out;
}

// The whole file → { lenses, care, wish, wears, learned, settings, counts }. Throws (with what is wrong, in
// Chinese, for the toast) before anything is written, so a bad file never wipes the phone's data.
export function cleanBackup(data) {
  if (!isObj(data) || data.app !== 'lensy') throw new BadBackup('这不是 Lensy 的备份文件');
  const out = { settings: null };
  for (const s of STORES) {
    const list = data[s] == null ? [] : data[s];
    if (!Array.isArray(list)) throw new BadBackup(`备份文件里的${LABEL[s]}部分已损坏`);
    if (list.length > MAX_RECORDS) throw new BadBackup(`备份文件里的${LABEL[s]}太多了`);
    if (s === 'kv') {
      const rec = list.find((r) => isObj(r) && r.id === 'settings');
      out.settings = rec ? cleanSettings(rec.value) : null;
      continue;
    }
    const seen = new Set();
    out[s] = list.map((r, i) => {
      const rec = cleanRecord(s, r, `第 ${i + 1} 条${LABEL[s]}`);
      if (seen.has(rec.id)) bad(`第 ${i + 1} 条${LABEL[s]}`, '和前面的编号重复');
      seen.add(rec.id);
      return rec;
    });
  }
  out.counts = { lenses: out.lenses.length, care: out.care.length, wish: out.wish.length, wears: out.wears.length };
  return out;
}

// Which "正在佩戴" to keep after an import: this phone's own one (merge), else the file's one when it is
// from the last 24 hours and its lens + wear record came along. An old backup would otherwise show
// "已戴 300 小时" on the new phone.
export function pickWearing(here, fromFile, clean, mode, now) {
  now = now || Date.now();
  if (mode === 'merge' && here) return here;
  if (!fromFile) return null;
  const age = now - new Date(fromFile.start).getTime();
  const ok = age >= -300000 && age < 24 * 3600000
    && clean.lenses.some((l) => l.id === fromFile.lensId) && clean.wears.some((w) => w.id === fromFile.wearId);
  return ok ? fromFile : null;
}

// The settings record to write: merge keeps this phone's settings and takes the file's on top; replace starts
// from the file's. Either way this phone's push registration stays, and a wrong/old 正在佩戴 is dropped.
export function mergeSettings(here, clean, mode, now) {
  here = here || {};
  const file = clean.settings || {};
  const base = mode === 'merge' ? here : {};
  return { ...base, ...file, push: here.push || null, wearing: pickWearing(here.wearing, file.wearing, clean, mode, now) };
}

// A copy of the settings for a backup file, without this phone's push id + secret.
export const exportSettings = (value) => ({ ...(value || {}), push: null });
