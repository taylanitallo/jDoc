import { describe, expect, it } from 'vitest';
import { descreverLog, mudancasDoLog, type LogRegistro } from './logs.js';

const base: LogRegistro = {
  id: '1',
  criadoEm: '2026-10-22T13:00:00Z',
  action: 'tenant_updated',
  actorType: 'superadmin',
  adminName: 'Maria',
  orgao: 'Prefeitura de Sobral',
  entity: 'tenant',
  entityId: 'x',
  changes: null,
  metadata: null,
  ip: null,
};

describe('descreverLog', () => {
  it('descreve inclusao de permissao em portugues claro', () => {
    const t = descreverLog({
      ...base,
      action: 'perfil_atualizado',
      changes: {
        antes: { nome: 'Secretário', papel: 'operador', permissoes: ['despesas:read'] },
        depois: { nome: 'Secretário', papel: 'operador', permissoes: ['despesas:read', 'despesas:delete'] },
      },
    });
    expect(t).toBe('Maria alterou o perfil Secretário de Prefeitura de Sobral: incluiu a permissão Excluir em Despesas');
  });

  it('nunca mostra campo=true, chaves tecnicas ou JSON cru', () => {
    const casos: LogRegistro[] = [
      { ...base, changes: { antes: { ativo: true, ambiente: 'producao' }, depois: { ativo: false, ambiente: 'homologacao' } } },
      { ...base, action: 'tenant_deactivated', changes: { antes: { status: 'ativo' }, depois: { status: 'inativo', motivo: 'inadimplência' } } },
      { ...base, action: 'integracao_atualizada', entityId: 'email_smtp', changes: { antes: null, depois: { ligado: true, usarPadrao: false, segredos: ['senha'] } } },
      { ...base, action: 'acao_desconhecida_qualquer' },
    ];
    for (const c of casos) {
      const t = descreverLog(c);
      expect(t).not.toMatch(/=true|=false|\{|\}|"|_/);
      for (const m of mudancasDoLog(c)) {
        expect(`${m.campo} ${m.antes} ${m.depois}`).not.toMatch(/true|false|\{|\}|"/);
      }
    }
  });

  it('traduz status e valores booleanos', () => {
    const t = descreverLog({ ...base, changes: { antes: { ativo: true }, depois: { ativo: false } } });
    expect(t).toContain('ativo de sim para não');
    expect(descreverLog({ ...base, action: 'tenant_deactivated', changes: { antes: { status: 'ativo' }, depois: { status: 'inativo', motivo: 'pedido' } } })).toBe(
      'Maria suspendeu o órgão Prefeitura de Sobral (motivo: pedido)',
    );
  });
});
