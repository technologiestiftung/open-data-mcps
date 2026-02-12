import fs from 'fs';

const csvPath = '/Users/alsino/Desktop/EWR_L21_202412E_Matrix.csv';
const csv = fs.readFileSync(csvPath, 'utf-8');
const lines = csv.split('\n');
const headers = lines[0].split(';');
const bezIndex = headers.indexOf('BEZ');
const eeIndex = headers.indexOf('E_E');

console.log('Testing population calculation on raw CSV data');
console.log('Headers found:', { bezIndex, eeIndex });
console.log('Total lines:', lines.length);

const byBezirk = {};
let totalPop = 0;
let nanCount = 0;

for (let i = 1; i < lines.length; i++) {
  const row = lines[i].split(';');
  if (row.length < 8) continue;

  const bezirk = row[bezIndex];
  const pop = parseInt(row[eeIndex]);

  if (isNaN(pop)) {
    nanCount++;
    continue;
  }

  byBezirk[bezirk] = (byBezirk[bezirk] || 0) + pop;
  totalPop += pop;
}

console.log('\nBezirke populations:');
Object.entries(byBezirk).sort((a, b) => b[1] - a[1]).forEach(([bez, pop]) => {
  console.log(`  Bezirk ${bez}: ${pop.toLocaleString()}`);
});
console.log('\nTotal:', totalPop.toLocaleString());
console.log('NaN rows:', nanCount);
