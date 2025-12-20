import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from 'lucide-react';

export default function InvestorForm({ investor, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    name: investor?.name || '',
    email: investor?.email || '',
    phone: investor?.phone || '',
    interest_calculation_type: investor?.interest_calculation_type || 'annual_rate',
    annual_interest_rate: investor?.annual_interest_rate || '',
    manual_interest_amount: investor?.manual_interest_amount || '',
    status: investor?.status || 'Active'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { ...formData };
    
    if (data.interest_calculation_type === 'annual_rate') {
      data.annual_interest_rate = parseFloat(data.annual_interest_rate);
      delete data.manual_interest_amount;
    } else {
      data.manual_interest_amount = parseFloat(data.manual_interest_amount);
      delete data.annual_interest_rate;
    }
    
    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={formData.phone}
            onChange={(e) => setFormData({...formData, phone: e.target.value})}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="interest_calculation_type">Interest Calculation Type *</Label>
        <Select
          value={formData.interest_calculation_type}
          onValueChange={(value) => setFormData({...formData, interest_calculation_type: value})}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annual_rate">Annual Rate (% p.a.)</SelectItem>
            <SelectItem value="manual_amount">Fixed Monthly Amount</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.interest_calculation_type === 'annual_rate' ? (
        <div className="space-y-2">
          <Label htmlFor="annual_interest_rate">Annual Interest Rate (% p.a.) *</Label>
          <Input
            id="annual_interest_rate"
            type="number"
            step="0.01"
            value={formData.annual_interest_rate}
            onChange={(e) => setFormData({...formData, annual_interest_rate: e.target.value})}
            required
          />
          <p className="text-xs text-slate-500">Interest will be calculated and paid monthly</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="manual_interest_amount">Fixed Monthly Interest Amount *</Label>
          <Input
            id="manual_interest_amount"
            type="number"
            step="0.01"
            value={formData.manual_interest_amount}
            onChange={(e) => setFormData({...formData, manual_interest_amount: e.target.value})}
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <Select
          value={formData.status}
          onValueChange={(value) => setFormData({...formData, status: value})}
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

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {investor ? 'Update' : 'Create'} Investor
        </Button>
      </div>
    </form>
  );
}