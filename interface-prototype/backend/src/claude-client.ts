// ABOUTME: Claude API client that handles conversation and tool calling
// ABOUTME: Manages message history and streaming responses

import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ConversationMessage } from './types.js';

export interface ClaudeResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: string | null;
  fullContent?: any[]; // Full content array including thinking blocks
}

export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

export class ClaudeClient {
  private client: Anthropic;
  private model = 'claude-haiku-4-5-20251001';
  // private model = 'claude-sonnet-4-5'; // Slower but better instruction following
  private systemPrompt = `You are an assistant helping users discover and analyze open data from Berlin's Open Data Portal.

You have access to tools that connect to the Berlin Open Data Portal. ALWAYS use these tools when users ask about datasets or data. NEVER make up or fabricate datasets, data, or analysis.

IMPORTANT: Always respond AND think in the same language as the user's question. If the user writes in German, your responses AND your thinking process must be in German. If in English, use English.

CRITICAL CONVERSATION RULE - Answer ONLY What Was Asked:

Before responding, ask yourself: "Did the user ask about [topic] in THIS message?"
- If NO: Do not mention that topic AT ALL
- If YES: Answer only that topic

Common mistake to avoid: Including facts from previous answers when they weren't asked about.

WRONG pattern:
User current question: "Wieviele Bezirke haben mehr Bewohner als Neukölln?"
Your answer: "Nach den Daten vom 31.12.2024 wohnen 315.548 Menschen in Lichtenberg. 4 Bezirke..."
Problem: User didn't ask about Lichtenberg! Why mention it?

CORRECT pattern:
User current question: "Wieviele Bezirke haben mehr Bewohner als Neukölln?"
Your answer: "4 Bezirke haben mehr Bewohner als Neukölln: Pankow, Mitte, Tempelhof-Schöneberg und Charlottenburg-Wilmersdorf."
Why correct: Directly answers the question without unnecessary information.

Test before responding: Does my answer contain information that wasn't asked for? If yes, remove it.

Key guidelines:
- Use search_berlin_datasets to find relevant datasets
- Use get_dataset_details to get more information about a specific dataset
- Use fetch_dataset_data to retrieve actual data from datasets
- Use execute_code to perform accurate calculations, counting, aggregations, or filtering on fetched data
- Only provide analysis based on data you've actually retrieved via tools
- If you cannot find a dataset, tell the user clearly - do not invent one
- When you fetch data, work with what's actually returned - do not extrapolate or fabricate additional data
- Be helpful and conversational, but always grounded in the real data from the portal

CRITICAL CALCULATION RULE: You MUST use execute_code for ANY calculation, no matter how simple:
- Adding numbers together: use execute_code
- Subtracting numbers: use execute_code
- Summing values from execute_code results: use execute_code again
- Calculating percentages: use execute_code
- Counting items in a list: use execute_code
- Comparing numbers (e.g., "how many are greater than X?"): use execute_code
- Finding position/rank in a list: use execute_code
- Averages, min, max: use execute_code
- ANY arithmetic operation: use execute_code
- ANY comparison or filtering operation: use execute_code

NEVER perform mental arithmetic or manual calculations. You are not accurate at math or counting. Always use execute_code.

IMPORTANT: If a user asks a follow-up question about data you already fetched (e.g., "How many districts have more than X?"), you MUST use execute_code to answer - do NOT count or compare manually from previous results.

IMPORTANT: When presenting results with a summary (e.g., "Total: X" or "Average: Y"), you must EITHER:
1. Include the summary calculation in the SAME execute_code call that produces the breakdown, OR
2. Call execute_code AGAIN to calculate the summary from the original dataset

DO NOT manually calculate summaries from execute_code results in your response text.

When users ask questions that require counting, aggregating, or calculating statistics from dataset data:
1. First use fetch_dataset_data to get the data
2. Then IMMEDIATELY use execute_code with the dataset_id and JavaScript code to perform ALL calculations you plan to mention
3. Include ALL relevant aggregations in the code (breakdown + total/average/etc)

Example workflow for district populations:
User: "What is the population of each Berlin district?"
1. fetch_dataset_data with dataset_id
2. execute_code with code that returns BOTH breakdown AND total (example):
   const byBezirk = data.reduce((acc, row) => { const bezirk = row.BEZIRK_NAME; acc[bezirk] = (acc[bezirk] || 0) + parseInt(row.E_E); return acc; }, {});
   const items = Object.entries(byBezirk).map(([bezirk, population]) => ({ bezirk, population })).sort((a, b) => b.population - a.population);
   const total = items.reduce((sum, item) => sum + item.population, 0);
   ({ items, total })
3. Present both items and total from the execute_code result - do NOT calculate total manually

Code execution notes:
- The LAST EXPRESSION in your code becomes the result
- DO NOT use console.log() - it returns undefined instead of your data
- End your code with the value you want returned (e.g., an object, array, or number)

ABSOLUTE RULE - NEVER FABRICATE DATA:

You are FORBIDDEN from using ANY numeric values in execute_code except:
1. Values from the 'data' variable (from fetch_dataset_data)
2. Values the user explicitly typed in the current conversation

This means you CANNOT use:
- Numbers you "know" from training (district areas, populations, distances)
- Numbers you calculated in a previous execute_code call (you must recalculate or fetch again)
- "Approximate" or "estimated" values
- ANY hardcoded numbers for real-world quantities

POPULATION DENSITY EXAMPLE - READ THIS CAREFULLY:
To calculate population density (Bevölkerungsdichte), you need:
1. Population data - fetch it with fetch_dataset_data
2. Area data - fetch it with a SEPARATE fetch_dataset_data call

If you cannot find an area dataset:
- DO NOT write: const areas = { "Pankow": 103.04, ... }  // THIS IS FORBIDDEN!
- DO NOT write: const areaData = { "Mitte": 39.47, ... }  // THIS IS FORBIDDEN!
- INSTEAD say: "Für die Berechnung der Bevölkerungsdichte benötige ich Flächendaten der Bezirke. Ich konnte keinen passenden Datensatz finden. Können Sie mir die Flächendaten bereitstellen oder einen anderen Ansatz vorschlagen?"

SELF-CHECK before execute_code:
Ask yourself: "Where did each number in my code come from?"
- If answer is "from the 'data' variable" → OK
- If answer is "the user typed it" → OK
- If answer is "I know this value" → FORBIDDEN - stop and tell the user you need the data

DATA NOT AVAILABLE ON THE PORTAL:
Some data is not available on the Berlin Open Data Portal (daten.berlin.de). When users ask for this data:

District area data (Bezirksflächen in km²):
- This data is NOT on daten.berlin.de
- Tell the user: "Flächendaten der Berliner Bezirke sind leider nicht im Open Data Portal verfügbar. Diese Daten finden Sie beim Amt für Statistik Berlin-Brandenburg: https://www.statistik-berlin-brandenburg.de/a-v-3-j - Wenn Sie mir die Flächendaten nennen, kann ich die Berechnung durchführen."
- Do NOT try to calculate areas from block-level data or geographic datasets - this won't give accurate results
- Do NOT fabricate area values from your training data

Visualization with create_visualization:
- IMPORTANT: The data you visualize MUST match the aggregation level you're discussing with the user
- If you're analyzing and showing yearly totals in your text, create a chart with yearly data (not monthly)
- Before creating a visualization, use execute_code to prepare the data at the correct aggregation level
- For time series with many points (>20), aggregate to yearly or quarterly for readability
- When a visualization tool returns a [CHART:...] marker with embedded iframe, ALWAYS include it in your response
- Copy the entire [CHART:chartId]<iframe...></iframe>[/CHART] block into your response text
- Example workflow:
  1. Analyze data and show yearly table
  2. execute_code to create yearly aggregates: [{year: "2019", impressions: 274944}, ...]
  3. create_visualization with the yearly aggregates
  4. Include the [CHART:...] block in your response`;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Transform MCP tools to Claude API format
   * MCP uses inputSchema, Claude uses input_schema
   */
  private transformToolsForClaude(mcpTools: Tool[]): any[] {
    return mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }

  /**
   * Send a message to Claude with available tools
   * Returns response which may include tool calls
   */
  async sendMessage(
    messages: ConversationMessage[],
    tools: Tool[]
  ): Promise<ClaudeResponse> {
    try {
      console.log('[ClaudeClient] sendMessage: Preparing API request');
      // Transform MCP tools to Claude API format
      const claudeTools = this.transformToolsForClaude(tools);

      console.log('[ClaudeClient] sendMessage: Calling Claude API...');
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 12000,
        system: this.systemPrompt,
        messages: messages as any,
        tools: claudeTools,
        thinking: {
          type: 'enabled',
          budget_tokens: 8000
        }
      });

      console.log('[ClaudeClient] sendMessage: API response received, id:', response.id, 'model:', response.model);
      console.log('[ClaudeClient] Response content blocks:', response.content.map((block: any) => ({ type: block.type, hasText: !!block.text, hasThinking: !!block.thinking })));

      // Extract text content (excluding thinking blocks for display)
      const textContent = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      // Extract tool calls
      const toolCalls = response.content
        .filter((block: any) => block.type === 'tool_use')
        .map((block: any) => ({
          id: block.id,
          name: block.name,
          input: block.input
        }));

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason: response.stop_reason,
        fullContent: response.content // Preserve full content including thinking blocks
      };
    } catch (error) {
      console.error('Claude API error:', error);
      throw error;
    }
  }

  /**
   * Send a message with streaming support
   * Streams text deltas via callback as they arrive
   */
  async sendMessageStreaming(
    messages: ConversationMessage[],
    tools: Tool[],
    streamCallback: (chunk: string) => void,
    thinkingCallback?: (thinking: string) => void
  ): Promise<ClaudeResponse> {
    try {
      const claudeTools = this.transformToolsForClaude(tools);

      const stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: 12000,
        system: this.systemPrompt,
        messages: messages as any,
        tools: claudeTools,
        thinking: {
          type: 'enabled',
          budget_tokens: 8000
        }
      });

      let fullText = '';
      const toolCalls: ToolCall[] = [];
      const toolInputJsonBuffers: Map<number, string> = new Map();
      const blockIndexToToolCallIndex: Map<number, number> = new Map();
      const fullContentBlocks: any[] = [];
      const blockIndexToContentBlock: Map<number, any> = new Map();

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          console.log('[ClaudeClient] content_block_start:', event.index, event.content_block.type);
          // Store all content blocks for history (including thinking)
          blockIndexToContentBlock.set(event.index, { ...event.content_block });

          if (event.content_block.type === 'tool_use') {
            // Initialize tool call - input will be built from deltas
            const toolCallIndex = toolCalls.length;
            toolCalls.push({
              id: event.content_block.id,
              name: event.content_block.name,
              input: {}
            });
            toolInputJsonBuffers.set(event.index, '');
            blockIndexToToolCallIndex.set(event.index, toolCallIndex);
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const chunk = event.delta.text;
            fullText += chunk;
            streamCallback(chunk);
            // Accumulate text in content block
            const block = blockIndexToContentBlock.get(event.index);
            if (block) {
              block.text = (block.text || '') + chunk;
            }
          } else if (event.delta.type === 'input_json_delta') {
            // Accumulate JSON input for tool calls
            const currentJson = toolInputJsonBuffers.get(event.index) || '';
            toolInputJsonBuffers.set(event.index, currentJson + event.delta.partial_json);
          } else if (event.delta.type === 'thinking_delta') {
            console.log('[ClaudeClient] thinking_delta received, length:', event.delta.thinking.length);
            // Accumulate thinking and stream it
            const block = blockIndexToContentBlock.get(event.index);
            if (block) {
              block.thinking = (block.thinking || '') + event.delta.thinking;
            }
            // Stream thinking chunks if callback provided
            if (thinkingCallback) {
              console.log('[ClaudeClient] Calling thinkingCallback');
              thinkingCallback(event.delta.thinking);
            } else {
              console.log('[ClaudeClient] No thinkingCallback provided!');
            }
          }
        } else if (event.type === 'content_block_stop') {
          // Finalize content block
          const block = blockIndexToContentBlock.get(event.index);
          if (block) {
            fullContentBlocks.push(block);
          }

          // Parse accumulated JSON input for tool calls
          const jsonBuffer = toolInputJsonBuffers.get(event.index);
          const toolCallIndex = blockIndexToToolCallIndex.get(event.index);
          if (jsonBuffer !== undefined && toolCallIndex !== undefined) {
            try {
              const parsedInput = JSON.parse(jsonBuffer);
              toolCalls[toolCallIndex].input = parsedInput;
            } catch (error) {
              console.error('[ClaudeClient] Failed to parse tool input JSON:', error);
            }
          }
        }
      }

      return {
        content: fullText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason: 'end_turn',
        fullContent: fullContentBlocks // Preserve full content including thinking blocks
      };
    } catch (error) {
      console.error('Claude API streaming error:', error);
      throw error;
    }
  }

  /**
   * Send message and handle tool calling loop
   * Executes tools via provided callback and continues until final response
   * Returns both the final response text and the complete updated message history
   *
   * @param userMessage - The user's message to send
   * @param conversationHistory - Previous messages in the conversation
   * @param tools - Available MCP tools
   * @param executeToolCallback - Callback to execute a tool (called for each tool use)
   * @param streamCallback - Optional callback for streaming text chunks as they arrive
   * @param toolActivityCallback - Optional callback for tool execution events (start/complete)
   *                                Enables real-time tool activity display in the UI
   */
  async sendMessageWithTools(
    userMessage: string,
    conversationHistory: ConversationMessage[],
    tools: Tool[],
    executeToolCallback: (name: string, args: any) => Promise<any>,
    streamCallback?: (chunk: string) => void,
    toolActivityCallback?: (activity: { type: 'start' | 'complete', toolCallId: string, toolName: string, toolArgs?: any, result?: string, isError?: boolean }) => void,
    thinkingCallback?: (thinking: string) => void
  ): Promise<{ response: string; messages: ConversationMessage[] }> {
    console.log('[ClaudeClient] sendMessageWithTools called with message:', userMessage);
    console.log('[ClaudeClient] Conversation history length:', conversationHistory.length);

    // Log conversation history for debugging
    if (conversationHistory.length > 0) {
      console.log('[ClaudeClient] Last 3 messages in history:');
      conversationHistory.slice(-3).forEach((msg, idx) => {
        if (msg.role === 'user') {
          console.log(`  [${idx}] USER: ${typeof msg.content === 'string' ? msg.content.substring(0, 100) : JSON.stringify(msg.content).substring(0, 100)}`);
        } else {
          console.log(`  [${idx}] ASSISTANT: ${Array.isArray(msg.content) ? `${msg.content.length} blocks` : msg.content.substring(0, 100)}`);
          if (Array.isArray(msg.content)) {
            msg.content.forEach((block: any, blockIdx: number) => {
              console.log(`    [${blockIdx}] ${block.type}: ${block.type === 'text' ? block.text?.substring(0, 80) : block.type === 'tool_use' ? block.name : block.type === 'thinking' ? 'thinking...' : ''}`);
            });
          }
        }
      });
    }
    console.log('[ClaudeClient] Available tools:', tools.length);

    // Add user message to history
    const messages: ConversationMessage[] = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    let finalResponse = '';
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (iterations < maxIterations) {
      iterations++;
      console.log(`[ClaudeClient] Iteration ${iterations}/${maxIterations}`);

      // Use streaming for final response (when no tool calls expected)
      const isLikelyFinalResponse = iterations > 1;

      if (isLikelyFinalResponse && streamCallback) {
        // Try streaming - if we get tool calls, we'll handle them normally
        console.log('[ClaudeClient] Using streaming for likely final response');
        const response = await this.sendMessageStreaming(messages, tools, streamCallback, thinkingCallback);
        console.log('[ClaudeClient] Streaming response received, stopReason:', response.stopReason);

        if (!response.toolCalls || response.toolCalls.length === 0) {
          finalResponse = response.content;

          // Add final assistant response to history before breaking
          messages.push({
            role: 'assistant',
            content: response.fullContent || [{ type: 'text', text: response.content }]
          });

          break;
        }

        // If we got tool calls despite streaming, continue with tool execution
        // Note: intro text was already streamed by sendMessageStreaming
        // Add assistant's response to history (including thinking blocks)
        messages.push({
          role: 'assistant',
          content: response.fullContent || [] // Use full content including thinking blocks
        });

        // Execute tools and collect results
        const toolResults = [];
        for (const toolCall of response.toolCalls) {
          try {
            // Notify that tool execution is starting
            toolActivityCallback?.({
              type: 'start',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              toolArgs: toolCall.input
            });

            const result = await executeToolCallback(toolCall.name, toolCall.input);

            let resultText = '';
            if (result.content && Array.isArray(result.content)) {
              resultText = result.content
                .filter((item: any) => item.type === 'text')
                .map((item: any) => item.text)
                .join('\n');
            } else if (typeof result === 'string') {
              resultText = result;
            } else {
              resultText = JSON.stringify(result);
            }

            // Notify that tool execution completed
            toolActivityCallback?.({
              type: 'complete',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: resultText
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: resultText
            });
          } catch (error) {
            console.error(`Tool execution error for ${toolCall.name}:`, error);
            const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;

            // Notify that tool execution failed
            toolActivityCallback?.({
              type: 'complete',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: errorMessage,
              isError: true
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: errorMessage,
              is_error: true
            });
          }
        }

        messages.push({
          role: 'user',
          content: toolResults
        });

        continue;
      }

      console.log('[ClaudeClient] Calling sendMessage (non-streaming)');
      const response = await this.sendMessage(messages, tools);
      console.log('[ClaudeClient] Response received, content length:', response.content.length, 'toolCalls:', response.toolCalls?.length || 0);

      // Extract and send thinking blocks if present (non-streaming mode)
      if (response.fullContent && thinkingCallback) {
        const thinkingBlocks = response.fullContent.filter((block: any) => block.type === 'thinking');
        for (const thinkingBlock of thinkingBlocks) {
          if (thinkingBlock.thinking) {
            console.log('[ClaudeClient] Sending thinking block from non-streaming response, length:', thinkingBlock.thinking.length);
            thinkingCallback(thinkingBlock.thinking);
          }
        }
      }

      // If no tool calls, we have final response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalResponse = response.content;
        // Stream the response if callback provided (iteration 1 uses non-streaming mode)
        if (streamCallback && response.content) {
          streamCallback(response.content);
        }

        // Add final assistant response to history before breaking
        messages.push({
          role: 'assistant',
          content: response.fullContent || [{ type: 'text', text: response.content }]
        });

        console.log('[ClaudeClient] Final response received, breaking loop');
        break;
      }

      // Execute tool calls
      console.log(`Claude requested ${response.toolCalls.length} tool calls`);

      // If Claude provided intro text along with tool calls, stream it immediately
      // This shows the user what Claude is about to do (e.g., "Let me search for that...")
      if (response.content && response.content.trim() && streamCallback) {
        streamCallback(response.content);
      }

      // Add assistant's response to history (including thinking blocks)
      messages.push({
        role: 'assistant',
        content: response.fullContent || [] // Use full content including thinking blocks
      });

      // Execute tools and collect results
      const toolResults = [];
      for (const toolCall of response.toolCalls) {
        try {
          // Notify that tool execution is starting
          console.log('[ClaudeClient] Calling toolActivityCallback (start):', toolCall.name, toolCall.id);
          toolActivityCallback?.({
            type: 'start',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs: toolCall.input
          });

          const result = await executeToolCallback(toolCall.name, toolCall.input);

          // Extract text from MCP result
          let resultText = '';
          if (result.content && Array.isArray(result.content)) {
            resultText = result.content
              .filter((item: any) => item.type === 'text')
              .map((item: any) => item.text)
              .join('\n');
          } else if (typeof result === 'string') {
            resultText = result;
          } else {
            resultText = JSON.stringify(result);
          }

          // Notify that tool execution completed
          console.log('[ClaudeClient] Calling toolActivityCallback (complete):', toolCall.name, toolCall.id);
          toolActivityCallback?.({
            type: 'complete',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: resultText
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: resultText
          });
        } catch (error) {
          console.error(`Tool execution error for ${toolCall.name}:`, error);
          const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;

          // Notify that tool execution failed
          toolActivityCallback?.({
            type: 'complete',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: errorMessage,
            isError: true
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: errorMessage,
            is_error: true
          });
        }
      }

      // Add tool results to history
      messages.push({
        role: 'user',
        content: toolResults
      });
    }

    if (iterations >= maxIterations) {
      console.warn('[ClaudeClient] Max tool calling iterations reached');
      finalResponse = finalResponse || 'I apologize, but I encountered too many tool calls. Please try rephrasing your question.';
    }

    console.log('[ClaudeClient] Returning final response, length:', finalResponse.length);
    return {
      response: finalResponse,
      messages: messages
    };
  }
}
