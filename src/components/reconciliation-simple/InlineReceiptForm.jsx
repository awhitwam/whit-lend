/**
 * InlineReceiptForm - Create loan repayment from bank entry
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, X } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { createLoanRepayment } from '@/lib/reconciliation/reconcileHandler';

export default function InlineReceiptForm({
  bankEntry,
  loans,
  borrowers,
  onSuccess,
  onCancel
}) {
  const amount = Math.abs(bankEntry.amount);

  const [selectedBorrowerId, setSelectedBorrowerId] = useState('');
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [principal, setPrincipal] = useState('0');
  const [interest, setInterest] = useState(amount.toString());
  const [fees, setFees] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get active loans (excludes Written Off)
  const activeLoans = useMemo(() => {
    return loans.filter(l =>
      l.status === 'Live' || l.status === 'Active'
    );
  }, [loans]);

  // Get borrowers with active loans
  const borrowersWithLoans = useMemo(() => {
    const loanBorrowerIds = new Set(activeLoans.map(l => l.borrower_id));
    return borrowers.filter(b => loanBorrowerIds.has(b.id));
  }, [borrowers, activeLoans]);

  // Get loans for selected borrower
  const borrowerLoans = useMemo(() => {
    if (!selectedBorrowerId) return [];
    return activeLoans.filter(l => l.borrower_id === selectedBorrowerId);
  }, [activeLoans, selectedBorrowerId]);

  // Calculate total allocation
  const totalAllocation = (parseFloat(principal) || 0) + (parseFloat(interest) || 0) + (parseFloat(fees) || 0);
  const isBalanced = Math.abs(totalAllocation - amount) < 0.01;

  // Handle auto-fill to interest
  const handleAutoFill = () => {
    const p = parseFloat(principal) || 0;
    const f = parseFloat(fees) || 0;
    const remaining = amount - p - f;
    setInterest(remaining > 0 ? remaining.toFixed(2) : '0');
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!selectedLoanId) {
      toast.error('Please select a loan');
      return;
    }

    if (!isBalanced) {
      toast.error('Allocation must equal bank entry amount');
      return;
    }

    setIsSubmitting(true);
    try {
      const loan = loans.find(l => l.id === selectedLoanId);
      if (!loan) throw new Error('Loan not found');

      await createLoanRepayment({
        bankEntry,
        loan,
        split: {
          principal: parseFloat(principal) || 0,
          interest: parseFloat(interest) || 0,
          fees: parseFloat(fees) || 0
        }
      });

      toast.success('Repayment created and reconciled');
      onSuccess?.();
    } catch (error) {
      console.error('Error creating repayment:', error);
      toast.error(`Failed to create repayment: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border rounded-lg p-4 bg-white space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">New Loan Repayment</h4>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Borrower Select */}
        <div className="space-y-1.5">
          <Label>Borrower</Label>
          <Select value={selectedBorrowerId} onValueChange={(val) => {
            setSelectedBorrowerId(val);
            setSelectedLoanId('');
          }}>
            <SelectTrigger>
              <SelectValue placeholder="Select borrower" />
            </SelectTrigger>
            <SelectContent>
              {borrowersWithLoans.map(b => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Loan Select */}
        <div className="space-y-1.5">
          <Label>Loan</Label>
          <Select value={selectedLoanId} onValueChange={setSelectedLoanId} disabled={!selectedBorrowerId}>
            <SelectTrigger>
              <SelectValue placeholder={selectedBorrowerId ? 'Select loan' : 'Select borrower first'} />
            </SelectTrigger>
            <SelectContent>
              {borrowerLoans.map(l => (
                <SelectItem key={l.id} value={l.id}>
                  {l.loan_number} - {formatCurrency(l.principal_amount)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Allocation Fields */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Principal</Label>
          <Input
            type="number"
            step="0.01"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Interest</Label>
          <Input
            type="number"
            step="0.01"
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Fees</Label>
          <Input
            type="number"
            step="0.01"
            value={fees}
            onChange={(e) => setFees(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
        <div className="text-sm">
          <span className="text-slate-500">Bank Amount:</span>{' '}
          <span className="font-medium">{formatCurrency(amount)}</span>
        </div>
        <div className="text-sm">
          <span className="text-slate-500">Allocated:</span>{' '}
          <span className={`font-medium ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(totalAllocation)}
          </span>
        </div>
        {!isBalanced && (
          <Button variant="ghost" size="sm" onClick={handleAutoFill}>
            Auto-fill Interest
          </Button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || !isBalanced || !selectedLoanId}>
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : null}
          Create Repayment
        </Button>
      </div>
    </div>
  );
}
