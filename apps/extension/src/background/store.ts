/**
 * Extension State Store using Zustand
 */

import type { ExtensionState, ConnectionStatus, DomainAllowlist } from '../shared/types';

interface ExtensionStore {
  setConnectionStatus: (status: ConnectionStatus) => void;
  setAllowlist: (allowlist: DomainAllowlist) => void;
  setPendingConfirmation: (confirmation: ExtensionState['pendingConfirmation']) => void;
  getState: () => ExtensionState;
  subscribe: (callback: (state: ExtensionState) => void) => () => void;
}

export function createExtensionStore(): ExtensionStore {
  let listeners: Array<(state: ExtensionState) => void> = [];
  let state: ExtensionState = {
    connectionStatus: { connected: false },
    allowlist: { domains: [], enabled: false },
    pendingConfirmation: null
  };

  const notify = () => {
    listeners.forEach(cb => cb(state));
  };

  const store: ExtensionStore = {
    getState: () => state,
    subscribe: (callback) => {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter(cb => cb !== callback);
      };
    },
    setConnectionStatus: (status) => {
      state = { ...state, connectionStatus: status };
      notify();
    },
    setAllowlist: (allowlist) => {
      state = { ...state, allowlist };
      notify();
    },
    setPendingConfirmation: (confirmation) => {
      state = { ...state, pendingConfirmation: confirmation };
      notify();
    }
  };

  return store;
}
