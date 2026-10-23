// ABOUTME: Tests for the list/get/update/delete visualization tools via an in-memory MCP client
// ABOUTME: DatawrapperClient methods are stubbed, so no real Datawrapper API calls are made

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DatawrapperMCPServer } from '../index.js';
import { DatawrapperApiError, DatawrapperClient } from '../datawrapper-client.js';
import { ChartLogger } from '../chart-logger.js';
import { DatawrapperChart } from '../types.js';

const API_KEY = 'test-token';
// Tiny stand-in for an exported PNG (preview images are attached to create/update/publish responses)
const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');

async function setup(): Promise<Client> {
  const server = new DatawrapperMCPServer(path.join(os.tmpdir(), `dw-test-${Date.now()}.ndjson`));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: any): string {
  return result.content.map((c: any) => c.text).join('\n');
}

function chart(overrides: Partial<DatawrapperChart> = {}): DatawrapperChart {
  return {
    id: 'abc12',
    title: 'Population by District',
    type: 'd3-bars',
    metadata: {
      describe: { intro: 'Intro text', byline: 'TSB', 'source-name': 'Berlin Open Data', 'source-url': 'https://daten.berlin.de' },
      visualize: { 'base-color': '#2A7FFF', 'thick': false, 'unrelated-setting': 1 },
      axes: { x: 'district' },
    },
    createdAt: '2026-10-01T10:00:00.000Z',
    lastModifiedAt: '2026-10-02T11:30:00.000Z',
    publishedAt: null,
    publicVersion: 0,
    publicId: 'abc12',
    publicUrl: null,
    folderId: null,
    ...overrides,
  };
}

const publishedChart = () => chart({
  publishedAt: '2026-10-03T09:00:00.000Z',
  publicVersion: 2,
  publicUrl: 'https://datawrapper.dwcdn.net/abc12/2/',
  metadata: { visualize: { 'base-color': '#2A7FFF' }, publish: { 'embed-height': 480 } },
});

let client: Client;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(ChartLogger.prototype, 'logChart').mockResolvedValue();
  // Never hit the network for previews; individual tests override this
  vi.spyOn(DatawrapperClient.prototype, 'exportPng').mockResolvedValue(PNG_BYTES);
  client = await setup();
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
});

describe('tool registration', () => {
  it('registers all seven tools with annotations', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));

    expect(Object.keys(byName).sort()).toEqual([
      'create_visualization',
      'delete_visualization',
      'export_visualization_png',
      'get_visualization',
      'list_visualizations',
      'publish_visualization',
      'update_visualization',
    ]);
    expect(byName.list_visualizations.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_visualization.annotations?.readOnlyHint).toBe(true);
    expect(byName.delete_visualization.annotations?.destructiveHint).toBe(true);
    expect(byName.update_visualization.annotations?.readOnlyHint).toBe(false);
    expect(byName.create_visualization.annotations?.destructiveHint).toBe(false);
    expect(byName.publish_visualization.annotations?.openWorldHint).toBe(true);
    expect(byName.export_visualization_png.annotations?.readOnlyHint).toBe(true);
    expect(byName.delete_visualization.description).toMatch(/explicit confirmation/);
  });
});

describe('list_visualizations', () => {
  it('formats charts and adds a pagination hint when more results exist', async () => {
    const listSpy = vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockResolvedValue({
      total: 30,
      list: [
        { ...publishedChart(), metadata: undefined },
        { ...chart({ id: 'xyz34', title: '', type: 'd3-lines', folderId: 7 }), metadata: undefined },
      ],
    });

    const result: any = await client.callTool({
      name: 'list_visualizations',
      arguments: { api_key: API_KEY, search: 'District', limit: 2, offset: 10 },
    });
    const text = textOf(result);

    expect(result.isError).toBeFalsy();
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ search: 'District', limit: 2, offset: 10 }));
    expect(text).toContain('charts 11-12 of 30');
    expect(text).toContain('**Population by District** - `abc12` · d3-bars');
    expect(text).toContain('🌍 Published: https://datawrapper.dwcdn.net/abc12/2/');
    expect(text).toContain('**(untitled)** - `xyz34`');
    expect(text).toContain('📝 Not published');
    expect(text).toContain('📁 Folder: 7');
    expect(text).toContain('https://app.datawrapper.de/chart/xyz34/visualize');
    expect(text).toContain('`offset: 12`');
  });

  it('uses the default limit and omits the hint on the last page', async () => {
    const listSpy = vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockResolvedValue({
      total: 1,
      list: [{ ...chart(), metadata: undefined }],
    });

    const result: any = await client.callTool({ name: 'list_visualizations', arguments: { api_key: API_KEY } });

    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
    expect(textOf(result)).not.toContain('More charts available');
  });

  it('caps large limits', async () => {
    const listSpy = vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockResolvedValue({ total: 0, list: [] });
    await client.callTool({ name: 'list_visualizations', arguments: { api_key: API_KEY, limit: 1000 } });
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it('reports an empty result', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockResolvedValue({ total: 0, list: [] });
    const result: any = await client.callTool({ name: 'list_visualizations', arguments: { api_key: API_KEY, published: true } });
    expect(textOf(result)).toContain('No charts found');
  });

  it('rejects a missing api_key through schema validation', async () => {
    const result: any = await client.callTool({ name: 'list_visualizations', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Input validation error/);
  });

  it('returns API errors as tool errors', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockRejectedValue(new DatawrapperApiError('Datawrapper authentication failed. Please check your API token.', 401));
    const result: any = await client.callTool({ name: 'list_visualizations', arguments: { api_key: API_KEY } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('❌ Datawrapper authentication failed');
  });

  it('does not repeat the "Failed to list charts" prefix of client errors', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockRejectedValue(new DatawrapperApiError('Failed to list charts: boom', 500));
    const result: any = await client.callTool({ name: 'list_visualizations', arguments: { api_key: API_KEY } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('❌ Failed to list charts: boom');
  });

  it('filters unpublished charts locally when published is false', async () => {
    const listSpy = vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockResolvedValue({
      total: 40,
      list: [
        { ...publishedChart(), metadata: undefined },
        { ...chart({ id: 'xyz34', title: 'Draft' }), metadata: undefined },
      ],
    });

    const result: any = await client.callTool({ name: 'list_visualizations', arguments: { api_key: API_KEY, published: false, limit: 2 } });
    const text = textOf(result);

    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ published: undefined }));
    expect(text).toContain('**Draft** - `xyz34`');
    expect(text).not.toContain('`abc12`');
    expect(text).toContain('applied locally to this page only: 1 of the 2 charts');
    expect(text).toContain('`offset: 2`');
  });
});

describe('get_visualization', () => {
  it('shows metadata, description and key settings of an unpublished chart', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const dataSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartData');

    const result: any = await client.callTool({ name: 'get_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });
    const text = textOf(result);

    expect(result.isError).toBeFalsy();
    expect(text).toContain('**Population by District**');
    expect(text).toContain('🆔 **Chart ID**: abc12');
    expect(text).toContain('📝 **Status**: Not published');
    expect(text).toContain('**Description**: Intro text');
    expect(text).toContain('**Source**: Berlin Open Data (https://daten.berlin.de)');
    expect(text).toContain('`base-color`: "#2A7FFF"');
    expect(text).not.toContain('unrelated-setting');
    expect(text).toContain('**Axes:** {"x":"district"}');
    expect(text).not.toContain('Embed code');
    expect(dataSpy).not.toHaveBeenCalled();
  });

  it('shows public URL and embed code for a published chart', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(publishedChart());

    const result: any = await client.callTool({ name: 'get_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });
    const text = textOf(result);

    expect(text).toContain('Published (version 2');
    expect(text).toContain('👁️ **View**: https://datawrapper.dwcdn.net/abc12/2/');
    expect(text).toContain('id="datawrapper-chart-abc12"');
    expect(text).toContain('height="480"');
  });

  it('prefers the official embed code from metadata.publish["embed-codes"]', async () => {
    const official = '<iframe title="Population by District" aria-label="Bar Chart" id="datawrapper-chart-abc12" src="https://datawrapper.dwcdn.net/abc12/2/"></iframe>';
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({
      ...publishedChart(),
      metadata: { publish: { 'embed-height': 480, 'embed-codes': { 'embed-method-responsive': official } } },
    }));

    const result: any = await client.callTool({ name: 'get_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });
    const text = textOf(result);

    expect(text).toContain(official);
    expect(text).not.toContain('aria-label="Map"');
  });

  it('includes truncated data when include_data is set', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const csv = ['district,population', ...Array.from({ length: 80 }, (_, i) => `D${i},${i}`)].join('\n');
    const dataSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartData').mockResolvedValue(csv);

    const result: any = await client.callTool({ name: 'get_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', include_data: true } });
    const text = textOf(result);

    expect(dataSpy).toHaveBeenCalledWith('abc12');
    expect(text).toContain('**Data:**');
    expect(text).toContain('district,population\nD0,0');
    expect(text).toContain('D48,48');
    expect(text).not.toContain('D49,49');
    expect(text).toContain('Truncated');
  });

  it('includes raw metadata when include_metadata is set', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const result: any = await client.callTool({ name: 'get_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', include_metadata: true } });
    expect(textOf(result)).toContain('"unrelated-setting": 1');
  });

  it('reports a missing chart', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockRejectedValue(new DatawrapperApiError('Chart not found (ID: zzz99). It may have been deleted, or your API token has no access to it.', 404));
    const result: any = await client.callTool({ name: 'get_visualization', arguments: { api_key: API_KEY, chart_id: 'zzz99' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('❌ Chart not found (ID: zzz99)');
  });
});

describe('update_visualization', () => {
  it('requires at least one change', async () => {
    const infoSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartInfo');
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart');

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', visualize_overrides: {} },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No changes specified');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('patches only the changed keys, merging visualize_overrides with base_color', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockImplementation(async (_id, update) => ({ ...chart(), ...update } as DatawrapperChart));
    const createSpy = vi.spyOn(DatawrapperClient.prototype, 'createChart');
    const uploadSpy = vi.spyOn(DatawrapperClient.prototype, 'uploadData');

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: {
        api_key: API_KEY,
        chart_id: 'abc12',
        title: 'New title',
        description: 'New intro',
        base_color: '#E63946',
        visualize_overrides: { 'custom-colors': { Mitte: '#000000' }, 'show-color-key': true },
      },
    });
    const text = textOf(result);

    expect(result.isError).toBeFalsy();
    expect(updateSpy).toHaveBeenCalledWith('abc12', {
      title: 'New title',
      metadata: {
        describe: { intro: 'New intro' },
        visualize: { 'base-color': '#E63946', 'custom-colors': { Mitte: '#000000' }, 'show-color-key': true },
      },
    });
    expect(createSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(text).toContain('🆔 **Chart ID**: abc12 (unchanged)');
    expect(text).toContain('https://app.datawrapper.de/chart/abc12/visualize');
    expect(text).toContain('Title → "New title"');
    expect(text).toContain('`base-color` → "#E63946"');
    expect(text).toContain('Do NOT publish automatically');
    expect(text).not.toContain('already published');
  });

  it('lets visualize_overrides win over base_color, as in create_visualization', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());

    await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', base_color: '#111111', visualize_overrides: { 'base-color': '#222222' } },
    });

    expect(updateSpy).toHaveBeenCalledWith('abc12', { metadata: { visualize: { 'base-color': '#222222' } } });
  });

  it('warns that a published chart needs republishing and does not publish', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(publishedChart());
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(publishedChart());
    const publishSpy = vi.spyOn(DatawrapperClient.prototype, 'publishChart');

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', base_color: '#E63946' },
    });
    const text = textOf(result);

    expect(publishSpy).not.toHaveBeenCalled();
    expect(text).toContain('This chart is already published');
    expect(text).toContain('https://datawrapper.dwcdn.net/abc12/2/');
    expect(text).toContain('Do NOT republish automatically');
    expect(text).toContain('publish_visualization');
  });

  it('changes chart type and variant via the Datawrapper type map', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({ type: 'column-chart' }));
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart({ type: 'stacked-column-chart' }));

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', chart_type: 'column', variant: 'stacked' },
    });

    // Stacked/grouped column charts need transposed data so the first column stays on the x-axis
    expect(updateSpy).toHaveBeenCalledWith('abc12', { type: 'stacked-column-chart', metadata: { data: { transpose: true } } });
    expect(textOf(result)).toContain('Type → stacked-column-chart (was column-chart)');
    expect(textOf(result)).toContain('Transpose → true');
  });

  it('resets transpose when leaving a grouped/stacked column chart', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({ type: 'grouped-column-chart' }));
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart({ type: 'd3-lines' }));

    await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', chart_type: 'line' },
    });

    expect(updateSpy).toHaveBeenCalledWith('abc12', { type: 'd3-lines', metadata: { data: { transpose: false } } });
  });

  it('maps base_color to the choropleth color scale and symbol color', async () => {
    const getSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartInfo');
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());

    getSpy.mockResolvedValueOnce(chart({ type: 'd3-maps-choropleth' }));
    await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', base_color: '#2E7D32' } });
    expect(updateSpy.mock.calls[0][1].metadata?.visualize).toEqual({
      'base-color': '#2E7D32',
      colorscale: { colors: [{ color: '#e0ece0', position: 0 }, { color: '#2E7D32', position: 1 }] },
    });

    getSpy.mockResolvedValueOnce(chart({ type: 'd3-maps-choropleth' }));
    await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', color_scale: ['#ffffff', '#888888', '#000000'] } });
    expect(updateSpy.mock.calls[1][1].metadata?.visualize?.colorscale).toEqual({
      colors: [{ color: '#ffffff', position: 0 }, { color: '#888888', position: 0.5 }, { color: '#000000', position: 1 }],
    });

    getSpy.mockResolvedValueOnce(chart({ type: 'd3-maps-symbols' }));
    await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', base_color: '#FF6B00' } });
    expect(updateSpy.mock.calls[2][1].metadata?.visualize).toEqual({ 'base-color': '#FF6B00', 'symbol-color': '#FF6B00' });
  });

  it('sets the range end color via secondary_color and warns for other types', async () => {
    const getSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartInfo');
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());

    getSpy.mockResolvedValueOnce(chart({ type: 'd3-range-plot' }));
    await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', secondary_color: '#FF6B00' } });
    expect(updateSpy.mock.calls[0][1].metadata?.visualize).toEqual({ 'base-color2': '#FF6B00' });

    getSpy.mockResolvedValueOnce(chart({ type: 'd3-bars' }));
    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', secondary_color: '#FF6B00', title: 'T' } });
    expect(updateSpy.mock.calls[1][1].metadata).toBeUndefined();
    expect(textOf(result)).toContain('secondary_color only applies to range plots');
  });

  it('sets language, folder, notes and per-column number formats', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'getChartData').mockResolvedValue('district,population,share\nMitte,397000,"1,5"\nPankow,424000,2\n');
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: {
        api_key: API_KEY, chart_id: 'abc12', language: 'de-DE', folder_id: 42, notes: 'Stand: 2025',
        number_append: ' Pers.', number_divisor: 3,
      },
    });

    expect(updateSpy).toHaveBeenCalledWith('abc12', {
      language: 'de-DE',
      folderId: 42,
      metadata: {
        data: { 'column-format': { population: { type: 'number', 'number-append': ' Pers.', 'number-divisor': 3 } } },
        annotate: { notes: 'Stand: 2025' },
      },
    });
    expect(textOf(result)).toContain('Language → de-DE');
    expect(textOf(result)).toContain('for column(s): population');
  });

  it('rejects number_columns without a number format option', async () => {
    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', number_columns: ['population'], title: 'T' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('number_columns needs at least one of');
  });

  it('keeps the current variant when chart_type is passed without a variant', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({ type: 'd3-bars-stacked' }));
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart({ type: 'd3-bars-stacked' }));

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', chart_type: 'bar', base_color: '#ff0000' },
    });

    expect(updateSpy).toHaveBeenCalledWith('abc12', { metadata: { visualize: { 'base-color': '#ff0000' } } });
    expect(textOf(result)).toContain('Type unchanged (already d3-bars-stacked)');
  });

  it('refuses to switch between symbol and choropleth maps', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({ type: 'd3-maps-choropleth' }));
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart');

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', chart_type: 'map', map_type: 'd3-maps-symbols' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Cannot change the map type from d3-maps-choropleth to d3-maps-symbols');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('treats locator maps as maps and refuses to replace their data', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({ type: 'locator-map' }));
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart');
    const uploadSpy = vi.spyOn(DatawrapperClient.prototype, 'uploadData');

    const toBar: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', chart_type: 'bar' },
    });
    expect(toBar.isError).toBe(true);
    expect(textOf(toBar)).toContain('Cannot convert a map (locator-map)');

    const newData: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', data: [{ name: 'A', value: 1 }] },
    });
    expect(newData.isError).toBe(true);
    expect(textOf(newData)).toContain('Replacing data is not supported for locator-map');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('passes {} and null in visualize_overrides through to the PATCH body', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());

    await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', visualize_overrides: { 'custom-colors': {}, 'highlighted-series': null } },
    });

    expect(updateSpy).toHaveBeenCalledWith('abc12', { metadata: { visualize: { 'custom-colors': {}, 'highlighted-series': null } } });
  });

  it('reports a partial update when the data upload fails after the PATCH', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart({ title: 'New title' }));
    vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockRejectedValue(new DatawrapperApiError('Rate limit exceeded. Please try again in a few moments.', 429));

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: {
        api_key: API_KEY,
        chart_id: 'abc12',
        title: 'New title',
        data: [{ district: 'Mitte', population: 380000 }],
      },
    });
    const text = textOf(result);

    expect(updateSpy).toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(text).toContain('only partly updated');
    expect(text).toContain('Title → "New title"');
    expect(text).toContain('The data was NOT replaced: Rate limit exceeded');
    expect(text).toContain('only `chart_id` and `data`');
  });

  it('rejects chart IDs that could change the request path before calling the API', async () => {
    const infoSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartInfo');
    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: '../folders/12', title: 'x' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/5-character Datawrapper chart ID/);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('refuses to convert a chart into a map', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart');

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', chart_type: 'map', map_type: 'd3-maps-symbols' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Cannot convert a chart');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('replaces data after validating it against the chart type', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart');
    const uploadSpy = vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockResolvedValue();

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: {
        api_key: API_KEY,
        chart_id: 'abc12',
        data: [{ district: 'Mitte', population: 380000 }, { district: 'Pankow', population: 410000 }],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(uploadSpy).toHaveBeenCalledWith('abc12', 'district,population\nMitte,380000\nPankow,410000');
    expect(textOf(result)).toContain('Data replaced (2 rows)');
  });

  it('rejects data that does not fit the chart type without writing anything', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart');
    const uploadSpy = vi.spyOn(DatawrapperClient.prototype, 'uploadData');

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', title: 'x', data: [{ district: 'Mitte', label: 'no numbers' }] },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No numeric columns found');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('pads Bezirk IDs and checks columns when replacing choropleth data', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({
      type: 'd3-maps-choropleth',
      metadata: {
        visualize: { basemap: 'berlin-boroughs', 'map-key-attr': 'Gemeinde_s' },
        axes: { keys: 'BEZ_ID', values: 'population' },
      },
    }));
    const uploadSpy = vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockResolvedValue();

    await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', data: [{ BEZ_ID: '01', population: 380000 }] },
    });
    expect(uploadSpy).toHaveBeenCalledWith('abc12', 'BEZ_ID,population\n001,380000');

    const missing: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'abc12', data: [{ region: 'Mitte', population: 380000 }] },
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('must contain the column(s): BEZ_ID');
  });
});

describe('delete_visualization', () => {
  it('looks the chart up and reports its title after deleting', async () => {
    const infoSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const deleteSpy = vi.spyOn(DatawrapperClient.prototype, 'deleteChart').mockResolvedValue();

    const result: any = await client.callTool({ name: 'delete_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });
    const text = textOf(result);

    expect(result.isError).toBeFalsy();
    expect(infoSpy).toHaveBeenCalledWith('abc12');
    expect(deleteSpy).toHaveBeenCalledWith('abc12');
    expect(text).toContain('Chart deleted: **Population by District** (ID: abc12)');
    expect(text).toContain('30 days');
    expect(text).not.toContain('was published');
  });

  it('mentions that a published chart may still be reachable', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(publishedChart());
    vi.spyOn(DatawrapperClient.prototype, 'deleteChart').mockResolvedValue();

    const result: any = await client.callTool({ name: 'delete_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });
    expect(textOf(result)).toContain('This chart was published');
  });

  it('reports "chart not found" and does not call delete', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockRejectedValue(new DatawrapperApiError('Chart not found (ID: zzz99). It may have been deleted, or your API token has no access to it.', 404));
    const deleteSpy = vi.spyOn(DatawrapperClient.prototype, 'deleteChart');

    const result: any = await client.callTool({ name: 'delete_visualization', arguments: { api_key: API_KEY, chart_id: 'zzz99' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('❌ Chart not found (ID: zzz99)');
    expect(textOf(result)).toContain('Nothing was deleted.');
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('reports other delete failures', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'deleteChart').mockRejectedValue(new DatawrapperApiError('Permission denied: could not delete chart. Make sure your API token has the chart:write scope and that you have access to chart abc12.', 403));

    const result: any = await client.callTool({ name: 'delete_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('❌ Permission denied: could not delete chart');
  });

  it('does not repeat the "Failed to" prefix of client errors', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'deleteChart').mockRejectedValue(new DatawrapperApiError('Failed to delete chart: boom', 500));

    const result: any = await client.callTool({ name: 'delete_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('❌ Failed to delete chart: boom');
  });

  it.each(['../folders/123', 'abcde?permanent=true'])('rejects the unsafe chart ID %s without looking up or deleting anything', async (badId) => {
    const infoSpy = vi.spyOn(DatawrapperClient.prototype, 'getChartInfo');
    const deleteSpy = vi.spyOn(DatawrapperClient.prototype, 'deleteChart');

    const result: any = await client.callTool({ name: 'delete_visualization', arguments: { api_key: API_KEY, chart_id: badId } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/5-character Datawrapper chart ID/);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('publish_visualization', () => {
  it('uses publicId, url and version from the { data, version, url } publish response', async () => {
    const postSpy = vi.spyOn(DatawrapperClient.prototype, 'publishChart').mockResolvedValue({
      chart: chart({ publicId: 'f00ba12hash' }),
      version: 3,
      url: 'https://datawrapper.dwcdn.net/f00ba12hash/3/',
    });

    const result: any = await client.callTool({ name: 'publish_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12' } });
    const text = textOf(result);

    expect(postSpy).toHaveBeenCalledWith('abc12');
    expect(result.isError).toBeFalsy();
    expect(text).toContain('Chart published (version 3)');
    expect(text).toContain('👁️ **View**: https://datawrapper.dwcdn.net/f00ba12hash/3/');
    expect(text).toContain('[CHART:f00ba12hash]');
    expect(text).toContain('id="datawrapper-chart-f00ba12hash"');
  });
});

describe('create_visualization styling', () => {
  it('transposes grouped column charts and passes language, folder, notes and number formats', async () => {
    const createSpy = vi.spyOn(DatawrapperClient.prototype, 'createChart').mockResolvedValue(chart({ id: 'new01', type: 'grouped-column-chart' }));
    vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockResolvedValue();

    const result: any = await client.callTool({
      name: 'create_visualization',
      arguments: {
        api_key: API_KEY,
        chart_type: 'column',
        variant: 'grouped',
        data: [{ jahr: '2021', online: 5, offline: 7 }, { jahr: '2022', online: 8, offline: 3 }],
        title: 'Kanäle',
        language: 'de-DE',
        folder_id: 7,
        notes: 'Testnotiz',
        number_append: ' %',
      },
    });

    expect(result.isError).toBeFalsy();
    const [type, metadata, title, options] = createSpy.mock.calls[0];
    expect(type).toBe('grouped-column-chart');
    expect(title).toBe('Kanäle');
    expect(options).toEqual({ language: 'de-DE', folderId: 7 });
    expect(metadata?.data).toEqual({
      transpose: true,
      'column-format': {
        online: { type: 'number', 'number-append': ' %' },
        offline: { type: 'number', 'number-append': ' %' },
      },
    });
    expect(metadata?.annotate).toEqual({ notes: 'Testnotiz' });
  });

  it('colors choropleth maps with a gradient of base_color', async () => {
    const createSpy = vi.spyOn(DatawrapperClient.prototype, 'createChart').mockResolvedValue(chart({ id: 'map01', type: 'd3-maps-choropleth' }));
    vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockResolvedValue();

    await client.callTool({
      name: 'create_visualization',
      arguments: {
        api_key: API_KEY,
        chart_type: 'map',
        map_type: 'd3-maps-choropleth',
        basemap: 'berlin-boroughs',
        base_color: '#2E7D32',
        data: [{ bezirk: 'Mitte', wert: 1 }, { bezirk: 'Pankow', wert: 2 }],
      },
    });

    const metadata: any = createSpy.mock.calls[0][1];
    expect(metadata.visualize.colorscale).toEqual({ colors: [{ color: '#e0ece0', position: 0 }, { color: '#2E7D32', position: 1 }] });
  });
});

describe('folder and team errors', () => {
  it('reports an unknown folder instead of "chart not found" on update', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockRejectedValue(new DatawrapperApiError('Chart not found (ID: abc12).', 404));

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', folder_id: 1 } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Folder 1 was not found or your API token has no access to it, so the chart was not updated');
    expect(textOf(result)).not.toContain('Chart not found');
  });

  it('keeps "chart not found" when no folder is involved', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockRejectedValue(new DatawrapperApiError('Chart not found (ID: abc12).', 404));

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', title: 'T' } });

    expect(textOf(result)).toContain('Chart not found');
  });

  it('reports missing team access on list', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'listCharts').mockRejectedValue(new DatawrapperApiError('Permission denied: could not list charts.', 403));

    const result: any = await client.callTool({ name: 'list_visualizations', arguments: { api_key: API_KEY, team_id: 'nope' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No access to team "nope"');
  });
});

describe('PNG previews', () => {
  it('attaches a preview image to update responses', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());
    const exportSpy = vi.spyOn(DatawrapperClient.prototype, 'exportPng').mockResolvedValue(PNG_BYTES);

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', base_color: '#000000' } });

    expect(exportSpy).toHaveBeenCalledWith('abc12', { zoom: 1, timeoutMs: 15000 });
    expect(result.content[1]).toEqual({ type: 'image', data: PNG_BYTES.toString('base64'), mimeType: 'image/png' });
  });

  it('attaches previews to create and publish responses', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'createChart').mockResolvedValue(chart({ id: 'new01' }));
    vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockResolvedValue();
    vi.spyOn(DatawrapperClient.prototype, 'publishChart').mockResolvedValue({ chart: chart({ id: 'new01', publicId: 'new01' }), version: 1 });
    const exportSpy = vi.spyOn(DatawrapperClient.prototype, 'exportPng').mockResolvedValue(PNG_BYTES);

    const created: any = await client.callTool({ name: 'create_visualization', arguments: { api_key: API_KEY, chart_type: 'bar', data: [{ a: 'x', b: 1 }] } });
    const published: any = await client.callTool({ name: 'publish_visualization', arguments: { api_key: API_KEY, chart_id: 'new01' } });

    expect(exportSpy).toHaveBeenCalledTimes(2);
    expect(created.content[1].type).toBe('image');
    expect(published.content[1].type).toBe('image');
  });

  it('skips the preview when preview is false', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());
    const exportSpy = vi.spyOn(DatawrapperClient.prototype, 'exportPng');

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', title: 'T', preview: false } });

    expect(exportSpy).not.toHaveBeenCalled();
    expect(result.content).toHaveLength(1);
  });

  it('still succeeds with a note when the preview export fails', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'exportPng').mockRejectedValue(new DatawrapperApiError('Failed to export chart as PNG: timeout of 15000ms exceeded'));

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', title: 'T' } });

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(textOf(result)).toContain('Chart updated in place');
    expect(textOf(result)).toContain('No preview image: Failed to export chart as PNG');
  });

  it('skips oversized previews', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'exportPng').mockResolvedValue(Buffer.alloc(1_000_001));

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'abc12', title: 'T' } });

    expect(result.content).toHaveLength(1);
    expect(textOf(result)).toContain('too large');
  });
});

describe('export_visualization_png', () => {
  it('passes export options and returns the image', async () => {
    const exportSpy = vi.spyOn(DatawrapperClient.prototype, 'exportPng').mockResolvedValue(PNG_BYTES);

    const result: any = await client.callTool({
      name: 'export_visualization_png',
      arguments: { api_key: API_KEY, chart_id: 'abc12', width: 800, plain: true, transparent: true, border_width: 10, border_color: '#ffffff' },
    });

    expect(exportSpy).toHaveBeenCalledWith('abc12', { width: 800, height: undefined, plain: true, zoom: 2, transparent: true, borderWidth: 10, borderColor: '#ffffff' });
    expect(result.content[1]).toEqual({ type: 'image', data: PNG_BYTES.toString('base64'), mimeType: 'image/png' });
  });

  it('rejects invalid chart IDs and zoom values before calling the API', async () => {
    const exportSpy = vi.spyOn(DatawrapperClient.prototype, 'exportPng');

    const badId: any = await client.callTool({ name: 'export_visualization_png', arguments: { api_key: API_KEY, chart_id: '../x' } });
    const badZoom: any = await client.callTool({ name: 'export_visualization_png', arguments: { api_key: API_KEY, chart_id: 'abc12', zoom: 10 } });

    expect(badId.isError).toBe(true);
    expect(badZoom.isError).toBe(true);
    expect(exportSpy).not.toHaveBeenCalled();
  });
});
