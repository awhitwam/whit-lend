import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from './LoanCalculator';

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan, viewType = 'ledger' }) {
  if (viewType === 'ledger') {
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
              <TableHead className="font-semibold text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(6).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5} className="h-14">
                    <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                  </TableCell>
                </TableRow>
              ))
            ) : ledgerEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-slate-500">
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

  // Schedule view - show expected installments with running totals
  const scheduleWithTotals = schedule.map((row, index) => {
    const interestReceived = transactions
      .filter(tx => !tx.is_deleted && new Date(tx.date) <= new Date(row.due_date))
      .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
    
    return {
      ...row,
      cumulativeInterest: schedule.slice(0, index + 1).reduce((sum, r) => sum + r.interest_amount, 0),
      interestReceived,
      interestDue: schedule.slice(0, index + 1).reduce((sum, r) => sum + r.interest_amount, 0) - interestReceived
    };
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/50">
            <TableHead className="font-semibold">#</TableHead>
            <TableHead className="font-semibold">Due Date</TableHead>
            <TableHead className="font-semibold text-right">Interest Due</TableHead>
            <TableHead className="font-semibold text-right">Cumulative</TableHead>
            <TableHead className="font-semibold text-right">Received</TableHead>
            <TableHead className="font-semibold text-right">Outstanding</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
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
          ) : scheduleWithTotals.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                No schedule generated
              </TableCell>
            </TableRow>
          ) : (
            scheduleWithTotals.map((row) => (
              <TableRow key={row.id} className={new Date(row.due_date) < new Date() && row.interestDue > 0 ? 'bg-red-50/50' : ''}>
                <TableCell className="font-medium">#{row.installment_number}</TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{format(new Date(row.due_date), 'MMM dd, yyyy')}</p>
                    <p className="text-xs text-slate-500">{format(new Date(row.due_date), 'EEEE')}</p>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(row.interest_amount)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold">
                  {formatCurrency(row.cumulativeInterest)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-emerald-600">
                  {formatCurrency(row.interestReceived)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold text-red-600">
                  {formatCurrency(row.interestDue)}
                </TableCell>
                <TableCell>
                  <Badge 
                    className={
                      row.interestDue <= 0 
                        ? 'bg-emerald-100 text-emerald-700' 
                        : new Date(row.due_date) < new Date()
                        ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-700'
                    }
                  >
                    {row.interestDue <= 0 ? 'Paid' : new Date(row.due_date) < new Date() ? 'Overdue' : 'Pending'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}