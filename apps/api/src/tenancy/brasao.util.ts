import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';

const BRASAO_URL_TTL_S = 3600;

/** Le o brasao real do tenant (tenant_settings.brasaoKey) e assina a URL —
 *  mesma fonte de verdade usada na propria tela de login do orgao. A coluna
 *  `public.tenants.brasao_url` foi descontinuada (nunca era escrita por
 *  nenhum fluxo real de upload, so aceitava uma URL externa colada a mao). */
export async function resolveBrasaoUrl(
  db: DatabaseService,
  storage: StorageService,
  schemaName: string,
  slug: string,
): Promise<string | null> {
  const sql = db.tenant(schemaName);
  const rows = await sql<Array<{ valor: string | unknown }>>`
    SELECT valor FROM tenant_settings WHERE chave = 'brasaoKey'
  `;
  const raw = rows[0]?.valor;
  if (!raw) return null;
  const key = typeof raw === 'string' ? (JSON.parse(raw) as string) : (raw as string);
  return storage.createSignedUrl(slug, key, BRASAO_URL_TTL_S);
}
