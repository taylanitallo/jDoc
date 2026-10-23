import PDFKitDocument from 'pdfkit';
import {
  CHECKLIST_QC,
  CHECKLIST_QC_LABEL,
  ESTADO_CONSERVACAO_LABEL,
  ETAPA_LOTE_LABEL,
  TIPO_ITEM_LOTE_LABEL,
  type LoteDetalheView,
  type ProducaoResumo,
  type TermoLote,
} from '@jdoc/shared';
import { gerarCsv, gerarPdfTabela, type ColunaExport } from '../common/exportacao';

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' }) : '—';
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }) : '—');

const TITULO: Record<TermoLote, string> = {
  recebimento: 'TERMO DE RECEBIMENTO DE ACERVO PARA DIGITALIZAÇÃO',
  aceite: 'TERMO DE CONFERÊNCIA E ACEITE DO LOTE DIGITALIZADO',
  devolucao: 'TERMO DE DEVOLUÇÃO DOS ORIGINAIS',
};

/** Termos do lote (recebimento, aceite e devolucao) em A4, com inventario e assinaturas. */
export function termoLotePdf(orgao: string, l: LoteDetalheView, tipo: TermoLote): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4', margin: 50 });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const campo = (rotulo: string, valor: string | number | null | undefined) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`${rotulo}: `, { continued: true });
      doc.font('Helvetica').text(valor === null || valor === undefined || valor === '' ? '—' : String(valor));
    };
    try {
      doc.font('Helvetica-Bold').fontSize(11).text(orgao.toUpperCase(), { align: 'center' });
      doc.fontSize(13).text(TITULO[tipo], { align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Lote ${l.protocolo}`, { align: 'center' });
      doc.moveDown(1).fillColor('#0f172a');

      campo('Descrição', l.descricao);
      campo('Secretaria', l.orgaoNome ? `${l.orgaoCodigo} — ${l.orgaoNome}` : l.orgaoCodigo);
      campo('Setor de origem', l.setorOrigem);
      if (l.planoTitulo) campo('Plano de trabalho', l.planoTitulo);
      campo('Caixas', l.caixas);
      campo('Estado de conservação', ESTADO_CONSERVACAO_LABEL[l.estadoConservacao]);
      const cuidados = [l.sigiloso && 'sigiloso', l.fragil && 'frágil', l.grandeFormato && 'grande formato', l.contaminado && 'contaminado'].filter(Boolean);
      campo('Tratamento especial', cuidados.length ? cuidados.join(', ') : 'nenhum');
      campo('Etapa atual', ETAPA_LOTE_LABEL[l.etapa]);

      if (tipo === 'aceite') {
        doc.moveDown(0.6);
        campo('Documentos', l.documentos);
        campo('Páginas aceitas (medição)', l.paginasAceitas ?? l.paginas);
        const qc = l.qcs[0];
        if (qc) {
          doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).text(`Controle de qualidade (amostra de ${qc.amostra}) — ${qc.aprovado ? 'APROVADO' : 'REPROVADO'}`);
          doc.font('Helvetica').fontSize(9);
          for (const k of CHECKLIST_QC) doc.text(`${qc.checklist[k] ? '[x]' : '[ ]'} ${CHECKLIST_QC_LABEL[k]}`);
        }
        const ncs = l.naoConformidades;
        if (ncs.length) {
          doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).text(`Não conformidades: ${ncs.length} (todas corrigidas antes do aceite)`);
          doc.font('Helvetica').fontSize(8);
          for (const n of ncs.slice(0, 30)) doc.text(`• ${n.descricao}${n.correcao ? ` — correção: ${n.correcao}` : ''}`);
        }
        doc.moveDown(0.6);
        campo('Aceite', `${l.aceitePor ?? '—'} em ${dataHora(l.aceiteEm)} (IP ${l.aceiteIp ?? '—'})`);
        if (l.aceiteObservacao) campo('Observação do fiscal', l.aceiteObservacao);
      } else {
        doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text(tipo === 'recebimento' ? 'Inventário preliminar' : 'Inventário conferido na devolução');
        doc.font('Helvetica').fontSize(8);
        if (!l.itens.length) doc.text('Sem itens inventariados.');
        l.itens.forEach((i, n) => {
          const conferido = tipo === 'devolucao' ? (i.conferidoDevolucao ? ' [conferido]' : ' [NÃO conferido]') : '';
          doc.text(
            `${n + 1}. ${TIPO_ITEM_LOTE_LABEL[i.tipo]} ${i.identificacao}` +
              `${i.datasLimite ? ` · ${i.datasLimite}` : ''}${i.folhas ? ` · ${i.folhas} fl.` : ''}` +
              ` · ${ESTADO_CONSERVACAO_LABEL[i.estadoConservacao]}${i.localFisicoCodigo ? ` · ${i.localFisicoCodigo}` : ''}${conferido}`,
          );
        });
      }

      doc.moveDown(1).fontSize(8).fillColor('#475569');
      doc.text(
        tipo === 'recebimento'
          ? `Recebido em ${dia(l.eventos[0]?.criadoEm ?? l.criadoEm)}. A contratada passa a responder pela guarda do acervo até a devolução.`
          : tipo === 'devolucao'
            ? 'Os originais acima foram devolvidos ao órgão na mesma ordem e estado em que foram recebidos.'
            : 'O fiscal do contrato atesta a conferência do lote e autoriza sua medição.',
        { align: 'justify' },
      );
      doc.fillColor('#0f172a').moveDown(4);
      const y = doc.y;
      doc.moveTo(60, y).lineTo(260, y).stroke();
      doc.moveTo(335, y).lineTo(535, y).stroke();
      const [esq, dir] =
        tipo === 'aceite' ? ['Responsável pela digitalização', 'Fiscal do contrato'] : tipo === 'recebimento' ? ['Entregue por (órgão)', 'Recebido por (contratada)'] : ['Entregue por (contratada)', 'Recebido por (órgão)'];
      doc.fontSize(8).text(esq, 60, y + 4, { width: 200, align: 'center' });
      doc.text(dir, 335, y + 4, { width: 200, align: 'center' });
      doc.end();
    } catch (e) {
      reject(e as Error);
    }
  });
}

type Linha = ProducaoResumo['linhas'][number];
const COLUNAS: ColunaExport<Linha>[] = [
  { titulo: 'Lote', peso: 8, valor: (l) => l.protocolo },
  { titulo: 'Secretaria', peso: 18, valor: (l) => (l.orgaoCodigo ? `${l.orgaoCodigo} — ${l.orgaoNome ?? ''}` : 'Sem secretaria') },
  { titulo: 'Descrição', peso: 26, valor: (l) => l.descricao },
  { titulo: 'Etapa', peso: 12, valor: (l) => ETAPA_LOTE_LABEL[l.etapa] },
  { titulo: 'Docs', peso: 6, valor: (l) => l.documentos, alinhar: 'right' },
  { titulo: 'Págs. digitalizadas', peso: 9, valor: (l) => l.paginasDigitalizadas, alinhar: 'right' },
  { titulo: 'Págs. aceitas', peso: 8, valor: (l) => l.paginasAceitas, alinhar: 'right' },
  { titulo: 'NCs', peso: 5, valor: (l) => l.naoConformidades, alinhar: 'right' },
  { titulo: 'Aceite', peso: 8, valor: (l) => dia(l.aceiteEm) },
];

/** Relatorio de producao e qualidade (base da medicao mensal). */
export async function producaoExport(
  orgao: string,
  p: ProducaoResumo,
  formato: 'pdf' | 'csv',
  periodo: string,
  emitidoPor: string | null,
): Promise<{ arquivo: Buffer; nome: string }> {
  const data = new Date().toISOString().slice(0, 10);
  if (formato === 'csv') return { arquivo: gerarCsv(COLUNAS, p.linhas), nome: `producao-digitalizacao-${data}.csv` };
  const t = p.totais;
  const arquivo = await gerarPdfTabela(
    {
      orgao,
      titulo: 'Relatório de Produção e Qualidade da Digitalização',
      detalhes: [
        periodo,
        `${t.lotes} lote(s) · ${t.documentos} documento(s) · ${t.paginasDigitalizadas.toLocaleString('pt-BR')} página(s) digitalizada(s) · ` +
          `${t.paginasAceitas.toLocaleString('pt-BR')} página(s) aceita(s) · ${t.naoConformidades} não conformidade(s)`,
      ],
      emitidoPor,
    },
    [
      { subtitulo: 'Lotes', colunas: COLUNAS, linhas: p.linhas },
      {
        subtitulo: 'Por secretaria (medição)',
        colunas: [
          { titulo: 'Secretaria', peso: 50, valor: (s) => (s.orgaoCodigo ? `${s.orgaoCodigo} — ${s.orgaoNome ?? ''}` : 'Sem secretaria') },
          { titulo: 'Lotes', peso: 10, valor: (s) => s.lotes, alinhar: 'right' },
          { titulo: 'Págs. digitalizadas', peso: 20, valor: (s) => s.paginasDigitalizadas, alinhar: 'right' },
          { titulo: 'Págs. aceitas', peso: 20, valor: (s) => s.paginasAceitas, alinhar: 'right' },
        ] as ColunaExport<ProducaoResumo['porSecretaria'][number]>[],
        linhas: p.porSecretaria,
      },
    ] as never,
  );
  return { arquivo, nome: `producao-digitalizacao-${data}.pdf` };
}
