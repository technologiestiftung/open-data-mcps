# Interface Prototype

Web-based chat interface for the Berlin Open Data MCP server.

## Architecture

- **Frontend**: Svelte + Vite chat UI (port 5173)
- **Backend**: Node.js/Express + WebSocket server (port 3000)
- **MCP Server**: Berlin Open Data MCP (spawned by backend)
- **AI**: Mistral API for conversation orchestration

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure your Mistral API key:
```bash
cd backend
cp .env.example .env
# Edit .env and add your API key
```

3. Build the Berlin MCP server (if not already built):
```bash
cd ../berlin-open-data-mcp
npm install
npm run build
cd ../interface-prototype
```

## Development

Start both backend and frontend with a single command:

```bash
npm run dev
```

Open browser to http://localhost:5173

**Alternative:** Run backend and frontend separately:
```bash
npm run dev:backend  # Terminal 1
npm run dev:frontend # Terminal 2
```

## Production Build

```bash
npm run build
npm start
```

**Deployed instance**: https://interface-prototype.up.railway.app

## Project Structure

- `backend/` - Express server, MCP client, Mistral API integration
- `frontend/` - Svelte chat interface

## How It Works

1. User types message in web UI
2. Frontend sends via WebSocket to backend
3. Backend forwards to Mistral API with available MCP tools
4. Mistral decides which tools to call
5. Backend executes tools via Berlin MCP server and streams tool activity to frontend
6. Backend sends results back to Mistral
7. Mistral generates final response
8. Backend streams response to frontend
9. Frontend displays response in chat with tool activity indicators

### Tool Activity Display

The interface shows real-time tool execution to give users visibility into the assistant's work. The display is structured in three parts:

**1. Intro text** (if provided by the AI)
- Natural language explanation of what the AI is about to do
- Example: "Let me search for traffic datasets..."
- Streams immediately when Claude responds

**2. Tool activity** (during and after execution)
- **During**: Active tools display with spinner: "Searching Berlin Datasets..."
- **After**: Individual collapsible badge for each tool: "🔧 Search Berlin Datasets"
- Multiple tools appear as stacked badges, showing the tool chain
- Click each badge to expand and see tool details:
  - Input arguments (JSON)
  - Results or error messages

**3. Final response**
- The AI's response after analyzing tool results
- Example: "I found 5 datasets about traffic in Berlin..."

**Implementation:**
- Backend extracts intro text from the AI's response (if present) and streams it immediately
- Backend emits `tool_call_start` when tool execution begins
- Backend emits `tool_call_complete` when tool finishes (with result or error)
- Backend streams final response after tools complete
- Frontend displays intro → tools → response in order
- See `/backend/src/types.ts` for WebSocket message types

## File Upload

Users can upload data files for analysis.

**Supported formats:**
- CSV (`.csv`)
- JSON (`.json`)
- GeoJSON (`.geojson`)
- Excel (`.xlsx`, `.xls`)

**Size limit:** 10 MB

**How it works:**
1. Click the paperclip icon next to the input field
2. Select a file (or remove it by clicking ×)
3. Optionally add a message describing what you want to analyze
4. Send - the file is parsed and cached server-side
5. The AI can analyze the data using the `execute_code` tool

**Technical details:**
- Files are base64-encoded and sent via WebSocket
- Backend parses files and caches as `upload-{timestamp}-{id}`
- Parsed data is available to the sandboxed JavaScript executor
- Data persists for the session (lost on page refresh)

## Testing

```bash
npm test
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MISTRAL_API_KEY` | Yes | Your Mistral API key (from https://console.mistral.ai/) |
| `PORT` | No | Backend port (default: 3000) |
| `BOD_MCP_URL` | No | URL to remote Berlin Open Data MCP (e.g., `https://bod-mcp.up.railway.app`) |
| `DATAWRAPPER_MCP_URL` | No | URL to remote Datawrapper MCP |
| `DATAWRAPPER_MCP_AUTH_TOKEN` | No | Auth token if Datawrapper MCP requires it |
| `BERLIN_MCP_PATH` | No | Path to local Berlin MCP server (auto-detected if not set) |

When `BOD_MCP_URL` is set, the backend connects to the remote MCP server via HTTP instead of spawning a local process.
