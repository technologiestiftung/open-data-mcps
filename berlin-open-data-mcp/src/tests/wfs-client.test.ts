import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import {
  WFSClient,
  WFSServiceError,
  WFSUrlNotAllowedError,
  isAllowedWFSUrl,
  isClientSafeWFSError,
} from '../wfs-client.js';

const featureCollection = { type: 'FeatureCollection', features: [] };

function mockGet(response: { data: unknown; headers?: Record<string, string> }) {
  return vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, headers: {}, ...response });
}

function httpError(status: number, data: string): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isAllowedWFSUrl', () => {
  it('allows https URLs on allowlisted hosts', () => {
    expect(isAllowedWFSUrl('https://gdi.berlin.de/services/wfs/kita?REQUEST=GetCapabilities')).toBe(true);
    expect(isAllowedWFSUrl('https://energieatlas.berlin.de/public/ogcsl.ashx?nodeId=255')).toBe(true);
    expect(isAllowedWFSUrl('https://GDI.BERLIN.DE/services/wfs/kita')).toBe(true);
  });

  it('rejects other hosts, schemes, ports and credentials', () => {
    const rejected = [
      'https://attacker.example/?d=secret',
      'https://fbinter.stadt-berlin.de/fb/wfs/data/senstadt/s_wfs_alkis',
      'http://127.0.0.1:8765/x',
      'http://gdi.berlin.de/services/wfs/kita',
      'https://gdi.berlin.de:8443/services/wfs/kita',
      'https://gdi.berlin.de.attacker.example/services/wfs',
      'https://attacker.example/gdi.berlin.de',
      'https://gdi.berlin.de@attacker.example/services/wfs',
      'https://user:pass@gdi.berlin.de/services/wfs',
      'file:///etc/passwd',
      'not a url',
    ];
    for (const url of rejected) {
      expect(isAllowedWFSUrl(url), url).toBe(false);
    }
  });
});

describe('WFSClient', () => {
  it('parseWFSUrl rejects non-allowlisted URLs', () => {
    const client = new WFSClient();
    expect(() => client.parseWFSUrl('http://127.0.0.1:8765/x')).toThrow(WFSUrlNotAllowedError);
  });

  it('does not send requests to non-allowlisted base URLs', async () => {
    const client = new WFSClient();
    await expect(client.getFeatures('http://127.0.0.1:8765/x', 'test')).rejects.toThrow(WFSUrlNotAllowedError);
  });
});

describe('WFSClient.getFeatures requests', () => {
  it('requests application/json from gdi.berlin.de without following redirects', async () => {
    const get = mockGet({ data: featureCollection, headers: { 'content-type': 'application/json' } });
    await new WFSClient().getFeatures('https://gdi.berlin.de/services/wfs/kita', 'kita:kita');

    const [url, config] = get.mock.calls[0];
    expect(new URL(url as string).searchParams.get('OUTPUTFORMAT')).toBe('application/json');
    expect(config?.maxRedirects).toBe(0);
  });

  it('requests application/geo+json from energieatlas.berlin.de', async () => {
    const get = mockGet({ data: featureCollection, headers: { 'content-type': 'application/geo+json' } });
    const client = new WFSClient();
    const { baseUrl, preservedParams } = client.parseWFSUrl(
      'https://energieatlas.berlin.de/public/ogcsl.ashx?nodeId=255&Service=WFS&request=GetCapabilities'
    );
    const result = await client.getFeatures(baseUrl, 'cls:L185', {}, preservedParams);

    const url = new URL(get.mock.calls[0][0] as string);
    expect(url.searchParams.get('OUTPUTFORMAT')).toBe('application/geo+json');
    expect(url.searchParams.get('nodeId')).toBe('255');
    expect(result.type).toBe('FeatureCollection');
  });
});

describe('WFSClient error handling', () => {
  const baseUrl = 'https://gdi.berlin.de/services/wfs/kita';

  it('passes on HTTP status and OGC exception text', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(
      httpError(
        400,
        '<ows:ExceptionReport><ows:Exception><ows:ExceptionText>Feature type kita:nope unknown</ows:ExceptionText></ows:Exception></ows:ExceptionReport>'
      )
    );
    const error = await new WFSClient().getFeatures(baseUrl, 'kita:nope').catch((e) => e);

    expect(error).toBeInstanceOf(WFSServiceError);
    expect(error.message).toBe('GetFeature failed with HTTP 400: Feature type kita:nope unknown');
    expect(isClientSafeWFSError(error)).toBe(true);
  });

  it('passes on redirects as HTTP status', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(httpError(302, ''));
    const error = await new WFSClient().getCapabilities(baseUrl).catch((e) => e);

    expect(error).toBeInstanceOf(WFSServiceError);
    expect(error.message).toBe('GetCapabilities failed with HTTP 302');
  });

  it('reports exceptions returned with HTTP 200 and an XML body', async () => {
    mockGet({
      data: '<ServiceExceptionReport><ServiceException code="x">Unsupported GetFeature Format</ServiceException></ServiceExceptionReport>',
      headers: { 'content-type': 'text/xml' },
    });
    const error = await new WFSClient().getFeatures(baseUrl, 'kita:kita').catch((e) => e);

    expect(error).toBeInstanceOf(WFSServiceError);
    expect(error.message).toBe('GetFeature returned text/xml instead of JSON: Unsupported GetFeature Format');
  });

  it('does not mark network errors as client-safe', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(new AxiosError('connect ECONNREFUSED 10.0.0.1:443', 'ECONNREFUSED'));
    const error = await new WFSClient().getFeatures(baseUrl, 'kita:kita').catch((e) => e);

    expect(isClientSafeWFSError(error)).toBe(false);
  });
});
