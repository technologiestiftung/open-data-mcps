import { z } from 'zod';

const datasetIdSchema = z.string().min(1, 'dataset_id is required');

export const SearchDatasetsSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
});

export const SearchFilteredSchema = z.object({
  query: z.string().default('*'),
  organization: z.string().optional(),
  tag: z.string().optional(),
  format: z.string().optional(),
  modified_since: z.string().optional(),
  sort: z.string().default('score desc, metadata_modified desc').optional(),
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
  limit: z.coerce.number().int().min(1).max(1000).default(100),
})

export const DownloadDatasetSchema = z.object({
  dataset_id: datasetIdSchema,
  resource_id: z.string().optional(),
  format: z.enum(['csv', 'json', 'geojson']).optional(),
});

export const GetPortalStatsSchema = z.object({});
