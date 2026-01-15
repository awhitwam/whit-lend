/**
 * Loan Comments Import Script
 *
 * Imports historical loan comments from a CSV file.
 *
 * USAGE:
 * 1. First run with DRY_RUN=true to see unique staff names and validate data
 * 2. Fill in the staffMap with user IDs for each staff member
 * 3. Run with DRY_RUN=false to perform the import
 *
 * CSV Expected Columns:
 * - Date: timestamp like "21/10/2020 8:54am"
 * - Staff: user name like "Andrew Whitwam"
 * - Comments: the comment text
 * - Loan: loan number to match existing loans
 */

import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';

// ============================================
// CONFIGURATION - EDIT THESE VALUES
// ============================================

// Set to true to preview without making changes
const DRY_RUN = true;

// Organization ID to import comments into
const ORGANIZATION_ID = 'YOUR_ORGANIZATION_ID_HERE';

// Path to your CSV file
const CSV_FILE_PATH = './360 loan comments.csv';

// Map staff names from CSV to user IDs in your organization
// Run with DRY_RUN=true first to see all unique staff names
const staffMap = {
  // 'Andrew Whitwam': 'uuid-of-andrew-whitwam',
  // 'Andrew Pearse': 'uuid-of-andrew-pearse',
  // Add more mappings as needed
};

// Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SERVICE_ROLE_KEY';

// ============================================
// END CONFIGURATION
// ============================================

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Parse UK date format "21/10/2020 8:54am" to ISO string
 */
function parseUKDate(dateStr) {
  if (!dateStr) return null;

  // Handle format: "21/10/2020 8:54am" or "21/10/2020"
  const parts = dateStr.trim().split(' ');
  const datePart = parts[0];
  const timePart = parts[1] || '12:00pm';

  // Parse date: dd/mm/yyyy
  const [day, month, year] = datePart.split('/').map(Number);

  // Parse time: 8:54am or 14:30
  let hours = 0;
  let minutes = 0;

  if (timePart) {
    const timeMatch = timePart.match(/^(\d{1,2}):?(\d{2})?(am|pm)?$/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2] || '0', 10);
      const ampm = (timeMatch[3] || '').toLowerCase();

      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
    }
  }

  const date = new Date(year, month - 1, day, hours, minutes);
  return date.toISOString();
}

async function main() {
  console.log('='.repeat(60));
  console.log('Loan Comments Import Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE IMPORT'}`);
  console.log('');

  // Check configuration
  if (ORGANIZATION_ID === 'YOUR_ORGANIZATION_ID_HERE') {
    console.error('ERROR: Please set ORGANIZATION_ID in the configuration');
    process.exit(1);
  }

  // Read and parse CSV
  console.log(`Reading CSV file: ${CSV_FILE_PATH}`);
  const csvPath = path.resolve(CSV_FILE_PATH);

  if (!fs.existsSync(csvPath)) {
    console.error(`ERROR: CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`Found ${records.length} rows in CSV`);
  console.log('');

  // Collect unique staff names
  const uniqueStaff = new Set();
  const uniqueLoanNumbers = new Set();

  records.forEach(row => {
    if (row.Staff) uniqueStaff.add(row.Staff);
    if (row.Loan) uniqueLoanNumbers.add(row.Loan);
  });

  console.log('Unique Staff Names Found:');
  console.log('-'.repeat(40));
  [...uniqueStaff].sort().forEach(name => {
    const mapped = staffMap[name] ? `→ ${staffMap[name]}` : '(NOT MAPPED)';
    console.log(`  ${name} ${mapped}`);
  });
  console.log('');

  // Fetch existing loans for this organization
  console.log('Fetching existing loans...');
  const { data: loans, error: loansError } = await supabase
    .from('loans')
    .select('id, loan_number')
    .eq('organization_id', ORGANIZATION_ID);

  if (loansError) {
    console.error('ERROR fetching loans:', loansError);
    process.exit(1);
  }

  // Create loan number to ID map
  const loanMap = {};
  loans.forEach(loan => {
    loanMap[loan.loan_number] = loan.id;
  });

  console.log(`Found ${loans.length} loans in organization`);
  console.log('');

  // Validate loan numbers from CSV
  const missingLoans = [];
  uniqueLoanNumbers.forEach(loanNum => {
    if (!loanMap[loanNum]) {
      missingLoans.push(loanNum);
    }
  });

  if (missingLoans.length > 0) {
    console.log('WARNING: Some loan numbers from CSV not found in database:');
    missingLoans.forEach(num => console.log(`  ${num}`));
    console.log('');
  }

  // Check for unmapped staff
  const unmappedStaff = [...uniqueStaff].filter(name => !staffMap[name]);
  if (unmappedStaff.length > 0 && !DRY_RUN) {
    console.log('WARNING: Some staff members are not mapped to user IDs:');
    unmappedStaff.forEach(name => console.log(`  ${name}`));
    console.log('Comments from unmapped staff will have user_id = null');
    console.log('');
  }

  // Prepare comments for import
  const commentsToImport = [];
  const skipped = [];

  records.forEach((row, idx) => {
    const loanNumber = row.Loan;
    const loanId = loanMap[loanNumber];

    if (!loanId) {
      skipped.push({ row: idx + 2, reason: `Loan ${loanNumber} not found` });
      return;
    }

    if (!row.Comments || !row.Comments.trim()) {
      skipped.push({ row: idx + 2, reason: 'Empty comment' });
      return;
    }

    const staffName = row.Staff || 'Unknown';
    const userId = staffMap[staffName] || null;
    const createdAt = parseUKDate(row.Date) || new Date().toISOString();

    commentsToImport.push({
      organization_id: ORGANIZATION_ID,
      loan_id: loanId,
      user_id: userId,
      user_name: staffName,
      comment: row.Comments.trim(),
      created_at: createdAt
    });
  });

  console.log('Import Summary:');
  console.log('-'.repeat(40));
  console.log(`  Comments to import: ${commentsToImport.length}`);
  console.log(`  Skipped rows: ${skipped.length}`);
  console.log('');

  if (skipped.length > 0 && skipped.length <= 20) {
    console.log('Skipped rows:');
    skipped.forEach(s => console.log(`  Row ${s.row}: ${s.reason}`));
    console.log('');
  }

  // Preview first few comments
  if (commentsToImport.length > 0) {
    console.log('Sample comments to import:');
    console.log('-'.repeat(40));
    commentsToImport.slice(0, 5).forEach((c, i) => {
      console.log(`${i + 1}. [${c.created_at.substring(0, 10)}] ${c.user_name}`);
      console.log(`   Loan: ${Object.keys(loanMap).find(k => loanMap[k] === c.loan_id)}`);
      console.log(`   Comment: ${c.comment.substring(0, 100)}${c.comment.length > 100 ? '...' : ''}`);
      console.log('');
    });
  }

  // Perform import if not dry run
  if (DRY_RUN) {
    console.log('='.repeat(60));
    console.log('DRY RUN COMPLETE - No changes made');
    console.log('');
    console.log('Next steps:');
    console.log('1. Review the output above');
    console.log('2. Fill in the staffMap with user IDs');
    console.log('3. Set DRY_RUN = false');
    console.log('4. Run the script again to import');
    console.log('='.repeat(60));
  } else {
    console.log('Starting import...');

    // Insert in batches of 100
    const BATCH_SIZE = 100;
    let imported = 0;

    for (let i = 0; i < commentsToImport.length; i += BATCH_SIZE) {
      const batch = commentsToImport.slice(i, i + BATCH_SIZE);

      const { error: insertError } = await supabase
        .from('loan_comments')
        .insert(batch);

      if (insertError) {
        console.error(`ERROR inserting batch ${i / BATCH_SIZE + 1}:`, insertError);
        process.exit(1);
      }

      imported += batch.length;
      console.log(`  Imported ${imported}/${commentsToImport.length} comments...`);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`IMPORT COMPLETE: ${imported} comments imported`);
    console.log('='.repeat(60));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
