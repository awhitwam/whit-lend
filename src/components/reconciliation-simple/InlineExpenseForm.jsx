/**
 * InlineExpenseForm - Compact expense form with learned pattern suggestions
 */

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, X, Check, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { createExpense } from '@/lib/reconciliation/reconcileHandler';
import { api } from '@/api/dataClient';
import { extractVendorKeywords, calculateSimilarity } from '@/lib/reconciliation/scoring';

export default function InlineExpenseForm({
  bankEntry,
  expenseTypes = [],
  expenseTypeSuggestion,
  patterns = [],
  loans = [],
  onSuccess,
  onCancel
}) {
  const queryClient = useQueryClient();

  // Initialize with suggested expense type if available
  const [selectedTypeId, setSelectedTypeId] = useState(() => {
    if (expenseTypeSuggestion?.expenseTypeId) {
      return expenseTypeSuggestion.expenseTypeId;
    }
    return '__none__';
  });
  const [description, setDescription] = useState(bankEntry.description || '');
  const [selectedLoanId, setSelectedLoanId] = useState('__none__');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update selected type if suggestion changes
  useEffect(() => {
    if (expenseTypeSuggestion?.expenseTypeId && selectedTypeId === '__none__') {
      setSelectedTypeId(expenseTypeSuggestion.expenseTypeId);
    }
  }, [expenseTypeSuggestion]);

  // Get selected expense type (null if "none" selected)
  const selectedType = selectedTypeId === '__none__' ? null : expenseTypes.find(t => t.id === selectedTypeId);

  // Save or update pattern after successful expense creation
  const saveReconciliationPattern = async (expenseTypeId) => {
    if (!expenseTypeId) return;

    try {
      // Extract keywords from bank entry description
      const keywords = extractVendorKeywords(bankEntry.description);
      if (keywords.length === 0) return;

      const patternText = keywords.slice(0, 5).join(' '); // Use top 5 keywords
      const amount = Math.abs(bankEntry.amount);

      // Check if similar pattern exists
      const existingPattern = patterns.find(p =>
        calculateSimilarity(p.description_pattern, patternText) > 0.7 &&
        p.match_type === 'expense'
      );

      if (existingPattern) {
        // Update existing pattern
        await api.entities.ReconciliationPattern.update(existingPattern.id, {
          match_count: (existingPattern.match_count || 1) + 1,
          confidence_score: Math.min(1, (existingPattern.confidence_score || 0.5) + 0.1),
          last_used_at: new Date().toISOString(),
          // Update expense type if different (user may have corrected it)
          expense_type_id: expenseTypeId
        });
      } else {
        // Create new pattern
        await api.entities.ReconciliationPattern.create({
          description_pattern: patternText,
          amount_min: amount * 0.8, // Allow 20% variance
          amount_max: amount * 1.2,
          transaction_type: 'DBIT',
          bank_source: bankEntry.bank_source,
          match_type: 'expense',
          expense_type_id: expenseTypeId,
          confidence_score: 0.6 // Start with moderate confidence
        });
      }

      // Refresh patterns
      queryClient.invalidateQueries({ queryKey: ['reconciliation-patterns'] });
    } catch (error) {
      // Don't fail the main operation if pattern learning fails
      console.error('Error saving reconciliation pattern:', error);
    }
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!description.trim()) {
      toast.error('Please enter a description');
      return;
    }

    setIsSubmitting(true);
    try {
      await createExpense({
        bankEntry,
        expenseType: selectedType,
        description: description.trim(),
        loan_id: selectedLoanId !== '__none__' ? selectedLoanId : null
      });

      // Learn this pattern for future suggestions
      if (selectedType) {
        await saveReconciliationPattern(selectedType.id);
      }

      toast.success('Expense created and reconciled');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      onSuccess?.();
    } catch (error) {
      console.error('Error creating expense:', error);
      toast.error(`Failed to create expense: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle enter key
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && description.trim()) {
      handleSubmit();
    }
  };

  return (
    <div className="p-3 bg-white rounded-lg shadow-sm space-y-2">
      {/* Suggestion indicator */}
      {expenseTypeSuggestion && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
          <Lightbulb className="w-3 h-3" />
          <span>
            Suggested: <strong>{expenseTypeSuggestion.expenseTypeName}</strong>
            {expenseTypeSuggestion.reason && (
              <span className="text-amber-500 ml-1">({expenseTypeSuggestion.reason})</span>
            )}
          </span>
        </div>
      )}

      {/* Form row */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-600 shrink-0">Expense:</span>
        <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder="Type (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No type</SelectItem>
            {expenseTypes.map(t => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
                {expenseTypeSuggestion?.expenseTypeId === t.id && (
                  <span className="ml-1 text-amber-500">★</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loans.length > 0 && (
          <Select value={selectedLoanId} onValueChange={setSelectedLoanId}>
            <SelectTrigger className="h-8 w-[200px]">
              <SelectValue placeholder="Link to loan (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No loan linked</SelectItem>
              {loans.filter(l => !l.is_deleted).map(loan => (
                <SelectItem key={loan.id} value={loan.id}>
                  {loan.borrower_name} - {loan.loan_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Description"
          className="h-8 flex-1"
        />
        <Button
          size="sm"
          className="h-8"
          onClick={handleSubmit}
          disabled={isSubmitting || !description.trim()}
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
    </div>
  );
}
