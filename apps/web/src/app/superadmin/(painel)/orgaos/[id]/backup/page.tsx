'use client';

import { useParams } from 'next/navigation';
import { CalendarClock, DatabaseBackup, Upload } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { AgendamentoTab, BackupTab } from '@/components/superadmin/tenant-manage-modal';
import { RestaurarArquivo } from '@/components/platform/restauracao';
import { useOrgao } from '@/components/platform/orgao-ui';
import { usePode } from '@/components/platform/admin-context';

export default function OrgaoBackupPage() {
  const { id } = useParams<{ id: string }>();
  const { data: t } = useOrgao(id);
  const owner = usePode('owner');
  if (!t) return <Skeleton rows={6} />;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader icon={DatabaseBackup} title="Backups do órgão" description="Cópias do banco do órgão; o download é registrado na auditoria." />
        <div className="p-5">
          <BackupTab tenant={t} />
        </div>
      </Card>
      <Card>
        <CardHeader icon={CalendarClock} title="Agendamento" description="Frequência, hora (de Fortaleza) e quantas cópias guardar." />
        <div className="p-5">
          <AgendamentoTab tenant={t} />
        </div>
      </Card>
      {owner && (
        <Card>
          <CardHeader icon={Upload} title="Restaurar" description="Enviando um arquivo próprio. Para voltar a um backup da lista, use a tela Backups." />
          <div className="p-5">
            <RestaurarArquivo tenantId={t.id} nomeOrgao={t.nome} />
          </div>
        </Card>
      )}
    </div>
  );
}
