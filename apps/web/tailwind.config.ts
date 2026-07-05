import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidade JEOS
        'login-bg-from': '#0a0a12',
        'login-bg-to': '#12001f',
        'neon-purple': '#a855f7',
        'neon-magenta': '#d946ef',
        'neon-violet': '#7c3aed',
        'sidebar-dark': '#16213e',
        'sidebar-light': '#1e2a4a',
        'content-bg': '#f8f9fb',
        'flag-green': '#009c3b',

        // Tokens de tema (light/dark via var(--*))
        app: 'var(--app-text)',
        'app-bg': 'var(--app-bg)',
        'app-card': 'var(--app-card)',
        'app-border': 'var(--app-border)',
        'app-muted': 'var(--app-muted)',
        'app-input-bg': 'var(--app-input-bg)',
        'app-input-border': 'var(--app-input-border)',
        'app-skeleton': 'var(--app-skeleton)',
        'app-error-bg': 'var(--app-error-bg)',
        'app-error-text': 'var(--app-error-text)',
        'app-badge-gray-bg': 'var(--app-badge-gray-bg)',
        'app-badge-gray-text': 'var(--app-badge-gray-text)',
        'app-table-head': 'var(--app-table-head)',
        'app-hover': 'var(--app-hover)',

        // Cor de destaque do tenant (tenant_settings.corDestaque, via BrandingProvider).
        // Fallback e o roxo institucional quando o tenant nao customizou.
        accent: 'var(--accent-color, #7c3aed)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #7c3aed 0%, #d946ef 100%)',
        'gradient-modal': 'linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%)',
        'gradient-login': 'linear-gradient(160deg, #0a0a12 0%, #12001f 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
