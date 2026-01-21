/**
 * ManualMatchDialog - Manual matching with multi-select support
 *
 * Supports:
 * - Many bank entries → one transaction (many-to-one)
 * - One bank entry → many transactions (one-to-many)
 * - One bank entry → one expense (one-to-one)
 */

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Check,
  Search,
  AlertCircle,
  ArrowRight,
  FileText,
  Building2,
  Receipt
} from 'lucide-react';

export default function ManualMatchDialog({
  open,
  onClose,
  selectedBankEntries,
  loanTransactions,
  investorTransactions,
  expenses,
  loans,
  borrowers,
  investors,
  onMatch,
  isProcessing
}) {
  const [activeTab, setActiveTab] = useState('loans');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTargets, setSelectedTargets] = useState(new Set());

  // Calculate bank total - NET for mixed directions, ABS for same direction
  const { bankTotal, isNetMatch, totalCredits, totalDebits } = useMemo(() => {
    const credits = selectedBankEntries.filter(e => e.amount > 0);
    const debits = selectedBankEntries.filter(e => e.amount < 0);

    const creditsSum = credits.reduce((sum, e) => sum + e.amount, 0);
    const debitsSum = debits.reduce((sum, e) => sum + Math.abs(e.amount), 0);

    // Net match if we have both credits and debits
    const isMixed = credits.length > 0 && debits.length > 0;

    if (isMixed) {
      // Net = credits - debits
      return {
        bankTotal: creditsSum - debitsSum,
        isNetMatch: true,
        totalCredits: creditsSum,
        totalDebits: debitsSum
      };
    }

    // Same direction: use absolute sum
    return {
      bankTotal: selectedBankEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0),
      isNetMatch: false,
      totalCredits: creditsSum,
      totalDebits: debitsSum
    };
  }, [selectedBankEntries]);

  // Check if all bank entries are same direction (for non-net matches)
  const isCredits = !isNetMatch && selectedBankEntries.every(e => e.amount > 0);
  const isDebits = !isNetMatch && selectedBankEntries.every(e => e.amount < 0);
  const isManyBankEntries = selectedBankEntries.length > 1;

  // Get borrower name
  const getBorrowerName = (borrowerId) => {
    const borrower = borrowers.find(b => b.id === borrowerId);
    return borrower?.business_name || borrower?.name || 'Unknown';
  };

  // Filter loan transactions
  const filteredLoanTxs = useMemo(() => {
    let txs = loanTransactions.filter(tx => {
      if (tx.is_deleted) return false;

      if (isNetMatch) {
        // Net positive = repayment, net negative = disbursement
        if (bankTotal > 0 && tx.type !== 'Repayment') return false;
        if (bankTotal < 0 && tx.type !== 'Disbursement') return false;
      } else {
        // Credits match to repayments, debits to disbursements
        if (isCredits && tx.type !== 'Repayment') return false;
        if (isDebits && tx.type !== 'Disbursement') return false;
      }
      return true;
    });

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      txs = txs.filter(tx => {
        const loan = loans.find(l => l.id === tx.loan_id);
        return loan?.loan_number?.toLowerCase().includes(term) ||
               loan?.borrower_name?.toLowerCase().includes(term) ||
               getBorrowerName(loan?.borrower_id)?.toLowerCase().includes(term);
      });
    }

    return txs.slice(0, 50); // Limit for performance
  }, [loanTransactions, loans, borrowers, searchTerm, isCredits, isDebits, isNetMatch, bankTotal]);

  // Filter investor transactions
  const filteredInvestorTxs = useMemo(() => {
    let txs = investorTransactions.filter(tx => {
      if (isNetMatch) {
        // Net positive = capital_in, net negative = capital_out
        if (bankTotal > 0 && tx.type !== 'capital_in') return false;
        if (bankTotal < 0 && tx.type !== 'capital_out') return false;
      } else {
        // Credits match to capital_in, debits to capital_out
        if (isCredits && tx.type !== 'capital_in') return false;
        if (isDebits && tx.type !== 'capital_out') return false;
      }
      return true;
    });

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      txs = txs.filter(tx => {
        const investor = investors.find(i => i.id === tx.investor_id);
        return investor?.name?.toLowerCase().includes(term) ||
               investor?.business_name?.toLowerCase().includes(term);
      });
    }

    return txs.slice(0, 50);
  }, [investorTransactions, investors, searchTerm, isCredits, isDebits, isNetMatch, bankTotal]);

  // Filter expenses (only for debits)
  const filteredExpenses = useMemo(() => {
    if (!isDebits) return [];

    let exps = [...expenses];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      exps = exps.filter(e =>
        e.description?.toLowerCase().includes(term) ||
        e.type_name?.toLowerCase().includes(term)
      );
    }

    return exps.slice(0, 50);
  }, [expenses, searchTerm, isDebits]);

  // Calculate selected total
  const selectedTotal = useMemo(() => {
    let total = 0;
    selectedTargets.forEach(id => {
      if (activeTab === 'loans') {
        const tx = loanTransactions.find(t => t.id === id);
        total += Math.abs(tx?.amount || 0);
      } else if (activeTab === 'investors') {
        const tx = investorTransactions.find(t => t.id === id);
        total += Math.abs(tx?.amount || 0);
      } else if (activeTab === 'expenses') {
        const exp = expenses.find(e => e.id === id);
        total += Math.abs(exp?.amount || 0);
      }
    });
    return total;
  }, [selectedTargets, activeTab, loanTransactions, investorTransactions, expenses]);

  // Check if amounts balance (use absolute bankTotal for comparison)
  const absBankTotal = Math.abs(bankTotal);
  const difference = Math.abs(absBankTotal - selectedTotal);
  const isBalanced = difference < 0.01;

  // Toggle target selection
  const toggleTarget = (id) => {
    setSelectedTargets(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // For expenses, only allow single selection
        if (activeTab === 'expenses') {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  };

  // Clear selection when tab changes
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSelectedTargets(new Set());
    setSearchTerm('');
  };

  // Determine match type and relationship
  const getMatchInfo = () => {
    let matchType;
    if (activeTab === 'loans') {
      // For net matches, use the sign of bankTotal; for same-direction, use isCredits
      const isPositive = isNetMatch ? bankTotal > 0 : isCredits;
      matchType = isPositive ? 'loan_repayment' : 'loan_disbursement';
    } else if (activeTab === 'investors') {
      const isPositive = isNetMatch ? bankTotal > 0 : isCredits;
      matchType = isPositive ? 'investor_credit' : 'investor_withdrawal';
    } else {
      matchType = 'expense';
    }

    let relationshipType;
    if (isNetMatch) {
      relationshipType = 'net-receipt';
    } else if (isManyBankEntries && selectedTargets.size === 1) {
      relationshipType = 'many-to-one';
    } else if (!isManyBankEntries && selectedTargets.size > 1) {
      relationshipType = 'one-to-many';
    } else {
      relationshipType = 'one-to-one';
    }

    return { matchType, relationshipType };
  };

  // Handle match
  const handleMatch = async () => {
    if (selectedTargets.size === 0 || !isBalanced) return;

    const { matchType, relationshipType } = getMatchInfo();

    // Get target transactions
    let targets;
    if (activeTab === 'loans') {
      targets = loanTransactions.filter(t => selectedTargets.has(t.id));
    } else if (activeTab === 'investors') {
      targets = investorTransactions.filter(t => selectedTargets.has(t.id));
    } else {
      targets = expenses.filter(e => selectedTargets.has(e.id));
    }

    await onMatch(targets, matchType, relationshipType);
    onClose();
  };

  if (!selectedBankEntries.length) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manual Match</DialogTitle>
          <DialogDescription>
            Match {selectedBankEntries.length} bank {selectedBankEntries.length === 1 ? 'entry' : 'entries'} to transactions
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selected Bank Entries Summary */}
          <div className="p-3 border rounded-lg bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Selected Bank Entries</span>
              <Badge>{selectedBankEntries.length} entries</Badge>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {selectedBankEntries.map(entry => (
                <div key={entry.id} className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1 text-slate-600">{entry.description}</span>
                  <span className={entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}>
                    {formatCurrency(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
            {isNetMatch ? (
              <div className="mt-2 pt-2 border-t space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-600">Credits:</span>
                  <span className="text-emerald-600 font-mono">+{formatCurrency(totalCredits)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-red-600">Refunds/Debits:</span>
                  <span className="text-red-600 font-mono">-{formatCurrency(totalDebits)}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t">
                  <span className="text-sm font-bold">Net Amount</span>
                  <span className={`font-mono font-bold ${bankTotal > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(bankTotal)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-2 pt-2 border-t flex items-center justify-between">
                <span className="text-sm font-medium">Total</span>
                <span className={`font-mono font-bold ${isCredits ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(bankTotal)}
                </span>
              </div>
            )}
          </div>

          <ArrowRight className="w-6 h-6 mx-auto text-slate-400" />

          {/* Target Selection Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="loans" className="text-xs">
                <FileText className="w-3 h-3 mr-1" />
                Loans
              </TabsTrigger>
              <TabsTrigger value="investors" className="text-xs">
                <Building2 className="w-3 h-3 mr-1" />
                Investors
              </TabsTrigger>
              {isDebits && (
                <TabsTrigger value="expenses" className="text-xs">
                  <Receipt className="w-3 h-3 mr-1" />
                  Expenses
                </TabsTrigger>
              )}
            </TabsList>

            {/* Search */}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Loan Transactions */}
            <TabsContent value="loans" className="mt-3">
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredLoanTxs.map(tx => {
                    const loan = loans.find(l => l.id === tx.loan_id);
                    const isSelected = selectedTargets.has(tx.id);
                    return (
                      <div
                        key={tx.id}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-100 border-blue-300 border' : 'hover:bg-slate-100'
                        }`}
                        onClick={() => toggleTarget(tx.id)}
                      >
                        <Checkbox checked={isSelected} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{loan?.loan_number}</span>
                            <span className="text-sm">{formatCurrency(tx.amount)}</span>
                          </div>
                          <p className="text-xs text-slate-500 truncate">
                            {loan?.borrower_name || getBorrowerName(loan?.borrower_id)} •{' '}
                            {tx.date ? format(parseISO(tx.date), 'dd MMM') : '-'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {filteredLoanTxs.length === 0 && (
                    <p className="text-center text-slate-500 py-4">No matching transactions</p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Investor Transactions */}
            <TabsContent value="investors" className="mt-3">
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredInvestorTxs.map(tx => {
                    const investor = investors.find(i => i.id === tx.investor_id);
                    const isSelected = selectedTargets.has(tx.id);
                    return (
                      <div
                        key={tx.id}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-100 border-blue-300 border' : 'hover:bg-slate-100'
                        }`}
                        onClick={() => toggleTarget(tx.id)}
                      >
                        <Checkbox checked={isSelected} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">
                              {investor?.business_name || investor?.name}
                            </span>
                            <span className="text-sm">{formatCurrency(tx.amount)}</span>
                          </div>
                          <p className="text-xs text-slate-500">
                            {tx.type === 'capital_in' ? 'Capital In' : 'Capital Out'} •{' '}
                            {tx.date ? format(parseISO(tx.date), 'dd MMM') : '-'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {filteredInvestorTxs.length === 0 && (
                    <p className="text-center text-slate-500 py-4">No matching transactions</p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Expenses */}
            <TabsContent value="expenses" className="mt-3">
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredExpenses.map(exp => {
                    const isSelected = selectedTargets.has(exp.id);
                    return (
                      <div
                        key={exp.id}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-100 border-blue-300 border' : 'hover:bg-slate-100'
                        }`}
                        onClick={() => toggleTarget(exp.id)}
                      >
                        <Checkbox checked={isSelected} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{exp.type_name || 'Expense'}</span>
                            <span className="text-sm">{formatCurrency(exp.amount)}</span>
                          </div>
                          <p className="text-xs text-slate-500 truncate">
                            {exp.description} •{' '}
                            {exp.date ? format(parseISO(exp.date), 'dd MMM') : '-'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {filteredExpenses.length === 0 && (
                    <p className="text-center text-slate-500 py-4">No matching expenses</p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {/* Match Summary */}
          <div className="p-3 border rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">{isNetMatch ? 'Net Amount' : 'Bank Total'}</p>
                <p className="font-mono font-bold">{formatCurrency(absBankTotal)}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-slate-500">Selected</p>
                <p className="font-mono font-bold">{formatCurrency(selectedTotal)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">Difference</p>
                <p className={`font-mono font-bold ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(difference)}
                </p>
              </div>
            </div>
          </div>

          {/* Balance warning */}
          {selectedTargets.size > 0 && !isBalanced && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                Amounts don't balance. Select transactions totaling {formatCurrency(absBankTotal)}.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            onClick={handleMatch}
            disabled={selectedTargets.size === 0 || !isBalanced || isProcessing}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Check className="w-4 h-4 mr-2" />
            {isProcessing ? 'Matching...' : `Match (${selectedTargets.size} selected)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
