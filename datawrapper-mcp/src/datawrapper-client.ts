// ABOUTME: Datawrapper API client for chart creation and management
// ABOUTME: Handles authentication, chart creation, listing, updates, data upload, publishing and deletion

import axios, { AxiosInstance } from 'axios';
import { DatawrapperChart, DatawrapperChartList, DatawrapperChartMetadata, DatawrapperChartUpdate, DatawrapperPublishResult, ListChartsOptions } from './types.js';

// Scopes required per endpoint, used to explain 403 errors
const SCOPE_READ = 'chart:read';
const SCOPE_WRITE = 'chart:write';
const SCOPE_PUBLISH = 'chart:read, chart:write, theme:read and visualization:read';

// Datawrapper chart IDs are 5 alphanumeric characters
const CHART_ID_PATTERN = /^[A-Za-z0-9]{5}$/;

/**
 * Error raised for failed Datawrapper API calls. Keeps the HTTP status so callers can react to it.
 */
export class DatawrapperApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'DatawrapperApiError';
    this.status = status;
  }
}

export class DatawrapperClient {
  private client: AxiosInstance | null = null;
  private token: string | null = null;

  constructor(token?: string) {
    if (token) {
      this.setToken(token);
    }
  }

  setToken(token: string): void {
    this.token = token;
    this.client = axios.create({
      baseURL: 'https://api.datawrapper.de/v3',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  get hasToken(): boolean {
    return this.token !== null;
  }

  private getClient(): AxiosInstance {
    if (!this.client) {
      throw new Error('API token missing for this request.');
    }
    return this.client;
  }

  /**
   * Guard against chart IDs that would change the request path or query
   * (e.g. "../folders/1" or "abcde?permanent=true") before building a /charts/{id} URL.
   */
  private assertChartId(chartId: string): void {
    if (typeof chartId !== 'string' || !CHART_ID_PATTERN.test(chartId)) {
      throw new DatawrapperApiError(`Invalid chart ID "${chartId}": a Datawrapper chart ID has exactly 5 letters or digits.`);
    }
  }

  /**
   * Translate an axios error into a user-facing DatawrapperApiError.
   * 401/403/404/429 get specific messages; everything else keeps the "Failed to <action>" form.
   */
  private toApiError(error: any, action: string, options: { scope?: string; chartId?: string } = {}): DatawrapperApiError {
    const status: number | undefined = error?.response?.status;
    const { scope, chartId } = options;

    switch (status) {
      case 401:
        return new DatawrapperApiError('Datawrapper authentication failed. Please check your API token.', 401);
      case 403: {
        const scopeHint = scope ? ` Make sure your API token has the ${scope} scope` : ' Make sure your API token has the required scopes';
        const accessHint = chartId ? ` and that you have access to chart ${chartId}.` : '.';
        return new DatawrapperApiError(`Permission denied: could not ${action}.${scopeHint}${accessHint}`, 403);
      }
      case 404:
        if (chartId) {
          return new DatawrapperApiError(`Chart not found (ID: ${chartId}). It may have been deleted, or your API token has no access to it.`, 404);
        }
        return new DatawrapperApiError(`Failed to ${action}: resource not found.`, 404);
      case 429:
        return new DatawrapperApiError('Rate limit exceeded. Please try again in a few moments.', 429);
      default: {
        const apiMessage = typeof error?.response?.data?.message === 'string' ? ` (${error.response.data.message})` : '';
        return new DatawrapperApiError(`Failed to ${action}: ${error?.message ?? String(error)}${apiMessage}`, status);
      }
    }
  }

  async validateToken(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.get('/me');
      return true;
    } catch (error: any) {
      if (error.response?.status === 401) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create an empty chart with specified type, metadata and (top-level) title, language and folder
   */
  async createChart(
    type: string,
    metadata?: DatawrapperChartMetadata,
    title?: string,
    options: { language?: string; folderId?: number } = {}
  ): Promise<DatawrapperChart> {
    try {
      const response = await this.getClient().post('/charts', {
        type,
        ...(title ? { title } : {}),
        ...(options.language ? { language: options.language } : {}),
        ...(options.folderId !== undefined ? { folderId: options.folderId } : {}),
        metadata: metadata || {}
      });
      return response.data;
    } catch (error: any) {
      throw this.toApiError(error, 'create chart', { scope: SCOPE_WRITE });
    }
  }

  /**
   * List charts visible to the token owner (GET /charts).
   * Undefined options are left out of the query string. The API only knows published=true
   * ("published charts only"); published=false is ignored by the API, so it is not sent either.
   */
  async listCharts(options: ListChartsOptions = {}): Promise<DatawrapperChartList> {
    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(options)) {
      if (key === 'published' && value !== true) {
        continue;
      }
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }

    try {
      const response = await this.getClient().get('/charts', { params });
      return response.data;
    } catch (error: any) {
      throw this.toApiError(error, 'list charts', { scope: SCOPE_READ });
    }
  }

  /**
   * Upload data to an existing chart (replaces the whole dataset)
   */
  async uploadData(chartId: string, data: string): Promise<void> {
    this.assertChartId(chartId);
    try {
      await this.getClient().put(`/charts/${chartId}/data`, data, {
        headers: {
          'Content-Type': 'text/csv'
        }
      });
    } catch (error: any) {
      throw this.toApiError(error, 'upload data', { scope: SCOPE_WRITE, chartId });
    }
  }

  /**
   * Get the current dataset of a chart as raw text (usually CSV)
   */
  async getChartData(chartId: string): Promise<string> {
    this.assertChartId(chartId);
    try {
      const response = await this.getClient().get(`/charts/${chartId}/data`, {
        responseType: 'text',
        headers: {
          'Accept': 'text/csv, application/json;q=0.9, */*;q=0.8'
        }
      });
      const data = response.data;
      if (data === null || data === undefined) {
        return '';
      }
      return typeof data === 'string' ? data : JSON.stringify(data);
    } catch (error: any) {
      throw this.toApiError(error, 'get chart data', { scope: SCOPE_READ, chartId });
    }
  }

  /**
   * Update chart metadata
   */
  async updateMetadata(chartId: string, metadata: DatawrapperChartMetadata): Promise<DatawrapperChart> {
    this.assertChartId(chartId);
    try {
      const response = await this.getClient().patch(`/charts/${chartId}`, {
        metadata
      });
      return response.data;
    } catch (error: any) {
      throw this.toApiError(error, 'update metadata', { scope: SCOPE_WRITE, chartId });
    }
  }

  /**
   * Partially update a chart in place (PATCH /charts/{id}); the chart keeps its ID.
   * Datawrapper deep-merges nested metadata objects server-side, so only the changed keys need to be sent.
   * Objects (e.g. custom-colors) are merged key by key; arrays and plain values replace the stored value.
   * Per the archived API source, an empty object {} replaces (clears) the stored object, and null is stored as null.
   */
  async updateChart(chartId: string, update: DatawrapperChartUpdate): Promise<DatawrapperChart> {
    this.assertChartId(chartId);
    try {
      const response = await this.getClient().patch(`/charts/${chartId}`, update);
      return response.data;
    } catch (error: any) {
      throw this.toApiError(error, 'update chart', { scope: SCOPE_WRITE, chartId });
    }
  }

  /**
   * Delete a chart (DELETE /charts/{id}). Without the permanent flag Datawrapper moves the chart
   * to the trash, where it is kept for 30 days. Responds with 204 No Content.
   */
  async deleteChart(chartId: string): Promise<void> {
    this.assertChartId(chartId);
    try {
      await this.getClient().delete(`/charts/${chartId}`);
    } catch (error: any) {
      throw this.toApiError(error, 'delete chart', { scope: SCOPE_WRITE, chartId });
    }
  }

  /**
   * Publish a chart publicly. POST /charts/{id}/publish responds with { data: Chart, version, url }.
   */
  async publishChart(chartId: string): Promise<DatawrapperPublishResult> {
    this.assertChartId(chartId);
    try {
      const response = await this.getClient().post(`/charts/${chartId}/publish`);
      const body = response.data || {};
      return {
        chart: body.data ?? body,
        version: typeof body.version === 'number' ? body.version : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
      };
    } catch (error: any) {
      throw this.toApiError(error, 'publish chart', { scope: SCOPE_PUBLISH, chartId });
    }
  }

  /**
   * Get chart information including URLs
   */
  async getChartInfo(chartId: string): Promise<DatawrapperChart> {
    this.assertChartId(chartId);
    try {
      const response = await this.getClient().get(`/charts/${chartId}`);
      return response.data;
    } catch (error: any) {
      throw this.toApiError(error, 'get chart info', { scope: SCOPE_READ, chartId });
    }
  }

  /**
   * Get embed code for a published chart
   */
  getEmbedCode(publicId: string, width: number = 600, height: number = 400): string {
    // Use responsive embed with aspect ratio
    return `<iframe title="" aria-label="Map" id="datawrapper-chart-${publicId}" src="https://datawrapper.dwcdn.net/${publicId}/" scrolling="no" frameborder="0" style="width: 0; min-width: 100% !important; border: none;" height="${height}" data-external="1"></iframe><script type="text/javascript">!function(){"use strict";window.addEventListener("message",(function(a){if(void 0!==a.data["datawrapper-height"]){var e=document.querySelectorAll("iframe");for(var t in a.data["datawrapper-height"])for(var r=0;r<e.length;r++)if(e[r].contentWindow===a.source){var i=a.data["datawrapper-height"][t]+"px";e[r].style.height=i}}}))}();</script>`;
  }

  /**
   * Get public URL for a published chart
   */
  getPublicUrl(publicId: string): string {
    return `https://datawrapper.dwcdn.net/${publicId}/`;
  }

  /**
   * Get edit URL for a chart
   */
  getEditUrl(chartId: string): string {
    return `https://app.datawrapper.de/chart/${chartId}/visualize`;
  }

  /**
   * Get list of available base maps
   */
  async getBasemaps(): Promise<any[]> {
    try {
      const response = await this.getClient().get('/basemaps');
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to fetch basemaps: ${error.message}`);
    }
  }
}
