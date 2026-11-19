// ABOUTME: Unit tests for cleaning up model-provided data before upload
// ABOUTME: Run with: npm test

import { describe, it, expect } from 'vitest';
import { columnNameToVariable, normalizeNumericStrings } from '../data-normalizer.js';

describe('normalizeNumericStrings', () => {
  it('turns dot-decimal number strings into numbers', () => {
    const data = [{ Bezirk: 'Mitte', Wert: '12.5' }, { Bezirk: 'Pankow', Wert: '1,234.5' }];
    expect(normalizeNumericStrings(data)).toEqual([{ Bezirk: 'Mitte', Wert: 12.5 }, { Bezirk: 'Pankow', Wert: 1234.5 }]);
  });

  it('reads German-formatted columns', () => {
    const data = [{ Bezirk: 'Mitte', Wert: '12,5' }, { Bezirk: 'Pankow', Wert: '1.234,5' }, { Bezirk: 'Spandau', Wert: '7' }];
    expect(normalizeNumericStrings(data).map(row => row.Wert)).toEqual([12.5, 1234.5, 7]);
  });

  it('removes space thousands separators', () => {
    expect(normalizeNumericStrings([{ a: 'x', b: '1 234' }, { a: 'y', b: '12 345,6' }]).map(row => row.b)).toEqual([1234, 12345.6]);
  });

  it('keeps numbers, empty values and mixed columns', () => {
    const data = [{ a: 'x', b: 3, c: 'k.A.' }, { a: 'y', b: null, c: '4' }, { a: 'z', b: '5', c: '6' }];
    expect(normalizeNumericStrings(data)).toEqual([{ a: 'x', b: 3, c: 'k.A.' }, { a: 'y', b: null, c: '4' }, { a: 'z', b: 5, c: '6' }]);
  });

  it('keeps IDs with leading zeros', () => {
    const data = [{ Name: 'Mitte', ID: '01', Wert: '3' }, { Name: 'Pankow', ID: '03', Wert: '4' }];
    expect(normalizeNumericStrings(data)).toEqual([{ Name: 'Mitte', ID: '01', Wert: 3 }, { Name: 'Pankow', ID: '03', Wert: 4 }]);
  });

  it('keeps the first column as labels', () => {
    const data = [{ Jahr: '2023', Wert: '1' }, { Jahr: '2024', Wert: '2' }];
    expect(normalizeNumericStrings(data)).toEqual([{ Jahr: '2023', Wert: 1 }, { Jahr: '2024', Wert: 2 }]);
  });

  it('normalizes GeoJSON feature properties', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [13.4, 52.5] }, properties: { name: 'A', count: '1.234,5' } }],
    };
    const result = normalizeNumericStrings(geojson);
    expect(result.features[0].properties).toEqual({ name: 'A', count: 1234.5 });
    expect(result.features[0].geometry).toEqual(geojson.features[0].geometry);
  });

  it('returns other values unchanged', () => {
    expect(normalizeNumericStrings('text')).toBe('text');
    expect(normalizeNumericStrings(undefined)).toBe(undefined);
  });
});

describe('columnNameToVariable', () => {
  it('matches Datawrapper variable names', () => {
    expect(columnNameToVariable('Fahrraddiebstähle')).toBe('fahrraddiebsthle');
    expect(columnNameToVariable('GDP (per cap.)')).toBe('gdp_per_cap');
    expect(columnNameToVariable('2024')).toBe('_2024');
    expect(columnNameToVariable('in')).toBe('in_');
  });
});
