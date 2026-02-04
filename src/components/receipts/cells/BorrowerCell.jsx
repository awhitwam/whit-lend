import { useState, forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from '@/components/ui/command';
import { ChevronDown, User, Building, Check, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Cell for selecting a borrower
 * Features searchable dropdown with borrower name/business display
 * Supports locked mode for dialog contexts
 * Shows indicator for borrowers with active loans vs settled only
 */
const BorrowerCell = forwardRef(function BorrowerCell({
  row,
  borrowers = [],
  loans = [],
  isFocused,
  isEditing: _isEditing,
  onUpdate,
  locked = false,
  lockedBorrower = null
}, ref) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const buttonRef = useRef(null);

  // Expose focus method
  useImperativeHandle(ref, () => ({
    focus: () => {
      buttonRef.current?.focus();
    }
  }));

  // Calculate which borrowers have active loans
  const borrowerLoanStatus = useMemo(() => {
    const status = new Map(); // borrowerId -> { hasActive: boolean, hasSettled: boolean }
    const activeStatuses = ['Live', 'Active', 'Defaulted'];
    const settledStatuses = ['Closed', 'Settled', 'Restructured', 'Written Off'];

    for (const loan of loans) {
      if (!loan.borrower_id || loan.is_deleted) continue;
      const current = status.get(loan.borrower_id) || { hasActive: false, hasSettled: false };

      if (activeStatuses.includes(loan.status)) {
        current.hasActive = true;
      } else if (settledStatuses.includes(loan.status)) {
        current.hasSettled = true;
      }

      status.set(loan.borrower_id, current);
    }

    return status;
  }, [loans]);

  // Find selected borrower
  const selectedBorrower = useMemo(() => {
    return borrowers.find(b => b.id === row.borrowerId);
  }, [borrowers, row.borrowerId]);

  // Filter and sort borrowers - active loan holders first
  const filteredBorrowers = useMemo(() => {
    let filtered = borrowers;

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = borrowers.filter(b => {
        const name = (b.full_name || '').toLowerCase();
        const business = (b.business || '').toLowerCase();
        const keywords = b.keywords || [];
        const keywordMatch = keywords.some(k => k.toLowerCase().includes(searchLower));
        return name.includes(searchLower) || business.includes(searchLower) || keywordMatch;
      });
    }

    // Sort: active loan holders first, then settled only, then no loans
    return filtered
      .map(b => ({
        ...b,
        _loanStatus: borrowerLoanStatus.get(b.id) || { hasActive: false, hasSettled: false }
      }))
      .sort((a, b) => {
        // Active loans first
        if (a._loanStatus.hasActive && !b._loanStatus.hasActive) return -1;
        if (!a._loanStatus.hasActive && b._loanStatus.hasActive) return 1;
        // Then settled loans
        if (a._loanStatus.hasSettled && !b._loanStatus.hasSettled) return -1;
        if (!a._loanStatus.hasSettled && b._loanStatus.hasSettled) return 1;
        return 0;
      })
      .slice(0, 50);
  }, [borrowers, search, borrowerLoanStatus]);

  // Get display name for a borrower
  const getBorrowerDisplay = (borrower) => {
    if (!borrower) return null;
    if (borrower.full_name && borrower.business) {
      return { primary: borrower.full_name, secondary: borrower.business };
    }
    return { primary: borrower.full_name || borrower.business || 'Unknown', secondary: null };
  };

  const handleSelect = (borrower) => {
    onUpdate({
      borrowerId: borrower.id,
      // Clear loan selection when borrower changes
      selectedLoanIds: [],
      allocations: {}
    });
    setOpen(false);
    setSearch('');
  };

  // Use locked borrower if provided, otherwise use selected
  const displayBorrower = locked ? lockedBorrower : selectedBorrower;
  const display = getBorrowerDisplay(displayBorrower);

  // Locked mode: show read-only display
  if (locked) {
    return (
      <div
        ref={buttonRef}
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded',
          isFocused && 'ring-2 ring-blue-500 ring-inset'
        )}
        tabIndex={isFocused ? 0 : -1}
      >
        <Lock className="w-3 h-3 text-slate-400 flex-shrink-0" />
        {displayBorrower?.business ? (
          <Building className="w-4 h-4 text-slate-400 flex-shrink-0" />
        ) : (
          <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
        )}
        <div className="text-left min-w-0">
          <div className="truncate text-sm">{display?.primary || 'No borrower'}</div>
          {display?.secondary && (
            <div className="text-xs text-slate-500 truncate">{display.secondary}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={buttonRef}
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between h-auto py-1.5 px-2 font-normal',
              !selectedBorrower && 'text-slate-500'
            )}
            tabIndex={isFocused ? 0 : -1}
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedBorrower ? (
                <>
                  {selectedBorrower.business ? (
                    <Building className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  ) : (
                    <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  )}
                  <div className="text-left min-w-0">
                    <div className="truncate text-sm">{display?.primary}</div>
                    {display?.secondary && (
                      <div className="text-xs text-slate-500 truncate">{display.secondary}</div>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-sm">Select borrower...</span>
              )}
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search borrowers..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No borrower found.</CommandEmpty>
              <CommandGroup>
                {filteredBorrowers.map((borrower) => {
                  const bDisplay = getBorrowerDisplay(borrower);
                  const loanStatus = borrower._loanStatus || { hasActive: false, hasSettled: false };
                  return (
                    <CommandItem
                      key={borrower.id}
                      value={borrower.id}
                      onSelect={() => handleSelect(borrower)}
                      className="flex items-center gap-2"
                    >
                      {borrower.business ? (
                        <Building className="w-4 h-4 text-slate-400" />
                      ) : (
                        <User className="w-4 h-4 text-slate-400" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{bDisplay?.primary}</div>
                        {bDisplay?.secondary && (
                          <div className="text-xs text-slate-500 truncate">{bDisplay.secondary}</div>
                        )}
                      </div>
                      {/* Loan status indicator */}
                      {loanStatus.hasActive ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
                          Active
                        </span>
                      ) : loanStatus.hasSettled ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                          Settled
                        </span>
                      ) : null}
                      {row.borrowerId === borrower.id && (
                        <Check className="w-4 h-4 text-blue-500" />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
});

export default BorrowerCell;
