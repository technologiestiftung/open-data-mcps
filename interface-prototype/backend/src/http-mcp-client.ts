// ABOUTME: HTTP client for connecting to remote MCP servers
// ABOUTME: Replaces subprocess spawning with HTTP transport for independent deployment

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface HTTPMCPClientConfig {
  baseUrl: string;
  authToken?: string;
  name: string;
}

export class HTTPMCPClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools: Tool[] = [];
  private isConnected = false;
  private config: HTTPMCPClientConfig;

  constructor(config: HTTPMCPClientConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log(`HTTP MCP client (${this.config.name}) already connected`);
      return;
    }

    try {
      console.log(`Connecting to ${this.config.name} at ${this.config.baseUrl}...`);

      const headers: Record<string, string> = {};
      if (this.config.authToken) {
        headers['Authorization'] = `Bearer ${this.config.authToken}`;
      }

      this.transport = new StreamableHTTPClientTransport(
        new URL(`${this.config.baseUrl}/mcp`),
        { requestInit: { headers } }
      );

      this.client = new Client(
        { name: `interface-${this.config.name}-client`, version: '1.0.0' },
        { capabilities: {} }
      );

      await this.client.connect(this.transport);
      this.isConnected = true;
      console.log(`Connected to ${this.config.name}`);

      await this.refreshTools();
    } catch (error) {
      console.error(`Failed to connect to ${this.config.name}:`, error);
      throw new Error(`MCP connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async refreshTools(): Promise<Tool[]> {
    if (!this.client || !this.isConnected) {
      throw new Error('HTTP MCP client not connected');
    }

    try {
      const response = await this.client.listTools();
      this.tools = response.tools;
      console.log(`Loaded ${this.tools.length} tools from ${this.config.name}`);
      return this.tools;
    } catch (error) {
      console.error('Failed to fetch tools:', error);
      throw error;
    }
  }

  getTools(): Tool[] {
    return this.tools;
  }

  async callTool(name: string, args: any, options?: { timeout?: number }): Promise<any> {
    if (!this.client || !this.isConnected) {
      throw new Error('HTTP MCP client not connected');
    }

    try {
      console.log(`[${this.config.name}] Executing tool: ${name}`);
      const result = await this.client.callTool({ name, arguments: args }, undefined, options);
      console.log(`[${this.config.name}] Tool ${name} executed successfully`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Detect session errors and attempt reconnection once
      if (errorMsg.includes('session') || errorMsg.includes('Session')) {
        console.log(`[${this.config.name}] Session error detected, reconnecting...`);
        try {
          await this.disconnect();
          await this.connect();
          console.log(`[${this.config.name}] Reconnected, retrying tool: ${name}`);
          const result = await this.client!.callTool({ name, arguments: args }, undefined, options);
          console.log(`[${this.config.name}] Tool ${name} succeeded after reconnection`);
          return result;
        } catch (retryError) {
          console.error(`[${this.config.name}] Retry failed after reconnection:`, retryError);
          throw retryError;
        }
      }

      console.error(`[${this.config.name}] Tool execution failed for ${name}:`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    this.isConnected = false;
    console.log(`Disconnected from ${this.config.name}`);
  }

  connected(): boolean {
    return this.isConnected;
  }
}
