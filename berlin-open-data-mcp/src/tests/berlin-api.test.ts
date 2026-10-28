import fetch, { Response } from 'node-fetch';
import { describe, expect, it, vi } from 'vitest';
import { BerlinOpenDataAPI } from '../berlin-api.js';

describe('BerlinOpenDataAPI', () => {
  it('uses WAF-safe edismax fields without Solr boost syntax', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      result: { count: 0, results: [], search_facets: {} },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const api = new BerlinOpenDataAPI(fetchMock as unknown as typeof fetch);
    await api.searchDatasets({ query: 'verkehr', limit: 5 });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.searchParams.get('qf')).toBe('title notes tags author maintainer');
    expect(requestedUrl.searchParams.get('qf')).not.toContain('^');
  });

  it('sends facet fields without `","`, which the portal WAF blocks', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      result: { count: 0, results: [], search_facets: {} },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const api = new BerlinOpenDataAPI(fetchMock as unknown as typeof fetch);
    await api.getFacets('verkehr', ['tags', 'organization', 'res_format', 'groups']);
    await api.searchDatasets({ query: 'verkehr' });

    for (const [url] of fetchMock.mock.calls as unknown as [string][]) {
      const requestedUrl = new URL(String(url));
      expect(requestedUrl.searchParams.get('facet.field')).not.toContain('","');
    }
    const facetUrl = new URL(String((fetchMock.mock.calls as unknown as [string][])[0][0]));
    expect(facetUrl.searchParams.get('facet.field')).toBe('["tags", "organization", "res_format", "groups"]');
  });

  it('reports an actionable error when the portal returns an HTML block page', async () => {
    const fetchMock = vi.fn(async () => new Response(
      '<!DOCTYPE html><html><title>403 Forbidden</title><body>Blocked by shield</body></html>',
      {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html' },
      }
    ));

    const api = new BerlinOpenDataAPI(fetchMock as unknown as typeof fetch);

    await expect(api.searchDatasets({ query: 'verkehr' })).rejects.toThrow(
      /non-JSON response \(403 Forbidden; text\/html\).*403 Forbidden.*Blocked by shield/
    );
  });
});
