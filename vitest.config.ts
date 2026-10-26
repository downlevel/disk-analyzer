import { defineConfig } from "vitest/config";

// Configurazione separata da vite.config.ts: i test non hanno bisogno di React né di Tailwind.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
