import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Global,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { tenantSlugSchema } from '@jdoc/shared';
import { loadEnv } from '../config/env';
import { DatabaseService } from '../database/database.service';

export const SIGNED_URL_TTL_S = 60;

/** file_key: uuid.<ext> gerado pelo servidor — allowlist estrita (anti path-traversal).
 *  Prefixo opcional `backup-` + extensao composta `.dump.gz` cobre os dumps
 *  gerados pelo BackupsWorker, que reaproveita este mesmo storage. */
const FILE_KEY_REGEX =
  /^(?:backup-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|zip|png|jpg|jpeg|dump\.gz)$/;

export function assertSafeFileKey(key: string): void {
  if (!FILE_KEY_REGEX.test(key)) {
    throw new BadRequestException('Chave de arquivo invalida');
  }
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gz: 'application/gzip',
};

function extOf(key: string): string {
  return key.slice(key.lastIndexOf('.') + 1).toLowerCase();
}

function mimeForKey(key: string): string {
  return MIME_BY_EXT[extOf(key)] ?? 'application/octet-stream';
}

/** Nome de download exibido ao usuario — sanitizado (nao concede acesso, so cosmetica). */
function sanitizeDownloadName(name: string): string {
  return name.replace(/[^\w \-.À-ÿ]/g, '').trim().slice(0, 150) || 'arquivo';
}

/**
 * Storage por tenant.
 * - Producao: Supabase Storage, bucket privado `jdoc-<slug>`, signed URL 60s.
 * - Dev/local (sem SUPABASE_URL): filesystem + URL assinada HMAC de 60s
 *   servida por /files/:slug/:key (mesma semantica de expiracao).
 * Em ambos, o caminho e derivado de slug VALIDADO + file_key VALIDADA.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly supabase: SupabaseClient | null;
  private readonly baseDir: string;

  constructor(private readonly db: DatabaseService) {
    const env = loadEnv();
    this.supabase =
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
        : null;
    this.baseDir = resolve(env.STORAGE_DIR);
    if (!this.supabase) {
      this.logger.warn(`Supabase ausente — storage local em ${this.baseDir} (somente dev)`);
    }
  }

  private bucket(slug: string): string {
    return `jdoc-${tenantSlugSchema.parse(slug)}`;
  }

  private localPath(slug: string, key: string): string {
    // slug e key ja validados por allowlist — sem componentes de path do usuario.
    return join(this.baseDir, this.bucket(slug), key);
  }

  async upload(slug: string, key: string, data: Buffer): Promise<void> {
    assertSafeFileKey(key);
    if (this.supabase) {
      const bucket = this.bucket(slug);
      await this.supabase.storage.createBucket(bucket, { public: false }).catch(() => undefined);
      const { error } = await this.supabase.storage
        .from(bucket)
        .upload(key, data, { contentType: mimeForKey(key), upsert: false });
      if (error) throw new Error(`Falha no upload: ${error.message}`);
      return;
    }
    const path = this.localPath(slug, key);
    await mkdir(join(this.baseDir, this.bucket(slug)), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  async delete(slug: string, key: string): Promise<void> {
    assertSafeFileKey(key);
    if (this.supabase) {
      await this.supabase.storage.from(this.bucket(slug)).remove([key]);
      return;
    }
    await rm(this.localPath(slug, key), { force: true });
  }

  /** Signed URL de 60s. Chamador JA validou permissao + posse do arquivo pelo tenant.
   *  downloadName (opcional) e so cosmetico — nome do arquivo que o navegador salva. */
  async createSignedUrl(
    slug: string,
    key: string,
    ttlS: number = SIGNED_URL_TTL_S,
    downloadName?: string,
  ): Promise<string> {
    assertSafeFileKey(key);
    if (this.supabase) {
      const ext = `.${extOf(key)}`;
      const { data, error } = await this.supabase.storage
        .from(this.bucket(slug))
        .createSignedUrl(key, ttlS, downloadName ? { download: `${sanitizeDownloadName(downloadName)}${ext}` } : undefined);
      if (error || !data) throw new Error(`Falha ao assinar URL: ${error?.message}`);
      return data.signedUrl;
    }
    const env = loadEnv();
    const exp = Math.floor(Date.now() / 1000) + ttlS;
    const sig = signLocal(slug, key, exp);
    const nameParam = downloadName ? `&name=${encodeURIComponent(sanitizeDownloadName(downloadName))}` : '';
    return `${env.API_PUBLIC_URL}/files/${slug}/${key}?exp=${exp}&sig=${sig}${nameParam}`;
  }

  /** Baixa os bytes do arquivo (Supabase download OU leitura local). */
  async download(slug: string, key: string): Promise<Buffer> {
    assertSafeFileKey(key);
    if (this.supabase) {
      const { data, error } = await this.supabase.storage.from(this.bucket(slug)).download(key);
      if (error || !data) throw new NotFoundException('Arquivo nao encontrado');
      return Buffer.from(await data.arrayBuffer());
    }
    return this.readLocal(slug, key);
  }

  /**
   * Uso real em bytes do bucket do tenant.
   * - Supabase: soma `metadata.size` de `storage.objects` (fonte de verdade do
   *   proprio Supabase Storage — reflete exatamente o que esta no bucket, sem
   *   depender de contadores locais que podem divergir do storage real).
   * - Dev/local: soma o tamanho real dos arquivos no diretorio do tenant.
   */
  async usageBytes(slug: string): Promise<number> {
    const bucket = this.bucket(slug);
    if (this.supabase) {
      const sql = this.db.catalog();
      const rows = await sql<Array<{ total: string | null }>>`
        SELECT COALESCE(SUM((metadata->>'size')::bigint), 0) AS total
        FROM storage.objects WHERE bucket_id = ${bucket}
      `;
      return Number(rows[0]?.total ?? 0);
    }
    const dir = join(this.baseDir, bucket);
    try {
      const files = await readdir(dir);
      let total = 0;
      for (const f of files) {
        const st = await stat(join(dir, f));
        if (st.isFile()) total += st.size;
      }
      return total;
    } catch {
      return 0;
    }
  }

  /** Leitura local (somente fallback dev). */
  async readLocal(slug: string, key: string): Promise<Buffer> {
    assertSafeFileKey(key);
    try {
      return await readFile(this.localPath(slug, key));
    } catch {
      throw new NotFoundException('Arquivo nao encontrado');
    }
  }
}

function signLocal(slug: string, key: string, exp: number): string {
  const env = loadEnv();
  return createHmac('sha256', env.COOKIE_SECRET).update(`${slug}|${key}|${exp}`).digest('hex');
}

/**
 * Endpoint do storage LOCAL (fallback dev): valida HMAC + expiracao.
 * URL expirada = 403 — mesma semantica das signed URLs do Supabase.
 */
@Controller('files')
export class LocalFilesController {
  constructor(private readonly storage: StorageService) {}

  @Get(':slug/:key')
  async serve(
    @Param('slug') rawSlug: string,
    @Param('key') key: string,
    @Query('exp') expRaw: string,
    @Query('sig') sig: string,
    @Query('name') name: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const slugParsed = tenantSlugSchema.safeParse(rawSlug);
    if (!slugParsed.success) throw new ForbiddenException('URL invalida');
    assertSafeFileKey(key);

    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || !sig || !/^[0-9a-f]{64}$/.test(sig)) {
      throw new ForbiddenException('URL invalida');
    }
    if (exp < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('URL expirada');
    }
    const expected = signLocal(slugParsed.data, key, exp);
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      throw new ForbiddenException('URL invalida');
    }

    const data = await this.storage.readLocal(slugParsed.data, key);
    const isAttachment = key.endsWith('.zip') || key.endsWith('.dump.gz');
    const isImage = ['png', 'jpg', 'jpeg'].includes(extOf(key));
    const displayName = name ? `${sanitizeDownloadName(name)}.${extOf(key)}` : key;
    res.setHeader('Content-Type', mimeForKey(key));
    res.setHeader('Content-Disposition', isAttachment ? `attachment; filename="${displayName}"` : 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Imagens (brasao) sao incorporadas via <img> de outra origem (app web em outra porta) —
    // o CORP padrao do Helmet (same-origin) bloquearia esse carregamento entre origens.
    if (isImage) res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(data);
  }
}

@Global()
@Module({
  controllers: [LocalFilesController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
