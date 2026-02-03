/**
 * InlineDisbursementForm - Compact loan disbursement form
 */

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, X, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { createLoanDisbursement } from '@/lib/reconciliation/reconcileHandler';

export default function InlineDisbursementForm({
  bankEntry,
  loans,
  borrowers,
  onSuccess,
  onCancel
}) {
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

        // Check for exact substring match first (highest priority)
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

        // Check for consecutive word matches
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

  // Update selection when suggestion changes (e.g., when data loads)
  useEffect(() => {
    if (suggestedBorrowerId && !selectedBorrowerId) {
      setSelectedBorrowerId(suggestedBorrowerId);
    }
  }, [suggestedBorrowerId, selectedBorrowerId]);

  // Get loans that might need disbursements
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

  // Get loans for selected borrower
  const borrowerLoans = useMemo(() => {
    if (!selectedBorrowerId) return [];
    return eligibleLoans.filter(l => l.borrower_id === selectedBorrowerId);
  }, [eligibleLoans, selectedBorrowerId]);

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

  return (
    <div className="flex items-center gap-2 p-2 bg-white rounded-lg shadow-sm">
      <span className="text-sm font-medium text-slate-600 shrink-0">Disbursement:</span>
      <Select value={selectedBorrowerId} onValueChange={(val) => {
        setSelectedBorrowerId(val);
        setSelectedLoanId('');
      }}>
        <SelectTrigger className="h-8 w-[160px]">
          <SelectValue placeholder="Borrower" />
        </SelectTrigger>
        <SelectContent>
          {borrowersWithLoans.map(b => (
            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedLoanId} onValueChange={setSelectedLoanId} disabled={!selectedBorrowerId}>
        <SelectTrigger className="h-8 flex-1 min-w-[180px]">
          <SelectValue placeholder={selectedBorrowerId ? 'Select loan' : 'Select borrower first'} />
        </SelectTrigger>
        <SelectContent>
          {borrowerLoans.map(l => (
            <SelectItem key={l.id} value={l.id}>
              {l.loan_number} - {formatCurrency(l.principal_amount)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="h-8"
        onClick={handleSubmit}
        disabled={isSubmitting || !selectedLoanId}
      >
        {isSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Check className="w-4 h-4" />
        )}
      </Button>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onCancel}>
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
