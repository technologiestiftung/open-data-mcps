// ABOUTME: Unit tests for BasemapMatcher class
// ABOUTME: Run with: npm run build && node dist/tests/basemap-matcher.test.js

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

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error: any) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
  }
}

function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(actual: boolean, message?: string) {
  if (!actual) {
    throw new Error(message || 'Expected true but got false');
  }
}

console.log('\nBasemapMatcher Unit Tests\n' + '='.repeat(50));

test('detects Bezirke by ID column', () => {
  const result = matcher.detectAvailableLevels(bezirkeDataById);
  assertTrue(result.detected, 'Should detect regions');
  assertEqual(result.primaryLevel?.basemap, 'berlin-boroughs', 'Should detect berlin-boroughs');
  assertEqual(result.regionColumn, 'BEZ_ID', 'Should identify BEZ_ID column');
});

test('detects Bezirke by name', () => {
  const result = matcher.detectAvailableLevels(bezirkeDataByName);
  assertTrue(result.detected, 'Should detect regions');
  assertEqual(result.primaryLevel?.basemap, 'berlin-boroughs', 'Should detect berlin-boroughs');
});

test('detects Prognoseräume', () => {
  const result = matcher.detectAvailableLevels(prognoseraeumeData);
  assertTrue(result.detected, 'Should detect regions');
  assertEqual(result.primaryLevel?.basemap, 'berlin-prognoseraume-2021', 'Should detect prognoseraume');
  assertEqual(result.regionColumn, 'PGR_ID', 'Should identify PGR_ID column');
});

test('detects Bezirksregionen', () => {
  const result = matcher.detectAvailableLevels(bezirksregionenData);
  assertTrue(result.detected, 'Should detect regions');
  assertEqual(result.primaryLevel?.basemap, 'berlin-bezreg-2021', 'Should detect bezreg');
  assertEqual(result.regionColumn, 'BZR_ID', 'Should identify BZR_ID column');
});

test('detects Planungsräume', () => {
  const result = matcher.detectAvailableLevels(planungsraeumeData);
  assertTrue(result.detected, 'Should detect regions');
  assertEqual(result.primaryLevel?.basemap, 'berlin-planungsraeume-2021', 'Should detect planungsraeume');
  assertEqual(result.regionColumn, 'PLR_ID', 'Should identify PLR_ID column');
});

test('detects multiple levels in mixed data', () => {
  const result = matcher.detectAvailableLevels(mixedData);
  assertTrue(result.detected, 'Should detect regions');
  assertTrue(result.allLevels.length >= 2, 'Should detect multiple levels');
});

test('finds value column', () => {
  const result = matcher.detectAvailableLevels(bezirkeDataById);
  assertEqual(result.valueColumn, 'population', 'Should find numeric column');
});

test('returns detected=false for unrecognized data', () => {
  const result = matcher.detectAvailableLevels(noMatchData);
  assertTrue(!result.detected, 'Should not detect regions');
  assertEqual(result.allLevels.length, 0, 'Should have no levels');
});

test('pads BEZ_ID correctly', () => {
  assertEqual(matcher.padBezirkId('01'), '001', 'Should pad 01 to 001');
  assertEqual(matcher.padBezirkId('12'), '012', 'Should pad 12 to 012');
  assertEqual(matcher.padBezirkId('001'), '001', 'Should not change 001');
});

test('getLORLevels returns all levels', () => {
  const levels = matcher.getLORLevels();
  assertEqual(levels.length, 4, 'Should have 4 LOR levels');
});

test('getLevelByBasemap returns correct level', () => {
  const level = matcher.getLevelByBasemap('berlin-boroughs');
  assertEqual(level?.label, 'Bezirke', 'Should return Bezirke level');
  assertEqual(level?.count, 12, 'Should have 12 regions');
});

console.log('\n' + '='.repeat(50));
console.log('Tests complete\n');
