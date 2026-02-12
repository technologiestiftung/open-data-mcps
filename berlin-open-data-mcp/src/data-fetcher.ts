// ABOUTME: Downloads and parses dataset resources from URLs
// ABOUTME: Handles CSV, JSON, Excel (XLS/XLSX), GeoJSON, KML, and WFS formats

import fetch from 'node-fetch';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { BrowserFetcher } from './browser-fetcher.js';
import { DOMParser } from '@xmldom/xmldom';
import * as toGeoJSON from '@tmcw/togeojson';
import { WFSClient } from './wfs-client.js';

export interface FetchedData {
  format: string;
  rows: any[];
  totalRows: number;
  columns: string[];
  error?: string;
  originalGeoJSON?: any; // Preserve original GeoJSON structure for proper downloads
}

export class DataFetcher {
  private readonly MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB limit
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds
  private readonly useBrowserAutomation: boolean;

  constructor(options: { useBrowserAutomation?: boolean } = {}) {
    this.useBrowserAutomation = options.useBrowserAutomation !== false; // Default true
  }

  private needsBrowserFetch(url: string): boolean {
    // URLs that require JavaScript execution
    return url.includes('statistik-berlin-brandenburg.de');
  }

  private shouldUseBrowser(url: string): boolean {
    return this.useBrowserAutomation &&
           this.needsBrowserFetch(url) &&
           BrowserFetcher.isAvailable();
  }

  async fetchResource(url: string, format: string, options?: { fullData?: boolean }): Promise<FetchedData> {
    // Check if this is a WFS service
    if (format.toUpperCase() === 'WFS' || WFSClient.isWFSUrl(url)) {
      return this.fetchWFS(url, options?.fullData ?? false);
    }

    // First try with browser if this URL needs it
    if (this.shouldUseBrowser(url)) {
      const browserResult = await this.fetchWithBrowser(url, format);
      if (browserResult) return browserResult;
      // If browser fetch failed, fall through to regular fetch
    }

    try {
      // Download the resource with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Berlin-Open-Data-MCP-Server/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > this.MAX_DOWNLOAD_SIZE) {
        throw new Error(`File too large: ${contentLength} bytes (max: ${this.MAX_DOWNLOAD_SIZE})`);
      }

      const contentType = response.headers.get('content-type') || '';

      // Handle Excel files - need binary data
      const formatLower = format.toLowerCase();
      if (formatLower === 'xls' || formatLower === 'xlsx' ||
          contentType.includes('spreadsheet') ||
          contentType.includes('excel') ||
          contentType.includes('ms-excel')) {
        const arrayBuffer = await response.arrayBuffer();
        return this.parseExcel(Buffer.from(arrayBuffer), format);
      }

      // For text formats (CSV, JSON), get as text
      const text = await response.text();

      // Parse based on format
      return this.parseData(text, format, contentType);
    } catch (error) {
      let errorMessage = 'Unknown error';

      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          errorMessage = 'Download timeout - file may be too large or server is slow';
        } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
          errorMessage = 'Could not connect to server - URL may be invalid';
        } else if (error.message.includes('Too large')) {
          errorMessage = error.message;
        } else {
          errorMessage = error.message;
        }
      }

      return {
        format,
        rows: [],
        totalRows: 0,
        columns: [],
        error: errorMessage,
      };
    }
  }

  private parseData(text: string, format: string, contentType: string): FetchedData {
    const formatLower = format.toLowerCase();

    // Excel files should not reach here (handled as binary above)
    if (formatLower === 'xls' || formatLower === 'xlsx') {
      return {
        format,
        rows: [],
        totalRows: 0,
        columns: [],
        error: 'Excel files require binary download - internal error',
      };
    }

    // Try KML if format or content suggests it
    if (formatLower === 'kml' || contentType.includes('kml') ||
        text.trim().includes('<kml')) {
      return this.parseKML(text);
    }

    // Try JSON first if format or content-type suggests it
    if (formatLower.includes('json') || contentType.includes('json')) {
      return this.parseJSON(text, format);
    }

    // Try CSV - use papaparse for robust parsing
    if (formatLower.includes('csv') || contentType.includes('csv') || contentType.includes('text')) {
      return this.parseCSV(text, format);
    }

    // Default to CSV parsing
    return this.parseCSV(text, format);
  }

  private parseJSON(text: string, format: string): FetchedData {
    try {
      const parsed = JSON.parse(text);

      // Check if this is GeoJSON
      if (this.isGeoJSON(parsed)) {
        const result = this.parseGeoJSON(parsed);
        // Preserve original GeoJSON structure for proper downloads
        result.originalGeoJSON = parsed;
        return result;
      }

      // Find the largest array in the JSON structure (recursively)
      const rows = this.findLargestArray(parsed);

      if (!rows || rows.length === 0) {
        return {
          format,
          rows: [],
          totalRows: 0,
          columns: [],
          error: 'No data arrays found in JSON structure',
        };
      }

      // Extract columns from first row
      const columns = rows.length > 0 && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];

      return {
        format: 'JSON',
        rows,
        totalRows: rows.length,
        columns,
      };
    } catch (error) {
      return {
        format,
        rows: [],
        totalRows: 0,
        columns: [],
        error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private isGeoJSON(obj: any): boolean {
    // Check for FeatureCollection or Feature
    return (
      (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) ||
      (obj.type === 'Feature' && obj.geometry && obj.properties)
    );
  }

  private parseGeoJSON(geojson: any): FetchedData {
    try {
      // Extract features array
      const features = geojson.type === 'FeatureCollection'
        ? geojson.features
        : [geojson]; // Single Feature

      if (!Array.isArray(features) || features.length === 0) {
        return {
          format: 'GeoJSON',
          rows: [],
          totalRows: 0,
          columns: [],
          error: 'No features found in GeoJSON',
        };
      }

      // Convert features to tabular rows
      const rows: any[] = [];
      const columnSet = new Set<string>();

      for (const feature of features) {
        if (feature.type !== 'Feature') continue;

        const row: any = {};

        // Add properties as columns
        if (feature.properties && typeof feature.properties === 'object') {
          Object.keys(feature.properties).forEach(key => {
            row[key] = feature.properties[key];
            columnSet.add(key);
          });
        }

        // Add geometry metadata
        if (feature.geometry) {
          row['geometry_type'] = feature.geometry.type;
          columnSet.add('geometry_type');

          // Store coordinates as JSON string
          if (feature.geometry.coordinates) {
            row['geometry_coordinates'] = JSON.stringify(feature.geometry.coordinates);
            columnSet.add('geometry_coordinates');
          }
        }

        // Add feature ID if present
        if (feature.id !== undefined) {
          row['feature_id'] = feature.id;
          columnSet.add('feature_id');
        }

        rows.push(row);
      }

      const columns = Array.from(columnSet);

      return {
        format: 'GeoJSON',
        rows,
        totalRows: rows.length,
        columns,
      };
    } catch (error) {
      return {
        format: 'GeoJSON',
        rows: [],
        totalRows: 0,
        columns: [],
        error: `GeoJSON parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private parseKML(text: string): FetchedData {
    try {
      // Parse XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');

      // Check for XML parsing errors
      const parseError = xmlDoc.getElementsByTagName('parsererror');
      if (parseError.length > 0) {
        return {
          format: 'KML',
          rows: [],
          totalRows: 0,
          columns: [],
          error: 'Invalid KML/XML structure',
        };
      }

      // Convert KML to GeoJSON
      const geojson = toGeoJSON.kml(xmlDoc);

      // Use existing GeoJSON parser
      const result = this.parseGeoJSON(geojson);

      // Update format to KML and preserve GeoJSON
      return {
        ...result,
        format: 'KML',
        originalGeoJSON: geojson, // Preserve GeoJSON for proper downloads
      };

    } catch (error) {
      return {
        format: 'KML',
        rows: [],
        totalRows: 0,
        columns: [],
        error: `KML parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private findLargestArray(obj: any): any[] | null {
    // If this is an array of objects, return it
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
      return obj;
    }

    // If this is an object, recursively search for arrays
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      let largestArray: any[] | null = null;
      let largestSize = 0;

      for (const key in obj) {
        const value = obj[key];
        const foundArray = this.findLargestArray(value);

        if (foundArray && foundArray.length > largestSize) {
          largestArray = foundArray;
          largestSize = foundArray.length;
        }
      }

      return largestArray;
    }

    // If this is an array but not of objects, check if it's empty or just primitives
    if (Array.isArray(obj)) {
      return obj;
    }

    return null;
  }

  private parseCSV(text: string, format: string): FetchedData {
    try {
      // Check if we got HTML instead of CSV
      const trimmedText = text.trim();
      if (trimmedText.toLowerCase().startsWith('<!doctype html') ||
          trimmedText.toLowerCase().startsWith('<html')) {
        const hasPuppeteer = BrowserFetcher.isAvailable();
        const errorMsg = hasPuppeteer
          ? 'Server returned HTML instead of CSV. Browser automation failed to download the file. The resource may not be accessible programmatically.'
          : 'Server returned HTML instead of CSV. This URL requires browser automation. Install puppeteer (npm install puppeteer) to enable automatic downloads for these files, or download manually from the Berlin Open Data Portal website.';

        return {
          format,
          rows: [],
          totalRows: 0,
          columns: [],
          error: errorMsg,
        };
      }

      // Use papaparse for robust CSV parsing
      // Automatically detects delimiters, handles quotes, encoding issues, etc.
      const result = Papa.parse<any>(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false, // Keep all as strings, we'll infer types later
      });

      if (result.errors && result.errors.length > 0) {
        console.warn('CSV parsing warnings:', result.errors);
      }

      const rows = result.data;
      const columns = result.meta?.fields || [];

      // Additional sanity check: if we have very few rows and parsing seems wrong
      if (rows.length === 0 || (columns.length === 0 && rows.length < 5)) {
        return {
          format,
          rows: [],
          totalRows: 0,
          columns: [],
          error: 'CSV parsing produced no valid data. The file may be malformed or in an unexpected format.',
        };
      }

      return {
        format: 'CSV',
        rows,
        totalRows: rows.length,
        columns,
      };
    } catch (error) {
      return {
        format,
        rows: [],
        totalRows: 0,
        columns: [],
        error: `CSV parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private parseExcel(buffer: Buffer, format: string): FetchedData {
    try {
      // Read the Excel file from buffer
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      // Get first sheet
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return {
          format,
          rows: [],
          totalRows: 0,
          columns: [],
          error: 'Excel file has no sheets',
        };
      }

      const sheet = workbook.Sheets[sheetName];

      // Convert to JSON (array of objects)
      const rows = XLSX.utils.sheet_to_json(sheet) as any[];

      // Extract column names
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      // Sanity check
      if (rows.length === 0 || columns.length === 0) {
        return {
          format,
          rows: [],
          totalRows: 0,
          columns: [],
          error: 'Excel file appears to be empty or has no headers',
        };
      }

      return {
        format: format.toUpperCase(),
        rows,
        totalRows: rows.length,
        columns,
      };
    } catch (error) {
      return {
        format,
        rows: [],
        totalRows: 0,
        columns: [],
        error: `Excel parse error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async fetchWithBrowser(url: string, format: string): Promise<FetchedData | null> {
    try {
      const fetcher = new BrowserFetcher();
      const result = await fetcher.fetchWithBrowser(url);
      await fetcher.close();

      if (!result.success || !result.data) {
        console.warn('Browser fetch failed:', result.error);
        return null;
      }

      // Parse the data using existing methods
      console.error('[DataFetcher] Parsing downloaded CSV data...');
      const parsed = this.parseData(result.data, format, 'text/csv');
      console.error('[DataFetcher] CSV parsing complete');
      return parsed;
    } catch (error) {
      console.error('Browser fetch error:', error);
      return null;
    }
  }

  /**
   * Fetch data from WFS (Web Feature Service)
   */
  private async fetchWFS(url: string, fullData: boolean): Promise<FetchedData> {
    try {
      const wfsClient = new WFSClient();

      // Parse URL and preserve non-WFS params (like nodeId)
      const { baseUrl, preservedParams } = wfsClient.parseWFSUrl(url);

      // Get capabilities to discover feature types (with preserved params)
      console.error('[DataFetcher] Getting WFS capabilities...');
      const capabilities = await wfsClient.getCapabilities(baseUrl, preservedParams);

      if (capabilities.featureTypes.length === 0) {
        return {
          format: 'WFS',
          rows: [],
          totalRows: 0,
          columns: [],
          error: 'No feature types available in WFS service',
        };
      }

      // Use first feature type (most Berlin WFS services have only one)
      const featureType = capabilities.featureTypes[0];
      console.error(`[DataFetcher] Fetching features from type: ${featureType.name}`);

      // Get total feature count (with preserved params)
      const totalCount = await wfsClient.getFeatureCount(baseUrl, featureType.name, preservedParams);
      console.error(`[DataFetcher] Total features available: ${totalCount}`);

      let allFeatures: any[] = [];

      if (fullData) {
        // For downloads, cap at 5000 features to avoid browser resource issues
        const maxDownloadFeatures = 5000;
        const featuresToFetch = Math.min(totalCount, maxDownloadFeatures);
        const batchSize = 1000;
        let startIndex = 0;

        while (startIndex < featuresToFetch) {
          console.error(`[DataFetcher] Fetching features ${startIndex} to ${Math.min(startIndex + batchSize, featuresToFetch)}...`);

          const batch = await wfsClient.getFeatures(
            baseUrl,
            featureType.name,
            { count: batchSize, startIndex },
            preservedParams
          );

          allFeatures = allFeatures.concat(batch.features);
          startIndex += batchSize;

          // Safety check: if we got fewer features than requested, we've reached the end
          if (batch.features.length < batchSize) {
            break;
          }
        }

        console.error(`[DataFetcher] Received ${allFeatures.length} features (limit: ${maxDownloadFeatures})`);
      } else if (totalCount <= 500) {
        // For small datasets in analysis mode, fetch all features
        console.error(`[DataFetcher] Small dataset (${totalCount} features), fetching all...`);

        const features = await wfsClient.getFeatures(
          baseUrl,
          featureType.name,
          { count: totalCount, startIndex: 0 },
          preservedParams
        );

        allFeatures = features.features;
        console.error(`[DataFetcher] Received ${allFeatures.length} total features`);
      } else {
        // For analysis of large datasets, fetch only first 10 features as sample
        console.error(`[DataFetcher] Large dataset (${totalCount} features), fetching sample of 10...`);

        const sample = await wfsClient.getFeatures(
          baseUrl,
          featureType.name,
          { count: 10, startIndex: 0 },
          preservedParams
        );

        allFeatures = sample.features;
        console.error(`[DataFetcher] Received ${allFeatures.length} sample features`);
      }

      // Create combined GeoJSON
      const geojson: any = {
        type: 'FeatureCollection',
        features: allFeatures
      };

      // Use existing GeoJSON parser to convert to tabular format
      const result = this.parseGeoJSON(geojson);

      // Update total rows to reflect actual count from service
      if (totalCount > 0 && totalCount !== result.totalRows) {
        result.totalRows = totalCount;
      }

      return {
        ...result,
        format: 'WFS',
        originalGeoJSON: geojson, // Preserve original GeoJSON for proper downloads
      };
    } catch (error) {
      return {
        format: 'WFS',
        rows: [],
        totalRows: 0,
        columns: [],
        error: `WFS fetch error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
