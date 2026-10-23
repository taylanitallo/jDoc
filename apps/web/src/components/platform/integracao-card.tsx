'use client';

import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, Mail, Map as MapIcon, MessageCircle, PlugZap, Sparkles, XCircle, type LucideIcon } from 'lucide-react';
import {
  DEFINICOES_INTEGRACAO,
  type IntegracaoUpdateInput,
  type IntegracaoView,
  type TesteIntegracao,
} from '@jdoc/shared';
import { ApiError } from '@/lib/api';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Switch } from '@/components/ui';
import { useToast } from '@/components/toast';

const ICONES: Record<string, LucideIcon> = { Mail, Sparkles, Bot, Map: MapIcon, MessageCircle };

const ORIGEM: Record<string, string> = {
  orgao: 'Chave própria do órgão',
  plataforma: 'Padrão da plataforma',
  ambiente: 'Variável do servidor',
};

/**
 * Uma integracao (SMTP, IA, mapas, WhatsApp): ligar/desligar, campos de
 * configuracao, segredos (so "configurado ••••1234"; digitar troca) e "Testar".
 * No orgao ainda ha "usar a padrao da plataforma".
 */
export function IntegracaoCard({
  view,
  modo,
  onSalvar,
  onTestar,
  podeEditar = true,
}: {
  view: IntegracaoView;
  modo: 'orgao' | 'plataforma';
  onSalvar: (body: IntegracaoUpdateInput) => Promise<void>;
  onTestar: () => Promise<TesteIntegracao>;
  podeEditar?: boolean;
}) {
  const def = DEFINICOES_INTEGRACAO[view.key];
  const Icone = ICONES[def.icone] ?? PlugZap;
  const toast = useToast();
  const [enabled, setEnabled] = useState(view.enabled);
  const [usarPadrao, setUsarPadrao] = useState(view.usarPadrao);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [segredos, setSegredos] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<TesteIntegracao | null>(null);

  useEffect(() => {
    setEnabled(view.enabled || (modo === 'orgao' && !view.atualizadoEm));
    setUsarPadrao(view.usarPadrao);
    setConfig(Object.fromEntries(def.campos.map((c) => [c.id, view.config[c.id] == null ? '' : String(view.config[c.id])])));
    setSegredos({});
  }, [view, def, modo]);

  const proprio = modo === 'plataforma' || !usarPadrao;

  const salvar = async () => {
    for (const c of def.campos) {
      if (proprio && enabled && c.obrigatorio && !config[c.id]?.trim()) {
        toast.error(`Preencha "${c.label}".`);
        return;
      }
    }
    setSalvando(true);
    try {
      const configTipada = Object.fromEntries(
        def.campos.map((c) => {
          const v = config[c.id]?.trim() ?? '';
          return [c.id, v === '' ? null : c.tipo === 'numero' ? Number(v) : v];
        }),
      );
      const novos = Object.fromEntries(Object.entries(segredos).filter(([, v]) => v.trim() !== ''));
      await onSalvar({
        enabled,
        ...(modo === 'orgao' ? { usarPadrao } : {}),
        config: configTipada,
        ...(Object.keys(novos).length ? { segredos: novos } : {}),
      });
      setTeste(null);
      toast.success(`${def.nome}: configuração salva.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    try {
      setTeste(await onTestar());
    } catch (e) {
      setTeste({ ok: false, mensagem: e instanceof ApiError ? e.message : 'Falha ao testar.', ms: 0 });
    } finally {
      setTestando(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={Icone}
        title={def.nome}
        description={def.descricao}
        action={
          view.origemEfetiva ? (
            <Badge tone="success">{ORIGEM[view.origemEfetiva]}</Badge>
          ) : (
            <Badge tone="neutral">Sem configuração</Badge>
          )
        }
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
            <Switch checked={enabled} onChange={setEnabled} label={`Ligar ${def.nome}`} disabled={!podeEditar} />
            Ligado
          </label>
          {modo === 'orgao' && (
            <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <Switch checked={usarPadrao} onChange={setUsarPadrao} label="Usar a padrão da plataforma" disabled={!podeEditar} />
              Usar a padrão da plataforma
              {!view.padraoDisponivel && <span className="text-xs font-normal text-ink-500">(a plataforma não tem uma ligada)</span>}
            </label>
          )}
        </div>

        {proprio && (
          <div className="grid gap-4 sm:grid-cols-2">
            {def.campos.map((c) => (
              <Field key={c.id} label={c.label} htmlFor={`${view.key}-${c.id}`} required={c.obrigatorio} hint={c.dica}>
                {c.tipo === 'opcoes' ? (
                  <Select
                    id={`${view.key}-${c.id}`}
                    value={config[c.id] ?? ''}
                    onChange={(e) => setConfig((s) => ({ ...s, [c.id]: e.target.value }))}
                    disabled={!podeEditar}
                  >
                    <option value="">Selecione</option>
                    {c.opcoes?.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={`${view.key}-${c.id}`}
                    type={c.tipo === 'numero' ? 'number' : c.tipo === 'email' ? 'email' : 'text'}
                    value={config[c.id] ?? ''}
                    placeholder={c.placeholder}
                    onChange={(e) => setConfig((s) => ({ ...s, [c.id]: e.target.value }))}
                    disabled={!podeEditar}
                  />
                )}
              </Field>
            ))}
            {def.segredos.map((s) => (
              <Field
                key={s.id}
                label={s.label}
                htmlFor={`${view.key}-seg-${s.id}`}
                hint={view.segredos[s.id] ? `Configurado ${view.segredos[s.id]}. Digite para trocar.` : 'Não configurado.'}
              >
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
                  <Input
                    id={`${view.key}-seg-${s.id}`}
                    type="password"
                    autoComplete="new-password"
                    className="pl-9"
                    value={segredos[s.id] ?? ''}
                    placeholder={view.segredos[s.id] ?? ''}
                    onChange={(e) => setSegredos((x) => ({ ...x, [s.id]: e.target.value }))}
                    disabled={!podeEditar}
                  />
                </div>
              </Field>
            ))}
          </div>
        )}

        {teste && (
          <p
            role="status"
            className={`flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-sm ring-1 ring-inset ${
              teste.ok ? 'bg-success-50 text-success-600 ring-success-600/15' : 'bg-danger-50 text-danger-600 ring-danger-600/15'
            }`}
          >
            {teste.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="h-4 w-4 shrink-0" aria-hidden />}
            {teste.mensagem}
            {teste.ms > 0 && <span className="ml-auto text-xs opacity-75">{teste.ms} ms</span>}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={testar} loading={testando} leftIcon={<PlugZap aria-hidden />}>
            Testar conexão
          </Button>
          {podeEditar && (
            <Button onClick={salvar} loading={salvando}>
              Salvar
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
