import { describe, expect, it } from 'vitest';
import { civilIdValidity } from './civilIdValidity.js';

describe('Civil ID expiry in Kuwait time', () => {
  it('accepts an ID through its expiry date and rejects it the next Kuwait day', () => {
    expect(civilIdValidity('2026-11-03', 'high', new Date('2026-11-03T20:59:59Z'))).toBe('valid');
    expect(civilIdValidity('2026-11-03', 'high', new Date('2026-11-03T21:00:00Z'))).toBe('expired');
  });
  it('rejects impossible, missing, or uncertain dates', () => {
    expect(civilIdValidity('2026-02-30', 'high')).toBe('unreadable');
    expect(civilIdValidity(null, 'high')).toBe('unreadable');
    expect(civilIdValidity('2099-12-31', 'low')).toBe('unreadable');
  });
});
