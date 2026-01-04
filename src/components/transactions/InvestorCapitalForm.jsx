import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { CalendarIcon, Loader2, AlertTriangle } from 'lucide-react';
import TransactionPreview, { createInvestorPreviewItems } from './TransactionPreview';
import { cn } from '@/lib/utils';

/**
 * Shared investor capital form for both reconciliation and manual entry
 * Handles both Capital In (funding) and Capital Out (withdrawal) transactions
 *
 * Props:
 * - investor: Pre-selected investor (optional, if provided investor selector is hidden)
 * - investors: Array of available investors for selection
 * - transactionType: 'capital_in' or 'capital_out' (pre-selected type)
 * - amount: Pre-populated amount (from bank entry)
 * - date: Pre-populated date (from bank entry)
 * - reference: Pre-populated reference (from bank entry)
 * - mode: 'inline' (no submit button) or 'standalone' (with submit button)
 * - onSubmit: Callback when form is submitted
 * - onCancel: Callback when cancelled
 * - onChange: Callback when form values change (for inline mode)
 * - isLoading: Show loading state on submit button
 */
export default function InvestorCapitalForm({
  investor: initialInvestor,
  investors = [],
  transactionType: initialType,
  amount: initialAmount,
  date: initialDate,
  reference: initialReference,
  mode = 'standalone',
  onSubmit,
  onCancel,
  onChange,
  isLoading = false
}) {
  // Form state
  const [selectedInvestorId, setSelectedInvestorId] = useState(initialInvestor?.id || '');
  const [transactionType, setTransactionType] = useState(initialType || 'capital_in');
  const [amount, setAmount] = useState(initialAmount || '');
  const [date, setDate] = useState(
    initialDate ? new Date(initialDate) : new Date()
  );
  const [reference, setReference] = useState(initialReference || '');
  const [notes, setNotes] = useState('');

  // Get selected investor
  const selectedInvestor = useMemo(() => {
    return initialInvestor || investors.find(i => i.id === selectedInvestorId);
  }, [initialInvestor, investors, selectedInvestorId]);

  // Calculate values
  const paymentAmount = parseFloat(amount) || 0;

  // Validation
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    if (selectedInvestor && transactionType === 'capital_out') {
      const capitalBalance = selectedInvestor.current_capital_balance || 0;
      if (paymentAmount > capitalBalance) {
        errors.push(`Withdrawal exceeds capital balance (${formatCurrency(capitalBalance)})`);
      }
    }

    if (selectedInvestor?.status === 'Inactive') {
      warnings.push('This investor is marked as inactive');
    }

    return { errors, warnings };
  }, [selectedInvestor, transactionType, paymentAmount]);

  // Balance preview
  const previewItems = useMemo(() => {
    return createInvestorPreviewItems(selectedInvestor, transactionType, paymentAmount);
  }, [selectedInvestor, transactionType, paymentAmount]);

  // Form validity
  const isValid = selectedInvestor && paymentAmount > 0 && date && validation.errors.length === 0;

  // Notify parent of changes (inline mode)
  useEffect(() => {
    if (onChange) {
      onChange({
        investor: selectedInvestor,
        transactionType,
        amount: paymentAmount,
        date,
        reference,
        notes,
        isValid
      });
    }
  }, [selectedInvestor, transactionType, paymentAmount, date, reference, notes, isValid]);

  // Handle submit
  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!isValid || !onSubmit) return;

    onSubmit({
      investor_id: selectedInvestor.id,
      type: transactionType,
      amount: paymentAmount,
      date: format(date, 'yyyy-MM-dd'),
      reference,
      description: notes
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Investor Selection (hidden if investor provided) */}
      {!initialInvestor && (
        <div className="space-y-2">
          <Label>Investor *</Label>
          <Select value={selectedInvestorId} onValueChange={setSelectedInvestorId}>
            <SelectTrigger>
              <SelectValue placeholder="Select investor..." />
            </SelectTrigger>
            <SelectContent>
              {investors.filter(i => i.status === 'Active').map(investor => (
                <SelectItem key={investor.id} value={investor.id}>
                  {investor.name}
                  {investor.account_number && ` (${investor.account_number})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Selected Investor Info */}
      {selectedInvestor && (
        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <p className="font-medium text-purple-900">{selectedInvestor.name}</p>
          <div className="flex gap-4 mt-1 text-sm text-purple-700">
            {selectedInvestor.account_number && (
              <span>Account: {selectedInvestor.account_number}</span>
            )}
            <span>Balance: {formatCurrency(selectedInvestor.current_capital_balance || 0)}</span>
          </div>
        </div>
      )}

      {/* Transaction Type */}
      <div className="space-y-2">
        <Label>Transaction Type *</Label>
        <RadioGroup
          value={transactionType}
          onValueChange={setTransactionType}
          disabled={!!initialType}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="capital_in" id="type-in" />
            <Label
              htmlFor="type-in"
              className={cn(
                "text-sm font-normal cursor-pointer",
                transactionType === 'capital_in' && "text-emerald-600 font-medium"
              )}
            >
              Capital In (Funding)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="capital_out" id="type-out" />
            <Label
              htmlFor="type-out"
              className={cn(
                "text-sm font-normal cursor-pointer",
                transactionType === 'capital_out' && "text-red-600 font-medium"
              )}
            >
              Capital Out (Withdrawal)
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Amount and Date Row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Amount *</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="font-mono"
            disabled={!!initialAmount}
          />
        </div>
        <div className="space-y-2">
          <Label>Date *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={!!initialDate}
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date ? format(date, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Validation Errors/Warnings */}
      {validation.errors.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          {validation.errors.map((error, i) => (
            <p key={i} className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </p>
          ))}
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          {validation.warnings.map((warning, i) => (
            <p key={i} className="text-sm text-amber-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {warning}
            </p>
          ))}
        </div>
      )}

      {/* Balance Preview */}
      {selectedInvestor && paymentAmount > 0 && previewItems.length > 0 && (
        <TransactionPreview
          title="Balance Impact"
          items={previewItems}
        />
      )}

      {/* Reference */}
      <div className="space-y-2">
        <Label>Reference</Label>
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Bank reference or transaction ID"
          disabled={!!initialReference}
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes..."
          rows={2}
        />
      </div>

      {/* Actions (standalone mode only) */}
      {mode === 'standalone' && (
        <div className="flex justify-end gap-3 pt-4 border-t">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!isValid || isLoading}>
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Record {transactionType === 'capital_in' ? 'Funding' : 'Withdrawal'}
          </Button>
        </div>
      )}
    </form>
  );
}
