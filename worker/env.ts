import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from './db/schema';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CANONICAL_HOST: string;
  ALLOWED_EMAILS: string;
  /** One-time link secret for setting or resetting a password: /setup#<token>. */
  SETUP_TOKEN?: string;
  /** Local development only (.dev.vars): enables /auth/dev. */
  DEV_LOGIN?: string;
}

export type DB = DrizzleD1Database<typeof schema>;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export type AppEnv = { Bindings: Env; Variables: { db: DB; user: SessionUser } };
