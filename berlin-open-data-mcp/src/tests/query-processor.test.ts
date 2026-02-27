import { describe, it, expect } from 'vitest';
import { QueryProcessor } from '../query-processor.js';

const qp = new QueryProcessor();

describe('QueryProcessor.buildQuery', () => {
  describe('stop word filtering', () => {
    it('filters common German stop words', () => {
      const result = qp.buildQuery('was ist die Luftqualität');
      expect(result).not.toMatch(/\bwas\b/i);
      expect(result).not.toMatch(/\bist\b/i);
      expect(result).not.toMatch(/\bdie\b/i);
      expect(result.toLowerCase()).toContain('luftqualität');
    });

    it('filters Berlin and Anzahl as portal-level noise', () => {
      const result = qp.buildQuery('Fahrradwege Berlin Anzahl');
      expect(result.toLowerCase()).not.toContain('berlin');
      expect(result.toLowerCase()).not.toContain('anzahl');
      expect(result.toLowerCase()).toContain('fahrradwege');
    });

    it('falls back to original query when all tokens are stop words', () => {
      // "Berlin" alone → all tokens filtered → returns original
      const result = qp.buildQuery('Berlin');
      expect(result).toBe('Berlin');
    });

    it('filters stop word "viele" and German question words', () => {
      const result = qp.buildQuery('Wie viele Einwohner hat Berlin?');
      expect(result.toLowerCase()).not.toContain('wie');
      expect(result.toLowerCase()).not.toContain('viele');
      expect(result.toLowerCase()).not.toContain('hat');
      expect(result.toLowerCase()).not.toContain('berlin');
    });
  });

  describe('punctuation stripping', () => {
    it('strips trailing question mark so stop words are still filtered', () => {
      const result = qp.buildQuery('Wie viele Einwohner hat Berlin?');
      // "berlin?" would bypass the stop-word set; after stripping it becomes "berlin"
      expect(result.toLowerCase()).not.toContain('berlin');
      expect(result.toLowerCase()).toContain('einwohner');
    });

    it('strips commas and exclamation marks', () => {
      const result = qp.buildQuery('Müll, Abfall!');
      // Should still expand correctly without punctuation in output
      expect(result).not.toContain(',');
      expect(result).not.toContain('!');
      expect(result.toLowerCase()).toContain('müll');
    });
  });

  describe('structured query passthrough', () => {
    it('passes through field-qualified queries unchanged', () => {
      expect(qp.buildQuery('title:Radverkehr')).toBe('title:Radverkehr');
    });

    it('passes through wildcard queries unchanged', () => {
      expect(qp.buildQuery('*:*')).toBe('*:*');
      expect(qp.buildQuery('*')).toBe('*');
    });

    it('passes through queries with explicit OR unchanged', () => {
      const q = '(radverkehr OR fahrrad)';
      expect(qp.buildQuery(q)).toBe(q);
    });

    it('passes through quoted phrase queries unchanged', () => {
      const q = '"Berliner Mietspiegel"';
      expect(qp.buildQuery(q)).toBe(q);
    });
  });

  describe('SEED_MAPPINGS synonym expansion', () => {
    it('expands cycling terms', () => {
      const result = qp.buildQuery('Fahrrad').toLowerCase();
      expect(result).toContain('fahrrad');
      expect(result).toContain('radverkehr');
    });

    it('expands English cycling term to German equivalents', () => {
      const result = qp.buildQuery('bicycle').toLowerCase();
      expect(result).toContain('bicycle');
      expect(result).toContain('fahrrad');
      expect(result).toContain('radverkehr');
    });

    it('expands fahrradwege to radverkehrsanlagen', () => {
      const result = qp.buildQuery('Fahrradwege').toLowerCase();
      expect(result).toContain('fahrradwege');
      expect(result).toContain('radverkehrsanlagen');
      expect(result).toContain('radverkehr');
    });

    it('expands population terms', () => {
      const result = qp.buildQuery('Einwohner').toLowerCase();
      expect(result).toContain('einwohner');
      expect(result).toContain('einwohnerinnen');
      expect(result).toContain('bevölkerung');
    });

    it('expands English population query', () => {
      const result = qp.buildQuery('population').toLowerCase();
      expect(result).toContain('population');
      expect(result).toContain('einwohner');
      expect(result).toContain('bevölkerung');
    });

    it('expands rent/housing terms', () => {
      const result = qp.buildQuery('Miete').toLowerCase();
      expect(result).toContain('miete');
      expect(result).toContain('mietspiegel');
    });

    it('expands crime terms correctly (no polizei)', () => {
      const result = qp.buildQuery('Kriminalität').toLowerCase();
      expect(result).toContain('kriminalität');
      expect(result).toContain('kriminalitätsatlas');
      expect(result).not.toContain('polizei');
    });

    it('expands energy terms', () => {
      const result = qp.buildQuery('Solar').toLowerCase();
      expect(result).toContain('solar');
      expect(result).toContain('solaranlagen');
      expect(result).toContain('photovoltaik');
    });
  });

  describe('deduplication', () => {
    it('deduplicates overlapping expansions', () => {
      // "fahrrad" maps to "radverkehr", and "rad" also maps to "fahrrad" + "radverkehr"
      const result = qp.buildQuery('rad fahrrad');
      const terms = result.replace(/[()]/g, '').split(' OR ');
      const unique = new Set(terms);
      expect(terms.length).toBe(unique.size);
    });
  });

  describe('output format', () => {
    it('wraps multiple terms in parentheses with OR', () => {
      const result = qp.buildQuery('Einwohner Bezirk');
      expect(result).toMatch(/^\(.*\)$/);
      expect(result).toContain(' OR ');
    });

    it('returns a single term without parentheses when there is no expansion', () => {
      // A term not in SEED_MAPPINGS and not a stop word
      const result = qp.buildQuery('kita');
      expect(result).toBe('kita');
    });

    it('handles empty string by returning it', () => {
      expect(qp.buildQuery('')).toBe('');
    });
  });
});
