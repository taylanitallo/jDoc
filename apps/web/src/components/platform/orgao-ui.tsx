'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import type { TenantOverview, TenantRole, TenantStatus } from '@jdoc/shared';
import { api } from '@/lib/api';
import { Button, Input, Modal, type Tone } from '@/components/ui';
import { useToast } from '@/components/toast';

export const PAPEL_ORGAO: Record<TenantRole, string> = { admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' };

export const STATUS_TOM: Record<TenantStatus, Tone> = { ativo: 'success', inativo: 'danger', manutencao: 'warning', arquivado: 'neutral' };

/** Mostra uma senha provisoria que nao pode ir por e-mail (SMTP ausente). */
export function SenhaProvisoriaModal({ dados, onFechar }: { dados: { email: string; senha: string } | null; onFechar: () => void }) {
  const toast = useToast();
  return (
    <Modal
      open={!!dados}
      onClose={onFechar}
      title="Senha provisória"
      subtitle="O e-mail não pôde ser enviado (servidor de e-mail não configurado). Repasse a senha por um canal seguro; ela só aparece agora."
      size="sm"
      footer={<Button onClick={onFechar}>Pronto</Button>}
    >
      {dados && (
        <div className="space-y-2">
          <p className="text-sm text-ink-600">{dados.email}</p>
          <div className="flex gap-2">
            <Input readOnly value={dados.senha} className="font-mono" aria-label="Senha provisória" />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar senha"
              onClick={async () => {
                await navigator.clipboard.writeText(dados.senha);
                toast.success('Senha copiada.');
              }}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Orgao da rota (cache compartilhado entre as abas do detalhe). */
export function useOrgao(id: string) {
  return useQuery({ queryKey: ['sa-tenant', id], queryFn: () => api<TenantOverview>(`/superadmin/tenants/${id}`) });
}

/** Recarrega o orgao e a lista depois de uma alteracao. */
export function useAtualizarOrgao(id: string): () => Promise<void> {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['sa-tenant', id] }), qc.invalidateQueries({ queryKey: ['sa-tenants'] })]);
  };
}
