# Known Issues

This document tracks known issues, limitations, and problems encountered with the Interface Prototype frontend.

---

## Issue #1: Auto-scroll to User Question on Follow-up

**Status:** RESOLVED
**Severity:** MEDIUM
**Date discovered:** 2025-11-20
**Date resolved:** 2025-11-21

**Description:**

When a user sends a follow-up question, the interface should automatically scroll to position the user's question at the top of the viewport (with ~50px offset), similar to Claude Desktop behavior. The assistant response should then stream below the fixed user question.

**Root cause:**

The fundamental issue was a **timing problem with content availability**:

1. When user sends a message, it's added to the DOM
2. We attempt to scroll the user message to the top
3. BUT: The assistant response hasn't started streaming yet, so there's not enough content below the user message
4. The browser caps `scrollTop` at the maximum available scroll height
5. Result: The scroll doesn't reach the target position

**Solution:**

Implemented a two-part solution in `Chat.svelte`:

1. **Dynamic spacer element**: Added a conditional spacer (`showSpacer`) that creates scroll space equal to viewport height minus header/input (`calc(100vh - 12rem)`)
   - Spacer shows when user sends message (enabling full scroll)
   - Spacer hides when assistant response completes (removing empty space)
   - Spacer reappears for next follow-up question

2. **Immediate scroll on send**: Scroll the user message immediately when sent (not when response starts streaming), using `tick()` and manual `scrollTo()` calculation with 50px top offset

**Implementation:**

```javascript
// State variable
let showSpacer = false;

// Show spacer when user sends message
function handleSend(event) {
  const messageId = `msg-${Date.now()}`;
  messages = [...messages, { role: 'user', content: userMessage, id: messageId }];
  showSpacer = true;

  // Scroll immediately
  tick().then(() => {
    const messageElement = document.getElementById(messageId);
    if (messageElement && chatContainer) {
      const containerRect = chatContainer.getBoundingClientRect();
      const messageRect = messageElement.getBoundingClientRect();
      const messageOffsetTop = chatContainer.scrollTop + (messageRect.top - containerRect.top);
      const topOffset = 50; // Pixels from top
      chatContainer.scrollTo({
        top: messageOffsetTop - topOffset,
        behavior: 'smooth'
      });
    }
  });
}

// Hide spacer when response completes
function handleMessage(data) {
  if (data.type === 'assistant_message' && data.done) {
    showSpacer = false;
  }
}
```

```svelte
<!-- Conditional spacer in template -->
{#if showSpacer}
  <div class="scroll-spacer"></div>
{/if}
```

```css
.scroll-spacer {
  height: calc(100vh - 12rem);
  flex-shrink: 0;
}
```

**Result:**

Follow-up questions now scroll to the top of the viewport smoothly with proper offset, and the spacer disappears after the response completes to avoid unnecessary empty space.
