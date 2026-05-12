#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ensureChrome } from './chrome-bootstrap.js';
import { ensureDaemon } from './daemon-launcher.js';
import { callTool, resolveActiveTools, TOOLS, type ToolArgs } from './tool-dispatcher.js';

async function main(): Promise<void> {
  await ensureChrome();
  await ensureDaemon();

  const activeTools = await resolveActiveTools();

  const server = new Server(
    { name: 'ai-browser-runtime', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: activeTools as (typeof TOOLS)[number][] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      const result = await callTool(name, args as ToolArgs);

      if (name === 'browser_screenshot' && typeof (result as { base64?: string }).base64 === 'string') {
        return {
          content: [
            {
              type: 'image' as const,
              data: (result as { base64: string }).base64,
              mimeType: 'image/png',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`[ai-browser] Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
