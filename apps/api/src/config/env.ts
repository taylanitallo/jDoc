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

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET deve ter >= 32 chars'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET deve ter >= 32 chars'),

  SUPERADMIN_ALLOWED_IPS: z.string().optional().default(''),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  /** Diretorio do storage local (fallback dev quando Supabase ausente). */
  STORAGE_DIR: z.string().default('.storage'),
  /** Base publica da API (para montar signed URLs locais). */
  API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),
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
