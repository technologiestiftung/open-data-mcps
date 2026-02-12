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

export interface CreateVisualizationParams {
  data: Array<Record<string, any>> | GeoJSON;
  chart_type: ChartType;
  variant?: ChartVariant;
  map_type?: MapType;
  basemap?: BerlinBasemap;
  region_column?: string;
  value_column?: string;
  title?: string;
  description?: string;
  source_dataset_id?: string;
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
  };
  visualize?: Record<string, any>;
  axes?: Record<string, any>;
}

export interface DatawrapperChart {
  id: string;
  type: string;
  title: string;
  metadata: DatawrapperChartMetadata;
  publicUrl?: string;
  publicId?: string;
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
