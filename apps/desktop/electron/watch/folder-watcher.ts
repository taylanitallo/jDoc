import { watch as fsWatch, existsSync, mkdirSync, readdirSync, statSync, renameSync, readFileSync, promises as fsp, type FSWatcher } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Pasta monitorada (Marco 9): detecta PDFs soltos numa pasta local e os
 * disponibiliza como "pendentes" para o usuario revisar campos e enviar,
 * sem precisar abrir o seletor de arquivo a cada anexo. Roda inteiramente
 * no processo MAIN (acesso a disco nunca e exposto ao renderer).
 *
 * Assinatura ICP-Brasil NAO e suportada para arquivos desta origem na v1
 * (exigiria trazer os bytes ao renderer antes de enviar) — o botao
 * "assinar" fica oculto para itens vindos da pasta monitorada.
 */

export interface PendingFile {
  fileId: string;
  name: string;
  size: number;
  detectedAt: string;
}

interface InternalPendingFile extends PendingFile {
  path: string;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const; // %PDF
const MAX_UPLOAD_MB = Number(process.env['JDOC_MAX_UPLOAD_MB']) || 25;
/** Espera o arquivo "parar de mudar" antes de considera-lo pronto (copia em andamento). */
const STABLE_DELAY_MS = 800;

const SENT_SUBDIR = '_enviados';
const ERROR_SUBDIR = '_erros';
const IGNORED_SUBDIR = '_ignorados';
const MANAGED_SUBDIRS = [SENT_SUBDIR, ERROR_SUBDIR, IGNORED_SUBDIR];

let watcher: FSWatcher | null = null;
let currentFolder: string | null = null;
const pending = new Map<string, InternalPendingFile>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export type PendingSink = (files: PendingFile[]) => void;
let sink: PendingSink | null = null;
export function setPendingSink(fn: PendingSink): void {
  sink = fn;
}

function toPublic({ path: _path, ...rest }: InternalPendingFile): PendingFile {
  return rest;
}

export function list(): PendingFile[] {
  return Array.from(pending.values())
    .map(toPublic)
    .sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
}

function emit(): void {
  sink?.(list());
}

export function currentConfig(): { folder: string | null } {
  return { folder: currentFolder };
}

/**
 * Sonda se da pra ESCREVER na pasta, sem nunca congelar a UI. Criar uma
 * subpasta de teste de forma ASSINCRONA (roda no threadpool do libuv, fora da
 * thread principal) e essencial: o "Acesso Controlado a Pastas" (Seguranca do
 * Windows) nao devolve um erro limpo quando bloqueia — ele faz a escrita
 * TRAVAR na camada nativa. Um mkdir sincrono nessa situacao congela o processo
 * inteiro (o famoso "Nao esta respondendo"). Com a versao async + timeout, o
 * travamento fica confinado a uma thread do pool e a UI continua viva; se nao
 * concluir a tempo (ou falhar), tratamos a pasta como nao-gravavel.
 *
 * Retorna true so se conseguiu criar E remover a subpasta de teste.
 */
export async function probeWritable(folder: string): Promise<boolean> {
  const probe = join(folder, `.jdoc-probe-${randomUUID()}`);
  try {
    await Promise.race([
      fsp.mkdir(probe),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    await fsp.rm(probe, { recursive: true, force: true }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function ensureSubdirs(folder: string): void {
  for (const sub of MANAGED_SUBDIRS) {
    const dir = join(folder, sub);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** Move best-effort (nunca lanca) — se o arquivo ja sumiu, apenas ignora. */
function moveTo(folder: string, fileName: string, subdir: string): void {
  try {
    renameSync(join(folder, fileName), join(folder, subdir, fileName));
  } catch {
    // arquivo ja removido/movido — sem acao.
  }
}

function validate(buf: Buffer): string | null {
  if (buf.length < 5 || PDF_MAGIC.some((b, i) => buf[i] !== b)) return 'Assinatura %PDF ausente';
  if (buf.length > MAX_UPLOAD_MB * 1024 * 1024) return `Excede ${MAX_UPLOAD_MB} MB`;
  return null;
}

/** Arquivo parado de ser escrito: valida e registra como pendente, ou descarta em _erros. */
function settle(folder: string, fileName: string): void {
  timers.delete(fileName);
  const full = join(folder, fileName);
  let buf: Buffer;
  let size: number;
  try {
    size = statSync(full).size;
    buf = readFileSync(full);
  } catch {
    return; // sumiu antes de estabilizar
  }

  if (validate(buf)) {
    moveTo(folder, fileName, ERROR_SUBDIR);
    return;
  }

  const fileId = randomUUID();
  pending.set(fileId, { fileId, name: fileName, size, detectedAt: new Date().toISOString(), path: full });
  emit();
}

function isManagedSubdir(name: string): boolean {
  return (MANAGED_SUBDIRS as string[]).includes(name);
}

function onFsEvent(folder: string, fileName: string | null): void {
  if (!fileName || isManagedSubdir(fileName)) return;
  if (extname(fileName).toLowerCase() !== '.pdf') return;

  const full = join(folder, fileName);
  const existingTimer = timers.get(fileName);
  if (!existsSync(full)) {
    if (existingTimer) {
      clearTimeout(existingTimer);
      timers.delete(fileName);
    }
    return;
  }

  // (Re)inicia o debounce — cada evento de escrita adia a "settle".
  if (existingTimer) clearTimeout(existingTimer);
  timers.set(fileName, setTimeout(() => settle(folder, fileName), STABLE_DELAY_MS));
}

/** Varre arquivos ja existentes na pasta ao (re)iniciar o monitoramento. */
function scanExisting(folder: string): void {
  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    return;
  }
  for (const name of entries) {
    if (isManagedSubdir(name) || extname(name).toLowerCase() !== '.pdf') continue;
    try {
      if (statSync(join(folder, name)).isDirectory()) continue;
    } catch {
      continue;
    }
    onFsEvent(folder, name);
  }
}

export function start(folder: string): void {
  stop();
  if (!existsSync(folder)) throw new Error('Pasta nao encontrada.');
  ensureSubdirs(folder);
  currentFolder = folder;
  scanExisting(folder);
  watcher = fsWatch(folder, { persistent: true }, (_event, fileName) => {
    onFsEvent(folder, fileName ? fileName.toString() : null);
  });
  emit();
}

export function stop(): void {
  watcher?.close();
  watcher = null;
  currentFolder = null;
  pending.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  emit();
}

/**
 * Consome um arquivo pendente: le + revalida os bytes, move para _enviados
 * e remove da lista de pendentes. Lanca se invalido ou ja consumido.
 */
export function consume(fileId: string): { name: string; content: Uint8Array } {
  const item = pending.get(fileId);
  if (!item) throw new Error('Arquivo nao encontrado na pasta monitorada.');

  const buf = readFileSync(item.path);
  const err = validate(buf);
  if (err) throw new Error(err);

  if (currentFolder) moveTo(currentFolder, item.name, SENT_SUBDIR);
  pending.delete(fileId);
  emit();
  return { name: item.name, content: new Uint8Array(buf) };
}

/** Descarta um pendente sem enviar (move para _ignorados). */
export function dismiss(fileId: string): void {
  const item = pending.get(fileId);
  if (!item) return;
  if (currentFolder) moveTo(currentFolder, item.name, IGNORED_SUBDIR);
  pending.delete(fileId);
  emit();
}
