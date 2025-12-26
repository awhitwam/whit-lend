import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle } from 'lucide-react';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';

export default function EditLoanModal({ 
  isOpen, 
  onClose, 
  loan, 
  onSubmit, 
  isLoading 
}) {
  const [formData, setFormData] = useState({
    product_id: loan?.product_id || '',
    principal_amount: loan?.principal_amount || '',
    arrangement_fee: loan?.arrangement_fee || '',
    exit_fee: loan?.exit_fee || '',
    interest_rate: loan?.interest_rate || '',
    interest_type: loan?.interest_type || '',
    period: loan?.period || '',
    interest_only_period: loan?.interest_only_period || 0,
    duration: loan?.duration || '',
    start_date: loan?.start_date || ''
  });

  const { data: products = [] } = useQuery({
    queryKey: ['loan-products'],
    queryFn: () => api.entities.LoanProduct.list()
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const selectedProduct = products.find(p => p.id === formData.product_id);
    onSubmit({
      product_id: formData.product_id,
      product_name: selectedProduct?.name || loan.product_name,
      principal_amount: parseFloat(formData.principal_amount),
      arrangement_fee: parseFloat(formData.arrangement_fee) || 0,
      exit_fee: parseFloat(formData.exit_fee) || 0,
      interest_rate: parseFloat(formData.interest_rate),
      interest_type: formData.interest_type,
      period: formData.period,
      interest_only_period: parseInt(formData.interest_only_period) || 0,
      duration: parseInt(formData.duration),
      start_date: formData.start_date,
      net_disbursed: parseFloat(formData.principal_amount) - (parseFloat(formData.arrangement_fee) || 0)
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Loan</DialogTitle>
        </DialogHeader>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">Warning</p>
            <p>Editing this loan will recalculate the repayment schedule. Existing payments will be reapplied to the new schedule.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product">Loan Product *</Label>
            <Select 
              value={formData.product_id} 
              onValueChange={(value) => {
                const product = products.find(p => p.id === value);
                if (product) {
                  setFormData(prev => ({
                    ...prev,
                    product_id: value,
                    interest_rate: product.interest_rate,
                    interest_type: product.interest_type,
                    period: product.period,
                    interest_only_period: product.interest_only_period || 0
                  }));
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select loan product" />
              </SelectTrigger>
              <SelectContent>
                {products.map(product => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} - {product.interest_rate}% {product.interest_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="principal_amount">Principal Amount *</Label>
              <Input
                id="principal_amount"
                type="number"
                value={formData.principal_amount}
                onChange={(e) => handleChange('principal_amount', e.target.value)}
                step="0.01"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="interest_rate">Interest Rate (%) *</Label>
              <Input
                id="interest_rate"
                type="number"
                value={formData.interest_rate}
                onChange={(e) => handleChange('interest_rate', e.target.value)}
                step="0.01"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="arrangement_fee">Arrangement Fee</Label>
              <Input
                id="arrangement_fee"
                type="number"
                value={formData.arrangement_fee}
                onChange={(e) => handleChange('arrangement_fee', e.target.value)}
                step="0.01"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exit_fee">Exit Fee</Label>
              <Input
                id="exit_fee"
                type="number"
                value={formData.exit_fee}
                onChange={(e) => handleChange('exit_fee', e.target.value)}
                step="0.01"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (periods) *</Label>
              <Input
                id="duration"
                type="number"
                value={formData.duration}
                onChange={(e) => handleChange('duration', e.target.value)}
                min="1"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date *</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update Loan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}