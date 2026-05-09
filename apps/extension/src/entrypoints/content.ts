import { defineContentScript } from 'wxt/sandbox';

// Console capture buffer (FR-NI, get_console)
const consoleLogs: Array<{ type: string; timestamp: number; args: string[] }> = [];
const MAX_LOGS = 200;

// Shadow DOM host for overlay HUD
let hudHost: HTMLElement | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // --- Console capture (Phase 15, T-096) ---
    const methods = ['log', 'warn', 'error', 'info', 'debug'] as const;
    for (const level of methods) {
      const orig = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        orig(...args);
        consoleLogs.push({
          type: level,
          timestamp: Date.now(),
          args: args.map((a) => (typeof a === 'object' ? safeJson(a) : String(a))),
        });
        if (consoleLogs.length > MAX_LOGS) consoleLogs.shift();
      };
    }

    // --- abr-id tracking (Phase 15, T-093) ---
    const abrIdMap = new WeakMap<Element, string>();
    let abrCounter = 0;

    function isInteractive(el: Element): boolean {
      const tag = el.tagName.toLowerCase();
      if (['a', 'button', 'input', 'select', 'textarea', 'label', 'details', 'summary'].includes(tag)) return true;
      const role = el.getAttribute('role') ?? '';
      return ['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'combobox', 'textbox', 'option'].includes(role);
    }

    function injectAbrIds(): void {
      abrCounter = 0;
      for (const el of document.querySelectorAll('*')) {
        if (isInteractive(el) && !abrIdMap.has(el)) {
          const id = `abr-${el.tagName.toLowerCase()}-${++abrCounter}`;
          el.setAttribute('data-abr-id', id);
          abrIdMap.set(el, id);
        }
      }
    }

    function resolveEl(selector: string): Element | null {
      try {
        const byAbr = document.querySelector(`[data-abr-id="${CSS.escape(selector)}"]`);
        if (byAbr) return byAbr;
      } catch { /* ignore */ }
      try { return document.querySelector(selector); } catch { return null; }
    }

    // --- DOM extraction (Phase 15, T-092) ---
    function extractDom() {
      injectAbrIds();
      const MAX = 2 * 1024 * 1024;
      const html = document.documentElement.outerHTML;
      return html.length > MAX
        ? { html: html.slice(0, MAX), truncated: true, truncatedAtBytes: MAX }
        : { html, truncated: false };
    }

    function extractText(): string {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (['script', 'style', 'noscript'].includes(p.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
          const s = window.getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const parts: string[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = n.textContent?.trim();
        if (t) parts.push(t);
      }
      return parts.join(' ');
    }

    // --- Interaction tools (Phase 15, T-094, T-095) ---
    function clickElement(selector: string) {
      const el = resolveEl(selector);
      if (!el) return { success: false, error: `Element not found: ${selector}` };
      (el as HTMLElement).focus();
      (el as HTMLElement).click();
      return { success: true };
    }

    function typeText(text: string, selector?: string) {
      const el: Element | null = selector ? resolveEl(selector) : document.activeElement;
      if (!el || !(el instanceof HTMLElement)) return { success: false, error: 'No target element' };
      el.focus();
      const inputEl = el as HTMLInputElement;
      // Trigger native React/Vue reactivity via native value setter
      const proto = inputEl instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const next = (inputEl.value ?? '') + text;
      if (setter) setter.call(inputEl, next);
      else inputEl.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }

    function scroll(selector?: string, deltaY = 300) {
      const target = selector ? (resolveEl(selector) as HTMLElement | null) : null;
      if (target) target.scrollBy({ top: deltaY, behavior: 'smooth' });
      else window.scrollBy({ top: deltaY, behavior: 'smooth' });
      return { success: true };
    }

    async function waitForSelector(selector: string, timeout = 10000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (document.querySelector(selector)) return { success: true };
        await sleep(100);
      }
      return { success: false, error: `Timeout waiting for: ${selector}` };
    }

    function executeScript(source: string) {
      try {
        // indirect eval to avoid strict-mode scoping
        // eslint-disable-next-line no-new-func
        const result = new Function(`return (${source})`)();
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // --- Overlay HUD (Phase 16, T-098) ---
    function injectOverlay(confirmation: {
      id: string;
      action: string;
      details: Record<string, unknown>;
      domain: string;
    }) {
      removeOverlay();
      hudHost = document.createElement('div');
      hudHost.id = '__abr-hud-host__';
      Object.assign(hudHost.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
        zIndex: '2147483647', pointerEvents: 'none',
      });
      document.documentElement.appendChild(hudHost);

      const shadow = hudHost.attachShadow({ mode: 'open' });
      const script = confirmation.details.source ? escHtml(String(confirmation.details.source)) : null;

      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .backdrop {
            position: fixed; inset: 0; background: rgba(0,0,0,0.55);
            display: flex; align-items: center; justify-content: center;
            pointer-events: all; font-family: system-ui,-apple-system,sans-serif;
          }
          .card {
            background: #fff; border-radius: 12px; padding: 24px 28px;
            max-width: 500px; width: 90%; box-shadow: 0 24px 64px rgba(0,0,0,0.35);
            color: #111;
          }
          .title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
          .subtitle { font-size: 13px; color: #6b7280; margin-bottom: 16px; }
          .row { margin-bottom: 12px; }
          .label { font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
          .value { font-size: 14px; color: #374151; }
          .code { background: #f3f4f6; border-radius: 6px; padding: 8px 12px; font-family: monospace; font-size: 12px; word-break: break-all; max-height: 100px; overflow-y: auto; white-space: pre-wrap; }
          .timer { font-size: 12px; color: #ef4444; margin-top: 14px; font-weight: 500; }
          .actions { display: flex; gap: 10px; margin-top: 18px; }
          .deny { flex: 1; padding: 10px; background: #fff; border: 1.5px solid #d1d5db; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; color: #374151; transition: background .15s; }
          .deny:hover { background: #f3f4f6; }
          .approve { flex: 1; padding: 10px; background: #1e40af; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background .15s; }
          .approve:hover { background: #1d3a8a; }
        </style>
        <div class="backdrop">
          <div class="card">
            <div class="title">⚠️ Permission Required</div>
            <div class="subtitle">An AI agent is requesting to run a privileged action.</div>
            <div class="row">
              <div class="label">Tool</div>
              <div class="value">${escHtml(confirmation.action)}</div>
            </div>
            <div class="row">
              <div class="label">Domain</div>
              <div class="value">${escHtml(confirmation.domain)}</div>
            </div>
            ${script ? `<div class="row"><div class="label">Script</div><div class="code">${script}</div></div>` : ''}
            <div class="timer" id="timer">Auto-denying in 30s</div>
            <div class="actions">
              <button class="deny" id="deny">Deny</button>
              <button class="approve" id="approve">Approve</button>
            </div>
          </div>
        </div>
      `;

      let remaining = 30;
      const timerEl = shadow.getElementById('timer')!;
      const interval = setInterval(() => {
        remaining--;
        timerEl.textContent = `Auto-denying in ${remaining}s`;
        if (remaining <= 0) { clearInterval(interval); respond(false); }
      }, 1000);

      function respond(approved: boolean) {
        clearInterval(interval);
        chrome.runtime.sendMessage({ type: 'CONFIRM_ACTION', payload: { id: confirmation.id, approved } });
        removeOverlay();
      }

      shadow.getElementById('approve')!.addEventListener('click', () => respond(true));
      shadow.getElementById('deny')!.addEventListener('click', () => respond(false));
      return { success: true };
    }

    function removeOverlay() {
      hudHost?.remove();
      hudHost = null;
      return { success: true };
    }

    // --- Message listener ---
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'REQUEST_CONFIRMATION') {
        injectOverlay(message.payload as Parameters<typeof injectOverlay>[0]);
        sendResponse({ success: true });
        return false;
      }
      if (message.type !== 'TOOL_REQUEST') return false;

      const { method, params } = message as { method: string; params: Record<string, unknown> };
      (async () => {
        try {
          let result: unknown;
          switch (method) {
            case 'extractDom':       result = extractDom(); break;
            case 'extractText':      result = extractText(); break;
            case 'clickElement':     result = clickElement(params.selector as string); break;
            case 'typeText':         result = typeText(params.text as string, params.selector as string | undefined); break;
            case 'scroll':           result = scroll(params.selector as string | undefined, params.deltaY as number | undefined); break;
            case 'waitForSelector':  result = await waitForSelector(params.selector as string, params.timeout as number | undefined); break;
            case 'getConsoleLogs':   result = consoleLogs.slice(); break;
            case 'executeScript':    result = executeScript(params.source as string); break;
            default:
              sendResponse({ success: false, error: `Unknown method: ${method}` });
              return;
          }
          sendResponse({ success: true, result });
        } catch (err) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;
    });
  },
});

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function safeJson(v: unknown): string { try { return JSON.stringify(v); } catch { return String(v); } }
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
