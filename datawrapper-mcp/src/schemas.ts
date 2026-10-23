// ABOUTME: Zod input schemas for all Datawrapper MCP tools
// ABOUTME: Shared by the MCP tool registrations; descriptions are shown to the calling model

import { z } from 'zod';

const ApiKeySchema = z.string().min(1, 'api_key is required').describe(
  'Your Datawrapper API token. Required on every request because this MCP server is stateless.'
);

// Datawrapper chart IDs are 5 alphanumeric characters. The strict pattern also keeps the ID
// from changing the request path or query (e.g. "../folders/1" or "abcde?permanent=true").
const ChartIdSchema = z.string().regex(/^[A-Za-z0-9]{5}$/, 'chart_id must be a 5-character Datawrapper chart ID (letters and digits only)');

const ChartTypeSchema = z.enum([
  'bar',
  'column',
  'line',
  'area',
  'scatter',
  'dot',
  'range',
  'arrow',
  'pie',
  'donut',
  'election-donut',
  'table',
  'map',
]);

const VariantSchema = z.enum(['basic', 'stacked', 'grouped', 'split']);

const MapTypeSchema = z.enum(['d3-maps-symbols', 'd3-maps-choropleth']);

const HexColorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Colors must be hex colors like "#2E7D32"');

// Styling and placement options shared by create_visualization and update_visualization
const StyleFields = {
  secondary_color: z.string().optional().describe(
    'Optional second color. Range plots: color of the range end (base_color colors the start).'
  ),
  color_scale: z.array(HexColorSchema).min(2).optional().describe(
    'Optional choropleth map gradient: 2+ hex colors from lowest to highest value, e.g. ["#e8f5e9", "#2E7D32"]. Without it, base_color produces a light-to-dark gradient of that color.'
  ),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'language must be a locale like "de-DE" or "en-US"').optional().describe(
    'Optional chart locale for number/date formatting and footer texts, e.g. "de-DE" (397.000,5) or "en-US" (397,000.5). Datawrapper defaults to "en-US".'
  ),
  notes: z.string().optional().describe(
    'Optional notes shown below the chart (e.g. footnotes or methodology hints).'
  ),
  number_prepend: z.string().optional().describe(
    'Optional text shown before numbers, e.g. "€ ". Applied to number_columns (default: all numeric columns).'
  ),
  number_append: z.string().optional().describe(
    'Optional text shown after numbers, e.g. " %" or " Pers.". Applied to number_columns (default: all numeric columns).'
  ),
  number_divisor: z.number().int().min(-12).max(12).optional().describe(
    'Optional power of ten to divide numbers by: 3 = thousands, 6 = millions (combine with number_append, e.g. " Tsd."). 0 = no division. Applied to number_columns.'
  ),
  number_columns: z.array(z.string()).optional().describe(
    'Optional column names the number_prepend/number_append/number_divisor options apply to. Default: all numeric columns.'
  ),
  folder_id: z.number().int().optional().describe(
    'Optional Datawrapper folder ID to put the chart in (if the folder belongs to a team, the chart moves into that team). The ID is the number at the end of the folder URL in the Datawrapper archive, e.g. 455751 in app.datawrapper.de/.../archive/455751.'
  ),
};

export const CreateVisualizationSchema = z.object({
  api_key: ApiKeySchema,
  data: z.any().describe(
    'Array of data objects. For choropleth maps: tabular data with region IDs/names. For symbol maps: GeoJSON FeatureCollection.'
  ),
  chart_type: ChartTypeSchema.describe('Type of visualization to create'),
  variant: VariantSchema.optional().describe(
    'Chart variant. For bar: basic (default), stacked, split. For column: basic (default), grouped, stacked.'
  ),
  map_type: MapTypeSchema.optional().describe(
    'REQUIRED when chart_type is "map". "d3-maps-symbols" for point locations (requires GeoJSON), "d3-maps-choropleth" for region comparison (requires tabular data with Berlin region identifiers).'
  ),
  basemap: z.enum([
    'berlin-boroughs',
    'berlin-prognoseraume-2021',
    'berlin-bezreg-2021',
    'berlin-planungsraeume-2021',
  ]).optional().describe(
    'For choropleth maps: explicitly select basemap. If omitted, auto-detects from data and returns options for confirmation.'
  ),
  region_column: z.string().optional().describe(
    'For choropleth maps: column name containing region IDs or names. Auto-detected if omitted.'
  ),
  value_column: z.string().optional().describe(
    'For choropleth maps: column name containing values to visualize. Auto-detected if omitted.'
  ),
  base_color: z.string().optional().describe(
    'Optional base color for the chart, for example "#E63946". Also colors symbol map points and the choropleth gradient (light to dark of this color).'
  ),
  thick: z.boolean().optional().describe(
    'Optional Datawrapper thickness toggle for supported chart types.'
  ),
  value_label_format: z.string().optional().describe(
    'Optional Datawrapper number format for value labels, for example "0,0.[00]" or "0.0%".'
  ),
  visualize_overrides: z.record(z.string(), z.unknown()).optional().describe(
    'Optional advanced Datawrapper visualize metadata overrides. Use this for additional styling beyond base_color.'
  ),
  title: z.string().optional().describe(
    'Optional chart title (auto-generated if omitted)'
  ),
  description: z.string().optional().describe(
    'Optional chart description/byline'
  ),
  source_dataset_id: z.string().optional().describe(
    'Optional Berlin dataset ID for tracking'
  ),
  ...StyleFields,
});

export const PublishVisualizationSchema = z.object({
  api_key: ApiKeySchema,
  chart_id: ChartIdSchema.describe(
    'The chart ID returned from create_visualization (or found via list_visualizations)'
  ),
});

export const ListVisualizationsSchema = z.object({
  api_key: ApiKeySchema,
  search: z.string().optional().describe(
    'Optional search term to filter charts (matches the chart title and some descriptive fields).'
  ),
  folder_id: z.number().int().optional().describe(
    'Optional Datawrapper folder ID to list only charts in that folder.'
  ),
  team_id: z.string().optional().describe(
    'Optional Datawrapper team ID to list the charts of that team.'
  ),
  published: z.boolean().optional().describe(
    'Optional filter: true = only published charts; omit for all charts. The Datawrapper API has no "unpublished only" filter: false is applied locally to the returned page only (so a page can contain fewer charts than the limit).'
  ),
  order_by: z.enum(['createdAt', 'lastModifiedAt', 'publishedAt', 'title', 'type']).optional().describe(
    'Optional sort field. Defaults to the Datawrapper default ordering.'
  ),
  order: z.enum(['ASC', 'DESC']).optional().describe(
    'Optional sort direction (default DESC, newest first).'
  ),
  limit: z.number().int().min(1).optional().describe(
    'Optional number of charts to return (default 25, capped at 100 per call).'
  ),
  offset: z.number().int().min(0).optional().describe(
    'Optional number of charts to skip, for pagination (default 0).'
  ),
});

export const GetVisualizationSchema = z.object({
  api_key: ApiKeySchema,
  chart_id: ChartIdSchema.describe(
    'The ID of the chart to look up (5 characters, e.g. "aBcDe")'
  ),
  include_data: z.boolean().optional().describe(
    'Optional: also return the chart\'s current dataset (CSV, truncated for large datasets). Default false.'
  ),
  include_metadata: z.boolean().optional().describe(
    'Optional: also return the raw Datawrapper metadata JSON (truncated if very large). Default false.'
  ),
});

export const UpdateVisualizationSchema = z.object({
  api_key: ApiKeySchema,
  chart_id: ChartIdSchema.describe(
    'The ID of the existing chart to modify. The chart keeps this ID.'
  ),
  title: z.string().optional().describe(
    'Optional new chart title'
  ),
  description: z.string().optional().describe(
    'Optional new chart description (shown below the title)'
  ),
  byline: z.string().optional().describe(
    'Optional new byline (author credit)'
  ),
  source_name: z.string().optional().describe(
    'Optional new data source name, for example "Amt für Statistik Berlin-Brandenburg"'
  ),
  source_url: z.string().optional().describe(
    'Optional new data source URL'
  ),
  base_color: z.string().optional().describe(
    'Optional new base color, for example "#E63946". Also recolors symbol map points and the choropleth gradient (light to dark of this color, unless color_scale is given).'
  ),
  thick: z.boolean().optional().describe(
    'Optional Datawrapper thickness toggle for supported chart types.'
  ),
  value_label_format: z.string().optional().describe(
    'Optional Datawrapper number format for value labels, for example "0,0.[00]" or "0.0%".'
  ),
  visualize_overrides: z.record(z.string(), z.unknown()).optional().describe(
    'Optional advanced Datawrapper visualize metadata changes. Only the given keys change. Objects (e.g. "custom-colors", a label -> color map) are merged key by key with the existing settings, so old entries stay unless overwritten; arrays and plain values replace the stored value. To clear an object key, pass {} (e.g. {"custom-colors": {}}); to replace a map completely, clear it first and set the new entries in a second call. null sets a value to null but does not remove the key (merge behavior inferred from the Datawrapper API source). Applied after base_color/thick/value_label_format.'
  ),
  chart_type: ChartTypeSchema.optional().describe(
    'Optional new chart type. Use together with variant for bar/column charts. For maps use map_type. Converting between charts and maps is not supported.'
  ),
  variant: VariantSchema.optional().describe(
    'Optional chart variant (requires chart_type). For bar: basic, stacked, split. For column: basic, grouped, stacked. If omitted and chart_type is the chart\'s current type family, the current variant is kept; if the family changes, basic is used.'
  ),
  map_type: MapTypeSchema.optional().describe(
    'Optional map type when chart_type is "map": "d3-maps-symbols" or "d3-maps-choropleth". It must match the current map type: switching between symbol and choropleth maps is not supported (create a new map with create_visualization instead).'
  ),
  transpose: z.boolean().optional().describe(
    'Optional: swap rows and columns of the data (Datawrapper "transpose"). Grouped and stacked column charts are transposed automatically so the first column becomes the x-axis; use this to fix older charts whose axis shows the series names.'
  ),
  ...StyleFields,
  data: z.any().optional().describe(
    'Optional replacement dataset. Replaces the whole dataset. Array of data objects; for symbol maps a GeoJSON FeatureCollection. For choropleth maps the data must keep the map\'s region and value columns.'
  ),
});

export const DeleteVisualizationSchema = z.object({
  api_key: ApiKeySchema,
  chart_id: ChartIdSchema.describe(
    'The ID of the chart to delete. Only use an ID the user has explicitly confirmed for deletion.'
  ),
});
