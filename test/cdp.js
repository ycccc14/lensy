// Headless Chrome at iPhone size (390×844), driven over the DevTools protocol.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPhone({ port = 9344, shots, dark = false } = {}) {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const errors = [];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lensy-ui-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ }
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '')) errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
    if (m.method) listeners.forEach((fn) => fn(m));
  };
  const send = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + '\n' + expr.slice(0, 300));
    return r.result.value;
  };
  const screen = () => js(`JSON.stringify({ view: document.querySelector('#view').innerText.slice(0, 400), sheet: [...document.querySelectorAll('.sheet-wrap')].map((s) => s.innerText.slice(0, 300)), toast: document.querySelector('#toast').textContent })`);
  const until = async (expr, what, ms) => {
    const end = Date.now() + (ms || 6000);
    while (Date.now() < end) { if (await js(expr)) return; await sleep(80); }
    throw new Error(`Timed out waiting for: ${what}\n  on screen: ${await screen()}`);
  };
  const metrics = (height) => send('Emulation.setDeviceMetricsOverride', { width: 390, height, deviceScaleFactor: 2, mobile: true });
  const shot = async (name) => {
    if (!shots) return;
    await sleep(350);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const full = async (name) => {
    if (!shots) return;
    const h = await js('Math.ceil(document.documentElement.scrollHeight)');
    await metrics(Math.min(h, 5000));
    await shot(name);
    await metrics(844);
  };
  // Taps the last visible element matching sel whose text includes `text` (sheets on top win).
  const tap = async (sel, text) => {
    const ok = await js(`(() => {
      const top = [...document.querySelectorAll('.sheet-wrap')].pop();
      const root = top || document;
      const els = [...root.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length && !e.closest('[hidden]'));
      const el = els.filter((e) => !${JSON.stringify(text || '')} || e.textContent.includes(${JSON.stringify(text || '')})).pop();
      if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
    if (!ok) throw new Error(`Nothing to tap: ${sel} ${text || ''}\n  on screen: ${await screen()}`);
    await sleep(120);
  };
  const type = async (sel, value) => {
    const ok = await js(`(() => { const top = [...document.querySelectorAll('.sheet-wrap')].pop() || document; const el = top.querySelector(${JSON.stringify(sel)}); if (!el) return false;
      el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`Nothing to type into: ${sel}\n  on screen: ${await screen()}`);
    await sleep(80);
  };
  // Answer the next photo picker with these files, the way a phone would.
  let chooserFiles = null;
  listeners.push(async (m) => {
    if (m.method === 'Page.fileChooserOpened' && chooserFiles) {
      const files = chooserFiles; chooserFiles = null;
      await send('DOM.setFileInputFiles', { files, backendNodeId: m.params.backendNodeId });
    }
  });
  const nextFiles = (files) => { chooserFiles = files; };
  const close = () => { try { ws.close(); } catch { /* gone */ } chrome.kill(); };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await metrics(844);
  await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  return { send, js, until, shot, full, tap, type, nextFiles, errors, close, screen };
}
