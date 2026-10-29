/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript harness. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const original = Module._load;
Module._load = function (name, ...args) { if (name === 'server-only') return {}; return original.call(this, name, ...args); };
const { assistantQuestion, askAssistant } = require('../src/lib/ai-assistant.ts');
Module._load = original;
// Unit tests select providers explicitly and never load real .env credentials.
process.env.AI_PROVIDER = 'openai';

test('question input rejects malformed, empty and oversized questions', () => {
  for (const body of [null, [], {}, { question: 1 }, { question: '  ' }, { question: 'a'.repeat(1001) }]) assert.throws(() => assistantQuestion(body), e => e.status === 400);
  assert.equal(assistantQuestion({ question: ' Satışlar nasıl? ', branchId: 'untrusted' }), 'Satışlar nasıl?');
});

test('Responses request uses server key, bounded output and no storage; parses message text only', async () => {
  const previous = { ...process.env };
  try {
    delete process.env.OPENAI_API_KEY; process.env.OPENAI_SECRET_KEY = 'test-secret';
    const answer = await askAssistant('Özet', { sales: { total: '75.00' } }, async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(init.headers.Authorization, 'Bearer test-secret');
      const body = JSON.parse(init.body);
      assert.equal(body.store, false); assert.equal(body.max_output_tokens, 900);
      assert.equal(body.tools, undefined); assert.equal(body.previous_response_id, undefined);
      assert.ok(!init.body.includes('test-secret'));
      assert.equal(JSON.parse(body.input[0].content).data.sales.total, '75.00');
      return Response.json({ status: 'completed', output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'hidden' }] }, { type: 'message', content: [{ type: 'output_text', text: '75 TL' }] }] });
    });
    assert.equal(answer, '75 TL');
  } finally { process.env = previous; }
});

test('missing credentials, provider errors, timeout and incomplete output fail without exposing secrets', async () => {
  const previous = { ...process.env };
  try {
    delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_SECRET_KEY;
    await assert.rejects(askAssistant('Özet', {}), e => e.status === 503);
    process.env.OPENAI_API_KEY = 'private-test-key';
    for (const status of [401, 403, 429, 500]) {
      await assert.rejects(askAssistant('Özet', {}, async () => new Response('private-provider-detail', { status })), e => !e.message.includes('private') && e.status === (status === 429 ? 429 : 503));
    }
    await assert.rejects(askAssistant('Özet', {}, async () => { throw new Error('private-test-key'); }), e => !e.message.includes('private'));
    for (const payload of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [] }]) {
      await assert.rejects(askAssistant('Özet', {}, async () => Response.json(payload)), e => e.status === 503);
    }
  } finally { process.env = previous; }
});

test('429 distinguishes exhausted credit, spending caps and temporary throttling without exposing provider text', async () => {
  const previous = { ...process.env };
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    for (const [code, text] of [['credit_balance_exhausted', 'kredi bakiyesi tükenmiş'], ['project_spend_limit_exceeded', 'proje harcama'], ['organization_spend_limit_exceeded', 'işletme harcama'], ['organization_usage_limit_exceeded', 'kullanım kotasına'], ['insufficient_quota', 'kullanım kotası yetersiz'], ['rate_limit_exceeded', 'geçici istek'], ['slow_down', 'istek sıklığı']]) {
      await assert.rejects(askAssistant('Özet', {}, async () => Response.json({ error: { code, message: 'private-provider-detail' } }, { status: 429 })), e => e.status === 429 && e.message.includes(text) && !e.message.includes('private'));
    }
  } finally { process.env = previous; }
});

test('route takes branch context from authorized dashboard and excludes customer/order fields', async () => {
  let captured, permission, selectedBranch = 'authorized-branch';
  const stubs = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/rbac': { withPermission: (value, handler) => { permission = value; return handler; } },
    '@/lib/current-membership': { getCurrentMembership: async () => ({ organizationId: 'org', userId: 'user' }) },
    '@/lib/http-security': { boundedJson: request => request.json() },
    '@/lib/rate-limit': { consumeRateLimit: () => {} },
    '@/lib/dashboard-data': { dashboardPeriod: () => ({ day: '2026-10-28' }), loadDashboard: async () => ({ branchId: selectedBranch, total: '75.00', count: 1, average: '75.00', changes: {}, charts: { month: [] }, orders: [{ orderNumber: 'private-order' }] }) },
    '@/lib/stock-alerts': { criticalStockAlerts: async () => ({ enabled: true, total: 1, rows: [{ id: 'private-id', name: 'Ürün', quantity: '1', criticalLevel: '2', unit: 'ADET' }] }) },
    '@/lib/ai-assistant': { assistantQuestion, askAssistant: async (q, data) => { captured = data; return 'Özet'; }, AssistantError: require('../src/lib/ai-assistant.ts').AssistantError },
  };
  Module._load = function (name, ...args) { if (name in stubs) return stubs[name]; return original.call(this, name, ...args); };
  let POST;
  try { ({ POST } = require('../src/app/api/ai/assistant/route.ts')); } finally { Module._load = original; }
  assert.equal(permission, 'finance.manage');
  const request = () => new Request('http://localhost/api/ai/assistant', { method: 'POST', body: JSON.stringify({ question: 'Özet', branchId: 'foreign-branch', data: { total: '99999' } }) });
  const response = await POST(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).branchId, 'authorized-branch');
  assert.equal(captured.sales.total, '75.00');
  assert.ok(!JSON.stringify(captured).includes('private-'));
  captured = null; selectedBranch = null;
  assert.equal((await POST(request())).status, 400); assert.equal(captured, null);
  assert.equal((await POST(new Request('http://localhost/api', { method: 'POST', body: '{}' }))).status, 400);
});

test('Gemini uses only its own key, server context and bounded text output', async () => {
  const previous = { ...process.env };
  try {
    process.env.AI_PROVIDER = 'gemini'; process.env.GEMINI_API_KEY = 'gemini-private-key';
    delete process.env.GEMINI_MODEL;
    const answer = await askAssistant('Özet', { sales: { total: '75.00' } }, async (url, init) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
      assert.ok(!url.includes('gemini-private-key'));
      assert.equal(init.headers['x-goog-api-key'], 'gemini-private-key');
      assert.equal(init.headers.Authorization, undefined);
      const body = JSON.parse(init.body);
      assert.equal(body.generationConfig.maxOutputTokens, 900); assert.equal(body.tools, undefined);
      assert.equal(JSON.parse(body.contents[0].parts[0].text).data.sales.total, '75.00');
      assert.ok(!init.body.includes('gemini-private-key'));
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hidden reasoning' }, { text: '75 TL' }] } }] });
    });
    assert.equal(answer, '75 TL');
  } finally { process.env = previous; }
});

test('Gemini handles missing key, quotas, blocked/incomplete text and never falls back to paid OpenAI', async () => {
  const previous = { ...process.env };
  try {
    process.env.AI_PROVIDER = 'gemini'; delete process.env.GEMINI_API_KEY;
    let calls = 0;
    const fetcher = async () => { calls++; return Response.json({}); };
    await assert.rejects(askAssistant('Özet', {}, fetcher), /GEMINI_API_KEY/); assert.equal(calls, 0);
    process.env.GEMINI_API_KEY = 'private-key';
    for (const status of [400, 401, 403, 404, 429, 500]) {
      await assert.rejects(askAssistant('Özet', {}, async () => new Response('private-provider-detail', { status })), e => e.status === (status === 429 ? 429 : 503) && !e.message.includes('private'));
    }
    for (const payload of [{}, { promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }, { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }]) {
      await assert.rejects(askAssistant('Özet', {}, async () => Response.json(payload)), e => e.status === 503);
    }
    await assert.rejects(askAssistant('Özet', {}, async () => { throw new Error('private-key'); }), e => !e.message.includes('private'));
    process.env.GEMINI_MODEL = '../invalid';
    await assert.rejects(askAssistant('Özet', {}, fetcher), /GEMINI_MODEL/); assert.equal(calls, 0);
    process.env.AI_PROVIDER = 'unknown';
    await assert.rejects(askAssistant('Özet', {}, fetcher), /AI_PROVIDER/); assert.equal(calls, 0);
  } finally { process.env = previous; }
});
