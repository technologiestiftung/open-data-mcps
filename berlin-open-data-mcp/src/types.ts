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

export interface SearchResult {
  count: number;
  results: BerlinDataset[];
}

export interface DatasetSearchParams {
  query: string;
  limit?: number;
  offset?: number;
  tags?: string[];
  organization?: string;
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