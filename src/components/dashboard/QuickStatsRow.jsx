import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  TrendingUp,
  TrendingDown,
  ArrowDownLeft,
  ArrowUpRight as ArrowUpRightIcon,
  CheckCircle2,
  Clock
} from 'lucide-react';

export default function QuickStatsRow({
  thisMonthCollections,
  collectionsChange,
  totalThisMonthDisbursements,
  settledLoansCount,
  totalRepaid,
  pendingLoans
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-100">
              <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-500 truncate">This Month Collections</p>
              <p className="text-lg font-bold text-slate-900">{formatCurrency(thisMonthCollections)}</p>
              {collectionsChange !== 0 && (
                <div className={`flex items-center gap-1 text-xs ${collectionsChange > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {collectionsChange > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  <span>{Math.abs(collectionsChange).toFixed(0)}% vs last month</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-100">
              <ArrowUpRightIcon className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-500 truncate">This Month Disbursed</p>
              <p className="text-lg font-bold text-slate-900">{formatCurrency(totalThisMonthDisbursements)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-100">
              <CheckCircle2 className="w-5 h-5 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-500 truncate">Settled Loans</p>
              <p className="text-lg font-bold text-slate-900">{settledLoansCount}</p>
              <p className="text-xs text-slate-400">{formatCurrency(totalRepaid)} repaid</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-100">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-500 truncate">Pending Approval</p>
              <p className="text-lg font-bold text-slate-900">{pendingLoans.length}</p>
              <p className="text-xs text-slate-400">
                {pendingLoans.length > 0
                  ? formatCurrency(pendingLoans.reduce((s, l) => s + (l.principal_amount || 0), 0))
                  : 'No pending'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
