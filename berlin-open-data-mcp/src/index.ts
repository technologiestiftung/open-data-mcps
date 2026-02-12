#!/usr/bin/env node
// ABOUTME: MCP server implementation for Berlin Open Data Portal
// ABOUTME: Handles tool registration and request routing for dataset discovery and data fetching

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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
import { CodeExecutor } from './code-executor.js';

// Global cache for datasets - works across sessions (Claude.ai doesn't maintain sessions)
// This is safe because Berlin Open Data is public data
interface CachedDataset {
  data: any[];
  timestamp: number;
}
const globalDatasetCache = new Map<string, CachedDataset>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getFromGlobalCache(datasetId: string): any[] | undefined {
  const cached = globalDatasetCache.get(datasetId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached) {
    globalDatasetCache.delete(datasetId); // Expired
  }
  return undefined;
}

function setInGlobalCache(datasetId: string, data: any[]): void {
  globalDatasetCache.set(datasetId, { data, timestamp: Date.now() });
}

export interface BerlinOpenDataMCPServerOptions {
  sessionCache?: Map<string, any[]>;
}

export class BerlinOpenDataMCPServer {
  private server: Server;
  private api: BerlinOpenDataAPI;
  private queryProcessor: QueryProcessor;
  private dataFetcher: DataFetcher;
  private dataSampler: DataSampler;
  private geoJSONTransformer: GeoJSONTransformer;
  private lorLookup: LORLookupService;
  private codeExecutor: CodeExecutor;
  private sessionCache: Map<string, any[]>;

  constructor(options: BerlinOpenDataMCPServerOptions = {}) {
    this.sessionCache = options.sessionCache || new Map();
    this.codeExecutor = new CodeExecutor();
    this.server = new Server(
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
    this.dataFetcher = new DataFetcher({ useBrowserAutomation: true });
    this.dataSampler = new DataSampler();
    this.geoJSONTransformer = new GeoJSONTransformer();
    this.lorLookup = new LORLookupService();

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'search_berlin_datasets',
          description: 'Search Berlin open datasets using natural language queries. Perfect for discovering data about transportation, environment, demographics, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language search query in German or English (e.g., "bicycle infrastructure", "Luftqualität", "public transport data")',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 20)',
                default: 20,
              },
            },
            required: ['query'],
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
          description: 'VIEW dataset content in the chat for analysis. Returns a preview (10 sample rows) or full data for small datasets. Supports CSV, JSON, Excel (XLS/XLSX), GeoJSON, KML, and WFS formats. WFS data is automatically converted to tabular format. Does NOT support ZIP archives (provides direct download URL instead). Use when user wants to SEE/ANALYZE data, not download it. Keywords: "zeig mir", "schau dir an", "wie sieht aus", "analysiere".',
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
                description: 'If true, return all data for small datasets (≤500 rows). Refused for large datasets.',
                default: false,
              },
            },
            required: ['dataset_id'],
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
          name: 'execute_code',
          description: 'REQUIRED for data analysis. After fetch_dataset_data caches data, use this tool to perform calculations, aggregations, filtering, or transformations. Do NOT try to download files directly or write local scripts - use this tool instead. The full dataset is available as the `data` variable.',
          inputSchema: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description: 'JavaScript code to execute. The dataset is available as `data` (array of row objects). Return the result as the last expression. Example: `data.reduce((acc, r) => { acc[r.BEZIRK_NAME] = (acc[r.BEZIRK_NAME] || 0) + parseInt(r.E_E); return acc; }, {})`',
              },
              dataset_id: {
                type: 'string',
                description: 'Dataset ID to use. If not provided, uses the most recently fetched dataset.',
              },
            },
            required: ['code'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_berlin_datasets': {
            const { query, limit = 20 } = args as { query: string; limit?: number };

            // Four-Tier Search Strategy for Optimal Relevance
            // =================================================
            //
            // TIER 1 - Expansion Search (Broad Coverage):
            //   Expands query terms using portal metadata mappings
            //   Example: "Einwohner" → ["Einwohnerinnen", "Kleinräumige einwohnerzahl", ...]
            //   Purpose: Find all potentially relevant datasets (high recall)
            //
            // TIER 2 - Smart Fallback Detection:
            //   Checks if top 5 expansion results contain ALL user's key terms
            //   Purpose: Detect when expansion search found exact matches
            //
            // TIER 3 - Literal Search + Year Boosting (Precision):
            //   If no exact match in top 5, runs literal CKAN search
            //   Applies position-based scoring (1st=1000, 2nd=999, etc.)
            //   Adds +1000 bonus for datasets containing query year
            //   Purpose: Ensure specific queries return exact matches first
            //   Example: "Einwohner 2024" → 2024 dataset ranked #1 (not 2020/2019)
            //
            // TIER 4 - Recency Boost (Temporal Relevance):
            //   Extracts years from all dataset titles and boosts recent datasets
            //   Current year: +50, Last year: +40, 2 years ago: +30, etc.
            //   Purpose: Prefer recent data when no year specified in query
            //   Example: "Bevölkerung" → 2024 datasets ranked above 2019
            //
            // Result: Best of all worlds - broad coverage + precise ranking + temporal relevance

            // STEP 1: Expansion Search
            const searchTerms = this.queryProcessor.extractSearchTerms(query);

            // Search for each term separately and combine results
            // Use higher limit per term to ensure we capture all relevant datasets
            // Example: "Einwohnerinnen" finds 2024 LOR dataset at position 41
            const searchPromises = searchTerms.map(term =>
              this.api.searchDatasets({ query: term, limit: 100 })
            );

            const allResults = await Promise.all(searchPromises);

            // Merge and deduplicate results by dataset ID
            const datasetMap = new Map<string, { dataset: any; matchCount: number; isLiteral: boolean }>();

            allResults.forEach(result => {
              result.results.forEach(dataset => {
                if (datasetMap.has(dataset.id)) {
                  // Dataset already found - increment match count
                  datasetMap.get(dataset.id)!.matchCount++;
                } else {
                  // New dataset - add it
                  datasetMap.set(dataset.id, { dataset, matchCount: 1, isLiteral: false });
                }
              });
            });

            // STEP 2: Smart Fallback - Check if expansion search found exact matches
            // Extract key terms from original query (including years and significant words)
            const cleanedQuery = query.replace(/\b(find|search|show|me|list|all|datasets?|about|in|for|the|and)\b/gi, '').trim();
            const keyTerms = cleanedQuery.split(/\s+/).filter(term =>
              term.length >= 3 || /^\d{4}$/.test(term) // Include 4-digit years
            );

            // Get top 5 results from expansion search to check quality
            const topExpansionResults = Array.from(datasetMap.values())
              .sort((a, b) => b.matchCount - a.matchCount)
              .slice(0, 5)
              .map(item => item.dataset);

            // Check if any top result contains ALL user's key terms (exact match)
            const hasExactMatch = topExpansionResults.some(dataset => {
              const searchableText = `${dataset.title} ${dataset.name} ${dataset.notes || ''}`.toLowerCase();
              return keyTerms.every(term => searchableText.includes(term.toLowerCase()));
            });

            // STEP 3: Literal Search Fallback (if expansion didn't find exact match)
            // This ensures specific queries like "Einwohner 2024" return the 2024 dataset first,
            // even if expansion search ranked older datasets higher due to more term matches
            if (!hasExactMatch && cleanedQuery.length > 0) {
              const literalResult = await this.api.searchDatasets({ query: cleanedQuery, limit: limit });

              // Detect if query contains a year for temporal relevance boosting
              const yearMatch = cleanedQuery.match(/\b(\d{4})\b/);
              const queryYear = yearMatch ? yearMatch[1] : null;

              // Apply position-based scoring to literal results
              // CKAN returns most relevant first, so we trust its ranking
              literalResult.results.forEach((dataset, index) => {
                // Base score: Position-based (1000, 999, 998, ...)
                let positionBoost = 1000 - index;

                // Temporal relevance boost: Add +1000 if dataset contains query year
                // Example: "Einwohner 2024" → datasets with "2024" get massive boost
                if (queryYear) {
                  const datasetText = `${dataset.title} ${dataset.name}`.toLowerCase();
                  if (datasetText.includes(queryYear)) {
                    positionBoost += 1000;
                  }
                }

                if (datasetMap.has(dataset.id)) {
                  // Dataset already found by expansion - override score with literal match score
                  const item = datasetMap.get(dataset.id)!;
                  item.isLiteral = true;
                  item.matchCount = positionBoost;
                } else {
                  // New dataset from literal search - add with high priority
                  datasetMap.set(dataset.id, { dataset, matchCount: positionBoost, isLiteral: true });
                }
              });
            }

            // STEP 4: Apply recency boost to all results
            // Extract years from dataset titles and boost recent years
            const currentYear = new Date().getFullYear();

            for (const item of datasetMap.values()) {
              const dataset = item.dataset;
              const titleText = `${dataset.title} ${dataset.name}`;

              // Extract all 4-digit years from title (2000-2099)
              const years = titleText.match(/\b(20\d{2})\b/g);

              if (years && years.length > 0) {
                // Get the most recent year mentioned
                const mostRecentYear = Math.max(...years.map(y => parseInt(y)));

                // Calculate recency score based on age
                const yearsDiff = currentYear - mostRecentYear;

                if (yearsDiff === 0) {
                  item.matchCount += 50;
                } else if (yearsDiff === 1) {
                  item.matchCount += 40;
                } else if (yearsDiff === 2) {
                  item.matchCount += 30;
                } else if (yearsDiff <= 5) {
                  item.matchCount += 20;
                } else if (yearsDiff <= 10) {
                  item.matchCount += 10;
                }
                // Older datasets get no boost
              }
            }

            // Sort by match count (literal matches + recency boosted to top)
            const combinedResults = Array.from(datasetMap.values())
              .sort((a, b) => b.matchCount - a.matchCount)
              .slice(0, limit)
              .map(item => item.dataset);

            const totalUnique = datasetMap.size;

            // Create a conversational, structured response
            let responseText = `# Search Results for "${query}"\n\n`;

            if (combinedResults.length === 0) {
              responseText += "I couldn't find any datasets matching your query. Try:\n";
              responseText += "- Using different keywords\n";
              responseText += "- Searching in German (e.g., 'Verkehr' instead of 'traffic')\n";
            } else {
              responseText += `Found ${totalUnique} relevant dataset(s)`;
              if (searchTerms.length > 1) {
                responseText += ` (searched: ${searchTerms.join(', ')})`;
              }
              if (totalUnique > combinedResults.length) {
                responseText += ` (showing top ${combinedResults.length})`;
              }
              responseText += `:\n\n`;

              combinedResults.forEach((dataset, index) => {
                responseText += `## ${index + 1}. ${dataset.title}\n`;
                responseText += `**ID**: ${dataset.name}\n`;
                responseText += `**URL**: https://daten.berlin.de/datensaetze/${dataset.name}\n`;
                responseText += `**Organization**: ${dataset.organization?.title || 'Unknown'}\n`;

                if (dataset.notes && dataset.notes.length > 0) {
                  const description = dataset.notes.length > 200
                    ? dataset.notes.substring(0, 200) + '...'
                    : dataset.notes;
                  responseText += `**Description**: ${description}\n`;
                }

                if (dataset.resources && dataset.resources.length > 0) {
                  responseText += `**Resources**: ${dataset.resources.length} files available`;
                  const formats = [...new Set(dataset.resources.map((r: any) => r.format).filter(Boolean))];
                  if (formats.length > 0) {
                    responseText += ` (${formats.join(', ')})`;
                  }
                  responseText += '\n';
                }

                if (dataset.tags && dataset.tags.length > 0) {
                  responseText += `**Tags**: ${dataset.tags.slice(0, 5).map((t: any) => t.name).join(', ')}`;
                  if (dataset.tags.length > 5) {
                    responseText += ` +${dataset.tags.length - 5} more`;
                  }
                  responseText += '\n';
                }

                responseText += '\n';
              });

              responseText += `\n💡 **Next steps**:\n`;
              responseText += `- Use \`get_dataset_details\` with any dataset ID to get full details\n`;
            }

            return {
              content: [
                {
                  type: 'text',
                  text: responseText,
                },
              ],
            };
          }

          case 'get_dataset_details': {
            const { dataset_id } = args as { dataset_id: string };
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
            const { offset = 0, limit = 100 } = args as { offset?: number; limit?: number };
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
            const { dataset_id, resource_id, full_data = false } = args as {
              dataset_id: string;
              resource_id?: string;
              full_data?: boolean;
            };

            if (!dataset_id) {
              return {
                content: [{
                  type: 'text',
                  text: '❌ Missing required parameter: dataset_id. Use `search_berlin_datasets` to find dataset IDs.',
                }],
              };
            }

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

            // Fetch the data (sample for analysis, not full dataset)
            const fetchedData = await this.dataFetcher.fetchResource(resource.url, resource.format, { fullData: false });

            if (fetchedData.error) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Error fetching data: ${fetchedData.error}\n\nYou can try:\n- Using a different resource\n- Downloading manually from: ${resource.url}`,
                }],
              };
            }

            const totalRows = fetchedData.rows.length;
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

            // For small datasets, return preview and instruct to use execute_code
            // The backend caches full data for execute_code to use
            if (!isLarge) {
              // Enrich data with LOR names if applicable
              const lorInfo = this.lorLookup.hasLORColumns(fetchedData.columns);
              let enrichedRows = fetchedData.rows;

              if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID)) {
                enrichedRows = fetchedData.rows.map(row => this.lorLookup.enrichRow(row));
                console.log('[fetch_dataset_data] Enriched dataset with LOR names');
              }

              // Cache the full data for execute_code (both session and global)
              this.sessionCache.set(dataset_id, enrichedRows);
              setInGlobalCache(dataset_id, enrichedRows);
              console.log(`[fetch_dataset_data] Cached ${enrichedRows.length} rows for dataset ${dataset_id}`);

              responseText += `Dataset has ${totalRows} rows. This is a **${sizeLabel} dataset**.\n\n`;

              // Show enriched columns
              const displayColumns = enrichedRows.length > 0 ? Object.keys(enrichedRows[0]) : fetchedData.columns;
              responseText += `**Columns (${displayColumns.length}):** ${displayColumns.join(', ')}\n\n`;

              // Add LOR enrichment note if applicable
              if (this.lorLookup.isLoaded() && (lorInfo.hasBEZ || lorInfo.hasRAUMID)) {
                responseText += `**📍 LOR Enrichment:** This dataset has been automatically enriched with Berlin administrative district names.\n`;
                if (lorInfo.hasBEZ) {
                  responseText += `- \`BEZIRK_NAME\`: Full bezirk name (e.g., "Marzahn-Hellersdorf")\n`;
                }
                if (lorInfo.hasRAUMID) {
                  responseText += `- \`PLANUNGSRAUM_NAME\`, \`BEZIRKSREGION_NAME\`, \`PROGNOSERAUM_NAME\`: Planning area names\n`;
                }
                responseText += `\n`;
              }

              // Return first 3 rows as preview
              const preview = enrichedRows.slice(0, 3);
              responseText += `## Preview (first 3 rows)\n\n`;
              responseText += `\`\`\`json\n${JSON.stringify(preview, null, 2)}\n\`\`\`\n\n`;

              responseText += `## Data Analysis Available\n\n`;
              responseText += `**IMPORTANT:** The full dataset (${totalRows} rows) is cached and ready for analysis.\n\n`;
              responseText += `**To analyze this data, you MUST use the \`execute_code\` tool.**\n`;
              responseText += `Do NOT download the file or write local scripts - use execute_code instead.\n\n`;

              responseText += `**Example - Sum population per bezirk:**\n`;
              if (lorInfo.hasBEZ) {
                responseText += `\`\`\`javascript\ndata.reduce((acc, row) => {\n  acc[row.BEZIRK_NAME] = (acc[row.BEZIRK_NAME] || 0) + parseInt(row.E_E);\n  return acc;\n}, {})\n\`\`\`\n`;
              } else {
                const firstCol = displayColumns[0];
                responseText += `\`\`\`javascript\ndata.reduce((acc, row) => {\n  acc[row["${firstCol}"]] = (acc[row["${firstCol}"]] || 0) + 1;\n  return acc;\n}, {})\n\`\`\`\n`;
              }

              // Add full data as second JSON block for interface-prototype to cache
              // This block is stripped by the interface before sending to Claude
              responseText += `\n\`\`\`json\n${JSON.stringify(enrichedRows)}\n\`\`\`\n`;

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

          case 'download_dataset': {
            const { dataset_id, resource_id, format: requestedFormat } = args as {
              dataset_id: string;
              resource_id?: string;
              format?: 'csv' | 'json' | 'geojson';
            };

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

          case 'execute_code': {
            const { code, dataset_id } = args as { code: string; dataset_id?: string };

            // Find cached data - check session cache first, then global cache
            // (Claude.ai doesn't maintain sessions between tool calls, so we need global fallback)
            let data: any[] | undefined;
            let usedDatasetId: string | undefined;

            if (dataset_id) {
              // Try session cache first, then global cache
              data = this.sessionCache.get(dataset_id) || getFromGlobalCache(dataset_id);
              usedDatasetId = dataset_id;
              if (!data) {
                return {
                  content: [{
                    type: 'text',
                    text: `❌ No cached data found for dataset "${dataset_id}". Use \`fetch_dataset_data\` first to load the dataset.`,
                  }],
                };
              }
            } else {
              // Use most recently cached dataset - check session first, then global
              let keys = Array.from(this.sessionCache.keys());
              if (keys.length === 0) {
                // Fall back to global cache
                keys = Array.from(globalDatasetCache.keys());
              }
              if (keys.length === 0) {
                return {
                  content: [{
                    type: 'text',
                    text: `❌ No dataset cached. Use \`fetch_dataset_data\` first to load a dataset before running code.`,
                  }],
                };
              }
              usedDatasetId = keys[keys.length - 1];
              data = this.sessionCache.get(usedDatasetId) || getFromGlobalCache(usedDatasetId);
            }

            if (!data || data.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Cached dataset "${usedDatasetId}" is empty.`,
                }],
              };
            }

            // Execute code with data in context
            const result = await this.codeExecutor.execute(code, { data });

            if (!result.success) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Code execution error: ${result.error}\n\n**Code:**\n\`\`\`javascript\n${code}\n\`\`\``,
                }],
              };
            }

            let responseText = `## Code Execution Result\n\n`;
            responseText += `**Dataset:** ${usedDatasetId} (${data.length} rows)\n`;
            responseText += `**Execution time:** ${result.executionTime}ms\n\n`;
            responseText += `**Result:**\n\`\`\`json\n${JSON.stringify(result.output, null, 2)}\n\`\`\`\n`;

            return {
              content: [{ type: 'text', text: responseText }],
            };
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

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
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

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
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