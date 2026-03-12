#!/usr/bin/env node
// ABOUTME: MCP server implementation for Berlin Open Data Portal
// ABOUTME: Handles tool registration and request routing for dataset discovery and data fetching

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BerlinOpenDataAPI } from './berlin-api.js';
import { QueryProcessor } from './query-processor.js';
import { DataFetcher } from './data-fetcher.js';
import { DataSampler } from './data-sampler.js';
import { GeoJSONTransformer } from './geojson-transformer.js';
import { LORLookupService } from './lor-lookup.js';
import { WFSClient } from './wfs-client.js';
import {
  SearchDatasetsSchema,
  SearchFilteredSchema,
  GetFacetsSchema,
  ListTagsSchema,
  GetDatasetDetailsSchema,
  ListAllDatasetsSchema,
  FetchDatasetDataSchema,
  AggregateDatasetSchema,
  DownloadDatasetSchema,
  GetPortalStatsSchema,
  ListGeoLayersSchema,
  FetchGeoFeaturesSchema,
} from './schemas.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export interface BerlinOpenDataMCPServerOptions {}

export class BerlinOpenDataMCPServer {
  private server: McpServer;
  private api: BerlinOpenDataAPI;
  private queryProcessor: QueryProcessor;
  private dataFetcher: DataFetcher;
  private dataSampler: DataSampler;
  private geoJSONTransformer: GeoJSONTransformer;
  private lorLookup: LORLookupService;
  private wfsClient: WFSClient;
  constructor(options: BerlinOpenDataMCPServerOptions = {}) {
    this.server = new McpServer(
      {
        name: 'berlin-opendata-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    this.api = new BerlinOpenDataAPI();
    this.queryProcessor = new QueryProcessor();
    this.wfsClient = new WFSClient();
    this.dataFetcher = new DataFetcher({ useBrowserAutomation: true, wfsClient: this.wfsClient });
    this.dataSampler = new DataSampler();
    this.geoJSONTransformer = new GeoJSONTransformer();
    this.lorLookup = new LORLookupService();

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_berlin_datasets',
          description: 'Search Berlin open datasets using natural language queries in German or English. Automatically expands synonyms (e.g. "bicycle" → fahrrad, radverkehr) and sends a single OR-joined edismax query with field weighting (title^5 tags^3 notes^2). Results are sorted by relevance then recency.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language search query in German or English (e.g. "bicycle infrastructure", "Luftqualität Berlin", "Einwohner 2024")',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 20)',
                default: 20,
              },
              sort: {
                type: 'string',
                description: 'Sort order. Default: "score desc, metadata_modified desc" (relevance first, then recency). WARNING: "metadata_modified desc" alone is dominated by frequently-harvested WMS/WFS layers. To find the most recent statistical data, use search_datasets_filtered with an organization filter AND sort="metadata_modified desc".',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'search_datasets_filtered',
          description: 'Structured search with explicit filters for organization, tag, file format, and date. Filters map to Solr fq (cached, zero-cost for scoring). Always returns facet counts so you can refine further. Use after get_facets to do a two-step discovery → filter workflow.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Free-text search query (German or English). Use "*" to match everything when only filtering.',
                default: '*',
              },
              organization: {
                type: 'string',
                description: 'Filter to a specific publishing organization slug (e.g. "senuvk", "statistik-berlin-brandenburg"). Use list_organizations to discover slugs.',
              },
              tag: {
                type: 'string',
                description: 'Filter to a specific tag (e.g. "luftqualitaet", "radverkehr"). Use list_tags or get_facets to discover available tags.',
              },
              format: {
                type: 'string',
                description: 'Filter to datasets that have at least one resource in this format (e.g. "CSV", "JSON", "WFS", "XLSX").',
              },
              modified_since: {
                type: 'string',
                description: 'Only return datasets modified after this date (ISO 8601, e.g. "2023-01-01").',
              },
              sort: {
                type: 'string',
                description: 'Sort order. Default: "score desc, metadata_modified desc". Use "metadata_modified desc" for newest-first.',
                default: 'score desc, metadata_modified desc',
              },
              rows: {
                type: 'number',
                description: 'Number of results to return (default: 20).',
                default: 20,
              },
            },
          },
        },
        {
          name: 'get_facets',
          description: 'Returns top tags, organizations, and file formats associated with a query without fetching any actual datasets (rows=0). Use this as a fast first step to discover the taxonomy of a topic, then call search_datasets_filtered with the relevant fq values.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Topic query to get facets for (e.g. "Radverkehr", "Luftqualität Berlin"). Use "*" to get overall portal facets.',
                default: '*',
              },
              limit: {
                type: 'number',
                description: 'Maximum facet items to return per field (default: 10).',
                default: 10,
              },
            },
          },
        },
        {
          name: 'list_tags',
          description: 'List available tags from the Berlin Open Data Portal, optionally filtered by a prefix query. Use for tag autocomplete when building fq filters for search_datasets_filtered.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Optional prefix to filter tags (e.g. "luft" returns "luftqualitaet", "luftverkehr", …).',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of tags to return (default: 50).',
                default: 50,
              },
            },
          },
        },
        {
          name: 'get_dataset_details',
          description: 'Get detailed information about a specific Berlin dataset',
          inputSchema: {
            type: 'object',
            properties: {
              dataset_id: {
                type: 'string',
                description: 'The ID or name of the dataset',
              },
            },
            required: ['dataset_id'],
          },
        },
        {
          name: 'get_portal_stats',
          description: 'Get overview statistics about the Berlin Open Data Portal (total datasets, organizations, categories)',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_all_datasets',
          description: 'List all datasets in the portal with pagination support. Use this to browse the entire catalog.',
          inputSchema: {
            type: 'object',
            properties: {
              offset: {
                type: 'number',
                description: 'Starting position (default: 0)',
                default: 0,
              },
              limit: {
                type: 'number',
                description: 'Number of results to return (default: 100, max: 1000)',
                default: 100,
              },
            },
          },
        },
        {
          name: 'fetch_dataset_data',
          description: 'VIEW dataset content in the chat for surface-level analysis. Returns a potentially truncated preview plus value distributions for all columns. Supports CSV, JSON, Excel (XLS/XLSX), GeoJSON, KML, and WFS formats. WFS data is automatically converted to tabular format. Does NOT support ZIP archives (provides direct download URL instead). Use when user wants to SEE data shape, not run full aggregations. For robust counts/totals/breakdowns, use `aggregate_dataset`.',
          inputSchema: {
            type: 'object',
            properties: {
              dataset_id: {
                type: 'string',
                description: 'The dataset ID or name',
              },
              resource_id: {
                type: 'string',
                description: 'Optional: specific resource ID. If not provided, uses first available resource.',
              },
              full_data: {
                type: 'boolean',
                description: 'Set to true to fetch the complete dataset with value distributions for all columns. Required for any counting, filtering, or aggregation task. For WFS datasets with >500 features, this is the only way to get column distributions. Rejected only if dataset exceeds 1000 rows.',
                default: false,
              },
            },
            required: ['dataset_id'],
          },
        },
        {
          name: 'aggregate_dataset',
          description: 'Run server-side aggregations on a dataset without sending full rows to the model. Use this for totals, counts, grouped breakdowns, and filtered summaries (e.g. Einwohner sum by BEZIRK_NAME).',
          inputSchema: {
            type: 'object',
            properties: {
              dataset_id: {
                type: 'string',
                description: 'The dataset ID or name',
              },
              resource_id: {
                type: 'string',
                description: 'Optional: specific resource ID. If not provided, uses first available data resource.',
              },
              group_by: {
                type: 'array',
                items: { type: 'string' },
                description: 'Columns to group by (e.g. ["BEZIRK_NAME"]). Leave empty for overall totals.',
                default: [],
              },
              metrics: {
                type: 'array',
                description: 'Aggregation metrics. Example: [{ op: "sum", column: "E_E", as: "einwohner" }]',
                items: {
                  type: 'object',
                  properties: {
                    op: {
                      type: 'string',
                      enum: ['sum', 'avg', 'min', 'max', 'count', 'count_distinct'],
                    },
                    column: {
                      type: 'string',
                      description: 'Required for all metrics except count.',
                    },
                    as: {
                      type: 'string',
                      description: 'Optional output field name.',
                    },
                  },
                  required: ['op'],
                },
              },
              filters: {
                type: 'array',
                description: 'Optional row filters applied before aggregation.',
                items: {
                  type: 'object',
                  properties: {
                    column: { type: 'string' },
                    op: {
                      type: 'string',
                      enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'],
                    },
                    value: {
                      description: 'Filter value. For op="in", provide an array.',
                    },
                  },
                  required: ['column', 'op', 'value'],
                },
                default: [],
              },
              sort: {
                type: 'array',
                description: 'Optional sorting for aggregated result rows.',
                items: {
                  type: 'object',
                  properties: {
                    column: { type: 'string' },
                    direction: { type: 'string', enum: ['asc', 'desc'] },
                  },
                  required: ['column'],
                },
                default: [],
              },
              limit: {
                type: 'number',
                description: 'Maximum number of aggregated rows to return (default: 100, max: 1000).',
                default: 100,
              },
            },
            required: ['dataset_id', 'metrics'],
          },
        },
        {
          name: 'download_dataset',
          description: 'DOWNLOAD dataset as a file to the user\'s computer. Triggers browser download dialog. Use when user wants to SAVE/DOWNLOAD the file. Supports CSV, JSON, Excel (XLS/XLSX), GeoJSON, KML, and WFS formats. WFS data is automatically converted to GeoJSON. For ZIP archives, provides direct download URL (ZIP files cannot be processed by MCP). Keywords: "herunterladen", "download", "speichern", "save", "auf meinem Computer", "als Datei". Always use this tool when user says they need the data on their computer.',
          inputSchema: {
            type: 'object',
            properties: {
              dataset_id: {
                type: 'string',
                description: 'The dataset ID or name',
              },
              resource_id: {
                type: 'string',
                description: 'Optional: specific resource ID. If not provided, uses first available data resource (CSV/JSON/Excel).',
              },
              format: {
                type: 'string',
                description: 'Output format: "csv", "json", or "geojson". Use "geojson" for geodata (WFS/GeoJSON/KML). If not specified, geodata defaults to GeoJSON, other data defaults to original format.',
                enum: ['csv', 'json', 'geojson'],
              },
            },
            required: ['dataset_id'],
          },
        },
        {
          name: 'list_geo_layers',
          description: 'Discover available WFS layers for a dataset. Returns layer names, titles, feature counts, and bounding boxes. Use after search_datasets to explore geodata in detail.',
          inputSchema: {
            type: 'object',
            properties: {
              dataset_id: {
                type: 'string',
                description: 'Dataset ID from search results (must have a WFS resource)',
              },
            },
            required: ['dataset_id'],
          },
        },
        {
          name: 'fetch_geo_features',
          description: 'Fetch features from a WFS layer as GeoJSON. Returns properties, geometry types, and sample data. Supports CQL filters for property-based queries (e.g., "bezirk = \'Mitte\'").',
          inputSchema: {
            type: 'object',
            properties: {
              wfs_url: {
                type: 'string',
                description: 'WFS service URL from list_geo_layers or dataset details',
              },
              typename: {
                type: 'string',
                description: 'Layer/typename from list_geo_layers (e.g., "poi_schulen")',
              },
              limit: {
                type: 'number',
                description: 'Maximum features to return (default: 100, max: 5000)',
                default: 100,
              },
              property_filter: {
                type: 'string',
                description: 'CQL filter expression (e.g., "bezirk = \'Mitte\'", "name LIKE \'%Schule%\'")',
              },
            },
            required: ['wfs_url', 'typename'],
          },
        },
      ],
    }));

    this.server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_berlin_datasets': {
            const parsed = SearchDatasetsSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { query, limit, sort } = parsed.data;

            // Build a single OR-joined edismax query.
            // Synonyms from SEED_MAPPINGS are folded in client-side so Solr
            // scores all matching terms natively in one round trip.
            // "bicycle infrastructure" → "(bicycle OR fahrrad OR radverkehr OR infrastructure)"
            const builtQuery = this.queryProcessor.buildQuery(query);
            const result = await this.api.searchDatasets({ query: builtQuery, limit, sort });

            let responseText = `# Search Results for "${query}"\n\n`;

            if (result.results.length === 0) {
              responseText += "No datasets found. Try:\n";
              responseText += "- Using different keywords\n";
              responseText += "- Searching in German (e.g., 'Verkehr' instead of 'traffic')\n";
              responseText += "- Using `get_facets` to discover which tags/organizations are relevant\n";
            } else {
              responseText += `Found ${result.count} dataset(s)`;
              if (result.count > result.results.length) {
                responseText += ` (showing top ${result.results.length})`;
              }
              responseText += `:\n\n`;

              result.results.forEach((dataset, index) => {
                responseText += `## ${index + 1}. ${dataset.title}\n`;
                responseText += `**ID**: ${dataset.name}\n`;
                responseText += `**URL**: https://daten.berlin.de/datensaetze/${dataset.name}\n`;
                responseText += `**Organization**: ${dataset.organization?.title || 'Unknown'}\n`;

                // Extract data reference period from title (e.g. "am 31.12.2024", "2022", "2023/2024")
                const datePeriodMatch = dataset.title.match(
                  /(?:am\s+\d{1,2}\.\d{1,2}\.(\d{4})|(\d{4})\/(\d{4})|(?:^|\s)(\d{4})(?:\s|$))/
                );
                if (datePeriodMatch) {
                  const year = datePeriodMatch[1] || datePeriodMatch[3] || datePeriodMatch[4];
                  if (year) responseText += `**Data period**: ${year}\n`;
                }

                if (dataset.metadata_modified) {
                  responseText += `**Catalog entry updated**: ${new Date(dataset.metadata_modified).toLocaleDateString('de-DE')}\n`;
                }

                if (dataset.notes && dataset.notes.length > 0) {
                  const description = dataset.notes.length > 200
                    ? dataset.notes.substring(0, 200) + '…'
                    : dataset.notes;
                  responseText += `**Description**: ${description}\n`;
                }

                if (dataset.resources && dataset.resources.length > 0) {
                  const formats = [...new Set(dataset.resources.map((r: any) => r.format).filter(Boolean))];
                  responseText += `**Resources**: ${dataset.resources.length} file(s)${formats.length ? ` (${formats.join(', ')})` : ''}\n`;
                }

                if (dataset.tags && dataset.tags.length > 0) {
                  responseText += `**Tags**: ${dataset.tags.slice(0, 5).map((t: any) => t.name).join(', ')}`;
                  if (dataset.tags.length > 5) responseText += ` +${dataset.tags.length - 5} more`;
                  responseText += '\n';
                }

                responseText += '\n';
              });

              responseText += `\n> **Note**: "Catalog entry updated" is the date the portal record was last edited — it does NOT reflect data currency. The actual reference period is in the dataset title (e.g. "am 31.12.2024") or the "Data period" field above.\n`;

              // Render top organizations from facets — show slugs so the model can filter correctly.
              // IMPORTANT: the organization parameter requires the slug (e.g. "amt-fur-statistik-berlin-brandenburg"),
              // NOT the display name ("Amt für Statistik Berlin-Brandenburg"). Using the display name returns 0 results.
              if (result.facets?.organization?.length) {
                responseText += `\n**Organizations with matching datasets** (use the slug as \`organization\` value):\n`;
                result.facets.organization.slice(0, 6).forEach((f: any) => {
                  let note = '';
                  if (f.name.includes('harvester') || f.name.includes('simplesearch')) note = ' ⚠️ re-harvests geodata daily — dominates date-sorted results';
                  responseText += `- \`${f.name}\` — ${f.display_name} (${f.count} datasets)${note}\n`;
                });
                responseText += `\n**→ To get the most recent data**: call \`search_datasets_filtered\` with the chosen \`organization\` slug and \`sort="metadata_modified desc"\`\n`;
              }

              responseText += `\n**Next steps**:\n`;
              responseText += `- Use \`get_dataset_details\` with any dataset ID for full details and resource URLs\n`;
              responseText += `- Use \`search_datasets_filtered\` with \`organization\`, \`tag\`, \`format\`, or \`modified_since\` filters\n`;
              responseText += `- Use \`search_datasets_filtered\` with \`sort="metadata_modified desc"\` to surface the newest catalog entries first\n`;
            }

            return { content: [{ type: 'text', text: responseText }] };
          }

          case 'get_dataset_details': {
            const parsed = GetDatasetDetailsSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { dataset_id } = parsed.data;
            const dataset = await this.api.getDataset(dataset_id);

            let details = `# ${dataset.title}\n\n`;

            // Basic information
            details += `## Overview\n`;
            details += `**ID**: ${dataset.name}\n`;
            details += `**Portal URL**: https://daten.berlin.de/datensaetze/${dataset.name}\n`;
            details += `**Organization**: ${dataset.organization?.title || 'Unknown'}\n`;

            if (dataset.metadata_modified) {
              const lastUpdate = new Date(dataset.metadata_modified).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
              details += `**Last Updated**: ${lastUpdate}\n`;
            }

            details += `\n## Description\n`;
            details += dataset.notes ? dataset.notes : 'No description available.';

            // Tags
            if (dataset.tags && dataset.tags.length > 0) {
              details += `\n\n## Categories & Tags\n`;
              details += dataset.tags.map(t => `\`${t.name}\``).join(', ');
            }

            // Resources
            details += `\n\n## Available Resources\n`;
            if (dataset.resources && dataset.resources.length > 0) {
              details += `This dataset contains ${dataset.resources.length} resource(s):\n\n`;

              dataset.resources.forEach((resource, index) => {
                details += `### ${index + 1}. ${resource.name || 'Unnamed Resource'}\n`;
                if (resource.id) {
                  details += `**Resource ID**: ${resource.id}\n`;
                }
                if (resource.format) {
                  details += `**Format**: ${resource.format}\n`;
                }
                if (resource.description) {
                  details += `**Description**: ${resource.description}\n`;
                }
                if (resource.url) {
                  details += `**Download URL**: ${resource.url}\n`;
                }
                details += '\n';
              });

              details += `💡 **How to use**: You can download these resources directly from the URLs above, or use \`fetch_dataset_data\` with the Resource ID to download and analyze the data.\n`;
            } else {
              details += 'No downloadable resources are available for this dataset.\n';
            }

            // Additional metadata
            if (dataset.license_title || dataset.author || dataset.maintainer) {
              details += `\n## Additional Information\n`;
              if (dataset.license_title) {
                details += `**License**: ${dataset.license_title}\n`;
              }
              if (dataset.author) {
                details += `**Author**: ${dataset.author}\n`;
              }
              if (dataset.maintainer) {
                details += `**Maintainer**: ${dataset.maintainer}\n`;
              }
            }

            return {
              content: [
                {
                  type: 'text',
                  text: details,
                },
              ],
            };
          }

          case 'get_portal_stats': {
            const parsed = GetPortalStatsSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const stats = await this.api.getPortalStats();

            let responseText = '# Berlin Open Data Portal Statistics\n\n';
            responseText += `📊 **Total Datasets**: ${stats.total_datasets}\n`;
            responseText += `🏛️ **Organizations**: ${stats.total_organizations}\n`;
            responseText += `🏷️ **Categories/Tags**: ${stats.total_tags}\n`;

            responseText += '\n💡 **Next steps**:\n';
            responseText += '- Use `list_all_datasets` to browse all datasets\n';
            responseText += '- Use `search_berlin_datasets` to find specific topics\n';

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'list_all_datasets': {
            const parsed = ListAllDatasetsSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { offset, limit } = parsed.data;
            const result = await this.api.listAllDatasets(offset, limit);

            let responseText = `# All Berlin Open Datasets\n\n`;
            responseText += `Showing ${offset + 1}-${Math.min(offset + limit, result.total)} of ${result.total} datasets\n\n`;

            result.datasets.forEach((dataset: any, index: number) => {
              responseText += `${offset + index + 1}. **${dataset.title}** (ID: ${dataset.name})\n`;
            });

            if (offset + limit < result.total) {
              responseText += `\n📄 **More data available**: Use offset=${offset + limit} to see next page\n`;
            }

            responseText += `\n💡 Use \`get_dataset_details\` with any ID to see full information\n`;

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'fetch_dataset_data': {
            const parsed = FetchDatasetDataSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { dataset_id, resource_id, full_data } = parsed.data;

            const LARGE_DATASET_THRESHOLD = 1000;

            // Get dataset to find resources
            const dataset = await this.api.getDataset(dataset_id);

            if (!dataset.resources || dataset.resources.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ No resources available for dataset "${dataset_id}". This dataset may not have downloadable files.`,
                }],
              };
            }

            // Select resource
            let resource;
            if (resource_id) {
              resource = dataset.resources.find(r => r.id === resource_id);
              if (!resource) {
                return {
                  content: [{
                    type: 'text',
                    text: `❌ Resource "${resource_id}" not found. Use \`get_dataset_details\` to see available resources and their IDs.`,
                  }],
                };
              }
            } else {
              // Smart resource selection - prefer data formats over HTML/other
              const dataFormats = ['CSV', 'JSON', 'XLSX', 'XLS', 'XML', 'WMS', 'WFS'];
              resource = dataset.resources.find(r =>
                dataFormats.includes(r.format?.toUpperCase())
              ) || dataset.resources[0]; // Fallback to first if no data format found
            }

            // Check if this is a ZIP file - cannot preview/analyze
            const formatUpper = resource.format?.toUpperCase() || '';
            if (formatUpper === 'ZIP' || formatUpper.startsWith('ZIP:') || formatUpper.includes(':ZIP')) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Cannot preview ZIP files. ZIP archives must be downloaded directly.\n\n**Direct download URL**: ${resource.url}\n\nZIP files contain compressed data that needs to be extracted first. Download the file and extract it to access the data inside.`,
                }],
              };
            }

            // Fetch the data. For WFS large datasets this returns a sample; fullData: true
            // will be requested below if the user asked for it and size permits.
            let fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: false });

            if (fetchedData.error) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Error fetching data: ${fetchedData.error}\n\nYou can try:\n- Using a different resource\n- Downloading manually from: ${resource.url}`,
                }],
              };
            }

            // Use totalRows from the fetcher (accurate for WFS via getFeatureCount;
            // equals rows.length for CSV/JSON/XLSX which always load everything).
            const totalRows = fetchedData.totalRows;
            const isSampled = fetchedData.rows.length < totalRows;
            const isLarge = totalRows > LARGE_DATASET_THRESHOLD;
            const sizeLabel = isLarge ? 'large' : 'small';

            let responseText = `# Data from: ${dataset.title}\n\n`;
            responseText += `**Resource**: ${resource.name} (${resource.format})\n\n`;

            // Handle explicit full_data request for large datasets (reject)
            if (full_data && isLarge) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Dataset has ${totalRows} rows and is too large for direct analysis. Returning all data would risk context overflow.\n\n📥 **Download manually**: ${resource.url}\n\nOnce downloaded, attach the file to Claude Desktop for analysis.`,
                }],
              };
            }

            // If full data was requested and we only have a sample (e.g. WFS large dataset),
            // re-fetch with fullData: true now that we know the size is within limits.
            if (full_data && isSampled) {
              fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: true });
              if (fetchedData.error) {
                return {
                  content: [{
                    type: 'text',
                    text: `❌ Error fetching full data: ${fetchedData.error}\n\nYou can try downloading manually from: ${resource.url}`,
                  }],
                };
              }
            }

            if (!isLarge) {
              // Enrich data with LOR names if applicable
              const lorInfo = this.lorLookup.hasLORColumns(fetchedData.columns);
              let enrichedRows = fetchedData.rows;

              if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID)) {
                enrichedRows = fetchedData.rows.map(row => this.lorLookup.enrichRow(row));
              }

              // Geometry columns — useful for map rendering but bloat LLM context
              const GEOMETRY_COLS = new Set(['geometry_coordinates', 'geometry_type', 'geometry']);

              const displayColumns = enrichedRows.length > 0 ? Object.keys(enrichedRows[0]) : fetchedData.columns;
              const sampledNote = isSampled && !full_data
                ? ` *(showing ${enrichedRows.length} of ${totalRows} — use \`full_data: true\` to fetch all)*`
                : '';
              responseText += `**Rows**: ${totalRows}${sampledNote} | **Columns (${displayColumns.length}):** ${displayColumns.join(', ')}\n\n`;

              if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID)) {
                responseText += `**📍 LOR Enrichment:** Automatically enriched with Berlin administrative district names.\n`;
                if (lorInfo.hasBEZ) responseText += `- \`BEZIRK_NAME\`: Full bezirk name (e.g., "Marzahn-Hellersdorf")\n`;
                if (lorInfo.hasRAUMID) responseText += `- \`PLANUNGSRAUM_NAME\`, \`BEZIRKSREGION_NAME\`, \`PROGNOSERAUM_NAME\`: Planning area names\n`;
                responseText += `\n`;
              }

              const preview = enrichedRows.slice(0, 3);
              responseText += `## Preview (first 3 rows)\n\n`;
              responseText += `\`\`\`json\n${JSON.stringify(preview, null, 2)}\n\`\`\`\n\n`;

              // For datasets with many rows, add value distributions for categorical columns so
              // the LLM can answer aggregation questions without needing the full row list.
              const attributeRows = enrichedRows.map(row => {
                const r: any = {};
                for (const [k, v] of Object.entries(row)) {
                  if (!GEOMETRY_COLS.has(k)) r[k] = v;
                }
                return r;
              });

              if (attributeRows.length > 10) {
                const attrCols = attributeRows.length > 0 ? Object.keys(attributeRows[0]) : [];
                const distributions: Record<string, Record<string, number>> = {};
                for (const col of attrCols) {
                  const counts: Record<string, number> = {};
                  let uniqueOverflow = false;
                  for (const row of attributeRows) {
                    const val = String(row[col] ?? '');
                    counts[val] = (counts[val] ?? 0) + 1;
                    if (Object.keys(counts).length > 50) { uniqueOverflow = true; break; }
                  }
                  if (!uniqueOverflow) distributions[col] = counts;
                }
                if (Object.keys(distributions).length > 0) {
                  responseText += `## Column value distributions\n\n`;
                  responseText += `\`\`\`json\n${JSON.stringify(distributions, null, 2)}\n\`\`\`\n\n`;
                }
              }

              // Avoid oversized MCP responses: do not include a large full-row JSON block.
              // Clients can use download_dataset when they need the complete file payload.
              responseText += `## Full data access\n\n`;
              responseText += `For complete row-level data, use \`download_dataset\` (or fetch this resource directly): ${resource.url}\n\n`;

              return {
                content: [{ type: 'text', text: responseText }],
              };
            }

            // For large datasets, return sample with warning
            const sample = this.dataSampler.generateSample(
              fetchedData.rows,
              fetchedData.columns
            );

            responseText += `Dataset has ${totalRows} rows. This is a **${sizeLabel} dataset**.\n\n`;
            responseText += `## ⚠️ LARGE DATASET - MANUAL DOWNLOAD REQUIRED\n\n`;
            responseText += `This dataset has **${totalRows} rows** and CANNOT be analyzed in-context.\n\n`;
            responseText += `**CRITICAL: Do NOT attempt automated downloads or create sample/synthetic data.**\n\n`;
            responseText += `**REQUIRED STEPS for analysis:**\n\n`;
            responseText += `1. **Manual download ONLY:** Open ${resource.url} in your browser and save the file\n`;
            responseText += `2. **Attach the downloaded file** to this conversation using the paperclip icon\n`;
            responseText += `3. **Wait for confirmation** that the file is loaded before proceeding with analysis\n\n`;
            responseText += `**DO NOT:**\n`;
            responseText += `- ❌ Use wget, curl, or requests to download (proxy errors)\n`;
            responseText += `- ❌ Create synthetic/sample data based on the preview\n`;
            responseText += `- ❌ Extrapolate from the 10-row preview below\n\n`;
            responseText += `The 10-row preview below is for REFERENCE ONLY and must NOT be used for analysis.\n\n`;
            responseText += `---\n\n`;
            responseText += `## Data Preview\n\n`;
            responseText += `**Columns (${fetchedData.columns.length}):** ${fetchedData.columns.join(', ')}\n\n`;
            responseText += `**Sample Data (first ${sample.sampleRows.length} rows):**\n`;
            responseText += `\`\`\`json\n${JSON.stringify(sample.sampleRows, null, 2)}\n\`\`\`\n\n`;

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'aggregate_dataset': {
            const parsed = AggregateDatasetSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const {
              dataset_id,
              resource_id,
              group_by = [],
              metrics,
              filters = [],
              sort = [],
              limit = 100,
            } = parsed.data;

            const dataset = await this.api.getDataset(dataset_id);
            if (!dataset.resources || dataset.resources.length === 0) {
              return {
                content: [{ type: 'text', text: `❌ No resources available for dataset "${dataset_id}".` }],
              };
            }

            let resource;
            if (resource_id) {
              resource = dataset.resources.find(r => r.id === resource_id);
              if (!resource) {
                return {
                  content: [{ type: 'text', text: `❌ Resource "${resource_id}" not found.` }],
                };
              }
            } else {
              const dataFormats = ['CSV', 'JSON', 'XLSX', 'XLS', 'XML', 'WMS', 'WFS'];
              resource = dataset.resources.find(r => dataFormats.includes(r.format?.toUpperCase())) || dataset.resources[0];
            }

            const formatUpper = resource.format?.toUpperCase() || '';
            if (formatUpper === 'ZIP' || formatUpper.startsWith('ZIP:') || formatUpper.includes(':ZIP')) {
              return {
                content: [{ type: 'text', text: `❌ Cannot aggregate ZIP resources directly. Download and extract first: ${resource.url}` }],
              };
            }

            const fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: true });
            if (fetchedData.error) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Error fetching data for aggregation: ${fetchedData.error}\n\nTry a different resource or download manually: ${resource.url}`,
                }],
              };
            }

            const GEOMETRY_COLS = new Set(['geometry_coordinates', 'geometry_type', 'geometry']);
            const lorInfo = this.lorLookup.hasLORColumns(fetchedData.columns);
            let rows = fetchedData.rows;
            if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID)) {
              rows = rows.map(row => this.lorLookup.enrichRow(row));
            }

            rows = rows.map(row => {
              const clean: any = {};
              for (const [k, v] of Object.entries(row)) {
                if (!GEOMETRY_COLS.has(k)) clean[k] = v;
              }
              return clean;
            });

            const toNumber = (v: any): number | null => {
              if (v === null || v === undefined || v === '') return null;
              const n = Number(v);
              return Number.isFinite(n) ? n : null;
            };

            const matchesFilter = (row: Record<string, any>, filter: { column: string; op: string; value: any }): boolean => {
              const raw = row[filter.column];
              const rawStr = String(raw ?? '');
              const filterStr = String(filter.value ?? '');
              const rawNum = toNumber(raw);
              const filterNum = toNumber(filter.value);

              switch (filter.op) {
                case 'eq': return rawStr === filterStr;
                case 'neq': return rawStr !== filterStr;
                case 'contains': return rawStr.toLowerCase().includes(filterStr.toLowerCase());
                case 'in': {
                  const values = Array.isArray(filter.value) ? filter.value.map((v: any) => String(v)) : [filterStr];
                  return values.includes(rawStr);
                }
                case 'gt': return rawNum !== null && filterNum !== null ? rawNum > filterNum : rawStr > filterStr;
                case 'gte': return rawNum !== null && filterNum !== null ? rawNum >= filterNum : rawStr >= filterStr;
                case 'lt': return rawNum !== null && filterNum !== null ? rawNum < filterNum : rawStr < filterStr;
                case 'lte': return rawNum !== null && filterNum !== null ? rawNum <= filterNum : rawStr <= filterStr;
                default: return false;
              }
            };

            const filteredRows = rows.filter(row => filters.every(f => matchesFilter(row, f)));
            const groupCols = group_by ?? [];
            const groupMap = new Map<string, any>();
            const metricName = (m: { op: string; column?: string; as?: string }) => m.as || `${m.op}_${m.column || 'rows'}`;

            const ensureGroup = (row: Record<string, any>) => {
              const groupKey = groupCols.length > 0
                ? JSON.stringify(groupCols.map(col => row[col] ?? null))
                : '__all__';

              let agg = groupMap.get(groupKey);
              if (!agg) {
                agg = {};
                for (const col of groupCols) agg[col] = row[col] ?? null;
                for (const m of metrics) {
                  const name = metricName(m);
                  if (m.op === 'count') agg[name] = 0;
                  else if (m.op === 'sum' || m.op === 'avg') {
                    agg[name] = 0;
                    if (m.op === 'avg') agg[`__avg_count_${name}`] = 0;
                  } else if (m.op === 'min' || m.op === 'max') agg[name] = null;
                  else if (m.op === 'count_distinct') agg[`__distinct_${name}`] = new Set<string>();
                }
                groupMap.set(groupKey, agg);
              }
              return agg;
            };

            for (const row of filteredRows) {
              const agg = ensureGroup(row);
              for (const m of metrics) {
                const name = metricName(m);
                const value = m.column ? row[m.column] : undefined;
                const num = toNumber(value);
                switch (m.op) {
                  case 'count':
                    agg[name] += 1;
                    break;
                  case 'sum':
                    if (num !== null) agg[name] += num;
                    break;
                  case 'avg':
                    if (num !== null) {
                      agg[name] += num;
                      agg[`__avg_count_${name}`] += 1;
                    }
                    break;
                  case 'min':
                    if (num !== null) agg[name] = agg[name] === null ? num : Math.min(agg[name], num);
                    break;
                  case 'max':
                    if (num !== null) agg[name] = agg[name] === null ? num : Math.max(agg[name], num);
                    break;
                  case 'count_distinct':
                    agg[`__distinct_${name}`].add(String(value ?? ''));
                    break;
                }
              }
            }

            let resultRows = Array.from(groupMap.values()).map((agg: any) => {
              const out: any = {};
              for (const col of groupCols) out[col] = agg[col];
              for (const m of metrics) {
                const name = metricName(m);
                if (m.op === 'avg') {
                  const c = agg[`__avg_count_${name}`];
                  out[name] = c > 0 ? agg[name] / c : null;
                } else if (m.op === 'count_distinct') {
                  out[name] = agg[`__distinct_${name}`].size;
                } else {
                  out[name] = agg[name];
                }
              }
              return out;
            });

            if (sort.length > 0) {
              resultRows.sort((a, b) => {
                for (const s of sort) {
                  const dir = (s.direction || 'asc').toLowerCase() === 'desc' ? -1 : 1;
                  const av = a[s.column];
                  const bv = b[s.column];
                  if (av === bv) continue;
                  if (av === null || av === undefined) return 1;
                  if (bv === null || bv === undefined) return -1;
                  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
                  return String(av).localeCompare(String(bv)) * dir;
                }
                return 0;
              });
            }

            const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
            const limitedRows = resultRows.slice(0, safeLimit);

            let responseText = `# Aggregation result: ${dataset.title}\n\n`;
            responseText += `**Source resource:** ${resource.name} (${resource.format})\n`;
            responseText += `**Input rows:** ${rows.length}\n`;
            responseText += `**Rows after filters:** ${filteredRows.length}\n`;
            responseText += `**Groups:** ${resultRows.length}`;
            if (resultRows.length > limitedRows.length) {
              responseText += ` (showing first ${limitedRows.length})`;
            }
            responseText += `\n\n`;
            responseText += `**Group by:** ${groupCols.length > 0 ? groupCols.join(', ') : '(none)'}\n`;
            responseText += `**Metrics:** ${metrics.map(m => `${metricName(m)}=${m.op}${m.column ? `(${m.column})` : ''}`).join(', ')}\n`;
            if (filters.length > 0) {
              responseText += `**Filters:** ${filters.map(f => `${f.column} ${f.op} ${Array.isArray(f.value) ? `[${f.value.join(', ')}]` : f.value}`).join(' AND ')}\n`;
            }
            responseText += `\n## Result rows\n\n`;
            responseText += `\`\`\`json\n${JSON.stringify(limitedRows, null, 2)}\n\`\`\`\n`;

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'download_dataset': {
            const parsed = DownloadDatasetSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { dataset_id, resource_id, format: requestedFormat } = parsed.data;

            // Get dataset to find resources
            const dataset = await this.api.getDataset(dataset_id);

            if (!dataset.resources || dataset.resources.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ No resources available for dataset "${dataset_id}". This dataset may not have downloadable files.`,
                }],
              };
            }

            // Select resource - prefer data formats
            let resource;
            if (resource_id) {
              resource = dataset.resources.find(r => r.id === resource_id);
              if (!resource) {
                return {
                  content: [{
                    type: 'text',
                    text: `❌ Resource "${resource_id}" not found. Use \`get_dataset_details\` to see available resources and their IDs.`,
                  }],
                };
              }
            } else {
              // Smart resource selection - prefer data formats over HTML/other
              const dataFormats = ['CSV', 'JSON', 'XLSX', 'XLS', 'XML', 'WMS', 'WFS'];
              resource = dataset.resources.find(r =>
                dataFormats.includes(r.format?.toUpperCase())
              ) || dataset.resources[0];
            }

            // Handle ZIP files - provide direct download URL
            if (resource.format?.toUpperCase() === 'ZIP') {
              return {
                content: [{
                  type: 'text',
                  text: `📦 ZIP Archive: ${resource.name}\n\n**Direct download URL**: ${resource.url}\n\nZIP files cannot be processed through the MCP server. Please download the file directly from the URL above and extract it to access the data inside.\n\n💡 **Tip**: After extracting, you can analyze individual files from the archive by attaching them to the conversation.`,
                }],
              };
            }

            // Fetch the data (full dataset for download)
            const fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: true });

            if (fetchedData.error) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Error downloading data: ${fetchedData.error}\n\nYou can try:\n- Using a different resource\n- Downloading manually from: ${resource.url}`,
                }],
              };
            }

            // Transform GeoJSON coordinates early if we have originalGeoJSON
            // This ensures the preview shows transformed coordinates
            if (fetchedData.originalGeoJSON) {
              // Check if coordinates need transformation by looking at first coordinate
              // WGS84: lon [-180, 180], lat [-90, 90]
              // EPSG:25833: x ~[300000, 500000], y ~[5800000, 5900000]
              let needsTransform = false;
              const firstFeature = fetchedData.originalGeoJSON.features?.[0];
              if (firstFeature?.geometry?.coordinates) {
                const coords = firstFeature.geometry.coordinates;
                // Get first coordinate point (handling different geometry types)
                let firstCoord;
                if (firstFeature.geometry.type === 'Point') {
                  firstCoord = coords;
                } else if (firstFeature.geometry.type === 'LineString') {
                  firstCoord = coords[0];
                } else if (firstFeature.geometry.type === 'Polygon') {
                  firstCoord = coords[0][0];
                } else if (firstFeature.geometry.type === 'MultiPolygon') {
                  firstCoord = coords[0][0][0];
                }

                // If coordinates are outside WGS84 range, they need transformation
                if (firstCoord && (Math.abs(firstCoord[0]) > 180 || Math.abs(firstCoord[1]) > 90)) {
                  needsTransform = true;
                }
              }

              let transformedGeoJSON;
              if (needsTransform) {
                // Berlin WFS services use EPSG:25833
                const sourceCRS = resource.format.toUpperCase() === 'WFS' ? 'EPSG:25833' : undefined;
                transformedGeoJSON = this.geoJSONTransformer.transformToWGS84(
                  fetchedData.originalGeoJSON,
                  sourceCRS
                );
              } else {
                // Already in WGS84, just clean CRS property
                transformedGeoJSON = this.geoJSONTransformer.transformToWGS84(
                  fetchedData.originalGeoJSON
                );
              }

              fetchedData.originalGeoJSON = transformedGeoJSON;

              // Re-parse to update rows with transformed coordinates
              const geojsonFeatures = transformedGeoJSON.type === 'FeatureCollection'
                ? transformedGeoJSON.features
                : [transformedGeoJSON];

              const updatedRows: any[] = [];
              const columnSet = new Set<string>(fetchedData.columns);

              for (const feature of geojsonFeatures) {
                if (feature.type !== 'Feature') continue;

                const row: any = {};

                // Add properties
                if (feature.properties && typeof feature.properties === 'object') {
                  Object.keys(feature.properties).forEach(key => {
                    row[key] = (feature.properties as any)[key];
                    columnSet.add(key);
                  });
                }

                // Add geometry metadata
                if (feature.geometry) {
                  row['geometry_type'] = feature.geometry.type;
                  columnSet.add('geometry_type');

                  // GeometryCollection doesn't have coordinates directly
                  const geom = feature.geometry as any;
                  if (geom.coordinates) {
                    row['geometry_coordinates'] = JSON.stringify(geom.coordinates);
                    columnSet.add('geometry_coordinates');
                  }
                }

                // Add feature ID if present
                if (feature.id !== undefined) {
                  row['feature_id'] = feature.id;
                  columnSet.add('feature_id');
                }

                updatedRows.push(row);
              }

              fetchedData.rows = updatedRows;
              fetchedData.columns = Array.from(columnSet);
            }

            // Determine output format
            // For geodata (WFS, GeoJSON, KML), default to 'geojson' unless explicitly requested otherwise
            let outputFormat: string;
            if (requestedFormat) {
              outputFormat = requestedFormat;
            } else {
              const resourceFormat = resource.format.toUpperCase();
              if (resourceFormat === 'CSV') {
                outputFormat = 'csv';
              } else if (['WFS', 'GEOJSON', 'KML'].includes(resourceFormat)) {
                outputFormat = 'geojson';
              } else {
                outputFormat = 'json';
              }
            }

            // Generate file content
            let fileContent: string;
            let mimeType: string;
            let fileExtension: string;

            // Special handling for GeoJSON - use already-transformed GeoJSON
            if (outputFormat === 'geojson' && fetchedData.originalGeoJSON) {
              // GeoJSON already transformed to WGS84 earlier (see coordinate transformation above)
              fileContent = JSON.stringify(fetchedData.originalGeoJSON, null, 2);
              mimeType = 'application/geo+json';
              fileExtension = 'geojson';
            } else if (outputFormat === 'csv') {
              // Convert to CSV
              if (fetchedData.rows.length > 0) {
                const header = fetchedData.columns.join(',') + '\n';
                const rows = fetchedData.rows.map(row => {
                  return fetchedData.columns.map(col => {
                    const val = row[col];
                    // Escape CSV values with commas or quotes
                    if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                      return `"${val.replace(/"/g, '""')}"`;
                    }
                    return val ?? '';
                  }).join(',');
                }).join('\n');
                fileContent = header + rows;
              } else {
                fileContent = fetchedData.columns.join(',');
              }
              mimeType = 'text/csv';
              fileExtension = 'csv';
            } else {
              // JSON format
              fileContent = JSON.stringify(fetchedData.rows, null, 2);
              mimeType = 'application/json';
              fileExtension = 'json';
            }

            // Helper function to transliterate German umlauts
            const transliterateGerman = (text: string): string => {
              return text
                .replace(/ä/g, 'ae')
                .replace(/ö/g, 'oe')
                .replace(/ü/g, 'ue')
                .replace(/ß/g, 'ss');
            };

            // Generate filename from dataset title and resource name
            const datasetPart = transliterateGerman(dataset.title.toLowerCase())
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');

            // Add resource name if it provides additional context
            let safeFilename = datasetPart;

            // Skip resource name for WFS resources (they typically have generic names)
            const isWfsResource = resource.format.toUpperCase() === 'WFS';

            if (!isWfsResource && resource.name && resource.name.trim() !== '') {
              const resourceName = resource.name
                .toLowerCase()
                .replace(/\(csv\)|\(json\)|\(xlsx?\)|\(geojson\)/gi, '') // Remove format indicators
                .trim();

              if (resourceName !== '' && resourceName !== dataset.title.toLowerCase()) {
                const resourcePart = transliterateGerman(resourceName)
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '');

                // Extract tokens from both parts to find unique resource tokens
                const datasetTokens = new Set(datasetPart.split('-').filter(t => t.length > 2));
                const resourceTokens = resourcePart.split('-').filter(t => t.length > 0);

                // Keep only resource tokens that add new information
                const uniqueTokens = resourceTokens.filter(token =>
                  !datasetTokens.has(token) || token.length <= 2
                );

                if (uniqueTokens.length > 0) {
                  safeFilename = `${datasetPart}-${uniqueTokens.join('-')}`;
                }
              }
            }

            safeFilename = safeFilename.substring(0, 100);
            const filename = `${safeFilename}.${fileExtension}`;

            const fileSizeKB = (fileContent.length / 1024).toFixed(2);

            // Return with special marker for download
            let responseText = `✅ **Download ready!**\n\n`;
            responseText += `**Dataset:** ${dataset.title}\n`;
            responseText += `**Format:** ${outputFormat.toUpperCase()}\n`;
            responseText += `**Size:** ${fileSizeKB} KB\n`;
            responseText += `**Rows:** ${fetchedData.rows.length}`;

            // Add WFS-specific information about feature limits
            if (isWfsResource && fetchedData.totalRows > 5000) {
              responseText += ` (of ${fetchedData.totalRows.toLocaleString()} total features)\n`;
              responseText += `\n⚠️ **Note:** Due to browser resource limitations, only 5,000 features are included in this download.\n`;
              responseText += `For the complete dataset, use the [WFS Explorer](https://wfsexplorer.odis-berlin.de/?wfs=${encodeURIComponent(resource.url.split('?')[0])}).\n`;
            } else {
              responseText += `\n`;
            }

            responseText += `**Columns:** ${fetchedData.columns.length}\n\n`;

            // Show first row preview
            if (fetchedData.rows.length > 0) {
              responseText += `**First row:**\n\`\`\`json\n${JSON.stringify(fetchedData.rows[0], null, 2)}\n\`\`\`\n\n`;
            }

            responseText += `[DOWNLOAD:${filename}:${mimeType}]\n`;
            responseText += fileContent;

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'search_datasets_filtered': {
            const parsed = SearchFilteredSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const {
              query,
              organization,
              tag,
              format,
              modified_since,
              sort,
              rows,
            } = parsed.data;

            const processedQuery = query !== '*' ? this.queryProcessor.buildQuery(query) : query;

            const result = await this.api.searchDatasetsFiltered({
              query: processedQuery,
              organization,
              tag,
              format,
              modified_since,
              sort,
              limit: rows,
            });

            let responseText = `# Filtered Search: "${query}"\n\n`;

            const activeFilters: string[] = [];
            if (organization) activeFilters.push(`organization: ${organization}`);
            if (tag) activeFilters.push(`tag: ${tag}`);
            if (format) activeFilters.push(`format: ${format}`);
            if (modified_since) activeFilters.push(`modified since: ${modified_since}`);
            if (activeFilters.length > 0) {
              responseText += `**Active filters**: ${activeFilters.join(' · ')}\n`;
            }
            responseText += `**Total matches**: ${result.count}`;
            if (result.count > rows) {
              responseText += ` (showing ${rows})`;
            }
            responseText += '\n\n';

            if (result.results.length === 0) {
              responseText += 'No datasets found. Try broadening your filters or query.\n';
            } else {
              result.results.forEach((dataset, index) => {
                responseText += `## ${index + 1}. ${dataset.title}\n`;
                responseText += `**ID**: ${dataset.name}\n`;
                responseText += `**Organization**: ${dataset.organization?.title || 'Unknown'}\n`;

                const datePeriodMatch = dataset.title.match(
                  /(?:am\s+\d{1,2}\.\d{1,2}\.(\d{4})|(\d{4})\/(\d{4})|(?:^|\s)(\d{4})(?:\s|$))/
                );
                if (datePeriodMatch) {
                  const year = datePeriodMatch[1] || datePeriodMatch[3] || datePeriodMatch[4];
                  if (year) responseText += `**Data period**: ${year}\n`;
                }

                if (dataset.metadata_modified) {
                  responseText += `**Catalog entry updated**: ${new Date(dataset.metadata_modified).toLocaleDateString('de-DE')}\n`;
                }
                if (dataset.notes) {
                  const desc = dataset.notes.length > 200 ? dataset.notes.substring(0, 200) + '…' : dataset.notes;
                  responseText += `**Description**: ${desc}\n`;
                }
                if (dataset.resources?.length > 0) {
                  const formats = [...new Set(dataset.resources.map((r: any) => r.format).filter(Boolean))];
                  responseText += `**Resources**: ${dataset.resources.length} file(s) (${formats.join(', ')})\n`;
                }
                if (dataset.tags?.length > 0) {
                  responseText += `**Tags**: ${dataset.tags.slice(0, 5).map((t: any) => t.name).join(', ')}\n`;
                }
                responseText += '\n';
              });
              responseText += `\n> **Note**: "Catalog entry updated" is when the portal record was last edited — NOT data currency. The actual reference period is usually in the dataset title (e.g. "am 31.12.2024").\n`;
            }

            if (result.facets && Object.keys(result.facets).length > 0) {
              responseText += `\n## Refine your search\n\n`;
              responseText += `Use the **slug** (in backticks) as the \`organization\` parameter value — NOT the display name:\n\n`;

              if (result.facets.organization?.length) {
                responseText += `**Organizations**:\n`;
                result.facets.organization.forEach((f: any) => {
                  let note = '';
                  if (f.name.includes('harvester') || f.name.includes('simplesearch')) note = ' ⚠️ re-harvests geodata daily — dominates date-sorted results';
                  responseText += `- \`${f.name}\` — ${f.display_name} (${f.count} datasets)${note}\n`;
                });
                responseText += `\n**→ To get the most recent data**: re-run with the chosen \`organization\` slug above and \`sort="metadata_modified desc"\`\n\n`;
              }
              if (result.facets.tags?.length) {
                responseText += `**Tags** (use as \`tag\` filter): ${result.facets.tags.map((f: any) => `\`${f.name}\` (${f.count})`).join(', ')}\n`;
              }
              if (result.facets.res_format?.length) {
                responseText += `**Formats** (use as \`format\` filter): ${result.facets.res_format.map((f: any) => `\`${f.name}\` (${f.count})`).join(', ')}\n`;
              }
            }

            return { content: [{ type: 'text', text: responseText }] };
          }

          case 'list_geo_layers': {
            const parsed = ListGeoLayersSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { dataset_id } = parsed.data;

            // Get dataset to find WFS resources
            const dataset = await this.api.getDataset(dataset_id);
            const wfsResource = dataset.resources?.find(r => r.format?.toUpperCase() === 'WFS');

            if (!wfsResource || !wfsResource.url) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ No WFS resource found for dataset "${dataset_id}". Use \`get_dataset_details\` to see available resources.`,
                }],
              };
            }

            const { baseUrl, preservedParams } = this.wfsClient.parseWFSUrl(wfsResource.url);
            const capabilities = await this.wfsClient.getCapabilities(baseUrl, preservedParams);

            let responseText = `# Available Geo Layers for: ${dataset.title}\n\n`;
            responseText += `**WFS URL**: ${baseUrl}\n\n`;

            for (const ft of capabilities.featureTypes) {
              responseText += `### ${ft.title}\n`;
              responseText += `- **Layer Name (typename)**: \`${ft.name}\`\n`;
              if (ft.abstract) {
                responseText += `- **Abstract**: ${ft.abstract}\n`;
              }
              
              // Get feature count for this layer
              const count = await this.wfsClient.getFeatureCount(baseUrl, ft.name, preservedParams);
              responseText += `- **Feature Count**: ${count.toLocaleString()}\n\n`;
            }

            responseText += `\n**Next steps**: Use \`fetch_geo_features\` with the \`wfs_url\` and \`typename\` above to fetch data.`;

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'fetch_geo_features': {
            const parsed = FetchGeoFeaturesSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { wfs_url, typename, limit, property_filter } = parsed.data;

            const { baseUrl, preservedParams } = this.wfsClient.parseWFSUrl(wfs_url);
            const geojson = await this.wfsClient.getFeatures(
              baseUrl,
              typename,
              { count: limit, cqlFilter: property_filter },
              preservedParams
            );

            let responseText = `# Geo Features: ${typename}\n\n`;
            responseText += `**WFS URL**: ${baseUrl}\n`;
            responseText += `**Total features returned**: ${geojson.features.length}\n\n`;

            if (geojson.features.length > 0) {
              const firstFeature = geojson.features[0];
              const properties = Object.keys(firstFeature.properties || {});
              responseText += `**Properties (${properties.length})**: ${properties.join(', ')}\n`;
              responseText += `**Geometry Type**: ${firstFeature.geometry?.type || 'Unknown'}\n\n`;

              responseText += `## Sample Data (first 3 features)\n\n`;
              const preview = geojson.features.slice(0, 3);
              responseText += `\`\`\`json\n${JSON.stringify(preview, null, 2)}\n\`\`\`\n\n`;
            } else {
              responseText += `No features found matching the criteria.\n`;
            }

            responseText += `\n**Note**: For larger datasets or full analysis, use \`download_dataset\` to get the complete GeoJSON.`;

            return {
              content: [{ type: 'text', text: responseText }],
            };
          }

          case 'get_facets': {
            const parsed = GetFacetsSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { query, limit } = parsed.data;

            const facets = await this.api.getFacets(
              query,
              ['tags', 'organization', 'res_format', 'groups'],
              limit,
            );

            let responseText = `# Facets for "${query}"\n\n`;
            responseText += `Use these values with \`search_datasets_filtered\` to narrow your search.\n\n`;

            if (facets.organization?.length) {
              responseText += `## Organizations\n`;
              facets.organization.forEach(f => {
                responseText += `- \`${f.name}\` — ${f.display_name} (${f.count} datasets)\n`;
              });
              responseText += '\n';
            }

            if (facets.tags?.length) {
              responseText += `## Tags\n`;
              facets.tags.forEach(f => {
                responseText += `- \`${f.name}\` (${f.count} datasets)\n`;
              });
              responseText += '\n';
            }

            if (facets.res_format?.length) {
              responseText += `## Formats\n`;
              facets.res_format.forEach(f => {
                responseText += `- \`${f.name}\` (${f.count} datasets)\n`;
              });
              responseText += '\n';
            }

            if (facets.groups?.length) {
              responseText += `## Groups\n`;
              facets.groups.forEach(f => {
                responseText += `- \`${f.name}\` — ${f.display_name} (${f.count} datasets)\n`;
              });
              responseText += '\n';
            }

            return { content: [{ type: 'text', text: responseText }] };
          }

          case 'list_tags': {
            const parsed = ListTagsSchema.safeParse(args);
            if (!parsed.success) {
              return { content: [{ type: 'text', text: `❌ Validation error: ${parsed.error.message}` }] };
            }
            const { query, limit } = parsed.data;

            const tags = await this.api.listTags(limit, query);

            let responseText = query
              ? `# Tags matching "${query}"\n\n`
              : `# Available Tags (first ${limit})\n\n`;

            if (tags.length === 0) {
              responseText += 'No tags found.\n';
            } else {
              responseText += tags.map(t => `- \`${t.name}\``).join('\n');
              responseText += `\n\n${tags.length} tag(s) returned. Use these values in \`search_datasets_filtered\` as the \`tag\` parameter.\n`;
            }

            return { content: [{ type: 'text', text: responseText }] };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });

    this.server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'berlin_data_discovery',
          description: 'Help discover relevant Berlin open datasets based on user needs',
          arguments: [
            {
              name: 'topic',
              description: 'The topic or domain you are interested in',
              required: true,
            },
            {
              name: 'use_case',
              description: 'What you plan to do with the data',
              required: false,
            },
          ],
        },
      ],
    }));

    this.server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'berlin_data_discovery') {
        const { topic, use_case } = args as { topic: string; use_case?: string };

        const promptText = `I need to find Berlin open datasets related to "${topic}"` +
          (use_case ? ` for ${use_case}` : '') +
          '. Please help me discover relevant datasets and provide information about their content, formats, and how to access them.';

        return {
          description: `Data discovery prompt for ${topic}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: promptText,
              },
            },
          ],
        };
      }

      throw new Error(`Unknown prompt: ${name}`);
    });
  }

  async connect(transport: any) {
    await this.server.connect(transport);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Berlin Open Data MCP Server running on stdio');
  }
}

const server = new BerlinOpenDataMCPServer();
server.run().catch(console.error);