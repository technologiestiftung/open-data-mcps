// ABOUTME: WebSocket handler for real-time communication with frontend
// ABOUTME: Processes user messages and streams Claude responses back

import type { WebSocket } from 'ws';
import type { MCPClientManager } from './mcp-client.js';
import type { HTTPMCPClient } from './http-mcp-client.js';
import type { ClaudeClient } from './claude-client.js';
import type { ConversationMessage, WebSocketMessage, UserMessage, FileUpload } from './types.js';
import { CodeExecutor } from './code-executor.js';
import * as XLSX from 'xlsx';
import { parse as parseCSVSync } from 'csv-parse/sync';

export class WebSocketHandler {
  private conversationHistory: Map<WebSocket, ConversationMessage[]> = new Map();
  private codeExecutor: CodeExecutor;
  private fetchedDatasets: Map<WebSocket, Map<string, any[]>> = new Map();

  constructor(
    private berlinMcpClient: MCPClientManager | HTTPMCPClient,
    private claudeClient: ClaudeClient,
    private datawrapperMcpClient?: MCPClientManager | HTTPMCPClient
  ) {
    this.codeExecutor = new CodeExecutor();
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: WebSocket): void {
    console.log('New WebSocket connection');

    // Initialize conversation history and dataset cache for this connection
    this.conversationHistory.set(ws, []);
    this.fetchedDatasets.set(ws, new Map());

    // Send welcome message
    this.sendMessage(ws, {
      type: 'status',
      status: 'Connected to Berlin Open Data Chat'
    });

    // Set up message handler
    ws.on('message', async (data: Buffer) => {
      await this.handleMessage(ws, data);
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log('WebSocket connection closed');
      this.conversationHistory.delete(ws);
      this.fetchedDatasets.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }

  /**
   * Handle incoming message from frontend
   */
  private async handleMessage(ws: WebSocket, data: Buffer): Promise<void> {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());

      if (message.type === 'user_message') {
        await this.handleUserMessage(ws, message);
      } else if (message.type === 'file_upload') {
        await this.handleFileUpload(ws, message);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.sendMessage(ws, {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Process user message and get Claude response
   */
  private async handleUserMessage(ws: WebSocket, message: UserMessage): Promise<void> {
    const { content } = message;
    const history = this.conversationHistory.get(ws) || [];

    try {
      // Get available tools from both MCP clients
      // Filter out execute_code from MCP tools since we provide our own local version
      // that has access to cached datasets
      const berlinTools = this.berlinMcpClient.getTools().filter(t => t.name !== 'execute_code');
      const datawrapperTools = this.datawrapperMcpClient?.getTools() || [];
      const mcpTools = [...berlinTools, ...datawrapperTools];

      // Add code execution tool
      const codeExecutionTool = {
        name: 'execute_code',
        description: 'Execute JavaScript code to perform calculations and analyze datasets. CRITICAL: You MUST use this tool for ANY calculation - additions, sums, counts, averages, percentages, etc. NEVER calculate mentally or manually. Even simple arithmetic like adding two numbers must use this tool. After fetching data with fetch_dataset_data, immediately use this tool for all analysis and calculations.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript code to execute. The fetched dataset will be available as the "data" variable (an array of objects). Use standard JavaScript array methods like data.reduce(), data.map(), data.filter(). IMPORTANT: The value of the LAST EXPRESSION is returned as the result. DO NOT use console.log() - it returns undefined. CRITICAL: When using parseInt() or parseFloat(), ALWAYS add "|| 0" to handle NaN values. Example: "parseInt(row.E_E) || 0" not "parseInt(row.E_E)". Examples:\n- Count total rows: "data.length"\n- Sum population: "data.reduce((sum, row) => sum + (parseInt(row.E_E) || 0), 0)"\n- Count by bezirk: "data.reduce((acc, row) => { acc[row.bezirk] = (acc[row.bezirk] || 0) + 1; return acc; }, {})"\n- Return object literal: Wrap in parentheses: "({ total: data.length, unique: [...new Set(data.map(row => row.bezirk))] })"\n- Get unique values: "[...new Set(data.map(row => row.bezirk))]"'
            },
            dataset_id: {
              type: 'string',
              description: 'Optional: The dataset ID to use. If not provided, will use the most recently fetched dataset. Example: "fahrradreparaturstationen-wfs-ffeaba56"'
            }
          },
          required: ['code']
        }
      };

      const tools = [...mcpTools, codeExecutionTool];

      // Send to Claude with tool execution callback and streaming
      const result = await this.claudeClient.sendMessageWithTools(
        content,
        history,
        tools,
        async (toolName: string, toolArgs: any) => {
          // Handle code execution locally
          if (toolName === 'execute_code') {
            // Log what we received
            console.log('[execute_code] Received toolArgs:', JSON.stringify(toolArgs, null, 2));

            let { dataset_id, code } = toolArgs as { dataset_id?: string; code?: string };
            const datasetCache = this.fetchedDatasets.get(ws);

            // Auto-detect dataset_id if not provided
            if (!dataset_id && datasetCache && datasetCache.size > 0) {
              // Get the most recently cached dataset
              const datasets = Array.from(datasetCache.keys());
              dataset_id = datasets[datasets.length - 1];
              console.log('[execute_code] Auto-detected dataset_id:', dataset_id);
            }

            // Validate code parameter
            if (!code) {
              console.error('[execute_code] Missing code parameter. toolArgs:', toolArgs);
              return {
                content: [{
                  type: 'text',
                  text: `Error: execute_code requires a 'code' parameter with JavaScript code to execute. Example: { "code": "data.length" }`
                }],
                isError: true
              };
            }

            // Validate dataset_id
            if (!dataset_id) {
              console.error('[execute_code] No dataset_id provided and no cached datasets found');
              return {
                content: [{
                  type: 'text',
                  text: `Error: No dataset available. Please use fetch_dataset_data first to load a dataset.`
                }],
                isError: true
              };
            }

            // Get cached dataset
            const data = datasetCache?.get(dataset_id);

            if (!data) {
              console.error('[execute_code] Dataset not found in cache:', dataset_id);
              return {
                content: [{
                  type: 'text',
                  text: `Error: Dataset "${dataset_id}" not found. Please use fetch_dataset_data first to load the dataset.`
                }],
                isError: true
              };
            }

            console.log('[execute_code] Executing code on', dataset_id, 'with', data.length, 'rows');
            const executionResult = await this.codeExecutor.execute(code, { data });

            if (executionResult.success) {
              console.log('[execute_code] Success, execution time:', executionResult.executionTime, 'ms');
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(executionResult.output, null, 2)
                }]
              };
            } else {
              console.error('[execute_code] Execution failed:', executionResult.error);
              return {
                content: [{
                  type: 'text',
                  text: `Error executing code: ${executionResult.error}`
                }],
                isError: true
              };
            }
          }

          // Route tool call to appropriate MCP client
          // Datawrapper tools: create_visualization, publish_visualization
          // Berlin tools: search_datasets, fetch_dataset_data, download_dataset
          const isDatawrapperTool = toolName === 'create_visualization' || toolName === 'publish_visualization';
          const mcpClient = isDatawrapperTool ? this.datawrapperMcpClient : this.berlinMcpClient;

          if (!mcpClient) {
            throw new Error(`MCP client not available for tool: ${toolName}`);
          }

          // Use extended timeout for dataset operations (5 minutes) to handle WFS datasets and browser automation
          const timeout = (toolName === 'download_dataset' || toolName === 'fetch_dataset_data') ? 300000 : undefined;
          const result = await mcpClient.callTool(toolName, toolArgs, timeout ? { timeout } : undefined);

          // Extract text from MCP result structure
          let resultText = '';
          if (result && result.content && Array.isArray(result.content)) {
            // MCP returns { content: [{ type: 'text', text: '...' }] }
            const textContent = result.content.find((item: any) => item.type === 'text');
            if (textContent) {
              resultText = textContent.text;
            }
          } else if (typeof result === 'string') {
            resultText = result;
          }

          // Cache dataset if this was fetch_dataset_data
          if (toolName === 'fetch_dataset_data') {
            const { dataset_id } = toolArgs as { dataset_id: string };
            // Extract JSON from markdown code blocks (finds LAST json block = full data)
            const jsonMatches = resultText.matchAll(/```json\n([\s\S]*?)\n```/g);
            const allMatches = Array.from(jsonMatches);

            if (allMatches.length > 0 && dataset_id) {
              // The last JSON block contains the full dataset
              const lastMatch = allMatches[allMatches.length - 1];
              try {
                const parsedData = JSON.parse(lastMatch[1]);
                const datasetCache = this.fetchedDatasets.get(ws);
                if (datasetCache && Array.isArray(parsedData)) {
                  datasetCache.set(dataset_id, parsedData);
                  console.log('[fetch_dataset_data] Cached', parsedData.length, 'rows for', dataset_id);

                  // STRIP the full data JSON block from result before sending to Claude
                  // This prevents context overflow while keeping the data cached for execute_code
                  // Keep the preview (first JSON block), remove the full dataset (last JSON block)
                  resultText = resultText.substring(0, lastMatch.index) +
                               resultText.substring(lastMatch.index + lastMatch[0].length);
                  console.log('[fetch_dataset_data] Stripped full data from result, new length:', resultText.length);
                }
              } catch (error) {
                console.error('[fetch_dataset_data] Failed to parse/cache dataset:', error);
              }
            }
          }

          console.log('[WebSocket] Tool result text length:', resultText.length);
          console.log('[WebSocket] Checking for download marker...');

          // Check if the result contains a file download
          const downloadMatch = resultText.match(/\[DOWNLOAD:([^:]+):([^\]]+)\]\n([\s\S]*)/);

          if (downloadMatch) {
            console.log('[WebSocket] Download marker found!');
            const [, filename, mimeType, fileContent] = downloadMatch;

            // Extract the message before the download marker
            const messageBeforeDownload = resultText.substring(0, resultText.indexOf('[DOWNLOAD:'));

            // Send file download message immediately
            this.sendMessage(ws, {
              type: 'file_download',
              filename: filename,
              mimeType: mimeType,
              content: fileContent
            });

            // Return only the message part (without the file content) as the tool result
            // Keep the same structure as the original result
            return {
              content: [{ type: 'text', text: messageBeforeDownload.trim() }]
            };
          }

          // Check if the result contains a chart embed - but don't strip it, pass it through
          // The chart will be rendered inline in the message
          if (resultText.includes('[CHART:')) {
            console.log('[WebSocket] Chart marker found in tool result');
          }

          // Return result with potentially modified text (e.g., stripped full dataset)
          return {
            content: [{ type: 'text', text: resultText }]
          };
        },
        (chunk: string) => {
          // Check if this is a file download
          const downloadMatch = chunk.match(/\[DOWNLOAD:([^:]+):([^\]]+)\]\n([\s\S]*)/);
          if (downloadMatch) {
            const [, filename, mimeType, fileContent] = downloadMatch;

            // Extract the message before the download marker
            const messageBeforeDownload = chunk.substring(0, chunk.indexOf('[DOWNLOAD:'));

            // Send the message text first (without the file content)
            if (messageBeforeDownload.trim()) {
              this.sendMessage(ws, {
                type: 'assistant_message_chunk',
                content: messageBeforeDownload,
                done: false
              });
            }

            // Send file download message
            this.sendMessage(ws, {
              type: 'file_download',
              filename: filename,
              mimeType: mimeType,
              content: fileContent
            });
          } else {
            // Regular text chunk - stream to frontend
            this.sendMessage(ws, {
              type: 'assistant_message_chunk',
              content: chunk,
              done: false
            });
          }
        },
        (activity) => {
          // Forward tool activity to frontend for real-time display
          // This allows the UI to show a spinner during execution and
          // then display results in an expandable badge when complete
          if (activity.type === 'start') {
            this.sendMessage(ws, {
              type: 'tool_call_start',
              toolCallId: activity.toolCallId,
              toolName: activity.toolName,
              toolArgs: activity.toolArgs
            });
          } else {
            this.sendMessage(ws, {
              type: 'tool_call_complete',
              toolCallId: activity.toolCallId,
              toolName: activity.toolName,
              result: activity.result || '',
              isError: activity.isError
            });
          }
        },
        (thinking: string) => {
          // Forward thinking blocks to frontend for display
          console.log('[WebSocket] Sending thinking block, length:', thinking.length);
          this.sendMessage(ws, {
            type: 'thinking_block',
            thinking: thinking
          });
        }
      );

      // Update conversation history with complete message chain (includes tool calls and results)
      this.conversationHistory.set(ws, result.messages);

      // Send final done message
      this.sendMessage(ws, {
        type: 'assistant_message',
        content: '',
        done: true
      });

    } catch (error) {
      console.error('Error processing user message:', error);
      this.sendMessage(ws, {
        type: 'error',
        error: `Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  /**
   * Send message to WebSocket client
   */
  private sendMessage(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle file upload from frontend
   */
  private async handleFileUpload(ws: WebSocket, message: FileUpload): Promise<void> {
    const { content, file } = message;
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

    try {
      // Validate size
      if (file.size > MAX_SIZE) {
        throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 10 MB.`);
      }

      // Decode and parse file
      const buffer = Buffer.from(file.data, 'base64');
      const parsedData = this.parseFile(buffer, file.name);

      if (!Array.isArray(parsedData) || parsedData.length === 0) {
        throw new Error('File is empty or contains no data rows');
      }

      // Generate upload ID and cache
      const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const datasetCache = this.fetchedDatasets.get(ws);
      if (datasetCache) {
        datasetCache.set(uploadId, parsedData);
        console.log(`[file_upload] Cached ${parsedData.length} rows as ${uploadId}`);
      }

      // Get column names for context
      const columns = parsedData.length > 0 ? Object.keys(parsedData[0]) : [];

      // Create enhanced message that tells Claude about the upload
      const enhancedContent = content
        ? `${content}\n\n[User uploaded file: ${file.name} (${parsedData.length} rows, columns: ${columns.join(', ')}). Data cached as "${uploadId}" - use execute_code with dataset_id="${uploadId}" to analyze it.]`
        : `[User uploaded file: ${file.name} (${parsedData.length} rows, columns: ${columns.join(', ')}). Data cached as "${uploadId}" - use execute_code with dataset_id="${uploadId}" to analyze it.]`;

      // Process as normal user message
      await this.handleUserMessage(ws, {
        type: 'user_message',
        content: enhancedContent
      });

    } catch (error) {
      console.error('[file_upload] Error processing file:', error);
      this.sendMessage(ws, {
        type: 'error',
        error: `Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  /**
   * Parse uploaded file based on extension
   */
  private parseFile(buffer: Buffer, filename: string): any[] {
    const ext = filename.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'csv':
        return this.parseCSV(buffer);
      case 'json':
      case 'geojson':
        return this.parseJSON(buffer);
      case 'xlsx':
      case 'xls':
        return this.parseExcel(buffer);
      default:
        throw new Error(`Unsupported file format: .${ext}. Supported formats: CSV, JSON, GeoJSON, Excel (.xlsx/.xls)`);
    }
  }

  /**
   * Parse CSV file
   */
  private parseCSV(buffer: Buffer): any[] {
    const text = buffer.toString('utf-8');
    return parseCSVSync(text, {
      columns: true,        // Use first row as headers
      skip_empty_lines: true,
      trim: true
    });
  }

  /**
   * Parse JSON or GeoJSON file
   */
  private parseJSON(buffer: Buffer): any[] {
    const text = buffer.toString('utf-8');
    const data = JSON.parse(text);

    // Handle GeoJSON FeatureCollection
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      return data.features.map((f: any) => ({
        ...f.properties,
        geometry_type: f.geometry?.type,
        geometry: f.geometry
      }));
    }

    // Handle plain array
    if (Array.isArray(data)) {
      return data;
    }

    // Handle object with data property (common API response format)
    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }

    // Handle object with results property
    if (data.results && Array.isArray(data.results)) {
      return data.results;
    }

    throw new Error('JSON must be an array, GeoJSON FeatureCollection, or object with data/results array');
  }

  /**
   * Parse Excel file
   */
  private parseExcel(buffer: Buffer): any[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Excel file contains no sheets');
    }
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet);
  }
}
