'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Modal } from './modal';
import { Field, Input, Textarea } from './input';

/**
 * Confirmacao de acao destrutiva/sensivel. Opcionalmente exige digitar um
 * texto (ex.: o identificador do orgao) ou informar um motivo.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  tone = 'danger',
  loading,
  digitar,
  motivo,
}: {
  open: boolean;
  onClose: () => void;
  /** Recebe o motivo digitado, quando `motivo` estiver ligado. */
  onConfirm: (motivo: string) => void | Promise<void>;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  /** Texto que precisa ser digitado igual para liberar o botao. */
  digitar?: string;
  /** Pede um motivo (obrigatorio, minimo 5 caracteres). */
  motivo?: { label: string; placeholder?: string };
}) {
  const [texto, setTexto] = useState('');
  const [razao, setRazao] = useState('');
  const liberado = (!digitar || texto.trim() === digitar) && (!motivo || razao.trim().length >= 5);
  const fechar = () => {
    setTexto('');
    setRazao('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={fechar}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            variant={tone}
            loading={loading}
            disabled={!liberado}
            onClick={async () => {
              await onConfirm(razao.trim());
              setTexto('');
              setRazao('');
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {description && <div className="text-sm text-ink-600">{description}</div>}
        {motivo && (
          <Field label={motivo.label} htmlFor="confirm-motivo" required hint="Mínimo de 5 caracteres. Fica registrado na auditoria.">
            <Textarea id="confirm-motivo" value={razao} onChange={(e) => setRazao(e.target.value)} placeholder={motivo.placeholder} />
          </Field>
        )}
        {digitar && (
          <Field label={<>Digite <strong className="font-mono text-ink-900">{digitar}</strong> para confirmar</>} htmlFor="confirm-texto" required>
            <Input id="confirm-texto" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" />
          </Field>
        )}
      </div>
    </Modal>
  );
}
