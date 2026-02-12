// ABOUTME: Chart logging for provenance tracking
// ABOUTME: Maintains append-only JSON log of created charts with metadata

import * as fs from 'fs/promises';
import * as path from 'path';
import { ChartLogEntry } from './types.js';

export class ChartLogger {
  private logPath: string;

  constructor(logPath: string = './charts-log.json') {
    this.logPath = logPath;
  }

  /**
   * Log a created chart with metadata
   */
  async logChart(entry: ChartLogEntry): Promise<void> {
    try {
      // Append as NDJSON (newline-delimited JSON) for better performance
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.logPath, line, 'utf-8');
    } catch (error: any) {
      console.error('Failed to log chart:', error.message);
      // Don't throw - logging failure shouldn't break chart creation
    }
  }

  /**
   * Get all logged charts
   */
  async getCharts(): Promise<ChartLogEntry[]> {
    try {
      const content = await fs.readFile(this.logPath, 'utf-8');

      // Parse NDJSON format (one JSON object per line)
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to read chart log: ${error.message}`);
    }
  }

  /**
   * Get chart by ID
   */
  async getChartById(chartId: string): Promise<ChartLogEntry | undefined> {
    const charts = await this.getCharts();
    return charts.find(chart => chart.chartId === chartId);
  }

  /**
   * Get charts by source dataset ID
   */
  async getChartsByDataset(datasetId: string): Promise<ChartLogEntry[]> {
    const charts = await this.getCharts();
    return charts.filter(chart => chart.sourceDatasetId === datasetId);
  }
}
