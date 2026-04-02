# Datawrapper MCP Server

MCP server for creating data visualizations using the Datawrapper API. Enables automatic chart creation from Berlin open data through conversational AI.

## Features

- **Bar Charts**: Horizontal bars with variants (basic, stacked, split)
- **Column Charts**: Vertical columns with variants (basic, grouped, stacked)
- **Line Charts**: Single and multi-series line charts for time-series data
- **Area Charts**: Filled area charts
- **Scatter Plots**: X/Y scatter plots for correlation analysis
- **Dot Plots**: Horizontal dot plots with legend
- **Range Plots**: Show min/max ranges with labeled endpoints
- **Arrow Plots**: Show change direction between two values
- **Pie & Donut Charts**: Part-to-whole visualizations
- **Election Donuts**: Parliament-style seat distribution charts
- **Tables**: Formatted data tables
- **Maps**: GeoJSON visualization (symbol maps, choropleth)
- **Smart Defaults**: Automatic titles, labels, and axes from data structure
- **Provenance Tracking**: JSON log of created charts with source dataset links

## Setup

### Prerequisites

- Node.js 18+

### Installation

```bash
npm install
npm run build
```

### Running the Server

**HTTP mode only** (for remote access via Claude/ChatGPT/etc.):
```bash
npm run start:http
```

The HTTP server exposes:
- `/mcp` - MCP endpoint (Streamable HTTP transport)
- `/health` - Health check endpoint

**Environment variables for HTTP mode:**
- `PORT` (optional): Server port (default: 3000)

**Deployed instance**: https://datawrapper-mcp.up.railway.app

### Authentication

This MCP server is stateless. Pass your Datawrapper API token as `api_key` on every `create_visualization` and `publish_visualization` call.

To get a Datawrapper API token:

1. Get a Datawrapper API token:
   - Create account at https://app.datawrapper.de/
   - Navigate to Settings → API Tokens
   - Create new token with permissions: `chart:read`, `chart:write`, `chart:publish`

## MCP Tools

### `create_visualization`

Create a data visualization using Datawrapper.

**Parameters**:
- `api_key` (required): Your Datawrapper API token
- `data` (required): Array of objects or GeoJSON FeatureCollection
- `chart_type` (required): Type of visualization (see below)
- `variant` (optional): Chart variant for bar/column charts
- `map_type` (required for maps): `'d3-maps-symbols'` or `'d3-maps-choropleth'`
- `base_color` (optional): Base color like `"#E63946"`
- `thick` (optional): Datawrapper thickness toggle for supported chart types
- `value_label_format` (optional): Datawrapper value label format like `"0,0.[00]"` or `"0.0%"`
- `visualize_overrides` (optional): Advanced Datawrapper `metadata.visualize` overrides
- `title` (optional): Chart title (auto-generated if omitted)
- `description` (optional): Chart description/byline
- `source_dataset_id` (optional): Berlin dataset ID for tracking

**Supported Chart Types**:

| Type | Variants | Description |
|------|----------|-------------|
| `bar` | basic, stacked, split | Horizontal bar charts |
| `column` | basic, grouped, stacked | Vertical column charts |
| `line` | - | Line charts |
| `area` | - | Area charts |
| `scatter` | - | Scatter plots (requires 2+ numeric columns) |
| `dot` | - | Dot plots with legend |
| `range` | - | Range plots (requires 2 numeric columns) |
| `arrow` | - | Arrow plots (requires 2 numeric columns) |
| `pie` | - | Pie charts |
| `donut` | - | Donut charts |
| `election-donut` | - | Election/parliament donut charts |
| `table` | - | Data tables |
| `map` | - | GeoJSON maps (requires map_type) |

**Examples**:

```javascript
// Basic bar chart
{
  api_key: "your_datawrapper_api_token_here",
  data: [
    { district: "Mitte", population: 380000 },
    { district: "Pankow", population: 410000 }
  ],
  chart_type: "bar",
  base_color: "#E63946",
  thick: true,
  value_label_format: "0,0",
  title: "Population by District"
}

// Stacked column chart
{
  api_key: "your_datawrapper_api_token_here",
  data: [
    { year: "2020", online: 45, offline: 30 },
    { year: "2021", online: 55, offline: 25 }
  ],
  chart_type: "column",
  variant: "stacked",
  visualize_overrides: {
    "show-color-key": true
  }
}

// Range plot (shows salary gap)
{
  api_key: "your_datawrapper_api_token_here",
  data: [
    { category: "Berlin", Women: 52000, Men: 61000 },
    { category: "Munich", Women: 48000, Men: 58000 }
  ],
  chart_type: "range"
}

// Scatter plot
{
  api_key: "your_datawrapper_api_token_here",
  data: [
    { city: "Berlin", population: 3.6, area: 891 },
    { city: "Munich", population: 1.5, area: 310 }
  ],
  chart_type: "scatter"
}
```

### `publish_visualization`

Publish a previously created chart.

**Parameters**:
- `api_key` (required): Your Datawrapper API token
- `chart_id` (required): The chart ID returned from `create_visualization`

## Testing

```bash
# Run unit tests
npm test

# Run live API tests (creates actual charts in Datawrapper)
npm run build && node dist/tests/test-chart-types.js
```

## Project Structure

```
datawrapper-mcp/
├── src/
│   ├── index.ts              # MCP server implementation
│   ├── http-server.ts        # HTTP server for remote access
│   ├── datawrapper-client.ts # Datawrapper API wrapper
│   ├── chart-builder.ts      # Smart defaults engine & validation
│   ├── basemap-matcher.ts    # LOR region detection for choropleth maps
│   ├── chart-logger.ts       # Chart provenance logging
│   └── types.ts              # TypeScript interfaces
├── src/tests/
│   ├── basemap-matcher.test.ts # Unit tests for basemap matcher
│   └── test-choropleth-integration.ts # Choropleth integration tests
├── dist/                     # Compiled JavaScript
└── README.md
```

## License

ISC
