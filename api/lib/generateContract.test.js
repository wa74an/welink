import path from 'path';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';
import { describe, it, expect } from 'vitest';
import { mergeContract, MissingFieldError } from './generateContract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '__fixtures__', 'minimal-template.docx');
const REAL_TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'guarantor-contract.docx');

const baseFields = {
  tenant_name: 'John Smith',
  tenant_address: '12 Example Street, London, SW1A 1AA',
  tenant_civil_id: '123456789012',
  tenant_phone: '+44 7700 900000',
  guarantor_name: 'Jane Doe',
  guarantor_address: '34 Sample Road, Manchester, M1 1AA',
  guarantor_civil_id: '210987654321',
  guarantor_phone: '+44 7700 900001',
  rent_amount_gbp: '850',
  rent_due_day: '1',
  contract_start_date: '01/10/2026',
  contract_end_date: '30/09/2027',
  contract_weekday: 'Thursday',
  contract_date: '01/10/2026'
};

function extractText(buf) {
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();
  return xml.replace(/<[^>]+>/g, '');
}

describe('mergeContract', () => {
  it('renders successfully with all required fields (happy path)', () => {
    const buf = mergeContract(baseFields, FIXTURE);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    const text = extractText(buf);
    expect(text).toContain('John Smith');
    expect(text).not.toMatch(/\{\{|\}\}/);
  });

  it('handles long names and long addresses without truncation', () => {
    const longAddress = 'Flat 42B, The Old Coach House, ' + 'Long Lane '.repeat(15) + 'London, SW1A 1AA';
    const fields = { ...baseFields, tenant_address: longAddress };
    const buf = mergeContract(fields, FIXTURE);
    const text = extractText(buf);
    expect(text).toContain(longAddress);
  });

  it('round-trips Arabic diacritics and unusual characters exactly', () => {
    const arabicName = 'محمَّد بن عَبدِ اللّٰه الشَّمَّري';
    const fields = { ...baseFields, tenant_name: arabicName };
    const buf = mergeContract(fields, FIXTURE);
    const text = extractText(buf);
    expect(text).toContain(arabicName);
  });

  it('throws MissingFieldError and blocks generation when a required field is empty', () => {
    const fields = { ...baseFields, tenant_civil_id: '' };
    expect(() => mergeContract(fields, FIXTURE)).toThrow(MissingFieldError);
  });

  it('throws MissingFieldError when a required field is entirely omitted', () => {
    const fields = { ...baseFields };
    delete fields.guarantor_phone;
    expect(() => mergeContract(fields, FIXTURE)).toThrow(MissingFieldError);
  });

  it('never renders with a field left as literal undefined/blank text', () => {
    const fields = { ...baseFields, rent_due_day: '   ' }; // whitespace-only
    expect(() => mergeContract(fields, FIXTURE)).toThrow(MissingFieldError);
  });

  it('keeps the two rent-amount occurrences in sync in the real template (Clause 1 + Clause 5)', () => {
    const buf = mergeContract(baseFields, REAL_TEMPLATE);
    const text = extractText(buf);
    const occurrences = text.split('850').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(text).not.toMatch(/\{\{|\}\}/);
  });
});
