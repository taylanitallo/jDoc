'use client';

import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Opcao {
  value: string;
  label: ReactNode;
  texto: string;
  disabled: boolean;
}

function textoDe(no: ReactNode): string {
  if (no === null || no === undefined || typeof no === 'boolean') return '';
  if (typeof no === 'string' || typeof no === 'number') return String(no);
  if (Array.isArray(no)) return no.map(textoDe).join('');
  if (isValidElement<{ children?: ReactNode }>(no)) return textoDe(no.props.children);
  return '';
}

/** Le os <option> filhos (inclusive dentro de fragments/arrays) como o <select> nativo faria. */
function lerOpcoes(children: ReactNode): Opcao[] {
  const out: Opcao[] = [];
  const visitar = (nos: ReactNode) =>
    Children.forEach(nos, (no) => {
      if (!isValidElement(no)) return;
      const el = no as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
      if (el.type === 'option') {
        const texto = textoDe(el.props.children);
        out.push({
          value: el.props.value !== undefined ? String(el.props.value) : texto,
          label: el.props.children,
          texto,
          disabled: !!el.props.disabled,
        });
      } else if (el.props.children !== undefined) {
        visitar(el.props.children);
      }
    });
  visitar(children);
  return out;
}

export type SelectMenuProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  /** Classes da lista aberta (ex.: largura minima). */
  menuClassName?: string;
  /** Conteudo antes do texto no botao (ex.: icone). */
  leading?: ReactNode;
};

/**
 * Select com lista no padrao visual do jDoc. Por baixo existe um <select> nativo
 * escondido que recebe o valor e dispara o `change` de verdade: react-hook-form,
 * defaultValue, `e.target.value` e envio de formulario seguem funcionando.
 */
export const SelectMenu = forwardRef<HTMLSelectElement, SelectMenuProps>(function SelectMenu(
  { className, children, invalid, menuClassName, leading, id, disabled, value, defaultValue, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const nativo = useRef<HTMLSelectElement>(null);
  useImperativeHandle(ref, () => nativo.current as HTMLSelectElement);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listaId = `${baseId}-lista`;

  const opcoes = lerOpcoes(children);
  const controlado = value !== undefined;
  const [interno, setInterno] = useState<string>(
    defaultValue !== undefined ? String(defaultValue) : (opcoes.find((o) => !o.disabled)?.value ?? opcoes[0]?.value ?? ''),
  );
  const atual = controlado ? String(value ?? '') : interno;
  const selecionada = opcoes.find((o) => o.value === atual);

  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; acima: boolean; maxH: number } | null>(null);
  const busca = useRef({ texto: '', ate: 0 });

  // react-hook-form escreve o valor direto no <select> (sem evento): sincroniza ao montar e ao abrir.
  const sincronizar = useCallback(() => {
    if (!controlado && nativo.current && nativo.current.value !== interno) setInterno(nativo.current.value);
  }, [controlado, interno]);
  useEffect(() => {
    sincronizar();
    // so na montagem: depois o valor muda pelo proprio componente
  }, []);

  const posicionar = useCallback(() => {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    const abaixo = window.innerHeight - r.bottom - 8;
    const acimaEspaco = r.top - 8;
    const acima = abaixo < 220 && acimaEspaco > abaixo;
    const maxH = Math.min(320, Math.max(160, acima ? acimaEspaco : abaixo) - 8);
    setPos({ top: acima ? r.top - 6 : r.bottom + 6, left: r.left, width: r.width, acima, maxH });
  }, []);

  const abrir = () => {
    if (disabled) return;
    sincronizar();
    posicionar();
    const i = opcoes.findIndex((o) => o.value === atual);
    setAtivo(i >= 0 ? i : Math.max(0, opcoes.findIndex((o) => !o.disabled)));
    setAberto(true);
  };
  const fechar = (focar = true) => {
    setAberto(false);
    if (focar) botao.current?.focus();
  };

  const escolher = (o: Opcao) => {
    if (o.disabled) return;
    const el = nativo.current;
    if (el && el.value !== o.value) {
      // setter nativo + evento real: o onChange do React recebe um ChangeEvent de verdade
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(el, o.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!controlado) setInterno(o.value);
    fechar();
  };

  useLayoutEffect(() => {
    if (!aberto) return;
    const reposicionar = () => posicionar();
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!botao.current?.contains(alvo) && !lista.current?.contains(alvo)) setAberto(false);
    };
    window.addEventListener('resize', reposicionar);
    window.addEventListener('scroll', reposicionar, true);
    document.addEventListener('mousedown', fora);
    return () => {
      window.removeEventListener('resize', reposicionar);
      window.removeEventListener('scroll', reposicionar, true);
      document.removeEventListener('mousedown', fora);
    };
  }, [aberto, posicionar]);

  // Mantem a opcao ativa visivel ao navegar pelo teclado.
  useEffect(() => {
    if (aberto) lista.current?.querySelector(`[data-i="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [aberto, ativo]);

  const mover = (de: number, passo: number) => {
    let i = de;
    for (let n = 0; n < opcoes.length; n++) {
      i = (i + passo + opcoes.length) % opcoes.length;
      if (!opcoes[i]?.disabled) return i;
    }
    return de;
  };

  const teclado = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!aberto) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => mover(a, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => mover(a, -1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setAtivo(mover(-1, 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      setAtivo(mover(opcoes.length, -1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = opcoes[ativo];
      if (o) escolher(o);
    } else if (e.key === 'Escape') {
      // so fecha a lista: nao deixa o Esc chegar ao Modal por tras
      e.preventDefault();
      e.stopPropagation();
      fechar();
    } else if (e.key === 'Tab') {
      setAberto(false);
    } else if (e.key.length === 1) {
      // digitar as primeiras letras pula para a opcao
      const agora = Date.now();
      busca.current.texto = (agora < busca.current.ate ? busca.current.texto : '') + e.key.toLowerCase();
      busca.current.ate = agora + 700;
      const i = opcoes.findIndex((o) => !o.disabled && o.texto.toLowerCase().startsWith(busca.current.texto));
      if (i >= 0) setAtivo(i);
    }
  };

  const vazio = !selecionada || selecionada.value === '';

  return (
    <>
      <select
        ref={nativo}
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        value={controlado ? atual : undefined}
        defaultValue={controlado ? undefined : defaultValue}
        className="sr-only"
        {...rest}
      >
        {children}
      </select>
      <button
        ref={botao}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? listaId : undefined}
        aria-activedescendant={aberto ? `${listaId}-${ativo}` : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={teclado}
        className={cn(
          'flex items-center gap-2 text-left',
          className,
          'pr-9',
          invalid && 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20',
          aberto && 'border-brand-500 ring-2 ring-brand-500/20',
          'relative',
        )}
      >
        {leading}
        <span className={cn('min-w-0 flex-1 truncate', vazio && 'text-ink-400')}>{selecionada?.label ?? ' '}</span>
        <ChevronDown
          className={cn('pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 transition-transform', aberto && 'rotate-180 text-brand-600')}
          aria-hidden
        />
      </button>
      {aberto &&
        pos &&
        createPortal(
          <ul
            ref={lista}
            id={listaId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              left: pos.left,
              minWidth: Math.max(pos.width, 180),
              maxWidth: Math.max(pos.width, 360),
              maxHeight: pos.maxH,
              ...(pos.acima ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
            className={cn(
              'no-scrollbar z-[120] animate-fade-in overflow-y-auto rounded-[12px] border border-ink-200/70 bg-surface p-1.5 shadow-xl',
              menuClassName,
            )}
          >
            {opcoes.map((o, i) => {
              // "Selecione…" desabilitado e vazio e so instrucao: aparece no botao, nao na lista
              if (o.disabled && o.value === '') return null;
              const sel = o.value === atual;
              return (
                <li
                  key={`${o.value}-${i}`}
                  id={`${listaId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={sel}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => !o.disabled && setAtivo(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(o)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-sm transition-colors',
                    o.disabled && 'cursor-not-allowed text-ink-400',
                    !o.disabled && (i === ativo ? 'bg-ink-100 text-ink-900' : 'text-ink-700'),
                    sel && 'font-semibold text-brand-600',
                    sel && i !== ativo && 'bg-brand-50',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {sel && <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />}
                </li>
              );
            })}
            {opcoes.length === 0 && <li className="px-3 py-2 text-sm text-ink-400">Nenhuma opção</li>}
          </ul>,
          document.body,
        )}
    </>
  );
});
