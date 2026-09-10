import pg from 'pg';
import { config } from './config.mjs';

export function createPool() {
  return new pg.Pool({ connectionString: config.databaseUrl });
}

export async function assertScratchDatabase(pool) {
  const { rows: [row] } = await pool.query('select current_database() as name');
  if (row.name !== 'topology_prototype') throw new Error(`Refusing database ${row.name}`);
}

export async function resetSchemas(pool) {
  await assertScratchDatabase(pool);
  await pool.query('drop schema if exists topology_mastra cascade; drop schema if exists topology_factory cascade');
  await pool.query(`
    create schema topology_factory;
    create schema topology_mastra;
    create table topology_factory.missions (
      run_id text primary key,
      mission_id text not null,
      status text not null,
      gate text not null,
      created_at timestamptz not null default now()
    );
    create table topology_factory.commands (
      idempotency_key text primary key,
      run_id text not null,
      command text not null,
      accepted boolean not null,
      created_at timestamptz not null default now()
    );
    create table topology_factory.effects (
      idempotency_key text primary key,
      run_id text not null,
      created_at timestamptz not null default now()
    );
    create table topology_mastra.events (
      run_id text not null,
      sequence integer not null,
      kind text not null,
      payload jsonb not null,
      primary key (run_id, sequence)
    );
  `);
}

export async function closePool(pool) {
  await pool?.end();
}
