/**
 * InlineInvestorDepositForm - Compact single-row investor deposit form
 */

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, X, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { createInvestorCredit } from '@/lib/reconciliation/reconcileHandler';

export default function InlineInvestorDepositForm({
  bankEntry,
  investors,
  onSuccess,
  onCancel
}) {
  // Filter active investors
  const activeInvestors = useMemo(() => {
    return investors.filter(i => i.status === 'Active' || !i.status);
  }, [investors]);

  // Fuzzy match investor from bank description
  const suggestedInvestorId = useMemo(() => {
    const description = (bankEntry.description || '').toLowerCase();
    if (!description || !activeInvestors?.length) return '';

    const normalize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const descNorm = normalize(description);

    let bestMatch = '';
    let bestScore = 0;

    for (const investor of activeInvestors) {
      const names = [
        investor.business_name,
        investor.name,
        investor.full_name,
        investor.business,
        investor.display_name,
        investor.trading_name
      ].filter(Boolean);

      for (const name of names) {
        const nameNorm = normalize(name);

        // Check for exact substring match first (highest priority)
        if (descNorm.includes(nameNorm) && nameNorm.length > 3) {
          const exactScore = 1.0 + (nameNorm.length / 100);
          if (exactScore > bestScore) {
            bestScore = exactScore;
            bestMatch = investor.id;
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
          bestMatch = investor.id;
        }
      }
    }

    return bestMatch;
  }, [bankEntry.description, activeInvestors]);

  const [selectedInvestorId, setSelectedInvestorId] = useState(suggestedInvestorId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update selection when suggestion changes (e.g., when data loads)
  useEffect(() => {
    if (suggestedInvestorId && !selectedInvestorId) {
      setSelectedInvestorId(suggestedInvestorId);
    }
  }, [suggestedInvestorId, selectedInvestorId]);

  // Handle submit
  const handleSubmit = async () => {
    if (!selectedInvestorId) {
      toast.error('Please select an investor');
      return;
    }

    setIsSubmitting(true);
    try {
      const investor = investors.find(i => i.id === selectedInvestorId);
      if (!investor) throw new Error('Investor not found');

      await createInvestorCredit({
        bankEntry,
        investor
      });

      toast.success('Investor deposit created and reconciled');
      onSuccess?.();
    } catch (error) {
      console.error('Error creating investor deposit:', error);
      toast.error(`Failed to create deposit: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-white rounded-lg shadow-sm">
      <span className="text-sm font-medium text-slate-600 shrink-0">Investor Deposit:</span>
      <Select value={selectedInvestorId} onValueChange={setSelectedInvestorId}>
        <SelectTrigger className="h-8 flex-1 min-w-[200px]">
          <SelectValue placeholder="Select investor" />
        </SelectTrigger>
        <SelectContent>
          {activeInvestors.map(i => (
            <SelectItem key={i.id} value={i.id}>
              {i.business_name || i.name}
              {i.current_capital_balance ? ` (${formatCurrency(i.current_capital_balance)})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="h-8"
        onClick={handleSubmit}
        disabled={isSubmitting || !selectedInvestorId}
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
