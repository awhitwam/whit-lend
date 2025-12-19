import { format, isPast, isToday } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from './LoanCalculator';
import { CheckCircle2, Clock, AlertTriangle, CircleDot } from 'lucide-react';

export default function RepaymentScheduleTable({ schedule, isLoading }) {
  const getStatusBadge = (row) => {
    const isPastDue = isPast(new Date(row.due_date)) && !isToday(new Date(row.due_date));
    
    if (row.status === 'Paid') {
      return (
        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Paid
        </Badge>
      );
    }
    if (row.status === 'Partial') {
      return (
        <Badge className="bg-amber-50 text-amber-700 border-amber-200">
          <CircleDot className="w-3 h-3 mr-1" />
          Partial
        </Badge>
      );
    }
    if (isPastDue || row.status === 'Overdue') {
      return (
        <Badge className="bg-red-50 text-red-700 border-red-200">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Overdue
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-50 text-slate-600 border-slate-200">
        <Clock className="w-3 h-3 mr-1" />
        Pending
      </Badge>
    );
  };

  const getRowClass = (row) => {
    const isPastDue = isPast(new Date(row.due_date)) && !isToday(new Date(row.due_date));
    
    if (row.status === 'Paid') return 'bg-emerald-50/30';
    if (row.status === 'Partial') return 'bg-amber-50/30';
    if (isPastDue) return 'bg-red-50/30';
    if (isToday(new Date(row.due_date))) return 'bg-blue-50/30';
    return '';
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/50">
            <TableHead className="font-semibold w-16">#</TableHead>
            <TableHead className="font-semibold">Due Date</TableHead>
            <TableHead className="font-semibold text-right">Principal</TableHead>
            <TableHead className="font-semibold text-right">Interest</TableHead>
            <TableHead className="font-semibold text-right">Total Due</TableHead>
            <TableHead className="font-semibold text-right">Paid</TableHead>
            <TableHead className="font-semibold text-right">Balance</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={8} className="h-14">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-full"></div>
                </TableCell>
              </TableRow>
            ))
          ) : schedule.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                No repayment schedule found
              </TableCell>
            </TableRow>
          ) : (
            schedule.map((row) => (
              <TableRow 
                key={row.id || row.installment_number} 
                className={`${getRowClass(row)} transition-colors`}
              >
                <TableCell className="font-medium">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm">
                    {row.installment_number}
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{format(new Date(row.due_date), 'MMM dd, yyyy')}</p>
                    <p className="text-xs text-slate-500">{format(new Date(row.due_date), 'EEEE')}</p>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(row.principal_amount)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-amber-600">
                  {formatCurrency(row.interest_amount)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {formatCurrency(row.total_due)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-emerald-600">
                  {formatCurrency((row.principal_paid || 0) + (row.interest_paid || 0))}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(row.balance)}
                </TableCell>
                <TableCell>
                  {getStatusBadge(row)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}