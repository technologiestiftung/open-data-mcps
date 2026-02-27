/**
 * Integration tests — hit the real datenregister.berlin.de API.
 * Run with: npm run test:integration
 *
 * These test the full pipeline: QueryProcessor.buildQuery → BerlinOpenDataAPI.searchDatasets.
 * The interesting question isn't "does CKAN return results for a known OR query" (it does),
 * but "does a natural language user input survive our processing and surface relevant datasets?"
 */
import { describe, it, expect } from 'vitest';
import { BerlinOpenDataAPI } from '../src/berlin-api.js';
import { QueryProcessor } from '../src/query-processor.js';

const api = new BerlinOpenDataAPI();
const qp = new QueryProcessor();

async function search(naturalLanguageQuery: string) {
  const q = qp.buildQuery(naturalLanguageQuery);
  return api.searchDatasets({ query: q, limit: 10 });
}

describe('full pipeline: natural language → buildQuery → searchDatasets', () => {
  it('English term "bicycle" surfaces cycling datasets via SEED_MAPPINGS', async () => {
    const result = await search('bicycle infrastructure');
    expect(result.count).toBeGreaterThan(0);
    const titles = result.results.map(d => d.title.toLowerCase());
    const found = titles.some(t => t.includes('radverkehr') || t.includes('fahrrad'));
    expect(found, `Expected cycling datasets. Got: ${titles.slice(0, 5).join(', ')}`).toBe(true);
  }, 15_000);

  it('"Wie viele Einwohner hat Berlin?" (stop words + punctuation) surfaces population datasets', async () => {
    const result = await search('Wie viele Einwohner hat Berlin?');
    expect(result.count).toBeGreaterThan(0);
    const titles = result.results.map(d => d.title.toLowerCase());
    const found = titles.some(t => t.includes('einwohner') || t.includes('bevölkerung'));
    expect(found, `Expected population datasets. Got: ${titles.slice(0, 5).join(', ')}`).toBe(true);
  }, 15_000);

  it('"Miete" surfaces Mietspiegel datasets via SEED_MAPPINGS', async () => {
    const result = await search('Miete');
    const titles = result.results.map(d => d.title.toLowerCase());
    const found = titles.some(t => t.includes('mietspiegel'));
    expect(found, `Expected Mietspiegel. Got: ${titles.slice(0, 5).join(', ')}`).toBe(true);
  }, 15_000);

  it('"Kriminalität" surfaces crime datasets without police station noise', async () => {
    const result = await search('Kriminalität');
    expect(result.count).toBeGreaterThan(0);
    const topTitle = result.results[0]?.title.toLowerCase() ?? '';
    expect(topTitle).toMatch(/kriminalität|straftaten/);
  }, 15_000);

  it('structured query "title:Radverkehr" passes through unchanged and returns results', async () => {
    const result = await search('title:Radverkehr');
    expect(result.count).toBeGreaterThan(0);
    const titles = result.results.map(d => d.title.toLowerCase());
    expect(titles.every(t => t.includes('radverkehr'))).toBe(true);
  }, 15_000);
});
