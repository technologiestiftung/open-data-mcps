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
  cqlFilter?: string;
}

/**
 * Hosts the server is allowed to send WFS requests to. wfs_url comes from the model
 * (and thus potentially from prompt injection), so anything else is rejected to
 * prevent data exfiltration and SSRF.
 * energieatlas.berlin.de is referenced by WFS resources on daten.berlin.de.
 */
export const ALLOWED_WFS_HOSTS = ['gdi.berlin.de', 'energieatlas.berlin.de'];

export class WFSUrlNotAllowedError extends Error {
  constructor() {
    super(`WFS URL not allowed. Only https URLs on these hosts are supported: ${ALLOWED_WFS_HOSTS.join(', ')}`);
    this.name = 'WFSUrlNotAllowedError';
  }
}

/**
 * Error from an allowlisted WFS service (HTTP status, OGC exception, timeout, unexpected format).
 * Requests only reach allowlisted hosts, so the message is safe to pass on to the client.
 */
export class WFSServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WFSServiceError';
  }
}

/**
 * Whether an error's message can be shown to the client. Everything else (e.g. network errors)
 * should only be logged.
 */
export function isClientSafeWFSError(error: unknown): error is Error {
  return error instanceof WFSUrlNotAllowedError || error instanceof WFSServiceError;
}

/**
 * Extract the exception text from an OGC exception report (WFS 1.x ServiceExceptionReport or OWS ExceptionReport)
 */
function extractOGCExceptionText(data: unknown): string | undefined {
  if (typeof data !== 'string') return undefined;
  const match = data.match(/<(?:\w+:)?(?:ExceptionText|ServiceException)\b[^>]*>([\s\S]*?)<\//);
  const text = match?.[1].replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 300) : undefined;
}

function exceptionSuffix(data: unknown): string {
  const exceptionText = extractOGCExceptionText(data);
  return exceptionText ? `: ${exceptionText}` : '';
}

export function isAllowedWFSUrl(url: string | URL): boolean {
  try {
    const urlObj = typeof url === 'string' ? new URL(url) : url;
    return (
      urlObj.protocol === 'https:' &&
      urlObj.port === '' &&
      urlObj.username === '' &&
      urlObj.password === '' &&
      ALLOWED_WFS_HOSTS.includes(urlObj.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export class WFSClient {
  private readonly REQUEST_TIMEOUT = 30000;

  /**
   * GET an allowlisted WFS URL. Redirects are not followed, otherwise an allowed
   * host could bounce the request elsewhere.
   */
  private async get(url: URL) {
    if (!isAllowedWFSUrl(url)) {
      throw new WFSUrlNotAllowedError();
    }
    return axios.get(url.toString(), {
      timeout: this.REQUEST_TIMEOUT,
      maxRedirects: 0,
      headers: {
        'User-Agent': 'Berlin-Open-Data-MCP-Server/1.0',
      },
    });
  }

  /**
   * Convert request errors into WFSServiceErrors where the details are safe to pass on.
   * Network errors are rethrown unchanged and should only be logged.
   */
  private toServiceError(error: unknown, requestType: string): Error {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return new WFSServiceError(`${requestType} request timeout - WFS service may be slow or unavailable`);
      }
      if (error.response) {
        const exceptionText = extractOGCExceptionText(error.response.data);
        return new WFSServiceError(
          `${requestType} failed with HTTP ${error.response.status}${exceptionText ? `: ${exceptionText}` : ''}`
        );
      }
      return new Error(`Network error: ${error.message}`);
    }
    return error instanceof Error ? error : new Error(`Unknown error during ${requestType} request`);
  }

  /**
   * Output format for GetFeature. energieatlas.berlin.de only offers application/geo+json,
   * gdi.berlin.de only application/json.
   */
  private getFeatureOutputFormat(url: URL): string {
    return url.hostname === 'energieatlas.berlin.de' ? 'application/geo+json' : 'application/json';
  }

  /**
   * Parse WFS URL to extract base service URL and preserve non-WFS parameters
   * Preserves parameters like nodeId while stripping WFS-specific params
   */
  parseWFSUrl(url: string): { baseUrl: string; preservedParams: URLSearchParams } {
    if (!isAllowedWFSUrl(url)) {
      throw new WFSUrlNotAllowedError();
    }

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
      const response = await this.get(url);

      const xml = response.data;

      return this.parseCapabilities(xml);
    } catch (error) {
      throw this.toServiceError(error, 'GetCapabilities');
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
      throw new WFSServiceError('Invalid XML in GetCapabilities response');
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
      throw new WFSServiceError(
        `No feature types found in GetCapabilities response${exceptionSuffix(xml)}`
      );
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
    const { count = 1000, startIndex = 0, cqlFilter } = options;

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
    url.searchParams.set('OUTPUTFORMAT', this.getFeatureOutputFormat(url));
    url.searchParams.set('COUNT', count.toString());
    url.searchParams.set('STARTINDEX', startIndex.toString());

    if (cqlFilter) {
      url.searchParams.set('CQL_FILTER', cqlFilter);
    }

    // Request WGS84 coordinates directly for services that support it 
    // gdi.berlin.de supports srsName parameter, energieatlas.berlin.de returns WGS84 by default
    if (baseUrl.includes('gdi.berlin.de')) {
      url.searchParams.set('srsName', 'EPSG:4326');
    }

    try {
      const response = await this.get(url);

      const contentType = response.headers['content-type'] || '';

      // Some services (e.g. energieatlas.berlin.de) report errors as HTTP 200 with an XML exception report
      if (!contentType.includes('json')) {
        throw new WFSServiceError(
          `GetFeature returned ${contentType || 'unknown content type'} instead of JSON${exceptionSuffix(response.data)}`
        );
      }

      const geojson = response.data as FeatureCollection;

      // Validate GeoJSON structure
      if (geojson?.type !== 'FeatureCollection') {
        throw new WFSServiceError('Invalid GeoJSON: expected FeatureCollection');
      }

      return geojson;
    } catch (error) {
      throw this.toServiceError(error, 'GetFeature');
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
      const response = await this.get(url);

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
