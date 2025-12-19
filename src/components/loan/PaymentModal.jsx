import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, DollarSign, Calendar, FileText, TrendingDown, Wallet } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';
import { format } from 'date-fns';

export default function PaymentModal({ 
  isOpen, 
  onClose, 
  loan, 
  outstandingAmount,
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

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      loan_id: loan.id,
      borrower_id: loan.borrower_id,
      amount: parseFloat(formData.amount),
      date: formData.date,
      type: 'Repayment',
      reference: formData.reference,
      notes: formData.notes,
      overpayment_option: formData.overpayment_option
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            Record Payment
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Loan</span>
              <span className="font-medium">{loan?.borrower_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Outstanding Balance</span>
              <span className="font-semibold text-red-600">{formatCurrency(outstandingAmount)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Payment Amount *
            </Label>
            <Input
              id="amount"
              type="number"
              value={formData.amount}
              onChange={(e) => handleChange('amount', e.target.value)}
              placeholder="Enter amount"
              min={0}
              max={outstandingAmount}
              step="0.01"
              required
            />
            {formData.amount && parseFloat(formData.amount) > outstandingAmount && (
              <p className="text-xs text-amber-600">
                Amount exceeds outstanding balance. Overpayment will be recorded.
              </p>
            )}
          </div>

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

          {formData.amount && parseFloat(formData.amount) > outstandingAmount && (
            <div className="space-y-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-100 rounded">
                  <DollarSign className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="font-medium text-amber-900">Overpayment Detected</p>
                  <p className="text-xs text-amber-700">
                    Excess: {formatCurrency(parseFloat(formData.amount) - outstandingAmount)}
                  </p>
                </div>
              </div>
              
              <Label className="text-sm font-medium text-amber-900">How should we handle the overpayment?</Label>
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
                    <p className="text-xs text-slate-600">Apply excess to reduce future principal, lowering total interest paid</p>
                  </Label>
                </div>
                
                <div className="flex items-start space-x-2 p-3 bg-white rounded-lg border border-amber-200 cursor-pointer hover:bg-amber-50">
                  <RadioGroupItem value="credit" id="credit" className="mt-1" />
                  <Label htmlFor="credit" className="cursor-pointer flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet className="w-4 h-4 text-blue-600" />
                      <span className="font-medium text-slate-900">Keep as Credit</span>
                    </div>
                    <p className="text-xs text-slate-600">Store as credit to offset future payments automatically</p>
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
              disabled={isLoading || !formData.amount}
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