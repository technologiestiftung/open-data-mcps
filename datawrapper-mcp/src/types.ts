// ABOUTME: TypeScript type definitions for Datawrapper MCP server
// ABOUTME: Includes interfaces for chart types, API responses, and configuration

export type ChartType =
  | 'bar'
  | 'column'
  | 'line'
  | 'area'
  | 'scatter'
  | 'dot'
  | 'range'
  | 'arrow'
  | 'pie'
  | 'donut'
  | 'election-donut'
  | 'table'
  | 'map';

export type ChartVariant = 'basic' | 'stacked' | 'grouped' | 'split';

export type MapType = 'd3-maps-choropleth' | 'd3-maps-symbols';

export type BerlinBasemap =
  | 'berlin-boroughs'
  | 'berlin-prognoseraume-2021'
  | 'berlin-bezreg-2021'
  | 'berlin-planungsraeume-2021';

export interface LORLevel {
  basemap: BerlinBasemap;
  idColumn: string;        // Column name in data (e.g., 'BEZ_ID')
  idKey: string;           // Datawrapper key attribute (e.g., 'Gemeinde_s')
  nameColumn: string;      // Column name for names (e.g., 'BEZ')
  nameKey: string;         // Datawrapper name key (e.g., 'Gemeinde_n')
  label: string;           // Human-readable label (e.g., 'Bezirke')
  count: number;           // Number of regions
}

export interface DetectionResult {
  detected: boolean;
  primaryLevel?: LORLevel;
  allLevels: LORLevel[];
  regionColumn: string;
  valueColumn?: string;
  matchedRows: number;
  totalRows: number;
  unmatchedValues?: string[];
}

/**
 * Styling and placement options shared by create_visualization and update_visualization
 */
export interface ChartStyleParams {
  secondary_color?: string;
  color_scale?: string[];
  language?: string;
  notes?: string;
  number_prepend?: string;
  number_append?: string;
  number_divisor?: number;
  number_columns?: string[];
  folder_id?: number;
  color_column?: string;
  category_colors?: Record<string, string>;
  size_column?: string;
}

export interface CreateVisualizationParams extends ChartStyleParams {
  api_key: string;
  preview?: boolean;
  data: Array<Record<string, any>> | GeoJSON;
  chart_type: ChartType;
  variant?: ChartVariant;
  map_type?: MapType;
  basemap?: BerlinBasemap;
  region_column?: string;
  value_column?: string;
  base_color?: string;
  thick?: boolean;
  value_label_format?: string;
  visualize_overrides?: Record<string, any>;
  title?: string;
  description?: string;
  source_dataset_id?: string;
}

export interface PublishVisualizationParams {
  api_key: string;
  chart_id: string;
  preview?: boolean;
}

export type ListOrderBy = 'createdAt' | 'lastModifiedAt' | 'publishedAt' | 'title' | 'type';

export type SortOrder = 'ASC' | 'DESC';

export interface ListVisualizationsParams {
  api_key: string;
  search?: string;
  folder_id?: number;
  team_id?: string;
  published?: boolean;
  order_by?: ListOrderBy;
  order?: SortOrder;
  limit?: number;
  offset?: number;
}

export interface GetVisualizationParams {
  api_key: string;
  chart_id: string;
  include_data?: boolean;
  include_metadata?: boolean;
}

export interface UpdateVisualizationParams extends ChartStyleParams {
  api_key: string;
  preview?: boolean;
  chart_id: string;
  title?: string;
  description?: string;
  byline?: string;
  source_name?: string;
  source_url?: string;
  base_color?: string;
  thick?: boolean;
  value_label_format?: string;
  visualize_overrides?: Record<string, any>;
  chart_type?: ChartType;
  variant?: ChartVariant;
  map_type?: MapType;
  transpose?: boolean;
  data?: Array<Record<string, any>> | GeoJSON;
}

export interface DeleteVisualizationParams {
  api_key: string;
  chart_id: string;
}

export interface ExportVisualizationPngParams {
  api_key: string;
  chart_id: string;
  width?: number;
  height?: number;
  plain?: boolean;
  zoom?: number;
  transparent?: boolean;
  border_width?: number;
  border_color?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ColumnAnalysis {
  categorical: string[];
  numeric: string[];
  date: string[];
}

export interface GeoJSON {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: {
      type: string;
      coordinates: any;
    };
    properties?: Record<string, any>;
  }>;
}

export interface DatawrapperChartMetadata {
  title?: string;
  describe?: {
    intro?: string;
    byline?: string;
    'source-name'?: string;
    'source-url'?: string;
    [key: string]: any;
  };
  visualize?: Record<string, any>;
  axes?: Record<string, any>;
  publish?: Record<string, any>;
  [key: string]: any;
}

export interface DatawrapperChart {
  id: string;
  type: string;
  title: string;
  metadata: DatawrapperChartMetadata;
  publicUrl?: string | null;
  publicId?: string | null;
  publicVersion?: number;
  createdAt?: string;
  lastModifiedAt?: string;
  publishedAt?: string | null;
  lastEditStep?: number;
  folderId?: number | null;
  folder?: { name?: string } | null;
  organizationId?: string | null;
  language?: string;
  theme?: string;
}

/**
 * Normalized response of POST /charts/{id}/publish ({ data: Chart, version, url })
 */
export interface DatawrapperPublishResult {
  chart: DatawrapperChart;
  version?: number;
  url?: string;
}

/**
 * Query options for GET /charts/{id}/export/png (camelCase, as the Datawrapper API expects them)
 */
export interface ExportPngOptions {
  width?: number;
  height?: number;
  plain?: boolean;
  zoom?: number;
  transparent?: boolean;
  borderWidth?: number;
  borderColor?: string;
  // Request timeout in milliseconds (not sent to the API)
  timeoutMs?: number;
}

/**
 * Query options for GET /charts (camelCase, as the Datawrapper API expects them)
 */
export interface ListChartsOptions {
  search?: string;
  folderId?: number;
  teamId?: string;
  published?: boolean;
  orderBy?: ListOrderBy;
  order?: SortOrder;
  limit?: number;
  offset?: number;
}

/**
 * Response of GET /charts. Items are lightweight (no full metadata unless expand=true).
 */
export interface DatawrapperChartList {
  list: Array<Omit<DatawrapperChart, 'metadata'> & { metadata?: DatawrapperChartMetadata }>;
  total: number;
  next?: string;
}

/**
 * Body for PATCH /charts/{id}. All fields optional; metadata is merged server-side.
 */
export interface DatawrapperChartUpdate {
  title?: string;
  type?: string;
  language?: string;
  folderId?: number;
  metadata?: DatawrapperChartMetadata;
}

export interface ChartLogEntry {
  chartId: string;
  editUrl: string;
  chartType?: ChartType;
  title?: string;
  createdAt?: string;
  sourceDatasetId?: string;
  sourceDatasetUrl?: string;
  dataRowCount?: number;
  published: boolean;
  url?: string;
  embedCode?: string;
  publishedAt?: string;
}

export interface ChartConfig {
  title: string;
  xAxis?: string;
  yAxis?: string[];
  xLabel?: string;
  yLabel?: string;
  series?: string[];
  bbox?: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  };
  basemap?: string;
}
