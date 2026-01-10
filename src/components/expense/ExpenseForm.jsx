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
    // Handle loan_id - convert empty string or 'none' to null for proper UUID handling
    const loanId = formData.loan_id && formData.loan_id !== '' && formData.loan_id !== 'none' ? formData.loan_id : null;
    const selectedLoan = loanId ? loans.find(l => l.id === loanId) : null;

    onSubmit({
      ...formData,
      loan_id: loanId,  // Use the properly converted value
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
        <Select value={formData.loan_id || 'none'} onValueChange={(value) => handleChange('loan_id', value === 'none' ? '' : value)}>
          <SelectTrigger>
            <SelectValue placeholder="No loan linked" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No loan linked</SelectItem>
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