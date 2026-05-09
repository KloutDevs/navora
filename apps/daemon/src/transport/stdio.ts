/**
 * @ai-browser-runtime/daemon - MCP Stdio Server Transport
 * Implements the stdio transport for MCP server communication
 */

import { MCPServer, MCPServerBuilder, parseJSONRPCRequest, parseJSONRPCBatchRequest, serializeJSONRPCResponse, type MCPServerOptions, type JSONRPCRequest } from "@ai-browser-runtime/mcp";

/**
 * Stdio transport options
 */
export interface StdioTransportOptions {
  /** The MCP server instance or builder options */
  serverOptions: MCPServerOptions;
  /** Stream to read from (default: stdin) */
  inputStream?: NodeJS.ReadableStream;
  /** Stream to write to (default: stdout) */
  outputStream?: NodeJS.WritableStream;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * StdioTransport implements the MCP stdio transport protocol.
 * 
 * Protocol:
 * - Messages are sent as JSON-RPC 2.0 strings terminated by a newline
 * - Reading is line-delimited (one JSON-RPC message per line)
 * - The transport handles both single requests and batch requests
 */
export class StdioTransport {
  private server: MCPServer;
  private input: NodeJS.ReadableStream;
  private output: NodeJS.WritableStream;
  private debug: boolean;
  private buffer: string = "";
  private isRunning: boolean = false;

  constructor(options: StdioTransportOptions) {
    // Create MCP server from options
    const builder = new MCPServerBuilder(options.serverOptions);
    this.server = builder.build();
    
    // Use provided streams or default to stdin/stdout
    this.input = options.inputStream ?? process.stdin;
    this.output = options.outputStream ?? process.stdout;
    this.debug = options.debug ?? false;
  }

  /**
   * Get the underlying MCP server
   */
  getServer(): MCPServer {
    return this.server;
  }

  /**
   * Start the stdio transport
   * Reads lines from stdin and processes them as JSON-RPC requests
   */
  start(): void {
    if (this.isRunning) {
      this.log("StdioTransport already running");
      return;
    }

    this.isRunning = true;
    this.log("StdioTransport started");

    // Set up line-by-line reading
    this.input.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.input.on("end", () => {
      this.log("StdioTransport: input stream ended");
      this.isRunning = false;
    });

    this.input.on("error", (err: Error) => {
      this.log(`StdioTransport: input error - ${err.message}`);
      this.isRunning = false;
    });
  }

  /**
   * Process the input buffer, extracting complete lines
   */
  private processBuffer(): void {
    // Split by newlines
    const lines = this.buffer.split("\n");
    
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    // Process each complete line
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        this.handleMessage(trimmed);
      }
    }
  }

  /**
   * Handle a single JSON-RPC message
   */
  private async handleMessage(rawMessage: string): Promise<void> {
    try {
      this.log(`Received: ${rawMessage.substring(0, 100)}...`);

      // Check if it's a batch request
      const trimmed = rawMessage.trim();
      if (trimmed.startsWith("[")) {
        // Batch request
        const batchResult = parseJSONRPCBatchRequest(trimmed);
        if (!batchResult.ok) {
          const errorResponse = {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32700,
              message: batchResult.error.message,
            },
          };
          this.sendResponse(serializeJSONRPCResponse(errorResponse as any));
          return;
        }

        const requests = batchResult.value;
        const responses: string[] = [];

        for (const request of requests) {
          const response = await this.server.handleParsedRequest(request);
          responses.push(response);
        }

        // Send batch response
        const batchResponse = `[${responses.join(",")}]`;
        this.sendResponse(batchResponse);
      } else {
        // Single request
        const response = await this.server.handleRequest(rawMessage);
        this.sendResponse(response);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.log(`Error handling message: ${errorMessage}`);
      const errorResponse = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: `Internal error: ${errorMessage}`,
        },
      };
      this.sendResponse(serializeJSONRPCResponse(errorResponse as any));
    }
  }

  /**
   * Send a response to stdout
   */
  private sendResponse(response: string): void {
    try {
      this.log(`Sending: ${response.substring(0, 100)}...`);
      this.output.write(response + "\n");
    } catch (err) {
      this.log(`Error sending response: ${(err as Error).message}`);
    }
  }

  /**
   * Stop the transport
   */
  stop(): void {
    this.isRunning = false;
    this.log("StdioTransport stopped");
  }

  /**
   * Check if transport is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Log a debug message if debug mode is enabled
   */
  private log(message: string): void {
    if (this.debug) {
      console.error(`[StdioTransport] ${message}`);
    }
  }
}

/**
 * Create a new StdioTransport instance
 */
export function createStdioTransport(options: StdioTransportOptions): StdioTransport {
  return new StdioTransport(options);
}

/**
 * Run the MCP server as a stdio server
 * This is a convenience function that creates and starts a transport
 */
export async function runStdioServer(serverOptions: MCPServerOptions): Promise<void> {
  const transport = createStdioTransport({
    serverOptions,
    debug: process.env["DEBUG"] === "true",
  });

  // Handle graceful shutdown
  const shutdown = () => {
    transport.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Start listening
  transport.start();
}