// ABOUTME: Unit tests for BasemapMatcher class
// ABOUTME: Run with: npm test

import { describe, it, expect } from 'vitest';
import { BasemapMatcher } from '../basemap-matcher.js';

const matcher = new BasemapMatcher();

// Test data for different LOR levels
const bezirkeDataById = [
  { BEZ_ID: '01', population: 384000 },
  { BEZ_ID: '02', population: 289000 },
  { BEZ_ID: '03', population: 407000 },
];

const bezirkeDataByName = [
  { district: 'Mitte', population: 384000 },
  { district: 'Friedrichshain-Kreuzberg', population: 289000 },
  { district: 'Pankow', population: 407000 },
];

const prognoseraeumeData = [
  { PGR_ID: '0110', value: 100 },
  { PGR_ID: '0120', value: 200 },
  { PGR_ID: '0130', value: 150 },
];

const bezirksregionenData = [
  { BZR_ID: '011001', count: 50 },
  { BZR_ID: '011002', count: 75 },
  { BZR_ID: '012005', count: 60 },
];

const planungsraeumeData = [
  { PLR_ID: '01100101', metric: 10 },
  { PLR_ID: '01100102', metric: 20 },
  { PLR_ID: '01100103', metric: 15 },
];

const mixedData = [
  { BEZ_ID: '01', BZR_ID: '011001', value: 100 },
  { BEZ_ID: '01', BZR_ID: '011002', value: 200 },
  { BEZ_ID: '02', BZR_ID: '021001', value: 150 },
];

const noMatchData = [
  { region: 'Unknown1', value: 100 },
  { region: 'Unknown2', value: 200 },
];

describe('BasemapMatcher Unit Tests', () => {
  it('detects Bezirke by ID column', () => {
    const result = matcher.detectAvailableLevels(bezirkeDataById);
    expect(result.detected).toBe(true);
    expect(result.primaryLevel?.basemap).toBe('berlin-boroughs');
    expect(result.regionColumn).toBe('BEZ_ID');
  });

  it('detects Bezirke by name', () => {
    const result = matcher.detectAvailableLevels(bezirkeDataByName);
    expect(result.detected).toBe(true);
    expect(result.primaryLevel?.basemap).toBe('berlin-boroughs');
  });

  it('detects Prognoseräume', () => {
    const result = matcher.detectAvailableLevels(prognoseraeumeData);
    expect(result.detected).toBe(true);
    expect(result.primaryLevel?.basemap).toBe('berlin-prognoseraume-2021');
    expect(result.regionColumn).toBe('PGR_ID');
  });

  it('detects Bezirksregionen', () => {
    const result = matcher.detectAvailableLevels(bezirksregionenData);
    expect(result.detected).toBe(true);
    expect(result.primaryLevel?.basemap).toBe('berlin-bezreg-2021');
    expect(result.regionColumn).toBe('BZR_ID');
  });

  it('detects Planungsräume', () => {
    const result = matcher.detectAvailableLevels(planungsraeumeData);
    expect(result.detected).toBe(true);
    expect(result.primaryLevel?.basemap).toBe('berlin-planungsraeume-2021');
    expect(result.regionColumn).toBe('PLR_ID');
  });

  it('detects multiple levels in mixed data', () => {
    const result = matcher.detectAvailableLevels(mixedData);
    expect(result.detected).toBe(true);
    expect(result.allLevels.length).toBeGreaterThanOrEqual(2);
  });

  it('finds value column', () => {
    const result = matcher.detectAvailableLevels(bezirkeDataById);
    expect(result.valueColumn).toBe('population');
  });

  it('returns detected=false for unrecognized data', () => {
    const result = matcher.detectAvailableLevels(noMatchData);
    expect(result.detected).toBe(false);
    expect(result.allLevels.length).toBe(0);
  });

  it('pads BEZ_ID correctly', () => {
    expect(matcher.padBezirkId('01')).toBe('001');
    expect(matcher.padBezirkId('12')).toBe('012');
    expect(matcher.padBezirkId('001')).toBe('001');
  });

  it('getLORLevels returns all levels', () => {
    const levels = matcher.getLORLevels();
    expect(levels.length).toBe(4);
  });

  it('getLevelByBasemap returns correct level', () => {
    const level = matcher.getLevelByBasemap('berlin-boroughs');
    expect(level?.label).toBe('Bezirke');
    expect(level?.count).toBe(12);
  });
});
