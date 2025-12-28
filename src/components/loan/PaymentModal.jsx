import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, DollarSign, Calendar, FileText, TrendingDown, Wallet, Settings2, Percent, Banknote } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';
import { format } from 'date-fns';

export default function PaymentModal({
  isOpen,
  onClose,
  loan,
  outstandingAmount,
  outstandingInterest = 0,
  outstandingPrincipal = 0,
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

  const [manualMode, setManualMode] = useState(false);
  const [interestAmount, setInterestAmount] = useState('');
  const [principalAmount, setPrincipalAmount] = useState('');

  // Reset manual amounts when total amount changes and not in manual mode
  useEffect(() => {
    if (!manualMode && formData.amount) {
      setInterestAmount('');
      setPrincipalAmount('');
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
      overpayment_option: formData.overpayment_option
    };

    // Add manual split amounts if in manual mode
    if (manualMode) {
      paymentData.manual_split = true;
      paymentData.interest_amount = parseFloat(interestAmount) || 0;
      paymentData.principal_amount = parseFloat(principalAmount) || 0;
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
  const totalAllocated = allocatedInterest + allocatedPrincipal;
  const remaining = totalAmount - totalAllocated;

  // Validation
  const interestExceedsOutstanding = allocatedInterest > outstandingInterest;
  const principalExceedsOutstanding = allocatedPrincipal > outstandingPrincipal;
  const allocationExceedsTotal = totalAllocated > totalAmount;

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
          {/* Loan Summary Header */}
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

            {/* Right Column - Attribution */}
            <div className="space-y-4">
              {/* Manual Attribution Toggle */}
              <Card className={`${manualMode ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200'}`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-slate-500" />
                      <div>
                        <Label htmlFor="manual-mode" className="font-medium cursor-pointer text-sm">
                          Manual Attribution
                        </Label>
                        <p className="text-xs text-slate-500">Specify interest/principal split</p>
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

              {/* Manual Split Inputs */}
              {manualMode && formData.amount && (
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
                            max {formatCurrency(outstandingInterest)}
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
                          <Label htmlFor="principal_amount" className="text-sm flex items-center gap-1.5">
                            <Banknote className="w-3.5 h-3.5 text-blue-600" />
                            Principal
                          </Label>
                          <span className="text-xs text-slate-500">
                            max {formatCurrency(outstandingPrincipal)}
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

              {/* Auto-allocation info when not in manual mode */}
              {!manualMode && formData.amount && (
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

          {/* Overpayment Options - Full Width */}
          {showOverpayment && (
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
