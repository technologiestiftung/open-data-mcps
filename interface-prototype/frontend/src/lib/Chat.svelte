<!-- ABOUTME: Main chat container component -->
<!-- ABOUTME: Manages WebSocket connection and displays message history -->

<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import Message from './Message.svelte';
  import Input from './Input.svelte';
  import ToolItem from './ToolItem.svelte';

  let messages = [];
  let ws = null;
  let connected = false;
  let waiting = false;
  let error = null;
  let showSpacer = false;

  onMount(() => {
    connectWebSocket();
  });

  onDestroy(() => {
    if (ws) {
      ws.close();
    }
  });

  function triggerDownload(filename, content, mimeType) {
    // Create a Blob from the content
    const blob = new Blob([content], { type: mimeType });

    // Create a temporary URL for the blob
    const url = URL.createObjectURL(blob);

    // Create a temporary anchor element and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = import.meta.env.DEV ? '3000' : window.location.port;
    const wsUrl = `${protocol}//${window.location.hostname}:${port}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      connected = true;
      error = null;
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleMessage(data);
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      error = 'Connection error';
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      connected = false;

      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (!connected) {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }
      }, 3000);
    };
  }

  function handleMessage(data) {
    // console.log('[Frontend] Received message:', data.type, data);

    if (data.type === 'status') {
      console.log('Status:', data.status);
    } else if (data.type === 'thinking_block') {
      // Thinking block received - add to current assistant message
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage.items) {
          lastMessage.items = [];
        }

        const lastItem = lastMessage.items[lastMessage.items.length - 1];

        // If last item is thinking, append to it; otherwise create new thinking item
        if (lastItem && lastItem.type === 'thinking') {
          lastItem.content += data.thinking;
        } else {
          lastMessage.items.push({
            type: 'thinking',
            content: data.thinking
          });
        }
        messages = messages; // Trigger reactivity
      } else {
        // Start new assistant message with thinking
        const messageId = `msg-${Date.now()}`;
        const newMessage = {
          role: 'assistant',
          streaming: true,
          id: messageId,
          items: [{
            type: 'thinking',
            content: data.thinking
          }]
        };
        messages = [...messages, newMessage];
      }
    } else if (data.type === 'tool_call_start') {
      // Tool execution started - append tool item to chronological list
      const newToolItem = {
        type: 'tool',
        id: data.toolCallId,
        name: data.toolName,
        args: data.toolArgs,
        completed: false
      };

      // Add to current assistant message
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        if (!messages[messages.length - 1].items) {
          messages[messages.length - 1].items = [];
        }
        messages[messages.length - 1].items = [...messages[messages.length - 1].items, newToolItem];
        messages = messages; // Trigger reactivity
      }
    } else if (data.type === 'tool_call_complete') {
      // Tool execution completed - update the tool item
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].items) {
        messages[messages.length - 1].items = messages[messages.length - 1].items.map(item =>
          item.type === 'tool' && item.id === data.toolCallId
            ? { ...item, completed: true, result: data.result, isError: data.isError }
            : item
        );
        messages = messages; // Trigger reactivity
      }
    } else if (data.type === 'file_download') {
      // File download ready - trigger browser download
      triggerDownload(data.filename, data.content, data.mimeType);
    } else if (data.type === 'assistant_message_chunk') {
      // Streaming text chunk - append to last text item or create new one
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        // Append to existing assistant message (may contain tools from previous iteration)
        const lastMessage = messages[messages.length - 1];
        lastMessage.streaming = true; // Mark as streaming
        if (!lastMessage.items) {
          lastMessage.items = [];
        }

        const lastItem = lastMessage.items[lastMessage.items.length - 1];

        // If last item is text, append to it; otherwise create new text item
        if (lastItem && lastItem.type === 'text') {
          lastItem.content += data.content;
        } else {
          lastMessage.items.push({
            type: 'text',
            content: data.content
          });
        }
        messages = messages; // Trigger reactivity
      } else {
        // Start new streaming assistant message
        const messageId = `msg-${Date.now()}`;
        const newMessage = {
          role: 'assistant',
          streaming: true,
          id: messageId,
          items: [{
            type: 'text',
            content: data.content
          }]
        };
        messages = [...messages, newMessage];
      }
    } else if (data.type === 'assistant_message') {
      if (data.done) {
        // Mark last message as complete
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
          delete messages[messages.length - 1].streaming;
          messages = messages; // Trigger reactivity
        }
        waiting = false;
        showSpacer = false;
      } else {
        // Non-streaming message (fallback)
        const messageId = `msg-${Date.now()}`;
        messages = [...messages, {
          role: 'assistant',
          id: messageId,
          items: data.content ? [{
            type: 'text',
            content: data.content
          }] : []
        }];
        waiting = false;
      }
    } else if (data.type === 'error') {
      error = data.error;
      waiting = false;
    }
  }

  let chatContainer;

  function handleSend(event) {
    const { message: userMessage, file } = event.detail;

    // Build display content - include filename if file attached
    const displayContent = file
      ? (userMessage ? `${userMessage}\n\n📎 ${file.name}` : `📎 ${file.name}`)
      : userMessage;

    // Add user message to UI with unique ID
    const messageId = `msg-${Date.now()}`;
    messages = [...messages, { role: 'user', content: displayContent, id: messageId }];

    waiting = true;
    error = null;
    showSpacer = true;

    // Scroll the user message to top immediately after it's added
    tick().then(() => {
      const messageElement = document.getElementById(messageId);
      if (messageElement && chatContainer) {
        // Get current scroll position and element positions
        const containerRect = chatContainer.getBoundingClientRect();
        const messageRect = messageElement.getBoundingClientRect();

        // Calculate where the message currently is in the container
        const messageOffsetTop = chatContainer.scrollTop + (messageRect.top - containerRect.top);

        // Scroll so the message is at the top of the container with some offset
        const topOffset = 50; // Pixels from top of viewport
        chatContainer.scrollTo({
          top: messageOffsetTop - topOffset,
          behavior: 'smooth'
        });
      }
    });

    // Send to backend
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (file) {
        // Send file upload message
        ws.send(JSON.stringify({
          type: 'file_upload',
          content: userMessage,
          file: file
        }));
      } else {
        // Send regular user message
        ws.send(JSON.stringify({
          type: 'user_message',
          content: userMessage
        }));
      }
    } else {
      error = 'Not connected to server';
      waiting = false;
    }
  }

  function handleInputError(event) {
    error = event.detail.message;
  }


</script>

<div class="chat-container">
  <div class="messages-wrapper" bind:this={chatContainer}>
    <div class="messages">
      {#if messages.length === 0}
        <div class="welcome">
          <h2>Berlin Simple Open Data</h2>
          <p>Finde und erkunde Daten aus dem Berliner Open Data Portal</p>
          {#if !connected}
            <div class="connection-status">
              <span class="status-dot"></span>
              Connecting to server...
            </div>
          {/if}
        </div>
      {/if}

      {#each messages as message, i (message.id || i)}
        {#if message.role === 'user'}
          <div id={message.id}>
            <Message role={message.role} content={message.content} />
          </div>
        {:else if message.role === 'assistant'}
          {#if message.items}
            {#each message.items as item, j (item.id || j)}
              {#if item.type === 'thinking'}
                <div class="thinking-block">
                  <div class="thinking-header">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M12 16v-4M12 8h.01"/>
                    </svg>
                    <span>Claude denkt nach...</span>
                  </div>
                  <details>
                    <summary>Zeige Denkprozess</summary>
                    <div class="thinking-content">{item.content}</div>
                  </details>
                </div>
              {:else if item.type === 'text'}
                <Message role="assistant" content={item.content} />
              {:else if item.type === 'tool'}
                <ToolItem tool={item} />
              {/if}
            {/each}
          {/if}
        {/if}
      {/each}

      {#if waiting}
        <div class="loading">
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
        </div>
      {/if}

      {#if error}
        <div class="error-message">{error}</div>
      {/if}

      <!-- Spacer to ensure there's always scroll space for messages to reach the top -->
      {#if showSpacer}
        <div class="scroll-spacer"></div>
      {/if}
    </div>
  </div>

  <div class="input-wrapper">
    <Input on:send={handleSend} on:error={handleInputError} disabled={!connected || waiting} />
  </div>
</div>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #f9f9f9;
  }

  .messages-wrapper {
    flex: 1;
    overflow-y: auto;
    display: flex;
    justify-content: center;
  }

  .messages {
    width: 100%;
    max-width: 48rem;
    padding: 2rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0rem;
  }

  .scroll-spacer {
    /* Create scroll space equal to viewport height minus header/input */
    height: calc(100vh - 12rem);
    flex-shrink: 0;
  }

  .welcome {
    text-align: center;
    color: #6b7280;
    margin: auto;
    padding: 2rem;
  }

  .welcome h2 {
    color: #1a1a1a;
    font-size: 2rem;
    font-weight: 400;
    margin-bottom: 0.5rem;
  }

  .welcome p {
    font-size: 1rem;
    margin-bottom: 1.5rem;
  }

  .connection-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #9ca3af;
    margin-top: 1rem;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #fbbf24;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    color: #6b7280;
  }

  .loading-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #9ca3af;
    animation: loading 1.4s ease-in-out infinite;
  }

  .loading-dot:nth-child(1) {
    animation-delay: 0s;
  }

  .loading-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .loading-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes loading {
    0%, 80%, 100% {
      opacity: 0.3;
      transform: scale(1);
    }
    40% {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  .error-message {
    padding: 1rem;
    background-color: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 0.5rem;
    color: #991b1b;
    font-size: 0.875rem;
  }

  .input-wrapper {
    display: flex;
    justify-content: center;
    border-top: 1px solid #e5e7eb;
    background: white;
    padding: 1rem;
  }

  .thinking-block {
    margin: 0.5rem 0;
    padding: 0.75rem 1rem;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    font-size: 0.875rem;
  }

  .thinking-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #6b7280;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .thinking-header svg {
    flex-shrink: 0;
  }

  .thinking-block details {
    margin-top: 0.5rem;
  }

  .thinking-block summary {
    cursor: pointer;
    color: #3b82f6;
    font-size: 0.8125rem;
    padding: 0.25rem 0;
    list-style: none;
    user-select: none;
  }

  .thinking-block summary:hover {
    color: #2563eb;
    text-decoration: underline;
  }

  .thinking-block summary::-webkit-details-marker {
    display: none;
  }

  .thinking-content {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: white;
    border-radius: 0.375rem;
    color: #374151;
    font-size: 0.8125rem;
    line-height: 1.5;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
</style>
