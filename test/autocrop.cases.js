// Synthetic pictures for the auto-crop tests (shared by Lensy and 种草本: keep both copies the same).
// Each case: { name, w, h, px, expect: null | {x,y,w,h} (fractions, ±0.03) }.
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function img(w, h, paint) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y); const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  return px;
}
// "photo": smooth colourful texture with noise; "text": dark strokes on ~18% of a line's pixels.
const photo = (x, y) => [120 + 80 * Math.sin(x / 9) + 30 * rnd(), 90 + 60 * Math.cos(y / 13) + 30 * rnd(), 140 + 50 * Math.sin((x + y) / 17) + 30 * rnd()];
const textRow = (y, top) => (y - top) % 14 < 9; // 9px text lines, 5px spacing
const text = (x, y, top, ink, bg) => (textRow(y, top) && x > 12 && x < 200 && (Math.floor(x / 3) * 7 + y) % 5 === 0 ? ink : bg);

export function cases() {
  const out = [];
  { // 小红书 note, light mode: status bar + header, photo 0.14-0.62, title + text + comment bar below
    const w = 220, h = 476;
    const y0 = Math.round(h * 0.14), y1 = Math.round(h * 0.62);
    const W = [255, 255, 255], K = [34, 34, 34];
    out.push({ name: 'xhs note (light)', w, h, expect: { x: 0, y: y0 / h, w: 1, h: (y1 - y0) / h }, px: img(w, h, (x, y) => {
      if (y < 14) return text(x, y, 2, K, W);
      if (y < y0) return (x > 10 && x < 34 && y > 26 && y < 50) ? [200, 150, 120] : (x > 160 && x < 205 && y > 30 && y < 46) ? [255, 36, 66] : text(x, y, 32, K, W);
      if (y < y1) return photo(x, y);
      if (y < y1 + 10) return (x > 100 && x < 120 && (x % 6) < 3 && y > y1 + 3 && y < y1 + 7) ? [255, 36, 66] : W; // carousel dots
      return text(x, y, y1 + 14, K, W);
    }) });
  }
  { // 小红书 dark mode
    const w = 220, h = 476;
    const y0 = 70, y1 = 330;
    const B = [18, 18, 18], L = [230, 230, 230];
    out.push({ name: 'xhs note (dark)', w, h, expect: { x: 0, y: y0 / h, w: 1, h: (y1 - y0) / h }, px: img(w, h, (x, y) => (y >= y0 && y < y1 ? photo(x, y) : text(x, y, 4, L, B))) });
  }
  { // screenshot of a landscape photo in the Photos app: black bars, white status text
    const w = 220, h = 476;
    const y0 = 160, y1 = 306;
    out.push({ name: 'black bars', w, h, expect: { x: 0, y: y0 / h, w: 1, h: (y1 - y0) / h }, px: img(w, h, (x, y) => (y >= y0 && y < y1 ? photo(x, y) : y < 14 ? text(x, y, 2, [255, 255, 255], [0, 0, 0]) : [0, 0, 0])) });
  }
  { // a 3:4 photo with black bars left and right (not a screenshot shape)
    const w = 220, h = 160;
    out.push({ name: 'pillarbox', w, h, expect: { x: 50 / w, y: 0, w: 120 / w, h: 1 }, px: img(w, h, (x, y) => (x >= 50 && x < 170 ? photo(x, y) : [0, 0, 0])) });
  }
  { // ordinary portrait photo, 3:4: keep
    const w = 165, h = 220;
    out.push({ name: 'normal photo', w, h, expect: null, px: img(w, h, photo) });
  }
  { // tall photo whose top third is overcast sky (pale, uniform-ish): not an app screen, keep
    const w = 220, h = 476;
    out.push({ name: 'tall photo with sky', w, h, expect: null, px: img(w, h, (x, y) => (y < 160 ? [236 + 6 * rnd(), 238 + 6 * rnd(), 240 + 6 * rnd()] : photo(x, y))) });
  }
  { // tall photo, top 45% plain pale sky: no text anywhere, so not an app screen: keep
    const w = 220, h = 476;
    out.push({ name: 'tall photo, big plain sky', w, h, expect: null, px: img(w, h, (x, y) => (y < 214 ? [238, 240, 244] : photo(x, y))) });
  }
  { // product photo on white inside a screenshot: the white inside the photo must not split it
    const w = 220, h = 476;
    const y0 = 90, y1 = 350;
    out.push({ name: 'photo with a white stripe', w, h, expect: { x: 0, y: y0 / h, w: 1, h: (y1 - y0) / h }, px: img(w, h, (x, y) => (y >= y0 && y < y1 ? (y > 200 && y < 206 ? [255, 255, 255] : photo(x, y)) : text(x, y, 6, [30, 30, 30], [255, 255, 255]))) });
  }
  { // nail photo on a plain pink backdrop (rows of one colour) inside a 小红书 screenshot: keep the whole photo
    const w = 220, h = 476;
    const y0 = 60, y1 = 340;
    out.push({ name: 'plain backdrop in the photo', w, h, expect: { x: 0, y: y0 / h, w: 1, h: (y1 - y0) / h }, px: img(w, h, (x, y) => (y >= y0 && y < y1 ? (y < 200 ? [240 - (y - y0) / 4, 170, 180] : photo(x, y)) : text(x, y, 6, [30, 30, 30], [255, 255, 255]))) });
  }
  { // only text (a chat screenshot): nothing that looks like a photo, keep
    const w = 220, h = 476;
    out.push({ name: 'text only', w, h, expect: null, px: img(w, h, (x, y) => text(x, y, 3, [20, 20, 20], [255, 255, 255])) });
  }
  return out;
}

export const near = (a, b) => (a === null || b === null ? a === b : ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.03));
