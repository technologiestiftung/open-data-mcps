import fs from 'fs';
import Papa from '../../../berlin-open-data-mcp/node_modules/papaparse/papaparse.min.js';

const csvPath = '/Users/alsino/Desktop/EWR_L21_202412E_Matrix.csv';
const csv = fs.readFileSync(csvPath, 'utf-8');

// Parse with PapaParser (same as data-fetcher.ts)
const parsed = Papa.parse(csv, {
  header: true,
  delimiter: ';',
  skipEmptyLines: true
});

console.log('Parsed rows:', parsed.data.length);
console.log('\nFirst row fields:');
console.log(Object.keys(parsed.data[0]));

console.log('\nFirst 3 rows sample:');
parsed.data.slice(0, 3).forEach((row, i) => {
  console.log(`\nRow ${i}:`, {
    BEZ: row.BEZ,
    BEZIRK_NAME: row.BEZIRK_NAME,
    E_E: row.E_E
  });
});

// Test the aggregation with BEZIRK_NAME
console.log('\n--- Testing aggregation with BEZIRK_NAME field ---');
const byBezirkName = {};
parsed.data.forEach(row => {
  const bezirk = row.BEZIRK_NAME;
  const pop = parseInt(row.E_E) || 0;
  byBezirkName[bezirk] = (byBezirkName[bezirk] || 0) + pop;
});

console.log('Results:');
Object.entries(byBezirkName).forEach(([bez, pop]) => {
  if (pop > 0) console.log(`  ${bez}: ${pop.toLocaleString()}`);
});

// Test with BEZ field
console.log('\n--- Testing aggregation with BEZ field ---');
const byBez = {};
parsed.data.forEach(row => {
  const bezirk = row.BEZ;
  const pop = parseInt(row.E_E) || 0;
  byBez[bezirk] = (byBez[bezirk] || 0) + pop;
});

console.log('Results:');
Object.entries(byBez).sort((a, b) => b[1] - a[1]).forEach(([bez, pop]) => {
  console.log(`  Bezirk ${bez}: ${pop.toLocaleString()}`);
});
