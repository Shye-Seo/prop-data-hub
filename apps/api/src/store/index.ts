import pg from 'pg';
import { MemoryStore } from './memory-store';
import { PgStore, type Queryable } from './pg-store';
import type { Store } from './types';

export interface StoreConfig {
  databaseUrl?: string;
  /** DB가 없을 때 샘플 데이터를 적재해 API를 띄울지. 기본 true(로컬·데모). */
  seedDemo?: boolean;
}

export function createStore(config: StoreConfig = {}): Store {
  const databaseUrl = config.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) return new MemoryStore();

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const queryable: Queryable = {
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params as unknown[]);
      return { rows: result.rows as T[] };
    },
  };
  return new PgStore(queryable);
}

export { MemoryStore, PgStore };
export type { Store, Queryable };
