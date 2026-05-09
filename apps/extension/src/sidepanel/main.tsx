import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidepanelApp } from './App';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<SidepanelApp />);
}
