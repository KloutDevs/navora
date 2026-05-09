import { z } from 'zod';

/**
 * Native Messaging message types for Chrome extension communication.
 * Uses 4-byte little-endian length prefix framing with 1MB max message size.
 */

// Request message schema
export const NMMessageSchema = z.object({
  request_id: z.string(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export type NMMessage = z.infer<typeof NMMessageSchema>;

// Envelope wrapper with framing metadata
export const NMEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('request'),
    ...NMMessageSchema.shape,
  }),
  z.object({
    kind: z.literal('response'),
    request_id: z.string(),
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('error'),
    request_id: z.string().optional(),
    code: z.string(),
    message: z.string(),
  }),
]);

export type NMEnvelope = z.infer<typeof NMEnvelopeSchema>;

// Acknowledgment without full response body
export const NMAcknowledgmentSchema = z.object({
  request_id: z.string(),
  received_at: z.number(),
});

export type NMAcknowledgment = z.infer<typeof NMAcknowledgmentSchema>;