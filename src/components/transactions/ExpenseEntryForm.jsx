import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared expense entry form for both reconciliation and manual entry
 *
 * Props:
 * - expense: Existing expense for editing (optional)
 * - expenseTypes: Array of available expense types
 * - loans: Array of loans for loan-level expenses
 * - amount: Pre-populated amount (from bank entry)
 * - date: Pre-populated date (from bank entry)
 * - description: Pre-populated description (from bank entry)
 * - suggestedType: Pre-suggested expense type
 * - suggestedLoan: Pre-suggested loan for loan-level expense
 * - mode: 'inline' (no submit button) or 'standalone' (with submit button)
 * - onSubmit: Callback when form is submitted
 * - onCancel: Callback when cancelled
 * - onChange: Callback when form values change (for inline mode)
 * - isLoading: Show loading state on submit button
 */
export default function ExpenseEntryForm({
  expense,
  expenseTypes = [],
  loans = [],
  amount: initialAmount,
  date: initialDate,
  description: initialDescription,
  suggestedType,
  suggestedLoan,
  mode = 'standalone',
  onSubmit,
  onCancel,
  onChange,
  isLoading = false
}) {
  // Form state
  const [expenseTypeId, setExpenseTypeId] = useState(
    expense?.type_id || suggestedType?.id || ''
  );
  const [amount, setAmount] = useState(
    expense?.amount || initialAmount || ''
  );
  const [date, setDate] = useState(
    expense?.date ? new Date(expense.date) :
      initialDate ? new Date(initialDate) :
        new Date()
  );
  const [description, setDescription] = useState(
    expense?.description || initialDescription || ''
  );
  const [expenseLevel, setExpenseLevel] = useState(
    expense?.loan_id || suggestedLoan ? 'loan' : 'platform'
  );
  const [selectedLoanId, setSelectedLoanId] = useState(
    expense?.loan_id || suggestedLoan?.id || ''
  );
  const [capitalise, setCapitalise] = useState(
    expense?.is_capitalised || false
  );

  // Get selected expense type
  const selectedType = useMemo(() => {
    return expenseTypes.find(t => t.id === expenseTypeId);
  }, [expenseTypes, expenseTypeId]);

  // Get selected loan
  const selectedLoan = useMemo(() => {
    return loans.find(l => l.id === selectedLoanId);
  }, [loans, selectedLoanId]);

  // Form validity
  const paymentAmount = parseFloat(amount) || 0;
  const isValid = expenseTypeId && paymentAmount > 0 && date &&
    (expenseLevel === 'platform' || (expenseLevel === 'loan' && selectedLoanId));

  // Notify parent of changes (inline mode)
  useEffect(() => {
    if (onChange) {
      onChange({
        expenseType: selectedType,
        loan: selectedLoan,
        amount: paymentAmount,
        date,
        description,
        expenseLevel,
        capitalise,
        isValid
      });
    }
  }, [selectedType, selectedLoan, paymentAmount, date, description, expenseLevel, capitalise, isValid]);

  // Handle submit
  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!isValid || !onSubmit) return;

    onSubmit({
      type_id: expenseTypeId,
      type_name: selectedType?.name,
      amount: paymentAmount,
      date: format(date, 'yyyy-MM-dd'),
      description,
      loan_id: expenseLevel === 'loan' ? selectedLoanId : null,
      is_capitalised: expenseLevel === 'loan' ? capitalise : false
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Expense Type */}
      <div className="space-y-2">
        <Label>Expense Type *</Label>
        <Select value={expenseTypeId} onValueChange={setExpenseTypeId}>
          <SelectTrigger>
            <SelectValue placeholder="Select expense type..." />
          </SelectTrigger>
          <SelectContent>
            {expenseTypes.map(type => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      {/* Expense Level */}
      <div className="space-y-3">
        <Label>Expense Association</Label>
        <RadioGroup
          value={expenseLevel}
          onValueChange={setExpenseLevel}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="platform" id="level-platform" />
            <Label htmlFor="level-platform" className="text-sm font-normal cursor-pointer">
              Platform-level expense
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="loan" id="level-loan" />
            <Label htmlFor="level-loan" className="text-sm font-normal cursor-pointer">
              Loan-level expense
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Loan Selection (for loan-level expenses) */}
      {expenseLevel === 'loan' && (
        <div className="space-y-3 pl-4 border-l-2 border-blue-200">
          <div className="space-y-2">
            <Label>Linked Loan *</Label>
            <Select value={selectedLoanId} onValueChange={setSelectedLoanId}>
              <SelectTrigger>
                <SelectValue placeholder="Select loan..." />
              </SelectTrigger>
              <SelectContent>
                {loans.filter(l => l.status === 'Live' || l.status === 'Approved').map(loan => (
                  <SelectItem key={loan.id} value={loan.id}>
                    {loan.loan_number} - {loan.borrower_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedLoan && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="font-medium text-blue-900">{selectedLoan.borrower_name}</p>
              <p className="text-sm text-blue-700">{selectedLoan.loan_number}</p>
            </div>
          )}

          {/* Capitalise Option */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="capitalise"
              checked={capitalise}
              onCheckedChange={setCapitalise}
            />
            <Label
              htmlFor="capitalise"
              className="text-sm font-normal cursor-pointer"
            >
              Capitalise to loan (add to loan charges)
            </Label>
          </div>

          {capitalise && (
            <p className="text-xs text-amber-600">
              This expense will be added to the loan's outstanding charges and included in repayment calculations.
            </p>
          )}
        </div>
      )}

      {/* Description */}
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Expense description..."
          rows={2}
          disabled={!!initialDescription}
        />
      </div>

      {/* Summary */}
      {selectedType && paymentAmount > 0 && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">{selectedType.name}</span>
            <span className="font-mono font-semibold text-red-600">
              {formatCurrency(paymentAmount)}
            </span>
          </div>
          {expenseLevel === 'loan' && selectedLoan && (
            <p className="text-xs text-slate-500 mt-1">
              Linked to {selectedLoan.borrower_name}
              {capitalise && ' (capitalised)'}
            </p>
          )}
        </div>
      )}

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
            {expense ? 'Update Expense' : 'Record Expense'}
          </Button>
        </div>
      )}
    </form>
  );
}
