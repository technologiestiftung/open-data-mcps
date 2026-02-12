<!-- ABOUTME: Message input component with auto-growing textarea -->
<!-- ABOUTME: Handles user input, file attachments, and sends messages to parent -->

<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let inputValue = 'Gibt es Daten zu Kitas in Berlin?';
  let disabled = false;
  let textarea;
  let fileInput;
  let attachedFile = null;

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_EXTENSIONS = ['csv', 'json', 'geojson', 'xls', 'xlsx'];

  export { disabled };

  function getMimeType(ext) {
    const mimeTypes = {
      'csv': 'text/csv',
      'json': 'application/json',
      'geojson': 'application/geo+json',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size
    if (file.size > MAX_SIZE) {
      dispatch('error', { message: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 10 MB.` });
      fileInput.value = '';
      return;
    }

    // Validate extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      dispatch('error', { message: `Unsupported format: .${ext}. Supported: CSV, JSON, GeoJSON, Excel` });
      fileInput.value = '';
      return;
    }

    // Read as base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result.split(',')[1]; // Strip data URL prefix
      attachedFile = {
        name: file.name,
        mimeType: file.type || getMimeType(ext),
        data: base64Data,
        size: file.size
      };
    };
    reader.onerror = () => {
      dispatch('error', { message: 'Failed to read file' });
    };
    reader.readAsDataURL(file);
  }

  function removeFile() {
    attachedFile = null;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if ((inputValue.trim() || attachedFile) && !disabled) {
      dispatch('send', {
        message: inputValue.trim(),
        file: attachedFile
      });
      inputValue = '';
      attachedFile = null;
      if (fileInput) {
        fileInput.value = '';
      }
      if (textarea) {
        textarea.style.height = 'auto';
      }
    }
  }

  function handleKeyDown(e) {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleInput() {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  }
</script>

<form class="input-container" on:submit={handleSubmit}>
  <!-- Hidden file input -->
  <input
    type="file"
    bind:this={fileInput}
    on:change={handleFileSelect}
    accept=".csv,.json,.geojson,.xls,.xlsx"
    hidden
  />

  <!-- Attached file chip -->
  {#if attachedFile}
    <div class="attached-file">
      <span class="file-icon">📎</span>
      <span class="file-name">{attachedFile.name}</span>
      <button type="button" class="remove-file" on:click={removeFile} aria-label="Remove file">×</button>
    </div>
  {/if}

  <div class="input-wrapper">
    <!-- Paperclip button -->
    <button
      type="button"
      class="attach-button"
      on:click={() => fileInput.click()}
      disabled={disabled}
      aria-label="Attach file"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21.44 11.05L12.25 20.24C11.1242 21.3658 9.59723 21.9983 8.00505 21.9983C6.41286 21.9983 4.88589 21.3658 3.76005 20.24C2.63421 19.1142 2.00171 17.5872 2.00171 15.995C2.00171 14.4028 2.63421 12.8758 3.76005 11.75L12.95 2.56C13.7006 1.80943 14.7186 1.38574 15.78 1.38574C16.8415 1.38574 17.8595 1.80943 18.61 2.56C19.3606 3.31057 19.7843 4.32856 19.7843 5.39C19.7843 6.45144 19.3606 7.46943 18.61 8.22L9.41005 17.41C9.03476 17.7853 8.52576 17.9971 7.99505 17.9971C7.46433 17.9971 6.95533 17.7853 6.58005 17.41C6.20476 17.0347 5.99292 16.5257 5.99292 15.995C5.99292 15.4643 6.20476 14.9553 6.58005 14.58L15.07 6.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <textarea
      bind:this={textarea}
      bind:value={inputValue}
      on:keydown={handleKeyDown}
      on:input={handleInput}
      placeholder="Ask about Berlin datasets..."
      {disabled}
      rows="1"
    />
    <button type="submit" disabled={(!inputValue.trim() && !attachedFile) || disabled} aria-label="Send message">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 10L17 3L11 17L9 11L3 10Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
</form>

<style>
  .input-container {
    width: 100%;
    max-width: 48rem;
    padding: 0;
  }

  .attached-file {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
    background: #f3f4f6;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: #374151;
  }

  .file-icon {
    font-size: 1rem;
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .remove-file {
    width: 20px;
    height: 20px;
    padding: 0;
    background: #9ca3af;
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .remove-file:hover {
    background: #6b7280;
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: white;
    border: 1px solid #d1d5db;
    border-radius: 0.75rem;
    transition: border-color 0.2s;
  }

  .input-wrapper:focus-within {
    border-color: #9ca3af;
  }

  .attach-button {
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    color: #6b7280;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .attach-button:hover:not(:disabled) {
    background: #f3f4f6;
    color: #374151;
  }

  .attach-button:disabled {
    color: #d1d5db;
    cursor: not-allowed;
  }

  textarea {
    flex: 1;
    padding: 0.5rem 0;
    border: none;
    font-family: inherit;
    font-size: 1rem;
    resize: none;
    min-height: 24px;
    max-height: 200px;
    line-height: 1.5;
    color: #1a1a1a;
  }

  textarea:focus {
    outline: none;
  }

  textarea::placeholder {
    color: #9ca3af;
  }

  textarea:disabled {
    background-color: transparent;
    cursor: not-allowed;
    color: #9ca3af;
  }

  button[type="submit"] {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background-color: #1a1a1a;
    color: white;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color 0.2s;
    flex-shrink: 0;
  }

  button[type="submit"]:hover:not(:disabled) {
    background-color: #374151;
  }

  button[type="submit"]:disabled {
    background-color: #e5e7eb;
    color: #9ca3af;
    cursor: not-allowed;
  }
</style>
