import { LEIS_BRANCH, LEIS_REPO, lerCabecalho } from '@jdoc/shared';

/**
 * Acesso ao repositorio publico de leis. Sem token a API do GitHub libera 60
 * chamadas por hora por IP: o servico foi desenhado para gastar poucas (so
 * desce nas pastas cuja versao mudou). GITHUB_TOKEN, se existir, eleva o limite
 * (usado na carga inicial). O texto das leis vem de raw.githubusercontent.com,
 * que nao conta nesse limite.
 */

export interface EntradaArvore {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}
export interface Arvore {
  sha: string;
  tree: EntradaArvore[];
  truncated: boolean;
}

const API = `https://api.github.com/repos/${LEIS_REPO}`;
const RAW = `https://raw.githubusercontent.com/${LEIS_REPO}/${LEIS_BRANCH}`;
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function cabecalhosApi(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'jDoc-biblioteca-leis', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** fetch com repeticao para erro de rede, 5xx e limite de taxa. */
async function buscar(url: string, init: RequestInit = {}, tentativas = 4): Promise<Response> {
  let ultimo: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (r.status === 429 || r.status === 403) {
        const espera = Number(r.headers.get('retry-after') ?? 0) * 1000;
        const reset = Number(r.headers.get('x-ratelimit-reset') ?? 0) * 1000 - Date.now();
        if (r.headers.get('x-ratelimit-remaining') === '0' && reset > 120_000) throw new Error(`Limite de chamadas do GitHub esgotado (volta em ${Math.ceil(reset / 60_000)} min)`);
        await esperar(Math.min(Math.max(espera, reset > 0 ? reset : 0, 2_000 * (i + 1)), 90_000));
        continue;
      }
      if (r.status >= 500) {
        await esperar(1_500 * (i + 1));
        continue;
      }
      return r;
    } catch (e) {
      ultimo = e;
      if (e instanceof Error && e.message.startsWith('Limite de chamadas')) throw e;
      await esperar(1_500 * (i + 1));
    }
  }
  throw new Error(`GitHub indisponivel (${url}): ${ultimo instanceof Error ? ultimo.message : 'sem resposta'}`);
}

/** Arvore de uma pasta (so o primeiro nivel). `caminho` vazio = raiz. */
export async function arvore(caminho: string): Promise<Arvore | null> {
  const ref = caminho ? `${LEIS_BRANCH}:${caminho}` : LEIS_BRANCH;
  const r = await buscar(`${API}/git/trees/${encodeURIComponent(ref)}`, { headers: cabecalhosApi() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao listar ${caminho || 'raiz'}`);
  return (await r.json()) as Arvore;
}

/** Arvore por hash (subpasta ja conhecida pelo hash que a pasta-mae devolveu). */
export async function arvorePorSha(sha: string): Promise<Arvore> {
  const r = await buscar(`${API}/git/trees/${sha}`, { headers: cabecalhosApi() });
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao listar a pasta ${sha}`);
  return (await r.json()) as Arvore;
}

const urlRaw = (path: string) => `${RAW}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** So o cabecalho do arquivo (primeiros bytes); se ele nao fechar ali, baixa o arquivo todo. */
export async function cabecalhoDoArquivo(path: string): Promise<Record<string, string | boolean> | null> {
  const r = await buscar(urlRaw(path), { headers: { Range: 'bytes=0-8191', 'User-Agent': 'jDoc-biblioteca-leis' } });
  if (r.status === 404) return null;
  if (!r.ok && r.status !== 206) throw new Error(`Origem respondeu ${r.status} em ${path}`);
  let texto = await r.text();
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(texto) && r.status === 206) texto = await (await buscar(urlRaw(path))).text();
  return lerCabecalho(texto);
}

export async function textoDoArquivo(path: string): Promise<string | null> {
  const r = await buscar(urlRaw(path), { headers: { 'User-Agent': 'jDoc-biblioteca-leis' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Origem respondeu ${r.status} em ${path}`);
  return r.text();
}

export function linkDoRepositorio(path: string): string {
  return `https://github.com/${LEIS_REPO}/blob/${LEIS_BRANCH}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
