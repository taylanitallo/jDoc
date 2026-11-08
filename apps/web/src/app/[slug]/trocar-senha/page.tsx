'use client';

import { useParams } from 'next/navigation';
import type { UsuarioAtual } from '@jdoc/shared';
import { TrocaObrigatoria } from '@/components/conta/troca-obrigatoria';

const precisaMfa = (u: UsuarioAtual) => u.mfaPendente;

/** Primeiro acesso com senha provisoria: fora do (app), sem menu nem telas do sistema. */
export default function TrocarSenhaPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <TrocaObrigatoria<UsuarioAtual>
      slug={slug}
      loginPath={`/${slug}/login`}
      rotaMe={`/t/${slug}/auth/me`}
      rotaSenha={`/t/${slug}/auth/password`}
      minimo={6}
      inicio={`/${slug}/modulos`}
      contaMfa={`/${slug}/conta?trocar=1`}
      precisaMfa={precisaMfa}
    />
  );
}
