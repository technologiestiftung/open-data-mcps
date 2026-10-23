// ABOUTME: Unit tests for the styling option helpers (colors, number formats, CSV column detection)
// ABOUTME: Run with: npm test

import { describe, it, expect } from 'vitest';
import { buildColorSettings, detectNumericColumnsFromCsv, lightenHex, usesTransposedLayout } from '../style-options.js';

describe('lightenHex', () => {
  it('mixes a color with white', () => {
    expect(lightenHex('#000000', 0.5)).toBe('#808080');
    expect(lightenHex('#c00', 0)).toBe('#cc0000');
    expect(lightenHex('#2E7D32', 1)).toBe('#ffffff');
  });
});

describe('buildColorSettings', () => {
  it('keeps plain charts on base-color only', () => {
    expect(buildColorSettings('d3-bars', { base_color: '#123456' })).toEqual({ visualize: { 'base-color': '#123456' }, warnings: [] });
  });

  it('rejects an invalid color_scale', () => {
    expect(() => buildColorSettings('d3-maps-choropleth', { color_scale: ['#fff'] })).toThrow('at least 2 hex colors');
  });

  it('warns when a choropleth base_color is not a hex color', () => {
    const result = buildColorSettings('d3-maps-choropleth', { base_color: 'red' });
    expect(result.visualize.colorscale).toBeUndefined();
    expect(result.warnings[0]).toContain('hex color');
  });

  it('warns when color_scale is used outside choropleth maps', () => {
    expect(buildColorSettings('d3-bars', { color_scale: ['#fff', '#000'] }).warnings[0]).toContain('only applies to choropleth maps');
  });
});

describe('usesTransposedLayout', () => {
  it('is true only for grouped and stacked column charts', () => {
    expect(usesTransposedLayout('grouped-column-chart')).toBe(true);
    expect(usesTransposedLayout('stacked-column-chart')).toBe(true);
    expect(usesTransposedLayout('column-chart')).toBe(false);
    expect(usesTransposedLayout('d3-bars-stacked')).toBe(false);
  });
});

describe('detectNumericColumnsFromCsv', () => {
  it('finds numeric columns in CSV with quoted fields', () => {
    expect(detectNumericColumnsFromCsv('name,value,"label, long"\n"Mitte, Berlin",1.5,x\nPankow,-2,y\n')).toEqual(['value']);
  });

  it('handles tab-separated data and empty cells', () => {
    expect(detectNumericColumnsFromCsv('name\ta\tb\nMitte\t1\t\nPankow\t2\t3\n')).toEqual(['a', 'b']);
  });

  it('returns nothing without data rows', () => {
    expect(detectNumericColumnsFromCsv('name,value\n')).toEqual([]);
  });
});
