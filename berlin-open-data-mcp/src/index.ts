#!/usr/bin/env node
// ABOUTME: MCP server implementation for Berlin Open Data Portal
// ABOUTME: Handles tool registration and request routing for dataset discovery and data fetching

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BerlinOpenDataAPI } from './berlin-api.js';
import { QueryProcessor } from './query-processor.js';
import { DataFetcher } from './data-fetcher.js';
import { DataSampler } from './data-sampler.js';
import { GeoJSONTransformer } from './geojson-transformer.js';
import { LORLookupService } from './lor-lookup.js';
import { WFSClient, isClientSafeWFSError } from './wfs-client.js';
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
        name: 'berlin-opendata-mcp-server',
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
    this.server.registerTool(
      'search_berlin_datasets',
      {
        description:
          'Search Berlin open datasets using natural language queries in German or English. Automatically expands synonyms (e.g. "bicycle" → fahrrad, radverkehr) and sends a single OR-joined edismax query across titles, descriptions, tags, authors, and maintainers. Results are sorted by relevance then recency.',
        inputSchema: SearchDatasetsSchema,
      },
      async (args) => this.handleSearchBerlinDatasets(args)
    );

    this.server.registerTool(
      'search_datasets_filtered',
      {
        description:
          'Structured search with explicit filters for organization, tag, file format, and date. Filters map to Solr fq (cached, zero-cost for scoring). Always returns facet counts so you can refine further. Use after get_facets to do a two-step discovery → filter workflow.',
        inputSchema: SearchFilteredSchema,
      },
      async (args) => this.handleSearchFiltered(args)
    );

    this.server.registerTool(
      'get_facets',
      {
        description:
          'Returns top tags, organizations, and file formats associated with a query without fetching any actual datasets (rows=0). Use this as a fast first step to discover the taxonomy of a topic, then call search_datasets_filtered with the relevant fq values.',
        inputSchema: GetFacetsSchema,
      },
      async (args) => this.handleGetFacets(args)
    );

    this.server.registerTool(
      'list_tags',
      {
        description:
          'List available tags from the Berlin Open Data Portal, optionally filtered by a prefix query. Use for tag autocomplete when building fq filters for search_datasets_filtered.',
        inputSchema: ListTagsSchema,
      },
      async (args) => this.handleListTags(args)
    );

    this.server.registerTool(
      'get_dataset_details',
      {
        description: 'Get detailed information about a specific Berlin dataset',
        inputSchema: GetDatasetDetailsSchema,
      },
      async (args) => this.handleGetDatasetDetails(args)
    );

    this.server.registerTool(
      'list_all_datasets',
      {
        description:
          'List all datasets in the portal with pagination support. Use this to browse the entire catalog.',
        inputSchema: ListAllDatasetsSchema,
      },
      async (args) => this.handleListAllDatasets(args)
    );

    this.server.registerTool(
      'fetch_dataset_data',
      {
        description:
          'VIEW dataset content in the chat for surface-level analysis. Returns a potentially truncated preview plus value distributions for all columns. Supports CSV, JSON, Excel (XLS/XLSX), GeoJSON, KML, and WFS formats. WFS data is automatically converted to tabular format. Does NOT support ZIP archives (provides direct download URL instead). Use when user wants to SEE data shape, not run full aggregations. For robust counts/totals/breakdowns, use `aggregate_dataset`.',
        inputSchema: FetchDatasetDataSchema,
      },
      async (args) => this.handleFetchDatasetData(args)
    );

    this.server.registerTool(
      'aggregate_dataset',
      {
        description:
          'Run server-side aggregations on a dataset without sending full rows to the model. Use this for totals, counts, grouped breakdowns, and filtered summaries (e.g. Einwohner sum by BEZIRK_NAME).',
        inputSchema: AggregateDatasetSchema,
      },
      async (args) => this.handleAggregateDataset(args)
    );

    this.server.registerTool(
      'download_dataset',
      {
        description:
          'Get a direct download URL for a dataset. Returns the direct URL to the data file (resolves redirects). Use when user wants to download or save data. Supports CSV, JSON, Excel (XLS/XLSX), GeoJSON, KML, WFS, and ZIP formats. Keywords: "herunterladen", "download", "speichern", "save", "auf meinem Computer", "als Datei".',
        inputSchema: DownloadDatasetSchema,
      },
      async (args) => this.handleDownloadDataset(args)
    );

    this.server.registerTool(
      'get_portal_stats',
      {
        description:
          'Get overview statistics about the Berlin Open Data Portal (total datasets, organizations, categories)',
        inputSchema: GetPortalStatsSchema,
      },
      async () => this.handleGetPortalStats()
    );

    this.server.registerTool(
      'list_geo_layers',
      {
        description:
          'Discover available WFS layers for a dataset. Returns layer names, titles, feature counts, and bounding boxes. Use after search_datasets to explore geodata in detail.',
        inputSchema: ListGeoLayersSchema,
      },
      async (args) => this.handleListGeoLayers(args)
    );

    this.server.registerTool(
      'fetch_geo_features',
      {
        description:
          'Fetch features from a WFS layer as GeoJSON. Returns properties, geometry types, and sample data. Supports CQL filters for property-based queries (e.g., "bezirk = \'Mitte\'").',
        inputSchema: FetchGeoFeaturesSchema,
      },
      async (args) => this.handleFetchGeoFeatures(args)
    );

    this.server.registerPrompt(
      'berlin_data_discovery',
      {
        description: 'Help discover relevant Berlin open datasets based on user needs',
        argsSchema: {
          topic: z.string().describe('The topic or domain you are interested in'),
          use_case: z.string().optional().describe('What you plan to do with the data'),
        },
      },
      async ({ topic, use_case }) => {
        const promptText =
          `I need to find Berlin open datasets related to "${topic}"` +
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
    );
  }

  private async handleSearchBerlinDatasets(params: z.infer<typeof SearchDatasetsSchema>): Promise<CallToolResult> {
    try {
      const { query, limit, sort } = params;

      const builtQuery = this.queryProcessor.buildQuery(query);
      const result = await this.api.searchDatasets({ query: builtQuery, limit, sort });

      let responseText = `# Search Results for "${query}"\n\n`;

      if (result.results.length === 0) {
        responseText += 'No datasets found. Try:\n';
        responseText += '- Using different keywords\n';
        responseText += "- Searching in German (e.g., 'Verkehr' instead of 'traffic')\n";
        responseText += '- Using `get_facets` to discover which tags/organizations are relevant\n';
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
            const description =
              dataset.notes.length > 200 ? dataset.notes.substring(0, 200) + '…' : dataset.notes;
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

        if (result.facets?.organization?.length) {
          responseText += `\n**Organizations with matching datasets** (use the slug as \`organization\` value):\n`;
          result.facets.organization.slice(0, 6).forEach((f: any) => {
            let note = '';
            if (f.name.includes('harvester') || f.name.includes('simplesearch'))
              note = ' ⚠️ re-harvests geodata daily — dominates date-sorted results';
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
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleSearchFiltered(params: z.infer<typeof SearchFilteredSchema>): Promise<CallToolResult> {
    try {
      const { query, organization, tag, format, modified_since, sort, rows } = params;

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
            if (f.name.includes('harvester') || f.name.includes('simplesearch'))
              note = ' ⚠️ re-harvests geodata daily — dominates date-sorted results';
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
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleGetFacets(params: z.infer<typeof GetFacetsSchema>): Promise<CallToolResult> {
    try {
      const { query, limit } = params;

      // Same query preparation as the search tools (synonyms, WAF-safe terms)
      const processedQuery = query !== '*' ? this.queryProcessor.buildQuery(query) : query;
      const facets = await this.api.getFacets(processedQuery, ['tags', 'organization', 'res_format', 'groups'], limit);

      let responseText = `# Facets for "${query}"\n\n`;
      responseText += `Use these values with \`search_datasets_filtered\` to narrow your search.\n\n`;

      if (facets.organization?.length) {
        responseText += `## Organizations\n`;
        facets.organization.forEach((f) => {
          responseText += `- \`${f.name}\` — ${f.display_name} (${f.count} datasets)\n`;
        });
        responseText += '\n';
      }

      if (facets.tags?.length) {
        responseText += `## Tags\n`;
        facets.tags.forEach((f) => {
          responseText += `- \`${f.name}\` (${f.count} datasets)\n`;
        });
        responseText += '\n';
      }

      if (facets.res_format?.length) {
        responseText += `## Formats\n`;
        facets.res_format.forEach((f) => {
          responseText += `- \`${f.name}\` (${f.count} datasets)\n`;
        });
        responseText += '\n';
      }

      if (facets.groups?.length) {
        responseText += `## Groups\n`;
        facets.groups.forEach((f) => {
          responseText += `- \`${f.name}\` — ${f.display_name} (${f.count} datasets)\n`;
        });
        responseText += '\n';
      }

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleListTags(params: z.infer<typeof ListTagsSchema>): Promise<CallToolResult> {
    try {
      const { query, limit } = params;

      const tags = await this.api.listTags(limit, query);

      let responseText = query ? `# Tags matching "${query}"\n\n` : `# Available Tags (first ${limit})\n\n`;

      if (tags.length === 0) {
        responseText += 'No tags found.\n';
      } else {
        responseText += tags.map((t) => `- \`${t.name}\``).join('\n');
        responseText += `\n\n${tags.length} tag(s) returned. Use these values in \`search_datasets_filtered\` as the \`tag\` parameter.\n`;
      }

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleGetDatasetDetails(params: z.infer<typeof GetDatasetDetailsSchema>): Promise<CallToolResult> {
    try {
      const { dataset_id } = params;
      const dataset = await this.api.getDataset(dataset_id);

      let details = `# ${dataset.title}\n\n`;

      details += `## Overview\n`;
      details += `**ID**: ${dataset.name}\n`;
      details += `**Portal URL**: https://daten.berlin.de/datensaetze/${dataset.name}\n`;
      details += `**Organization**: ${dataset.organization?.title || 'Unknown'}\n`;

      if (dataset.metadata_modified) {
        const lastUpdate = new Date(dataset.metadata_modified).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        details += `**Last Updated**: ${lastUpdate}\n`;
      }

      details += `\n## Description\n`;
      details += dataset.notes ? dataset.notes : 'No description available.';

      if (dataset.tags && dataset.tags.length > 0) {
        details += `\n\n## Categories & Tags\n`;
        details += dataset.tags.map((t) => `\`${t.name}\``).join(', ');
      }

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

      return { content: [{ type: 'text', text: details }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleListAllDatasets(params: z.infer<typeof ListAllDatasetsSchema>): Promise<CallToolResult> {
    try {
      const { offset, limit } = params;
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

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleFetchDatasetData(params: z.infer<typeof FetchDatasetDataSchema>): Promise<CallToolResult> {
    try {
      const { dataset_id, resource_id, full_data } = params;
      const LARGE_DATASET_THRESHOLD = 1000;

      const dataset = await this.api.getDataset(dataset_id);

      if (!dataset.resources || dataset.resources.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ No resources available for dataset "${dataset_id}". This dataset may not have downloadable files.`,
            },
          ],
        };
      }

      let resource;
      if (resource_id) {
        resource = dataset.resources.find((r) => r.id === resource_id);
        if (!resource) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Resource "${resource_id}" not found. Use \`get_dataset_details\` to see available resources and their IDs.`,
              },
            ],
          };
        }
      } else {
        const dataFormats = ['CSV', 'JSON', 'XLSX', 'XLS', 'XML', 'WMS', 'WFS'];
        resource =
          dataset.resources.find((r) => dataFormats.includes(r.format?.toUpperCase())) || dataset.resources[0];
      }

      const formatUpper = resource.format?.toUpperCase() || '';
      if (formatUpper === 'ZIP' || formatUpper.startsWith('ZIP:') || formatUpper.includes(':ZIP')) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Cannot preview ZIP files. ZIP archives must be downloaded directly.\n\n**Direct download URL**: ${resource.url}\n\nZIP files contain compressed data that needs to be extracted first. Download the file and extract it to access the data inside.`,
            },
          ],
        };
      }

      let fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: false });

      if (fetchedData.error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error fetching data: ${fetchedData.error}\n\nYou can try:\n- Using a different resource\n- Downloading manually from: ${resource.url}`,
            },
          ],
        };
      }

      const totalRows = fetchedData.totalRows;
      const isSampled = fetchedData.rows.length < totalRows;
      const isLarge = totalRows > LARGE_DATASET_THRESHOLD;
      const sizeLabel = isLarge ? 'large' : 'small';

      let responseText = `# Data from: ${dataset.title}\n\n`;
      responseText += `**Resource**: ${resource.name} (${resource.format})\n\n`;

      if (full_data && isLarge) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Dataset has ${totalRows} rows and is too large for direct analysis. Returning all data would risk context overflow.\n\n📥 **Download manually**: ${resource.url}\n\nOnce downloaded, attach the file to Claude Desktop for analysis.`,
            },
          ],
        };
      }

      if (full_data && isSampled) {
        fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: true });
        if (fetchedData.error) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Error fetching full data: ${fetchedData.error}\n\nYou can try downloading manually from: ${resource.url}`,
              },
            ],
          };
        }
      }

      if (!isLarge) {
        const lorInfo = this.lorLookup.hasLORColumns(fetchedData.columns);
        let enrichedRows = fetchedData.rows;

        if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID || lorInfo.hasLOR)) {
          enrichedRows = fetchedData.rows.map((row) => this.lorLookup.enrichRow(row));
        }

        const GEOMETRY_COLS = new Set(['geometry_coordinates', 'geometry_type', 'geometry']);
        const displayColumns = enrichedRows.length > 0 ? Object.keys(enrichedRows[0]) : fetchedData.columns;
        const sampledNote =
          isSampled && !full_data
            ? ` *(showing ${enrichedRows.length} of ${totalRows} — use \`full_data: true\` to fetch all)*`
            : '';
        responseText += `**Rows**: ${totalRows}${sampledNote} | **Columns (${displayColumns.length}):** ${displayColumns.join(', ')}\n\n`;

        if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID || lorInfo.hasLOR)) {
          responseText += `**📍 LOR Enrichment:** Automatically enriched with Berlin administrative district names.\n`;
          if (lorInfo.hasBEZ || lorInfo.hasLOR)
            responseText += `- \`BEZIRK_NAME\`: Full bezirk name (e.g., "Marzahn-Hellersdorf")\n`;
          if (lorInfo.hasRAUMID)
            responseText += `- \`PLANUNGSRAUM_NAME\`, \`BEZIRKSREGION_NAME\`, \`PROGNOSERAUM_NAME\`: Planning area names\n`;
          responseText += `\n`;
        }

        const preview = enrichedRows.slice(0, 3);
        responseText += `## Preview (first 3 rows)\n\n`;
        responseText += `\`\`\`json\n${JSON.stringify(preview, null, 2)}\n\`\`\`\n\n`;

        const attributeRows = enrichedRows.map((row) => {
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
              if (Object.keys(counts).length > 50) {
                uniqueOverflow = true;
                break;
              }
            }
            if (!uniqueOverflow) distributions[col] = counts;
          }
          if (Object.keys(distributions).length > 0) {
            responseText += `## Column value distributions\n\n`;
            responseText += `\`\`\`json\n${JSON.stringify(distributions, null, 2)}\n\`\`\`\n\n`;
          }
        }

        responseText += `## Full data access\n\n`;
        responseText += `For complete row-level data, use \`download_dataset\` to get a direct download link (or fetch this resource directly): ${resource.url}\n\n`;

        return { content: [{ type: 'text', text: responseText }] };
      }

      const sample = this.dataSampler.generateSample(fetchedData.rows, fetchedData.columns);

      responseText += `Dataset has ${totalRows} rows. This is a **${sizeLabel} dataset** (${totalRows.toLocaleString()} rows).

## USE \`aggregate_dataset\` FOR ANALYSIS

This dataset is too large to load all rows directly into context.

**CRITICAL INSTRUCTIONS:**
- **DO NOT** ask the user to download or upload CSV files.
- **DO NOT** attempt to analyze full totals based only on the preview sample below.
- **USE \`aggregate_dataset\`** to perform server-side counts, totals, or grouped breakdowns (e.g. \`group_by: ["BEZIRK_NAME"]\` or other columns listed below).
- If the user explicitly wants to download the file, use \`download_dataset\` to get a direct download link.

---

## Data Preview & Structure

**Columns (${fetchedData.columns.length}):** ${fetchedData.columns.join(', ')}

**Sample Data (first ${sample.sampleRows.length} rows for column reference only):**
\`\`\`json
${JSON.stringify(sample.sampleRows, null, 2)}
\`\`\`

`;

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleAggregateDataset(params: z.infer<typeof AggregateDatasetSchema>): Promise<CallToolResult> {
    try {
      const {
        dataset_id,
        resource_id,
        group_by = [],
        metrics,
        filters = [],
        sort = [],
        limit = 1000,
      } = params;

      const dataset = await this.api.getDataset(dataset_id);
      if (!dataset.resources || dataset.resources.length === 0) {
        return {
          content: [{ type: 'text', text: `❌ No resources available for dataset "${dataset_id}".` }],
        };
      }

      let resource;
      if (resource_id) {
        resource = dataset.resources.find((r) => r.id === resource_id);
        if (!resource) {
          return {
            content: [{ type: 'text', text: `❌ Resource "${resource_id}" not found.` }],
          };
        }
      } else {
        const dataFormats = ['CSV', 'JSON', 'XLSX', 'XLS', 'XML', 'WMS', 'WFS'];
        resource =
          dataset.resources.find((r) => dataFormats.includes(r.format?.toUpperCase())) || dataset.resources[0];
      }

      const formatUpper = resource.format?.toUpperCase() || '';
      if (formatUpper === 'ZIP' || formatUpper.startsWith('ZIP:') || formatUpper.includes(':ZIP')) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Cannot aggregate ZIP resources directly. Download and extract first: ${resource.url}`,
            },
          ],
        };
      }

      const fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: true });
      if (fetchedData.error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error fetching data for aggregation: ${fetchedData.error}\n\nTry a different resource or download manually: ${resource.url}`,
            },
          ],
        };
      }

      const GEOMETRY_COLS = new Set(['geometry_coordinates', 'geometry_type', 'geometry']);
      const lorInfo = this.lorLookup.hasLORColumns(fetchedData.columns);
      let rows = fetchedData.rows;
      if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID || lorInfo.hasLOR)) {
        rows = rows.map((row) => this.lorLookup.enrichRow(row));
      }

      rows = rows.map((row) => {
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
          case 'eq':
            return rawStr === filterStr;
          case 'neq':
            return rawStr !== filterStr;
          case 'contains':
            return rawStr.toLowerCase().includes(filterStr.toLowerCase());
          case 'in': {
            const values = Array.isArray(filter.value) ? filter.value.map((v: any) => String(v)) : [filterStr];
            return values.includes(rawStr);
          }
          case 'gt':
            return rawNum !== null && filterNum !== null ? rawNum > filterNum : rawStr > filterStr;
          case 'gte':
            return rawNum !== null && filterNum !== null ? rawNum >= filterNum : rawStr >= filterStr;
          case 'lt':
            return rawNum !== null && filterNum !== null ? rawNum < filterNum : rawStr < filterStr;
          case 'lte':
            return rawNum !== null && filterNum !== null ? rawNum <= filterNum : rawStr <= filterStr;
          default:
            return false;
        }
      };

      const filteredRows = rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
      const groupCols = group_by ?? [];
      const groupMap = new Map<string, any>();
      const metricName = (m: { op: string; column?: string; as?: string }) =>
        m.as || `${m.op}_${m.column || 'rows'}`;

      const ensureGroup = (row: Record<string, any>) => {
        const groupKey =
          groupCols.length > 0 ? JSON.stringify(groupCols.map((col) => row[col] ?? null)) : '__all__';

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
      responseText += `**Metrics:** ${metrics.map((m) => `${metricName(m)}=${m.op}${m.column ? `(${m.column})` : ''}`).join(', ')}\n`;
      if (filters.length > 0) {
        responseText += `**Filters:** ${filters.map((f) => `${f.column} ${f.op} ${Array.isArray(f.value) ? `[${f.value.join(', ')}]` : f.value}`).join(' AND ')}\n`;
      }
      responseText += `\n## Result rows\n\n`;
      responseText += `\`\`\`json\n${JSON.stringify(limitedRows, null, 2)}\n\`\`\`\n`;

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleDownloadDataset(params: z.infer<typeof DownloadDatasetSchema>): Promise<CallToolResult> {
    try {
      const { dataset_id, resource_id } = params;

      const dataset = await this.api.getDataset(dataset_id);

      if (!dataset.resources || dataset.resources.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ No resources available for dataset "${dataset_id}". This dataset may not have downloadable files.`,
            },
          ],
        };
      }

      let resource;
      if (resource_id) {
        resource = dataset.resources.find((r) => r.id === resource_id);
        if (!resource) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Resource "${resource_id}" not found. Use \`get_dataset_details\` to see available resources and their IDs.`,
              },
            ],
          };
        }
      } else {
        const dataFormats = ['CSV', 'JSON', 'XLSX', 'XLS', 'XML', 'WMS', 'WFS'];
        resource =
          dataset.resources.find((r) => dataFormats.includes(r.format?.toUpperCase())) || dataset.resources[0];
      }

      let directUrl = resource.url;
      try {
        const response = await fetch(resource.url, { redirect: 'follow' });
        directUrl = response.url;
      } catch {
        // Fall back to original URL if fetch fails
      }

      return {
        content: [
          {
            type: 'text',
            text: `📥 **Download Link**\n\n${directUrl}\n\nClick the link above to download the dataset.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  private async handleGetPortalStats(): Promise<CallToolResult> {
    try {
      const stats = await this.api.getPortalStats();

      let responseText = '# Berlin Open Data Portal Statistics\n\n';
      responseText += `📊 **Total Datasets**: ${stats.total_datasets}\n`;
      responseText += `🏛️ **Organizations**: ${stats.total_organizations}\n`;
      responseText += `🏷️ **Categories/Tags**: ${stats.total_tags}\n`;

      responseText += '\n💡 **Next steps**:\n';
      responseText += '- Use `list_all_datasets` to browse all datasets\n';
      responseText += '- Use `search_berlin_datasets` to find specific topics\n';

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  /**
   * Errors from allowlisted WFS services (HTTP status, OGC exception) are passed on to the client.
   * Anything else (e.g. network errors) only goes to the server log, the client gets a generic message.
   */
  private wfsErrorResult(toolName: string, error: unknown): CallToolResult {
    console.error(`[${toolName}] WFS request failed:`, error);
    if (isClientSafeWFSError(error)) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
    return {
      content: [
        {
          type: 'text',
          text: 'Error: The WFS request failed. Check that wfs_url and typename are correct (use `list_geo_layers` to look them up) and try again.',
        },
      ],
      isError: true,
    };
  }

  private async handleListGeoLayers(params: z.infer<typeof ListGeoLayersSchema>): Promise<CallToolResult> {
    try {
      const { dataset_id } = params;

      const dataset = await this.api.getDataset(dataset_id);
      const wfsResource = dataset.resources?.find((r) => r.format?.toUpperCase() === 'WFS');

      if (!wfsResource || !wfsResource.url) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ No WFS resource found for dataset "${dataset_id}". Use \`get_dataset_details\` to see available resources.`,
            },
          ],
        };
      }

      const { baseUrl, preservedParams } = this.wfsClient.parseWFSUrl(wfsResource.url);
      const capabilities = await this.wfsClient.getCapabilities(baseUrl, preservedParams);

      // Keep non-WFS params (like energieatlas' nodeId), fetch_geo_features needs them
      const query = preservedParams.toString();
      const wfsUrl = query ? `${baseUrl}?${query}` : baseUrl;

      let responseText = `# Available Geo Layers for: ${dataset.title}\n\n`;
      responseText += `**WFS URL**: ${wfsUrl}\n\n`;

      for (const ft of capabilities.featureTypes) {
        responseText += `### ${ft.title}\n`;
        responseText += `- **Layer Name (typename)**: \`${ft.name}\`\n`;
        if (ft.abstract) {
          responseText += `- **Abstract**: ${ft.abstract}\n`;
        }

        const count = await this.wfsClient.getFeatureCount(baseUrl, ft.name, preservedParams);
        responseText += `- **Feature Count**: ${count.toLocaleString()}\n\n`;
      }

      responseText += `\n**Next steps**: Use \`fetch_geo_features\` with the \`wfs_url\` and \`typename\` above to fetch data.`;

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return this.wfsErrorResult('list_geo_layers', error);
    }
  }

  private async handleFetchGeoFeatures(params: z.infer<typeof FetchGeoFeaturesSchema>): Promise<CallToolResult> {
    try {
      const { wfs_url, typename, limit, property_filter } = params;

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

      responseText += `\n**Note**: For larger datasets or full analysis, use \`download_dataset\` to get a direct download link.`;

      return { content: [{ type: 'text', text: responseText }] };
    } catch (error) {
      return this.wfsErrorResult('fetch_geo_features', error);
    }
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
