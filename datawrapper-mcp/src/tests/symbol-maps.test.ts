// ABOUTME: Tests for symbol maps: GeoJSON property preservation and color/size column settings
// ABOUTME: Covers ChartBuilder.geoJSONToRows, buildSymbolColumnSettings and the create/update tool flows

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DatawrapperMCPServer } from '../index.js';
import { DatawrapperClient } from '../datawrapper-client.js';
import { ChartBuilder } from '../chart-builder.js';
import { ChartLogger } from '../chart-logger.js';
import { buildSymbolColumnSettings, parseDelimited } from '../style-options.js';
import { DatawrapperChart, GeoJSON } from '../types.js';

const API_KEY = 'test-token';

function point(lon: number, lat: number, properties: Record<string, any>) {
  return { type: 'Feature' as const, geometry: { type: 'Point', coordinates: [lon, lat] }, properties };
}

const STATIONS: GeoJSON = {
  type: 'FeatureCollection',
  features: [
    point(13.4147, 52.5169, { name: 'FW Mitte', typ: 'Feuerwache', adresse: 'Voltairestr. 2, 10179 Berlin', mitarbeitende: 80 }),
    point(13.3347, 52.5079, { name: 'RW Zoo', typ: 'Rettungswache', mitarbeitende: 25 }),
    point(13.4019, 52.4734, { name: 'FW Tempelhof', typ: 'Feuerwache', mitarbeitende: 60, plz: '12101' }),
  ],
};

describe('ChartBuilder.geoJSONToRows / processGeoJSON', () => {
  const builder = new ChartBuilder();

  it('keeps all feature properties as columns, plus latitude/longitude', () => {
    const { columns, rows, skipped } = builder.geoJSONToRows(STATIONS);

    expect(columns).toEqual(['name', 'typ', 'adresse', 'mitarbeitende', 'plz', 'latitude', 'longitude']);
    expect(rows[0]).toMatchObject({ name: 'FW Mitte', typ: 'Feuerwache', latitude: 52.5169, longitude: 13.4147 });
    expect(skipped).toBe(0);
  });

  it('writes a CSV with every column, quoting values with commas and leaving missing values empty', () => {
    const csv = builder.processGeoJSON(STATIONS, 'd3-maps-symbols').split('\n');

    expect(csv[0]).toBe('name,typ,adresse,mitarbeitende,plz,latitude,longitude');
    expect(csv[1]).toBe('FW Mitte,Feuerwache,"Voltairestr. 2, 10179 Berlin",80,,52.5169,13.4147');
    expect(csv[2]).toBe('RW Zoo,Rettungswache,,25,,52.5079,13.3347');
  });

  it('handles numeric names, nested values and skips non-point features', () => {
    const geojson: GeoJSON = {
      type: 'FeatureCollection',
      features: [
        point(13.4, 52.5, { name: 42, tags: { a: 1 } }),
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[13.4, 52.5], [13.5, 52.6]] }, properties: { name: 'Line' } },
      ],
    };
    const { rows, skipped } = builder.geoJSONToRows(geojson);

    expect(rows).toEqual([{ name: 42, tags: '{"a":1}', latitude: 52.5, longitude: 13.4 }]);
    expect(skipped).toBe(1);
  });

  it('throws when there are no point features', () => {
    const geojson: GeoJSON = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} }],
    };
    expect(() => builder.geoJSONToRows(geojson)).toThrow('Point features');
  });
});

describe('buildSymbolColumnSettings', () => {
  const table = new ChartBuilder().geoJSONToRows(STATIONS);

  it('colors by category for a text column, in data order, with custom colors', () => {
    const result = buildSymbolColumnSettings({ color_column: 'typ', category_colors: { Feuerwache: '#e41a1c' } }, table);

    expect(result.axes).toEqual({ values: 'typ' });
    expect(result.visualize.colorscale).toEqual({
      mode: 'categories',
      map: { Feuerwache: '#e41a1c' },
      categoryOrder: ['Feuerwache', 'Rettungswache'],
    });
    expect(result.warnings).toEqual([]);
  });

  it('warns about unknown categories and rejects invalid colors', () => {
    expect(buildSymbolColumnSettings({ color_column: 'typ', category_colors: { Polizei: '#000000' } }, table).warnings[0])
      .toContain('"Polizei" does not occur');
    expect(() => buildSymbolColumnSettings({ color_column: 'typ', category_colors: { Feuerwache: 'red' } }, table))
      .toThrow('hex color');
  });

  it('uses a gradient for a numeric column (from color_scale or base_color)', () => {
    expect(buildSymbolColumnSettings({ color_column: 'mitarbeitende', color_scale: ['#ffffff', '#000000'] }, table).visualize.colorscale)
      .toEqual({ mode: 'continuous', colors: [{ color: '#ffffff', position: 0 }, { color: '#000000', position: 1 }] });
    expect(buildSymbolColumnSettings({ color_column: 'mitarbeitende', base_color: '#000000' }, table).visualize.colorscale.colors[1])
      .toEqual({ color: '#000000', position: 1 });
  });

  it('sets the size column and validates columns', () => {
    expect(buildSymbolColumnSettings({ size_column: 'mitarbeitende' }, table).axes).toEqual({ area: 'mitarbeitende' });
    expect(() => buildSymbolColumnSettings({ size_column: 'typ' }, table)).toThrow('must be a numeric column');
    expect(() => buildSymbolColumnSettings({ color_column: 'nope' }, table)).toThrow('Available columns: name, typ');
  });

  it('detects numeric columns in stored CSV data', () => {
    const stored = parseDelimited('name,typ,wert,latitude,longitude\nA,Feuerwache,10,52.5,13.4\nB,Polizei,2.5,52.4,13.3\n');
    expect(buildSymbolColumnSettings({ color_column: 'wert' }, stored).visualize.colorscale.mode).toBe('continuous');
    expect(buildSymbolColumnSettings({ color_column: 'typ' }, stored).visualize.colorscale.categoryOrder).toEqual(['Feuerwache', 'Polizei']);
  });
});

function chart(overrides: Partial<DatawrapperChart> = {}): DatawrapperChart {
  return { id: 'sym01', title: 'Wachen', type: 'd3-maps-symbols', metadata: { visualize: {}, axes: {} }, ...overrides };
}

describe('symbol map tools', () => {
  let client: Client;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ChartLogger.prototype, 'logChart').mockResolvedValue();
    vi.spyOn(DatawrapperClient.prototype, 'exportPng').mockResolvedValue(Buffer.from('89504e47', 'hex'));
    const server = new DatawrapperMCPServer(path.join(os.tmpdir(), `dw-sym-test-${Date.now()}.ndjson`));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    vi.restoreAllMocks();
  });

  const textOf = (result: any) => result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');

  it('creates a symbol map with all properties uploaded and the color column set', async () => {
    const createSpy = vi.spyOn(DatawrapperClient.prototype, 'createChart').mockResolvedValue(chart());
    const uploadSpy = vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockResolvedValue();

    const result: any = await client.callTool({
      name: 'create_visualization',
      arguments: {
        api_key: API_KEY, chart_type: 'map', map_type: 'd3-maps-symbols', data: STATIONS,
        color_column: 'typ', category_colors: { Feuerwache: '#e41a1c', Rettungswache: '#377eb8' }, size_column: 'mitarbeitende',
      },
    });

    expect(result.isError).toBeFalsy();
    const metadata: any = createSpy.mock.calls[0][1];
    expect(metadata.axes).toEqual({ lat: 'latitude', lon: 'longitude', values: 'typ', area: 'mitarbeitende' });
    expect(metadata.visualize.colorscale).toEqual({
      mode: 'categories',
      map: { Feuerwache: '#e41a1c', Rettungswache: '#377eb8' },
      categoryOrder: ['Feuerwache', 'Rettungswache'],
    });
    expect(uploadSpy.mock.calls[0][1].split('\n')[0]).toBe('name,typ,adresse,mitarbeitende,plz,latitude,longitude');
  });

  it('rejects an unknown color column before creating anything', async () => {
    const createSpy = vi.spyOn(DatawrapperClient.prototype, 'createChart');

    const result: any = await client.callTool({
      name: 'create_visualization',
      arguments: { api_key: API_KEY, chart_type: 'map', map_type: 'd3-maps-symbols', data: STATIONS, color_column: 'kategorie' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('color_column "kategorie" is not a column');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('explains how to repair maps whose stored data lacks the column', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    vi.spyOn(DatawrapperClient.prototype, 'getChartData').mockResolvedValue('name,latitude,longitude\nFW Mitte,52.5169,13.4147\n');
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart');

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'sym01', color_column: 'typ' } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('pass the full GeoJSON as `data` in the same call');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('repairs such a map with data + color_column in one update', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart());
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());
    const uploadSpy = vi.spyOn(DatawrapperClient.prototype, 'uploadData').mockResolvedValue();

    const result: any = await client.callTool({
      name: 'update_visualization',
      arguments: { api_key: API_KEY, chart_id: 'sym01', data: STATIONS, color_column: 'typ', category_colors: { Feuerwache: '#e41a1c' } },
    });

    expect(result.isError).toBeFalsy();
    const patch: any = updateSpy.mock.calls[0][1];
    expect(patch.metadata.axes).toEqual({ lat: 'latitude', lon: 'longitude', values: 'typ' });
    expect(patch.metadata.visualize.colorscale.mode).toBe('categories');
    expect(uploadSpy.mock.calls[0][1]).toContain('typ');
    expect(textOf(result)).toContain('Color column → typ (2 categories');
  });

  it('recolors categories of the current color column with category_colors alone', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({ metadata: { visualize: {}, axes: { lat: 'latitude', lon: 'longitude', values: 'typ' } } }));
    vi.spyOn(DatawrapperClient.prototype, 'getChartData').mockResolvedValue('name,typ,latitude,longitude\nA,Feuerwache,52.5,13.4\nB,Polizei,52.4,13.3\n');
    const updateSpy = vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart());

    await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'sym01', category_colors: { Polizei: '#0000ff' } } });

    const patch: any = updateSpy.mock.calls[0][1];
    expect(patch.metadata.axes).toEqual({ values: 'typ' });
    expect(patch.metadata.visualize.colorscale).toEqual({ mode: 'categories', map: { Polizei: '#0000ff' }, categoryOrder: ['Feuerwache', 'Polizei'] });
  });

  it('warns when symbol options are used on other chart types', async () => {
    vi.spyOn(DatawrapperClient.prototype, 'getChartInfo').mockResolvedValue(chart({ type: 'd3-bars' }));
    vi.spyOn(DatawrapperClient.prototype, 'updateChart').mockResolvedValue(chart({ type: 'd3-bars' }));

    const result: any = await client.callTool({ name: 'update_visualization', arguments: { api_key: API_KEY, chart_id: 'sym01', color_column: 'typ', title: 'T' } });

    expect(textOf(result)).toContain('only apply to symbol maps');
  });
});
