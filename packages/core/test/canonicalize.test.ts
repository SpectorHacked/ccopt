import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalizeText, templateOf, toolLabel } from '../src/canonicalize.js';

interface GoldenCase {
  name: string;
  input: string;
  expected: string;
}

const golden: GoldenCase[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden/canonicalize.json', import.meta.url)), 'utf8'),
);

describe('canonicalizeText — golden suite', () => {
  for (const c of golden) {
    it(c.name, () => {
      expect(canonicalizeText(c.input)).toBe(c.expected);
    });
  }
});

describe('templateOf', () => {
  it('lowercases, collapses whitespace, replaces volatiles', () => {
    expect(templateOf('Fix   the FAILING test\n in /a/b/test_x.py')).toBe(
      'fix the failing test in <PATH:.py>',
    );
  });

  it('two prompts differing only in data share a template', () => {
    const a = templateOf('Scrape https://site-a.example.com/items?page=3 and save to /tmp/out1.json');
    const b = templateOf('Scrape https://site-a.example.com/items?page=9 and save to /tmp/out2.json');
    expect(a).toBe(b);
  });
});

describe('stripControlChars via canonicalizeText', () => {
  it('removes NUL and control characters from labels', () => {
    const withNul = `replace(/${String.fromCharCode(0)}/g) and bell${String.fromCharCode(7)}`;
    const out = canonicalizeText(withNul);
    expect(out).toBe('replace(//g) and bell');
    expect(out.includes(String.fromCharCode(0))).toBe(false);
  });

  it('removes lone surrogates created by truncation', () => {
    const loneSurrogate = '🎉'.slice(0, 1); // high surrogate only
    expect(canonicalizeText(`x${loneSurrogate}y`)).toBe('xy');
  });
});

describe('toolLabel', () => {
  it('same tool, same shape, different data → same label', () => {
    const a = toolLabel('Read', { file_path: '/repo/src/main.py', limit: 100 });
    const b = toolLabel('Read', { file_path: '/repo/lib/other.py', limit: 250 });
    expect(a).toBe(b);
  });

  it('different key set → different label', () => {
    const a = toolLabel('Read', { file_path: '/repo/src/main.py' });
    const b = toolLabel('Read', { file_path: '/repo/src/main.py', offset: 5 });
    expect(a).not.toBe(b);
  });
});
