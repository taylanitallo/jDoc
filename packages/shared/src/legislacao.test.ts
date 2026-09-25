import { describe, expect, it } from 'vitest';
import {
  alteracoesSchema,
  dadosDaEpigrafe,
  notaEvento,
  rotuloExibicao,
  parseTextoNormativo,
  rotuloNorma,
  situacaoNorma,
  textoCompilado,
  type DispositivoBase,
  type NormaRef,
  type RedacaoBase,
} from './legislacao.js';

const CODIGO_CIVIL = `LIVRO I
DAS PESSOAS
TÍTULO I
DAS PESSOAS NATURAIS
CAPÍTULO I
DA PERSONALIDADE E DA CAPACIDADE
Art. 1 o Toda pessoa é capaz de direitos e deveres na ordem civil.
Art. 2 o A personalidade civil da pessoa começa do nascimento com vida; mas a lei põe a salvo, desde a concepção, os direitos do nascituro.
Art. 3 o São absolutamente incapazes de exercer pessoalmente os atos da vida civil os menores de 16 (dezesseis) anos. (Redação dada pela Lei nº 13.146, de 2015) (Vigência)
I - (Revogado) ; (Redação dada pela Lei nº 13.146, de 2015) (Vigência)
II - (Revogado) ; (Redação dada pela Lei nº 13.146, de 2015) (Vigência)
III - (Revogado) . (Redação dada pela Lei nº 13.146, de 2015) (Vigência)
Art. 4 o São incapazes, relativamente a certos atos ou à maneira de os exercer: (Redação dada pela Lei nº 13.146, de 2015) (Vigência)
I - os maiores de dezesseis e menores de dezoito anos;
II - os ébrios habituais e os viciados em tóxico; (Redação dada pela Lei nº 13.146, de 2015) (Vigência)
III - aqueles que, por causa transitória ou permanente, não puderem exprimir sua vontade;
IV - os pródigos.
Parágrafo único. A capacidade dos indígenas será regulada por legislação especial. (Redação dada pela Lei nº 13.146, de 2015) (Vigência)
Art. 5 o A menoridade cessa aos dezoito anos completos, quando a pessoa fica habilitada à prática de todos os atos da vida civil.
Parágrafo único. Cessará, para os menores, a incapacidade:
I - pela concessão dos pais, ou de um deles na falta do outro;
II - pelo casamento;`;

const LEI_MUNICIPAL = `LEI Nº 1.234, DE 15 DE ABRIL DE 2019
Institui o Plano Diretor Participativo do
Município e dá outras providências.
O PREFEITO MUNICIPAL DE ITAPAJÉ, no uso de suas atribuições,
faz saber que a Câmara Municipal aprovou e ele sanciona a seguinte Lei:
Art. 1º Fica instituído o Plano Diretor Participativo, nos termos
desta Lei.
Art. 2º São objetivos do Plano:
I – ordenar o crescimento urbano;
II – proteger o patrimônio histórico, especialmente:
a) as edificações anteriores a 1950;
b) os sítios arqueológicos.
§ 1º O Poder Executivo regulamentará esta Lei em 90 dias.
§ 2º O prazo do § 1º poderá ser prorrogado uma vez.
Art. 2º-A O Conselho da Cidade acompanhará a execução.
Art. 10. Esta Lei entra em vigor na data de sua publicação.
Paço Municipal de Itapajé, 15 de abril de 2019.
FULANO DE TAL
Prefeito Municipal`;

describe('parseTextoNormativo', () => {
  it('estrutura o Código Civil (Planalto): agrupadores, artigos, incisos e parágrafo único', () => {
    const d = parseTextoNormativo(CODIGO_CIVIL);
    const rot = d.map((x) => `${x.tipo}:${x.rotulo}`);
    expect(rot.slice(0, 3)).toEqual(['livro:LIVRO I', 'titulo:TÍTULO I', 'capitulo:CAPÍTULO I']);
    expect(d[0]!.texto).toBe('DAS PESSOAS');
    expect(d[2]!.texto).toBe('DA PERSONALIDADE E DA CAPACIDADE');
    expect(d[1]!.parentRef).toBe(d[0]!.ref);
    const art3 = d.find((x) => x.rotulo === 'Art. 3º')!;
    expect(art3.parentRef).toBe(d[2]!.ref);
    // notas do compilado sao retiradas
    expect(art3.texto).toBe('São absolutamente incapazes de exercer pessoalmente os atos da vida civil os menores de 16 (dezesseis) anos.');
    const incisos3 = d.filter((x) => x.parentRef === art3.ref);
    expect(incisos3.map((x) => x.rotulo)).toEqual(['I', 'II', 'III']);
    const art5 = d.find((x) => x.rotulo === 'Art. 5º')!;
    const pu = d.find((x) => x.parentRef === art5.ref && x.tipo === 'paragrafo')!;
    expect(pu.rotulo).toBe('Parágrafo único');
    // incisos depois do paragrafo pertencem ao paragrafo
    expect(d.filter((x) => x.parentRef === pu.ref).map((x) => x.rotulo)).toEqual(['I', 'II']);
  });

  it('lei municipal extraída de PDF: preâmbulo, quebras de linha, alíneas, § , Art. 2º-A, Art. 10. e fecho', () => {
    const d = parseTextoNormativo(LEI_MUNICIPAL);
    expect(d.slice(0, 3).map((x) => `${x.tipo}:${x.rotulo}`)).toEqual(['preambulo:Epígrafe', 'preambulo:Ementa', 'preambulo:Preâmbulo']);
    expect(d[0]!.texto).toBe('LEI Nº 1.234, DE 15 DE ABRIL DE 2019');
    expect(d[1]!.texto).toBe('Institui o Plano Diretor Participativo do Município e dá outras providências.');
    expect(d[2]!.texto).toMatch(/^O PREFEITO MUNICIPAL DE ITAPAJÉ.*seguinte Lei:$/);
    const art1 = d.find((x) => x.rotulo === 'Art. 1º')!;
    expect(art1.texto).toBe('Fica instituído o Plano Diretor Participativo, nos termos desta Lei.');
    const art2 = d.find((x) => x.rotulo === 'Art. 2º')!;
    const incII = d.find((x) => x.parentRef === art2.ref && x.rotulo === 'II')!;
    expect(d.filter((x) => x.parentRef === incII.ref).map((x) => x.rotulo)).toEqual(['a)', 'b)']);
    expect(d.filter((x) => x.parentRef === art2.ref && x.tipo === 'paragrafo').map((x) => x.rotulo)).toEqual(['§ 1º', '§ 2º']);
    expect(d.some((x) => x.rotulo === 'Art. 2º-A' && x.texto.startsWith('O Conselho'))).toBe(true);
    expect(d.some((x) => x.rotulo === 'Art. 10' && x.texto.startsWith('Esta Lei entra'))).toBe(true);
    const fecho = d[d.length - 1]!;
    expect(fecho.tipo).toBe('fecho');
    expect(fecho.texto.split('\n')).toEqual(['Paço Municipal de Itapajé, 15 de abril de 2019.', 'FULANO DE TAL', 'Prefeito Municipal']);
  });

  it('"Art. 3º - O prefeito" não vira sufixo; OCR com espaços e travessões', () => {
    const d = parseTextoNormativo('Art.  3º - O Prefeito nomeará.\nArt 4o. A comissão terá:\nI—três membros;\nII -  um secretário.');
    expect(d.map((x) => x.rotulo)).toEqual(['Art. 3º', 'Art. 4º', 'I', 'II']);
    expect(d[0]!.texto).toBe('O Prefeito nomeará.');
    expect(d[3]!.texto).toBe('um secretário.');
  });

  it('"parte II desta Lei" no meio do texto não vira agrupador', () => {
    const d = parseTextoNormativo('Art. 1º Aplica-se o disposto na\nparte II desta Lei aos servidores.');
    expect(d).toHaveLength(1);
    expect(d[0]!.texto).toBe('Aplica-se o disposto na parte II desta Lei aos servidores.');
  });
});

const A: NormaRef = { id: 'A', tipo: 'lei', numero: '100', ano: 2010, dataPublicacao: '2010-03-01' };
const B: NormaRef = { id: 'B', tipo: 'lei', numero: '200', ano: 2015, dataPublicacao: '2015-07-06' };
const disp = (id: string, parentId: string | null, tipo: DispositivoBase['tipo'], rotulo: string, ordem: number, textoOriginal: string | null): DispositivoBase => ({
  id,
  parentId,
  tipo,
  rotulo,
  ordem,
  textoOriginal,
});
const DISPOSITIVOS: DispositivoBase[] = [
  disp('a3', null, 'artigo', 'Art. 3º', 1, 'São absolutamente incapazes:'),
  disp('a3i', 'a3', 'inciso', 'I', 2, 'os menores de dezesseis anos;'),
  disp('a4', null, 'artigo', 'Art. 4º', 3, 'São incapazes relativamente:'),
  disp('a4a', null, 'artigo', 'Art. 4º-A', 3.5, null),
];
const REDACOES: RedacaoBase[] = [
  { id: 'r1', dispositivoId: 'a3i', acao: 'revogacao', texto: null, vigenciaInicio: '2016-01-03', normaAlteradora: B, criadoEm: '2016-01-01T00:00:00Z' },
  { id: 'r2', dispositivoId: 'a4', acao: 'redacao', texto: 'São incapazes, relativamente a certos atos:', vigenciaInicio: '2016-01-03', normaAlteradora: B, criadoEm: '2016-01-01T00:00:00Z' },
  { id: 'r3', dispositivoId: 'a4a', acao: 'inclusao', texto: 'A capacidade é presumida.', vigenciaInicio: '2016-01-03', normaAlteradora: B, criadoEm: '2016-01-01T00:00:00Z' },
];

describe('textoCompilado', () => {
  it('mostra a redação vigente, o histórico e as notas estilo Planalto', () => {
    const c = textoCompilado(DISPOSITIVOS, REDACOES, '2026-01-01');
    expect(c.map((n) => n.rotulo)).toEqual(['Art. 3º', 'Art. 4º', 'Art. 4º-A']);
    const inc = c[0]!.filhos[0]!;
    expect(inc.revogado).toBe(true);
    expect(inc.texto).toBeNull();
    expect(inc.historico.map((h) => h.acao)).toEqual(['original', 'revogacao']);
    expect(notaEvento(inc.historico[1]!)).toBe('(Revogado pela Lei nº 200, de 2015)');
    const a4 = c[1]!;
    expect(a4.texto).toBe('São incapazes, relativamente a certos atos:');
    expect(a4.historico[0]!.vigente).toBe(false);
    expect(notaEvento(a4.historico[1]!)).toBe('(Redação dada pela Lei nº 200, de 2015)');
    expect(notaEvento(c[2]!.historico[0]!)).toBe('(Incluído pela Lei nº 200, de 2015)');
  });

  it('consulta por data: antes da alteração vale o texto original e o incluído não existe', () => {
    const c = textoCompilado(DISPOSITIVOS, REDACOES, '2015-12-31');
    expect(c.map((n) => n.rotulo)).toEqual(['Art. 3º', 'Art. 4º']);
    expect(c[0]!.filhos[0]!.texto).toBe('os menores de dezesseis anos;');
    expect(c[1]!.texto).toBe('São incapazes relativamente:');
  });
});

describe('situacaoNorma e rótulos', () => {
  it('calcula a situação', () => {
    expect(situacaoNorma(DISPOSITIVOS, [], '2026-01-01')).toBe('vigente');
    expect(situacaoNorma(DISPOSITIVOS, [REDACOES[1]!], '2026-01-01')).toBe('alterada');
    expect(situacaoNorma(DISPOSITIVOS, REDACOES, '2026-01-01')).toBe('revogada_parcial');
    expect(situacaoNorma(DISPOSITIVOS, REDACOES, '2015-01-01')).toBe('vigente');
    const revogaTudo: RedacaoBase[] = ['a3', 'a4'].map((id, i) => ({ id: `x${i}`, dispositivoId: id, acao: 'revogacao', texto: null, vigenciaInicio: '2020-01-01', normaAlteradora: B, criadoEm: '2020-01-01T00:00:00Z' }));
    expect(situacaoNorma(DISPOSITIVOS, revogaTudo, '2026-01-01')).toBe('revogada');
    expect(situacaoNorma(DISPOSITIVOS, [], '2026-01-01', true)).toBe('revogada');
  });

  it('rótulo por extenso', () => {
    expect(rotuloNorma(A)).toBe('Lei nº 100, de 1 de março de 2010');
    expect(rotuloNorma({ ...A, tipo: 'decreto', dataPublicacao: null })).toBe('Decreto nº 100/2010');
  });
});

describe('epígrafe, rótulos e validação', () => {
  it('extrai número, ano e data da epígrafe', () => {
    expect(dadosDaEpigrafe('LEI Nº 1.234, DE 15 DE ABRIL DE 2019')).toEqual({ numero: '1.234', ano: 2019, dataPublicacao: '2019-04-15' });
    expect(dadosDaEpigrafe('DECRETO Nº 101, DE 1º DE MARÇO DE 1987')).toEqual({ numero: '101', ano: 1987, dataPublicacao: '1987-03-01' });
    expect(dadosDaEpigrafe('PORTARIA N.º 45/2021')).toEqual({ numero: '45', ano: 2021, dataPublicacao: null });
  });

  it('rótulo como no Planalto', () => {
    expect(rotuloExibicao('inciso', 'IV')).toBe('IV –');
    expect(rotuloExibicao('paragrafo', 'Parágrafo único')).toBe('Parágrafo único.');
    expect(rotuloExibicao('paragrafo', '§ 2º')).toBe('§ 2º');
    expect(rotuloExibicao('preambulo', 'Ementa')).toBe('');
  });

  it('não aceita o mesmo dispositivo duas vezes na mesma alteração', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const base = { alvoId: '22222222-2222-4222-8222-222222222222' };
    expect(alteracoesSchema.safeParse({ ...base, itens: [{ acao: 'revogacao', dispositivoId: id }] }).success).toBe(true);
    expect(alteracoesSchema.safeParse({ ...base, itens: [{ acao: 'revogacao', dispositivoId: id }, { acao: 'redacao', dispositivoId: id, texto: 'x' }] }).success).toBe(false);
  });
});
