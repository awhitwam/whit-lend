# WhitLend MCP server

Read-only MCP server for interrogating the loan book in natural language. Runs locally
over stdio and is registered with Claude Desktop.

It is a **separate package** from the web app: its own `package.json` and
`node_modules`, deliberately outside `src/` so it is invisible to `npm run build`,
`npm run lint` and `npm run typecheck` at the repo root.

## Setup

### 1. Create a dedicated read-only account

Never use your own login. This account's password sits in a plaintext `.env`.

1. Supabase dashboard → **Authentication → Users → Add user → Create new user**.
   Email `mcp-readonly@yourdomain`, a long random password, **Auto Confirm User = ON**
   (without it, sign-in fails with `email_not_confirmed`).
2. Copy the new user's UUID.
3. Find your organization id: `select id, name from organizations;`
4. Grant read access, in the SQL editor:

   ```sql
   insert into organization_members (organization_id, user_id, role, is_active, joined_at)
   values ('<org-uuid>', '<mcp-user-uuid>', 'Viewer', true, now());
   ```

5. Confirm it is not a super-admin:
   `select is_super_admin from user_profiles where id = '<mcp-user-uuid>';`
   It must be `false` or the row must not exist. A super-admin account sees every
   organization, and the server refuses to start against one.
6. **Do not enrol MFA** on this account. No RLS policy references assurance level, so a
   password session is sufficient; MFA is enforced app-side only.

### 2. Configure

```bash
cd mcp-server
cp .env.example .env    # then fill it in
npm install
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are the same values the web app uses (repo root
`.env`). Both `.env` and `.env.example` are covered by the root `.gitignore`.

### 3. Verify before wiring it up

```bash
npm test                      # offline: 35 assertions against the real backup export
npm run smoke                 # live: credentials, org resolution, row counts
npm run smoke -- --expect-denied   # live: proves the read-only guards bite
npm run inspect               # browser UI to click through every tool
```

### 4. Register with Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json` (the folder appears after Claude Desktop
has been launched once):

```json
{
  "mcpServers": {
    "whitlend": {
      "command": "node",
      "args": ["C:\\Users\\whitw\\Documents\\Projects\\whit-lend\\mcp-server\\src\\index.js"]
    }
  }
}
```

Absolute path, escaped backslashes. If `node` is not on the PATH Claude Desktop
inherits, use the full path from `where node`. Quit Claude Desktop fully from the tray
icon — closing the window is not enough. Logs land in
`%APPDATA%\Claude\logs\mcp-server-whitlend.log`.

## Tools

| Tool | Answers |
|---|---|
| `portfolio_summary` | Book totals, counts by status, outstanding, total received |
| `find_loans` | Filter by borrower, status, product, amount, start date |
| `get_loan` | One loan in full: terms, balance, repayments, security, schedule |
| `list_products` | Configured loan products and their terms |
| `find_borrowers` | Search by name, business or `unique_number` |
| `get_borrower` | One borrower, their loans and lifetime repayments |
| `list_transactions` | Repayments and disbursements with totals |
| `payments_due` | Scheduled installments in a window |
| `arrears_report` | Loans behind, computed two ways, with a data-quality gate |

Every response ends with a footer naming the organization, the row count, and the
balance as-of time.

## Read-only enforcement

Four layers in code. The database will not stop writes — RLS policies here are
org-scoped, not role-scoped, so `Viewer` still permits INSERT at the DB level.

1. No write code exists in the server.
2. **Builder proxy** — tools reach the query builder through a `Proxy` that throws on
   anything outside a read allowlist. `.insert`, `.update`, `.delete`, `.upsert` and
   `.rpc` are unreachable.
3. **Table and column allowlist** (`src/db.js`) — `select()` is never a wildcard. A
   sensitive column added to a table later is not silently exposed.
4. **HTTP method fence** — a wrapping `fetch` throws on anything that is not GET/HEAD,
   except the auth token and logout endpoints. A write never leaves the process.

## What it will not read

`audit_logs`, `bank_statements`, `reconciliation_*`, `google_drive_tokens`,
`trusted_devices`, `invitations`, `receipt_drafts`, `letter_templates`,
`generated_letters`, `loan_comments`, and the investor tables.

`borrowers.id_number` and `borrowers.gender` are never returned. Contact details and
free-text notes are withheld unless a tool call opts in — set `WHITLEND_MCP_PII=full`
to return contact details by default.

Everything a tool returns is sent to Anthropic's API by Claude Desktop. The redaction
default is data minimisation, not a security boundary.

## Data caveats

The server knows which stored figures are trustworthy and says so in its output. The
full list is published as the MCP resource `whitlend://data-caveats`. The short version:

- **`loans.principal_remaining` is trusted** — trigger-maintained by migration 054, and
  always reported with `balance_updated_at`.
- **`loans.principal_paid` / `interest_paid` are not** — nothing maintains them. Loan
  1000036 reads `principal_paid = 0` while £1.28m of principal has been repaid. They are
  not in the column allowlist; amounts repaid are summed from `transactions` instead.
- **`loans.interest_remaining` is not** — the column exists but migration 054 never
  populates it. Shown by `get_loan` only, under an explicit "cached, unverified" label.
- **`organization_summary` is never read** — client-written and observed stale.
- **There is no `maturity_date` column** — `contract_end_date` is computed as
  `start_date + duration`, with the unit from `period`. Most live loans have
  `auto_extend` set, so a past contract end is not a maturity.
- **Arrears may be uncomputable.** They depend on `repayment_schedules.principal_paid` /
  `interest_paid`, which are unpopulated on a bulk-imported book. `arrears_report`
  measures this at query time and withholds a headline figure when the data cannot
  support one — on the January 2026 export the naive formula produces £26.6m of arrears
  on a £9.4m book.

The server does not model interest. It reports stored values and sums stored rows.
Payoff and settlement figures need the interest engine and are out of scope.
