import { forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Cell for allocating receipt amount across selected loans
 * Shows principal/interest/fees inputs for each selected loan
 */
const AllocationCell = forwardRef(function AllocationCell({
  row,
  loans = [],
  isFocused,
  isEditing: _isEditing,
  onUpdate
}, ref) {
  const containerRef = useRef(null);
  const inputRefs = useRef({});

  // Expose focus method
  useImperativeHandle(ref, () => ({
    focus: () => {
      // Focus first input
      const firstLoanId = (row.selectedLoanIds || [])[0];
      if (firstLoanId && inputRefs.current[`${firstLoanId}-principal`]) {
        inputRefs.current[`${firstLoanId}-principal`].focus();
      } else {
        containerRef.current?.focus();
      }
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

  // Get selected loans
  const selectedLoans = useMemo(() => {
    if (!row.selectedLoanIds || row.selectedLoanIds.length === 0) return [];
    return row.selectedLoanIds
      .map(id => loans.find(l => l.id === id))
      .filter(Boolean);
  }, [loans, row.selectedLoanIds]);

  // Calculate totals
  const { totalAllocated, isBalanced } = useMemo(() => {
    let total = 0;
    for (const loanId of (row.selectedLoanIds || [])) {
      const alloc = row.allocations?.[loanId] || {};
      total += (parseFloat(alloc.principal) || 0);
      total += (parseFloat(alloc.interest) || 0);
      total += (parseFloat(alloc.fees) || 0);
    }
    const receiptAmount = parseFloat(row.amount) || 0;
    const balanced = Math.abs(total - receiptAmount) < 0.01;
    return { totalAllocated: total, isBalanced: balanced };
  }, [row.selectedLoanIds, row.allocations, row.amount]);

  // Update allocation for a loan
  const handleAllocationChange = (loanId, field, value) => {
    const currentAlloc = row.allocations?.[loanId] || { principal: 0, interest: 0, fees: 0 };
    const newAllocations = {
      ...row.allocations,
      [loanId]: {
        ...currentAlloc,
        [field]: parseFloat(value) || 0
      }
    };
    onUpdate({ allocations: newAllocations });
  };

  // Get outstanding amounts for a loan
  const getLoanOutstanding = (loan) => {
    return {
      principal: (parseFloat(loan.principal_amount) || 0) - (parseFloat(loan.principal_paid) || 0),
      interest: (parseFloat(loan.total_interest) || 0) - (parseFloat(loan.interest_paid) || 0)
    };
  };

  // Auto-distribute remaining amount
  const handleAutoDistribute = () => {
    if (selectedLoans.length === 0) return;

    const receiptAmount = parseFloat(row.amount) || 0;
    const newAllocations = {};

    if (selectedLoans.length === 1) {
      // Single loan - allocate all to principal
      newAllocations[selectedLoans[0].id] = {
        principal: receiptAmount,
        interest: 0,
        fees: 0
      };
    } else {
      // Multiple loans - distribute evenly as principal
      const perLoan = receiptAmount / selectedLoans.length;
      for (const loan of selectedLoans) {
        newAllocations[loan.id] = {
          principal: perLoan,
          interest: 0,
          fees: 0
        };
      }
    }

    onUpdate({ allocations: newAllocations });
  };

  if (!row.selectedLoanIds || row.selectedLoanIds.length === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'px-2 py-2 text-sm text-slate-400 min-w-[280px]',
          isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
        )}
        tabIndex={isFocused ? 0 : -1}
      >
        Select loans first
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'px-2 py-1 min-w-[280px]',
        isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
      )}
      tabIndex={isFocused ? 0 : -1}
    >
      {/* Allocations per loan */}
      <div className="space-y-2">
        {selectedLoans.map((loan) => {
          const alloc = row.allocations?.[loan.id] || { principal: 0, interest: 0, fees: 0 };
          const outstanding = getLoanOutstanding(loan);
          const principalOver = (parseFloat(alloc.principal) || 0) > outstanding.principal;
          const interestOver = (parseFloat(alloc.interest) || 0) > outstanding.interest;

          return (
            <div key={loan.id} className="space-y-1">
              {selectedLoans.length > 1 && (
                <div className="text-xs text-slate-500 font-medium">
                  #{loan.loan_number}
                </div>
              )}
              <div className="flex gap-1">
                <div className="flex-1">
                  <Label className="text-[10px] text-slate-400 uppercase">Capital</Label>
                  <Input
                    ref={el => inputRefs.current[`${loan.id}-principal`] = el}
                    type="number"
                    value={alloc.principal || ''}
                    onChange={(e) => handleAllocationChange(loan.id, 'principal', e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className={cn(
                      'h-7 text-sm text-right',
                      principalOver && 'border-amber-500 bg-amber-50'
                    )}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-[10px] text-slate-400 uppercase">Interest</Label>
                  <Input
                    ref={el => inputRefs.current[`${loan.id}-interest`] = el}
                    type="number"
                    value={alloc.interest || ''}
                    onChange={(e) => handleAllocationChange(loan.id, 'interest', e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className={cn(
                      'h-7 text-sm text-right',
                      interestOver && 'border-amber-500 bg-amber-50'
                    )}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-[10px] text-slate-400 uppercase">Fees</Label>
                  <Input
                    ref={el => inputRefs.current[`${loan.id}-fees`] = el}
                    type="number"
                    value={alloc.fees || ''}
                    onChange={(e) => handleAllocationChange(loan.id, 'fees', e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className="h-7 text-sm text-right"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Balance summary */}
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
    </div>
  );
});

export default AllocationCell;
