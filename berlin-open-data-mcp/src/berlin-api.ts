// ABOUTME: API client for Berlin Open Data Portal CKAN API
// ABOUTME: Provides methods for searching, listing, and retrieving dataset metadata

import fetch from 'node-fetch';
import { BerlinDataset, SearchResult, DatasetSearchParams, PortalStats, DatasetListResult } from './types.js';

const BERLIN_CKAN_API_BASE = 'https://datenregister.berlin.de/api/3/action';

export class BerlinOpenDataAPI {
  private async makeRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    const url = new URL(`${BERLIN_CKAN_API_BASE}/${endpoint}`);

    // Add parameters to URL
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });

    try {
      const response = await fetch(url.toString());
      const data = await response.json() as any;

      if (!response.ok || !data.success) {
        throw new Error(`API request failed: ${data.error?.message || response.statusText}`);
      }

      return data.result;
    } catch (error) {
      console.error(`Berlin API request failed:`, error);
      throw error;
    }
  }

  async searchDatasets(params: DatasetSearchParams): Promise<SearchResult> {
    const searchParams: Record<string, any> = {
      q: params.query,
      rows: params.limit || 20,
      start: params.offset || 0
    };

    // Add filters
    const filters: string[] = [];
    if (params.tags && params.tags.length > 0) {
      filters.push(`tags:(${params.tags.join(' OR ')})`);
    }
    if (params.organization) {
      filters.push(`organization:${params.organization}`);
    }

    if (filters.length > 0) {
      searchParams.fq = filters.join(' AND ');
    }

    const result = await this.makeRequest('package_search', searchParams);
    return {
      count: result.count,
      results: result.results
    };
  }

  async getDataset(id: string): Promise<BerlinDataset> {
    return await this.makeRequest('package_show', { id });
  }

  async listDatasets(limit: number = 100): Promise<string[]> {
    return await this.makeRequest('package_list', { limit });
  }

  async listAllDatasets(offset: number = 0, limit: number = 100): Promise<DatasetListResult> {
    const result = await this.makeRequest('package_search', {
      q: '*:*',
      rows: limit,
      start: offset,
      fl: 'name,title',
    });

    return {
      datasets: result.results.map((d: any) => ({ name: d.name, title: d.title })),
      total: result.count,
    };
  }

  async autocompleteDatasets(query: string, limit: number = 10): Promise<Array<{ name: string; title: string }>> {
    // Fallback to regular search if autocomplete requires auth
    try {
      return await this.makeRequest('package_autocomplete', { q: query, limit });
    } catch (error) {
      // Fallback to search
      const results = await this.searchDatasets({ query, limit });
      return results.results.map(r => ({ name: r.name, title: r.title }));
    }
  }

  async listTags(limit: number = 100): Promise<Array<{ name: string }>> {
    const tags = await this.makeRequest('tag_list', { limit });
    // tag_list returns array of strings, convert to objects
    return tags.map((tag: string) => ({ name: tag }));
  }

  async listOrganizations(): Promise<Array<{ name: string; title: string }>> {
    // organization_list returns array of org IDs by default
    // Use all_fields=true to get full organization objects with title
    const orgs = await this.makeRequest('organization_list', { all_fields: true });
    return orgs;
  }

  async getPortalStats(): Promise<PortalStats> {
    const [datasets, orgs, tags] = await Promise.all([
      this.makeRequest('package_search', { rows: 0 }),
      this.listOrganizations(),
      this.listTags(0),
    ]);

    return {
      total_datasets: datasets.count,
      total_organizations: orgs.length,
      total_tags: tags.length,
    };
  }

  async listDatasetResources(datasetId: string): Promise<Array<{ id: string; name: string; format: string; url: string; description: string }>> {
    const dataset = await this.getDataset(datasetId);

    return dataset.resources.map(r => ({
      id: r.id,
      name: r.name,
      format: r.format,
      url: r.url,
      description: r.description,
    }));
  }

}