// Tests server/Code.gs (Lensy Push, Google Apps Script) in Node with stand-ins for Google's services.
//   node test/push-server.test.js
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
let passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('FAIL', msg); } };

const signed = (b) => Array.from(b).map((x) => (x > 127 ? x - 256 : x));
const buf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(Array.from(v).map((x) => x & 255)));
const props = {};
const cache = {};
const fetched = [];
let pushStatus = 200;
const triggers = [];
const context = {
  console: { log() {}, warn() {} },
  BigInt, JSON, Math, Date, Array, Object, String, Number, isFinite,
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { if (Buffer.byteLength(String(v)) > 9216) throw new Error('Argument too large: value'); props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
    getKeys: () => Object.keys(props),
  }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, MacAlgorithm: { HMAC_SHA_256: 'hmac' }, Charset: { UTF_8: 'utf8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, v) => signed(crypto.createHash('sha256').update(buf(v)).digest()),
    computeHmacSignature: (alg, value, key) => signed(crypto.createHmac('sha256', buf(key)).update(buf(value)).digest()),
    base64EncodeWebSafe: (v) => buf(v).toString('base64').replace(/[+]/g, '-').replace(/[/]/g, '_'),
    newBlob: (str) => ({ getBytes: () => signed(Buffer.from(str, 'utf8')) }),
  },
  UrlFetchApp: { fetchAll: (reqs) => reqs.map((r) => { fetched.push(r); return { getResponseCode: () => pushStatus, getContentText: () => '' }; }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.map((h) => ({ getHandlerFunction: () => h })),
    deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t.getHandlerFunction()), 1); },
    newTrigger: (h) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push(h) }) }) }),
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'server/Code.gs'), 'utf8') + '\nthis.__G = { doGet, doPost, tickAt_, keys_, p256_, pushHmac_, jwt_, cleanItems_, setup };', context);
const G = context.__G;
const post = (body) => JSON.parse(G.doPost({ postData: { contents: JSON.stringify(body) } }).text);

// ---------- VAPID crypto ----------
const ec = G.p256_();
const d0 = BigInt('0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721');
const sig0 = Buffer.from(ec.sign(d0, Array.from(Buffer.from('sample')), G.pushHmac_)).toString('hex').toUpperCase();
ok(sig0 === 'EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8', 'P-256 signature matches the RFC 6979 test vector');
const keys = G.keys_();
const pubBuf = Buffer.from(keys.pub, 'base64url');
ok(pubBuf.length === 65 && pubBuf[0] === 4 && G.keys_().pub === keys.pub, 'VAPID key pair made once (65-byte public key)');
const nodeKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pubBuf.subarray(1, 33).toString('base64url'), y: pubBuf.subarray(33).toString('base64url') }, format: 'jwk' });
const jwt = G.jwt_('https://web.push.apple.com/abc', keys);
const [h64, p64, s64] = jwt.split('.');
ok(crypto.verify('sha256', Buffer.from(h64 + '.' + p64), { key: nodeKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url')), 'VAPID token signature verifies with Node crypto');
const claims = JSON.parse(Buffer.from(p64, 'base64url').toString());
ok(claims.aud === 'https://web.push.apple.com' && claims.sub.startsWith('https://') && claims.exp > Date.now() / 1000, 'VAPID claims: aud = push origin, https subject, future expiry');

// ---------- API ----------
ok(JSON.parse(G.doGet().text).key === keys.pub, 'GET shows the public key');
ok(post({ fn: 'key' }).result === keys.pub, 'fn key returns the public key');
const id = 'dev_' + crypto.randomBytes(12).toString('hex');
const secret = crypto.randomBytes(24).toString('base64url');
const now = Date.now();
const items = [
  { key: 'soak:p1:2026-01-02', at: now + 3600e3, title: '🫧 新晋 OL 该换护理液了', body: '每 3 天换一次', url: '#lens/x' },
  { key: 'end:p1', at: now + 7200e3, title: '⏳ 今天到期', body: '请丢弃', url: '#home' },
  { key: 'old', at: now - 3 * 86400e3, title: 'too old', body: '', url: '' },
  { key: '', at: now + 10, title: 'no key' },
];
let r = post({ fn: 'sync', id, secret, endpoint: 'https://web.push.apple.com/QK-abc', items });
ok(r.ok && r.result.items === 2 && r.result.push === true, 'sync saves the phone and keeps only valid upcoming reminders');
ok(triggers.filter((t) => t === 'tick').length === 1, 'sync creates the 15-minute job once');
post({ fn: 'sync', id, secret, items });
ok(triggers.length === 1, 'the job is not created twice');
ok(!JSON.stringify(props).includes(secret), 'the secret itself is never stored');
r = post({ fn: 'sync', id, secret: 'x'.repeat(30), items: [] });
ok(!r.ok && /secret/.test(r.error), 'a wrong secret is refused');
ok(!post({ fn: 'sync', id: 'short', secret, items: [] }).ok, 'a malformed device id is refused');
ok(!post({ fn: 'sync', id, secret, endpoint: 'http://evil', items }).ok, 'a non-https endpoint is refused');

// Nothing due yet.
fetched.length = 0;
ok(G.tickAt_(now) === 0 && fetched.length === 0, 'tick sends nothing before a reminder is due');
// First one due.
ok(G.tickAt_(now + 3600e3 + 60e3) === 1 && fetched.length === 1, 'tick pushes when a reminder is due');
const req = fetched[0];
ok(req.url === 'https://web.push.apple.com/QK-abc' && req.payload === '' && /^vapid t=.+, k=/.test(req.headers.Authorization) && req.headers.TTL, 'push is empty, VAPID-signed and has a TTL');
ok(G.tickAt_(now + 3600e3 + 120e3) === 0, 'the same reminder is not pushed twice');
// The service worker collects the inbox.
r = post({ fn: 'inbox', id, secret });
ok(r.ok && r.result.messages.length === 1 && r.result.messages[0].title.includes('新晋 OL') && r.result.messages[0].url === '#lens/x', 'inbox returns the due reminder text');
ok(post({ fn: 'inbox', id, secret }).result.messages.length === 0, 'inbox is emptied after reading');
ok(post({ fn: 'inbox', id, secret: 'y'.repeat(30) }).result.messages.length === 0, 'inbox with the wrong secret gets nothing');
// Re-sync with the already-sent reminder: still not sent again.
post({ fn: 'sync', id, secret, items });
fetched.length = 0;
G.tickAt_(now + 3600e3 + 180e3);
ok(fetched.length === 0, 'a re-synced reminder that was already sent is not sent again');
// A reminder missed by more than 6 hours is dropped, not sent late at night.
fetched.length = 0;
G.tickAt_(now + 7200e3 + 7 * 3600e3);
ok(fetched.length === 0, 'a reminder more than 6 hours late is skipped');

// Big lists still fit in one Script Property.
const many = Array.from({ length: 200 }, (_, i) => ({ key: 'k' + i, at: now + (i + 1) * 3600e3, title: '一'.repeat(60), body: '二'.repeat(120), url: '#lens/abcdefghij' }));
r = post({ fn: 'sync', id, secret, items: many });
ok(r.ok && r.result.items > 5 && r.result.items <= 60, 'a long list is trimmed to fit (' + (r.ok ? r.result.items : r.error) + ')');

// Test notification and an expired subscription.
fetched.length = 0;
r = post({ fn: 'test', id, secret });
ok(r.ok && fetched.length === 1, 'test sends a push now');
ok(post({ fn: 'inbox', id, secret }).result.messages.some((m) => m.key === 'test'), 'test message is in the inbox');
pushStatus = 410;
r = post({ fn: 'test', id, secret });
ok(!r.ok && /失效/.test(r.error), 'an expired subscription is reported');
pushStatus = 200;
ok(post({ fn: 'sync', id, secret, items: [] }).result.push === false, 'and the dead endpoint is forgotten');
// Turning off deletes the device.
ok(post({ fn: 'off', id, secret }).ok && !Object.keys(props).some((k) => k.startsWith('DEV_')), 'off deletes the phone');

console.log(`push-server: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
