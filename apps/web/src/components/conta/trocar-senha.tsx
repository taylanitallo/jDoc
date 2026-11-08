'use client';

import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, CardHeader, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';

/** Troca da propria senha (orgao e superadmin; muda so a rota e o minimo). */
export function TrocarSenha({ rota, minimo }: { rota: string; minimo: number }) {
  const toast = useToast();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (nova.length < minimo) return setErro(`A nova senha deve ter no mínimo ${minimo} caracteres.`);
    if (nova !== confirma) return setErro('A confirmação não confere com a nova senha.');
    setSalvando(true);
    try {
      await api(rota, { method: 'POST', body: { senhaAtual: atual, novaSenha: nova } });
      setAtual('');
      setNova('');
      setConfirma('');
      toast.success('Senha alterada.');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card id="senha" className="scroll-mt-24">
      <CardHeader icon={KeyRound} title="Senha" description="Troque sua senha de acesso." />
      <form onSubmit={enviar} className="grid gap-4 p-5 sm:grid-cols-3" noValidate>
        <Field label="Senha atual" htmlFor="senha-atual" required>
          <Input id="senha-atual" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
        </Field>
        <Field label="Nova senha" htmlFor="senha-nova" required hint={`Mínimo de ${minimo} caracteres.`}>
          <Input id="senha-nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
        </Field>
        <Field label="Confirmar nova senha" htmlFor="senha-confirma" required error={erro ?? undefined}>
          <Input id="senha-confirma" type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" loading={salvando} disabled={!atual || !nova || !confirma}>
            Alterar senha
          </Button>
        </div>
      </form>
    </Card>
  );
}
