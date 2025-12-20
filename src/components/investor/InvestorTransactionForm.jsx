import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function InvestorTransactionForm({ investor, monthlyInterestDue, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    type: 'capital_in',
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    reference: '',
    notes: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      amount: parseFloat(formData.amount)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="type">Transaction Type *</Label>
        <Select
          value={formData.type}
          onValueChange={(value) => {
            const newData = {...formData, type: value};
            if (value === 'interest_payment' && monthlyInterestDue && !formData.amount) {
              newData.amount = monthlyInterestDue.toString();
            }
            setFormData(newData);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="capital_in">Capital In</SelectItem>
            <SelectItem value="capital_out">Capital Out</SelectItem>
            <SelectItem value="interest_payment">Interest Payment</SelectItem>
          </SelectContent>
        </Select>
        {formData.type === 'interest_payment' && monthlyInterestDue > 0 && (
          <p className="text-xs text-amber-600">Monthly interest due: £{monthlyInterestDue.toFixed(2)}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="amount">Amount *</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData({...formData, amount: e.target.value})}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="date">Date *</Label>
        <Input
          id="date"
          type="date"
          value={formData.date}
          onChange={(e) => setFormData({...formData, date: e.target.value})}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reference">Reference</Label>
        <Input
          id="reference"
          value={formData.reference}
          onChange={(e) => setFormData({...formData, reference: e.target.value})}
          placeholder="e.g. Transaction reference"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({...formData, notes: e.target.value})}
          placeholder="Additional notes..."
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Add Transaction
        </Button>
      </div>
    </form>
  );
}