import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Check, AlertTriangle } from 'lucide-react';

/**
 * Reusable split editor widget for dividing a payment amount
 * into multiple components (principal, interest, fees, etc.)
 */
export default function SplitInput({
  totalAmount,
  split,
  onChange,
  fields = ['principal', 'interest', 'fees'],
  labels = { principal: 'Principal', interest: 'Interest', fees: 'Fees' },
  disabled = false,
  showValidation = true,
  validation = {}
}) {
  // Calculate split total
  const splitTotal = fields.reduce((sum, field) => sum + (split[field] || 0), 0);
  const isBalanced = Math.abs(splitTotal - totalAmount) < 0.01;

  // Handle field change
  const handleChange = (field, value) => {
    const numValue = parseFloat(value) || 0;
    onChange({
      ...split,
      [field]: numValue
    });
  };

  // Auto-balance remaining to a specific field
  const autoBalance = (targetField) => {
    const otherFields = fields.filter(f => f !== targetField);
    const otherTotal = otherFields.reduce((sum, f) => sum + (split[f] || 0), 0);
    const remaining = totalAmount - otherTotal;

    onChange({
      ...split,
      [targetField]: Math.max(0, remaining)
    });
  };

  return (
    <div className="space-y-3">
      {/* Split Fields */}
      <div className={`grid grid-cols-${fields.length} gap-3`}>
        {fields.map(field => {
          const fieldValidation = validation[field];
          const hasError = fieldValidation?.error;
          const hasWarning = fieldValidation?.warning;

          return (
            <div key={field} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-slate-500">{labels[field] || field}</Label>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => autoBalance(field)}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Auto
                  </button>
                )}
              </div>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={split[field] || ''}
                onChange={(e) => handleChange(field, e.target.value)}
                disabled={disabled}
                className={`font-mono text-sm ${hasError ? 'border-red-300 focus:border-red-500' : hasWarning ? 'border-amber-300 focus:border-amber-500' : ''}`}
                placeholder="0.00"
              />
              {hasError && (
                <p className="text-xs text-red-600">{fieldValidation.error}</p>
              )}
              {hasWarning && !hasError && (
                <p className="text-xs text-amber-600">{fieldValidation.warning}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Total Row */}
      {showValidation && (
        <div className={`flex items-center justify-between p-2 rounded-lg ${isBalanced ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <span className="text-sm font-medium">Split Total:</span>
          <div className="flex items-center gap-2">
            <span className={`font-mono font-semibold ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(splitTotal)}
            </span>
            {isBalanced ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-500" />
            )}
          </div>
        </div>
      )}

      {!isBalanced && showValidation && (
        <p className="text-xs text-red-600">
          Split total must equal {formatCurrency(totalAmount)}
          {splitTotal > totalAmount
            ? ` (over by ${formatCurrency(splitTotal - totalAmount)})`
            : ` (under by ${formatCurrency(totalAmount - splitTotal)})`}
        </p>
      )}
    </div>
  );
}
