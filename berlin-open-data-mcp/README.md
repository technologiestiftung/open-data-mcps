# Berlin Open Data MCP Server

A Model Context Protocol (MCP) server for natural language discovery of Berlin's open datasets.

## Features

- 🔍 **Natural Language Search**: Query datasets using plain English
- 📊 **Dataset Discovery**: Browse datasets by category, organization, or explore all available data
- 📈 **Portal Overview**: Get statistics and understand the data landscape
- 💾 **Data Fetching**: Download and parse dataset contents (CSV, JSON, Excel, GeoJSON, KML, WFS)
- 🧮 **Code Execution**: Run JavaScript code on cached data for calculations, aggregations, and filtering
- 📑 **Excel Support**: Automatically parses XLS and XLSX files (545 datasets, 20.6% of portal)
- 🗺️ **Geodata Support**: Parse GeoJSON, KML, and WFS geospatial formats (674 datasets, 25.3% of portal)
  - Automatic feature-to-table conversion
  - Geometry metadata extraction (type, coordinates)
  - WFS (Web Feature Service) protocol support (596 datasets, 22.4%)
  - Works with JSON-tagged GeoJSON files
- 🌐 **Browser Automation**: Optional Puppeteer support for JavaScript-rendered downloads (182 datasets, 6.9% of portal)
- 🎯 **Smart Sampling**: Automatic data sampling with statistics to prevent context overflow
- 🔗 **Direct API Integration**: Connects to Berlin's official CKAN-based data portal
- 🤖 **Standalone Operation**: Works with any MCP client (Claude.ai, Le Chat, Claude Desktop) without additional infrastructure

**Total Portal Coverage**: 1,709 datasets (64.2% of portal)

## Installation

```bash
npm install
npm run build
```

### Optional: Browser Automation Support

To enable fetching of datasets from statistik-berlin-brandenburg.de (182 datasets, ~7% of portal), install Puppeteer:

```bash
npm install puppeteer
```

This adds ~300MB of dependencies (Chromium) but unlocks access to demographic and statistical datasets that require JavaScript to download.

## Usage

The server implements the MCP protocol and provides these tools:

### Tools

**Portal Metadata & Navigation:**

1. **get_portal_stats**: Get overview statistics (total datasets, organizations, categories)
2. **list_all_datasets**: Browse all datasets with pagination

**Dataset Discovery:**

3. **search_berlin_datasets**: Search datasets using natural language
4. **get_dataset_details**: Get detailed information about a specific dataset (includes resource IDs for downloading)
5. **list_geo_layers**: Discover available WFS layers for a dataset (requires dataset ID with WFS resource)

**Data Fetching & Analysis:**

6. **fetch_geo_features**: Fetch features from a WFS layer as GeoJSON (supports CQL filters for property-based queries)
7. **fetch_dataset_data**: View dataset contents in chat for analysis (returns preview, caches full data)
8. **download_dataset**: Download dataset as a file to user's computer (triggers browser download)
9. **aggregate_dataset**: Run server-side aggregations on a dataset (totals, counts, group-by)
10. **get_facets**: Get top organizations, tags, and formats for a query
11. **list_tags**: List available tags from the portal

### Example Queries

- "Find all datasets about bicycle infrastructure in Berlin"
- "Show me traffic data for Berlin districts"
- "What datasets are available about air quality?"
- "List all housing and rental data"

### Workflow Examples

**Explore the portal:**
```
User: "What's available in the Berlin Open Data Portal?"
→ Uses get_portal_stats
→ Gets overview with counts and suggestions
```

**Find and analyze data:**
```
User: "Wie viele Einwohner hat jeder Bezirk?"
→ Uses search_berlin_datasets for population data
→ Uses aggregate_dataset: dataset_id="...", group_by=["BEZIRK_NAME"], metrics=[{op: "sum", column: "E_E", as: "einwohner"}]
→ Returns results: [{ "BEZIRK_NAME": "Mitte", "einwohner": 397004 }, { "BEZIRK_NAME": "Pankow", "einwohner": 413168 }, ...]
```

**Discover and fetch geodata (WFS):**
```
User: "Show me all drinking fountains in Mitte"
→ Uses search_berlin_datasets for "drinking fountains"
→ Uses list_geo_layers to see available WFS layers
→ Uses fetch_geo_features: wfs_url="...", typename="...", property_filter="bezirk = 'Mitte'"
→ Returns GeoJSON features for fountains in Mitte
```

**Download data for local use:**
```
User: "Lade die Zugriffsstatistik herunter" / "Download the traffic data"
→ Uses search_berlin_datasets to find dataset
→ Uses download_dataset to trigger browser download
→ User saves file locally with browser download dialog
```

### Data Aggregation

The server supports server-side aggregations to enable analysis of large datasets without context overflow:

1. **aggregate_dataset** runs counts, sums, averages, min/max, and count-distinct operations server-side.
2. Supports **group_by** for breakdowns (e.g., population by district).
3. Supports **filters** applied before aggregation (e.g., only show data for a specific year).
4. Returns only the aggregated result rows to the client.

**Example patterns:**
- Sum population by district
- Count number of schools per neighborhood
- Find the latest measurement value across all stations
- Group and sort results by multiple columns

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
- `/health` - Health check endpoint

**Deployed instance**: 

## Geodata Support

The server automatically handles geospatial data formats, converting them to tabular format for easy analysis:

**Supported Formats:**
- **GeoJSON**: JSON-based vector data (may be tagged as JSON, GeoJSON, or GEOJSON-Datei) - 39 datasets
- **KML**: Keyhole Markup Language from Google Earth - 39 datasets
- **WFS**: Web Feature Service (OGC standard) - 596 datasets hosted on gdi.berlin.de
  - Automatic GetCapabilities discovery
  - Fetches features as GeoJSON
  - Supports pagination for large datasets

**How It Works:**
- Each geographic feature becomes a table row
- Feature properties become regular columns
- Geometry is stored in special columns:
  - `geometry_type`: Type of geometry (Point, LineString, Polygon, etc.)
  - `geometry_coordinates`: Coordinate array as JSON string
  - `feature_id`: Feature identifier (if present)
- WFS services are automatically detected and queried using the OGC WFS 2.0.0 protocol

**Example:**

A GeoJSON with drinking fountains:
```json
{
  "type": "Feature",
  "geometry": {"type": "Point", "coordinates": [13.4, 52.5]},
  "properties": {"name": "Trinkbrunnen", "category": "public"}
}
```

Becomes a table row:
```
name: "Trinkbrunnen"
category: "public"
geometry_type: "Point"
geometry_coordinates: "[13.4, 52.5]"
```

This enables standard data analysis operations on geospatial datasets.

## Query Processing

The server uses a **three-tier search strategy** for optimal relevance:

1. **Expansion Search** - Broad coverage using portal metadata mappings
   - Expands query terms (e.g., "Einwohner" → "Einwohnerinnen", "Kleinräumige einwohnerzahl")
   - Handles German and English keywords
   - Ensures high recall (finds all relevant datasets)

2. **Smart Fallback Detection** - Precision checking
   - Checks if top 5 expansion results contain all user's key terms
   - Triggers literal search if exact match not found

3. **Literal Search + Year Boosting** - Exact match prioritization
   - Runs CKAN literal search when needed
   - Position-based scoring (1st result = highest score)
   - **+1000 bonus for datasets containing query year** (e.g., "2024")
   - Ensures specific queries return exact matches first

**Result**: Broad coverage with precise ranking. Queries like "Einwohner 2024" return the 2024 dataset first, not older alternatives.

## API Integration

Connects to Berlin's open data portal at `daten.berlin.de` using the CKAN API:
- Package search and filtering
- Dataset metadata retrieval
- Tag and organization browsing
- Autocomplete functionality

## MCP Client Compatibility

The server works with any MCP-compatible client, but client behaviors vary:

### Claude.ai (Recommended)
- Passes user queries directly to search tools
- Maintains stable interaction with MCP tools
- Best results for data discovery and analysis

### Le Chat (Mistral)
- May reformulate queries before passing to tools
- Examples observed:
  - User: "Wie viele Einwohner hat Berlin?" → Tool receives: "Bevölkerungszahl Berliner Bezirke aktuell"
  - User asks about population → Query modified to include "2026" (current year)
- Query reformulation can affect search results since it changes the search terms
- The server includes synonym expansion (e.g., "Bevölkerungszahl" → "Einwohnerinnen") to mitigate this

### Claude Desktop
- Direct MCP integration via stdio
- Reliable query passthrough
- See [Claude Desktop Setup Guide](docs/CLAUDE_DESKTOP_SETUP.md)

**Note**: If search results seem unexpected, the client may have reformulated your query. Try rephrasing or using specific German dataset terminology like "Einwohnerinnen" instead of "Bevölkerung".

## Development

```bash
npm run dev  # Development mode with tsx
npm run build  # Production build
```

## Maintenance

### Updating the Query Expansion List

The server uses a pre-generated vocabulary mapping to expand search queries. This mapping is based on the actual content of the Berlin Open Data Portal. When new datasets are added to the portal, the expansion list should be regenerated to include the new vocabulary.

**When to regenerate:**
- Monthly, or when deploying updates
- When new datasets are added to the portal
- When users report that certain search terms don't find expected datasets

**How to regenerate:**

```bash
npm run generate-expansions  # Analyzes all portal datasets, generates src/generated-expansions.ts
npm run build                 # Rebuild with new expansions
```

The script fetches all ~2,600 datasets from the portal and analyzes word co-occurrences to build the expansion mappings. This takes a few minutes to complete.

**Manual seed mappings:**

For common user terms that don't appear in portal metadata (e.g., English terms or colloquial German), add manual mappings to `src/query-processor.ts` in the `SEED_MAPPINGS` constant:

```typescript
const SEED_MAPPINGS: Record<string, string[]> = {
  'miete': ['mietspiegel'],
  'wohnung': ['wohnen', 'wohn'],
  'apartment': ['wohnen', 'wohn'],  // English support
  // ... add new mappings here
};
```

These seed mappings are automatically expanded using the generated portal vocabulary.