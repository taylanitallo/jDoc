'use client';

import type { AdminAtual } from '@jdoc/shared';
import { TrocaObrigatoria } from '@/components/conta/troca-obrigatoria';

const precisaMfa = (a: AdminAtual) => !a.mfaEnabled;

/** Senha provisoria da equipe: fora do (painel), sem menu nem telas do painel. */
export default function TrocarSenhaSuperadminPage() {
  return (
    <TrocaObrigatoria<AdminAtual>
      slug={null}
      loginPath="/superadmin/login"
      rotaMe="/superadmin/me"
      rotaSenha="/superadmin/auth/password"
      minimo={10}
      inicio="/superadmin"
      contaMfa="/superadmin/conta"
      precisaMfa={precisaMfa}
    />
  );
}
