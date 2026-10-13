import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, DollarSign, Calendar, FileText, TrendingDown, Wallet, Settings2, Percent, Banknote } from 'lucide-react';
import { formatCurrency, calculateLoanInterestBalance } from './LoanCalculator';
import { calculatePrincipalAtDate, allocateSettlement } from '@/lib/schedule/utils/interestCalculations';
import { getExitFeeRemaining } from '@/lib/loanCalculations';
import { format } from 'date-fns';

export default function PaymentModal({
  isOpen,
  onClose,
  loan,
  outstandingAmount,
  outstandingInterest = 0,
  outstandingPrincipal = 0,
  exitFeeOutstanding = 0,
  schedule = [],
  transactions = [],
  product = null,
  onSubmit,
  isLoading
}) {
  // Determine product type
  const isFixedCharge = loan?.product_type === 'Fixed Charge';
  const isIrregularIncome = loan?.product_type === 'Irregular Income';
  const isSpecialType = isFixedCharge || isIrregularIncome;
  const [formData, setFormData] = useState({
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    reference: '',
    notes: '',
    overpayment_option: 'credit'
  });

  const [manualMode, setManualMode] = useState(false);
  // Off by default: an exit fee falls due on redemption, so a routine overpayment must not have
  // it skimmed off the top without the user saying so.
  const [allocateExitFee, setAllocateExitFee] = useState(false);
  const [interestAmount, setInterestAmount] = useState('');
  const [principalAmount, setPrincipalAmount] = useState('');
  const [feesAmount, setFeesAmount] = useState('');

  // Reset manual amounts when total amount changes and not in manual mode
  useEffect(() => {
    if (!manualMode && formData.amount) {
      setInterestAmount('');
      setPrincipalAmount('');
      setFeesAmount('');
    }
  }, [formData.amount, manualMode]);

  const handleSubmit = (e) => {
    e.preventDefault();

    const paymentData = {
      loan_id: loan.id,
      borrower_id: loan.borrower_id,
      amount: parseFloat(formData.amount),
      date: formData.date,
      type: 'Repayment',
      reference: formData.reference,
      notes: formData.notes,
      overpayment_option: formData.overpayment_option,
      allocate_exit_fee: !manualMode && allocateExitFee && exitFeeOutstanding > 0
    };

    // Add manual split amounts if in manual mode
    if (manualMode) {
      paymentData.manual_split = true;
      paymentData.interest_amount = parseFloat(interestAmount) || 0;
      paymentData.principal_amount = parseFloat(principalAmount) || 0;
      paymentData.fees_amount = parseFloat(feesAmount) || 0;
    }

    onSubmit(paymentData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Calculate allocated and remaining amounts in manual mode
  const totalAmount = parseFloat(formData.amount) || 0;
  const allocatedInterest = parseFloat(interestAmount) || 0;
  const allocatedPrincipal = parseFloat(principalAmount) || 0;
  const allocatedFees = parseFloat(feesAmount) || 0;
  const totalAllocated = allocatedInterest + allocatedFees + allocatedPrincipal;
  const remaining = totalAmount - totalAllocated;

  // What is actually owed as at the DATE OF THE REPAYMENT, not today. Back-dating a redemption
  // must not settle interest that had not yet accrued on the day the money arrived.
  const owedAtPaymentDate = useMemo(() => {
    if (!loan || !formData.date) return null;

    const asOf = new Date(formData.date);
    if (Number.isNaN(asOf.getTime())) return null;

    const interest = Math.max(
      0,
      calculateLoanInterestBalance(loan, schedule, transactions, asOf, product).interestBalance
    );
    const fees = getExitFeeRemaining(loan, transactions, asOf);
    const capital = calculatePrincipalAtDate(
      loan.principal_amount,
      transactions,
      asOf,
      loan.start_date,
      true
    );

    return { interest, fees, capital };
  }, [loan, schedule, transactions, product, formData.date]);

  // Interest, then fees, then capital - the order a redemption settles in.
  const proposedAllocation = useMemo(() => {
    if (!owedAtPaymentDate || totalAmount <= 0) return null;

    return allocateSettlement({
      amount: totalAmount,
      interestOutstanding: owedAtPaymentDate.interest,
      feesOutstanding: owedAtPaymentDate.fees,
      capitalOutstanding: owedAtPaymentDate.capital
    });
  }, [owedAtPaymentDate, totalAmount]);

  // A payment bigger than the capital outstanding is a redemption: it has to be spread across
  // interest and fees as well, so offer the split rather than letting the waterfall guess.
  const isRedemption = Boolean(
    owedAtPaymentDate && totalAmount > 0 && totalAmount > owedAtPaymentDate.capital
  );

  const applyProposedAllocation = () => {
    if (!proposedAllocation) return;
    setManualMode(true);
    setInterestAmount(proposedAllocation.interest.toFixed(2));
    setFeesAmount(proposedAllocation.fees.toFixed(2));
    setPrincipalAmount(proposedAllocation.capital.toFixed(2));
  };

  // Validation - measured against the payment date, falling back to the live figures.
  const maxInterest = owedAtPaymentDate ? owedAtPaymentDate.interest : outstandingInterest;
  const maxFees = owedAtPaymentDate ? owedAtPaymentDate.fees : exitFeeOutstanding;
  const maxPrincipal = owedAtPaymentDate ? owedAtPaymentDate.capital : outstandingPrincipal;

  const interestExceedsOutstanding = allocatedInterest > maxInterest;
  const principalExceedsOutstanding = allocatedPrincipal > maxPrincipal;
  const feesExceedOutstanding = allocatedFees > maxFees;
  const allocationExceedsTotal = totalAllocated > totalAmount;

  // Stays available during a redemption too: the split card below switches to manual entry, so
  // without this a user who ignored it would allocate nothing to the fee.
  const showExitFeeOption = !manualMode && exitFeeOutstanding > 0;

  const isValid = !manualMode || (!allocationExceedsTotal && totalAllocated > 0);
  const showOverpayment = (manualMode && remaining > 0) || (!manualMode && formData.amount && parseFloat(formData.amount) > outstandingAmount);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            Record Payment
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Loan Summary Header - Different for each product type */}
          {isIrregularIncome ? (
            <div className="grid grid-cols-1 gap-3">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-blue-600 mb-0.5">Principal Outstanding</p>
                  <p className="text-lg font-bold text-blue-700">{formatCurrency(outstandingPrincipal)}</p>
                  <p className="text-xs text-slate-500 mt-1">No interest on irregular income loans</p>
                </CardContent>
              </Card>
            </div>
          ) : isFixedCharge ? (
            <div className="grid grid-cols-1 gap-3">
              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-purple-600 mb-0.5">Charges Outstanding</p>
                  <p className="text-lg font-bold text-purple-700">{formatCurrency(outstandingAmount)}</p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Card className="bg-slate-50 border-slate-200">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Total Outstanding</p>
                  <p className="text-lg font-bold text-slate-900">{formatCurrency(outstandingAmount)}</p>
                </CardContent>
              </Card>
              <Card className="bg-amber-50 border-amber-200">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-amber-600 mb-0.5">Interest Due</p>
                  <p className="text-lg font-bold text-amber-700">{formatCurrency(outstandingInterest)}</p>
                </CardContent>
              </Card>
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-blue-600 mb-0.5">Principal Due</p>
                  <p className="text-lg font-bold text-blue-700">{formatCurrency(outstandingPrincipal)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Main Form Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Left Column - Payment Details */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="amount" className="flex items-center gap-2 text-sm font-medium">
                  <DollarSign className="w-4 h-4" />
                  Payment Amount *
                </Label>
                <Input
                  id="amount"
                  type="number"
                  value={formData.amount}
                  onChange={(e) => handleChange('amount', e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step="0.01"
                  required
                  className="text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="date" className="flex items-center gap-2 text-sm font-medium">
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

              <div className="space-y-2">
                <Label htmlFor="reference" className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="w-4 h-4" />
                  Reference
                </Label>
                <Input
                  id="reference"
                  value={formData.reference}
                  onChange={(e) => handleChange('reference', e.target.value)}
                  placeholder="Bank ref, MPESA code..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-sm font-medium">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Additional notes..."
                  rows={2}
                  className="resize-none"
                />
              </div>
            </div>

            {/* Right Column - Attribution (only for standard loans) */}
            <div className="space-y-4">
              {/* Info for special product types */}
              {isIrregularIncome && (
                <Card className="border-amber-200 bg-amber-50">
                  <CardContent className="p-3">
                    <p className="text-sm text-amber-800 font-medium">Irregular Income Payment</p>
                    <p className="text-xs text-amber-600 mt-1">
                      Payment will be applied directly to principal. No interest calculation.
                    </p>
                  </CardContent>
                </Card>
              )}

              {isFixedCharge && (
                <Card className="border-purple-200 bg-purple-50">
                  <CardContent className="p-3">
                    <p className="text-sm text-purple-800 font-medium">Facility Charge Payment</p>
                    <p className="text-xs text-purple-600 mt-1">
                      Payment will be applied to outstanding charges.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Redemption: payment exceeds the capital outstanding, so it has to cover
                  interest and fees too. Figures are as at the payment date. */}
              {!isSpecialType && isRedemption && proposedAllocation && (
                <Card className="border-emerald-300 bg-emerald-50/60">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-emerald-100 rounded-lg">
                        <Banknote className="w-4 h-4 text-emerald-700" />
                      </div>
                      <div>
                        <p className="font-medium text-emerald-900">Redemption payment</p>
                        <p className="text-sm text-emerald-700">
                          Exceeds the {formatCurrency(owedAtPaymentDate.capital)} capital outstanding.
                          Suggested split as at {format(new Date(formData.date), 'dd MMM yyyy')}:
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-sm bg-white rounded-lg border border-emerald-200 p-3">
                      <div className="flex justify-between">
                        <span className="text-slate-600">1. Interest outstanding</span>
                        <span className="font-medium">{formatCurrency(proposedAllocation.interest)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">2. Fees outstanding</span>
                        <span className="font-medium">{formatCurrency(proposedAllocation.fees)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">3. Capital</span>
                        <span className="font-medium">{formatCurrency(proposedAllocation.capital)}</span>
                      </div>
                      <div className="flex justify-between pt-1.5 border-t border-emerald-200 font-medium">
                        <span className="text-slate-700">Capital remaining</span>
                        <span className={proposedAllocation.capitalAfter > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                          {formatCurrency(proposedAllocation.capitalAfter)}
                        </span>
                      </div>
                      {proposedAllocation.excess > 0 && (
                        <div className="flex justify-between text-amber-600">
                          <span>Unallocated excess</span>
                          <span className="font-medium">{formatCurrency(proposedAllocation.excess)}</span>
                        </div>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                      onClick={applyProposedAllocation}
                    >
                      Apply this split
                    </Button>
                    <p className="text-xs text-emerald-700">
                      Fills the manual split below so you can adjust it before saving.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Manual Attribution Toggle - only for standard loans */}
              {!isSpecialType && (
              <Card className={`${manualMode ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200'}`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-slate-500" />
                      <div>
                        <Label htmlFor="manual-mode" className="font-medium cursor-pointer text-sm">
                          Manual Attribution
                        </Label>
                        <p className="text-xs text-slate-500">Specify interest / fees / principal split</p>
                      </div>
                    </div>
                    <Switch
                      id="manual-mode"
                      checked={manualMode}
                      onCheckedChange={setManualMode}
                    />
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Manual Split Inputs - only for standard loans */}
              {!isSpecialType && manualMode && formData.amount && (
                <Card className="border-blue-200 bg-blue-50/30">
                  <CardContent className="p-4 space-y-4">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="interest_amount" className="text-sm flex items-center gap-1.5">
                            <Percent className="w-3.5 h-3.5 text-amber-600" />
                            Interest
                          </Label>
                          <span className="text-xs text-slate-500">
                            max {formatCurrency(maxInterest)}
                          </span>
                        </div>
                        <Input
                          id="interest_amount"
                          type="number"
                          value={interestAmount}
                          onChange={(e) => setInterestAmount(e.target.value)}
                          placeholder="0.00"
                          min={0}
                          step="0.01"
                          className={`${interestExceedsOutstanding ? 'border-amber-500 bg-amber-50' : ''}`}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="fees_amount" className="text-sm flex items-center gap-1.5">
                            <Wallet className="w-3.5 h-3.5 text-violet-600" />
                            Fees
                          </Label>
                          <span className="text-xs text-slate-500">
                            max {formatCurrency(maxFees)}
                          </span>
                        </div>
                        <Input
                          id="fees_amount"
                          type="number"
                          value={feesAmount}
                          onChange={(e) => setFeesAmount(e.target.value)}
                          placeholder="0.00"
                          min={0}
                          step="0.01"
                          className={`${feesExceedOutstanding ? 'border-amber-500 bg-amber-50' : ''}`}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="principal_amount" className="text-sm flex items-center gap-1.5">
                            <Banknote className="w-3.5 h-3.5 text-blue-600" />
                            Principal
                          </Label>
                          <span className="text-xs text-slate-500">
                            max {formatCurrency(maxPrincipal)}
                          </span>
                        </div>
                        <Input
                          id="principal_amount"
                          type="number"
                          value={principalAmount}
                          onChange={(e) => setPrincipalAmount(e.target.value)}
                          placeholder="0.00"
                          min={0}
                          step="0.01"
                          className={`${principalExceedsOutstanding ? 'border-amber-500 bg-amber-50' : ''}`}
                        />
                      </div>
                    </div>

                    {/* Allocation Summary */}
                    <div className="pt-3 border-t border-blue-200 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Payment:</span>
                        <span className="font-medium">{formatCurrency(totalAmount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Allocated:</span>
                        <span className={`font-medium ${allocationExceedsTotal ? 'text-red-600' : ''}`}>
                          {formatCurrency(totalAllocated)}
                        </span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span className="text-slate-700">Remaining:</span>
                        <span className={`${remaining < 0 ? 'text-red-600' : remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {formatCurrency(remaining)}
                        </span>
                      </div>
                      {allocationExceedsTotal && (
                        <p className="text-xs text-red-600 pt-1">
                          Allocation exceeds payment amount
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Auto-allocation info when not in manual mode - only for standard loans */}
              {!isSpecialType && !manualMode && formData.amount && (
                <Card className="border-slate-200 bg-slate-50/50">
                  <CardContent className="p-4">
                    <div className="text-sm text-slate-600">
                      <p className="font-medium text-slate-700 mb-2">Auto-Allocation</p>
                      <p className="text-xs">
                        Payment will be applied in order: interest first, then principal.
                        Any excess will be handled according to your selection below.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Exit fee allocation - the fee sits between interest and capital */}
          {showExitFeeOption && (
            <Card className={allocateExitFee ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-violet-100 rounded-lg">
                      <Banknote className="w-4 h-4 text-violet-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">
                        Settle exit fee ({formatCurrency(exitFeeOutstanding)})
                      </p>
                      <p className="text-sm text-slate-500">
                        Allocated after outstanding interest and before capital.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={allocateExitFee}
                    onCheckedChange={setAllocateExitFee}
                    aria-label="Settle exit fee from this payment"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Overpayment Options - Full Width (only for standard loans) */}
          {!isSpecialType && showOverpayment && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <DollarSign className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-amber-900">Overpayment Detected</p>
                    <p className="text-sm text-amber-700">
                      Excess: {formatCurrency(manualMode ? remaining : parseFloat(formData.amount) - outstandingAmount)}
                    </p>
                  </div>
                </div>

                <RadioGroup
                  value={formData.overpayment_option}
                  onValueChange={(value) => handleChange('overpayment_option', value)}
                  className="grid grid-cols-2 gap-3"
                >
                  <div className={`flex items-start space-x-2 p-3 bg-white rounded-lg border cursor-pointer hover:bg-amber-50 ${formData.overpayment_option === 'reduce_principal' ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-amber-200'}`}>
                    <RadioGroupItem value="reduce_principal" id="reduce" className="mt-0.5" />
                    <Label htmlFor="reduce" className="cursor-pointer flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <TrendingDown className="w-4 h-4 text-emerald-600" />
                        <span className="font-medium text-slate-900 text-sm">Reduce Principal</span>
                      </div>
                      <p className="text-xs text-slate-500">Lower future interest</p>
                    </Label>
                  </div>

                  <div className={`flex items-start space-x-2 p-3 bg-white rounded-lg border cursor-pointer hover:bg-amber-50 ${formData.overpayment_option === 'credit' ? 'border-blue-400 ring-1 ring-blue-400' : 'border-amber-200'}`}>
                    <RadioGroupItem value="credit" id="credit" className="mt-0.5" />
                    <Label htmlFor="credit" className="cursor-pointer flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Wallet className="w-4 h-4 text-blue-600" />
                        <span className="font-medium text-slate-900 text-sm">Keep as Credit</span>
                      </div>
                      <p className="text-xs text-slate-500">Apply to future payments</p>
                    </Label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !formData.amount || !isValid}
              className="bg-emerald-600 hover:bg-emerald-700 min-w-[140px]"
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
