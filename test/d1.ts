// A D1 stand-in over node:sqlite, enough for drizzle-orm/d1 and raw prepare() calls.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type Args = unknown[];

export function createD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of fs.readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(`migrations/${f}`, 'utf8'));
  }
  const norm = (args: Args) => args.map((a) => (typeof a === 'boolean' ? Number(a) : a === undefined ? null : a)) as never[];
  const isQuery = (sql: string) => /^\s*(SELECT|WITH|PRAGMA)\b|\bRETURNING\b/i.test(sql);

  const statement = (sql: string, args: Args = []): any => ({
    bind: (...a: Args) => statement(sql, a),
    first: async (col?: string) => {
      const row = db.prepare(sql).get(...norm(args)) as Record<string, unknown> | undefined;
      return row ? (col ? row[col] : row) : null;
    },
    all: async () => ({ results: isQuery(sql) ? db.prepare(sql).all(...norm(args)) : (run(sql, args), []), success: true, meta: {} }),
    run: async () => ({ success: true, meta: { changes: run(sql, args) }, results: [] }),
    raw: async (opts?: { columnNames?: boolean }) => {
      const st = db.prepare(sql);
      if (!isQuery(sql)) { run(sql, args); return []; }
      st.setReturnArrays(true);
      const rows = st.all(...norm(args)) as unknown as unknown[][];
      if (opts?.columnNames) return [st.columns().map((c) => c.name), ...rows];
      return rows;
    },
  });
  const run = (sql: string, args: Args) => Number(db.prepare(sql).run(...norm(args)).changes);

  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of list) out.push(await s.all());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => { db.exec(sql); return { count: 0, duration: 0 }; },
    dump: async () => new ArrayBuffer(0),
    withSession: () => { throw new Error('not supported'); },
  } as unknown as D1Database;
}
