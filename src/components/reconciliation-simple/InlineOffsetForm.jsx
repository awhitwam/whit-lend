/**
 * InlineOffsetForm - Link opposite-sign bank entries that cancel each other out
 *
 * Used for "Funds Returned" / bank movement scenarios where a payment goes out
 * and a corresponding payment comes back. No loan/investor/expense entity is created.
 */

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, X, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { api } from '@/api/dataClient';

export default function InlineOffsetForm({
  bankEntry,
  oppositeEntries = [],
  onSuccess,
  onCancel
}) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sort opposite entries by best match (closest amount, then closest date)
  const sortedEntries = useMemo(() => {
    const entryDate = new Date(bankEntry.statement_date).getTime();
    const entryAbs = Math.abs(bankEntry.amount);

    return [...oppositeEntries].sort((a, b) => {
      // Exact amount match gets top priority
      const aAmtDiff = Math.abs(Math.abs(a.amount) - entryAbs);
      const bAmtDiff = Math.abs(Math.abs(b.amount) - entryAbs);
      const aExact = aAmtDiff < 0.01 ? 0 : 1;
      const bExact = bAmtDiff < 0.01 ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      // Then by date proximity
      const aDateDiff = Math.abs(new Date(a.statement_date).getTime() - entryDate);
      const bDateDiff = Math.abs(new Date(b.statement_date).getTime() - entryDate);
      return aDateDiff - bDateDiff;
    });
  }, [oppositeEntries, bankEntry]);

  // Calculate running balance
  const runningBalance = useMemo(() => {
    let total = bankEntry.amount;
    for (const entry of oppositeEntries) {
      if (selectedIds.has(entry.id)) {
        total += entry.amount;
      }
    }
    return total;
  }, [bankEntry, oppositeEntries, selectedIds]);

  const isBalanced = Math.abs(runningBalance) < 0.01;
  const canSubmit = isBalanced && notes.trim() && !isSubmitting;

  const toggleEntry = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const selectedEntries = oppositeEntries.filter(e => selectedIds.has(e.id));
      const allEntries = [bankEntry, ...selectedEntries];

      // Generate unique group ID
      const offsetGroupId = `offset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const notesWithGroupId = `[${offsetGroupId}] ${notes.trim()}`;

      // Mark all entries as reconciled and create reconciliation entries
      for (const entry of allEntries) {
        await api.entities.BankStatement.update(entry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        await api.entities.ReconciliationEntry.create({
          bank_statement_id: entry.id,
          reconciliation_type: 'offset',
          amount: entry.amount,
          notes: notesWithGroupId,
          was_created: false
        });
      }

      queryClient.invalidateQueries({ queryKey: ['bank-statements-unreconciled'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements-reconciled'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });

      toast.success(`${allEntries.length} entries offset and reconciled`);
      onSuccess?.();
    } catch (error) {
      console.error('Error creating offset reconciliation:', error);
      toast.error(`Failed to reconcile: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-700">
          Funds Returned / Offset
        </div>
        <div className="text-xs text-slate-500">
          This entry: <span className={`font-mono font-semibold ${bankEntry.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {bankEntry.amount > 0 ? '+' : '-'}{formatCurrency(Math.abs(bankEntry.amount))}
          </span>
        </div>
      </div>

      {/* Opposite entries list */}
      {sortedEntries.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-4">
          No opposite entries available to offset against
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
          {sortedEntries.map(entry => {
            const isSelected = selectedIds.has(entry.id);
            const amtMatch = Math.abs(Math.abs(entry.amount) - Math.abs(bankEntry.amount)) < 0.01;
            return (
              <label
                key={entry.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors ${
                  isSelected ? 'bg-blue-50' : ''
                }`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleEntry(entry.id)}
                />
                <span className="text-xs text-slate-500 w-20 shrink-0">
                  {format(new Date(entry.statement_date), 'dd MMM yyyy')}
                </span>
                <span className={`text-sm font-mono font-semibold w-24 shrink-0 text-right ${
                  entry.amount > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {entry.amount > 0 ? '+' : '-'}{formatCurrency(Math.abs(entry.amount))}
                </span>
                <span className="text-sm text-slate-600 truncate flex-1">
                  {entry.description || 'No description'}
                </span>
                {amtMatch && (
                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded shrink-0">
                    Exact match
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {/* Balance + Notes + Actions */}
      <div className="flex items-center gap-2">
        <div className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${
          selectedIds.size === 0
            ? 'bg-slate-100 text-slate-500'
            : isBalanced
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
        }`}>
          Net: {formatCurrency(runningBalance)}
        </div>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason (e.g. Failed payment returned)"
          className="h-8 flex-1 text-sm"
        />
        <Button
          size="sm"
          className="h-8"
          onClick={handleSubmit}
          disabled={!canSubmit}
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
