import { defineConfig } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
  // @ts-expect-error earlyAccess not yet in type definitions
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  migrate: {
    async adapter() {
      const { PrismaPg } = await import('@prisma/adapter-pg');
      return new PrismaPg({ connectionString: process.env.DATABASE_URL });
    },
  },
});
