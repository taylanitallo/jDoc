import type { Sql, TransactionSql } from 'postgres';

/**
 * Executa um dump plain do pg_dump dentro de uma transacao do postgres.js.
 *
 * O texto do pg_dump nao e SQL puro: traz meta-comandos do psql (`\restrict`,
 * `\unrestrict`), blocos `COPY ... FROM stdin;` com os dados ate a linha `\.`
 * e, no pg_dump 17, `SET transaction_timeout` (que servidor 15/16 recusa).
 * Aqui os comandos vao em lotes pelo protocolo simples e cada COPY vai pelo
 * canal de COPY do driver.
 */
export async function executarDump(tx: TransactionSql | Sql, dump: string): Promise<{ comandos: number; copias: number }> {
  const linhas = dump.split(/\r?\n/);
  let lote: string[] = [];
  let comandos = 0;
  let copias = 0;

  const enviarLote = async () => {
    const texto = lote.join('\n').trim();
    lote = [];
    if (!texto) return;
    await tx.unsafe(texto);
    comandos++;
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;
    if (/^\\(restrict|unrestrict)\b/.test(linha)) continue;
    if (/^SET transaction_timeout\b/.test(linha)) continue;
    const copia = /^COPY .+ FROM stdin;$/.exec(linha);
    if (!copia) {
      lote.push(linha);
      continue;
    }
    await enviarLote();
    const dados: string[] = [];
    for (i++; i < linhas.length && linhas[i] !== '\\.'; i++) dados.push(linhas[i]!);
    const stream = await tx.unsafe(linha.slice(0, -1)).writable();
    await new Promise<void>((ok, falha) => {
      stream.on('error', falha);
      stream.on('finish', () => ok());
      if (dados.length) stream.write(`${dados.join('\n')}\n`);
      stream.end();
    });
    copias++;
  }
  await enviarLote();
  return { comandos, copias };
}

/** Troca o schema do dump (ex.: restaurar num schema temporario para teste). */
export function trocarSchema(dump: string, de: string, para: string): string {
  // Nome de schema vem de regex [a-z0-9_]: sem caracteres especiais de regex.
  return dump.replace(new RegExp(`\\b${de}\\b`, 'g'), para);
}
