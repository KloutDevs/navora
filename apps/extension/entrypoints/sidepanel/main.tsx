/**
 * Sidepanel Entry Point
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from '../../sidepanel/index';

export default defineSidepanel(() => {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<PopupApp />);
  }
});