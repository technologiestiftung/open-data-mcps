// ABOUTME: TypeScript type definitions for Berlin Open Data Portal entities
// ABOUTME: Defines interfaces for datasets, search results, and API responses

export interface BerlinDataset {
  id: string;
  name: string;
  title: string;
  notes: string;
  tags: Array<{ name: string }>;
  groups: Array<{ name: string; title: string }>;
  organization: {
    name: string;
    title: string;
  };
  resources: Array<{
    id: string;
    name: string;
    description: string;
    format: string;
    url: string;
  }>;
  metadata_created: string;
  metadata_modified: string;
  license_title?: string;
  author?: string;
  maintainer?: string;
}

export interface FacetItem {
  name: string;
  display_name: string;
  count: number;
}

export interface FacetCounts {
  tags?: FacetItem[];
  organization?: FacetItem[];
  groups?: FacetItem[];
  res_format?: FacetItem[];
}

export interface SearchResult {
  count: number;
  results: BerlinDataset[];
  facets?: FacetCounts;
}

export interface DatasetSearchParams {
  query: string;
  limit?: number;
  offset?: number;
  /** Filter by one or more tags (joined as OR in fq) */
  tags?: string[];
  organization?: string;
  /** Filter to datasets with at least one resource in this format (e.g. "CSV", "WFS") */
  format?: string;
  /** Only return datasets modified after this ISO date string (e.g. "2023-01-01") */
  modifiedSince?: string;
  /**
   * Sort expression. Default: 'score desc, metadata_modified desc'.
   * Use 'metadata_modified desc' for newest-first.
   */
  sort?: string;
  /** Convenience flag: sets sort='metadata_modified desc'. Overridden by explicit sort. */
  sortByDate?: boolean;
}

/** Shape for search_datasets_filtered tool params — mapped to fq in berlin-api */
export interface FilteredSearchParams {
  query: string;
  limit?: number;
  offset?: number;
  organization?: string;
  tag?: string;
  format?: string;
  modified_since?: string;
  sort?: string;
}

export interface PortalStats {
  total_datasets: number;
  total_organizations: number;
  total_tags: number;
  last_updated?: string;
}

export interface DatasetListResult {
  datasets: Array<{ name: string; title: string }>;
  total: number;
}