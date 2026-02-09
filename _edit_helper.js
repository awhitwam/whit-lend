const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'pages', 'LoanDetails.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// Find the disbursements tab block
// It starts with: {activeTab === 'disbursements' && (
//   <Card>
// And ends just before: {activeTab === 'security' && (

const lines = content.split('\n');

let startLine = -1;
let endLine = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("activeTab === 'disbursements'") && lines[i].includes('&&')) {
    startLine = i;
  }
  if (startLine !== -1 && endLine === -1 && lines[i].includes("activeTab === 'security'") && lines[i].includes('&&')) {
    // The end is the line before the blank line before security
    // Go back to find the closing )}
    for (let j = i - 1; j > startLine; j--) {
      if (lines[j].trim() === ')}') {
        endLine = j;
        break;
      }
    }
    break;
  }
}

console.log('Start line:', startLine + 1, '(0-indexed:', startLine, ')');
console.log('End line:', endLine + 1, '(0-indexed:', endLine, ')');
console.log('Lines to replace:', endLine - startLine + 1);

if (startLine === -1 || endLine === -1) {
  console.log('Could not find markers!');
  process.exit(1);
}

// Show context
console.log('\n--- Start context ---');
console.log(lines.slice(startLine - 1, startLine + 3).join('\n'));
console.log('\n--- End context ---');
console.log(lines.slice(endLine - 1, endLine + 3).join('\n'));

// Build replacement
const indent = '          '; // Match the indentation of the original
const replacement = [
  `${indent}{activeTab === 'disbursements' && (`,
  `${indent}  <DisbursementsTab`,
  `${indent}    transactions={transactions}`,
  `${indent}    loan={loan}`,
  `${indent}    disbursementSort={disbursementSort}`,
  `${indent}    setDisbursementSort={setDisbursementSort}`,
  `${indent}    selectedDisbursements={selectedDisbursements}`,
  `${indent}    setSelectedDisbursements={setSelectedDisbursements}`,
  `${indent}    setIsAddDisbursementOpen={setIsAddDisbursementOpen}`,
  `${indent}    setDeleteDisbursementsDialogOpen={setDeleteDisbursementsDialogOpen}`,
  `${indent}    reconciledTransactionIds={reconciledTransactionIds}`,
  `${indent}    reconciliationMap={reconciliationMap}`,
  `${indent}    acceptedOrphanMap={acceptedOrphanMap}`,
  `${indent}    setEditDisbursementTarget={setEditDisbursementTarget}`,
  `${indent}    setEditDisbursementValues={setEditDisbursementValues}`,
  `${indent}    setEditDisbursementDialogOpen={setEditDisbursementDialogOpen}`,
  `${indent}  />`,
  `${indent})}`
];

// Replace the lines
const newLines = [
  ...lines.slice(0, startLine),
  ...replacement,
  ...lines.slice(endLine + 1)
];

const newContent = newLines.join('\n');

fs.writeFileSync(filePath, newContent, 'utf8');

console.log('\nDone! Replaced', (endLine - startLine + 1), 'lines with', replacement.length, 'lines');
console.log('File saved. New total lines:', newLines.length, '(was:', lines.length, ')');
