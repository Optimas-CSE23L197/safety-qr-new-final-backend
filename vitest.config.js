import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/modules/order/**"],
      exclude: ["src/modules/order/order.routes.js"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/order/unit/**/*.test.js"],
        },
      },
      {
        test: {
          name: "steps",
          include: ["tests/order/steps/**/*.test.js"],
          setupFiles: ["tests/setup/mocks.setup.js"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/order/integration/**/*.test.js"],
          setupFiles: ["tests/setup/db.setup.js"],
          pool: "forks",
        },
      },
    ],
  },
});
