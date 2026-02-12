// ABOUTME: Script to verify LOR values match Datawrapper basemap keys
// ABOUTME: Run with: npm run build && node dist/tests/verify-basemap-keys.js

import * as dotenv from 'dotenv';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const API_TOKEN = process.env.DATAWRAPPER_API_TOKEN;
if (!API_TOKEN) {
  console.error('DATAWRAPPER_API_TOKEN required');
  process.exit(1);
}

const client = axios.create({
  baseURL: 'https://api.datawrapper.de/v3',
  headers: {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

// Basemaps we want to use and their key attributes
const BASEMAPS = [
  { id: 'berlin-boroughs', nameKey: 'Gemeinde_n', codeKey: 'Gemeinde_s', lorColumn: 'BEZ', lorIdColumn: 'BEZ_ID' },
  { id: 'berlin-prognoseraume-2021', nameKey: 'PGR_NAME', codeKey: 'PGR_ID', lorColumn: 'PGR', lorIdColumn: 'PGR_ID' },
  { id: 'berlin-bezreg-2021', nameKey: 'BZR_NAME', codeKey: 'BZR_ID', lorColumn: 'BZR', lorIdColumn: 'BZR_ID' },
  { id: 'berlin-planungsraeume-2021', nameKey: 'PLR_NAME', codeKey: 'PLR_ID', lorColumn: 'PLR', lorIdColumn: 'PLR_ID' },
];

// Whether to test IDs instead of names
const TEST_IDS = true;

async function getBasemapKeys(basemapId: string, keyName: string): Promise<string[]> {
  try {
    const response = await client.get(`/basemaps/${basemapId}/${keyName}`);
    const data = response.data;

    // Handle different response formats
    if (Array.isArray(data)) {
      return data.map(v => String(v));
    } else if (data && typeof data === 'object') {
      // Could be { values: [...] } or similar
      if (data.values && Array.isArray(data.values)) {
        return data.values.map((v: any) => String(v));
      }
      // Or it might be keyed differently
      const keys = Object.keys(data);
      if (keys.length > 0) {
        const firstKey = keys[0];
        if (Array.isArray(data[firstKey])) {
          return data[firstKey].map((v: any) => String(v));
        }
      }
      // Return all values if it's a flat object
      return Object.values(data).map(v => String(v));
    }
    console.log(`  Unexpected response format for ${basemapId}/${keyName}:`, typeof data, data);
    return [];
  } catch (error: any) {
    console.error(`Error fetching ${basemapId}/${keyName}:`, error.message);
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Data:`, error.response.data);
    }
    return [];
  }
}

function loadLORData(): Map<string, Set<string>> {
  // Navigate from dist/tests/ to data/
  const csvPath = path.resolve(process.cwd(), 'data/LOR_2023_Übersicht-Tabelle 1.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  // Handle Windows line endings
  const lines = content.replace(/\r/g, '').split('\n');

  // Skip header row (line 0 is "Tabelle 1", line 1 is actual header)
  const header = lines[1].split(';');

  // Create sets for each column we care about
  const columnSets = new Map<string, Set<string>>();
  for (const col of ['BEZ', 'BEZ_ID', 'PGR', 'PGR_ID', 'BZR', 'BZR_ID', 'PLR', 'PLR_ID']) {
    columnSets.set(col, new Set<string>());
  }

  // Parse data rows
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(';');
    for (const [colName, colSet] of columnSets) {
      const colIndex = header.indexOf(colName);
      if (colIndex >= 0 && values[colIndex]) {
        colSet.add(values[colIndex]);
      }
    }
  }

  return columnSets;
}

async function verifyBasemap(basemap: typeof BASEMAPS[0], lorData: Map<string, Set<string>>) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Basemap: ${basemap.id}`);
  console.log('='.repeat(60));

  // Choose whether to test names or IDs
  const dwKey = TEST_IDS ? basemap.codeKey : basemap.nameKey;
  const lorCol = TEST_IDS ? basemap.lorIdColumn : basemap.lorColumn;

  // Get Datawrapper keys
  console.log(`\nFetching Datawrapper keys (${dwKey})...`);
  const dwNames = await getBasemapKeys(basemap.id, dwKey);
  console.log(`  Found ${dwNames.length} values in Datawrapper`);

  // Get LOR values
  const lorNames = lorData.get(lorCol) || new Set();
  console.log(`  Found ${lorNames.size} unique values in LOR file (column: ${lorCol})`);

  if (dwNames.length === 0) {
    console.log(`  ⚠️ Could not fetch Datawrapper values`);
    return {
      basemap: basemap.id,
      matchingNames: 0,
      totalDW: 0,
      totalLOR: lorNames.size,
      onlyInDW: [],
      onlyInLOR: [...lorNames]
    };
  }

  // Compare names
  const dwNameSet = new Set(dwNames);
  const lorNameSet = lorNames;

  const inBothNames = [...dwNameSet].filter(n => lorNameSet.has(n));
  const onlyInDW = [...dwNameSet].filter(n => !lorNameSet.has(n));
  const onlyInLOR = [...lorNameSet].filter(n => !dwNameSet.has(n));

  console.log(`\n  NAME COMPARISON:`);
  console.log(`    Matching: ${inBothNames.length}`);
  console.log(`    Only in Datawrapper: ${onlyInDW.length}`);
  console.log(`    Only in LOR file: ${onlyInLOR.length}`);

  if (onlyInDW.length > 0) {
    console.log(`\n    Values only in Datawrapper:`);
    onlyInDW.slice(0, 10).forEach(n => console.log(`      - "${n}"`));
    if (onlyInDW.length > 10) console.log(`      ... and ${onlyInDW.length - 10} more`);
  }

  if (onlyInLOR.length > 0) {
    console.log(`\n    Values only in LOR file:`);
    onlyInLOR.slice(0, 10).forEach(n => console.log(`      - "${n}"`));
    if (onlyInLOR.length > 10) console.log(`      ... and ${onlyInLOR.length - 10} more`);
  }

  // Print all values for comparison
  console.log(`\n  DATAWRAPPER VALUES:`);
  dwNames.slice(0, 20).forEach((n, i) => console.log(`    ${i + 1}. "${n}"`));
  if (dwNames.length > 20) console.log(`    ... and ${dwNames.length - 20} more`);

  console.log(`\n  LOR FILE VALUES:`);
  [...lorNames].slice(0, 20).forEach((n, i) => console.log(`    ${i + 1}. "${n}"`));
  if (lorNames.size > 20) console.log(`    ... and ${lorNames.size - 20} more`);

  return {
    basemap: basemap.id,
    matchingNames: inBothNames.length,
    totalDW: dwNames.length,
    totalLOR: lorNames.size,
    onlyInDW,
    onlyInLOR
  };
}

async function main() {
  console.log('Verifying LOR data matches Datawrapper basemap keys\n');

  // Load LOR data
  console.log('Loading LOR data from CSV...');
  const lorData = loadLORData();

  for (const [col, values] of lorData) {
    console.log(`  ${col}: ${values.size} unique values`);
  }

  // Verify each basemap
  const results = [];
  for (const basemap of BASEMAPS) {
    const result = await verifyBasemap(basemap, lorData);
    results.push(result);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));

  for (const r of results) {
    const status = r.onlyInDW.length === 0 && r.onlyInLOR.length === 0 ? '✅' :
                   r.matchingNames > 0 ? '⚠️' : '❌';
    console.log(`${status} ${r.basemap}: ${r.matchingNames}/${r.totalDW} DW values matched, ${r.totalLOR} LOR values`);
  }
}

main().catch(console.error);
