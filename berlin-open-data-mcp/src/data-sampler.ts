// ABOUTME: Generates smart samples and statistics from dataset rows
// ABOUTME: Prevents context overflow by limiting data size

export interface ColumnStats {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'date' | 'unknown';
}

export interface DataSample {
  sampleRows: any[];
  totalRows: number;
  isTruncated: boolean;
  columns: ColumnStats[];
  summary: string;
}

export class DataSampler {
  private readonly DEFAULT_SAMPLE_SIZE = 10;

  generateSample(rows: any[], columns: string[]): DataSample {
    const sampleRows = rows.slice(0, this.DEFAULT_SAMPLE_SIZE);

    // Generate minimal column statistics (name and type only)
    const columnStats = columns.map(colName => this.analyzeColumn(colName, rows));

    // Generate summary text
    const summary = this.generateSummary(rows.length, columns.length, columnStats);

    return {
      sampleRows,
      totalRows: rows.length,
      isTruncated: rows.length > this.DEFAULT_SAMPLE_SIZE,
      columns: columnStats,
      summary,
    };
  }

  private analyzeColumn(columnName: string, rows: any[]): ColumnStats {
    const values = rows.map(row => row[columnName]);
    const nonNullValues = values.filter(v => v != null && v !== '');

    // Infer type
    const type = this.inferType(nonNullValues);

    return {
      name: columnName,
      type,
    };
  }

  private inferType(values: any[]): 'number' | 'string' | 'boolean' | 'date' | 'unknown' {
    if (values.length === 0) return 'unknown';

    // Sample first 100 non-null values
    const sample = values.slice(0, 100);

    // Check if all are numbers
    const numericCount = sample.filter(v => !isNaN(parseFloat(v)) && isFinite(v)).length;
    if (numericCount / sample.length > 0.8) return 'number';

    // Check if all are booleans
    const boolCount = sample.filter(v =>
      v === true || v === false || v === 'true' || v === 'false' || v === '0' || v === '1'
    ).length;
    if (boolCount / sample.length > 0.8) return 'boolean';

    // Check if looks like dates
    const dateCount = sample.filter(v => {
      const str = String(v);
      return /^\d{4}-\d{2}-\d{2}/.test(str) || /^\d{2}\/\d{2}\/\d{4}/.test(str);
    }).length;
    if (dateCount / sample.length > 0.8) return 'date';

    return 'string';
  }

  private generateSummary(totalRows: number, totalColumns: number, columns: ColumnStats[]): string {
    let summary = `Dataset contains ${totalRows} rows and ${totalColumns} columns.\n\n`;
    summary += '**Columns:**\n';
    summary += columns.map(col => `- ${col.name} (${col.type})`).join('\n');
    return summary;
  }
}
