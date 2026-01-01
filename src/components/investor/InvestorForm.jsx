import { useState, useEffect } from 'react';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
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
    account_number: investor?.account_number || '',
    investor_number: investor?.investor_number || '',
    business_name: investor?.business_name || '',
    first_name: investor?.first_name || '',
    last_name: investor?.last_name || '',
    investor_product_id: investor?.investor_product_id || '',
    interest_calculation_type: investor?.interest_calculation_type || 'annual_rate',
    annual_interest_rate: investor?.annual_interest_rate || '',
    manual_interest_amount: investor?.manual_interest_amount || '',
    status: investor?.status || 'Active'
  });

  // Fetch investor products
  const { data: products = [] } = useQuery({
    queryKey: ['investorProducts'],
    queryFn: () => api.entities.InvestorProduct.list()
  });

  // Auto-populate interest rate when product is selected
  useEffect(() => {
    if (formData.investor_product_id && !investor) {
      const selectedProduct = products.find(p => p.id === formData.investor_product_id);
      if (selectedProduct && selectedProduct.interest_rate_per_annum) {
        setFormData(prev => ({
          ...prev,
          annual_interest_rate: selectedProduct.interest_rate_per_annum.toString(),
          interest_calculation_type: 'annual_rate'
        }));
      }
    }
  }, [formData.investor_product_id, products, investor]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { ...formData };

    // Handle product ID
    if (!data.investor_product_id) {
      data.investor_product_id = null;
    }

    // Handle interest calculation
    if (data.interest_calculation_type === 'annual_rate') {
      data.annual_interest_rate = parseFloat(data.annual_interest_rate) || 0;
      delete data.manual_interest_amount;
    } else {
      data.manual_interest_amount = parseFloat(data.manual_interest_amount) || 0;
      delete data.annual_interest_rate;
    }

    // Clean up empty strings
    Object.keys(data).forEach(key => {
      if (data[key] === '') {
        data[key] = null;
      }
    });

    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Basic Info */}
      <div className="space-y-2">
        <Label htmlFor="name">Display Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          placeholder="e.g., John Smith - ABC Holdings Ltd"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="first_name">First Name</Label>
          <Input
            id="first_name"
            value={formData.first_name}
            onChange={(e) => setFormData({...formData, first_name: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last_name">Last Name</Label>
          <Input
            id="last_name"
            value={formData.last_name}
            onChange={(e) => setFormData({...formData, last_name: e.target.value})}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="business_name">Business Name</Label>
        <Input
          id="business_name"
          value={formData.business_name}
          onChange={(e) => setFormData({...formData, business_name: e.target.value})}
          placeholder="e.g., ABC Holdings Ltd"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="account_number">Account Number</Label>
          <Input
            id="account_number"
            value={formData.account_number}
            onChange={(e) => setFormData({...formData, account_number: e.target.value})}
            placeholder="e.g., 1000001"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="investor_number">Investor #</Label>
          <Input
            id="investor_number"
            value={formData.investor_number}
            onChange={(e) => setFormData({...formData, investor_number: e.target.value})}
          />
        </div>
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

      {/* Product Selection */}
      <div className="space-y-2">
        <Label htmlFor="investor_product_id">Investor Product</Label>
        <Select
          value={formData.investor_product_id || 'none'}
          onValueChange={(value) => setFormData({...formData, investor_product_id: value === 'none' ? '' : value})}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a product..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No product</SelectItem>
            {products.filter(p => p.status === 'Active').map(product => (
              <SelectItem key={product.id} value={product.id}>
                {product.name} ({product.interest_rate_per_annum}% p.a.)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-slate-500">
          Selecting a product will auto-populate the interest rate
        </p>
      </div>

      {/* Interest Settings */}
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
            min="0"
            value={formData.annual_interest_rate}
            onChange={(e) => setFormData({...formData, annual_interest_rate: e.target.value})}
            required
          />
          <p className="text-xs text-slate-500">Interest will be calculated daily and posted monthly</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="manual_interest_amount">Fixed Monthly Interest Amount *</Label>
          <Input
            id="manual_interest_amount"
            type="number"
            step="0.01"
            min="0"
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
