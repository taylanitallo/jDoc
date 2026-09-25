'use client';

import { useState } from 'react';
import { Building2, Calculator, FileType2, FolderTree, Palette, Settings, Target, Users, type LucideIcon } from 'lucide-react';
import { Tabs, TONE_VIVID } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useModuloAtivo } from '@/components/modulo-ativo';
import type { Sistema } from '@jdoc/shared';
import { OrgaosTab } from './orgaos-tab';
import { ProjetoAtividadeTab } from './projeto-atividade-tab';
import { ElementosDespesaTab } from './elementos-despesa-tab';
import { TiposDocumentoTab } from './tipos-documento-tab';
import { UsuariosTab } from './usuarios-tab';
import { LayoutTab } from './layout-tab';
import { ClassificacaoTab } from './classificacao-tab';

type Guia = 'orgaos' | 'projetos' | 'elementos' | 'tipos-documento' | 'classificacao' | 'usuarios' | 'layout';

/** sistema = aba so aparece com o modulo contratado; null = comum. */
const GUIAS: { id: Guia; label: string; sistema: Sistema | null; icon: LucideIcon }[] = [
  { id: 'orgaos', label: 'Órgãos', sistema: null, icon: Building2 },
  { id: 'projetos', label: 'Projeto/atividade', sistema: 'financeiro', icon: Target },
  { id: 'elementos', label: 'Elemento de despesa', sistema: 'financeiro', icon: Calculator },
  { id: 'tipos-documento', label: 'Tipos de documento', sistema: null, icon: FileType2 },
  { id: 'classificacao', label: 'Plano de Classificação', sistema: 'arquivo', icon: FolderTree },
  { id: 'usuarios', label: 'Usuários', sistema: null, icon: Users },
  { id: 'layout', label: 'Aparência', sistema: null, icon: Palette },
];

export default function ConfiguracoesPage() {
  const [guiaAtiva, setGuiaAtiva] = useState<Guia>('orgaos');
  // Abas do modulo em uso + as comuns aos dois.
  const { ativo } = useModuloAtivo();
  const guias = GUIAS.filter((g) => g.sistema === null || g.sistema === ativo);
  const guia = guias.some((g) => g.id === guiaAtiva) ? guiaAtiva : 'orgaos';

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.neutral.chip)}>
          <Settings className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Configurações</h1>
          <p className="mt-0.5 text-sm text-ink-500">Cadastros de apoio, usuários e a aparência do sistema.</p>
        </div>
      </div>

      <Tabs value={guia} onChange={setGuiaAtiva} items={guias} className="w-full sm:w-auto" />

      {/* Conteudo da guia ativa */}
      {guia === 'orgaos' && <OrgaosTab />}
      {guia === 'projetos' && <ProjetoAtividadeTab />}
      {guia === 'elementos' && <ElementosDespesaTab />}
      {guia === 'tipos-documento' && <TiposDocumentoTab />}
      {guia === 'classificacao' && <ClassificacaoTab />}
      {guia === 'usuarios' && <UsuariosTab />}
      {guia === 'layout' && <LayoutTab />}
    </div>
  );
}
