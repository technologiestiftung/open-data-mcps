<!-- ABOUTME: Individual message component -->
<!-- ABOUTME: Displays user or assistant messages with appropriate styling -->

<script>
  import { marked } from 'marked';
  import { onMount } from 'svelte';

  export let role = 'user'; // 'user' or 'assistant'
  export let content = '';

  let htmlContent = '';

  // Register Datawrapper height listener once globally
  // This handles the postMessage communication that the embedded script would normally do
  onMount(() => {
    const handleDatawrapperMessage = (event) => {
      if (event.data && event.data['datawrapper-height']) {
        const heights = event.data['datawrapper-height'];
        const iframes = document.querySelectorAll('iframe');
        for (const chartId in heights) {
          for (const iframe of iframes) {
            if (iframe.contentWindow === event.source) {
              iframe.style.height = heights[chartId] + 'px';
            }
          }
        }
      }
    };

    window.addEventListener('message', handleDatawrapperMessage);

    return () => {
      window.removeEventListener('message', handleDatawrapperMessage);
    };
  });

  // Parse markdown to HTML, handle [CHART:...] markers, and add target="_blank" to external links
  $: {
    // Check if content contains chart markers (debug)
    if (content.includes('[CHART:')) {
      console.log('[Message.svelte] Content contains CHART marker');
      console.log('[Message.svelte] Raw content:', content.substring(0, 500));
    }

    // Parse markdown first
    let html = marked.parse(content);

    if (content.includes('[CHART:')) {
      console.log('[Message.svelte] HTML after markdown parse:', html.substring(0, 500));
    }

    // Extract and replace [CHART:...] markers with embedded iframes
    // Try multiple patterns to catch the chart markers
    const patterns = [
      // Pattern 1: Already escaped HTML entities
      /\[CHART:([^\]]+)\]\s*&lt;iframe([^&]*)&gt;.*?&lt;\/iframe&gt;\s*\[\/CHART\]/gs,
      // Pattern 2: Normal HTML
      /\[CHART:([^\]]+)\]\s*<iframe([^>]*)>.*?<\/iframe>\s*\[\/CHART\]/gs,
      // Pattern 3: Within <p> tags
      /<p>\[CHART:([^\]]+)\]\s*&lt;iframe([^&]*)&gt;.*?&lt;\/iframe&gt;\s*\[\/CHART\]<\/p>/gs,
      // Pattern 4: Split across elements
      /\[CHART:([^\]]+)\][\s\S]*?<iframe[^>]*>.*?<\/iframe>[\s\S]*?\[\/CHART\]/gs,
    ];

    let matched = false;
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        console.log('[Message.svelte] Matched pattern:', pattern);
        matched = true;
        html = html.replace(pattern, (match, chartId, ...rest) => {
          console.log('[Message.svelte] Replacing chart marker for:', chartId);
          console.log('[Message.svelte] Full match:', match);

          // Extract iframe from the match
          let iframeMatch = match.match(/(<iframe[^>]*>.*?<\/iframe>|&lt;iframe[^&]*&gt;.*?&lt;\/iframe&gt;)/s);
          if (!iframeMatch) {
            console.error('[Message.svelte] Could not extract iframe from match');
            return match;
          }

          let iframe = iframeMatch[1];

          // Decode HTML entities if present
          if (iframe.includes('&lt;')) {
            iframe = iframe
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, '&');
          }

          console.log('[Message.svelte] Final iframe:', iframe);
          return `<div class="chart-embed">${iframe}</div>`;
        });
        break;
      }
    }

    if (content.includes('[CHART:') && !matched) {
      console.warn('[Message.svelte] Chart marker found but no pattern matched!');
      console.log('[Message.svelte] HTML to match against:', html);
    }

    // Add target="_blank" to external links
    htmlContent = html.replace(
      /<a href="(https?:\/\/[^"]+)"([^>]*)>/g,
      '<a href="$1"$2 target="_blank" rel="noopener noreferrer">'
    );
  }
</script>

<div class="message {role}">
  <div class="message-content">
    {@html htmlContent}
  </div>
</div>

<style>
  .message {
    width: 100%;
    padding: 1.2rem 1rem;
  }

  .message.user {
    background-color: white;
  }

  .message.assistant {
    background-color: #f9f9f9;
  }

  .message-content {
    word-wrap: break-word;
    line-height: 1.7;
    font-size: 1rem;
    color: #1a1a1a;
  }

  /* Markdown styling */
  .message-content :global(h1) {
    font-size: 1.875rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 1rem;
    color: #111827;
    line-height: 1.3;
  }

  .message-content :global(h2) {
    font-size: 1.5rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: #111827;
    line-height: 1.3;
  }

  .message-content :global(h3) {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 1.25rem;
    margin-bottom: 0.5rem;
    color: #374151;
    line-height: 1.4;
  }

  .message-content :global(h4) {
    font-size: 1.125rem;
    font-weight: 600;
    margin-top: 1rem;
    margin-bottom: 0.5rem;
    color: #374151;
    line-height: 1.4;
  }

  .message-content :global(p) {
    margin-top: 0;
    margin-bottom: 1rem;
  }

  .message-content :global(p:last-child) {
    margin-bottom: 0;
  }

  .message-content :global(ul),
  .message-content :global(ol) {
    margin-top: 0.75rem;
    margin-bottom: 1rem;
    padding-left: 1.75rem;
  }

  .message-content :global(li) {
    margin-bottom: 0.5rem;
  }

  .message-content :global(li > p) {
    margin-bottom: 0.5rem;
  }

  .message-content :global(strong) {
    font-weight: 600;
    color: #111827;
  }

  .message-content :global(em) {
    font-style: italic;
  }

  .message-content :global(code) {
    background-color: #f3f4f6;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
    font-size: 0.875em;
    color: #1f2937;
  }

  .message-content :global(pre) {
    background-color: #1f2937;
    color: #f9fafb;
    padding: 1rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin-top: 0.75rem;
    margin-bottom: 1rem;
  }

  .message-content :global(pre code) {
    background-color: transparent;
    padding: 0;
    color: inherit;
    font-size: 0.875rem;
  }

  .message-content :global(a) {
    color: #2563eb;
    text-decoration: none;
  }

  .message-content :global(a:hover) {
    text-decoration: underline;
  }

  .message-content :global(blockquote) {
    border-left: 3px solid #d1d5db;
    padding-left: 1rem;
    margin-left: 0;
    margin-right: 0;
    color: #6b7280;
  }

  .message-content :global(hr) {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 1.5rem 0;
  }

  .message-content :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 1rem 0;
    font-size: 0.875rem;
  }

  .message-content :global(th),
  .message-content :global(td) {
    border: 1px solid #e5e7eb;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }

  .message-content :global(th) {
    background-color: #f9fafb;
    font-weight: 600;
    color: #374151;
  }

  .message-content :global(td) {
    color: #1f2937;
  }

  /* Chart embed styling */
  .message-content :global(.chart-embed) {
    margin: 2rem;
    padding: 0;
    overflow: visible;
  }

  .message-content :global(.chart-embed iframe) {
    width: 100%;
    min-height: 400px;
    border: none;
    display: block;
    margin: 0;
    padding: 0;
    pointer-events: auto;
  }
</style>
