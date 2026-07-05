import { existsSync } from 'node:fs';
import { readSettings } from '../settings';

/**
 * Caminhos default das bibliotecas PKCS#11 dos tokens ICP-Brasil mais comuns
 * no Windows. A ordem nao implica preferencia — pega-se a primeira que existir
 * no disco. Um caminho configurado em settings (pkcs11LibPath) SEMPRE vence.
 *
 * Fontes tipicas de instalacao dos middlewares:
 * - SafeNet eToken (Thales/Gemalto): eToken.dll / eTPKCS11.dll
 * - Gemalto/IDPrime (Thales): idprimepkcs11.dll / gtop11dotnet
 * - Watchdata: WDPKCS.dll
 */
export const DEFAULT_PKCS11_PATHS: readonly string[] = [
  // SafeNet Authentication Client (eToken 5110, muito comum no Brasil)
  'C:\\Windows\\System32\\eToken.dll',
  'C:\\Windows\\System32\\eTPKCS11.dll',
  'C:\\Program Files\\SafeNet\\Authentication\\SAC\\x64\\IDPrimePKCS11.dll',
  // Gemalto / Thales IDPrime
  'C:\\Windows\\System32\\idprimepkcs11.dll',
  'C:\\Windows\\System32\\eTPKCS11GEM.dll',
  // Watchdata (WD PROXKey / token ICP)
  'C:\\Windows\\System32\\WDPKCS.dll',
  'C:\\Windows\\System32\\Watchdata\\Watchdata Brazil CSP\\WDPKCS.dll',
];

export interface LibResolution {
  /** Caminho efetivo a carregar, ou null se nenhum encontrado. */
  path: string | null;
  /** true quando veio de settings (configurado manualmente). */
  fromSettings: boolean;
  /** Todos os candidatos que existem no disco (para diagnostico). */
  detected: string[];
}

/**
 * Resolve qual biblioteca PKCS#11 usar: settings tem prioridade; senao,
 * auto-detecta a primeira DLL default existente.
 */
export function resolvePkcs11Lib(): LibResolution {
  const configured = readSettings().pkcs11LibPath;
  const detected = DEFAULT_PKCS11_PATHS.filter((p) => existsSync(p));

  if (configured && existsSync(configured)) {
    return { path: configured, fromSettings: true, detected };
  }
  return { path: detected[0] ?? null, fromSettings: false, detected };
}
