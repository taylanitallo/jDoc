import type { JdocBridge } from '../electron/preload';

/**
 * Tipagem da ponte exposta pelo preload. O renderer enxerga apenas
 * `window.jdoc.invoke` — nada de ipcRenderer nem Node API.
 */
declare global {
  interface Window {
    jdoc: JdocBridge;
  }
}

export {};
