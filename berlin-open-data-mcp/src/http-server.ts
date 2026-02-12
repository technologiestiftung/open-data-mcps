#!/usr/bin/env node
// ABOUTME: HTTP server wrapper for Berlin Open Data MCP
// ABOUTME: Exposes the MCP server via Streamable HTTP transport for remote access

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { BerlinOpenDataMCPServer } from './index.js';

const PORT = process.env.PORT || 3000;

// Store MCP transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Store dataset caches by session ID (for execute_code)
const sessionCaches: { [sessionId: string]: Map<string, any[]> } = {};

async function main() {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'bod-mcp' });
  });

  // MCP endpoint
  app.all('/mcp', async (req, res) => {
    console.log(`Received ${req.method} request to /mcp`);

    try {
      const sessionId = req.headers['mcp-session-id'] as string;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
        // Create new session (handles both fresh connections and stale session IDs)
        // Create cache for this session
        const sessionCache = new Map<string, any[]>();
        let sessionId: string | undefined;

        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.log(`MCP session initialized: ${sid}`);
            sessionId = sid;
            transports[sid] = newTransport;
            sessionCaches[sid] = sessionCache;
          }
        });

        newTransport.onclose = () => {
          const sid = newTransport.sessionId;
          if (sid && transports[sid]) {
            console.log(`MCP session closed: ${sid}`);
            delete transports[sid];
            delete sessionCaches[sid];
          }
        };

        // Pass session cache to MCP server for execute_code support
        const mcpServer = new BerlinOpenDataMCPServer({ sessionCache });
        await mcpServer.connect(newTransport);
        transport = newTransport;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      if (!transport) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error: transport not initialized' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const server = createServer(app);
  server.listen(PORT, () => {
    console.log(`Berlin Open Data MCP HTTP server running on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

main().catch(console.error);
