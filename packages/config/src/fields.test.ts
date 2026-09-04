import { describe, expect, it } from 'vitest';
import { booleanString, nonEmptyString, optionalUrl, port } from './fields.js';

describe('fields', () => {
  it('port accepts 1..65535 only', () => {
    expect(port(1).parse('65535')).toBe(65535);
    expect(port(1).safeParse('0').success).toBe(false);
    expect(port(1).safeParse('70000').success).toBe(false);
    expect(port(1).safeParse('12.5').success).toBe(false);
    expect(port(4000).parse(undefined)).toBe(4000);
  });

  it('booleanString understands common spellings', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on'])
      expect(booleanString(false).parse(v)).toBe(true);
    for (const v of ['false', '0', 'no', 'off']) expect(booleanString(true).parse(v)).toBe(false);
    expect(booleanString(true).parse(undefined)).toBe(true);
    expect(booleanString(true).safeParse('maybe').success).toBe(false);
  });

  it('optionalUrl and nonEmptyString', () => {
    expect(optionalUrl.parse(undefined)).toBeUndefined();
    expect(optionalUrl.parse('https://a.test/x')).toBe('https://a.test/x');
    expect(optionalUrl.safeParse('not a url').success).toBe(false);
    expect(nonEmptyString.safeParse('').success).toBe(false);
  });
});
