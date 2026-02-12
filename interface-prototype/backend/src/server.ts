// ABOUTME: Main Express server with WebSocket support
// ABOUTME: Initializes MCP client, Claude client, and serves frontend

import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { MCPClientManager, findBerlinMCPPath } from './mcp-client.js';
import { HTTPMCPClient } from './http-mcp-client.js';
import { ClaudeClient } from './claude-client.js';
import { WebSocketHandler } from './websocket-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATAWRAPPER_API_KEY = process.env.DATAWRAPPER_API_KEY;
const DATAWRAPPER_MCP_AUTH_TOKEN = process.env.DATAWRAPPER_MCP_AUTH_TOKEN;
const BOD_MCP_URL = process.env.BOD_MCP_URL;
const DATAWRAPPER_MCP_URL = process.env.DATAWRAPPER_MCP_URL;

if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

async function main() {
  try {
    console.log('Starting Interface Prototype Backend...');

    // Initialize Berlin MCP client (HTTP or subprocess)
    let berlinMcpClient: MCPClientManager | HTTPMCPClient;

    if (BOD_MCP_URL) {
      console.log(`Connecting to Berlin MCP via HTTP: ${BOD_MCP_URL}`);
      berlinMcpClient = new HTTPMCPClient({
        baseUrl: BOD_MCP_URL,
        name: 'berlin-open-data'
      });
    } else {
      const berlinMCPPath = findBerlinMCPPath();
      console.log(`Using Berlin MCP server at: ${berlinMCPPath}`);
      berlinMcpClient = new MCPClientManager({ serverPath: berlinMCPPath });
    }
    await berlinMcpClient.connect();

    // Initialize Datawrapper MCP client (HTTP or subprocess, optional)
    let datawrapperMcpClient: MCPClientManager | HTTPMCPClient | undefined;

    if (DATAWRAPPER_MCP_URL) {
      console.log(`Connecting to Datawrapper MCP via HTTP: ${DATAWRAPPER_MCP_URL}`);
      datawrapperMcpClient = new HTTPMCPClient({
        baseUrl: DATAWRAPPER_MCP_URL,
        authToken: DATAWRAPPER_MCP_AUTH_TOKEN,
        name: 'datawrapper'
      });
      await datawrapperMcpClient.connect();
      console.log('Datawrapper MCP client connected successfully');
    } else if (DATAWRAPPER_API_KEY) {
      try {
        const datawrapperMCPPath = path.resolve(__dirname, '../../../datawrapper-mcp/dist/index.js');
        console.log(`Using Datawrapper MCP server at: ${datawrapperMCPPath}`);

        datawrapperMcpClient = new MCPClientManager({
          serverPath: datawrapperMCPPath,
          env: { DATAWRAPPER_API_TOKEN: DATAWRAPPER_API_KEY }
        });
        await datawrapperMcpClient.connect();
        console.log('Datawrapper MCP client connected successfully');
      } catch (error) {
        console.error('Failed to initialize Datawrapper MCP client:', error);
        console.warn('Continuing without visualization features');
        datawrapperMcpClient = undefined;
      }
    } else {
      console.warn('DATAWRAPPER_API_KEY not set and DATAWRAPPER_MCP_URL not configured - visualization features disabled');
    }

    // Initialize Claude client
    const claudeClient = new ClaudeClient(ANTHROPIC_API_KEY!);

    // Create Express app
    const app = express();
    app.use(express.json());
    const server = createServer(app);

    // Create WebSocket server
    const wss = new WebSocketServer({ server, path: '/ws' });

    // Create WebSocket handler with both MCP clients
    const wsHandler = new WebSocketHandler(berlinMcpClient, claudeClient, datawrapperMcpClient);

    // Handle WebSocket connections
    wss.on('connection', (ws) => {
      wsHandler.handleConnection(ws);
    });

    // Serve static files (production build of frontend)
    const frontendDistPath = path.join(__dirname, '../../frontend/dist');
    app.use(express.static(frontendDistPath));

    // Catch-all route to serve index.html
    app.get('*', (req, res) => {
      res.sendFile(path.join(frontendDistPath, 'index.html'));
    });

    // Start server
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`WebSocket server listening on ws://localhost:${PORT}/ws`);
      console.log(`Connected to Berlin MCP server with ${berlinMcpClient.getTools().length} tools`);
      if (datawrapperMcpClient) {
        console.log(`Connected to Datawrapper MCP server with ${datawrapperMcpClient.getTools().length} tools`);
      }
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await berlinMcpClient.disconnect();
      if (datawrapperMcpClient) {
        await datawrapperMcpClient.disconnect();
      }
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
