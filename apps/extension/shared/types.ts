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

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  type: 'action' | 'permission' | 'error' | 'info';
  action: string;
  details?: string;
  domain?: string;
}

export interface ExtensionState {
  connectionStatus: ConnectionStatus;
  allowlist: DomainAllowlist;
  activityLog: ActivityLogEntry[];
  pendingConfirmation: ConfirmationRequest | null;
}

interface ConfirmationRequest {
  id: string;
  action: string;
  details: Record<string, unknown>;
  domain: string;
  timestamp: number;
}

// Message types for background-content communication
export type BackgroundMessage =
  | { type: 'EXECUTE_TOOL'; payload: NMRequest }
  | { type: 'GET_STATE' }
  | { type: 'UPDATE_ALLOWLIST'; payload: DomainAllowlist }
  | { type: 'CONFIRM_ACTION'; payload: { id: string; approved: boolean } }
  | { type: 'CONNECTION_STATUS'; payload: ConnectionStatus };

export type ContentMessage =
  | { type: 'TOOL_RESPONSE'; payload: NMResponse }
  | { type: 'STATE_UPDATE'; payload: ExtensionState }
  | { type: 'REQUEST_CONFIRMATION'; payload: ConfirmationRequest };