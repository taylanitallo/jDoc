'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';

/** Nova senha + confirmacao (recuperacao de senha). */
export function NovaSenhaForm({
  antes,
  minimo = 6,
  textoBotao = 'Salvar nova senha',
  enviando,
  erro,
  onEnviar,
}: {
  /** Campos extras acima (ex.: o codigo de 6 digitos). */
  antes?: ReactNode;
  minimo?: number;
  textoBotao?: string;
  enviando: boolean;
  erro: string | null;
  onEnviar: (novaSenha: string) => void;
}) {
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (nova.length < minimo) return setLocal(`A senha deve ter no mínimo ${minimo} caracteres.`);
    if (nova !== confirma) return setLocal('A confirmação não confere com a nova senha.');
    setLocal(null);
    onEnviar(nova);
  };
  const mensagem = local ?? erro;

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      {antes}
      <Field label="Nova senha" htmlFor="ns-nova" required hint={`Mínimo de ${minimo} caracteres.`}>
        <Input id="ns-nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
      </Field>
      <Field label="Confirmar nova senha" htmlFor="ns-conf" required>
        <Input id="ns-conf" type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
      </Field>
      {mensagem && (
        <p role="alert" className="flex items-center gap-2 rounded-[10px] bg-danger-50 px-3 py-2.5 text-sm text-danger-600 ring-1 ring-inset ring-danger-600/15">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {mensagem}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={enviando} disabled={!nova || !confirma}>
        {textoBotao}
      </Button>
    </form>
  );
}
