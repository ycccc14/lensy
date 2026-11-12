// Lensy — contact lens tracker. Screens, forms and actions.
import * as DB from './db.js';
import { BRANDS, CYCLES, CYCLE_KEYS, TONES, TONE_KEYS, CARE_TYPES, DROP_CYCLES, CURRENCIES, CUR_KEYS, curOf, convert, isDailyDrops, fixCare, findBrand, colorsFor, specFor, cyclesFor, guessTone } from './catalog.js';
import { DEFAULT_SETTINGS, today, addDays, diffDays, uid, isLong, cycleDays, lensName, activePairs, pairEnd, lensState, lastSoak, dueLabel, reminders, careEnd, stats, buildIcs, gcalLink, parseDate, pushSchedule, priceIn } from './logic.js';
import { suggest, xhsApp, xhsWeb } from './style.js';

const VERSION = '1.3.4';
// Lensy Push server (server/Code.gs, Google Apps Script): sends reminders while the app is closed.
const PUSH_API = 'https://script.google.com/macros/s/AKfycbz1QL4_ebLslhwKmMIM-nitPbaG-_PUaUEKzP7_bKw1SWa488V5TVDLuU15v0cHn0w8/exec';
const S = { lenses: [], care: [], wish: [], wears: [], learned: [], settings: { ...DEFAULT_SETTINGS } };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dispCur = () => curOf(S.settings.currency);
const fmtNum = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2).replace(/\.00$/, '');
// money(n, cur): an amount in its own currency (default: the display currency).
const money = (n, cur) => (Number(n) ? `${CURRENCIES[curOf(cur || dispCur())].label} ${fmtNum(n)}` : '');
// A record's price as typed, plus "≈ RM x" when it is in another currency than the display one.
const priceText = (x) => {
  if (!Number(x && x.price)) return '';
  const own = curOf(x.priceCur);
  return own === dispCur() ? money(x.price, own) : `${money(x.price, own)}（≈ ${money(priceIn(x, dispCur()))}）`;
};
const curSelect = (val) => `<select name="priceCur" class="cur">${CUR_KEYS.map((k) => `<option value="${k}" ${curOf(val) === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`;
const priceField = (f, label) => field(label || '价格', `<div class="money-in">${input('price', f.price, 'inputmode="decimal" placeholder="总价"')}${curSelect(f.priceCur)}</div>`, '1 CNY = 0.6 MYR，1 AUD = 2.8 MYR');
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const toneHex = (t) => (TONES[t] || TONES.brown).hex;
const iris = (tone, cls) => `<i class="iris ${cls || ''}" style="--c:${toneHex(tone)}"></i>`;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const fmtCN = (iso) => { const d = parseDate(iso); return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`; };
const short = (iso) => (iso ? iso.slice(5).replace('-', '/') : '');
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dur = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`; };
const wearsOf = (id) => S.wears.filter((w) => w.lensId === id);
const lensById = (id) => S.lenses.find((l) => l.id === id);

// ---------- storage ----------
async function load() {
  const [lenses, care, wish, wears, learned, kv] = await Promise.all([DB.all('lenses'), DB.all('care'), DB.all('wish'), DB.all('wears'), DB.all('learned'), DB.get('kv', 'settings')]);
  Object.assign(S, { lenses, care: care.map(fixCare), wish, wears, learned });
  S.settings = { ...DEFAULT_SETTINGS, ...(kv ? kv.value : {}) };
  if (!CURRENCIES[S.settings.currency]) S.settings.currency = 'MYR'; // was a free-text symbol ('RM') before v1.3
}
const saveSettings = async () => { await DB.put('kv', { id: 'settings', value: S.settings }); pushSoon(); };
async function save(store, rec) {
  rec.updatedAt = Date.now();
  const i = S[store].findIndex((x) => x.id === rec.id);
  if (i < 0) S[store].push(rec); else S[store][i] = rec;
  await DB.put(store, rec);
  pushSoon();
  return rec;
}
async function remove(store, id) {
  S[store] = S[store].filter((x) => x.id !== id);
  await DB.del(store, id);
  pushSoon();
}
// Remember what the user typed so the next lens of the same brand/colour/cycle fills itself in.
async function learn(l) {
  const id = `${l.brand}|${l.color}|${l.cycle}`.toLowerCase();
  const rec = { id, brand: l.brand, series: l.series || '', color: l.color, cycle: l.cycle, tone: l.tone, dia: l.dia, gdia: l.gdia, bc: l.bc, water: l.water, pack: l.pack || null };
  await save('learned', rec);
}

// ---------- small UI helpers ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function sheet(title, html, opts) {
  opts = opts || {};
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet ${opts.cls || ''}" role="dialog" aria-label="${esc(title)}">
    <div class="sheet-head"><b>${esc(title)}</b><button class="x" data-close aria-label="关闭">✕</button></div>
    <div class="sheet-body">${html}</div>${opts.foot ? `<div class="sheet-foot">${opts.foot}</div>` : ''}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const api = {
    el: wrap,
    body: $('.sheet-body', wrap),
    close() {
      if (closed) return;
      closed = true;
      wrap.className = 'sheet-closing'; // no longer counts as an open sheet
      setTimeout(() => wrap.remove(), 220);
      if (opts.onClose) opts.onClose();
    },
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.classList.contains('sheet-bg') || e.target.closest('[data-close]')) api.close();
  });
  return api;
}

function ask(title, msg, ok, danger) {
  return new Promise((resolve) => {
    let answered = false;
    const sh = sheet(title, `<p class="ask">${esc(msg)}</p>`, {
      cls: 'small',
      foot: `<button class="btn ghost" data-close>取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok || '确定')}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    $('[data-ok]', sh.el).onclick = () => { answered = true; resolve(true); sh.close(); };
  });
}

function choose(title, options, msg) {
  return new Promise((resolve) => {
    let answered = false;
    const sh = sheet(title, `${msg ? `<p class="ask">${esc(msg)}</p>` : ''}<div class="choices">${options.map((o, i) => `<button class="btn ${o.cls || 'soft'} block" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`, {
      cls: 'small', onClose: () => { if (!answered) resolve(null); },
    });
    sh.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      answered = true;
      resolve(options[+b.dataset.i].value);
      sh.close();
    });
  });
}

// One file input that lives on <body> for the whole session: an input inside a redrawn screen can vanish
// while the phone's photo picker is open, and the picked photo is then silently lost.
const fileIn = Object.assign(document.createElement('input'), { type: 'file', hidden: true });
fileIn.id = 'file-in';
document.body.appendChild(fileIn);
function pickFiles(accept, multiple) {
  return new Promise((resolve) => {
    fileIn.accept = accept;
    fileIn.multiple = !!multiple;
    fileIn.value = '';
    fileIn.onchange = () => resolve([...fileIn.files]);
    fileIn.click();
  });
}
const readUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
const readText = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsText(file); });
const loadImg = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('图片读取失败')); i.src = src; });
// Sharp resize: halve step by step (one big jump drops detail and looks blurry), high-quality smoothing.
function shrink(img, max, q) {
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const W = Math.round(w * k);
  const H = Math.round(h * k);
  let src = img;
  while (w / 2 >= W * 1.05) {
    const c = document.createElement('canvas');
    c.width = Math.round(w / 2); c.height = Math.round(h / 2);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, W, H);
  return c.toDataURL('image/jpeg', q);
}
const PHOTO_MAX = 2000; // long side of the stored photo (full screen on any phone stays sharp)
const THUMB_MAX = 800; // grid tiles and cards (≈ 3× their on-screen size)
// kind: 'mine' (我的佩戴效果) or 'web' (网图: shop / 小红书 pictures)
async function photosFromPicker(kind) {
  const files = await pickFiles('image/*', true);
  const out = [];
  for (const f of files) {
    try {
      const img = await loadImg(await readUrl(f));
      out.push({ full: shrink(img, PHOTO_MAX, 0.9), thumb: shrink(img, THUMB_MAX, 0.88), w: 2, kind: kind || 'mine' });
    } catch (e) { toast('有一张图片读不了，换一张试试'); }
  }
  return out;
}
// Photos saved before v1.3 have a 300px thumbnail that looks blurry when shown big: use the full picture.
const photoSrc = (p) => (p.w ? p.thumb : p.full || p.thumb);
const kindOf = (p, def) => p.kind || def || 'mine';
const PHOTO_KINDS = { mine: '我的佩戴效果', web: '网图' };

async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (/iPhone|iPad|Android/.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return true;
}

const powers = () => {
  const out = [];
  for (let v = 6; v >= -12; v -= v > -6.01 ? 0.25 : 0.5) out.push((v > 0 ? '+' : '') + v.toFixed(2));
  return out.map((v) => (v === '+0.00' || v === '-0.00' ? '0.00' : v)).filter((v, i, a) => a.indexOf(v) === i);
};
const powerSelect = (name, val, attrs) => `<select name="${name}" ${attrs || ''}>${powers().map((p) => `<option ${p === String(val) ? 'selected' : ''}>${p}</option>`).join('')}</select>`;
const bar = (frac, cls) => `<div class="prog ${cls || ''}"><i style="width:${Math.max(3, Math.min(100, frac * 100)).toFixed(1)}%"></i></div>`;
const firstPhoto = (x) => (x.photos || []).find((p) => kindOf(p) === 'mine') || (x.photos || [])[0];
const thumbOf = (x, cls) => (firstPhoto(x) ? `<img class="thumb ${cls || ''}" src="${photoSrc(firstPhoto(x))}" alt="">` : `<div class="thumb ${cls || ''} noimg">${iris(x.tone, 'lg')}</div>`);
const xhsButtons = (q, label) => `<div class="xhs"><a class="btn xhs-btn" href="${xhsApp(q)}">📕 ${esc(label || '小红书')}</a><a class="btn ghost sm" href="${xhsWeb(q)}" target="_blank" rel="noopener">网页版</a></div>`;

// ---------- screens ----------
function greet() { const h = new Date().getHours(); return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }

function Home() {
  const t = today();
  const rs = reminders(S, S.settings);
  const live = S.lenses.filter((l) => !l.archived);
  const usingPairs = live.reduce((a, l) => a + (isLong(l.cycle) ? activePairs(l).length : lensState(l) === 'using' ? 1 : 0), 0);
  const pieces = live.reduce((a, l) => a + (l.qty || 0), 0);
  const st = stats(S);
  const install = IOS && !STANDALONE && !S.settings.hideInstall
    ? `<div class="card install"><b>📲 把 Lensy 加到主屏幕</b><p>在 Safari 点下方的 <b>Share</b> 按钮（方框加向上箭头）→ <b>Add to Home Screen</b> → <b>Add</b>，就能像 App 一样打开，还可以开启通知。</p><button class="btn ghost sm" data-act="hide-install">知道了</button></div>` : '';
  return `
  <header class="top"><div><div class="hello">${greet()} ✨</div><h1>Lensy</h1></div><div class="date">${fmtCN(t)}</div></header>
  ${install}
  ${wearCard()}
  <section class="stats3">
    <a href="#lenses/using"><b>${usingPairs}</b><span>使用中</span></a>
    <a href="#lenses/stock"><b>${pieces}</b><span>库存片数</span></a>
    <a href="#stats"><b>${st.monthDays}</b><span>本月佩戴天</span></a>
  </section>
  <h2 class="sec">提醒 ${rs.length ? `<span class="count">${rs.length}</span>` : ''}</h2>
  <div class="rems">${rs.length ? rs.map(remCard).join('') : '<div class="empty">✨ 一切都好，暂时没有要处理的事</div>'}</div>
  ${inspoCard()}`;
}

function wearCard() {
  const w = S.settings.wearing;
  if (w) {
    const l = lensById(w.lensId);
    if (l) {
      const start = new Date(w.start);
      const off = new Date(start.getTime() + S.settings.maxHours * 3600000);
      const frac = (Date.now() - start) / (S.settings.maxHours * 3600000);
      return `<section class="card wearing">
        <div class="row">${thumbOf(l, 'md')}<div class="grow"><div class="label">正在佩戴</div><b>${esc(lensName(l))}</b>
        <div class="muted">已戴 <span data-since="${w.start}">${dur(Date.now() - start)}</span> · 建议 ${hm(off)} 前摘下</div></div></div>
        ${bar(frac, frac >= 1 ? 'red' : frac > 0.8 ? 'amber' : '')}
        <div class="btns"><button class="btn primary" data-act="wear-stop">摘下 👋</button><a class="btn ghost" href="#lens/${l.id}">详情</a></div></section>`;
    }
  }
  const t = today();
  const opts = [];
  for (const l of S.lenses) {
    if (l.archived) continue;
    if (isLong(l.cycle)) {
      const ps = activePairs(l);
      ps.forEach((p, i) => opts.push({ l, p, sub: `${CYCLES[l.cycle].label}${ps.length > 1 ? ` · 第${i + 1}副` : ''} · 剩 ${Math.max(0, diffDays(t, pairEnd(l, p)))} 天` }));
      if (!ps.length && l.qty > 0) opts.push({ l, p: null, sub: `${CYCLES[l.cycle].label} · 开封新的一副` });
    } else if (l.qty > 0) opts.push({ l, p: null, sub: `日抛 · 剩 ${l.qty} 片` });
  }
  const order = (o) => (o.p ? 0 : lensState(o.l) === 'using' ? 1 : 2);
  opts.sort((a, b) => order(a) - order(b));
  const done = S.wears.filter((x) => x.date === t);
  const last = done[done.length - 1];
  const lastLens = last && lensById(last.lensId);
  if (!opts.length) {
    return `<section class="card wear-pick"><b>还没有可以戴的美瞳</b><p class="muted">先把手上的美瞳录进来吧</p><div class="btns"><button class="btn primary" data-act="add-lens">＋ 添加美瞳</button></div></section>`;
  }
  return `<section class="card wear-pick">
    <div class="row between"><b>今天戴哪副？</b>${lastLens ? `<span class="muted sm">今天戴过 ${esc(lastLens.color || lastLens.brand)}${last.hours ? ` ${last.hours.toFixed(1)}h` : ''}</span>` : ''}</div>
    <div class="pickgrid">${opts.map((o) => `<button class="pickl" data-act="wear" data-id="${o.l.id}" data-pair="${o.p ? o.p.id : ''}">
      ${thumbOf(o.l, 'sm')}<b>${esc(o.l.color || o.l.brand)}</b><span>${esc(o.sub)}</span></button>`).join('')}</div></section>`;
}

const REM_ICON = { 'pair-end': '⏳', soak: '🫧', 'lens-expiry': '📦', 'low-stock': '🛒', care: '🧴', 'care-low': '💧', 'wear-long': '👀', backup: '💾' };
function remCard(r) {
  const go = r.lensId ? `<a class="btn ghost sm" href="#lens/${r.lensId}">查看</a>` : '';
  const later = (days, label) => `<button class="btn ghost sm" data-act="snooze" data-key="${esc(r.key)}" data-days="${days}">${label || '稍后'}</button>`;
  const acts = {
    'pair-end': `<button class="btn sm ${r.level === 'overdue' ? 'danger' : 'primary'}" data-act="pair-done" data-id="${r.lensId}" data-pair="${r.pairId}">丢弃这副</button>${go}${r.level !== 'overdue' ? later(0) : ''}`,
    soak: `<button class="btn sm primary" data-act="soak" data-id="${r.lensId}" data-pair="${r.pairId}">已换水 🫧</button>${go}${later(0)}`,
    'lens-expiry': `${go}${later(7, '知道了')}`,
    'low-stock': `<button class="btn sm primary" data-act="restock" data-id="${r.lensId}">补货 +1盒</button><a class="btn ghost sm" href="#wish">心愿单</a>${later(9999, '知道了')}`,
    care: `<button class="btn sm primary" data-act="care-done" data-id="${r.careId}">用完/已换新</button>${later(0)}`,
    'care-low': `<a class="btn sm primary" href="#lenses/care">去看看</a>${later(9999, '知道了')}`,
    'wear-long': '<button class="btn sm primary" data-act="wear-stop">摘下 👋</button>',
    backup: `<button class="btn sm primary" data-act="backup">立即备份</button>${later(9999, '知道了')}`,
  };
  return `<div class="rem ${r.level}"><div class="ico">${REM_ICON[r.kind] || '🔔'}</div><div class="grow"><b>${esc(r.title)}</b><p>${esc(r.sub)}</p><div class="btns">${acts[r.kind] || ''}</div></div></div>`;
}

function inspoCard() {
  const w = S.settings.wearing;
  const lastW = S.wears.slice().sort((a, b) => (a.start || a.date) < (b.start || b.date) ? 1 : -1)[0];
  const l = (w && lensById(w.lensId)) || (lastW && lensById(lastW.lensId)) || S.lenses.find((x) => lensState(x) === 'using');
  if (!l) return '';
  const sg = suggest(l);
  return `<h2 class="sec">今日妆容灵感</h2><section class="card inspo">
    <div class="row">${iris(l.tone, 'lg')}<div class="grow"><b>${esc(lensName(l))}</b><div class="tags">${sg.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div></div>
    <p class="formula">💄 ${esc(sg.formula)}</p>${xhsButtons(sg.searches[0].q, '小红书看上眼图')}
    <a class="more" href="#lens/${l.id}">完整搭配建议 ›</a></section>`;
}

const SEGS = [['using', '使用中'], ['stock', '未开封'], ['care', '护理品'], ['done', '存档']];
function Lenses(seg) {
  seg = SEGS.some((s) => s[0] === seg) ? seg : 'using';
  const count = (k) => (k === 'care' ? S.care.filter((c) => !c.finished).length : S.lenses.filter((l) => lensState(l) === k).length);
  const head = `<header class="top"><h1>美瞳柜</h1><button class="btn primary round" data-act="${seg === 'care' ? 'add-care' : 'add-lens'}" aria-label="添加">＋</button></header>
    <nav class="seg">${SEGS.map(([k, n]) => `<a href="#lenses/${k}" class="${k === seg ? 'on' : ''}">${n}<small>${count(k)}</small></a>`).join('')}</nav>`;
  if (seg === 'care') return head + careList();
  const list = S.lenses.filter((l) => lensState(l) === seg).sort((a, b) => sortKey(a) - sortKey(b));
  const empty = { using: '还没有正在用的美瞳。去「未开封」开封一副，或在首页选今天戴哪副。', stock: '没有未开封的库存', done: '用完或存档的美瞳会放在这里，方便回顾戴过哪些' }[seg];
  return `${head}${list.length > 3 ? '<input class="search" placeholder="搜索品牌 / 花色" data-filter>' : ''}
    <div class="list">${list.length ? list.map(lensCard).join('') : `<div class="empty">${empty}${seg !== 'done' ? '<br><button class="btn primary" data-act="add-lens">＋ 添加美瞳</button>' : ''}</div>`}</div>`;
}
function sortKey(l) {
  const p = activePairs(l)[0];
  if (p) return diffDays(today(), pairEnd(l, p));
  if (l.archived || lensState(l) === 'done') return -(l.updatedAt || 0) / 1e9;
  return l.expiry ? diffDays(today(), l.expiry) + 1000 : 5000;
}

function lensCard(l) {
  const st = lensState(l);
  const t = today();
  const ps = activePairs(l);
  let line = '';
  let prog = '';
  if (isLong(l.cycle) && ps.length) {
    const p = ps[0];
    const end = pairEnd(l, p);
    const total = cycleDays(l.cycle);
    const used = diffDays(p.openedAt, t) + 1;
    const left = diffDays(t, end);
    line = `第 ${Math.max(1, used)}/${total} 天 · ${left >= 0 ? `${left} 天后到期` : `已超期 ${-left} 天`}${ps.length > 1 ? ` · 共 ${ps.length} 副在用` : ''}${l.qty ? ` · 库存 ${l.qty} 片` : ''}`;
    prog = bar(used / total, left < 0 ? 'red' : left <= 7 ? 'amber' : '');
  } else if (st === 'done') {
    line = `${l.archived ? (l.archiveWhy || '已存档') : '已用完'} · 共戴 ${wearsOf(l.id).length} 次${l.price ? ` · ${money(l.price, l.priceCur)}` : ''}`;
  } else if (!isLong(l.cycle)) {
    line = `剩 ${l.qty} 片 · 戴过 ${wearsOf(l.id).length} 次${l.expiry ? ` · 有效期 ${l.expiry}` : ''}`;
    if (l.boughtQty) prog = bar(l.qty / l.boughtQty, l.qty <= S.settings.lowStock ? 'amber' : '');
  } else {
    line = `库存 ${l.qty} 片${l.expiry ? ` · 有效期 ${l.expiry}` : ''}`;
  }
  return `<a class="card lcard" href="#lens/${l.id}" data-q="${esc((l.brand + ' ' + l.color + ' ' + (l.series || '')).toLowerCase())}">
    ${thumbOf(l)}<div class="grow"><b>${esc(l.brand)}</b><div class="color">${iris(l.tone, 'sm')}${esc(l.color || '')}</div>
    <div class="tags"><span class="tag">${CYCLES[l.cycle] ? CYCLES[l.cycle].label : ''}</span>${l.powerL && l.powerL !== '0.00' ? `<span class="tag">${esc(l.powerL === l.powerR ? l.powerL : l.powerL + '/' + l.powerR)}</span>` : ''}</div>
    <div class="muted sm">${esc(line)}</div>${prog}</div></a>`;
}

function careList() {
  const active = S.care.filter((c) => !c.finished).sort((a, b) => ((careEnd(a) || { date: '9999' }).date < (careEnd(b) || { date: '9999' }).date ? -1 : 1));
  const old = S.care.filter((c) => c.finished);
  const card = (c) => {
    const ty = CARE_TYPES[c.type] || CARE_TYPES.other;
    const end = careEnd(c);
    const left = end ? diffDays(today(), end.date) : null;
    let prog = '';
    if (c.openedAt && end) { const total = Math.max(1, diffDays(c.openedAt, end.date)); prog = bar(diffDays(c.openedAt, today()) / total, left < 0 ? 'red' : left <= S.settings.careWarn ? 'amber' : ''); }
    const daily = isDailyDrops(c);
    const status = c.finished ? `已用完 ${c.finishedAt || ''}` : end ? `${end.why} ${end.date}（${dueLabel(left)}）` : '未填写有效期';
    const sub = daily ? `日抛${c.qty !== '' && c.qty != null ? ` · 剩 ${c.qty} 支` : ''}` : c.openedAt ? `开封 ${c.openedAt}${c.type === 'drops' ? ` · ${c.openDays} 天内用完` : ''}` : '未开封';
    return `<div class="card ccard ${left != null && left < 0 && !c.finished ? 'late' : ''}">
      <div class="row">${c.photos && c.photos[0] ? `<img class="thumb sm" src="${photoSrc(c.photos[0])}" alt="">` : `<div class="cicon">${ty.icon}</div>`}
      <div class="grow"><b>${esc(c.name || ty.label)}</b><div class="muted sm">${ty.label} · ${esc(sub)}</div><div class="sm ${left != null && left < 0 && !c.finished ? 'red-t' : ''}">${esc(status)}</div>${prog}</div></div>
      <div class="btns">${c.finished ? `<button class="btn ghost sm" data-act="care-restore" data-id="${c.id}">恢复</button>`
        : daily ? `<button class="btn sm primary" data-act="drop-use" data-id="${c.id}">用了一支 −1</button><button class="btn sm soft" data-act="care-done" data-id="${c.id}">用完了</button>`
        : `${!c.openedAt ? `<button class="btn sm primary" data-act="care-open" data-id="${c.id}">今天开封</button>` : ''}<button class="btn sm soft" data-act="care-done" data-id="${c.id}">${c.type === 'case' ? '已换新' : '用完了'}</button>`}
      <button class="btn ghost sm" data-act="edit-care" data-id="${c.id}">编辑</button></div></div>`;
  };
  return `<p class="muted sm pad">护理液开封后一般 90 天内用完；眼药水按包装上的使用周期（日抛单支装用一次就丢）；镜盒建议每 3 个月更换。</p>
    <div class="list">${active.length ? active.map(card).join('') : '<div class="empty">记录护理液、眼药水、镜盒，快过期时会提醒你<br><button class="btn primary" data-act="add-care">＋ 添加护理品</button></div>'}</div>
    ${old.length ? `<details class="old"><summary>已用完（${old.length}）</summary><div class="list">${old.map(card).join('')}</div></details>` : ''}`;
}

// Style & makeup card (lens detail and wishlist detail).
function styleCard(sg) {
  return `<section class="card style"><h3>风格 & 搭配建议 <small>根据花色、色系和尺寸自动生成</small></h3>
    <div class="tags">${sg.tags.map((x) => `<span class="tag pink">${esc(x)}</span>`).join('')}</div>
    <p class="formula">💄 ${esc(sg.formula)}</p>
    <div class="makeup">${sg.makeup.map((m) => `<div><span>${m.k}</span><div>${m.palette ? m.palette.map((p) => `<i class="dot" style="background:${p.hex}"></i>${esc(p.name)}`).join('　') : esc(m.text)}</div></div>`).join('')}
    <div><span>适合</span><div>${sg.scenes.map(esc).join(' · ')}</div></div><div><span>发色</span><div>${esc(sg.hair)}</div></div><div><span>穿搭</span><div>${esc(sg.outfit)}</div></div></div>
    <ul class="tips">${sg.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h4>去小红书看真人上眼 & 妆容</h4>
    ${sg.searches.map((s) => `<div class="xrow"><span>${esc(s.label)}<small>${esc(s.q)}</small></span><a class="btn xhs-btn sm" href="${s.app}">📕 App</a><a class="btn ghost sm" href="${s.web}" target="_blank" rel="noopener">网页</a></div>`).join('')}
  </section>`;
}

function LensDetail(id) {
  const l = lensById(id);
  if (!l) return `<header class="bar"><button class="back" data-act="back">‹</button><b>美瞳</b><span></span></header><div class="empty">找不到这副美瞳</div>`;
  const st = lensState(l);
  const t = today();
  const stLabel = { using: '使用中', stock: '未开封', done: l.archived ? '已存档' : '已用完' }[st];
  const long = isLong(l.cycle);
  const ps = activePairs(l);
  const wears = wearsOf(l.id).sort((a, b) => ((a.start || a.date) < (b.start || b.date) ? 1 : -1));
  const all = l.photos || [];
  const gal = (kind) => {
    const list = all.map((p, i) => ({ p, i })).filter((x) => kindOf(x.p) === kind);
    return `<section class="card gal"><div class="row between"><h3>${PHOTO_KINDS[kind]}${list.length ? `<small>${list.length} 张</small>` : ''}</h3><button class="btn ghost sm" data-act="add-photo" data-id="${l.id}" data-kind="${kind}">＋ 添加</button></div>
      ${list.length ? `<div class="gallery ${list.length === 1 ? 'one' : ''}">${list.map((x) => `<img src="${list.length === 1 ? x.p.full || x.p.thumb : photoSrc(x.p)}" data-act="photo" data-id="${l.id}" data-i="${x.i}" alt="">`).join('')}</div>`
        : `<p class="muted sm">${kind === 'mine' ? '拍一张自己戴上的效果，方便以后对比' : '存店铺图或小红书上的上眼图'}</p>`}</section>`;
  };
  const photos = all.length ? gal('mine') + gal('web')
    : `<div class="gallery none" data-act="add-photo" data-id="${l.id}" data-kind="mine">${iris(l.tone, 'xl')}<span>＋ 添加我的佩戴效果</span></div><div class="btns center"><button class="btn ghost sm" data-act="add-photo" data-id="${l.id}" data-kind="web">＋ 添加网图</button></div>`;
  const per = Number(l.perWear) || 2;
  const stock = st === 'done' && !l.qty ? '' : `<section class="card">
    <div class="row between"><div><div class="label">库存</div><div class="big">${l.qty || 0}<small> 片</small></div></div>
    <div class="stepper"><button data-act="qty" data-id="${l.id}" data-d="-1" aria-label="减一片">−</button><button data-act="qty" data-id="${l.id}" data-d="1" aria-label="加一片">＋</button><button class="wide" data-act="restock" data-id="${l.id}">+1盒</button></div></div>
    <div class="btns">${!long && l.qty > 0 ? `<button class="btn primary" data-act="wear" data-id="${l.id}" data-pair="">今天戴这副（−${per}片）</button>` : ''}
    ${long && l.qty > 0 ? `<button class="btn ${ps.length ? 'soft' : 'primary'}" data-act="open-pair" data-id="${l.id}">开封新的一副</button>` : ''}
    <button class="btn ghost" data-act="log-wear" data-id="${l.id}">补记一次</button></div></section>`;
  const pairCards = ps.map((p, i) => {
    const end = pairEnd(l, p);
    const total = cycleDays(l.cycle);
    const used = Math.max(1, diffDays(p.openedAt, t) + 1);
    const left = diffDays(t, end);
    const soak = lastSoak(p);
    const every = Number(l.soakDays) || S.settings.soakDays;
    const sinceSoak = diffDays(soak, t);
    const wearing = S.settings.wearing && S.settings.wearing.pairId === p.id;
    return `<section class="card pair">
      <div class="row between"><b>${ps.length > 1 ? `第 ${i + 1} 副` : '在用的这副'}${p.pieces === 1 ? '（单片）' : ''}</b><span class="tag ${left < 0 ? 'red' : left <= 7 ? 'amber' : 'green'}">${left < 0 ? `超期 ${-left} 天` : left === 0 ? '今天到期' : `剩 ${left} 天`}</span></div>
      ${bar(used / total, left < 0 ? 'red' : left <= 7 ? 'amber' : '')}
      <dl class="kv"><dt>开封</dt><dd>${p.openedAt}（第 ${used}/${total} 天）</dd><dt>建议丢弃</dt><dd>${end}</dd>
      <dt>上次换水</dt><dd class="${sinceSoak > every ? 'red-t' : ''}">${soak}（${sinceSoak === 0 ? '今天' : sinceSoak + ' 天前'}，每 ${every} 天换）</dd><dt>已戴</dt><dd>${S.wears.filter((w) => w.pairId === p.id).length} 次</dd></dl>
      <div class="btns">${wearing ? '<button class="btn primary" data-act="wear-stop">摘下 👋</button>' : `<button class="btn primary" data-act="wear" data-id="${l.id}" data-pair="${p.id}">今天戴这副</button>`}
      <button class="btn soft" data-act="soak" data-id="${l.id}" data-pair="${p.id}">已换水 🫧</button>
      <button class="btn ghost" data-act="pair-cal" data-id="${l.id}" data-pair="${p.id}">📅 加到日历</button>
      <button class="btn ghost" data-act="pair-edit" data-id="${l.id}" data-pair="${p.id}">改开封日</button>
      <button class="btn ghost danger-t" data-act="pair-done" data-id="${l.id}" data-pair="${p.id}">丢弃这副</button></div></section>`;
  }).join('');
  const spec = (k, v, unit) => (v !== '' && v != null ? `<div><span>${k}</span><b>${esc(v)}${unit || ''}</b></div>` : '');
  const sg = suggest(l);
  const pastPairs = (l.pairs || []).filter((p) => p.status === 'done');
  return `<header class="bar"><button class="back" data-act="back" aria-label="返回">‹</button><b>美瞳详情</b><button class="btn ghost sm" data-act="edit-lens" data-id="${l.id}">编辑</button></header>
  ${photos}
  <div class="lhead"><h1>${esc(l.brand)}</h1><div class="lcolor">${iris(l.tone)}${esc(l.color || '')}</div>
  <div class="tags"><span class="tag">${CYCLES[l.cycle].label}</span><span class="tag">${TONES[l.tone] ? TONES[l.tone].label : ''}</span><span class="tag st-${st}">${stLabel}</span>${l.series ? `<span class="tag">${esc(l.series)}</span>` : ''}</div></div>
  ${pairCards}${stock}
  <section class="card"><h3>产品资料</h3><div class="specs">
    ${spec('直径', l.dia, 'mm')}${spec('着色直径', l.gdia, 'mm')}${spec('基弧', l.bc, 'mm')}${spec('含水量', l.water, '%')}
    ${spec('度数 左', l.powerL)}${spec('度数 右', l.powerR)}${spec('有效期', l.expiry)}${spec('购买日期', l.buyDate)}
    ${spec('价格', priceText(l))}${spec('购买渠道', l.shop)}${long ? spec('换水间隔', `${Number(l.soakDays) || S.settings.soakDays} 天`) : ''}${spec('买入片数', l.boughtQty)}
  </div>${l.notes ? `<p class="note">📝 ${esc(l.notes)}</p>` : ''}</section>
  ${styleCard(sg)}
  <section class="card"><div class="row between"><h3>我的灵感收藏</h3><button class="btn ghost sm" data-act="add-inspo" data-id="${l.id}">＋ 收藏</button></div>
    ${(l.inspo || []).length ? `<div class="inspo-list">${l.inspo.map((x, i) => `<div class="ins">${x.img ? `<img src="${x.img}" data-act="inspo-img" data-id="${l.id}" data-i="${i}" alt="">` : ''}<div class="grow">${x.note ? `<p>${esc(x.note)}</p>` : ''}${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url.length > 42 ? x.url.slice(0, 42) + '…' : x.url)}</a>` : ''}</div><button class="x" data-act="del-inspo" data-id="${l.id}" data-i="${i}" aria-label="删除">✕</button></div>`).join('')}</div>`
      : '<p class="muted sm">在小红书看到喜欢的妆容？复制笔记链接或截图存到这里。</p>'}</section>
  <section class="card"><h3>佩戴记录 <small>${wears.length} 次</small></h3>
    ${wears.length ? `<ul class="hist">${wears.slice(0, 30).map((w) => `<li><span>${w.date}</span><span class="muted">${w.start ? hm(new Date(w.start)) : '补记'}${w.hours ? ` · ${w.hours.toFixed(1)} 小时` : w.start && !w.end ? ' · 佩戴中' : ''}</span><button class="x" data-act="del-wear" data-id="${w.id}" aria-label="删除这条">✕</button></li>`).join('')}</ul>` : '<p class="muted sm">还没有佩戴记录</p>'}
    ${pastPairs.length ? `<h4>用完的几副</h4><ul class="hist">${pastPairs.map((p) => `<li><span>${p.openedAt} → ${p.doneAt}</span><span class="muted">${esc(p.doneWhy || '')} · 戴了 ${S.wears.filter((w) => w.pairId === p.id).length} 次</span></li>`).join('')}</ul>` : ''}
  </section>
  <div class="btns center pad">${l.archived ? `<button class="btn soft" data-act="unarchive" data-id="${l.id}">移回美瞳柜</button>` : `<button class="btn soft" data-act="archive" data-id="${l.id}">移到存档</button>`}
  <button class="btn soft" data-act="rebuy" data-id="${l.id}">再买一次</button>
  <button class="btn ghost danger-t" data-act="del-lens" data-id="${l.id}">删除</button></div>`;
}

function Wish() {
  const list = S.wish.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.createdAt || 0) - (a.createdAt || 0));
  const total = list.reduce((a, w) => a + priceIn(w, dispCur()), 0);
  return `<header class="top"><div><h1>心愿单</h1>${total ? `<div class="muted sm">全部买下约 ${money(total)}</div>` : ''}</div><button class="btn primary round" data-act="add-wish" aria-label="添加心愿">＋</button></header>
  <div class="wgrid">${list.length ? list.map((w) => {
    const q = `${w.brand || ''} ${(w.color || '').split(' ').find((x) => /[一-龥]/.test(x)) || w.color || ''} 上眼`.trim();
    return `<div class="card wcard">
      <div class="wimg" data-act="open-wish" data-id="${w.id}">${w.photos && w.photos[0] ? `<img src="${photoSrc(w.photos[0])}" alt="">` : iris(w.tone, 'xl')}${w.priority ? `<span class="pri">${'♥'.repeat(w.priority)}</span>` : ''}</div>
      <div class="wbody" data-act="open-wish" data-id="${w.id}"><b>${esc(w.brand || '')}</b><div class="sm">${esc(w.color || '')}</div>
      <div class="muted sm">${[w.cycle && CYCLES[w.cycle] ? CYCLES[w.cycle].label : '', money(w.price, w.priceCur)].filter(Boolean).join(' · ')}</div></div>
      <div class="wact"><a class="btn xhs-btn sm" href="${xhsApp(q)}">📕</a><button class="btn primary sm" data-act="wish-bought" data-id="${w.id}">买到了</button></div></div>`;
  }).join('') : '<div class="empty wide">把下次想买的美瞳存起来，附上图片和价格<br><button class="btn primary" data-act="add-wish">＋ 添加心愿</button></div>'}</div>`;
}

function WishDetail(id) {
  const w = S.wish.find((x) => x.id === id);
  if (!w) return `<header class="bar"><button class="back" data-act="back" aria-label="返回">‹</button><b>心愿</b><span></span></header><div class="empty">找不到这条心愿</div>`;
  const ph = w.photos || [];
  const photos = ph.length
    ? `<div class="gallery wgal ${ph.length === 1 ? 'one' : ''}">${ph.map((p, i) => `<img src="${ph.length === 1 ? p.full || p.thumb : photoSrc(p)}" data-act="photo" data-id="${w.id}" data-i="${i}" alt="">`).join('')}</div>
      <div class="btns center"><button class="btn ghost sm" data-act="add-photo" data-id="${w.id}" data-kind="web">＋ 添加图片</button></div>`
    : `<div class="gallery none" data-act="add-photo" data-id="${w.id}" data-kind="web">${iris(w.tone, 'xl')}<span>＋ 添加网图</span></div>`;
  const q = `${w.brand || ''} ${(w.color || '').split(' ').find((x) => /[一-龥]/.test(x)) || w.color || ''} 上眼`.trim();
  const spec = (k, v, cls) => (v !== '' && v != null ? `<div class="${cls || ''}"><span>${k}</span><b>${esc(v)}</b></div>` : '');
  const sp = w.brand && w.color ? specFor(w.brand, w.color, w.cycle, S.learned, w.series) : null;
  const mm = (v) => (v ? v + 'mm' : '');
  return `<header class="bar"><button class="back" data-act="back" aria-label="返回">‹</button><b>心愿详情</b><button class="btn ghost sm" data-act="edit-wish" data-id="${w.id}">编辑</button></header>
  ${photos}
  <div class="lhead"><h1>${esc(w.brand || '未选品牌')}</h1>${w.color ? `<div class="lcolor">${iris(w.tone)}${esc(w.color)}</div>` : ''}
  <div class="tags">${w.cycle && CYCLES[w.cycle] ? `<span class="tag">${CYCLES[w.cycle].label}</span>` : ''}${TONES[w.tone] ? `<span class="tag">${TONES[w.tone].label}</span>` : ''}${w.series ? `<span class="tag">${esc(w.series)}</span>` : ''}${w.priority ? `<span class="tag pink">${'♥'.repeat(w.priority)}</span>` : ''}</div></div>
  <section class="card"><h3>资料</h3><div class="specs">
    ${spec('价格', priceText(w), 'full')}${spec('在哪买', w.shop, 'full')}
    ${sp && sp.from !== 'none' ? spec('直径', mm(sp.dia)) + spec('着色直径', mm(sp.gdia)) + spec('基弧', mm(sp.bc)) + spec('含水量', sp.water ? sp.water + '%' : '') : ''}
  </div>${w.link ? `<p class="note">🔗 <a href="${esc(w.link)}" target="_blank" rel="noopener">${esc(w.link.length > 42 ? w.link.slice(0, 42) + '…' : w.link)}</a></p>` : ''}${w.notes ? `<p class="note">📝 ${esc(w.notes)}</p>` : ''}
  <div class="btns"><button class="btn primary" data-act="wish-bought" data-id="${w.id}">买到了</button><a class="btn xhs-btn" href="${xhsApp(q)}">📕 小红书看上眼</a></div></section>
  ${styleCard(suggest({ ...w, dia: sp && sp.dia, gdia: sp && sp.gdia }))}`;
}

function Me() {
  const st = stats(S, null, dispCur());
  const s = S.settings;
  const num = (key, label, unit, min, max) => `<label class="srow"><span>${label}</span><span><input type="number" inputmode="numeric" min="${min}" max="${max}" data-set="${key}" value="${s[key]}"> ${unit}</span></label>`;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const pushOn = !!(s.push && s.push.on && perm === 'granted');
  const canPush = 'PushManager' in window && 'serviceWorker' in navigator;
  const pushSub = pushOn ? '已开启：到期、换水、护理品、戴太久都会推送，App 关着也会提醒'
    : IOS && !STANDALONE ? '需要先在 Safari 点 Share → Add to Home Screen，从主屏幕打开 Lensy 再开启'
      : canPush ? 'App 关着也会准时推送到期、换水等提醒' : '这个浏览器不支持推送通知';
  return `<header class="top"><h1>我的</h1></header>
  <a class="card statcard" href="#stats"><div><b>${st.monthDays}</b><span>本月佩戴天数</span></div><div><b>${st.totalWears}</b><span>累计佩戴</span></div><div><b>${money(st.spend) || '—'}</b><span>总花费</span></div><i>›</i></a>
  <h2 class="sec">我的度数</h2><section class="card">
    <label class="srow"><span>左眼 L</span>${powerSelect('powerL', s.powerL, 'data-set="powerL"')}</label>
    <label class="srow"><span>右眼 R</span>${powerSelect('powerR', s.powerR, 'data-set="powerR"')}</label>
    <p class="muted sm">新录入美瞳时会自动带入这个度数。</p></section>
  <h2 class="sec">提醒设置</h2><section class="card">
    ${num('warnDays', '到期前提醒', '天', 1, 60)}${num('soakDays', '换护理液间隔', '天', 1, 30)}${num('maxHours', '每天最长佩戴', '小时', 1, 24)}
    ${num('lowStock', '日抛库存少于', '片提醒', 0, 60)}${num('expiryWarn', '产品有效期前', '天提醒', 1, 365)}${num('careWarn', '护理品到期前', '天提醒', 1, 60)}</section>
  <h2 class="sec">通知 & 日历</h2><section class="card">
    <div class="srow"><span>手机通知<small>${pushSub}</small></span>
      <button class="btn sm ${pushOn ? 'soft' : 'primary'}" data-act="notify">${pushOn ? '已开启' : '开启'}</button></div>
    ${pushOn ? `<label class="srow"><span>每天提醒时间<small>到期日、换水日在这个时间推送</small></span><input type="time" data-set="remindAt" value="${esc(s.remindAt || '09:00')}" class="time"></label>
    <div class="srow"><span>测试一下<small>马上发一条通知到这台手机</small></span><button class="btn sm soft" data-act="push-test">发送测试</button></div>` : ''}
    <div class="srow"><span>加入手机日历<small>也可以把到期日、换水日导出到手机日历</small></span><button class="btn sm ghost" data-act="ics">导出</button></div></section>
  <h2 class="sec">资料备份</h2><section class="card">
    <p class="muted sm">所有资料只存在这台手机上${s.lastBackup ? `，上次备份 ${s.lastBackup.slice(0, 10)}` : '，还没备份过'}。换手机前记得导出。</p>
    <div class="btns"><button class="btn primary" data-act="backup">导出备份</button><button class="btn soft" data-act="restore">导入备份</button><button class="btn ghost danger-t" data-act="wipe">清空</button></div></section>
  <h2 class="sec">其他</h2><section class="card">
    <label class="srow"><span>总花费显示为<small>录入价格时可选 MYR / CNY / AUD；1 CNY = 0.6 MYR，1 AUD = 2.8 MYR</small></span><select data-set="currency" class="cur">${CUR_KEYS.map((k) => `<option value="${k}" ${dispCur() === k ? 'selected' : ''}>${CURRENCIES[k].name}</option>`).join('')}</select></label>
    <div class="srow"><span>品牌资料库<small>内置 ${BRANDS.length} 个品牌；你录入的新品牌/花色已记住 ${S.learned.length} 条</small></span></div>
    <p class="muted sm">只有核对过品牌官网的款式（ACUVUE DEFINE、FreshKon）会自动填参数，其他款式不再填“参考值”以免填错。照包装或售卖页填写一次，下次同款就会自动填好。</p>
    <p class="muted sm">Lensy v${VERSION}</p></section>`;
}

function Stats(month) {
  const t = today();
  month = /^\d{4}-\d{2}$/.test(month || '') ? month : t.slice(0, 7);
  const st = stats(S, null, dispCur());
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  const byDay = {};
  for (const w of S.wears) if (w.date.startsWith(month)) (byDay[w.date] = byDay[w.date] || []).push(w);
  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const ws = byDay[iso] || [];
    const l = ws.length && lensById(ws[0].lensId);
    cells += `<div class="${iso === t ? 'today' : ''}">${d}${l ? iris(l.tone, 'xs') : ''}</div>`;
  }
  const mDays = Object.keys(byDay).length;
  const toneTotal = Object.values(st.tones).reduce((a, b) => a + b, 0);
  const topLenses = Object.entries(st.byLens).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ l: lensById(id), n })).filter((x) => x.l);
  return `<header class="bar"><button class="back" data-act="back" aria-label="返回">‹</button><b>佩戴统计</b><span></span></header>
  <section class="grid2">
    <div class="card k"><b>${st.totalWears}</b><span>累计佩戴次数</span></div>
    <div class="card k"><b>${st.avgHours ? st.avgHours.toFixed(1) : '—'}</b><span>平均每次（小时）</span></div>
    <div class="card k"><b>${money(st.spend) || '—'}</b><span>美瞳+护理总花费</span></div>
    <div class="card k"><b>${st.perWear ? money(st.perWear) : '—'}</b><span>平均每次成本</span></div></section>
  <section class="card"><div class="row between"><a class="btn ghost sm" href="#stats/${prev}">‹</a><b>${y}年${m}月 · 戴了 ${mDays} 天</b><a class="btn ghost sm" href="#stats/${next}">›</a></div>
    <div class="cal">${WEEK.map((w) => `<div class="wk">${w}</div>`).join('')}${cells}</div></section>
  ${topLenses.length ? `<section class="card"><h3>最常戴</h3>${topLenses.map((x) => `<a class="rankrow" href="#lens/${x.l.id}">${iris(x.l.tone, 'sm')}<span class="grow">${esc(lensName(x.l))}</span><b>${x.n} 次</b></a>`).join('')}</section>` : ''}
  ${toneTotal ? `<section class="card"><h3>色系偏好</h3>${Object.entries(st.tones).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="tonerow"><span>${iris(k, 'sm')}${TONES[k] ? TONES[k].label : k}</span>${bar(n / toneTotal)}<b>${Math.round((n / toneTotal) * 100)}%</b></div>`).join('')}</section>` : ''}`;
}

// ---------- pickers ----------
function pickBrand() {
  return new Promise((resolve) => {
    let picked = false;
    const mine = [...new Set(S.learned.map((l) => l.brand).concat(S.lenses.map((l) => l.brand), S.wish.map((w) => w.brand)))].filter((n) => n && !findBrand(n));
    const sh = sheet('选择品牌', '<input class="search" placeholder="搜索，或直接输入新品牌名" data-q autocomplete="off"><div class="plist" data-list></div>', { onClose: () => { if (!picked) resolve(null); } });
    const list = $('[data-list]', sh.el);
    const draw = (q) => {
      q = q.trim().toLowerCase();
      const all = BRANDS.map((b) => ({ name: b.name, sub: `${b.en !== b.name ? b.en + ' · ' : ''}${b.origin}` })).concat(mine.map((n) => ({ name: n, sub: '我添加的' })));
      const hit = all.filter((b) => !q || (b.name + ' ' + b.sub).toLowerCase().includes(q));
      const exact = all.some((b) => b.name.toLowerCase() === q);
      list.innerHTML = hit.map((b) => `<button class="pitem" data-v="${esc(b.name)}"><b>${esc(b.name)}</b><small>${esc(b.sub)}</small></button>`).join('')
        + (q && !exact ? `<button class="pitem add" data-v="${esc(q)}"><b>＋ 使用新品牌「${esc(q)}」</b><small>Lensy 会记住它</small></button>` : '');
    };
    const input = $('[data-q]', sh.el);
    input.addEventListener('input', () => draw(input.value));
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      picked = true;
      const raw = b.dataset.v;
      const known = findBrand(raw);
      resolve(known ? known.name : raw.trim());
      sh.close();
    });
    draw('');
  });
}

function pickColor(brand) {
  return new Promise((resolve) => {
    let picked = false;
    const colors = colorsFor(brand, S.learned);
    const b = findBrand(brand);
    const seriesList = b ? b.series.map((s) => s.name) : [];
    const sh = sheet(`${brand} · 选择花色`, `<input class="search" placeholder="搜索，或输入新的花色名" data-q autocomplete="off">
      <div class="chips tone-filter">${['all'].concat(TONE_KEYS).map((k) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-tone="${k}">${k === 'all' ? '全部' : iris(k, 'xs') + TONES[k].label}</button>`).join('')}</div>
      ${!colors.length ? `<p class="muted sm">这个品牌还没有内置花色，直接输入花色名（例如「冷茶棕」），Lensy 会记住。${seriesList.length ? `<br>系列：${seriesList.map(esc).join('、')}` : ''}</p>` : ''}
      <div class="plist" data-list></div>`, { onClose: () => { if (!picked) resolve(null); } });
    const list = $('[data-list]', sh.el);
    let tone = 'all';
    const input = $('[data-q]', sh.el);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const hit = colors.filter((c) => (tone === 'all' || c.tone === tone) && (!q || c.name.toLowerCase().includes(q)));
      const exact = colors.some((c) => c.name.toLowerCase() === q);
      list.innerHTML = hit.map((c) => `<button class="pitem" data-name="${esc(c.name)}">${iris(c.tone)}<span class="grow"><b>${esc(c.name)}</b><small>${esc(c.series ? c.series + ' · ' : '')}${c.cycles.map((k) => CYCLES[k].label).join(' / ')}${c.builtIn ? '' : ' · 我添加的'}</small></span></button>`).join('')
        + (q && !exact ? `<button class="pitem add" data-new="${esc(input.value.trim())}">${iris(guessTone(q))}<span class="grow"><b>＋ 新花色「${esc(input.value.trim())}」</b><small>色系会自动判断，可以再改</small></span></button>` : '')
        + (!hit.length && !q ? '<p class="muted sm center">没有这个色系的内置花色</p>' : '');
    };
    input.addEventListener('input', draw);
    sh.el.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-tone]');
      if (tb) { tone = tb.dataset.tone; $$('[data-tone]', sh.el).forEach((x) => x.classList.toggle('on', x === tb)); draw(); return; }
      const it = e.target.closest('[data-name],[data-new]');
      if (!it) return;
      picked = true;
      if (it.dataset.new) {
        const name = it.dataset.new;
        resolve({ name, tone: guessTone(name), series: seriesList.length === 1 ? seriesList[0] : '', cycles: cyclesFor(brand, name, S.learned) });
      } else resolve(colors.find((c) => c.name === it.dataset.name));
      sh.close();
    });
    draw();
  });
}

// ---------- forms ----------
const field = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<small class="hint">${hint}</small>` : ''}</div>`;
const input = (name, val, attrs) => `<input name="${name}" value="${esc(val == null ? '' : val)}" ${attrs || ''}>`;
// kind: only show photos of this kind ('mine' / 'web'); new photos get that kind. def: kind of old photos without one.
const photoGrid = (photos, kind, def) => `<div class="pgrid">${photos.map((p, i) => ({ p, i })).filter((x) => !kind || kindOf(x.p, def) === kind)
  .map(({ p, i }) => `<div class="pg"><img src="${photoSrc(p)}" alt=""><button type="button" class="x" data-f="rmphoto" data-i="${i}" aria-label="删除照片">✕</button></div>`).join('')}<button type="button" class="pg add" data-f="photo" data-kind="${kind || 'mine'}">＋<small>${kind === 'web' ? '网图' : kind === 'mine' ? '佩戴照' : '照片'}</small></button></div>`;
const shopSearch = (q) => `https://s.taobao.com/search?q=${encodeURIComponent(q)}`;
const toneChips = (cur) => `<div class="chips">${TONE_KEYS.map((k) => `<button type="button" class="chip ${cur === k ? 'on' : ''}" data-f="tone" data-v="${k}">${iris(k, 'xs')}${TONES[k].label}</button>`).join('')}</div>`;

function syncForm(el, f) {
  $$('[name]', el).forEach((i) => { f[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
}

function lensForm(existing, prefill, onSaved) {
  const isNew = !existing;
  const f = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), brand: '', series: '', color: '', cycle: '', tone: '', dia: '', gdia: '', bc: '', water: '',
    powerL: S.settings.powerL, powerR: S.settings.powerR, boxes: 1, pack: '', expiry: '', buyDate: today(), price: '', shop: '',
    photos: [], notes: '', soakDays: '', openNow: false, openedAt: today(), perWear: 2, specFrom: '', priceCur: S.settings.lastCur || dispCur(), ...(prefill || {}),
  };
  if (existing) { f.qty = existing.qty; f.boughtQty = existing.boughtQty == null ? '' : existing.boughtQty; f.priceCur = curOf(existing.priceCur); }
  for (const k of ['shop', 'notes', 'expiry', 'buyDate', 'series']) if (f[k] == null) f[k] = '';
  f.photos = f.photos || [];
  const sh = sheet(isNew ? '添加美瞳' : '编辑美瞳', '', { foot: `<button class="btn primary block" data-f="save">${isNew ? '保存' : '保存修改'}</button>` });
  const applySpec = () => {
    if (!f.brand || !f.color || !f.cycle) { f.specFrom = ''; return; }
    const sp = specFor(f.brand, f.color, f.cycle, S.learned, f.series);
    if (sp) {
      f.dia = sp.dia == null ? '' : sp.dia; f.gdia = sp.gdia == null ? '' : sp.gdia; f.bc = sp.bc == null ? '' : sp.bc; f.water = sp.water == null ? '' : sp.water;
      if (isNew) f.pack = sp.pack;
      f.specFrom = sp.from;
      f.specSrc = sp.src || '';
    } else f.specFrom = 'none';
  };
  const fixCycle = () => {
    const opts = cyclesFor(f.brand, f.color, S.learned, f.series);
    if (!opts.includes(f.cycle)) f.cycle = opts.length === 1 ? opts[0] : '';
    if (isNew && f.cycle && !f.pack) f.pack = CYCLES[f.cycle].pack;
    applySpec();
  };
  if (isNew && prefill && prefill.brand && prefill.color) fixCycle();
  const draw = () => {
    const y = sh.body.scrollTop;
    const opts = f.brand && f.color ? cyclesFor(f.brand, f.color, S.learned, f.series) : CYCLE_KEYS;
    const long = f.cycle && isLong(f.cycle);
    const specHint = { ref: `✓ 已按${esc(f.specSrc || '品牌官网')}的资料自动填写`, mine: '✓ 已按你上次录入的资料自动填写', none: '这款没有核对过的资料，请照包装或售卖页填写，下次同款会自动填好' }[f.specFrom] || '选好品牌、花色和周期后会自动填写';
    const q = `${f.brand} ${f.color} ${f.cycle && CYCLES[f.cycle] ? CYCLES[f.cycle].label : ''} 直径 着色直径 基弧 含水量`.replace(/\s+/g, ' ').trim();
    const lookUp = f.brand && f.color && f.specFrom !== 'ref' && f.specFrom !== 'mine'
      ? `<div class="btns tight"><a class="btn ghost sm" href="${shopSearch(q)}" target="_blank" rel="noopener">🛒 淘宝查参数</a><a class="btn xhs-btn sm" href="${xhsApp(q)}">📕 小红书查</a></div>` : '';
    const total = (Number(f.boxes) || 0) * (Number(f.pack) || 0);
    sh.body.innerHTML = `
      ${field('品牌', `<button type="button" class="pick" data-f="brand">${f.brand ? esc(f.brand) : '<span class="ph">选择品牌</span>'}<i>›</i></button>`)}
      ${field('花色', `<button type="button" class="pick" data-f="color">${f.color ? iris(f.tone) + esc(f.color) : '<span class="ph">选择或输入花色</span>'}<i>›</i></button>`)}
      ${field('抛弃周期', `<div class="chips">${opts.map((k) => `<button type="button" class="chip ${f.cycle === k ? 'on' : ''}" data-f="cycle" data-v="${k}">${CYCLES[k].label}</button>`).join('')}</div>`,
        f.color && opts.length > 1 ? `这个花色有 ${opts.length} 种周期，选你买的那一种` : f.color && opts.length === 1 ? `这个花色只有${CYCLES[opts[0]].label}` : '')}
      <div class="field"><label>参数</label><div class="spec4">
        <span>直径<input name="dia" inputmode="decimal" value="${esc(f.dia)}" placeholder="14.2"><em>mm</em></span>
        <span>着色直径<input name="gdia" inputmode="decimal" value="${esc(f.gdia)}" placeholder="13.6"><em>mm</em></span>
        <span>基弧<input name="bc" inputmode="decimal" value="${esc(f.bc)}" placeholder="8.6"><em>mm</em></span>
        <span>含水量<input name="water" inputmode="decimal" value="${esc(f.water)}" placeholder="38"><em>%</em></span></div>
        <small class="hint ${f.specFrom === 'ref' || f.specFrom === 'mine' ? 'ok' : ''}">${specHint}</small>${lookUp}</div>
      ${field('色系（用于妆容建议）', toneChips(f.tone || guessTone(f.color)))}
      <div class="field two"><div><label>左眼度数</label>${powerSelect('powerL', f.powerL)}</div><div><label>右眼度数</label>${powerSelect('powerR', f.powerR)}</div></div>
      ${isNew
        ? field('数量', `<div class="qtyrow">${input('boxes', f.boxes, 'inputmode="numeric" class="short"')}<span>盒 ×</span>${input('pack', f.pack, 'inputmode="numeric" class="short" placeholder="片"')}<span>片/盒 = <b>${total}</b> 片</span></div>`)
        : `<div class="field two"><div><label>剩余片数</label>${input('qty', f.qty, 'inputmode="numeric"')}</div><div><label>买入片数</label>${input('boughtQty', f.boughtQty, 'inputmode="numeric" placeholder="一共买了几片"')}</div></div>`}
      ${field('每次佩戴', `<div class="chips"><button type="button" class="chip ${Number(f.perWear) !== 1 ? 'on' : ''}" data-f="per" data-v="2">两眼 2 片</button><button type="button" class="chip ${Number(f.perWear) === 1 ? 'on' : ''}" data-f="per" data-v="1">单眼 1 片</button></div>`)}
      ${long ? field('换护理液间隔（天）', input('soakDays', f.soakDays, `inputmode="numeric" class="short" placeholder="${S.settings.soakDays}"`), '不戴的时候，镜盒里的护理液多久换一次；留空用默认值') : ''}
      ${isNew && long ? `<div class="field"><label class="check"><input type="checkbox" name="openNow" ${f.openNow ? 'checked' : ''}> 已经开封在用了</label>
        ${f.openNow ? `<div class="two"><div><label>开封日期</label>${input('openedAt', f.openedAt, 'type="date"')}</div><div class="hint">会从库存扣掉一副，并开始计算到期日</div></div>` : ''}</div>` : ''}
      <div class="field two"><div><label>产品有效期</label>${input('expiry', f.expiry, 'type="date"')}</div><div><label>购买日期</label>${input('buyDate', f.buyDate, 'type="date"')}</div></div>
      ${priceField(f)}
      ${field('购买渠道', input('shop', f.shop, 'placeholder="淘宝 / Shopee / 门店"'))}
      ${field('我的佩戴效果', photoGrid(f.photos, 'mine'), '自己戴上的照片')}
      ${field('网图', photoGrid(f.photos, 'web'), '店铺图、小红书上眼图')}
      ${field('备注', `<textarea name="notes" rows="2" placeholder="舒适度、上眼感受…">${esc(f.notes)}</textarea>`)}`;
    sh.body.scrollTop = y;
  };
  sh.el.addEventListener('input', (e) => { if (e.target.name === 'boxes' || e.target.name === 'pack') { syncForm(sh.el, f); const b = $('.qtyrow b', sh.el); if (b) b.textContent = (Number(f.boxes) || 0) * (Number(f.pack) || 0); } });
  sh.el.addEventListener('change', (e) => { if (e.target.name === 'openNow') { syncForm(sh.el, f); draw(); } });
  sh.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    syncForm(sh.el, f);
    const k = b.dataset.f;
    if (k === 'brand') {
      const name = await pickBrand();
      if (name && name !== f.brand) { Object.assign(f, { brand: name, color: '', series: '', cycle: '', specFrom: '' }); draw(); }
    } else if (k === 'color') {
      if (!f.brand) { toast('先选品牌'); return; }
      const c = await pickColor(f.brand);
      if (c) { f.color = c.name; f.series = c.series || f.series; f.tone = c.tone; fixCycle(); draw(); }
    } else if (k === 'cycle') {
      f.cycle = b.dataset.v;
      if (isNew) f.pack = CYCLES[f.cycle].pack;
      applySpec();
      draw();
    } else if (k === 'tone') { f.tone = b.dataset.v; draw(); }
    else if (k === 'per') { f.perWear = Number(b.dataset.v); draw(); }
    else if (k === 'photo') { f.photos.push(...(await photosFromPicker(b.dataset.kind))); draw(); }
    else if (k === 'rmphoto') { f.photos.splice(+b.dataset.i, 1); draw(); }
    else if (k === 'save') {
      if (!f.brand) { toast('请选择品牌'); return; }
      if (!f.color) { toast('请选择或输入花色'); return; }
      if (!f.cycle) { toast('请选择抛弃周期'); return; }
      const n = (v) => (v === '' || v == null || isNaN(Number(v)) ? '' : Number(v));
      const rec = existing ? { ...existing } : { id: f.id, pairs: [], inspo: [], createdAt: Date.now() };
      Object.assign(rec, {
        brand: f.brand.trim(), series: f.series || '', color: f.color.trim(), cycle: f.cycle, tone: f.tone || guessTone(f.color),
        dia: n(f.dia), gdia: n(f.gdia), bc: n(f.bc), water: n(f.water), powerL: f.powerL, powerR: f.powerR,
        expiry: f.expiry, buyDate: f.buyDate, price: n(f.price), priceCur: curOf(f.priceCur), shop: f.shop.trim(), photos: f.photos, notes: f.notes.trim(),
        soakDays: n(f.soakDays), perWear: Number(f.perWear) === 1 ? 1 : 2, pack: n(f.pack) || rec.pack || '',
      });
      if (isNew) {
        rec.qty = Math.max(0, Math.round((Number(f.boxes) || 0) * (Number(f.pack) || 0)));
        rec.boughtQty = rec.qty;
        if (isLong(rec.cycle) && f.openNow) {
          const take = Math.min(rec.perWear, rec.qty) || rec.perWear;
          rec.qty = Math.max(0, rec.qty - take);
          rec.pairs.push({ id: uid(), openedAt: f.openedAt || today(), soakAt: f.openedAt || today(), status: 'using', pieces: take });
        }
      } else {
        rec.qty = Math.max(0, Math.round(Number(f.qty) || 0));
        rec.boughtQty = f.boughtQty === '' || f.boughtQty == null ? '' : Math.max(0, Math.round(Number(f.boughtQty) || 0));
      }
      if (rec.price !== '') { S.settings.lastCur = rec.priceCur; saveSettings(); }
      await save('lenses', rec);
      await learn(rec);
      sh.close();
      toast(isNew ? '已添加 ✨' : '已保存');
      if (onSaved) await onSaved(rec);
      if (isNew) location.hash = `#lens/${rec.id}`; else render();
    }
  });
  draw();
}

function careForm(existing) {
  const isNew = !existing;
  const f = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), type: 'solution', name: '', volume: '', price: '', priceCur: S.settings.lastCur || dispCur(), expiry: '', opened: false, openedAt: today(), openDays: CARE_TYPES.solution.openDays, qty: '', notes: '', photos: [] };
  if (existing) f.opened = !!existing.openedAt;
  for (const k of ['name', 'volume', 'notes', 'expiry', 'qty']) if (f[k] == null) f[k] = '';
  f.photos = f.photos || [];
  if (existing && !existing.openedAt) f.openedAt = today();
  const sh = sheet(isNew ? '添加护理品' : '编辑护理品', '', { foot: `${!isNew ? '<button class="btn ghost danger-t" data-f="del">删除</button>' : ''}<button class="btn primary grow" data-f="save">保存</button>` });
  const draw = () => {
    const ty = CARE_TYPES[f.type];
    const drops = f.type === 'drops';
    const daily = drops && Number(f.openDays) === 1;
    const change = f.type === 'case' || f.type === 'tool';
    sh.body.innerHTML = `
      ${field('类型', `<div class="chips">${Object.entries(CARE_TYPES).map(([k, v]) => `<button type="button" class="chip ${f.type === k ? 'on' : ''}" data-f="type" data-v="${k}">${v.icon} ${v.label}</button>`).join('')}</div>`)}
      ${field('名称', input('name', f.name, `placeholder="例如：${drops ? '乐敦 润眼液 / 海露' : '博士伦 润明护理液'}"`))}
      ${drops ? field('使用周期', `<div class="chips">${DROP_CYCLES.map(([d, label]) => `<button type="button" class="chip ${Number(f.openDays) === d ? 'on' : ''}" data-f="dcycle" data-v="${d}">${label}</button>`).join('')}</div>`,
        daily ? '日抛（单支装）：每支用一次就丢，按支数记录，用完或快过期时提醒' : `开封后 ${f.openDays} 天内用完，到期提醒你换新`) : ''}
      ${field(change ? '购买/到货日期' : '有效期（包装上的）', input('expiry', f.expiry, 'type="date"'))}
      ${daily ? field('数量（支）', input('qty', f.qty, 'inputmode="numeric" class="short" placeholder="30"'), '用一支点一下「用了一支」；剩 5 支时提醒补货')
        : `<div class="field"><label class="check"><input type="checkbox" name="opened" ${f.opened ? 'checked' : ''}> ${change ? '已经开始使用' : '已经开封'}</label>
      ${f.opened ? `<div class="two"><div><label>${change ? '开始使用' : '开封日期'}</label>${input('openedAt', f.openedAt, 'type="date"')}</div><div><label>${change ? '多少天换新' : '开封后可用（天）'}</label>${input('openDays', f.openDays, 'inputmode="numeric"')}</div></div>` : ''}
      <small class="hint">${!drops && ty.openDays ? `${ty.label}一般${f.type === 'case' ? `每 ${ty.openDays} 天更换` : `开封后 ${ty.openDays} 天内用完`}，以说明书为准` : ''}</small></div>`}
      ${priceField(f)}
      ${field('容量/规格', input('volume', f.volume, 'placeholder="360ml / 10ml"'))}
      ${field('照片', photoGrid(f.photos))}
      ${field('备注', `<textarea name="notes" rows="2">${esc(f.notes)}</textarea>`)}`;
  };
  sh.el.addEventListener('change', (e) => { if (e.target.name === 'opened') { syncForm(sh.el, f); draw(); } });
  sh.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    syncForm(sh.el, f);
    const k = b.dataset.f;
    if (k === 'type') { const was = CARE_TYPES[f.type].openDays; f.type = b.dataset.v; if (!f.openDays || Number(f.openDays) === was || f.type === 'drops') f.openDays = CARE_TYPES[f.type].openDays; draw(); }
    else if (k === 'dcycle') { f.openDays = Number(b.dataset.v); if (f.openDays > 1 && !f.opened) { f.opened = true; f.openedAt = f.openedAt || today(); } draw(); }
    else if (k === 'photo') { f.photos.push(...(await photosFromPicker(b.dataset.kind))); draw(); }
    else if (k === 'rmphoto') { f.photos.splice(+b.dataset.i, 1); draw(); }
    else if (k === 'del') { if (await ask('删除护理品', `确定删除「${f.name || CARE_TYPES[f.type].label}」吗？`, '删除', true)) { await remove('care', f.id); sh.close(); render(); } }
    else if (k === 'save') {
      const rec = existing ? { ...existing } : { id: f.id, createdAt: Date.now() };
      const daily = f.type === 'drops' && Number(f.openDays) === 1;
      Object.assign(rec, { type: f.type, name: f.name.trim(), volume: f.volume.trim(), price: f.price === '' ? '' : Number(f.price) || '', priceCur: curOf(f.priceCur), expiry: f.expiry,
        openedAt: !daily && f.opened ? f.openedAt || today() : '', openDays: f.opened || daily ? Number(f.openDays) || 0 : Number(f.openDays) || CARE_TYPES[f.type].openDays,
        qty: daily && f.qty !== '' ? Math.max(0, Math.round(Number(f.qty) || 0)) : '', notes: f.notes.trim(), photos: f.photos });
      if (rec.price !== '') { S.settings.lastCur = rec.priceCur; saveSettings(); }
      await save('care', rec);
      sh.close();
      toast('已保存');
      render();
    }
  });
  draw();
}

function wishForm(existing) {
  const isNew = !existing;
  const f = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), brand: '', series: '', color: '', cycle: '', tone: '', price: '', priceCur: S.settings.lastCur || dispCur(), shop: '', link: '', priority: 2, photos: [], notes: '' };
  for (const k of ['brand', 'series', 'color', 'cycle', 'shop', 'link', 'notes']) if (f[k] == null) f[k] = '';
  f.photos = f.photos || [];
  const sh = sheet(isNew ? '添加心愿' : '编辑心愿', '', { foot: `${!isNew ? '<button class="btn ghost danger-t" data-f="del">删除</button>' : ''}<button class="btn primary grow" data-f="save">保存</button>` });
  const draw = () => {
    const opts = f.brand && f.color ? cyclesFor(f.brand, f.color, S.learned, f.series) : CYCLE_KEYS;
    sh.body.innerHTML = `
      ${field('品牌', `<button type="button" class="pick" data-f="brand">${f.brand ? esc(f.brand) : '<span class="ph">选择品牌</span>'}<i>›</i></button>`)}
      ${field('花色', `<button type="button" class="pick" data-f="color">${f.color ? iris(f.tone) + esc(f.color) : '<span class="ph">选择或输入花色</span>'}<i>›</i></button>`)}
      ${field('想买的周期', `<div class="chips">${opts.map((k) => `<button type="button" class="chip ${f.cycle === k ? 'on' : ''}" data-f="cycle" data-v="${k}">${CYCLES[k].label}</button>`).join('')}</div>`)}
      ${field('色系', toneChips(f.tone || guessTone(f.color)))}
      ${field('网图', photoGrid(f.photos, 'web', 'web'), '存小红书/店铺的上眼图，方便对比')}
      ${f.photos.some((p) => kindOf(p, 'web') === 'mine') ? field('我的佩戴效果', photoGrid(f.photos, 'mine', 'web')) : ''}
      ${field('有多想要', `<div class="chips">${[1, 2, 3].map((p) => `<button type="button" class="chip ${Number(f.priority) === p ? 'on' : ''}" data-f="pri" data-v="${p}">${'♥'.repeat(p)}</button>`).join('')}</div>`)}
      ${priceField(f)}
      ${field('在哪买', input('shop', f.shop, 'placeholder="店铺名"'))}
      ${field('链接', input('link', f.link, 'type="url" placeholder="商品或小红书链接"'))}
      ${field('备注', `<textarea name="notes" rows="2">${esc(f.notes)}</textarea>`)}`;
  };
  sh.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    syncForm(sh.el, f);
    const k = b.dataset.f;
    if (k === 'brand') { const n = await pickBrand(); if (n && n !== f.brand) { Object.assign(f, { brand: n, color: '', series: '', cycle: '' }); draw(); } }
    else if (k === 'color') {
      if (!f.brand) { toast('先选品牌'); return; }
      const c = await pickColor(f.brand);
      if (c) { f.color = c.name; f.series = c.series || ''; f.tone = c.tone; const o = cyclesFor(f.brand, f.color, S.learned, f.series); if (!o.includes(f.cycle)) f.cycle = o.length === 1 ? o[0] : ''; draw(); }
    } else if (k === 'cycle') { f.cycle = f.cycle === b.dataset.v ? '' : b.dataset.v; draw(); }
    else if (k === 'tone') { f.tone = b.dataset.v; draw(); }
    else if (k === 'pri') { f.priority = Number(b.dataset.v); draw(); }
    else if (k === 'photo') { f.photos.push(...(await photosFromPicker(b.dataset.kind))); draw(); }
    else if (k === 'rmphoto') { f.photos.splice(+b.dataset.i, 1); draw(); }
    else if (k === 'del') { if (await ask('删除心愿', '确定删除吗？', '删除', true)) { await remove('wish', f.id); sh.close(); if (location.hash.startsWith('#wishitem/')) location.hash = '#wish'; else render(); } }
    else if (k === 'save') {
      if (!f.brand && !f.color && !f.photos.length) { toast('至少选个品牌、花色或加张图'); return; }
      const rec = existing ? { ...existing } : { id: f.id, createdAt: Date.now() };
      if (f.price !== '') { S.settings.lastCur = curOf(f.priceCur); saveSettings(); }
      Object.assign(rec, { brand: f.brand, series: f.series, color: f.color, cycle: f.cycle, tone: f.tone || guessTone(f.color), price: f.price === '' ? '' : Number(f.price) || '', priceCur: curOf(f.priceCur), shop: f.shop.trim(), link: f.link.trim(), priority: Number(f.priority) || 0, photos: f.photos, notes: f.notes.trim() });
      await save('wish', rec);
      sh.close();
      toast(isNew ? '已加入心愿单 💗' : '已保存');
      render();
    }
  });
  draw();
}

// ---------- actions ----------
async function startWear(lensId, pairId) {
  const l = lensById(lensId);
  if (!l) return;
  if (S.settings.wearing) {
    if (!(await ask('正在佩戴另一副', '先把正在戴的摘下，再戴这副？', '摘下并换这副'))) return;
    await stopWear(true);
  }
  const per = Number(l.perWear) || 2;
  const t = today();
  const w = { id: uid(), lensId: l.id, date: t, start: new Date().toISOString() };
  if (isLong(l.cycle)) {
    let p = (l.pairs || []).find((x) => x.id === pairId && x.status === 'using') || activePairs(l)[0];
    if (!p) {
      if (!l.qty) { toast('没有库存了'); return; }
      if (!(await ask('开封新的一副', `${lensName(l)} 还没有开封的，现在开封一副吗？从今天开始计算${CYCLES[l.cycle].label}期限。`, '开封并戴上'))) return;
      p = openPairRec(l, t);
    }
    if (diffDays(t, pairEnd(l, p)) < 0 && !(await ask('这副已经超期', `这副在 ${pairEnd(l, p)} 就到期了，超期佩戴容易引起眼睛感染。还要继续戴吗？`, '还是要戴', true))) return;
    w.pairId = p.id;
  } else {
    if ((l.qty || 0) <= 0) { toast('没有库存了'); return; }
    if (l.expiry && l.expiry < t && !(await ask('已过有效期', `这盒的有效期到 ${l.expiry}，过期的镜片不建议佩戴。还要继续吗？`, '还是要戴', true))) return;
    const take = Math.min(per, l.qty);
    l.qty -= take;
    w.pieces = take;
  }
  l.wearCount = (l.wearCount || 0) + 1;
  await save('lenses', l);
  await save('wears', w);
  S.settings.wearing = { lensId: l.id, pairId: w.pairId || null, start: w.start, wearId: w.id };
  await saveSettings();
  toast(`戴上啦 ✨ 建议 ${S.settings.maxHours} 小时内摘下`);
  render();
}

async function stopWear(quiet) {
  const cur = S.settings.wearing;
  if (!cur) return;
  const w = S.wears.find((x) => x.id === cur.wearId);
  if (w) { w.end = new Date().toISOString(); w.hours = Math.round(((new Date(w.end) - new Date(w.start)) / 3600000) * 10) / 10; await save('wears', w); }
  const l = lensById(cur.lensId);
  if (l && cur.pairId) {
    const p = (l.pairs || []).find((x) => x.id === cur.pairId);
    if (p) { p.lastWorn = today(); p.soakAt = today(); await save('lenses', l); }
  }
  S.settings.wearing = null;
  await saveSettings();
  if (!quiet) toast(l && isLong(l.cycle) ? '已摘下 👋 记得用新鲜护理液浸泡镜片' : '已摘下 👋 日抛直接丢掉哦');
  render();
}

function openPairRec(l, date) {
  const per = Number(l.perWear) || 2;
  const take = Math.min(per, l.qty || 0) || per;
  l.qty = Math.max(0, (l.qty || 0) - take);
  const p = { id: uid(), openedAt: date, soakAt: date, status: 'using', pieces: take };
  l.pairs = l.pairs || [];
  l.pairs.push(p);
  return p;
}

const ACTS = {
  back: () => { if (history.length > 1) history.back(); else location.hash = '#home'; },
  'hide-install': async () => { S.settings.hideInstall = true; await saveSettings(); render(); },
  'quick-add': async () => {
    const v = await choose('添加', [{ label: '👁 添加美瞳', value: 'lens', cls: 'primary' }, { label: '🧴 添加护理液 / 眼药水 / 镜盒', value: 'care' }, { label: '💗 添加到心愿单', value: 'wish' }]);
    if (v === 'lens') lensForm();
    if (v === 'care') careForm();
    if (v === 'wish') wishForm();
  },
  'add-lens': () => lensForm(),
  'edit-lens': (d) => lensForm(lensById(d.id)),
  'del-lens': async (d) => {
    const l = lensById(d.id);
    if (!(await ask('删除美瞳', `确定删除「${lensName(l)}」和它的 ${wearsOf(l.id).length} 条佩戴记录吗？只是用完了的话，建议用「移到存档」保留记录。`, '删除', true))) return;
    for (const w of wearsOf(l.id)) await remove('wears', w.id);
    if (S.settings.wearing && S.settings.wearing.lensId === l.id) { S.settings.wearing = null; await saveSettings(); }
    await remove('lenses', l.id);
    toast('已删除');
    location.hash = '#lenses';
  },
  archive: async (d) => {
    const l = lensById(d.id);
    const why = await choose('移到存档', [{ label: '用完了', value: '用完了' }, { label: '不喜欢 / 不舒服', value: '不喜欢' }, { label: '送人了', value: '送人了' }, { label: '过期丢弃', value: '过期丢弃' }], '存档后仍会保留所有佩戴记录。');
    if (!why) return;
    l.archived = true;
    l.archiveWhy = why;
    for (const p of activePairs(l)) Object.assign(p, { status: 'done', doneAt: today(), doneWhy: why });
    if (S.settings.wearing && S.settings.wearing.lensId === l.id) await stopWear(true);
    await save('lenses', l);
    toast('已移到存档');
    render();
  },
  unarchive: async (d) => { const l = lensById(d.id); l.archived = false; l.archiveWhy = ''; await save('lenses', l); toast('已移回美瞳柜'); render(); },
  rebuy: (d) => { const l = lensById(d.id); lensForm(null, { brand: l.brand, series: l.series, color: l.color, cycle: l.cycle, tone: l.tone, photos: (l.photos || []).filter((p) => kindOf(p) === 'web').slice(0, 2), shop: l.shop, price: l.price, priceCur: curOf(l.priceCur), perWear: l.perWear, soakDays: l.soakDays, powerL: l.powerL, powerR: l.powerR }); },
  wear: (d) => startWear(d.id, d.pair),
  'wear-stop': () => stopWear(),
  'open-pair': async (d) => {
    const l = lensById(d.id);
    if (!l.qty) { toast('没有库存了'); return; }
    if (activePairs(l).length && !(await ask('再开一副？', '已经有一副在用了。确定再开封一副吗？（例如原来那副破了或丢了）', '开封'))) return;
    openPairRec(l, today());
    await save('lenses', l);
    toast(`已开封，${addDays(today(), cycleDays(l.cycle))} 到期`);
    render();
  },
  'pair-done': async (d) => {
    const l = lensById(d.id);
    const p = (l.pairs || []).find((x) => x.id === d.pair);
    if (!p) return;
    const why = await choose('丢弃这副', [{ label: '到期丢弃', value: '到期丢弃', cls: 'primary' }, { label: '破了', value: '破损' }, { label: '丢了一片/两片', value: '丢失' }, { label: '戴着不舒服', value: '不舒服' }], `${lensName(l)}，开封于 ${p.openedAt}`);
    if (!why) return;
    Object.assign(p, { status: 'done', doneAt: today(), doneWhy: why });
    if (S.settings.wearing && S.settings.wearing.pairId === p.id) await stopWear(true);
    await save('lenses', l);
    toast(lensState(l) === 'done' ? '这款已经用完，已移到存档' : '已丢弃这副');
    render();
  },
  'pair-edit': async (d) => {
    const l = lensById(d.id);
    const p = l.pairs.find((x) => x.id === d.pair);
    const sh = sheet('修改开封日期', `${field('开封日期', `<input type="date" name="openedAt" value="${p.openedAt}">`)}${field('自定到期日（可留空）', `<input type="date" name="endAt" value="${p.endAt || ''}">`, `留空按${CYCLES[l.cycle].label}自动算：${addDays(p.openedAt, cycleDays(l.cycle))}`)}`, { cls: 'small', foot: '<button class="btn primary block" data-ok>保存</button>' });
    $('[data-ok]', sh.el).onclick = async () => {
      const o = $('[name=openedAt]', sh.el).value;
      if (o) { if (p.soakAt === p.openedAt || p.soakAt < o) p.soakAt = o; p.openedAt = o; }
      p.endAt = $('[name=endAt]', sh.el).value || '';
      await save('lenses', l);
      sh.close();
      render();
    };
  },
  soak: async (d) => {
    const l = lensById(d.id);
    const p = l && (l.pairs || []).find((x) => x.id === d.pair);
    if (!p) return;
    p.soakAt = today();
    await save('lenses', l);
    toast('已换水 🫧 下次：' + addDays(today(), Number(l.soakDays) || S.settings.soakDays));
    render();
  },
  'pair-cal': async (d) => {
    const l = lensById(d.id);
    const p = l.pairs.find((x) => x.id === d.pair);
    calendarSheet(buildIcs({ lenses: [{ ...l, pairs: [p], qty: 0 }], care: [] }, S.settings), `lensy-${l.color || l.brand}.ics`, gcalLink(`👁 ${lensName(l)} 到期，请丢弃`, pairEnd(l, p), `开封于 ${p.openedAt}`));
  },
  qty: async (d) => { const l = lensById(d.id); l.qty = Math.max(0, (l.qty || 0) + Number(d.d)); await save('lenses', l); render(); },
  restock: async (d) => {
    const l = lensById(d.id);
    const pack = Number(l.pack) || CYCLES[l.cycle].pack;
    l.qty = (l.qty || 0) + pack;
    l.boughtQty = (l.boughtQty || 0) + pack;
    if (l.archived) { l.archived = false; l.archiveWhy = ''; }
    await save('lenses', l);
    toast(`+${pack} 片，现在有 ${l.qty} 片`);
    render();
  },
  'log-wear': async (d) => {
    const l = lensById(d.id);
    const ps = l.pairs || [];
    const sh = sheet('补记一次佩戴', `${field('日期', `<input type="date" name="date" value="${today()}" max="${today()}">`)}
      ${field('戴了多久（小时，可不填）', '<input name="hours" inputmode="decimal" class="short">')}
      ${isLong(l.cycle) ? (ps.length ? field('哪一副', `<select name="pair">${ps.map((p) => `<option value="${p.id}">${p.openedAt} 开封${p.status === 'done' ? '（已丢弃）' : ''}</option>`).join('')}</select>`) : '<p class="muted sm">还没有开封记录，只记日期。</p>')
        : `<label class="check"><input type="checkbox" name="take" checked> 从库存扣掉 ${Number(l.perWear) || 2} 片</label>`}`, { cls: 'small', foot: '<button class="btn primary block" data-ok>保存</button>' });
    $('[data-ok]', sh.el).onclick = async () => {
      const f = {};
      syncForm(sh.el, f);
      const w = { id: uid(), lensId: l.id, date: f.date || today(), hours: Number(f.hours) || 0 };
      if (f.pair) { w.pairId = f.pair; const p = ps.find((x) => x.id === f.pair); if (p && (!p.lastWorn || p.lastWorn < w.date)) p.lastWorn = w.date; }
      if (f.take && !isLong(l.cycle)) { const take = Math.min(Number(l.perWear) || 2, l.qty || 0); l.qty -= take; w.pieces = take; }
      l.wearCount = (l.wearCount || 0) + 1;
      await save('lenses', l);
      await save('wears', w);
      sh.close();
      toast('已补记');
      render();
    };
  },
  'del-wear': async (d) => {
    const w = S.wears.find((x) => x.id === d.id);
    if (!w) return;
    const l = lensById(w.lensId);
    if (!(await ask('删除这条记录', `${w.date} 的佩戴记录${w.pieces ? `，并把 ${w.pieces} 片加回库存` : ''}？`, '删除', true))) return;
    if (l) { l.wearCount = Math.max(0, (l.wearCount || 0) - 1); if (w.pieces) l.qty = (l.qty || 0) + w.pieces; await save('lenses', l); }
    if (S.settings.wearing && S.settings.wearing.wearId === w.id) { S.settings.wearing = null; await saveSettings(); }
    await remove('wears', w.id);
    render();
  },
  photo: (d, el) => viewPhoto(fullSrc(el), el),
  'inspo-img': (d, el) => viewPhoto(fullSrc(el), el),
  'add-photo': async (d) => {
    const w = S.wish.find((x) => x.id === d.id);
    const l = w || lensById(d.id);
    const ph = await photosFromPicker(d.kind || 'mine');
    if (!ph.length) return;
    l.photos = (l.photos || []).concat(ph);
    await save(w ? 'wish' : 'lenses', l);
    render();
  },
  'add-inspo': (d) => {
    const l = lensById(d.id);
    const f = { url: '', note: '', img: '' };
    const sh = sheet('收藏灵感', `${field('小红书笔记链接', '<input name="url" type="url" placeholder="在小红书点 分享 → 复制链接，粘贴到这里">')}
      ${field('备注', '<input name="note" placeholder="例如：这个眼妆好看 / 博主同款眼影">')}
      ${field('截图（可选）', '<div class="pgrid" data-img><button type="button" class="pg add" data-pick>＋<small>截图</small></button></div>')}`, { cls: 'small', foot: '<button class="btn primary block" data-ok>保存</button>' });
    $('[data-pick]', sh.el).onclick = async () => {
      const ph = await photosFromPicker();
      if (ph[0]) { f.img = ph[0].full; $('[data-img]', sh.el).innerHTML = `<div class="pg"><img src="${photoSrc(ph[0])}" alt=""></div>`; }
    };
    $('[data-ok]', sh.el).onclick = async () => {
      syncForm(sh.el, f);
      const m = (f.url || '').match(/https?:\/\/\S+/);
      const rec = { id: uid(), url: m ? m[0] : '', note: (f.note || '').trim() || (m ? f.url.replace(m[0], '').trim().slice(0, 60) : ''), img: f.img };
      if (!rec.url && !rec.note && !rec.img) { toast('贴个链接、写句备注或加张截图'); return; }
      l.inspo = (l.inspo || []).concat(rec);
      await save('lenses', l);
      sh.close();
      render();
    };
  },
  'del-inspo': async (d) => { const l = lensById(d.id); if (!(await ask('删除收藏', '确定删除这条灵感吗？', '删除', true))) return; l.inspo.splice(+d.i, 1); await save('lenses', l); render(); },
  'add-care': () => careForm(),
  'edit-care': (d) => careForm(S.care.find((c) => c.id === d.id)),
  'drop-use': async (d) => {
    const c = S.care.find((x) => x.id === d.id);
    if (!c) return;
    c.qty = Math.max(0, (Number(c.qty) || 0) - 1);
    await save('care', c);
    toast(c.qty ? `已记录，还剩 ${c.qty} 支` : '这盒用完了，记得补货');
    render();
  },
  'care-open': async (d) => { const c = S.care.find((x) => x.id === d.id); c.openedAt = today(); c.openDays = Number(c.openDays) || CARE_TYPES[c.type].openDays; await save('care', c); toast('已记录开封日期'); render(); },
  'care-done': async (d) => {
    const c = S.care.find((x) => x.id === d.id);
    const again = await choose(c.type === 'case' ? '换新镜盒' : '用完了', [{ label: '用完了，不再记录', value: 'done' }, { label: '换了一瓶/一个新的（同款）', value: 'new', cls: 'primary' }], c.name || CARE_TYPES[c.type].label);
    if (!again) return;
    c.finished = true;
    c.finishedAt = today();
    await save('care', c);
    if (again === 'new') {
      const n = { ...c, id: uid(), finished: false, finishedAt: '', openedAt: today(), expiry: '', createdAt: Date.now() };
      await save('care', n);
      toast('已换新，记得填新的有效期');
      careForm(n);
    } else toast('已移到「已用完」');
    render();
  },
  'care-restore': async (d) => { const c = S.care.find((x) => x.id === d.id); c.finished = false; await save('care', c); render(); },
  'add-wish': () => wishForm(),
  'open-wish': (d) => { location.hash = `#wishitem/${d.id}`; },
  'edit-wish': (d) => wishForm(S.wish.find((w) => w.id === d.id)),
  'wish-bought': (d) => {
    const w = S.wish.find((x) => x.id === d.id);
    lensForm(null, { brand: w.brand, series: w.series, color: w.color, cycle: w.cycle, tone: w.tone, photos: (w.photos || []).map((p) => ({ ...p, kind: kindOf(p, 'web') })), price: w.price, priceCur: curOf(w.priceCur), shop: w.shop, notes: w.notes }, async () => { await remove('wish', w.id); });
  },
  snooze: async (d) => {
    S.settings.snooze[d.key] = Number(d.days) >= 9999 ? '9999-12-31' : addDays(today(), Number(d.days) || 0);
    await saveSettings();
    render();
  },
  notify: async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast(IOS ? '请先 Share → Add to Home Screen，再从主屏幕打开 Lensy 开启' : '这个浏览器不支持通知'); return; }
    if (S.settings.push && S.settings.push.on && Notification.permission === 'granted') {
      if (await ask('关闭通知', '关闭后不会再收到 Lensy 的推送提醒。', '关闭')) { await pushOff(); render(); }
      return;
    }
    // The permission prompt must come straight from the tap (iOS), before any network wait.
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('没有获得通知权限，可以在 Settings › Notifications › Lensy 里打开'); return; }
    S.settings.notify = true;
    toast('正在开启…');
    try {
      await pushOn();
      toast('通知已开启 🔔 App 关着也会提醒');
    } catch (e) {
      console.error(e);
      await saveSettings();
      toast('推送开启失败：' + (e.message || e) + '（只能在打开 App 时提醒）');
    }
    render();
  },
  'push-test': async (d, el) => {
    el.disabled = true;
    try { await pushCall('test'); toast('已发送，几秒内会收到 🔔'); } catch (e) { toast(e.message || String(e)); } finally { el.disabled = false; }
  },
  ics: () => calendarSheet(buildIcs(S, S.settings), 'lensy-提醒.ics'),
  backup: async () => {
    const data = await DB.dump();
    const ok = await shareFile(`lensy-备份-${today()}.json`, JSON.stringify(data), 'application/json');
    if (ok) { S.settings.lastBackup = new Date().toISOString(); await saveSettings(); toast('备份已导出'); render(); }
  },
  restore: async () => {
    const [file] = await pickFiles('application/json,.json', false);
    if (!file) return;
    let data;
    try { data = JSON.parse(await readText(file)); if (data.app !== 'lensy') throw new Error(); } catch (e) { toast('这不是 Lensy 的备份文件'); return; }
    const mode = await choose('导入备份', [{ label: '合并（保留手机上现有资料）', value: 'merge', cls: 'primary' }, { label: '覆盖（清空现有资料再导入）', value: 'replace', cls: 'danger' }], `备份时间 ${String(data.exportedAt || '').slice(0, 10)}，美瞳 ${(data.lenses || []).length} 款，护理品 ${(data.care || []).length} 个。`);
    if (!mode) return;
    await DB.restore(data, mode);
    await load();
    toast('导入完成');
    render();
  },
  wipe: async () => {
    if (!(await ask('清空所有资料', '会删除所有美瞳、护理品、心愿和佩戴记录，不能恢复。建议先导出备份。', '全部清空', true))) return;
    if (!(await ask('再确认一次', '真的要清空吗？', '清空', true))) return;
    await DB.wipe();
    await load();
    toast('已清空');
    location.hash = '#home';
    render();
  },
};

// Photo zoom, two kinds:
//   viewPhoto(src, from)  tap → full-screen viewer on black, tap again to close.
//   peekPhoto(src, from)  long-press → iOS / Instagram style preview: the picture pops up over the blurred
//                          page while the finger is down; peek.close() on release shrinks it back.
// The picture grows out of `from` (the thumbnail) and shrinks back into it, cropped the way the thumbnail is
// (object-fit: cover). It starts with the thumbnail's own, already decoded picture so it appears at once,
// then swaps in the full-size one. Only transform / opacity / clip-path animate: no page re-layout.
const PV_MS = 280;
const PV_EASE = 'cubic-bezier(.2, .8, .2, 1)';
const PEEK_IN = 'cubic-bezier(.3, 1.3, .6, 1)'; // a little spring, like the iPhone's preview
const viewPhoto = (src, from) => zoomPhoto(src, from, false);
const peekPhoto = (src, from) => zoomPhoto(src, from, true);
async function zoomPhoto(src, from, peek) {
  if ($('.pv')) return null;
  const pv = document.createElement('div');
  pv.className = 'pv' + (peek ? ' peek' : '');
  pv.innerHTML = `<div class="pv-bg"></div><img class="pv-img" alt="">${peek ? '' : '<button class="pv-x" aria-label="关闭">✕</button>'}`;
  const img = $('.pv-img', pv);
  const bg = $('.pv-bg', pv);
  const x = $('.pv-x', pv);
  const ready = from && from.complete && from.naturalWidth;
  img.src = ready ? from.currentSrc || from.src : src;
  if (!ready) { try { await img.decode(); } catch (e) { /* still show it */ } }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const nw = img.naturalWidth || vw;
  const nh = img.naturalHeight || vh;
  const k = peek ? Math.min(Math.min(vw - 32, 520) / nw, (vh * 0.7) / nh) : Math.min(vw / nw, (vh * 0.86) / nh);
  const fw = nw * k;
  const fh = nh * k;
  const big = `translate(${(vw - fw) / 2}px, ${(vh - fh) / 2}px) scale(1)`;
  const bigClip = `inset(0px 0px 0px 0px round ${peek ? 18 : 8}px)`;
  img.style.width = fw + 'px';
  img.style.height = fh + 'px';
  img.style.transform = big;
  // Where the thumbnail is now, as a transform + crop of the big picture (null: it's gone or off screen).
  const small = () => {
    if (!from || !from.isConnected) return null;
    const r = from.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > vh) return null;
    const s = Math.max(r.width / fw, r.height / fh);
    const ix = (fw - r.width / s) / 2;
    const iy = (fh - r.height / s) / 2;
    const rad = (parseFloat(getComputedStyle(from).borderTopLeftRadius) || 0) / s;
    return { transform: `translate(${r.left - ix * s}px, ${r.top - iy * s}px) scale(${s})`, clip: `inset(${iy}px ${ix}px ${iy}px ${ix}px round ${rad}px)` };
  };
  const frames = (a, b) => [
    { transform: a.transform, clipPath: a.clip, webkitClipPath: a.clip, opacity: a.opacity == null ? 1 : a.opacity },
    { transform: b.transform, clipPath: b.clip, webkitClipPath: b.clip, opacity: b.opacity == null ? 1 : b.opacity },
  ];
  const open = { transform: big, clip: bigClip };
  const start = small() || { transform: big.replace('scale(1)', 'scale(.92)'), clip: bigClip, opacity: 0 };
  document.body.appendChild(pv);
  if (from) from.style.visibility = 'hidden';
  img.animate(frames(start, open), { duration: peek ? 320 : PV_MS, easing: peek ? PEEK_IN : PV_EASE, fill: 'forwards' });
  bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PV_MS, easing: 'ease-out', fill: 'forwards' });
  if (x) x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PV_MS, fill: 'forwards' });

  let closing = false;
  if (img.src !== src) { // swap in the full-size picture once it's decoded (same shape, so nothing moves)
    const hi = new Image();
    hi.src = src;
    hi.decode().then(() => { if (!closing) img.src = src; }, () => {});
  }
  const close = () => {
    if (closing) return;
    closing = true;
    window.removeEventListener('hashchange', close);
    pv.classList.add('closing');
    const end = small() || { transform: big.replace('scale(1)', 'scale(.92)'), clip: bigClip, opacity: 0 };
    const ms = peek ? 220 : PV_MS;
    img.getAnimations().forEach((a) => a.cancel());
    const a = img.animate(frames(open, end), { duration: ms, easing: PV_EASE, fill: 'forwards' });
    bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
    if (x) x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms / 2, fill: 'forwards' });
    const done = () => {
      if (from) from.style.visibility = ''; // same frame as the overlay goes: the picture lands exactly where it was
      pv.remove();
    };
    a.finished.then(done, done);
  };
  if (!peek) pv.addEventListener('click', close);
  window.addEventListener('hashchange', close);
  return { close };
}

// The full-size picture behind a thumbnail on the page (falls back to what the thumbnail shows).
function fullSrc(el) {
  const d = el.dataset;
  const big = (p) => p && (p.full || p.thumb);
  if (d.act === 'photo') { const l = lensById(d.id) || S.wish.find((w) => w.id === d.id); const p = l && big((l.photos || [])[+d.i]); if (p) return p; }
  if (d.act === 'inspo-img') { const l = lensById(d.id); const p = l && l.inspo && l.inspo[+d.i] && l.inspo[+d.i].img; if (p) return p; }
  const wi = el.closest('.wimg');
  if (wi) { const w = S.wish.find((x) => x.id === wi.dataset.id); const p = w && big((w.photos || [])[0]); if (p) return p; }
  return el.currentSrc || el.src;
}

// Long-press a photo → preview pops up while the finger stays down, lifting it puts the picture back
// (Lensy's own, because iOS's preview stutters as it springs back).
let lp = null; // waiting for the press to become long
let held = null; // the open preview: Promise of { close }
let lpNoClickUntil = 0;
const lpCancel = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
const release = (e) => {
  lpCancel();
  if (!held) return;
  const h = held;
  held = null;
  h.then((p) => p && p.close());
  lpNoClickUntil = Date.now() + 350; // lifting the finger must not also open the card behind the picture
  if (e && e.cancelable) e.preventDefault();
};
document.addEventListener('touchstart', (e) => {
  lpCancel();
  const img = e.touches.length === 1 && e.target.closest && e.target.closest('#view img');
  if (!img || $('.pv')) return;
  const t = e.touches[0];
  lp = { x: t.clientX, y: t.clientY, t: setTimeout(() => { lp = null; held = peekPhoto(fullSrc(img), img); }, 420) };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (held) { if (e.cancelable) e.preventDefault(); return; } // the page stays put under the preview
  if (!lp) return;
  const t = e.touches[0];
  if (Math.abs(t.clientX - lp.x) > 10 || Math.abs(t.clientY - lp.y) > 10) lpCancel();
}, { passive: false });
document.addEventListener('touchcancel', release, { passive: false });
document.addEventListener('touchend', release, { passive: false });
document.addEventListener('click', (e) => { if (Date.now() < lpNoClickUntil) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('#view img')) e.preventDefault(); });

function calendarSheet(ics, name, gcal) {
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const sh = sheet('加入手机日历', `<p class="ask">共 ${count} 个提醒（到期日、换水日、护理品到期）。加入日历后，即使不打开 Lensy，手机也会准时提醒你。</p>
    ${count ? `<div class="choices">
      ${IOS ? '<button class="btn primary block" data-cal="open">加入 iPhone 日历</button>' : ''}
      <button class="btn ${IOS ? 'soft' : 'primary'} block" data-cal="file">${IOS ? '分享 .ics 文件' : '下载日历文件 (.ics)'}</button>
      ${gcal ? `<a class="btn soft block" href="${gcal}" target="_blank" rel="noopener">加到 Google 日历</a>` : ''}</div>
      <p class="muted sm">提示：以后开封新的一副、换了护理品，再导出一次即可（同一个提醒不会重复）。${IOS ? '点“加入 iPhone 日历”后，在弹出的页面点 <b>Add All</b>。如果没反应，请在 Safari 里打开 Lensy 再试；用“分享 .ics 文件”时在分享菜单里选 <b>Calendar</b>。' : '下载后点开文件，选择用日历打开。'}</p>` : '<p class="muted">目前没有未来的提醒。</p>'}`, { cls: 'small' });
  sh.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cal]');
    if (!b) return;
    if (b.dataset.cal === 'open') location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    else await shareFile(name, ics, 'text/calendar');
  });
}

// ---------- phone notifications (push) ----------
// The phone sends its upcoming reminders (times + text only) to the Lensy Push server, which pushes
// each one when it is due — also while the app is closed. The service worker (sw.js) fetches the text
// from the server's inbox with this phone's id + secret, kept in the Cache "lensy-push" for it.
const b64Bytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
const bytesB64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
const randomId = (n) => bytesB64(crypto.getRandomValues(new Uint8Array(n)));

async function pushPost(body) {
  const res = await fetch(PUSH_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || '服务器出错');
  return out.result;
}
const pushCall = (fn, extra) => pushPost({ fn, id: S.settings.push.id, secret: S.settings.push.secret, ...(extra || {}) });

async function pushOn() {
  const reg = await navigator.serviceWorker.ready;
  const key = await pushPost({ fn: 'key' });
  let sub = await reg.pushManager.getSubscription();
  const subKey = sub && sub.options && sub.options.applicationServerKey;
  if (sub && subKey && bytesB64(subKey) !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64Bytes(key) });
  const cfg = S.settings.push && S.settings.push.id ? S.settings.push : { id: 'p' + randomId(15), secret: randomId(24) };
  S.settings.push = { ...cfg, on: true };
  await DB.put('kv', { id: 'settings', value: S.settings });
  await pushConfigForSW();
  await pushCall('sync', { endpoint: sub.endpoint, items: pushSchedule(S, S.settings) });
}

async function pushOff() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* ignore */ }
  try { if (S.settings.push) await pushCall('off'); } catch (e) { /* offline: the server forgets it after 120 days */ }
  S.settings.push = null;
  S.settings.notify = false;
  await DB.put('kv', { id: 'settings', value: S.settings });
  try { await caches.delete('lensy-push'); } catch (e) { /* ignore */ }
}

async function pushConfigForSW() {
  if (!('caches' in window) || !S.settings.push) return;
  const c = await caches.open('lensy-push');
  await c.put('push-config', new Response(JSON.stringify({ api: PUSH_API, id: S.settings.push.id, secret: S.settings.push.secret })));
}

// Re-sends the schedule a moment after any change (and when the app opens or comes back).
let pushTimer = null;
let lastPushed = '';
function pushSoon(delay) {
  if (!S.settings.push || !S.settings.push.on) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSync, delay == null ? 1500 : delay);
}
async function pushSync() {
  if (!S.settings.push || !S.settings.push.on || !navigator.onLine) return;
  const items = pushSchedule(S, S.settings);
  const sig = JSON.stringify(items);
  if (sig === lastPushed) return;
  try {
    let endpoint;
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); endpoint = sub ? sub.endpoint : ''; } catch (e) { /* keep the saved one */ }
    await pushCall('sync', endpoint === undefined ? { items } : { endpoint, items });
    lastPushed = sig;
  } catch (e) { console.warn('push sync failed', e); }
}

// ---------- badge & in-app notifications ----------
async function notifyDue() {
  const rs = reminders(S, S.settings).filter((r) => r.level === 'overdue' || r.level === 'due');
  try { if (navigator.setAppBadge) { if (rs.length) navigator.setAppBadge(rs.length); else navigator.clearAppBadge(); } } catch (e) { /* not supported */ }
  if (S.settings.push && S.settings.push.on) return; // the push server sends them
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const t = today();
  const fresh = rs.filter((r) => S.settings.notified[r.key] !== t);
  if (!fresh.length) return;
  const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
  for (const r of fresh.slice(0, 4)) {
    const opts = { body: r.sub, tag: r.key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: r.lensId ? `#lens/${r.lensId}` : '#home' } };
    try { if (reg) await reg.showNotification(r.title, opts); else new Notification(r.title, opts); } catch (e) { /* ignore */ }
    S.settings.notified[r.key] = t;
  }
  for (const k of Object.keys(S.settings.notified)) if (diffDays(S.settings.notified[k], t) > 60) delete S.settings.notified[k];
  for (const k of Object.keys(S.settings.snooze)) if (S.settings.snooze[k] < t) delete S.settings.snooze[k];
  await saveSettings();
}

// ---------- routing ----------
const SCREENS = { home: Home, lenses: Lenses, lens: LensDetail, wish: Wish, wishitem: WishDetail, me: Me, stats: Stats };
let lastRoute = '';
function render() {
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  const fn = SCREENS[name] || Home;
  const route = location.hash;
  const y = route === lastRoute ? scrollY : 0;
  lastRoute = route;
  $('#view').innerHTML = fn(arg);
  const tab = { lens: 'lenses', wishitem: 'wish', stats: 'me' }[name] || (SCREENS[name] ? name : 'home');
  $$('.tabs [data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  scrollTo(0, y);
  const filter = $('[data-filter]');
  if (filter) filter.addEventListener('input', () => { const q = filter.value.trim().toLowerCase(); $$('.lcard').forEach((c) => { c.hidden = q && !c.dataset.q.includes(q); }); });
  notifyDue();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el.dataset, el); } catch (err) { console.error(err); toast('出错了：' + (err.message || err)); }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-set]');
  if (!el) return;
  const k = el.dataset.set;
  S.settings[k] = el.type === 'number' ? Math.max(Number(el.min) || 0, Number(el.value) || DEFAULT_SETTINGS[k]) : el.value.trim() || DEFAULT_SETTINGS[k];
  await saveSettings();
  toast('已保存');
  if (k === 'currency') render();
});
window.addEventListener('hashchange', render);
// No zooming. Double-tap zoom is turned off by touch-action in app.css; iOS ignores user-scalable=no,
// so pinch gestures are stopped here too (except in the full-screen photo viewer).
document.addEventListener('gesturestart', (e) => { if (!(e.target.closest && e.target.closest('.pv'))) e.preventDefault(); }, { passive: false });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  checkUpdate();
  pushSoon(300);
  if (!$('.sheet-wrap') && !$('.pv')) render();
});
setInterval(() => {
  $$('[data-since]').forEach((el) => { el.textContent = dur(Date.now() - new Date(el.dataset.since)); });
  if (S.settings.wearing) notifyDue();
}, 30000);

async function start() {
  try { await load(); } catch (e) { $('#view').innerHTML = `<div class="empty">无法打开本地资料库：${esc(e.message)}<br>如果在无痕模式，请换普通模式打开。</div>`; return; }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(() => checkUpdate()).catch(() => {});
    // A new version took over: reload to it now, or as soon as no form is open.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; } // first install, nothing to reload
      reloadWhenIdle();
    });
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open' && e.data.url) location.hash = e.data.url.split('#')[1] || 'home'; });
  }
  if (S.settings.push && S.settings.push.on) { pushConfigForSW().catch(() => {}); pushSoon(800); }
  window.__lensy = { S, render, reload: async () => { await load(); render(); }, pushSchedule: () => pushSchedule(S, S.settings) }; // for tests
  document.documentElement.dataset.ready = '1';
}

// ---------- updates ----------
// Every open (and every return to the app) asks for the latest sw.js; a new version installs in the
// background, takes over (skipWaiting in sw.js) and the page reloads into it.
let hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
let lastCheck = 0;
async function checkUpdate() {
  if (!('serviceWorker' in navigator) || Date.now() - lastCheck < 10000) return;
  lastCheck = Date.now();
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* offline */ }
}
function reloadWhenIdle() {
  if (reloadWhenIdle.done) return;
  if ($('.sheet-wrap') || $('.pv')) { setTimeout(reloadWhenIdle, 1500); return; } // don't lose a form being filled in
  reloadWhenIdle.done = true;
  try { sessionStorage.setItem('lensy-updated', '1'); } catch (e) { /* ignore */ }
  location.reload();
}
try { if (sessionStorage.getItem('lensy-updated')) { sessionStorage.removeItem('lensy-updated'); setTimeout(() => toast(`已更新到最新版 v${VERSION} ✨`), 600); } } catch (e) { /* ignore */ }
start();
