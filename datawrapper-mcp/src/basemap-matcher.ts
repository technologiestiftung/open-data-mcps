// ABOUTME: Detects Berlin LOR regions in data and matches to Datawrapper basemaps
// ABOUTME: Loads LOR lookup table and provides detection/matching functions

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BerlinBasemap, LORLevel, DetectionResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOR_LEVELS: LORLevel[] = [
  {
    basemap: 'berlin-planungsraeume-2021',
    idColumn: 'PLR_ID',
    idKey: 'PLR_ID',
    nameColumn: 'PLR',
    nameKey: 'PLR_NAME',
    label: 'Planungsräume',
    count: 542
  },
  {
    basemap: 'berlin-bezreg-2021',
    idColumn: 'BZR_ID',
    idKey: 'BZR_ID',
    nameColumn: 'BZR',
    nameKey: 'BZR_NAME',
    label: 'Bezirksregionen',
    count: 143
  },
  {
    basemap: 'berlin-prognoseraume-2021',
    idColumn: 'PGR_ID',
    idKey: 'PGR_ID',
    nameColumn: 'PGR',
    nameKey: 'PGR_NAME',
    label: 'Prognoseräume',
    count: 58
  },
  {
    basemap: 'berlin-boroughs',
    idColumn: 'BEZ_ID',
    idKey: 'Gemeinde_s',
    nameColumn: 'BEZ',
    nameKey: 'Gemeinde_n',
    label: 'Bezirke',
    count: 12
  }
];

export class BasemapMatcher {
  private lorData: Map<string, Set<string>> = new Map();
  private initialized = false;

  constructor() {
    this.loadLORData();
  }

  private loadLORData(): void {
    try {
      // Use __dirname to resolve relative to this module's location (dist/ or src/)
      const csvPath = path.resolve(__dirname, '../data/LOR_2023_Übersicht-Tabelle 1.csv');

      if (!fs.existsSync(csvPath)) {
        console.error(`LOR data file not found at: ${csvPath}`);
        return;
      }

      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.replace(/\r/g, '').split('\n');

      // Line 0 is "Tabelle 1", line 1 is header
      const header = lines[1].split(';');

      // Initialize sets for each column
      const columns = ['BEZ', 'BEZ_ID', 'PGR', 'PGR_ID', 'BZR', 'BZR_ID', 'PLR', 'PLR_ID'];
      for (const col of columns) {
        this.lorData.set(col, new Set<string>());
      }

      // Parse data rows
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(';');
        for (const col of columns) {
          const colIndex = header.indexOf(col);
          if (colIndex >= 0 && values[colIndex]) {
            this.lorData.set(col, this.lorData.get(col)!.add(values[colIndex]));
          }
        }
      }

      this.initialized = true;
      console.error(`BasemapMatcher: Loaded LOR data with ${this.lorData.get('BEZ')?.size} Bezirke, ${this.lorData.get('PLR')?.size} Planungsräume`);
    } catch (error) {
      console.error('Failed to load LOR data:', error);
    }
  }

  getLORLevels(): LORLevel[] {
    return LOR_LEVELS;
  }

  getLevelByBasemap(basemap: BerlinBasemap): LORLevel | undefined {
    return LOR_LEVELS.find(l => l.basemap === basemap);
  }

  detectAvailableLevels(data: Array<Record<string, any>>): DetectionResult {
    if (!this.initialized || data.length === 0) {
      return {
        detected: false,
        allLevels: [],
        regionColumn: '',
        matchedRows: 0,
        totalRows: data.length
      };
    }

    const columns = Object.keys(data[0]);
    const detectedLevels: LORLevel[] = [];
    let primaryLevel: LORLevel | undefined;
    let regionColumn = '';
    let matchedRows = 0;
    let unmatchedValues: string[] = [];

    // Check each LOR level (most granular first)
    for (const level of LOR_LEVELS) {
      // Check for ID column match
      const idColMatch = this.findMatchingColumn(data, columns, level.idColumn, level);
      if (idColMatch.matched) {
        detectedLevels.push(level);
        if (!primaryLevel) {
          primaryLevel = level;
          regionColumn = idColMatch.column;
          matchedRows = idColMatch.matchedRows;
          unmatchedValues = idColMatch.unmatchedValues;
        }
        continue;
      }

      // Check for name column match
      const nameColMatch = this.findMatchingColumn(data, columns, level.nameColumn, level);
      if (nameColMatch.matched) {
        detectedLevels.push(level);
        if (!primaryLevel) {
          primaryLevel = level;
          regionColumn = nameColMatch.column;
          matchedRows = nameColMatch.matchedRows;
          unmatchedValues = nameColMatch.unmatchedValues;
        }
      }
    }

    // Find first numeric column for values
    let valueColumn: string | undefined;
    for (const col of columns) {
      if (typeof data[0][col] === 'number') {
        valueColumn = col;
        break;
      }
    }

    return {
      detected: detectedLevels.length > 0,
      primaryLevel,
      allLevels: detectedLevels,
      regionColumn,
      valueColumn,
      matchedRows,
      totalRows: data.length,
      unmatchedValues: unmatchedValues.length > 0 ? unmatchedValues : undefined
    };
  }

  private findMatchingColumn(
    data: Array<Record<string, any>>,
    columns: string[],
    targetColumn: string,
    level: LORLevel
  ): { matched: boolean; column: string; matchedRows: number; unmatchedValues: string[] } {
    // First, check for exact column name match
    if (columns.includes(targetColumn)) {
      const result = this.checkColumnValues(data, targetColumn, level);
      if (result.matchRate > 0.5) {
        return { matched: true, column: targetColumn, ...result };
      }
    }

    // Check all columns for value matches
    for (const col of columns) {
      const result = this.checkColumnValues(data, col, level);
      if (result.matchRate > 0.5) {
        return { matched: true, column: col, ...result };
      }
    }

    return { matched: false, column: '', matchedRows: 0, unmatchedValues: [] };
  }

  private checkColumnValues(
    data: Array<Record<string, any>>,
    column: string,
    level: LORLevel
  ): { matchRate: number; matchedRows: number; unmatchedValues: string[] } {
    const idSet = this.lorData.get(level.idColumn);
    const nameSet = this.lorData.get(level.nameColumn);

    let matchedRows = 0;
    const unmatchedValues: string[] = [];

    for (const row of data) {
      const value = String(row[column] ?? '');
      if (!value) continue;

      // For BEZ_ID, need to pad 2-digit to 3-digit for Datawrapper
      let normalizedValue = value;
      if (level.basemap === 'berlin-boroughs' && /^\d{2}$/.test(value)) {
        normalizedValue = '0' + value;
      }

      if (idSet?.has(value) || idSet?.has(normalizedValue) || nameSet?.has(value)) {
        matchedRows++;
      } else {
        if (unmatchedValues.length < 5) {
          unmatchedValues.push(value);
        }
      }
    }

    return {
      matchRate: data.length > 0 ? matchedRows / data.length : 0,
      matchedRows,
      unmatchedValues
    };
  }

  padBezirkId(id: string): string {
    // Pad 2-digit BEZ_ID to 3-digit for Datawrapper
    if (/^\d{2}$/.test(id)) {
      return '0' + id;
    }
    return id;
  }

  isUsingIds(data: Array<Record<string, any>>, regionColumn: string, level: LORLevel): boolean {
    if (data.length === 0) return false;
    const firstValue = String(data[0][regionColumn] ?? '');
    const idSet = this.lorData.get(level.idColumn);

    // Check if it looks like an ID (numeric string)
    if (/^\d+$/.test(firstValue)) {
      // For BEZ_ID, also check padded version
      if (level.basemap === 'berlin-boroughs') {
        return idSet?.has(firstValue) || idSet?.has(this.padBezirkId(firstValue)) || false;
      }
      return idSet?.has(firstValue) || false;
    }
    return false;
  }
}
