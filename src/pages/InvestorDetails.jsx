import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Edit, TrendingUp, TrendingDown, DollarSign, Plus, Trash2 } from 'lucide-react';
import InvestorForm from '@/components/investor/InvestorForm';
import InvestorTransactionForm from '@/components/investor/InvestorTransactionForm';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';

export default function InvestorDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const investorId = urlParams.get('id');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  if (investorLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="h-64 bg-white rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!investor) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-6xl mx-auto text-center py-20">
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

  // Calculate monthly interest due
  const monthlyInterestDue = investor.interest_calculation_type === 'annual_rate'
    ? (investor.current_capital_balance || 0) * (investor.annual_interest_rate / 100 / 12)
    : investor.manual_interest_amount || 0;

  const getTransactionIcon = (type) => {
    if (type === 'capital_in') return { icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-100' };
    if (type === 'capital_out') return { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-100' };
    return { icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-100' };
  };

  const getTransactionLabel = (type) => {
    if (type === 'capital_in') return 'Capital In';
    if (type === 'capital_out') return 'Capital Out';
    return 'Interest Payment';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
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
                <div className="flex gap-4 mt-2 text-slate-300">
                  {investor.email && <p>{investor.email}</p>}
                  {investor.phone && <p>{investor.phone}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge className={investor.status === 'Active' 
                  ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400' 
                  : 'bg-slate-500/20 text-slate-200 border-slate-400'
                }>
                  {investor.status}
                </Badge>
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
                <p className="text-xs text-slate-500 mb-1">Interest Type</p>
                <p className="font-semibold">
                  {investor.interest_calculation_type === 'annual_rate' 
                    ? `${investor.annual_interest_rate}% p.a.` 
                    : `${formatCurrency(investor.manual_interest_amount)} Fixed`
                  }
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Current Capital</p>
                <p className="text-xl font-bold text-purple-600">
                  {formatCurrency(investor.current_capital_balance || 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Monthly Interest Due</p>
                <p className="text-xl font-bold text-amber-600">
                  {formatCurrency(monthlyInterestDue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Total Contributed</p>
                <p className="text-xl font-bold">
                  {formatCurrency(investor.total_capital_contributed || 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Interest Paid</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(interestPaid)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

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
              <Button size="sm" onClick={() => setIsTransactionOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Transaction
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>No transactions yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {transactions.map((tx) => {
                  const { icon: Icon, color, bg } = getTransactionIcon(tx.type);
                  return (
                    <div key={tx.id} className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`p-2 rounded-lg ${bg}`}>
                          <Icon className={`w-4 h-4 ${color}`} />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{getTransactionLabel(tx.type)}</p>
                          <p className="text-sm text-slate-500">{format(new Date(tx.date), 'MMM dd, yyyy')}</p>
                          {tx.notes && <p className="text-xs text-slate-500 mt-1">{tx.notes}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className={`font-semibold ${color}`}>
                            {formatCurrency(tx.amount)}
                          </p>
                          {tx.reference && <p className="text-xs text-slate-500">{tx.reference}</p>}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (window.confirm('Delete this transaction?')) {
                              deleteTransactionMutation.mutate(tx.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
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

        <Dialog open={isTransactionOpen} onOpenChange={setIsTransactionOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Transaction</DialogTitle>
            </DialogHeader>
            <InvestorTransactionForm
              investor={investor}
              monthlyInterestDue={monthlyInterestDue}
              onSubmit={(data) => createTransactionMutation.mutate(data)}
              onCancel={() => setIsTransactionOpen(false)}
              isLoading={createTransactionMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}