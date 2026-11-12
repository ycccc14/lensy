/**
 * Lensy Push — sends Lensy's reminders to the phone even when the app is closed (Web Push, iOS 16.4+
 * Home Screen apps and Android Chrome).
 *
 * How it works:
 *  - The phone works out its upcoming reminders (date + time + text) and sends the list here with
 *    `sync` whenever something changes. Nothing else about the lenses is sent.
 *  - A timed job (tick) runs every 15 minutes. Each reminder whose time has come goes into that
 *    phone's inbox and an empty push is sent. The phone's service worker then fetches its inbox
 *    (`inbox`) and shows the notifications, so Apple/Google's push service never sees the text and
 *    no payload encryption is needed. Pushes are signed with this project's VAPID key (P-256 below).
 *  - Each phone is identified by a random id + secret it made itself; only a hash of the secret is
 *    kept here.
 *
 * One-time setup (needs the owner): deploy as a web app (Execute as: Me, Who has access: Anyone),
 * then run `setup` once from the editor to create the 15-minute job. The job also creates itself
 * on the first `sync`.
 */

const SUBJECT = 'https://ycccc14.github.io/lensy/'; // VAPID contact
const DEV = 'DEV_'; // + device id → { h, endpoint, items, sent, inbox, seen }
const MAX_DEVICES = 20;
const MAX_ITEMS = 60;
const PROP_BYTES = 8600; // one Script Property holds 9 kB
const CATCH_UP_MS = 6 * 3600 * 1000; // a reminder missed by a late run is still sent within 6 hours
const TICK_MINUTES = 15;
const TRIGGER_VERSION = '1';

// ======================================================================
// Web app
// ======================================================================

function doGet() {
  return json_({ ok: true, app: 'lensy-push', key: keys_().pub });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  try {
    return json_({ ok: true, result: route_(body) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(b) {
  if (b.fn === 'key') return keys_().pub;
  const id = String(b.id || '');
  const secret = String(b.secret || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || secret.length < 20 || secret.length > 128) throw new Error('bad device');
  const h = sha256Hex_(secret);

  if (b.fn === 'sync') {
    const dev = withLock_(() => {
      let d = read_(id);
      if (d && d.h !== h) throw new Error('wrong secret');
      if (!d) {
        if (deviceIds_().length >= MAX_DEVICES) throw new Error('too many devices');
        d = { h, endpoint: '', items: [], sent: {}, inbox: [] };
      }
      if (b.endpoint !== undefined) {
        const ep = String(b.endpoint || '');
        if (ep && !/^https:\/\/[^\s]+$/.test(ep)) throw new Error('bad endpoint');
        d.endpoint = ep;
      }
      d.items = cleanItems_(b.items, Date.now());
      d.seen = Date.now();
      write_(id, d);
      return d;
    });
    ensureTrigger_();
    return { items: dev.items.length, next: dev.items.length ? dev.items[0].at : null, push: !!dev.endpoint };
  }

  if (b.fn === 'inbox') {
    return withLock_(() => {
      const d = read_(id);
      if (!d || d.h !== h) return { messages: [] };
      const messages = d.inbox || [];
      d.inbox = [];
      write_(id, d);
      return { messages };
    });
  }

  if (b.fn === 'test') {
    const d = withLock_(() => {
      const x = read_(id);
      if (!x || x.h !== h) throw new Error('这台手机还没开启通知');
      if (!x.endpoint) throw new Error('这台手机还没开启通知');
      x.inbox = (x.inbox || []).concat({ key: 'test', title: '🔔 Lensy 通知测试', body: '收到这条就说明通知正常，App 关着也会提醒你～', url: '#me', at: Date.now() }).slice(-8);
      write_(id, x);
      return x;
    });
    const res = sendPush_(d.endpoint);
    if (res === 'gone') {
      withLock_(() => { const x = read_(id); if (x) { x.endpoint = ''; write_(id, x); } });
      throw new Error('手机的通知订阅已失效，请关闭再重新开启通知');
    }
    if (res !== 'ok') throw new Error('推送服务暂时没有回应（' + res + '），稍后再试');
    return { sent: 1 };
  }

  if (b.fn === 'off') {
    withLock_(() => {
      const d = read_(id);
      if (d && d.h === h) PropertiesService.getScriptProperties().deleteProperty(DEV + id);
    });
    return { off: true };
  }

  throw new Error('unknown fn');
}

/** Keeps well-formed reminders from a day ago to 120 days ahead, soonest first, within the size limit. */
function cleanItems_(list, now) {
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const out = (Array.isArray(list) ? list : []).map(x => ({
    key: str(x && x.key, 80), at: Number(x && x.at), title: str(x && x.title, 60), body: str(x && x.body, 120), url: str(x && x.url, 60),
  })).filter(x => x.key && x.title && isFinite(x.at) && x.at > now - 24 * 3600 * 1000 && x.at < now + 120 * 24 * 3600 * 1000);
  out.sort((a, b) => a.at - b.at);
  return out.slice(0, MAX_ITEMS);
}

// ======================================================================
// Timed job
// ======================================================================

/** Run once from the editor: authorises the project and creates the 15-minute job. */
function setup() {
  keys_();
  PropertiesService.getScriptProperties().deleteProperty('TRIGGER_VERSION');
  ensureTrigger_();
  console.log('Lensy Push is ready. Devices: ' + deviceIds_().length);
}

function ensureTrigger_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TRIGGER_VERSION') === TRIGGER_VERSION) return;
  withLock_(() => {
    if (props.getProperty('TRIGGER_VERSION') === TRIGGER_VERSION) return;
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'tick').forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('tick').timeBased().everyMinutes(TICK_MINUTES).create();
    props.setProperty('TRIGGER_VERSION', TRIGGER_VERSION);
  });
}

/** Every 15 minutes: moves due reminders into each phone's inbox and pushes it. */
function tick() {
  tickAt_(Date.now());
}

function tickAt_(now) {
  const toPush = [];
  withLock_(() => {
    deviceIds_().forEach(id => {
      const d = read_(id);
      if (!d) return;
      // A phone that hasn't opened Lensy for 120 days is forgotten.
      if (d.seen && now - d.seen > 120 * 24 * 3600 * 1000) { PropertiesService.getScriptProperties().deleteProperty(DEV + id); return; }
      const sent = d.sent || {};
      const due = (d.items || []).filter(x => x.at <= now && x.at > now - CATCH_UP_MS && !sent[x.key + '@' + x.at]);
      Object.keys(sent).forEach(k => { if (now - sent[k] > 3 * 24 * 3600 * 1000) delete sent[k]; });
      if (!due.length) { if (Object.keys(sent).length !== Object.keys(d.sent || {}).length) { d.sent = sent; write_(id, d); } return; }
      due.forEach(x => { sent[x.key + '@' + x.at] = now; });
      d.sent = sent;
      d.items = d.items.filter(x => x.at > now);
      const fresh = (d.inbox || []).filter(m => now - m.at < 2 * 24 * 3600 * 1000 && !due.some(x => x.key === m.key));
      d.inbox = fresh.concat(due.map(x => ({ key: x.key, title: x.title, body: x.body, url: x.url, at: now }))).slice(-8);
      write_(id, d);
      if (d.endpoint) toPush.push({ id, endpoint: d.endpoint });
    });
  });
  if (!toPush.length) return 0;
  const results = sendPushAll_(toPush.map(x => x.endpoint));
  const gone = toPush.filter((x, i) => results[i] === 'gone');
  if (gone.length) {
    withLock_(() => gone.forEach(x => { const d = read_(x.id); if (d) { d.endpoint = ''; write_(x.id, d); } }));
  }
  return results.filter(r => r === 'ok').length;
}

// ======================================================================
// Storage
// ======================================================================

function deviceIds_() {
  return PropertiesService.getScriptProperties().getKeys().filter(k => k.indexOf(DEV) === 0).map(k => k.slice(DEV.length));
}

function read_(id) {
  const raw = PropertiesService.getScriptProperties().getProperty(DEV + id);
  return raw ? JSON.parse(raw) : null;
}

/** Saves a device, dropping the latest reminders if the record would not fit in one property. */
function write_(id, d) {
  let s = JSON.stringify(d);
  while (utf8Len_(s) > PROP_BYTES && d.items && d.items.length) {
    d.items = d.items.slice(0, Math.max(0, Math.floor(d.items.length * 0.8)));
    s = JSON.stringify(d);
  }
  while (utf8Len_(s) > PROP_BYTES && d.inbox && d.inbox.length) {
    d.inbox = d.inbox.slice(1);
    s = JSON.stringify(d);
  }
  PropertiesService.getScriptProperties().setProperty(DEV + id, s);
}

function utf8Len_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function sha256Hex_(s) {
  return pushBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8))
    .map(b => (b < 16 ? '0' : '') + b.toString(16)).join('');
}

// ======================================================================
// Sending
// ======================================================================

/** 'ok' | 'gone' (the phone unsubscribed or the app was removed) | the HTTP status. */
function sendPush_(endpoint) {
  return sendPushAll_([endpoint])[0];
}

function sendPushAll_(endpoints) {
  const keys = keys_();
  const responses = UrlFetchApp.fetchAll(endpoints.map(endpoint => ({
    url: endpoint, method: 'post', payload: '', muteHttpExceptions: true,
    headers: { Authorization: 'vapid t=' + jwt_(endpoint, keys) + ', k=' + keys.pub, TTL: '86400', Urgency: 'high' },
  })));
  return responses.map((res, i) => {
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return 'ok';
    if (code === 404 || code === 410) return 'gone';
    console.warn('Push failed: ' + code + ' ' + res.getContentText().slice(0, 200) + ' ' + endpoints[i].slice(0, 40));
    return String(code);
  });
}

// ======================================================================
// VAPID: P-256 keys and ES256-signed tokens (same code as the ZR & YC finance tracker's Push.gs)
// ======================================================================

/** The project's VAPID key pair, created once with Google's secure random UUIDs. */
function keys_() {
  const props = PropertiesService.getScriptProperties();
  let d = props.getProperty('VAPID_D');
  let pub = props.getProperty('VAPID_PUB');
  if (!d || !pub) {
    withLock_(() => {
      d = props.getProperty('VAPID_D');
      pub = props.getProperty('VAPID_PUB');
      if (d && pub) return;
      const seed = [1, 2, 3, 4].map(() => Utilities.getUuid()).join('');
      const ec = p256_();
      const k = ec.mod(ec.fromBytes(pushBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed))), ec.n - ec.one) + ec.one;
      d = k.toString(16);
      pub = pushB64_(ec.publicKey(k));
      props.setProperty('VAPID_D', d);
      props.setProperty('VAPID_PUB', pub);
    });
  }
  return { d: BigInt('0x' + d), pub };
}

/** A signed VAPID token for the push service at this endpoint, reused for up to 6 hours. */
function jwt_(endpoint, keys) {
  const aud = endpoint.match(/^https:\/\/[^/]+/)[0];
  const cache = CacheService.getScriptCache();
  const hit = cache.get('vapid-' + aud);
  if (hit) return hit;
  const enc = obj => pushB64_(pushBytes_(Utilities.newBlob(JSON.stringify(obj)).getBytes()));
  const input = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT });
  const sig = p256_().sign(keys.d, pushBytes_(Utilities.newBlob(input).getBytes()), pushHmac_);
  const token = input + '.' + pushB64_(sig);
  cache.put('vapid-' + aud, token, 21600);
  return token;
}

/** Apps Script byte arrays are signed (-128…127); the maths below uses 0…255. */
function pushBytes_(bytes) {
  return Array.prototype.map.call(bytes, b => b & 255);
}

function pushB64_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes.map(b => (b > 127 ? b - 256 : b))).replace(/=+$/, '');
}

function pushHmac_(key, data) {
  const signed = a => a.map(b => (b > 127 ? b - 256 : b));
  return pushBytes_(Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, signed(data), signed(key)));
}

/**
 * NIST P-256 with BigInt: public keys and ECDSA signatures (deterministic k, RFC 6979), enough for
 * VAPID. Checked against Node's crypto and the RFC 6979 test vector in test/push-server.test.js.
 */
function p256_() {
  if (p256_.lib) return p256_.lib;
  const [N0, N1, N2, N3, N4, N8] = [0, 1, 2, 3, 4, 8].map(BigInt);
  const p = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
  const n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const G = [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
    BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'), N1];
  const mod = (a, m) => ((a % m) + m) % m;
  const inv = (a, m) => {
    let [r0, r1, s0, s1] = [mod(a, m), m, N1, N0];
    while (r1 !== N0) {
      const q = r0 / r1;
      [r0, r1] = [r1, r0 - q * r1];
      [s0, s1] = [s1, s0 - q * s1];
    }
    return mod(s0, m);
  };
  // Jacobian coordinates; null is the point at infinity. a = -3.
  const dbl = P => {
    if (!P || P[1] === N0) return null;
    const [X, Y, Z] = P;
    const delta = mod(Z * Z, p);
    const gamma = mod(Y * Y, p);
    const beta = mod(X * gamma, p);
    const alpha = mod(N3 * (X - delta) * (X + delta), p);
    const X3 = mod(alpha * alpha - N8 * beta, p);
    return [X3, mod(alpha * (N4 * beta - X3) - N8 * gamma * gamma, p), mod((Y + Z) * (Y + Z) - gamma - delta, p)];
  };
  const add = (P, Q) => {
    if (!P) return Q;
    if (!Q) return P;
    const Z1Z1 = mod(P[2] * P[2], p);
    const Z2Z2 = mod(Q[2] * Q[2], p);
    const U1 = mod(P[0] * Z2Z2, p);
    const U2 = mod(Q[0] * Z1Z1, p);
    const S1 = mod(P[1] * Q[2] * Z2Z2, p);
    const S2 = mod(Q[1] * P[2] * Z1Z1, p);
    if (U1 === U2) return S1 === S2 ? dbl(P) : null;
    const H = mod(U2 - U1, p);
    const R = mod(S2 - S1, p);
    const H2 = mod(H * H, p);
    const H3 = mod(H * H2, p);
    const X3 = mod(R * R - H3 - N2 * U1 * H2, p);
    return [X3, mod(R * (U1 * H2 - X3) - S1 * H3, p), mod(H * P[2] * Q[2], p)];
  };
  const mul = (k, P) => {
    let R = null;
    for (let i = k.toString(2), j = 0; j < i.length; j++) {
      R = dbl(R);
      if (i[j] === '1') R = add(R, P);
    }
    return R;
  };
  const affine = P => {
    const zi = inv(P[2], p);
    return [mod(P[0] * zi * zi, p), mod(P[1] * zi * zi * zi, p)];
  };
  const toBytes = x => {
    const hex = x.toString(16).padStart(64, '0');
    const out = [];
    for (let i = 0; i < 64; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  };
  const fromBytes = b => BigInt('0x' + (b.map(x => x.toString(16).padStart(2, '0')).join('') || '0'));
  const sha256 = bytes => pushBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.map(b => (b > 127 ? b - 256 : b))));

  /** Uncompressed public key: 0x04 ‖ x ‖ y (65 bytes). */
  const publicKey = d => {
    const [x, y] = affine(mul(d, G));
    return [4].concat(toBytes(x), toBytes(y));
  };

  /** ECDSA-SHA256 signature r ‖ s (64 bytes), k from RFC 6979 using hmac(key, data). */
  const sign = (d, message, hmac) => {
    const h = mod(fromBytes(sha256(message)), n);
    const x = toBytes(d);
    const h1 = toBytes(h);
    let V = new Array(32).fill(1);
    let K = new Array(32).fill(0);
    K = hmac(K, V.concat([0], x, h1));
    V = hmac(K, V);
    K = hmac(K, V.concat([1], x, h1));
    V = hmac(K, V);
    for (;;) {
      V = hmac(K, V);
      const k = fromBytes(V);
      if (k > N0 && k < n) {
        const r = mod(affine(mul(k, G))[0], n);
        const s = mod(inv(k, n) * (h + r * d), n);
        if (r !== N0 && s !== N0) return toBytes(r).concat(toBytes(s));
      }
      K = hmac(K, V.concat([0]));
      V = hmac(K, V);
    }
  };

  p256_.lib = { n, one: N1, mod, fromBytes, publicKey, sign };
  return p256_.lib;
}
