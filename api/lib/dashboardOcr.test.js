import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const dashboard = fs.readFileSync(new URL('../../dashboard.html', import.meta.url), 'utf8');
const source = dashboard.slice(dashboard.indexOf('async function extractContractIds()'), dashboard.indexOf('async function submitContract()'));

function setup(callFunction) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', style: {}, files: [], textContent: '', disabled: false });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    contractState: {}, callFunction,
    fileToBase64: async file => file.name,
    console: { error: vi.fn() }
  });
  vm.runInContext(source, context);
  return { context, element };
}

const reading = {
  full_name: 'uncertain name', civil_id_number: '000000000000',
  address: 'uncertain address', sex: 'male', confidence: 'low',
  field_confidence: { full_name: 'low', civil_id_number: 'high', address: 'low', sex: 'high' }
};

describe('contract form ID reading', () => {
  it('fills a confident ID independently of an uncertain name and address', async () => {
    const { context, element } = setup(async url => url.includes('upload') ? { path: 'test-path' } : reading);
    expect(await context.extractOne({ name: 'front', type: 'image/png' }, null, 'tenant')).toBe(false);
    expect(element('c-tenant-name').value).toBe('');
    expect(element('c-tenant-civil-id').value).toBe('000000000000');
    expect(element('c-tenant-address').value).toBe('');
    expect(element('c-tenant-sex').value).toBe('male');
  });

  it('starts both people before either finishes and keeps the successful result when one fails', async () => {
    const pending = [];
    const { context, element } = setup(async (url, body) => {
      if (url.includes('upload')) return { path: body.kind };
      return new Promise((resolve, reject) => pending.push({ kind: body.path, resolve, reject }));
    });
    element('contractTenantIdFile').files = [{ name: 'tenant-front', type: 'image/png' }];
    element('contractGuarantorIdFile').files = [{ name: 'parent-front', type: 'image/png' }];
    const operation = context.extractContractIds();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending.find(task => task.kind === 'tenant').reject(new Error('Reader unavailable'));
    pending.find(task => task.kind === 'guarantor').resolve(reading);
    await operation;
    expect(element('c-guarantor-civil-id').value).toBe('000000000000');
    expect(element('contractExtractStatus').textContent).toContain('Reader unavailable');
    expect(element('contractExtractBtn').disabled).toBe(false);
  });

  it('uploads front and back concurrently rather than waiting for the front upload', async () => {
    const uploads = [];
    const { context } = setup(async (url, body) => {
      if (url.includes('upload')) return new Promise(resolve => uploads.push({ name: body.image, resolve }));
      return reading;
    });
    const operation = context.extractOne({ name: 'front' }, { name: 'back' }, 'tenant');
    await vi.waitFor(() => expect(uploads).toHaveLength(2));
    uploads.forEach(upload => upload.resolve({ path: upload.name }));
    await operation;
  });
});
