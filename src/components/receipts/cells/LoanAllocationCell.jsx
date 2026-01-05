import { forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';
import { Info, AlertCircle, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

/**
 * Combined cell for selecting loans and allocating amounts
 * Each loan row shows: checkbox, loan info, and allocation inputs (capital/interest/fees)
 *
 * Modes:
 * - standalone/borrower: Multiple loans can be selected
 * - loan: Single loan is locked and pre-selected (no checkbox shown)
 */
const LoanAllocationCell = forwardRef(function LoanAllocationCell({
  row,
  loans = [],
  lastPayments = {},
  schedules = [],
  isFocused,
  isEditing: _isEditing,
  onUpdate,
  mode = 'standalone',
  lockedLoanId = null
}, ref) {
  const isSingleLoanMode = mode === 'loan';
  const containerRef = useRef(null);
  const inputRefs = useRef({});

  // Expose focus method
  useImperativeHandle(ref, () => ({
    focus: () => {
      containerRef.current?.focus();
    }
  }));

  const formatCurrency = (value, suppressZero = false) => {
    const num = parseFloat(value) || 0;
    if (suppressZero && num === 0) return '';
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

  // Filter loans for this borrower - only show live/active loans
  // In single-loan mode, only show the locked loan
  const borrowerLoans = useMemo(() => {
    if (isSingleLoanMode && lockedLoanId) {
      // Single loan mode: only show the locked loan
      return loans.filter(l => l.id === lockedLoanId);
    }

    if (!row.borrowerId) return [];
    const inactiveStatuses = ['Closed', 'Settled', 'Restructured', 'Written Off', 'Cancelled'];
    return loans.filter(l =>
      l.borrower_id === row.borrowerId &&
      !inactiveStatuses.includes(l.status)
    );
  }, [loans, row.borrowerId, isSingleLoanMode, lockedLoanId]);

  // Calculate totals
  const { totalAllocated, isBalanced } = useMemo(() => {
    let total = 0;

    // In single-loan mode, use the locked loan ID
    const loanIds = isSingleLoanMode && lockedLoanId
      ? [lockedLoanId]
      : (row.selectedLoanIds || []);

    for (const loanId of loanIds) {
      const alloc = row.allocations?.[loanId] || {};
      total += (parseFloat(alloc.principal) || 0);
      total += (parseFloat(alloc.interest) || 0);
      total += (parseFloat(alloc.fees) || 0);
    }
    const receiptAmount = parseFloat(row.amount) || 0;
    const balanced = receiptAmount > 0 && Math.abs(total - receiptAmount) < 0.01;
    return { totalAllocated: total, isBalanced: balanced };
  }, [row.selectedLoanIds, row.allocations, row.amount, isSingleLoanMode, lockedLoanId]);

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

  // Update allocation for a loan
  const handleAllocationChange = (loanId, field, value) => {
    const currentAlloc = row.allocations?.[loanId] || { principal: 0, interest: 0, fees: 0, description: '' };
    const newAllocations = {
      ...row.allocations,
      [loanId]: {
        ...currentAlloc,
        // Description is a string, numeric fields need parseFloat
        [field]: field === 'description' ? value : (parseFloat(value) || 0)
      }
    };
    onUpdate({ allocations: newAllocations });
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

  // Auto-fill based on last transaction for each loan
  // Only fills loans that have previous payment data, skips loans with no history
  const handleAutoDistribute = () => {
    const selectedLoans = borrowerLoans.filter(l => (row.selectedLoanIds || []).includes(l.id));
    if (selectedLoans.length === 0) return;

    const newAllocations = { ...row.allocations };

    for (const loan of selectedLoans) {
      const lastPayment = lastPayments[loan.id];
      if (lastPayment && (lastPayment.principal || lastPayment.interest || lastPayment.fees)) {
        // Use the last transaction's allocation breakdown
        newAllocations[loan.id] = {
          principal: lastPayment.principal || 0,
          interest: lastPayment.interest || 0,
          fees: lastPayment.fees || 0
        };
      }
      // If no previous payment data, skip this loan (don't invent figures)
    }

    onUpdate({ allocations: newAllocations });
  };

  // In single-loan mode with locked loan, skip the borrower check
  if (!row.borrowerId && !isSingleLoanMode) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'px-2 py-2 text-sm text-slate-400',
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
          'px-2 py-2 text-sm text-slate-400',
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
        'px-1 py-1',
        isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
      )}
      tabIndex={isFocused ? 0 : -1}
    >
      {/* Header row with allocation column labels - hide in single-loan mode */}
      {!isSingleLoanMode && (
        <div className="flex items-center gap-1 px-1 py-1 text-[10px] text-slate-500 uppercase font-medium">
          <div className="w-4 shrink-0"></div>{/* Checkbox spacer */}
          <div className="w-[300px] shrink-0">Loan</div>
          <div className="flex-1 min-w-[120px]">Note</div>
          <div className="w-20 text-right">Interest</div>
          <div className="w-20 text-right">Capital</div>
          <div className="w-16 text-right">Fees</div>
        </div>
      )}

      {/* Loan rows */}
      <div className="space-y-1">
        {borrowerLoans.map((loan) => {
          // In single-loan mode, the loan is always selected
          const isSelected = isSingleLoanMode || (row.selectedLoanIds || []).includes(loan.id);
          const lastPayment = lastPayments[loan.id];
          const nextSchedule = getNextSchedule(loan.id);
          const outstanding = getLoanOutstanding(loan);
          const alloc = row.allocations?.[loan.id] || { principal: 0, interest: 0, fees: 0, description: '' };
          const principalOver = (parseFloat(alloc.principal) || 0) > outstanding.principal;
          const interestOver = (parseFloat(alloc.interest) || 0) > outstanding.interest;

          // Get product abbreviation
          const productAbbr = loan.product_abbreviation ||
            (loan.product_name ? loan.product_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4) : '');

          return (
            <div
              key={loan.id}
              className={cn(
                'flex items-center gap-1 px-1 py-1 rounded border transition-colors',
                isSelected ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
              )}
            >
              {/* Checkbox - hide in single-loan mode */}
              {!isSingleLoanMode && (
                <Checkbox
                  id={`loan-${loan.id}`}
                  checked={isSelected}
                  onCheckedChange={(checked) => handleToggle(loan.id, checked)}
                />
              )}

              {/* Loan Info Section */}
              <div className="flex items-center gap-1 w-[300px] shrink-0">
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
                  <span className="text-xs text-slate-500 truncate max-w-[80px]" title={loan.description}>
                    {loan.description}
                  </span>
                )}

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

                {/* Info icon */}
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
                  <HoverCardContent className="w-64" align="start">
                    <div className="space-y-2 text-sm">
                      <div className="font-medium">#{loan.loan_number} Details</div>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        {outstanding.principal > 0 && (
                          <div>
                            <span className="text-slate-500">Principal O/S:</span>
                            <span className="ml-1 font-medium">{formatCurrency(outstanding.principal)}</span>
                          </div>
                        )}
                        {outstanding.interest > 0 && (
                          <div>
                            <span className="text-slate-500">Interest O/S:</span>
                            <span className="ml-1 font-medium">{formatCurrency(outstanding.interest)}</span>
                          </div>
                        )}
                      </div>
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

              {/* Description Input */}
              <Input
                ref={el => inputRefs.current[`${loan.id}-description`] = el}
                type="text"
                value={alloc.description || ''}
                onChange={(e) => handleAllocationChange(loan.id, 'description', e.target.value)}
                placeholder="Note..."
                disabled={!isSelected}
                className={cn(
                  'h-7 flex-1 min-w-[120px] text-xs px-1',
                  !isSelected && 'bg-slate-100 text-slate-400'
                )}
              />

              {/* Allocation Inputs - aligned with header columns (Interest, Capital, Fees) */}
              <div className="flex items-center gap-1">
                <Input
                  ref={el => inputRefs.current[`${loan.id}-interest`] = el}
                  type="number"
                  value={alloc.interest || ''}
                  onChange={(e) => handleAllocationChange(loan.id, 'interest', e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  disabled={!isSelected}
                  className={cn(
                    'h-7 w-20 text-sm text-right px-1',
                    !isSelected && 'bg-slate-100 text-slate-400',
                    interestOver && 'border-amber-500 bg-amber-50'
                  )}
                />
                <Input
                  ref={el => inputRefs.current[`${loan.id}-principal`] = el}
                  type="number"
                  value={alloc.principal || ''}
                  onChange={(e) => handleAllocationChange(loan.id, 'principal', e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  disabled={!isSelected}
                  className={cn(
                    'h-7 w-20 text-sm text-right px-1',
                    !isSelected && 'bg-slate-100 text-slate-400',
                    principalOver && 'border-amber-500 bg-amber-50'
                  )}
                />
                <Input
                  ref={el => inputRefs.current[`${loan.id}-fees`] = el}
                  type="number"
                  value={alloc.fees || ''}
                  onChange={(e) => handleAllocationChange(loan.id, 'fees', e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  disabled={!isSelected}
                  className={cn(
                    'h-7 w-16 text-sm text-right px-1',
                    !isSelected && 'bg-slate-100 text-slate-400'
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Balance summary - show when loans are selected or in single-loan mode */}
      {(isSingleLoanMode || (row.selectedLoanIds || []).length > 0) && (
        <div className={cn(
          'mt-2 pt-2 border-t flex items-center justify-between text-sm',
          isBalanced ? 'text-green-600' : 'text-amber-600'
        )}>
          <div className="flex items-center gap-1">
            {isBalanced ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            <span>
              {formatCurrency(totalAllocated)} / {formatCurrency(row.amount)}
            </span>
          </div>
          {!isBalanced && (
            <button
              type="button"
              className="text-xs text-blue-600 hover:underline"
              onClick={handleAutoDistribute}
            >
              Auto-fill
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default LoanAllocationCell;
