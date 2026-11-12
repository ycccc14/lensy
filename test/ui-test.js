// node test/ui-test.js — drives the real app in an iPhone-sized headless Chrome, the way a user taps it.
// Screenshots go to test/shots/ (gitignored) for a visual check.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from './server.js';
import { openPhone, sleep } from './cdp.js';
import { addDays, today } from '../js/logic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.UI_PORT) || 8791; // 8790 is left for test/server.js
const URL0 = `http://127.0.0.1:${PORT}/`;
const PHOTO = path.join(HERE, 'fixtures', 'lens.jpg');
const T = today();
let step = 0;
const ok = (name) => console.log(`  ✓ ${++step}. ${name}`);

const srv = await serve(PORT);
const ph = await openPhone({ shots: path.join(HERE, 'shots') });
const { js, until, tap, type, shot, full } = ph;
const S = (expr) => js(`(() => { const S = window.__lensy.S; return ${expr}; })()`);
const go = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(150); };
const noOverflow = async (where) => assert.ok(await js('document.documentElement.scrollWidth <= 391'), `page wider than the phone on ${where}`);
const sheetCount = () => js('document.querySelectorAll(".sheet-wrap").length');
const addLens = async () => { await tap('.tabs .plus'); await until('document.querySelector(".choices")', 'add menu'); await tap('.choices .btn', '添加美瞳'); await until('document.querySelector("[data-f=brand]")', 'lens form'); };
const pickBrand = async (q, name) => { await tap('[data-f=brand]'); await until('document.querySelector("[data-q]")', 'brand picker'); await type('[data-q]', q); await tap('.pitem', name); await until(`document.querySelector('[data-f=brand]').textContent.includes(${JSON.stringify(name)})`, 'brand chosen'); };
const pickColor = async (q, name) => { await tap('[data-f=color]'); await until('document.querySelectorAll(".sheet-wrap").length === 2', 'colour picker'); if (q) await type('[data-q]', q); await tap('.pitem', name); await until('document.querySelectorAll(".sheet-wrap").length === 1', 'colour chosen'); };
const formVal = (name) => js(`document.querySelector('.sheet-wrap [name=${name}]').value`);
const save = async () => { const n = await S('S.lenses.length + S.care.length + S.wish.length'); await tap('[data-f=save]'); await until(`(() => { const S = window.__lensy.S; return S.lenses.length + S.care.length + S.wish.length !== ${n} || !document.querySelector('[data-f=save]'); })()`, 'saved'); await sleep(250); };

try {
  await ph.send('Page.addScriptToEvaluateOnNewDocument', { source: 'navigator.canShare = () => false;' });
  await ph.send('Page.navigate', { url: URL0 });
  await until('document.documentElement.dataset.ready === "1"', 'app start');
  assert.ok((await js('document.body.innerText')).includes('还没有可以戴的美瞳'));
  await shot('01-empty');
  ok('starts empty');

  // 1. Brand + colour autofill; a colour sold in two cycles asks which one
  await addLens();
  await pickBrand('安视', '安视优');
  await pickColor('', 'Natural Shine');
  assert.equal(await js('document.querySelectorAll(".sheet-wrap [data-f=cycle]").length'), 2);
  assert.equal(await js('document.querySelectorAll(".sheet-wrap [data-f=cycle].on").length'), 0, 'no cycle chosen for the user');
  assert.ok((await js('document.querySelector(".sheet-wrap").innerText')).includes('2 种周期'));
  await tap('[data-f=cycle]', '双周抛');
  assert.equal(await formVal('dia'), '14');
  assert.equal(await formVal('bc'), '8.5');
  assert.equal(await formVal('pack'), '6');
  await tap('[data-f=cycle]', '日抛');
  assert.equal(await formVal('dia'), '14.2');
  assert.equal(await formVal('pack'), '30');
  await tap('[data-f=cycle]', '双周抛');
  ph.nextFiles([PHOTO]);
  await tap('[data-f=photo]', '佩戴照');
  await until('document.querySelector(".sheet-wrap .pgrid img")', 'photo from the picker');
  await full('02-form');
  await save();
  await until('location.hash.startsWith("#lens/")', 'detail page');
  const acuvue = await S('S.lenses[0]');
  assert.equal(acuvue.cycle, '2week'); assert.equal(acuvue.qty, 6); assert.equal(acuvue.dia, 14); assert.equal(acuvue.photos.length, 1);
  assert.ok(acuvue.photos[0].full.startsWith('data:image/jpeg'));
  ok('add lens: brand → colour → choose cycle → specs filled → photo');

  // 2. Open a pair, wear it, take it off
  await tap('[data-act=open-pair]');
  await until('document.querySelector(".pair")', 'pair card');
  assert.equal(await S('S.lenses[0].qty'), 4);
  await tap('.pair [data-act=wear]');
  await until('window.__lensy.S.settings.wearing', 'wearing');
  await go('#home');
  assert.ok((await js('document.body.innerText')).includes('正在佩戴'));
  await shot('03-wearing');
  await tap('[data-act=wear-stop]');
  await until('!window.__lensy.S.settings.wearing', 'took off');
  const w = await S('S.wears[0]');
  assert.ok(w.end && w.pairId);
  assert.equal(await S('S.lenses[0].pairs[0].soakAt'), T);
  ok('open pair, wear, take off (solution counted as fresh)');

  // 3. Half-year lens already in use: end-of-cycle and solution-change reminders
  await addLens();
  await pickBrand('moody', 'Moody');
  await pickColor('乌龙', '冷泡乌龙茶');
  assert.equal(await js('document.querySelectorAll(".sheet-wrap [data-f=cycle]").length'), 1);
  assert.ok(await js('document.querySelector(".sheet-wrap [data-f=cycle].on").textContent.includes("半年抛")'), 'only cycle picked automatically');
  await js('(() => { const c = document.querySelector(".sheet-wrap [name=openNow]"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await until('document.querySelector(".sheet-wrap [name=openedAt]")', 'opened date');
  await type('[name=openedAt]', addDays(T, -176));
  await type('[name=boxes]', '2');
  await save();
  const moody = await S('S.lenses.find((l) => l.brand === "Moody")');
  assert.equal(moody.qty, 2); assert.equal(moody.pairs.length, 1); assert.equal(moody.pairs[0].openedAt, addDays(T, -176));
  await go('#home');
  let home = await js('document.querySelector(".rems").innerText');
  assert.ok(home.includes('冷泡乌龙茶 还剩 4 天'), home);
  assert.ok(home.includes('该换护理液了'), home);
  await full('04-home-reminders');
  await tap('.rem [data-act=soak]');
  await sleep(200);
  home = await js('document.querySelector(".rems").innerText');
  assert.ok(!home.includes('该换护理液了'));
  ok('half-year lens: expiry + solution reminders, "已换水" clears it');

  // 4. Brand that isn't built in: Lensy learns it
  await addLens();
  await pickBrand('小众牌', '小众牌');
  await pickColor('雾霾灰', '雾霾灰');
  assert.equal(await js('document.querySelectorAll(".sheet-wrap [data-f=cycle]").length'), 6);
  await tap('[data-f=cycle]', '年抛');
  assert.ok((await js('document.querySelector(".sheet-wrap").innerText')).includes('请照包装'));
  assert.ok(await js('!!document.querySelector(".sheet-wrap a[href*=\\"taobao\\"]")'), 'look-up link for the specs');
  assert.ok(await js('document.querySelector(".sheet-wrap [data-f=tone].on").textContent.includes("灰")'), 'tone guessed');
  await type('[name=dia]', '14.1');
  await type('[name=gdia]', '13.4');
  await save();
  await addLens();
  await pickBrand('小众', '小众牌');
  await pickColor('', '雾霾灰');
  assert.ok(await js('document.querySelector(".sheet-wrap [data-f=cycle].on").textContent.includes("年抛")'));
  assert.equal(await formVal('dia'), '14.1');
  assert.ok((await js('document.querySelector(".sheet-wrap").innerText')).includes('上次录入'));
  await tap('[data-close]');
  await sleep(300);
  ok('unknown brand/colour is remembered and fills itself in next time');

  // 5. Daily lens: wearing takes 2 pieces
  await addLens();
  await pickBrand('acuvue', '安视优');
  await pickColor('charm', 'Radiant Charm');
  assert.ok(await js('document.querySelector(".sheet-wrap [data-f=cycle].on").textContent.includes("日抛")'));
  await save();
  await go('#home');
  await tap('.pickl', 'Radiant Charm');
  await until('window.__lensy.S.settings.wearing', 'wearing daily');
  assert.equal(await S('S.lenses.find((l) => l.cycle === "daily").qty'), 28);
  await tap('[data-act=wear-stop]');
  await until('!window.__lensy.S.settings.wearing', 'off');
  ok('daily lens: wear uses 2 pieces');

  // 6. Care products
  await tap('.tabs .plus');
  await tap('.choices .btn', '护理液');
  await until('document.querySelector("[data-f=type]")', 'care form');
  await tap('[data-f=type]', '眼药水');
  assert.ok(await js('document.querySelector(".sheet-wrap [data-f=dcycle].on").textContent.includes("日抛")'), 'eye drops default to 日抛');
  assert.ok(await js('!!document.querySelector(".sheet-wrap [name=qty]") && !document.querySelector(".sheet-wrap [name=opened]")'), 'daily drops are counted, not opened');
  await type('[name=name]', '乐敦润眼液');
  await tap('[data-f=dcycle]', '28 天');
  await until('document.querySelector(".sheet-wrap [name=openDays]")', 'open days');
  assert.equal(await formVal('openDays'), '28');
  await type('[name=openedAt]', addDays(T, -25));
  await save();
  await go('#home');
  assert.ok((await js('document.querySelector(".rems").innerText')).includes('乐敦润眼液 还剩 3 天'));
  await go('#lenses/care');
  await shot('05-care');
  await noOverflow('care');
  ok('care product: opened eye drops warn before 28 days are up');

  // 6b. Daily (single-use) eye drops: count vials, warn when few are left
  await tap('.tabs .plus');
  await tap('.choices .btn', '护理液');
  await until('document.querySelector("[data-f=type]")', 'care form');
  await tap('[data-f=type]', '眼药水');
  await type('[name=name]', '海露单支');
  await type('[name=qty]', '6');
  await save();
  await go('#lenses/care');
  await tap('[data-act=drop-use]');
  await sleep(200);
  assert.equal(await S('S.care.find((c) => c.name === "海露单支").qty'), 5);
  await go('#home');
  assert.ok((await js('document.querySelector(".rems").innerText')).includes('海露单支 只剩 5 支'));
  ok('daily eye drops: "用了一支" counts down, low-stock reminder');

  // 7. Wishlist with a picture, then "买到了" turns it into a lens
  await go('#wish');
  await tap('[data-act=add-wish]');
  await until('document.querySelector("[data-f=brand]")', 'wish form');
  await pickBrand('olens', 'OLENS');
  await pickColor('grey', 'Russian Velvet Grey');
  ph.nextFiles([PHOTO]);
  await tap('[data-f=photo]');
  await until('document.querySelector(".sheet-wrap .pgrid img")', 'wish photo');
  await type('[name=price]', '89');
  await js('(() => { const s = document.querySelector(".sheet-wrap [name=priceCur]"); s.value = "CNY"; s.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await save();
  await until('document.querySelector(".wcard img")', 'wish card');
  const wimgRatio = '(() => { const r = document.querySelector(".wimg").getBoundingClientRect(); return Math.round((r.width / r.height) * 100) / 100; })()';
  assert.equal(await js(wimgRatio), 0.75, 'wishlist pictures are portrait 3:4');
  // A tall screenshot (小红书) must not stretch the card either.
  await js('new Promise((r) => { const c = document.createElement("canvas"); c.width = 400; c.height = 1200; c.getContext("2d").fillRect(0, 0, 400, 1200); const i = document.querySelector(".wimg img"); i.onload = r; i.src = c.toDataURL(); })');
  assert.equal(await js(wimgRatio), 0.75, 'tall wishlist pictures are cropped to 3:4');
  await js('new Promise((r) => { const c = document.createElement("canvas"); c.width = 1200; c.height = 400; c.getContext("2d").fillRect(0, 0, 1200, 400); const i = document.querySelector(".wimg img"); i.onload = r; i.src = c.toDataURL(); })');
  assert.equal(await js(wimgRatio), 0.75, 'wide wishlist pictures are cropped to 3:4 too');
  await go('#home'); await go('#wish'); await until('document.querySelector(".wimg img")', 'wish card again');
  // Long-press a picture: a preview pops up while the finger is down (not the edit form),
  // and goes back into the card as soon as the finger lifts.
  const c0 = await js('(() => { const r = document.querySelector(".wimg img").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()');
  await ph.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [c0] });
  await until('document.querySelector(".pv.peek")', 'preview from long-press');
  await sleep(500);
  await shot('06b-peek');
  assert.ok(await js('(() => { const r = document.querySelector(".pv-img").getBoundingClientRect(); return r.width > 300 && r.width < 390; })()'), 'preview is big but leaves the page visible around it');
  assert.ok(!(await js('!!document.querySelector(".pv-x")')), 'a preview has no close button: lifting the finger closes it');
  await ph.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until('!document.querySelector(".pv") && document.querySelector(".wimg img").style.visibility === ""', 'preview gone on release, card picture back');
  await sleep(300);
  assert.equal(await sheetCount(), 0, 'long-press does not also open the wish form');
  assert.ok((await js('document.querySelector(".wgrid").innerText')).includes('¥ 89'));
  assert.ok((await js('document.querySelector(".top").innerText')).includes('RM 53.4'), 'total converted to MYR (89 × 0.6)');
  await shot('06-wish');
  // Tapping the card opens the wish's own page: every picture, style suggestions, 编辑 top right.
  await tap('.wbody[data-act=open-wish]');
  await until('location.hash.startsWith("#wishitem/") && document.querySelector(".wgal img")', 'wish detail');
  ph.nextFiles([PHOTO]);
  await tap('[data-act=add-photo]');
  await until('document.querySelectorAll(".wgal img").length === 2', 'second wish picture shown');
  assert.ok(await js('(() => { const r = document.querySelector(".wgal img").getBoundingClientRect(); return Math.abs(r.width / r.height - 0.75) < 0.02; })()'), 'detail pictures are portrait 3:4');
  assert.equal(await S('S.wish[0].photos.length'), 2);
  assert.ok((await js('document.querySelector(".card.style").innerText')).includes('穿搭'), 'style & outfit suggestions');
  assert.ok((await js('document.querySelector(".card.style").innerText')).includes('Russian Velvet') || (await js('document.querySelector(".card.style").innerText')).includes('混血'));
  const editBtn = await js('(() => { const b = document.querySelector(".bar [data-act=edit-wish]").getBoundingClientRect(); return b.right > innerWidth - 80 && b.top < 80; })()');
  assert.ok(editBtn, '编辑 button top right');
  await shot('06c-wish-detail');
  await tap('.bar [data-act=edit-wish]');
  await until('document.querySelector(".sheet-wrap [data-f=save]")', 'wish edit form');
  assert.equal(await js('document.querySelectorAll(".sheet-wrap .pgrid img").length'), 2);
  await save();
  assert.ok((await js('location.hash')).startsWith('#wishitem/'), 'stays on the wish page after saving');
  await tap('[data-act=wish-bought]');
  await until('document.querySelector(".sheet-wrap [data-f=brand]")', 'lens form from wish');
  assert.ok((await js('document.querySelector("[data-f=brand]").textContent')).includes('OLENS'));
  assert.equal(await js('document.querySelectorAll(".sheet-wrap .pgrid img").length'), 2, 'photos carried over');
  await tap('[data-f=cycle]', '月抛');
  await save();
  await until('location.hash.startsWith("#lens/")', 'new lens');
  assert.equal(await S('S.wish.length'), 0);
  assert.equal(await S('S.lenses.find((l) => l.brand === "OLENS").price'), 89);
  assert.equal(await S('S.lenses.find((l) => l.brand === "OLENS").priceCur'), 'CNY');
  assert.equal(await S('S.lenses.find((l) => l.brand === "OLENS").photos[0].kind'), 'web', 'wishlist picture becomes a 网图');
  assert.ok((await js('document.body.innerText')).includes('网图') && (await js('document.body.innerText')).includes('我的佩戴效果'));
  await tap('[data-act=photo]');
  await until('document.querySelector(".pv-img") && document.querySelector(".pv-img").naturalWidth > 0', 'tap opens the photo viewer');
  await js('document.querySelector(".pv").click()');
  await until('!document.querySelector(".pv") && document.querySelector("[data-act=photo]").style.visibility === ""', 'viewer closed');
  ok('wishlist with photo (¥, portrait 3:4) → detail page (all pictures, style, 编辑) → bought → lens keeps currency, picture filed as 网图');

  // 8. Detail page with style suggestions and Xiaohongshu links
  const id = await S('S.lenses.find((l) => l.brand === "Moody").id');
  await go(`#lens/${id}`);
  const detail = await js('document.body.innerText');
  assert.ok(detail.includes('风格 & 搭配建议') && detail.includes('眼影') && detail.includes('去小红书'));
  assert.ok(await js('[...document.querySelectorAll("a[href^=\\"xhsdiscover://\\"]")].length === 3'));
  assert.ok(await js('decodeURIComponent(document.querySelector("a[href*=\\"xiaohongshu.com\\"]").href).includes("Moody 冷泡乌龙茶 上眼")'));
  await full('07-detail');
  await noOverflow('detail');
  await tap('[data-act=add-inspo]');
  await type('[name=url]', '看看这个妆 http://xhslink.com/a/AbC123 复制本条信息');
  await tap('[data-ok]');
  await sleep(200);
  const ins = await S(`S.lenses.find((l) => l.id === ${JSON.stringify(id)}).inspo[0]`);
  assert.equal(ins.url, 'http://xhslink.com/a/AbC123');
  ok('style + makeup suggestions, 3 Xiaohongshu searches, saved inspiration link');

  // 9. Discard pair → archive
  await tap('.pair [data-act=pair-done]');
  await tap('.choices .btn', '到期丢弃');
  await sleep(200);
  assert.equal(await S(`S.lenses.find((l) => l.id === ${JSON.stringify(id)}).pairs[0].status`), 'done');
  await go('#lenses/stock');
  assert.ok((await js('document.body.innerText')).includes('冷泡乌龙茶'), 'still has 2 pieces in stock');
  const ac = await S('S.lenses.find((l) => l.brand === "OLENS").id');
  await go(`#lens/${ac}`);
  await tap('[data-act=archive]');
  await tap('.choices .btn', '不喜欢');
  await sleep(200);
  await go('#lenses/done');
  assert.ok((await js('document.body.innerText')).includes('OLENS'));
  await go('#lenses/using');
  await shot('08-cabinet');
  await noOverflow('cabinet');
  ok('discard a pair; archive keeps worn lenses');

  // 10. Stats, settings, calendar, backup, persistence
  await go('#stats');
  assert.ok((await js('document.body.innerText')).includes('累计佩戴次数'));
  await shot('09-stats');
  await go('#me');
  await full('10-me');
  await noOverflow('me');
  await tap('[data-act=ics]');
  await until('document.querySelector(".sheet-wrap")', 'calendar sheet');
  assert.ok(/共 \d+ 个提醒/.test(await js('document.querySelector(".sheet-wrap").innerText')));
  await tap('[data-close]');
  await sleep(250);
  await js('(() => { const i = document.querySelector("[data-set=soakDays]"); i.value = "5"; i.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await sleep(150);
  assert.equal(await S('S.settings.soakDays'), 5);
  await tap('[data-act=backup]');
  await until('window.__lensy.S.settings.lastBackup', 'backup');
  const before = await S('S.lenses.length');
  await ph.send('Page.reload');
  await until('document.documentElement.dataset.ready === "1"', 'reload');
  assert.equal(await S('S.lenses.length'), before);
  assert.equal(await S('S.settings.soakDays'), 5);
  ok('stats, settings saved, calendar export, backup, data survives reload');

  // 11. Edit the number of pieces bought; photos are sharp; display currency
  const acId = await S('S.lenses.find((l) => l.brand === "安视优" && l.cycle === "2week").id');
  await go(`#lens/${acId}`);
  await tap('[data-act=edit-lens]');
  await until('document.querySelector(".sheet-wrap [name=boughtQty]")', 'bought pieces field');
  assert.equal(await formVal('boughtQty'), '6');
  await type('[name=boughtQty]', '12');
  await type('[name=qty]', '10');
  await tap('[data-f=save]');
  await until('!document.querySelector(".sheet-wrap [name=boughtQty]")', 'saved edit');
  await sleep(200);
  assert.deepEqual(await S(`(() => { const l = S.lenses.find((x) => x.id === ${JSON.stringify(acId)}); return [l.boughtQty, l.qty]; })()`), [12, 10]);
  const ph0 = await S(`S.lenses.find((x) => x.id === ${JSON.stringify(acId)}).photos[0]`);
  const dims = await js(`new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = ${JSON.stringify(ph0.full)}; })`);
  const tdims = await js(`new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = ${JSON.stringify(ph0.thumb)}; })`);
  assert.ok(Math.max(...dims) <= 2000 && Math.max(...tdims) >= Math.min(800, Math.max(...dims)) - 1 && ph0.w, `photo kept sharp: full ${dims}, thumb ${tdims}`);
  assert.equal(ph0.kind, 'mine');
  await go('#me');
  await js('(() => { const s = document.querySelector("[data-set=currency]"); s.value = "AUD"; s.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await sleep(250);
  assert.equal(await S('S.settings.currency'), 'AUD');
  assert.ok((await js('document.querySelector(".statcard").innerText')).includes('A$'), 'total spend shown in AUD');
  await js('(() => { const s = document.querySelector("[data-set=currency]"); s.value = "MYR"; s.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await sleep(200);
  ok('edit pieces bought, photos stored large, totals in the chosen currency');

  // 12. Phone notifications: subscribe, send the schedule to the push server (faked here), test push
  await ph.send('Browser.grantPermissions', { origin: URL0.slice(0, -1), permissions: ['notifications'] }).catch(() => {});
  await js(`(() => {
    window.__pushCalls = [];
    Notification.requestPermission = async () => 'granted';
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    const fake = { endpoint: 'https://web.push.apple.com/fake', options: { applicationServerKey: null }, unsubscribe: async () => true, toJSON() { return { endpoint: this.endpoint }; } };
    PushManager.prototype.subscribe = async function () { this.__sub = fake; return fake; };
    PushManager.prototype.getSubscription = async function () { return this.__sub || null; };
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).startsWith('https://script.google.com/')) {
        const b = JSON.parse(opts.body); window.__pushCalls.push(b);
        const result = b.fn === 'key' ? 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' : b.fn === 'sync' ? { items: b.items.length } : { sent: 1 };
        return new Response(JSON.stringify({ ok: true, result }));
      }
      return real(url, opts);
    };
  })()`);
  await tap('[data-act=notify]');
  await until('window.__lensy.S.settings.push && window.__lensy.S.settings.push.on', 'push on', 8000);
  const calls = await js('window.__pushCalls');
  const sync = calls.find((c) => c.fn === 'sync');
  assert.ok(sync && sync.endpoint === 'https://web.push.apple.com/fake' && sync.items.length > 0 && sync.id && sync.secret, 'schedule sent with endpoint');
  assert.ok(sync.items.every((x) => x.at > Date.now() && x.title), 'only future reminders with text');
  assert.ok(await js('caches.open("lensy-push").then((c) => c.match("push-config")).then((r) => r.json()).then((j) => !!(j.id && j.secret && j.api))'), 'service worker can find the id + secret');
  await until('document.querySelector("[data-act=push-test]")', 'test button');
  await tap('[data-act=push-test]');
  await until('window.__pushCalls.some((c) => c.fn === "test")', 'test push');
  const n0 = (await js('window.__pushCalls')).length;
  await js('(() => { const i = document.querySelector("[data-set=remindAt]"); i.value = "21:00"; i.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await until(`window.__pushCalls.length > ${n0}`, 'schedule re-sent after a change', 6000);
  const last = (await js('window.__pushCalls')).pop();
  assert.ok(last.fn === 'sync' && last.items.filter((x) => !x.key.startsWith('wear:')).every((x) => new Date(x.at).getHours() === 21), 'new reminder time used');
  ok('push notifications: subscribe, schedule synced to the server, test, re-sync on change');

  // 12. Dark mode look
  await ph.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await go('#home');
  await full('11-home-dark');
  await ph.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  assert.equal(await sheetCount(), 0);
  assert.deepEqual(ph.errors, [], 'no page errors');
  ok('no page errors');
  console.log(`\nUI test passed (${step} steps). Screenshots: test/shots/`);
} catch (e) {
  await shot('FAILED').catch(() => {});
  console.error('\nUI test FAILED:', e.message);
  if (ph.errors.length) console.error('page errors:', ph.errors);
  process.exitCode = 1;
} finally {
  ph.close();
  srv.close();
}
