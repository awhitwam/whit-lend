import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Edit, TrendingUp, TrendingDown, DollarSign, Plus, Trash2, Calculator, Loader2, Calendar, Percent, Building2, Pencil, EyeOff, RefreshCw } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
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
  const [isPostingInterest, setIsPostingInterest] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [hideCancelledTransactions, setHideCancelledTransactions] = useState(false);
  const queryClient = useQueryClient();
  const _navigate = useNavigate(); // Prefixed with _ to suppress unused warning

  const { data: investor, isLoading: investorLoading } = useQuery({
    queryKey: ['investor', investorId],
    queryFn: async () => {
      const investors = await api.entities.Investor.filter({ id: investorId });
      return investors[0];
    },
    enabled: !!investorId
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['investor-transactions', investorId],
    queryFn: () => api.entities.InvestorTransaction.filter({ investor_id: investorId }, '-date'),
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

      // Update the transaction
      await api.entities.InvestorTransaction.update(editingTransaction.id, {
        ...data,
        investor_id: investorId,
        investor_name: investor.name
      });

      // Calculate capital balance changes
      // First, reverse the old transaction's effect
      let capitalChange = 0;
      if (oldTransaction.type === 'capital_in') {
        capitalChange -= oldTransaction.amount;
      } else if (oldTransaction.type === 'capital_out') {
        capitalChange += oldTransaction.amount;
      }

      // Then apply the new transaction's effect
      if (data.type === 'capital_in') {
        capitalChange += data.amount;
      } else if (data.type === 'capital_out') {
        capitalChange -= data.amount;
      }

      // Update investor balance if there's a capital change
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

  // Recalculate balance from transactions
  const recalculateBalanceMutation = useMutation({
    mutationFn: async () => {
      // Calculate totals from all transactions
      const calculatedCapitalIn = transactions.filter(t => t.type === 'capital_in').reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
      const calculatedCapitalOut = transactions.filter(t => t.type === 'capital_out').reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
      const calculatedInterestPaid = transactions.filter(t => t.type === 'interest_payment').reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

      const calculatedBalance = calculatedCapitalIn - calculatedCapitalOut;

      // Update investor with recalculated values
      await api.entities.Investor.update(investorId, {
        current_capital_balance: calculatedBalance,
        total_capital_contributed: calculatedCapitalIn,
        total_interest_paid: calculatedInterestPaid
      });

      return { calculatedBalance, calculatedCapitalIn, calculatedCapitalOut, calculatedInterestPaid };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
    }
  });

  // Post interest payment
  const postInterestMutation = useMutation({
    mutationFn: async () => {
      const frequency = product?.interest_posting_frequency || 'monthly';
      const periodStart = investor.last_accrual_date || getPeriodStart(frequency);
      const periodEnd = new Date();

      // Create interest payment transaction
      await api.entities.InvestorTransaction.create({
        investor_id: investorId,
        investor_name: investor.name,
        type: 'interest_payment',
        amount: accruedInterest.accruedInterest,
        date: new Date().toISOString().split('T')[0],
        description: `Interest payment for period ${format(new Date(periodStart), 'MMM dd')} - ${format(periodEnd, 'MMM dd, yyyy')}`,
        is_auto_generated: false,
        accrual_period_start: periodStart,
        accrual_period_end: periodEnd.toISOString().split('T')[0]
      });

      // Update investor with new accrual date and total interest paid
      await api.entities.Investor.update(investorId, {
        accrued_interest: 0,
        last_accrual_date: new Date().toISOString().split('T')[0],
        total_interest_paid: (investor.total_interest_paid || 0) + accruedInterest.accruedInterest
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investor', investorId] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions', investorId] });
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

  const capitalIn = transactions.filter(t => t.type === 'capital_in').reduce((sum, t) => sum + t.amount, 0);
  const capitalOut = transactions.filter(t => t.type === 'capital_out').reduce((sum, t) => sum + t.amount, 0);
  const interestPaid = transactions.filter(t => t.type === 'interest_payment').reduce((sum, t) => sum + t.amount, 0);
  const interestAccrued = transactions.filter(t => t.type === 'interest_accrual').reduce((sum, t) => sum + t.amount, 0);

  // Sort transactions: by date descending, with interest_accrual appearing before interest_payment on same day
  // Since display is newest-first, interest_payment shows at top, then interest_accrual below it
  // Reading down the list: payment -> accrual (chronologically: accrual happened first, then payment)
  const sortedTransactions = [...transactions].sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateA !== dateB) return dateB - dateA; // Descending by date
    // Same date: interest_payment appears first (top), interest_accrual below
    const typeOrder = { interest_payment: 0, capital_out: 1, capital_in: 2, interest_accrual: 3 };
    return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
  });

  // Calculate interest accrual
  const annualRate = investor.annual_interest_rate || product?.interest_rate_per_annum || 0;
  const currentBalance = investor.current_capital_balance || 0;
  const minBalanceForInterest = product?.min_balance_for_interest || 0;

  // Calculate accrued interest if balance meets minimum
  const accruedInterest = currentBalance >= minBalanceForInterest
    ? calculateAccruedInterest(currentBalance, annualRate, investor.last_accrual_date)
    : { accruedInterest: 0, days: 0, dailyRate: 0 };

  // Calculate monthly interest estimate
  const monthlyInterestDue = investor.interest_calculation_type === 'manual_amount'
    ? investor.manual_interest_amount || 0
    : currentBalance * (annualRate / 100 / 12);

  const getTransactionIcon = (type) => {
    if (type === 'capital_in') return { icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-100' };
    if (type === 'capital_out') return { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-100' };
    if (type === 'interest_accrual') return { icon: Percent, color: 'text-amber-600', bg: 'bg-amber-100' };
    if (type === 'interest_payment') return { icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-100' };
    return { icon: DollarSign, color: 'text-slate-600', bg: 'bg-slate-100' };
  };

  const getTransactionLabel = (type) => {
    if (type === 'capital_in') return 'Capital In';
    if (type === 'capital_out') return 'Capital Out';
    if (type === 'interest_accrual') return 'Interest Accrued';
    if (type === 'interest_payment') return 'Interest Payment';
    return type;
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
                    if (window.confirm('Recalculate balance from transactions? This will update the stored balance to match the sum of all transactions.')) {
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
                <p className="text-xs text-slate-500 mb-1">Accrued Interest</p>
                <p className="text-xl font-bold text-amber-600">
                  {formatCurrency(accruedInterest.accruedInterest)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Total Contributed</p>
                <p className="text-xl font-bold">
                  {formatCurrency(investor.total_capital_contributed || 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Total Interest Paid</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(investor.total_interest_paid || interestPaid)}
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
                  Post Interest Payment
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
                    <p className="text-xs text-slate-500">Last Accrual</p>
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  <p className="text-sm text-slate-500">Interest Paid</p>
                  <p className="text-2xl font-bold text-blue-600">{formatCurrency(interestPaid)}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-100">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Transactions</CardTitle>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <Switch
                    checked={hideCancelledTransactions}
                    onCheckedChange={setHideCancelledTransactions}
                  />
                  <EyeOff className="w-4 h-4" />
                  <span>Hide paid interest</span>
                </label>
                <Button size="sm" onClick={() => setIsTransactionOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Transaction
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>No transactions yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                {/* Find cancelled out interest pairs (accrual + payment with same amount, payment on same day or later) */}
                {(() => {
                  const cancelledIds = new Set();
                  // Sort accruals by date ascending (oldest first) to match with earliest payment
                  const accruals = sortedTransactions
                    .filter(t => t.type === 'interest_accrual')
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                  const payments = sortedTransactions
                    .filter(t => t.type === 'interest_payment')
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                  accruals.forEach(accrual => {
                    // Find a payment with same amount that occurs on or after the accrual date
                    const accrualDate = new Date(accrual.date).getTime();
                    const matchingPayment = payments.find(payment =>
                      new Date(payment.date).getTime() >= accrualDate &&
                      Math.abs(payment.amount - accrual.amount) < 0.01 &&
                      !cancelledIds.has(payment.id)
                    );
                    if (matchingPayment) {
                      cancelledIds.add(accrual.id);
                      cancelledIds.add(matchingPayment.id);
                    }
                  });

                  return (
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 pr-4 text-xs font-medium text-slate-500 uppercase">Date</th>
                      <th className="pb-2 pr-4 text-xs font-medium text-slate-500 uppercase">Type</th>
                      <th className="pb-2 pr-4 text-xs font-medium text-slate-500 uppercase">Description</th>
                      <th className="pb-2 pr-4 text-xs font-medium text-slate-500 uppercase text-right">Debit</th>
                      <th className="pb-2 pr-4 text-xs font-medium text-slate-500 uppercase text-right">Credit</th>
                      <th className="pb-2 text-xs font-medium text-slate-500 uppercase text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sortedTransactions
                      .filter(tx => !hideCancelledTransactions || !cancelledIds.has(tx.id))
                      .map((tx) => {
                      const { icon: Icon, color, bg } = getTransactionIcon(tx.type);
                      // Debit = money going OUT (capital_out, interest_payment paid out)
                      // Credit = money coming IN (capital_in, interest_accrual added to balance)
                      const isDebit = tx.type === 'capital_out' || tx.type === 'interest_payment';
                      const isCredit = tx.type === 'capital_in' || tx.type === 'interest_accrual';
                      const isCancelled = cancelledIds.has(tx.id);

                      return (
                        <tr key={tx.id} className={`hover:bg-slate-50 ${isCancelled ? 'opacity-60' : ''}`}>
                          <td className="py-1.5 pr-4 whitespace-nowrap">
                            <p className="text-sm font-medium">{format(new Date(tx.date), 'dd MMM yyyy')}</p>
                          </td>
                          <td className="py-1.5 pr-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className={`p-1 rounded ${bg}`}>
                                <Icon className={`w-3 h-3 ${color}`} />
                              </div>
                              <span className="text-sm">{getTransactionLabel(tx.type)}</span>
                              {tx.is_auto_generated && (
                                <Badge variant="outline" className="text-xs">Auto</Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 pr-4">
                            {(tx.description || tx.notes) ? (
                              <div className="group relative">
                                <p className="text-sm text-slate-700 max-w-lg truncate cursor-default">
                                  {tx.description || tx.notes}
                                </p>
                                {(tx.description || tx.notes || '').length > 60 && (
                                  <div className="hidden group-hover:block absolute z-10 left-0 top-full mt-1 p-3 bg-slate-900 text-white text-sm rounded-lg shadow-lg max-w-xl whitespace-pre-wrap">
                                    {tx.description || tx.notes}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-slate-400">-</p>
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                            {isDebit ? (
                              <p className={`font-semibold text-red-600 ${isCancelled ? 'line-through' : ''}`}>{formatCurrency(tx.amount)}</p>
                            ) : (
                              <p className="text-slate-300">-</p>
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                            {isCredit ? (
                              <p className={`font-semibold text-emerald-600 ${isCancelled ? 'line-through' : ''}`}>{formatCurrency(tx.amount)}</p>
                            ) : (
                              <p className="text-slate-300">-</p>
                            )}
                          </td>
                          <td className="py-1.5 text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                onClick={() => {
                                  setEditingTransaction(tx);
                                  setIsTransactionOpen(true);
                                }}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  if (window.confirm('Delete this transaction?')) {
                                    deleteTransactionMutation.mutate(tx.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td colSpan="3" className="py-2 pr-4 text-sm font-semibold text-slate-700">Totals</td>
                      <td className="py-2 pr-4 text-right font-bold text-red-600">
                        {formatCurrency(capitalOut + interestPaid)}
                      </td>
                      <td className="py-2 pr-4 text-right font-bold text-emerald-600">
                        {formatCurrency(capitalIn + interestAccrued)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
                  );
                })()}
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
              <DialogTitle>{editingTransaction ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle>
            </DialogHeader>
            <InvestorTransactionForm
              investor={investor}
              transaction={editingTransaction}
              monthlyInterestDue={monthlyInterestDue}
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

        {/* Confirm Interest Posting Dialog */}
        <Dialog open={isPostingInterest} onOpenChange={setIsPostingInterest}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Post Interest Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-600">
                This will create an interest payment transaction for the accrued interest.
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
