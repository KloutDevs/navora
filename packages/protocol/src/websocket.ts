import { z } from 'zod';

/**
 * WebSocket protocol types for real-time event streaming.
 * JSON-RPC 2.0 based with custom event subscription model.
 */

// Base WebSocket message schema
export const WSMessageSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

export type WSMessage = z.infer<typeof WSMessageSchema>;

// Envelope with event metadata
export const WSEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('request'),
    method: z.string(),
    id: z.union([z.string(), z.number()]),
    params: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('response'),
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('event'),
    event: z.string(),
    data: z.record(z.unknown()).optional(),
    timestamp: z.number().optional(),
  }),
  z.object({
    type: z.literal('subscription'),
    action: z.enum(['subscribe', 'unsubscribe']),
    events: z.array(z.string()),
  }),
]);

export type WSEnvelope = z.infer<typeof WSEnvelopeSchema>;