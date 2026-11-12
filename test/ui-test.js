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
  await tap('[data-f=photo]');
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
  assert.ok((await js('document.querySelector(".sheet-wrap").innerText')).includes('请照包装填写'));
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
  await type('[name=name]', '乐敦润眼液');
  await js('(() => { const c = document.querySelector(".sheet-wrap [name=opened]"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); })()');
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
  await save();
  await until('document.querySelector(".wcard img")', 'wish card');
  await shot('06-wish');
  await tap('[data-act=wish-bought]');
  await until('document.querySelector(".sheet-wrap [data-f=brand]")', 'lens form from wish');
  assert.ok((await js('document.querySelector("[data-f=brand]").textContent')).includes('OLENS'));
  assert.equal(await js('document.querySelectorAll(".sheet-wrap .pgrid img").length'), 1, 'photo carried over');
  await tap('[data-f=cycle]', '月抛');
  await save();
  await until('location.hash.startsWith("#lens/")', 'new lens');
  assert.equal(await S('S.wish.length'), 0);
  assert.equal(await S('S.lenses.find((l) => l.brand === "OLENS").price'), 89);
  ok('wishlist with photo → bought → lens');

  // 8. Detail page with style suggestions and Xiaohongshu links
  const id = await S('S.lenses.find((l) => l.brand === "Moody").id');
  await go(`#lens/${id}`);
  const detail = await js('document.body.innerText');
  assert.ok(detail.includes('风格 & 妆容建议') && detail.includes('眼影') && detail.includes('去小红书'));
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

  // 11. Import the Apple Reminders list through the file the Shortcut saves
  const jpg = fs.readFileSync(PHOTO).toString('base64');
  const exportFile = path.join(os.tmpdir(), 'lensy-reminders-export.txt');
  fs.writeFileSync(exportFile, [
    ['拉拜诗 新晋 OL', '月', '否', 2], ['Glam Up 琥珀光', '半', '否', 1], ['拉拜诗 好运女孩', '日', '否', 0],
    ['Glam Up 焦糖美式', '半', '是', 1], ['Neo 浪漫蓝调', '', '否', 3], ['小众牌 雾霾灰', '年', '否', 0],
  ].map(([t, nt, d, imgs]) => `@@ITEM\n@@TITLE ${t}\n@@NOTES ${nt}\n@@DONE ${d}\n${Array(imgs).fill(`@@IMG ${jpg}`).join('\n')}`).join('\n'));
  await go('#me');
  const lensCount = await S('S.lenses.length');
  const wishCount = await S('S.wish.length');
  await tap('[data-act=import-rem]');
  await until('document.querySelector(".sheet-wrap [data-f=file]")', 'import sheet');
  await shot('12-import');
  ph.nextFiles([exportFile]);
  await tap('[data-f=file]');
  await until('document.querySelector(".sheet-wrap .irow")', 'import preview');
  assert.equal(await js('document.querySelectorAll(".sheet-wrap .irow").length'), 6);
  assert.equal(await js('document.querySelectorAll(".sheet-wrap .istrip img").length'), 7, 'thumbnails from the export');
  assert.ok(await js('document.querySelectorAll(".sheet-wrap .irow")[5].classList.contains("skip")'), '小众牌 雾霾灰 is already in Lensy');
  assert.equal(await js('document.querySelectorAll(".sheet-wrap .irow")[0].querySelector("[name=brand]").value'), '拉拜诗');
  await js('(() => { const c = document.querySelectorAll(".sheet-wrap .irow")[0].querySelector("[name=opened]"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); })()');
  assert.ok((await js('document.querySelector(".sheet-wrap [data-f=go]").textContent')).includes('导入 4 个美瞳 · 1 个心愿'));
  await full('13-import-preview');
  await tap('[data-f=go]');
  await until('!document.querySelector(".sheet-wrap")', 'import finished', 15000);
  assert.equal(await S('S.lenses.length'), lensCount + 4);
  assert.equal(await S('S.wish.length'), wishCount + 1);
  const ol = await S('S.lenses.find((l) => l.color === "新晋 OL")');
  assert.deepEqual([ol.brand, ol.cycle, ol.photos.length, ol.pairs.length, ol.pairs[0].status, ol.dia], ['拉拜诗', 'monthly', 2, 1, 'using', 14.2]);
  const caramel = await S('S.lenses.find((l) => l.color === "焦糖美式")');
  assert.deepEqual([caramel.archived, caramel.cycle, caramel.tone], [true, 'halfyear', 'amber']);
  assert.equal(await S('S.wish.find((w) => w.color === "浪漫蓝调").photos.length'), 3);
  await go('#lenses/using');
  await shot('14-after-import');
  ok('import Apple Reminders export: preview, photos, open pair, ticked → archive, wish');

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
