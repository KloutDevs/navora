/**
 * Sidebar/Popup UI - React Components
 */

import React, { useState, useEffect } from 'react';
import { create } from 'zustand';
import type { ExtensionState, ConnectionStatus, DomainAllowlist, ActivityLogEntry } from '../shared/types';

// Create Zustand store for React components
interface UIStore extends ExtensionState {
  setConnectionStatus: (status: ConnectionStatus) => void;
  setAllowlist: (allowlist: DomainAllowlist) => void;
  addActivityLog: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
  clearActivityLog: () => void;
}

const useUIStore = create<UIStore>((set) => ({
  connectionStatus: { connected: false },
  allowlist: { domains: [], enabled: false },
  activityLog: [],
  pendingConfirmation: null,

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setAllowlist: (allowlist) => set({ allowlist }),
  addActivityLog: (entry) =>
    set((state) => ({
      activityLog: [
        ...state.activityLog,
        {
          ...entry,
          id: `log_${Date.now()}`,
          timestamp: Date.now()
        }
      ].slice(-100)
    })),
  clearActivityLog: () => set({ activityLog: [] })
}));

// Tab components
function ConnectionTab() {
  const connectionStatus = useUIStore((state) => state.connectionStatus);

  return (
    <div className="tab-content">
      <h3>Connection Status</h3>
      <div className={`status-badge ${connectionStatus.connected ? 'connected' : 'disconnected'}`}>
        {connectionStatus.connected ? 'Connected' : 'Disconnected'}
      </div>
      {connectionStatus.daemonVersion && (
        <p>Daemon Version: {connectionStatus.daemonVersion}</p>
      )}
      {connectionStatus.lastConnected && (
        <p>Last Connected: {new Date(connectionStatus.lastConnected).toLocaleString()}</p>
      )}
      {connectionStatus.error && (
        <p className="error">Error: {connectionStatus.error}</p>
      )}
    </div>
  );
}

function AllowlistTab() {
  const allowlist = useUIStore((state) => state.allowlist);
  const setAllowlist = useUIStore((state) => state.setAllowlist);
  const [newDomain, setNewDomain] = useState('');

  const handleAddDomain = () => {
    if (newDomain && !allowlist.domains.includes(newDomain)) {
      setAllowlist({
        ...allowlist,
        domains: [...allowlist.domains, newDomain]
      });
      setNewDomain('');
    }
  };

  const handleRemoveDomain = (domain: string) => {
    setAllowlist({
      ...allowlist,
      domains: allowlist.domains.filter((d) => d !== domain)
    });
  };

  const handleToggleEnabled = () => {
    setAllowlist({
      ...allowlist,
      enabled: !allowlist.enabled
    });
  };

  return (
    <div className="tab-content">
      <h3>Domain Allowlist</h3>
      <div className="toggle-row">
        <label>
          <input
            type="checkbox"
            checked={allowlist.enabled}
            onChange={handleToggleEnabled}
          />
          Enable allowlist
        </label>
      </div>
      <div className="add-domain">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="example.com"
          onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
        />
        <button onClick={handleAddDomain}>Add</button>
      </div>
      <ul className="domain-list">
        {allowlist.domains.map((domain) => (
          <li key={domain}>
            <span>{domain}</span>
            <button onClick={() => handleRemoveDomain(domain)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityLogTab() {
  const activityLog = useUIStore((state) => state.activityLog);
  const clearActivityLog = useUIStore((state) => state.clearActivityLog);

  const getTypeClass = (type: string) => {
    switch (type) {
      case 'error':
        return 'type-error';
      case 'permission':
        return 'type-permission';
      case 'action':
        return 'type-action';
      default:
        return 'type-info';
    }
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Activity Log</h3>
        {activityLog.length > 0 && (
          <button onClick={clearActivityLog} className="clear-btn">
            Clear
          </button>
        )}
      </div>
      {activityLog.length === 0 ? (
        <p className="empty">No activity yet</p>
      ) : (
        <ul className="log-list">
          {activityLog.slice().reverse().map((entry) => (
            <li key={entry.id} className={getTypeClass(entry.type)}>
              <span className="timestamp">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="action">{entry.action}</span>
              {entry.details && <span className="details">{entry.details}</span>}
              {entry.domain && <span className="domain">{entry.domain}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Main App component
export function PopupApp() {
  const [activeTab, setActiveTab] = useState<'connection' | 'allowlist' | 'activity'>('connection');

  useEffect(() => {
    // Fetch initial state from background
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
      if (state) {
        useUIStore.setState(state as ExtensionState);
      }
    });

    // Listen for state updates
    const handleMessage = (message: { type: string; payload: unknown }) => {
      if (message.type === 'STATE_UPDATE') {
        useUIStore.setState(message.payload as ExtensionState);
      } else if (message.type === 'CONNECTION_STATUS') {
        useUIStore.getState().setConnectionStatus(message.payload as ConnectionStatus);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  return (
    <div className="popup-app">
      <header className="popup-header">
        <h1>AI Browser Runtime</h1>
      </header>
      <nav className="tab-nav">
        <button
          className={activeTab === 'connection' ? 'active' : ''}
          onClick={() => setActiveTab('connection')}
        >
          Connection
        </button>
        <button
          className={activeTab === 'allowlist' ? 'active' : ''}
          onClick={() => setActiveTab('allowlist')}
        >
          Allowlist
        </button>
        <button
          className={activeTab === 'activity' ? 'active' : ''}
          onClick={() => setActiveTab('activity')}
        >
          Activity
        </button>
      </nav>
      <main className="popup-content">
        {activeTab === 'connection' && <ConnectionTab />}
        {activeTab === 'allowlist' && <AllowlistTab />}
        {activeTab === 'activity' && <ActivityLogTab />}
      </main>
    </div>
  );
}