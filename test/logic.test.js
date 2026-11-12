// node test/logic.test.js — reminders, catalogue autofill, style suggestions, calendar export.
import assert from 'node:assert/strict';
import { reminders, lensState, careEnd, buildIcs, stats, addDays, diffDays, pairEnd } from '../js/logic.js';
import { colorsFor, specFor, cyclesFor, guessTone, BRANDS, CYCLES, TONES } from '../js/catalog.js';
import { suggest } from '../js/style.js';
import { parseExport, toRows, cycleFrom, splitTitle } from '../js/importer.js';
import fs from 'node:fs';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓', name); };
const NOW = new Date(2026, 10, 12, 10, 0); // 2026-11-12 10:00
const T = '2026-11-12';

console.log('logic');
test('dates', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(diffDays('2026-02-27', '2026-03-01'), 2);
});

test('lens state', () => {
  assert.equal(lensState({ cycle: 'daily', qty: 10, wearCount: 0 }), 'stock');
  assert.equal(lensState({ cycle: 'daily', qty: 8, wearCount: 1 }), 'using');
  assert.equal(lensState({ cycle: 'daily', qty: 0, wearCount: 5 }), 'done');
  assert.equal(lensState({ cycle: 'monthly', qty: 2, pairs: [] }), 'stock');
  assert.equal(lensState({ cycle: 'monthly', qty: 0, pairs: [{ status: 'using', openedAt: T }] }), 'using');
  assert.equal(lensState({ cycle: 'monthly', qty: 0, pairs: [{ status: 'done' }] }), 'done');
  assert.equal(lensState({ cycle: 'monthly', qty: 4, archived: true }), 'done');
});

test('pair end reminders: soon, due, overdue', () => {
  const lens = (openedAt, cycle) => ({ id: 'l1', brand: 'Moody', color: '冷茶棕', cycle, qty: 0, pairs: [{ id: 'p1', openedAt, soakAt: T, status: 'using' }] });
  // monthly opened 25 days ago -> 5 days left -> soon (warn = min(7, 30/4=7))
  let r = reminders({ lenses: [lens(addDays(T, -25), 'monthly')] }, {}, NOW).filter((x) => x.kind === 'pair-end');
  assert.equal(r.length, 1); assert.equal(r[0].level, 'soon'); assert.equal(r[0].days, 5);
  // 2 week opened 13 days ago -> 1 day left -> due (warn = min(7, 14/4=3))
  r = reminders({ lenses: [lens(addDays(T, -13), '2week')] }, {}, NOW).filter((x) => x.kind === 'pair-end');
  assert.equal(r[0].level, 'due');
  // 2 week opened 9 days ago -> 5 days left -> outside 3-day window
  r = reminders({ lenses: [lens(addDays(T, -9), '2week')] }, {}, NOW).filter((x) => x.kind === 'pair-end');
  assert.equal(r.length, 0);
  // half-year opened 200 days ago -> overdue
  r = reminders({ lenses: [lens(addDays(T, -200), 'halfyear')] }, {}, NOW).filter((x) => x.kind === 'pair-end');
  assert.equal(r[0].level, 'overdue'); assert.ok(r[0].sub.includes('请丢弃'));
});

test('custom end date wins over the cycle', () => {
  const l = { cycle: 'monthly', pairs: [] };
  assert.equal(pairEnd(l, { openedAt: T }), addDays(T, 30));
  assert.equal(pairEnd(l, { openedAt: T, endAt: '2026-11-20' }), '2026-11-20');
});

test('solution change reminders', () => {
  const mk = (soakAt, lastWorn, soakDays) => ({ lenses: [{ id: 'l', brand: 'B', color: 'C', cycle: 'halfyear', soakDays, qty: 0, pairs: [{ id: 'p', openedAt: addDays(T, -30), soakAt, lastWorn, status: 'using' }] }] });
  const soak = (d, s) => reminders(d, s || {}, NOW).filter((x) => x.kind === 'soak');
  assert.equal(soak(mk(addDays(T, -2))).length, 0, '2 days < 3');
  assert.equal(soak(mk(addDays(T, -3)))[0].level, 'due');
  assert.equal(soak(mk(addDays(T, -6)))[0].level, 'overdue');
  assert.equal(soak(mk(addDays(T, -6), addDays(T, -1))).length, 0, 'wearing refreshes the solution');
  assert.equal(soak(mk(addDays(T, -6), null, 7)).length, 0, 'per-lens interval');
  assert.equal(soak(mk(addDays(T, -3)), { soakDays: 5 }).length, 0, 'global interval');
  // not while it is in the eyes
  const d = mk(addDays(T, -6));
  assert.equal(soak(d, { wearing: { pairId: 'p', start: NOW.toISOString() } }).length, 0);
});

test('box expiry, low stock, snooze', () => {
  const data = { lenses: [
    { id: 'a', brand: 'X', color: 'Y', cycle: 'daily', qty: 3, wearCount: 2, expiry: addDays(T, 20) },
    { id: 'b', brand: 'X', color: 'Z', cycle: 'monthly', qty: 2, expiry: addDays(T, -1), pairs: [] },
  ] };
  const r = reminders(data, {}, NOW);
  assert.ok(r.find((x) => x.kind === 'lens-expiry' && x.lensId === 'a' && x.level === 'soon'));
  assert.ok(r.find((x) => x.kind === 'lens-expiry' && x.lensId === 'b' && x.level === 'overdue'));
  const low = r.find((x) => x.kind === 'low-stock');
  assert.ok(low);
  assert.equal(r[0].level, 'overdue', 'most urgent first');
  const after = reminders(data, { snooze: { [low.key]: T } }, NOW);
  assert.ok(!after.find((x) => x.kind === 'low-stock'), 'snoozed for today');
  const tomorrow = reminders(data, { snooze: { [low.key]: T } }, new Date(2026, 10, 13, 9));
  assert.ok(tomorrow.find((x) => x.kind === 'low-stock'), 'back the next day');
});

test('care products: earlier of expiry and opened+days', () => {
  assert.deepEqual(careEnd({ expiry: '2027-05-01', openedAt: T, openDays: 90 }).date, addDays(T, 90));
  assert.deepEqual(careEnd({ expiry: '2026-12-01', openedAt: T, openDays: 90 }).date, '2026-12-01');
  assert.equal(careEnd({}), null);
  const r = reminders({ care: [
    { id: 'c1', type: 'drops', name: '润眼液', openedAt: addDays(T, -25), openDays: 28 },
    { id: 'c2', type: 'solution', name: '护理液', expiry: addDays(T, -3) },
    { id: 'c3', type: 'solution', name: '用完的', expiry: addDays(T, -3), finished: true },
    { id: 'c4', type: 'case', name: '镜盒', openedAt: addDays(T, -100), openDays: 90 },
  ] }, {}, NOW);
  assert.equal(r.find((x) => x.careId === 'c1').level, 'soon');
  assert.equal(r.find((x) => x.careId === 'c2').level, 'overdue');
  assert.ok(!r.find((x) => x.careId === 'c3'));
  assert.ok(r.find((x) => x.careId === 'c4').title.includes('该更换了'));
});

test('long wear and backup reminders', () => {
  const start = new Date(NOW.getTime() - 9 * 3600000).toISOString();
  const r = reminders({ lenses: [{ id: 'a', brand: 'a', color: 'b', cycle: 'daily', qty: 5 }, { id: 'b', brand: 'a', color: 'c', cycle: 'daily', qty: 5 }] }, { wearing: { lensId: 'a', start } }, NOW);
  assert.ok(r.find((x) => x.kind === 'wear-long'));
  assert.ok(r.find((x) => x.kind === 'backup'));
  assert.ok(!reminders({ lenses: [{ id: 'a', cycle: 'daily', qty: 1 }, { id: 'b', cycle: 'daily', qty: 1 }] }, { lastBackup: NOW.toISOString() }, NOW).find((x) => x.kind === 'backup'));
});

test('stats', () => {
  const st = stats({ lenses: [{ id: 'a', price: 100, tone: 'grey' }], wears: [{ lensId: 'a', date: T, hours: 6 }, { lensId: 'a', date: T, hours: 8 }, { lensId: 'a', date: '2026-10-01' }], care: [{ price: 30 }] }, NOW);
  assert.equal(st.monthDays, 1);
  assert.equal(st.totalWears, 3);
  assert.equal(st.spend, 130);
  assert.equal(Math.round(st.perWear * 100), 3333);
  assert.equal(st.avgHours, 7);
  assert.equal(st.tones.grey, 3);
});

test('calendar export', () => {
  const ics = buildIcs({ lenses: [{ id: 'l', brand: 'Moody', color: '冷泡乌龙茶', cycle: 'halfyear', qty: 2, expiry: '2028-01-01', pairs: [{ id: 'p', openedAt: T, soakAt: T, status: 'using' }] }], care: [{ id: 'c', name: '护理液, 大瓶', type: 'solution', openedAt: T, openDays: 90 }] }, {}, NOW);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${addDays(T, 180).replace(/-/g, '')}`), 'pair end');
  assert.ok(ics.includes('UID:soak-p-'), 'solution changes');
  assert.equal((ics.match(/UID:soak-p-/g) || []).length, 12, 'next 12 changes');
  assert.ok(ics.includes('护理液\\, 大瓶'), 'commas escaped');
  assert.ok(ics.includes('BEGIN:VALARM'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length);
});

console.log('catalogue');
test('every brand has series with valid cycles and colours', () => {
  for (const b of BRANDS) {
    assert.ok(b.series.length, b.name);
    for (const s of b.series) {
      for (const k of Object.keys(s.cycles)) assert.ok(CYCLES[k], `${b.name} ${k}`);
      for (const [name, tone, cyc] of s.colors) {
        assert.ok(TONES[tone], `${name} tone`);
        for (const k of cyc || []) assert.ok(k in s.cycles, `${b.name} ${name} ${k} not in series`);
      }
    }
  }
});

test('a colour sold in two cycles asks for the cycle; specs follow the cycle', () => {
  assert.deepEqual(cyclesFor('安视优', 'Natural Shine 自然亮棕', []), ['daily', '2week']);
  assert.deepEqual(cyclesFor('ACUVUE', 'Radiant Charm 魅力琥珀', []), ['daily']);
  const daily = specFor('安视优', 'Natural Shine 自然亮棕', 'daily', []);
  const two = specFor('安视优', 'Natural Shine 自然亮棕', '2week', []);
  assert.equal(daily.dia, 14.2); assert.equal(daily.bc, 8.5); assert.equal(daily.pack, 30);
  assert.equal(two.dia, 14.0); assert.equal(two.pack, 6);
  assert.deepEqual(cyclesFor('Moody', '冷泡乌龙茶', []), ['halfyear']);
});

test('learned values win and add new colours/cycles', () => {
  const learned = [{ brand: 'Moody', color: '冷泡乌龙茶', cycle: 'halfyear', dia: 14.5, gdia: 13.8, bc: 8.7, water: 42, tone: 'brown' },
    { brand: 'Moody', color: '新色号', cycle: 'monthly', dia: 14.0, tone: 'grey' }, { brand: '小众牌', color: '雾霾灰', cycle: 'yearly', dia: 14.1 }];
  assert.equal(specFor('Moody', '冷泡乌龙茶', 'halfyear', learned).dia, 14.5);
  assert.equal(specFor('Moody', '冷泡乌龙茶', 'halfyear', learned).from, 'mine');
  assert.ok(colorsFor('Moody', learned).find((c) => c.name === '新色号' && c.tone === 'grey'));
  assert.deepEqual(cyclesFor('小众牌', '雾霾灰', learned), ['yearly']);
  assert.equal(specFor('小众牌', '雾霾灰', 'yearly', learned).dia, 14.1);
  assert.equal(specFor('小众牌', '别的', 'yearly', learned), null);
  // unknown colour of a known brand still gets the series' reference specs
  assert.equal(specFor('可啦啦', '随便一个色', 'halfyear', []).bc, 8.6);
});

test('tone guessing', () => {
  assert.equal(guessTone('冷茶棕'), 'brown');
  assert.equal(guessTone('冰川灰'), 'grey');
  assert.equal(guessTone('蜜糖琥珀'), 'amber');
  assert.equal(guessTone('混血棕'), 'mixed');
  assert.equal(guessTone('樱花粉'), 'pink');
  assert.equal(guessTone('Mystical Black'), 'black');
});

console.log('style');
test('suggestions depend on tone, size and name', () => {
  const g = suggest({ brand: 'Moody', color: '冰川灰', tone: 'grey', gdia: 13.8 });
  assert.ok(g.tags.includes('清冷感'));
  assert.ok(g.tags.some((t) => t.includes('明显放大')));
  assert.ok(g.makeup.find((m) => m.k === '唇色').palette[0].hex.startsWith('#'));
  assert.equal(g.searches.length, 3);
  assert.ok(g.searches[0].q.includes('Moody') && g.searches[0].q.includes('冰川灰') && g.searches[0].q.includes('上眼'));
  assert.ok(g.searches[0].app.startsWith('xhsdiscover://search/result?keyword='));
  assert.ok(g.searches[0].web.startsWith('https://www.xiaohongshu.com/search_result?keyword='));
  const b = suggest({ brand: '安视优', color: 'Natural Shine 自然亮棕', tone: 'brown', dia: 14.2 });
  assert.ok(b.searches[0].q.includes('自然亮棕'), 'uses the Chinese part of the colour name');
  assert.notDeepEqual(g.formula, b.formula);
  for (const t of Object.keys(TONES)) assert.ok(suggest({ tone: t }).formula);
});

console.log('import from Reminders');
const JPG = fs.readFileSync(new URL('./fixtures/lens.jpg', import.meta.url)).toString('base64');
test('Shortcut export: titles, notes, done (Chinese 是/否), wrapped images', () => {
  const wrapped = JPG.match(/.{1,76}/g).join('\n');
  const text = `@@ITEM\r\n@@TITLE 拉拜诗 新晋 OL\r\n@@NOTES 月\r\n@@DONE 否\r\n@@IMG ${JPG}\r\n@@IMG ${wrapped}\r\n`
    + '@@ITEM\n@@TITLE Glam Up 焦糖美式\n@@NOTES 半\n第二行备注\n@@DONE 是\n'
    + '@@ITEM\n@@TITLE Neo 浪漫蓝调\n@@NOTES \n@@DONE No\n@@IMG \n'
    + '@@ITEM\n@@TITLE \n@@NOTES 空标题会被丢掉\n';
  const items = parseExport(text);
  assert.equal(items.length, 3);
  assert.deepEqual([items[0].title, items[0].notes, items[0].done, items[0].images.length], ['拉拜诗 新晋 OL', '月', false, 2]);
  assert.equal(items[0].images[1], JPG, 'wrapped base64 joined back');
  assert.deepEqual([items[1].notes, items[1].done], ['半\n第二行备注', true]);
  assert.equal(items[2].images.length, 0, 'empty image line dropped');
});

test('plain pasted text from the Reminders list', () => {
  const items = parseExport('🗄️\n拉拜诗 新晋 OL\n月\nGlam Up 琥珀光\n半\n○ 拉拜诗 好运女孩\n日\n✓ Glam Up 焦糖美式\n半\n\n愿望清单🎋\n拉拜诗 一克霓虹\nNeo 浪漫蓝调\n● 拉拜诗 新晋 OL/新手光环');
  assert.deepEqual(items.map((i) => i.title), ['拉拜诗 新晋 OL', 'Glam Up 琥珀光', '拉拜诗 好运女孩', 'Glam Up 焦糖美式', '拉拜诗 一克霓虹', 'Neo 浪漫蓝调', '拉拜诗 新晋 OL/新手光环']);
  assert.deepEqual(items.map((i) => i.notes), ['月', '半', '日', '半', '', '', '']);
  assert.deepEqual(items.map((i) => i.section), ['', '', '', '', 'wish', 'wish', 'wish']);
  assert.equal(items[3].done, true);
  assert.equal(items[6].done, true);
});

test('rows: brand split, cycle, cabinet vs wishlist, duplicates', () => {
  const items = parseExport('拉拜诗 新晋 OL\n月\nGlam Up 琥珀光\n半\nMOODY 积雨云\n日\n✓ Glam Up 焦糖美式\n半\n愿望清单\nNeo 鸢尾手记\n● 拉拜诗 新晋 OL/新手光环\n人鱼姬 黑金胶片');
  const rows = toRows(items, { existing: [{ brand: 'Moody', color: '积雨云' }], wishExisting: [{ brand: '人鱼姬', color: '黑金胶片' }] });
  const r = Object.fromEntries(rows.map((x) => [x.title, x]));
  assert.deepEqual([r['拉拜诗 新晋 OL'].brand, r['拉拜诗 新晋 OL'].color, r['拉拜诗 新晋 OL'].cycle, r['拉拜诗 新晋 OL'].dest, r['拉拜诗 新晋 OL'].qty], ['拉拜诗', '新晋 OL', 'monthly', 'lens', 2]);
  assert.deepEqual([r['Glam Up 琥珀光'].brand, r['Glam Up 琥珀光'].cycle], ['Glam Up', 'halfyear']);
  assert.deepEqual([r['MOODY 积雨云'].brand, r['MOODY 积雨云'].dest], ['Moody', 'skip'], 'already in Lensy');
  assert.deepEqual([r['Glam Up 焦糖美式'].dest, r['Glam Up 焦糖美式'].done, r['Glam Up 焦糖美式'].qty], ['lens', true, 0], 'ticked lens → archive');
  assert.equal(r['Neo 鸢尾手记'].dest, 'wish');
  assert.equal(r['拉拜诗 新晋 OL/新手光环'].dest, 'skip', 'ticked wish = bought');
  assert.equal(r['人鱼姬 黑金胶片'].dest, 'skip', 'already wished');
  // Shortcut export has no sections: a cycle note means cabinet, none means wishlist
  const ex = toRows(parseExport('@@ITEM\n@@TITLE 拉拜诗 珍珠引力\n@@NOTES \n@@DONE 否\n@@ITEM\n@@TITLE 拉拜诗 好运女孩\n@@NOTES 日\n@@DONE 否'));
  assert.deepEqual(ex.map((x) => [x.dest, x.cycle, x.qty]), [['wish', '', 10], ['lens', 'daily', 10]]);
});

test('cycle words', () => {
  assert.deepEqual(['日', '月', '半', '季', '年', '双周', '半年抛', '月抛', '两周', ''].map(cycleFrom), ['daily', 'monthly', 'halfyear', 'quarterly', 'yearly', '2week', 'halfyear', 'monthly', '2week', '']);
  assert.deepEqual(splitTitle('Glam Up焦糖美式'), { brand: 'Glam Up', color: '焦糖美式' });
  assert.deepEqual(splitTitle('小众牌 雾霾灰', ['小众牌']), { brand: '小众牌', color: '雾霾灰' });
  assert.deepEqual(splitTitle('Neon 新品'), { brand: 'Neon', color: '新品' }, 'Neo must not match Neon');
});

console.log(`\n${n} logic tests passed`);
