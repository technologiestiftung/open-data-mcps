# Known Issues

This document tracks known issues, limitations, and problems encountered with the Interface Prototype backend.

---

## Issue #1: Conversation History Loss Causing Claude Hallucinations

**Status:** Resolved
**Severity:** CRITICAL
**Date discovered:** 2025-11-20
**Date resolved:** 2025-11-20

**Description:**

The interface was experiencing significantly lower quality responses compared to Claude Desktop, with Claude fabricating datasets that did not exist in the Berlin Open Data Portal.

**Root cause:**

The `websocket-handler.ts` was only saving simple text messages to conversation history:

```typescript
// BROKEN CODE:
history.push({ role: 'user', content });
history.push({ role: 'assistant', content: response });
```

However, the actual conversation with Claude includes **all tool calls and tool results**. The `sendMessageWithTools` function was building up the complete history internally (with `tool_use` and `tool_result` blocks), but only returning the final text response. This meant:

- Claude had **no memory** of what tools it called
- Claude had **no memory** of what data it received from tools
- Each new message started **completely fresh** with zero context
- This caused **hallucination** - Claude didn't remember it should use tools and fabricated responses

**Example of broken behavior:**

1. User: "Show me air quality datasets"
   - Claude calls `search_berlin_datasets` tool, gets 40 real results
   - Responds with list of real datasets
   - **BUT**: History only saves "User: Show me..." and "Assistant: Here are 40 datasets..."

2. User: "Tell me more about the first one"
   - Claude has NO memory of the search results (tool calls lost)
   - Makes up fake dataset information instead of using real data

**Impact:**

- CRITICAL: Users received fabricated information about datasets
- Claude's behavior was significantly worse than Claude Desktop
- Undermined trust in the system
- Could lead to incorrect decisions based on fake data

**Solution implemented:**

Modified `claude-client.ts` to return both response text AND complete message history:

```typescript
// FIXED CODE:
async sendMessageWithTools(...): Promise<{ response: string; messages: ConversationMessage[] }> {
  // ... tool calling loop ...
  return {
    response: finalResponse,
    messages: messages  // Complete history with all tool calls and results
  };
}
```

Modified `websocket-handler.ts` to save complete history:

```typescript
// FIXED CODE:
const result = await this.claudeClient.sendMessageWithTools(...);
this.conversationHistory.set(ws, result.messages);  // Save EVERYTHING
```

Added system prompt explicitly instructing Claude to use tools and never fabricate data.

**Verification:**

After fix, Claude correctly:
- Remembers previous tool calls and their results
- Uses real data from MCP server
- Maintains context across multi-turn conversations
- Behavior matches Claude Desktop quality

---

## Issue #2: Claude Model Deprecation and Availability Issues

**Status:** Resolved with workaround
**Severity:** HIGH
**Date discovered:** 2025-11-20
**Date resolved:** 2025-11-20 (workaround)

**Description:**

Multiple Claude model IDs that previously worked started returning 404 or 529 errors, preventing the application from functioning.

**Timeline of issues:**

1. **Original model**: `claude-3-5-sonnet-20241022`
   - Worked previously
   - Now returns: `404 not_found_error` - Model no longer exists

2. **Upgraded to**: `claude-sonnet-4-5-20250929`
   - Based on commit c0ffb26
   - Returns: `529 overloaded_error` - Consistent overload, not just temporary

3. **Tried alternatives**:
   - `claude-3-5-sonnet-20240620` → 404
   - `claude-3-5-sonnet-latest` → 404
   - `claude-3-5-sonnet` → 404
   - `claude-3-opus-20240229` → 404
   - All Claude 3.x models deprecated

**Root cause:**

Anthropic deprecated Claude 3.5 Sonnet models and replaced them with Claude 4.x models:
- All `claude-3-5-sonnet-*` model IDs return 404
- `claude-sonnet-4-5-20250929` exists but has availability issues (consistent 529 errors)
- Date `20250929` (September 2025) suggests limited beta availability

**Solution implemented:**

Switched to `claude-haiku-4-5` (using alias instead of dated version):
- Haiku 4.5 is a smaller, faster model
- Has better API availability (no 529 errors)
- Works reliably for the application's needs

**Trade-offs:**

- Haiku is less capable than Sonnet for complex reasoning
- BUT: For tool calling and data retrieval tasks, Haiku performs adequately
- Can switch back to Sonnet when availability improves

**Related discovery:**

The Anthropic SDK version (0.32.0) was initially suspected but was not the issue. The SDK works correctly with the new model IDs.

---

## Issue #3: Tool Schema Format Change Requirement

**Status:** Resolved
**Severity:** HIGH
**Date discovered:** 2025-11-20
**Date resolved:** 2025-11-20

**Description:**

When attempting to use the original code (without tool transformation), the API returned:

```
400 invalid_request_error: tools.0.custom.input_schema: Field required
```

**Root cause:**

MCP tools use `inputSchema` (camelCase) but Claude API expects `input_schema` (snake_case). The original code passed tools directly with `tools: tools as any`, which worked with older API versions but no longer works.

**Solution implemented:**

Added tool transformation in `claude-client.ts`:

```typescript
private transformToolsForClaude(mcpTools: Tool[]): any[] {
  return mcpTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema  // Transform camelCase to snake_case
  }));
}
```

**Impact:**

- Required for all API calls with tools
- Without transformation, all requests return 400 errors
- This change was introduced in commit c0ffb26 and is now mandatory

---

## Issue #4: Intermittent 529 Overloaded Errors

**Status:** Ongoing
**Severity:** MEDIUM
**Date discovered:** 2025-11-20

**Description:**

Occasional `529 overloaded_error` responses from Anthropic API, even with working model (Haiku 4.5).

**Characteristics:**

- Intermittent - not consistent
- Returns `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":null}`
- More frequent during initial testing (possibly due to rapid successive requests)
- Less frequent during normal usage

**Root cause:**

Anthropic's API servers experiencing temporary load spikes. This is a server-side issue, not related to client code.

**Current handling:**

User sees error message in UI. No automatic retry implemented yet.

**Potential improvements:**

1. Add automatic retry logic with exponential backoff for 529 errors
2. Show user-friendly "Service temporarily busy, retrying..." message instead of raw error
3. Implement request queuing to reduce burst load

---

## Limitations

### Model Selection

Currently using Claude Haiku 4.5 instead of Sonnet due to availability issues. Haiku is:
- Faster and cheaper than Sonnet
- Adequate for tool calling and data retrieval
- Less capable for complex reasoning or analysis

When Sonnet 4.5 availability improves, may want to switch back for better quality responses.

### Error Handling

Error messages shown to users are raw technical errors from the API. Should be improved to:
- Hide technical details
- Show user-friendly messages
- Provide actionable guidance

### API Key Configuration

Currently requires manual .env file setup. Could be improved with:
- API key validation on startup
- Clear error messages if key is missing or invalid
- Ability to test/validate key without making full requests
