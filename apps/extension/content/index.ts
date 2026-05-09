/**
 * Content Script Entry Point
 * Located in src/content for WXT auto-detection
 */

import { defineContentScript } from 'wxt';

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message: { type: string; payload?: unknown }, _sender, _sendResponse) => {
      if (message.type === 'REQUEST_CONFIRMATION') {
        const confirmation = message.payload as { id: string; action: string; details: Record<string, unknown>; domain: string };
        const overlay = document.createElement('div');
        overlay.id = 'abr-hud-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:999999;display:flex;justify-content:center;align-items:center;';
        overlay.innerHTML = `<div style="background:white;padding:20px;border-radius:8px;max-width:400px">
          <h3>Confirm Action</h3>
          <p><strong>${confirmation.action}</strong></p>
          <p style="font-size:12px;color:#666">Domain: ${confirmation.domain}</p>
          <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
            <button id="abr-denied" style="padding:8px 16px;background:#dc2626;color:white;border:none;border-radius:4px;cursor:pointer">Denied</button>
            <button id="abr-approved" style="padding:8px 16px;background:#16a34a;color:white;border:none;border-radius:4px;cursor:pointer">Approved</button>
          </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#abr-approved')?.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'CONFIRM_ACTION', payload: { id: confirmation.id, approved: true } });
          overlay.remove();
        });
        overlay.querySelector('#abr-denied')?.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'CONFIRM_ACTION', payload: { id: confirmation.id, approved: false } });
          overlay.remove();
        });
      } else if (message.type === 'HIDE_HUD') {
        document.getElementById('abr-hud-overlay')?.remove();
      }
      return false;
    });
  }
});