import { ENV } from '#config/env.js';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',

  datasource: {
    url: ENV.DATABASE_URL,
  },

  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
});
