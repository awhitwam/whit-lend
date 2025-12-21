import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertTriangle,
  Trash2,
  AlertCircle as AlertCircleIcon,
  Edit,
  MoreVertical,
  Repeat,
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import RepaymentScheduleTable from '@/components/loan/RepaymentScheduleTable';
import PaymentModal from '@/components/loan/PaymentModal';
import EditLoanModal from '@/components/loan/EditLoanModal';
import SettleLoanModal from '@/components/loan/SettleLoanModal';
import { formatCurrency, applyPaymentWaterfall, calculateLiveInterestOutstanding } from '@/components/loan/LoanCalculator';
import { regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';
import { generateLoanStatementPDF } from '@/components/loan/LoanPDFGenerator';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function LoanDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const loanId = urlParams.get('id');
  const navigate = useNavigate();
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [txPage, setTxPage] = useState(1);
  const [txPerPage, setTxPerPage] = useState(25);
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

  const { data: expenses = [] } = useQuery({
    queryKey: ['loan-expenses', loanId],
    queryFn: () => base44.entities.Expense.filter({ loan_id: loanId }, '-date'),
    enabled: !!loanId
  });

  const editLoanMutation = useMutation({
    mutationFn: async (updatedData) => {
      toast.loading('Updating loan...', { id: 'edit-loan' });
      
      // Fetch the product to get its settings
      const products = await base44.entities.LoanProduct.filter({ id: updatedData.product_id });
      const product = products[0];
      
      if (!product) throw new Error('Product not found');

      // Update loan with new parameters
      await base44.entities.Loan.update(loanId, {
        ...updatedData,
        interest_type: product.interest_type,
        period: product.period
      });
      
      toast.loading('Regenerating schedule...', { id: 'edit-loan' });
      
      // Delete old schedule
      const oldSchedule = await base44.entities.RepaymentSchedule.filter({ loan_id: loanId });
      for (const row of oldSchedule) {
        await base44.entities.RepaymentSchedule.delete(row.id);
      }
      
      // Use centralized schedule manager to regenerate
      await regenerateLoanSchedule(loanId, { duration: updatedData.duration });
      
      toast.loading('Reapplying payments...', { id: 'edit-loan' });
      
      // Reapply all non-deleted payments
      const activeTransactions = transactions.filter(t => !t.is_deleted && t.type === 'Repayment');
      const newScheduleRows = await base44.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number');
      
      let totalPrincipalPaid = 0;
      let totalInterestPaid = 0;
      
      for (const tx of activeTransactions) {
        const { updates } = applyPaymentWaterfall(tx.amount, newScheduleRows, 0, 'credit');
        
        for (const update of updates) {
          await base44.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
          totalPrincipalPaid += update.principalApplied;
          totalInterestPaid += update.interestApplied;
        }
      }
      
      // Update loan payment totals
      await base44.entities.Loan.update(loanId, {
        principal_paid: totalPrincipalPaid,
        interest_paid: totalInterestPaid
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-transactions', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      toast.success('Loan updated successfully', { id: 'edit-loan' });
      setIsEditOpen(false);
    },
    onError: () => {
      toast.error('Failed to update loan', { id: 'edit-loan' });
    }
  });

  const deleteLoanMutation = useMutation({
    mutationFn: async (reason) => {
      const user = await base44.auth.me();
      
      await base44.entities.Loan.update(loanId, {
        is_deleted: true,
        deleted_by: user.email,
        deleted_date: new Date().toISOString(),
        deleted_reason: reason
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      navigate(createPageUrl('Loans'));
    }
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: async ({ transactionId, reason }) => {
      toast.loading('Deleting transaction...', { id: 'delete-transaction' });
      const transaction = transactions.find(t => t.id === transactionId);
      const user = await base44.auth.me();
      
      // Mark transaction as deleted (audit trail)
      await base44.entities.Transaction.update(transactionId, {
        is_deleted: true,
        deleted_by: user.email,
        deleted_date: new Date().toISOString(),
        deleted_reason: reason
      });
      
      // Reverse the transaction effects
      const newPrincipalPaid = (loan.principal_paid || 0) - (transaction.principal_applied || 0);
      const newInterestPaid = (loan.interest_paid || 0) - (transaction.interest_applied || 0);
      
      await base44.entities.Loan.update(loanId, {
        principal_paid: Math.max(0, newPrincipalPaid),
        interest_paid: Math.max(0, newInterestPaid),
        status: 'Live' // Reopen if was closed
      });
      
      // Reverse schedule updates - recalculate from all non-deleted transactions
      const allSchedule = await base44.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number');
      
      // Reset all schedule rows
      for (const row of allSchedule) {
        await base44.entities.RepaymentSchedule.update(row.id, {
          principal_paid: 0,
          interest_paid: 0,
          status: 'Pending'
        });
      }
      
      // Reapply all non-deleted transactions
      const activeTransactions = transactions.filter(t => !t.is_deleted && t.id !== transactionId);
      for (const tx of activeTransactions) {
        const { updates } = applyPaymentWaterfall(tx.amount, allSchedule, 0, 'credit');
        for (const update of updates) {
          const currentRow = allSchedule.find(r => r.id === update.id);
          await base44.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-transactions', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      toast.success('Transaction deleted', { id: 'delete-transaction' });
    },
    onError: () => {
      toast.error('Failed to delete transaction', { id: 'delete-transaction' });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status) => {
      toast.loading('Updating loan status...', { id: 'update-status' });
      return base44.entities.Loan.update(loanId, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      toast.success('Loan status updated', { id: 'update-status' });
    },
    onError: () => {
      toast.error('Failed to update status', { id: 'update-status' });
    }
  });

  const toggleAutoExtendMutation = useMutation({
    mutationFn: () => {
      toast.loading('Updating auto-extend...', { id: 'auto-extend' });
      return base44.entities.Loan.update(loanId, { auto_extend: !loan.auto_extend });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      toast.success(`Auto-extend ${loan.auto_extend ? 'disabled' : 'enabled'}`, { id: 'auto-extend' });
    },
    onError: () => {
      toast.error('Failed to update auto-extend', { id: 'auto-extend' });
    }
  });

  const clearScheduleMutation = useMutation({
    mutationFn: async () => {
      toast.loading('Clearing repayment schedule...', { id: 'clear-schedule' });
      const scheduleRows = await base44.entities.RepaymentSchedule.filter({ loan_id: loanId });
      for (const row of scheduleRows) {
        await base44.entities.RepaymentSchedule.delete(row.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
      toast.success('Schedule cleared successfully', { id: 'clear-schedule' });
    },
    onError: () => {
      toast.error('Failed to clear schedule', { id: 'clear-schedule' });
    }
  });

  const recalculateLoanMutation = useMutation({
    mutationFn: async () => {
      toast.loading('Regenerating repayment schedule...', { id: 'regenerate-schedule' });

      // Use centralized schedule manager with current loan duration
      await regenerateLoanSchedule(loanId, { duration: loan.duration });

      toast.loading('Reapplying payments...', { id: 'regenerate-schedule' });

      // Reapply all non-deleted payments
      const activeTransactions = transactions.filter(t => !t.is_deleted && t.type === 'Repayment');
      const newScheduleRows = await base44.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number');

      let totalPrincipalPaid = 0;
      let totalInterestPaid = 0;

      for (const tx of activeTransactions) {
        const { updates } = applyPaymentWaterfall(tx.amount, newScheduleRows, 0, 'credit');

        for (const update of updates) {
          await base44.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
          totalPrincipalPaid += update.principalApplied;
          totalInterestPaid += update.interestApplied;
        }
      }

      // Update loan payment totals
      await base44.entities.Loan.update(loanId, {
        principal_paid: totalPrincipalPaid,
        interest_paid: totalInterestPaid
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      toast.success('Schedule regenerated successfully', { id: 'regenerate-schedule' });
    },
    onError: () => {
      toast.error('Failed to regenerate schedule', { id: 'regenerate-schedule' });
    }
  });

  const handleGenerateLoanStatement = () => {
    generateLoanStatementPDF(loan, schedule, transactions);
  };

  const paymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      toast.loading('Processing payment...', { id: 'payment' });
      
      // Check if this is a settlement payment
      const isSettlement = paymentData.notes?.toLowerCase().includes('settlement');
      
      // Apply waterfall logic with overpayment handling
      const { updates, principalReduction, creditAmount } = applyPaymentWaterfall(
        paymentData.amount, 
        schedule,
        loan.overpayment_credit || 0,
        paymentData.overpayment_option
      );
      
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
      
      // If settlement, delete all remaining unpaid installments
      if (isSettlement) {
        const remainingInstallments = schedule.filter(row => row.status === 'Pending');
        for (const row of remainingInstallments) {
          await base44.entities.RepaymentSchedule.delete(row.id);
        }
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
        interest_paid: newInterestPaid,
        overpayment_credit: creditAmount
      };
      
      // Check if loan is fully paid or settled
      if (isSettlement || (newPrincipalPaid >= loan.principal_amount && newInterestPaid >= loan.total_interest)) {
        updateData.status = 'Closed';
      }
      
      await base44.entities.Loan.update(loanId, updateData);
      
      return { totalPrincipalApplied, totalInterestApplied, principalReduction, creditAmount };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loan-transactions', loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      toast.success('Payment recorded successfully', { id: 'payment' });
      setIsPaymentOpen(false);
    },
    onError: () => {
      toast.error('Failed to record payment', { id: 'payment' });
    }
  });

  const getStatusColor = (status) => {
    const colors = {
      'Pending': 'bg-slate-100 text-slate-700',
      'Live': 'bg-emerald-100 text-emerald-700',
      'Closed': 'bg-purple-100 text-purple-700',
      'Defaulted': 'bg-red-100 text-red-700'
    };
    return colors[status] || colors['Pending'];
  };

  const getStatusLabel = (status) => {
    return status === 'Closed' ? 'Settled' : status;
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

  // Calculate totals from actual transactions
  const actualPrincipalPaid = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
  const actualInterestPaid = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  
  // Calculate totals from repayment schedule
  const schedulePrincipalPaid = schedule.reduce((sum, row) => sum + (row.principal_paid || 0), 0);
  const scheduleInterestPaid = schedule.reduce((sum, row) => sum + (row.interest_paid || 0), 0);
  const totalPaidFromSchedule = actualPrincipalPaid + actualInterestPaid;
  
  const principalRemaining = loan.principal_amount - actualPrincipalPaid;
  const interestRemaining = loan.total_interest - actualInterestPaid;
  const totalOutstanding = principalRemaining + interestRemaining;
  const progressPercent = (actualPrincipalPaid / loan.principal_amount) * 100;
  const liveInterestOutstanding = calculateLiveInterestOutstanding(loan);
  const isLoanActive = loan.status === 'Live' || loan.status === 'Active';

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
                  <div>
                    <h1 className="text-2xl font-bold">
                      {loan.loan_number ? `#${loan.loan_number}` : `Loan ${loan.id.slice(0, 8)}`} - {loan.borrower_name}
                    </h1>
                    <p className="text-sm text-slate-300 mt-1">{loan.product_name}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                <Badge className={`${getStatusColor(loan.status)} text-sm px-3 py-1`}>
                  {getStatusLabel(loan.status)}
                </Badge>
                {loan.status === 'Pending' && (
                  <Button 
                    size="sm" 
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => updateStatusMutation.mutate('Live')}
                    disabled={updateStatusMutation.isPending}
                  >
                    Activate Loan
                  </Button>
                )}
                {loan.status === 'Live' && (
                  <>
                    <Button 
                      size="sm" 
                      variant="secondary"
                      onClick={() => setIsSettleOpen(true)}
                    >
                      Calculate Settlement
                    </Button>
                    <Button 
                      size="sm" 
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => setIsPaymentOpen(true)}
                    >
                      <DollarSign className="w-4 h-4 mr-2" />
                      Record Payment
                    </Button>
                  </>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleGenerateLoanStatement}>
                      <Download className="w-4 h-4 mr-2" />
                      Download Loan Statement
                    </DropdownMenuItem>
                    {loan.status !== 'Closed' && (
                      <>
                        <DropdownMenuItem 
                          onClick={() => setIsRegenerateDialogOpen(true)}
                          disabled={recalculateLoanMutation.isPending}
                        >
                          <Repeat className="w-4 h-4 mr-2" />
                          Regenerate Schedule
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => setIsClearDialogOpen(true)}
                          disabled={clearScheduleMutation.isPending}
                          className="text-red-600"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Clear Schedule
                        </DropdownMenuItem>
                      </>
                    )}
                    {(loan.status === 'Active' || loan.status === 'Live') && (
                      <DropdownMenuItem onClick={() => toggleAutoExtendMutation.mutate()}>
                        <Repeat className="w-4 h-4 mr-2" />
                        {loan.auto_extend ? 'Disable' : 'Enable'} Auto-Extend
                      </DropdownMenuItem>
                    )}
                    {loan.status !== 'Closed' && (
                      <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit Loan
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem 
                      className="text-red-600"
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Loan
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                  </DropdownMenu>
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
                {loan.auto_extend && (
                  <div className="flex items-center gap-1 mt-1">
                    <Repeat className="w-3 h-3 text-blue-600" />
                    <p className="text-xs text-blue-600 font-medium">Auto-extending</p>
                  </div>
                )}
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

            {loan.auto_extend && loan.status === 'Active' && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <Repeat className="w-4 h-4 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">Auto-Extend Enabled</p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      This loan will continue to accrue interest beyond the original duration until fully settled. 
                      Use the settlement calculator for accurate payoff amounts.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
            <CardContent className="p-5">
              <p className="text-sm text-blue-600 font-medium">Total Repayable</p>
              <p className="text-2xl font-bold text-blue-900">{formatCurrency(loan.total_repayable)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200">
            <CardContent className="p-5">
              <p className="text-sm text-amber-600 font-medium">Interest Received</p>
              <p className="text-2xl font-bold text-amber-900">{formatCurrency(actualInterestPaid)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200">
            <CardContent className="p-5">
              <p className="text-sm text-emerald-600 font-medium">Amount Paid</p>
              <p className="text-2xl font-bold text-emerald-900">
                {formatCurrency(totalPaidFromSchedule)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-red-50 to-red-100/50 border-red-200">
            <CardContent className="p-5">
              <p className="text-sm text-red-600 font-medium">Outstanding</p>
              <p className="text-2xl font-bold text-red-900">{formatCurrency(totalOutstanding)}</p>
              {loan.overpayment_credit > 0 && (
                <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Credit: {formatCurrency(loan.overpayment_credit)}
                </p>
              )}
            </CardContent>
          </Card>
          {isLoanActive && (
            <Card className={`bg-gradient-to-br ${liveInterestOutstanding < 0 ? 'from-emerald-50 to-emerald-100/50 border-emerald-200' : 'from-purple-50 to-purple-100/50 border-purple-200'}`}>
              <CardContent className="p-5">
                <p className={`text-sm font-medium ${liveInterestOutstanding < 0 ? 'text-emerald-600' : 'text-purple-600'}`}>
                  Live Interest {liveInterestOutstanding < 0 ? 'Overpaid' : 'Due'}
                </p>
                <p className={`text-2xl font-bold ${liveInterestOutstanding < 0 ? 'text-emerald-900' : 'text-purple-900'}`}>
                  {liveInterestOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(liveInterestOutstanding))}
                </p>
                <p className="text-xs text-slate-500 mt-1">As of today</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Progress */}
        {isLoanActive && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Principal Repayment Progress</span>
                <span className="text-lg font-bold">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-sm text-slate-500">
                <span>{formatCurrency(actualPrincipalPaid)} / {formatCurrency(loan.principal_amount)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs for different views */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="transactions">
              Transactions
              <Badge variant="secondary" className="ml-2">{transactions.filter(t => !t.is_deleted).length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="expenses">
              Expenses
              <Badge variant="secondary" className="ml-2">{expenses.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Combined Repayment View */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-slate-900">Repayment Schedule & Transactions</h2>
                <Badge variant="outline">{schedule.length} periods</Badge>
              </div>
              <RepaymentScheduleTable schedule={schedule} isLoading={scheduleLoading} transactions={transactions} loan={loan} />
            </div>
          </TabsContent>

          <TabsContent value="transactions">
            <Card>
              <CardHeader>
                <CardTitle>Transaction History</CardTitle>
              </CardHeader>
              <CardContent>
                {transactions.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No transactions yet</p>
                  </div>
                ) : (
                  <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-600">Show</span>
                      <Select value={txPerPage.toString()} onValueChange={(v) => { setTxPerPage(Number(v)); setTxPage(1); }}>
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                          <SelectItem value={transactions.length.toString()}>All</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-slate-600">entries</span>
                    </div>
                    <div className="text-sm text-slate-600">
                      Showing {(txPage - 1) * txPerPage + 1} to {Math.min(txPage * txPerPage, transactions.length)} of {transactions.length}
                    </div>
                  </div>
                  <div className="divide-y">
                    {transactions.slice((txPage - 1) * txPerPage, txPage * txPerPage).map((tx) => (
                      <div key={tx.id} className={`py-3 flex items-center justify-between ${tx.is_deleted ? 'opacity-50 bg-red-50/50' : ''}`}>
                        <div className="flex items-center gap-3 flex-1">
                          <div className={`p-2 rounded-lg ${tx.is_deleted ? 'bg-red-100' : tx.type === 'Repayment' ? 'bg-emerald-100' : 'bg-blue-100'}`}>
                            {tx.is_deleted ? (
                              <Trash2 className="w-4 h-4 text-red-600" />
                            ) : (
                              <DollarSign className={`w-4 h-4 ${tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`} />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{tx.type}</p>
                              {tx.is_deleted && (
                                <Badge variant="destructive" className="text-xs">Deleted</Badge>
                              )}
                            </div>
                            <p className="text-sm text-slate-500">{format(new Date(tx.date), 'MMM dd, yyyy')}</p>
                            {tx.is_deleted && (
                              <p className="text-xs text-red-600 mt-1">
                                Deleted by {tx.deleted_by} on {format(new Date(tx.deleted_date), 'MMM dd, yyyy')}
                                {tx.deleted_reason && ` - ${tx.deleted_reason}`}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className={`font-semibold ${tx.is_deleted ? 'text-red-600 line-through' : tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`}>
                              {formatCurrency(tx.amount)}
                            </p>
                            {tx.reference && <p className="text-xs text-slate-500">{tx.reference}</p>}
                          </div>
                          {!tx.is_deleted && loan.status === 'Active' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                const reason = prompt('Enter reason for deleting this transaction:');
                                if (reason) {
                                  deleteTransactionMutation.mutate({ transactionId: tx.id, reason });
                                }
                              }}
                              disabled={deleteTransactionMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTxPage(p => Math.max(1, p - 1))}
                      disabled={txPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Previous
                    </Button>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-600">
                        Page {txPage} of {Math.ceil(transactions.length / txPerPage)}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTxPage(p => Math.min(Math.ceil(transactions.length / txPerPage), p + 1))}
                      disabled={txPage >= Math.ceil(transactions.length / txPerPage)}
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="expenses">
            <Card>
              <CardHeader>
                <CardTitle>Loan Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                {expenses.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No expenses linked to this loan</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {expenses.map(expense => (
                      <div key={expense.id} className="py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="p-2 rounded-lg bg-red-100">
                            <DollarSign className="w-4 h-4 text-red-600" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{expense.type_name}</p>
                              <Badge variant="outline" className="text-xs">{expense.type_name}</Badge>
                            </div>
                            <p className="text-sm text-slate-500">{format(new Date(expense.date), 'MMM dd, yyyy')}</p>
                            {expense.description && (
                              <p className="text-xs text-slate-500 mt-1">{expense.description}</p>
                            )}
                          </div>
                        </div>
                        <p className="font-semibold text-red-600">{formatCurrency(expense.amount)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Payment Modal */}
        <PaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          loan={loan}
          outstandingAmount={totalOutstanding}
          onSubmit={(data) => paymentMutation.mutate(data)}
          isLoading={paymentMutation.isPending}
        />

        {/* Edit Loan Modal */}
        <EditLoanModal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          loan={loan}
          onSubmit={(data) => editLoanMutation.mutate(data)}
          isLoading={editLoanMutation.isPending}
        />

        {/* Settle Loan Modal */}
        <SettleLoanModal
          isOpen={isSettleOpen}
          onClose={() => setIsSettleOpen(false)}
          loan={loan}
          onSubmit={(data) => {
            paymentMutation.mutate(data);
            setIsSettleOpen(false);
          }}
          isLoading={paymentMutation.isPending}
        />

        {/* Regenerate Schedule Dialog */}
        <AlertDialog open={isRegenerateDialogOpen} onOpenChange={setIsRegenerateDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regenerate Repayment Schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                This will clear and recreate the schedule based on product settings, then reapply all payments. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  recalculateLoanMutation.mutate();
                  setIsRegenerateDialogOpen(false);
                }}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                Regenerate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Clear Schedule Dialog */}
        <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear Repayment Schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove all scheduled payments but keep transaction history. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  clearScheduleMutation.mutate();
                  setIsClearDialogOpen(false);
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                Clear Schedule
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Loan Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Loan?</AlertDialogTitle>
              <AlertDialogDescription>
                Please provide a reason for deleting this loan. This action marks the loan as deleted but preserves the record for audit purposes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-4">
              <textarea
                className="w-full min-h-[100px] px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Enter reason for deletion..."
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteReason('')}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (deleteReason.trim()) {
                    deleteLoanMutation.mutate(deleteReason);
                    setIsDeleteDialogOpen(false);
                    setDeleteReason('');
                  }
                }}
                disabled={!deleteReason.trim()}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete Loan
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
        </div>
        );
        }