#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { isChromeReachable, launchChrome } from './chrome-launcher.js';
import { ensureDaemon } from './daemon-launcher.js';
import * as browser from './browser.js';

// ─── Startup: ensure Chrome + daemon are running ─────────────────────────────

async function ensureChrome(): Promise<void> {
  if (await isChromeReachable()) return;

  process.stderr.write('[ai-browser] Chrome not found on CDP port 9222, attempting launch...\n');
  try {
    await launchChrome();
    process.stderr.write('[ai-browser] Chrome launched successfully.\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[ai-browser] Warning: ${msg}\n`);
    process.stderr.write('[ai-browser] Continuing — some tools may fail until Chrome is reachable.\n');
  }
}

// ─── Tool registry ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'browser_navigate',
    description: 'Navigate the active browser tab to a URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        tabId: { type: 'number', description: 'Tab ID (optional, defaults to active tab)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the active tab as a base64-encoded PNG.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
    },
  },
  {
    name: 'browser_get_dom',
    description: 'Get the serialized DOM of the current page including interactive element IDs (data-abr-id).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
    },
  },
  {
    name: 'browser_get_text',
    description: 'Extract visible text content from the current page.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by CSS selector or data-abr-id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector or data-abr-id value' },
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into a focused input or a specific element.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to type' },
        selector: { type: 'string', description: 'Target element selector (optional — uses currently focused element)' },
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page or a specific element.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deltaY: { type: 'number', description: 'Pixels to scroll (positive = down, negative = up)' },
        selector: { type: 'string', description: 'Element to scroll (optional — scrolls window if omitted)' },
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
      required: ['deltaY'],
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait for a CSS selector to appear in the DOM.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Max wait in ms (default: 5000)' },
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_execute_script',
    description: 'Execute arbitrary JavaScript in the page context. Returns the script result.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'JavaScript code to execute' },
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
      required: ['source'],
    },
  },
  {
    name: 'browser_get_console',
    description: 'Get captured console log entries from the current page.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
    },
  },
  {
    name: 'browser_get_tabs',
    description: 'List all open browser tabs with their URLs and titles.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_go_back',
    description: 'Navigate back in the browser history.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
    },
  },
] as const;

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

type Args = Record<string, unknown>;

async function callTool(name: string, args: Args): Promise<unknown> {
  const tabId = typeof args['tabId'] === 'number' ? args['tabId'] : undefined;

  switch (name) {
    case 'browser_navigate': {
      const url = String(args['url'] ?? '');
      return browser.navigate(url, tabId);
    }
    case 'browser_screenshot': {
      const raw = await browser.takeScreenshot(tabId) as unknown;
      // CDP Page.captureScreenshot returns { data: base64 }, not a bare string
      const b64 = (typeof raw === 'object' && raw !== null && 'data' in raw)
        ? (raw as { data: string }).data
        : raw as string;
      return { base64: b64 };
    }
    case 'browser_get_dom':
      return browser.extractDom(tabId);
    case 'browser_get_text':
      return { text: await browser.extractText(tabId) };
    case 'browser_click': {
      const selector = String(args['selector'] ?? '');
      return browser.clickElement(selector, tabId);
    }
    case 'browser_type': {
      const text = String(args['text'] ?? '');
      const selector = typeof args['selector'] === 'string' ? args['selector'] : undefined;
      return browser.typeText(text, selector, tabId);
    }
    case 'browser_scroll': {
      const deltaY = Number(args['deltaY'] ?? 0);
      const selector = typeof args['selector'] === 'string' ? args['selector'] : undefined;
      return browser.scroll(selector, deltaY, tabId);
    }
    case 'browser_wait_for': {
      const selector = String(args['selector'] ?? '');
      const timeout = typeof args['timeout'] === 'number' ? args['timeout'] : undefined;
      return browser.waitForSelector(selector, timeout, tabId);
    }
    case 'browser_execute_script': {
      const source = String(args['source'] ?? '');
      return browser.executeScript(source, tabId);
    }
    case 'browser_get_console':
      return browser.getConsoleLogs(tabId);
    case 'browser_get_tabs':
      return browser.getTabs();
    case 'browser_go_back':
      return browser.goBack(tabId);
    case 'browser_reload':
      return browser.reload(tabId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await ensureChrome();
  await ensureDaemon();

  const server = new Server(
    { name: 'ai-browser-runtime', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      const result = await callTool(name, args as Args);

      // Screenshots get special treatment — return as image content
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
