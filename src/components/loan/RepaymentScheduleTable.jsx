import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from './LoanCalculator';

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan }) {
  // Create ledger entries
  const ledgerEntries = [];
  
  // Add loan disbursement as first entry
  if (loan) {
    ledgerEntries.push({
      type: 'disbursement',
      date: new Date(loan.start_date),
      description: 'Loan Disbursement',
      debit: loan.principal_amount,
      credit: 0,
      balance: -loan.principal_amount
    });
  }
  
  // Add all transactions (actual repayments)
  transactions
    .filter(tx => !tx.is_deleted)
    .forEach(tx => {
      if (tx.type === 'Repayment') {
        ledgerEntries.push({
          type: 'repayment',
          date: new Date(tx.date),
          description: `Payment Received${tx.reference ? ` - ${tx.reference}` : ''}`,
          debit: 0,
          credit: tx.amount,
          principal: tx.principal_applied || 0,
          interest: tx.interest_applied || 0,
          reference: tx.reference,
          notes: tx.notes
        });
      }
    });
  
  // Sort by date
  ledgerEntries.sort((a, b) => a.date - b.date);
  
  // Calculate running balance (principal only)
  let runningBalance = 0;
  ledgerEntries.forEach(entry => {
    if (entry.type === 'disbursement') {
      runningBalance = -entry.debit;
    } else {
      // Only principal payments reduce the balance
      runningBalance += entry.principal;
    }
    entry.runningBalance = runningBalance;
  });



  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/50">
            <TableHead className="font-semibold">Date</TableHead>
            <TableHead className="font-semibold">Description</TableHead>
            <TableHead className="font-semibold text-right">Principal</TableHead>
            <TableHead className="font-semibold text-right">Interest</TableHead>
            <TableHead className="font-semibold text-right">Debit</TableHead>
            <TableHead className="font-semibold text-right">Credit</TableHead>
            <TableHead className="font-semibold text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7} className="h-14">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                </TableCell>
              </TableRow>
            ))
          ) : ledgerEntries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                No transaction history
              </TableCell>
            </TableRow>
          ) : (
            ledgerEntries.map((entry, index) => (
              <TableRow 
                key={index}
                className={entry.type === 'disbursement' ? 'bg-red-50/50 border-l-4 border-red-500' : 'bg-emerald-50/50 border-l-4 border-emerald-500'}
              >
                <TableCell>
                  <div>
                    <p className="font-medium">{format(entry.date, 'MMM dd, yyyy')}</p>
                    <p className="text-xs text-slate-500">{format(entry.date, 'EEEE')}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{entry.description}</p>
                    {entry.notes && <p className="text-xs text-slate-500 mt-1">{entry.notes}</p>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {entry.principal > 0 ? formatCurrency(entry.principal) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {entry.interest > 0 ? formatCurrency(entry.interest) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold text-red-600">
                  {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold text-emerald-600">
                  {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                </TableCell>
                <TableCell className={`text-right font-mono font-bold ${entry.runningBalance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCurrency(Math.abs(entry.runningBalance))} {entry.runningBalance < 0 ? 'DR' : 'CR'}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}