<!-- ABOUTME: Tool activity component showing tool execution status and results -->
<!-- ABOUTME: Displays active tools as status indicators and completed tools as expandable badges -->

<!--
  Hybrid tool activity display:

  DURING EXECUTION:
  - Shows Claude's thinking text before each tool (introText)
  - Shows active tools with animated spinner
  - Displays friendly tool name (e.g., "Searching Berlin Datasets...")
  - Multiple tools can be shown simultaneously

  AFTER COMPLETION:
  - Shows Claude's thinking text before each tool (introText)
  - Shows collapsible badge: "🔧 Tool Name"
  - Clicking expands to show details for each tool:
    - Tool name and error status
    - Input arguments (JSON)
    - Results or error message

  PROPS:
  - toolCalls: Array of tool call objects
    - id: unique identifier
    - name: tool name (snake_case from MCP)
    - args: arguments object
    - completed: boolean
    - introText: Claude's thinking before this tool (optional)
    - result: result text (if completed)
    - isError: boolean (if completed with error)
-->

<script>
  import { marked } from 'marked';

  export let toolCalls = [];
  export let streamingThinkingText = '';

  let expandedCalls = new Set();

  function toggleExpanded(id) {
    if (expandedCalls.has(id)) {
      expandedCalls.delete(id);
    } else {
      expandedCalls.add(id);
    }
    expandedCalls = expandedCalls;
  }

  // Convert snake_case to Title Case for display
  function formatToolName(name) {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Reactive statements to separate active and completed tool calls
  $: activeCalls = toolCalls.filter(call => !call.completed);
  $: completedCalls = toolCalls.filter(call => call.completed);
</script>

{#if streamingThinkingText}
  <div class="streaming-thinking">
    {@html marked.parse(streamingThinkingText)}
  </div>
{/if}

{#if activeCalls.length > 0}
  {#each activeCalls as call}
    <div class="active-tools">
      <div class="active-tool">
        <span class="spinner"></span>
        <span>{formatToolName(call.name)}...</span>
      </div>
    </div>
  {/each}
{/if}

{#if completedCalls.length > 0}
  <div class="completed-tools">
    {#each completedCalls as call}
      {#if call.introText}
        <div class="intro-text">
          {@html marked.parse(call.introText)}
        </div>
      {/if}
      <div class="tool-item">
        <button
          class="tools-badge"
          class:error={call.isError}
          on:click={() => toggleExpanded(call.id)}
        >
          <span class="badge-icon">🔧</span>
          <span class="badge-text">{formatToolName(call.name)}</span>
          {#if call.isError}
            <span class="error-indicator">⚠</span>
          {/if}
          <span class="expand-icon">{expandedCalls.has(call.id) ? '▼' : '▶'}</span>
        </button>

        {#if expandedCalls.has(call.id)}
          <div class="tool-details">
            {#if call.args}
              <details class="tool-section" open>
                <summary>Anfrage</summary>
                {#if call.args.code}
                  <!-- Special handling for code parameter -->
                  {#if Object.keys(call.args).length > 1}
                    <!-- Show other parameters if they exist -->
                    <pre class="tool-content">{JSON.stringify(
                      Object.fromEntries(Object.entries(call.args).filter(([k]) => k !== 'code')),
                      null,
                      2
                    )}</pre>
                  {/if}
                  <div class="code-label">Code:</div>
                  <pre class="tool-content code-block">{call.args.code}</pre>
                {:else}
                  <pre class="tool-content">{JSON.stringify(call.args, null, 2)}</pre>
                {/if}
              </details>
            {/if}

            {#if call.result}
              <details class="tool-section">
                <summary>Antwort</summary>
                <div class="tool-content result">{call.result}</div>
              </details>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .streaming-thinking,
  .intro-text {
    padding: 0.75rem 1rem;
    word-wrap: break-word;
    line-height: 1.7;
    font-size: 1rem;
    color: #1a1a1a;
  }

  /* Markdown styling - match Message.svelte */
  .streaming-thinking :global(p),
  .intro-text :global(p) {
    margin-top: 0;
    margin-bottom: 1rem;
  }

  .streaming-thinking :global(p:last-child),
  .intro-text :global(p:last-child) {
    margin-bottom: 0;
  }

  .streaming-thinking :global(strong),
  .intro-text :global(strong) {
    font-weight: 600;
    color: #111827;
  }

  .streaming-thinking :global(em),
  .intro-text :global(em) {
    font-style: italic;
  }

  .streaming-thinking :global(code),
  .intro-text :global(code) {
    background-color: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
    font-size: 0.875em;
    color: #1f2937;
  }

  .active-tools {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    margin: 0.5rem 0;
    background: #f3f4f6;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: #4b5563;
  }

  .active-tool {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .completed-tools {
    margin: 0.5rem 0;
    padding: 0.75rem 1rem;
    background: #f9f9f9;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tool-item {
    display: flex;
    flex-direction: column;
  }

  .tools-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s;
    width: fit-content;
  }

  .tools-badge:hover {
    background: #f3f4f6;
    border-color: #d1d5db;
  }

  .tools-badge.error {
    border-color: #fecaca;
    background: #fef2f2;
  }

  .error-indicator {
    color: #dc2626;
    font-size: 1rem;
  }

  .badge-icon {
    font-size: 1rem;
  }

  .badge-text {
    font-weight: 500;
  }

  .expand-icon {
    font-size: 0.75rem;
    margin-left: auto;
  }

  .tool-details {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .tool-section {
    margin-top: 0.5rem;
  }

  .tool-section summary {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #6b7280;
    cursor: pointer;
    user-select: none;
    padding: 0.25rem 0;
  }

  .tool-section summary:hover {
    color: #374151;
  }

  .tool-content {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: #f9fafb;
    border-radius: 0.25rem;
    font-size: 0.8125rem;
    color: #374151;
    overflow-x: auto;
  }

  .tool-content.result {
    white-space: pre-wrap;
    word-break: break-word;
  }

  pre.tool-content {
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    line-height: 1.5;
  }

  .code-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #6b7280;
    margin-top: 0.5rem;
    margin-bottom: 0.25rem;
  }

  pre.code-block {
    background: #1e293b;
    color: #e2e8f0;
    padding: 0.75rem;
    border-radius: 0.375rem;
    overflow-x: auto;
    line-height: 1.6;
    margin-top: 0;
  }
</style>
