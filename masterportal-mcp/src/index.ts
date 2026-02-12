#!/usr/bin/env node
// ABOUTME: MCP server for generating Masterportal geodata portals
// ABOUTME: Exposes create_portal tool for single-call portal generation

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { PortalSession, Layer, MapConfig } from './types.js';
import { DataFetcher } from './data-fetcher.js';
import { ZipBuilder } from './zip-builder.js';
import { CreatePortalParams } from './types.js';

dotenv.config();

// Tool definition
const LIST_WFS_LAYERS_TOOL: Tool = {
  name: 'list_wfs_layers',
  description: 'List available feature types (layers) from a WFS service. Use this to discover what layers are available before adding them to a portal. If a WFS has multiple feature types, ask the user which one(s) to include.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'WFS service URL (e.g., https://gdi.berlin.de/services/wfs/gruene_wege)',
      },
    },
    required: ['url'],
  },
};

const CREATE_PORTAL_TOOL: Tool = {
  name: 'create_portal',
  description: 'Create a complete Masterportal in a single call. Provide all layers and configuration at once. Returns a download URL for the generated zip package. Use this tool for stateless clients like Claude.ai web.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Portal title displayed in the header',
      },
      center: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
        description: 'Initial map center [longitude, latitude]. Default: Berlin [13.30, 52.52]',
      },
      zoom: {
        type: 'number',
        description: 'Initial zoom level (1-18). Default: 1 (shows all of Berlin)',
      },
      basemap_url: {
        type: 'string',
        description: 'Custom WMS basemap URL. Default: OpenStreetMap',
      },
      layers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique layer identifier',
            },
            name: {
              type: 'string',
              description: 'Display name in layer tree',
            },
            type: {
              type: 'string',
              enum: ['geojson', 'wfs'],
              description: 'Data type: "geojson" or "wfs"',
            },
            data: {
              oneOf: [
                { type: 'string' },
                { type: 'object' },
              ],
              description: 'Inline GeoJSON (string or object)',
            },
            url: {
              type: 'string',
              description: 'URL to GeoJSON file or WFS endpoint',
            },
            featureType: {
              type: 'string',
              description: 'WFS feature type name (required if WFS has multiple feature types). Use list_wfs_layers to discover available types.',
            },
            style: {
              type: 'object',
              properties: {
                color: { type: 'string', description: 'Feature color (hex)' },
                opacity: { type: 'number', description: 'Opacity 0-1' },
                icon: { type: 'string', description: 'Icon URL for point features' },
              },
            },
          },
          required: ['id', 'name', 'type'],
        },
        description: 'Array of layers to include in the portal. Each layer needs id, name, type, and either data or url.',
      },
      filename: {
        type: 'string',
        description: 'Output filename (without .zip extension). Default: auto-generated',
      },
    },
    required: ['title', 'layers'],
  },
};

const DEFAULT_MAP_CONFIG: MapConfig = {
  title: 'Masterportal',
  center: [13.30, 52.52], // Berlin center
  zoom: 1, // Shows all of Berlin
};

let serverInstanceCounter = 0;

export class MasterportalMCPServer {
  private server: Server;
  private session: PortalSession;
  private dataFetcher: DataFetcher;
  private zipBuilder: ZipBuilder;
  private baseUrl: string;
  private instanceId: number;

  constructor(baseUrl?: string) {
    this.instanceId = ++serverInstanceCounter;
    console.error(`[Server ${this.instanceId}] Created new MasterportalMCPServer instance`);
    this.baseUrl = baseUrl || 'http://localhost:3000';

    this.server = new Server(
      {
        name: 'masterportal-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Each server instance has one session (no need for session ID mapping)
    this.session = {
      id: 'session',
      layers: [],
      mapConfig: { ...DEFAULT_MAP_CONFIG },
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };
    this.dataFetcher = new DataFetcher();
    this.zipBuilder = new ZipBuilder();

    this.setupHandlers();
  }

  setSessionId(_sessionId: string): void {
    // No longer needed - each server instance owns one session
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [LIST_WFS_LAYERS_TOOL, CREATE_PORTAL_TOOL],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'list_wfs_layers':
          return await this.handleListWfsLayers(args as { url: string });
        case 'create_portal':
          return await this.handleCreatePortal(args as unknown as CreatePortalParams);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async handleListWfsLayers(params: { url: string }) {
    try {
      const { url } = params;
      const capabilitiesUrl = `${url}?SERVICE=WFS&REQUEST=GetCapabilities`;

      console.error(`Fetching WFS capabilities from: ${capabilitiesUrl}`);
      const response = await axios.get(capabilitiesUrl, { timeout: 30000 });
      const xml = response.data;

      // Parse feature types from XML
      const featureTypes: Array<{ name: string; title: string }> = [];
      const nameRegex = /<Name>([^<]+)<\/Name>/g;
      const titleRegex = /<Title>([^<]+)<\/Title>/g;

      // Find all FeatureType blocks
      const featureTypeBlocks = xml.match(/<FeatureType[^>]*>[\s\S]*?<\/FeatureType>/g) || [];

      for (const block of featureTypeBlocks) {
        const nameMatch = block.match(/<Name>([^<]+)<\/Name>/);
        const titleMatch = block.match(/<Title>([^<]+)<\/Title>/);
        if (nameMatch) {
          featureTypes.push({
            name: nameMatch[1],
            title: titleMatch ? titleMatch[1] : nameMatch[1],
          });
        }
      }

      if (featureTypes.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No feature types found in WFS service at ${url}`,
          }],
        };
      }

      const layerList = featureTypes.map(ft => `- ${ft.name}: ${ft.title}`).join('\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${featureTypes.length} feature type(s) in WFS service:\n\n${layerList}\n\nTo use a layer, specify the feature type name (e.g., "${featureTypes[0].name}") in the featureType parameter when calling create_portal.`,
        }],
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Failed to fetch WFS capabilities: ${error.message}`,
        }],
        isError: true,
      };
    }
  }

  private async handleCreatePortal(params: CreatePortalParams) {
    console.error(`[Server ${this.instanceId}] handleCreatePortal called with ${params.layers?.length || 0} layers`);
    try {
      const { title, center, zoom, basemap_url, layers, filename } = params;

      if (!layers || layers.length === 0) {
        throw new Error('At least one layer is required');
      }

      // Reset session for new portal
      this.session.layers = [];

      // Configure map
      this.session.mapConfig.title = title;
      if (center) this.session.mapConfig.center = center as [number, number];
      if (zoom !== undefined) this.session.mapConfig.zoom = zoom;
      if (basemap_url) this.session.mapConfig.basemapUrl = basemap_url;

      // Process all layers
      const layerResults: string[] = [];
      for (const layerInput of layers) {
        const { id, name, type, data, url, featureType, style } = layerInput;

        if (!data && !url) {
          throw new Error(`Layer "${name}" requires either "data" (inline GeoJSON) or "url"`);
        }

        let resolvedData;
        // Only fetch/parse data for GeoJSON layers (bundled in zip)
        // WFS layers are loaded directly by Masterportal at runtime
        if (type === 'geojson') {
          if (data) {
            resolvedData = this.dataFetcher.parseInlineGeoJSON(data);
          } else if (url) {
            resolvedData = await this.dataFetcher.fetchGeoJSON(url);
          }
        }

        const layer: Layer = { id, name, type, data: typeof data === 'string' ? data : JSON.stringify(data), url, featureType, style, resolvedData };
        this.session.layers.push(layer);

        if (type === 'wfs') {
          layerResults.push(`- ${name}: WFS service`);
        } else {
          const featureCount = resolvedData?.features?.length || 0;
          layerResults.push(`- ${name}: ${featureCount} features`);
        }
      }

      // Generate the portal
      const download = await this.zipBuilder.buildZip(this.session, filename);
      const downloadUrl = `${this.baseUrl}/downloads/${download.filename}`;

      const totalFeatures = this.session.layers.reduce((sum, l) => sum + (l.resolvedData?.features?.length || 0), 0);

      return {
        content: [
          {
            type: 'text',
            text: `Portal created successfully!

IMPORTANT: Share this download link with the user:
${downloadUrl}

Portal details:
- Title: ${title}
- Layers: ${this.session.layers.length}
- Total features: ${totalFeatures}

Layers added:
${layerResults.join('\n')}

The download link expires in 1 hour. The user should click the link to download the zip file, then extract it and serve with any web server (e.g., "npx http-server").`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to create portal: ${error.message}` }],
        isError: true,
      };
    }
  }

  getZipBuilder(): ZipBuilder {
    return this.zipBuilder;
  }

  async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Masterportal MCP server running on stdio');
  }

  destroy(): void {
    this.zipBuilder.destroy();
  }
}

// CLI entry point
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const server = new MasterportalMCPServer();
  server.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
