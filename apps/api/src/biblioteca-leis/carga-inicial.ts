/**
 * Carga (ou continuacao) da biblioteca de leis, rodando de fora do servidor:
 *
 *   railway run --service jdoc-api --environment production npx tsx src/biblioteca-leis/carga-inicial.ts
 *
 * GITHUB_TOKEN no ambiente eleva o limite da API do GitHub (60 -> 5000/h); sem
 * ele a carga federal (muitas pastas) para no limite e continua na proxima vez.
 * Repetir e seguro: so baixa o que falta.
 */
import { DatabaseService } from '../database/database.service';
import { LeisSyncService } from './leis-sync.service';

async function main(): Promise<void> {
  const db = new DatabaseService();
  const sync = new LeisSyncService(db);
  const inicio = Date.now();
  const limite = Number(process.env.LEIS_LIMITE ?? 200_000);
  const r = await sync.sincronizar({
    limite,
    onProgresso: (p) => console.log(`... ${p.novos} novas, ${p.atualizados} alteradas, ${p.falhas} falhas, ${p.pastasPuladas} pastas puladas`),
  });
  console.log(JSON.stringify(r));
  console.log(`concluido em ${Math.round((Date.now() - inicio) / 1000)} s${r.incompleto ? ' (INCOMPLETO: rode de novo)' : ''}`);
  await db.onModuleDestroy();
}

main().catch((e: Error) => {
  console.error('erro:', e.message);
  process.exit(1);
});
