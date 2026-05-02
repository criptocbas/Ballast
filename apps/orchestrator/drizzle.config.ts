import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config — used by `drizzle-kit generate` to produce SQL migrations
 * from src/db/schema.ts. Migrations land in ./drizzle and are committed to git.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './ballast.sqlite',
  },
} satisfies Config;
