import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Building2, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export default function InvestorSummaryTable({ investors, investorTransactions }) {
  if (investors.length === 0) return null;

  return (
    <Card className="bg-white border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-purple-600" />
            Investor Accounts
          </CardTitle>
          <Link to={createPageUrl('Investors')}>
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900">
              View All
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <div className="text-sm text-slate-500">
            Total Balance: <span className="font-semibold text-slate-900">{formatCurrency(investors.reduce((sum, inv) => sum + (inv.current_capital_balance || 0), 0))}</span>
          </div>
          <div className="text-sm text-slate-500">
            {investors.length} investor{investors.length !== 1 ? 's' : ''}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-t bg-slate-50">
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Business Name</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Balance</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Last Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {investors
                .filter(inv => inv.status === 'Active')
                .sort((a, b) => (b.current_capital_balance || 0) - (a.current_capital_balance || 0))
                .slice(0, 8)
                .map(investor => {
                  const lastTx = investorTransactions.find(tx => tx.investor_id === investor.id);
                  return (
                    <tr key={investor.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link to={createPageUrl(`InvestorDetails?id=${investor.id}`)} className="hover:text-purple-600">
                          <p className="font-medium text-slate-900">{investor.business_name || investor.name}</p>
                          {investor.business_name && investor.name !== investor.business_name && (
                            <p className="text-xs text-slate-500">{investor.name}</p>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <p className="font-semibold text-purple-600">{formatCurrency(investor.current_capital_balance || 0)}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {lastTx ? (
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                lastTx.type === 'capital_in' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                lastTx.type === 'capital_out' ? 'bg-red-50 text-red-700 border-red-200' :
                                lastTx.type === 'interest_accrual' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-blue-50 text-blue-700 border-blue-200'
                              }
                            >
                              {lastTx.type === 'capital_in' ? 'In' :
                               lastTx.type === 'capital_out' ? 'Out' :
                               lastTx.type === 'interest_accrual' ? 'Accrued' : 'Interest'}
                            </Badge>
                            <span className="text-sm text-slate-600">{formatCurrency(lastTx.amount)}</span>
                            <span className="text-xs text-slate-400">{format(new Date(lastTx.date), 'dd MMM')}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">No transactions</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
