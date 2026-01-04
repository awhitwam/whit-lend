import { formatCurrency } from '@/components/loan/LoanCalculator';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';

/**
 * Shows before/after balance impact of a transaction
 */
export default function TransactionPreview({
  title = 'Balance Impact',
  items = [],
  className = ''
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className={`p-3 bg-slate-50 rounded-lg border border-slate-200 ${className}`}>
      {title && (
        <h4 className="text-xs font-medium text-slate-500 mb-2">{title}</h4>
      )}
      <div className="space-y-2">
        {items.map((item, index) => {
          const change = item.after - item.before;
          const isDecrease = change < 0;
          const _isIncrease = change > 0;

          return (
            <div key={index} className="flex items-center justify-between text-sm">
              <span className="text-slate-600">{item.label}:</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-500">
                  {formatCurrency(item.before)}
                </span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="font-mono font-medium">
                  {formatCurrency(item.after)}
                </span>
                {change !== 0 && (
                  <span className={`flex items-center gap-0.5 text-xs ${isDecrease ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {isDecrease ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : (
                      <TrendingUp className="w-3 h-3" />
                    )}
                    {formatCurrency(Math.abs(change))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Helper to create loan balance preview items
 */
export function createLoanPreviewItems(loan, split) {
  if (!loan) return [];

  const items = [];

  // Principal balance
  if (split.principal !== undefined) {
    items.push({
      label: 'Principal',
      before: loan.outstanding_balance || loan.principal_amount || 0,
      after: Math.max(0, (loan.outstanding_balance || loan.principal_amount || 0) - split.principal)
    });
  }

  // Interest balance (if tracked)
  if (split.interest !== undefined && loan.accrued_interest !== undefined) {
    items.push({
      label: 'Accrued Interest',
      before: loan.accrued_interest || 0,
      after: Math.max(0, (loan.accrued_interest || 0) - split.interest)
    });
  }

  // Fees/Charges balance (if applicable)
  if (split.fees !== undefined && split.fees > 0 && loan.outstanding_charges !== undefined) {
    items.push({
      label: 'Charges',
      before: loan.outstanding_charges || 0,
      after: Math.max(0, (loan.outstanding_charges || 0) - split.fees)
    });
  }

  return items;
}

/**
 * Helper to create investor balance preview items
 */
export function createInvestorPreviewItems(investor, transactionType, amount) {
  if (!investor) return [];

  const items = [];

  // Capital balance
  const capitalBefore = investor.current_capital_balance || 0;
  let capitalAfter = capitalBefore;

  if (transactionType === 'capital_in') {
    capitalAfter = capitalBefore + amount;
  } else if (transactionType === 'capital_out' || transactionType === 'withdrawal') {
    capitalAfter = Math.max(0, capitalBefore - amount);
  }

  items.push({
    label: 'Capital Balance',
    before: capitalBefore,
    after: capitalAfter
  });

  return items;
}
