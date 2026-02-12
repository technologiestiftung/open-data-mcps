// ABOUTME: Type definitions for MCP client, WebSocket messages, and Claude API
// ABOUTME: Provides type safety across the backend application

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// WebSocket message types
export interface UserMessage {
  type: 'user_message';
  content: string;
}

export interface AssistantMessage {
  type: 'assistant_message';
  content: string;
  done: boolean;
}

export interface AssistantMessageChunk {
  type: 'assistant_message_chunk';
  content: string;
  done: boolean;
}

export interface ThinkingBlock {
  type: 'thinking_block';
  thinking: string;
}

export interface ErrorMessage {
  type: 'error';
  error: string;
}

export interface StatusMessage {
  type: 'status';
  status: string;
}

/**
 * Sent when a tool execution begins
 * Allows frontend to display real-time spinner/status indicator
 */
export interface ToolCallStart {
  type: 'tool_call_start';
  toolCallId: string;  // Unique ID to track this specific tool call
  toolName: string;    // Name of the MCP tool being executed
  toolArgs: any;       // Arguments passed to the tool
}

/**
 * Sent when a tool execution completes (successfully or with error)
 * Frontend uses this to update the tool display with results
 */
export interface ToolCallComplete {
  type: 'tool_call_complete';
  toolCallId: string;  // Matches the ID from ToolCallStart
  toolName: string;    // Name of the tool that completed
  result: string;      // Result text or error message
  isError?: boolean;   // True if tool execution failed
}

/**
 * Sent when a file download is ready
 * Frontend triggers browser download dialog
 */
export interface FileDownload {
  type: 'file_download';
  filename: string;    // Name of the file to download
  mimeType: string;    // MIME type (e.g., 'text/csv', 'application/json')
  content: string;     // File content
}

/**
 * Sent when user uploads a file for analysis
 * Backend will parse and cache the data for execute_code to use
 */
export interface FileUpload {
  type: 'file_upload';
  content: string;     // User's message text (can be empty)
  file: {
    name: string;      // Original filename
    mimeType: string;  // MIME type
    data: string;      // Base64-encoded file content
    size: number;      // Original size in bytes
  };
}

export type WebSocketMessage = UserMessage | AssistantMessage | AssistantMessageChunk | ThinkingBlock | ErrorMessage | StatusMessage | ToolCallStart | ToolCallComplete | FileDownload | FileUpload;

// Conversation history
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

// MCP configuration
export interface MCPConfig {
  serverPath: string;
  serverArgs?: string[];
  env?: Record<string, string>;
}

// Tool execution result
export interface ToolResult {
  toolUseId: string;
  content: any;
  isError?: boolean;
}
