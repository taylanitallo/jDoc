'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Bot, Building2, Landmark, Mail, Server, ShieldCheck, UserCheck } from 'lucide-react';
import { DIREITOS_LGPD, DIREITO_LGPD_LABEL, LGPD_PRAZO_DIAS, type PrivacidadePublica, type TenantBranding } from '@jdoc/shared';
import { api } from '@/lib/api';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

/** Pagina publica (sem login): quem trata os dados, onde ficam e como o titular exerce os direitos. */
export default function PrivacidadePage() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <Conteudo />
    </QueryClientProvider>
  );
}

function Conteudo() {
  const { slug } = useParams<{ slug: string }>();
  const { data: b } = useQuery<TenantBranding>({
    queryKey: ['public-branding', slug],
    queryFn: () => api(`/t/${slug}/configuracoes/public-branding`),
  });
  const { data: p } = useQuery<PrivacidadePublica>({
    queryKey: ['privacidade-publica', slug],
    queryFn: () => api(`/t/${slug}/privacidade/publica`),
  });
  const nome = b?.nomeExibido || b?.nomeOrgao || p?.orgao || String(slug);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-ink-200 bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4 sm:px-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-200 bg-ink-50">
            {b?.brasaoUrl ? <img src={b.brasaoUrl} alt="" className="h-full w-full object-contain" /> : <Landmark className="h-6 w-6 text-ink-400" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold uppercase tracking-tight text-ink-900 sm:text-base">{nome}</p>
            <p className="flex items-center gap-1.5 text-sm text-ink-500">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Privacidade e proteção de dados
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        {!p ? (
          <Skeleton rows={8} />
        ) : (
          <>
            <p className="text-sm text-ink-700">
              Esta página explica como os documentos e dados pessoais guardados no sistema de gestão documental de {nome} são tratados, conforme a Lei
              Geral de Proteção de Dados (Lei nº 13.709/2018).
            </p>

            <Card>
              <CardHeader icon={Building2} title="Quem trata os dados" />
              <CardBody>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="label-caps">Controlador</dt>
                    <dd className="mt-1 text-ink-900">{nome}</dd>
                    <dd className="text-xs text-ink-500">Decide sobre os dados e responde ao titular.</dd>
                  </div>
                  <div>
                    <dt className="label-caps">Operador</dt>
                    <dd className="mt-1 text-ink-900">
                      {p.plataforma.operadorNome}
                      {p.plataforma.operadorCnpj ? ` — CNPJ ${p.plataforma.operadorCnpj}` : ''}
                    </dd>
                    <dd className="text-xs text-ink-500">Fornece o sistema e trata os dados só por ordem do órgão.</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader icon={UserCheck} title="Encarregado (DPO)" description="Canal para dúvidas e pedidos sobre seus dados." />
              <CardBody>
                {p.encarregado ? (
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-ink-900">{p.encarregado.nome}</p>
                    {p.encarregado.email && (
                      <p className="flex items-center gap-1.5 text-ink-700">
                        <Mail className="h-4 w-4" aria-hidden />
                        <a href={`mailto:${p.encarregado.email}`} className="text-brand-600 hover:underline">
                          {p.encarregado.email}
                        </a>
                      </p>
                    )}
                    {p.encarregado.telefone && <p className="text-ink-700">{p.encarregado.telefone}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-ink-500">O órgão ainda não informou o encarregado. Procure o protocolo ou a ouvidoria.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader icon={Server} title="Onde os dados ficam" description={p.plataforma.regiaoHospedagem} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-ink-100 bg-ink-50/60 text-left">
                    <tr>
                      <th className="px-5 py-2 label-caps">Suboperador</th>
                      <th className="px-5 py-2 label-caps">Para quê</th>
                      <th className="px-5 py-2 label-caps">Local</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {p.plataforma.suboperadores.map((s) => (
                      <tr key={s.nome}>
                        <td className="px-5 py-2 font-semibold text-ink-900">{s.nome}</td>
                        <td className="px-5 py-2 text-ink-700">{s.finalidade}</td>
                        <td className="px-5 py-2 text-ink-700">{s.local}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader icon={Bot} title="Inteligência artificial" />
              <CardBody>
                <p className="text-sm text-ink-700">
                  {p.iaDesligada
                    ? 'Este órgão não usa inteligência artificial com os documentos: nenhum conteúdo é enviado a provedores de IA.'
                    : 'O assistente de pesquisa e a conferência de documentos podem enviar trechos dos documentos ao provedor de IA listado acima, só para responder ao usuário. Os documentos não são usados para treinar modelos.'}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader icon={ShieldCheck} title="Compromissos" />
              <CardBody>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
                  {p.plataforma.compromissos.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                icon={UserCheck}
                title="Seus direitos como titular"
                description={`Faça o pedido ao encarregado ou no protocolo. O órgão responde em até ${LGPD_PRAZO_DIAS} dias (art. 19 da LGPD).`}
              />
              <CardBody>
                <ul className="grid gap-1 text-sm text-ink-700 sm:grid-cols-2">
                  {DIREITOS_LGPD.map((d) => (
                    <li key={d}>• {DIREITO_LGPD_LABEL[d]}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </>
        )}
      </main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-center text-xs text-ink-400 sm:px-6">Publicado com jDoc — JEOS Sistemas.</footer>
    </div>
  );
}
