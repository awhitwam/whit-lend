/**
 * InlineTransferForm - Reconcile a movement between the organisation's own accounts
 *
 * Money placed in a savings pot leaves the current account and shows up in the bank feed
 * as an ordinary debit, but nothing has been spent. This files it against an internal
 * account instead, so the entry clears without touching the P&L.
 *
 * Direction is read off the bank entry rather than asked for: a debit is money going into
 * the pot, a credit is money coming back.
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, X, Check, ArrowRightLeft, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { createInternalTransfer } from '@/lib/reconciliation/reconcileHandler';
import { internalAccountBalances, suggestInternalAccount } from '@/lib/internalAccounts';

const EMPTY_ARRAY = [];

export default function InlineTransferForm({
  bankEntry,
  internalAccounts = EMPTY_ARRAY,
  internalTransfers = EMPTY_ARRAY,
  onSuccess,
  onCancel
}) {
  const amount = Math.abs(bankEntry.amount);
  // A debit means money left the current account, so it went into the pot.
  const isIntoPot = bankEntry.amount < 0;

  const activeAccounts = useMemo(
    () => internalAccounts.filter(a => a.is_active !== false),
    [internalAccounts]
  );

  const balances = useMemo(
    () => internalAccountBalances(internalTransfers),
    [internalTransfers]
  );

  const suggestedAccountId = useMemo(
    () => suggestInternalAccount(bankEntry.description, activeAccounts)?.id ?? '',
    [bankEntry.description, activeAccounts]
  );

  // Derived, not stored: a late-loading suggestion is picked up without an effect that
  // can go stale. The user's own choice wins once made.
  const [accountIdOverride, setAccountIdOverride] = useState(null);
  const selectedAccountId = accountIdOverride ?? suggestedAccountId;

  const [description, setDescription] = useState(bankEntry.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedAccount = activeAccounts.find(a => a.id === selectedAccountId);
  const currentBalance = balances.get(selectedAccountId) ?? 0;
  const balanceAfter = isIntoPot ? currentBalance + amount : currentBalance - amount;

  // Taking out more than the pot holds is allowed but worth flagging - it usually means
  // an earlier transfer in has not been reconciled yet.
  const overdrawn = !isIntoPot && balanceAfter < -0.01;

  const handleSubmit = async () => {
    if (!selectedAccount) {
      toast.error('Please select an account');
      return;
    }

    setIsSubmitting(true);
    try {
      await createInternalTransfer({
        bankEntry,
        internalAccount: selectedAccount,
        description: description.trim() || undefined
      });
      toast.success(
        `Transfer ${isIntoPot ? 'to' : 'from'} ${selectedAccount.name} recorded and reconciled`
      );
      onSuccess?.();
    } catch (error) {
      console.error('Error creating internal transfer:', error);
      toast.error(`Failed to record transfer: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && selectedAccount && !isSubmitting) handleSubmit();
  };

  if (activeAccounts.length === 0) {
    return (
      <div className="p-3 bg-white rounded-lg shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-indigo-500" />
            Transfer between accounts
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-sm text-slate-500">
          No internal accounts set up yet. Add one under Finance &rarr; Internal Accounts,
          then file this entry against it.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-white rounded-lg shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-indigo-500" />
          {isIntoPot ? 'Transfer out to another account' : 'Transfer back from another account'}
        </div>
        <div className="text-xs text-slate-500">
          This entry:{' '}
          <span className={`font-mono font-semibold ${isIntoPot ? 'text-red-600' : 'text-green-600'}`}>
            {isIntoPot ? '-' : '+'}{formatCurrency(amount)}
          </span>
        </div>
      </div>

      {/* Account + description */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600 shrink-0 w-20">
          {isIntoPot ? 'Move to:' : 'Came from:'}
        </span>
        <Select value={selectedAccountId} onValueChange={setAccountIdOverride}>
          <SelectTrigger className="h-9 flex-1 max-w-[280px]">
            <SelectValue placeholder="Select account" />
          </SelectTrigger>
          <SelectContent>
            {activeAccounts.map(a => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedAccount && (
          <div className="text-sm text-slate-500">
            Balance:{' '}
            <span className="font-mono font-medium text-slate-700">
              {formatCurrency(currentBalance)}
            </span>
            <span className="mx-1 text-slate-300">&rarr;</span>
            <span className={`font-mono font-medium ${overdrawn ? 'text-red-600' : 'text-slate-900'}`}>
              {formatCurrency(balanceAfter)}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600 shrink-0 w-20">Details:</span>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Transfer description"
          className="h-9 flex-1"
        />
        <div className="flex items-center gap-1 ml-auto">
          <Button
            size="sm"
            className="h-8"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedAccount || amount < 0.01}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4 mr-1" />
                Record Transfer
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {overdrawn && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            This takes {selectedAccount.name} to {formatCurrency(balanceAfter)}. Usually that
            means an earlier transfer into it has not been reconciled yet &mdash; worth checking,
            but you can still file this.
          </span>
        </div>
      )}
    </div>
  );
}
