import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Edit, TrendingUp, TrendingDown, DollarSign, Plus, Trash2, Calculator, Loader2, Calendar, Percent, Building2, Pencil, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InvestorForm from '@/components/investor/InvestorForm';
import InvestorTransactionForm from '@/components/investor/InvestorTransactionForm';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';
import { calculateAccruedInterest, getPeriodStart } from '@/lib/interestCalculation';

export default function InvestorDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const investorId = urlParams.get('id');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [isInterestDialogOpen, setIsInterestDialogOpen] = useState(false);
  const [isPostingInterest, setIsPostingInterest] = useState(false);
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

  const updateMutation = useMutation({
    mutationFn: (data) => api.entities.Investor.update(investorId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      setIsEditOpen(false);
    }
  });

  const createTransactionMutation = useMutation({
    mutationFn: async (data) => {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
    }
  });

  const updateTransactionMutation = useMutation({
    mutationFn: async (data) => {
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
    mutationFn: async (data) => {
      await api.entities.InvestorInterest.create({
        investor_id: investorId,
        type: data.type,
        amount: parseFloat(data.amount),
        date: data.date,
        description: data.description
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor-interest', investorId] });
      setIsInterestDialogOpen(false);
      setInterestFormData({ type: 'credit', amount: '', date: new Date().toISOString().split('T')[0], description: '' });
    }
  });

  const updateInterestMutation = useMutation({
    mutationFn: async (data) => {
      await api.entities.InvestorInterest.update(editingInterest.id, {
        type: data.type,
        amount: parseFloat(data.amount),
        date: data.date,
        description: data.description
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor-interest', investorId] });
      setIsInterestDialogOpen(false);
      setEditingInterest(null);
      setInterestFormData({ type: 'credit', amount: '', date: new Date().toISOString().split('T')[0], description: '' });
    }
  });

  const deleteInterestMutation = useMutation({
    mutationFn: (id) => api.entities.InvestorInterest.delete(id),
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

  // Track which date groups are expanded (must be before early returns)
  const [expandedDates, setExpandedDates] = useState(new Set());

  // Filter to only capital transactions (exclude old interest types for display)
  const capitalTransactions = useMemo(() =>
    transactions.filter(t => t.type === 'capital_in' || t.type === 'capital_out'),
    [transactions]
  );

  // Merge capital transactions and interest entries for unified display
  const mergedItems = useMemo(() => [
    ...capitalTransactions.map(t => ({
      ...t,
      itemType: 'capital',
      sortDate: new Date(t.date).getTime()
    })),
    ...interestEntries.map(e => ({
      ...e,
      itemType: 'interest',
      sortDate: new Date(e.date).getTime()
    }))
  ].sort((a, b) => b.sortDate - a.sortDate), [capitalTransactions, interestEntries]);

  // Group transactions by date for better display
  const groupedByDate = useMemo(() => {
    const groups = {};
    mergedItems.forEach(item => {
      const dateKey = item.date;
      if (!groups[dateKey]) {
        groups[dateKey] = {
          date: dateKey,
          items: [],
          totalDebit: 0,
          totalCredit: 0
        };
      }
      groups[dateKey].items.push(item);

      const isDebit = item.itemType === 'interest' ? item.type === 'debit' : item.type === 'capital_out';
      const isCredit = item.itemType === 'interest' ? item.type === 'credit' : item.type === 'capital_in';

      if (isDebit) groups[dateKey].totalDebit += parseFloat(item.amount) || 0;
      if (isCredit) groups[dateKey].totalCredit += parseFloat(item.amount) || 0;
    });
    return Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [mergedItems]);

  // Calculate totals from transactions
  const capitalIn = useMemo(() =>
    capitalTransactions.filter(t => t.type === 'capital_in').reduce((sum, t) => sum + t.amount, 0),
    [capitalTransactions]
  );
  const capitalOut = useMemo(() =>
    capitalTransactions.filter(t => t.type === 'capital_out').reduce((sum, t) => sum + t.amount, 0),
    [capitalTransactions]
  );

  // Calculate interest balance from new ledger
  const interestCredits = useMemo(() =>
    interestEntries.filter(e => e.type === 'credit').reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
    [interestEntries]
  );
  const interestDebits = useMemo(() =>
    interestEntries.filter(e => e.type === 'debit').reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0),
    [interestEntries]
  );
  const interestBalance = interestCredits - interestDebits;

  // Calculate interest accrual (safe with optional chaining)
  const annualRate = investor?.annual_interest_rate || product?.interest_rate_per_annum || 0;
  const currentBalance = investor?.current_capital_balance || 0;
  const minBalanceForInterest = product?.min_balance_for_interest || 0;

  const accruedInterest = currentBalance >= minBalanceForInterest
    ? calculateAccruedInterest(currentBalance, annualRate, investor?.last_accrual_date)
    : { accruedInterest: 0, days: 0, dailyRate: 0 };

  // Post accrued interest (creates a credit entry in interest ledger)
  const postInterestMutation = useMutation({
    mutationFn: async () => {
      const frequency = product?.interest_posting_frequency || 'monthly';
      const periodStart = investor.last_accrual_date || getPeriodStart(frequency);
      const periodEnd = new Date();

      // Create interest credit in the new ledger
      await api.entities.InvestorInterest.create({
        investor_id: investorId,
        type: 'credit',
        amount: accruedInterest.accruedInterest,
        date: new Date().toISOString().split('T')[0],
        description: `Interest for period ${format(new Date(periodStart), 'MMM dd')} - ${format(periodEnd, 'MMM dd, yyyy')} (${accruedInterest.days} days at ${annualRate}% p.a.)`
      });

      // Update investor with new accrual date
      await api.entities.Investor.update(investorId, {
        accrued_interest: 0,
        last_accrual_date: new Date().toISOString().split('T')[0]
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investor-interest', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      setIsPostingInterest(false);
    }
  });

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

  const toggleDateExpanded = (date) => {
    setExpandedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  };

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
                  {investor.interest_calculation_type === 'manual_amount'
                    ? `${formatCurrency(investor.manual_interest_amount)} Fixed`
                    : `${annualRate}% p.a.`
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
                <p className="text-xs text-slate-500 mb-1">Interest Balance</p>
                <p className={`text-xl font-bold ${interestBalance >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                  {formatCurrency(interestBalance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Total Contributed</p>
                <p className="text-xl font-bold">
                  {formatCurrency(investor.total_capital_contributed || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Interest Accrual Card */}
        {annualRate > 0 && investor.interest_calculation_type !== 'manual_amount' && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-amber-600" />
                  Interest Accrual
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => setIsPostingInterest(true)}
                  disabled={accruedInterest.accruedInterest <= 0}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  {postInterestMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <DollarSign className="w-4 h-4 mr-2" />
                  )}
                  Post Interest Credit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Percent className="w-4 h-4 text-slate-500" />
                    <p className="text-xs text-slate-500">Daily Rate</p>
                  </div>
                  <p className="text-lg font-semibold">{formatCurrency(accruedInterest.dailyRate)}</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <p className="text-xs text-slate-500">Days Accrued</p>
                  </div>
                  <p className="text-lg font-semibold">{accruedInterest.days} days</p>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-slate-500" />
                    <p className="text-xs text-slate-500">Last Posted</p>
                  </div>
                  <p className="text-lg font-semibold">
                    {investor.last_accrual_date
                      ? format(new Date(investor.last_accrual_date), 'MMM dd, yyyy')
                      : 'Never'
                    }
                  </p>
                </div>
                <div className="bg-amber-100 p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-amber-600" />
                    <p className="text-xs text-amber-700">Accrued Amount</p>
                  </div>
                  <p className="text-xl font-bold text-amber-700">
                    {formatCurrency(accruedInterest.accruedInterest)}
                  </p>
                </div>
              </div>

              {currentBalance < minBalanceForInterest && minBalanceForInterest > 0 && (
                <Alert className="mt-4 border-amber-200 bg-amber-100">
                  <AlertDescription className="text-amber-800">
                    Balance below minimum of {formatCurrency(minBalanceForInterest)} required for interest accrual.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Capital In</p>
                  <p className="text-2xl font-bold text-emerald-600">{formatCurrency(capitalIn)}</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-100">
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Capital Out</p>
                  <p className="text-2xl font-bold text-red-600">{formatCurrency(capitalOut)}</p>
                </div>
                <div className="p-3 rounded-xl bg-red-100">
                  <TrendingDown className="w-5 h-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Interest Earned</p>
                  <p className="text-2xl font-bold text-amber-600">{formatCurrency(interestCredits)}</p>
                  {interestCredits > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">Total credited</p>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-amber-100">
                  <Percent className="w-5 h-5 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Interest Paid Out</p>
                  <p className="text-2xl font-bold text-purple-600">{formatCurrency(interestDebits)}</p>
                  {interestDebits > 0 && interestBalance !== 0 && (
                    <p className={`text-xs mt-0.5 ${interestBalance < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      Balance: {formatCurrency(interestBalance)}
                    </p>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-purple-100">
                  <DollarSign className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
            {groupedByDate.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>No transactions yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Header row */}
                <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-slate-500 uppercase border-b">
                  <div className="col-span-3">Date</div>
                  <div className="col-span-4">Details</div>
                  <div className="col-span-2 text-right">Debit</div>
                  <div className="col-span-2 text-right">Credit</div>
                  <div className="col-span-1"></div>
                </div>

                {/* Grouped transactions */}
                {groupedByDate.map((group) => {
                  const isExpanded = expandedDates.has(group.date);
                  const hasMultiple = group.items.length > 1;
                  const hasCapital = group.items.some(i => i.itemType === 'capital');
                  const hasInterest = group.items.some(i => i.itemType === 'interest');

                  // Calculate breakdown amounts for collapsed display
                  const capitalDebit = group.items.filter(i => i.itemType === 'capital' && i.type === 'capital_out').reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
                  const interestDebit = group.items.filter(i => i.itemType === 'interest' && i.type === 'debit').reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

                  return (
                    <div key={group.date} className="border rounded-lg overflow-hidden">
                      {/* Group header - clickable if multiple items */}
                      <div
                        className={`grid grid-cols-12 gap-2 px-3 py-2 items-center ${hasMultiple ? 'cursor-pointer hover:bg-slate-50' : 'bg-white'} ${isExpanded ? 'bg-slate-50 border-b' : ''}`}
                        onClick={() => hasMultiple && toggleDateExpanded(group.date)}
                      >
                        <div className="col-span-3 flex items-center gap-2">
                          {hasMultiple && (
                            isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                          <span className="font-medium text-sm">{format(new Date(group.date), 'dd MMM yyyy')}</span>
                        </div>
                        <div className="col-span-4 flex items-center gap-2">
                          {hasMultiple ? (
                            <div className="flex items-center gap-1.5">
                              {hasCapital && (
                                <Badge variant="outline" className="text-xs bg-slate-100">
                                  Capital {capitalDebit > 0 && <span className="ml-1 text-red-600">{formatCurrency(capitalDebit)}</span>}
                                </Badge>
                              )}
                              {hasInterest && (
                                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                  Interest {interestDebit > 0 && <span className="ml-1">{formatCurrency(interestDebit)}</span>}
                                </Badge>
                              )}
                              <span className="text-xs text-slate-500">({group.items.length} items)</span>
                            </div>
                          ) : (
                            // Single item - show inline
                            (() => {
                              const item = group.items[0];
                              const isInterest = item.itemType === 'interest';
                              return (
                                <div className="flex items-center gap-2">
                                  {isInterest ? (
                                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                      {item.type === 'credit' ? 'Interest Credit' : 'Interest Withdrawn'}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className={`text-xs ${item.type === 'capital_in' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                      {item.type === 'capital_in' ? 'Capital In' : 'Capital Out'}
                                    </Badge>
                                  )}
                                  {(item.description || item.notes) && (
                                    <span className="text-sm text-slate-600 truncate max-w-[200px]">
                                      {item.description || item.notes}
                                    </span>
                                  )}
                                </div>
                              );
                            })()
                          )}
                        </div>
                        <div className="col-span-2 text-right">
                          {group.totalDebit > 0 && (
                            <span className="font-semibold text-red-600">{formatCurrency(group.totalDebit)}</span>
                          )}
                        </div>
                        <div className="col-span-2 text-right">
                          {group.totalCredit > 0 && (
                            <span className="font-semibold text-emerald-600">{formatCurrency(group.totalCredit)}</span>
                          )}
                        </div>
                        <div className="col-span-1 flex justify-end">
                          {!hasMultiple && (
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const item = group.items[0];
                                  if (item.itemType === 'interest') {
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const item = group.items[0];
                                  if (window.confirm(`Delete this ${item.itemType === 'interest' ? 'interest entry' : 'transaction'}?`)) {
                                    if (item.itemType === 'interest') {
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
                          )}
                        </div>
                      </div>

                      {/* Expanded detail rows */}
                      {hasMultiple && isExpanded && (
                        <div className="bg-slate-50/50">
                          {group.items.map((item) => {
                            const isInterest = item.itemType === 'interest';
                            const isDebit = isInterest ? item.type === 'debit' : item.type === 'capital_out';
                            const isCredit = isInterest ? item.type === 'credit' : item.type === 'capital_in';

                            return (
                              <div
                                key={`${item.itemType}-${item.id}`}
                                className={`grid grid-cols-12 gap-2 px-3 py-2 items-center border-b last:border-b-0 ${isInterest ? 'bg-amber-50/30' : ''}`}
                              >
                                <div className="col-span-3 pl-6">
                                  {/* Indent for nested feel */}
                                </div>
                                <div className="col-span-4 flex items-center gap-2">
                                  {isInterest ? (
                                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                      {item.type === 'credit' ? 'Interest Credit' : 'Interest Withdrawn'}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className={`text-xs ${item.type === 'capital_in' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                      {item.type === 'capital_in' ? 'Capital In' : 'Capital Out'}
                                    </Badge>
                                  )}
                                  {(item.description || item.notes) && (
                                    <span className="text-sm text-slate-600 truncate max-w-[180px]" title={item.description || item.notes}>
                                      {item.description || item.notes}
                                    </span>
                                  )}
                                </div>
                                <div className="col-span-2 text-right">
                                  {isDebit && (
                                    <span className="text-sm text-red-600">{formatCurrency(item.amount)}</span>
                                  )}
                                </div>
                                <div className="col-span-2 text-right">
                                  {isCredit && (
                                    <span className="text-sm text-emerald-600">{formatCurrency(item.amount)}</span>
                                  )}
                                </div>
                                <div className="col-span-1 flex justify-end gap-1">
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
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Totals row */}
                <div className="grid grid-cols-12 gap-2 px-3 py-3 bg-slate-100 rounded-lg border-2 border-slate-200 mt-4">
                  <div className="col-span-3 font-semibold text-slate-700">Totals</div>
                  <div className="col-span-4"></div>
                  <div className="col-span-2 text-right font-bold text-red-600">
                    {formatCurrency(capitalOut + interestDebits)}
                  </div>
                  <div className="col-span-2 text-right font-bold text-emerald-600">
                    {formatCurrency(capitalIn + interestCredits)}
                  </div>
                  <div className="col-span-1"></div>
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

        {/* Confirm Interest Posting Dialog */}
        <Dialog open={isPostingInterest} onOpenChange={setIsPostingInterest}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Post Interest Credit</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-600">
                This will create an interest credit entry for the accrued interest.
              </p>
              <div className="bg-amber-50 p-4 rounded-lg">
                <p className="text-sm text-slate-500">Amount to post:</p>
                <p className="text-2xl font-bold text-amber-700">
                  {formatCurrency(accruedInterest.accruedInterest)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  For {accruedInterest.days} days at {formatCurrency(accruedInterest.dailyRate)}/day
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setIsPostingInterest(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => postInterestMutation.mutate()}
                  disabled={postInterestMutation.isPending}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  {postInterestMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <DollarSign className="w-4 h-4 mr-2" />
                  )}
                  Confirm Post
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
