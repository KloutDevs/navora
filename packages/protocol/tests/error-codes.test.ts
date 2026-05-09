import { describe, it, expect } from 'vitest';
import { ProtocolErrorCode, WSProtocolError, WSProtocolWarning } from '../src/index.js';

describe('Error Codes', () => {
  describe('ProtocolErrorCode enum', () => {
    it('should have all transport error codes in range 1xxx', () => {
      expect(ProtocolErrorCode.PROTOCOL_PARSE_ERROR).toBe(1000);
      expect(ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH).toBe(1001);
      expect(ProtocolErrorCode.PROTOCOL_TIMEOUT).toBe(1002);
      expect(ProtocolErrorCode.PROTOCOL_CONNECTION_CLOSED).toBe(1003);
    });

    it('should have all bridge error codes in range 2xxx', () => {
      expect(ProtocolErrorCode.BRIDGE_TIMEOUT).toBe(2000);
      expect(ProtocolErrorCode.BRIDGE_DISCONNECTED).toBe(2001);
      expect(ProtocolErrorCode.BRIDGE_MESSAGE_TOO_LARGE).toBe(2002);
      expect(ProtocolErrorCode.BRIDGE_FRAMING_ERROR).toBe(2003);
    });

    it('should have all session error codes in range 3xxx', () => {
      expect(ProtocolErrorCode.SESSION_NOT_FOUND).toBe(3000);
      expect(ProtocolErrorCode.SESSION_LIMIT_REACHED).toBe(3001);
      expect(ProtocolErrorCode.SESSION_EXPIRED).toBe(3002);
      expect(ProtocolErrorCode.SESSION_INVALID_TOKEN).toBe(3003);
    });

    it('should have all permission error codes in range 4xxx', () => {
      expect(ProtocolErrorCode.PERMISSION_DENIED).toBe(4000);
      expect(ProtocolErrorCode.DOMAIN_NOT_ALLOWED).toBe(4001);
      expect(ProtocolErrorCode.HUD_TIMEOUT).toBe(4002);
      expect(ProtocolErrorCode.HUD_DENIED).toBe(4003);
    });

    it('should have all tool execution error codes in range 5xxx', () => {
      expect(ProtocolErrorCode.TOOL_NOT_FOUND).toBe(5000);
      expect(ProtocolErrorCode.INVALID_PARAMS).toBe(5001);
      expect(ProtocolErrorCode.TOOL_TIMEOUT).toBe(5002);
      expect(ProtocolErrorCode.TOOL_EXECUTION_FAILED).toBe(5003);
      expect(ProtocolErrorCode.SELECTOR_DRIFT).toBe(5004);
    });

    it('should have all browser context error codes in range 6xxx', () => {
      expect(ProtocolErrorCode.CONTEXT_CLOSED).toBe(6000);
      expect(ProtocolErrorCode.CONTEXT_TAB_NOT_FOUND).toBe(6001);
      expect(ProtocolErrorCode.CONTEXT_NAVIGATION_FAILED).toBe(6002);
      expect(ProtocolErrorCode.CONTEXT_STALE).toBe(6003);
    });
  });

  describe('WSProtocolError enum', () => {
    it('should have WebSocket protocol error codes starting at 6000', () => {
      expect(WSProtocolError.INVALID_JSON).toBe(6000);
      expect(WSProtocolError.MISSING_METHOD).toBe(6001);
      expect(WSProtocolError.INVALID_SUBSCRIPTION).toBe(6002);
      expect(WSProtocolError.RATE_LIMIT_EXCEEDED).toBe(6003);
      expect(WSProtocolError.AUTHENTICATION_FAILED).toBe(6004);
      expect(WSProtocolError.UNKNOWN_ERROR).toBe(6005);
    });
  });

  describe('WSProtocolWarning enum', () => {
    it('should have WebSocket protocol warning codes starting at 7000', () => {
      expect(WSProtocolWarning.LARGE_PAYLOAD).toBe(7000);
      expect(WSProtocolWarning.SLOW_RESPONSE).toBe(7001);
      expect(WSProtocolWarning.MISSING_TIMESTAMP).toBe(7002);
      expect(WSProtocolWarning.UNSUBSCRIBED_EVENT).toBe(7003);
    });
  });
});