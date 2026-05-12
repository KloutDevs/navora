import React, { useState, useEffect, useCallback } from 'react';
import { create } from 'zustand';
import type {
  ExtensionState,
  ConnectionStatus,
  DomainAllowlist,
  ActivityLogEntry,
  ConfirmationRequest,
} from '../shared/types';

// ---------------------------------------------------------------------------
// Store (Phase 17, T-099) — synced from background via chrome.runtime.connect
// ---------------------------------------------------------------------------

interface UIStore extends ExtensionState {
  setConnectionStatus: (s: ConnectionStatus) => void;
  setAllowlist: (a: DomainAllowlist) => void;
  addActivityLog: (e: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
  clearActivityLog: () => void;
  setPendingConfirmation: (c: ConfirmationRequest | null) => void;
}

const useStore = create<UIStore>((set) => ({
  connectionStatus: { connected: false },
  allowlist: { domains: [], enabled: false },
  activityLog: [],
  pendingConfirmation: null,

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setAllowlist: (allowlist) => set({ allowlist }),
  addActivityLog: (entry) =>
    set((s) => ({
      activityLog: [
        ...s.activityLog,
        { ...entry, id: `log_${Date.now()}`, timestamp: Date.now() },
      ].slice(-50),
    })),
  clearActivityLog: () => set({ activityLog: [] }),
  setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation }),
}));

// ---------------------------------------------------------------------------
// HUD Modal (Phase 17, T-101 + FR-UI-02)
// ---------------------------------------------------------------------------

function HUDModal({ confirmation }: { confirmation: ConfirmationRequest }) {
  const setPending = useStore((s) => s.setPendingConfirmation);
  const addLog = useStore((s) => s.addActivityLog);
  const [remaining, setRemaining] = useState(30);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(interval);
          respond(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmation.id]);

  function respond(approved: boolean) {
    chrome.runtime.sendMessage({ type: 'CONFIRM_ACTION', payload: { id: confirmation.id, approved } });
    addLog({
      type: 'permission',
      action: approved ? `approved_${confirmation.action}` : `denied_${confirmation.action}`,
      domain: confirmation.domain,
    });
    setPending(null);
  }

  const scriptSource = confirmation.details['source'] ? String(confirmation.details['source']) : null;

  return (
    <div className="hud-overlay">
      <div className="hud-card">
        <div className="hud-title">⚠️ Permission Required</div>
        <div className="hud-subtitle">An AI agent is requesting a privileged action.</div>

        <div className="hud-row">
          <div className="hud-label">Tool</div>
          <div className="hud-value">{confirmation.action}</div>
        </div>
        <div className="hud-row">
          <div className="hud-label">Domain</div>
          <div className="hud-value">{confirmation.domain}</div>
        </div>
        {scriptSource && (
          <div className="hud-row">
            <div className="hud-label">Script</div>
            <pre className="hud-code">{scriptSource}</pre>
          </div>
        )}

        <div className="hud-timer">Auto-denying in {remaining}s</div>
        <div className="hud-actions">
          <button className="btn-deny" onClick={() => respond(false)}>Deny</button>
          <button className="btn-approve" onClick={() => respond(true)}>Approve</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection tab (FR-UI-01)
// ---------------------------------------------------------------------------

function ConnectionTab() {
  const status = useStore((s) => s.connectionStatus);
  return (
    <div className="tab-content">
      <h3>Connection</h3>
      <div className={`status-badge ${status.connected ? 'connected' : 'disconnected'}`}>
        {status.connected ? 'Connected to Daemon' : 'Disconnected'}
      </div>
      {status.daemonVersion && <p className="meta">Daemon v{status.daemonVersion}</p>}
      {status.lastConnected && (
        <p className="meta">Last connected: {new Date(status.lastConnected).toLocaleTimeString()}</p>
      )}
      {status.error && <p className="error">{status.error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Allowlist tab (FR-UI-03)
// ---------------------------------------------------------------------------

function AllowlistTab() {
  const allowlist = useStore((s) => s.allowlist);
  const setAllowlist = useStore((s) => s.setAllowlist);
  const [newDomain, setNewDomain] = useState('');

  function saveAllowlist(next: DomainAllowlist) {
    setAllowlist(next);
    chrome.runtime.sendMessage({ type: 'UPDATE_ALLOWLIST', payload: next });
  }

  function addDomain() {
    const d = newDomain.trim();
    if (!d || allowlist.domains.includes(d)) return;
    saveAllowlist({ ...allowlist, domains: [...allowlist.domains, d] });
    setNewDomain('');
  }

  function removeDomain(d: string) {
    saveAllowlist({ ...allowlist, domains: allowlist.domains.filter((x) => x !== d) });
  }

  return (
    <div className="tab-content">
      <h3>Domain Allowlist</h3>
      <div className="toggle-row">
        <label>
          <input
            type="checkbox"
            checked={allowlist.enabled}
            onChange={() => saveAllowlist({ ...allowlist, enabled: !allowlist.enabled })}
          />
          {' '}Enforce allowlist for mutating tools
        </label>
      </div>
      <div className="add-domain">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="example.com"
          onKeyDown={(e) => e.key === 'Enter' && addDomain()}
        />
        <button onClick={addDomain}>Add</button>
      </div>
      {allowlist.domains.length === 0 ? (
        <p className="empty">No domains added</p>
      ) : (
        <ul className="domain-list">
          {allowlist.domains.map((d) => (
            <li key={d}>
              <span>{d}</span>
              <button onClick={() => removeDomain(d)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab (FR-UI-04)
// ---------------------------------------------------------------------------

const TIER_CLASS: Record<string, string> = {
  error: 'type-error',
  permission: 'type-permission',
  action: 'type-action',
};

function ActivityTab() {
  const log = useStore((s) => s.activityLog);
  const clear = useStore((s) => s.clearActivityLog);

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Activity</h3>
        {log.length > 0 && (
          <button className="clear-btn" onClick={clear}>Clear</button>
        )}
      </div>
      {log.length === 0 ? (
        <p className="empty">No activity yet</p>
      ) : (
        <ul className="log-list">
          {[...log].reverse().map((entry) => (
            <li key={entry.id} className={TIER_CLASS[entry.type] ?? ''}>
              <span className="timestamp">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span className="action">{entry.action}</span>
              {entry.details && <span className="details"> — {entry.details}</span>}
              {entry.domain && <span className="domain"> ({entry.domain})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root app (Phase 17, T-100)
// ---------------------------------------------------------------------------

type Tab = 'connection' | 'allowlist' | 'activity';

export function SidepanelApp() {
  const [activeTab, setActiveTab] = useState<Tab>('connection');
  const pendingConfirmation = useStore((s) => s.pendingConfirmation);

  const applyState = useCallback((state: ExtensionState) => {
    useStore.setState({
      connectionStatus: state.connectionStatus,
      allowlist: state.allowlist,
      activityLog: state.activityLog,
      pendingConfirmation: state.pendingConfirmation,
    });
  }, []);

  useEffect(() => {
    // Initial state fetch
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state: ExtensionState) => {
      if (state) applyState(state);
    });

    // Live state sync via persistent port
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    port.onMessage.addListener((msg: { type: string; payload: ExtensionState }) => {
      if (msg.type === 'STATE_UPDATE') applyState(msg.payload);
    });

    return () => port.disconnect();
  }, [applyState]);

  return (
    <div className="popup-app">
      <header className="popup-header">
        <h1>AI Browser Runtime</h1>
      </header>

      {pendingConfirmation && <HUDModal confirmation={pendingConfirmation} />}

      <nav className="tab-nav">
        {(['connection', 'allowlist', 'activity'] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main className="popup-content">
        {activeTab === 'connection' && <ConnectionTab />}
        {activeTab === 'allowlist' && <AllowlistTab />}
        {activeTab === 'activity' && <ActivityTab />}
      </main>
    </div>
  );
}
