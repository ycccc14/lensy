// node test/layout-test.js — every screen and sheet, at several phone widths, filled with long names and big
// numbers: fails if any text sits outside its box (card, button, chip, tag…), if the page scrolls sideways,
// or if zooming (double-tap / field focus) is possible.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.js';
import { openPhone, sleep } from './cdp.js';
import { addDays, today } from '../js/logic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8792;
const WIDTHS = [320, 360, 375, 390, 430];
const T = today();
const LONG = '超级无敌长的花色名字 Natural Shimmer Extra Long Colour Name 测试';

const data = {
  app: 'lensy', version: 1,
  lenses: [
    { id: 'L1', brand: 'Hapa Kristin', series: 'Cat-titude Kristin', color: LONG, cycle: 'monthly', tone: 'grey', dia: 14.2, gdia: 13.8, bc: 8.6, water: 45, powerL: '-10.00', powerR: '-9.50', qty: 12, boughtQty: 14, pack: 2, expiry: addDays(T, 10), buyDate: T, price: 123456.78, shop: 'Shopee 官方旗舰店 Lensy Very Long Shop Name Malaysia', notes: '很长很长的备注'.repeat(12), perWear: 2, wearCount: 3, photos: [], createdAt: 1,
      pairs: [{ id: 'P1', openedAt: addDays(T, -26), soakAt: addDays(T, -8), status: 'using', pieces: 2 }, { id: 'P0', openedAt: addDays(T, -70), soakAt: addDays(T, -40), status: 'done', doneAt: addDays(T, -40), doneWhy: '到期丢弃' }],
      inspo: [{ id: 'i1', url: 'https://www.xiaohongshu.com/discovery/item/66aa11bb22cc33dd44ee55ff?xsec_token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', note: '这个妆容好看'.repeat(6) }] },
    { id: 'L2', brand: '安视优', series: 'DEFINE 美瞳', color: 'Radiant Charm 魅力琥珀', cycle: 'daily', tone: 'amber', dia: 14.2, bc: 8.5, water: 58, powerL: '-3.25', powerR: '-3.25', qty: 3, boughtQty: 30, pack: 30, expiry: addDays(T, -2), perWear: 2, wearCount: 9, photos: [], pairs: [], inspo: [], createdAt: 2 },
    { id: 'L3', brand: 'Moody', color: '冷泡乌龙茶', cycle: 'halfyear', tone: 'brown', dia: 14.2, qty: 2, pack: 2, perWear: 2, photos: [], inspo: [], createdAt: 3,
      pairs: [{ id: 'P3', openedAt: addDays(T, -190), soakAt: addDays(T, -12), status: 'using', pieces: 2 }] },
    { id: 'L4', brand: 'OLENS', color: 'Russian Velvet Grey', cycle: 'monthly', tone: 'grey', qty: 0, archived: true, archiveWhy: '不喜欢', price: 89, photos: [], pairs: [], inspo: [], createdAt: 4 },
    { id: 'L5', brand: '一个非常非常长的自定义品牌名字Brand', color: 'Mystical Black', cycle: 'yearly', tone: 'black', qty: 99999, pack: 2, expiry: addDays(T, 400), photos: [], pairs: [], inspo: [], createdAt: 5 },
  ],
  care: [
    { id: 'C1', type: 'drops', name: '乐敦 Rohto Cool 40α 润眼液 超长名字测试 Contact Lens Eye Drops', openedAt: addDays(T, -25), openDays: 28, price: 25.9, createdAt: 1 },
    { id: 'C2', type: 'solution', name: '博士伦 润明护理液', expiry: addDays(T, -3), createdAt: 2 },
    { id: 'C3', type: 'case', name: '镜盒', openedAt: addDays(T, -10), openDays: 90, createdAt: 3 },
    { id: 'C4', type: 'solution', name: '用完的护理液', finished: true, finishedAt: T, createdAt: 4 },
  ],
  wish: [
    { id: 'W1', brand: '拉拜诗', color: '一克霓虹 超长花色名字 Extra Long Wishlist Name', cycle: 'halfyear', tone: 'mixed', price: 99999.99, priority: 3, photos: [], createdAt: 1 },
    { id: 'W2', brand: 'Neo', color: '浪漫蓝调', tone: 'blue', priority: 1, photos: [], createdAt: 2 },
    { id: 'W3', brand: 'Glam Up', color: '', tone: 'brown', photos: [], createdAt: 3 },
  ],
  wears: [
    { id: 'w1', lensId: 'L1', pairId: 'P1', date: T, start: new Date(Date.now() - 9.5 * 3600000).toISOString() },
    { id: 'w2', lensId: 'L2', date: addDays(T, -1), hours: 7.5 }, { id: 'w3', lensId: 'L1', pairId: 'P1', date: addDays(T, -2), hours: 6 },
    { id: 'w4', lensId: 'L3', pairId: 'P3', date: addDays(T, -3), hours: 10 },
  ],
  learned: [],
  kv: [{ id: 'settings', value: { currency: 'MYR', wearing: { lensId: 'L1', pairId: 'P1', start: new Date(Date.now() - 9.5 * 3600000).toISOString(), wearId: 'w1' } } }],
};

// Runs in the page: every visible text node must sit inside its nearest box and inside the screen.
const CHECK = `(() => {
  const BOX = '.card,.btn,.chip,.tag,.pickl,.stats3 a,.seg a,.rem,.pitem,.pick,.specs > div,.k,.wbody,.wact,.irow,.pg,.srow,.cal > div,.tabs a,#toast,.sheet-head,.sheet-foot,.formula,.note,.ins,.howto-box,.xrow,.hist li,.kv,.lhead,.top,.bar,.field,.makeup > div,.tonerow,.rankrow,.gallery';
  const W = document.documentElement.clientWidth;
  const bad = [];
  const scrollsX = (e) => { for (let a = e; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) return true; } return false; };
  const scrollsY = (e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || el.closest('[hidden],script,style,option,select,textarea,.sheet-closing,details:not([open]) > :not(summary)')) continue;
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    let clipped = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.textOverflow === 'ellipsis' && s.overflow !== 'visible') { clipped = true; break; } }
    if (clipped) continue;
    const r = document.createRange();
    r.selectNodeContents(t);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0.5);
    const box = el.closest(BOX);
    const b = box && box.getBoundingClientRect();
    const sx = scrollsX(el);
    for (const x of rects) {
      let why = '';
      if (b && (x.left < b.left - 1 || x.right > b.right + 1)) why = 'sticks out sideways of ' + box.className;
      else if (b && !scrollsY(box) && (x.top < b.top - 1 || x.bottom > b.bottom + 1)) why = 'sticks out top/bottom of ' + box.className;
      else if (!sx && (x.left < -1 || x.right > W + 1)) why = 'off the screen';
      if (why) { bad.push(why + ': "' + t.textContent.trim().slice(0, 40) + '"'); break; }
    }
  }
  if (document.documentElement.scrollWidth > W + 1) bad.push('page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + W + ')');
  // nothing may scroll sideways (no left/right swiping anywhere)
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('.sheet-closing') || !e.getClientRects().length) continue;
    const s = getComputedStyle(e);
    if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1) { bad.push('scrolls sideways: ' + e.tagName.toLowerCase() + '.' + e.className); break; }
  }
  // every field stays inside its column (iPhone date boxes used to overlap the field next to them)
  for (const e of document.querySelectorAll('input:not([type=checkbox]), select, textarea')) {
    if (!e.getClientRects().length || e.closest('.sheet-closing')) continue;
    const r = e.getBoundingClientRect();
    const p = e.parentElement.getBoundingClientRect();
    if (r.right > p.right + 1 || r.left < p.left - 1) { bad.push('field wider than its column: ' + (e.name || e.className || e.type)); break; }
  }
  return bad;
})()`;

const srv = await serve(PORT);
const ph = await openPhone({ port: 9345, shots: path.join(HERE, 'shots', 'layout') });
const { js, until, tap, shot } = ph;
const problems = [];
const go = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(120); };
const sheetsOpen = () => js('document.querySelectorAll(".sheet-wrap").length');
const closeAll = async () => { for (let i = 0; i < 4 && (await sheetsOpen()); i++) { await tap('[data-close]'); await sleep(260); } };
let width = 390;
const check = async (where) => {
  await sleep(120);
  const bad = await js(CHECK);
  if (bad.length) { problems.push(`[${width}px] ${where}:\n    ` + [...new Set(bad)].slice(0, 8).join('\n    ')); await shot(`${width}-${where.replace(/[^\w-]+/g, '_')}`); }
};

try {
  await ph.send('Page.addScriptToEvaluateOnNewDocument', { source: 'navigator.canShare = () => false;' });
  await ph.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await until('document.documentElement.dataset.ready === "1"', 'start');
  await js(`(async () => { const DB = await import('/js/db.js'); await DB.restore(${JSON.stringify(data)}, 'replace'); await window.__lensy.reload(); })()`);

  // the checker must catch real overflow, otherwise a pass means nothing
  const caught = await js(`(() => { const d = document.createElement('div'); d.className = 'card'; d.style.width = '120px';
    d.innerHTML = '<span style="white-space:nowrap">This text is far too long for this little box</span>'; document.querySelector('#view').prepend(d);
    const r = ${CHECK}; d.remove(); return r; })()`);
  assert.ok(caught.some((x) => x.includes('sticks out')), 'checker missed a planted overflow: ' + JSON.stringify(caught));
  console.log('  ✓ checker catches planted overflow');

  // zoom is off
  assert.ok((await js('document.querySelector("meta[name=viewport]").content')).includes('user-scalable=no'));
  assert.equal(await js('getComputedStyle(document.documentElement).touchAction'), 'pan-y');
  assert.equal(await js('getComputedStyle(document.querySelector(".tabs a")).touchAction'), 'pan-y');
  assert.equal(await js('getComputedStyle(document.documentElement).scrollbarWidth'), 'none', 'no scrollbars');
  await tap('.tabs .plus'); await tap('.choices .btn', '添加美瞳'); await sleep(250);
  const small = await js('[...document.querySelectorAll(".sheet-wrap input, .sheet-wrap select, .sheet-wrap textarea")].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length');
  assert.equal(small, 0, 'fields under 16px make iOS zoom in on tap');
  await closeAll();
  console.log('  ✓ zoom and sideways swiping off: viewport, touch-action pan-y, 16px fields, no scrollbars');

  for (width of WIDTHS) {
    await ph.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
    for (const h of ['#home', '#lenses/using', '#lenses/stock', '#lenses/care', '#lenses/done', '#lens/L1', '#lens/L2', '#lens/L3', '#lens/L4', '#lens/L5', '#wish', '#wishitem/W1', '#wishitem/W2', '#wishitem/W3', '#me', '#stats']) {
      await go(h);
      await check(h);
    }
    // sheets
    await go('#home');
    await tap('.tabs .plus'); await check('add menu'); await tap('.choices .btn', '添加美瞳'); await sleep(250); await check('new lens form');
    await tap('[data-f=brand]'); await sleep(250); await check('brand picker');
    await tap('.pitem', 'Hapa Kristin'); await sleep(250);
    await tap('[data-f=color]'); await sleep(250); await check('colour picker');
    await closeAll();
    await go('#lens/L1');
    await tap('[data-act=edit-lens]'); await sleep(250); await check('edit lens form'); await closeAll();
    await tap('.pair [data-act=pair-done]'); await sleep(250); await check('discard sheet'); await closeAll();
    await tap('[data-act=log-wear]'); await sleep(250); await check('log wear sheet'); await closeAll();
    await tap('[data-act=add-inspo]'); await sleep(250); await check('inspiration sheet'); await closeAll();
    await tap('[data-act=pair-cal]'); await sleep(250); await check('pair calendar sheet'); await closeAll();
    await go('#lenses/care');
    await tap('[data-act=edit-care]'); await sleep(250); await check('care form'); await closeAll();
    await tap('.tabs .plus'); await tap('.choices .btn', '护理液'); await sleep(250); await tap('[data-f=type]', '眼药水'); await sleep(150); await check('daily eye drops form');
    await tap('[data-f=dcycle]', '28 天'); await sleep(150); await check('28-day eye drops form'); await closeAll();
    await go('#wish');
    await tap('[data-act=open-wish]'); await sleep(250); await tap('.bar [data-act=edit-wish]'); await sleep(250); await check('wish form'); await closeAll();
    await go('#me');
    await tap('[data-act=ics]'); await sleep(250); await check('calendar sheet'); await closeAll();

    if (width === 320) { await go('#home'); await shot('320-home'); await go('#lens/L1'); await shot('320-detail'); }
  }
  await shot('done');
  if (problems.length) {
    console.error(`\nLayout problems (${problems.length}):\n` + problems.join('\n'));
    process.exitCode = 1;
  } else console.log(`  ✓ no text outside its box and no sideways scrolling on ${WIDTHS.join(' / ')} px, every screen and sheet`);
  assert.deepEqual(ph.errors, [], 'no page errors');
} catch (e) {
  await shot('FAILED').catch(() => {});
  console.error('\nLayout test FAILED:', e.message);
  if (ph.errors.length) console.error('page errors:', ph.errors);
  process.exitCode = 1;
} finally {
  ph.close();
  srv.close();
}
