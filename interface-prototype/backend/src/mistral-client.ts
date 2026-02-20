import { Mistral } from '@mistralai/mistralai';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ConversationMessage } from './types.js';

export interface MistralResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: string | null;
  fullContent?: any[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

type MistralMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; content: string; toolCallId: string; name?: string };

export class MistralClient {
  private client: Mistral;
  private model = 'mistral-small-latest';
  // mistral-large-latest for better quality; magistral-small-latest has reasoning support
  private systemPrompt = `You are an assistant helping users discover and analyze open data from Berlin's Open Data Portal.

You have access to tools that connect to the Berlin Open Data Portal. ALWAYS use these tools when users ask about datasets or data. NEVER make up or fabricate datasets, data, or analysis.

IMPORTANT: Always respond in the same language as the user's question. If the user writes in German, your responses must be in German. If in English, use English.

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
    this.client = new Mistral({ apiKey });
  }

  /**
   * Transform MCP tools to Mistral API format
   * MCP uses inputSchema, Mistral uses OpenAI-compatible format: type: "function", function: { name, description, parameters }
   */
  private transformToolsForMistral(mcpTools: Tool[]): any[] {
    return mcpTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }

  /**
   * Convert ConversationMessage[] (Claude format) to Mistral messages
   * Claude: assistant content can be array of blocks (text, tool_use, thinking); user with tool results has content as array of tool_result
   * Mistral: assistant has content string + tool_calls; tool results are separate { role: 'tool', content, tool_call_id } messages
   */
  private toMistralMessages(messages: ConversationMessage[]): MistralMessage[] {
    const result: MistralMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else {
          // Array of tool_result blocks - convert to tool messages
          for (const block of msg.content as any[]) {
            if (block.type === 'tool_result') {
              result.push({
                role: 'tool',
                content: block.content || '',
                toolCallId: block.tool_use_id,
                name: block.tool_name
              });
            }
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'assistant', content: msg.content });
        } else {
          const blocks = msg.content as any[];
          const textParts: string[] = [];
          const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

          for (const block of blocks) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {})
                }
              });
            }
          }

          result.push({
            role: 'assistant',
            content: textParts.join('\n') || '',
            ...(toolCalls.length > 0 && { toolCalls })
          });
        }
      }
    }

    return result;
  }

  /**
   * Convert Mistral response to ConversationMessage format for history
   */
  private toConversationMessage(
    content: string,
    toolCalls?: ToolCall[],
    fullContent?: any[]
  ): ConversationMessage {
    if (!toolCalls || toolCalls.length === 0) {
      return { role: 'assistant', content };
    }

    const blocks: any[] = [];
    if (content.length > 0) {
      blocks.push({ type: 'text', text: content });
    }
    for (const tc of toolCalls) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    return {
      role: 'assistant',
      content: fullContent || blocks
    };
  }

  /**
   * Send a message to Mistral with available tools
   */
  async sendMessage(
    messages: ConversationMessage[],
    tools: Tool[]
  ): Promise<MistralResponse> {
    try {
      console.log('[MistralClient] sendMessage: Preparing API request');
      const mistralTools = this.transformToolsForMistral(tools);
      const mistralMessages = this.toMistralMessages(messages);

      console.log('[MistralClient] sendMessage: Calling Mistral API...');
      const response = await this.client.chat.complete({
        model: this.model,
        maxTokens: 12000,
        messages: [
          { role: 'system', content: this.systemPrompt },
          ...mistralMessages
        ],
        tools: mistralTools.length > 0 ? mistralTools : undefined,
        toolChoice: mistralTools.length > 0 ? 'auto' : undefined
      });

      const choice = response.choices?.[0];
      const message = choice?.message;
      const rawContent = message?.content;
      const textContent = typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? (rawContent as any[]).filter((c: any) => c?.type === 'text').map((c: any) => c?.text ?? '').join('')
          : '';

      const toolCalls = message?.toolCalls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name ?? tc.name,
        input: (() => {
          try {
            const args = tc.function?.arguments ?? tc.arguments;
            return typeof args === 'string' ? JSON.parse(args) : args ?? {};
          } catch {
            return {};
          }
        })()
      })) ?? [];

      console.log('[MistralClient] sendMessage: API response received, id:', response.id, 'model:', response.model);

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason: choice?.finishReason ?? null,
        fullContent: message ? [{ type: 'text', text: textContent }, ...toolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input }))] : undefined
      };
    } catch (error) {
      console.error('Mistral API error:', error);
      throw error;
    }
  }

  /**
   * Send a message with streaming support
   */
  async sendMessageStreaming(
    messages: ConversationMessage[],
    tools: Tool[],
    streamCallback: (chunk: string) => void,
    _thinkingCallback?: (thinking: string) => void
  ): Promise<MistralResponse> {
    try {
      const mistralTools = this.transformToolsForMistral(tools);
      const mistralMessages = this.toMistralMessages(messages);

      const stream = await this.client.chat.stream({
        model: this.model,
        maxTokens: 12000,
        messages: [
          { role: 'system', content: this.systemPrompt },
          ...mistralMessages
        ],
        tools: mistralTools.length > 0 ? mistralTools : undefined,
        toolChoice: mistralTools.length > 0 ? 'auto' : undefined
      });

      let fullText = '';
      const toolCalls: ToolCall[] = [];
      const toolCallBuffers: Map<number, string> = new Map();

      for await (const event of stream) {
        const chunk = (event as any).data;
        const delta = chunk?.choices?.[0]?.delta;
        if (!delta) continue;

        const content = delta.content;
        const contentStr = typeof content === 'string' ? content : '';
        if (contentStr) {
          fullText += contentStr;
          streamCallback(contentStr);
        }

        if (delta.toolCalls) {
          for (const tc of delta.toolCalls) {
            const idx = tc.index ?? 0;
            // Always initialize slot so the array is never sparse
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: '', name: '', input: {} };
            }
            // Accumulate id and name as they may arrive in separate chunks
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].name = tc.function.name;
            const args = tc.function?.arguments;
            if (typeof args === 'string' && args) {
              toolCallBuffers.set(idx, (toolCallBuffers.get(idx) ?? '') + args);
            }
          }
        }
      }

      for (let i = 0; i < toolCalls.length; i++) {
        const buf = toolCallBuffers.get(i);
        if (buf && toolCalls[i]) {
          try {
            toolCalls[i].input = JSON.parse(buf);
          } catch {
            toolCalls[i].input = {};
          }
        }
      }

      // Filter out any incomplete tool calls (missing id or name) to keep counts consistent
      const validToolCalls = toolCalls.filter(tc => tc && tc.id && tc.name);

      return {
        content: fullText,
        toolCalls: validToolCalls.length > 0 ? validToolCalls : undefined,
        stopReason: 'stop',
        fullContent: validToolCalls.length > 0
          ? [{ type: 'text', text: fullText }, ...validToolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input }))]
          : [{ type: 'text', text: fullText }]
      };
    } catch (error) {
      console.error('Mistral API streaming error:', error);
      throw error;
    }
  }

  /**
   * Send message and handle tool calling loop
   */
  async sendMessageWithTools(
    userMessage: string,
    conversationHistory: ConversationMessage[],
    tools: Tool[],
    executeToolCallback: (name: string, args: any) => Promise<any>,
    streamCallback?: (chunk: string) => void,
    toolActivityCallback?: (activity: { type: 'start' | 'complete'; toolCallId: string; toolName: string; toolArgs?: any; result?: string; isError?: boolean }) => void,
    _thinkingCallback?: (thinking: string) => void
  ): Promise<{ response: string; messages: ConversationMessage[] }> {
    console.log('[MistralClient] sendMessageWithTools called with message:', userMessage);
    console.log('[MistralClient] Conversation history length:', conversationHistory.length);
    console.log('[MistralClient] Available tools:', tools.length);

    const messages: ConversationMessage[] = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    let finalResponse = '';
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;
      console.log(`[MistralClient] Iteration ${iterations}/${maxIterations}`);

      const isLikelyFinalResponse = iterations > 1;

      if (isLikelyFinalResponse && streamCallback) {
        const response = await this.sendMessageStreaming(messages, tools, streamCallback);

        if (!response.toolCalls || response.toolCalls.length === 0) {
          finalResponse = response.content;
          messages.push(this.toConversationMessage(response.content, undefined, response.fullContent));
          break;
        }

        messages.push(this.toConversationMessage(response.content, response.toolCalls, response.fullContent));

        const toolResults = [];
        for (const toolCall of response.toolCalls) {
          try {
            toolActivityCallback?.({ type: 'start', toolCallId: toolCall.id, toolName: toolCall.name, toolArgs: toolCall.input });
            const result = await executeToolCallback(toolCall.name, toolCall.input);

            let resultText = '';
            if (result?.content && Array.isArray(result.content)) {
              resultText = result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n');
            } else if (typeof result === 'string') {
              resultText = result;
            } else {
              resultText = JSON.stringify(result ?? '');
            }

            toolActivityCallback?.({ type: 'complete', toolCallId: toolCall.id, toolName: toolCall.name, result: resultText });
            toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, tool_name: toolCall.name, content: resultText });
          } catch (error) {
            const errMsg = `Error: ${error instanceof Error ? error.message : String(error)}`;
            toolActivityCallback?.({ type: 'complete', toolCallId: toolCall.id, toolName: toolCall.name, result: errMsg, isError: true });
            toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, tool_name: toolCall.name, content: errMsg, is_error: true });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      console.log('[MistralClient] Calling sendMessage (non-streaming)');
      const response = await this.sendMessage(messages, tools);
      console.log('[MistralClient] Response received, content length:', response.content.length, 'toolCalls:', response.toolCalls?.length || 0);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalResponse = response.content;
        if (streamCallback && response.content) {
          streamCallback(response.content);
        }
        messages.push(this.toConversationMessage(response.content, undefined, response.fullContent));
        console.log('[MistralClient] Final response received, breaking loop');
        break;
      }

      console.log(`Mistral requested ${response.toolCalls.length} tool calls`);

      if (response.content?.trim() && streamCallback) {
        streamCallback(response.content);
      }

      messages.push(this.toConversationMessage(response.content, response.toolCalls, response.fullContent));

      const toolResults = [];
      for (const toolCall of response.toolCalls) {
        try {
          console.log('[MistralClient] Calling toolActivityCallback (start):', toolCall.name, toolCall.id);
          toolActivityCallback?.({ type: 'start', toolCallId: toolCall.id, toolName: toolCall.name, toolArgs: toolCall.input });

          const result = await executeToolCallback(toolCall.name, toolCall.input);

          let resultText = '';
          if (result?.content && Array.isArray(result.content)) {
            resultText = result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n');
          } else if (typeof result === 'string') {
            resultText = result;
          } else {
            resultText = JSON.stringify(result ?? '');
          }

          console.log('[MistralClient] Calling toolActivityCallback (complete):', toolCall.name, toolCall.id);
          toolActivityCallback?.({ type: 'complete', toolCallId: toolCall.id, toolName: toolCall.name, result: resultText });
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, tool_name: toolCall.name, content: resultText });
        } catch (error) {
          const errMsg = `Error: ${error instanceof Error ? error.message : String(error)}`;
          toolActivityCallback?.({ type: 'complete', toolCallId: toolCall.id, toolName: toolCall.name, result: errMsg, isError: true });
          toolResults.push({ type: 'tool_result', tool_use_id: toolCall.id, tool_name: toolCall.name, content: errMsg, is_error: true });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    if (iterations >= maxIterations) {
      console.warn('[MistralClient] Max tool calling iterations reached');
      finalResponse = finalResponse || 'I apologize, but I encountered too many tool calls. Please try rephrasing your question.';
    }

    console.log('[MistralClient] Returning final response, length:', finalResponse.length);
    return { response: finalResponse, messages };
  }
}
