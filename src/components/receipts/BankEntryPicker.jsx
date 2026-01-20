import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Calendar, ArrowDownRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';

/**
 * Modal dialog for selecting from unreconciled bank entries
 */
export default function BankEntryPicker({
  open,
  onOpenChange,
  onSelect,
  excludeIds = []
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  // Load unreconciled bank statements
  const { data: bankEntries = [], isLoading } = useQuery({
    queryKey: ['bank-statements-unreconciled'],
    queryFn: () => api.entities.BankStatement.filter({ is_reconciled: false }, '-statement_date'),
    enabled: open
  });

  // Filter to only credits (positive amounts) and apply search/exclusions
  const filteredEntries = useMemo(() => {
    return bankEntries
      .filter(entry => {
        // Only show credits (money coming in)
        if (parseFloat(entry.amount) <= 0) return false;
        // Exclude already-used entries
        if (excludeIds.includes(entry.id)) return false;
        // Apply search filter
        if (search) {
          const searchLower = search.toLowerCase();
          const desc = (entry.description || '').toLowerCase();
          const amount = entry.amount?.toString() || '';
          return desc.includes(searchLower) || amount.includes(search);
        }
        return true;
      });
  }, [bankEntries, excludeIds, search]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
      return format(date, 'dd MMM yyyy');
    } catch {
      return dateStr;
    }
  };

  const handleSelect = () => {
    if (selectedId) {
      const entry = bankEntries.find(e => e.id === selectedId);
      if (entry) {
        onSelect?.(entry);
        onOpenChange?.(false);
        setSelectedId(null);
        setSearch('');
      }
    }
  };

  const handleEntryClick = (entry) => {
    setSelectedId(entry.id);
  };

  const handleEntryDoubleClick = (entry) => {
    onSelect?.(entry);
    onOpenChange?.(false);
    setSelectedId(null);
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Bank Entry</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by description or amount..."
            className="pl-9"
          />
        </div>

        {/* Entries list */}
        <ScrollArea className="flex-1 min-h-0 border rounded-md">
          {isLoading ? (
            <div className="p-8 text-center text-slate-500">
              Loading bank entries...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              {search ? 'No matching entries found' : 'No unreconciled credit entries available'}
            </div>
          ) : (
            <div className="divide-y">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    'p-3 cursor-pointer transition-colors',
                    selectedId === entry.id
                      ? 'bg-blue-50 border-l-2 border-l-blue-500'
                      : 'hover:bg-slate-50'
                  )}
                  onClick={() => handleEntryClick(entry)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{formatDate(entry.statement_date)}</span>
                        {entry.bank_source && (
                          <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                            {entry.bank_source}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-medium truncate">
                        {entry.description || 'No description'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-green-600 font-semibold">
                      <ArrowDownRight className="w-4 h-4" />
                      {formatCurrency(entry.amount)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange?.(false);
              setSelectedId(null);
              setSearch('');
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={!selectedId}
          >
            Select Entry
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
