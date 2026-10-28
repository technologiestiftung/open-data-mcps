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
      /firewall blocked this request \(HTTP 403\).*simplify the query/
    );
  });

  it('identifies itself with the MCP user agent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'x' }));

    const api = new BerlinOpenDataAPI(fetchMock as unknown as typeof fetch);
    await api.getDataset('x');

    const init = (fetchMock.mock.calls as unknown as [string, { headers: Record<string, string> }][])[0][1];
    expect(init.headers['User-Agent']).toMatch(/^Berlin-Open-Data-MCP-Server\/1\.0 \(\+https:\/\//);
  });

  it('builds WAF-safe filter queries', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ count: 0, results: [], search_facets: {} }));

    const api = new BerlinOpenDataAPI(fetchMock as unknown as typeof fetch);
    await api.searchDatasetsFiltered({ query: '*', tag: 'Bildung', format: 'csv', modified_since: '2024-06-01' });
    await api.searchDatasetsFiltered({ query: '*', tag: 'Öffentlicher Raum', organization: 'datenrubrik' });

    const fqs = (fetchMock.mock.calls as unknown as [string][]).map(([url]) => new URL(url).searchParams.get('fq'));
    expect(fqs[0]).toBe('tags:Bildung AND res_format:CSV AND metadata_modified:[2024-06-01T00:00:00Z TO NOW]');
    expect(fqs[1]).toBe('tags:Öffentlicher?Raum AND organization:datenrubrik');
  });

  it('retries once after a rate limit response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<html>429 Please respect our berlin.de/robots.txt</html>', {
        status: 429,
        headers: { 'content-type': 'text/html', 'retry-after': '0' },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'x' }));

    const api = new BerlinOpenDataAPI(fetchMock as unknown as typeof fetch);
    await expect(api.getDataset('x')).resolves.toEqual({ id: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a rate limit when the retry is limited too', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>429</html>', {
      status: 429,
      headers: { 'content-type': 'text/html', 'retry-after': '0' },
    }));

    const api = new BerlinOpenDataAPI(fetchMock as unknown as typeof fetch);
    await expect(api.getDataset('x')).rejects.toThrow(/rate limiting requests \(HTTP 429\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(result: unknown) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
