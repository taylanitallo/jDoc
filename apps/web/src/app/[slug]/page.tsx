import { redirect } from 'next/navigation';

/** `/orgao` sozinho (sem sub-rota) — manda pro login do tenant. */
export default async function TenantRoot({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/${slug}/login`);
}
