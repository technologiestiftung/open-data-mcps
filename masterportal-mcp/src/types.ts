// ABOUTME: TypeScript type definitions for Masterportal MCP server
// ABOUTME: Includes interfaces for layers, portal config, and session state

export interface LayerStyle {
  color?: string;
  opacity?: number;
  icon?: string;
}

export interface Layer {
  id: string;
  name: string;
  type: 'geojson' | 'wfs';
  data?: string;  // Inline GeoJSON string
  url?: string;   // URL to GeoJSON or WFS endpoint
  featureType?: string;  // WFS feature type name (for WFS with multiple types)
  style?: LayerStyle;
  // Resolved data (fetched from URL or parsed from inline)
  resolvedData?: GeoJSON;
}

export interface MapConfig {
  title: string;
  center: [number, number];  // [lon, lat]
  zoom: number;
  basemapUrl?: string;  // Custom WMS basemap URL
}

export interface PortalSession {
  id: string;
  layers: Layer[];
  mapConfig: MapConfig;
  createdAt: Date;
  lastAccessedAt: Date;
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

export interface LayerInput {
  id: string;
  name: string;
  type: 'geojson' | 'wfs';
  data?: string | object;  // Inline GeoJSON (string or object)
  url?: string;            // URL to GeoJSON or WFS endpoint
  featureType?: string;    // WFS feature type name (for WFS with multiple types)
  style?: LayerStyle;
}

export interface CreatePortalParams {
  title: string;
  center?: [number, number];  // [lon, lat], default: Berlin [13.4, 52.52]
  zoom?: number;              // 1-18, default: 10
  basemap_url?: string;       // Custom WMS basemap URL
  layers: LayerInput[];       // At least one layer required
  filename?: string;          // Output filename (without .zip)
}

export interface GeneratePortalResult {
  download_url: string;
  expires_at: string;
  layers_count: number;
  filename: string;
}

export interface DownloadFile {
  filename: string;
  path: string;
  createdAt: Date;
  expiresAt: Date;
}
