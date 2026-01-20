import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Link2, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';

/**
 * Cell for date and amount entry
 * Supports manual entry or linking to a bank statement
 */
const DateAmountCell = forwardRef(function DateAmountCell({
  row,
  isFocused,
  isEditing: _isEditing,
  onUpdate,
  onOpenBankPicker,
  bankEntry
}, ref) {
  const dateRef = useRef(null);
  const amountRef = useRef(null);

  // Expose focus method
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (row.entryMode === 'manual') {
        dateRef.current?.focus();
      } else {
        amountRef.current?.focus();
      }
    }
  }));

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
      return format(date, 'dd/MM/yyyy');
    } catch {
      return dateStr;
    }
  };

  // Bank entry mode - show linked entry info
  if (row.entryMode === 'bank_entry') {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 px-1.5 py-1.5',
          isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
        )}
        tabIndex={0}
        ref={amountRef}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-sm">{formatDate(row.date)}</span>
            <span className="text-sm font-medium text-green-600">
              {formatCurrency(row.amount)}
            </span>
          </div>
          {bankEntry?.description && (
            <div className="text-xs text-slate-500 truncate mt-0.5">
              {bankEntry.description}
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onOpenBankPicker?.();
          }}
          title="Change bank entry"
        >
          <Link2 className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  // Manual entry mode
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-1 py-1',
        isFocused && 'ring-2 ring-blue-500 ring-inset rounded'
      )}
    >
      <Input
        ref={dateRef}
        type="date"
        value={row.date || ''}
        onChange={(e) => onUpdate({ date: e.target.value })}
        className="h-7 w-28 text-xs px-1.5"
        tabIndex={isFocused ? 0 : -1}
      />
      <Input
        ref={amountRef}
        type="number"
        value={row.amount || ''}
        onChange={(e) => onUpdate({ amount: parseFloat(e.target.value) || 0 })}
        placeholder="0.00"
        step="0.01"
        min="0"
        className="h-7 w-20 text-xs text-right px-1.5"
        tabIndex={isFocused ? 0 : -1}
      />
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onOpenBankPicker?.();
        }}
        title="Link to bank entry"
      >
        <Link2 className="w-4 h-4 text-slate-400" />
      </Button>
    </div>
  );
});

export default DateAmountCell;
