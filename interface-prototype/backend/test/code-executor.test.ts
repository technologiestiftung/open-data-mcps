// ABOUTME: Unit tests for CodeExecutor
// ABOUTME: Tests sandboxing, security, and execution correctness

import { CodeExecutor } from '../src/code-executor.js';

describe('CodeExecutor', () => {
  let executor: CodeExecutor;

  beforeEach(() => {
    executor = new CodeExecutor();
  });

  test('should execute simple arithmetic', async () => {
    const result = await executor.execute('2 + 2');
    expect(result.success).toBe(true);
    expect(result.output).toBe(4);
  });

  test('should access provided data context', async () => {
    const data = [{ name: 'Alice' }, { name: 'Bob' }];
    const result = await executor.execute(
      'data.map(row => row.name)',
      { data }
    );

    expect(result.success).toBe(true);
    expect(result.output).toEqual(['Alice', 'Bob']);
  });

  test('should count objects by field', async () => {
    const data = [
      { bezirk: 'Mitte' },
      { bezirk: 'Mitte' },
      { bezirk: 'Pankow' },
    ];

    const code = `
      const counts = data.reduce((acc, row) => {
        acc[row.bezirk] = (acc[row.bezirk] || 0) + 1;
        return acc;
      }, {});
      counts;
    `;

    const result = await executor.execute(code, { data });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ Mitte: 2, Pankow: 1 });
  });

  test('should reject code with require()', async () => {
    const result = await executor.execute('require("fs")');
    expect(result.success).toBe(false);
    expect(result.error).toContain('forbidden pattern');
  });

  test('should reject code with import', async () => {
    const result = await executor.execute('import fs from "fs"');
    expect(result.success).toBe(false);
    expect(result.error).toContain('forbidden pattern');
  });

  test('should reject code with process', async () => {
    const result = await executor.execute('process.exit(1)');
    expect(result.success).toBe(false);
    expect(result.error).toContain('forbidden pattern');
  });

  test('should reject code with eval', async () => {
    const result = await executor.execute('eval("1+1")');
    expect(result.success).toBe(false);
    expect(result.error).toContain('forbidden pattern');
  });

  test('should timeout long-running code', async () => {
    const executor = new CodeExecutor({ timeout: 100 });
    const result = await executor.execute('while(true) {}');

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  }, 10000);

  test('should handle errors gracefully', async () => {
    const result = await executor.execute('throw new Error("test error")');

    expect(result.success).toBe(false);
    expect(result.error).toContain('test error');
  });

  test('should handle syntax errors', async () => {
    const result = await executor.execute('const x = ;');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should return execution time', async () => {
    const result = await executor.execute('2 + 2');

    expect(result.success).toBe(true);
    expect(result.executionTime).toBeGreaterThan(0);
    expect(result.executionTime).toBeLessThan(1000);
  });

  test('should handle complex data transformations', async () => {
    const data = [
      { bezirk: 'Mitte', count: 5 },
      { bezirk: 'Pankow', count: 3 },
      { bezirk: 'Mitte', count: 7 },
    ];

    const code = `
      const grouped = data.reduce((acc, row) => {
        if (!acc[row.bezirk]) {
          acc[row.bezirk] = 0;
        }
        acc[row.bezirk] += row.count;
        return acc;
      }, {});

      Object.entries(grouped)
        .sort((a, b) => b[1] - a[1])
        .map(([bezirk, total]) => ({ bezirk, total }));
    `;

    const result = await executor.execute(code, { data });

    expect(result.success).toBe(true);
    expect(result.output).toEqual([
      { bezirk: 'Mitte', total: 12 },
      { bezirk: 'Pankow', total: 3 },
    ]);
  });

  test('should handle Math operations', async () => {
    const result = await executor.execute('Math.sqrt(16)');

    expect(result.success).toBe(true);
    expect(result.output).toBe(4);
  });

  test('should handle Array methods', async () => {
    const data = [1, 2, 3, 4, 5];
    const result = await executor.execute(
      'data.filter(x => x > 2).map(x => x * 2)',
      { data }
    );

    expect(result.success).toBe(true);
    expect(result.output).toEqual([6, 8, 10]);
  });
});
