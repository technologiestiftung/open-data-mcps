// ABOUTME: LOR (Lebensweltlich Orientierte Räume) lookup service
// ABOUTME: Loads and provides hierarchical Berlin administrative district mappings

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface LORMapping {
  BLN_ID: string;
  BLN: string;
  BEZ_ID: string;
  BEZ: string;
  PGR_ID: string;
  PGR: string;
  BZR_ID: string;
  BZR: string;
  PLR_ID: string;
  PLR: string;
}

export class LORLookupService {
  private bezirkMap: Map<string, string> = new Map();
  private lorMap: Map<string, LORMapping> = new Map();
  private loaded = false;

  constructor(private dataPath: string = join(__dirname, '../data/lor_2021-01-01_k3_uebersicht_id_namen')) {
    this.loadLookupTables();
  }

  private loadLookupTables(): void {
    try {
      // Load bezirk lookup
      const bezirkFile = join(this.dataPath, 'LOR_2023_BEZ-Tabelle 1.csv');
      const bezirkContent = readFileSync(bezirkFile, 'utf-8');
      const bezirkLines = bezirkContent.split('\n').slice(2); // Skip header rows

      for (const line of bezirkLines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const parts = trimmedLine.split(';');
        if (parts.length >= 2) {
          const bezId = parts[0].trim();
          const bezName = parts[1].trim();
          if (bezId && bezName) {
            this.bezirkMap.set(bezId, bezName);
          }
        }
      }

      // Load full LOR overview
      const lorFile = join(this.dataPath, 'LOR_2023_Übersicht-Tabelle 1.csv');
      const lorContent = readFileSync(lorFile, 'utf-8');
      const lorLines = lorContent.split('\n').slice(2); // Skip header rows

      for (const line of lorLines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const parts = trimmedLine.split(';');
        if (parts.length >= 10) {
          const plrId = parts[8].trim();
          const mapping: LORMapping = {
            BLN_ID: parts[0].trim(),
            BLN: parts[1].trim(),
            BEZ_ID: parts[2].trim(),
            BEZ: parts[3].trim(),
            PGR_ID: parts[4].trim(),
            PGR: parts[5].trim(),
            BZR_ID: parts[6].trim(),
            BZR: parts[7].trim(),
            PLR_ID: plrId,
            PLR: parts[9].trim()
          };
          if (plrId) {
            this.lorMap.set(plrId, mapping);
          }
        }
      }

      this.loaded = true;
      console.log(`[LOR Lookup] Loaded ${this.bezirkMap.size} bezirke and ${this.lorMap.size} planungsräume`);
    } catch (error) {
      console.error('[LOR Lookup] Failed to load lookup tables:', error);
      this.loaded = false;
    }
  }

  /**
   * Get bezirk name from BEZ code
   */
  getBezirkName(bezId: string): string | undefined {
    return this.bezirkMap.get(bezId);
  }

  /**
   * Get full LOR hierarchy from PLR_ID (RAUMID)
   */
  getLORHierarchy(raumId: string): LORMapping | undefined {
    return this.lorMap.get(raumId);
  }

  /**
   * Check if dataset has LOR columns that can be enriched
   */
  hasLORColumns(columns: string[]): { hasBEZ: boolean; hasRAUMID: boolean } {
    return {
      hasBEZ: columns.includes('BEZ'),
      hasRAUMID: columns.includes('RAUMID')
    };
  }

  /**
   * Enrich a dataset row with LOR names
   */
  enrichRow(row: Record<string, any>): Record<string, any> {
    const enriched = { ...row };

    // Add bezirk name if BEZ exists
    if (row.BEZ && this.bezirkMap.has(row.BEZ)) {
      enriched.BEZIRK_NAME = this.bezirkMap.get(row.BEZ);
    }

    // Add full hierarchy if RAUMID exists
    if (row.RAUMID && this.lorMap.has(row.RAUMID)) {
      const hierarchy = this.lorMap.get(row.RAUMID)!;
      // Don't overwrite BEZIRK_NAME if it was already set from BEZ
      if (!enriched.BEZIRK_NAME) {
        enriched.BEZIRK_NAME = hierarchy.BEZ;
      }
      enriched.PROGNOSERAUM_NAME = hierarchy.PGR;
      enriched.BEZIRKSREGION_NAME = hierarchy.BZR;
      enriched.PLANUNGSRAUM_NAME = hierarchy.PLR;
    }

    return enriched;
  }

  /**
   * Get list of all bezirk codes and names
   */
  getAllBezirke(): Array<{ code: string; name: string }> {
    return Array.from(this.bezirkMap.entries()).map(([code, name]) => ({
      code,
      name
    }));
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}
