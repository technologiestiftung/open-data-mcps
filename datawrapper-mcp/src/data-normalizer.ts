// ABOUTME: Cleans up model-provided data before it is uploaded to Datawrapper
// ABOUTME: Turns number-like strings into numbers and maps column names to Datawrapper template variables

import { GeoJSON } from './types.js';

type Row = Record<string, any>;

// Spaces (incl. no-break and thin spaces) used as thousands separators, e.g. "1 234"
const SPACE_GROUPING = /(?<=\d)[\s  ](?=\d{3}(\D|$))/g;
// "1234", "1234.5", "1,234.5"
const DOT_DECIMAL = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
// "1234,5", "1.234,5", "1.234"
const COMMA_DECIMAL = /^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
// IDs like "01" or "08012345" lose their leading zero as numbers
const LEADING_ZERO = /^[-+]?0\d/;

function parseColumn(values: string[], pattern: RegExp, groupSeparator: string, decimalSeparator: string): number[] | null {
  if (!values.every(value => pattern.test(value))) {
    return null;
  }
  return values.map(value => Number(value.split(groupSeparator).join('').replace(decimalSeparator, '.')));
}

/**
 * Converts the string values of one column to numbers if every non-empty value is a number,
 * written with dot decimals ("1,234.5") or German comma decimals ("1.234,5"). Returns null
 * if the column is not numeric or has IDs with leading zeros. Ambiguous values like "1.234"
 * are read as dot decimals, like JSON numbers.
 */
function parseNumericStrings(values: string[]): number[] | null {
  const cleaned = values.map(value => value.trim().replace(SPACE_GROUPING, ''));
  if (cleaned.some(value => LEADING_ZERO.test(value))) {
    return null;
  }
  return parseColumn(cleaned, DOT_DECIMAL, ',', '.') ?? parseColumn(cleaned, COMMA_DECIMAL, '.', ',');
}

function normalizeRows(rows: Row[], keepFirstColumn: boolean): Row[] {
  const allColumns = Array.from(new Set(rows.flatMap(row => (row && typeof row === 'object' ? Object.keys(row) : []))));
  const columns = keepFirstColumn ? allColumns.slice(1) : allColumns;
  const converted = new Map<string, Map<number, number>>();

  for (const column of columns) {
    const stringCells: Array<{ index: number; value: string }> = [];
    let allNumeric = true;
    rows.forEach((row, index) => {
      const value = row?.[column];
      if (value === null || value === undefined || value === '' || typeof value === 'number') {
        return;
      }
      if (typeof value === 'string') {
        stringCells.push({ index, value });
      } else {
        allNumeric = false;
      }
    });
    if (!allNumeric || stringCells.length === 0) {
      continue;
    }
    const numbers = parseNumericStrings(stringCells.map(cell => cell.value));
    if (numbers) {
      converted.set(column, new Map(stringCells.map((cell, i) => [cell.index, numbers[i]])));
    }
  }

  if (converted.size === 0) {
    return rows;
  }
  return rows.map((row, index) => {
    const next = { ...row };
    for (const [column, values] of converted) {
      if (values.has(index)) {
        next[column] = values.get(index);
      }
    }
    return next;
  });
}

/**
 * Datawrapper only treats a column as numeric if its CSV values are plain numbers. Models often
 * send numbers as strings, sometimes German-formatted ("12,5"), which then arrive as text and
 * break charts ("Not enough data to show a column chart"). This converts such columns to numbers.
 * The first column of an array of rows is kept as is: Datawrapper uses it for labels, e.g. years.
 * Works on arrays of rows and on GeoJSON feature properties; anything else is returned unchanged.
 */
export function normalizeNumericStrings<T>(data: T): T {
  if (Array.isArray(data)) {
    return normalizeRows(data, true) as T;
  }
  const geojson = data as unknown as GeoJSON;
  if (geojson && typeof geojson === 'object' && Array.isArray(geojson.features)) {
    const properties = normalizeRows(geojson.features.map(feature => feature?.properties || {}), false);
    return {
      ...geojson,
      features: geojson.features.map((feature, index) => ({ ...feature, properties: properties[index] })),
    } as T;
  }
  return data;
}

/**
 * The variable name Datawrapper uses for a column in tooltip templates ({{ ... }}).
 * Same as columnNameToVariable in @datawrapper/shared: "Fahrraddiebstähle" becomes "fahrraddiebsthle".
 */
export function columnNameToVariable(name: string): string {
  return name
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w-]+/g, '')
    .replace(/-/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
    .replace(/^(\d)/, '_$1')
    .replace(/^(and|or|in|true|false)$/, '$1_');
}
