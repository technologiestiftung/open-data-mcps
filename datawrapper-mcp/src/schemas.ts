import { z } from 'zod';

export const CreateVisualizationSchema = z.object({
  api_key: z.string().min(1, 'api_key is required').describe(
    'Your Datawrapper API token. Required on every request because this MCP server is stateless.'
  ),
  data: z.any().describe(
    'Array of data objects. For choropleth maps: tabular data with region IDs/names. For symbol maps: GeoJSON FeatureCollection.'
  ),
  chart_type: z.enum([
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
  ]).describe('Type of visualization to create'),
  variant: z.enum(['basic', 'stacked', 'grouped', 'split']).optional().describe(
    'Chart variant. For bar: basic (default), stacked, split. For column: basic (default), grouped, stacked.'
  ),
  map_type: z.enum(['d3-maps-symbols', 'd3-maps-choropleth']).optional().describe(
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
    'Optional base color for the chart, for example "#E63946".'
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
});

export const PublishVisualizationSchema = z.object({
  api_key: z.string().min(1, 'api_key is required').describe(
    'Your Datawrapper API token. Required on every request because this MCP server is stateless.'
  ),
  chart_id: z.string().min(1, 'chart_id is required').describe(
    'The chart ID returned from create_visualization'
  ),
});
