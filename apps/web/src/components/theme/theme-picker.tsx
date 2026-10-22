'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { Check, Laptop, Moon, Palette, RotateCcw, Sun } from 'lucide-react';
import { CORES_RAPIDAS, HEX_COR, PRESETS_TEMA, type ModoTema, type UiTheme } from '@jdoc/shared';
import { Badge, Button, Card, CardHeader, Input, Tabs } from '@/components/ui';
import { aplicarTemaMarca, previaTemaMarca } from '@/lib/brand-theme';
import { cn } from '@/lib/cn';

/**
 * "Aparencia": presets de cor com previa ao clicar, cor personalizada e modo
 * claro/escuro/sistema. Nada e gravado ate "Salvar"; sair sem salvar volta ao
 * tema que estava aplicado.
 */
export function ThemePicker({
  escopo,
  valor,
  corOrgao,
  rotuloOrgao = 'Usar a cor do órgão',
  onSalvar,
}: {
  escopo: string;
  valor: UiTheme | null;
  corOrgao: string | null;
  rotuloOrgao?: string;
  onSalvar: (tema: UiTheme | null) => Promise<void>;
}) {
  const { theme, setTheme } = useTheme();
  const [cor, setCor] = useState<string | null>(valor?.color ?? null);
  const [modo, setModo] = useState<ModoTema>(valor?.mode ?? ((theme as ModoTema | undefined) ?? 'light'));
  const [hex, setHex] = useState(valor?.color ?? '');
  const [salvando, setSalvando] = useState(false);
  const salvo = useRef(valor);
  salvo.current = valor;

  // Saiu da tela sem salvar: desfaz a previa.
  useEffect(
    () => () => {
      aplicarTemaMarca(escopo, salvo.current?.color ?? null, corOrgao);
      if (salvo.current?.mode) setTheme(salvo.current.mode);
    },
    [], // so na desmontagem
  );

  const escolher = (c: string | null) => {
    setCor(c);
    if (c) setHex(c);
    if (c) previaTemaMarca(c);
    else aplicarTemaMarca(escopo, null, corOrgao);
  };

  const mudarModo = (m: ModoTema) => {
    setModo(m);
    setTheme(m);
  };

  const hexValido = HEX_COR.test(hex);
  const alterado = (valor?.color ?? null) !== cor || (valor?.mode ?? null) !== modo;

  const salvar = async () => {
    setSalvando(true);
    try {
      await onSalvar({ color: cor, mode: modo });
      aplicarTemaMarca(escopo, cor, corOrgao);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={Palette}
        title="Aparência"
        description="Cores e modo do sistema. Clique para ver a prévia; o tema acompanha sua conta em qualquer aparelho."
        action={
          <Button size="sm" onClick={salvar} loading={salvando} disabled={!alterado || (cor !== null && !HEX_COR.test(cor))}>
            Salvar
          </Button>
        }
      />
      <div className="space-y-6 p-5">
        <div>
          <p className="label-caps mb-2">Modo</p>
          <Tabs<ModoTema>
            value={modo}
            onChange={mudarModo}
            items={[
              { id: 'light', label: 'Claro', icon: Sun },
              { id: 'dark', label: 'Escuro', icon: Moon },
              { id: 'system', label: 'Igual ao sistema', icon: Laptop },
            ]}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="label-caps">Tema de cor</p>
            <button
              type="button"
              onClick={() => escolher(null)}
              className={cn(
                'inline-flex items-center gap-1.5 text-[13px] font-semibold transition',
                cor === null ? 'text-brand-600' : 'text-ink-500 hover:text-ink-900',
              )}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {rotuloOrgao}
              {corOrgao && <span className="h-3 w-3 rounded-full ring-1 ring-inset ring-ink-900/10" style={{ background: corOrgao }} />}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PRESETS_TEMA.map((p) => {
              const ativo = cor?.toLowerCase() === p.cor.toLowerCase();
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => escolher(p.cor)}
                  aria-pressed={ativo}
                  className={cn(
                    'relative rounded-[12px] border bg-surface p-4 text-left transition',
                    ativo ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-ink-200 hover:border-ink-300',
                  )}
                >
                  {ativo && (
                    <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  )}
                  <span className="flex gap-1.5">
                    {[p.cor, ...p.apoio].map((c) => (
                      <span key={c} className="h-5 w-5 rounded-full ring-1 ring-inset ring-ink-900/10" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="mt-3 block text-sm font-bold text-ink-900">{p.nome}</span>
                  <span className="mt-0.5 block text-xs text-ink-500">{p.descricao}</span>
                  <span className="mt-3 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <Badge key={t} tone="neutral">
                        {t}
                      </Badge>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="label-caps mb-2">Cor personalizada</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              aria-label="Escolher cor"
              value={hexValido ? hex : '#2547eb'}
              onChange={(e) => escolher(e.target.value)}
              className="h-10 w-12 cursor-pointer rounded-[10px] border border-ink-200 bg-surface p-1"
            />
            <Input
              value={hex}
              onChange={(e) => {
                const v = e.target.value.trim();
                setHex(v);
                if (HEX_COR.test(v)) escolher(v);
              }}
              placeholder="#2547eb"
              invalid={hex !== '' && !hexValido}
              aria-label="Cor em hexadecimal"
              className="w-32 font-mono"
              maxLength={7}
            />
            <div className="flex flex-wrap gap-1.5">
              {CORES_RAPIDAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => escolher(c)}
                  aria-label={`Usar a cor ${c}`}
                  className={cn(
                    'h-7 w-7 rounded-full ring-1 ring-inset ring-ink-900/10 transition hover:scale-110',
                    cor?.toLowerCase() === c && 'ring-2 ring-offset-2 ring-offset-surface ring-ink-900',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          {hex !== '' && !hexValido && <p className="mt-1.5 text-xs font-medium text-danger-600">Use o formato #RRGGBB.</p>}
        </div>

        {/* Previa dos elementos que mudam */}
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-dashed border-ink-200 p-4">
          <span className="label-caps">Prévia</span>
          <Button size="sm">Botão principal</Button>
          <Badge tone="brand">Destaque</Badge>
          <span className="flex h-9 items-center gap-2 rounded-[10px] bg-[var(--sidebar-bg,#0f172a)] px-3 text-xs font-semibold text-white">
            <span className="rounded-[8px] bg-brand-600 px-2 py-1">Menu ativo</span>
            Menu
          </span>
        </div>
      </div>
    </Card>
  );
}
