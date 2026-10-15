/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        page: '#F3F2EE',
        surface: '#EAE8E1',
        border: '#D3D0C6',
        text: '#1C1C1A',
        accent: '#1F5F5B',
        onAccent: '#F3F2EE',
        success: '#3F6B4A',
        danger: '#9A3B32',
        warning: '#8A6A1F',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        default: '2px',
      },
      boxShadow: {
        none: 'none',
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
};
