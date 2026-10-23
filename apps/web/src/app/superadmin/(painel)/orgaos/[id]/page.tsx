import { redirect } from 'next/navigation';

/** O detalhe abre na aba Geral. */
export default async function OrgaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/superadmin/orgaos/${id}/geral`);
}
