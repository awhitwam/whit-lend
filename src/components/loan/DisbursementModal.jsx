import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Banknote, Calendar, FileText, Percent, DollarSign } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';
import { format } from 'date-fns';

export default function DisbursementModal({
  isOpen,
  onClose,
  loan,
  onSubmit,
  isLoading
}) {
  const [formData, setFormData] = useState({
    gross_amount: '',
    deducted_fee: '',
    deducted_interest: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    notes: ''
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        gross_amount: '',
        deducted_fee: '',
        deducted_interest: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        notes: ''
      });
    }
  }, [isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();

    const grossAmount = parseFloat(formData.gross_amount) || 0;
    const deductedFee = parseFloat(formData.deducted_fee) || 0;
    const deductedInterest = parseFloat(formData.deducted_interest) || 0;
    const netAmount = grossAmount - deductedFee - deductedInterest;

    onSubmit({
      loan_id: loan.id,
      borrower_id: loan.borrower_id,
      date: formData.date,
      type: 'Disbursement',
      gross_amount: grossAmount,
      deducted_fee: deductedFee,
      deducted_interest: deductedInterest,
      amount: netAmount,
      principal_applied: grossAmount,
      interest_applied: 0,
      fees_applied: deductedFee,
      notes: formData.notes || 'Additional drawdown'
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Calculate net amount
  const grossAmount = parseFloat(formData.gross_amount) || 0;
  const deductedFee = parseFloat(formData.deducted_fee) || 0;
  const deductedInterest = parseFloat(formData.deducted_interest) || 0;
  const netAmount = grossAmount - deductedFee - deductedInterest;
  const hasDeductions = deductedFee > 0 || deductedInterest > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-blue-600" />
            Add Disbursement
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Gross Amount */}
          <div className="space-y-2">
            <Label htmlFor="gross_amount" className="flex items-center gap-2 text-sm font-medium">
              <DollarSign className="w-4 h-4" />
              Gross Amount *
            </Label>
            <Input
              id="gross_amount"
              type="number"
              value={formData.gross_amount}
              onChange={(e) => handleChange('gross_amount', e.target.value)}
              placeholder="0.00"
              min={0}
              step="0.01"
              required
              className="text-lg font-semibold"
            />
            <p className="text-xs text-slate-500">The full amount added to principal</p>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="date" className="flex items-center gap-2 text-sm font-medium">
              <Calendar className="w-4 h-4" />
              Disbursement Date *
            </Label>
            <Input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) => handleChange('date', e.target.value)}
              required
            />
          </div>

          {/* Deductions Section */}
          <Card className="border-slate-200 bg-slate-50/50">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium text-slate-700">Deductions (Optional)</p>

              <div className="space-y-2">
                <Label htmlFor="deducted_fee" className="text-sm flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-amber-600" />
                  Arrangement Fee
                </Label>
                <Input
                  id="deducted_fee"
                  type="number"
                  value={formData.deducted_fee}
                  onChange={(e) => handleChange('deducted_fee', e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step="0.01"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="deducted_interest" className="text-sm flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-blue-600" />
                  Advance Interest
                </Label>
                <Input
                  id="deducted_interest"
                  type="number"
                  value={formData.deducted_interest}
                  onChange={(e) => handleChange('deducted_interest', e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step="0.01"
                />
              </div>
            </CardContent>
          </Card>

          {/* Net Amount Summary */}
          {grossAmount > 0 && (
            <Card className={`${hasDeductions ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50'}`}>
              <CardContent className="p-3">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Gross Amount:</span>
                    <span className="font-medium">{formatCurrency(grossAmount)}</span>
                  </div>
                  {deductedFee > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Less Arrangement Fee:</span>
                      <span>-{formatCurrency(deductedFee)}</span>
                    </div>
                  )}
                  {deductedInterest > 0 && (
                    <div className="flex justify-between text-blue-700">
                      <span>Less Advance Interest:</span>
                      <span>-{formatCurrency(deductedInterest)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t font-medium">
                    <span className="text-slate-700">Net Cash Paid:</span>
                    <span className={netAmount < 0 ? 'text-red-600' : 'text-emerald-700'}>
                      {formatCurrency(netAmount)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="flex items-center gap-2 text-sm font-medium">
              <FileText className="w-4 h-4" />
              Notes
            </Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional drawdown notes..."
              rows={2}
              className="resize-none"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !formData.gross_amount || netAmount < 0}
              className="bg-blue-600 hover:bg-blue-700 min-w-[140px]"
            >
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Disbursement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
