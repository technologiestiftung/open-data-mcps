#!/usr/bin/env node
// ABOUTME: MCP server for Datawrapper visualization integration
// ABOUTME: Exposes tools to create, list, inspect, update, publish and delete charts via the Datawrapper API

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DatawrapperApiError, DatawrapperClient } from './datawrapper-client.js';
import { ChartBuilder } from './chart-builder.js';
import { ChartLogger } from './chart-logger.js';
import {
  CreateVisualizationParams,
  PublishVisualizationParams,
  ListVisualizationsParams,
  GetVisualizationParams,
  UpdateVisualizationParams,
  DeleteVisualizationParams,
  ChartStyleParams,
  ChartType,
  ChartVariant,
  GeoJSON,
  DetectionResult,
  DatawrapperChart,
  DatawrapperChartMetadata,
  DatawrapperChartUpdate,
} from './types.js';
import { BasemapMatcher } from './basemap-matcher.js';
import {
  buildColorSettings,
  buildColumnFormat,
  detectNumericColumnsFromCsv,
  hasNumberFormat,
  usesTransposedLayout,
} from './style-options.js';
import {
  CreateVisualizationSchema,
  PublishVisualizationSchema,
  ListVisualizationsSchema,
  GetVisualizationSchema,
  UpdateVisualizationSchema,
  DeleteVisualizationSchema,
} from './schemas.js';

// list_visualizations paging defaults (Datawrapper allows up to 500, we cap to keep responses compact)
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

// Size limits for get_visualization output
const MAX_DATA_LINES = 50;
const MAX_DATA_CHARS = 5000;
const MAX_METADATA_CHARS = 8000;

// Visualize settings worth surfacing in get_visualization (shown only if present)
const KEY_VISUALIZE_SETTINGS = [
  'base-color',
  'base-color2',
  'symbol-color',
  'colorscale',
  'custom-colors',
  'color-category',
  'thick',
  'value-label-format',
  'show-value-labels',
  'show-color-key',
  'basemap',
  'map-key-attr',
];

/**
 * A chart counts as published once it has a publish timestamp or a public version
 */
function isPublished(chart: Pick<DatawrapperChart, 'publishedAt' | 'publicVersion'>): boolean {
  return Boolean(chart.publishedAt) || (chart.publicVersion ?? 0) > 0;
}

/**
 * Format an API timestamp as "YYYY-MM-DD HH:MM UTC" (falls back to the raw value)
 */
function formatTimestamp(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return value;
  }
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Truncate a string to maxChars, marking the cut
 */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Check if a Datawrapper type string is a map type (d3-maps-*, locator-map, or any other *map* type)
 */
function isMapType(dwType?: string): boolean {
  return typeof dwType === 'string' && dwType.includes('map');
}

/**
 * Build a tool error result in the shared "❌ ..." format
 */
function errorResult(message: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `❌ ${message}`
      }
    ],
    isError: true
  };
}

/**
 * Get default visualize settings for chart types that need them
 */
function getDefaultVisualizeSettings(chartType: ChartType, variant?: ChartVariant): Record<string, any> {
  switch (chartType) {
    case 'range':
    case 'arrow':
      return {
        'show-value-labels': true,
        'range-value-labels': 'both',
        'label-first-range': true,
        'show-color-key': true,
      };
    case 'dot':
      return {
        'show-value-labels': true,
        'range-value-labels': 'both',
        'label-first-range': true,
        'show-color-key': true,
      };
    case 'bar':
    case 'column':
      if (variant === 'stacked' || variant === 'grouped' || variant === 'split') {
        return {
          'show-color-key': true,
        };
      }
      return {};
    case 'line':
    case 'area':
      return {
        'show-color-key': true,
      };
    case 'pie':
    case 'donut':
    case 'election-donut':
      return {
        'show-color-key': true,
      };
    default:
      return {};
  }
}

/**
 * Translate the shared styling options into metadata sections for a Datawrapper type.
 * numericColumns are the columns number formats apply to when number_columns is not given.
 */
function buildStyleMetadata(
  dwType: string,
  params: ChartStyleParams & { base_color?: string },
  numericColumns: string[]
): { visualize: Record<string, any>; data: Record<string, any>; annotate: Record<string, any>; warnings: string[]; changes: string[] } {
  const { visualize, warnings } = buildColorSettings(dwType, params);
  const data: Record<string, any> = {};
  const annotate: Record<string, any> = {};
  const changes: string[] = [];

  if (params.notes !== undefined) {
    annotate.notes = params.notes;
    changes.push('Notes updated');
  }

  if (hasNumberFormat(params)) {
    const columns = params.number_columns ?? numericColumns;
    if (columns.length === 0) {
      warnings.push('No numeric columns found for number_prepend/number_append/number_divisor; pass number_columns to choose the columns.');
    } else {
      data['column-format'] = buildColumnFormat(columns, params);
      const parts = [
        params.number_prepend !== undefined ? `prefix "${params.number_prepend}"` : '',
        params.number_append !== undefined ? `suffix "${params.number_append}"` : '',
        params.number_divisor !== undefined ? `divisor 10^${params.number_divisor}` : '',
      ].filter(Boolean);
      changes.push(`Number format (${parts.join(', ')}) for column(s): ${columns.join(', ')}`);
    }
  }

  return { visualize, data, annotate, warnings, changes };
}

/**
 * Numeric columns of tabular data, or of the feature properties of a GeoJSON FeatureCollection
 */
function numericColumnsOf(chartBuilder: ChartBuilder, data: Array<Record<string, any>> | GeoJSON): string[] {
  if (Array.isArray(data)) {
    return chartBuilder.analyzeColumns(data).numeric;
  }
  const properties = data?.features?.[0]?.properties || {};
  return Object.keys(properties).filter(key => typeof properties[key] === 'number');
}

/**
 * Explain 403/404 errors of requests that name a folder or team. The client maps these to
 * "chart not found" / missing scope, which is misleading when the folder or team is the problem.
 */
function withFolderOrTeamContext(error: any, context: { folderId?: number; teamId?: string; action?: string }): any {
  if (!(error instanceof DatawrapperApiError) || (error.status !== 403 && error.status !== 404)) {
    return error;
  }
  if (context.folderId !== undefined) {
    const consequence = context.action ? `, so the chart was not ${context.action}` : '';
    return new DatawrapperApiError(`Folder ${context.folderId} was not found or your API token has no access to it${consequence}. Check the folder ID: it is the number at the end of the folder URL in the Datawrapper archive.`, error.status);
  }
  if (context.teamId !== undefined) {
    return new DatawrapperApiError(`No access to team "${context.teamId}": the team ID is wrong, your account is not a member of this team, or your API token lacks the chart:read scope.`, error.status);
  }
  return error;
}

/**
 * Format detection response for choropleth map auto-detection
 */
function formatDetectionResponse(detection: DetectionResult): string {
  if (!detection.detected) {
    return `❌ Could not detect Berlin region data.

Please ensure your data contains a column with one of:
- Bezirk IDs (BEZ_ID) or names (e.g., "Mitte", "Pankow")
- Prognoseraum IDs (PGR_ID) or names
- Bezirksregion IDs (BZR_ID) or names
- Planungsraum IDs (PLR_ID) or names

Found columns: ${Object.keys(detection.totalRows > 0 ? {} : {}).join(', ') || 'none'}`;
  }

  const primary = detection.primaryLevel!;
  let response = `✅ Detected Berlin ${primary.label} data

**Detected level:** ${primary.label} (${primary.count} regions)
**Region column:** ${detection.regionColumn}
**Value column:** ${detection.valueColumn || 'none found'}
**Match rate:** ${detection.matchedRows}/${detection.totalRows} rows`;

  if (detection.unmatchedValues && detection.unmatchedValues.length > 0) {
    response += `\n**Unmatched values:** ${detection.unmatchedValues.join(', ')}`;
  }

  if (detection.allLevels.length > 1) {
    response += `\n\n**Available aggregation levels:**`;
    for (const level of detection.allLevels) {
      const isCurrent = level.basemap === primary.basemap;
      response += `\n- ${level.label} (${level.count} regions)${isCurrent ? ' ← detected' : ' - requires aggregation'}`;
    }
  }

  response += `\n\n**To create the map**, call again with:
- \`basemap: "${primary.basemap}"\`${detection.allLevels.length > 1 ? ' (or choose another level)' : ''}`;

  return response;
}

export class DatawrapperMCPServer {
  private server: McpServer;
  private chartBuilder: ChartBuilder;
  private chartLogger: ChartLogger;
  private basemapMatcher: BasemapMatcher;

  constructor(chartLogPath?: string) {
    const logPath = chartLogPath || process.env.CHART_LOG_PATH || './charts-log.json';

    this.server = new McpServer(
      {
        name: 'datawrapper-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.chartBuilder = new ChartBuilder();
    this.chartLogger = new ChartLogger(logPath);
    this.basemapMatcher = new BasemapMatcher();

    this.setupHandlers();
  }

  private getAuthenticatedClient(apiKey: string): DatawrapperClient {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('api_key is required');
    }

    return new DatawrapperClient(apiKey);
  }

  private setupHandlers() {
    this.server.registerTool(
      'create_visualization',
      {
        title: 'Create Datawrapper chart',
        description: 'Create a NEW data visualization using the Datawrapper API. To change an existing chart (colors, title, description, data, type), use `update_visualization` instead - it keeps the chart ID. The chart is NOT published automatically - use `publish_visualization` after the user approves it. Supports bar, column, line, area, scatter, dot, range, arrow, pie, donut, election-donut, table, and map charts. Use "variant" for bar (basic/stacked/split) and column (basic/grouped/stacked) charts. **For maps, map_type is REQUIRED**: "d3-maps-symbols" (points with GeoJSON) or "d3-maps-choropleth" (regions with tabular data). **For choropleth maps**: provide tabular data with Berlin region identifiers (Bezirke, Prognoseräume, Bezirksregionen, or Planungsräume). If basemap is not specified, the tool will auto-detect and return available options. Optional styling: base_color (also colors map points / the choropleth gradient), secondary_color (range end), color_scale (choropleth), language (e.g. "de-DE" for German number formatting), notes, number_prepend/number_append/number_divisor, folder_id. Returns an edit URL where the user can preview and adjust the chart before publishing.',
        inputSchema: CreateVisualizationSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (args) => {
        return await this.handleCreateVisualization(args as CreateVisualizationParams);
      }
    );

    this.server.registerTool(
      'publish_visualization',
      {
        title: 'Publish Datawrapper chart',
        description: 'Publish a previously created visualization to make it publicly viewable. Use this after the user has reviewed and approved the chart in the Datawrapper editor. Also use it to republish a chart after `update_visualization`, so that the changes become visible in the public version and embeds.',
        inputSchema: PublishVisualizationSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        return await this.handlePublishVisualization(args as PublishVisualizationParams);
      }
    );

    this.server.registerTool(
      'list_visualizations',
      {
        title: 'List Datawrapper charts',
        description: 'List charts in the Datawrapper account of the API token (newest first by default). Returns ID, title, type, publish status, public URL and edit URL per chart, plus the total count. Supports search, folder/team filters, sorting and pagination via limit/offset. Use this to find chart IDs for `get_visualization`, `update_visualization`, `publish_visualization` or `delete_visualization`.',
        inputSchema: ListVisualizationsSchema,
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args) => {
        return await this.handleListVisualizations(args as ListVisualizationsParams);
      }
    );

    this.server.registerTool(
      'get_visualization',
      {
        title: 'Get Datawrapper chart',
        description: 'Get details of an existing Datawrapper chart by ID: title, type, publish status, public URL and embed code (if published), edit URL, timestamps, folder, description/byline/source, key style settings (e.g. base-color) and axes. Optionally includes the current dataset (include_data) and the raw metadata JSON (include_metadata).',
        inputSchema: GetVisualizationSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        return await this.handleGetVisualization(args as GetVisualizationParams);
      }
    );

    this.server.registerTool(
      'update_visualization',
      {
        title: 'Update Datawrapper chart',
        description: 'Modify an existing Datawrapper chart in place - the chart keeps its ID, edit URL and embed codes. Use this for small changes such as colors (base_color, secondary_color for range ends, color_scale for choropleth maps, visualize_overrides e.g. custom-colors), title, description, byline, source, notes, language/locale (e.g. "de-DE" for German number formatting), number prefix/suffix/divisor, value label format, folder, chart type/variant, transpose, or to replace the dataset (data). Provide at least one change; only the given fields change. Changes are NOT published automatically: if the chart was already published, its public version and embeds keep showing the old state until `publish_visualization` is called again - ask the user before republishing.',
        inputSchema: UpdateVisualizationSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        return await this.handleUpdateVisualization(args as UpdateVisualizationParams);
      }
    );

    this.server.registerTool(
      'delete_visualization',
      {
        title: 'Delete Datawrapper chart',
        description: 'Delete a Datawrapper chart by ID. **Before calling this tool you MUST show the user the chart title and ID (e.g. from `get_visualization` or `list_visualizations`) and get their explicit confirmation to delete it.** Never delete charts on your own initiative or as a cleanup step. Datawrapper moves deleted charts to its trash, where they are kept for 30 days before being deleted permanently.',
        inputSchema: DeleteVisualizationSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        return await this.handleDeleteVisualization(args as DeleteVisualizationParams);
      }
    );
  }

  private async handleCreateVisualization(params: CreateVisualizationParams): Promise<CallToolResult> {
    try {
      const { api_key, data, chart_type, variant, map_type, base_color, thick, value_label_format, visualize_overrides, title, description, source_dataset_id, language, folder_id } = params;
      const datawrapperClient = this.getAuthenticatedClient(api_key);

      // Validate map_type is provided for maps
      if (chart_type === 'map' && !map_type) {
        throw new Error('map_type is required when chart_type is "map". Choose: (1) "d3-maps-symbols" for point locations (requires GeoJSON), or (2) "d3-maps-choropleth" for region comparison (requires tabular data with Berlin region identifiers).');
      }

      // Handle choropleth maps separately
      if (chart_type === 'map' && map_type === 'd3-maps-choropleth') {
        return await this.handleChoroplethMap(datawrapperClient, params);
      }

      // Validate data structure for the chart type
      if (chart_type !== 'map') {
        const dataArray = data as Array<Record<string, any>>;
        const validation = this.chartBuilder.validateDataForChartType(dataArray, chart_type, variant);
        if (!validation.valid) {
          throw new Error(validation.error);
        }
      } else {
        this.chartBuilder.validateData(data, chart_type);
      }

      // Infer chart configuration
      const config = this.chartBuilder.inferChartConfig(data, chart_type, title);

      // Get Datawrapper chart type
      const dwChartType = chart_type === 'map' ? map_type! : this.chartBuilder.getDatawrapperType(chart_type, variant);

      // Get chart-type-specific visualize settings
      const typeSpecificSettings = getDefaultVisualizeSettings(chart_type, variant);

      // Colors, notes and number formats in the keys this chart type reads
      const style = buildStyleMetadata(dwChartType, params, numericColumnsOf(this.chartBuilder, data));

      // Create initial chart metadata with clean, modern styling
      const metadata: any = {
        visualize: {
          'base-color': base_color || '#2A7FFF',
          'thick': thick ?? false,
          'value-label-format': value_label_format || '0,0.[00]',
          ...typeSpecificSettings,
          ...style.visualize,
          ...(visualize_overrides || {}),
        },
        publish: chart_type === 'map' ? {
          'embed-width': 600,
          'embed-height': 600
        } : undefined
      };

      // Grouped/stacked column charts draw rows as series unless transposed: make the first column the x-axis
      if (usesTransposedLayout(dwChartType)) {
        style.data.transpose = true;
      }
      if (Object.keys(style.data).length > 0) {
        metadata.data = style.data;
      }
      if (Object.keys(style.annotate).length > 0) {
        metadata.annotate = style.annotate;
      }

      if (config.title) {
        metadata.title = config.title;
      }

      // Add description and source information
      if (description || source_dataset_id) {
        metadata.describe = {};
        if (description) {
          metadata.describe.intro = description;
        }
        if (source_dataset_id) {
          metadata.describe['source-name'] = 'Berlin Open Data';
          metadata.describe['source-url'] = `https://daten.berlin.de/datensaetze/${source_dataset_id}`;
        }
      }

      // Add chart-specific configuration
      if (['bar', 'column', 'line', 'area'].includes(chart_type)) {
        if (config.xAxis) {
          metadata.axes = {
            x: config.xAxis
          };
        }
      } else if (chart_type === 'scatter') {
        const dataArray = data as Array<Record<string, any>>;
        const cols = this.chartBuilder.analyzeColumns(dataArray);
        if (cols.categorical.length > 0 && cols.numeric.length >= 2) {
          metadata.axes = {
            x: cols.numeric[0],
            y: cols.numeric[1],
            labels: cols.categorical[0]
          };
        }
      } else if (chart_type === 'map' && map_type === 'd3-maps-symbols' && config.basemap) {
        metadata.visualize.basemap = config.basemap;
        metadata.visualize['map-type'] = 'map-symbol';
        metadata.visualize['fitcontent'] = false;
      }

      // Create chart
      const variantLabel = variant && variant !== 'basic' ? ` (${variant})` : '';
      const chartTypeLabel = chart_type === 'map' ? `${map_type} map` : `${chart_type}${variantLabel} chart`;
      console.error(`Creating ${chartTypeLabel}...`);
      const chart = await datawrapperClient.createChart(dwChartType, metadata, config.title, { language, folderId: folder_id })
        .catch(error => { throw withFolderOrTeamContext(error, { folderId: folder_id, action: 'created' }); });

      // Prepare and upload data
      let dataString: string;
      let rowCount: number;
      let sampleFeature: any = null;

      if (chart_type === 'map') {
        const geojson = data as GeoJSON;
        rowCount = geojson.features.length;
        sampleFeature = this.chartBuilder.getSampleFeature(geojson);

        if (map_type === 'd3-maps-symbols') {
          dataString = this.chartBuilder.processGeoJSON(geojson, map_type);
        } else {
          const strippedGeoJSON = this.chartBuilder.stripGeoJSONProperties(geojson, map_type!);
          dataString = this.chartBuilder.processGeoJSON(strippedGeoJSON, map_type!);
        }
      } else {
        const dataArray = data as Array<Record<string, any>>;
        dataString = this.chartBuilder.formatForDatawrapper(dataArray);
        rowCount = dataArray.length;
      }

      console.error(`Uploading data (${rowCount} rows)...`);
      await datawrapperClient.uploadData(chart.id, dataString);

      // Get edit URL (chart is not published yet)
      const editUrl = datawrapperClient.getEditUrl(chart.id);

      // Log chart creation asynchronously
      this.chartLogger.logChart({
        chartId: chart.id,
        editUrl,
        chartType: chart_type,
        title: config.title,
        createdAt: new Date().toISOString(),
        sourceDatasetId: source_dataset_id,
        sourceDatasetUrl: source_dataset_id ? `https://daten.berlin.de/datensaetze/${source_dataset_id}` : undefined,
        dataRowCount: rowCount,
        published: false
      }).catch((err: Error) => console.error('Background logging failed:', err));

      // Format response - chart is ready for review but not published
      let responseText = `✅ Chart created (not yet published)

✏️ **Edit & Preview**: ${editUrl}
🆔 **Chart ID**: ${chart.id}

**IMPORTANT: Do NOT publish automatically.** Present this edit link to the user and ask: "Would you like me to publish this chart, or do you want to make changes first?"`;

      if (style.warnings.length > 0) {
        responseText += `\n\n⚠️ **Warnings:**\n${style.warnings.map(w => `- ${w}`).join('\n')}`;
      }

      if (chart_type === 'map' && sampleFeature) {
        responseText += `

📍 **Map type**: ${map_type}
📦 **Features**: ${rowCount}
🔍 **Sample feature**:
\`\`\`json
${JSON.stringify(sampleFeature, null, 2)}
\`\`\``;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error: any) {
      console.error('Error creating visualization:', error);

      return {
        content: [
          {
            type: 'text',
            text: `❌ ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleChoroplethMap(datawrapperClient: DatawrapperClient, params: CreateVisualizationParams): Promise<CallToolResult> {
    const { data, basemap, region_column, value_column, base_color, thick, value_label_format, visualize_overrides, title, description, source_dataset_id, language, folder_id } = params;

    // Choropleth maps require tabular data, not GeoJSON
    if (!Array.isArray(data)) {
      throw new Error('Choropleth maps require tabular data (array of objects), not GeoJSON. For GeoJSON point data, use map_type: "d3-maps-symbols" instead.');
    }

    const dataArray = data as Array<Record<string, any>>;

    if (dataArray.length === 0) {
      throw new Error('Cannot create choropleth map: Data array is empty.');
    }

    // Detect available LOR levels
    const detection = this.basemapMatcher.detectAvailableLevels(dataArray);

    // If no basemap specified, return detection info for user confirmation
    if (!basemap) {
      return {
        content: [
          {
            type: 'text',
            text: formatDetectionResponse(detection)
          }
        ]
      };
    }

    // Validate specified basemap
    const level = this.basemapMatcher.getLevelByBasemap(basemap);
    if (!level) {
      throw new Error(`Unknown basemap: ${basemap}. Valid options: berlin-boroughs, berlin-prognoseraume-2021, berlin-bezreg-2021, berlin-planungsraeume-2021`);
    }

    // Determine region column
    const regionCol = region_column || detection.regionColumn;
    if (!regionCol) {
      throw new Error(`Could not detect region column for ${level.label}. Please specify region_column parameter.`);
    }

    // Determine value column
    const valueCol = value_column || detection.valueColumn;
    if (!valueCol) {
      throw new Error('Choropleth maps require at least one numeric column for visualization. Please specify value_column parameter.');
    }

    // Check if using IDs or names
    const usingIds = this.basemapMatcher.isUsingIds(dataArray, regionCol, level);
    const keyAttr = usingIds ? level.idKey : level.nameKey;

    // Prepare data - transform region column if needed (BEZ_ID padding)
    let processedData = dataArray;
    if (usingIds && basemap === 'berlin-boroughs') {
      processedData = dataArray.map(row => ({
        ...row,
        [regionCol]: this.basemapMatcher.padBezirkId(String(row[regionCol]))
      }));
    }

    // Colors (gradient from base_color or color_scale), notes and number formats for the value column
    const style = buildStyleMetadata('d3-maps-choropleth', params, [valueCol]);

    // Build metadata for choropleth map
    const chartTitle = title || `${level.label} Map`;
    const metadata: any = {
      describe: {
        headline: chartTitle,
      },
      visualize: {
        'base-color': base_color || '#2A7FFF',
        'thick': thick ?? false,
        'value-label-format': value_label_format || '0,0.[00]',
        ...style.visualize,
        ...(visualize_overrides || {}),
        basemap: basemap,
        'map-key-attr': keyAttr,
        tooltip: {
          body: `<b>{{ ${valueCol} }}</b>`,
          title: `{{ ${regionCol} }}`,
          fields: {
            [regionCol]: regionCol,
            [valueCol]: valueCol
          }
        }
      },
      axes: {
        keys: regionCol,
        values: valueCol
      },
      publish: {
        'embed-width': 600,
        'embed-height': 600
      }
    };

    // Add description and source
    if (description) {
      metadata.describe.intro = description;
    }
    if (source_dataset_id) {
      metadata.describe['source-name'] = 'Berlin Open Data';
      metadata.describe['source-url'] = `https://daten.berlin.de/datensaetze/${source_dataset_id}`;
    }
    if (Object.keys(style.data).length > 0) {
      metadata.data = style.data;
    }
    if (Object.keys(style.annotate).length > 0) {
      metadata.annotate = style.annotate;
    }

    // Create chart
    console.error(`Creating choropleth map with ${basemap}...`);
    const chart = await datawrapperClient.createChart('d3-maps-choropleth', metadata, chartTitle, { language, folderId: folder_id })
      .catch(error => { throw withFolderOrTeamContext(error, { folderId: folder_id, action: 'created' }); });

    // Convert data to CSV and upload
    const csvData = this.chartBuilder.formatForDatawrapper(processedData);
    console.error(`Uploading data (${processedData.length} rows)...`);
    await datawrapperClient.uploadData(chart.id, csvData);

    // Get edit URL (chart is not published yet)
    const editUrl = datawrapperClient.getEditUrl(chart.id);

    // Log chart creation
    this.chartLogger.logChart({
      chartId: chart.id,
      editUrl,
      chartType: 'map',
      title: chartTitle,
      createdAt: new Date().toISOString(),
      sourceDatasetId: source_dataset_id,
      sourceDatasetUrl: source_dataset_id ? `https://daten.berlin.de/datensaetze/${source_dataset_id}` : undefined,
      dataRowCount: processedData.length,
      published: false
    }).catch((err: Error) => console.error('Background logging failed:', err));

    // Format response - chart is ready for review but not published
    let responseText = `✅ Choropleth map created (not yet published)

✏️ **Edit & Preview**: ${editUrl}
🆔 **Chart ID**: ${chart.id}

🗺️ **Basemap**: ${basemap} (${level.label})
📍 **Region column**: ${regionCol} (using ${usingIds ? 'IDs' : 'names'})
📈 **Value column**: ${valueCol}
📦 **Regions**: ${processedData.length}

**IMPORTANT: Do NOT publish automatically.** Present this edit link to the user and ask: "Would you like me to publish this map, or do you want to make changes first?"`;

    if (style.warnings.length > 0) {
      responseText += `\n\n⚠️ **Warnings:**\n${style.warnings.map(w => `- ${w}`).join('\n')}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: responseText
        }
      ]
    };
  }

  private async handlePublishVisualization(params: PublishVisualizationParams): Promise<CallToolResult> {
    try {
      const { api_key, chart_id } = params;
      const datawrapperClient = this.getAuthenticatedClient(api_key);

      if (!chart_id) {
        throw new Error('chart_id is required');
      }

      console.error(`Publishing chart ${chart_id}...`);
      const { chart: publishedChart, version, url } = await datawrapperClient.publishChart(chart_id);

      const publicId = publishedChart?.publicId || chart_id;
      const publicUrl = url || publishedChart?.publicUrl || datawrapperClient.getPublicUrl(publicId);
      const editUrl = datawrapperClient.getEditUrl(chart_id);
      const embedCode = datawrapperClient.getEmbedCode(publicId);

      // Update log entry with published info
      this.chartLogger.logChart({
        chartId: chart_id,
        url: publicUrl,
        embedCode,
        editUrl,
        publishedAt: new Date().toISOString(),
        published: true
      }).catch((err: Error) => console.error('Background logging failed:', err));

      const versionInfo = version !== undefined ? ` (version ${version})` : '';
      const responseText = `✅ Chart published${versionInfo}!

👁️ **View**: ${publicUrl}
✏️ **Edit**: ${editUrl}

[CHART:${publicId}]
${embedCode}
[/CHART]`;

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error: any) {
      console.error('Error publishing visualization:', error);

      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to publish: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  private async handleListVisualizations(params: ListVisualizationsParams): Promise<CallToolResult> {
    try {
      const { api_key, search, folder_id, team_id, published, order_by, order } = params;
      const datawrapperClient = this.getAuthenticatedClient(api_key);

      const requestedLimit = params.limit ?? DEFAULT_LIST_LIMIT;
      const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIST_LIMIT);
      const offset = Math.max(params.offset ?? 0, 0);

      console.error(`Listing charts (limit ${limit}, offset ${offset})...`);
      // The API only supports published=true; "unpublished only" is filtered locally below
      const result = await datawrapperClient.listCharts({
        search,
        folderId: folder_id,
        teamId: team_id,
        published: published === true ? true : undefined,
        orderBy: order_by,
        order,
        limit,
        offset,
      }).catch(error => { throw withFolderOrTeamContext(error, { folderId: folder_id, teamId: team_id }); });

      const pageCharts = Array.isArray(result?.list) ? result.list : [];
      const total = typeof result?.total === 'number' ? result.total : offset + pageCharts.length;
      const filterLocally = published === false;
      const charts = filterLocally ? pageCharts.filter(chart => !isPublished(chart)) : pageCharts;
      const localFilterNote = filterLocally
        ? `\n\nℹ️ The Datawrapper API cannot filter for unpublished charts, so \`published: false\` was applied locally to this page only: ${charts.length} of the ${pageCharts.length} charts on this page (positions ${offset + 1}-${offset + pageCharts.length} of ${total} in total) are unpublished.`
        : '';

      if (charts.length === 0) {
        const hint = offset > 0 && total > 0
          ? `\n\nThe offset (${offset}) is past the end of the list. Try a smaller offset.`
          : (search || folder_id !== undefined || team_id || published !== undefined)
            ? '\n\nNo charts match the given filters. Try removing some filters.'
            : '\n\nIf you expected team charts, pass `team_id`.';
        return {
          content: [
            {
              type: 'text',
              text: `📊 No charts found (total: ${total}).${hint}${localFilterNote}`
            }
          ]
        };
      }

      const first = offset + 1;
      const last = offset + pageCharts.length;
      const lines = charts.map((chart, index) => {
        const title = chart.title?.trim() || '(untitled)';
        const editUrl = datawrapperClient.getEditUrl(chart.id);
        let status: string;
        if (isPublished(chart)) {
          const publicUrl = chart.publicUrl || datawrapperClient.getPublicUrl(chart.publicId || chart.id);
          status = `🌍 Published: ${publicUrl}`;
        } else {
          status = '📝 Not published';
        }
        let details = `🕒 Last modified: ${formatTimestamp(chart.lastModifiedAt)}`;
        if (chart.folderId !== undefined && chart.folderId !== null) {
          details += ` · 📁 Folder: ${chart.folderId}`;
        }
        if (chart.organizationId) {
          details += ` · 👥 Team: ${chart.organizationId}`;
        }
        const position = filterLocally ? `-` : `${offset + index + 1}.`;
        return `${position} **${title}** - \`${chart.id}\` · ${chart.type}
   ${status}
   ✏️ Edit: ${editUrl}
   ${details}`;
      });

      let responseText = filterLocally
        ? `📊 Unpublished Datawrapper charts among charts ${first}-${last} of ${total}`
        : `📊 Datawrapper charts ${first}-${last} of ${total}`;
      if (requestedLimit > MAX_LIST_LIMIT) {
        responseText += ` (limit capped at ${MAX_LIST_LIMIT})`;
      }
      responseText += `\n\n${lines.join('\n\n')}${localFilterNote}`;

      if (last < total) {
        responseText += `\n\n➡️ **More charts available.** Call \`list_visualizations\` again with \`offset: ${last}\` to see the next page.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error: any) {
      console.error('Error listing visualizations:', error);
      // DatawrapperApiError messages are already complete ("Failed to list charts: ..." or a specific hint)
      return errorResult(error instanceof DatawrapperApiError ? error.message : `Failed to list charts: ${error.message}`);
    }
  }

  private async handleGetVisualization(params: GetVisualizationParams): Promise<CallToolResult> {
    try {
      const { api_key, chart_id, include_data, include_metadata } = params;
      const datawrapperClient = this.getAuthenticatedClient(api_key);

      if (!chart_id) {
        throw new Error('chart_id is required');
      }

      console.error(`Fetching chart ${chart_id}...`);
      const chart = await datawrapperClient.getChartInfo(chart_id);
      const metadata: DatawrapperChartMetadata = chart.metadata || {};
      const editUrl = datawrapperClient.getEditUrl(chart.id || chart_id);
      const published = isPublished(chart);

      let responseText = `📊 **${chart.title?.trim() || '(untitled)'}**

🆔 **Chart ID**: ${chart.id || chart_id}
📈 **Type**: ${chart.type}
✏️ **Edit**: ${editUrl}
🕒 **Created**: ${formatTimestamp(chart.createdAt)} · **Last modified**: ${formatTimestamp(chart.lastModifiedAt)}`;

      if (chart.folderId !== undefined && chart.folderId !== null) {
        const folderName = chart.folder?.name ? ` (${chart.folder.name})` : '';
        responseText += `\n📁 **Folder**: ${chart.folderId}${folderName}`;
      }
      if (chart.organizationId) {
        responseText += `\n👥 **Team**: ${chart.organizationId}`;
      }
      if (chart.language) {
        responseText += `\n🌐 **Language**: ${chart.language}`;
      }

      if (published) {
        const publicId = chart.publicId || chart.id || chart_id;
        const publicUrl = chart.publicUrl || datawrapperClient.getPublicUrl(publicId);
        // Prefer the official embed code Datawrapper stores for published charts
        const embedCodes = metadata.publish?.['embed-codes'] || {};
        const officialEmbed = embedCodes['embed-method-responsive'] || embedCodes['embed-method-iframe'];
        const embedHeight = Number(metadata.publish?.['embed-height']) || undefined;
        const embedCode = typeof officialEmbed === 'string' && officialEmbed.trim()
          ? officialEmbed
          : datawrapperClient.getEmbedCode(publicId, undefined, embedHeight);
        responseText += `

🌍 **Status**: Published (version ${chart.publicVersion ?? '?'}, ${formatTimestamp(chart.publishedAt)})
👁️ **View**: ${publicUrl}
🆔 **Public ID**: ${publicId}

**Embed code:**
\`\`\`html
${embedCode}
\`\`\`

Note: changes made since the last publish only become public after calling \`publish_visualization\` again.`;
      } else {
        responseText += `\n\n📝 **Status**: Not published`;
      }

      const describe = metadata.describe || {};
      const describeLines: string[] = [];
      if (describe.intro) describeLines.push(`- **Description**: ${describe.intro}`);
      if (describe.byline) describeLines.push(`- **Byline**: ${describe.byline}`);
      if (describe['source-name'] || describe['source-url']) {
        const sourceUrl = describe['source-url'] ? ` (${describe['source-url']})` : '';
        describeLines.push(`- **Source**: ${describe['source-name'] || ''}${sourceUrl}`.trim());
      }
      if (metadata.annotate?.notes) describeLines.push(`- **Notes**: ${metadata.annotate.notes}`);
      if (describeLines.length > 0) {
        responseText += `\n\n**Description & source:**\n${describeLines.join('\n')}`;
      }

      const visualize = metadata.visualize || {};
      const visualizeLines = KEY_VISUALIZE_SETTINGS
        .filter(key => visualize[key] !== undefined)
        .map(key => `- \`${key}\`: ${truncate(JSON.stringify(visualize[key]), 300)}`);
      if (visualizeLines.length > 0) {
        responseText += `\n\n**Key visualize settings:**\n${visualizeLines.join('\n')}`;
      }

      if (metadata.axes && Object.keys(metadata.axes).length > 0) {
        responseText += `\n\n**Axes:** ${truncate(JSON.stringify(metadata.axes), 500)}`;
      }
      if (metadata.data?.transpose) {
        responseText += `\n**Data transposed:** yes (rows and columns swapped)`;
      }
      const columnFormat = metadata.data?.['column-format'];
      if (columnFormat && typeof columnFormat === 'object' && !Array.isArray(columnFormat) && Object.keys(columnFormat).length > 0) {
        responseText += `\n**Column formats:** ${truncate(JSON.stringify(columnFormat), 500)}`;
      }

      if (include_data) {
        console.error(`Fetching data for chart ${chart_id}...`);
        const rawData = await datawrapperClient.getChartData(chart_id);
        const dataLines = rawData.split(/\r?\n/);
        let shownData = dataLines.slice(0, MAX_DATA_LINES).join('\n');
        let truncated = dataLines.length > MAX_DATA_LINES;
        if (shownData.length > MAX_DATA_CHARS) {
          shownData = shownData.slice(0, MAX_DATA_CHARS);
          truncated = true;
        }
        responseText += `\n\n**Data:**\n\`\`\`\n${shownData}\n\`\`\``;
        if (truncated) {
          responseText += `\n_(Truncated: showing at most ${MAX_DATA_LINES} lines / ${MAX_DATA_CHARS} characters of ${dataLines.length} lines / ${rawData.length} characters.)_`;
        }
      }

      if (include_metadata) {
        const metadataJson = JSON.stringify(metadata, null, 2);
        responseText += `\n\n**Raw metadata:**\n\`\`\`json\n${truncate(metadataJson, MAX_METADATA_CHARS)}\n\`\`\``;
        if (metadataJson.length > MAX_METADATA_CHARS) {
          responseText += `\n_(Truncated: showing ${MAX_METADATA_CHARS} of ${metadataJson.length} characters.)_`;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error: any) {
      console.error('Error getting visualization:', error);
      return errorResult(error.message);
    }
  }

  private async handleUpdateVisualization(params: UpdateVisualizationParams): Promise<CallToolResult> {
    try {
      const {
        api_key, chart_id, title, description, byline, source_name, source_url,
        base_color, thick, value_label_format, visualize_overrides, chart_type, variant, map_type, data,
        secondary_color, color_scale, language, notes, number_prepend, number_append, number_divisor, number_columns,
        folder_id, transpose,
      } = params;
      const datawrapperClient = this.getAuthenticatedClient(api_key);

      if (!chart_id) {
        throw new Error('chart_id is required');
      }

      const hasOverrides = visualize_overrides !== undefined && Object.keys(visualize_overrides).length > 0;
      const hasChanges = [
        title, description, byline, source_name, source_url, base_color, thick, value_label_format, chart_type, variant, map_type, data,
        secondary_color, color_scale, language, notes, number_prepend, number_append, number_divisor, folder_id, transpose,
      ].some(value => value !== undefined) || hasOverrides;
      if (!hasChanges) {
        throw new Error('No changes specified. Provide at least one of: title, description, byline, source_name, source_url, notes, language, folder_id, base_color, secondary_color, color_scale, thick, value_label_format, number_prepend, number_append, number_divisor, visualize_overrides, chart_type (+ variant / map_type), transpose, data.');
      }
      if (number_columns !== undefined && !hasNumberFormat(params)) {
        throw new Error('number_columns needs at least one of number_prepend, number_append or number_divisor.');
      }

      if (variant && !chart_type) {
        throw new Error('variant requires chart_type (e.g. chart_type: "bar", variant: "stacked").');
      }
      if (chart_type === 'map' && !map_type) {
        throw new Error('map_type is required when chart_type is "map" ("d3-maps-symbols" or "d3-maps-choropleth").');
      }
      if (map_type && chart_type && chart_type !== 'map') {
        throw new Error('map_type can only be used with chart_type "map".');
      }

      // Fetch the current chart: needed for type checks, data validation and the publish status
      console.error(`Fetching chart ${chart_id}...`);
      const current = await datawrapperClient.getChartInfo(chart_id);
      const currentMetadata: DatawrapperChartMetadata = current.metadata || {};

      // Resolve a new Datawrapper type, if requested
      let newType: string | undefined;
      if (map_type) {
        newType = map_type;
      } else if (chart_type) {
        // Keep the current variant (e.g. stacked) when the same chart family is passed without a variant
        const currentFamily = current.type ? this.chartBuilder.getChartTypeFromDatawrapperType(current.type) : null;
        const effectiveVariant = variant ?? (currentFamily?.chartType === chart_type ? currentFamily.variant : undefined);
        newType = this.chartBuilder.getDatawrapperType(chart_type, effectiveVariant);
      }
      if (newType && current.type && isMapType(newType) !== isMapType(current.type)) {
        throw new Error(`Cannot convert a ${isMapType(current.type) ? 'map' : 'chart'} (${current.type}) into ${newType}. Create a new visualization with create_visualization instead.`);
      }
      if (newType && current.type && isMapType(current.type) && newType !== current.type) {
        throw new Error(`Cannot change the map type from ${current.type} to ${newType}: symbol, choropleth and locator maps need different data and settings. Create a new map with create_visualization instead.`);
      }
      const targetType = newType || current.type;

      // Validate and prepare replacement data before writing anything
      let dataUpload: { dataString: string; rowCount: number; warnings: string[] } | undefined;
      if (data !== undefined) {
        dataUpload = this.prepareReplacementData(data, targetType, currentMetadata);
      }

      // Columns that number formats apply to by default: numeric columns of the new or the stored data
      let numericColumns: string[] = [];
      if (hasNumberFormat(params) && number_columns === undefined) {
        if (targetType === 'd3-maps-choropleth' && typeof currentMetadata.axes?.values === 'string') {
          numericColumns = [currentMetadata.axes.values];
        } else if (data !== undefined) {
          numericColumns = numericColumnsOf(this.chartBuilder, data);
        } else {
          numericColumns = detectNumericColumnsFromCsv(await datawrapperClient.getChartData(chart_id));
        }
      }
      const style = buildStyleMetadata(targetType, params, numericColumns);

      // Build the PATCH body. Datawrapper merges nested metadata objects server-side,
      // so only the changed keys are sent and all other settings stay untouched.
      const update: DatawrapperChartUpdate = {};
      const changes: string[] = [];

      if (title !== undefined) {
        update.title = title;
        changes.push(`Title → "${title}"`);
      }
      if (language !== undefined) {
        update.language = language;
        changes.push(`Language → ${language}`);
      }
      if (folder_id !== undefined) {
        update.folderId = folder_id;
        changes.push(`Folder → ${folder_id}`);
      }
      if (newType && newType !== current.type) {
        update.type = newType;
        changes.push(`Type → ${newType} (was ${current.type})`);
      } else if (newType) {
        changes.push(`Type unchanged (already ${newType})`);
      }

      const describe: Record<string, string> = {};
      if (description !== undefined) {
        describe.intro = description;
        changes.push('Description updated');
      }
      if (byline !== undefined) {
        describe.byline = byline;
        changes.push(`Byline → "${byline}"`);
      }
      if (source_name !== undefined) {
        describe['source-name'] = source_name;
        changes.push(`Source name → "${source_name}"`);
      }
      if (source_url !== undefined) {
        describe['source-url'] = source_url;
        changes.push(`Source URL → ${source_url}`);
      }

      // base-color and the type-specific color keys (map colors, range end color) come from style
      const visualize: Record<string, any> = { ...style.visualize };
      if (thick !== undefined) {
        visualize['thick'] = thick;
      }
      if (value_label_format !== undefined) {
        visualize['value-label-format'] = value_label_format;
      }
      // Overrides win over the shortcut fields, same as in create_visualization
      Object.assign(visualize, visualize_overrides || {});
      for (const [key, value] of Object.entries(visualize)) {
        changes.push(`\`${key}\` → ${truncate(JSON.stringify(value), 120)}`);
      }
      changes.push(...style.changes);

      // Grouped/stacked column charts need transposed data; switching into or out of them adjusts it
      const dataSettings: Record<string, any> = { ...style.data };
      if (transpose !== undefined) {
        dataSettings.transpose = transpose;
        changes.push(`Transpose → ${transpose}`);
      } else if (newType && newType !== current.type && usesTransposedLayout(newType) !== usesTransposedLayout(current.type)) {
        dataSettings.transpose = usesTransposedLayout(newType);
        changes.push(`Transpose → ${dataSettings.transpose} (to match ${newType})`);
      }

      const metadataPatch: DatawrapperChartMetadata = {};
      if (Object.keys(describe).length > 0) {
        metadataPatch.describe = describe;
      }
      if (Object.keys(visualize).length > 0) {
        metadataPatch.visualize = visualize;
      }
      if (Object.keys(dataSettings).length > 0) {
        metadataPatch.data = dataSettings;
      }
      if (Object.keys(style.annotate).length > 0) {
        metadataPatch.annotate = style.annotate;
      }
      if (Object.keys(metadataPatch).length > 0) {
        update.metadata = metadataPatch;
      }

      let updated: DatawrapperChart = current;
      const patched = Object.keys(update).length > 0;
      if (patched) {
        console.error(`Updating chart ${chart_id}...`);
        // The chart itself was just fetched, so a 403/404 here points at folder_id when it is set
        updated = await datawrapperClient.updateChart(chart_id, update)
          .catch(error => { throw withFolderOrTeamContext(error, { folderId: folder_id, action: 'updated' }); }) || current;
      }

      if (dataUpload) {
        console.error(`Uploading replacement data (${dataUpload.rowCount} rows)...`);
        try {
          await datawrapperClient.uploadData(chart_id, dataUpload.dataString);
        } catch (uploadError: any) {
          // The PATCH (if any) already went through: say exactly what was saved and what was not
          if (!patched) {
            throw uploadError;
          }
          return errorResult(`Chart ${chart_id} was only partly updated. These changes WERE saved:
${changes.map(change => `- ${change}`).join('\n')}

The data was NOT replaced: ${uploadError.message}
Retry \`update_visualization\` with only \`chart_id\` and \`data\` to upload the data again.`);
        }
        changes.push(`Data replaced (${dataUpload.rowCount} rows)`);
      }

      const editUrl = datawrapperClient.getEditUrl(chart_id);
      const chartTitle = (updated.title ?? current.title)?.trim() || '(untitled)';

      let responseText = `✅ Chart updated in place: **${chartTitle}**

✏️ **Edit & Preview**: ${editUrl}
🆔 **Chart ID**: ${chart_id} (unchanged)

**Changes:**
${changes.map(change => `- ${change}`).join('\n')}`;

      if (dataUpload && dataUpload.warnings.length > 0) {
        responseText += `\n\n⚠️ **Data warnings:**\n${dataUpload.warnings.map(w => `- ${w}`).join('\n')}`;
      }
      if (style.warnings.length > 0) {
        responseText += `\n\n⚠️ **Warnings:**\n${style.warnings.map(w => `- ${w}`).join('\n')}`;
      }

      if (isPublished(current)) {
        const publicUrl = current.publicUrl || datawrapperClient.getPublicUrl(current.publicId || chart_id);
        responseText += `

⚠️ **This chart is already published.** The public version (${publicUrl}) and all embeds still show the previous state until the chart is republished.

**IMPORTANT: Do NOT republish automatically.** Present the edit link to the user and ask: "Would you like me to republish this chart so the changes go live?" If yes, call \`publish_visualization\` with chart ID ${chart_id}.`;
      } else {
        responseText += `

**IMPORTANT: Do NOT publish automatically.** Present the edit link to the user and ask: "Would you like me to publish this chart, or do you want to make more changes first?"`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error: any) {
      console.error('Error updating visualization:', error);
      return errorResult(error.message);
    }
  }

  /**
   * Validate a replacement dataset against the chart's (target) type and convert it to the upload format
   */
  private prepareReplacementData(
    data: Array<Record<string, any>> | GeoJSON,
    targetType: string,
    currentMetadata: DatawrapperChartMetadata
  ): { dataString: string; rowCount: number; warnings: string[] } {
    const warnings: string[] = [];

    if (data === null || typeof data !== 'object') {
      throw new Error('data must be an array of data objects (or a GeoJSON FeatureCollection for symbol maps).');
    }

    // Symbol maps take GeoJSON points
    if (targetType === 'd3-maps-symbols') {
      const geojson = data as GeoJSON;
      this.chartBuilder.validateData(geojson, 'map');
      this.chartBuilder.inferChartConfig(geojson, 'map');
      return {
        dataString: this.chartBuilder.processGeoJSON(geojson, 'd3-maps-symbols'),
        rowCount: geojson.features.length,
        warnings,
      };
    }

    if (!Array.isArray(data)) {
      throw new Error(`Replacement data for ${targetType} must be an array of data objects.`);
    }
    const resolved = this.chartBuilder.getChartTypeFromDatawrapperType(targetType);
    if (!resolved) {
      // e.g. locator maps (marker JSON) or chart types this server does not create: uploading CSV could break them
      throw new Error(`Replacing data is not supported for ${targetType} charts. Edit the data in the Datawrapper editor instead.`);
    }
    this.chartBuilder.validateData(data, resolved.chartType !== 'map' ? resolved.chartType : 'table');
    let rows: Array<Record<string, any>> = data;
    const columns = Object.keys(rows[0] || {});

    if (targetType === 'd3-maps-choropleth') {
      // The existing map is bound to its region and value columns
      const regionCol = currentMetadata.axes?.keys;
      const valueCol = currentMetadata.axes?.values;
      const missing = [regionCol, valueCol].filter((col): col is string => typeof col === 'string' && !columns.includes(col));
      if (missing.length > 0) {
        throw new Error(`Replacement data for this choropleth map must contain the column(s): ${missing.join(', ')}. Found: ${columns.join(', ')}.`);
      }

      // Same BEZ_ID padding as in create_visualization when the map matches Bezirke by ID
      const visualize = currentMetadata.visualize || {};
      const level = visualize.basemap ? this.basemapMatcher.getLevelByBasemap(visualize.basemap) : undefined;
      if (level && visualize.basemap === 'berlin-boroughs' && visualize['map-key-attr'] === level.idKey && typeof regionCol === 'string') {
        rows = rows.map(row => ({
          ...row,
          [regionCol]: this.basemapMatcher.padBezirkId(String(row[regionCol]))
        }));
      }
    } else {
      const validation = this.chartBuilder.validateDataForChartType(rows, resolved.chartType, resolved.variant);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Warn when existing axis settings point to columns that no longer exist
      const axisColumns = Object.values(currentMetadata.axes || {}).filter((col): col is string => typeof col === 'string');
      const missingAxes = axisColumns.filter(col => !columns.includes(col));
      if (missingAxes.length > 0) {
        warnings.push(`The chart's axis settings reference column(s) not in the new data: ${missingAxes.join(', ')}. Check the axes in the Datawrapper editor.`);
      }
    }

    return {
      dataString: this.chartBuilder.formatForDatawrapper(rows),
      rowCount: rows.length,
      warnings,
    };
  }

  private async handleDeleteVisualization(params: DeleteVisualizationParams): Promise<CallToolResult> {
    try {
      const { api_key, chart_id } = params;
      const datawrapperClient = this.getAuthenticatedClient(api_key);

      if (!chart_id) {
        throw new Error('chart_id is required');
      }

      // Look the chart up first so the response can name what was deleted (and 404s surface clearly)
      console.error(`Fetching chart ${chart_id} before deletion...`);
      const chart = await datawrapperClient.getChartInfo(chart_id);
      const chartTitle = chart.title?.trim() || '(untitled)';

      console.error(`Deleting chart ${chart_id}...`);
      await datawrapperClient.deleteChart(chart_id);

      let responseText = `🗑️ Chart deleted: **${chartTitle}** (ID: ${chart_id})

Datawrapper moves deleted charts to the trash and deletes them permanently after 30 days. Until then, the chart can be restored from the trash in Datawrapper.`;

      if (isPublished(chart)) {
        responseText += `\n\n⚠️ This chart was published. Deleting it also takes down its public version: existing links and embeds stop working (they may still be served from caches for a short time).`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error: any) {
      console.error('Error deleting visualization:', error);
      // DatawrapperApiError messages are already complete ("Failed to delete chart: ..." or a specific hint)
      let message: string;
      if (error instanceof DatawrapperApiError) {
        message = error.status === 404 ? `${error.message} Nothing was deleted.` : error.message;
      } else {
        message = `Failed to delete: ${error.message}`;
      }
      return errorResult(message);
    }
  }

  async connect(transport: any) {
    await this.server.connect(transport);
  }
}
