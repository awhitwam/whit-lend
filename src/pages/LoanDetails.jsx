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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ChevronRight,
  Sparkles,
  Loader2
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
  const [regenerateEndDate, setRegenerateEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [txPage, setTxPage] = useState(1);
  const [txPerPage, setTxPerPage] = useState(25);
  const [aiSummary, setAiSummary] = useState('');
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const queryClient = useQueryClient();

  const { data: loan, isLoading: loanLoading } = useQuery({
    queryKey: ['loan', loanId],
    queryFn: async () => {
      const loans = await base44.entities.Loan.filter({ id: loanId });
      return loans[0];
    },
    enabled: !!loanId
  });

  const { data: product } = useQuery({
    queryKey: ['product', loan?.product_id],
    queryFn: async () => {
      const products = await base44.entities.LoanProduct.filter({ id: loan.product_id });
      return products[0];
    },
    enabled: !!loan?.product_id
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

      // Update loan with new parameters AND product settings
      await base44.entities.Loan.update(loanId, {
        ...updatedData,
        interest_calculation_method: product.interest_calculation_method,
        interest_alignment: product.interest_alignment
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
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId], refetchType: 'active' });
      queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId], type: 'active' });
      toast.success('Schedule cleared successfully', { id: 'clear-schedule' });
      setIsClearDialogOpen(false);
    },
    onError: () => {
      toast.error('Failed to clear schedule', { id: 'clear-schedule' });
      setIsClearDialogOpen(false);
    }
  });

  const recalculateLoanMutation = useMutation({
    mutationFn: async (endDate) => {
      toast.loading('Regenerating repayment schedule...', { id: 'regenerate-schedule' });

      // Use centralized schedule manager with end date for auto-extend loans
      const options = loan.auto_extend 
        ? { endDate } 
        : { duration: loan.duration };
      await regenerateLoanSchedule(loanId, options);

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
      queryClient.invalidateQueries({ queryKey: ['loan', loanId], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['loans'], refetchType: 'active' });
      queryClient.refetchQueries({ queryKey: ['loan', loanId], type: 'active' });
      queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId], type: 'active' });
      toast.success('Schedule regenerated successfully', { id: 'regenerate-schedule' });
      setIsRegenerateDialogOpen(false);
    },
    onError: () => {
      toast.error('Failed to regenerate schedule', { id: 'regenerate-schedule' });
      setIsRegenerateDialogOpen(false);
    }
  });

  const handleGenerateLoanStatement = () => {
    generateLoanStatementPDF(loan, schedule, transactions);
  };

  const generateAISummary = async () => {
    setIsLoadingSummary(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a loan analyst. Analyze this loan repayment data and provide a clear, concise summary.

Loan Details:
- Borrower: ${loan.borrower_name}
- Principal: ${formatCurrency(loan.principal_amount)}
- Interest Rate: ${loan.interest_rate}% ${loan.interest_type}
- Duration: ${loan.duration} ${loan.period === 'Monthly' ? 'months' : 'weeks'}
- Start Date: ${format(new Date(loan.start_date), 'MMM dd, yyyy')}
- Status: ${loan.status}

Financial Summary:
- Total Repayable: ${formatCurrency(loan.total_repayable)}
- Principal Paid: ${formatCurrency(actualPrincipalPaid)} / ${formatCurrency(loan.principal_amount)}
- Interest Paid: ${formatCurrency(actualInterestPaid)} / ${formatCurrency(loan.total_interest)}
- Outstanding: ${formatCurrency(totalOutstanding)}

Schedule Progress:
- Total Installments: ${schedule.length}
- Paid: ${schedule.filter(s => s.status === 'Paid').length}
- Partial: ${schedule.filter(s => s.status === 'Partial').length}
- Pending: ${schedule.filter(s => s.status === 'Pending').length}
- Overdue: ${schedule.filter(s => s.status === 'Overdue').length}

Recent Transactions (last 5):
${transactions.filter(t => !t.is_deleted).slice(0, 5).map(t => 
  `- ${format(new Date(t.date), 'MMM dd, yyyy')}: ${formatCurrency(t.amount)} (Principal: ${formatCurrency(t.principal_applied || 0)}, Interest: ${formatCurrency(t.interest_applied || 0)})`
).join('\n')}

Please provide:
1. A brief overall assessment of the loan status
2. Payment performance (on time, behind, ahead)
3. Any concerns or positive observations
4. Next steps or recommendations

Keep it concise and actionable. Use bullet points where appropriate.`,
        add_context_from_internet: false
      });
      
      setAiSummary(result);
    } catch (error) {
      toast.error('Failed to generate AI summary');
    } finally {
      setIsLoadingSummary(false);
    }
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
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-2 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4" />
                <div>
                  <h1 className="text-base font-bold">
                    {loan.loan_number ? `#${loan.loan_number}` : `Loan ${loan.id.slice(0, 8)}`} - {loan.borrower_name}
                  </h1>
                  <p className="text-xs text-slate-300">{loan.product_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={`${getStatusColor(loan.status)} text-xs px-2 py-0.5`}>
                  {getStatusLabel(loan.status)}
                </Badge>
                {loan.status === 'Pending' && (
                  <Button 
                    size="sm" 
                    className="bg-emerald-600 hover:bg-emerald-700 h-7 text-xs"
                    onClick={() => updateStatusMutation.mutate('Live')}
                    disabled={updateStatusMutation.isPending}
                  >
                    Activate
                  </Button>
                )}
                {loan.status === 'Live' && (
                  <>
                    <Button 
                      size="sm" 
                      variant="secondary"
                      onClick={() => setIsSettleOpen(true)}
                      className="h-7 text-xs"
                    >
                      Settle
                    </Button>
                    <Button 
                      size="sm" 
                      className="bg-emerald-600 hover:bg-emerald-700 h-7 text-xs"
                      onClick={() => setIsPaymentOpen(true)}
                    >
                      <DollarSign className="w-3 h-3 mr-1" />
                      Payment
                    </Button>
                  </>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" className="h-7">
                      <MoreVertical className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleGenerateLoanStatement}>
                      <Download className="w-4 h-4 mr-2" />
                      Download Statement
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
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs mb-3">
              <div>
                <p className="text-slate-500 mb-0.5">Principal</p>
                <p className="font-bold">{formatCurrency(loan.principal_amount)}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Rate</p>
                <p className="font-bold">{loan.interest_rate}% {loan.interest_type}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Duration</p>
                <p className="font-bold">{loan.duration} {loan.period === 'Monthly' ? 'mo' : 'wk'}{loan.auto_extend && ' (ext)'}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Start Date</p>
                <p className="font-bold">{format(new Date(loan.start_date), 'dd/MM/yy')}</p>
              </div>
              {loan.arrangement_fee > 0 && (
                <div>
                  <p className="text-slate-500 mb-0.5">Arr. Fee</p>
                  <p className="font-bold text-red-600">{formatCurrency(loan.arrangement_fee)}</p>
                </div>
              )}
              {loan.exit_fee > 0 && (
                <div>
                  <p className="text-slate-500 mb-0.5">Exit Fee</p>
                  <p className="font-bold text-amber-600">{formatCurrency(loan.exit_fee)}</p>
                </div>
              )}
              {loan.net_disbursed && (
                <div>
                  <p className="text-slate-500 mb-0.5">Net Disbursed</p>
                  <p className="font-bold text-emerald-600">{formatCurrency(loan.net_disbursed)}</p>
                </div>
              )}
            </div>
            {product && (
              <div className="pt-3 border-t border-slate-200">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div>
                    <p className="text-slate-500 mb-0.5">Calculation</p>
                    <p className="font-medium text-slate-700">{product.interest_calculation_method === 'daily' ? 'Daily' : 'Monthly fixed'}</p>
                  </div>
                  {product.period === 'Monthly' && (
                    <div>
                      <p className="text-slate-500 mb-0.5">Alignment</p>
                      <p className="font-medium text-slate-700">{product.interest_alignment === 'period_based' ? 'From start' : '1st of month'}</p>
                    </div>
                  )}
                  {product.interest_only_period > 0 && (
                    <div>
                      <p className="text-slate-500 mb-0.5">Interest-Only</p>
                      <p className="font-medium text-slate-700">{product.interest_only_period} periods</p>
                    </div>
                  )}
                  {product.extend_for_full_period && (
                    <div>
                      <p className="text-slate-500 mb-0.5">Extension</p>
                      <p className="font-medium text-slate-700">Full period required</p>
                    </div>
                  )}
                  {product.interest_paid_in_advance && (
                    <div>
                      <p className="text-slate-500 mb-0.5">Payment</p>
                      <p className="font-medium text-slate-700">Paid in advance</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
            <CardContent className="p-3">
              <p className="text-xs text-blue-600 font-medium">Total Repayable</p>
              <p className="text-xl font-bold text-blue-900">{formatCurrency(loan.total_repayable)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200">
            <CardContent className="p-3">
              <p className="text-xs text-amber-600 font-medium">Interest Received</p>
              <p className="text-xl font-bold text-amber-900">{formatCurrency(actualInterestPaid)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200">
            <CardContent className="p-3">
              <p className="text-xs text-emerald-600 font-medium">Amount Paid</p>
              <p className="text-xl font-bold text-emerald-900">
                {formatCurrency(totalPaidFromSchedule)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-red-50 to-red-100/50 border-red-200">
            <CardContent className="p-3">
              <p className="text-xs text-red-600 font-medium">Outstanding</p>
              <p className="text-xl font-bold text-red-900">{formatCurrency(totalOutstanding)}</p>
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
              <CardContent className="p-3">
                <p className={`text-xs font-medium ${liveInterestOutstanding < 0 ? 'text-emerald-600' : 'text-purple-600'}`}>
                  Live Interest {liveInterestOutstanding < 0 ? 'Overpaid' : 'Due'}
                </p>
                <p className={`text-xl font-bold ${liveInterestOutstanding < 0 ? 'text-emerald-900' : 'text-purple-900'}`}>
                  {liveInterestOutstanding < 0 ? '-' : ''}{formatCurrency(Math.abs(liveInterestOutstanding))}
                </p>
                <p className="text-xs text-slate-500 mt-1">As of today</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Tabs for different views */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="repayments">
              Repayments
              <Badge variant="secondary" className="ml-2">{transactions.filter(t => !t.is_deleted && t.type === 'Repayment').length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="schedule">
              Schedule
              <Badge variant="secondary" className="ml-2">{schedule.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="expenses">
              Expenses
              <Badge variant="secondary" className="ml-2">{expenses.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="ai-analysis">
              <Sparkles className="w-4 h-4 mr-1" />
              AI Analysis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Combined Repayment View */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-slate-900">Status View</h2>
                <Badge variant="outline">{schedule.length} periods</Badge>
              </div>
              <RepaymentScheduleTable schedule={schedule} isLoading={scheduleLoading} transactions={transactions} loan={loan} />
            </div>
          </TabsContent>

          <TabsContent value="repayments">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Repayment History</CardTitle>
                  <Select 
                    defaultValue="date-desc"
                    onValueChange={(value) => {
                      const sorted = [...transactions.filter(t => !t.is_deleted && t.type === 'Repayment')];
                      if (value === 'date-desc') sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
                      if (value === 'date-asc') sorted.sort((a, b) => new Date(a.date) - new Date(b.date));
                      if (value === 'amount-desc') sorted.sort((a, b) => b.amount - a.amount);
                      if (value === 'amount-asc') sorted.sort((a, b) => a.amount - b.amount);
                    }}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date-desc">Date (Newest)</SelectItem>
                      <SelectItem value="date-asc">Date (Oldest)</SelectItem>
                      <SelectItem value="amount-desc">Amount (High-Low)</SelectItem>
                      <SelectItem value="amount-asc">Amount (Low-High)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  const repayments = transactions.filter(t => !t.is_deleted && t.type === 'Repayment');
                  const totalAmount = repayments.reduce((sum, t) => sum + t.amount, 0);
                  const totalPrincipal = repayments.reduce((sum, t) => sum + (t.principal_applied || 0), 0);
                  const totalInterest = repayments.reduce((sum, t) => sum + (t.interest_applied || 0), 0);

                  return (
                    <>
                      <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Total Repaid</p>
                          <p className="text-xl font-bold text-slate-900">{formatCurrency(totalAmount)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Principal Repaid</p>
                          <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalPrincipal)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Interest Repaid</p>
                          <p className="text-xl font-bold text-amber-600">{formatCurrency(totalInterest)}</p>
                        </div>
                      </div>

                      {repayments.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                          <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                          <p>No repayments recorded yet</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Date</th>
                                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Reference</th>
                                <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Amount</th>
                                <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Principal</th>
                                <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Interest</th>
                                <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Notes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {repayments.map((tx) => (
                                <tr key={tx.id} className="hover:bg-slate-50">
                                  <td className="py-3 px-4 text-sm font-medium">{format(new Date(tx.date), 'dd/MM/yy')}</td>
                                  <td className="py-3 px-4 text-sm text-slate-600">{tx.reference || '—'}</td>
                                  <td className="py-3 px-4 text-sm font-semibold text-emerald-600 text-right">{formatCurrency(tx.amount)}</td>
                                  <td className="py-3 px-4 text-sm text-slate-600 text-right">{formatCurrency(tx.principal_applied || 0)}</td>
                                  <td className="py-3 px-4 text-sm text-slate-600 text-right">{formatCurrency(tx.interest_applied || 0)}</td>
                                  <td className="py-3 px-4 text-sm text-slate-500">{tx.notes || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card>
              <CardHeader>
                <CardTitle>Repayment Schedule</CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const totalPrincipal = schedule.reduce((sum, s) => sum + s.principal_amount, 0);
                  const totalInterest = schedule.reduce((sum, s) => sum + s.interest_amount, 0);
                  const totalDue = schedule.reduce((sum, s) => sum + s.total_due, 0);

                  return (
                    <>
                      <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Total Principal</p>
                          <p className="text-xl font-bold text-slate-900">{formatCurrency(totalPrincipal)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Total Interest</p>
                          <p className="text-xl font-bold text-amber-600">{formatCurrency(totalInterest)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Total Due</p>
                          <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalDue)}</p>
                        </div>
                      </div>

                      {schedule.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                          <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                          <p>No schedule entries yet</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="text-left py-2 px-3 text-sm font-semibold text-slate-700">Period</th>
                                <th className="text-left py-2 px-3 text-sm font-semibold text-slate-700">Due Date</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">Principal</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">Interest</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">Total Due</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-700">Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {schedule.map((row) => (
                                <tr key={row.id} className="hover:bg-slate-50">
                                  <td className="py-2 px-3 text-sm font-medium">{row.installment_number}</td>
                                  <td className="py-2 px-3 text-sm">{format(new Date(row.due_date), 'dd/MM/yy')}</td>
                                  <td className="py-2 px-3 text-sm text-slate-600 text-right">{formatCurrency(row.principal_amount)}</td>
                                  <td className="py-2 px-3 text-sm text-slate-600 text-right">{formatCurrency(row.interest_amount)}</td>
                                  <td className="py-2 px-3 text-sm font-semibold text-right">{formatCurrency(row.total_due)}</td>
                                  <td className="py-2 px-3 text-sm text-slate-600 text-right">{formatCurrency(row.balance)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  );
                })()}
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

          <TabsContent value="ai-analysis">
            <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    AI Repayment Analysis
                  </CardTitle>
                  <Button
                    onClick={generateAISummary}
                    disabled={isLoadingSummary}
                    size="sm"
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {isLoadingSummary ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate Analysis
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {aiSummary ? (
                  <div className="prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap text-slate-700">{aiSummary}</div>
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm text-center py-4">
                    Click "Generate Analysis" to get an AI-powered summary of the loan repayment status, 
                    including payment performance and recommendations.
                  </p>
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
                {recalculateLoanMutation.isPending 
                  ? 'Regenerating schedule and reapplying payments...' 
                  : loan.auto_extend 
                    ? 'This will regenerate the schedule up to the specified end date and reapply all payments.' 
                    : 'This will clear and recreate the schedule based on product settings, then reapply all payments. This action cannot be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {loan.auto_extend && !recalculateLoanMutation.isPending && (
              <div className="px-6 py-2">
                <Label htmlFor="regenerate-end-date" className="text-sm font-medium">
                  Generate schedule up to:
                </Label>
                <Input
                  id="regenerate-end-date"
                  type="date"
                  value={regenerateEndDate}
                  onChange={(e) => setRegenerateEndDate(e.target.value)}
                  className="mt-2"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Schedule will include all periods from loan start to this date
                </p>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={recalculateLoanMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => recalculateLoanMutation.mutate(regenerateEndDate)}
                disabled={recalculateLoanMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {recalculateLoanMutation.isPending ? 'Processing...' : 'Regenerate'}
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
                {clearScheduleMutation.isPending
                  ? 'Clearing repayment schedule...'
                  : 'This will remove all scheduled payments but keep transaction history. This action cannot be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearScheduleMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => clearScheduleMutation.mutate()}
                disabled={clearScheduleMutation.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {clearScheduleMutation.isPending ? 'Processing...' : 'Clear Schedule'}
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