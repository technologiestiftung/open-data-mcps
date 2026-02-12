// ABOUTME: MCP client that connects to Berlin Open Data MCP server
// ABOUTME: Handles server spawning, tool discovery, and tool execution

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MCPClientManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private process: ChildProcess | null = null;
  private tools: Tool[] = [];
  private isConnected = false;

  constructor(private config: MCPConfig) {}

  /**
   * Start the MCP server and connect to it
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log('MCP client already connected');
      return;
    }

    try {
      console.log('Starting Berlin MCP server...');
      console.log('Server path:', this.config.serverPath);

      // Spawn the MCP server as a child process
      this.process = spawn('node', [this.config.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.config.env }
      });

      // Log server errors
      this.process.stderr?.on('data', (data) => {
        console.error('MCP Server Error:', data.toString());
      });

      // Handle server exit
      this.process.on('exit', (code) => {
        console.log(`MCP server exited with code ${code}`);
        this.isConnected = false;
      });

      // Create transport using stdio
      this.transport = new StdioClientTransport({
        command: 'node',
        args: [this.config.serverPath],
        env: { ...process.env, ...this.config.env } as Record<string, string>
      });

      // Create and connect MCP client
      this.client = new Client(
        {
          name: 'interface-prototype-client',
          version: '1.0.0'
        },
        {
          capabilities: {}
        }
      );

      await this.client.connect(this.transport);

      this.isConnected = true;
      console.log('Connected to Berlin MCP server');

      // Fetch available tools
      await this.refreshTools();

    } catch (error) {
      console.error('Failed to connect to MCP server:', error);
      throw new Error(`MCP connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetch available tools from the MCP server
   */
  async refreshTools(): Promise<Tool[]> {
    if (!this.client || !this.isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      const response = await this.client.listTools();
      this.tools = response.tools;
      console.log(`Loaded ${this.tools.length} tools from Berlin MCP server`);
      return this.tools;
    } catch (error) {
      console.error('Failed to fetch tools:', error);
      throw error;
    }
  }

  /**
   * Get list of available tools
   */
  getTools(): Tool[] {
    return this.tools;
  }

  /**
   * Execute a tool
   */
  async callTool(name: string, args: any, options?: { timeout?: number }): Promise<any> {
    if (!this.client || !this.isConnected) {
      throw new Error('MCP client not connected');
    }

    try {
      console.log(`Executing tool: ${name}`, JSON.stringify(args, null, 2));

      const result = await this.client.callTool({
        name,
        arguments: args
      }, undefined, options);

      console.log(`Tool ${name} executed successfully`);
      return result;
    } catch (error) {
      console.error(`Tool execution failed for ${name}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    this.isConnected = false;
    console.log('Disconnected from MCP server');
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.isConnected;
  }
}

/**
 * Helper function to find Berlin MCP server path
 */
export function findBerlinMCPPath(): string {
  // Try environment variable first
  if (process.env.BERLIN_MCP_PATH) {
    return process.env.BERLIN_MCP_PATH;
  }

  // Default: assume it's in ../berlin-open-data-mcp/dist/index.js
  const defaultPath = path.resolve(__dirname, '../../../berlin-open-data-mcp/dist/index.js');
  return defaultPath;
}
