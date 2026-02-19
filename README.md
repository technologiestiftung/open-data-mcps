# Berlin Simple Open Data (Soda)

A collection of MCP (Model Context Protocol) servers and tools for working with Berlin's open data ecosystem.

**Live Demo**: TBD

## Structure

This repository contains multiple components:

### `/berlin-open-data-mcp`

MCP server for natural language discovery and fetching of Berlin's open datasets. Connects to the Berlin Open Data Portal (daten.berlin.de) and enables:
- Natural language dataset search with smart query expansion
- Data fetching with smart sampling for large datasets
- Format support: CSV, JSON, Excel (XLS/XLSX), GeoJSON, KML, and WFS
- GeoJSON coordinate transformation (EPSG:25833 → WGS84)
- ZIP archive detection (provides direct download URLs)
- Browser automation for JavaScript-rendered downloads

See [berlin-open-data-mcp/README.md](berlin-open-data-mcp/README.md) for details.

### `/datawrapper-mcp`

MCP server for creating data visualizations using the Datawrapper API. Enables automatic chart creation from Berlin open data through conversational AI:
- Bar charts (vertical/horizontal)
- Line charts (single and multi-series)
- Maps (GeoJSON visualization with automatic Berlin bounds)
- Smart defaults for titles, labels, and axes
- Provenance tracking with source dataset links

See [datawrapper-mcp/README.md](datawrapper-mcp/README.md) for setup and API token configuration.

### `/masterportal-mcp`

MCP server for generating ready-to-host [Masterportal](https://www.masterportal.org/) geodata portals. Creates complete zip packages from GeoJSON or WFS data:
- Multi-layer support with configurable styling
- Map configuration (title, center, zoom, basemap)
- Complete Masterportal v3 runtime bundled
- Download as zip, extract to any web server

See [masterportal-mcp/README.md](masterportal-mcp/README.md) for details.

### `/interface-prototype`

Web-based chat interface for exploring Berlin open data through natural language. Integrates the Berlin Open Data MCP server with Claude to enable:
- Conversational dataset search and discovery
- Data fetching and preview
- Accurate data analysis via sandboxed JavaScript code execution
- Real-time streaming responses via WebSocket

See [interface-prototype/README.md](interface-prototype/README.md) for setup and usage.

## Using the MCP Servers

The MCP servers are deployed independently and can be used in multiple ways:

### Deployed Services

| Service | URL | Description |
|---------|-----|-------------|
| Berlin Open Data MCP | TBD| Dataset search and fetching |
| Datawrapper MCP | TBD | Chart creation |
| Masterportal MCP | TBD | Geodata portal generation |
| Chat Interface | TBD | Web UI combining all MCPs |

### Remote Access (Claude Desktop)

Connect directly from Claude Desktop to access Berlin Open Data tools in any conversation:

```json
{
  "mcpServers": {
    "berlin-data": {
      "command": "npx",
      "args": ["mcp-remote", "TBD"]
    },
    "datawrapper": {
      "command": "npx",
      "args": ["mcp-remote", "TBD"]
    },
    "masterportal": {
      "command": "npx",
      "args": ["mcp-remote", "TBD"]
    }
  }
}
```

Add this to your Claude Desktop configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop after updating the configuration.

**Requirements:**
- Claude Pro, Team, or Enterprise plan (remote MCP servers not available on free tier)
- Internet connection

### Remote Access (Claude.ai Web)

Connect from [Claude.ai](https://claude.ai/) using Custom Connectors:

1. Go to **Settings** → **Connectors**
2. Click **Add custom connector** at the bottom
3. Add each server:

**Berlin Open Data MCP:**
| Field | Value |
|-------|-------|
| URL | `TBD` |
| OAuth | Leave empty |

**Datawrapper MCP:**
| Field | Value |
|-------|-------|
| URL | `TBD` |
| OAuth | Leave empty |

**Masterportal MCP:**
| Field | Value |
|-------|-------|
| URL | `TBD` |
| OAuth | Leave empty |

4. Click **Add** for each connector

To use in conversations:
1. Click the **+** button in the lower left of the chat
2. Select **Connectors**
3. Toggle on the connectors you want to use

**Requirements:**
- Claude Pro, Max, Team, or Enterprise plan
- Connectors feature access

### Remote Access (Mistral Le Chat)

Connect from [Le Chat](https://chat.mistral.ai/) using Custom MCP Connectors:

1. Go to **Intelligence** → **Connectors** → **+ Add Connector**
2. Select **Custom MCP Connector** tab
3. Add each server:

**Berlin Open Data MCP:**
| Field | Value |
|-------|-------|
| Connector Name | `berlin-open-data` |
| Connection Server | `TBD` |
| Authentication | No Authentication |

**Datawrapper MCP:**
| Field | Value |
|-------|-------|
| Connector Name | `datawrapper` |
| Connection Server | `TBD` |
| Authentication | No Authentication |

**Masterportal MCP:**
| Field | Value |
|-------|-------|
| Connector Name | `masterportal` |
| Connection Server | `TBD` |
| Authentication | No Authentication |

**Requirements:**
- Mistral account with Connector access

### Web Chat Interface

Visit TBD for a web-based chat interface with:
- Real-time tool execution display
- Conversational data exploration
- No authentication required

## Getting Started

Each component has its own setup instructions in its respective directory.
