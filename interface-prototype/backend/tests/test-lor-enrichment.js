import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load bezirk lookup
const bezirkFile = '/Users/alsino/Desktop/ODIS/berlin-open-data-mcp/data/lor_2021-01-01_k3_uebersicht_id_namen/LOR_2023_BEZ-Tabelle 1.csv';
const bezirkContent = fs.readFileSync(bezirkFile, 'utf-8');
const bezirkLines = bezirkContent.split('\n').slice(2);

const bezirkMap = new Map();
for (const line of bezirkLines) {
  const trimmedLine = line.trim();
  if (!trimmedLine) continue;

  const parts = trimmedLine.split(';');
  if (parts.length >= 2) {
    const bezId = parts[0].trim();
    const bezName = parts[1].trim();
    if (bezId && bezName) {
      bezirkMap.set(bezId, bezName);
    }
  }
}

console.log('Loaded bezirk mapping:');
bezirkMap.forEach((name, code) => {
  console.log(`  ${code} -> ${name}`);
});

// Test enrichment on a sample row (simulating the fixed enrichRow function)
const sampleRow = {
  BEZ: '03',
  RAUMID: '03010101',
  E_E: '3580'
};

console.log('\n--- Testing enrichment (fixed version) ---');
console.log('Input row:', sampleRow);

const enriched = { ...sampleRow };

// Add bezirk name if BEZ exists
if (sampleRow.BEZ && bezirkMap.has(sampleRow.BEZ)) {
  enriched.BEZIRK_NAME = bezirkMap.get(sampleRow.BEZ);
}

// Simulate RAUMID enrichment (don't overwrite BEZIRK_NAME if already set)
if (sampleRow.RAUMID) {
  if (!enriched.BEZIRK_NAME) {
    enriched.BEZIRK_NAME = 'WOULD_BE_OVERWRITTEN';
  }
}

console.log('Enriched row:', enriched);
console.log('\nBEZIRK_NAME correctly set to:', enriched.BEZIRK_NAME);
console.log('Expected: Pankow');
console.log('Match:', enriched.BEZIRK_NAME === 'Pankow' ? '✓ PASS' : '✗ FAIL');
