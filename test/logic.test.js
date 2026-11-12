// node test/logic.test.js — reminders, catalogue autofill, style suggestions, calendar export.
import assert from 'node:assert/strict';
import { reminders, lensState, careEnd, buildIcs, stats, addDays, diffDays, pairEnd, pushSchedule, priceIn } from '../js/logic.js';
import { colorsFor, specFor, cyclesFor, guessTone, BRANDS, CYCLES, TONES, CARE_TYPES, DROP_CYCLES, isDailyDrops, fixCare, convert } from '../js/catalog.js';
import { suggest } from '../js/style.js';

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
  const st = stats({ lenses: [{ id: 'a', price: 100, tone: 'grey' }], wears: [{ lensId: 'a', date: T, hours: 6 }, { lensId: 'a', date: T, hours: 8 }, { lensId: 'a', date: '2026-10-01' }], care: [{ price: 30 }] }, NOW, 'MYR');
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
  const fk = specFor('FreshKon', 'Brilliant Brown', 'daily', []);
  assert.deepEqual([fk.dia, fk.bc, fk.water, fk.pack, fk.from], [14.2, 8.5, 58, 30, 'ref'], 'FreshKon daily from freshkon.com');
  assert.deepEqual(cyclesFor('FreshKon', 'Warm Hazel', []), ['monthly']);
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
  // brands whose specs were not checked fill in nothing (no guessed "typical" values) and offer every cycle
  const none = specFor('可啦啦', '随便一个色', 'halfyear', []);
  assert.deepEqual([none.dia, none.bc, none.water, none.from], [null, null, null, 'none']);
  assert.equal(specFor('拉拜诗', '新晋 OL', 'monthly', []).from, 'none');
  assert.equal(cyclesFor('可啦啦', '随便一个色', []).length, Object.keys(CYCLES).length);
  for (const b of BRANDS) for (const se of b.series) if (!se.verified) for (const v of Object.values(se.cycles)) assert.equal(v, null, `${b.name} has unchecked specs`);
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

console.log('currency, eye drops, push schedule');
test('prices in MYR / CNY / AUD, totals in the chosen currency', () => {
  assert.equal(convert(100, 'CNY', 'MYR'), 60);
  assert.equal(convert(10, 'AUD', 'MYR'), 28);
  assert.equal(Math.round(convert(28, 'MYR', 'AUD') * 100) / 100, 10);
  assert.equal(convert(50, undefined, 'MYR'), 50, 'old records without a currency are MYR');
  const data = { lenses: [{ id: 'a', price: 100, priceCur: 'CNY' }, { id: 'b', price: 10, priceCur: 'AUD' }], care: [{ price: 12 }], wears: [] };
  assert.equal(stats(data, NOW, 'MYR').spend, 60 + 28 + 12);
  assert.equal(stats(data, NOW, 'CNY').spend.toFixed(2), ((60 + 28 + 12) / 0.6).toFixed(2));
  assert.equal(priceIn({ price: 10, priceCur: 'AUD' }, 'CNY').toFixed(2), (28 / 0.6).toFixed(2));
});

test('eye drops: daily vials are counted, others expire after their cycle', () => {
  assert.equal(CARE_TYPES.drops.openDays, 1, 'default is 日抛');
  assert.ok(DROP_CYCLES.some(([d]) => d === 28) && DROP_CYCLES[0][0] === 1);
  const daily = { id: 'd', type: 'drops', openDays: 1, openedAt: addDays(T, -5), qty: 3, expiry: '2027-06-01' };
  assert.ok(isDailyDrops(daily));
  assert.equal(careEnd(daily).date, '2027-06-01', 'opening does not matter for single-use vials');
  const r = reminders({ care: [daily] }, {}, NOW);
  assert.ok(r.find((x) => x.kind === 'care-low' && x.title.includes('3 支')));
  assert.ok(!r.find((x) => x.kind === 'care'), 'not "expired" a day after opening');
  assert.equal(careEnd({ type: 'drops', openDays: 28, openedAt: T }).date, addDays(T, 28));
  assert.deepEqual(fixCare({ type: 'single', openDays: 1 }), { type: 'drops', openDays: 1 }, 'old 单支装 become daily drops');
});

test('push schedule: exact times, future only, snooze respected', () => {
  const lens = { id: 'l', brand: '拉拜诗', color: '新晋 OL', cycle: 'monthly', qty: 2, expiry: addDays(T, 40), pairs: [{ id: 'p', openedAt: addDays(T, -20), soakAt: addDays(T, -1), status: 'using' }] };
  const care = [{ id: 'c', type: 'solution', name: '护理液', openedAt: addDays(T, -85), openDays: 90 }];
  const items = pushSchedule({ lenses: [lens], care }, { remindAt: '20:30' }, NOW);
  const end = addDays(T, 10);
  const at = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, 20, 30).getTime(); };
  assert.ok(items.find((x) => x.key === `end:p:${end}` && x.at === at(end) && x.title.includes('今天到期')), 'end day at the chosen time');
  assert.ok(items.find((x) => x.key.startsWith('warn:p:') && x.at === at(addDays(end, -7))), 'warning 7 days before');
  assert.ok(items.find((x) => x.key.startsWith('over:p:')), 'day after the end');
  const soaks = items.filter((x) => x.key.startsWith('soak:p:'));
  assert.equal(soaks[0].at, at(addDays(T, 2)), 'next solution change 3 days after the last');
  assert.ok(soaks.every((x) => x.at <= at(end)), 'no solution changes after the pair ends');
  assert.ok(items.find((x) => x.key === `care:c:${addDays(T, 5)}`), 'care product end');
  assert.ok(items.find((x) => x.key.startsWith('expwarn:l:')) && items.find((x) => x.key === `exp:l:${addDays(T, 40)}`), 'box expiry');
  assert.ok(items.every((x) => x.at > NOW.getTime() && x.title && x.url), 'future only, with title and link');
  assert.ok(items.every((x, i) => !i || items[i - 1].at <= x.at), 'soonest first');
  const snoozed = pushSchedule({ lenses: [lens], care }, { remindAt: '20:30', snooze: { [`end:p:${end}`]: end } }, NOW);
  assert.ok(!snoozed.find((x) => x.key.startsWith('end:p:') || x.key.startsWith('warn:p:')), 'snoozed reminder is not pushed');
  const start = new Date(NOW.getTime() - 2 * 3600000).toISOString();
  const worn = pushSchedule({ lenses: [lens], care: [] }, { wearing: { lensId: 'l', pairId: 'p', start }, maxHours: 8 }, NOW);
  assert.ok(worn.find((x) => x.key === `wear:${start}` && x.at === new Date(start).getTime() + 8 * 3600000), 'take them off after 8 hours');
  assert.ok(!worn.find((x) => x.key.startsWith('soak:')), 'no solution reminders while they are in the eyes');
});

console.log(`\n${n} logic tests passed`);
