import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, DollarSign, Calendar, FileText, TrendingDown, Wallet, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';

export default function BorrowerPaymentModal({
  isOpen,
  onClose,
  borrower,
  loans = [],
  onSubmit,
  isLoading
}) {
  const [formData, setFormData] = useState({
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    reference: '',
    notes: '',
    overpayment_option: 'credit'
  });

  // Track allocations per loan: { loan_id: { included, interest, principal } }
  const [allocations, setAllocations] = useState({});

  // Initialize allocations when loans change
  useEffect(() => {
    const initial = {};
    loans.forEach(loan => {
      initial[loan.id] = {
        included: false,
        interest: '',
        principal: ''
      };
    });
    setAllocations(initial);
  }, [loans]);

  // Calculate outstanding amounts for each loan
  const loanOutstandings = loans.map(loan => {
    const interestOutstanding = Math.max(0, (loan.total_interest || 0) - (loan.interest_paid || 0));
    const principalOutstanding = Math.max(0, (loan.principal_amount || 0) - (loan.principal_paid || 0));
    const totalOutstanding = interestOutstanding + principalOutstanding;
    return {
      ...loan,
      interestOutstanding,
      principalOutstanding,
      totalOutstanding
    };
  });

  // Calculate totals
  const totalAmount = parseFloat(formData.amount) || 0;
  const totalAllocated = Object.values(allocations).reduce((sum, alloc) => {
    if (!alloc.included) return sum;
    return sum + (parseFloat(alloc.interest) || 0) + (parseFloat(alloc.principal) || 0);
  }, 0);
  const remaining = totalAmount - totalAllocated;
  const includedLoans = Object.entries(allocations).filter(([_, alloc]) => alloc.included).length;

  const handleSubmit = (e) => {
    e.preventDefault();

    // Build allocations array for included loans
    const loanAllocations = Object.entries(allocations)
      .filter(([_, alloc]) => alloc.included && ((parseFloat(alloc.interest) || 0) + (parseFloat(alloc.principal) || 0) > 0))
      .map(([loanId, alloc]) => ({
        loan_id: loanId,
        interest_amount: parseFloat(alloc.interest) || 0,
        principal_amount: parseFloat(alloc.principal) || 0
      }));

    onSubmit({
      borrower_id: borrower.id,
      total_amount: totalAmount,
      date: formData.date,
      reference: formData.reference,
      notes: formData.notes,
      overpayment_option: formData.overpayment_option,
      allocations: loanAllocations
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAllocationChange = (loanId, field, value) => {
    setAllocations(prev => ({
      ...prev,
      [loanId]: {
        ...prev[loanId],
        [field]: value
      }
    }));
  };

  const toggleLoanIncluded = (loanId) => {
    setAllocations(prev => ({
      ...prev,
      [loanId]: {
        ...prev[loanId],
        included: !prev[loanId]?.included,
        // Reset amounts when toggling off
        interest: !prev[loanId]?.included ? prev[loanId]?.interest : '',
        principal: !prev[loanId]?.included ? prev[loanId]?.principal : ''
      }
    }));
  };

  // Validation
  const allocationExceedsTotal = totalAllocated > totalAmount + 0.01;
  const hasValidAllocation = includedLoans > 0 && totalAllocated > 0;
  const isValid = !allocationExceedsTotal && hasValidAllocation;

  // Filter to only active loans
  const activeLoans = loanOutstandings.filter(loan =>
    loan.status === 'Live' || loan.status === 'Active'
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            Record Payment for {borrower?.full_name || borrower?.business || 'Borrower'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Payment Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Total Payment Amount *
            </Label>
            <Input
              id="amount"
              type="number"
              value={formData.amount}
              onChange={(e) => handleChange('amount', e.target.value)}
              placeholder="Enter total payment amount"
              min={0}
              step="0.01"
              required
            />
          </div>

          {/* Loan Allocations */}
          {formData.amount && parseFloat(formData.amount) > 0 && (
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                Allocate to Loans
              </Label>

              {activeLoans.length === 0 ? (
                <div className="p-4 bg-slate-50 rounded-lg text-center text-slate-500">
                  No active loans found for this borrower
                </div>
              ) : (
                <div className="space-y-3">
                  {activeLoans.map((loan) => {
                    const alloc = allocations[loan.id] || { included: false, interest: '', principal: '' };
                    const allocInterest = parseFloat(alloc.interest) || 0;
                    const allocPrincipal = parseFloat(alloc.principal) || 0;
                    const loanTotal = allocInterest + allocPrincipal;

                    return (
                      <Card
                        key={loan.id}
                        className={`${alloc.included ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              id={`loan-${loan.id}`}
                              checked={alloc.included}
                              onCheckedChange={() => toggleLoanIncluded(loan.id)}
                              className="mt-1"
                            />
                            <div className="flex-1 space-y-3">
                              <div className="flex justify-between items-start">
                                <Label
                                  htmlFor={`loan-${loan.id}`}
                                  className="cursor-pointer"
                                >
                                  <div className="font-medium">
                                    #{loan.loan_number || loan.id.slice(0, 8)} - {loan.product_name}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-0.5">
                                    Outstanding: {formatCurrency(loan.totalOutstanding)}
                                    <span className="mx-1">•</span>
                                    Interest: {formatCurrency(loan.interestOutstanding)}
                                    <span className="mx-1">•</span>
                                    Principal: {formatCurrency(loan.principalOutstanding)}
                                  </div>
                                </Label>
                                {alloc.included && loanTotal > 0 && (
                                  <span className="text-sm font-medium text-emerald-700">
                                    {formatCurrency(loanTotal)}
                                  </span>
                                )}
                              </div>

                              {alloc.included && (
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-slate-500">
                                      Interest (max: {formatCurrency(loan.interestOutstanding)})
                                    </Label>
                                    <Input
                                      type="number"
                                      value={alloc.interest}
                                      onChange={(e) => handleAllocationChange(loan.id, 'interest', e.target.value)}
                                      placeholder="0.00"
                                      min={0}
                                      max={loan.interestOutstanding}
                                      step="0.01"
                                      className={allocInterest > loan.interestOutstanding ? 'border-amber-500' : ''}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-slate-500">
                                      Principal (max: {formatCurrency(loan.principalOutstanding)})
                                    </Label>
                                    <Input
                                      type="number"
                                      value={alloc.principal}
                                      onChange={(e) => handleAllocationChange(loan.id, 'principal', e.target.value)}
                                      placeholder="0.00"
                                      min={0}
                                      max={loan.principalOutstanding}
                                      step="0.01"
                                      className={allocPrincipal > loan.principalOutstanding ? 'border-amber-500' : ''}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Allocation Summary */}
              <div className="p-4 bg-slate-50 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Total Payment:</span>
                  <span className="font-medium">{formatCurrency(totalAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Allocated ({includedLoans} loan{includedLoans !== 1 ? 's' : ''}):</span>
                  <span className={`font-medium ${allocationExceedsTotal ? 'text-red-600' : ''}`}>
                    {formatCurrency(totalAllocated)}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-slate-600">Remaining:</span>
                  <span className={`font-bold ${remaining < 0 ? 'text-red-600' : remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {formatCurrency(remaining)}
                  </span>
                </div>

                {allocationExceedsTotal && (
                  <div className="flex items-center gap-2 text-red-600 text-xs mt-2">
                    <AlertCircle className="w-4 h-4" />
                    Allocation exceeds payment amount
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Payment Date */}
          <div className="space-y-2">
            <Label htmlFor="date" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Payment Date *
            </Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) => handleChange('date', e.target.value)}
              required
            />
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <Label htmlFor="reference" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Reference Number
            </Label>
            <Input
              id="reference"
              value={formData.reference}
              onChange={(e) => handleChange('reference', e.target.value)}
              placeholder="e.g. MPESA code, bank ref"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          {/* Overpayment Options */}
          {remaining > 0.01 && (
            <div className="space-y-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-100 rounded">
                  <DollarSign className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="font-medium text-amber-900">Unallocated Amount</p>
                  <p className="text-xs text-amber-700">
                    {formatCurrency(remaining)} not allocated to any loan
                  </p>
                </div>
              </div>

              <Label className="text-sm font-medium text-amber-900">How should we handle the excess?</Label>
              <RadioGroup
                value={formData.overpayment_option}
                onValueChange={(value) => handleChange('overpayment_option', value)}
              >
                <div className="flex items-start space-x-2 p-3 bg-white rounded-lg border border-amber-200 cursor-pointer hover:bg-amber-50">
                  <RadioGroupItem value="reduce_principal" id="reduce" className="mt-1" />
                  <Label htmlFor="reduce" className="cursor-pointer flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingDown className="w-4 h-4 text-emerald-600" />
                      <span className="font-medium text-slate-900">Reduce Principal Balance</span>
                    </div>
                    <p className="text-xs text-slate-600">Apply excess to reduce principal on allocated loans</p>
                  </Label>
                </div>

                <div className="flex items-start space-x-2 p-3 bg-white rounded-lg border border-amber-200 cursor-pointer hover:bg-amber-50">
                  <RadioGroupItem value="credit" id="credit" className="mt-1" />
                  <Label htmlFor="credit" className="cursor-pointer flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet className="w-4 h-4 text-blue-600" />
                      <span className="font-medium text-slate-900">Keep as Credit</span>
                    </div>
                    <p className="text-xs text-slate-600">Store as credit on first allocated loan</p>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !formData.amount || !isValid}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
