import { redirect } from 'next/navigation';

/** `/superadmin` sozinho (sem sub-rota) — manda pro login do superadmin. */
export default function SuperadminRoot() {
  redirect('/superadmin/login');
}
