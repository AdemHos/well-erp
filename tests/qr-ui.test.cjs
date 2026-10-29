/* eslint-disable @typescript-eslint/no-require-imports -- Component effects are driven with controlled hooks/timers, no browser or live DB. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function harness(relative, shared = {}) {
  const filename = path.resolve(__dirname, '../src', relative), original = Module._load;
  const slots = [], effects = []; let cursor = 0, scheduled = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++, previous = effects[index]; if (!previous || deps.some((d, i) => !Object.is(d, previous.deps[i]))) scheduled.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; }); },
  };
  Module._load = function(request, parent, main) {
    if (request === 'react' && parent.filename === filename) return hooks;
    if (request === '@/components/current-accounts/shared') return { api: shared.api, panel: 'panel', button: 'button', secondary: 'secondary', date: value => value, Notice: () => null, Pager: () => null };
    return original.call(this, request, parent, main);
  };
  let Component;
  try { const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText; const m = new Module(filename, module); m.filename = filename; m.paths = module.paths; m._compile(compiled, filename); Component = m.exports.default; }
  finally { Module._load = original; }
  return { render(props) { cursor = 0; scheduled = []; const tree = Component(props); scheduled.forEach(fn => fn()); return tree; }, close() { effects.forEach(e => e?.cleanup?.()); } };
}
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
function text(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (Array.isArray(tree)) return tree.map(text).join(''); if (typeof tree !== 'object') return String(tree); return text(tree.props?.children); }
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && text(n).includes(label));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test('public menu: general/invalid/disabled controls, missing tab and safe JSON request', async () => {
  const originalFetch = global.fetch, calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ message: 'Hesap talebiniz personele iletildi.' }) }; };
  const h = harness('components/qr-menu/PublicMenu.tsx'), menu = { organizationName: 'Cafe', branchName: 'A', tableName: null, invalidTable: false, waiterCallEnabled: false, billRequestEnabled: false, hasOpenTab: false, products: [] };
  try {
    let tree = h.render({ menu, publicToken: 'public', tableToken: null }); assert.equal(button(tree, 'Garson Çağır'), undefined); assert.equal(button(tree, 'Hesap İste'), undefined);
    tree = h.render({ menu: { ...menu, tableName: 'Masa 1', waiterCallEnabled: true, billRequestEnabled: true }, publicToken: 'public', tableToken: 'secret' }); assert.equal(button(tree, 'Hesap İste').props.disabled, true);
    tree = h.render({ menu: { ...menu, tableName: 'Masa 1', waiterCallEnabled: true, billRequestEnabled: true, hasOpenTab: true }, publicToken: 'public', tableToken: 'secret' }); button(tree, 'Hesap İste').props.onClick(); await flush();
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/menu/public/requests'); assert.equal(calls[0].options.headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(calls[0].options.body), { type: 'BILL_REQUEST', tableToken: 'secret' });
    tree = h.render({ menu, publicToken: 'public', tableToken: null }); assert(text(tree).includes('Hesap talebiniz personele iletildi.'));
  } finally { h.close(); global.fetch = originalFetch; }
});
test('personnel notifications: polling, no overlap, visual alert, opt-in sound, hidden pause and error backoff', async () => {
  const original = { setTimeout, clearTimeout, document: global.document, AudioContext: global.AudioContext }, timers = new Map(), listeners = new Map(); let seq = 0, soundCount = 0, calls = 0, result = { total: 0, pages: 1, page: 1, rows: [], latestId: null }, reject = false;
  global.setTimeout = (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }; global.clearTimeout = id => timers.delete(id);
  global.document = { hidden: false, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  global.AudioContext = class { state = 'suspended'; currentTime = 0; destination = {}; async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; } createOscillator() { return { connect() {}, frequency: {}, start() { soundCount++; }, stop() {} }; } createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; } };
  const h = harness('components/restaurant/ServiceRequestsPanel.tsx', { api: async () => { calls++; if (reject) throw new Error('offline'); return result; } }), props = { branchId: 'A', canManage: true };
  async function tick(delay) { const found = [...timers].find(([, timer]) => timer.delay === delay); assert(found, 'timer ' + delay + ' not scheduled'); timers.delete(found[0]); found[1].fn(); await flush(); }
  try {
    h.render(props); await flush(); let tree = h.render(props); assert.equal(calls, 1); assert.equal(soundCount, 0); assert(text(tree).includes('Bekleyen servis talebi yok.'));
    button(tree, 'Ses kapalı').props.onClick(); await flush(); tree = h.render(props);
    result = { ...result, latestId: 'new' }; await tick(5000); tree = h.render(props); assert(text(tree).includes('Yeni servis talebi geldi.')); assert.equal(soundCount, 1);
    global.document.hidden = true; const before = calls; await tick(5000); assert.equal(calls, before); assert.equal(soundCount, 1);
    global.document.hidden = false; listeners.get('visibilitychange')(); await flush(); assert.equal(calls, before + 1); assert.equal(soundCount, 1);
    reject = true; await tick(5000); assert([...timers.values()].some(timer => timer.delay === 10000)); assert(![...timers.values()].some(timer => timer.delay === 5000));
    h.close(); assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
  } finally { h.close(); global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout; global.document = original.document; global.AudioContext = original.AudioContext; }
});
