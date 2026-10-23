import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { tenantSlugSchema } from '@jdoc/shared';
import { loadEnv } from '../config/env';

/**
 * Destino segregado da copia de seguranca: um projeto Supabase separado do
 * principal (COPIA_SUPABASE_*) ou, sem ele, uma pasta montada em volume
 * (COPIA_DIR). Recebe os PDFs e os dumps do banco de cada orgao, num
 * bucket proprio `copia-jdoc-<slug>`.
 */
@Injectable()
export class DestinoSegregadoService {
  private readonly supabase: SupabaseClient | null;
  private readonly dir: string | null;

  constructor() {
    const env = loadEnv();
    this.supabase =
      env.COPIA_SUPABASE_URL && env.COPIA_SUPABASE_SERVICE_ROLE_KEY ? createClient(env.COPIA_SUPABASE_URL, env.COPIA_SUPABASE_SERVICE_ROLE_KEY) : null;
    this.dir = !this.supabase && env.COPIA_DIR ? resolve(env.COPIA_DIR) : null;
  }

  configurado(): boolean {
    return !!this.supabase || !!this.dir;
  }

  descricao(): string | null {
    if (this.supabase) return 'Projeto de armazenamento separado (Supabase)';
    if (this.dir) return 'Volume separado do servidor';
    return null;
  }

  private bucket(slug: string): string {
    return `copia-jdoc-${tenantSlugSchema.parse(slug)}`;
  }

  /** `key` ja validada pelo chamador (mesma allowlist do storage principal). */
  async enviar(slug: string, key: string, dados: Buffer): Promise<void> {
    const bucket = this.bucket(slug);
    if (this.supabase) {
      await this.supabase.storage.createBucket(bucket, { public: false }).catch(() => undefined);
      const { error } = await this.supabase.storage.from(bucket).upload(key, dados, { upsert: true, contentType: 'application/octet-stream' });
      if (error) throw new Error(`Cópia segregada recusou ${key}: ${error.message}`);
      return;
    }
    if (!this.dir) throw new Error('Destino segregado não configurado');
    await mkdir(join(this.dir, bucket), { recursive: true });
    await writeFile(join(this.dir, bucket, key), dados);
  }
}
