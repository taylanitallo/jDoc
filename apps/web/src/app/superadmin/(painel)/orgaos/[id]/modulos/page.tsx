'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Landmark, Library, Settings, type LucideIcon } from 'lucide-react';
import { CATALOGO_MODULOS, type MenuOverrides, type Sistema } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, Switch } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { useAtualizarOrgao, useOrgao } from '@/components/platform/orgao-ui';
import { usePode } from '@/components/platform/admin-context';

const ICONES: Record<string, LucideIcon> = { Landmark, Library, Settings };

/**
 * Modulos contratados (cartoes com o que cada um faz) e, abaixo de cada um,
 * as telas que podem ser desligadas so para este orgao.
 */
export default function OrgaoModulosPage() {
  const { id } = useParams<{ id: string }>();
  const { data: t } = useOrgao(id);
  const pode = usePode('owner', 'implantacao');
  const toast = useToast();
  const atualizar = useAtualizarOrgao(id);
  const [modulos, setModulos] = useState<Sistema[]>([]);
  const [menus, setMenus] = useState<MenuOverrides>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!t) return;
    setModulos(t.modulos);
    setMenus(t.menuOverrides ?? {});
  }, [t]);

  if (!t) return <Skeleton rows={6} />;

  const alterado =
    JSON.stringify([...modulos].sort()) !== JSON.stringify([...t.modulos].sort()) ||
    JSON.stringify(menus) !== JSON.stringify(t.menuOverrides ?? {});

  const salvar = async () => {
    if (modulos.length === 0) return toast.error('O órgão precisa de pelo menos um módulo.');
    setSalvando(true);
    try {
      // So guarda o que esta desligado.
      const desligados = Object.fromEntries(Object.entries(menus).filter(([, v]) => v === false));
      await api(`/superadmin/tenants/${id}`, { method: 'PATCH', body: { modulos, menuOverrides: desligados } });
      await atualizar();
      toast.success('Módulos e menus salvos. Os usuários veem a mudança no próximo carregamento.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      {CATALOGO_MODULOS.map((m) => {
        const Icone = ICONES[m.icone] ?? Settings;
        const contratavel = m.id !== 'geral';
        const ligado = !contratavel || modulos.includes(m.id as Sistema);
        return (
          <Card key={m.id}>
            <div className="flex items-start gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-brand-50 text-brand-600">
                <Icone className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-ink-900">{m.nome}</h2>
                  {contratavel && <Badge tone={ligado ? 'success' : 'neutral'}>{ligado ? 'Contratado' : 'Não contratado'}</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink-600">{m.descricao}</p>
              </div>
              {contratavel && (
                <Switch
                  checked={ligado}
                  disabled={!pode}
                  label={`Contratar ${m.nome}`}
                  onChange={(v) => setModulos((s) => (v ? [...s, m.id as Sistema] : s.filter((x) => x !== m.id)))}
                />
              )}
            </div>
            {ligado && (
              <div className="border-t border-ink-100 px-5 py-4">
                <p className="label-caps mb-3">Telas</p>
                <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {m.menus.map((menu) => {
                    const on = menus[menu.id] !== false;
                    return (
                      <li key={menu.id} className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className={`block text-sm font-semibold ${on ? 'text-ink-800' : 'text-ink-400 line-through'}`}>{menu.label}</span>
                          <span className="block text-xs text-ink-500">{menu.descricao}</span>
                        </span>
                        <Switch
                          checked={on}
                          disabled={!pode}
                          label={`Mostrar ${menu.label}`}
                          onChange={(v) => setMenus((s) => ({ ...s, [menu.id]: v }))}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        );
      })}
      {pode && (
        <div className="sticky bottom-4 flex justify-end">
          <Button onClick={salvar} loading={salvando} disabled={!alterado} className="shadow-md">
            Salvar módulos e menus
          </Button>
        </div>
      )}
    </div>
  );
}
