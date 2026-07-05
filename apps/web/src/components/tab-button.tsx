import type { ReactNode } from 'react';

interface Props {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function TabButton({ active, onClick, children }: Props) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active
          ? 'bg-gradient-primary text-white shadow'
          : 'text-app-muted hover:bg-app-hover'
      }`}
    >
      {children}
    </button>
  );
}