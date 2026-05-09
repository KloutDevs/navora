import { describe, it, expect } from 'vitest';
import {
  NMMessageSchema,
  NMEnvelopeSchema,
  WSMessageSchema,
  WSEnvelopeSchema,
} from '../src/index.js';

describe('Schema Roundtrip Tests', () => {
  describe('NM schema roundtrip', () => {
    it('should roundtrip a request message through JSON', () => {
      const original = {
        request_id: 'req-roundtrip-123',
        method: 'getTabs',
        params: { profile_id: 'default', window_id: 1 },
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = NMMessageSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.request_id).toBe(original.request_id);
        expect(result.data.method).toBe(original.method);
        expect(result.data.params).toEqual(original.params);
      }
    });

    it('should roundtrip an NM envelope through JSON', () => {
      const original = {
        kind: 'response' as const,
        request_id: 'req-123',
        success: true,
        result: {
          tabs: [
            {
              tabId: 1,
              url: 'https://example.com',
              title: 'Example',
              status: 'complete',
              windowId: 1,
            },
          ],
        },
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = NMEnvelopeSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe('response');
        expect(result.data.request_id).toBe(original.request_id);
        expect(result.data.success).toBe(original.success);
        expect(result.data.result).toBeDefined();
      }
    });

    it('should handle nested objects in params', () => {
      const original = {
        kind: 'request' as const,
        request_id: 'req-complex',
        method: 'clickElement',
        params: {
          selector: '#submit-btn',
          mouse_x: 10,
          mouse_y: 20,
          options: {
            timeout: 5000,
            retry_count: 3,
          },
        },
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = NMEnvelopeSchema.safeParse(parsed);

      expect(result.success).toBe(true);
    });

    it('should preserve error objects in responses', () => {
      const original = {
        kind: 'response' as const,
        request_id: 'req-error-123',
        success: false,
        error: {
          code: 'BRIDGE_TIMEOUT',
          message: 'Extension did not respond within 8s',
        },
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = NMEnvelopeSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success && result.data.kind === 'response') {
        expect(result.data.error).toBeDefined();
        if (result.data.error) {
          expect(result.data.error.code).toBe('BRIDGE_TIMEOUT');
          expect(result.data.error.message).toBe('Extension did not respond within 8s');
        }
      }
    });
  });

  describe('WS schema roundtrip', () => {
    it('should roundtrip a JSON-RPC request through JSON', () => {
      const original = {
        jsonrpc: '2.0' as const,
        id: 'ws-req-123',
        method: 'subscribe',
        params: { events: ['tab_navigated', 'console_entry'] },
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = WSMessageSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.method).toBe('subscribe');
        expect(result.data.params).toEqual(original.params);
      }
    });

    it('should roundtrip a WS event envelope through JSON', () => {
      const original = {
        type: 'event' as const,
        event: 'hud_request',
        data: {
          tool: 'execute_script',
          client_name: 'TestClient',
          target_url: 'https://example.com',
          script_content: 'console.log("test")',
        },
        timestamp: Date.now(),
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = WSEnvelopeSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'event') {
        expect(result.data.event).toBe('hud_request');
        expect(result.data.data).toBeDefined();
        expect(result.data.timestamp).toBeDefined();
      }
    });

    it('should roundtrip a WS subscription message', () => {
      const original = {
        type: 'subscription' as const,
        action: 'subscribe' as const,
        events: ['tab_navigated', 'tabs_changed', 'hud_request'],
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = WSEnvelopeSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'subscription') {
        expect(result.data.action).toBe('subscribe');
        expect(result.data.events).toHaveLength(3);
      }
    });

    it('should handle numeric ids in JSON-RPC messages', () => {
      const original = {
        jsonrpc: '2.0' as const,
        id: 42,
        result: { success: true },
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = WSMessageSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(42);
      }
    });
  });

  describe('Large payload roundtrip', () => {
    it('should handle large params object', () => {
      const largeParams: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        largeParams[`key_${i}`] = `value_${i}_${'x'.repeat(100)}`;
      }

      const original = {
        request_id: 'req-large',
        method: 'extractDOM',
        params: largeParams,
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = NMMessageSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data.params ?? {})).toHaveLength(100);
      }
    });

    it('should handle nested array data', () => {
      const original = {
        kind: 'response' as const,
        request_id: 'req-array',
        success: true,
        result: {
          tabs: Array.from({ length: 50 }, (_, i) => ({
            tabId: i,
            url: `https://example${i}.com`,
            title: `Tab ${i}`,
            status: i % 2 === 0 ? 'complete' : 'loading',
            windowId: 1,
          })),
        },
      };

      const jsonString = JSON.stringify(original);
      const parsed = JSON.parse(jsonString);
      const result = NMEnvelopeSchema.safeParse(parsed);

      expect(result.success).toBe(true);
      if (result.success && result.data.kind === 'response') {
        expect(result.data.result).toBeDefined();
      }
    });
  });
});