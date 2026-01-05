import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logInvestorEvent, logInvestorTransactionEvent, AuditAction } from '@/lib/auditLog';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Edit, TrendingUp, TrendingDown, DollarSign, Plus, Trash2, Loader2, Percent, Building2, Pencil, RefreshCw, Landmark } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InvestorForm from '@/components/investor/InvestorForm';
import InvestorTransactionForm from '@/components/investor/InvestorTransactionForm';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';
import { calculateAccruedInterest } from '@/lib/interestCalculation';

export default function InvestorDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const investorId = urlParams.get('id');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [isInterestDialogOpen, setIsInterestDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [editingInterest, setEditingInterest] = useState(null);
  const [interestFormData, setInterestFormData] = useState({
    type: 'credit',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    description: ''
  });
  const queryClient = useQueryClient();
  const _navigate = useNavigate();

  const { data: investor, isLoading: investorLoading } = useQuery({
    queryKey: ['investor', investorId],
    queryFn: async () => {
      const investors = await api.entities.Investor.filter({ id: investorId });
      return investors[0];
    },
    enabled: !!investorId
  });

  // Capital transactions only (no interest types)
  const { data: transactions = [] } = useQuery({
    queryKey: ['investor-transactions', investorId],
    queryFn: () => api.entities.InvestorTransaction.filter({ investor_id: investorId }, '-date'),
    enabled: !!investorId
  });

  // Interest ledger entries
  const { data: interestEntries = [] } = useQuery({
    queryKey: ['investor-interest', investorId],
    queryFn: () => api.entities.InvestorInterest.filter({ investor_id: investorId }, '-date'),
    enabled: !!investorId
  });

  // Fetch investor product if assigned
  const { data: product } = useQuery({
    queryKey: ['investorProduct', investor?.investor_product_id],
    queryFn: async () => {
      if (!investor?.investor_product_id) return null;
      const products = await api.entities.InvestorProduct.filter({ id: investor.investor_product_id });
      return products[0];
    },
    enabled: !!investor?.investor_product_id
  });

  // Fetch reconciliation entries to show which transactions are matched to bank statements
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['investor-reconciliation-entries', investorId],
    queryFn: () => api.entities.ReconciliationEntry.list(),
    enabled: !!investorId
  });

  // Fetch bank statements to show details about matched entries
  const { data: bankStatements = [] } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api.entities.BankStatement.list(),
    enabled: reconciliationEntries.length > 0
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.entities.Investor.update(investorId, data),
    onSuccess: (_updatedInvestor, variables) => {
      logInvestorEvent(AuditAction.INVESTOR_UPDATE, { id: investorId, name: investor?.name }, variables, investor);
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      setIsEditOpen(false);
    }
  });

  const createTransactionMutation = useMutation({
    mutationFn: async (/** @type {{type: string, amount: number, date: string, notes?: string}} */ data) => {
      await api.entities.InvestorTransaction.create({
        ...data,
        investor_id: investorId,
        investor_name: investor.name
      });

      let capitalChange = 0;
      if (data.type === 'capital_in') {
        capitalChange = data.amount;
      } else if (data.type === 'capital_out') {
        capitalChange = -data.amount;
      }

      if (capitalChange !== 0) {
        await api.entities.Investor.update(investorId, {
          current_capital_balance: (investor.current_capital_balance || 0) + capitalChange,
          total_capital_contributed: data.type === 'capital_in'
            ? (investor.total_capital_contributed || 0) + data.amount
            : investor.total_capital_contributed
        });
      }

      // Log audit event
      logInvestorTransactionEvent(AuditAction.INVESTOR_TRANSACTION_CREATE,
        { id: null, investor_id: investorId, type: data.type, amount: data.amount, date: data.date },
        { name: investor?.name },
        { description: data.notes }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      setIsTransactionOpen(false);
    }
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: async (transactionId) => {
      const transaction = transactions.find(t => t.id === transactionId);
      await api.entities.InvestorTransaction.delete(transactionId);

      let capitalChange = 0;
      if (transaction.type === 'capital_in') {
        capitalChange = -transaction.amount;
      } else if (transaction.type === 'capital_out') {
        capitalChange = transaction.amount;
      }

      if (capitalChange !== 0) {
        await api.entities.Investor.update(investorId, {
          current_capital_balance: (investor.current_capital_balance || 0) + capitalChange,
          total_capital_contributed: transaction.type === 'capital_in'
            ? (investor.total_capital_contributed || 0) - transaction.amount
            : investor.total_capital_contributed
        });
      }

      // Log the deletion
      logInvestorTransactionEvent(AuditAction.INVESTOR_TRANSACTION_DELETE,
        { id: transactionId, investor_id: investorId, type: transaction.type, amount: transaction.amount, date: transaction.date },
        { name: investor?.name },
        { reason: 'User deleted transaction' }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
    }
  });

  const updateTransactionMutation = useMutation({
    mutationFn: async (/** @type {{type: string, amount: number, date: string, notes?: string}} */ data) => {
      const oldTransaction = transactions.find(t => t.id === editingTransaction.id);

      await api.entities.InvestorTransaction.update(editingTransaction.id, {
        ...data,
        investor_id: investorId,
        investor_name: investor.name
      });

      let capitalChange = 0;
      if (oldTransaction.type === 'capital_in') {
        capitalChange -= oldTransaction.amount;
      } else if (oldTransaction.type === 'capital_out') {
        capitalChange += oldTransaction.amount;
      }

      if (data.type === 'capital_in') {
        capitalChange += data.amount;
      } else if (data.type === 'capital_out') {
        capitalChange -= data.amount;
      }

      if (capitalChange !== 0 || oldTransaction.type !== data.type) {
        const oldCapitalIn = oldTransaction.type === 'capital_in' ? oldTransaction.amount : 0;
        const newCapitalIn = data.type === 'capital_in' ? data.amount : 0;
        const contributedChange = newCapitalIn - oldCapitalIn;

        await api.entities.Investor.update(investorId, {
          current_capital_balance: (investor.current_capital_balance || 0) + capitalChange,
          total_capital_contributed: (investor.total_capital_contributed || 0) + contributedChange
        });
      }

      // Log the update with before/after values
      logInvestorTransactionEvent(AuditAction.INVESTOR_TRANSACTION_UPDATE,
        { id: editingTransaction.id, investor_id: investorId, type: data.type, amount: data.amount, date: data.date },
        { name: investor?.name },
        { new_type: data.type, new_amount: data.amount, new_date: data.date },
        { old_type: oldTransaction.type, old_amount: oldTransaction.amount, old_date: oldTransaction.date }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      setIsTransactionOpen(false);
      setEditingTransaction(null);
    }
  });

  // Interest ledger mutations
  const createInterestMutation = useMutation({
    mutationFn: async (/** @type {{type: string, amount: string, date: string, description?: string}} */ data) => {
      await api.entities.InvestorInterest.create({
        investor_id: investorId,
        type: data.type,
        amount: parseFloat(data.amount),
        date: data.date,
        description: data.description
      });

      // Log interest entry creation
      logInvestorTransactionEvent(AuditAction.INVESTOR_TRANSACTION_CREATE,
        { id: null, investor_id: investorId, type: `interest_${data.type}`, amount: parseFloat(data.amount), date: data.date },
        { name: investor?.name },
        { interest_type: data.type, description: data.description }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor-interest', investorId] });
      setIsInterestDialogOpen(false);
      setInterestFormData({ type: 'credit', amount: '', date: new Date().toISOString().split('T')[0], description: '' });
    }
  });

  const updateInterestMutation = useMutation({
    mutationFn: async (/** @type {{type: string, amount: string, date: string, description?: string}} */ data) => {
      await api.entities.InvestorInterest.update(editingInterest.id, {
        type: data.type,
        amount: parseFloat(data.amount),
        date: data.date,
        description: data.description
      });

      // Log interest entry update
      logInvestorTransactionEvent(AuditAction.INVESTOR_TRANSACTION_UPDATE,
        { id: editingInterest.id, investor_id: investorId, type: `interest_${data.type}`, amount: parseFloat(data.amount), date: data.date },
        { name: investor?.name },
        { new_type: data.type, new_amount: parseFloat(data.amount), new_date: data.date },
        { old_type: editingInterest.type, old_amount: editingInterest.amount, old_date: editingInterest.date }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor-interest', investorId] });
      setIsInterestDialogOpen(false);
      setEditingInterest(null);
      setInterestFormData({ type: 'credit', amount: '', date: new Date().toISOString().split('T')[0], description: '' });
    }
  });

  const deleteInterestMutation = useMutation({
    mutationFn: async (id) => {
      const entry = interestEntries.find(e => e.id === id);
      await api.entities.InvestorInterest.delete(id);

      // Log interest entry deletion
      if (entry) {
        logInvestorTransactionEvent(AuditAction.INVESTOR_TRANSACTION_DELETE,
          { id, investor_id: investorId, type: `interest_${entry.type}`, amount: entry.amount, date: entry.date },
          { name: investor?.name },
          { reason: 'User deleted interest entry' }
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor-interest', investorId] });
    }
  });

  // Recalculate balance from transactions
  const recalculateBalanceMutation = useMutation({
    mutationFn: async () => {
      const calculatedCapitalIn = transactions.filter(t => t.type === 'capital_in').reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
      const calculatedCapitalOut = transactions.filter(t => t.type === 'capital_out').reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
      const calculatedBalance = calculatedCapitalIn - calculatedCapitalOut;

      await api.entities.Investor.update(investorId, {
        current_capital_balance: calculatedBalance,
        total_capital_contributed: calculatedCapitalIn
      });

      return { calculatedBalance, calculatedCapitalIn, calculatedCapitalOut };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
    }
  });


  // Filter to only capital transactions (exclude old interest types for display)
  const capitalTransactions = useMemo(() =>
    transactions.filter(t => t.type === 'capital_in' || t.type === 'capital_out'),
    [transactions]
  );

  // Merge capital transactions and interest entries for unified display
  // Sort by date descending, and for same date interest entries, debits appear before credits
  // (so credit appears as earlier transaction when reading top-to-bottom)
  const mergedItems = useMemo(() => [
    ...capitalTransactions.map(t => ({
      ...t,
      itemType: 'capital',
      sortDate: new Date(t.date).getTime(),
      sortOrder: 0 // Capital transactions have neutral order
    })),
    ...interestEntries.map(e => ({
      ...e,
      itemType: 'interest',
      sortDate: new Date(e.date).getTime(),
      sortOrder: e.type === 'credit' ? 1 : -1 // Debits before credits (so credit is "earlier" when newest first)
    }))
  ].sort((a, b) => {
    // First sort by date descending (newest first)
    if (b.sortDate !== a.sortDate) return b.sortDate - a.sortDate;
    // For same date, sort by sortOrder (debits first, so credit appears below/earlier)
    return a.sortOrder - b.sortOrder;
  }), [capitalTransactions, interestEntries]);

  // Calculate which interest entries should be struck out (matched credit/debit pairs in same month)
  const struckOutIds = useMemo(() => {
    const struckOut = new Set();

    // Group interest entries by month
    const interestByMonth = {};
    interestEntries.forEach(entry => {
      const monthKey = entry.date.substring(0, 7); // YYYY-MM
      if (!interestByMonth[monthKey]) {
        interestByMonth[monthKey] = { credits: [], debits: [] };
      }
      if (entry.type === 'credit') {
        interestByMonth[monthKey].credits.push(entry);
      } else {
        interestByMonth[monthKey].debits.push(entry);
      }
    });

    // For each month, check if total credits match total debits
    Object.values(interestByMonth).forEach(month => {
      const totalCredits = month.credits.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
      const totalDebits = month.debits.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

      // If credits and debits match (within 1p tolerance), strike them all out
      if (month.credits.length > 0 && month.debits.length > 0 && Math.abs(totalCredits - totalDebits) < 0.01) {
        month.credits.forEach(e => struckOut.add(e.id));
        month.debits.forEach(e => struckOut.add(e.id));
      }
    });

    return struckOut;
  }, [interestEntries]);

  // Calculate totals from transactions
  const capitalIn = useMemo(() =>
    capitalTransactions.filter(t => t.type === 'capital_in').reduce((sum, t) => sum + t.amount, 0),
    [capitalTransactions]
  );
  const capitalOut = useMemo(() =>
    capitalTransactions.filter(t => t.type === 'capital_out').reduce((sum, t) => sum + t.amount, 0),
    [capitalTransactions]
  );

  // Calculate interest accrual (safe with optional chaining)
  const annualRate = investor?.annual_interest_rate || product?.interest_rate_per_annum || 0;
  const currentBalance = investor?.current_capital_balance || 0;

  // Calculate interest accruing since last posting
  const accruedSinceLastPosting = useMemo(() => {
    if (!investor || !annualRate || currentBalance <= 0) {
      return { accruedInterest: 0, days: 0, dailyRate: 0 };
    }
    return calculateAccruedInterest(currentBalance, annualRate, investor.last_accrual_date);
  }, [investor, annualRate, currentBalance]);

  // Calculate interest due (credits not yet withdrawn)
  // Only count entries dated on or after last_accrual_date (current period)
  // Historical entries before last_accrual_date are considered settled
  const interestDue = useMemo(() => {
    const cutoffDate = investor?.last_accrual_date;
    if (!cutoffDate) return 0;

    const recentCredits = interestEntries
      .filter(e => e.type === 'credit' && e.date >= cutoffDate)
      .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const recentDebits = interestEntries
      .filter(e => e.type === 'debit' && e.date >= cutoffDate)
      .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    return Math.max(0, recentCredits - recentDebits);
  }, [interestEntries, investor?.last_accrual_date]);

  // Calculate totals from interest ledger (for totals row display only)
  const interestCredits = useMemo(() =>
    interestEntries.filter(e => e.type === 'credit').reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
    [interestEntries]
  );
  const interestDebits = useMemo(() =>
    interestEntries.filter(e => e.type === 'debit').reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
    [interestEntries]
  );

  // Build maps of transaction/interest ID -> array of bank statement details for reconciliation indicator
  // Uses arrays to support transactions matched to multiple bank entries
  const capitalTxReconciliationMap = useMemo(() => {
    const map = new Map();
    reconciliationEntries
      .filter(entry => entry.investor_transaction_id)
      .forEach(entry => {
        const bankStatement = bankStatements.find(bs => bs.id === entry.bank_statement_id);
        const existing = map.get(entry.investor_transaction_id) || [];
        existing.push({ entry, bankStatement });
        map.set(entry.investor_transaction_id, existing);
      });
    return map;
  }, [reconciliationEntries, bankStatements]);

  const interestReconciliationMap = useMemo(() => {
    const map = new Map();
    reconciliationEntries
      .filter(entry => entry.interest_id)
      .forEach(entry => {
        const bankStatement = bankStatements.find(bs => bs.id === entry.bank_statement_id);
        const existing = map.get(entry.interest_id) || [];
        existing.push({ entry, bankStatement });
        map.set(entry.interest_id, existing);
      });
    return map;
  }, [reconciliationEntries, bankStatements]);


  if (investorLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="h-64 bg-white rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!investor) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold text-slate-900">Investor not found</h2>
          <Link to={createPageUrl('Investors')}>
            <Button className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Investors
            </Button>
          </Link>
        </div>
      </div>
    );
  }


  const getTransactionIcon = (type) => {
    if (type === 'capital_in') return { icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-100' };
    if (type === 'capital_out') return { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-100' };
    return { icon: DollarSign, color: 'text-slate-600', bg: 'bg-slate-100' };
  };

  const getTransactionLabel = (type) => {
    if (type === 'capital_in') return 'Capital In';
    if (type === 'capital_out') return 'Capital Out';
    return type;
  };

  const openInterestDialog = (entry = null) => {
    if (entry) {
      setEditingInterest(entry);
      setInterestFormData({
        type: entry.type,
        amount: entry.amount.toString(),
        date: entry.date,
        description: entry.description || ''
      });
    } else {
      setEditingInterest(null);
      setInterestFormData({
        type: 'credit',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        description: ''
      });
    }
    setIsInterestDialogOpen(true);
  };

  const handleInterestSubmit = (e) => {
    e.preventDefault();
    if (editingInterest) {
      updateInterestMutation.mutate(interestFormData);
    } else {
      createInterestMutation.mutate(interestFormData);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <Link to={createPageUrl('Investors')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Investors
          </Button>
        </Link>

        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-6 text-white">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">{investor.name}</h1>
                <div className="flex flex-wrap gap-4 mt-2 text-slate-300 text-sm">
                  {investor.email && <p>{investor.email}</p>}
                  {investor.phone && <p>{investor.phone}</p>}
                  {investor.account_number && <p>Account: {investor.account_number}</p>}
                </div>
                {product && (
                  <div className="mt-2">
                    <Badge className="bg-purple-500/20 text-purple-200 border-purple-400">
                      {product.name}
                    </Badge>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Badge className={investor.status === 'Active'
                  ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400'
                  : 'bg-slate-500/20 text-slate-200 border-slate-400'
                }>
                  {investor.status}
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (window.confirm('Recalculate capital balance from transactions?')) {
                      recalculateBalanceMutation.mutate();
                    }
                  }}
                  disabled={recalculateBalanceMutation.isPending}
                >
                  {recalculateBalanceMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Recalculate
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setIsEditOpen(true)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </div>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Interest Rate</p>
                <p className="font-semibold">
                  {investor.interest_calculation_type === 'annual_rate' && annualRate > 0
                    ? `${annualRate}% p.a.`
                    : <span className="text-slate-500 italic">Manual</span>
                  }
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Current Capital</p>
                <p className="text-xl font-bold text-purple-600">
                  {formatCurrency(currentBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Interest Due</p>
                <p className={`text-xl font-bold ${interestDue > 0 ? 'text-amber-600' : 'text-slate-600'}`}>
                  {formatCurrency(interestDue)}
                </p>
                <p className="text-xs text-slate-400">Posted, not yet withdrawn</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Interest Accruing</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(accruedSinceLastPosting.accruedInterest)}
                </p>
                {accruedSinceLastPosting.days > 0 && (
                  <p className="text-xs text-slate-400">
                    {accruedSinceLastPosting.days} days @ {formatCurrency(accruedSinceLastPosting.dailyRate)}/day
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Total Contributed</p>
                <p className="text-xl font-bold">
                  {formatCurrency(capitalIn)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>


        {/* Additional Details */}
        {(investor.business_name || investor.first_name || investor.investor_number) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Additional Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {investor.business_name && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Business Name</p>
                    <p className="font-medium">{investor.business_name}</p>
                  </div>
                )}
                {(investor.first_name || investor.last_name) && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Contact Name</p>
                    <p className="font-medium">{investor.first_name} {investor.last_name}</p>
                  </div>
                )}
                {investor.investor_number && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Investor #</p>
                    <p className="font-medium">{investor.investor_number}</p>
                  </div>
                )}
                {investor.account_number && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Account Number</p>
                    <p className="font-medium">{investor.account_number}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}


        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Transactions & Interest</CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openInterestDialog()}>
                  <Percent className="w-4 h-4 mr-2" />
                  Add Interest Entry
                </Button>
                <Button size="sm" onClick={() => setIsTransactionOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Capital Transaction
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {mergedItems.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>No transactions yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {/* Header row */}
                <div className="flex gap-2 px-3 py-2 text-xs font-medium text-slate-500 uppercase border-b">
                  <div className="w-24 shrink-0">Date</div>
                  <div className="w-28 shrink-0">Type</div>
                  <div className="flex-1 min-w-0">Details</div>
                  <div className="w-20 shrink-0 text-right">Debit</div>
                  <div className="w-20 shrink-0 text-right">Credit</div>
                  <div className="w-16 shrink-0"></div>
                </div>

                {/* Flat transaction list */}
                <TooltipProvider>
                {mergedItems.map((item) => {
                  const isInterest = item.itemType === 'interest';
                  const isDebit = isInterest ? item.type === 'debit' : item.type === 'capital_out';
                  const isCredit = isInterest ? item.type === 'credit' : item.type === 'capital_in';
                  const isStruckOut = isInterest && struckOutIds.has(item.id);

                  // Check reconciliation status (now returns array of matches)
                  const reconMatches = isInterest
                    ? interestReconciliationMap.get(item.id)
                    : capitalTxReconciliationMap.get(item.id);
                  const isReconciled = reconMatches && reconMatches.length > 0;

                  return (
                    <div
                      key={`${item.itemType}-${item.id}`}
                      className={`flex gap-2 px-3 py-2 items-center border-b hover:bg-slate-50 ${isInterest ? 'bg-amber-50/30' : ''}`}
                    >
                      <div className="w-24 shrink-0">
                        <span className="text-sm">{format(new Date(item.date), 'dd MMM yyyy')}</span>
                      </div>
                      <div className="w-28 shrink-0">
                        {isInterest ? (
                          <Badge variant="outline" className={`text-xs bg-amber-50 text-amber-700 border-amber-200 ${isStruckOut ? 'opacity-60' : ''}`}>
                            {item.type === 'credit' ? 'Interest Credit' : 'Interest Withdrawn'}
                            {isStruckOut && <span className="ml-1 text-emerald-600">✓</span>}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={`text-xs ${item.type === 'capital_in' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            {item.type === 'capital_in' ? 'Capital In' : 'Capital Out'}
                          </Badge>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {(item.description || item.notes) && (
                          <span className={`text-sm text-slate-600 truncate block ${isStruckOut ? 'opacity-60' : ''}`} title={item.description || item.notes}>
                            {item.description || item.notes}
                          </span>
                        )}
                      </div>
                      <div className="w-20 shrink-0 text-right">
                        {isDebit && (
                          <span className={`text-sm text-red-600 ${isStruckOut ? 'line-through opacity-60' : ''}`}>
                            {formatCurrency(item.amount)}
                          </span>
                        )}
                      </div>
                      <div className="w-20 shrink-0 text-right">
                        {isCredit && (
                          <span className={`text-sm text-emerald-600 ${isStruckOut ? 'line-through opacity-60' : ''}`}>
                            {formatCurrency(item.amount)}
                          </span>
                        )}
                      </div>
                      <div className="w-16 shrink-0 flex justify-end gap-1">
                        {/* Bank reconciliation indicator */}
                        {isReconciled && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-blue-500 cursor-help flex items-center">
                                <Landmark className="w-3.5 h-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <div className="text-xs space-y-2">
                                <div className="font-medium text-blue-600">
                                  Matched to {reconMatches.length > 1 ? `${reconMatches.length} bank entries` : 'bank statement'}
                                </div>
                                {reconMatches.map((match, idx) => (
                                  <div key={idx} className={reconMatches.length > 1 ? 'border-t border-slate-200 pt-1' : ''}>
                                    {match.bankStatement && (
                                      <>
                                        <div>Date: {format(new Date(match.bankStatement.statement_date), 'dd MMM yyyy')}</div>
                                        <div>Amount: {formatCurrency(Math.abs(match.bankStatement.amount))}</div>
                                        <div>Source: {match.bankStatement.bank_source || '-'}</div>
                                        {match.bankStatement.description && (
                                          <div className="text-slate-500 truncate max-w-[200px]">
                                            {match.bankStatement.description}
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                          onClick={() => {
                            if (isInterest) {
                              openInterestDialog(item);
                            } else {
                              setEditingTransaction(item);
                              setIsTransactionOpen(true);
                            }
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (window.confirm(`Delete this ${isInterest ? 'interest entry' : 'transaction'}?`)) {
                              if (isInterest) {
                                deleteInterestMutation.mutate(item.id);
                              } else {
                                deleteTransactionMutation.mutate(item.id);
                              }
                            }
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                </TooltipProvider>

                {/* Totals row */}
                <div className="flex gap-2 px-3 py-3 bg-slate-100 rounded-lg border-2 border-slate-200 mt-4">
                  <div className="w-24 shrink-0 font-semibold text-slate-700">Totals</div>
                  <div className="w-28 shrink-0"></div>
                  <div className="flex-1 min-w-0"></div>
                  <div className="w-20 shrink-0 text-right font-bold text-red-600">
                    {formatCurrency(capitalOut + interestDebits)}
                  </div>
                  <div className="w-20 shrink-0 text-right font-bold text-emerald-600">
                    {formatCurrency(capitalIn + interestCredits)}
                  </div>
                  <div className="w-16 shrink-0"></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Investor</DialogTitle>
            </DialogHeader>
            <InvestorForm
              investor={investor}
              onSubmit={(data) => updateMutation.mutate(data)}
              onCancel={() => setIsEditOpen(false)}
              isLoading={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={isTransactionOpen} onOpenChange={(open) => {
            setIsTransactionOpen(open);
            if (!open) setEditingTransaction(null);
          }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingTransaction ? 'Edit Transaction' : 'Add Capital Transaction'}</DialogTitle>
            </DialogHeader>
            <InvestorTransactionForm
              investor={investor}
              transaction={editingTransaction}
              onSubmit={(data) => {
                if (editingTransaction) {
                  updateTransactionMutation.mutate(data);
                } else {
                  createTransactionMutation.mutate(data);
                }
              }}
              onCancel={() => {
                setIsTransactionOpen(false);
                setEditingTransaction(null);
              }}
              isLoading={editingTransaction ? updateTransactionMutation.isPending : createTransactionMutation.isPending}
            />
          </DialogContent>
        </Dialog>

        {/* Interest Entry Dialog */}
        <Dialog open={isInterestDialogOpen} onOpenChange={(open) => {
            setIsInterestDialogOpen(open);
            if (!open) {
              setEditingInterest(null);
              setInterestFormData({ type: 'credit', amount: '', date: new Date().toISOString().split('T')[0], description: '' });
            }
          }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingInterest ? 'Edit Interest Entry' : 'Add Interest Entry'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleInterestSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={interestFormData.type}
                  onValueChange={(value) => setInterestFormData(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">Credit (Interest Added)</SelectItem>
                    <SelectItem value="debit">Debit (Interest Withdrawn)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={interestFormData.amount}
                  onChange={(e) => setInterestFormData(prev => ({ ...prev, amount: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={interestFormData.date}
                  onChange={(e) => setInterestFormData(prev => ({ ...prev, date: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={interestFormData.description}
                  onChange={(e) => setInterestFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setIsInterestDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createInterestMutation.isPending || updateInterestMutation.isPending}
                  className={interestFormData.type === 'credit' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}
                >
                  {(createInterestMutation.isPending || updateInterestMutation.isPending) && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {editingInterest ? 'Update' : 'Add'} {interestFormData.type === 'credit' ? 'Credit' : 'Debit'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
