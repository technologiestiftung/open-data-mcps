// ABOUTME: Datawrapper API client for chart creation and management
// ABOUTME: Handles authentication, chart creation, data upload, and publishing

import axios, { AxiosInstance } from 'axios';
import { DatawrapperChart, DatawrapperChartMetadata } from './types.js';

export class DatawrapperClient {
  private client: AxiosInstance | null = null;
  private token: string | null = null;

  constructor() {}

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
      throw new Error('API token not configured. Call configure_api_key first.');
    }
    return this.client;
  }

  async validateToken(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.get('/users/me');
      return true;
    } catch (error: any) {
      if (error.response?.status === 401) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Create an empty chart with specified type and metadata
   */
  async createChart(type: string, metadata?: DatawrapperChartMetadata): Promise<DatawrapperChart> {
    try {
      const response = await this.getClient().post('/charts', {
        type,
        metadata: metadata || {}
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('Datawrapper authentication failed. Please check your API token.');
      }
      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again in a few moments.');
      }
      throw new Error(`Failed to create chart: ${error.message}`);
    }
  }

  /**
   * Upload data to an existing chart
   */
  async uploadData(chartId: string, data: string): Promise<void> {
    try {
      await this.getClient().put(`/charts/${chartId}/data`, data, {
        headers: {
          'Content-Type': 'text/csv'
        }
      });
    } catch (error: any) {
      throw new Error(`Failed to upload data: ${error.message}`);
    }
  }

  /**
   * Update chart metadata
   */
  async updateMetadata(chartId: string, metadata: DatawrapperChartMetadata): Promise<DatawrapperChart> {
    try {
      const response = await this.getClient().patch(`/charts/${chartId}`, {
        metadata
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to update metadata: ${error.message}`);
    }
  }

  /**
   * Publish a chart publicly
   */
  async publishChart(chartId: string): Promise<DatawrapperChart> {
    try {
      const response = await this.getClient().post(`/charts/${chartId}/publish`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to publish chart: ${error.message}`);
    }
  }

  /**
   * Get chart information including URLs
   */
  async getChartInfo(chartId: string): Promise<DatawrapperChart> {
    try {
      const response = await this.getClient().get(`/charts/${chartId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get chart info: ${error.message}`);
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
