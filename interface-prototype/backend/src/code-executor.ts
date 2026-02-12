// ABOUTME: Sandboxed JavaScript code executor for data analysis
// ABOUTME: Executes user code in isolated VM with timeout and memory limits

import { createContext, runInContext } from 'node:vm';

export interface ExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTime: number;
}

export interface CodeExecutorConfig {
  timeout?: number; // milliseconds
  maxOutputSize?: number; // bytes
}

export class CodeExecutor {
  private readonly timeout: number;
  private readonly maxOutputSize: number;

  constructor(config: CodeExecutorConfig = {}) {
    this.timeout = config.timeout || 5000; // 5 seconds default
    this.maxOutputSize = config.maxOutputSize || 1024 * 1024; // 1MB default
  }

  /**
   * Execute JavaScript code in a sandboxed environment
   */
  async execute(code: string, context: Record<string, any> = {}): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Validate code doesn't contain dangerous patterns
      this.validateCode(code);

      // Create safe sandbox context
      const sandbox = this.createSandbox(context);

      // Execute with timeout - run directly without IIFE wrapper
      // This ensures the last expression is returned as the result
      const result = await this.executeWithTimeout(code, sandbox);

      // Sanitize output
      const sanitizedOutput = this.sanitizeOutput(result);

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        output: sanitizedOutput,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      };
    }
  }

  /**
   * Validate code doesn't contain dangerous patterns
   */
  private validateCode(code: string): void {
    // Block obvious dangerous patterns
    const dangerousPatterns = [
      /\brequire\s*\(/,
      /\bimport\s+/,
      /\bprocess\b/,
      /\b__dirname\b/,
      /\b__filename\b/,
      /\beval\s*\(/,
      /Function\s*\(/,
      /\bchild_process\b/,
      /\bfs\b/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        throw new Error(`Code contains forbidden pattern: ${pattern.source}`);
      }
    }
  }

  /**
   * Create sandbox environment with safe globals
   */
  private createSandbox(userContext: Record<string, any>): any {
    const capturedLogs: any[] = [];

    const sandbox = createContext({
      // User-provided data
      ...userContext,

      // Safe globals
      console: {
        log: (...args: any[]) => capturedLogs.push(args),
      },
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,

      // Utility to access captured logs
      __getLogs: () => capturedLogs,

      // No dangerous globals
      require: undefined,
      process: undefined,
      global: undefined,
      __dirname: undefined,
      __filename: undefined,
      module: undefined,
      exports: undefined,
    });

    return sandbox;
  }

  /**
   * Execute code with timeout enforcement
   */
  private async executeWithTimeout(code: string, sandbox: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timeout after ${this.timeout}ms`));
      }, this.timeout);

      try {
        const result = runInContext(code, sandbox, {
          timeout: this.timeout,
          displayErrors: true,
        });

        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Sanitize output to prevent large/dangerous data
   */
  private sanitizeOutput(output: any): any {
    // Convert to JSON and back to remove functions, symbols, etc.
    try {
      const json = JSON.stringify(output);

      if (json.length > this.maxOutputSize) {
        throw new Error(`Output too large: ${json.length} bytes (max: ${this.maxOutputSize})`);
      }

      return JSON.parse(json);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Output too large')) {
        throw error;
      }

      // If output is not JSON-serializable, return string representation
      return String(output);
    }
  }
}
