// ABOUTME: Maps the tools' styling options to the Datawrapper metadata keys each chart type actually uses
// ABOUTME: Covers map colors, range plot end color, per-column number formats and transposed column layouts

// Datawrapper types whose rows are drawn as series unless the data is transposed
const TRANSPOSED_LAYOUT_TYPES = ['grouped-column-chart', 'stacked-column-chart'];

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface ColorOptions {
  base_color?: string;
  secondary_color?: string;
  color_scale?: string[];
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
  } else if (color_scale !== undefined) {
    warnings.push('color_scale only applies to choropleth maps and was ignored.');
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
 * Detect the numeric columns of a stored Datawrapper dataset (CSV or TSV text) from its first data rows
 */
export function detectNumericColumnsFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0];
  const delimiter = header.includes('\t') ? '\t' : header.includes(';') && !header.includes(',') ? ';' : ',';
  const columns = splitDelimitedLine(header, delimiter);
  const rows = lines.slice(1, 21).map(line => splitDelimitedLine(line, delimiter));

  return columns.filter((_, index) => {
    const values = rows.map(row => row[index]).filter(value => value !== undefined && value !== '');
    return values.length > 0 && values.every(value => !isNaN(Number(value)));
  });
}
