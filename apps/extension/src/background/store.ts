/**
 * Extension State Store using Zustand
 */

import { create as createZustandStore } from 'zustand';
import type { ExtensionState, ConnectionStatus, DomainAllowlist, ActivityLogEntry } from '../../shared/types';

interface ExtensionStore extends ExtensionState {
  setConnectionStatus: (status: ConnectionStatus) => void;
  setAllowlist: (allowlist: DomainAllowlist) => void;
  addActivityLog: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
  clearActivityLog: () => void;
  setPendingConfirmation: (confirmation: ExtensionState['pendingConfirmation']) => void;
  getState: () => ExtensionState;
  subscribe: (callback: (state: ExtensionState) => void) => () => void;
}

export function createExtensionStore(): ExtensionStore {
  let listeners: Array<(state: ExtensionState) => void> = [];
  let state: ExtensionState = {
    connectionStatus: { connected: false },
    allowlist: { domains: [], enabled: false },
    activityLog: [],
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
    addActivityLog: (entry) => {
      state = {
        ...state,
        activityLog: [
          ...state.activityLog,
          {
            ...entry,
            id: `log_${Date.now()}`,
            timestamp: Date.now()
          }
        ].slice(-100)
      };
      notify();
    },
    clearActivityLog: () => {
      state = { ...state, activityLog: [] };
      notify();
    },
    setPendingConfirmation: (confirmation) => {
      state = { ...state, pendingConfirmation: confirmation };
      notify();
    }
  };

  return store;
}