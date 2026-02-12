# Masterportal MCP Server

A Model Context Protocol (MCP) server for generating ready-to-host [Masterportal](https://www.masterportal.org/) geodata portals.

## Features

- **Single-Call Portal Creation**: Create complete portals with one tool call
- **Multi-Layer Support**: Include multiple GeoJSON or WFS layers
- **Map Configuration**: Set title, center, zoom, and basemap
- **Complete Package**: Generates zip files with Masterportal runtime included
- **Ready to Host**: Extract and serve from any web server

## Installation

```bash
npm install
npm run build
```

### Download Masterportal Runtime

The server needs the Masterportal runtime files to bundle into generated portals:

```bash
./scripts/download-runtime.sh
```

This downloads pre-built Masterportal (v3.10.0) from the official website.

## Usage

The server provides two tools:

### list_wfs_layers

Discover available feature types from a WFS service before adding layers to a portal.

**Parameters:**
- `url` (required): WFS service URL (e.g., `https://gdi.berlin.de/services/wfs/gruene_wege`)

**Returns:** List of available feature types with their names.

### create_portal

Creates a complete Masterportal and returns a download URL.

**Parameters:**
- `title` (required): Portal title displayed in the header
- `layers` (required): Array of layers to include
- `center`: Initial map center `[longitude, latitude]` (default: Berlin `[13.4, 52.52]`)
- `zoom`: Initial zoom level 1-18 (default: 10)
- `basemap_url`: Custom WMS basemap URL (default: OpenStreetMap)
- `filename`: Output filename without .zip extension

**Layer format:**
- `id`: Unique layer identifier
- `name`: Display name in layer tree
- `type`: `"geojson"` or `"wfs"`
- `data`: Inline GeoJSON (string or object)
- `url`: URL to GeoJSON file or WFS endpoint
- `style`: Optional `{ color, opacity, icon }`

### Example

```json
{
  "name": "create_portal",
  "arguments": {
    "title": "Berlin Points of Interest",
    "center": [13.4, 52.52],
    "zoom": 11,
    "layers": [
      {
        "id": "landmarks",
        "name": "Landmarks",
        "type": "geojson",
        "data": {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "geometry": { "type": "Point", "coordinates": [13.377, 52.516] },
              "properties": { "name": "Brandenburg Gate" }
            }
          ]
        }
      },
      {
        "id": "districts",
        "name": "Districts",
        "type": "geojson",
        "url": "https://example.com/berlin-districts.geojson"
      }
    ]
  }
}
```

### Running the Server

**Stdio mode** (for Claude Desktop integration):
```bash
npm start
```

**HTTP mode** (for remote access):
```bash
npm run start:http
```

The HTTP server exposes:
- `/mcp` - MCP endpoint (Streamable HTTP transport)
- `/downloads/:filename` - Download generated zip files
- `/health` - Health check endpoint

**Deployed instance**: https://masterportal-mcp.up.railway.app

## Generated Portal Structure

```
portal.zip
├── index.html           # Entry point
├── config.js            # Masterportal config
├── config.json          # Layer and UI config
├── resources/
│   ├── services.json    # Layer service definitions
│   ├── rest-services.json
│   └── style.json       # Layer styling
├── data/
│   └── *.geojson        # Embedded layer data
└── mastercode/          # Masterportal runtime
    ├── js/masterportal.js
    ├── css/
    ├── img/
    └── locales/
```

## Deployment

### Railway

The server is configured for Railway deployment:

```bash
# Railway will use the Dockerfile automatically
# Set PORT environment variable (default: 8080)
```

### Docker

```bash
docker build -t masterportal-mcp .
docker run -p 8080:8080 masterportal-mcp
```

## Development

```bash
npm run dev      # Development mode with tsx
npm run dev:http # HTTP server in development mode
npm run build    # Production build
```

## License

MIT
