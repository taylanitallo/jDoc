'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/** Rodape de tabela: "Exibindo X–Y de Z" + Anterior/Proxima (some quando nao ha itens). */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (total <= 0) return null;
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
  const inicio = (page - 1) * pageSize + 1;
  const fim = Math.min(page * pageSize, total);
  const fmt = (n: number) => n.toLocaleString('pt-BR');

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <p className="text-[13px] text-ink-500 tabular-nums">
        Exibindo <span className="font-semibold text-ink-800">{fmt(inicio)}–{fmt(fim)}</span> de{' '}
        <span className="font-semibold text-ink-800">{fmt(total)}</span>
      </p>
      {totalPaginas > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} leftIcon={<ChevronLeft aria-hidden />}>
            Anterior
          </Button>
          <span className="px-1 text-[13px] text-ink-500 tabular-nums">
            {page} / {totalPaginas}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPaginas} onClick={() => onPageChange(page + 1)}>
            Próxima
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
