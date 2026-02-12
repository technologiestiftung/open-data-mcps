// ABOUTME: Chart builder with smart defaults for Datawrapper visualizations
// ABOUTME: Infers chart configuration from data and generates titles, axes, and labels

import { ChartType, ChartVariant, ChartConfig, GeoJSON, ValidationResult, ColumnAnalysis } from './types.js';

// Map our interface to Datawrapper type strings
const DATAWRAPPER_TYPE_MAP: Record<string, Record<string, string>> = {
  bar: {
    basic: 'd3-bars',
    stacked: 'd3-bars-stacked',
    split: 'd3-bars-split',
  },
  column: {
    basic: 'column-chart',
    grouped: 'grouped-column-chart',
    stacked: 'stacked-column-chart',
  },
  line: {
    basic: 'd3-lines',
  },
  area: {
    basic: 'd3-area',
  },
  scatter: {
    basic: 'd3-scatter-plot',
  },
  dot: {
    basic: 'd3-dot-plot',
  },
  range: {
    basic: 'd3-range-plot',
  },
  arrow: {
    basic: 'd3-arrow-plot',
  },
  pie: {
    basic: 'd3-pies',
  },
  donut: {
    basic: 'd3-donuts',
  },
  'election-donut': {
    basic: 'election-donut-chart',
  },
  table: {
    basic: 'tables',
  },
};

export class ChartBuilder {
  /**
   * Get Datawrapper type string from our chart_type and variant
   */
  getDatawrapperType(chartType: ChartType, variant?: ChartVariant): string {
    const typeMap = DATAWRAPPER_TYPE_MAP[chartType];
    if (!typeMap) {
      throw new Error(`Unknown chart type: ${chartType}`);
    }

    const v = variant || 'basic';
    const dwType = typeMap[v];
    if (!dwType) {
      throw new Error(`Invalid variant '${v}' for chart type '${chartType}'`);
    }

    return dwType;
  }

  /**
   * Analyze column types in data
   */
  analyzeColumns(data: Array<Record<string, any>>): ColumnAnalysis {
    const result: ColumnAnalysis = { categorical: [], numeric: [], date: [] };

    if (data.length === 0) {
      return result;
    }

    const sample = data[0];

    for (const [key, value] of Object.entries(sample)) {
      if (typeof value === 'number') {
        result.numeric.push(key);
      } else if (typeof value === 'string' && !isNaN(Date.parse(value)) && value.includes('-')) {
        result.date.push(key);
      } else {
        result.categorical.push(key);
      }
    }

    return result;
  }

  /**
   * Validate data against chart type requirements
   */
  validateDataForChartType(
    data: Array<Record<string, any>>,
    chartType: ChartType,
    variant?: ChartVariant
  ): ValidationResult {
    const cols = this.analyzeColumns(data);

    switch (chartType) {
      case 'bar':
      case 'column':
        if (cols.numeric.length === 0) {
          return {
            valid: false,
            error: `❌ Cannot create ${chartType} chart: No numeric columns found.\nFound: ${cols.categorical.length} categorical columns (${cols.categorical.join(', ')}).\nHint: Data must contain at least one numeric column for visualization.`
          };
        }
        if ((variant === 'stacked' || variant === 'grouped') && cols.numeric.length < 2) {
          return {
            valid: false,
            error: `❌ Cannot create ${variant} ${chartType}: Requires 2+ numeric columns.\nFound: ${cols.numeric.length} numeric column (${cols.numeric.join(', ')}).\nHint: Add more numeric columns, or use 'basic' variant.`
          };
        }
        if (variant === 'split' && cols.numeric.length !== 2) {
          return {
            valid: false,
            error: `❌ Cannot create split ${chartType}: Requires exactly 2 numeric columns.\nFound: ${cols.numeric.length} numeric columns (${cols.numeric.join(', ')}).\nHint: Data should have one column per side of the split.`
          };
        }
        break;

      case 'line':
      case 'area':
        if (cols.numeric.length === 0) {
          return {
            valid: false,
            error: `❌ Cannot create ${chartType} chart: No numeric columns found.\nFound: ${cols.categorical.length} categorical columns.\nHint: Data must contain at least one numeric column.`
          };
        }
        break;

      case 'scatter':
        if (cols.numeric.length < 2) {
          return {
            valid: false,
            error: `❌ Cannot create scatter plot: Requires at least 2 numeric columns.\nFound: ${cols.numeric.length} numeric column(s) (${cols.numeric.join(', ')}), ${cols.categorical.length} categorical column(s) (${cols.categorical.join(', ')}).\nHint: Need two numeric columns for x and y axes.`
          };
        }
        break;

      case 'dot':
        if (cols.numeric.length === 0) {
          return {
            valid: false,
            error: `❌ Cannot create dot plot: Requires at least 1 numeric column.\nFound: ${cols.categorical.length} categorical columns only.\nHint: Data should have [category, value] structure.`
          };
        }
        break;

      case 'range':
        if (cols.numeric.length < 2) {
          return {
            valid: false,
            error: `❌ Cannot create range plot: Requires at least 2 numeric columns for start/end values.\nFound: ${cols.numeric.length} numeric column(s).\nHint: Data should have columns like [category, start_value, end_value].`
          };
        }
        break;

      case 'arrow':
        if (cols.numeric.length < 2) {
          return {
            valid: false,
            error: `❌ Cannot create arrow plot: Requires at least 2 numeric columns for from/to values.\nFound: ${cols.numeric.length} numeric column(s).\nHint: Data should have columns like [category, from_value, to_value].`
          };
        }
        break;

      case 'pie':
      case 'donut':
      case 'election-donut':
        if (cols.numeric.length === 0) {
          return {
            valid: false,
            error: `❌ Cannot create ${chartType}: Requires 1 categorical + 1 numeric column.\nFound: ${cols.categorical.length} categorical, ${cols.numeric.length} numeric.\nHint: Data should have [label, value] structure.`
          };
        }
        if (cols.categorical.length === 0) {
          return {
            valid: false,
            error: `❌ Cannot create ${chartType}: Requires 1 categorical column for labels.\nFound: ${cols.numeric.length} numeric columns only.\nHint: Add a column with category/label names.`
          };
        }
        break;

      case 'table':
        // Tables accept any data structure
        break;
    }

    return { valid: true };
  }

  /**
   * Infer chart configuration from data
   */
  inferChartConfig(data: Array<Record<string, any>> | GeoJSON, chartType: ChartType, userTitle?: string): ChartConfig {
    if (chartType === 'map') {
      return this.inferMapConfig(data as GeoJSON, userTitle);
    }

    const dataArray = data as Array<Record<string, any>>;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      throw new Error('Data must be a non-empty array');
    }

    const title = userTitle || this.generateTitle(dataArray);

    // Charts that need axis configuration
    if (['bar', 'line', 'column', 'area'].includes(chartType)) {
      return this.inferBarLineConfig(dataArray, chartType, title);
    }

    // Charts that just need a title (pie, donut, scatter, dot, range, arrow, table, election-donut)
    return { title };
  }

  /**
   * Generate title from data structure
   */
  generateTitle(data: Array<Record<string, any>>): string {
    if (data.length === 0) return 'Data Visualization';

    const firstRow = data[0];
    const columns = Object.keys(firstRow);

    if (columns.length === 0) return 'Data Visualization';

    // Use first column name as title basis
    const firstColumn = columns[0];
    return this.formatLabel(firstColumn) + ' Overview';
  }

  /**
   * Format column name as human-readable label
   */
  formatLabel(columnName: string): string {
    return columnName
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Detect column types in data
   */
  detectColumnTypes(data: Array<Record<string, any>>): Map<string, 'string' | 'number' | 'date'> {
    const types = new Map<string, 'string' | 'number' | 'date'>();

    if (data.length === 0) return types;

    const firstRow = data[0];

    for (const [key, value] of Object.entries(firstRow)) {
      if (typeof value === 'number') {
        types.set(key, 'number');
      } else if (value instanceof Date || this.isDateString(value)) {
        types.set(key, 'date');
      } else {
        types.set(key, 'string');
      }
    }

    return types;
  }

  /**
   * Check if string is a date
   */
  private isDateString(value: any): boolean {
    if (typeof value !== 'string') return false;
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  /**
   * Infer configuration for bar and line charts
   */
  private inferBarLineConfig(data: Array<Record<string, any>>, chartType: ChartType, title: string): ChartConfig {
    const columnTypes = this.detectColumnTypes(data);

    // Find first string/date column for X-axis
    let xAxis: string | undefined;
    for (const [col, type] of columnTypes.entries()) {
      if (type === 'string' || type === 'date') {
        xAxis = col;
        break;
      }
    }

    // Find all numeric columns for Y-axis
    const yAxis: string[] = [];
    for (const [col, type] of columnTypes.entries()) {
      if (type === 'number') {
        yAxis.push(col);
      }
    }

    if (yAxis.length === 0) {
      throw new Error(`Cannot create ${chartType} chart: No numeric columns found in data. Data must contain at least one numeric column for visualization.`);
    }

    // Warn if too many categories
    if (xAxis && data.length > 20) {
      console.warn(`Warning: ${data.length} categories detected. Consider grouping or filtering for better visualization.`);
    }

    return {
      title,
      xAxis,
      yAxis,
      xLabel: xAxis ? this.formatLabel(xAxis) : undefined,
      yLabel: yAxis.length === 1 ? this.formatLabel(yAxis[0]) : 'Value',
      series: yAxis.map(col => this.formatLabel(col))
    };
  }

  /**
   * Infer configuration for maps
   */
  private inferMapConfig(geojson: GeoJSON, userTitle?: string): ChartConfig {
    // Validate GeoJSON structure
    if (!geojson.type || geojson.type !== 'FeatureCollection') {
      throw new Error('Invalid GeoJSON: Missing \'type\' field or not a FeatureCollection. Maps require GeoJSON FeatureCollection format.');
    }

    if (!geojson.features || !Array.isArray(geojson.features)) {
      throw new Error('Invalid GeoJSON: Missing \'features\' array. Maps require GeoJSON FeatureCollection format.');
    }

    if (geojson.features.length === 0) {
      throw new Error('Cannot create visualization: GeoJSON FeatureCollection is empty. Please provide at least one feature.');
    }

    // Validate that features have geometry
    for (const feature of geojson.features) {
      if (!feature.geometry) {
        throw new Error('Invalid GeoJSON: Feature missing geometry object.');
      }
    }

    const title = userTitle || 'Map Visualization';
    const bbox = this.calculateBoundingBox(geojson);
    const basemap = this.selectBasemap(bbox);

    return {
      title,
      bbox,
      basemap
    };
  }

  /**
   * Select appropriate basemap based on data extent
   */
  private selectBasemap(bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number }): string {
    // Berlin city boundaries (approximate)
    const BERLIN_BOUNDS = {
      minLon: 13.08,
      maxLon: 13.76,
      minLat: 52.34,
      maxLat: 52.68
    };

    // Check if data extends beyond Berlin boundaries
    const withinBerlin = bbox.minLon >= BERLIN_BOUNDS.minLon &&
                         bbox.maxLon <= BERLIN_BOUNDS.maxLon &&
                         bbox.minLat >= BERLIN_BOUNDS.minLat &&
                         bbox.maxLat <= BERLIN_BOUNDS.maxLat;

    if (withinBerlin) {
      return 'berlin-boroughs';
    } else {
      // Data extends beyond Berlin, use metropolitan region
      return 'berlin-metropolitan-region';
    }
  }

  /**
   * Calculate bounding box from GeoJSON features
   */
  private calculateBoundingBox(geojson: GeoJSON): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const feature of geojson.features) {
      const coords = this.extractCoordinates(feature.geometry);

      for (const [lon, lat] of coords) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }

    return { minLon, maxLon, minLat, maxLat };
  }

  /**
   * Extract all coordinates from a geometry object
   */
  private extractCoordinates(geometry: any): Array<[number, number]> {
    const coords: Array<[number, number]> = [];

    const flatten = (arr: any): void => {
      if (Array.isArray(arr)) {
        if (arr.length === 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
          coords.push([arr[0], arr[1]]);
        } else {
          arr.forEach(flatten);
        }
      }
    };

    if (geometry.coordinates) {
      flatten(geometry.coordinates);
    }

    return coords;
  }

  /**
   * Strip unnecessary properties from GeoJSON to reduce token usage
   * Keeps only name and numeric properties for symbol and choropleth maps
   */
  stripGeoJSONProperties(geojson: GeoJSON, mapType: string): GeoJSON {
    const strippedFeatures = geojson.features.map(feature => {
      if (!feature.properties) {
        return feature;
      }

      let keptProperties: Record<string, any> = {};

      // Keep name/label property
      const nameKeys = ['name', 'title', 'label', 'Name', 'Title'];
      for (const key of nameKeys) {
        if (feature.properties[key]) {
          keptProperties.name = feature.properties[key];
          break;
        }
      }

      // Keep all numeric properties for data visualization
      for (const [key, value] of Object.entries(feature.properties)) {
        if (typeof value === 'number') {
          keptProperties[key] = value;
        }
      }

      return {
        ...feature,
        properties: keptProperties
      };
    });

    return {
      type: 'FeatureCollection',
      features: strippedFeatures
    };
  }

  /**
   * Get a sample feature from GeoJSON for preview
   */
  getSampleFeature(geojson: GeoJSON): any {
    if (geojson.features.length === 0) {
      return null;
    }
    return geojson.features[0];
  }

  /**
   * Convert data to CSV format for Datawrapper
   */
  formatForDatawrapper(data: Array<Record<string, any>>): string {
    if (data.length === 0) return '';

    const columns = Object.keys(data[0]);
    const header = columns.join(',');

    const rows = data.map(row => {
      return columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return '';

        // Escape values containing commas or quotes
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    });

    return [header, ...rows].join('\n');
  }

  /**
   * Process GeoJSON for Datawrapper map
   */
  processGeoJSON(geojson: GeoJSON, mapType: string): string {
    // Symbol maps need CSV format with lat/lon columns
    if (mapType === 'd3-maps-symbols') {
      return this.convertGeoJSONToCSV(geojson);
    }

    // Choropleth maps use GeoJSON format
    return JSON.stringify(geojson);
  }

  /**
   * Convert GeoJSON to CSV format for symbol maps
   */
  private convertGeoJSONToCSV(geojson: GeoJSON): string {
    const rows: string[] = [];

    // Header row
    rows.push('name,latitude,longitude');

    // Data rows
    for (const feature of geojson.features) {
      if (feature.geometry.type === 'Point') {
        const coords = feature.geometry.coordinates as [number, number];
        const name = feature.properties?.name || 'Unnamed';
        const lon = coords[0];
        const lat = coords[1];

        // Escape name if it contains commas or quotes
        const escapedName = name.includes(',') || name.includes('"')
          ? `"${name.replace(/"/g, '""')}"`
          : name;

        rows.push(`${escapedName},${lat},${lon}`);
      }
    }

    return rows.join('\n');
  }

  /**
   * Validate data before creating visualization
   */
  validateData(data: Array<Record<string, any>> | GeoJSON, chartType: ChartType): void {
    // Check for empty data
    if (chartType === 'map') {
      const geojson = data as GeoJSON;
      if (!geojson.features || geojson.features.length === 0) {
        throw new Error('Cannot create visualization: Data array is empty. Please provide at least one row of data.');
      }
      if (geojson.features.length > 10000) {
        throw new Error(`Data exceeds Datawrapper limit of 10,000 rows (provided: ${geojson.features.length}). Please filter or aggregate the data before visualization.`);
      }
    } else {
      const dataArray = data as Array<Record<string, any>>;
      if (!Array.isArray(dataArray) || dataArray.length === 0) {
        throw new Error('Cannot create visualization: Data array is empty. Please provide at least one row of data.');
      }
      if (dataArray.length > 10000) {
        throw new Error(`Data exceeds Datawrapper limit of 10,000 rows (provided: ${dataArray.length}). Please filter or aggregate the data before visualization.`);
      }
    }
  }
}
