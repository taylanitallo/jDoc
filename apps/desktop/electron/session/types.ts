import { tenantAccessClaimsSchema, type TenantAccessClaims, type TenantRole } from '@jdoc/shared';

/**
 * Visao de sessao entregue ao renderer. NUNCA contem token (access ou refresh).
 * Derivada das claims do JWT de acesso + e-mail informado no login.
 */
export interface SessionUser {
  id: string;
  /** null quando a sessao e restaurada do keychain no boot (e-mail nao persistido nas claims). */
  email: string | null;
  role: TenantRole;
  permissions: string[];
  mustChangePassword: boolean;
}

export interface SessionTenant {
  id: string;
  slug: string;
}

export interface SessionView {
  user: SessionUser;
  tenant: SessionTenant;
}

/**
 * Decodifica (sem verificar assinatura — isso e papel do backend) o payload
 * do JWT de acesso e valida a forma com o schema canonico do @jdoc/shared.
 * A confianca vem do canal HTTPS + do proprio backend; aqui e so leitura
 * para montar a visao de sessao do renderer.
 */
export function decodeAccessClaims(token: string): TenantAccessClaims {
  const segments = token.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || !payload) {
    throw new Error('Token de acesso malformado');
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Token de acesso ilegivel');
  }
  return tenantAccessClaimsSchema.parse(json);
}

/** Monta a visao de sessao a partir das claims + e-mail (opcional no restore). */
export function toSessionView(claims: TenantAccessClaims, email: string | null, mustChangePassword: boolean): SessionView {
  return {
    user: {
      id: claims.sub,
      email,
      role: claims.role,
      permissions: claims.permissions,
      mustChangePassword,
    },
    tenant: { id: claims.tenantId, slug: claims.tenantSlug },
  };
}
