import type { Config } from "tailwindcss";

// Design tokens per docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md §28.
// Swap/extend as the real design system gets built out in Phase 4+.
const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    // packages/ui ships pre-compiled JS (tsc, react-jsx runtime) — Tailwind
    // still needs to scan it for the utility classes those components use,
    // or its JIT purge strips them since nothing in apps/web's own source
    // mentions them literally.
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#F8F9FC",
        surface: "#FFFFFF",
        "text-primary": "#172033",
        "text-secondary": "#667085",
        border: "#E7EAF0",
        primary: "#5267E8",
        "primary-hover": "#4057D6",
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
      },
    },
  },
  plugins: [],
};

export default config;
