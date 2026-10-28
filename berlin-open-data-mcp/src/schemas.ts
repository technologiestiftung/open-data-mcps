import { z } from 'zod';

// Solr sort expression like "metadata_modified desc" or "score desc, metadata_modified desc"
const sortSchema = z
  .string()
  .regex(
    /^[a-z_]+ (asc|desc)(, ?[a-z_]+ (asc|desc))*$/,
    'sort must look like "metadata_modified desc" or "score desc, metadata_modified desc"'
  );

// Dataset IDs are CKAN names (or UUIDs). Anything else would only reach the portal's WAF
// or return "not found", so reject it with a hint instead.
const datasetIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9_-]{2,100}$/,
    'dataset_id must be a dataset ID from search results (lowercase letters, digits, "-" and "_"), not a title or URL'
  );

export const SearchDatasetsSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: sortSchema.optional(),
});

export const SearchFilteredSchema = z.object({
  query: z.string().default('*'),
  organization: z.string().optional(),
  tag: z.string().optional(),
  format: z.string().optional(),
  modified_since: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?$/,
      'modified_since must be a date like "2024-01-01" or "2024-01-01T00:00:00Z"'
    )
    .optional(),
  sort: sortSchema.default('score desc, metadata_modified desc').optional(),
  rows: z.coerce.number().int().min(1).max(100).default(20),
});

export const GetFacetsSchema = z.object({
  query: z.string().default('*'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const ListTagsSchema = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GetDatasetDetailsSchema = z.object({
  dataset_id: datasetIdSchema,
});

export const ListAllDatasetsSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const FetchDatasetDataSchema = z.object({
  dataset_id: datasetIdSchema,
  resource_id: z.string().optional(),
  full_data: z.coerce.boolean().default(false),
});

const MetricSchema = z.object({
  op: z.enum(['sum', 'avg', 'min', 'max', 'count', 'count_distinct']),
  column: z.string().optional(),
  as: z.string().optional(),
});

const FilterSchema = z.object({
  column: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
  value: z.any(),
});

const SortSchema = z.object({
  column: z.string(),
  direction: z.enum(['asc', 'desc']).optional(),
});

export const AggregateDatasetSchema = z.object({
  dataset_id: datasetIdSchema,
  resource_id: z.string().optional(),
  group_by: z.array(z.string()).default([]),
  metrics: z.array(MetricSchema).min(1),
  filters: z.array(FilterSchema).default([]),
  sort: z.array(SortSchema).default([]),
  limit: z.coerce.number().int().min(1).max(1000).default(1000),
})

export const DownloadDatasetSchema = z.object({
  dataset_id: datasetIdSchema,
  resource_id: z.string().optional(),
  format: z.enum(['csv', 'json', 'geojson']).optional(),
});

export const GetPortalStatsSchema = z.object({});

export const ListGeoLayersSchema = z.object({
  dataset_id: datasetIdSchema,
});

export const FetchGeoFeaturesSchema = z.object({
  wfs_url: z.url(),
  typename: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(5000).default(100),
  property_filter: z.string().optional(),
});
