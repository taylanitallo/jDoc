'use client';

import { useState } from 'react';
import { TabButton } from '@/components/tab-button';
import { OrgaosTab } from './orgaos-tab';
import { ProjetoAtividadeTab } from './projeto-atividade-tab';
import { ElementosDespesaTab } from './elementos-despesa-tab';
import { TiposDocumentoTab } from './tipos-documento-tab';
import { UsuariosTab } from './usuarios-tab';
import { LayoutTab } from './layout-tab';

type Guia = 'orgaos' | 'projetos' | 'elementos' | 'tipos-documento' | 'usuarios' | 'layout';

const GUIAS: { id: Guia; label: string }[] = [
  { id: 'orgaos', label: 'Órgãos' },
  { id: 'projetos', label: 'Projeto Atividade' },
  { id: 'elementos', label: 'Elemento de Despesa' },
  { id: 'tipos-documento', label: 'Tipos de Documento' },
  { id: 'usuarios', label: 'Usuários e Permissões' },
  { id: 'layout', label: 'Layout / Customização' },
];

export default function ConfiguracoesPage() {
  const [guiaAtiva, setGuiaAtiva] = useState<Guia>('orgaos');

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-app">Configurações</h1>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {GUIAS.map((g) => (
          <TabButton
            key={g.id}
            active={guiaAtiva === g.id}
            onClick={() => setGuiaAtiva(g.id)}
          >
            {g.label}
          </TabButton>
        ))}
      </div>

      {/* Conteudo da guia ativa */}
      {guiaAtiva === 'orgaos' && <OrgaosTab />}
      {guiaAtiva === 'projetos' && <ProjetoAtividadeTab />}
      {guiaAtiva === 'elementos' && <ElementosDespesaTab />}
      {guiaAtiva === 'tipos-documento' && <TiposDocumentoTab />}
      {guiaAtiva === 'usuarios' && <UsuariosTab />}
      {guiaAtiva === 'layout' && <LayoutTab />}
    </div>
  );
}
