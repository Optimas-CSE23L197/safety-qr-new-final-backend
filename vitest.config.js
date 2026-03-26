import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    clearMocks: true,
    testTimeout: 120000,
    hookTimeout: 60000,
    setupFiles: ["tests/setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/modules/order/**"],
      exclude: [
        "src/modules/order/order.routes.js",
        "src/modules/order/**/*.test.js",
      ],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.js"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.js"],
          pool: "forks",
        },
      },
      {
        test: {
          name: "contract",
          include: ["tests/contract/**/*.test.js"],
        },
      },
      {
        test: {
          name: "load",
          include: ["tests/load/**/*.test.js"],
          testTimeout: 300000,
          hookTimeout: 120000,
        },
      },
    ],
  },
});
