'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Search, UserSearch } from 'lucide-react';
import type { UsuarioGlobalView } from '@jdoc/shared';
import { api } from '@/lib/api';
import { fmtCpf, fmtRelative } from '@/lib/format';
import { Avatar, Badge, Card, Input, PageHeader, Pagination } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';

const POR_PAGINA = 25;

/** Busca um usuario em todos os orgaos (nome, e-mail ou CPF) e leva a aba Usuarios do orgao. */
export default function UsuariosGlobalPage() {
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(texto.trim());
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [texto]);
  const { data, isFetching } = useQuery({
    queryKey: ['sa-busca-usuarios', q],
    queryFn: () => api<UsuarioGlobalView[]>(`/superadmin/users?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 3,
  });
  const lista = data ?? [];

  return (
    <div>
      <PageHeader title="Usuários" description="Encontre uma pessoa em qualquer órgão pelo nome, e-mail ou CPF." />
      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
        <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Digite ao menos 3 caracteres" className="pl-9" aria-label="Buscar usuário" autoFocus />
      </div>
      {q.length < 3 ? (
        <EmptyState icon={UserSearch} title="Busque por nome, e-mail ou CPF" description="A busca percorre todos os órgãos, um a um, sem misturar os dados deles." />
      ) : isFetching && !data ? (
        <SkeletonTable rows={4} columns={4} label="Buscando" />
      ) : lista.length === 0 ? (
        <EmptyState icon={UserSearch} title="Ninguém encontrado" description="Confira a grafia ou tente pelo e-mail." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Usuário</th>
                  <th className="px-4 py-3 label-caps">Órgão</th>
                  <th className="px-4 py-3 label-caps">Perfil</th>
                  <th className="px-4 py-3 label-caps">Último acesso</th>
                  <th className="px-4 py-3" aria-label="Abrir" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((u) => (
                  <tr key={`${u.tenantId}-${u.userId}`} className="hover:bg-ink-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar nome={u.nome} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-900">
                            {u.nome} {!u.ativo && <Badge tone="neutral">Desativado</Badge>}
                          </p>
                          <p className="truncate text-xs text-ink-500">
                            {u.email}
                            {u.cpf && ` · ${fmtCpf(u.cpf)}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{u.orgao}</td>
                    <td className="px-4 py-3 text-ink-600">{u.perfilNome ?? 'Personalizado'}</td>
                    <td className="px-4 py-3 text-ink-600">{u.ultimoAcesso ? fmtRelative(u.ultimoAcesso) : 'Nunca'}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/superadmin/orgaos/${u.tenantId}/usuarios`}
                        className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700"
                      >
                        Ver no órgão <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={lista.length} onPageChange={setPagina} />
          </div>
        </Card>
      )}
    </div>
  );
}
