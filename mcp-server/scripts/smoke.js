#!/usr/bin/env node
/**
 * Live connectivity check. No MCP involved - just credentials, RLS scoping, and the
 * data-quality signals the tools depend on.
 *
 *   node scripts/smoke.js                  connect, resolve org, count rows
 *   node scripts/smoke.js --expect-denied   also prove the read-only guards bite
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config.js';
import { Session } from '../src/session.js';
import { TABLES, createGuardedFetch } from '../src/db.js';

const expectDenied = process.argv.includes('--expect-denied');
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); process.exitCode = 1; };

console.log(`WhitLend MCP smoke test\n  env: ${config.envPath}\n  url: ${config.supabaseUrl}\n`);

const session = new Session();

try {
  console.log('Authentication');
  const user = await session.signIn();
  ok(`signed in as ${config.email} (${user.id})`);

  await session.assertNotSuperAdmin();
  ok('account is not flagged is_super_admin');

  const org = await session.resolveOrganization();
  ok(`organization resolved: ${org.name} (${org.id}), role ${org.role}`);

  console.log('\nRow counts (as this account sees them, through RLS)');
  for (const table of Object.keys(TABLES)) {
    if (table === 'organization_members' || table === 'user_profiles') continue;
    const { count, error } = await session.db.from(table)
      .select('id', { count: 'exact' })
      .limit(1);
    if (error) bad(`${table}: ${error.message}`);
    else ok(`${table}: ${count ?? 0}`);
  }

  console.log('\nData quality');
  const { data: loans } = await session.db.scoped('loans')
    .select('id,status,principal_remaining,balance_updated_at,interest_remaining')
    .or('is_deleted.is.null,is_deleted.eq.false')
    .limit(2000);
  const live = (loans || []).filter((l) => ['Live', 'Active'].includes(l.status));
  const outstanding = live.reduce((s, l) => s + Number(l.principal_remaining || 0), 0);
  const stale = (loans || []).filter((l) => l.balance_updated_at == null).length;
  const withInterest = (loans || []).filter((l) => l.interest_remaining != null).length;
  ok(`${live.length} active loans, outstanding ${outstanding.toFixed(2)}`);
  ok(`${stale} loans have no balance_updated_at`);
  ok(`interest_remaining populated on ${withInterest} of ${(loans || []).length} loans (not trusted either way)`);

  // The measurement that decides whether arrears can be reported at all.
  const { data: sched } = await session.db.scoped('repayment_schedules')
    .select('id,principal_paid,interest_paid,status')
    .limit(5000);
  const rows = sched || [];
  const paidRows = rows.filter((r) => Number(r.principal_paid) > 0 || Number(r.interest_paid) > 0);
  const statuses = new Set(rows.map((r) => r.status));
  ok(`repayment_schedules: ${paidRows.length} of ${rows.length} rows record a payment`);
  ok(`schedule statuses present: ${[...statuses].join(', ') || '(none)'}`);
  if (rows.length > 0 && paidRows.length === 0) {
    console.log('  NOTE  the schedule payment columns are unpopulated, so arrears_report will');
    console.log('        withhold a headline figure. That is the intended behaviour.');
  }

  if (expectDenied) {
    console.log('\nRead-only guards (all of these must be refused)');

    try {
      session.db.from('audit_logs');
      bad('audit_logs was reachable - the table allowlist did not bite');
    } catch (err) {
      ok(`table allowlist: ${err.message.slice(0, 60)}...`);
    }

    try {
      session.db.from('loans').insert({ loan_number: 'smoke-test' });
      bad('insert() was reachable - the builder proxy did not bite');
    } catch (err) {
      ok(`builder proxy: ${err.message.slice(0, 60)}...`);
    }

    try {
      session.db.from('loans').delete();
      bad('delete() was reachable - the builder proxy did not bite');
    } catch (err) {
      ok(`builder proxy: ${err.message.slice(0, 60)}...`);
    }

    const guarded = createGuardedFetch();
    try {
      await guarded(`${config.supabaseUrl}/rest/v1/loans`, { method: 'POST', body: '{}' });
      bad('a POST escaped the HTTP method fence');
    } catch (err) {
      ok(`method fence: ${err.message.slice(0, 60)}...`);
    }

    // The anon key with no session must see nothing - this is what proves RLS, not the
    // client-side filter, is doing the tenant scoping.
    const anon = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: leaked, error: anonErr } = await anon.from('loans').select('id').limit(1);
    if (anonErr) ok(`anon key with no session is refused: ${anonErr.message.slice(0, 50)}`);
    else if (!leaked || leaked.length === 0) ok('anon key with no session returns 0 rows');
    else bad(`anon key with no session returned ${leaked.length} rows - RLS is not scoping reads`);
  }

  console.log('\nDone.');
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await session.close();
}
