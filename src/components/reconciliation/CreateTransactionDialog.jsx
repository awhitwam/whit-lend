/**
 * CreateTransactionDialog - Create a new transaction and reconcile
 */

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, parseISO } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Check,
  FileText,
  Building2,
  Receipt,
  Calendar,
  Search
} from 'lucide-react';

export default function CreateTransactionDialog({
  open,
  onClose,
  entry,
  suggestion,
  loans,
  borrowers,
  investors,
  expenseTypes,
  onCreate,
  isProcessing
}) {
  const [transactionType, setTransactionType] = useState('');
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [selectedInvestor, setSelectedInvestor] = useState(null);
  const [selectedExpenseType, setSelectedExpenseType] = useState(null);
  const [expenseDescription, setExpenseDescription] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Split amounts for repayments/withdrawals
  const [splitAmounts, setSplitAmounts] = useState({
    principal: 0,
    interest: 0,
    fees: 0,
    capital: 0
  });

  const isCredit = entry?.amount > 0;
  const amount = Math.abs(entry?.amount || 0);

  // Reset state when dialog opens
  useEffect(() => {
    if (open && entry) {
      // Default type based on credit/debit
      if (isCredit) {
        setTransactionType('loan_repayment');
      } else {
        setTransactionType('expense');
      }

      // Initialize from suggestion if available
      if (suggestion) {
        setTransactionType(suggestion.type || '');
        if (suggestion.loan_id) {
          const loan = loans.find(l => l.id === suggestion.loan_id);
          setSelectedLoan(loan);
        }
        if (suggestion.investor_id) {
          const investor = investors.find(i => i.id === suggestion.investor_id);
          setSelectedInvestor(investor);
        }
        if (suggestion.expense_type_id) {
          const expType = expenseTypes.find(t => t.id === suggestion.expense_type_id);
          setSelectedExpenseType(expType);
        }

        // Apply default split from suggestion
        if (suggestion.defaultSplit) {
          setSplitAmounts({
            principal: (suggestion.defaultSplit.capital || 0) * amount,
            interest: (suggestion.defaultSplit.interest || 0) * amount,
            fees: (suggestion.defaultSplit.fees || 0) * amount,
            capital: (suggestion.defaultSplit.capital || 1) * amount
          });
        }
      }

      // Default split for repayments - all to principal
      if (!suggestion?.defaultSplit) {
        setSplitAmounts({
          principal: amount,
          interest: 0,
          fees: 0,
          capital: amount
        });
      }

      setExpenseDescription(entry.description || '');
      setSearchTerm('');
    }
  }, [open, entry, suggestion, loans, investors, expenseTypes, isCredit, amount]);

  // Get borrower name helper
  const getBorrowerName = (borrowerId) => {
    const borrower = borrowers.find(b => b.id === borrowerId);
    return borrower?.business_name || borrower?.name || 'Unknown';
  };

  // Filter loans by search
  const filteredLoans = useMemo(() => {
    if (!searchTerm) return loans.filter(l => l.status === 'Live' || l.status === 'Active');
    const term = searchTerm.toLowerCase();
    return loans.filter(l =>
      (l.status === 'Live' || l.status === 'Active') &&
      (l.loan_number?.toLowerCase().includes(term) ||
       l.borrower_name?.toLowerCase().includes(term) ||
       getBorrowerName(l.borrower_id)?.toLowerCase().includes(term))
    );
  }, [loans, borrowers, searchTerm]);

  // Filter investors by search
  const filteredInvestors = useMemo(() => {
    if (!searchTerm) return investors;
    const term = searchTerm.toLowerCase();
    return investors.filter(i =>
      i.name?.toLowerCase().includes(term) ||
      i.business_name?.toLowerCase().includes(term)
    );
  }, [investors, searchTerm]);

  // Validate form
  const isValid = useMemo(() => {
    if (!transactionType) return false;
    if (transactionType === 'loan_repayment' || transactionType === 'loan_disbursement') {
      return !!selectedLoan;
    }
    if (transactionType === 'investor_credit' || transactionType === 'investor_withdrawal') {
      return !!selectedInvestor;
    }
    if (transactionType === 'expense') {
      return true; // Expense type is optional
    }
    return false;
  }, [transactionType, selectedLoan, selectedInvestor]);

  // Handle create
  const handleCreate = async () => {
    if (!isValid || !entry) return;

    const split = transactionType === 'loan_repayment' ? {
      principal: splitAmounts.principal,
      interest: splitAmounts.interest,
      fees: splitAmounts.fees
    } : transactionType === 'investor_withdrawal' ? {
      capital: splitAmounts.capital,
      interest: splitAmounts.interest
    } : null;

    await onCreate(entry.id, {
      type: transactionType,
      loan: selectedLoan,
      investor: selectedInvestor,
      expenseType: selectedExpenseType,
      split,
      description: expenseDescription
    });

    onClose();
  };

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create Transaction</DialogTitle>
          <DialogDescription>
            Create a new transaction and reconcile with the bank entry
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bank Entry Summary */}
          <div className="p-3 border rounded-lg bg-slate-50">
            <div className="flex items-center justify-between">
              <span className={`font-mono text-lg font-bold ${
                isCredit ? 'text-emerald-600' : 'text-red-600'
              }`}>
                {isCredit ? '+' : ''}{formatCurrency(entry.amount)}
              </span>
              <div className="flex items-center gap-1 text-sm text-slate-600">
                <Calendar className="w-4 h-4" />
                {entry.statement_date
                  ? format(parseISO(entry.statement_date), 'dd MMM yyyy')
                  : '-'}
              </div>
            </div>
            <p className="text-sm text-slate-600 mt-1 truncate">{entry.description}</p>
          </div>

          {/* Transaction Type Selection */}
          <div>
            <Label>Transaction Type</Label>
            <Select value={transactionType} onValueChange={setTransactionType}>
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {isCredit ? (
                  <>
                    <SelectItem value="loan_repayment">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Loan Repayment
                      </div>
                    </SelectItem>
                    <SelectItem value="investor_credit">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        Investor Credit
                      </div>
                    </SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="loan_disbursement">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Loan Disbursement
                      </div>
                    </SelectItem>
                    <SelectItem value="investor_withdrawal">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        Investor Withdrawal
                      </div>
                    </SelectItem>
                    <SelectItem value="expense">
                      <div className="flex items-center gap-2">
                        <Receipt className="w-4 h-4" />
                        Expense
                      </div>
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Loan Selection */}
          {(transactionType === 'loan_repayment' || transactionType === 'loan_disbursement') && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search loans..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredLoans.map(loan => (
                    <div
                      key={loan.id}
                      className={`p-2 rounded cursor-pointer transition-colors ${
                        selectedLoan?.id === loan.id
                          ? 'bg-blue-100 border-blue-300 border'
                          : 'hover:bg-slate-100'
                      }`}
                      onClick={() => setSelectedLoan(loan)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{loan.loan_number}</span>
                        <span className="text-sm text-slate-500">
                          {formatCurrency(loan.current_balance || loan.original_amount)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">
                        {loan.borrower_name || getBorrowerName(loan.borrower_id)}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Split amounts for repayments */}
              {transactionType === 'loan_repayment' && selectedLoan && (
                <div className="space-y-2">
                  <Label>Split Allocation</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Principal</Label>
                      <Input
                        type="number"
                        value={splitAmounts.principal}
                        onChange={(e) => setSplitAmounts(prev => ({
                          ...prev,
                          principal: parseFloat(e.target.value) || 0
                        }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Interest</Label>
                      <Input
                        type="number"
                        value={splitAmounts.interest}
                        onChange={(e) => setSplitAmounts(prev => ({
                          ...prev,
                          interest: parseFloat(e.target.value) || 0
                        }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Fees</Label>
                      <Input
                        type="number"
                        value={splitAmounts.fees}
                        onChange={(e) => setSplitAmounts(prev => ({
                          ...prev,
                          fees: parseFloat(e.target.value) || 0
                        }))}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Total: {formatCurrency(splitAmounts.principal + splitAmounts.interest + splitAmounts.fees)}
                    {Math.abs((splitAmounts.principal + splitAmounts.interest + splitAmounts.fees) - amount) >= 0.01 && (
                      <span className="text-amber-600 ml-2">
                        (Difference: {formatCurrency(amount - (splitAmounts.principal + splitAmounts.interest + splitAmounts.fees))})
                      </span>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Investor Selection */}
          {(transactionType === 'investor_credit' || transactionType === 'investor_withdrawal') && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search investors..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredInvestors.map(investor => (
                    <div
                      key={investor.id}
                      className={`p-2 rounded cursor-pointer transition-colors ${
                        selectedInvestor?.id === investor.id
                          ? 'bg-blue-100 border-blue-300 border'
                          : 'hover:bg-slate-100'
                      }`}
                      onClick={() => setSelectedInvestor(investor)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {investor.business_name || investor.name}
                        </span>
                        <span className="text-sm text-slate-500">
                          {formatCurrency(investor.current_capital_balance || 0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Split for withdrawals */}
              {transactionType === 'investor_withdrawal' && selectedInvestor && (
                <div className="space-y-2">
                  <Label>Split Allocation</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Capital</Label>
                      <Input
                        type="number"
                        value={splitAmounts.capital}
                        onChange={(e) => setSplitAmounts(prev => ({
                          ...prev,
                          capital: parseFloat(e.target.value) || 0
                        }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Interest</Label>
                      <Input
                        type="number"
                        value={splitAmounts.interest}
                        onChange={(e) => setSplitAmounts(prev => ({
                          ...prev,
                          interest: parseFloat(e.target.value) || 0
                        }))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Expense Selection */}
          {transactionType === 'expense' && (
            <div className="space-y-3">
              <div>
                <Label>Expense Type (Optional)</Label>
                <Select
                  value={selectedExpenseType?.id || ''}
                  onValueChange={(id) => setSelectedExpenseType(expenseTypes.find(t => t.id === id) || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
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
              <div>
                <Label>Description</Label>
                <Input
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder="Expense description..."
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!isValid || isProcessing}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Check className="w-4 h-4 mr-2" />
            {isProcessing ? 'Creating...' : 'Create & Reconcile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
