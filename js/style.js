// Style & makeup suggestions for a lens, worked out on the phone from its colour family, size and name,
// plus ready-made Xiaohongshu (小红书) searches for real try-on photos and makeup notes.
import { TONES } from './catalog.js';

const P = (name, hex) => ({ name, hex });

const BASE = {
  black: {
    vibe: ['清澈有神', '黑白分明', '学生感', '伪素颜'],
    eye: [P('奶咖', '#b89578'), P('浅杏', '#e7c6a5'), P('珠光香槟', '#efdcc0')],
    liner: '深棕或黑色眼线，眼尾平拉 2mm，突出眼神的清澈感',
    lash: '根根分明的自然卷翘，不需要太浓',
    blush: P('蜜桃粉', '#f2a99a'), lip: P('豆沙/水光红棕', '#b9675e'),
    brow: '自然黑灰或深棕，野生眉',
    scenes: ['上学', '上班通勤', '面试', '日常'],
    hair: '黑发、深棕发都很搭', outfit: '白衬衫、针织开衫等干净简约的穿搭',
    tip: '黑色系最显“眼睛大又亮”，适合想要美瞳但不想被看出来的日子',
  },
  brown: {
    vibe: ['温柔', '自然放大', '奶茶系', '日常通勤'],
    eye: [P('奶茶棕', '#b48a6a'), P('焦糖', '#c27a46'), P('杏色', '#e9c8a8')],
    liner: '棕色眼线 + 眼尾下垂延长，显得更无辜温柔',
    lash: '棕色睫毛膏会更柔和',
    blush: P('奶杏/肉桂', '#e2a383'), lip: P('奶茶红棕', '#b7695a'),
    brow: '浅棕色眉，和瞳色呼应',
    scenes: ['上班通勤', '约会', '逛街', '拍照'],
    hair: '茶棕、栗棕、奶茶色头发很协调', outfit: '大地色、燕麦色、针织/风衣',
    tip: '棕色系对素颜和全妆都友好，是最稳的一类',
  },
  amber: {
    vibe: ['光泽感', '异域', '暖调高级', '日落感'],
    eye: [P('金棕', '#b8823e'), P('铜色', '#b0633a'), P('香槟金闪', '#e8cf98')],
    liner: '咖啡色眼线，眼尾微微上挑',
    lash: '浓密卷翘的睫毛衬托琥珀色的透光感',
    blush: P('橘调蜜桃', '#f0a070'), lip: P('焦糖橘棕', '#c26e48'),
    brow: '暖棕色眉',
    scenes: ['约会', '度假', '拍照', '派对'],
    hair: '焦糖色、蜜茶色、亚麻棕', outfit: '暖色系、复古风、度假碎花',
    tip: '在阳光下特别透亮，户外拍照很出片',
  },
  grey: {
    vibe: ['清冷', '混血感', '高级', '甜酷'],
    eye: [P('灰棕', '#9a8a80'), P('雾霾紫', '#a497ad'), P('银灰闪', '#d6d6dc')],
    liner: '灰黑色眼线，眼尾平拉或小上挑，营造冷感',
    lash: '下睫毛可以画几根，增加洋娃娃感',
    blush: P('冷调玫瑰', '#d99aa4'), lip: P('冷莓/玫瑰豆沙', '#a65a6c'),
    brow: '灰棕色眉，不要太黑',
    scenes: ['拍照', '约会', '派对', '演唱会'],
    hair: '冷棕、亚麻灰、黑长直都很有氛围', outfit: '黑白灰、皮衣、冷色系穿搭',
    tip: '灰色在暖光下会偏暖、冷光下更灰，拍照前在不同光线下试试',
  },
  blue: {
    vibe: ['混血', '洋娃娃', '夏日', '元气'],
    eye: [P('冰蓝闪', '#bcd3ea'), P('浅香槟', '#f0dfc6'), P('雾粉', '#e9c4c9')],
    liner: '棕色细眼线即可，避免太浓抢了瞳色',
    lash: '卷翘的下睫毛 + 卧蚕提亮',
    blush: P('冷调粉', '#efaab8'), lip: P('水光粉/樱桃', '#d7677e'),
    brow: '浅棕/灰棕色眉',
    scenes: ['旅行', '漫展/cos', '拍照', '夏日活动'],
    hair: '浅色发、亚麻色、金发效果最好', outfit: '白色、牛仔、海边度假风',
    tip: '蓝色比较显眼，日常通勤建议选着色直径小、花纹淡的款',
  },
  green: {
    vibe: ['森系', '异域', '复古', '神秘'],
    eye: [P('橄榄绿', '#8a8a5a'), P('大地棕', '#a07c5c'), P('金闪', '#e6cf8f')],
    liner: '橄榄或深棕眼线',
    lash: '自然浓密',
    blush: P('杏橘', '#eba582'), lip: P('砖红/枫叶红', '#a8513f'),
    brow: '暖棕色眉',
    scenes: ['旅行', '拍照', '复古主题', '漫展/cos'],
    hair: '红棕、焦糖、深棕', outfit: '复古、森系、大地色',
    tip: '绿色配暖调妆容最自然，冷调妆容会显得眼神突兀',
  },
  pink: {
    vibe: ['甜美', '少女', '梦幻', '元气'],
    eye: [P('樱花粉', '#f2bfc8'), P('奶白珠光', '#f6e9e4'), P('蜜桃', '#f3b49c')],
    liner: '粉棕色眼线，下眼尾画三角提亮',
    lash: '自然卷翘，可以贴小簇假睫毛',
    blush: P('草莓粉', '#f39aae'), lip: P('水光粉', '#e97e93'),
    brow: '浅棕色眉',
    scenes: ['约会', '拍照', '漫展/cos', '节日'],
    hair: '浅色发、粉棕色', outfit: '甜美风、蕾丝、粉白色系',
    tip: '粉色瞳色适合眼妆干净一点，重点放在腮红和唇上',
  },
  purple: {
    vibe: ['梦幻', '神秘', '高级冷感', '二次元'],
    eye: [P('香芋紫', '#b8a3cf'), P('雾灰紫', '#a8a0b4'), P('银闪', '#dcd9e4')],
    liner: '灰紫或深棕眼线',
    lash: '浓密卷翘',
    blush: P('冷粉', '#e2a1b8'), lip: P('莓果紫红', '#9c4f72'),
    brow: '灰棕色眉',
    scenes: ['派对', '拍照', '漫展/cos', '演唱会'],
    hair: '冷色系、黑发', outfit: '紫色/黑色系、亮片、街头风',
    tip: '紫色在室内光线下比较低调，户外会更明显',
  },
  mixed: {
    vibe: ['混血感', '立体', '欧美', '有神'],
    eye: [P('大地棕', '#9c7458'), P('暖橘棕', '#c27b54'), P('高光香槟', '#efdcbf')],
    liner: '眼尾上扬的猫眼线，下眼线后 1/3 晕染',
    lash: '浓密的小簇睫毛',
    blush: P('橘棕修容感', '#d48e74'), lip: P('砖红/红棕', '#a9533f'),
    brow: '有眉峰的标准眉',
    scenes: ['拍照', '派对', '旅行', '约会'],
    hair: '大波浪、深棕/焦糖', outfit: '欧美风、小黑裙、复古',
    tip: '多色花纹在近距离很立体，配一点鼻影和修容效果更好',
  },
  clear: {
    vibe: ['素颜', '原生感'],
    eye: [P('大地色', '#b08f75')], liner: '按照平时的眼妆即可', lash: '自然',
    blush: P('奶杏', '#e6aa8c'), lip: P('日常色', '#c27a6e'), brow: '自然眉',
    scenes: ['日常', '运动', '上班'], hair: '不限', outfit: '不限',
    tip: '透明片只矫正视力，不改变瞳色',
  },
};

const KEYWORDS = [
  [/茶|乌龙|奶|可可|巧克力|焦糖|拿铁|咖啡|mocha|latte|choco/i, '奶茶温柔系', '妆容走“奶茶妆”：低饱和棕色眼影 + 奶茶唇色，整体同色系最高级'],
  [/冰|雾|霜|月|银|雪|cool|misty|grey|gray/i, '清冷感', '试试“清冷妆”：眼影少量带过，重点放在干净的底妆和冷调唇色'],
  [/蜜|糖|桃|莓|甜|honey|sweet|peach|blush/i, '甜妹', '适合“甜妹妆”：卧蚕提亮 + 腮红打在眼下，笑起来特别甜'],
  [/星|闪|钻|光|shine|sparkle|shimmer|bright|glow|jewel/i, 'bling 闪闪', '可以在眼头/卧蚕加一点细闪，和镜片的光泽呼应'],
  [/混血|russian|velvet|欧美|hazel/i, '混血感', '加深眼窝、画一点鼻影，混血效果会更明显'],
  [/黑|墨|曜|accent|black/i, '有神黑眸', '眼线不用太粗，黑色本身就很有神'],
  [/姜饼|圣诞|派对|party/i, '节日氛围', '节日可以试试金棕色亮片眼影'],
];

function sizeNote(l) {
  const g = Number(l.gdia) || null;
  const d = Number(l.dia) || null;
  if (g) {
    if (g <= 13.0) return { tag: '小直径 · 自然无痕', note: `着色直径 ${g}mm，几乎看不出戴了美瞳，适合上班、上课等需要低调的场合` };
    if (g <= 13.5) return { tag: '微放大 · 日常', note: `着色直径 ${g}mm，放大得刚刚好，日常和拍照都不夸张` };
    if (g <= 13.9) return { tag: '明显放大 · 有神', note: `着色直径 ${g}mm，眼睛会明显变大，内眼线画淡一点，避免眼神显得呆` };
    return { tag: '大直径 · 女团/拍照', note: `着色直径 ${g}mm，放大效果强，适合拍照、舞台妆，日常可能稍显夸张` };
  }
  if (d) {
    if (d <= 14.0) return { tag: '自然款', note: `直径 ${d}mm，自然不夸张` };
    if (d <= 14.2) return { tag: '微放大', note: `直径 ${d}mm，适度放大的常见尺寸` };
    return { tag: '放大款', note: `直径 ${d}mm，放大效果较明显` };
  }
  return null;
}

export function suggest(l) {
  const tone = BASE[l.tone] ? l.tone : 'brown';
  const b = BASE[tone];
  const name = `${l.color || ''} ${l.series || ''}`;
  const tags = [...b.vibe];
  const extra = [];
  for (const [re, tag, tip] of KEYWORDS) if (re.test(name)) { if (!tags.includes(tag)) tags.unshift(tag); extra.push(tip); }
  const size = sizeNote(l);
  if (size) tags.push(size.tag);
  const formula = `${b.eye[0].name}眼影 + ${b.blush.name}腮红 + ${b.lip.name}唇`;
  return {
    tone,
    toneLabel: TONES[tone].label,
    tags: tags.slice(0, 6),
    formula,
    makeup: [
      { k: '眼影', palette: b.eye },
      { k: '眼线', text: b.liner },
      { k: '睫毛', text: b.lash },
      { k: '腮红', palette: [b.blush] },
      { k: '唇色', palette: [b.lip] },
      { k: '眉毛', text: b.brow },
    ],
    scenes: b.scenes,
    hair: b.hair,
    outfit: b.outfit,
    tips: [size && size.note, ...extra, b.tip].filter(Boolean),
    searches: xhsSearches(l, tags),
  };
}

export function xhsSearches(l, tags) {
  const brand = (l.brand || '').replace(/透明片/, '');
  const color = (l.color || '').replace(/\s+/g, ' ').trim();
  const short = color.split(' ').find((w) => /[一-龥]/.test(w)) || color;
  const tone = TONES[l.tone] ? TONES[l.tone].label.split('/')[0] : '';
  const list = [
    { label: '上眼图', q: `${brand} ${short} 上眼`.trim() },
    { label: '妆容搭配', q: `${brand} ${short} 妆容`.trim() },
    { label: '同色系推荐', q: `${tone}美瞳 ${(tags && tags[0]) || ''} 妆容`.trim() },
  ];
  return list.map((x) => ({ ...x, app: xhsApp(x.q), web: xhsWeb(x.q) }));
}

export const xhsApp = (q) => `xhsdiscover://search/result?keyword=${encodeURIComponent(q)}`;
export const xhsWeb = (q) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}&source=web_search_result_notes`;
