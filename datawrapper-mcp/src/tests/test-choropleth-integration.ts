// ABOUTME: Integration test for choropleth map creation via Datawrapper API
// ABOUTME: Run with: npm run build && node dist/tests/test-choropleth-integration.js

import * as dotenv from 'dotenv';
import { DatawrapperClient } from '../datawrapper-client.js';
import { ChartBuilder } from '../chart-builder.js';
import { BasemapMatcher } from '../basemap-matcher.js';

dotenv.config();

const API_TOKEN = process.env.DATAWRAPPER_API_TOKEN;
if (!API_TOKEN) {
  console.error('DATAWRAPPER_API_TOKEN required');
  process.exit(1);
}

const client = new DatawrapperClient(API_TOKEN);
const builder = new ChartBuilder();
const matcher = new BasemapMatcher();

// Test data for Berlin Bezirke
const bezirkeData = [
  { BEZ_ID: '01', name: 'Mitte', population: 384000 },
  { BEZ_ID: '02', name: 'Friedrichshain-Kreuzberg', population: 289000 },
  { BEZ_ID: '03', name: 'Pankow', population: 407000 },
  { BEZ_ID: '04', name: 'Charlottenburg-Wilmersdorf', population: 342000 },
  { BEZ_ID: '05', name: 'Spandau', population: 243000 },
  { BEZ_ID: '06', name: 'Steglitz-Zehlendorf', population: 308000 },
  { BEZ_ID: '07', name: 'Tempelhof-Schöneberg', population: 351000 },
  { BEZ_ID: '08', name: 'Neukölln', population: 327000 },
  { BEZ_ID: '09', name: 'Treptow-Köpenick', population: 271000 },
  { BEZ_ID: '10', name: 'Marzahn-Hellersdorf', population: 269000 },
  { BEZ_ID: '11', name: 'Lichtenberg', population: 296000 },
  { BEZ_ID: '12', name: 'Reinickendorf', population: 265000 },
];

async function testChoroplethMap() {
  console.log('Testing Choropleth Map with Berlin Bezirke\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Detection
    console.log('\n1. Detecting LOR level...');
    const detection = matcher.detectAvailableLevels(bezirkeData);
    console.log(`   Detected: ${detection.detected}`);
    console.log(`   Primary level: ${detection.primaryLevel?.label}`);
    console.log(`   Region column: ${detection.regionColumn}`);
    console.log(`   Value column: ${detection.valueColumn}`);
    console.log(`   Match rate: ${detection.matchedRows}/${detection.totalRows}`);

    if (!detection.detected) {
      throw new Error('Failed to detect LOR level');
    }

    // Step 2: Determine basemap settings
    console.log('\n2. Configuring basemap...');
    const level = detection.primaryLevel!;
    const usingIds = matcher.isUsingIds(bezirkeData, detection.regionColumn, level);
    const keyAttr = usingIds ? level.idKey : level.nameKey;
    console.log(`   Basemap: ${level.basemap}`);
    console.log(`   Using: ${usingIds ? 'IDs' : 'names'}`);
    console.log(`   Key attribute: ${keyAttr}`);

    // Step 3: Process data (pad BEZ_ID for berlin-boroughs)
    console.log('\n3. Processing data...');
    let processedData = bezirkeData;
    if (usingIds && level.basemap === 'berlin-boroughs') {
      processedData = bezirkeData.map(row => ({
        ...row,
        BEZ_ID: matcher.padBezirkId(String(row.BEZ_ID))
      }));
      console.log(`   Padded BEZ_ID: ${bezirkeData[0].BEZ_ID} → ${processedData[0].BEZ_ID}`);
    }

    // Step 4: Create chart
    console.log('\n4. Creating chart...');
    const metadata = {
      title: 'Berlin Population by District',
      visualize: {
        basemap: level.basemap,
        'map-key-attr': keyAttr,
      },
      axes: {
        keys: detection.regionColumn,
        values: detection.valueColumn
      },
      publish: {
        'embed-width': 600,
        'embed-height': 600
      }
    };
    console.log(`   Metadata:`, JSON.stringify(metadata, null, 2));

    const chart = await client.createChart('d3-maps-choropleth', metadata);
    console.log(`   Chart ID: ${chart.id}`);

    // Step 5: Upload data
    console.log('\n5. Uploading CSV data...');
    const csvData = builder.formatForDatawrapper(processedData);
    console.log(`   CSV preview:\n${csvData.split('\n').slice(0, 3).join('\n')}`);
    await client.uploadData(chart.id, csvData);
    console.log('   Data uploaded');

    // Step 6: Publish
    console.log('\n6. Publishing chart...');
    const published = await client.publishChart(chart.id);
    const publicId = published.publicId || chart.id;
    const publicUrl = client.getPublicUrl(publicId);
    const editUrl = client.getEditUrl(chart.id);

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ SUCCESS!');
    console.log(`   Public URL: ${publicUrl}`);
    console.log(`   Edit URL: ${editUrl}`);

    return { success: true, url: publicUrl };
  } catch (error: any) {
    console.log('\n' + '='.repeat(60));
    console.log('\n❌ FAILED!');
    console.log(`   Error: ${error.message}`);
    if (error.response) {
      console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return { success: false, error: error.message };
  }
}

testChoroplethMap().catch(console.error);
