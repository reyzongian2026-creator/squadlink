import { arcadeBoards, reportedGames } from './public/arcade-boards.js';
// The WebRTC server can still run without pg when no PostgreSQL URL is configured.
let schema = `
CREATE TABLE IF NOT EXISTS squadlink_progress_profiles (
  id text PRIMARY KEY,
  profile jsonb NOT NULL,
  xp bigint GENERATED ALWAYS AS ((profile->>'xp')::bigint) STORED,
  reflex_ms integer GENERATED ALWAYS AS ((profile #>> '{best,reflex}')::integer) STORED,
  sequence_round integer GENERATED ALWAYS AS ((profile #>> '{best,sequence}')::integer) STORED,
  CHECK (profile->>'id' IS NOT NULL AND profile->>'id' = id)
);
CREATE INDEX IF NOT EXISTS squadlink_progress_xp ON squadlink_progress_profiles (xp DESC, id) WHERE xp > 0;
CREATE INDEX IF NOT EXISTS squadlink_progress_reflex ON squadlink_progress_profiles (reflex_ms, id) WHERE reflex_ms > 0;
CREATE INDEX IF NOT EXISTS squadlink_progress_sequence ON squadlink_progress_profiles (sequence_round DESC, id) WHERE sequence_round > 0;
`;
const rankQueries = {
  xp:'WHERE xp > 0 ORDER BY xp DESC, id',
  reflex:'WHERE reflex_ms > 0 ORDER BY reflex_ms, id',
  sequence:'WHERE sequence_round > 0 ORDER BY sequence_round DESC, id'
};

// Only identifiers from our fixed catalog enter the SQL expressions. Old JSON
// profiles have NULL for the new fields and stay outside their partial indexes.
for (const game of reportedGames) {
  const score = "((profile #>> '{best," + game + "}')::bigint)";
  const order = arcadeBoards[game].order === 'min' ? 'ASC' : 'DESC';
  rankQueries[game] = 'WHERE ' + score + ' > 0 ORDER BY ' + score + ' ' + order + ', id';
  schema += 'CREATE INDEX IF NOT EXISTS squadlink_progress_' + game + ' ON squadlink_progress_profiles (' +
    score + ' ' + order + ', id) WHERE ' + score + ' > 0;\n';
}

async function transaction(pool, operation) {
  const client = await pool.connect();
  let discard;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally {
    client.release(discard);
  }
}

export function createPostgresStore(connectionString) {
  if (!URL.canParse(connectionString) || !['postgres:', 'postgresql:'].includes(new URL(connectionString).protocol))
    throw Error('SQUADLINK_DATABASE_URL debe ser una URL de PostgreSQL.');
  let ready = null;
  let closed = false;
  async function open() {
    const {Pool} = await import('pg');
    const pool = new Pool({connectionString,max:4,connectionTimeoutMillis:4_000,idleTimeoutMillis:15_000,
      statement_timeout:5_000,lock_timeout:4_000,idle_in_transaction_session_timeout:8_000,allowExitOnIdle:true});
    pool.on('error', () => console.error('Se interrumpió una conexión inactiva de PostgreSQL.'));
    try {
      await transaction(pool, async client => {
        // Serialize idempotent DDL if several instances boot on the same empty database.
        await client.query('SELECT pg_advisory_xact_lock(14547989, 1)');
        await client.query(schema);
      });
      return pool;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  function initialized() {
    if (closed) throw Error('El almacén ya está cerrado.');
    ready ??= open().catch(error => { ready = null; throw error; });
    return ready;
  }
  return {
    scope:'global',
    async update(id, transform) {
      const pool = await initialized();
      return transaction(pool, async client => {
        // A row lock alone cannot protect the concurrent creation of the first profile.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
        const {rows} = await client.query('SELECT profile FROM squadlink_progress_profiles WHERE id=$1', [id]);
        const current = rows[0]?.profile;
        const next = transform(current);
        if (next !== current) {
          await client.query(`INSERT INTO squadlink_progress_profiles (id, profile) VALUES ($1, $2::jsonb)
            ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile`, [id, JSON.stringify(next)]);
        }
        return next;
      });
    },
    async ranking(board) {
      if (!Object.hasOwn(rankQueries, board)) throw Error('Ranking desconocido.');
      const pool = await initialized();
      const {rows} = await pool.query('SELECT profile FROM squadlink_progress_profiles '
        + rankQueries[board] + ' LIMIT 30');
      return rows.map(row => row.profile);
    },
    async close() {
      if (closed) return;
      closed = true;
      const pool = await ready;
      if (pool) await pool.end();
    }
  };
}
