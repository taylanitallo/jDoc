import { z } from 'zod';

/**
 * Integracoes (chaves de API, e-mail, mapas, WhatsApp). Cada orgao pode ter a
 * propria chave ou usar a "padrao da plataforma" (Superadmin > Configuracoes).
 * Segredos ficam cifrados no banco e nunca voltam ao front: a tela recebe so
 * "configurado" e os 4 ultimos caracteres.
 */
export const INTEGRACOES = ['email_smtp', 'ia_gemini', 'ia_anthropic', 'mapas', 'whatsapp'] as const;
export type IntegracaoKey = (typeof INTEGRACOES)[number];

export interface CampoIntegracao {
  id: string;
  label: string;
  tipo: 'texto' | 'numero' | 'opcoes' | 'email';
  opcoes?: Array<{ valor: string; label: string }>;
  obrigatorio?: boolean;
  dica?: string;
  placeholder?: string;
}

export interface DefinicaoIntegracao {
  key: IntegracaoKey;
  nome: string;
  descricao: string;
  /** Nome do icone lucide. */
  icone: string;
  campos: CampoIntegracao[];
  segredos: Array<{ id: string; label: string }>;
}

export const DEFINICOES_INTEGRACAO: Record<IntegracaoKey, DefinicaoIntegracao> = {
  email_smtp: {
    key: 'email_smtp',
    nome: 'E-mail (SMTP)',
    descricao: 'Servidor que envia convites, recuperação de senha e avisos.',
    icone: 'Mail',
    campos: [
      { id: 'host', label: 'Servidor', tipo: 'texto', obrigatorio: true, placeholder: 'smtp.exemplo.com.br' },
      { id: 'porta', label: 'Porta', tipo: 'numero', obrigatorio: true, placeholder: '587' },
      {
        id: 'seguranca',
        label: 'Segurança',
        tipo: 'opcoes',
        obrigatorio: true,
        opcoes: [
          { valor: 'starttls', label: 'STARTTLS (porta 587)' },
          { valor: 'ssl', label: 'SSL/TLS (porta 465)' },
          { valor: 'nenhuma', label: 'Sem criptografia' },
        ],
      },
      { id: 'usuario', label: 'Usuário', tipo: 'texto', placeholder: 'nao-responda@exemplo.com.br' },
      { id: 'remetenteEmail', label: 'E-mail do remetente', tipo: 'email', obrigatorio: true },
      { id: 'remetenteNome', label: 'Nome do remetente', tipo: 'texto', placeholder: 'jDoc' },
    ],
    segredos: [{ id: 'senha', label: 'Senha' }],
  },
  ia_gemini: {
    key: 'ia_gemini',
    nome: 'IA — Google Gemini',
    descricao: 'Assistente Ayla e conferência de documentos por IA.',
    icone: 'Sparkles',
    campos: [{ id: 'modelo', label: 'Modelo', tipo: 'texto', placeholder: 'gemini-2.5-flash', dica: 'Vazio usa o padrão do sistema.' }],
    segredos: [{ id: 'apiKey', label: 'Chave de API' }],
  },
  ia_anthropic: {
    key: 'ia_anthropic',
    nome: 'IA — Anthropic Claude',
    descricao: 'Conferência de documentos por IA (alternativa ao Gemini).',
    icone: 'Bot',
    campos: [{ id: 'modelo', label: 'Modelo', tipo: 'texto', dica: 'Vazio usa o padrão do sistema.' }],
    segredos: [{ id: 'apiKey', label: 'Chave de API' }],
  },
  mapas: {
    key: 'mapas',
    nome: 'Mapas',
    descricao: 'Mapas e busca de endereços.',
    icone: 'Map',
    campos: [
      {
        id: 'provedor',
        label: 'Provedor',
        tipo: 'opcoes',
        obrigatorio: true,
        opcoes: [
          { valor: 'google', label: 'Google Maps' },
          { valor: 'mapbox', label: 'Mapbox' },
        ],
      },
    ],
    segredos: [{ id: 'apiKey', label: 'Chave de API' }],
  },
  whatsapp: {
    key: 'whatsapp',
    nome: 'WhatsApp',
    descricao: 'Envio de avisos pelo WhatsApp Business (API oficial da Meta).',
    icone: 'MessageCircle',
    campos: [{ id: 'phoneNumberId', label: 'Identificador do número', tipo: 'texto', obrigatorio: true }],
    segredos: [{ id: 'token', label: 'Token de acesso' }],
  },
};

export type OrigemIntegracao = 'orgao' | 'plataforma' | 'ambiente';

export interface IntegracaoView {
  key: IntegracaoKey;
  enabled: boolean;
  /** So no orgao: true = usa a configuracao da plataforma. */
  usarPadrao: boolean;
  config: Record<string, string | number | null>;
  /** Por segredo: "••••1234" quando configurado, null quando vazio. */
  segredos: Record<string, string | null>;
  /** De onde vem a configuracao que vale de fato (null = nenhuma). */
  origemEfetiva: OrigemIntegracao | null;
  /** A plataforma tem uma configuracao padrao ligada. */
  padraoDisponivel: boolean;
  atualizadoEm: string | null;
}

export const integracaoUpdateSchema = z
  .object({
    enabled: z.boolean(),
    usarPadrao: z.boolean().optional(),
    config: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.null()])),
    /** Segredo novo; null apaga; ausente mantem o atual. */
    segredos: z.record(z.string().max(60), z.string().max(4000).nullable()).optional(),
  })
  .strict();
export type IntegracaoUpdateInput = z.infer<typeof integracaoUpdateSchema>;

export interface TesteIntegracao {
  ok: boolean;
  mensagem: string;
  ms: number;
}
