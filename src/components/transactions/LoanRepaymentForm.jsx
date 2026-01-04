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
import { CalendarIcon, Loader2 } from 'lucide-react';
import SplitInput from './SplitInput';
import TransactionPreview, { createLoanPreviewItems } from './TransactionPreview';
import { cn } from '@/lib/utils';

/**
 * Shared loan repayment form for both reconciliation and manual entry
 *
 * Props:
 * - loan: Pre-selected loan (optional, if provided loan selector is hidden)
 * - loans: Array of available loans for selection
 * - schedules: Array of repayment schedules
 * - amount: Pre-populated amount (from bank entry)
 * - date: Pre-populated date (from bank entry)
 * - reference: Pre-populated reference (from bank entry)
 * - suggestedSplit: Pre-calculated split values
 * - mode: 'inline' (no submit button) or 'standalone' (with submit button)
 * - onSubmit: Callback when form is submitted
 * - onCancel: Callback when cancelled
 * - onChange: Callback when form values change (for inline mode)
 * - isLoading: Show loading state on submit button
 */
export default function LoanRepaymentForm({
  loan: initialLoan,
  loans = [],
  schedules = [],
  amount: initialAmount,
  date: initialDate,
  reference: initialReference,
  suggestedSplit,
  mode = 'standalone',
  onSubmit,
  onCancel,
  onChange,
  isLoading = false
}) {
  // Form state
  const [selectedLoanId, setSelectedLoanId] = useState(initialLoan?.id || '');
  const [amount, setAmount] = useState(initialAmount || '');
  const [date, setDate] = useState(initialDate ? new Date(initialDate) : new Date());
  const [reference, setReference] = useState(initialReference || '');
  const [notes, setNotes] = useState('');
  const [splitMode, setSplitMode] = useState('auto');
  const [manualSplit, setManualSplit] = useState({
    principal: 0,
    interest: 0,
    fees: 0
  });

  // Get selected loan
  const selectedLoan = useMemo(() => {
    return initialLoan || loans.find(l => l.id === selectedLoanId);
  }, [initialLoan, loans, selectedLoanId]);

  // Get schedules for selected loan
  const loanSchedules = useMemo(() => {
    if (!selectedLoan) return [];
    return schedules.filter(s =>
      s.loan_id === selectedLoan.id &&
      (s.status === 'Pending' || s.status === 'Overdue')
    ).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }, [schedules, selectedLoan]);

  // Calculate auto split
  const autoSplit = useMemo(() => {
    const paymentAmount = parseFloat(amount) || 0;

    // If suggested split provided, use it
    if (suggestedSplit) {
      return suggestedSplit;
    }

    // If no loan selected, default to all principal
    if (!selectedLoan) {
      return { principal: paymentAmount, interest: 0, fees: 0 };
    }

    // Find next pending schedule
    const nextSchedule = loanSchedules[0];

    if (nextSchedule) {
      const expectedPrincipal = nextSchedule.principal_amount || 0;
      const expectedInterest = nextSchedule.interest_amount || 0;
      const expectedTotal = expectedPrincipal + expectedInterest;

      // Exact or close match
      if (Math.abs(paymentAmount - expectedTotal) < expectedTotal * 0.05) {
        return {
          principal: expectedPrincipal,
          interest: expectedInterest,
          fees: 0
        };
      }

      // Overpayment
      if (paymentAmount > expectedTotal) {
        return {
          principal: expectedPrincipal + (paymentAmount - expectedTotal),
          interest: expectedInterest,
          fees: 0
        };
      }

      // Underpayment - interest first
      if (paymentAmount <= expectedInterest) {
        return {
          principal: 0,
          interest: paymentAmount,
          fees: 0
        };
      }

      return {
        principal: paymentAmount - expectedInterest,
        interest: expectedInterest,
        fees: 0
      };
    }

    // No schedule - default to principal
    return {
      principal: paymentAmount,
      interest: 0,
      fees: 0
    };
  }, [amount, selectedLoan, loanSchedules, suggestedSplit]);

  // Current split values
  const currentSplit = splitMode === 'auto' ? autoSplit : manualSplit;

  // Validation
  const validation = useMemo(() => {
    const result = { principal: {}, interest: {}, fees: {} };

    if (selectedLoan) {
      // Principal validation
      const outstandingBalance = selectedLoan.outstanding_balance || selectedLoan.principal_amount || 0;
      if (currentSplit.principal > outstandingBalance) {
        result.principal.error = `Exceeds balance (${formatCurrency(outstandingBalance)})`;
      }

      // Interest validation
      if (selectedLoan.accrued_interest !== undefined) {
        if (currentSplit.interest > selectedLoan.accrued_interest * 1.1) {
          result.interest.warning = `Exceeds accrued (${formatCurrency(selectedLoan.accrued_interest)})`;
        }
      }
    }

    return result;
  }, [selectedLoan, currentSplit]);

  // Balance preview
  const previewItems = useMemo(() => {
    return createLoanPreviewItems(selectedLoan, currentSplit);
  }, [selectedLoan, currentSplit]);

  // Form validity
  const paymentAmount = parseFloat(amount) || 0;
  const splitTotal = currentSplit.principal + currentSplit.interest + currentSplit.fees;
  const isBalanced = Math.abs(splitTotal - paymentAmount) < 0.01;
  const hasErrors = Object.values(validation).some(v => v.error);
  const isValid = selectedLoan && paymentAmount > 0 && isBalanced && !hasErrors;

  // Notify parent of changes (inline mode)
  useEffect(() => {
    if (onChange) {
      onChange({
        loan: selectedLoan,
        amount: paymentAmount,
        date,
        reference,
        notes,
        split: currentSplit,
        isValid
      });
    }
  }, [selectedLoan, paymentAmount, date, reference, notes, currentSplit, isValid]);

  // Handle submit
  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!isValid || !onSubmit) return;

    onSubmit({
      loan_id: selectedLoan.id,
      amount: paymentAmount,
      date: format(date, 'yyyy-MM-dd'),
      reference,
      notes,
      principal: currentSplit.principal,
      interest: currentSplit.interest,
      fees: currentSplit.fees
    });
  };

  // Initialize manual split from auto when switching to manual
  useEffect(() => {
    if (splitMode === 'manual') {
      setManualSplit(autoSplit);
    }
  }, [splitMode]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Loan Selection (hidden if loan provided) */}
      {!initialLoan && (
        <div className="space-y-2">
          <Label>Loan *</Label>
          <Select value={selectedLoanId} onValueChange={setSelectedLoanId}>
            <SelectTrigger>
              <SelectValue placeholder="Select loan..." />
            </SelectTrigger>
            <SelectContent>
              {loans.filter(l => l.status === 'Live').map(loan => (
                <SelectItem key={loan.id} value={loan.id}>
                  {loan.loan_number} - {loan.borrower_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Selected Loan Info */}
      {selectedLoan && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="font-medium text-blue-900">{selectedLoan.borrower_name}</p>
          <div className="flex gap-4 mt-1 text-sm text-blue-700">
            <span>{selectedLoan.loan_number}</span>
            <span>Balance: {formatCurrency(selectedLoan.outstanding_balance || selectedLoan.principal_amount || 0)}</span>
          </div>
        </div>
      )}

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

      {/* Split Mode Toggle */}
      {selectedLoan && paymentAmount > 0 && (
        <>
          <div className="flex items-center justify-between">
            <Label>Payment Split</Label>
            <RadioGroup
              value={splitMode}
              onValueChange={setSplitMode}
              className="flex gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="auto" id="split-auto" />
                <Label htmlFor="split-auto" className="text-sm font-normal cursor-pointer">
                  Auto
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="manual" id="split-manual" />
                <Label htmlFor="split-manual" className="text-sm font-normal cursor-pointer">
                  Manual
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Split Input */}
          <SplitInput
            totalAmount={paymentAmount}
            split={currentSplit}
            onChange={setManualSplit}
            disabled={splitMode === 'auto'}
            validation={validation}
          />

          {/* Balance Preview */}
          {previewItems.length > 0 && (
            <TransactionPreview
              title="Balance Impact"
              items={previewItems}
            />
          )}
        </>
      )}

      {/* Reference and Notes */}
      <div className="space-y-2">
        <Label>Reference</Label>
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Bank reference or transaction ID"
          disabled={!!initialReference}
        />
      </div>

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
            Record Payment
          </Button>
        </div>
      )}
    </form>
  );
}
