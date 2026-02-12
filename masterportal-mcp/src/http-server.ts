#!/usr/bin/env node
// ABOUTME: HTTP server wrapper for Masterportal MCP
// ABOUTME: Exposes MCP via HTTP transport plus /downloads endpoint for zip files

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { MasterportalMCPServer } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DOWNLOADS_DIR = join(__dirname, '..', 'downloads');

const PORT = process.env.PORT || 3000;

// Derive base URL from request headers (works with any domain)
function getBaseUrlFromRequest(req: express.Request): string {
  const host = req.get('host');
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  if (host) {
    return `${protocol}://${host}`;
  }
  return process.env.BASE_URL || `http://localhost:${PORT}`;
}

// Store transports and servers by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
const servers: { [sessionId: string]: MasterportalMCPServer } = {};

async function main() {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'masterportal-mcp' });
  });

  // Downloads endpoint for zip files
  app.get('/downloads/:filename', (req, res) => {
    const { filename } = req.params;

    // Security: only allow .zip files and prevent path traversal
    if (!filename.endsWith('.zip') || filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    // Check if file exists in downloads directory
    const downloadPath = join(DOWNLOADS_DIR, filename);

    if (!existsSync(downloadPath)) {
      res.status(404).json({ error: 'Download not found or expired' });
      return;
    }

    res.download(downloadPath, filename, (err) => {
      if (err) {
        console.error(`Download error for ${filename}:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download failed' });
        }
      }
    });
  });

  // MCP endpoint
  app.all('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string;
    const isInit = isInitializeRequest(req.body);
    console.log(`[MCP] ${req.method} sessionId=${sessionId || 'none'} isInit=${isInit} existingTransport=${!!transports[sessionId]}`);

    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        console.log(`[MCP] Reusing existing transport for session ${sessionId}`);
        transport = transports[sessionId];
      } else if (!sessionId && req.method === 'POST' && isInit) {
        console.log(`[MCP] Creating NEW session`);
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.log(`MCP session initialized: ${sid}`);
            transports[sid] = newTransport;
          },
        });

        newTransport.onclose = () => {
          const sid = newTransport.sessionId;
          if (sid) {
            console.log(`MCP session closed: ${sid}`);
            delete transports[sid];
            if (servers[sid]) {
              servers[sid].destroy();
              delete servers[sid];
            }
          }
        };

        const baseUrl = getBaseUrlFromRequest(req);
        const mcpServer = new MasterportalMCPServer(baseUrl);

        // Set session ID after transport is initialized
        newTransport.sessionId && mcpServer.setSessionId(newTransport.sessionId);

        await mcpServer.connect(newTransport);

        // Store server reference
        const sid = newTransport.sessionId;
        if (sid) {
          servers[sid] = mcpServer;
          mcpServer.setSessionId(sid);
        }

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
    console.log(`Masterportal MCP HTTP server running on port ${PORT}`);
    console.log(`MCP endpoint: /mcp`);
    console.log(`Downloads: /downloads/:filename`);
    console.log(`Health check: /health`);
  });
}

main().catch(console.error);
