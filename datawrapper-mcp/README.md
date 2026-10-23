# Datawrapper MCP Server

MCP server for creating and managing data visualizations using the Datawrapper API. Enables automatic chart creation from Berlin open data through conversational AI.

## Features

- 📈 **Visualizing data**:
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
- **Managing existing charts**:
  - **List** all charts of your account with search, folder/team filters and pagination
  - **Inspect** a chart's metadata, publish status, public URL, embed code and data
  - **Update** charts in place (colors, title, description, source, type, data) without getting a new chart ID
  - **Delete** charts (moved to the Datawrapper trash for 30 days)
- 🖼️ **Previews**: `create_visualization`, `update_visualization` and `publish_visualization` attach a PNG preview of the chart, so the assistant can check that a change (e.g. a color) actually shows. `export_visualization_png` exports high-resolution PNGs on request
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

This MCP server is stateless. Pass your Datawrapper API token as `api_key` on every tool call.

To get a Datawrapper API token:

1. Get a Datawrapper API token:
   - Create account at https://app.datawrapper.de/
   - Navigate to Settings → API Tokens
   - Create new token with permissions: `chart:read`, `chart:write`, `theme:read` and `visualization:read`

These scopes cover all tools: listing and reading charts need `chart:read`, updating and deleting need `chart:write`, and publishing needs all four. Existing tokens with these scopes do not need to be changed.

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
- Styling options (optional): see [Styling options](#styling-options)
- `preview` (optional): Attach a PNG preview to the response (default `true`, see [Previews](#previews))

Grouped and stacked column charts are created with transposed data, so the first column (e.g. years) becomes the x-axis and the other columns become the colored series.

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
- `chart_id` (required): The chart ID returned from `create_visualization` (or found via `list_visualizations`). Chart IDs have exactly 5 letters or digits (e.g. `aBcDe`); all tools reject other values

- `preview` (optional): Attach a PNG preview to the response (default `true`)

Also use it to republish a chart after `update_visualization`: edits only change the draft, and the public version and embeds keep showing the old state until the chart is published again. The chart ID stays the same, and Datawrapper increments the public version number.

### `list_visualizations`

List the charts in your Datawrapper account (read-only).

**Parameters**:
- `api_key` (required): Your Datawrapper API token
- `search` (optional): Search term (matches the title and some descriptive fields)
- `folder_id` (optional): Only charts in this folder
- `team_id` (optional): Only charts of this team. Pass it if team charts are missing from the default list
- `published` (optional): `true` for published charts only; omit it for all charts. The Datawrapper API has no "unpublished only" filter, so `false` is applied locally to the returned page only (the page can then hold fewer charts than `limit`, and the response says so)
- `order_by` (optional): `createdAt`, `lastModifiedAt`, `publishedAt`, `title` or `type`
- `order` (optional): `ASC` or `DESC` (default `DESC`)
- `limit` (optional): Number of charts per page (default 25, capped at 100)
- `offset` (optional): Number of charts to skip, for pagination (default 0)

Each entry shows ID, title, type, publish status with public URL, edit URL, last modified time and folder. When more charts exist, the response tells you which `offset` to use next.

```javascript
{
  api_key: "your_datawrapper_api_token_here",
  search: "Bezirk",
  published: true,
  order_by: "lastModifiedAt",
  limit: 10
}
```

### `get_visualization`

Get the details of one chart (read-only).

**Parameters**:
- `api_key` (required): Your Datawrapper API token
- `chart_id` (required): The chart ID
- `include_data` (optional): Also return the current dataset as CSV (at most 50 lines / 5,000 characters)
- `include_metadata` (optional): Also return the raw Datawrapper metadata JSON (at most 8,000 characters)

Returns title, type, edit URL, created/modified timestamps, folder, publish status, public URL and embed code (if published), description/byline/source, key visualize settings (e.g. `base-color`, `custom-colors`) and axes.

```javascript
{
  api_key: "your_datawrapper_api_token_here",
  chart_id: "aBcDe",
  include_data: true
}
```

### `update_visualization`

Modify an existing chart in place. The chart keeps its ID, edit URL and embed codes, so small changes no longer require creating a new chart.

**Parameters**:
- `api_key` (required): Your Datawrapper API token
- `chart_id` (required): The chart ID
- At least one of:
  - `title`, `description`, `byline`, `source_name`, `source_url`
  - `base_color`, `thick`, `value_label_format`
  - Any of the [styling options](#styling-options): `secondary_color`, `color_scale`, `language`, `notes`, `number_prepend`, `number_append`, `number_divisor` (+ `number_columns`), `folder_id`
  - `transpose`: Swap rows and columns. Switching to or from a grouped/stacked column chart sets this automatically; pass it to fix older grouped/stacked column charts whose x-axis shows the series names
  - `visualize_overrides`: Advanced `metadata.visualize` changes (applied after `base_color`/`thick`/`value_label_format`)
  - `chart_type` + `variant`: Change the chart type (e.g. column to stacked column). If `variant` is omitted and `chart_type` is the chart's current family, the current variant (e.g. stacked) is kept. Converting between charts and maps, and between map types (symbol, choropleth, locator), is not supported: create a new map instead
  - `data`: Replace the whole dataset. It is validated against the chart type first. For choropleth maps it must keep the map's region and value columns. Not supported for chart types this server does not create (e.g. locator maps)
- `preview` (optional): Attach a PNG preview to the response (default `true`). Does not count as a change

Only the given fields change. The tool sends a partial `PATCH /charts/{id}`, and Datawrapper deep-merges nested metadata objects, so other settings are kept:

- Objects such as `custom-colors` (a label-to-color map) are merged key by key. Setting `{ "Pankow": "#..." }` keeps an existing `Mitte` color.
- Arrays and plain values (e.g. `base-color`) replace the stored value.
- To clear an object, pass an empty object, e.g. `"custom-colors": {}`. To replace a color map completely, clear it first and set the new colors in a second call.
- `null` sets a value to `null` but does not remove the key.

The last two points are inferred from the archived Datawrapper API source, not from the official API docs.

If the call also replaces `data` and the data upload fails after the other changes were saved, the error lists the saved changes and says that the data was not replaced, so only the data upload needs to be retried.

The tool never publishes. If the chart was already published, the response says that the public version is unchanged until `publish_visualization` is called again.

```javascript
// Change the color of an existing chart
{
  api_key: "your_datawrapper_api_token_here",
  chart_id: "aBcDe",
  base_color: "#E63946",
  visualize_overrides: {
    "custom-colors": { "Mitte": "#1D3557" }
  }
}

// Replace the data and title
{
  api_key: "your_datawrapper_api_token_here",
  chart_id: "aBcDe",
  title: "Population by District (2025)",
  data: [
    { district: "Mitte", population: 397000 },
    { district: "Pankow", population: 418000 }
  ]
}
```

### Styling options

Shared by `create_visualization` and `update_visualization`. Datawrapper reads colors from different settings per chart type; the tools write them to the right place:

| Option | Effect |
|---|---|
| `base_color` | Main color. On symbol maps it colors the points (`symbol-color`); on choropleth maps it creates a light-to-dark gradient of this color (`colorscale`), unless `color_scale` is given. Tables ignore it |
| `secondary_color` | Range plots: color of the range end (`base-color2`). Ignored with a warning for other types |
| `color_scale` | Choropleth maps: 2+ hex colors from lowest to highest value, e.g. `["#fff7ec", "#fc8d59", "#7f0000"]` |
| `visualize_overrides` → `custom-colors` | Color single categories or series, e.g. `{ "Mitte": "#FF6B00" }` (bar, column, line, area, pie, donut, election donut, dot, arrow, scatter) |
| `language` | Chart locale, e.g. `"de-DE"` for German number formatting (`397.000,5`) and German footer texts. Datawrapper defaults to `"en-US"` |
| `notes` | Notes shown below the chart |
| `number_prepend`, `number_append`, `number_divisor` | Text before/after numbers and a power-of-ten divisor (`3` = thousands). Datawrapper only applies these per column, so they are set for `number_columns` (default: all numeric columns) |
| `folder_id` | Put the chart into a Datawrapper folder (and into that folder's team, if it belongs to one). The ID is the number at the end of the folder URL in the archive, e.g. `455751` in `app.datawrapper.de/…/archive/455751`. Unknown or inaccessible folders return a clear error and nothing is changed |

```javascript
// German number format in thousands, with notes
{
  api_key: "your_datawrapper_api_token_here",
  chart_id: "aBcDe",
  language: "de-DE",
  number_prepend: "ca. ",
  number_append: " Tsd.",
  number_divisor: 3,
  notes: "Stand: 31.12.2025"
}
```

### Previews

`create_visualization`, `update_visualization` and `publish_visualization` render the chart via Datawrapper's PNG export and attach it as an image to the response. The preview shows the current state, including unpublished changes. It is best-effort: if the export fails, takes longer than 15 seconds or is larger than 1 MB, the response says so and the chart operation itself still succeeds. Previews are typically 10-50 KB and add about 2 seconds per call. Pass `preview: false` to skip them.

### `export_visualization_png`

Export a chart as a PNG image, e.g. for slides or print. Needs only the `chart:read` scope.

**Parameters**:
- `api_key` (required): Your Datawrapper API token
- `chart_id` (required): The chart ID
- `width`, `height` (optional): Image size in pixels (default: the chart's embed width, automatic height)
- `zoom` (optional): Resolution multiplier from 1 to 4 (default 2)
- `plain` (optional): Only the visualization, without title, description and footer
- `transparent` (optional): Transparent instead of white background
- `border_width`, `border_color` (optional): Margin around the visualization

```javascript
{
  api_key: "your_datawrapper_api_token_here",
  chart_id: "aBcDe",
  zoom: 3,
  plain: true
}
```

### `delete_visualization`

Delete a chart. The tool description tells the assistant to show the chart title and ID and get explicit confirmation from the user before calling it.

**Parameters**:
- `api_key` (required): Your Datawrapper API token
- `chart_id` (required): The chart ID

The tool looks the chart up first, so the response names the deleted chart, and an unknown ID returns a clear "chart not found" error without deleting anything. Datawrapper moves deleted charts to the trash and deletes them permanently after 30 days; until then they can be restored in Datawrapper. Deleting also takes down the public version of a published chart (its public URL returns 404).

```javascript
{
  api_key: "your_datawrapper_api_token_here",
  chart_id: "aBcDe"
}
```

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
│   ├── index.ts              # MCP server and tool handlers
│   ├── http-server.ts        # HTTP server for remote access
│   ├── datawrapper-client.ts # Datawrapper API wrapper
│   ├── chart-builder.ts      # Smart defaults engine & validation
│   ├── style-options.ts      # Maps colors/number formats to per-chart-type Datawrapper settings
│   ├── basemap-matcher.ts    # LOR region detection for choropleth maps
│   ├── chart-logger.ts       # Chart provenance logging
│   ├── schemas.ts            # Zod input schemas for all tools
│   └── types.ts              # TypeScript interfaces
├── src/tests/
│   ├── basemap-matcher.test.ts # Unit tests for basemap matcher
│   ├── datawrapper-client.test.ts # API client tests (mocked axios)
│   ├── style-options.test.ts # Styling helper tests
│   ├── visualization-tools.test.ts # list/get/update/delete tool tests (in-memory MCP client)
│   └── test-choropleth-integration.ts # Choropleth integration tests
├── dist/                     # Compiled JavaScript
└── README.md
```

## License

ISC
