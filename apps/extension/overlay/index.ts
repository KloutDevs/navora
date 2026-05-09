/**
 * Overlay HUD - Shadow DOM overlay for action confirmation
 * Injected into web pages to confirm dangerous actions
 */

import type { ConfirmationRequest } from '../shared/types';

const OVERLAY_ID = 'abr-hud-overlay';

/**
 * Create and show the HUD overlay
 */
export function showHUDOverlay(
  confirmation: ConfirmationRequest,
  onApprove: () => void,
  onDeny: () => void
): void {
  // Remove existing overlay if any
  hideHUDOverlay();

  const container = document.createElement('div');
  container.id = OVERLAY_ID;

  const shadow = container.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .hud-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      }
      .hud-dialog {
        background: white;
        border-radius: 12px;
        padding: 28px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        animation: slideIn 0.2s ease-out;
      }
      @keyframes slideIn {
        from {
          transform: translateY(-20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      .hud-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      .hud-icon {
        width: 40px;
        height: 40px;
        background: #fef3c7;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
      }
      .hud-title {
        font-size: 18px;
        font-weight: 600;
        color: #111827;
      }
      .hud-subtitle {
        font-size: 13px;
        color: #6b7280;
        margin-bottom: 20px;
      }
      .hud-info {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
      }
      .hud-info-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        font-size: 13px;
      }
      .hud-info-label {
        color: #6b7280;
      }
      .hud-info-value {
        color: #111827;
        font-weight: 500;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hud-warning {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 12px;
        background: #fef3c7;
        border-radius: 6px;
        margin-bottom: 20px;
        font-size: 12px;
        color: #92400e;
      }
      .hud-warning-icon {
        flex-shrink: 0;
      }
      .hud-actions {
        display: flex;
        gap: 12px;
      }
      .hud-btn {
        flex: 1;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: all 0.15s;
      }
      .hud-btn:hover {
        transform: translateY(-1px);
      }
      .hud-btn-deny {
        background: #f3f4f6;
        color: #374151;
      }
      .hud-btn-deny:hover {
        background: #e5e7eb;
      }
      .hud-btn-approve {
        background: #2563eb;
        color: white;
      }
      .hud-btn-approve:hover {
        background: #1d4ed8;
      }
      .hud-timeout {
        font-size: 11px;
        color: #9ca3af;
        text-align: center;
        margin-top: 12px;
      }
    </style>
    <div class="hud-overlay">
      <div class="hud-dialog">
        <div class="hud-header">
          <div class="hud-icon">⚠️</div>
          <div>
            <div class="hud-title">Confirm Action</div>
            <div class="hud-subtitle">AI Browser Runtime</div>
          </div>
        </div>
        
        <div class="hud-info">
          <div class="hud-info-row">
            <span class="hud-info-label">Domain</span>
            <span class="hud-info-value">${confirmation.domain}</span>
          </div>
          <div class="hud-info-row">
            <span class="hud-info-label">Action</span>
            <span class="hud-info-value">${formatAction(confirmation.action)}</span>
          </div>
          ${Object.keys(confirmation.details).length > 0 ? `
          <div class="hud-info-row">
            <span class="hud-info-label">Target</span>
            <span class="hud-info-value">${formatTarget(confirmation.details)}</span>
          </div>
          ` : ''}
        </div>
        
        <div class="hud-warning">
          <span class="hud-warning-icon">ℹ️</span>
          <span>This action will interact with the current webpage. Only approve if you trust this action.</span>
        </div>
        
        <div class="hud-actions">
          <button class="hud-btn hud-btn-deny" id="hud-deny">Deny</button>
          <button class="hud-btn hud-btn-approve" id="hud-approve">Approve</button>
        </div>
        
        <div class="hud-timeout">Auto-dismiss in <span id="hud-timer">30</span>s</div>
      </div>
    </div>
  `;

  // Add event listeners
  const approveBtn = shadow.getElementById('hud-approve');
  const denyBtn = shadow.getElementById('hud-deny');
  const timerEl = shadow.getElementById('hud-timer');

  approveBtn?.addEventListener('click', () => {
    onApprove();
    hideHUDOverlay();
  });

  denyBtn?.addEventListener('click', () => {
    onDeny();
    hideHUDOverlay();
  });

  // Add to page
  document.body.appendChild(container);

  // Start countdown timer
  let timeLeft = 30;
  const timer = setInterval(() => {
    timeLeft--;
    if (timerEl) {
      timerEl.textContent = String(timeLeft);
    }
    if (timeLeft <= 0) {
      clearInterval(timer);
      hideHUDOverlay();
      onDeny(); // Auto-deny on timeout
    }
  }, 1000);

  // Store timer for cleanup
  (container as HTMLElement & { _timer?: ReturnType<typeof setInterval> })._timer = timer;
}

/**
 * Hide the HUD overlay
 */
export function hideHUDOverlay(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    const timer = (existing as HTMLElement & { _timer?: ReturnType<typeof setInterval> })._timer;
    if (timer) {
      clearInterval(timer);
    }
    existing.remove();
  }
}

/**
 * Format action name for display
 */
function formatAction(action: string): string {
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format target details for display
 */
function formatTarget(details: Record<string, unknown>): string {
  const selector = details.selector;
  if (typeof selector === 'string') {
    return selector.length > 30 ? selector.substring(0, 30) + '...' : selector;
  }
  const text = details.text;
  if (typeof text === 'string') {
    return text.length > 30 ? text.substring(0, 30) + '...' : text;
  }
  return 'Element';
}