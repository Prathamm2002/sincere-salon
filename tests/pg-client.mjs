/**
 * ---------------------------------------------------------------------------
 *  Minimal PostgreSQL client — TEST HARNESS ONLY, never shipped
 * ---------------------------------------------------------------------------
 *  Production talks to Neon through @neondatabase/serverless. This sandbox has
 *  no access to the npm registry, so to run the real handlers end-to-end
 *  against a real database this speaks the Postgres v3 wire protocol directly
 *  over TCP.
 *
 *  It implements exactly enough to be a drop-in for the bits of the
 *  node-postgres interface that lib/db.js uses: query(text, params),
 *  connect() -> client, release(). Extended query protocol, text format,
 *  trust authentication.
 *
 *  Type coercion mirrors node-postgres defaults (bool -> boolean, int -> number,
 *  numeric -> string) so behaviour here matches production.
 * ---------------------------------------------------------------------------
 */

import net from 'node:net';

// Type OIDs we coerce; everything else is handed back as text.
const OID = { BOOL: 16, INT8: 20, INT2: 21, INT4: 23, FLOAT4: 700, FLOAT8: 701 };

class Conn {
  constructor(opts) {
    this.opts = opts;
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.queue = [];        // Pending { resolve, reject, rows, fields }
    this.ready = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.opts.port, this.opts.host);
      this.socket.on('error', reject);
      this.socket.on('data', (d) => this.#onData(d));

      this.socket.on('connect', () => {
        // StartupMessage: protocol 3.0 + null-terminated key/value pairs.
        const params = `user\0${this.opts.user}\0database\0${this.opts.database}\0\0`;
        const body = Buffer.from(params, 'utf8');
        const msg = Buffer.alloc(8 + body.length);
        msg.writeInt32BE(8 + body.length, 0);
        msg.writeInt32BE(196608, 4);
        body.copy(msg, 8);
        this.socket.write(msg);
      });

      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  #onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);

    // Messages are [type:1][length:4][payload]; TCP may split or merge them,
    // so only consume whole messages.
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;

      const payload = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.#handle(type, payload);
    }
  }

  #handle(type, p) {
    const cur = this.queue[0];

    switch (type) {
      case 'R': {                      // Authentication
        const method = p.readInt32BE(0);
        if (method !== 0) {
          this.readyReject?.(new Error(`Unsupported auth method ${method}; use trust.`));
        }
        break;
      }
      case 'Z':                        // ReadyForQuery — ends every exchange
        if (this.readyResolve) {
          this.readyResolve(this);
          this.readyResolve = null;
          // Clear the reject handle too. Leaving it set meant the first query
          // error after connecting was routed to the already-settled connect
          // promise instead of the query's own, and vanished.
          this.readyReject = null;
        } else if (cur) {
          this.queue.shift();
          // A failed statement still ends with ReadyForQuery, so the decision
          // between resolve and reject has to happen HERE. Doing it in a check
          // after the switch was too late: the queue had already been shifted
          // and the promise resolved, silently swallowing the error.
          if (cur.error) cur.reject(cur.error);
          else cur.resolve({ rows: cur.rows });
        }
        break;

      case 'T': {                      // RowDescription
        const count = p.readInt16BE(0);
        let off = 2;
        const fields = [];
        for (let i = 0; i < count; i++) {
          const end = p.indexOf(0, off);
          const name = p.subarray(off, end).toString('utf8');
          off = end + 1;
          const typeOid = p.readInt32BE(off + 6);
          off += 18;
          fields.push({ name, typeOid });
        }
        if (cur) cur.fields = fields;
        break;
      }
      case 'D': {                      // DataRow
        if (!cur) break;
        const count = p.readInt16BE(0);
        let off = 2;
        const row = {};
        for (let i = 0; i < count; i++) {
          const len = p.readInt32BE(off);
          off += 4;
          let value = null;
          if (len >= 0) {
            value = p.subarray(off, off + len).toString('utf8');
            off += len;
          }
          const f = cur.fields[i];
          row[f?.name ?? i] = coerce(value, f?.typeOid);
        }
        cur.rows.push(row);
        break;
      }
      case 'E': {                      // ErrorResponse
        const msg = parseError(p);
        if (this.readyReject) { this.readyReject(new Error(msg)); this.readyReject = null; }
        else if (cur) { cur.error = new Error(msg); }
        break;
      }
      default:
        break;                         // ParseComplete, BindComplete, etc.
    }

  }

  query(text, params = []) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, rows: [], fields: [], error: null });
      this.socket.write(buildExtended(text, params));
    });
  }

  release() {}                          // Pool-compat no-op
  end() { this.socket?.end(); }
}

function coerce(value, oid) {
  if (value === null) return null;
  switch (oid) {
    case OID.BOOL:   return value === 't';
    case OID.INT2:
    case OID.INT4:   return Number(value);
    case OID.FLOAT4:
    case OID.FLOAT8: return Number(value);
    // INT8 and NUMERIC stay strings, matching node-postgres defaults.
    default:         return value;
  }
}

function parseError(p) {
  const parts = p.toString('utf8').split('\0');
  const msg = parts.find((s) => s.startsWith('M'));
  return msg ? msg.slice(1) : 'Postgres error';
}

/** Parse + Bind + Describe + Execute + Sync, as one write. */
function buildExtended(text, params) {
  const chunks = [];
  const msg = (type, body) => {
    const head = Buffer.alloc(5);
    head[0] = type.charCodeAt(0);
    head.writeInt32BE(4 + body.length, 1);
    chunks.push(head, body);
  };

  // Parse: unnamed statement, no declared parameter types (server infers).
  const q = Buffer.from(text, 'utf8');
  const parse = Buffer.alloc(1 + q.length + 1 + 2);
  q.copy(parse, 1);
  parse.writeInt16BE(0, 1 + q.length + 1);
  msg('P', parse);

  // Bind: all parameters in text format.
  const encoded = params.map((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return Buffer.from(v ? 't' : 'f');
    if (v instanceof Date) return Buffer.from(v.toISOString());
    return Buffer.from(String(v), 'utf8');
  });

  let size = 1 + 1 + 2 + 2;
  for (const e of encoded) size += 4 + (e ? e.length : 0);
  size += 2;

  const bind = Buffer.alloc(size);
  let off = 2;                                   // empty portal + empty stmt
  bind.writeInt16BE(0, off); off += 2;           // no format codes -> all text
  bind.writeInt16BE(encoded.length, off); off += 2;
  for (const e of encoded) {
    if (e === null) { bind.writeInt32BE(-1, off); off += 4; }
    else { bind.writeInt32BE(e.length, off); off += 4; e.copy(bind, off); off += e.length; }
  }
  bind.writeInt16BE(0, off);                     // result format: all text
  msg('B', bind);

  const describe = Buffer.alloc(2);
  describe[0] = 'P'.charCodeAt(0);
  msg('D', describe);

  const execute = Buffer.alloc(1 + 4);
  execute.writeInt32BE(0, 1);                    // no row limit
  msg('E', execute);

  msg('S', Buffer.alloc(0));
  return Buffer.concat(chunks);
}

/** Pool-compatible facade over a single connection. */
export async function createTestPool({ host = '127.0.0.1', port = 5433, user = 'postgres', database = 'salon' } = {}) {
  const conn = new Conn({ host, port, user, database });
  await conn.connect();
  return {
    query: (text, params) => conn.query(text, params),
    connect: async () => conn,
    end: () => conn.end(),
  };
}
