// ABOUTME: Fetches and validates GeoJSON data from URLs
// ABOUTME: Supports GeoJSON files and WFS endpoints

import axios from 'axios';
import { GeoJSON } from './types.js';

export class DataFetcher {
  private timeout = 30000; // 30 seconds

  async fetchGeoJSON(url: string): Promise<GeoJSON> {
    console.error(`Fetching GeoJSON from: ${url}`);

    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'Accept': 'application/json, application/geo+json',
        },
      });

      const data = response.data;
      this.validateGeoJSON(data);

      console.error(`Fetched ${data.features.length} features`);
      return data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch GeoJSON: ${error.message}`);
      }
      throw error;
    }
  }

  async fetchWFS(url: string): Promise<GeoJSON> {
    console.error(`Fetching WFS from: ${url}`);

    // Append outputFormat if not present
    const wfsUrl = new URL(url);
    if (!wfsUrl.searchParams.has('outputFormat')) {
      wfsUrl.searchParams.set('outputFormat', 'application/json');
    }
    if (!wfsUrl.searchParams.has('service')) {
      wfsUrl.searchParams.set('service', 'WFS');
    }
    if (!wfsUrl.searchParams.has('request')) {
      wfsUrl.searchParams.set('request', 'GetFeature');
    }

    try {
      const response = await axios.get(wfsUrl.toString(), {
        timeout: this.timeout,
        headers: {
          'Accept': 'application/json, application/geo+json',
        },
      });

      const data = response.data;
      this.validateGeoJSON(data);

      console.error(`Fetched ${data.features.length} features from WFS`);
      return data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch WFS: ${error.message}`);
      }
      throw error;
    }
  }

  parseInlineGeoJSON(data: string | object): GeoJSON {
    try {
      // Handle both string and object inputs (MCP passes objects directly)
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      this.validateGeoJSON(parsed);
      return parsed;
    } catch (error: any) {
      throw new Error(`Invalid GeoJSON: ${error.message}`);
    }
  }

  private validateGeoJSON(data: any): void {
    if (!data || typeof data !== 'object') {
      throw new Error('GeoJSON must be an object');
    }

    if (data.type !== 'FeatureCollection') {
      throw new Error(`Expected FeatureCollection, got ${data.type}`);
    }

    if (!Array.isArray(data.features)) {
      throw new Error('GeoJSON must have a features array');
    }
  }
}
