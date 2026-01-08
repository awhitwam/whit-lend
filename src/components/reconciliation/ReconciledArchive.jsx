/**
 * ReconciledArchive - Display reconciled entries with undo capability
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { format, parseISO, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  CheckCircle2,
  Search,
  Undo2,
  Calendar,
  Filter,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

export default function ReconciledArchive({
  entries,
  reconciliationEntries,
  onUnreconcile,
  isProcessing
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Get reconciliation info for each entry
  const entriesWithInfo = useMemo(() => {
    return entries.map(entry => {
      const recEntries = reconciliationEntries.filter(r => r.bank_statement_id === entry.id);
      const types = [...new Set(recEntries.map(r => r.reconciliation_type))];
      const wasCreated = recEntries.some(r => r.was_created);
      return {
        ...entry,
        reconciliationEntries: recEntries,
        types,
        wasCreated
      };
    });
  }, [entries, reconciliationEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    let filtered = [...entriesWithInfo];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(e =>
        e.description?.toLowerCase().includes(term) ||
        e.external_reference?.toLowerCase().includes(term)
      );
    }

    // Date filter
    const now = new Date();
    if (dateFilter === '7days') {
      const start = subDays(now, 7);
      filtered = filtered.filter(e => new Date(e.reconciled_at) >= start);
    } else if (dateFilter === '30days') {
      const start = subDays(now, 30);
      filtered = filtered.filter(e => new Date(e.reconciled_at) >= start);
    } else if (dateFilter === 'thisMonth') {
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      filtered = filtered.filter(e => {
        const d = new Date(e.reconciled_at);
        return d >= start && d <= end;
      });
    }

    // Type filter
    if (typeFilter !== 'all') {
      if (typeFilter === 'credits') {
        filtered = filtered.filter(e => e.amount > 0);
      } else if (typeFilter === 'debits') {
        filtered = filtered.filter(e => e.amount < 0);
      }
    }

    // Sort by reconciled date (most recent first)
    filtered.sort((a, b) => new Date(b.reconciled_at) - new Date(a.reconciled_at));

    return filtered;
  }, [entriesWithInfo, searchTerm, dateFilter, typeFilter]);

  // Calculate totals
  const totals = useMemo(() => {
    const credits = filteredEntries.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
    const debits = filteredEntries.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
    return { credits, debits, count: filteredEntries.length };
  }, [filteredEntries]);

  const getTypeLabel = (types) => {
    if (!types || types.length === 0) return 'Unknown';
    const labels = {
      loan_repayment: 'Repayment',
      loan_disbursement: 'Disbursement',
      investor_credit: 'Investor Credit',
      investor_withdrawal: 'Withdrawal',
      interest_withdrawal: 'Interest',
      expense: 'Expense',
      offset: 'Offset',
      other_income: 'Other Income'
    };
    return types.map(t => labels[t] || t).join(', ');
  };

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-500">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p>No reconciled entries yet</p>
          <p className="text-sm">Reconciled bank entries will appear here</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              Reconciled Archive
            </CardTitle>
            <CardDescription>
              {entries.length} reconciled entries
            </CardDescription>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <ArrowUpRight className="w-3 h-3 mr-1" />
              {formatCurrency(totals.credits)}
            </Badge>
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              <ArrowDownRight className="w-3 h-3 mr-1" />
              {formatCurrency(totals.debits)}
            </Badge>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 pt-3 border-t mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search description or reference..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>

          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <Calendar className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
              <SelectItem value="thisMonth">This Month</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="credits">Credits</SelectItem>
              <SelectItem value="debits">Debits</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <ScrollArea className="h-[450px] pr-4">
          <div className="space-y-2">
            {filteredEntries.map(entry => (
              <div
                key={entry.id}
                className="p-3 border rounded-lg bg-slate-50/50 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Amount and date */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-mono font-bold ${
                        entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {entry.amount > 0 ? '+' : ''}{formatCurrency(entry.amount)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {entry.statement_date
                          ? format(parseISO(entry.statement_date), 'dd MMM yyyy')
                          : '-'}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-slate-700 truncate mb-1">
                      {entry.description || '-'}
                    </p>

                    {/* Reconciliation info */}
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
                        {getTypeLabel(entry.types)}
                      </Badge>
                      {entry.wasCreated && (
                        <Badge variant="outline" className="text-[10px]">
                          Created
                        </Badge>
                      )}
                      <span className="text-slate-400">
                        Reconciled {entry.reconciled_at
                          ? format(parseISO(entry.reconciled_at), 'dd MMM yyyy HH:mm')
                          : '-'}
                      </span>
                    </div>
                  </div>

                  {/* Undo button */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 text-slate-500 hover:text-red-600"
                    onClick={() => onUnreconcile?.(entry.id)}
                    disabled={isProcessing}
                  >
                    <Undo2 className="w-3 h-3 mr-1" />
                    Undo
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
