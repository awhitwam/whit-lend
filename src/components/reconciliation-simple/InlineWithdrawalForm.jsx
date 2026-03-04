/**
 * InlineWithdrawalForm - Investor withdrawal form with capital/interest split
 * Improved layout with description field
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, X, Check, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { api } from '@/api/dataClient';
import { createInvestorWithdrawal } from '@/lib/reconciliation/reconcileHandler';

export default function InlineWithdrawalForm({
  bankEntry,
  investors,
  onSuccess,
  onCancel
}) {
  const amount = Math.abs(bankEntry.amount);

  // Load investor products
  const { data: investorProducts = [] } = useQuery({
    queryKey: ['investor-products'],
    queryFn: () => api.entities.InvestorProduct.list()
  });

  // Filter active investors with balance
  const activeInvestors = useMemo(() => {
    return investors.filter(i =>
      (i.status === 'Active' || !i.status) &&
      (parseFloat(i.current_capital_balance) || 0) > 0
    );
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
  const [capital, setCapital] = useState(amount.toString());
  const [interest, setInterest] = useState('0');
  const [description, setDescription] = useState(bankEntry.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update selection when suggestion changes (e.g., when data loads)
  useEffect(() => {
    if (suggestedInvestorId && !selectedInvestorId) {
      setSelectedInvestorId(suggestedInvestorId);
    }
  }, [suggestedInvestorId, selectedInvestorId]);

  // Get selected investor
  const selectedInvestor = investors.find(i => i.id === selectedInvestorId);
  const investorProduct = investorProducts.find(p => p.id === selectedInvestor?.investor_product_id);
  const investorBalance = parseFloat(selectedInvestor?.current_capital_balance) || 0;

  // Calculate totals
  const capitalNum = parseFloat(capital) || 0;
  const interestNum = parseFloat(interest) || 0;
  const totalAllocation = capitalNum + interestNum;
  const isBalanced = Math.abs(totalAllocation - amount) < 0.01;
  const remaining = amount - totalAllocation;

  // Check if capital exceeds investor balance
  const capitalExceedsBalance = capitalNum > investorBalance;

  // Handle submit
  const handleSubmit = async () => {
    if (!selectedInvestorId) {
      toast.error('Please select an investor');
      return;
    }

    if (!isBalanced) {
      toast.error('Capital + Interest must equal bank amount');
      return;
    }

    if (capitalExceedsBalance) {
      toast.error('Capital amount exceeds investor balance');
      return;
    }

    setIsSubmitting(true);
    try {
      const investor = investors.find(i => i.id === selectedInvestorId);
      if (!investor) throw new Error('Investor not found');

      await createInvestorWithdrawal({
        bankEntry,
        investor,
        split: {
          capital: capitalNum,
          interest: interestNum
        },
        investorProduct,
        description: description.trim() || undefined
      });

      toast.success('Investor withdrawal created and reconciled');
      onSuccess?.();
    } catch (error) {
      console.error('Error creating withdrawal:', error);
      toast.error(`Failed to create withdrawal: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle enter key
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isBalanced && selectedInvestorId && !capitalExceedsBalance) {
      handleSubmit();
    }
  };

  return (
    <div className="p-3 bg-white rounded-lg shadow-sm space-y-3">
      {/* Row 1: Investor selection and balance info */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600 shrink-0 w-20">Investor:</span>
        <Select value={selectedInvestorId} onValueChange={setSelectedInvestorId}>
          <SelectTrigger className="h-9 flex-1 max-w-[280px]">
            <SelectValue placeholder="Select investor" />
          </SelectTrigger>
          <SelectContent>
            {activeInvestors.map(i => (
              <SelectItem key={i.id} value={i.id}>
                {i.business_name || i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedInvestor && (
          <div className="text-sm text-slate-500">
            Balance: <span className="font-mono font-medium text-slate-700">{formatCurrency(investorBalance)}</span>
          </div>
        )}
      </div>

      {/* Row 2: Description */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600 shrink-0 w-20">Details:</span>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Withdrawal description"
          className="h-9 flex-1"
        />
      </div>

      {/* Row 3: Capital/Interest split and actions */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600 shrink-0 w-20">Split:</span>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded">
            <span className="text-xs font-medium text-blue-700">Capital:</span>
            <Input
              type="number"
              step="0.01"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              onKeyDown={handleKeyDown}
              className={`h-7 w-[100px] font-mono [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield] ${capitalExceedsBalance ? 'border-red-400 bg-red-50' : ''}`}
            />
          </div>

          <span className="text-slate-400">+</span>

          <div className="flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded">
            <span className="text-xs font-medium text-emerald-700">Interest:</span>
            <Input
              type="number"
              step="0.01"
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-7 w-[100px] font-mono [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
            />
          </div>

          <span className="text-slate-400">=</span>

          <div className={`font-mono text-sm font-medium px-2 py-1 rounded ${
            isBalanced
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {formatCurrency(totalAllocation)}
          </div>
        </div>

        {/* Remaining indicator */}
        {!isBalanced && (
          <div className="flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{remaining > 0 ? `${formatCurrency(remaining)} remaining` : `${formatCurrency(Math.abs(remaining))} over`}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto">
          <Button
            size="sm"
            className="h-8"
            onClick={handleSubmit}
            disabled={isSubmitting || !isBalanced || !selectedInvestorId || capitalExceedsBalance}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4 mr-1" />
                Create
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Warning if capital exceeds balance */}
      {capitalExceedsBalance && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Capital amount ({formatCurrency(capitalNum)}) exceeds investor balance ({formatCurrency(investorBalance)})</span>
        </div>
      )}
    </div>
  );
}
