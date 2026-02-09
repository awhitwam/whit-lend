import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { ArrowDownLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export default function RecentPaymentsTable({ recentRepayments }) {
  return (
    <Card className="bg-white border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
            Recent Payments
          </CardTitle>
          <Link to={createPageUrl('Ledger')}>
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900">
              View Ledger
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {recentRepayments.length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-500">
            No recent payments
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-t bg-slate-50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Borrower</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Loan</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Principal</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Interest</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentRepayments.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-sm text-slate-600">
                      {format(new Date(tx.date), 'dd MMM')}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        to={createPageUrl(`LoanDetails?id=${tx.loan_id}`)}
                        className="text-sm font-medium text-slate-900 hover:text-blue-600"
                      >
                        {tx.loan?.borrower_name || 'Unknown'}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-slate-500">
                      #{tx.loan?.loan_number}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-mono text-slate-600">
                      {tx.principal_applied > 0 ? formatCurrency(tx.principal_applied) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-mono text-slate-600">
                      {tx.interest_applied > 0 ? formatCurrency(tx.interest_applied) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-mono font-semibold text-emerald-600">
                      {formatCurrency(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
