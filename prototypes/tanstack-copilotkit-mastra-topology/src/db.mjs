import pg from 'pg';
import { config } from './config.mjs';
import { eventFromRow } from './protocol.mjs';

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

export async function appendEvent(pool, runId, kind, payload) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('begin');
    inTransaction = true;
    // ponytail: hash collisions can serialize unrelated Runs; use a run-sequences table if that is measured.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [runId]);
    const { rows: [row] } = await client.query(
      `insert into topology_mastra.events (run_id, sequence, kind, payload)
       values ($1, coalesce((select max(sequence) + 1 from topology_mastra.events where run_id = $1), 1), $2, $3)
       returning run_id, sequence, kind, payload`,
      [runId, kind, payload],
    );
    await client.query('commit');
    inTransaction = false;
    return eventFromRow(row);
  } catch (error) {
    if (inTransaction) await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function eventsAfter(pool, runId, after) {
  const { rows } = await pool.query(
    `select run_id, sequence, kind, payload from topology_mastra.events
     where run_id = $1 and sequence > $2 order by sequence`,
    [runId, after],
  );
  return rows.map(eventFromRow);
}
