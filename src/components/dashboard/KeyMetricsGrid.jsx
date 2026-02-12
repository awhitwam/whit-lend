import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Flame,
  Wallet,
  CreditCard,
  ArrowDownLeft
} from 'lucide-react';

export default function KeyMetricsGrid({
  highestInterestBalances,
  highestPrincipalBalances,
  borrowersInCredit
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Highest Interest Balances */}
      <Card className="bg-white border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500" />
              Highest Interest O/S
            </CardTitle>
          </div>
          <p className="text-xs text-slate-500 mt-1">Live accrued interest balances</p>
        </CardHeader>
        <CardContent className="p-0">
          {highestInterestBalances.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">
              No interest outstanding
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {highestInterestBalances.map((m, idx) => (
                <Link
                  key={m.loan.id}
                  to={createPageUrl(`LoanDetails?id=${m.loan.id}`)}
                  className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors"
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx === 0 ? 'bg-orange-100 text-orange-700' :
                    idx === 1 ? 'bg-slate-200 text-slate-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {m.loan.borrower_name}
                    </p>
                    <p className="text-xs text-slate-500">#{m.loan.loan_number}</p>
                    {m.loan.description && <p className="text-xs text-slate-400 truncate">{m.loan.description}</p>}
                  </div>
                  <p className="text-sm font-semibold text-red-600">
                    {formatCurrency(m.interestRemaining)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Highest Principal Balances */}
      <Card className="bg-white border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-blue-500" />
              Highest Principal O/S
            </CardTitle>
          </div>
          <p className="text-xs text-slate-500 mt-1">Largest outstanding balances</p>
        </CardHeader>
        <CardContent className="p-0">
          {highestPrincipalBalances.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">
              No principal outstanding
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {highestPrincipalBalances.map((m, idx) => (
                <Link
                  key={m.loan.id}
                  to={createPageUrl(`LoanDetails?id=${m.loan.id}`)}
                  className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors"
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx === 0 ? 'bg-blue-100 text-blue-700' :
                    idx === 1 ? 'bg-slate-200 text-slate-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {m.loan.borrower_name}
                    </p>
                    <p className="text-xs text-slate-500">#{m.loan.loan_number}</p>
                    {m.loan.description && <p className="text-xs text-slate-400 truncate">{m.loan.description}</p>}
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatCurrency(m.principalRemaining)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Borrowers in Credit */}
      <Card className="bg-white border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-500" />
              Borrowers in Credit
            </CardTitle>
          </div>
          <p className="text-xs text-slate-500 mt-1">Interest overpaid (credit balance)</p>
        </CardHeader>
        <CardContent className="p-0">
          {borrowersInCredit.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">
              No borrowers in credit
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {borrowersInCredit.slice(0, 5).map((item) => (
                <Link
                  key={item.loan.id}
                  to={createPageUrl(`LoanDetails?id=${item.loan.id}`)}
                  className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="p-1.5 rounded-full bg-emerald-100">
                    <ArrowDownLeft className="w-3 h-3 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {item.loan.borrower_name}
                    </p>
                    <p className="text-xs text-slate-500">#{item.loan.loan_number}</p>
                    {item.loan.description && <p className="text-xs text-slate-400 truncate">{item.loan.description}</p>}
                  </div>
                  <p className="text-sm font-semibold text-emerald-600">
                    +{formatCurrency(item.creditAmount)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
