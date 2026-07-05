import type { SessionView } from './types';

/**
 * Estado de sessao do processo MAIN. O access token vive somente aqui,
 * em memoria — jamais em disco, jamais exposto ao renderer.
 */
interface ActiveSession {
  accessToken: string;
  slug: string;
  userId: string;
  view: SessionView;
}

let current: ActiveSession | null = null;

export const sessionStore = {
  get current(): ActiveSession | null {
    return current;
  },
  set(session: ActiveSession): void {
    current = session;
  },
  setAccessToken(token: string): void {
    if (current) current.accessToken = token;
  },
  clear(): void {
    current = null;
  },
};
