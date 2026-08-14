import fs from 'fs';
import { jsPDF } from 'jspdf';
import { generateAccountantReportPDF } from '@/lib/accountantReportGenerator';

const OUT = process.argv[2] || 'out.pdf';
// jsPDF's save() writes via the browser; capture the doc output instead
jsPDF.API.save = function () {
  fs.writeFileSync(OUT, Buffer.from(this.output('arraybuffer')));
  console.log('pages:', this.internal.getNumberOfPages());
  return this;
};

const rows = [];
const desc = [
  'From MCL SOLUTIONS LIMITED, CORPORATE PAYMENT REFERENCE ABC123456789',
  '34SP.com Ltd Prestwich GB',
  'To ADW Enterprises Ltd, August investor interest distribution',
  'From CHRISTOPHER GEORGIOU'
];
for (let i = 0; i < 120; i++) {
  const split = i % 5 === 0;
  rows.push({
    bankEntryId: `bs-${i}`,
    id: `bs-${i}`,
    bankReference: `0608202${i}-10250-from-mcl-solutions-limited-long-ref`,
    date: '2026-08-06',
    description: desc[i % desc.length],
    isReconciled: i % 7 !== 0,
    notes: i % 7 === 0 ? 'Awaiting confirmation from the borrower about which loan this belongs to' : null,
    isFirstLine: true,
    isContinuation: false,
    amount: i % 3 === 0 ? -43271.71 : 1234567.89,
    type: i % 3 === 0 ? 'Debit' : 'Credit',
    allocatedAmount: 3750,
    reconciledTo: 'Loan Repayment',
    entityDetails: '1000048 - Cornish Mims Leisure Holdings Limited',
    borrowerId: '1000014',
    principalAmount: 0,
    interestAmount: 3750,
    feesAmount: 0,
    splitCount: split ? 2 : 1
  });
  if (split) {
    rows.push({
      ...rows[rows.length - 1],
      id: `bs-${i}:1`,
      isFirstLine: false,
      isContinuation: true,
      amount: null,
      type: null,
      allocatedAmount: 6500
    });
  }
}

generateAccountantReportPDF(rows, {
  fromDate: '2025-08-01',
  toDate: '2026-08-14',
  organization: { name: 'Whit Lend Ltd', address_line1: '1 Example Street', city: 'Leeds', postcode: 'LS1 1AA' }
});
console.log('OK, rows:', rows.length);
