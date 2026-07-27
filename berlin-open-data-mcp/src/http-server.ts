#!/usr/bin/env node
// ABOUTME: HTTP server wrapper for Berlin Open Data MCP
// ABOUTME: Exposes the MCP server via Streamable HTTP transport for remote access

import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { BerlinOpenDataMCPServer } from './index.js';

const PORT = process.env.PORT || 3000;

// Store MCP transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

async function main() {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'berlin-open-data-mcp' });
  });

  // MCP endpoint
  app.all('/mcp', async (req, res) => {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    console.log(`Received ${req.method} request to /mcp`);

    // Intercept writeHead to flush headers and send the Render buffer-bypass SSE comment
    // ONLY after the SDK has registered its actual headers.
    const originalWriteHead = res.writeHead.bind(res);
    // @ts-ignore
    res.writeHead = function (statusCode: number, ...args: any[]) {
      const result = originalWriteHead(statusCode, ...args);

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      // Write SSE keep-alive comment only for GET SSE streams
      if (req.method === 'GET') {
        res.write(':\n\n');
      }

      return result;
    };

    try {
      const sessionId = req.headers['mcp-session-id'] as string;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId) {
        if (transports[sessionId]) {
          transport = transports[sessionId];
        } else {
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Session not found' },
            id: null,
          });
          return;
        }
      } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            console.log(`MCP session initialized: ${sid}`);
            transports[sid] = newTransport;
          },
        });

        newTransport.onclose = () => {
          const sid = newTransport.sessionId;
          if (sid && transports[sid]) {
            console.log(`MCP session closed: ${sid}`);
            delete transports[sid];
          }
        };

        const mcpServer = new BerlinOpenDataMCPServer();
        await mcpServer.connect(newTransport);
        transport = newTransport;
      } else if (req.method === 'GET') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method Not Allowed: Initial requests must be POST' },
          id: null,
        });
        return;
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
