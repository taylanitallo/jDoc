import { useState } from 'react';
import type { SessionView } from '../types';
import { UploadView } from './UploadView';
import { DocumentsView } from './DocumentsView';

type Tab = 'upload' | 'documents';

/**
 * Shell autenticado. Duas abas: envio em lote e listagem/visualizacao de
 * documentos. Mostra orgao/papel e permite logout.
 */
export function Shell({
  session,
  onLogout,
}: {
  session: SessionView;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('upload');

  async function handleLogout() {
    setBusy(true);
    try {
      await window.jdoc.invoke('auth:logout');
    } finally {
      onLogout();
    }
  }

  return (
    <div className="shell">
      <header className="shell-bar">
        <span className="shell-brand">jDoc Desktop</span>
        <span className="shell-tenant">{session.tenant.slug}</span>
        <span className="shell-spacer" />
        <span className="shell-user">
          {session.user.email ?? session.user.id} · {session.user.role}
        </span>
        <button type="button" className="shell-logout" onClick={handleLogout} disabled={busy}>
          {busy ? 'Saindo…' : 'Sair'}
        </button>
      </header>

      <nav className="shell-tabs">
        <button
          type="button"
          className={`shell-tab ${tab === 'upload' ? 'shell-tab-active' : ''}`}
          onClick={() => setTab('upload')}
        >
          Enviar
        </button>
        <button
          type="button"
          className={`shell-tab ${tab === 'documents' ? 'shell-tab-active' : ''}`}
          onClick={() => setTab('documents')}
        >
          Documentos
        </button>
      </nav>

      <main className="shell-body">
        {tab === 'upload' ? (
          <>
            <h2 className="shell-title">Upload em lote</h2>
            <p className="shell-note">
              Órgão <strong>{session.tenant.slug}</strong> · envie PDFs de receita, despesa,
              balancete, extrato ou outros.
            </p>
            <UploadView />
          </>
        ) : (
          <>
            <h2 className="shell-title">Documentos</h2>
            <p className="shell-note">Filtre por módulo e visualize o PDF sem baixar para disco.</p>
            <DocumentsView />
          </>
        )}
      </main>
    </div>
  );
}
