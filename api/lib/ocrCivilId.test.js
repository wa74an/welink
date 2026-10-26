import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const handler = require('../ocr-civil-id.js');
const path = '00000000-0000-0000-0000-000000000000/tenant/123.png';
const extracted = {
  full_name: 'اسم تجريبي', civil_id_number: '000000000000',
  address: null, sex: null, confidence: 'high'
};
const completed = (data = extracted) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }]
});
const storageFile = () => ({ ok: true, arrayBuffer: async () => Buffer.from('synthetic test file') });

async function invoke(body = { path }, headers = { 'x-admin-secret': 'test-admin' }) {
  const res = {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    send(value) { this.body = JSON.parse(value); return this; }
  };
  await handler({ method: 'POST', headers, body }, res);
  return res;
}

describe('Civil ID extraction', () => {
  beforeEach(() => {
    for (const key of ['OPENAI_API_KEY', 'OPENAI_OCR_MODEL', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN']) vi.stubEnv(key, '');
    vi.stubEnv('ADMIN_SECRET', 'test-admin');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-storage');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('rejects unauthorized callers and invalid paths before accessing ID storage', async () => {
    expect((await invoke({ path }, {})).statusCode).toBe(401);
    expect((await invoke({ path: '../private.png' })).statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads front and back images via OpenAI using Vercel OIDC, preserving Arabic and missing fields', async () => {
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'test-oidc');
    fetch.mockResolvedValueOnce(storageFile()).mockResolvedValueOnce(storageFile())
      .mockResolvedValueOnce({ ok: true, json: async () => completed() });
    const res = await invoke({ path, backPath: path.replace('123', '124') });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(extracted);
    const [endpoint, options] = fetch.mock.calls[2];
    expect(endpoint).toBe('https://ai-gateway.vercel.sh/v1/responses');
    expect(options.headers.Authorization).toBe('Bearer test-oidc');
    const request = JSON.parse(options.body);
    expect(request.model).toBe('openai/gpt-5.4');
    expect(request.store).toBe(false);
    expect(request.text.format.strict).toBe(true);
    expect(request.text.format.schema.additionalProperties).toBe(false);
    expect(request.input[0].content.slice(0, 2).every(item => item.type === 'input_image')).toBe(true);
  });

  it('supports PDFs and a dedicated server-side OpenAI key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    fetch.mockResolvedValueOnce(storageFile()).mockResolvedValueOnce({ ok: true, json: async () => completed() });
    expect((await invoke({ path: path.replace('.png', '.pdf') })).statusCode).toBe(200);
    const [endpoint, options] = fetch.mock.calls[1];
    expect(endpoint).toBe('https://api.openai.com/v1/responses');
    const request = JSON.parse(options.body);
    expect(request.model).toBe('gpt-5.4');
    expect(request.input[0].content[0]).toMatchObject({ type: 'input_file', filename: 'civil-id.pdf' });
    expect(request.input[0].content[0].file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it.each([401, 402, 429, 500])('reports provider failure %s as unavailable, never as an unreadable ID', async status => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-gateway');
    fetch.mockResolvedValueOnce(storageFile()).mockResolvedValueOnce({ ok: false, status });
    const res = await invoke();
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('enter the fields manually');
    expect(res.body).not.toHaveProperty('civil_id_number');
  });

  it.each([
    { status: 'incomplete', output: completed().output },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'test' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'private-invalid-json' }] }] }
  ])('rejects incomplete, refused, and malformed output without logging ID content', async result => {
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'test-oidc');
    fetch.mockResolvedValueOnce(storageFile()).mockResolvedValueOnce({ ok: true, json: async () => result });
    const res = await invoke();
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('private-invalid-json');
  });

  it('does not accept invented or invalid schema fields', async () => {
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'test-oidc');
    fetch.mockResolvedValueOnce(storageFile()).mockResolvedValueOnce({ ok: true, json: async () => completed({ ...extracted, confidence: 'certain', sex: 'guessed' }) });
    const res = await invoke();
    expect(res.body).toEqual({ full_name: null, civil_id_number: null, address: null, sex: null, confidence: 'low' });
  });
});
