import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Info } from 'lucide-react';

// Helper to derive interest timing from the two underlying fields
const getInterestTiming = (data) => {
  if (data.interest_paid_in_advance) {
    return data.interest_alignment === 'monthly_first' ? 'advance_monthly' : 'advance';
  }
  return 'arrears';
};

export default function ProductForm({ product, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    abbreviation: product?.abbreviation || '',
    product_type: product?.product_type || 'Standard',
    interest_rate: product?.interest_rate || '',
    interest_type: product?.interest_type || 'Reducing',
    period: product?.period || 'Monthly',
    interest_calculation_method: product?.interest_calculation_method || 'daily',
    interest_alignment: product?.interest_alignment || 'period_based',
    extend_for_full_period: product?.extend_for_full_period || false,
    interest_paid_in_advance: product?.interest_paid_in_advance || false,
    interest_only_period: product?.interest_only_period || ''
  });

  const isFixedCharge = formData.product_type === 'Fixed Charge';
  const isIrregularIncome = formData.product_type === 'Irregular Income';
  const isSpecialType = isFixedCharge || isIrregularIncome;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      interest_rate: formData.interest_rate ? parseFloat(formData.interest_rate) : 0,
      interest_only_period: formData.interest_only_period ? parseInt(formData.interest_only_period) : null
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Product Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="e.g. Personal Loan, Business Loan"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="abbreviation">Abbreviation</Label>
            <Input
              id="abbreviation"
              value={formData.abbreviation}
              onChange={(e) => handleChange('abbreviation', e.target.value.toUpperCase().slice(0, 10))}
              placeholder="e.g. BRG, DEV"
              maxLength={10}
              className="font-mono uppercase"
            />
            <p className="text-xs text-slate-500">Max 10 chars, shown on Loans page</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="product_type">Product Type *</Label>
          <Select
            value={formData.product_type}
            onValueChange={(value) => handleChange('product_type', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Standard">Standard Loan</SelectItem>
              <SelectItem value="Fixed Charge">Fixed Charge Facility</SelectItem>
              <SelectItem value="Irregular Income">Irregular Income</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isFixedCharge && (
        <Alert className="border-purple-200 bg-purple-50">
          <Info className="w-4 h-4 text-purple-600" />
          <AlertDescription className="text-purple-800">
            <strong>Fixed Charge Facility:</strong> A regular monthly fee the borrower pays for the benefit of having loans with you.
            Not a loan itself - set the monthly charge amount when creating the facility. Supports arrangement and exit fees.
          </AlertDescription>
        </Alert>
      )}

      {isIrregularIncome && (
        <Alert className="border-amber-200 bg-amber-50">
          <Info className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            <strong>Irregular Income:</strong> A loan with no fixed repayment schedule.
            Record income as and when the borrower makes payments. Interest is not calculated - just track principal advanced and repaid.
          </AlertDescription>
        </Alert>
      )}

      {!isSpecialType && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="interest_rate">Interest Rate (% per year) *</Label>
            <Input
              id="interest_rate"
              type="number"
              value={formData.interest_rate}
              onChange={(e) => handleChange('interest_rate', e.target.value)}
              placeholder="e.g. 24"
              step="0.01"
              min={0}
              max={100}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="interest_type">Interest Type *</Label>
            <Select
              value={formData.interest_type}
              onValueChange={(value) => handleChange('interest_type', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Flat">Flat Rate</SelectItem>
                <SelectItem value="Reducing">Reducing Balance</SelectItem>
                <SelectItem value="Interest-Only">Interest-Only</SelectItem>
                <SelectItem value="Rolled-Up">Rolled-Up / Capitalized</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {!isSpecialType && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="period">Repayment Period *</Label>
              <Select
                value={formData.period}
                onValueChange={(value) => handleChange('period', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Monthly">Monthly</SelectItem>
                  <SelectItem value="Weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="interest_calculation_method">Interest Calculation Method *</Label>
              <Select
                value={formData.interest_calculation_method}
                onValueChange={(value) => handleChange('interest_calculation_method', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily (variable payments)</SelectItem>
                  <SelectItem value="monthly">Monthly (fixed 365/12)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {formData.interest_calculation_method === 'daily'
                  ? 'Interest calculated daily - payments vary by days in month (28-31 days)'
                  : 'Fixed monthly interest based on 365÷12 days. First payment still calculated daily.'}
              </p>
            </div>
          </div>

          {/* Interest Timing - Simplified dropdown (Monthly only, non-Rolled-Up) */}
          {formData.interest_type !== 'Rolled-Up' && formData.period === 'Monthly' && (
            <div className="space-y-2">
              <Label htmlFor="interest_timing">Interest Timing</Label>
              <Select
                value={getInterestTiming(formData)}
                onValueChange={(value) => {
                  const mapping = {
                    'advance': { interest_alignment: 'period_based', interest_paid_in_advance: true },
                    'advance_monthly': { interest_alignment: 'monthly_first', interest_paid_in_advance: true },
                    'arrears': { interest_alignment: 'period_based', interest_paid_in_advance: false }
                  };
                  setFormData(prev => ({ ...prev, ...mapping[value] }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select timing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="advance">Advance (interest due at start of period)</SelectItem>
                  <SelectItem value="advance_monthly">Advance, aligned to 1st of Month</SelectItem>
                  <SelectItem value="arrears">Arrears (interest due at end of period)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {formData.interest_paid_in_advance
                  ? formData.interest_alignment === 'monthly_first'
                    ? 'First payment on disbursement date, then 1st of each month'
                    : 'Interest payment due on disbursement date and each subsequent period'
                  : 'Interest payment due at the end of each period'}
              </p>
            </div>
          )}

          {formData.interest_type !== 'Rolled-Up' && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="extend_for_full_period"
                checked={formData.extend_for_full_period}
                onChange={(e) => handleChange('extend_for_full_period', e.target.checked)}
                className="rounded border-slate-300"
              />
              <Label htmlFor="extend_for_full_period" className="font-normal cursor-pointer">
                Extend loan to complete full final period (no partial final payment)
              </Label>
            </div>
          )}

          {formData.interest_type === 'Interest-Only' && (
            <div className="space-y-2">
              <Label htmlFor="interest_only_period">Interest-Only Period (periods)</Label>
              <Input
                id="interest_only_period"
                type="number"
                value={formData.interest_only_period}
                onChange={(e) => handleChange('interest_only_period', e.target.value)}
                placeholder="e.g. 12 (leave empty for entire term)"
                min={0}
              />
              <p className="text-xs text-slate-500">Leave empty if entire loan term is interest-only with balloon payment at the end.</p>
            </div>
          )}

          <div className="p-4 bg-blue-50 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">Interest Calculation Methods</h4>
            <div className="text-sm text-blue-800 space-y-2">
              <p><strong>Flat Rate:</strong> Interest calculated on the original principal throughout the loan term. Simple but results in higher effective interest.</p>
              <p><strong>Reducing Balance:</strong> Interest calculated on the remaining principal balance. Standard amortization method, more favorable for borrowers.</p>
              <p><strong>Interest-Only:</strong> Borrower pays only interest for a set period. Principal is either paid in later installments or as a balloon payment at the end. Best for businesses with irregular cash flow.</p>
              <p><strong>Rolled-Up / Capitalized:</strong> No monthly payments. Interest compounds and is added to the loan balance. Everything paid at the end. Common for bridging loans and property development.</p>
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {product ? 'Update Product' : 'Create Product'}
        </Button>
      </div>
    </form>
  );
}