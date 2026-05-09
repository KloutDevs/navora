// Native Messaging types
export {
  NMMessageSchema,
  type NMMessage,
  NMEnvelopeSchema,
  type NMEnvelope,
  NMAcknowledgmentSchema,
  type NMAcknowledgment,
} from './native-messaging.js';

// WebSocket types
export {
  WSMessageSchema,
  type WSMessage,
  WSEnvelopeSchema,
  type WSEnvelope,
} from './websocket.js';

// Error codes
export { ProtocolErrorCode } from './error-codes.js';
export { WSProtocolError } from './error-codes.js';
export { WSProtocolWarning } from './error-codes.js';

// Protocol errors
export { ProtocolError, createProtocolError } from './errors.js';