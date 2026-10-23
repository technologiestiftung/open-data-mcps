// ABOUTME: Maps the tools' styling options to the Datawrapper metadata keys each chart type actually uses
// ABOUTME: Covers map colors, symbol map color/size columns, range plot end color, number formats and transposed layouts

// Datawrapper types whose rows are drawn as series unless the data is transposed
const TRANSPOSED_LAYOUT_TYPES = ['grouped-column-chart', 'stacked-column-chart'];

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface ColorOptions {
  base_color?: string;
  secondary_color?: string;
  color_scale?: string[];
}

export interface SymbolColumnOptions {
  color_column?: string;
  category_colors?: Record<string, string>;
  size_column?: string;
  color_scale?: string[];
  base_color?: string;
}

/**
 * Columns and rows of a dataset, as uploaded (GeoJSON properties) or as stored by Datawrapper (parsed CSV)
 */
export interface DataTable {
  columns: string[];
  rows: Array<Record<string, any>>;
}

export interface NumberFormatOptions {
  number_prepend?: string;
  number_append?: string;
  number_divisor?: number;
  number_columns?: string[];
}

/**
 * Check for a hex color like "#2E7D32" or "#c00"
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/**
 * Mix a hex color with white. amount 0 keeps the color, 1 gives white.
 */
export function lightenHex(hex: string, amount: number): string {
  let digits = hex.slice(1);
  if (digits.length === 3) {
    digits = digits.split('').map(d => d + d).join('');
  }
  const channels = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16));
  const mixed = channels.map(c => Math.round(c + (255 - c) * amount));
  return `#${mixed.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Grouped and stacked column charts need transposed data so that the first column becomes the x-axis
 */
export function usesTransposedLayout(dwType?: string): boolean {
  return typeof dwType === 'string' && TRANSPOSED_LAYOUT_TYPES.includes(dwType);
}

/**
 * Build the visualize settings for the color options of a given Datawrapper type.
 * base-color is ignored by maps and only the start of range plots, so the color is also
 * written to the keys those types read (colorscale, symbol-color, base-color2).
 */
export function buildColorSettings(dwType: string, options: ColorOptions): { visualize: Record<string, any>; warnings: string[] } {
  const { base_color, secondary_color, color_scale } = options;
  const visualize: Record<string, any> = {};
  const warnings: string[] = [];

  if (base_color !== undefined) {
    visualize['base-color'] = base_color;
  }

  if (dwType === 'd3-maps-choropleth') {
    if (color_scale !== undefined) {
      const invalid = color_scale.filter(color => !isHexColor(color));
      if (color_scale.length < 2 || invalid.length > 0) {
        throw new Error('color_scale needs at least 2 hex colors like "#e8f5e9", from lowest to highest value.');
      }
      visualize.colorscale = {
        colors: color_scale.map((color, i) => ({ color, position: i / (color_scale.length - 1) })),
      };
    } else if (base_color !== undefined) {
      if (isHexColor(base_color)) {
        // Light tint of the base color for the lowest values, full color for the highest
        visualize.colorscale = {
          colors: [
            { color: lightenHex(base_color, 0.85), position: 0 },
            { color: base_color, position: 1 },
          ],
        };
      } else {
        warnings.push('base_color must be a hex color (e.g. "#2E7D32") to color a choropleth map; the map colors were not changed.');
      }
    }
  } else if (color_scale !== undefined && dwType !== 'd3-maps-symbols') {
    // Symbol maps use color_scale for a numeric color_column (see buildSymbolColumnSettings)
    warnings.push('color_scale only applies to choropleth maps and symbol maps with a numeric color_column, and was ignored.');
  }

  if (dwType === 'd3-maps-symbols' && base_color !== undefined) {
    visualize['symbol-color'] = base_color;
  }

  if (secondary_color !== undefined) {
    if (dwType === 'd3-range-plot') {
      visualize['base-color2'] = secondary_color;
    } else {
      warnings.push('secondary_color only applies to range plots (color of the range end) and was ignored.');
    }
  }

  return { visualize, warnings };
}

/**
 * Check whether any per-column number format option is set
 */
export function hasNumberFormat(options: NumberFormatOptions): boolean {
  return options.number_prepend !== undefined || options.number_append !== undefined || options.number_divisor !== undefined;
}

/**
 * Build metadata.data["column-format"] entries for the given columns. Datawrapper ignores the
 * chart-wide describe["number-prepend"/"number-append"], so prefix/suffix/divisor are set per column.
 */
export function buildColumnFormat(columns: string[], options: NumberFormatOptions): Record<string, Record<string, any>> {
  const format: Record<string, any> = { type: 'number' };
  if (options.number_prepend !== undefined) {
    format['number-prepend'] = options.number_prepend;
  }
  if (options.number_append !== undefined) {
    format['number-append'] = options.number_append;
  }
  if (options.number_divisor !== undefined) {
    format['number-divisor'] = options.number_divisor;
  }

  const columnFormat: Record<string, Record<string, any>> = {};
  for (const column of columns) {
    columnFormat[column] = { ...format };
  }
  return columnFormat;
}

/**
 * Split one CSV/TSV line, honoring double-quoted fields
 */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map(field => field.trim());
}

/**
 * Parse a stored Datawrapper dataset (CSV, TSV or semicolon-separated text) into columns and rows
 */
export function parseDelimited(text: string): DataTable {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) {
    return { columns: [], rows: [] };
  }
  const header = lines[0];
  const delimiter = header.includes('\t') ? '\t' : header.includes(';') && !header.includes(',') ? ';' : ',';
  const columns = splitDelimitedLine(header, delimiter);
  const rows = lines.slice(1).map(line => {
    const fields = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(columns.map((column, index) => [column, fields[index] ?? '']));
  });
  return { columns, rows };
}

/**
 * A value counts as numeric if it is a number or a string that parses as one
 */
function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

/**
 * Check whether all non-empty values of a column are numeric (sampling the first 200 rows)
 */
function isNumericColumn(table: DataTable, column: string): boolean {
  const values = table.rows.slice(0, 200).map(row => row[column]).filter(value => value !== undefined && value !== null && value !== '');
  return values.length > 0 && values.every(isNumericValue);
}

/**
 * Detect the numeric columns of a stored Datawrapper dataset (CSV or TSV text) from its first data rows
 */
export function detectNumericColumnsFromCsv(text: string): string[] {
  const table = parseDelimited(text);
  return table.columns.filter(column => isNumericColumn({ columns: table.columns, rows: table.rows.slice(0, 20) }, column));
}

/**
 * Symbol map settings for coloring and sizing points by data columns.
 * Datawrapper reads the color column from axes.values: a text column is colored by category via
 * colorscale.map (mode "categories" also shows a category legend), a numeric column gets a gradient.
 * The size column is axes.area. Throws if a column is missing or a size column is not numeric.
 */
export function buildSymbolColumnSettings(
  options: SymbolColumnOptions,
  table: DataTable
): { axes: Record<string, string>; visualize: Record<string, any>; warnings: string[]; changes: string[] } {
  const { color_column, category_colors, size_column, color_scale, base_color } = options;
  const axes: Record<string, string> = {};
  const visualize: Record<string, any> = {};
  const warnings: string[] = [];
  const changes: string[] = [];

  const requireColumn = (column: string, option: string) => {
    if (!table.columns.includes(column)) {
      throw new Error(`${option} "${column}" is not a column of the map data. Available columns: ${table.columns.join(', ') || 'none'}.`);
    }
  };

  if (color_column !== undefined) {
    requireColumn(color_column, 'color_column');
    axes.values = color_column;

    if (isNumericColumn(table, color_column)) {
      const colorscale: Record<string, any> = { mode: 'continuous' };
      const colors = color_scale ?? (isHexColor(base_color) ? [lightenHex(base_color, 0.85), base_color] : undefined);
      if (colors) {
        colorscale.colors = colors.map((color, i) => ({ color, position: i / (colors.length - 1) }));
      }
      visualize.colorscale = colorscale;
      changes.push(`Color column → ${color_column} (numeric, color gradient)`);
      if (category_colors !== undefined) {
        warnings.push(`category_colors was ignored: "${color_column}" is numeric, so it gets a color gradient (use color_scale to choose its colors).`);
      }
    } else {
      const categories: string[] = [];
      for (const row of table.rows) {
        const value = row[color_column];
        if (value !== undefined && value !== null && value !== '' && !categories.includes(String(value))) {
          categories.push(String(value));
        }
      }
      const map: Record<string, string> = {};
      for (const [category, color] of Object.entries(category_colors || {})) {
        if (!isHexColor(color)) {
          throw new Error(`category_colors["${category}"] must be a hex color like "#e41a1c".`);
        }
        if (!categories.includes(category)) {
          warnings.push(`category_colors: "${category}" does not occur in column "${color_column}" (values: ${categories.slice(0, 20).join(', ')}).`);
        }
        map[category] = color;
      }
      visualize.colorscale = { mode: 'categories', map, categoryOrder: categories };
      changes.push(`Color column → ${color_column} (${categories.length} categories${Object.keys(map).length > 0 ? `, colors: ${Object.entries(map).map(([k, v]) => `${k} ${v}`).join(', ')}` : ', default palette'})`);
      if (color_scale !== undefined) {
        warnings.push(`color_scale was ignored: "${color_column}" is a text column, so points are colored by category (use category_colors to choose the colors).`);
      }
    }
  } else if (category_colors !== undefined) {
    warnings.push('category_colors needs color_column (the text column whose categories the colors belong to) and was ignored.');
  } else if (color_scale !== undefined) {
    warnings.push('color_scale needs a numeric color_column on symbol maps and was ignored.');
  }

  if (size_column !== undefined) {
    requireColumn(size_column, 'size_column');
    if (!isNumericColumn(table, size_column)) {
      throw new Error(`size_column "${size_column}" must be a numeric column.`);
    }
    axes.area = size_column;
    changes.push(`Size column → ${size_column}`);
  }

  return { axes, visualize, warnings, changes };
}
