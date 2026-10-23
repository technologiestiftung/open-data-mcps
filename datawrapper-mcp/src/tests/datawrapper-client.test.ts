// ABOUTME: Unit tests for DatawrapperClient request shapes and error mapping
// ABOUTME: axios is mocked, so no real Datawrapper API calls are made

import { describe, it, expect, vi, beforeEach } from 'vitest';

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('axios', () => ({ default: { create: vi.fn(() => http) } }));

import axios from 'axios';
import { DatawrapperApiError, DatawrapperClient } from '../datawrapper-client.js';

function httpError(status: number, message = 'Request failed', data?: any) {
  return Object.assign(new Error(message), { response: { status, data } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DatawrapperClient', () => {
  it('creates an axios instance with base URL and bearer token', () => {
    new DatawrapperClient('tok');
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://api.datawrapper.de/v3',
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
    }));
  });

  describe('listCharts', () => {
    it('calls GET /charts with camelCase query params and drops undefined values', async () => {
      http.get.mockResolvedValue({ data: { list: [], total: 0 } });
      const client = new DatawrapperClient('tok');

      const result = await client.listCharts({
        search: 'Mitte',
        folderId: 12,
        teamId: undefined,
        published: true,
        orderBy: 'lastModifiedAt',
        order: 'DESC',
        limit: 25,
        offset: 50,
      });

      expect(http.get).toHaveBeenCalledWith('/charts', {
        params: { search: 'Mitte', folderId: 12, published: true, orderBy: 'lastModifiedAt', order: 'DESC', limit: 25, offset: 50 },
      });
      expect(result).toEqual({ list: [], total: 0 });
    });

    it('drops published: false, which the API ignores anyway', async () => {
      http.get.mockResolvedValue({ data: { list: [], total: 0 } });
      await new DatawrapperClient('tok').listCharts({ published: false });
      expect(http.get).toHaveBeenCalledWith('/charts', { params: {} });
    });
  });

  it('getChartInfo calls GET /charts/:id', async () => {
    http.get.mockResolvedValue({ data: { id: 'abc12', title: 'T', type: 'd3-bars', metadata: {} } });
    const chart = await new DatawrapperClient('tok').getChartInfo('abc12');
    expect(http.get).toHaveBeenCalledWith('/charts/abc12');
    expect(chart.id).toBe('abc12');
  });

  it('getChartData requests text and returns the raw body', async () => {
    http.get.mockResolvedValue({ data: 'a,b\n1,2' });
    const data = await new DatawrapperClient('tok').getChartData('abc12');
    expect(http.get).toHaveBeenCalledWith('/charts/abc12/data', expect.objectContaining({ responseType: 'text' }));
    expect(data).toBe('a,b\n1,2');
  });

  it('getChartData stringifies non-string bodies', async () => {
    http.get.mockResolvedValue({ data: { type: 'FeatureCollection' } });
    const data = await new DatawrapperClient('tok').getChartData('abc12');
    expect(data).toBe('{"type":"FeatureCollection"}');
  });

  it('updateChart sends a PATCH with only the given fields', async () => {
    const patch = { title: 'New', metadata: { visualize: { 'base-color': '#E63946' } } };
    http.patch.mockResolvedValue({ data: { id: 'abc12', ...patch } });
    const updated = await new DatawrapperClient('tok').updateChart('abc12', patch);
    expect(http.patch).toHaveBeenCalledWith('/charts/abc12', patch);
    expect(updated.title).toBe('New');
  });

  it('createChart sends the title at the top level of the POST body', async () => {
    http.post.mockResolvedValue({ data: { id: 'abc12' } });
    await new DatawrapperClient('tok').createChart('d3-bars', { visualize: {} }, 'My chart');
    expect(http.post).toHaveBeenCalledWith('/charts', { type: 'd3-bars', title: 'My chart', metadata: { visualize: {} } });
  });

  it('publishChart unwraps the { data, version, url } response', async () => {
    http.post.mockResolvedValue({
      data: { data: { id: 'abc12', publicId: 'f00ba12hash', type: 'd3-bars', title: 'T', metadata: {} }, version: 3, url: 'https://datawrapper.dwcdn.net/f00ba12hash/3/' },
    });
    const result = await new DatawrapperClient('tok').publishChart('abc12');
    expect(http.post).toHaveBeenCalledWith('/charts/abc12/publish');
    expect(result.chart.publicId).toBe('f00ba12hash');
    expect(result.version).toBe(3);
    expect(result.url).toBe('https://datawrapper.dwcdn.net/f00ba12hash/3/');
  });

  it.each(['../folders/12', 'abcde?permanent=true', 'abc', 'abc12/data', 'ab%2Fcd'])('rejects the unsafe chart ID %s without any request', async (badId) => {
    const client = new DatawrapperClient('tok');
    await expect(client.deleteChart(badId)).rejects.toThrow(/Invalid chart ID/);
    await expect(client.getChartInfo(badId)).rejects.toThrow(/Invalid chart ID/);
    await expect(client.updateChart(badId, { title: 'x' })).rejects.toThrow(/Invalid chart ID/);
    await expect(client.publishChart(badId)).rejects.toThrow(/Invalid chart ID/);
    await expect(client.uploadData(badId, 'a,b')).rejects.toThrow(/Invalid chart ID/);
    expect(http.delete).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
    expect(http.patch).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
    expect(http.put).not.toHaveBeenCalled();
  });

  it('deleteChart calls DELETE /charts/:id and accepts an empty 204 body', async () => {
    http.delete.mockResolvedValue({ status: 204, data: '' });
    await expect(new DatawrapperClient('tok').deleteChart('abc12')).resolves.toBeUndefined();
    expect(http.delete).toHaveBeenCalledWith('/charts/abc12');
  });

  describe('error mapping', () => {
    it('maps 401 to an authentication error', async () => {
      http.get.mockRejectedValue(httpError(401));
      await expect(new DatawrapperClient('tok').listCharts()).rejects.toThrow('Datawrapper authentication failed. Please check your API token.');
    });

    it('maps 403 to a permission error naming the required scope', async () => {
      http.delete.mockRejectedValue(httpError(403));
      const promise = new DatawrapperClient('tok').deleteChart('abc12');
      await expect(promise).rejects.toThrow(/Permission denied: could not delete chart/);
      await expect(promise).rejects.toThrow(/chart:write/);
    });

    it('names all publish scopes on a 403 from publish', async () => {
      http.post.mockRejectedValue(httpError(403));
      await expect(new DatawrapperClient('tok').publishChart('abc12')).rejects.toThrow(/theme:read and visualization:read/);
    });

    it('maps 404 to "chart not found" and keeps the status', async () => {
      http.get.mockRejectedValue(httpError(404));
      const error = await new DatawrapperClient('tok').getChartInfo('zzz99').catch(e => e);
      expect(error).toBeInstanceOf(DatawrapperApiError);
      expect(error.status).toBe(404);
      expect(error.message).toMatch(/Chart not found \(ID: zzz99\)/);
    });

    it('maps 429 to a rate limit error', async () => {
      http.patch.mockRejectedValue(httpError(429));
      await expect(new DatawrapperClient('tok').updateChart('abc12', { title: 'x' })).rejects.toThrow('Rate limit exceeded. Please try again in a few moments.');
    });

    it('keeps the "Failed to <action>" form for other errors and adds the API message', async () => {
      http.post.mockRejectedValue(httpError(400, 'Request failed with status code 400', { message: 'Invalid type' }));
      await expect(new DatawrapperClient('tok').createChart('nope')).rejects.toThrow('Failed to create chart: Request failed with status code 400 (Invalid type)');
    });

    it('keeps the "Failed to <action>" form for network errors', async () => {
      http.put.mockRejectedValue(new Error('socket hang up'));
      await expect(new DatawrapperClient('tok').uploadData('abc12', 'a,b')).rejects.toThrow('Failed to upload data: socket hang up');
    });
  });
});

describe('DatawrapperClient.exportPng', () => {
  it('requests a PNG in pixels with the given options and timeout', async () => {
    http.get.mockResolvedValue({ data: new Uint8Array([137, 80, 78, 71]).buffer });

    const png = await new DatawrapperClient('tok').exportPng('abc12', { zoom: 1, plain: true, width: undefined, timeoutMs: 15000 });

    expect(http.get).toHaveBeenCalledWith('/charts/abc12/export/png', {
      params: { unit: 'px', zoom: 1, plain: true },
      responseType: 'arraybuffer',
      headers: { 'Accept': 'image/png' },
      timeout: 15000,
    });
    expect(png).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it('maps errors and rejects invalid chart IDs', async () => {
    http.get.mockRejectedValue(httpError(403));
    await expect(new DatawrapperClient('tok').exportPng('abc12')).rejects.toThrow('chart:read');
    await expect(new DatawrapperClient('tok').exportPng('../x')).rejects.toThrow('Invalid chart ID');
  });
});
