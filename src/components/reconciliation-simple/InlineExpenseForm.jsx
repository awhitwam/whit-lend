/**
 * InlineExpenseForm - Compact single-row expense form
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { createExpense } from '@/lib/reconciliation/reconcileHandler';

export default function InlineExpenseForm({
  bankEntry,
  expenseTypes = [],
  onSuccess,
  onCancel
}) {
  const queryClient = useQueryClient();

  const [selectedTypeId, setSelectedTypeId] = useState('__none__');
  const [description, setDescription] = useState(bankEntry.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get selected expense type (null if "none" selected)
  const selectedType = selectedTypeId === '__none__' ? null : expenseTypes.find(t => t.id === selectedTypeId);

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
        description: description.trim()
      });

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
    <div className="flex items-center gap-2 p-2 bg-white rounded-lg shadow-sm">
      <span className="text-sm font-medium text-slate-600 shrink-0">Expense:</span>
      <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
        <SelectTrigger className="h-8 w-[140px]">
          <SelectValue placeholder="Type (optional)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No type</SelectItem>
          {expenseTypes.map(t => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  );
}
