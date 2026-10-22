import postgres from 'postgres';
import argon2 from 'argon2';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/**
 * Cria um proprietario (owner) da plataforma. Sem rota publica: so pelo terminal.
 *
 *   pnpm admin:create -- --email fulano@jeossistemas.com --name "Fulano de Tal"
 *
 * A senha e pedida no terminal (sem eco) e precisa ter 10+ caracteres. No
 * primeiro acesso o sistema obriga a configurar a verificacao em 2 etapas.
 */
const rootEnv = resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function perguntarSenha(rotulo: string): Promise<string> {
  let mudo = false;
  const saida = new Writable({
    write(chunk, enc, cb) {
      if (!mudo) process.stdout.write(chunk, enc);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: saida, terminal: true });
  return new Promise((ok) => {
    rl.question(rotulo, (resposta) => {
      rl.close();
      process.stdout.write('\n');
      ok(resposta);
    });
    mudo = true;
  });
}

async function main(): Promise<void> {
  const email = argumento('email')?.trim().toLowerCase();
  const nome = argumento('name')?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !nome) {
    throw new Error('Uso: pnpm admin:create -- --email <e-mail> --name "<nome>"');
  }
  const senha = await perguntarSenha('Senha (mínimo 10 caracteres): ');
  if (senha.length < 10) throw new Error('A senha deve ter no mínimo 10 caracteres.');
  if ((await perguntarSenha('Repita a senha: ')) !== senha) throw new Error('As senhas não conferem.');

  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DIRECT_URL ou DATABASE_URL não definido');
  const sql = postgres(url, { max: 1 });
  try {
    const hash = await argon2.hash(senha, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    const [r] = await sql<Array<{ id: string; novo: boolean }>>`
      INSERT INTO public.superadmins (email, nome, senha_hash, role, must_change_password)
      VALUES (${email}, ${nome}, ${hash}, 'owner', false)
      ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, role = 'owner', ativo = true
      RETURNING id, (xmax = 0) AS novo
    `;
    console.warn(`[admin:create] ${r?.novo ? 'Proprietário criado' : 'Proprietário atualizado'}: ${email}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: Error) => {
  console.error(`[admin:create] ${err.message}`);
  process.exit(1);
});
