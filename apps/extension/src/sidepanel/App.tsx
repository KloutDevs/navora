import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { ActivityEntry, ActivityEntryType } from '../background/activity-log';
import type {
  ExtensionState,
  ConnectionStatus,
  DomainAllowlist,
  ConfirmationRequest,
} from '../shared/types';

const ACTIVITY_LOG_STORAGE_KEY = 'navora_activity_log';
const LAST_PROFILE_STORAGE_KEY = 'navora_last_profile';

// ---------------------------------------------------------------------------
// Store — estado de extensión sincronizado con el background (puerto)
// ---------------------------------------------------------------------------

interface UIStore {
  connectionStatus: ConnectionStatus;
  allowlist: DomainAllowlist;
  pendingConfirmation: ConfirmationRequest | null;
  setConnectionStatus: (s: ConnectionStatus) => void;
  setAllowlist: (a: DomainAllowlist) => void;
  setPendingConfirmation: (c: ConfirmationRequest | null) => void;
}

const useStore = create<UIStore>((set) => ({
  connectionStatus: { connected: false },
  allowlist: { domains: [], enabled: false },
  pendingConfirmation: null,
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setAllowlist: (allowlist) => set({ allowlist }),
  setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation }),
}));

// ---------------------------------------------------------------------------
// Tiempo relativo (español)
// ---------------------------------------------------------------------------

function formatRelativeTime(ts: number, now = Date.now()): string {
  const sec = Math.floor((now - ts) / 1000);
  if (sec < 4) return 'ahora';
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

// ---------------------------------------------------------------------------
// HUD permisos
// ---------------------------------------------------------------------------

function HUDModal({ confirmation }: { confirmation: ConfirmationRequest }) {
  const setPending = useStore((s) => s.setPendingConfirmation);
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
  }, [confirmation.id]);

  function respond(approved: boolean) {
    chrome.runtime.sendMessage({ type: 'CONFIRM_ACTION', payload: { id: confirmation.id, approved } });
    setPending(null);
  }

  const scriptSource = confirmation.details['source'] ? String(confirmation.details['source']) : null;

  return (
    <div className="hud-overlay">
      <div className="hud-card">
        <div className="hud-title">Permiso requerido</div>
        <div className="hud-subtitle">Un agente de IA solicita una acción privilegiada.</div>
        <div className="hud-row">
          <div className="hud-label">Herramienta</div>
          <div className="hud-value">{confirmation.action}</div>
        </div>
        <div className="hud-row">
          <div className="hud-label">Dominio</div>
          <div className="hud-value">{confirmation.domain}</div>
        </div>
        {scriptSource && (
          <div className="hud-row">
            <div className="hud-label">Script</div>
            <pre className="hud-code">{scriptSource}</pre>
          </div>
        )}
        <div className="hud-timer">Se rechazará solo en {remaining}s</div>
        <div className="hud-actions">
          <button type="button" className="btn-deny" onClick={() => respond(false)}>
            Rechazar
          </button>
          <button type="button" className="btn-approve" onClick={() => respond(true)}>
            Aprobar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtros de actividad
// ---------------------------------------------------------------------------

type ActivityFilter = 'all' | 'connect' | 'tool_call' | 'error';

function filterEntries(entries: ActivityEntry[], f: ActivityFilter): ActivityEntry[] {
  if (f === 'all') return entries;
  if (f === 'connect') return entries.filter((e) => e.type === 'connect' || e.type === 'disconnect');
  return entries.filter((e) => e.type === f);
}

function entryIcon(type: ActivityEntryType): string {
  switch (type) {
    case 'connect':
      return '●';
    case 'disconnect':
      return '○';
    case 'tool_call':
      return '⌁';
    case 'error':
      return '!';
    default:
      return '·';
  }
}

function borderClass(type: ActivityEntryType): string {
  switch (type) {
    case 'connect':
      return 'act-border-connect';
    case 'disconnect':
      return 'act-border-disconnect';
    case 'tool_call':
      return 'act-border-tool';
    case 'error':
      return 'act-border-error';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Raíz
// ---------------------------------------------------------------------------

export function SidepanelApp() {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const allowlist = useStore((s) => s.allowlist);
  const setAllowlist = useStore((s) => s.setAllowlist);
  const pendingConfirmation = useStore((s) => s.pendingConfirmation);

  const [newDomain, setNewDomain] = useState('');
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [lastProfile, setLastProfile] = useState<string | undefined>(undefined);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [nowTick, setNowTick] = useState(() => Date.now());

  const applyState = useCallback((state: ExtensionState) => {
    useStore.setState({
      connectionStatus: state.connectionStatus,
      allowlist: state.allowlist,
      pendingConfirmation: state.pendingConfirmation,
    });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state: ExtensionState) => {
      if (state) applyState(state);
    });
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    port.onMessage.addListener((msg: { type: string; payload: ExtensionState }) => {
      if (msg.type === 'STATE_UPDATE') applyState(msg.payload);
    });
    return () => port.disconnect();
  }, [applyState]);

  useEffect(() => {
    const load = () => {
      chrome.storage.local.get([ACTIVITY_LOG_STORAGE_KEY, LAST_PROFILE_STORAGE_KEY], (r) => {
        const raw = r[ACTIVITY_LOG_STORAGE_KEY];
        const list = Array.isArray(raw) ? (raw as ActivityEntry[]).slice() : [];
        setActivityEntries(list.reverse());
        const lp = r[LAST_PROFILE_STORAGE_KEY];
        setLastProfile(typeof lp === 'string' ? lp : undefined);
      });
    };
    load();
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[ACTIVITY_LOG_STORAGE_KEY] || changes[LAST_PROFILE_STORAGE_KEY]) {
        load();
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const filteredActivity = useMemo(
    () => filterEntries(activityEntries, activityFilter),
    [activityEntries, activityFilter]
  );

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

  function clearActivity() {
    chrome.runtime.sendMessage({ type: 'CLEAR_ACTIVITY_LOG' }, () => {
      setActivityEntries([]);
    });
  }

  const disconnectedHelp = !connectionStatus.connected
    ? 'Sin canal Native Messaging. Abrí el daemon y el shim NM para este perfil de Chrome, o reinstalá el host NM. La extensión reintenta solo.'
    : null;

  return (
    <div className="sp-root">
      {pendingConfirmation && <HUDModal confirmation={pendingConfirmation} />}

      <header className="sp-header">
        <div className="sp-brand">
          <span className="sp-logo" aria-hidden />
          <div>
            <div className="sp-title">Navora</div>
            <div className="sp-sub">Runtime del navegador</div>
          </div>
        </div>
      </header>

      <section className="sp-status-card" aria-live="polite">
        <div className="sp-status-row">
          <span className={`sp-dot ${connectionStatus.connected ? 'on' : 'off'}`} />
          <div className="sp-status-text">
            <div className="sp-status-label">Daemon</div>
            <div className="sp-status-value">
              {connectionStatus.connected ? 'Conectado' : 'Desconectado'}
            </div>
          </div>
          {connectionStatus.daemonVersion && (
            <span className="sp-pill">v{connectionStatus.daemonVersion}</span>
          )}
        </div>
        <div className="sp-profile-row">
          <span className="sp-muted">Perfil activo</span>
          <span className="sp-profile-id">{lastProfile ?? '—'}</span>
        </div>
        {!connectionStatus.connected && (
          <p className="sp-disconnect-msg">{disconnectedHelp}</p>
        )}
      </section>

      <section className="sp-section">
        <div className="sp-section-head">
          <h2 className="sp-h2">Dominios permitidos</h2>
        </div>
        <label className="sp-toggle">
          <input
            type="checkbox"
            checked={allowlist.enabled}
            onChange={() => saveAllowlist({ ...allowlist, enabled: !allowlist.enabled })}
          />
          <span>Restringir herramientas mutables a la lista</span>
        </label>
        <div className="sp-domain-row">
          <input
            className="sp-input"
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="ejemplo.com"
            onKeyDown={(e) => e.key === 'Enter' && addDomain()}
          />
          <button type="button" className="sp-btn sp-btn-primary" onClick={addDomain}>
            Añadir
          </button>
        </div>
        {allowlist.domains.length === 0 ? (
          <p className="sp-empty-inline">Ningún dominio en la lista</p>
        ) : (
          <ul className="sp-domain-list">
            {allowlist.domains.map((d) => (
              <li key={d}>
                <span className="sp-domain-name">{d}</span>
                <button type="button" className="sp-icon-btn" onClick={() => removeDomain(d)} aria-label={`Quitar ${d}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sp-section sp-activity-section">
        <div className="sp-activity-toolbar">
          <h2 className="sp-h2">Actividad</h2>
          {activityEntries.length > 0 && (
            <button type="button" className="sp-btn sp-btn-ghost sp-clear" onClick={clearActivity}>
              Limpiar log
            </button>
          )}
        </div>
        <div className="sp-filter-row" role="tablist">
          {(
            [
              ['all', 'Todo'],
              ['connect', 'Conexión'],
              ['tool_call', 'Herramientas'],
              ['error', 'Errores'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activityFilter === key}
              className={`sp-pill-filter ${activityFilter === key ? 'active' : ''}`}
              onClick={() => setActivityFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sp-activity-scroll">
          {filteredActivity.length === 0 ? (
            <p className="sp-empty">Sin entradas en esta vista</p>
          ) : (
            <ul className="sp-activity-list">
              {filteredActivity.map((e) => (
                <li key={e.id} className={`sp-activity-item ${borderClass(e.type)}`}>
                  <div className="sp-act-icon" aria-hidden>
                    {entryIcon(e.type)}
                  </div>
                  <div className="sp-act-body">
                    <div className="sp-act-meta">
                      <span className="sp-act-time">{formatRelativeTime(e.timestamp, nowTick)}</span>
                      {e.client && <span className="sp-act-client">{e.client}</span>}
                      {e.type === 'error' && <span className="sp-act-badge err">error</span>}
                      {e.type === 'tool_call' && e.status === 'error' && (
                        <span className="sp-act-badge err">falló</span>
                      )}
                      {e.type === 'tool_call' && e.status === 'ok' && (
                        <span className="sp-act-badge ok">ok</span>
                      )}
                    </div>
                    <div className="sp-act-summary">{e.summary}</div>
                    {(e.tool || e.profile) && (
                      <div className="sp-act-foot">
                        {e.tool && <code className="sp-code">{e.tool}</code>}
                        {e.profile && <span className="sp-muted">{e.profile}</span>}
                        {typeof e.durationMs === 'number' && (
                          <span className="sp-muted">{e.durationMs} ms</span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
