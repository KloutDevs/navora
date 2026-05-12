/**
 * DaemonClient — connects to the ai-browser daemon WebSocket hub.
 * Handles auth/login handshake and routes tool calls via JSON-RPC 2.0.
 */

import { createHmac } from 'node:crypto';
import { WebSocket } from 'ws';

const DAEMON_PORT = Number(process.env['NAVORA_DAEMON_PORT'] ?? 51520);
const DAEMON_HOST = process.env['NAVORA_DAEMON_HOST'] ?? '127.0.0.1';
const AUTH_SECRET = process.env['NAVORA_AUTH_SECRET'] ?? 'dev-secret-change-in-production';
const PROFILE_ID = process.env['NAVORA_PROFILE_ID'] ?? 'default';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: { success: boolean; data?: unknown; error?: string };
  error?: { code: number; message: string };
}

function generateToken(profileId: string): string {
  const timestamp = Date.now();
  const signature = createHmac('sha256', AUTH_SECRET)
    .update(`${profileId}:${timestamp}`)
    .digest('hex');
  return Buffer.from(`${profileId}:${timestamp}:${signature}`).toString('base64');
}

export class DaemonClient {
  private ws: WebSocket | null = null;
  private reqId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ready: Promise<void> | null = null;

  async connect(): Promise<void> {
    // Return in-flight or completed connection
    if (this.ready) return this.ready;

    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const ws = new WebSocket(`ws://${DAEMON_HOST}:${DAEMON_PORT}`);
      this.ws = ws;

      ws.on('open', () => {
        const authId = this.reqId++;
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: authId,
          method: 'auth/login',
          params: { token: generateToken(PROFILE_ID) },
        }));
        this.pending.set(authId, {
          resolve: () => resolveReady(),
          reject: (e) => rejectReady(e),
        });
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as JsonRpcResponse;
          const handler = this.pending.get(msg.id);
          if (!handler) return;
          this.pending.delete(msg.id);

          if (msg.error) {
            handler.reject(new Error(`Daemon error ${msg.error.code}: ${msg.error.message}`));
          } else if (msg.result && !msg.result.success) {
            handler.reject(new Error(msg.result.error ?? 'Tool call failed'));
          } else {
            handler.resolve(msg.result?.data ?? msg.result);
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on('error', (e) => {
        this.ready = null;
        rejectReady(e);
      });

      ws.on('close', () => {
        for (const [, handler] of this.pending) {
          handler.reject(new Error('Daemon WebSocket closed'));
        }
        this.pending.clear();
        this.ws = null;
        this.ready = null;
      });
    });

    return this.ready;
  }

  async call(tool: string, params: Record<string, unknown>): Promise<unknown> {
    await this.connect();

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Daemon not connected');
    }

    return new Promise((resolve, reject) => {
      const id = this.reqId++;
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          tool,
          params,
          profileId: PROFILE_ID,
        },
      }));
    });
  }

  dispose(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton client — reused across all tool calls
export const daemonClient = new DaemonClient();
