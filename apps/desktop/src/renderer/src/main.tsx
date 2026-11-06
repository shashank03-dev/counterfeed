import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, useApp } from './app/store';
import './styles.css';

applyTheme(useApp.getState().prefs.theme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useApp.getState().prefs.theme));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
