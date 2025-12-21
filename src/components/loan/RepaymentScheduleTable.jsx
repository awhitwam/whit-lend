import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from './LoanCalculator';

export default function RepaymentScheduleTable({ schedule, isLoading, transactions = [], loan }) {
  // Calculate totals
  const totalPrincipalCollected = transactions
    .filter(tx => !tx.is_deleted)
    .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
  
  const totalInterestCollected = transactions
    .filter(tx => !tx.is_deleted)
    .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  
  // Create combined entries with all unique dates
  const allDates = new Set();
  
  // Add disbursement date
  if (loan) {
    allDates.add(format(new Date(loan.start_date), 'yyyy-MM-dd'));
  }
  
  // Add all transaction dates
  transactions.filter(tx => !tx.is_deleted).forEach(tx => {
    allDates.add(format(new Date(tx.date), 'yyyy-MM-dd'));
  });
  
  // Add all schedule dates
  schedule.forEach(row => {
    allDates.add(format(new Date(row.due_date), 'yyyy-MM-dd'));
  });
  
  // Create combined rows
  const combinedRows = Array.from(allDates)
    .sort()
    .map(dateStr => {
      const date = new Date(dateStr);
      
      // Find matching transaction(s)
      const txs = transactions.filter(tx => 
        !tx.is_deleted && format(new Date(tx.date), 'yyyy-MM-dd') === dateStr
      );
      
      // Find matching schedule entry
      const scheduleEntry = schedule.find(s => 
        format(new Date(s.due_date), 'yyyy-MM-dd') === dateStr
      );
      
      // Check if this is the disbursement date
      const isDisbursement = loan && format(new Date(loan.start_date), 'yyyy-MM-dd') === dateStr;
      
      return {
        date,
        dateStr,
        isDisbursement,
        transactions: txs,
        scheduleEntry
      };
    });
  
  // Calculate running balances and cumulative interest
  let runningBalance = 0;
  let cumulativeInterest = 0;
  let interestReceived = 0;
  
  // Calculate the expected interest per period for extended periods
  const lastScheduleEntry = schedule.length > 0 ? schedule[schedule.length - 1] : null;
  const expectedInterestPerPeriod = lastScheduleEntry ? lastScheduleEntry.interest_amount : 0;
  
  combinedRows.forEach(row => {
    if (row.isDisbursement) {
      runningBalance = -loan.principal_amount;
    }
    
    // Add principal from transactions
    row.transactions.forEach(tx => {
      runningBalance += tx.principal_applied || 0;
      interestReceived += tx.interest_applied || 0;
    });
    
    // Add expected interest from schedule OR calculate for extended periods
    if (row.scheduleEntry) {
      cumulativeInterest += row.scheduleEntry.interest_amount;
      row.expectedInterest = row.scheduleEntry.interest_amount;
    } else if (lastScheduleEntry && row.date > new Date(lastScheduleEntry.due_date)) {
      // For dates after schedule ends, continue accruing interest at the same rate
      cumulativeInterest += expectedInterestPerPeriod;
      row.expectedInterest = expectedInterestPerPeriod;
    } else {
      row.expectedInterest = 0;
    }
    
    row.runningBalance = runningBalance;
    row.cumulativeInterest = cumulativeInterest;
    row.interestReceived = interestReceived;
    row.interestOutstanding = cumulativeInterest - interestReceived;
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/50">
            <TableHead className="font-semibold">Date</TableHead>
            <TableHead className="font-semibold" colSpan={2}>Actual Transactions</TableHead>
            <TableHead className="font-semibold text-right">Principal Balance</TableHead>
            <TableHead className="font-semibold" colSpan={2}>Expected Schedule</TableHead>
          </TableRow>
          <TableRow className="bg-slate-50/50 border-t">
            <TableHead></TableHead>
            <TableHead className="font-semibold text-right">
              <div>Principal</div>
              <div className="text-xs text-emerald-600 font-bold mt-1">{formatCurrency(totalPrincipalCollected)}</div>
            </TableHead>
            <TableHead className="font-semibold text-right">
              <div>Interest</div>
              <div className="text-xs text-emerald-600 font-bold mt-1">{formatCurrency(totalInterestCollected)}</div>
            </TableHead>
            <TableHead className="font-semibold text-right">(DR/CR)</TableHead>
            <TableHead className="font-semibold text-right">Interest Due</TableHead>
            <TableHead className="font-semibold text-right">Outstanding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={6} className="h-14">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                </TableCell>
              </TableRow>
            ))
          ) : combinedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                No data available
              </TableCell>
            </TableRow>
          ) : (
            <>
            {combinedRows.map((row, index) => (
              <TableRow 
                key={index}
                className={
                  row.isDisbursement 
                    ? 'bg-red-50/50 border-l-4 border-red-500' 
                    : row.transactions.length > 0
                    ? 'bg-emerald-50/50 border-l-4 border-emerald-500'
                    : ''
                }
              >
                <TableCell>
                  <div>
                    <p className="font-medium">{format(row.date, 'MMM dd, yyyy')}</p>
                    <p className="text-xs text-slate-500">{format(row.date, 'EEEE')}</p>
                  </div>
                </TableCell>
                
                {/* Actual Transactions */}
                <TableCell className="text-right font-mono text-sm">
                  {row.isDisbursement ? (
                    <span className="text-red-600 font-semibold">{formatCurrency(loan.principal_amount)}</span>
                  ) : row.transactions.length > 0 ? (
                    formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0))
                  ) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {row.transactions.length > 0 ? (
                    <span className="text-emerald-600">{formatCurrency(row.transactions.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0))}</span>
                  ) : '-'}
                </TableCell>
                
                {/* Running Balance */}
                <TableCell className={`text-right font-mono font-bold ${row.runningBalance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCurrency(Math.abs(row.runningBalance))} {row.runningBalance < 0 ? 'DR' : 'CR'}
                </TableCell>
                
                {/* Expected Schedule */}
                <TableCell className="text-right font-mono text-sm">
                  {row.expectedInterest > 0 ? formatCurrency(row.expectedInterest) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold text-red-600">
                  {formatCurrency(row.interestOutstanding)}
                </TableCell>
              </TableRow>
            ))}
            {/* Total Row */}
            <TableRow className="bg-slate-100 font-bold border-t-2 border-slate-300">
              <TableCell colSpan={5} className="text-right">Total Outstanding:</TableCell>
              <TableCell className="text-right font-mono text-lg text-red-600">
                {formatCurrency(combinedRows.length > 0 ? combinedRows[combinedRows.length - 1].interestOutstanding : 0)}
              </TableCell>
            </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}