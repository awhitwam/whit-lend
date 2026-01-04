import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { CalendarIcon, Loader2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared investor interest payment form
 * Creates a debit entry in the investor_interest ledger
 *
 * Props:
 * - investor: Pre-selected investor (optional)
 * - investors: Array of available investors
 * - investorInterest: Array of interest entries (to calculate interest due)
 * - amount: Pre-populated amount (from bank entry)
 * - date: Pre-populated date (from bank entry)
 * - reference: Pre-populated reference (from bank entry)
 * - mode: 'inline' (no submit button) or 'standalone' (with submit button)
 * - onSubmit: Callback when form is submitted
 * - onCancel: Callback when cancelled
 * - onChange: Callback when form values change (for inline mode)
 * - isLoading: Show loading state on submit button
 */
export default function InvestorInterestForm({
  investor: initialInvestor,
  investors = [],
  investorInterest = [],
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

  // Calculate interest due for selected investor
  const interestDue = useMemo(() => {
    if (!selectedInvestor) return 0;

    const investorEntries = investorInterest.filter(e => e.investor_id === selectedInvestor.id);

    // Sum credits (interest added)
    const totalCredits = investorEntries
      .filter(e => e.type === 'credit')
      .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

    // Sum debits (interest withdrawn)
    const totalDebits = investorEntries
      .filter(e => e.type === 'debit')
      .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

    return Math.max(0, totalCredits - totalDebits);
  }, [selectedInvestor, investorInterest]);

  // Calculate values
  const paymentAmount = parseFloat(amount) || 0;

  // Validation
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    if (selectedInvestor && paymentAmount > 0) {
      if (paymentAmount > interestDue * 1.1) {
        warnings.push(`Payment exceeds interest due (${formatCurrency(interestDue)}) by more than 10%`);
      }
    }

    if (selectedInvestor?.status === 'Inactive') {
      warnings.push('This investor is marked as inactive');
    }

    return { errors, warnings };
  }, [selectedInvestor, paymentAmount, interestDue]);

  // Form validity
  const isValid = selectedInvestor && paymentAmount > 0 && date && validation.errors.length === 0;

  // Notify parent of changes (inline mode)
  useEffect(() => {
    if (onChange) {
      onChange({
        investor: selectedInvestor,
        amount: paymentAmount,
        date,
        reference,
        notes,
        interestDue,
        isValid
      });
    }
  }, [selectedInvestor, paymentAmount, date, reference, notes, interestDue, isValid]);

  // Handle submit
  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!isValid || !onSubmit) return;

    onSubmit({
      investor_id: selectedInvestor.id,
      type: 'debit',
      amount: paymentAmount,
      date: format(date, 'yyyy-MM-dd'),
      reference,
      description: notes || 'Interest payment'
    });
  };

  // Set amount to interest due
  const handlePayFullInterest = () => {
    setAmount(interestDue.toString());
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
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
          <p className="font-medium text-indigo-900">{selectedInvestor.name}</p>
          <div className="flex gap-4 mt-1 text-sm text-indigo-700">
            {selectedInvestor.account_number && (
              <span>Account: {selectedInvestor.account_number}</span>
            )}
            <span>Capital: {formatCurrency(selectedInvestor.current_capital_balance || 0)}</span>
          </div>
        </div>
      )}

      {/* Interest Due Info */}
      {selectedInvestor && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-900">Interest Due:</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-amber-900">
                {formatCurrency(interestDue)}
              </span>
              {interestDue > 0 && !initialAmount && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePayFullInterest}
                  className="text-xs h-6"
                >
                  Pay All
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-amber-700 mt-1">
            Calculated from interest credits minus previous payments
          </p>
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

      {/* Validation Warnings */}
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

      {/* Balance Summary */}
      {selectedInvestor && paymentAmount > 0 && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Interest Due After:</span>
            <span className="font-mono font-medium">
              {formatCurrency(Math.max(0, interestDue - paymentAmount))}
            </span>
          </div>
          {paymentAmount > interestDue && (
            <p className="text-xs text-amber-600 mt-1">
              Payment exceeds interest due by {formatCurrency(paymentAmount - interestDue)}
            </p>
          )}
        </div>
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
            Record Interest Payment
          </Button>
        </div>
      )}
    </form>
  );
}
