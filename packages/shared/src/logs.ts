import { ACAO_LABEL, PERMISSAO_LABEL } from './catalogo.js';
import type { ModuleAction, ModuleName } from './constants.js';
import { TENANT_STATUS_LABEL, type TenantStatus } from './tenant.js';
import { PAPEL_ADMIN_LABEL, type PapelAdmin } from './plataforma.js';
import { AMBIENTE_LABEL, type Ambiente } from './superadmin.js';
import { SISTEMA_LABEL, type Sistema } from './sistemas.js';
import { DEFINICOES_INTEGRACAO, type IntegracaoKey } from './integracoes.js';

/**
 * Logs em portugues claro. Nunca mostrar `campo=true`, chaves tecnicas ou
 * JSON cru: acoes, campos e valores passam por estes dicionarios.
 */
export interface LogRegistro {
  id: string;
  criadoEm: string;
  action: string;
  actorType: string;
  adminName: string | null;
  orgao: string | null;
  entity: string | null;
  entityId: string | null;
  changes: { antes?: unknown; depois?: unknown } | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
}

export interface LinhaMudanca {
  campo: string;
  antes: string;
  depois: string;
}

const CAMPOS: Record<string, string> = {
  nome: 'nome',
  email: 'e-mail',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  cidade: 'cidade',
  uf: 'UF',
  responsavel: 'responsável',
  modulos: 'módulos contratados',
  ambiente: 'ambiente',
  contrato: 'contrato',
  menuOverrides: 'telas desligadas',
  corMarca: 'cor da marca',
  brasaoUrl: 'brasão',
  status: 'situação',
  motivo: 'motivo',
  papel: 'papel',
  perfil: 'perfil',
  permissoes: 'permissões',
  descricao: 'descrição',
  ativo: 'ativo',
  ligado: 'ligado',
  usarPadrao: 'usar a configuração padrão',
  segredos: 'chaves configuradas',
  host: 'servidor',
  porta: 'porta',
  seguranca: 'segurança',
  usuario: 'usuário',
  remetenteEmail: 'e-mail do remetente',
  remetenteNome: 'nome do remetente',
  modelo: 'modelo',
  provedor: 'provedor',
  phoneNumberId: 'identificador do número',
  quotaDiscoMb: 'quota de disco',
  slug: 'identificador',
  numero: 'número',
  vigenciaInicio: 'início da vigência',
  vigenciaFim: 'fim da vigência',
  valor: 'valor',
  preposto: 'preposto',
  fiscal: 'fiscal',
  criticidade: 'criticidade',
  responsavelChamado: 'responsável',
  titulo: 'título',
};

function nomeCampo(k: string): string {
  return CAMPOS[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
}

const fmtData = (v: string) => {
  const [a, m, d] = v.split('-');
  return `${d}/${m}/${a}`;
};

/** Valor legivel: booleanos, status, papeis, listas, datas, objetos. */
export function valorLegivel(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'vazio';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (campo === 'status' && typeof v === 'string' && v in TENANT_STATUS_LABEL) return TENANT_STATUS_LABEL[v as TenantStatus];
  if (campo === 'papel' && typeof v === 'string') {
    if (v in PAPEL_ADMIN_LABEL) return PAPEL_ADMIN_LABEL[v as PapelAdmin];
    return ({ admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' } as Record<string, string>)[v] ?? v;
  }
  if (campo === 'ambiente' && typeof v === 'string' && v in AMBIENTE_LABEL) return AMBIENTE_LABEL[v as Ambiente];
  if (campo === 'modulos' && Array.isArray(v)) return v.map((s) => SISTEMA_LABEL[s as Sistema] ?? String(s)).join(', ') || 'nenhum';
  if (campo === 'quotaDiscoMb' && typeof v === 'number') return `${(v / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  if (campo === 'permissoes' && Array.isArray(v)) return `${v.length} permissões`;
  if (campo === 'segredos' && Array.isArray(v)) return v.length ? `${v.length} configurada(s)` : 'nenhuma';
  if (campo === 'menuOverrides' && typeof v === 'object') {
    const off = Object.entries(v as Record<string, boolean>).filter(([, x]) => x === false).map(([k]) => k.replace(/-/g, ' '));
    return off.length ? off.join(', ') : 'nenhuma';
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtData(v);
  if (Array.isArray(v)) return v.map((x) => valorLegivel(campo, x)).join(', ');
  if (typeof v === 'object') {
    const partes = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined && x !== '')
      .map(([k, x]) => `${nomeCampo(k)}: ${valorLegivel(k, x)}`);
    return partes.length ? partes.join('; ') : 'vazio';
  }
  return String(v);
}

function rotuloPermissao(chave: string): string {
  const [m, a] = chave.split(':') as [ModuleName, ModuleAction];
  return `${ACAO_LABEL[a] ?? a} em ${PERMISSAO_LABEL[m]?.label ?? m}`;
}

/** Linhas antes/depois so do que mudou. */
export function mudancasDoLog(log: Pick<LogRegistro, 'changes'>): LinhaMudanca[] {
  const antes = (log.changes?.antes ?? {}) as Record<string, unknown>;
  const depois = (log.changes?.depois ?? {}) as Record<string, unknown>;
  if (typeof antes !== 'object' || typeof depois !== 'object') return [];
  const chaves = [...new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})])];
  return chaves
    .filter((k) => JSON.stringify(antes?.[k] ?? null) !== JSON.stringify(depois?.[k] ?? null))
    .map((k) => ({ campo: nomeCampo(k), antes: valorLegivel(k, antes?.[k]), depois: valorLegivel(k, depois?.[k]) }));
}

/** "incluiu a permissão Excluir em Despesas; retirou ..." */
function diffPermissoes(log: LogRegistro): string | null {
  const a = ((log.changes?.antes as { permissoes?: string[] } | undefined)?.permissoes ?? null) as string[] | null;
  const d = ((log.changes?.depois as { permissoes?: string[] } | undefined)?.permissoes ?? null) as string[] | null;
  if (!a || !d) return null;
  const inc = d.filter((p) => !a.includes(p));
  const ret = a.filter((p) => !d.includes(p));
  const partes: string[] = [];
  const lista = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).map(rotuloPermissao).join(', ')} e mais ${xs.length - 3}` : xs.map(rotuloPermissao).join(', '));
  if (inc.length) partes.push(`incluiu ${inc.length === 1 ? 'a permissão' : 'as permissões'} ${lista(inc)}`);
  if (ret.length) partes.push(`retirou ${ret.length === 1 ? 'a permissão' : 'as permissões'} ${lista(ret)}`);
  return partes.length ? partes.join('; ') : null;
}

function resumoMudancas(log: LogRegistro): string {
  const m = mudancasDoLog(log).filter((x) => x.campo !== 'permissões');
  if (!m.length) return '';
  return m
    .slice(0, 3)
    .map((x) => `${x.campo} de ${x.antes} para ${x.depois}`)
    .join('; ')
    .concat(m.length > 3 ? ` e mais ${m.length - 3} alteração(ões)` : '');
}

const nomeDe = (log: LogRegistro, campo: 'antes' | 'depois' = 'depois'): string | null => {
  const o = log.changes?.[campo] as { nome?: string } | undefined;
  return o?.nome ?? null;
};
const meta = (log: LogRegistro, k: string): string | null => {
  const v = log.metadata?.[k];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};
const integ = (k: string | null) => (k && k in DEFINICOES_INTEGRACAO ? DEFINICOES_INTEGRACAO[k as IntegracaoKey].nome : 'integração');

type Frase = (log: LogRegistro, quem: string, orgao: string) => string;

const ACOES: Record<string, Frase> = {
  superadmin_login: (_, q) => `${q} entrou no painel`,
  superadmin_login_failed: (l) => `Tentativa de entrada no painel recusada${meta(l, 'email') ? ` para ${meta(l, 'email')}` : ''}`,
  superadmin_logout: (_, q) => `${q} saiu do painel`,
  superadmin_reauth: (_, q) => `${q} confirmou a identidade para uma ação crítica`,
  superadmin_2fa_enabled: (_, q) => `${q} ativou a verificação em 2 etapas`,
  superadmin_2fa_disabled: (_, q) => `${q} desligou a verificação em 2 etapas`,
  superadmin_senha_alterada: (_, q) => `${q} trocou a própria senha`,
  superadmin_refresh_reuse_or_invalid: () => 'Sessão do painel recusada por uso indevido do token de renovação',
  admin_convidado: (l, q) => `${q} convidou ${nomeDe(l) ?? 'uma pessoa'} para a equipe`,
  admin_atualizado: (l, q) => `${q} alterou ${nomeDe(l, 'antes') ?? 'um membro da equipe'}: ${resumoMudancas(l) || 'sem mudanças'}`,
  admin_senha_redefinida: (_, q) => `${q} redefiniu a senha de um membro da equipe`,
  admin_mfa_resetado: (_, q) => `${q} resetou a verificação em 2 etapas de um membro da equipe`,
  admin_sessoes_encerradas: (_, q) => `${q} encerrou as sessões de um membro da equipe`,
  tenant_created: (l, q) => `${q} criou o órgão ${nomeDe(l) ?? ''}`.trim(),
  tenant_updated: (l, q, o) => `${q} alterou o órgão ${o}: ${resumoMudancas(l) || 'cadastro'}`,
  tenant_activated: (_, q, o) => `${q} reativou o órgão ${o}`,
  tenant_deactivated: (l, q, o) => {
    const novo = (l.changes?.depois as { status?: string; motivo?: string } | undefined) ?? {};
    const acao = novo.status === 'arquivado' ? 'arquivou' : novo.status === 'manutencao' ? 'colocou em manutenção' : 'suspendeu';
    return `${q} ${acao} o órgão ${o}${novo.motivo ? ` (motivo: ${novo.motivo})` : ''}`;
  },
  tenant_deleted: (l, q) => `${q} excluiu definitivamente o órgão ${meta(l, 'nome') ?? ''}`.trim(),
  tenant_quota_changed: (_, q, o) => `${q} alterou a quota de disco de ${o}`,
  tenant_brasao_updated: (_, q, o) => `${q} trocou o brasão de ${o}`,
  tenant_brasao_removed: (_, q, o) => `${q} removeu o brasão de ${o}`,
  tenant_user_created: (l, q, o) => `${q} criou o usuário ${nomeDe(l) ?? ''} em ${o}`,
  tenant_user_updated: (l, q, o) => `${q} alterou o usuário ${nomeDe(l, 'antes') ?? ''} de ${o}: ${resumoMudancas(l) || 'sem mudanças'}`,
  tenant_user_password_reset: (_, q, o) => `${q} redefiniu a senha de um usuário de ${o}`,
  tenant_user_unlocked: (_, q, o) => `${q} desbloqueou um usuário de ${o}`,
  tenant_user_sessions_revoked: (_, q, o) => `${q} encerrou as sessões de um usuário de ${o}`,
  tenant_user_activated: (_, q, o) => `${q} reativou um usuário de ${o}`,
  tenant_user_deactivated: (_, q, o) => `${q} desativou um usuário de ${o}`,
  tenant_user_deleted: (l, q, o) => `${q} excluiu o usuário ${nomeDe(l, 'antes') ?? ''} de ${o}`,
  perfil_criado: (l, q, o) => `${q} criou o perfil ${nomeDe(l) ?? ''} em ${o}`,
  perfil_atualizado: (l, q, o) =>
    `${q} alterou o perfil ${nomeDe(l, 'antes') ?? ''} de ${o}: ${[diffPermissoes(l), resumoMudancas(l)].filter(Boolean).join('; ') || 'sem mudanças'}`,
  perfil_excluido: (l, q, o) => `${q} excluiu o perfil ${nomeDe(l, 'antes') ?? ''} de ${o}`,
  perfil_restaurado: (l, q, o) => `${q} restaurou o padrão do perfil ${nomeDe(l) ?? ''} em ${o}`,
  modelo_perfil_atualizado: (l, q) => `${q} alterou o perfil padrão ${nomeDe(l) ?? ''}: ${diffPermissoes(l) ?? resumoMudancas(l)}`,
  modelo_perfil_restaurado: (_, q) => `${q} voltou um perfil padrão ao padrão de fábrica`,
  modelo_perfil_aplicado: (l, q) => `${q} aplicou um perfil padrão a ${meta(l, 'orgaosAlterados') ?? 'todos os'} órgão(s)`,
  integracao_atualizada: (l, q, o) => `${q} alterou ${integ(l.entityId)} de ${o}: ${resumoMudancas(l) || 'configuração'}`,
  configuracao_atualizada: (l, q) => `${q} alterou a configuração padrão de ${integ(l.entityId)}: ${resumoMudancas(l) || 'configuração'}`,
  impersonacao_iniciada: (l, q, o) => `${q} entrou como um usuário de ${o}${meta(l, 'motivo') ? ` (motivo: ${meta(l, 'motivo')})` : ''}`,
  cross_tenant_attempt: (_, __, o) => `Acesso bloqueado: token de outro órgão tentou entrar em ${o}`,
  backup_created: (_, q, o) => `${q} pediu um backup de ${o}`,
  backup_downloaded: (_, q, o) => `${q} baixou um backup de ${o}`,
  backup_deleted: (_, q, o) => `${q} excluiu um backup de ${o}`,
  backup_history_cleared: (_, q, o) => `${q} limpou o histórico de backups de ${o}`,
  backup_settings_updated: (l, q, o) => `${q} alterou o agendamento de backup de ${o}: ${resumoMudancas(l) || 'configuração'}`,
  backup_restore_started: (_, q, o) => `${q} iniciou a restauração de ${o}`,
  correcoes_executadas: (l, q) => `${q} executou as correções automáticas (${meta(l, 'aplicadas') ?? 0} aplicada(s))`,
  job_executado: (l, q) => `${q} executou o job ${meta(l, 'nome') ?? ''}`.trim(),
  chamado_atualizado: (l, q) => `${q} atualizou o chamado nº ${meta(l, 'numero') ?? ''}: ${resumoMudancas(l) || 'andamento'}`,
  chamado_respondido: (l, q) => `${q} respondeu o chamado nº ${meta(l, 'numero') ?? ''}`,
  release_publicada: (l, q) => `${q} publicou a versão ${meta(l, 'versao') ?? ''}`,
  // Logs do orgao (audit_logs do schema)
  login: (_, q) => `${q} entrou no sistema`,
  login_failed: (l) => `Tentativa de entrada recusada${meta(l, 'email') ? ` para ${meta(l, 'email')}` : ''}`,
  logout: (_, q) => `${q} saiu do sistema`,
  logout_all: (_, q) => `${q} encerrou todas as próprias sessões`,
  senha_alterada: (_, q) => `${q} trocou a própria senha`,
  conta_atualizada: (_, q) => `${q} atualizou os próprios dados`,
  senha_recuperacao_solicitada: (_, q) => `${q} pediu a recuperação de senha`,
  senha_recuperacao_sem_conta: () => 'Pedido de recuperação de senha para dados que não correspondem a nenhuma conta',
  senha_redefinida_por_recuperacao: (_, q) => `${q} criou uma nova senha pela recuperação`,
  mfa_ativado: (_, q) => `${q} ativou a verificação em 2 etapas`,
  mfa_desligado: (_, q) => `${q} desligou a verificação em 2 etapas`,
  usuario_mfa_resetado: (_, q) => `${q} desligou a verificação em 2 etapas de um usuário`,
  seguranca_atualizada: (l, q) =>
    `${q} ${l.metadata?.depois === true ? 'passou a exigir' : 'deixou de exigir'} verificação em 2 etapas dos administradores`,
  // Documentos
  document_created: (_, q) => `${q} cadastrou um documento`,
  document_updated: (_, q) => `${q} alterou um documento`,
  document_viewed: (_, q) => `${q} abriu um documento`,
  document_deleted: (l, q) => (l.metadata?.bulk ? `${q} enviou ${meta(l, 'count') ?? 'vários'} documento(s) para a lixeira` : `${q} enviou um documento para a lixeira`),
  document_restored: (_, q) => `${q} restaurou um documento da lixeira`,
  document_download_url: (_, q) => `${q} baixou o arquivo de um documento`,
  document_file_attached: (_, q) => `${q} anexou o arquivo de um documento`,
  document_file_replaced: (_, q) => `${q} substituiu o arquivo de um documento`,
  document_file_removed: (_, q) => `${q} removeu o arquivo de um documento`,
  document_extra_file_attached: (_, q) => `${q} anexou um arquivo extra a um documento`,
  document_extra_file_removed: (_, q) => `${q} removeu um arquivo extra de um documento`,
  document_extra_file_download_url: (_, q) => `${q} baixou um arquivo extra de um documento`,
  documentos_baixados_zip: (l, q) => `${q} baixou ${meta(l, 'count') ?? 'vários'} documento(s) em ZIP`,
  trash_emptied: (_, q) => `${q} esvaziou a lixeira`,
  busca_realizada: (l, q) => `${q} pesquisou "${meta(l, 'termo') ?? ''}" (${meta(l, 'resultados') ?? 0} resultado(s))`,
  conteudo_reindexado: (l, q) => `${q} pediu a indexação do conteúdo de ${meta(l, 'enfileirados') ?? 0} arquivo(s)`,
  copia_autenticada_emitida: (_, q) => `${q} emitiu uma cópia autenticada`,
  labels_import_queued: (_, q) => `${q} importou um arquivo de etiquetas`,
  report_created: (_, q) => `${q} gerou um relatório`,
  report_downloaded: (_, q) => `${q} baixou um relatório`,
  report_deleted: (_, q) => `${q} excluiu um relatório`,
  report_history_cleared: (_, q) => `${q} limpou o histórico de relatórios`,
  relatorio_inventario_exportado: (_, q) => `${q} exportou o inventário do acervo`,
  relatorio_quantitativo_exportado: (_, q) => `${q} exportou o quantitativo do acervo`,
  relatorio_topografico_exportado: (_, q) => `${q} exportou o inventário topográfico`,
  auditoria_exportada: (l, q) => `${q} exportou a trilha de auditoria (${meta(l, 'registros') ?? 0} registro(s))`,
  auditoria_verificada: (l, q) =>
    `${q} verificou a integridade da trilha de auditoria: ${l.metadata?.integra === false ? 'adulteração encontrada' : 'íntegra'}`,
  // Cadastros
  usuario_created: (l, q) => `${q} criou o usuário ${meta(l, 'email') ?? ''}`.trim(),
  usuario_updated: (_, q) => `${q} alterou um usuário`,
  usuario_deleted: (_, q) => `${q} excluiu um usuário`,
  usuario_activated: (_, q) => `${q} reativou um usuário`,
  usuario_deactivated: (_, q) => `${q} desativou um usuário`,
  usuario_senha_reset: (_, q) => `${q} redefiniu a senha de um usuário`,
  orgao_created: (_, q) => `${q} cadastrou uma secretaria`,
  orgao_updated: (_, q) => `${q} alterou uma secretaria`,
  orgao_deleted: (_, q) => `${q} excluiu uma secretaria`,
  unidade_created: (_, q) => `${q} cadastrou uma unidade orçamentária`,
  unidade_updated: (_, q) => `${q} alterou uma unidade orçamentária`,
  unidade_deleted: (_, q) => `${q} excluiu uma unidade orçamentária`,
  tipo_documento_created: (_, q) => `${q} cadastrou um tipo de documento`,
  tipo_documento_updated: (_, q) => `${q} alterou um tipo de documento`,
  tipo_documento_deleted: (_, q) => `${q} excluiu um tipo de documento`,
  layout_updated: (_, q) => `${q} alterou a aparência do órgão`,
  brasao_updated: (_, q) => `${q} trocou o brasão do órgão`,
  brasao_removed: (_, q) => `${q} removeu o brasão do órgão`,
  // Arquivo
  classificacao_created: (_, q) => `${q} criou uma classe no plano de classificação`,
  classificacao_updated: (_, q) => `${q} alterou uma classe do plano de classificação`,
  classificacao_deleted: (_, q) => `${q} excluiu uma classe do plano de classificação`,
  classificacao_inativada: (_, q) => `${q} inativou uma classe do plano de classificação`,
  local_fisico_created: (_, q) => `${q} cadastrou um local do arquivo físico`,
  local_fisico_updated: (_, q) => `${q} alterou um local do arquivo físico`,
  emprestimo_registrado: (_, q) => `${q} registrou um empréstimo de documento`,
  emprestimo_devolvido: (_, q) => `${q} registrou a devolução de um documento emprestado`,
  documentos_transferidos: (_, q) => `${q} transferiu documentos para o arquivo intermediário`,
  documentos_recolhidos: (_, q) => `${q} recolheu documentos ao arquivo permanente`,
  eliminacao_criada: (_, q) => `${q} abriu uma listagem de eliminação`,
  eliminacao_aprovada: (_, q) => `${q} aprovou uma listagem de eliminação`,
  eliminacao_edital_publicado: (_, q) => `${q} publicou o edital de ciência de eliminação`,
  eliminacao_concluida: (_, q) => `${q} concluiu uma eliminação de documentos`,
  eliminacao_cancelada: (_, q) => `${q} cancelou uma listagem de eliminação`,
  integridade_verificacao_iniciada: (_, q) => `${q} iniciou a verificação de integridade dos arquivos`,
  integridade_ocorrencia_resolvida: (_, q) => `${q} resolveu uma ocorrência de integridade`,
  atendimento_registrado: (_, q) => `${q} registrou um pedido de acesso`,
  atendimento_prorrogado: (_, q) => `${q} prorrogou um pedido de acesso`,
  sigilo_classificado: (_, q) => `${q} classificou um documento como sigiloso`,
  sigilo_desclassificado: (_, q) => `${q} desclassificou um documento sigiloso`,
  dossie_aberto: (_, q) => `${q} abriu um dossiê ou processo`,
  dossie_juntada: (_, q) => `${q} juntou documentos a um dossiê`,
  dossie_encerrado: (_, q) => `${q} encerrou um dossiê`,
  norma_estruturada: (_, q) => `${q} cadastrou o texto de uma norma`,
  norma_alteracao_registrada: (_, q) => `${q} registrou uma alteração de norma`,
  privacidade_atualizada: (_, q) => `${q} alterou as configurações de privacidade (LGPD)`,
  dicionario_metadados_exportado: (_, q) => `${q} exportou o dicionário de metadados`,
  digit_plano_criado: (l, q) => `${q} criou o plano de trabalho ${meta(l, 'titulo') ?? ''}`.trim(),
  digit_plano_alterado: (_, q) => `${q} alterou um plano de trabalho de digitalização`,
  digit_plano_aprovado: (_, q) => `${q} aprovou um plano de trabalho como fiscal do contrato`,
  digit_lote_recebido: (l, q) => `${q} recebeu um lote para digitalização: ${meta(l, 'descricao') ?? ''}`.trim(),
  digit_lote_alterado: (_, q) => `${q} alterou os dados de um lote de digitalização`,
  digit_lote_etapa: (l, q) => `${q} moveu um lote de digitalização de ${meta(l, 'de') ?? '—'} para ${meta(l, 'para') ?? '—'}`,
  digit_item_inventariado: (l, q) => `${q} inventariou ${meta(l, 'identificacao') ?? 'um item'} em um lote`,
  digit_item_alterado: (_, q) => `${q} alterou um item do inventário do lote`,
  digit_item_removido: (_, q) => `${q} removeu um item do inventário do lote`,
  digit_documentos_vinculados: (l, q) => `${q} vinculou ${meta(l, 'count') ?? 0} documento(s) a um lote de digitalização`,
  digit_documento_desvinculado: (_, q) => `${q} retirou um documento de um lote de digitalização`,
  digit_qc_registrado: (l, q) =>
    `${q} registrou o controle de qualidade de um lote: ${l.metadata?.aprovado ? 'aprovado' : `reprovado (${meta(l, 'naoConformidades') ?? 0} não conformidade(s))`}`,
  digit_nc_corrigida: (_, q) => `${q} corrigiu uma não conformidade da digitalização`,
  digit_lote_aceito: (l, q) => `${q} deu o aceite de fiscal em um lote com ${meta(l, 'paginas') ?? 0} página(s)`,
  digit_termo_emitido: (l, q) => `${q} emitiu o termo de ${meta(l, 'tipo') ?? ''} de um lote`.trim(),
  digit_producao_exportada: (_, q) => `${q} exportou o relatório de produção da digitalização`,
};

/** Frase do log, em portugues, sem chaves tecnicas. */
export function descreverLog(log: LogRegistro): string {
  const quem = log.adminName ?? (log.actorType === 'system' ? 'O sistema' : log.actorType === 'security' ? 'Segurança' : 'Alguém');
  const orgao = log.orgao ?? 'um órgão';
  const frase = ACOES[log.action];
  if (frase) return frase(log, quem, orgao).replace(/\s+/g, ' ').replace(/: $/, '').trim();
  // Acao sem frase propria: nome legivel da acao, nunca o identificador cru.
  const legivel = log.action.replace(/_/g, ' ').replace(/\b(created|updated|deleted)\b/g, (m) => ({ created: 'criado', updated: 'alterado', deleted: 'excluído' })[m] ?? m);
  return `${quem}: ${legivel}`;
}

/** Rotulos curtos para o filtro "Ação" da tela de logs. */
export const ROTULOS_ACAO: Record<string, string> = {
  superadmin_login: 'Entrada no painel',
  superadmin_login_failed: 'Entrada no painel recusada',
  superadmin_reauth: 'Confirmação de identidade',
  admin_convidado: 'Convite para a equipe',
  admin_atualizado: 'Alteração na equipe',
  tenant_created: 'Órgão criado',
  tenant_updated: 'Órgão alterado',
  tenant_activated: 'Órgão reativado',
  tenant_deactivated: 'Órgão suspenso ou arquivado',
  tenant_deleted: 'Órgão excluído',
  tenant_user_created: 'Usuário criado',
  tenant_user_updated: 'Usuário alterado',
  tenant_user_password_reset: 'Senha de usuário redefinida',
  perfil_atualizado: 'Perfil alterado',
  modelo_perfil_atualizado: 'Perfil padrão alterado',
  modelo_perfil_aplicado: 'Perfil padrão aplicado',
  integracao_atualizada: 'Integração do órgão alterada',
  configuracao_atualizada: 'Configuração da plataforma alterada',
  impersonacao_iniciada: 'Entrar como',
  cross_tenant_attempt: 'Acesso bloqueado entre órgãos',
  backup_restore_started: 'Restauração de backup',
  correcoes_executadas: 'Correções executadas',
};

/** Filtro "Ação" da Auditoria do órgão. */
export const ROTULOS_ACAO_ORGAO: Record<string, string> = {
  login: 'Entrada no sistema',
  login_failed: 'Entrada recusada',
  logout: 'Saída do sistema',
  document_viewed: 'Documento aberto',
  document_created: 'Documento cadastrado',
  document_updated: 'Documento alterado',
  document_deleted: 'Documento para a lixeira',
  document_download_url: 'Arquivo baixado',
  documentos_baixados_zip: 'Documentos baixados em ZIP',
  busca_realizada: 'Pesquisa',
  relatorio_inventario_exportado: 'Inventário exportado',
  usuario_created: 'Usuário criado',
  usuario_updated: 'Usuário alterado',
  usuario_deactivated: 'Usuário desativado',
  mfa_ativado: '2 etapas ativada',
  mfa_desligado: '2 etapas desligada',
  sigilo_classificado: 'Classificação de sigilo',
  eliminacao_concluida: 'Eliminação concluída',
  auditoria_exportada: 'Auditoria exportada',
};
