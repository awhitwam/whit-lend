import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function ExpenseForm({ 
  expense, 
  expenseTypes = [], 
  loans = [],
  onSubmit, 
  onCancel, 
  isLoading 
}) {
  const [formData, setFormData] = useState({
    date: expense?.date || format(new Date(), 'yyyy-MM-dd'),
    type_id: expense?.type_id || '',
    amount: expense?.amount || '',
    description: expense?.description || '',
    loan_id: expense?.loan_id || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const selectedType = expenseTypes.find(t => t.id === formData.type_id);
    const selectedLoan = formData.loan_id ? loans.find(l => l.id === formData.loan_id) : null;
    
    onSubmit({
      ...formData,
      amount: parseFloat(formData.amount),
      type_name: selectedType?.name,
      borrower_name: selectedLoan?.borrower_name || null
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="date">Date *</Label>
        <Input
          id="date"
          type="date"
          value={formData.date}
          onChange={(e) => handleChange('date', e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="type_id">Expense Type *</Label>
        <Select value={formData.type_id} onValueChange={(value) => handleChange('type_id', value)} required>
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {expenseTypes.map(type => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="amount">Amount *</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => handleChange('amount', e.target.value)}
          placeholder="0.00"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="loan_id">Link to Loan (Optional)</Label>
        <Select value={formData.loan_id} onValueChange={(value) => handleChange('loan_id', value)}>
          <SelectTrigger>
            <SelectValue placeholder="No loan linked" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>No loan linked</SelectItem>
            {loans.filter(l => !l.is_deleted).map(loan => (
              <SelectItem key={loan.id} value={loan.id}>
                {loan.borrower_name} - {loan.product_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="Additional details..."
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {expense ? 'Update' : 'Create'} Expense
        </Button>
      </div>
    </form>
  );
}