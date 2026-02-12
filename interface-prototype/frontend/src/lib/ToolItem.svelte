<!-- ABOUTME: Single tool display component showing tool execution status and results -->
<!-- ABOUTME: Displays active tool as spinner or completed tool as expandable badge -->

<script>
  export let tool;

  let expanded = false;

  function toggleExpanded() {
    expanded = !expanded;
  }

  // Convert snake_case to Title Case for display
  function formatToolName(name) {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
</script>

{#if !tool.completed}
  <!-- Active tool with spinner -->
  <div class="active-tool">
    <span class="spinner"></span>
    <span>{formatToolName(tool.name)}...</span>
  </div>
{:else}
  <!-- Completed tool as collapsible badge -->
  <div class="tool-item">
    <button
      class="tools-badge"
      class:error={tool.isError}
      on:click={toggleExpanded}
    >
      <span class="badge-icon">🔧</span>
      <span class="badge-text">{formatToolName(tool.name)}</span>
      {#if tool.isError}
        <span class="error-indicator">⚠</span>
      {/if}
      <span class="expand-icon">{expanded ? '▼' : '▶'}</span>
    </button>

    {#if expanded}
      <div class="tool-details">
        {#if tool.args}
          <details class="tool-section" open>
            <summary>Anfrage</summary>
            {#if tool.args.code}
              <!-- Special handling for code parameter -->
              {#if Object.keys(tool.args).length > 1}
                <!-- Show other parameters if they exist -->
                <pre class="tool-content">{JSON.stringify(
                  Object.fromEntries(Object.entries(tool.args).filter(([k]) => k !== 'code')),
                  null,
                  2
                )}</pre>
              {/if}
              <div class="code-label">Code:</div>
              <pre class="tool-content code-block">{tool.args.code}</pre>
            {:else}
              <pre class="tool-content">{JSON.stringify(tool.args, null, 2)}</pre>
            {/if}
          </details>
        {/if}

        {#if tool.result}
          <details class="tool-section">
            <summary>Antwort</summary>
            <div class="tool-content result">{tool.result}</div>
          </details>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .active-tool {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    margin: 0.5rem 0;
    background: #f3f4f6;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: #4b5563;
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

  .tool-item {
    display: flex;
    flex-direction: column;
    margin: 0.5rem 0;
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
