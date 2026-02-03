/**
 * InlineOtherIncomeForm - Compact single-row other income form
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { api } from '@/api/dataClient';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';

export default function InlineOtherIncomeForm({
  bankEntry,
  onSuccess,
  onCancel
}) {
  const queryClient = useQueryClient();
  const amount = Math.abs(bankEntry.amount);

  const [description, setDescription] = useState(bankEntry.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle submit
  const handleSubmit = async () => {
    if (!description.trim()) {
      toast.error('Please enter a description');
      return;
    }

    setIsSubmitting(true);
    try {
      // Create other income entry
      const created = await api.entities.OtherIncome.create({
        date: bankEntry.statement_date,
        amount: amount,
        description: description.trim()
      });

      // Create reconciliation entry
      await api.entities.ReconciliationEntry.create({
        bank_statement_id: bankEntry.id,
        other_income_id: created.id,
        amount: amount,
        reconciliation_type: 'other_income',
        notes: 'Created new other income',
        was_created: true
      });

      // Mark bank entry as reconciled
      await api.entities.BankStatement.update(bankEntry.id, {
        is_reconciled: true,
        reconciled_at: new Date().toISOString()
      });

      // Audit log
      await logAudit({
        action: AuditAction.OTHER_INCOME_CREATE,
        entityType: EntityType.OTHER_INCOME,
        entityId: created.id,
        entityName: `Other Income - ${formatCurrency(amount)}`,
        details: {
          amount: amount,
          date: bankEntry.statement_date,
          description: description.trim(),
          source: 'bank_reconciliation'
        }
      });

      toast.success('Other income created and reconciled');
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
      onSuccess?.();
    } catch (error) {
      console.error('Error creating other income:', error);
      toast.error(`Failed to create other income: ${error.message}`);
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
      <span className="text-sm font-medium text-slate-600 shrink-0">Other Income:</span>
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Description (e.g. Bank interest, refund)"
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
