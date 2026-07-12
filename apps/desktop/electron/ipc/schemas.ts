import { z } from 'zod';
import { emailSchema, tenantSlugSchema, docModuleSchema, competenciaSchema } from '@jdoc/shared';

/**
 * Schemas dos payloads de cada kind IPC. Todos `.strict()`: campo extra
 * no payload = rejeitado (deny-by-default). Reusa emailSchema/tenantSlugSchema
 * canonicos do @jdoc/shared.
 */

/** auth:login — tela do desktop coleta slug do orgao + e-mail + senha. */
export const loginPayloadSchema = z
  .object({
    slug: tenantSlugSchema,
    email: emailSchema,
    senha: z.string().min(1).max(200),
  })
  .strict();
export type LoginPayload = z.infer<typeof loginPayloadSchema>;

/** auth:resolve — so e-mail + senha; o main descobre a qual(is) orgao(s) pertence. */
export const resolveLoginPayloadSchema = z
  .object({
    email: emailSchema,
    senha: z.string().min(1).max(200),
  })
  .strict();
export type ResolveLoginPayload = z.infer<typeof resolveLoginPayloadSchema>;

/** auth:select-tenant — usuario escolhe um orgao dentre os resolvidos no passo anterior. */
export const selectTenantPayloadSchema = z.object({ slug: tenantSlugSchema }).strict();
export type SelectTenantPayload = z.infer<typeof selectTenantPayloadSchema>;

/** Sem payload: auth:logout, auth:session, auth:me, ping. */
export const emptyPayloadSchema = z.object({}).strict();

/**
 * upload:enqueue — metadados + conteudo bruto do arquivo.
 * `fields` sao os campos multipart (strings, incl. `module`); sao revalidados
 * no handler contra documentFieldsSchema do @jdoc/shared. `content` e o PDF.
 */
export const enqueuePayloadSchema = z
  .object({
    fileId: z.string().min(1).max(200),
    name: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
    fields: z.record(z.string()),
    content: z.instanceof(Uint8Array),
  })
  .strict();
export type EnqueuePayload = z.infer<typeof enqueuePayloadSchema>;

/** upload:cancel — cancela um arquivo especifico da fila. */
export const cancelPayloadSchema = z.object({ fileId: z.string().min(1).max(200) }).strict();
export type CancelPayload = z.infer<typeof cancelPayloadSchema>;

/** documents:list — filtros minimos + paginacao simples. slug vem da sessao. */
export const listPayloadSchema = z
  .object({
    module: docModuleSchema,
    q: z.string().max(200).optional(),
    competencia: competenciaSchema.optional(),
    page: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();
export type ListPayload = z.infer<typeof listPayloadSchema>;

/** documents:view — pede a signed URL de um documento. */
export const viewPayloadSchema = z.object({ id: z.string().uuid() }).strict();
export type ViewPayload = z.infer<typeof viewPayloadSchema>;

/** watch:enqueue — envia um pendente da pasta monitorada (main le do disco). */
export const watchEnqueuePayloadSchema = z
  .object({
    fileId: z.string().min(1).max(200),
    fields: z.record(z.string()),
  })
  .strict();
export type WatchEnqueuePayload = z.infer<typeof watchEnqueuePayloadSchema>;

/** watch:attach — anexa um pendente a uma etiqueta (documento) existente. */
export const watchAttachPayloadSchema = z
  .object({
    fileId: z.string().min(1).max(200),
    documentId: z.string().uuid(),
  })
  .strict();
export type WatchAttachPayload = z.infer<typeof watchAttachPayloadSchema>;

/** watch:dismiss — descarta um pendente da pasta monitorada sem enviar. */
export const watchDismissPayloadSchema = z.object({ fileId: z.string().min(1).max(200) }).strict();
export type WatchDismissPayload = z.infer<typeof watchDismissPayloadSchema>;
