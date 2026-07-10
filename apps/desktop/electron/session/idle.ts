import type { BrowserWindow } from 'electron';

/**
 * Monitor de inatividade (idle timeout). Observado no MAIN via `input-event`
 * da janela — qualquer tecla/mouse reinicia a contagem. Ao expirar, dispara
 * `onExpire` (logout + aviso ao renderer). So conta enquanto ha sessao ativa.
 */
const DEFAULT_IDLE_MS = 120 * 60 * 1000;

class IdleMonitor {
  private timer: NodeJS.Timeout | null = null;
  private active = false;
  private readonly timeoutMs: number;

  /** Setado pelo main; chamado uma vez quando o tempo ocioso estoura. */
  onExpire: () => void = () => {};

  constructor() {
    const override = Number(process.env['JDOC_IDLE_MS']);
    this.timeoutMs = Number.isFinite(override) && override > 0 ? override : DEFAULT_IDLE_MS;
  }

  /** Liga o listener de atividade na janela (uma vez, no boot). */
  attach(win: BrowserWindow): void {
    win.webContents.on('input-event', () => this.touch());
  }

  /** Inicia a contagem (chamado quando uma sessao passa a existir). */
  start(): void {
    this.active = true;
    this.reset();
  }

  /** Para a contagem (logout ou expiracao). */
  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private touch(): void {
    if (this.active) this.reset();
  }

  private reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.active = false;
      this.timer = null;
      this.onExpire();
    }, this.timeoutMs);
  }
}

export const idleMonitor = new IdleMonitor();
