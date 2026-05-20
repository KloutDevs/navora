import { getResolvedCdpPort, isChromeReachable } from './chrome-launcher.js';
import * as browser from './browser.js';

export const TOOLS = [
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
    description: 'Wait for a CSS selector or text content to appear in the page. Provide either selector or text, not both.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        text: { type: 'string', description: 'Text to wait for in page body' },
        caseSensitive: { type: 'boolean', description: 'Case-sensitive text match (default: false)' },
        timeout: { type: 'number', description: 'Max wait in ms (default: 5000)' },
        tabId: { type: 'number', description: 'Tab ID (optional)' },
      },
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

export const CDP_TOOLS = [
  {
    name: 'cdp_evaluate',
    description: 'Evaluate a JavaScript expression in the page via Chrome DevTools Protocol (direct CDP).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
        tabId: { type: 'number', description: 'Optional tab id' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'cdp_send_command',
    description: 'Send a raw CDP method with optional params (direct CDP).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', description: 'CDP method, e.g. Runtime.evaluate' },
        params: { type: 'object', description: 'Optional CDP params object' },
        tabId: { type: 'number' },
      },
      required: ['method'],
    },
  },
  {
    name: 'cdp_network_har',
    description: 'Sample network-related CDP data (minimal implementation).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tabId: { type: 'number' },
      },
    },
  },
] as const;

export type ToolArgs = Record<string, unknown>;

export async function resolveActiveTools(): Promise<readonly unknown[]> {
  const base = [...TOOLS];
  if (process.env['NAVORA_CDP_PORT'] === undefined || process.env['NAVORA_CDP_PORT'] === '') {
    return base;
  }
  const port = getResolvedCdpPort();
  if (await isChromeReachable(port)) {
    return [...base, ...CDP_TOOLS];
  }
  return base;
}

export async function callTool(name: string, args: ToolArgs): Promise<unknown> {
  const tabId = typeof args['tabId'] === 'number' ? args['tabId'] : undefined;

  switch (name) {
    case 'browser_navigate': {
      const url = String(args['url'] ?? '');
      return browser.navigate(url, tabId);
    }
    case 'browser_screenshot': {
      const raw = (await browser.takeScreenshot(tabId)) as unknown;
      const b64 =
        typeof raw === 'object' && raw !== null && 'data' in raw
          ? (raw as { data: string }).data
          : (raw as string);
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
      const text = typeof args['text'] === 'string' ? args['text'] : undefined;
      const selector = typeof args['selector'] === 'string' ? args['selector'] : undefined;
      const timeout = typeof args['timeout'] === 'number' ? args['timeout'] : undefined;
      const caseSensitive = typeof args['caseSensitive'] === 'boolean' ? args['caseSensitive'] : undefined;
      if (text) return browser.waitForText(text, timeout, caseSensitive, tabId);
      return browser.waitForSelector(selector ?? '', timeout, tabId);
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
    case 'cdp_evaluate':
      return browser.cdpEvaluate(String(args['expression'] ?? ''), tabId);
    case 'cdp_send_command': {
      const method = String(args['method'] ?? '');
      const p = args['params'] as Record<string, unknown> | undefined;
      return browser.cdpSendCommand(method, p, tabId);
    }
    case 'cdp_network_har':
      return browser.cdpNetworkHar(tabId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function baseToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

export function cdpToolNames(): string[] {
  return CDP_TOOLS.map((t) => t.name);
}
