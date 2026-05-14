/**
 * Popup Entry Point
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidepanelApp } from '../../src/sidepanel/App';
import '../../src/sidepanel/styles.css';

export default definePopup(() => {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<SidepanelApp />);
  }
});