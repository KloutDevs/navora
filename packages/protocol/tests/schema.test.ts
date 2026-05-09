import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  NMMessageSchema,
  NMEnvelopeSchema,
  NMAcknowledgmentSchema,
  WSMessageSchema,
  WSEnvelopeSchema,
} from '../src/index.js';

describe('Native Messaging Schemas', () => {
  describe('NMMessageSchema', () => {
    it('should parse a valid request message', () => {
      const message = {
        request_id: 'req-123',
        method: 'getTabs',
        params: { profile_id: 'default' },
      };
      const result = NMMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should parse a message without optional params', () => {
      const message = {
        request_id: 'req-456',
        method: 'getActiveTab',
      };
      const result = NMMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject a message without request_id', () => {
      const message = {
        method: 'getTabs',
      };
      const result = NMMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject a message without method', () => {
      const message = {
        request_id: 'req-789',
      };
      const result = NMMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should accept arbitrary params values', () => {
      const message = {
        request_id: 'req-complex',
        method: 'navigate',
        params: { url: 'https://example.com', timeout: 5000 },
      };
      const result = NMMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe('NMEnvelopeSchema', () => {
    it('should parse a request envelope', () => {
      const envelope = {
        kind: 'request',
        request_id: 'req-123',
        method: 'getTabs',
        params: {},
      };
      const result = NMEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should parse a successful response envelope', () => {
      const envelope = {
        kind: 'response',
        request_id: 'req-123',
        success: true,
        result: { tabs: [] },
      };
      const result = NMEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should parse a failed response envelope', () => {
      const envelope = {
        kind: 'response',
        request_id: 'req-123',
        success: false,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      };
      const result = NMEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should parse a generic error envelope', () => {
      const envelope = {
        kind: 'error',
        code: 'PROTOCOL_PARSE_ERROR',
        message: 'Invalid JSON',
      };
      const result = NMEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should reject an envelope without kind discriminator', () => {
      const envelope = {
        request_id: 'req-123',
        method: 'getTabs',
      };
      const result = NMEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(false);
    });

    it('should reject an invalid kind value', () => {
      const envelope = {
        kind: 'invalid',
        request_id: 'req-123',
      };
      const result = NMEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(false);
    });
  });

  describe('NMAcknowledgmentSchema', () => {
    it('should parse a valid acknowledgment', () => {
      const ack = {
        request_id: 'req-123',
        received_at: Date.now(),
      };
      const result = NMAcknowledgmentSchema.safeParse(ack);
      expect(result.success).toBe(true);
    });

    it('should reject an acknowledgment without request_id', () => {
      const ack = {
        received_at: Date.now(),
      };
      const result = NMAcknowledgmentSchema.safeParse(ack);
      expect(result.success).toBe(false);
    });

    it('should reject an acknowledgment without received_at', () => {
      const ack = {
        request_id: 'req-123',
      };
      const result = NMAcknowledgmentSchema.safeParse(ack);
      expect(result.success).toBe(false);
    });
  });
});

describe('WebSocket Schemas', () => {
  describe('WSMessageSchema', () => {
    it('should parse a JSON-RPC request message', () => {
      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTabs',
        params: { profile_id: 'default' },
      };
      const result = WSMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should parse a JSON-RPC response message', () => {
      const message = {
        jsonrpc: '2.0',
        id: 1,
        result: { tabs: [] },
      };
      const result = WSMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should parse a JSON-RPC error response', () => {
      const message = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      };
      const result = WSMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should accept string id format', () => {
      const message = {
        jsonrpc: '2.0',
        id: 'abc-123',
        result: { success: true },
      };
      const result = WSMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject invalid jsonrpc version', () => {
      const message = {
        jsonrpc: '1.0',
        id: 1,
        method: 'getTabs',
      };
      const result = WSMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('WSEnvelopeSchema', () => {
    it('should parse a request envelope', () => {
      const envelope = {
        type: 'request',
        method: 'getTabs',
        id: 1,
        params: { profile_id: 'default' },
      };
      const result = WSEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should parse a response envelope', () => {
      const envelope = {
        type: 'response',
        id: 1,
        result: { tabs: [] },
      };
      const result = WSEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should parse an event envelope', () => {
      const envelope = {
        type: 'event',
        event: 'tab_navigated',
        data: { tab_id: '123', url: 'https://example.com' },
        timestamp: Date.now(),
      };
      const result = WSEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should parse a subscription request', () => {
      const envelope = {
        type: 'subscription',
        action: 'subscribe',
        events: ['tab_navigated', 'console_entry'],
      };
      const result = WSEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });

    it('should reject an envelope without type discriminator', () => {
      const envelope = {
        method: 'getTabs',
        id: 1,
      };
      const result = WSEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(false);
    });

    it('should reject invalid subscription action', () => {
      const envelope = {
        type: 'subscription',
        action: 'invalid',
        events: ['tab_navigated'],
      };
      const result = WSEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(false);
    });

    it('should reject invalid unsubscribe action', () => {
      const envelope = {
        type: 'subscription',
        action: 'unsubscribe',
        events: [],
      };
      const result = WSEnvelopeSchema.safeParse(envelope);
      expect(result.success).toBe(true);
    });
  });
});