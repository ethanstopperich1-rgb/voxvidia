// ── Tool Runner ──────────────────────────────────────────────────────────────
// Executes registered tool handlers with timeout protection and latency tracking.

import { createLogger } from '@voxvidia/shared';

const logger = createLogger('orchestrator:tool-runner');

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export class ToolRegistry {
  private handlers: Map<string, ToolHandler> = new Map();

  register(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
    logger.debug(`Registered tool: ${toolName}`);
  }

  has(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  get(toolName: string): ToolHandler | undefined {
    return this.handlers.get(toolName);
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }
}

export class ToolRunner {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async runTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number = 5000,
  ): Promise<ToolResult> {
    const handler = this.registry.get(toolName);
    if (!handler) {
      logger.error(`No handler registered for tool: ${toolName}`);
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
        latencyMs: 0,
      };
    }

    const start = performance.now();

    try {
      const result = await Promise.race([
        handler(args),
        createTimeout(timeoutMs, toolName),
      ]);

      const latencyMs = Math.round(performance.now() - start);

      logger.info(`Tool ${toolName} completed in ${latencyMs}ms`, {
        latencyMs,
        toolName,
      } as Record<string, unknown>);

      return {
        success: true,
        data: result,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      const errorMessage = err instanceof Error ? err.message : String(err);

      logger.error(`Tool ${toolName} failed: ${errorMessage}`, {
        latencyMs,
        toolName,
      } as Record<string, unknown>);

      return {
        success: false,
        error: errorMessage,
        latencyMs,
      };
    }
  }
}

function createTimeout(ms: number, toolName: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`Tool ${toolName} timed out after ${ms}ms`));
    }, ms);
  });
}
