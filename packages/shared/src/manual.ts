/**
 * Central de ajuda: o manual do sistema, por tela. O mesmo conteudo aparece
 * em /<orgao>/ajuda e no PDF "Manual do usuario" (TR: manual e capacitacao).
 */

export interface TopicoManual {
  id: string;
  area: 'Primeiros passos' | 'Acervo e documentos' | 'Gestão arquivística' | 'Digitalização' | 'Segurança e LGPD' | 'Administração';
  titulo: string;
  resumo: string;
  passos: string[];
  dicas?: string[];
  /** Rota da tela (sem o slug), para o botao "Abrir tela". */
  tela?: string;
}

export const MANUAL: TopicoManual[] = [
  {
    id: 'acesso',
    area: 'Primeiros passos',
    titulo: 'Entrar no sistema e proteger a conta',
    resumo: 'Login com e-mail e senha, verificação em 2 etapas e recuperação de senha.',
    tela: '/conta',
    passos: [
      'Abra o endereço do órgão e informe e-mail e senha.',
      'No primeiro acesso, troque a senha provisória em Minha conta.',
      'Em Minha conta, ative a verificação em 2 etapas: escaneie o QR code no Google Authenticator ou Microsoft Authenticator e confirme o código.',
      'Esqueceu a senha? Use "Esqueci minha senha" na tela de entrada e informe o CPF ou o e-mail.',
    ],
    dicas: ['Administradores podem ser obrigados a usar 2 etapas (Configurações > Usuários).', 'Nunca compartilhe a senha: cada acesso fica na trilha de auditoria com o seu nome.'],
  },
  {
    id: 'navegacao',
    area: 'Primeiros passos',
    titulo: 'Navegar pelos módulos',
    resumo: 'Menu lateral, troca entre Financeiro e Arquivo Municipal e o assistente.',
    passos: [
      'O menu à esquerda mostra só as telas que o seu perfil pode usar.',
      'Com os dois módulos contratados, escolha Financeiro/Contábil ou Arquivo Municipal no início.',
      'O assistente (canto inferior direito) responde perguntas sobre os documentos, quando o órgão permite o uso de IA.',
    ],
  },
  {
    id: 'cadastrar',
    area: 'Acervo e documentos',
    titulo: 'Cadastrar um documento',
    resumo: 'Inclusão do PDF com tipo documental, metadados e catalogação.',
    tela: '/acervo',
    passos: [
      'No Acervo, clique em Incluir e escolha o tipo documental.',
      'Preencha os campos do tipo (número, data de publicação etc.) e a data do documento.',
      'Em Catalogação, informe assunto, interessado, palavras-chave e se há dados pessoais.',
      'Confira a classificação e o nível de acesso sugeridos e anexe o PDF.',
      'Ao salvar, o sistema calcula o hash SHA-256, conta as páginas e indexa o texto para a busca.',
    ],
    dicas: ['Documento com dados pessoais sensíveis deve ficar com acesso restrito.', 'Para muitos PDFs de uma vez, use o envio em lote com planilha.'],
  },
  {
    id: 'lote',
    area: 'Acervo e documentos',
    titulo: 'Enviar documentos em lote',
    resumo: 'Vários PDFs com os dados vindos de uma planilha CSV.',
    tela: '/acervo/lote',
    passos: [
      'Em Acervo > Envio em lote, escolha o tipo documental e baixe a planilha-modelo.',
      'Preencha uma linha por PDF: arquivo, descrição, data e os campos do tipo; as colunas assunto, interessado, palavras_chave e dados_pessoais também são lidas.',
      'Selecione os PDFs e a planilha: o sistema casa cada linha com o arquivo pelo nome e aponta o que falta.',
      'Revise os itens marcados e envie.',
    ],
  },
  {
    id: 'busca',
    area: 'Acervo e documentos',
    titulo: 'Pesquisar documentos',
    resumo: 'Filtros por metadados e busca dentro do texto dos PDFs.',
    tela: '/busca',
    passos: [
      'Na lista de cada módulo, use a caixa de busca e o botão Filtros (número, assunto, interessado, palavra-chave, nível de acesso, dados pessoais, datas).',
      'Em Busca no conteúdo, procure palavras dentro dos PDFs, inclusive escaneados. Use aspas para frase exata e o sinal de menos para excluir uma palavra.',
      'Abra Busca avançada para combinar o texto com secretaria, assunto, interessado e período.',
    ],
    dicas: ['Cada pesquisa fica registrada na trilha de auditoria.'],
  },
  {
    id: 'acesso-niveis',
    area: 'Segurança e LGPD',
    titulo: 'Níveis de acesso: público, restrito e sigiloso',
    resumo: 'Quem vê o quê, e como classificar pela LAI.',
    tela: '/sigilo',
    passos: [
      'Público: qualquer usuário com acesso ao módulo vê o documento.',
      'Restrito: só quem tem a permissão "Acervo restrito" (dados pessoais, RH, saúde).',
      'Sigiloso: documento classificado pela LAI (termo de classificação em Sigilo); só quem tem "Acervo sigiloso" vê, e todo acesso fica na auditoria.',
      'Usuários lotados em secretarias veem apenas os documentos delas e os documentos sem secretaria.',
    ],
  },
  {
    id: 'classificacao',
    area: 'Gestão arquivística',
    titulo: 'Classificação e temporalidade',
    resumo: 'Plano de classificação, prazos de guarda e destinação.',
    tela: '/temporalidade',
    passos: [
      'Em Configurações > Plano de Classificação, cadastre ou importe as classes com prazos e destinação.',
      'Cada documento classificado recebe as datas previstas de transferência e de destinação.',
      'Em Temporalidade, acompanhe o que venceu e monte a listagem de eliminação: aprovação, edital de ciência e termo de eliminação.',
    ],
  },
  {
    id: 'fisico',
    area: 'Gestão arquivística',
    titulo: 'Arquivo físico e empréstimos',
    resumo: 'Prédios, salas, estantes e caixas; empréstimo e devolução de originais.',
    tela: '/arquivo-fisico',
    passos: [
      'Cadastre a estrutura física (prédio > sala > estante > caixa) e imprima as etiquetas.',
      'Vincule os documentos à caixa onde está o original em papel.',
      'Registre empréstimos com prazo e imprima o termo; a devolução fecha o empréstimo.',
    ],
  },
  {
    id: 'atendimento',
    area: 'Segurança e LGPD',
    titulo: 'Atendimento LAI e pedidos do titular (LGPD)',
    resumo: 'Registrar pedidos, prazos e respostas.',
    tela: '/atendimento',
    passos: [
      'Em Atendimento, clique em Novo atendimento e escolha o tipo: LAI ou Titular de dados (LGPD).',
      'LAI: prazo de 20 dias, prorrogável por mais 10 com justificativa.',
      'LGPD: informe o direito exercido (acesso, correção, eliminação...); prazo de 15 dias, sem prorrogação.',
      'Conclua com a resposta ou o indeferimento fundamentado e imprima o comprovante.',
    ],
  },
  {
    id: 'digit-lote',
    area: 'Digitalização',
    titulo: 'Receber um lote para digitalizar',
    resumo: 'Recebimento, inventário e cadeia de custódia.',
    tela: '/digitalizacao',
    passos: [
      'Em Digitalização > Lotes, clique em Receber lote, informe secretaria, caixas e tratamento especial (sigiloso, frágil, grande formato, contaminado).',
      'No lote, inclua cada caixa, pasta ou livro no inventário com o estado de conservação.',
      'Imprima o termo de recebimento e colha as assinaturas.',
      'Avance as etapas (preparação, digitalização, indexação): cada mudança registra quem, quando e de onde.',
    ],
  },
  {
    id: 'digit-qc',
    area: 'Digitalização',
    titulo: 'Controle de qualidade e aceite do fiscal',
    resumo: 'Amostragem, não conformidades e aceite formal.',
    tela: '/digitalizacao',
    passos: [
      'Vincule ao lote os documentos digitalizados e leve-o para Controle de qualidade.',
      'Confira a amostra sugerida, marque o checklist e registre as não conformidades encontradas.',
      'Corrija cada não conformidade (ou volte o lote para digitalização) e avalie de novo.',
      'Com a avaliação aprovada, o fiscal do contrato dá o aceite: as páginas do lote entram na medição do mês.',
      'Na devolução, confira cada item do inventário e imprima o termo de devolução.',
    ],
  },
  {
    id: 'auditoria',
    area: 'Segurança e LGPD',
    titulo: 'Trilha de auditoria',
    resumo: 'Quem fez o quê, quando e de onde; prova de que nada foi alterado.',
    tela: '/auditoria',
    passos: [
      'Em Auditoria, filtre por usuário, ação e período e abra o detalhe de cada registro.',
      'Exporte em CSV quando precisar anexar a um processo.',
      'Use Verificar integridade: o sistema recalcula a cadeia de hashes e aponta qualquer registro alterado ou apagado.',
    ],
  },
  {
    id: 'privacidade',
    area: 'Segurança e LGPD',
    titulo: 'Privacidade e uso de IA',
    resumo: 'Encarregado (DPO), página pública e desligamento da IA.',
    tela: '/configuracoes',
    passos: [
      'Em Configurações > Privacidade (LGPD), informe o encarregado pelo tratamento de dados.',
      'A página pública de privacidade mostra controlador, operador, onde os dados ficam e os direitos do titular.',
      'Marque "Não usar inteligência artificial" para que nenhum documento seja enviado a provedores de IA.',
      'Baixe o dicionário de metadados (PDF ou CSV) no mesmo lugar.',
    ],
  },
  {
    id: 'continuidade',
    area: 'Administração',
    titulo: 'Backups, continuidade e exportação',
    resumo: 'RPO/RTO, testes de restauração, disponibilidade e plano de saída.',
    tela: '/continuidade',
    passos: [
      'Em Continuidade, acompanhe o último backup, a cópia segregada e os testes de restauração.',
      'Gere o relatório mensal para anexar à medição.',
      'O administrador pode gerar a exportação integral: todos os PDFs e metadados em formatos abertos, em pacotes ZIP com hashes.',
    ],
  },
  {
    id: 'usuarios',
    area: 'Administração',
    titulo: 'Usuários, perfis e lotação',
    resumo: 'Criar usuários, definir permissões e restringir por secretaria.',
    tela: '/configuracoes',
    passos: [
      'Em Configurações > Usuários, clique em Novo usuário e escolha o perfil (ou permissões personalizadas).',
      'Em Lotação, marque as secretarias que o usuário enxerga (nenhuma = todas).',
      'Use a chave de 2 etapas para desligar o autenticador de quem perdeu o celular.',
    ],
  },
  {
    id: 'suporte',
    area: 'Administração',
    titulo: 'Suporte e chamados',
    resumo: 'Abrir chamado, acompanhar prazo e avaliar o atendimento.',
    tela: '/suporte',
    passos: [
      'Em Suporte, abra um chamado com a criticidade e a descrição do problema.',
      'Acompanhe as respostas e o prazo de atendimento (SLA) no próprio chamado.',
      'Ao final, avalie o atendimento.',
    ],
  },
];

/** Busca simples no manual (sem acento, sem maiuscula). */
export function buscarNoManual(termo: string, topicos: readonly TopicoManual[] = MANUAL): TopicoManual[] {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = n(termo.trim());
  if (!t) return [...topicos];
  return topicos.filter((x) => n([x.titulo, x.resumo, x.area, ...x.passos, ...(x.dicas ?? [])].join(' ')).includes(t));
}
