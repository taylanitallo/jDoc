import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Settings do app (nao-secretos) persistidos em userData/settings.json.
 * Aqui vive, por exemplo, o caminho configurado da biblioteca PKCS#11.
 * NUNCA guardar segredos (PIN/token) aqui.
 */
export interface AppSettings {
  /** Caminho manual para a DLL/.so PKCS#11 (sobrepoe a auto-deteccao). */
  pkcs11LibPath?: string;
  /** Pasta monitorada para deteccao automatica de PDFs a anexar (Marco 9). */
  watchedFolder?: string;
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function readSettings(): AppSettings {
  try {
    const file = settingsFile();
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf8')) as AppSettings;
  } catch {
    return {};
  }
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
