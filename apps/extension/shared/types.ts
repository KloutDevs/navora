/**
 * Shared types for the AI Browser Runtime extension
 */

export interface NMMessage {
  type: string;
  payload?: unknown;
  requestId?: string;
}

export interface NMRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface NMResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface ConnectionStatus {
  connected: boolean;
  daemonVersion?: string;
  lastConnected?: number;
  error?: string;
}

export interface DomainAllowlist {
  domains: string[];
  enabled: boolean;
}

export interface ConfirmationRequest {
  id: string;
  action: string;
  details: Record<string, unknown>;
  domain: string;
  timestamp: number;
}

export interface ExtensionState {
  connectionStatus: ConnectionStatus;
  allowlist: DomainAllowlist;
  pendingConfirmation: ConfirmationRequest | null;
}

// Message types for background-content communication
export type BackgroundMessage =
  | { type: 'EXECUTE_TOOL'; payload: NMRequest }
  | { type: 'GET_STATE' }
  | { type: 'CLEAR_ACTIVITY_LOG' }
  | { type: 'UPDATE_ALLOWLIST'; payload: DomainAllowlist }
  | { type: 'CONFIRM_ACTION'; payload: { id: string; approved: boolean } }
  | { type: 'CONNECTION_STATUS'; payload: ConnectionStatus };

export type ContentMessage =
  | { type: 'TOOL_RESPONSE'; payload: NMResponse }
  | { type: 'STATE_UPDATE'; payload: ExtensionState }
  | { type: 'REQUEST_CONFIRMATION'; payload: ConfirmationRequest };
