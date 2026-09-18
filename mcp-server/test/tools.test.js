import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildServer } from '../src/server.js';
import { createFakeSession } from './fakedb.js';

const FIXTURE = path.join(
  import.meta.dirname, '..', '..', 'docs', 'backup files',
  'backup-ADW-Enterprises-Limited-2026-01-10-0840 (FRESH IMPORT).json'
);
const available = fs.existsSync(FIXTURE);
const skip = available ? false : 'backup fixture not present';

const EXPECTED_TOOLS = [
  'portfolio_summary', 'find_loans', 'get_loan', 'list_products',
  'find_borrowers', 'get_borrower',
  'list_transactions', 'payments_due', 'arrears_report'
];

async function connect() {
  const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const session = createFakeSession(backup.tables, {
    id: backup.organizationId,
    name: backup.organizationName,
    role: 'Viewer'
  });
  const { server } = buildServer(session);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

const textOf = (result) => result.content.map((c) => c.text).join('\n');

test('server exposes exactly the expected tools', { skip }, async () => {
  const { client, server } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort());
  for (const t of tools) {
    assert.ok(t.description?.length > 40, `${t.name} needs a real description`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} must be marked read-only`);
  }
  await server.close();
});

test('the data-caveats resource is published', { skip }, async () => {
  const { client, server } = await connect();
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === 'whitlend://data-caveats'));
  const read = await client.readResource({ uri: 'whitlend://data-caveats' });
  assert.match(read.contents[0].text, /principal_remaining/);
  await server.close();
});

test('portfolio_summary reports the trustworthy outstanding total', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({ name: 'portfolio_summary', arguments: {} }));
  assert.match(out, /£9,422,122\.86/, 'outstanding must come from principal_remaining');
  assert.match(out, /active \(Live\/Active\): 31/);
  assert.match(out, /Live: 31/);
  assert.match(out, /Closed: 84/);
  assert.match(out, /org: ADW Enterprises Limited/);
  assert.doesNotMatch(out, /principal_paid/);
  await server.close();
});

test('find_loans lists active loans with outstanding balances', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({
    name: 'find_loans',
    arguments: { active_only: true, limit: 50 }
  }));
  assert.match(out, /1000036/);
  assert.match(out, /Live/);
  assert.match(out, /outstanding/);
  assert.doesNotMatch(out, /undefined/);
  await server.close();
});

test('find_loans filters by borrower through the embedded join', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({
    name: 'find_loans',
    arguments: { borrower_query: 'Bonding', limit: 20 }
  }));
  assert.match(out, /Bonding/i);
  await server.close();
});

test('get_loan reconciles stored outstanding against transactions', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({
    name: 'get_loan',
    arguments: { loan_number: '1000036' }
  }));
  assert.match(out, /Loan 1000036/);
  assert.match(out, /contract end \(start_date \+ duration\): 2034-09-08/);
  assert.match(out, /auto_extend is on/);
  assert.match(out, /£116,808\.75/, 'outstanding from principal_remaining');
  assert.match(out, /Repayments to date/);
  // The stale column is never presented as fact.
  assert.doesNotMatch(out, /principal_paid/);
  await server.close();
});

test('get_loan labels interest_remaining as unverified when present', { skip }, async () => {
  const { client, server } = await connect();
  const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const withInterest = backup.tables.loans.find((l) => l.interest_remaining != null && !l.is_deleted);
  if (!withInterest) return; // none in this export
  const out = textOf(await client.callTool({
    name: 'get_loan',
    arguments: { loan_number: withInterest.loan_number }
  }));
  assert.match(out, /Cached, unverified/);
  await server.close();
});

test('get_loan reports a clear miss for an unknown number', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({ name: 'get_loan', arguments: { loan_number: 'nope' } }));
  assert.match(out, /No loan found/);
  await server.close();
});

test('find_borrowers returns identity and position, not contact details', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({
    name: 'find_borrowers',
    arguments: { query: 'a', limit: 10 }
  }));
  assert.match(out, /number \| name \| business \| status \| loans \| active \| outstanding/);
  assert.doesNotMatch(out, /@/, 'no email addresses by default');
  await server.close();
});

test('get_borrower withholds contact details unless asked', { skip }, async () => {
  const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const target = backup.tables.borrowers.find((b) => b.email || b.phone);
  const { client, server } = await connect();

  const closed = textOf(await client.callTool({
    name: 'get_borrower',
    arguments: { unique_number: target.unique_number }
  }));
  assert.match(closed, /\(withheld - call again with include_contact: true/);
  if (target.email) assert.ok(!closed.includes(target.email));

  const opened = textOf(await client.callTool({
    name: 'get_borrower',
    arguments: { unique_number: target.unique_number, include_contact: true }
  }));
  if (target.email) assert.match(opened, new RegExp(target.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // id_number and gender are never returned, on either path.
  if (target.id_number) {
    assert.ok(!closed.includes(target.id_number));
    assert.ok(!opened.includes(target.id_number));
  }
  await server.close();
});

test('list_transactions totals the rows it shows', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({
    name: 'list_transactions',
    arguments: { type: 'Repayment', limit: 20 }
  }));
  assert.match(out, /Totals for the rows shown/);
  assert.match(out, /amount: £/);
  assert.match(out, /these totals cover only the 20 shown/, 'must flag partial totals');
  await server.close();
});

test('payments_due surfaces that no schedule row records a payment', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({
    name: 'payments_due',
    arguments: { window: 'overdue', limit: 20 }
  }));
  assert.match(out, /none of these rows record any payment/);
  assert.match(out, /list_transactions/, 'must point at the reliable alternative');
  await server.close();
});

test('arrears_report refuses a headline figure on this data', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({
    name: 'arrears_report',
    arguments: { as_of: '2026-01-10' }
  }));
  assert.match(out, /data_quality: UNRELIABLE/);
  assert.match(out, /no headline arrears figure is being reported/);
  assert.match(out, /not to be quoted as an arrears figure/);
  // The absurd number must never appear as a headline.
  assert.doesNotMatch(out, /schedule-based total:/);
  await server.close();
});

test('list_products describes the configured products', { skip }, async () => {
  const { client, server } = await connect();
  const out = textOf(await client.callTool({ name: 'list_products', arguments: {} }));
  assert.match(out, /loan product/);
  assert.match(out, /name \| rate \| interest type/);
  await server.close();
});

test('every tool stays within a sane token budget', { skip }, async () => {
  const { client, server } = await connect();
  const calls = [
    ['portfolio_summary', {}],
    ['find_loans', { active_only: true, limit: 50 }],
    ['get_loan', { loan_number: '1000036' }],
    ['find_borrowers', { query: 'a', limit: 25 }],
    ['list_transactions', { limit: 100 }],
    ['payments_due', { window: 'overdue', limit: 100 }],
    ['arrears_report', {}],
    ['list_products', {}]
  ];
  for (const [name, args] of calls) {
    const out = textOf(await client.callTool({ name, arguments: args }));
    assert.ok(out.length > 0, `${name} returned nothing`);
    assert.ok(out.length < 20000, `${name} returned ${out.length} chars - too expensive`);
    assert.match(out, /generated: /, `${name} must end with the footer`);
  }
  await server.close();
});

test('a tool failure comes back as content, not a thrown transport error', { skip }, async () => {
  const backup = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const session = createFakeSession(backup.tables, { id: backup.organizationId, name: 'x', role: 'Viewer' });
  session.run = async () => { throw new Error('simulated database outage'); };
  const { server } = buildServer(session);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);

  const result = await client.callTool({ name: 'portfolio_summary', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /simulated database outage/);
  await server.close();
});
