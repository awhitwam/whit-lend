import { forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';
import { Info } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

/**
 * Cell for selecting one or more loans for the receipt
 * Shows loan info popover with last payment and expected schedule
 */
const LoanCell = forwardRef(function LoanCell({
  row,
  loans = [],
  lastPayments = {},
  schedules = [],
  isFocused,
  isEditing: _isEditing,
  onUpdate
}, ref) {
  const containerRef = useRef(null);

  // Expose focus method
  useImperativeHandle(ref, () => ({
    focus: () => {
      containerRef.current?.focus();
    }
  }));

  const formatCurrency = (value) => {
    const num = parseFloat(value) || 0;
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2
    }).format(num);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
      return format(date, 'dd/MM/yy');
    } catch {
      return dateStr;
    }
  };

  // Filter loans for this borrower
  const borrowerLoans = useMemo(() => {
    if (!row.borrowerId) return [];
    return loans.filter(l => l.borrower_id === row.borrowerId && l.status !== 'Closed');
  }, [loans, row.borrowerId]);

  // Toggle loan selection
  const handleToggle = (loanId, checked) => {
    const currentIds = row.selectedLoanIds || [];
    let newIds;
    if (checked) {
      newIds = [...currentIds, loanId];
    } else {
      newIds = currentIds.filter(id => id !== loanId);
    }

    // Update allocations: remove allocation for deselected loans
    const newAllocations = { ...row.allocations };
    if (!checked) {
      delete newAllocations[loanId];
    }

    onUpdate({
      selectedLoanIds: newIds,
      allocations: newAllocations
    });
  };

  // Calculate loan outstanding
  const getLoanOutstanding = (loan) => {
    const principalOutstanding = (parseFloat(loan.principal_amount) || 0) - (parseFloat(loan.principal_paid) || 0);
    const interestOutstanding = (parseFloat(loan.total_interest) || 0) - (parseFloat(loan.interest_paid) || 0);
    return {
      principal: principalOutstanding,
      interest: interestOutstanding,
      total: principalOutstanding + interestOutstanding
    };
  };

  // Get next pending schedule for a loan
  const getNextSchedule = (loanId) => {
    return schedules.find(s =>
      s.loan_id === loanId &&
      (s.status === 'Pending' || s.status === 'Overdue')
    );
  };

  if (!row.borrowerId) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'px-2 py-2 text-sm text-slate-400 min-w-[200px]',
          isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
        )}
        tabIndex={isFocused ? 0 : -1}
      >
        Select borrower first
      </div>
    );
  }

  if (borrowerLoans.length === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'px-2 py-2 text-sm text-slate-400 min-w-[200px]',
          isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
        )}
        tabIndex={isFocused ? 0 : -1}
      >
        No active loans
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'px-2 py-1 space-y-1 min-w-[400px]',
        isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
      )}
      tabIndex={isFocused ? 0 : -1}
    >
      {borrowerLoans.map((loan) => {
        const isSelected = (row.selectedLoanIds || []).includes(loan.id);
        const lastPayment = lastPayments[loan.id];
        const nextSchedule = getNextSchedule(loan.id);
        const outstanding = getLoanOutstanding(loan);

        // Get product abbreviation (first letters of each word, or first 3 chars)
        const productAbbr = loan.product_abbreviation ||
          (loan.product_name ? loan.product_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4) : '');

        return (
          <div
            key={loan.id}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded border transition-colors',
              isSelected ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
            )}
          >
            <Checkbox
              id={`loan-${loan.id}`}
              checked={isSelected}
              onCheckedChange={(checked) => handleToggle(loan.id, checked)}
            />

            {/* Loan Number */}
            <span className="font-medium text-sm whitespace-nowrap">#{loan.loan_number}</span>

            {/* Product Abbreviation */}
            {productAbbr && (
              <span className="text-xs bg-slate-200 text-slate-600 px-1 py-0.5 rounded whitespace-nowrap">
                {productAbbr}
              </span>
            )}

            {/* Description - truncated */}
            {loan.description && (
              <span className="text-xs text-slate-500 truncate max-w-[120px]" title={loan.description}>
                {loan.description}
              </span>
            )}

            {/* Spacer */}
            <span className="flex-1" />

            {/* Last Payment */}
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {lastPayment ? (
                <>
                  <span className="text-green-600 font-medium">{formatCurrency(lastPayment.amount)}</span>
                  <span className="text-slate-400 ml-1">({formatDate(lastPayment.date)})</span>
                </>
              ) : (
                <span className="italic">No payments</span>
              )}
            </span>

            {/* Info icon for more details */}
            <HoverCard openDelay={200}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  className="p-0.5 hover:bg-slate-200 rounded"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-64" align="end">
                <div className="space-y-2 text-sm">
                  <div className="font-medium">#{loan.loan_number} Details</div>

                  {/* Outstanding */}
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div>
                      <span className="text-slate-500">Principal O/S:</span>
                      <span className="ml-1 font-medium">{formatCurrency(outstanding.principal)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Interest O/S:</span>
                      <span className="ml-1 font-medium">{formatCurrency(outstanding.interest)}</span>
                    </div>
                  </div>

                  {/* Next Due */}
                  {nextSchedule && (
                    <div className="pt-1 border-t text-xs">
                      <span className="text-slate-500">Next Due:</span>
                      <span className={cn(
                        'ml-1',
                        nextSchedule.status === 'Overdue' && 'text-red-600 font-medium'
                      )}>
                        {formatDate(nextSchedule.due_date)} - {formatCurrency(nextSchedule.total_due)}
                      </span>
                    </div>
                  )}
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>
        );
      })}
    </div>
  );
});

export default LoanCell;
