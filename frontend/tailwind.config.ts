import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#07080a",
        foreground: "#f3f4f6",
        surface: {
          DEFAULT: "#0f1218",
          subtle: "#161b24",
          border: "#232a38",
          highlight: "#30394a",
        },
        accent: {
          DEFAULT: "#e8a33d",
          hover: "#f5b452",
          subtle: "rgba(232, 163, 61, 0.12)",
        },
        emerald: {
          DEFAULT: "#10b981",
          subtle: "rgba(16, 185, 129, 0.12)",
        },
        rose: {
          DEFAULT: "#f43f5e",
          subtle: "rgba(244, 63, 94, 0.12)",
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        'radial-gradient': 'radial-gradient(circle at 50% 0%, var(--tw-gradient-stops))',
        'grid-pattern': 'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'click-ripple': 'ripple 0.6s ease-out',
      },
      keyframes: {
        ripple: {
          '0%': { transform: 'scale(0.8)', opacity: '1' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
