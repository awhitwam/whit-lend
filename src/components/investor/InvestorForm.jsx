import { useState } from 'react';
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

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { ...formData };

    // Handle product ID
    if (!data.investor_product_id) {
      data.investor_product_id = null;
    }

    // If product selected, get rate from product and set calculation type
    if (data.investor_product_id) {
      const selectedProduct = products.find(p => p.id === data.investor_product_id);
      if (selectedProduct) {
        data.interest_calculation_type = 'annual_rate';
        data.annual_interest_rate = selectedProduct.interest_rate_per_annum || 0;
      }
      delete data.manual_interest_amount;
    } else {
      // Handle manual interest calculation
      if (data.interest_calculation_type === 'annual_rate') {
        data.annual_interest_rate = parseFloat(data.annual_interest_rate) || 0;
        delete data.manual_interest_amount;
      } else {
        // Manual mode - no automatic interest
        data.annual_interest_rate = 0;
        data.manual_interest_amount = 0;
      }
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
        <Label htmlFor="investor_product_id">Investor Product *</Label>
        <Select
          value={formData.investor_product_id || 'none'}
          onValueChange={(value) => {
            const productId = value === 'none' ? '' : value;
            const selectedProduct = products.find(p => p.id === productId);
            setFormData({
              ...formData,
              investor_product_id: productId,
              // When product selected, use its rate; when no product, keep manual settings
              interest_calculation_type: productId ? 'annual_rate' : formData.interest_calculation_type,
              annual_interest_rate: selectedProduct ? selectedProduct.interest_rate_per_annum?.toString() || '' : formData.annual_interest_rate
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a product..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No product (manual interest)</SelectItem>
            {products.filter(p => p.status === 'Active').map(product => (
              <SelectItem key={product.id} value={product.id}>
                {product.name} ({product.interest_rate_per_annum}% p.a.)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Show product details as read-only when product selected */}
      {formData.investor_product_id && (() => {
        const selectedProduct = products.find(p => p.id === formData.investor_product_id);
        return selectedProduct ? (
          <div className="p-3 bg-slate-50 rounded-lg border">
            <p className="text-sm font-medium text-slate-700">{selectedProduct.name}</p>
            <p className="text-sm text-slate-500">{selectedProduct.interest_rate_per_annum}% p.a. - Interest calculated daily, posted monthly</p>
          </div>
        ) : null;
      })()}

      {/* Interest Settings - only show when no product selected */}
      {!formData.investor_product_id && (
        <>
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
                <SelectItem value="manual_amount">Manual (no automatic calculation)</SelectItem>
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
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-700">Interest entries will be added manually. No automatic calculation.</p>
            </div>
          )}
        </>
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
