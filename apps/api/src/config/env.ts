import { z } from 'zod';

/**
 * Validacao de ambiente (fail-fast). Se algo obrigatorio faltar,
 * a API nao sobe — evita rodar com config insegura.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3333),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  REDIS_URL: z.string().min(1),

  /** Conferencia de documentos por IA — opcional; ausente = feature desligada. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /**
   * Teste com Gemini como provedor alternativo da conferencia (custo/quota).
   * Trocar de volta pra 'anthropic' e reversao total, sem redeploy.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),
  CONFERENCIA_PROVIDER: z.enum(['anthropic', 'gemini']).default('anthropic'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET deve ter >= 32 chars'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET deve ter >= 32 chars'),

  SUPERADMIN_ALLOWED_IPS: z.string().optional().default(''),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  /** Diretorio do storage local (fallback dev quando Supabase ausente). */
  STORAGE_DIR: z.string().default('.storage'),
  /** '1'/'true' desliga a indexacao de conteudo (OCR) mesmo com poppler/tesseract instalados. */
  OCR_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  /** Base publica da API (para montar signed URLs locais). */
  API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),

  /**
   * Chave (32 bytes em base64) que cifra os segredos guardados no banco.
   * Ausente = chave derivada do COOKIE_SECRET (ver common/crypto.ts).
   */
  ENCRYPTION_KEY: z.string().min(1).optional(),
  /** Requisicoes acima disto (ms) entram no monitoramento de lentidao. */
  SLOW_REQUEST_MS: z.coerce.number().int().positive().default(1000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuracao de ambiente invalida:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Token de injecao para o env tipado.
 */
export const ENV = Symbol('ENV');
