// Built-in brand / series / colour reference data.
// Specs are typical published values for each series (reference only — the box label always wins).
// Every lens the user saves is also learned into the "my catalogue" store, so autofill gets better with use.

export const CYCLES = {
  daily: { label: '日抛', days: 1, pack: 10 },
  '2week': { label: '双周抛', days: 14, pack: 6 },
  monthly: { label: '月抛', days: 30, pack: 2 },
  quarterly: { label: '季抛', days: 90, pack: 2 },
  halfyear: { label: '半年抛', days: 180, pack: 2 },
  yearly: { label: '年抛', days: 365, pack: 2 },
};
export const CYCLE_KEYS = Object.keys(CYCLES);

export const TONES = {
  black: { label: '黑色', hex: '#2f2624' },
  brown: { label: '棕色', hex: '#8b5a3c' },
  amber: { label: '琥珀/金棕', hex: '#c58b3f' },
  grey: { label: '灰色', hex: '#8e939c' },
  blue: { label: '蓝色', hex: '#6f94c6' },
  green: { label: '绿色', hex: '#7ea57a' },
  pink: { label: '粉色', hex: '#dc9aab' },
  purple: { label: '紫色', hex: '#9c86c4' },
  mixed: { label: '混血/多色', hex: '#a98d72' },
  clear: { label: '透明片', hex: '#dbe7ee' },
};
export const TONE_KEYS = Object.keys(TONES);

// Guess a colour family from a colour name (used for custom colours).
export function guessTone(name) {
  const s = String(name || '').toLowerCase();
  const rules = [
    ['clear', /透明|clear/],
    ['mixed', /混血|多色|hazel|榛/],
    ['grey', /灰|grey|gray|银|雾|霜|云|珍珠|silver|shimmering g|misty|pearl/],
    ['blue', /蓝|blue|海|aqua|冰川/],
    ['green', /绿|green|抹茶|橄榄|olive/],
    ['pink', /粉|pink|樱|桃|blush|rose/],
    ['purple', /紫|purple|violet|葡萄|薰衣草|鸢尾/],
    ['amber', /琥珀|金|amber|gold|蜜|焦糖|honey|caramel|charm|bright|hazel/],
    ['black', /黑|black|墨|曜|accent|eclipse/],
    ['brown', /棕|褐|茶|咖啡|可可|巧克力|乌龙|brown|choco|mocha|tea|shine|sparkle|shimmer|vivid/],
  ];
  for (const [tone, re] of rules) if (re.test(s)) return tone;
  return 'brown';
}

const S = (dia, bc, water, gdia) => ({ dia, bc, water, gdia });

// colours: [name, tone, cycles (optional: defaults to all series cycles), graphic diameter (optional)]
export const BRANDS = [
  {
    id: 'acuvue', name: '安视优', en: 'ACUVUE', origin: '美国 · 强生',
    series: [
      {
        name: 'DEFINE 美瞳', cycles: { daily: S(14.2, 8.5, 58), '2week': S(14.0, 8.5, 58) }, packs: { daily: 30 },
        colors: [
          ['Natural Shine 自然亮棕', 'brown', ['daily', '2week']],
          ['Vivid Style 活力棕', 'brown', ['daily', '2week']],
          ['Accent Style 黑色轮廓', 'black', ['daily', '2week']],
          ['Natural Sparkle 星耀棕', 'brown', ['daily']],
          ['Natural Shimmer 闪耀浅棕', 'brown', ['daily']],
          ['Radiant Charm 魅力琥珀', 'amber', ['daily']],
          ['Radiant Bright 明亮金棕', 'amber', ['daily']],
        ],
      },
    ],
  },
  {
    id: 'freshkon', name: 'FreshKon', en: 'FreshKon', origin: '新加坡 · 马来西亚常见',
    series: [
      {
        name: 'Colors Fusion', cycles: { daily: S(14.2, 8.5, 58, 13.3), monthly: S(14.2, 8.6, 55, 13.3) },
        colors: [
          ['Blushing Velvet', 'pink'], ['Brilliant Brown', 'brown'], ['Shimmering Grey', 'grey'],
          ['Perky Brown', 'brown'], ['Misty Grey', 'grey'], ['Warm Hazel', 'amber'],
        ],
      },
      {
        name: 'Alluring Eyes', cycles: { daily: S(14.2, 8.5, 58, 13.3), monthly: S(14.2, 8.6, 55, 13.3) },
        colors: [['Mystical Black', 'black'], ['Winsome Brown', 'brown'], ['Charming Grey', 'grey']],
      },
      {
        name: 'Mosaic', cycles: { monthly: S(14.2, 8.6, 55) },
        colors: [['Charcoal Grey', 'grey'], ['Honey Brown', 'amber'], ['Steel Blue', 'blue']],
      },
    ],
  },
  {
    id: 'bausch', name: '博士伦', en: 'Bausch+Lomb', origin: '美国',
    series: [
      {
        name: '蕾丝明眸 Lacelle', cycles: { daily: S(14.0, 8.6, 59), monthly: S(14.0, 8.6, 38) },
        colors: [['Jewel Black 闪钻黑', 'black'], ['Glam Brown 魅惑棕', 'brown'], ['Gold Brown 金棕', 'amber']],
      },
    ],
  },
  {
    id: 'moody', name: 'Moody', en: 'moody', origin: '中国',
    series: [
      {
        name: 'Moody 美瞳', cycles: { daily: S(14.2, 8.6, 38, 13.6), monthly: S(14.2, 8.6, 38, 13.6), quarterly: S(14.2, 8.6, 38, 13.6), halfyear: S(14.2, 8.6, 38, 13.6) },
        colors: [
          ['丝绒棕', 'brown', ['daily']], ['冷茶棕', 'brown', ['daily']], ['积雨云', 'grey', ['daily']],
          ['冷泡乌龙茶', 'brown', ['halfyear']], ['姜饼果子', 'amber', ['halfyear']],
        ],
      },
    ],
  },
  {
    id: 'kilala', name: '可啦啦', en: 'Kilala', origin: '中国',
    series: [{ name: '可啦啦 美瞳', cycles: { daily: S(14.2, 8.6, 38), halfyear: S(14.2, 8.6, 38), yearly: S(14.2, 8.6, 38) }, colors: [] }],
  },
  {
    id: '4inlook', name: '4iNLOOK', en: '4inlook', origin: '韩国',
    series: [{ name: '4iNLOOK 美瞳', cycles: { daily: S(14.2, 8.6, 38), monthly: S(14.2, 8.6, 38), halfyear: S(14.2, 8.6, 38) }, colors: [] }],
  },
  {
    id: 'lapeche', name: '拉拜诗', en: 'Lapeche', origin: '中国',
    series: [{ name: '拉拜诗 美瞳', cycles: { daily: S(14.2, 8.6, 38), monthly: S(14.2, 8.6, 38), halfyear: S(14.2, 8.6, 38) }, colors: [['新晋 OL', 'brown', ['monthly']], ['好运女孩', 'brown', ['daily']], ['满分团宠', 'brown', ['monthly']], ['一克霓虹', 'mixed'], ['珍珠引力', 'grey'], ['仲夏夜', 'blue']] }],
  },
  {
    id: 'hapakristin', name: 'Hapa Kristin', en: 'Hapa Kristin', origin: '韩国',
    series: [
      { name: 'Pony Kristin', cycles: { daily: S(14.2, 8.7, 45), monthly: S(14.2, 8.6, 45) }, colors: [] },
      { name: 'Cat-titude Kristin', cycles: { daily: S(14.2, 8.7, 45), monthly: S(14.2, 8.6, 45) }, colors: [] },
    ],
  },
  {
    id: 'olens', name: 'OLENS', en: 'OLENS', origin: '韩国',
    series: [
      { name: 'Russian Velvet', cycles: { daily: S(14.2, 8.6, 42), monthly: S(14.2, 8.6, 42) }, colors: [['Russian Velvet Brown', 'brown'], ['Russian Velvet Grey', 'grey']] },
      { name: 'Real Ring', cycles: { daily: S(14.0, 8.6, 42), monthly: S(14.0, 8.6, 42) }, colors: [['Real Ring Black', 'black'], ['Real Ring Brown', 'brown']] },
    ],
  },
  {
    id: 'lensme', name: 'Lensme', en: 'Lensme', origin: '韩国',
    series: [{ name: 'Lensme 美瞳', cycles: { daily: S(14.2, 8.6, 42), monthly: S(14.2, 8.6, 42) }, colors: [] }],
  },
  {
    id: 'ttdeye', name: 'TTDeye', en: 'TTDeye', origin: '中国 · 海外站',
    series: [{ name: 'TTDeye 美瞳', cycles: { daily: S(14.2, 8.6, 38), yearly: S(14.2, 8.6, 38) }, colors: [] }],
  },
  {
    id: 'hydron', name: '海昌', en: 'Hydron', origin: '中国',
    series: [{ name: '海昌 星眸', cycles: { daily: S(14.0, 8.6, 38), monthly: S(14.0, 8.6, 38), halfyear: S(14.0, 8.6, 38) }, colors: [] }],
  },
  // Brands without checked specs: listed so titles split correctly and the picker offers them; specs come from what the user types.
  { id: 'glamup', name: 'Glam Up', en: 'Glam Up', origin: '彩瞳品牌', series: [{ name: 'Glam Up', cycles: { daily: null, monthly: null, halfyear: null, yearly: null }, colors: [['琥珀光', 'amber', ['halfyear']], ['碎云母', 'grey', ['daily']], ['焦糖美式', 'amber', ['halfyear']]] }] },
  { id: 'mermaid', name: '人鱼姬', en: '人鱼姬', origin: '彩瞳品牌', series: [{ name: '人鱼姬', cycles: { daily: null, monthly: null, halfyear: null, yearly: null }, colors: [['黑金胶片', 'black', ['daily']]] }] },
  { id: 'neo', name: 'Neo', en: 'NEO', origin: '韩国', series: [{ name: 'Neo', cycles: { daily: null, monthly: null, halfyear: null, yearly: null }, colors: [['浪漫蓝调', 'blue'], ['鸢尾手记', 'purple']] }] },
  {
    id: 'clear', name: '透明片', en: 'Clear', origin: '通用',
    series: [{ name: '透明隐形眼镜', cycles: { daily: S(14.2, 8.6, 58), '2week': S(14.0, 8.5, 58), monthly: S(14.2, 8.6, 38) }, colors: [['透明', 'clear']] }],
  },
];

export function findBrand(name) {
  const s = String(name || '').trim().toLowerCase();
  return BRANDS.find((b) => b.name.toLowerCase() === s || b.en.toLowerCase() === s || b.id === s) || null;
}

// All colours of a brand: built-in plus learned ones ({brand, series, color, cycle, tone, dia, gdia, bc, water}).
export function colorsFor(brandName, learned) {
  const b = findBrand(brandName);
  const out = [];
  const seen = new Set();
  if (b) {
    for (const se of b.series) {
      for (const [name, tone, cyc, gdia] of se.colors) {
        const cycles = cyc || Object.keys(se.cycles);
        out.push({ name, tone, series: se.name, cycles, gdia: gdia || null, builtIn: true });
        seen.add(name.toLowerCase());
      }
    }
  }
  for (const l of learned || []) {
    if (String(l.brand).toLowerCase() !== String(brandName).toLowerCase()) continue;
    const key = String(l.color).toLowerCase();
    const have = out.find((c) => c.name.toLowerCase() === key);
    if (have) { if (!have.cycles.includes(l.cycle)) have.cycles.push(l.cycle); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: l.color, tone: l.tone || guessTone(l.color), series: l.series || '', cycles: [l.cycle], gdia: l.gdia || null, builtIn: false });
  }
  for (const c of out) c.cycles = CYCLE_KEYS.filter((k) => c.cycles.includes(k));
  return out;
}

// Specs for brand + colour + cycle. Learned values (what the user typed before) win over built-in ones.
export function specFor(brandName, colorName, cycle, learned, seriesName) {
  const mine = (learned || []).find((l) => String(l.brand).toLowerCase() === String(brandName).toLowerCase()
    && String(l.color).toLowerCase() === String(colorName).toLowerCase() && l.cycle === cycle);
  const b = findBrand(brandName);
  let base = null;
  let pack = CYCLES[cycle] ? CYCLES[cycle].pack : 2;
  if (b) {
    const color = colorsFor(brandName, []).find((c) => c.name.toLowerCase() === String(colorName).toLowerCase());
    const se = b.series.find((x) => x.name === (color ? color.series : seriesName) && x.cycles[cycle])
      || b.series.find((x) => x.cycles[cycle]);
    if (se) {
      base = { ...se.cycles[cycle] };
      if (color && color.gdia) base.gdia = color.gdia;
      if (se.packs && se.packs[cycle]) pack = se.packs[cycle];
    }
  }
  if (mine && [mine.dia, mine.gdia, mine.bc, mine.water].some((v) => v !== '' && v != null)) return { dia: mine.dia, gdia: mine.gdia, bc: mine.bc, water: mine.water, pack: mine.pack || pack, from: 'mine' };
  if (base) return { ...base, gdia: base.gdia || null, pack, from: 'ref' };
  return null;
}

export function cyclesFor(brandName, colorName, learned, seriesName) {
  const c = colorsFor(brandName, learned).find((x) => x.name.toLowerCase() === String(colorName).toLowerCase());
  if (c) return c.cycles;
  const b = findBrand(brandName);
  if (b) {
    const se = b.series.find((x) => x.name === seriesName) || null;
    const all = new Set();
    for (const s of se ? [se] : b.series) Object.keys(s.cycles).forEach((k) => all.add(k));
    return CYCLE_KEYS.filter((k) => all.has(k));
  }
  return CYCLE_KEYS;
}

export const CARE_TYPES = {
  solution: { label: '护理液', icon: '🧴', openDays: 90 },
  peroxide: { label: '双氧水护理液', icon: '🫧', openDays: 90 },
  drops: { label: '眼药水/润眼液', icon: '💧', openDays: 28 },
  single: { label: '单支装润眼液', icon: '💧', openDays: 1 },
  case: { label: '镜盒', icon: '🫙', openDays: 90 },
  tool: { label: '镊子/吸棒', icon: '🥢', openDays: 180 },
  other: { label: '其他', icon: '✨', openDays: 0 },
};
