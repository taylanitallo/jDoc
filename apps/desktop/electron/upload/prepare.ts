import { createHash } from 'node:crypto';
import { documentFieldsSchema } from '@jdoc/shared';
import { sessionStore } from '../session/session-store';
import type { EnqueuePayload } from '../ipc/schemas';
import type { EnqueueInput } from './queue';

/**
 * Defesa em profundidade antes de enfileirar (o renderer ja validou, mas o
 * main NAO confia): revalida magic bytes %PDF, tamanho maximo, e os campos
 * contra o schema canonico do @jdoc/shared. Calcula o SHA-256 do conteudo.
 */
const MAX_UPLOAD_MB = Number(process.env['JDOC_MAX_UPLOAD_MB']) || 50;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] as const; // %PDF

export function prepareEnqueue(payload: EnqueuePayload): EnqueueInput {
  const session = sessionStore.current;
  if (!session) throw new Error('Sessao ausente — faca login antes de enviar.');

  const { content } = payload;
  if (content.length < 5 || PDF_MAGIC.some((byte, i) => content[i] !== byte)) {
    throw new Error('Arquivo invalido: assinatura %PDF ausente.');
  }
  if (content.length > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`Arquivo excede o limite de ${MAX_UPLOAD_MB} MB.`);
  }

  // Coercao do schema canonico prova a validade dos campos (data, numero, enum...).
  documentFieldsSchema.parse({ ...payload.fields });
  const module = payload.fields['module'] ?? '';

  const hash = createHash('sha256').update(content).digest('hex');

  return {
    fileId: payload.fileId,
    slug: session.slug,
    name: payload.name,
    size: content.length,
    module,
    fields: payload.fields,
    content,
    hash,
  };
}

/**
 * Variante para arquivos consumidos da pasta monitorada: o conteudo ja vem
 * validado (magic bytes/tamanho) pelo folder-watcher no momento da deteccao,
 * mas revalida aqui de novo (defesa em profundidade) e valida os campos.
 */
export function prepareWatchedEnqueue(
  fileId: string,
  name: string,
  content: Uint8Array,
  fields: Record<string, string>,
): EnqueueInput {
  const session = sessionStore.current;
  if (!session) throw new Error('Sessao ausente — faca login antes de enviar.');

  if (content.length < 5 || PDF_MAGIC.some((byte, i) => content[i] !== byte)) {
    throw new Error('Arquivo invalido: assinatura %PDF ausente.');
  }
  if (content.length > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`Arquivo excede o limite de ${MAX_UPLOAD_MB} MB.`);
  }

  documentFieldsSchema.parse({ ...fields });
  const module = fields['module'] ?? '';
  const hash = createHash('sha256').update(content).digest('hex');

  return { fileId, slug: session.slug, name, size: content.length, module, fields, content, hash };
}
