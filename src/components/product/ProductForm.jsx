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
    min_amount: product?.min_amount || '',
    max_amount: product?.max_amount || '',
    max_duration: product?.max_duration || '',
    interest_only_period: product?.interest_only_period || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      interest_rate: parseFloat(formData.interest_rate),
      min_amount: formData.min_amount ? parseFloat(formData.min_amount) : null,
      max_amount: formData.max_amount ? parseFloat(formData.max_amount) : null,
      max_duration: formData.max_duration ? parseInt(formData.max_duration) : null,
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <div className="space-y-2">
          <Label htmlFor="max_amount">Maximum Amount</Label>
          <Input
            id="max_amount"
            type="number"
            value={formData.max_amount}
            onChange={(e) => handleChange('max_amount', e.target.value)}
            placeholder="e.g. 1000000"
            min={0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_duration">Max Duration (periods)</Label>
          <Input
            id="max_duration"
            type="number"
            value={formData.max_duration}
            onChange={(e) => handleChange('max_duration', e.target.value)}
            placeholder="e.g. 24"
            min={1}
          />
        </div>
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