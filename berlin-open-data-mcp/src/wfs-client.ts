// ABOUTME: WFS (Web Feature Service) client implementing OGC WFS 2.0.0 protocol
// ABOUTME: Handles GetCapabilities and GetFeature requests for all Berlin WFS services

import axios from 'axios';
import { DOMParser } from '@xmldom/xmldom';
import type { FeatureCollection } from 'geojson';

export interface WFSCapabilities {
  featureTypes: Array<{
    name: string;
    title: string;
    abstract?: string;
  }>;
  supportedFormats: string[];
}

export interface WFSFeatureOptions {
  count?: number;
  startIndex?: number;
}

export class WFSClient {
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds

  /**
   * Parse WFS URL to extract base service URL and preserve non-WFS parameters
   * Preserves parameters like nodeId while stripping WFS-specific params
   */
  parseWFSUrl(url: string): { baseUrl: string; preservedParams: URLSearchParams } {
    try {
      const urlObj = new URL(url);

      // WFS-specific parameters that we will override (lowercase for comparison)
      const wfsParamNames = new Set([
        'service',
        'request',
        'version',
        'typenames',
        'typename',
        'outputformat',
        'count',
        'startindex',
        'resulttype',
      ]);

      // Preserve only non-WFS parameters (like nodeId, SRSNAME, etc.)
      const preservedParams = new URLSearchParams();
      for (const [key, value] of urlObj.searchParams) {
        // Case-insensitive comparison
        if (!wfsParamNames.has(key.toLowerCase())) {
          preservedParams.set(key, value);
        }
      }

      // Extract base URL (protocol + host + path, no query params)
      const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

      return { baseUrl, preservedParams };
    } catch (error) {
      throw new Error(`Invalid WFS URL: ${url}`);
    }
  }

  /**
   * Execute GetCapabilities request to discover available feature types
   */
  async getCapabilities(baseUrl: string, preservedParams?: URLSearchParams): Promise<WFSCapabilities> {
    const url = new URL(baseUrl);

    // Add preserved params first (like nodeId)
    if (preservedParams) {
      for (const [key, value] of preservedParams) {
        url.searchParams.set(key, value);
      }
    }

    // Add/override WFS params
    url.searchParams.set('SERVICE', 'WFS');
    url.searchParams.set('REQUEST', 'GetCapabilities');

    try {
      const response = await axios.get(url.toString(), {
        timeout: this.REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'Berlin-Open-Data-MCP-Server/1.0',
        },
      });

      const xml = response.data;

      return this.parseCapabilities(xml);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('GetCapabilities request timeout - WFS service may be slow or unavailable');
        }
        if (error.response) {
          throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
        }
        throw new Error(`Network error: ${error.message}`);
      }
      throw error instanceof Error ? error : new Error('Unknown error during GetCapabilities request');
    }
  }

  /**
   * Parse GetCapabilities XML response
   */
  private parseCapabilities(xml: string): WFSCapabilities {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    // Check for XML parsing errors
    const parseError = doc.getElementsByTagName('parsererror');
    if (parseError.length > 0) {
      throw new Error('Invalid XML in GetCapabilities response');
    }

    // Extract feature types (try with namespace first, then without)
    const featureTypes: WFSCapabilities['featureTypes'] = [];
    let featureTypeElements = doc.getElementsByTagNameNS('http://www.opengis.net/wfs/2.0', 'FeatureType');

    // Fallback to non-namespaced search if namespace search returns nothing
    if (featureTypeElements.length === 0) {
      featureTypeElements = doc.getElementsByTagName('FeatureType');
    }

    for (let i = 0; i < featureTypeElements.length; i++) {
      const ft = featureTypeElements[i];

      // Try with namespace first, then without
      const name = ft.getElementsByTagNameNS('http://www.opengis.net/wfs/2.0', 'Name')[0]?.textContent ||
                   ft.getElementsByTagName('Name')[0]?.textContent ||
                   ft.getElementsByTagName('wfs:Name')[0]?.textContent;

      const title = ft.getElementsByTagNameNS('http://www.opengis.net/wfs/2.0', 'Title')[0]?.textContent ||
                    ft.getElementsByTagName('Title')[0]?.textContent ||
                    ft.getElementsByTagName('wfs:Title')[0]?.textContent;

      const abstract = ft.getElementsByTagNameNS('http://www.opengis.net/wfs/2.0', 'Abstract')[0]?.textContent ||
                       ft.getElementsByTagName('Abstract')[0]?.textContent ||
                       ft.getElementsByTagName('wfs:Abstract')[0]?.textContent;

      if (name && title) {
        featureTypes.push({
          name: name.trim(),
          title: title.trim(),
          abstract: abstract?.trim(),
        });
      }
    }

    if (featureTypes.length === 0) {
      throw new Error('No feature types found in GetCapabilities response');
    }

    // Extract supported formats
    const supportedFormats: string[] = [];
    const formatElements = doc.getElementsByTagName('outputFormat');

    for (let i = 0; i < formatElements.length; i++) {
      const format = formatElements[i].textContent;
      if (format) {
        supportedFormats.push(format.trim());
      }
    }

    return { featureTypes, supportedFormats };
  }

  /**
   * Execute GetFeature request to retrieve actual feature data as GeoJSON
   */
  async getFeatures(
    baseUrl: string,
    typeName: string,
    options: WFSFeatureOptions = {},
    preservedParams?: URLSearchParams
  ): Promise<FeatureCollection> {
    const { count = 1000, startIndex = 0 } = options;

    const url = new URL(baseUrl);

    // Add preserved params first (like nodeId)
    if (preservedParams) {
      for (const [key, value] of preservedParams) {
        url.searchParams.set(key, value);
      }
    }

    // Add/override WFS params
    url.searchParams.set('SERVICE', 'WFS');
    url.searchParams.set('REQUEST', 'GetFeature');
    url.searchParams.set('VERSION', '2.0.0');
    url.searchParams.set('TYPENAMES', typeName);
    url.searchParams.set('OUTPUTFORMAT', 'application/json');
    url.searchParams.set('COUNT', count.toString());
    url.searchParams.set('STARTINDEX', startIndex.toString());

    // Request WGS84 coordinates directly for services that support it (88.7% of Berlin WFS)
    // gdi.berlin.de supports srsName parameter, fbinter.stadt-berlin.de doesn't (being phased out)
    if (baseUrl.includes('gdi.berlin.de')) {
      url.searchParams.set('srsName', 'EPSG:4326');
    }

    try {
      const response = await axios.get(url.toString(), {
        timeout: this.REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'Berlin-Open-Data-MCP-Server/1.0',
        },
      });

      const contentType = response.headers['content-type'] || '';

      if (!contentType.includes('json')) {
        throw new Error(`Expected JSON response, got: ${contentType}`);
      }

      const geojson = response.data as FeatureCollection;

      // Validate GeoJSON structure
      if (geojson.type !== 'FeatureCollection') {
        throw new Error('Invalid GeoJSON: expected FeatureCollection');
      }

      return geojson;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('GetFeature request timeout - dataset may be very large or service is slow');
        }
        if (error.response) {
          throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
        }
        throw new Error(`Network error: ${error.message}`);
      }
      throw error instanceof Error ? error : new Error('Unknown error during GetFeature request');
    }
  }

  /**
   * Get total feature count without fetching all features
   */
  async getFeatureCount(baseUrl: string, typeName: string, preservedParams?: URLSearchParams): Promise<number> {
    const url = new URL(baseUrl);

    // Add preserved params first (like nodeId)
    if (preservedParams) {
      for (const [key, value] of preservedParams) {
        url.searchParams.set(key, value);
      }
    }

    // Add/override WFS params
    url.searchParams.set('SERVICE', 'WFS');
    url.searchParams.set('REQUEST', 'GetFeature');
    url.searchParams.set('VERSION', '2.0.0');
    url.searchParams.set('TYPENAMES', typeName);
    url.searchParams.set('RESULTTYPE', 'hits');

    try {
      const response = await axios.get(url.toString(), {
        timeout: this.REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'Berlin-Open-Data-MCP-Server/1.0',
        },
      });

      const xml = response.data;

      // Parse numberMatched attribute from XML response
      const match = String(xml).match(/numberMatched="(\d+)"/);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }

      // Fallback: try to parse as JSON (some servers return JSON even for hits)
      try {
        const json = typeof xml === 'string' ? JSON.parse(xml) : xml;
        if (json.numberMatched !== undefined) {
          return json.numberMatched;
        }
      } catch {
        // Not JSON, continue
      }

      return 0;
    } catch (error) {
      // If count fails, return 0 (non-critical - we can still fetch features)
      console.warn('Could not get feature count:', error);
      return 0;
    }
  }

  /**
   * Check if a URL looks like a WFS service URL
   */
  static isWFSUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('gdi.berlin.de/services/wfs') ||
      lower.includes('request=getcapabilities') ||
      lower.includes('service=wfs')
    );
  }
}
