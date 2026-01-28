/**
 * ReceiptHistory - Shows history of all filed receipts (repayment transactions)
 *
 * Features:
 * - Sortable columns (date, borrower, amount)
 * - Borrower filter
 * - Shows allocation breakdown (principal, interest, fees)
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  History,
  Loader2,
  Filter
} from 'lucide-react';

export default function ReceiptHistory() {
  // State for sorting and filtering
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [borrowerFilter, setBorrowerFilter] = useState('all');

  // Load repayment transactions
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ['transactions-repayments-history'],
    queryFn: () => api.entities.Transaction.filter({ type: 'Repayment' }, '-date')
  });

  // Load borrowers for filter and display
  const { data: borrowers = [], isLoading: borrowersLoading } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list()
  });

  // Load loans for loan number display
  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list()
  });

  // Create lookup maps
  const borrowerMap = useMemo(() => {
    const map = {};
    for (const b of borrowers) {
      map[b.id] = b;
    }
    return map;
  }, [borrowers]);

  const loanMap = useMemo(() => {
    const map = {};
    for (const l of loans) {
      map[l.id] = l;
    }
    return map;
  }, [loans]);

  // Get unique borrowers that have receipts (via tx.borrower_id or loan.borrower_id)
  const borrowersWithReceipts = useMemo(() => {
    const ids = new Set();
    for (const tx of transactions) {
      if (tx.borrower_id) {
        ids.add(tx.borrower_id);
      } else if (tx.loan_id) {
        const loan = loanMap[tx.loan_id];
        if (loan?.borrower_id) {
          ids.add(loan.borrower_id);
        }
      }
    }
    return borrowers.filter(b => ids.has(b.id));
  }, [transactions, borrowers, loanMap]);

  // Filter and sort transactions
  const filteredAndSorted = useMemo(() => {
    // Helper to get borrower_id for a transaction (defined inside memo to avoid stale closures)
    const getBorrowerId = (tx) => {
      if (tx.borrower_id) return tx.borrower_id;
      const loan = loanMap[tx.loan_id];
      return loan?.borrower_id || null;
    };

    let result = [...transactions];

    // Apply borrower filter
    if (borrowerFilter !== 'all') {
      result = result.filter(tx => getBorrowerId(tx) === borrowerFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'date':
          comparison = new Date(a.date || 0) - new Date(b.date || 0);
          break;
        case 'borrower':
          // Get borrower from tx.borrower_id or fall back to loan.borrower_id
          const loanA = loanMap[a.loan_id];
          const loanB = loanMap[b.loan_id];
          const borrowerObjA = borrowerMap[a.borrower_id] || (loanA && borrowerMap[loanA.borrower_id]);
          const borrowerObjB = borrowerMap[b.borrower_id] || (loanB && borrowerMap[loanB.borrower_id]);
          const borrowerA = borrowerObjA?.business || borrowerObjA?.full_name || '';
          const borrowerB = borrowerObjB?.business || borrowerObjB?.full_name || '';
          comparison = borrowerA.localeCompare(borrowerB);
          break;
        case 'amount':
          comparison = (parseFloat(a.amount) || 0) - (parseFloat(b.amount) || 0);
          break;
        default:
          comparison = 0;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [transactions, borrowerFilter, sortField, sortDirection, borrowerMap, loanMap]);

  // Handle sort click
  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle direction
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to desc for date/amount, asc for borrower
      setSortField(field);
      setSortDirection(field === 'borrower' ? 'asc' : 'desc');
    }
  };

  // Sort icon component
  const SortIcon = ({ field }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-4 h-4 ml-1 text-slate-400" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="w-4 h-4 ml-1 text-blue-600" />
      : <ArrowDown className="w-4 h-4 ml-1 text-blue-600" />;
  };

  // Calculate totals for filtered results
  const totals = useMemo(() => {
    return filteredAndSorted.reduce((acc, tx) => ({
      amount: acc.amount + (parseFloat(tx.amount) || 0),
      principal: acc.principal + (parseFloat(tx.principal_applied) || 0),
      interest: acc.interest + (parseFloat(tx.interest_applied) || 0),
      fees: acc.fees + (parseFloat(tx.fees_applied) || 0)
    }), { amount: 0, principal: 0, interest: 0, fees: 0 });
  }, [filteredAndSorted]);

  const isLoading = txLoading || borrowersLoading || loansLoading;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="w-5 h-5" />
            Receipt History
          </CardTitle>

          {/* Borrower Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <Select value={borrowerFilter} onValueChange={setBorrowerFilter}>
              <SelectTrigger className="w-[220px] h-8">
                <SelectValue placeholder="All Borrowers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Borrowers</SelectItem>
                {borrowersWithReceipts.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.business || b.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            <span className="ml-2 text-slate-500">Loading history...</span>
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            {borrowerFilter !== 'all'
              ? 'No receipts found for this borrower'
              : 'No receipts have been filed yet'}
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 -ml-2 font-medium hover:bg-slate-100"
                        onClick={() => handleSort('date')}
                      >
                        Date
                        <SortIcon field="date" />
                      </Button>
                    </TableHead>
                    <TableHead className="w-[240px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 -ml-2 font-medium hover:bg-slate-100"
                        onClick={() => handleSort('borrower')}
                      >
                        Borrower
                        <SortIcon field="borrower" />
                      </Button>
                    </TableHead>
                    <TableHead className="w-[80px]">Loan</TableHead>
                    <TableHead className="text-right w-[100px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 -mr-2 font-medium hover:bg-slate-100 ml-auto"
                        onClick={() => handleSort('amount')}
                      >
                        Amount
                        <SortIcon field="amount" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right w-[90px]">Principal</TableHead>
                    <TableHead className="text-right w-[90px]">Interest</TableHead>
                    <TableHead className="text-right w-[70px] pr-8">Fees</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSorted.map((tx) => {
                    const loan = loanMap[tx.loan_id];
                    // Get borrower from tx.borrower_id, or fall back to loan.borrower_id
                    const borrower = borrowerMap[tx.borrower_id] || (loan && borrowerMap[loan.borrower_id]);

                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="text-sm">
                          {tx.date ? format(parseISO(tx.date), 'dd MMM yyyy') : '-'}
                        </TableCell>
                        <TableCell className="text-sm truncate max-w-[240px]" title={borrower?.business || borrower?.full_name}>
                          {borrower?.business || borrower?.full_name || '-'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {loan?.loan_number || '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium text-emerald-600 w-[100px]">
                          {formatCurrency(tx.amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-600 w-[90px]">
                          {formatCurrency(tx.principal_applied || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-600 w-[90px]">
                          {formatCurrency(tx.interest_applied || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-600 w-[70px] pr-8">
                          {formatCurrency(tx.fees_applied || 0)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500 truncate" title={tx.reference}>
                          {tx.reference || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Totals row */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between text-sm">
              <span className="text-slate-500">
                {filteredAndSorted.length} receipt{filteredAndSorted.length !== 1 ? 's' : ''}
                {borrowerFilter !== 'all' && ' (filtered)'}
              </span>
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-slate-500">Total:</span>
                  <span className="ml-1 font-mono font-medium text-emerald-600">
                    {formatCurrency(totals.amount)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Principal:</span>
                  <span className="ml-1 font-mono text-slate-700">
                    {formatCurrency(totals.principal)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Interest:</span>
                  <span className="ml-1 font-mono text-slate-700">
                    {formatCurrency(totals.interest)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Fees:</span>
                  <span className="ml-1 font-mono text-slate-700">
                    {formatCurrency(totals.fees)}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
