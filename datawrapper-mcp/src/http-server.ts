#!/usr/bin/env node
// ABOUTME: HTTP server wrapper for Datawrapper MCP
// ABOUTME: Exposes the MCP server via Streamable HTTP transport for remote access

import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { DatawrapperMCPServer } from './index.js';

const PORT = process.env.PORT || 3000;

// Store MCP transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

async function main() {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'datawrapper-mcp' });
  });

  // MCP endpoint
  app.all('/mcp', async (req, res) => {
    console.log(`Received ${req.method} request to /mcp`);

    try {
      const sessionId = req.headers['mcp-session-id'] as string;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            console.log(`MCP session initialized: ${sid}`);
            transports[sid] = newTransport;
          }
        });

        newTransport.onclose = () => {
          const sid = newTransport.sessionId;
          if (sid && transports[sid]) {
            console.log(`MCP session closed: ${sid}`);
            delete transports[sid];
          }
        };

        const mcpServer = new DatawrapperMCPServer();
        await mcpServer.connect(newTransport);
        transport = newTransport;
      } else {
        // If the client is probing with GET, return 405 Method Not Allowed.
        // This signals the @ai-sdk/mcp client to gracefully fall back to stateless HTTP POST-response mode.
        if (req.method === 'GET') {
          res.status(405).json({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'Method Not Allowed: Use POST for stateless MCP requests or provide a valid session ID' },
            id: null,
          });
          return;
        }

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
    console.log(`Datawrapper MCP HTTP server running on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

main().catch(console.error);
