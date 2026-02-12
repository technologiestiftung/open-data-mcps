#!/usr/bin/env node
// ABOUTME: MCP server for Datawrapper visualization integration
// ABOUTME: Exposes create_visualization tool for creating charts via Datawrapper API

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { DatawrapperClient } from './datawrapper-client.js';
import { ChartBuilder } from './chart-builder.js';
import { ChartLogger } from './chart-logger.js';
import { CreateVisualizationParams, ChartType, ChartVariant, GeoJSON, BerlinBasemap, DetectionResult } from './types.js';
import { BasemapMatcher } from './basemap-matcher.js';

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

// Tool definitions
const CREATE_VISUALIZATION_TOOL: Tool = {
  name: 'create_visualization',
  description: 'Create a data visualization using the Datawrapper API. The chart is NOT published automatically - use `publish_visualization` after the user approves it. Supports bar, column, line, area, scatter, dot, range, arrow, pie, donut, election-donut, table, and map charts. Use "variant" for bar (basic/stacked/split) and column (basic/grouped/stacked) charts. **For maps, map_type is REQUIRED**: "d3-maps-symbols" (points with GeoJSON) or "d3-maps-choropleth" (regions with tabular data). **For choropleth maps**: provide tabular data with Berlin region identifiers (Bezirke, Prognoseräume, Bezirksregionen, or Planungsräume). If basemap is not specified, the tool will auto-detect and return available options. Returns an edit URL where the user can preview and adjust the chart before publishing.',
  inputSchema: {
    type: 'object',
    properties: {
      data: {
        description: 'Array of data objects. For choropleth maps: tabular data with region IDs/names. For symbol maps: GeoJSON FeatureCollection.',
        oneOf: [
          {
            type: 'array',
            items: {
              type: 'object'
            }
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['FeatureCollection'] },
              features: { type: 'array' }
            }
          }
        ]
      },
      chart_type: {
        type: 'string',
        enum: ['bar', 'column', 'line', 'area', 'scatter', 'dot', 'range', 'arrow', 'pie', 'donut', 'election-donut', 'table', 'map'],
        description: 'Type of visualization to create'
      },
      variant: {
        type: 'string',
        enum: ['basic', 'stacked', 'grouped', 'split'],
        description: 'Chart variant. For bar: basic (default), stacked, split. For column: basic (default), grouped, stacked.'
      },
      map_type: {
        type: 'string',
        enum: ['d3-maps-symbols', 'd3-maps-choropleth'],
        description: 'REQUIRED when chart_type is "map". "d3-maps-symbols" for point locations (requires GeoJSON), "d3-maps-choropleth" for region comparison (requires tabular data with Berlin region identifiers).'
      },
      basemap: {
        type: 'string',
        enum: ['berlin-boroughs', 'berlin-prognoseraume-2021', 'berlin-bezreg-2021', 'berlin-planungsraeume-2021'],
        description: 'For choropleth maps: explicitly select basemap. If omitted, auto-detects from data and returns options for confirmation.'
      },
      region_column: {
        type: 'string',
        description: 'For choropleth maps: column name containing region IDs or names. Auto-detected if omitted.'
      },
      value_column: {
        type: 'string',
        description: 'For choropleth maps: column name containing values to visualize. Auto-detected if omitted.'
      },
      title: {
        type: 'string',
        description: 'Optional chart title (auto-generated if omitted)'
      },
      description: {
        type: 'string',
        description: 'Optional chart description/byline'
      },
      source_dataset_id: {
        type: 'string',
        description: 'Optional Berlin dataset ID for tracking'
      }
    },
    required: ['data', 'chart_type']
  }
};

const PUBLISH_VISUALIZATION_TOOL: Tool = {
  name: 'publish_visualization',
  description: 'Publish a previously created visualization to make it publicly viewable. Use this after the user has reviewed and approved the chart in the Datawrapper editor.',
  inputSchema: {
    type: 'object',
    properties: {
      chart_id: {
        type: 'string',
        description: 'The chart ID returned from create_visualization'
      }
    },
    required: ['chart_id']
  }
};

export class DatawrapperMCPServer {
  private server: Server;
  private datawrapperClient: DatawrapperClient;
  private chartBuilder: ChartBuilder;
  private chartLogger: ChartLogger;
  private basemapMatcher: BasemapMatcher;

  constructor(apiToken?: string) {
    // Load environment variables if not provided
    dotenv.config();

    const token = apiToken || process.env.DATAWRAPPER_API_TOKEN;
    const chartLogPath = process.env.CHART_LOG_PATH || './charts-log.json';

    if (!token) {
      throw new Error('DATAWRAPPER_API_TOKEN environment variable or apiToken parameter is required');
    }

    this.server = new Server(
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

    this.datawrapperClient = new DatawrapperClient(token);
    this.chartBuilder = new ChartBuilder();
    this.chartLogger = new ChartLogger(chartLogPath);
    this.basemapMatcher = new BasemapMatcher();

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [CREATE_VISUALIZATION_TOOL, PUBLISH_VISUALIZATION_TOOL]
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'create_visualization') {
        return await this.handleCreateVisualization(args as unknown as CreateVisualizationParams);
      }

      if (name === 'publish_visualization') {
        return await this.handlePublishVisualization(args as { chart_id: string });
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  private async handleCreateVisualization(params: CreateVisualizationParams) {
    try {
      const { data, chart_type, variant, map_type, basemap, region_column, value_column, title, description, source_dataset_id } = params;

      // Validate map_type is provided for maps
      if (chart_type === 'map' && !map_type) {
        throw new Error('map_type is required when chart_type is "map". Choose: (1) "d3-maps-symbols" for point locations (requires GeoJSON), or (2) "d3-maps-choropleth" for region comparison (requires tabular data with Berlin region identifiers).');
      }

      // Handle choropleth maps separately
      if (chart_type === 'map' && map_type === 'd3-maps-choropleth') {
        return await this.handleChoroplethMap(params);
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

      // Create initial chart metadata with clean, modern styling
      const metadata: any = {
        visualize: {
          'base-color': '#2A7FFF',
          'thick': false,
          'value-label-format': '0,0.[00]',
          ...typeSpecificSettings,
        },
        publish: chart_type === 'map' ? {
          'embed-width': 600,
          'embed-height': 600
        } : undefined
      };

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
      const chart = await this.datawrapperClient.createChart(dwChartType, metadata);

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
      await this.datawrapperClient.uploadData(chart.id, dataString);

      // Get edit URL (chart is not published yet)
      const editUrl = this.datawrapperClient.getEditUrl(chart.id);

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

  private async handleChoroplethMap(params: CreateVisualizationParams) {
    const { data, basemap, region_column, value_column, title, description, source_dataset_id } = params;

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

    // Build metadata for choropleth map
    const chartTitle = title || `${level.label} Map`;
    const metadata: any = {
      describe: {
        headline: chartTitle,
      },
      visualize: {
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

    // Create chart
    console.error(`Creating choropleth map with ${basemap}...`);
    const chart = await this.datawrapperClient.createChart('d3-maps-choropleth', metadata);

    // Convert data to CSV and upload
    const csvData = this.chartBuilder.formatForDatawrapper(processedData);
    console.error(`Uploading data (${processedData.length} rows)...`);
    await this.datawrapperClient.uploadData(chart.id, csvData);

    // Get edit URL (chart is not published yet)
    const editUrl = this.datawrapperClient.getEditUrl(chart.id);

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
    const responseText = `✅ Choropleth map created (not yet published)

✏️ **Edit & Preview**: ${editUrl}
🆔 **Chart ID**: ${chart.id}

🗺️ **Basemap**: ${basemap} (${level.label})
📍 **Region column**: ${regionCol} (using ${usingIds ? 'IDs' : 'names'})
📈 **Value column**: ${valueCol}
📦 **Regions**: ${processedData.length}

**IMPORTANT: Do NOT publish automatically.** Present this edit link to the user and ask: "Would you like me to publish this map, or do you want to make changes first?"`;

    return {
      content: [
        {
          type: 'text',
          text: responseText
        }
      ]
    };
  }

  private async handlePublishVisualization(params: { chart_id: string }) {
    try {
      const { chart_id } = params;

      if (!chart_id) {
        throw new Error('chart_id is required');
      }

      console.error(`Publishing chart ${chart_id}...`);
      const publishedChart = await this.datawrapperClient.publishChart(chart_id);

      const publicId = publishedChart.publicId || chart_id;
      const publicUrl = this.datawrapperClient.getPublicUrl(publicId);
      const editUrl = this.datawrapperClient.getEditUrl(chart_id);
      const embedCode = this.datawrapperClient.getEmbedCode(publicId);

      // Update log entry with published info
      this.chartLogger.logChart({
        chartId: chart_id,
        url: publicUrl,
        embedCode,
        editUrl,
        publishedAt: new Date().toISOString(),
        published: true
      }).catch((err: Error) => console.error('Background logging failed:', err));

      const responseText = `✅ Chart published!

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

  async connect(transport: any) {
    await this.server.connect(transport);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Datawrapper MCP server running on stdio');
  }
}

// CLI entry point - only runs when executed directly, not when imported
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const server = new DatawrapperMCPServer();
  server.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
