import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from 'lucide-react';

export default function InvestorProductForm({ product, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    name: '',
    interest_calculation_type: 'automatic',
    interest_rate_per_annum: 0,
    interest_posting_frequency: 'monthly',
    interest_posting_day: 1,
    min_balance_for_interest: 0,
    min_balance_for_withdrawals: 0,
    status: 'Active',
    description: ''
  });

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name || '',
        interest_calculation_type: product.interest_calculation_type || 'automatic',
        interest_rate_per_annum: product.interest_rate_per_annum || 0,
        interest_posting_frequency: product.interest_posting_frequency || 'monthly',
        interest_posting_day: product.interest_posting_day || 1,
        min_balance_for_interest: product.min_balance_for_interest || 0,
        min_balance_for_withdrawals: product.min_balance_for_withdrawals || 0,
        status: product.status || 'Active',
        description: product.description || ''
      });
    }
  }, [product]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      interest_rate_per_annum: parseFloat(formData.interest_rate_per_annum) || 0,
      interest_posting_day: parseInt(formData.interest_posting_day) || 1,
      min_balance_for_interest: parseFloat(formData.min_balance_for_interest) || 0,
      min_balance_for_withdrawals: parseFloat(formData.min_balance_for_withdrawals) || 0
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name */}
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="name">Product Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Directors Loan Interest"
            required
          />
        </div>

        {/* Interest Calculation Type */}
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="interest_calculation_type">Interest Calculation Method</Label>
          <Select
            value={formData.interest_calculation_type}
            onValueChange={(value) => setFormData({ ...formData, interest_calculation_type: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="automatic">Automatic - Calculate from rate</SelectItem>
              <SelectItem value="manual">Manual - I'll enter interest amounts</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            {formData.interest_calculation_type === 'automatic'
              ? 'Interest will be calculated automatically based on the rate below'
              : 'You will manually add accrued interest transactions for each investor'}
          </p>
        </div>

        {formData.interest_calculation_type === 'automatic' && (
          <>
            {/* Interest Rate */}
            <div className="space-y-2">
              <Label htmlFor="interest_rate_per_annum">Interest Rate (% per annum)</Label>
              <Input
                id="interest_rate_per_annum"
                type="number"
                step="0.01"
                min="0"
                value={formData.interest_rate_per_annum}
                onChange={(e) => setFormData({ ...formData, interest_rate_per_annum: e.target.value })}
                placeholder="e.g., 10.00"
              />
              <p className="text-xs text-slate-500">Annual interest rate for this product type</p>
            </div>

            {/* Posting Day */}
            <div className="space-y-2">
              <Label htmlFor="interest_posting_day">Interest Posting Day</Label>
              <Select
                value={formData.interest_posting_day.toString()}
                onValueChange={(value) => setFormData({ ...formData, interest_posting_day: parseInt(value) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                    <SelectItem key={day} value={day.toString()}>
                      {day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`} of month
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">Day of month when accrued interest is posted</p>
            </div>

            {/* Posting Frequency */}
            <div className="space-y-2">
              <Label htmlFor="interest_posting_frequency">Interest Posting Frequency</Label>
              <Select
                value={formData.interest_posting_frequency}
                onValueChange={(value) => setFormData({ ...formData, interest_posting_frequency: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Minimum Balance for Interest */}
        <div className="space-y-2">
          <Label htmlFor="min_balance_for_interest">Min Balance for Interest</Label>
          <Input
            id="min_balance_for_interest"
            type="number"
            step="0.01"
            min="0"
            value={formData.min_balance_for_interest}
            onChange={(e) => setFormData({ ...formData, min_balance_for_interest: e.target.value })}
            placeholder="0.00"
          />
          <p className="text-xs text-slate-500">Minimum balance required to earn interest</p>
        </div>

        {/* Minimum Balance for Withdrawals */}
        <div className="space-y-2">
          <Label htmlFor="min_balance_for_withdrawals">Min Balance for Withdrawals</Label>
          <Input
            id="min_balance_for_withdrawals"
            type="number"
            step="0.01"
            min="0"
            value={formData.min_balance_for_withdrawals}
            onChange={(e) => setFormData({ ...formData, min_balance_for_withdrawals: e.target.value })}
            placeholder="0.00"
          />
          <p className="text-xs text-slate-500">Minimum balance that must remain after withdrawal</p>
        </div>

        {/* Status */}
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            value={formData.status}
            onValueChange={(value) => setFormData({ ...formData, status: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Description */}
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optional description of this investor product"
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading || !formData.name}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : product ? 'Update Product' : 'Create Product'}
        </Button>
      </div>
    </form>
  );
}
