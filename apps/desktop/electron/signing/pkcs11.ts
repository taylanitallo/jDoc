import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { resolvePkcs11Lib } from './lib-paths';

/**
 * Camada PKCS#11 (Cryptoki) sobre pkcs11js.
 *
 * @pending TESTE COM HARDWARE. Sem token fisico nao ha como validar o fluxo
 * de ponta a ponta. Este modulo COMPILA e DEGRADA graciosamente (lib ausente,
 * sem token, sem login) — mas C_Login/C_Sign com um token real NAO foram
 * exercitados. A chave privada nunca sai do token: o token executa o C_Sign
 * sobre o digest; aqui so montamos entrada e lemos a saida.
 */

type Pkcs11Module = typeof import('pkcs11js');
type Pkcs11 = InstanceType<Pkcs11Module['PKCS11']>;
type Handle = Buffer;

let cachedModule: Pkcs11Module | null | undefined;

/** Import tardio: o binario nativo pode nao carregar (ABI/ausente) — degrada. */
async function loadModule(): Promise<Pkcs11Module | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    const imported = await import('pkcs11js');
    cachedModule = ((imported as { default?: Pkcs11Module }).default ?? imported) as Pkcs11Module;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export interface Pkcs11Status {
  available: boolean;
  libPath: string | null;
  fromSettings: boolean;
  detected: string[];
  tokenPresent: boolean;
  /** Assinatura real ainda nao validada com hardware. */
  pending: true;
  message: string;
  error?: string;
}

export interface CertificateInfo {
  /** CKA_ID em hex — liga certificado e chave privada no token. */
  id: string;
  label: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  certDerBase64: string;
}

export interface TokenSigner {
  certDer: Buffer;
  certId: string;
  /** Assina `data` no token (CKM_RSA_PKCS). A chave nunca sai do dispositivo. */
  sign: (data: Buffer) => Buffer;
  /** Logout + fecha sessao + finaliza. Sempre chamar em finally. */
  close: () => void;
}

function decodeString(buf: Buffer | undefined): string {
  return buf ? buf.toString('utf8').replace(/\0+$/, '') : '';
}

function formatDN(name: forge.pki.Certificate['subject']): string {
  return name.attributes.map((a) => `${a.shortName ?? a.name}=${String(a.value)}`).join(', ');
}

function parseCert(der: Buffer, idBuf: Buffer | undefined, labelBuf: Buffer | undefined): CertificateInfo | null {
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary')));
    const cert = forge.pki.certificateFromAsn1(asn1);
    const cn = (dn: forge.pki.Certificate['subject']): string => {
      const field = dn.getField('CN') as { value?: string } | null;
      return field?.value ?? formatDN(dn);
    };
    return {
      id: idBuf && idBuf.length ? idBuf.toString('hex') : createHash('sha1').update(der).digest('hex'),
      label: decodeString(labelBuf),
      subject: cn(cert.subject),
      issuer: cn(cert.issuer),
      notBefore: cert.validity.notBefore.toISOString(),
      notAfter: cert.validity.notAfter.toISOString(),
      certDerBase64: der.toString('base64'),
    };
  } catch {
    return null;
  }
}

/** Coleta todos os handles da busca corrente. */
function findAll(pkcs11: Pkcs11, session: Handle): Handle[] {
  const handles: Handle[] = [];
  for (;;) {
    const batch = pkcs11.C_FindObjects(session, 32) as Handle[];
    if (!batch || batch.length === 0) break;
    handles.push(...batch);
    if (batch.length < 32) break;
  }
  return handles;
}

/** Primeiro handle que casar com o template, ou null. */
function findFirst(
  pkcs11: Pkcs11,
  session: Handle,
  template: Array<{ type: number; value?: Buffer | number | string | boolean }>,
): Handle | null {
  pkcs11.C_FindObjectsInit(session, template);
  const found = pkcs11.C_FindObjects(session, 1) as Handle[];
  pkcs11.C_FindObjectsFinal(session);
  return found && found.length ? (found[0] as Handle) : null;
}

/** Status: lib carregada? token presente? Nunca lanca — sempre reporta. */
export async function getStatus(): Promise<Pkcs11Status> {
  const resolution = resolvePkcs11Lib();
  const base = {
    libPath: resolution.path,
    fromSettings: resolution.fromSettings,
    detected: resolution.detected,
    pending: true as const,
  };
  const mod = await loadModule();
  if (!mod) {
    return { ...base, available: false, tokenPresent: false, message: 'Modulo pkcs11js indisponivel (build nativo ausente ou incompativel).' };
  }
  if (!resolution.path) {
    return { ...base, available: false, tokenPresent: false, message: 'Nenhuma biblioteca PKCS#11 encontrada. Configure o caminho da DLL do token.' };
  }
  const pkcs11 = new mod.PKCS11();
  try {
    pkcs11.load(resolution.path);
    pkcs11.C_Initialize();
    const slots = pkcs11.C_GetSlotList(true) as Handle[];
    const tokenPresent = slots.length > 0;
    return {
      ...base,
      available: true,
      tokenPresent,
      message: tokenPresent
        ? 'Token presente. Assinatura real PENDENTE de teste com hardware.'
        : 'Biblioteca carregada, sem token conectado.',
    };
  } catch (e) {
    return { ...base, available: false, tokenPresent: false, message: 'Falha ao carregar a biblioteca PKCS#11.', error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      pkcs11.C_Finalize();
    } catch {
      /* ignore */
    }
  }
}

/** Lista certificados do token (objetos publicos; sem login). */
export async function listCertificates(): Promise<CertificateInfo[]> {
  const mod = await loadModule();
  const resolution = resolvePkcs11Lib();
  if (!mod || !resolution.path) return [];

  const pkcs11 = new mod.PKCS11();
  const out: CertificateInfo[] = [];
  let session: Handle | null = null;
  try {
    pkcs11.load(resolution.path);
    pkcs11.C_Initialize();
    const slots = pkcs11.C_GetSlotList(true) as Handle[];
    const slot = slots[0];
    if (!slot) return [];
    session = pkcs11.C_OpenSession(slot, mod.CKF_SERIAL_SESSION);

    pkcs11.C_FindObjectsInit(session, [{ type: mod.CKA_CLASS, value: mod.CKO_CERTIFICATE }]);
    const handles = findAll(pkcs11, session);
    pkcs11.C_FindObjectsFinal(session);

    for (const handle of handles) {
      const attrs = pkcs11.C_GetAttributeValue(session, handle, [
        { type: mod.CKA_VALUE },
        { type: mod.CKA_ID },
        { type: mod.CKA_LABEL },
      ]) as Array<{ value?: Buffer }>;
      const der = attrs[0]?.value;
      if (!der) continue;
      const info = parseCert(der, attrs[1]?.value, attrs[2]?.value);
      if (info) out.push(info);
    }
    return out;
  } catch {
    return out; // degrada: devolve o que conseguiu ler
  } finally {
    try {
      if (session) pkcs11.C_CloseSession(session);
    } catch {
      /* ignore */
    }
    try {
      pkcs11.C_Finalize();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Abre um assinador ligado ao certificado escolhido: faz login com o PIN,
 * localiza o cert (DER) e a chave privada (mesmo CKA_ID) e devolve um sign()
 * que delega o C_Sign ao token. Chamar close() sempre (finally).
 *
 * @pending nao exercitado com hardware.
 */
export async function openSigner(certId: string, pin: string): Promise<TokenSigner> {
  const mod = await loadModule();
  const resolution = resolvePkcs11Lib();
  if (!mod) throw new Error('Modulo pkcs11js indisponivel (build nativo ausente).');
  if (!resolution.path) throw new Error('Biblioteca PKCS#11 nao encontrada.');

  const pkcs11 = new mod.PKCS11();
  pkcs11.load(resolution.path);
  pkcs11.C_Initialize();

  let session: Handle;
  try {
    const slots = pkcs11.C_GetSlotList(true) as Handle[];
    const slot = slots[0];
    if (!slot) throw new Error('Nenhum token conectado.');
    session = pkcs11.C_OpenSession(slot, mod.CKF_SERIAL_SESSION | mod.CKF_RW_SESSION);
    pkcs11.C_Login(session, mod.CKU_USER, pin);
  } catch (e) {
    try {
      pkcs11.C_Finalize();
    } catch {
      /* ignore */
    }
    throw e;
  }

  const idBuf = Buffer.from(certId, 'hex');
  const certHandle = findFirst(pkcs11, session, [
    { type: mod.CKA_CLASS, value: mod.CKO_CERTIFICATE },
    { type: mod.CKA_ID, value: idBuf },
  ]);
  const keyHandle = findFirst(pkcs11, session, [
    { type: mod.CKA_CLASS, value: mod.CKO_PRIVATE_KEY },
    { type: mod.CKA_ID, value: idBuf },
  ]);

  const closeAll = (): void => {
    try {
      pkcs11.C_Logout(session);
    } catch {
      /* ignore */
    }
    try {
      pkcs11.C_CloseSession(session);
    } catch {
      /* ignore */
    }
    try {
      pkcs11.C_Finalize();
    } catch {
      /* ignore */
    }
  };

  if (!certHandle || !keyHandle) {
    closeAll();
    throw new Error('Certificado ou chave privada nao encontrados no token para o id informado.');
  }

  const certAttrs = pkcs11.C_GetAttributeValue(session, certHandle, [{ type: mod.CKA_VALUE }]) as Array<{ value?: Buffer }>;
  const certDer = certAttrs[0]?.value;
  if (!certDer) {
    closeAll();
    throw new Error('Nao foi possivel ler o certificado do token.');
  }

  return {
    certDer,
    certId,
    sign(data: Buffer): Buffer {
      pkcs11.C_SignInit(session, { mechanism: mod.CKM_RSA_PKCS }, keyHandle);
      return pkcs11.C_Sign(session, data, Buffer.alloc(1024)) as Buffer;
    },
    close: closeAll,
  };
}
