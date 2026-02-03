/**
 * InlineDisbursementForm - Loan disbursement form with rich selectors
 * Uses same UX patterns as receipts: searchable borrower, detailed loan list
 */

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { Loader2, X, Check, ChevronDown, User, Building } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { createLoanDisbursement } from '@/lib/reconciliation/reconcileHandler';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

export default function InlineDisbursementForm({
  bankEntry,
  loans,
  borrowers,
  onSuccess,
  onCancel
}) {
  const amount = Math.abs(bankEntry.amount);

  // Fuzzy match borrower from bank description
  const suggestedBorrowerId = useMemo(() => {
    const description = (bankEntry.description || '').toLowerCase();
    if (!description || !borrowers?.length) return '';

    const normalize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const descNorm = normalize(description);

    let bestMatch = '';
    let bestScore = 0;

    for (const borrower of borrowers) {
      const names = [
        borrower.name,
        borrower.full_name,
        borrower.business_name,
        borrower.business,
        borrower.display_name,
        borrower.trading_name
      ].filter(Boolean);

      for (const name of names) {
        const nameNorm = normalize(name);

        if (descNorm.includes(nameNorm) && nameNorm.length > 3) {
          const exactScore = 1.0 + (nameNorm.length / 100);
          if (exactScore > bestScore) {
            bestScore = exactScore;
            bestMatch = borrower.id;
          }
          continue;
        }

        const allWords = nameNorm.split(/\s+/).filter(w => w.length > 0);
        const longWords = allWords.filter(w => w.length > 2);
        if (allWords.length === 0) continue;

        let consecutiveMatch = false;
        if (allWords.length >= 2) {
          for (let i = 0; i < allWords.length - 1; i++) {
            const phrase = allWords.slice(i, i + 2).join(' ');
            if (phrase.length > 3 && descNorm.includes(phrase)) {
              consecutiveMatch = true;
              break;
            }
          }
        }

        let matchedLongWords = 0;
        for (const word of longWords) {
          if (descNorm.includes(word)) matchedLongWords++;
        }

        const shortWords = allWords.filter(w => w.length <= 2 && w.length > 0);
        let matchedShortWords = 0;
        for (const word of shortWords) {
          if (descNorm.includes(` ${word} `) || descNorm.startsWith(`${word} `) || descNorm.endsWith(` ${word}`)) {
            matchedShortWords++;
          }
        }

        let score = longWords.length > 0 ? matchedLongWords / longWords.length : 0;
        if (consecutiveMatch) score += 0.2;
        if (shortWords.length > 0 && matchedShortWords > 0) {
          score += (matchedShortWords / shortWords.length) * 0.15;
        }

        if (score > bestScore && score >= 0.5) {
          bestScore = score;
          bestMatch = borrower.id;
        }
      }
    }

    return bestMatch;
  }, [bankEntry.description, borrowers]);

  const [selectedBorrowerId, setSelectedBorrowerId] = useState(suggestedBorrowerId);
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [borrowerOpen, setBorrowerOpen] = useState(false);
  const [borrowerSearch, setBorrowerSearch] = useState('');

  // Update selection when suggestion changes
  useEffect(() => {
    if (suggestedBorrowerId && !selectedBorrowerId) {
      setSelectedBorrowerId(suggestedBorrowerId);
    }
  }, [suggestedBorrowerId, selectedBorrowerId]);

  // Get loans that might need disbursements (Pending, Live, or recently created)
  const eligibleLoans = useMemo(() => {
    return loans.filter(l => {
      const createdRecently = new Date(l.created_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      return l.status === 'Pending' || l.status === 'Live' || l.status === 'Active' || createdRecently;
    });
  }, [loans]);

  // Get borrowers with eligible loans
  const borrowersWithLoans = useMemo(() => {
    const loanBorrowerIds = new Set(eligibleLoans.map(l => l.borrower_id));
    return borrowers.filter(b => loanBorrowerIds.has(b.id));
  }, [borrowers, eligibleLoans]);

  // Filter borrowers by search
  const filteredBorrowers = useMemo(() => {
    if (!borrowerSearch) return borrowersWithLoans.slice(0, 50);
    const searchLower = borrowerSearch.toLowerCase();
    return borrowersWithLoans
      .filter(b => {
        const name = (b.full_name || b.name || '').toLowerCase();
        const business = (b.business || '').toLowerCase();
        const keywords = b.keywords || [];
        const keywordMatch = keywords.some(k => k.toLowerCase().includes(searchLower));
        return name.includes(searchLower) || business.includes(searchLower) || keywordMatch;
      })
      .slice(0, 50);
  }, [borrowersWithLoans, borrowerSearch]);

  // Get loans for selected borrower
  const borrowerLoans = useMemo(() => {
    if (!selectedBorrowerId) return [];
    return eligibleLoans.filter(l => l.borrower_id === selectedBorrowerId);
  }, [eligibleLoans, selectedBorrowerId]);

  // Find selected borrower
  const selectedBorrower = useMemo(() => {
    return borrowers.find(b => b.id === selectedBorrowerId);
  }, [borrowers, selectedBorrowerId]);

  // Find selected loan
  const selectedLoan = useMemo(() => {
    return loans.find(l => l.id === selectedLoanId);
  }, [loans, selectedLoanId]);

  // Get display name for a borrower
  const getBorrowerDisplay = (borrower) => {
    if (!borrower) return null;
    if (borrower.full_name && borrower.business) {
      return { primary: borrower.full_name, secondary: borrower.business };
    }
    return { primary: borrower.full_name || borrower.business || borrower.name || 'Unknown', secondary: null };
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

  // Handle borrower select
  const handleBorrowerSelect = (borrower) => {
    setSelectedBorrowerId(borrower.id);
    setSelectedLoanId('');
    setBorrowerOpen(false);
    setBorrowerSearch('');
  };

  // Handle loan select
  const handleLoanSelect = (loanId) => {
    setSelectedLoanId(loanId === selectedLoanId ? '' : loanId);
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!selectedLoanId) {
      toast.error('Please select a loan');
      return;
    }

    setIsSubmitting(true);
    try {
      const loan = loans.find(l => l.id === selectedLoanId);
      if (!loan) throw new Error('Loan not found');

      await createLoanDisbursement({
        bankEntry,
        loan
      });

      toast.success('Disbursement created and reconciled');
      onSuccess?.();
    } catch (error) {
      console.error('Error creating disbursement:', error);
      toast.error(`Failed to create disbursement: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const borrowerDisplay = getBorrowerDisplay(selectedBorrower);

  return (
    <div className="border rounded-lg p-4 bg-white space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">New Loan Disbursement</h4>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Borrower Selector */}
      <div className="space-y-1.5">
        <Label>Borrower</Label>
        <Popover open={borrowerOpen} onOpenChange={setBorrowerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={borrowerOpen}
              className={cn(
                'w-full justify-between h-auto py-2 px-3 font-normal',
                !selectedBorrower && 'text-slate-500'
              )}
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
                      <div className="truncate text-sm">{borrowerDisplay?.primary}</div>
                      {borrowerDisplay?.secondary && (
                        <div className="text-xs text-slate-500 truncate">{borrowerDisplay.secondary}</div>
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
          <PopoverContent className="w-80 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search borrowers..."
                value={borrowerSearch}
                onValueChange={setBorrowerSearch}
              />
              <CommandList>
                <CommandEmpty>No borrower found.</CommandEmpty>
                <CommandGroup>
                  {filteredBorrowers.map((borrower) => {
                    const bDisplay = getBorrowerDisplay(borrower);
                    return (
                      <CommandItem
                        key={borrower.id}
                        value={borrower.id}
                        onSelect={() => handleBorrowerSelect(borrower)}
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
                        {selectedBorrowerId === borrower.id && (
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

      {/* Loan Selector */}
      <div className="space-y-1.5">
        <Label>Loan</Label>
        {!selectedBorrowerId ? (
          <div className="text-sm text-slate-400 px-3 py-2 border rounded-md bg-slate-50">
            Select borrower first
          </div>
        ) : borrowerLoans.length === 0 ? (
          <div className="text-sm text-slate-400 px-3 py-2 border rounded-md bg-slate-50">
            No eligible loans for this borrower
          </div>
        ) : (
          <div className="space-y-1 max-h-[200px] overflow-y-auto border rounded-md p-2 bg-slate-50">
            {borrowerLoans.map((loan) => {
              const isSelected = selectedLoanId === loan.id;
              const productAbbr = loan.product_abbreviation ||
                (loan.product_name ? loan.product_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4) : '');
              const amountMatch = Math.abs(loan.principal_amount - amount) < 1;

              return (
                <div
                  key={loan.id}
                  onClick={() => handleLoanSelect(loan.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors',
                    isSelected ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-300' : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0',
                    isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
                  )}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>

                  {/* Loan Number */}
                  <span className="font-medium text-sm whitespace-nowrap">#{loan.loan_number}</span>

                  {/* Product Abbreviation */}
                  {productAbbr && (
                    <span className="text-xs bg-slate-200 text-slate-600 px-1 py-0.5 rounded whitespace-nowrap">
                      {productAbbr}
                    </span>
                  )}

                  {/* Status */}
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded whitespace-nowrap',
                    loan.status === 'Pending' ? 'bg-amber-100 text-amber-700' :
                    loan.status === 'Live' || loan.status === 'Active' ? 'bg-green-100 text-green-700' :
                    'bg-slate-100 text-slate-600'
                  )}>
                    {loan.status}
                  </span>

                  {/* Spacer */}
                  <span className="flex-1" />

                  {/* Principal Amount */}
                  <span className={cn(
                    'text-sm font-medium whitespace-nowrap',
                    amountMatch ? 'text-green-600' : 'text-slate-700'
                  )}>
                    {formatCurrency(loan.principal_amount)}
                    {amountMatch && <span className="text-xs ml-1">✓</span>}
                  </span>

                  {/* Start Date */}
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {formatDate(loan.start_date)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
        <div className="text-sm">
          <span className="text-slate-500">Bank Amount:</span>{' '}
          <span className="font-medium">{formatCurrency(amount)}</span>
        </div>
        {selectedLoan && (
          <div className="text-sm">
            <span className="text-slate-500">Loan Amount:</span>{' '}
            <span className={cn(
              'font-medium',
              Math.abs(selectedLoan.principal_amount - amount) < 1 ? 'text-green-600' : 'text-amber-600'
            )}>
              {formatCurrency(selectedLoan.principal_amount)}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || !selectedLoanId}>
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : null}
          Create Disbursement
        </Button>
      </div>
    </div>
  );
}
