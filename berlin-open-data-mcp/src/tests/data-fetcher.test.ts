import { describe, it, expect } from 'vitest';
import { DataFetcher } from '../data-fetcher.js';
import * as XLSX from 'xlsx';

// Helper functions to create test buffers
function createValidXlsxBuffer(): Buffer {
  const data = [
    { Name: 'Alice', Age: 30 },
    { Name: 'Bob', Age: 25 },
  ];
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(xlsxBuffer);
}

function createEmptySheetXlsxBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(xlsxBuffer);
}

function createHeadersOnlyXlsxBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([['Name', 'Age']]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(xlsxBuffer);
}

function createCorruptedBuffer(): Buffer {
  // Create a buffer that looks like a ZIP/XLSX but is invalid
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x99, 0x42]);
}

function createOldXlsBuffer(): Buffer {
  // Create a buffer with XLS/BIFF signature
  return Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
}

describe('DataFetcher.parseExcel', () => {
  const fetcher = new DataFetcher();

  it('should parse valid xlsx file correctly', async () => {
    const buffer = createValidXlsxBuffer();
    // Access private method through type assertion
    const result = await (fetcher as any).parseExcel(buffer, 'xlsx');

    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.columns).toEqual(['Name', 'Age']);
    expect(result.totalRows).toBe(2);
    expect(result.format).toBe('XLSX');
    expect(result.rows[0]).toEqual({ Name: 'Alice', Age: 30 });
    expect(result.rows[1]).toEqual({ Name: 'Bob', Age: 25 });
  });

  it('should handle empty sheet with descriptive error', async () => {
    const buffer = createEmptySheetXlsxBuffer();
    const result = await (fetcher as any).parseExcel(buffer, 'xlsx');

    expect(result.error).toBe('Excel file appears to be empty or has no headers');
    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('should handle headers-only sheet with descriptive error', async () => {
    const buffer = createHeadersOnlyXlsxBuffer();
    const result = await (fetcher as any).parseExcel(buffer, 'xlsx');

    expect(result.error).toBe('Excel file appears to be empty or has no data rows');
    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('should handle corrupted buffer with descriptive error', async () => {
    const buffer = createCorruptedBuffer();
    const result = await (fetcher as any).parseExcel(buffer, 'xlsx');

    expect(result.error).toMatch(/Could not parse Excel file/);
    expect(result.error).toMatch(/possibly corrupted/);
    expect(result.rows).toHaveLength(0);
  });

  it('should handle old .xls binary format with specific error', async () => {
    const buffer = createOldXlsBuffer();
    const result = await (fetcher as any).parseExcel(buffer, 'xls');

    expect(result.error).toMatch(/Could not parse Excel file/);
    expect(result.rows).toHaveLength(0);
  });

  it('should handle file with no sheets', async () => {
    // Create a workbook with no sheets
    const workbook = XLSX.utils.book_new();
    let buffer: Buffer;
    try {
      const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      buffer = Buffer.from(xlsxBuffer);
    } catch {
      // If XLSX.write throws on empty workbook, parseExcel should handle empty/invalid buffer
      buffer = Buffer.from('');
    }
    
    const result = await (fetcher as any).parseExcel(buffer, 'xlsx');

    expect(result.error).toBeDefined();
    expect(result.rows).toHaveLength(0);
  });
});