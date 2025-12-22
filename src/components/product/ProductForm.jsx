import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from 'lucide-react';

export default function ProductForm({ product, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    interest_rate: product?.interest_rate || '',
    interest_type: product?.interest_type || 'Reducing',
    period: product?.period || 'Monthly',
    interest_calculation_method: product?.interest_calculation_method || 'daily',
    interest_alignment: product?.interest_alignment || 'period_based',
    extend_for_full_period: product?.extend_for_full_period || false,
    interest_paid_in_advance: product?.interest_paid_in_advance || false,
    min_amount: product?.min_amount || '',
    interest_only_period: product?.interest_only_period || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      interest_rate: parseFloat(formData.interest_rate),
      min_amount: formData.min_amount ? parseFloat(formData.min_amount) : null,
      interest_only_period: formData.interest_only_period ? parseInt(formData.interest_only_period) : null
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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

      {formData.interest_type !== 'Rolled-Up' && formData.period === 'Monthly' && (
        <div className="space-y-2">
          <Label htmlFor="interest_alignment">Interest Payment Schedule</Label>
          <Select 
            value={formData.interest_alignment} 
            onValueChange={(value) => handleChange('interest_alignment', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select alignment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="period_based">Period-Based (from start date)</SelectItem>
              <SelectItem value="monthly_first">Align to 1st of Month</SelectItem>
            </SelectContent>
          </Select>
          {formData.interest_alignment === 'monthly_first' && (
            <p className="text-xs text-slate-500 mt-1">
              First payment: partial interest to month-end. Subsequent payments on 1st of each month.
            </p>
          )}
        </div>
      )}

      {formData.interest_type !== 'Rolled-Up' && (
        <div className="space-y-3">
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
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="interest_paid_in_advance"
              checked={formData.interest_paid_in_advance}
              onChange={(e) => handleChange('interest_paid_in_advance', e.target.checked)}
              className="rounded border-slate-300"
            />
            <Label htmlFor="interest_paid_in_advance" className="font-normal cursor-pointer">
              Interest paid in advance (interest due at START of each period)
            </Label>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="min_amount">Minimum Amount</Label>
        <Input
          id="min_amount"
          type="number"
          value={formData.min_amount}
          onChange={(e) => handleChange('min_amount', e.target.value)}
          placeholder="e.g. 1000"
          min={0}
        />
      </div>

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