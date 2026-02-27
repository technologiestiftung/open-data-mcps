// ABOUTME: API client for Berlin Open Data Portal CKAN API
// ABOUTME: Provides methods for searching, listing, and retrieving dataset metadata

import fetch from 'node-fetch';
import {
  BerlinDataset,
  SearchResult,
  DatasetSearchParams,
  PortalStats,
  DatasetListResult,
  FilteredSearchParams,
  FacetCounts,
} from './types.js';

const BERLIN_CKAN_API_BASE = 'https://datenregister.berlin.de/api/3/action';

// Allowed Solr params on datenregister.berlin.de:
//   defType, qf, mm, tie, sort, facet, facet.field, facet.limit, facet.mincount
// Blocked: pf (phrase fields) — not in the CKAN allowlist on this deployment.
//
// IMPORTANT — mm is accepted but ineffective here:
// CKAN's PackageSearchQuery wraps multi-term queries in mandatory +(…) syntax
// before passing them to Solr, which forces AND semantics and overrides mm.
// Tested: q="fahrrad zebra" with mm=1 returns 0 instead of the expected union.
// Single-term queries with edismax + qf work correctly and produce better ranking.
const DEFAULT_QF = 'title^5 notes^2 tags^3 author^1 maintainer^1';
const DEFAULT_TIE = '0.1';

export class BerlinOpenDataAPI {
  /**
   * Rewrites plain multi-word queries to explicit OR groups so any term can
   * match (recall). CKAN uses q.op=AND at the top level, meaning space-separated
   * terms are required by default and mm has no effect. Explicit OR in
   * parentheses bypasses this — confirmed working on datenregister.berlin.de.
   *
   * "Radverkehr Infrastruktur" → "(Radverkehr OR Infrastruktur)"
   *
   * Structured queries (containing operators, quotes, field qualifiers, or
   * wildcards) are passed through unchanged.
   */
  private rewriteQuery(query: string): string {
    const trimmed = query.trim();
    // Pass through wildcards, structured queries, and already-OR'd queries
    const isStructured = /[+\-":()\[\]{}\\]|\b(?:AND|OR|NOT)\b/i.test(trimmed)
      || trimmed === '*'
      || trimmed === '*:*';
    if (isStructured) return trimmed;

    const terms = trimmed.split(/\s+/).filter(Boolean);
    if (terms.length <= 1) return trimmed;

    return `(${terms.join(' OR ')})`;
  }

  private async makeRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    const url = new URL(`${BERLIN_CKAN_API_BASE}/${endpoint}`);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        // Arrays map to repeated params (e.g. multiple fq= values ANDed by Solr)
        if (Array.isArray(value)) {
          value.forEach(v => url.searchParams.append(key, String(v)));
        } else {
          url.searchParams.append(key, String(value));
        }
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

  /**
   * Core search method. Uses edismax with field weighting and always returns
   * facets for tags/organizations/formats.
   *
   * edismax + qf dramatically improves ranking: a dataset titled "Radverkehr"
   * scores 5× higher than one that mentions it once in a 2000-word description.
   *
   * Multi-word queries are automatically rewritten to explicit OR groups via
   * rewriteQuery() to recover recall. Without this, CKAN's q.op=AND forces all
   * terms to match and returns 0 results for most multi-word queries.
   */
  async searchDatasets(params: DatasetSearchParams): Promise<SearchResult> {
    const resolvedSort = params.sort ?? (params.sortByDate
      ? 'metadata_modified desc'
      : 'score desc, metadata_modified desc');

    const searchParams: Record<string, any> = {
      q: this.rewriteQuery(params.query || '*:*'),
      rows: params.limit || 20,
      start: params.offset || 0,
      defType: 'edismax',
      qf: DEFAULT_QF,
      tie: DEFAULT_TIE,
      sort: resolvedSort,
      facet: 'true',
      'facet.field': '["tags", "organization", "groups"]',
      'facet.limit': 10,
      'facet.mincount': 1,
    };

    // fq filters are cached separately by Solr — fast and do not affect scoring
    const fqFilters: string[] = [];

    if (params.tags && params.tags.length > 0) {
      fqFilters.push(`tags:(${params.tags.join(' OR ')})`);
    }
    if (params.organization) {
      fqFilters.push(`organization:${params.organization}`);
    }
    if (params.format) {
      fqFilters.push(`res_format:${params.format.toUpperCase()}`);
    }
    if (params.modifiedSince) {
      const ts = params.modifiedSince.includes('T')
        ? params.modifiedSince
        : `${params.modifiedSince}T00:00:00Z`;
      fqFilters.push(`metadata_modified:[${ts} TO *]`);
    }

    if (fqFilters.length > 0) {
      // Pass as array → repeated fq= params, ANDed by Solr
      searchParams.fq = fqFilters;
    }

    const result = await this.makeRequest('package_search', searchParams);

    return {
      count: result.count,
      results: result.results,
      facets: this.parseFacets(result),
    };
  }

  /**
   * Structured filtered search for the search_datasets_filtered MCP tool.
   * Delegates to searchDatasets after mapping named filter params.
   */
  async searchDatasetsFiltered(params: FilteredSearchParams): Promise<SearchResult> {
    return this.searchDatasets({
      query: params.query || '*:*',
      limit: params.limit,
      offset: params.offset,
      organization: params.organization,
      tags: params.tag ? [params.tag] : undefined,
      format: params.format,
      modifiedSince: params.modified_since,
      sort: params.sort,
    });
  }

  /**
   * Returns only facet counts for a query (rows=0).
   * Use as a first step to discover which organizations/tags/formats are
   * associated with a topic, then call searchDatasetsFiltered with fq values.
   */
  async getFacets(
    query: string,
    facetFields: string[] = ['tags', 'organization', 'res_format', 'groups'],
    limit: number = 10,
  ): Promise<FacetCounts> {
    const facetFieldJson = JSON.stringify(facetFields);
    const searchParams: Record<string, any> = {
      q: this.rewriteQuery(query || '*:*'),
      rows: 0,
      defType: 'edismax',
      qf: DEFAULT_QF,
      facet: 'true',
      'facet.field': facetFieldJson,
      'facet.limit': limit,
      'facet.mincount': 1,
    };

    const result = await this.makeRequest('package_search', searchParams);
    return this.parseFacets(result);
  }

  private parseFacets(result: any): FacetCounts {
    const facets: FacetCounts = {};
    if (result.search_facets) {
      for (const [field, facetData] of Object.entries(result.search_facets as Record<string, any>)) {
        const items = facetData.items || [];
        (facets as any)[field] = items;
      }
    }
    return facets;
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
    try {
      return await this.makeRequest('package_autocomplete', { q: query, limit });
    } catch {
      const results = await this.searchDatasets({ query, limit });
      return results.results.map(r => ({ name: r.name, title: r.title }));
    }
  }

  /**
   * Lists tags from the portal. Supports optional prefix filtering via the
   * CKAN tag_list `q` parameter (server-side autocomplete).
   */
  async listTags(limit: number = 100, query?: string): Promise<Array<{ name: string }>> {
    const params: Record<string, any> = { limit };
    if (query) {
      params.q = query;
    }
    const tags = await this.makeRequest('tag_list', params);
    return tags.map((tag: string) => ({ name: tag }));
  }

  async listOrganizations(): Promise<Array<{ name: string; title: string; package_count?: number }>> {
    return await this.makeRequest('organization_list', { all_fields: true, include_dataset_count: true });
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
