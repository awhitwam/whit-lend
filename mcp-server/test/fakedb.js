import { num } from '../src/format.js';

/**
 * A small in-memory stand-in for the PostgREST builder, backed by the real backup
 * export. Enough of the surface for the tools to run end to end offline: filters,
 * ordering, paging, exact counts, and the handful of embedded selects the tools use.
 */

const EMBEDS = {
  // parent table -> embed name -> { table, fk, on }
  loans: {
    borrowers: { table: 'borrowers', fk: 'borrower_id', on: 'id' }
  },
  transactions: {
    loans: { table: 'loans', fk: 'loan_id', on: 'id' }
  },
  loan_properties: {
    properties: { table: 'properties', fk: 'property_id', on: 'id' },
    first_charge_holders: { table: 'first_charge_holders', fk: 'first_charge_holder_id', on: 'id' }
  },
  organization_members: {
    organizations: { table: 'organizations', fk: 'organization_id', on: 'id' }
  }
};

/** Top-level embed names in a select string, e.g. "a,b!inner(x,y),c(z)" -> ["b","c"]. */
function parseEmbeds(select) {
  const names = [];
  let depth = 0;
  let token = '';
  for (const ch of select) {
    if (ch === '(') {
      if (depth === 0 && token) names.push(token.replace('!inner', '').split(',').pop().trim());
      depth += 1;
      token = '';
    } else if (ch === ')') {
      depth -= 1;
    } else if (depth === 0) {
      token += ch;
    }
  }
  return names.filter(Boolean);
}

function matchIlike(value, pattern) {
  const body = String(pattern).replace(/^%|%$/g, '').replace(/\\(.)/g, '$1');
  return String(value ?? '').toLowerCase().includes(body.toLowerCase());
}

/** Evaluate one PostgREST or() clause, e.g. `is_deleted.is.null` or `full_name.ilike."%x%"`. */
function evalClause(row, clause) {
  const m = clause.match(/^([\w.]+)\.(is|eq|neq|ilike|gte|lte|gt|lt)\.(.*)$/);
  if (!m) return false;
  const [, column, op, rawValue] = m;
  const value = row[column.split('.').pop()];
  const target = rawValue.replace(/^"|"$/g, '');
  switch (op) {
    case 'is': return target === 'null' ? value == null : String(value) === target;
    case 'eq': return String(value) === target;
    case 'neq': return String(value) !== target;
    case 'ilike': return matchIlike(value, target);
    case 'gte': return value >= target;
    case 'lte': return value <= target;
    case 'gt': return value > target;
    case 'lt': return value < target;
    default: return false;
  }
}

/** Split an or() filter on top-level commas, respecting quotes and parentheses. */
function splitClauses(filter) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let token = '';
  for (const ch of filter) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (ch === ',' && depth === 0 && !quoted) { out.push(token); token = ''; continue; }
    token += ch;
  }
  if (token) out.push(token);
  return out;
}

class FakeBuilder {
  constructor(tables, table, rows) {
    this.tables = tables;
    this.table = table;
    this.rows = rows;
    this.selectStr = '*';
    this.wantCount = false;
    this.ops = [];
    this.limitN = null;
    this.rangeN = null;
    this.orderBy = null;
    this.single = false;
  }

  select(str = '*', opts = {}) {
    this.selectStr = str;
    if (opts.count === 'exact') this.wantCount = true;
    return this;
  }

  eq(col, val) { this.ops.push((r) => String(this._get(r, col)) === String(val)); return this; }
  neq(col, val) { this.ops.push((r) => String(this._get(r, col)) !== String(val)); return this; }
  in(col, vals) { const s = new Set(vals.map(String)); this.ops.push((r) => s.has(String(this._get(r, col)))); return this; }
  gte(col, val) { this.ops.push((r) => this._get(r, col) >= val); return this; }
  lte(col, val) { this.ops.push((r) => this._get(r, col) <= val); return this; }
  gt(col, val) { this.ops.push((r) => this._get(r, col) > val); return this; }
  lt(col, val) { this.ops.push((r) => this._get(r, col) < val); return this; }
  is(col, val) { this.ops.push((r) => (val === null ? this._get(r, col) == null : this._get(r, col) === val)); return this; }
  ilike(col, pattern) { this.ops.push((r) => matchIlike(this._get(r, col), pattern)); return this; }

  or(filter, opts = {}) {
    const clauses = splitClauses(filter);
    const ref = opts.referencedTable;
    this.ops.push((row) => {
      const targets = ref
        ? [ref.split('.').reduce((acc, k) => (acc ? acc[k] : null), this._embedded(row))].filter(Boolean)
        : [row];
      return targets.some((t) => clauses.some((c) => evalClause(t, c)));
    });
    return this;
  }

  order(col, opts = {}) { this.orderBy = { col, asc: opts.ascending !== false }; return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeN = [from, to]; return this; }
  maybeSingle() { this.single = true; return this; }
  abortSignal() { return this; }

  _get(row, col) {
    if (!col.includes('.')) return row[col];
    // Embedded filter path, e.g. loans.loan_number
    const [embed, ...rest] = col.split('.');
    const joined = this._embedded(row)[embed];
    return joined ? joined[rest.join('.')] : undefined;
  }

  /** Lazily attach embedded rows so filters and output can both see them. */
  _embedded(row) {
    if (row.__embedded) return row.__embedded;
    const attached = {};
    const map = EMBEDS[this.table] || {};
    for (const [name, spec] of Object.entries(map)) {
      const parent = (this.tables[spec.table] || []).find((p) => p[spec.on] === row[spec.fk]);
      if (parent) {
        attached[name] = { ...parent };
        // One level of nesting: loans -> borrowers
        const nested = EMBEDS[spec.table] || {};
        for (const [n2, s2] of Object.entries(nested)) {
          const gp = (this.tables[s2.table] || []).find((p) => p[s2.on] === parent[s2.fk]);
          if (gp) attached[name][n2] = { ...gp };
        }
      }
    }
    Object.defineProperty(row, '__embedded', { value: attached, enumerable: false });
    return attached;
  }

  async _run() {
    let rows = this.rows.filter((r) => this.ops.every((op) => op(r)));
    const count = rows.length;

    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        return asc ? cmp : -cmp;
      });
    }

    if (this.rangeN) rows = rows.slice(this.rangeN[0], this.rangeN[1] + 1);
    else if (this.limitN != null) rows = rows.slice(0, this.limitN);

    const wanted = parseEmbeds(this.selectStr);
    const shaped = rows.map((r) => {
      const out = { ...r };
      delete out.__embedded;
      const embedded = this._embedded(r);
      for (const name of wanted) if (embedded[name]) out[name] = embedded[name];
      return out;
    });

    if (this.single) return { data: shaped[0] ?? null, error: null };
    return { data: shaped, error: null, count: this.wantCount ? count : undefined };
  }

  then(resolve, reject) { return this._run().then(resolve, reject); }
  catch(reject) { return this._run().catch(reject); }
  finally(fn) { return this._run().finally(fn); }
}

/** A db handle with the same shape tools receive from createReadOnlyDb. */
export function createFakeDb(tables, orgId) {
  return {
    orgId,
    from(table) { return new FakeBuilder(tables, table, tables[table] || []); },
    scoped(table) { return this.from(table).eq('organization_id', orgId); },
    notDeleted(builder) { return builder.or('is_deleted.is.null,is_deleted.eq.false'); },
    clampLimit(requested, fallback) {
      const n = Number.isFinite(Number(requested)) ? Number(requested) : fallback;
      return Math.max(1, Math.min(n, 200));
    },
    signal() { return undefined; }
  };
}

/** A Session stand-in: no network, no credentials. */
export function createFakeSession(tables, org) {
  const db = createFakeDb(tables, org.id);
  return {
    org,
    db,
    async ensureReady() { return this; },
    async run(fn) { return fn(db); },
    async close() {}
  };
}

export { num };
