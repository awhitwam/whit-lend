import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft, 
  DollarSign, 
  Calendar, 
  User,
  TrendingUp,
  FileText,
  Banknote,
  Clock,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import RepaymentScheduleTable from '@/components/loan/RepaymentScheduleTable';
import PaymentModal from '@/components/loan/PaymentModal';
import { formatCurrency, applyPaymentWaterfall } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';

export default function LoanDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const loanId = urlParams.get('id');
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: loan, isLoading: loanLoading } = useQuery({
    queryKey: ['loan', loanId],
    queryFn: async () => {
      const loans = await base44.entities.Loan.filter({ id: loanId });
      return loans[0];
    },
    enabled: !!loanId
  });

  const { data: schedule = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ['loan-schedule', loanId],
    queryFn: () => base44.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number'),
    enabled: !!loanId
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['loan-transactions', loanId],
    queryFn: () => base44.entities.Transaction.filter({ loan_id: loanId }, '-date'),
    enabled: !!loanId
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status) => base44.entities.Loan.update(loanId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    }
  });

  const paymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      // Apply waterfall logic
      const { updates, remainingPayment } = applyPaymentWaterfall(paymentData.amount, schedule);
      
      let totalPrincipalApplied = 0;
      let totalInterestApplied = 0;
      
      // Update schedule rows
      for (const update of updates) {
        await base44.entities.RepaymentSchedule.update(update.id, {
          interest_paid: update.interest_paid,
          principal_paid: update.principal_paid,
          status: update.status
        });
        totalPrincipalApplied += update.principalApplied;
        totalInterestApplied += update.interestApplied;
      }
      
      // Create transaction
      await base44.entities.Transaction.create({
        ...paymentData,
        principal_applied: totalPrincipalApplied,
        interest_applied: totalInterestApplied
      });
      
      // Update loan totals
      const newPrincipalPaid = (loan.principal_paid || 0) + totalPrincipalApplied;
      const newInterestPaid = (loan.interest_paid || 0) + totalInterestApplied;
      
      const updateData = {
        principal_paid: newPrincipalPaid,
        interest_paid: newInterestPaid
      };
      
      // Check if loan is fully paid
      if (newPrincipalPaid >= loan.principal_amount && newInterestPaid >= loan.total_interest) {
        updateData.status = 'Closed';
      }
      
      await base44.entities.Loan.update(loanId, updateData);
      
      return { totalPrincipalApplied, totalInterestApplied };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-transactions', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      setIsPaymentOpen(false);
    }
  });

  const getStatusColor = (status) => {
    const colors = {
      'Pending': 'bg-slate-100 text-slate-700',
      'Approved': 'bg-blue-100 text-blue-700',
      'Active': 'bg-emerald-100 text-emerald-700',
      'Closed': 'bg-slate-100 text-slate-600',
      'Defaulted': 'bg-red-100 text-red-700'
    };
    return colors[status] || colors['Pending'];
  };

  if (loanLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="h-64 bg-white rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (!loan) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-6xl mx-auto text-center py-20">
          <h2 className="text-2xl font-bold text-slate-900">Loan not found</h2>
          <Link to={createPageUrl('Loans')}>
            <Button className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Loans
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const principalRemaining = loan.principal_amount - (loan.principal_paid || 0);
  const interestRemaining = loan.total_interest - (loan.interest_paid || 0);
  const totalOutstanding = principalRemaining + interestRemaining;
  const progressPercent = ((loan.principal_paid || 0) + (loan.interest_paid || 0)) / loan.total_repayable * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Back Button */}
        <Link to={createPageUrl('Loans')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Loans
          </Button>
        </Link>

        {/* Header */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-6 text-white">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <FileText className="w-6 h-6" />
                  <h1 className="text-2xl font-bold">{loan.product_name}</h1>
                </div>
                <Link 
                  to={createPageUrl(`BorrowerDetails?id=${loan.borrower_id}`)}
                  className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors"
                >
                  <User className="w-4 h-4" />
                  {loan.borrower_name}
                </Link>
              </div>
              <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                <Badge className={`${getStatusColor(loan.status)} text-sm px-3 py-1`}>
                  {loan.status}
                </Badge>
                {loan.status === 'Pending' && (
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="secondary"
                      onClick={() => updateStatusMutation.mutate('Approved')}
                      disabled={updateStatusMutation.isPending}
                    >
                      Approve
                    </Button>
                  </div>
                )}
                {loan.status === 'Approved' && (
                  <Button 
                    size="sm" 
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => updateStatusMutation.mutate('Active')}
                    disabled={updateStatusMutation.isPending}
                  >
                    Disburse Loan
                  </Button>
                )}
                {loan.status === 'Active' && (
                  <Button 
                    size="sm" 
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => setIsPaymentOpen(true)}
                  >
                    <DollarSign className="w-4 h-4 mr-2" />
                    Record Payment
                  </Button>
                )}
              </div>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <Banknote className="w-4 h-4" />
                  Principal
                </div>
                <p className="text-xl font-bold">{formatCurrency(loan.principal_amount)}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <TrendingUp className="w-4 h-4" />
                  Interest Rate
                </div>
                <p className="text-xl font-bold">{loan.interest_rate}%</p>
                <p className="text-xs text-slate-500">{loan.interest_type}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <Clock className="w-4 h-4" />
                  Duration
                </div>
                <p className="text-xl font-bold">{loan.duration} {loan.period === 'Monthly' ? 'months' : 'weeks'}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                  <Calendar className="w-4 h-4" />
                  Start Date
                </div>
                <p className="text-xl font-bold">{format(new Date(loan.start_date), 'MMM dd, yyyy')}</p>
              </div>
            </div>
            
            {(loan.arrangement_fee > 0 || loan.exit_fee > 0) && (
              <div className="mt-6 pt-6 border-t border-slate-200">
                <p className="text-sm font-medium text-slate-700 mb-3">Fees</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {loan.arrangement_fee > 0 && (
                    <div>
                      <p className="text-xs text-slate-500">Arrangement Fee</p>
                      <p className="text-lg font-semibold text-red-600">{formatCurrency(loan.arrangement_fee)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Deducted from disbursement</p>
                    </div>
                  )}
                  {loan.net_disbursed && (
                    <div>
                      <p className="text-xs text-slate-500">Net Disbursed</p>
                      <p className="text-lg font-semibold text-emerald-600">{formatCurrency(loan.net_disbursed)}</p>
                    </div>
                  )}
                  {loan.exit_fee > 0 && (
                    <div>
                      <p className="text-xs text-slate-500">Exit Fee</p>
                      <p className="text-lg font-semibold text-amber-600">{formatCurrency(loan.exit_fee)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Added to repayment</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
            <CardContent className="p-5">
              <p className="text-sm text-blue-600 font-medium">Total Repayable</p>
              <p className="text-2xl font-bold text-blue-900">{formatCurrency(loan.total_repayable)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200">
            <CardContent className="p-5">
              <p className="text-sm text-amber-600 font-medium">Total Interest</p>
              <p className="text-2xl font-bold text-amber-900">{formatCurrency(loan.total_interest)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200">
            <CardContent className="p-5">
              <p className="text-sm text-emerald-600 font-medium">Amount Paid</p>
              <p className="text-2xl font-bold text-emerald-900">
                {formatCurrency((loan.principal_paid || 0) + (loan.interest_paid || 0))}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-red-50 to-red-100/50 border-red-200">
            <CardContent className="p-5">
              <p className="text-sm text-red-600 font-medium">Outstanding</p>
              <p className="text-2xl font-bold text-red-900">{formatCurrency(totalOutstanding)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Progress */}
        {loan.status === 'Active' && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Repayment Progress</span>
                <span className="text-lg font-bold">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-sm text-slate-500">
                <span>Principal: {formatCurrency(loan.principal_paid || 0)} / {formatCurrency(loan.principal_amount)}</span>
                <span>Interest: {formatCurrency(loan.interest_paid || 0)} / {formatCurrency(loan.total_interest)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Repayment Schedule */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Repayment Schedule</h2>
            <Badge variant="outline">{schedule.length} installments</Badge>
          </div>
          <RepaymentScheduleTable schedule={schedule} isLoading={scheduleLoading} />
        </div>

        {/* Recent Transactions */}
        {transactions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {transactions.slice(0, 10).map((tx) => (
                  <div key={tx.id} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${tx.type === 'Repayment' ? 'bg-emerald-100' : 'bg-blue-100'}`}>
                        <DollarSign className={`w-4 h-4 ${tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`} />
                      </div>
                      <div>
                        <p className="font-medium">{tx.type}</p>
                        <p className="text-sm text-slate-500">{format(new Date(tx.date), 'MMM dd, yyyy')}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        {formatCurrency(tx.amount)}
                      </p>
                      {tx.reference && <p className="text-xs text-slate-500">{tx.reference}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment Modal */}
        <PaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          loan={loan}
          outstandingAmount={totalOutstanding}
          onSubmit={(data) => paymentMutation.mutate(data)}
          isLoading={paymentMutation.isPending}
        />
      </div>
    </div>
  );
}