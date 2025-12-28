import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logLoanEvent, logTransactionEvent, AuditAction } from '@/lib/auditLog';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Loader2,
  Shield,
  Zap,
  Coins
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
import { formatCurrency, applyPaymentWaterfall, applyManualPayment, calculateLiveInterestOutstanding, calculateAccruedInterest } from '@/components/loan/LoanCalculator';
import { regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';
import { generateLoanStatementPDF } from '@/components/loan/LoanPDFGenerator';
import SecurityTab from '@/components/loan/SecurityTab';
import ImportRestructureModal from '@/components/loan/ImportRestructureModal';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function LoanDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const loanId = urlParams.get('id');
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);
  const [regenerateEndDate, setRegenerateEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteAuthorized, setDeleteAuthorized] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const [txPerPage, setTxPerPage] = useState(25);
  const [aiSummary, setAiSummary] = useState('');
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [disbursementSort, setDisbursementSort] = useState('date-desc');
  const [activeTab, setActiveTab] = useState('overview');
  const [isImportRestructureOpen, setIsImportRestructureOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: loan, isLoading: loanLoading } = useQuery({
    queryKey: ['loan', loanId],
    queryFn: async () => {
      const loans = await api.entities.Loan.filter({ id: loanId });
      return loans[0];
    },
    enabled: !!loanId
  });

  const { data: product } = useQuery({
    queryKey: ['product', loan?.product_id],
    queryFn: async () => {
      const products = await api.entities.LoanProduct.filter({ id: loan.product_id });
      return products[0];
    },
    enabled: !!loan?.product_id
  });

  const { data: schedule = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ['loan-schedule', loanId],
    queryFn: () => api.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number'),
    enabled: !!loanId
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['loan-transactions', loanId],
    queryFn: () => api.entities.Transaction.filter({ loan_id: loanId }, '-date'),
    enabled: !!loanId
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['loan-expenses', loanId],
    queryFn: () => api.entities.Expense.filter({ loan_id: loanId }, '-date'),
    enabled: !!loanId
  });

  const { data: borrower } = useQuery({
    queryKey: ['borrower', loan?.borrower_id],
    queryFn: async () => {
      const borrowers = await api.entities.Borrower.filter({ id: loan.borrower_id });
      return borrowers[0];
    },
    enabled: !!loan?.borrower_id
  });

  const editLoanMutation = useMutation({
    mutationFn: async (updatedData) => {
      setIsProcessing(true);
      setProcessingMessage('Updating loan...');
      toast.loading('Updating loan...', { id: 'edit-loan' });

      // Fetch the product to get its settings
      const products = await api.entities.LoanProduct.filter({ id: updatedData.product_id });
      const product = products[0];

      if (!product) throw new Error('Product not found');

      // Capture previous values for audit - include all modifiable fields
      const previousValues = {
        principal_amount: loan.principal_amount,
        interest_rate: loan.interest_rate,
        duration: loan.duration,
        start_date: loan.start_date,
        auto_extend: loan.auto_extend,
        // Product changes
        product_id: loan.product_id,
        product_name: loan.product_name,
        // Fee changes
        arrangement_fee: loan.arrangement_fee,
        exit_fee: loan.exit_fee,
        net_disbursed: loan.net_disbursed,
        // Interest rate override
        override_interest_rate: loan.override_interest_rate,
        overridden_rate: loan.overridden_rate,
        // Penalty rate changes
        has_penalty_rate: loan.has_penalty_rate,
        penalty_rate: loan.penalty_rate,
        penalty_rate_from: loan.penalty_rate_from
      };

      // Update loan with new parameters
      await api.entities.Loan.update(loanId, updatedData);

      // Log loan update to audit trail
      await logLoanEvent(AuditAction.LOAN_UPDATE, loan, updatedData, previousValues);

      toast.loading('Regenerating schedule...', { id: 'edit-loan' });

      // Delete old schedule
      const oldSchedule = await api.entities.RepaymentSchedule.filter({ loan_id: loanId });
      for (const row of oldSchedule) {
        await api.entities.RepaymentSchedule.delete(row.id);
      }

      // Use centralized schedule manager to regenerate
      // Use same logic as Regenerate Schedule: respect auto_extend setting
      const today = new Date();
      const isAutoExtend = updatedData.auto_extend !== undefined ? updatedData.auto_extend : loan.auto_extend;
      const loanDuration = updatedData.duration || loan.duration;
      const options = isAutoExtend
        ? { endDate: format(today, 'yyyy-MM-dd'), duration: loanDuration }
        : { duration: loanDuration };
      await regenerateLoanSchedule(loanId, options);
      
      toast.loading('Reapplying payments...', { id: 'edit-loan' });
      
      // Reapply all non-deleted payments
      const activeTransactions = transactions.filter(t => !t.is_deleted && t.type === 'Repayment');
      const newScheduleRows = await api.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number');
      
      let totalPrincipalPaid = 0;
      let totalInterestPaid = 0;
      
      for (const tx of activeTransactions) {
        const { updates } = applyPaymentWaterfall(tx.amount, newScheduleRows, 0, 'credit');
        
        for (const update of updates) {
          await api.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
          totalPrincipalPaid += update.principalApplied;
          totalInterestPaid += update.interestApplied;
        }
      }
      
      // Update loan payment totals
      await api.entities.Loan.update(loanId, {
        principal_paid: totalPrincipalPaid,
        interest_paid: totalInterestPaid
      });
    },
    onSuccess: async () => {
      setProcessingMessage('Refreshing data...');
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      setIsProcessing(false);
      toast.success('Loan updated successfully', { id: 'edit-loan' });
      setIsEditOpen(false);
    },
    onError: () => {
      setIsProcessing(false);
      toast.error('Failed to update loan', { id: 'edit-loan' });
    }
  });

  const deleteLoanMutation = useMutation({
    mutationFn: async (reason) => {
      await api.entities.Loan.update(loanId, {
        is_deleted: true,
        deleted_by: user?.email || 'unknown',
        deleted_date: new Date().toISOString(),
        deleted_reason: reason
      });
      // Log loan deletion to audit trail
      await logLoanEvent(AuditAction.LOAN_DELETE, loan, {
        reason,
        deleted_by: user?.email || 'unknown',
        principal_amount: loan.principal_amount,
        borrower_name: loan.borrower_name,
        status_at_deletion: loan.status
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

      // Mark transaction as deleted (audit trail)
      await api.entities.Transaction.update(transactionId, {
        is_deleted: true,
        deleted_by: user?.email || 'unknown',
        deleted_date: new Date().toISOString(),
        deleted_reason: reason
      });

      // Log transaction deletion to audit trail
      await logTransactionEvent(AuditAction.TRANSACTION_DELETE, transaction, loan, {
        reason,
        deleted_by: user?.email || 'unknown',
        amount: transaction.amount,
        principal_applied: transaction.principal_applied,
        interest_applied: transaction.interest_applied
      });
      
      // Reverse the transaction effects
      const newPrincipalPaid = (loan.principal_paid || 0) - (transaction.principal_applied || 0);
      const newInterestPaid = (loan.interest_paid || 0) - (transaction.interest_applied || 0);
      
      await api.entities.Loan.update(loanId, {
        principal_paid: Math.max(0, newPrincipalPaid),
        interest_paid: Math.max(0, newInterestPaid),
        status: 'Live' // Reopen if was closed
      });
      
      // Reverse schedule updates - recalculate from all non-deleted transactions
      const allSchedule = await api.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number');
      
      // Reset all schedule rows
      for (const row of allSchedule) {
        await api.entities.RepaymentSchedule.update(row.id, {
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
          await api.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      toast.success('Transaction deleted', { id: 'delete-transaction' });
    },
    onError: () => {
      toast.error('Failed to delete transaction', { id: 'delete-transaction' });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status) => {
      toast.loading('Updating loan status...', { id: 'update-status' });
      return api.entities.Loan.update(loanId, { status });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      toast.success('Loan status updated', { id: 'update-status' });
    },
    onError: () => {
      toast.error('Failed to update status', { id: 'update-status' });
    }
  });

  const toggleAutoExtendMutation = useMutation({
    mutationFn: () => {
      toast.loading('Updating auto-extend...', { id: 'auto-extend' });
      return api.entities.Loan.update(loanId, { auto_extend: !loan.auto_extend });
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['loan', loanId] });
      toast.success(`Auto-extend ${loan.auto_extend ? 'disabled' : 'enabled'}`, { id: 'auto-extend' });
    },
    onError: () => {
      toast.error('Failed to update auto-extend', { id: 'auto-extend' });
    }
  });

  const recalculateLoanMutation = useMutation({
    mutationFn: async (endDate) => {
      setIsProcessing(true);
      setProcessingMessage('Regenerating schedule...');
      toast.loading('Regenerating repayment schedule...', { id: 'regenerate-schedule' });

      // For closed/settled loans, find the settlement date (last principal payment)
      let effectiveEndDate = endDate;
      if (loan.status === 'Closed') {
        const principalPayments = transactions
          .filter(t => !t.is_deleted && t.type === 'Repayment' && t.principal_applied > 0)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        if (principalPayments.length > 0) {
          effectiveEndDate = principalPayments[0].date;
        }
      }

      // Use centralized schedule manager with end date for auto-extend or closed loans
      // Always pass duration for consistency between Edit Loan and Regenerate Schedule
      const options = (loan.auto_extend || loan.status === 'Closed')
        ? { endDate: effectiveEndDate, duration: loan.duration }
        : { duration: loan.duration };
      await regenerateLoanSchedule(loanId, options);

      toast.loading('Reapplying payments...', { id: 'regenerate-schedule' });

      // Reapply all non-deleted payments
      const activeTransactions = transactions.filter(t => !t.is_deleted && t.type === 'Repayment');
      const newScheduleRows = await api.entities.RepaymentSchedule.filter({ loan_id: loanId }, 'installment_number');

      let totalPrincipalPaid = 0;
      let totalInterestPaid = 0;

      for (const tx of activeTransactions) {
        const { updates } = applyPaymentWaterfall(tx.amount, newScheduleRows, 0, 'credit');

        for (const update of updates) {
          await api.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
          totalPrincipalPaid += update.principalApplied;
          totalInterestPaid += update.interestApplied;
        }
      }

      // Update loan payment totals
      await api.entities.Loan.update(loanId, {
        principal_paid: totalPrincipalPaid,
        interest_paid: totalInterestPaid
      });
    },
    onSuccess: async () => {
      setProcessingMessage('Refreshing data...');
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      setIsProcessing(false);
      toast.success('Schedule regenerated successfully', { id: 'regenerate-schedule' });
      setIsRegenerateDialogOpen(false);
    },
    onError: () => {
      setIsProcessing(false);
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
      // AI summary feature requires external LLM integration
      // TODO: Integrate with OpenAI or other LLM provider
      setAiSummary("AI summary feature is currently not available. This feature requires LLM integration to be configured.");
    } catch (error) {
      toast.error('Failed to generate AI summary');
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const paymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      setIsProcessing(true);
      setProcessingMessage('Processing payment...');
      toast.loading('Processing payment...', { id: 'payment' });

      // Check if this is a settlement payment
      const isSettlement = paymentData.notes?.toLowerCase().includes('settlement');

      let updates, principalReduction, creditAmount;

      // Check if manual split mode is enabled
      if (paymentData.manual_split) {
        // Use manual payment function with specified interest/principal amounts
        const result = applyManualPayment(
          paymentData.interest_amount,
          paymentData.principal_amount,
          schedule,
          loan.overpayment_credit || 0,
          paymentData.overpayment_option
        );
        updates = result.updates;
        principalReduction = result.principalReduction;
        creditAmount = result.creditAmount;
      } else {
        // Apply waterfall logic with overpayment handling
        const result = applyPaymentWaterfall(
          paymentData.amount,
          schedule,
          loan.overpayment_credit || 0,
          paymentData.overpayment_option
        );
        updates = result.updates;
        principalReduction = result.principalReduction;
        creditAmount = result.creditAmount;
      }

      let totalPrincipalApplied = 0;
      let totalInterestApplied = 0;

      // Update schedule rows
      for (const update of updates) {
        await api.entities.RepaymentSchedule.update(update.id, {
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
          await api.entities.RepaymentSchedule.delete(row.id);
        }
      }
      
      // Create transaction
      const createdTransaction = await api.entities.Transaction.create({
        ...paymentData,
        principal_applied: totalPrincipalApplied,
        interest_applied: totalInterestApplied
      });

      // Log payment to audit trail
      await logTransactionEvent(AuditAction.TRANSACTION_CREATE, {
        id: createdTransaction?.id || 'unknown',
        type: paymentData.type || 'Repayment',
        amount: paymentData.amount
      }, loan, {
        principal_applied: totalPrincipalApplied,
        interest_applied: totalInterestApplied,
        is_settlement: isSettlement,
        reference: paymentData.reference || null
      });
      
      // Update loan totals
      const newPrincipalPaid = (loan.principal_paid || 0) + totalPrincipalApplied;
      const newInterestPaid = (loan.interest_paid || 0) + totalInterestApplied;

      // Calculate total principal including disbursements
      const disbursementTotal = transactions
        .filter(t => !t.is_deleted && t.type === 'Disbursement')
        .reduce((sum, tx) => sum + (tx.amount || 0), 0);
      const loanTotalPrincipal = loan.principal_amount + disbursementTotal;

      const updateData = {
        principal_paid: newPrincipalPaid,
        interest_paid: newInterestPaid,
        overpayment_credit: creditAmount
      };

      // Check if loan is fully paid or settled
      if (isSettlement || (newPrincipalPaid >= loanTotalPrincipal && newInterestPaid >= loan.total_interest)) {
        updateData.status = 'Closed';
      }
      
      await api.entities.Loan.update(loanId, updateData);
      
      return { totalPrincipalApplied, totalInterestApplied, principalReduction, creditAmount };
    },
    onSuccess: async () => {
      setProcessingMessage('Refreshing data...');
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      setIsProcessing(false);
      toast.success('Payment recorded successfully', { id: 'payment' });
      setIsPaymentOpen(false);
    },
    onError: () => {
      setIsProcessing(false);
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

  // Determine product type for tab selection (needs to be before early returns)
  const isIrregularIncomeType = loan?.product_type === 'Irregular Income' || product?.product_type === 'Irregular Income';

  // Set default tab based on product type when it loads
  useEffect(() => {
    if (isIrregularIncomeType) {
      setActiveTab('journal');
    } else if (loan) {
      setActiveTab('overview');
    }
  }, [isIrregularIncomeType, loan]);

  if (loanLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="h-64 bg-white rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!loan) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="text-center py-20">
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

  // Determine product type
  const isFixedCharge = loan?.product_type === 'Fixed Charge' || product?.product_type === 'Fixed Charge';
  const isIrregularIncome = loan?.product_type === 'Irregular Income' || product?.product_type === 'Irregular Income';
  const isSpecialType = isFixedCharge || isIrregularIncome;

  // Calculate totals from actual transactions
  const actualPrincipalPaid = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
  const actualInterestPaid = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  const actualFeesPaid = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .reduce((sum, tx) => sum + (tx.fees_applied || 0), 0);

  // Calculate total disbursements (further advances)
  const totalDisbursements = transactions
    .filter(t => !t.is_deleted && t.type === 'Disbursement')
    .reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // Total principal = initial amount + all disbursements
  const totalPrincipal = loan.principal_amount + totalDisbursements;

  // Calculate totals from repayment schedule
  const schedulePrincipalPaid = schedule.reduce((sum, row) => sum + (row.principal_paid || 0), 0);
  const scheduleInterestPaid = schedule.reduce((sum, row) => sum + (row.interest_paid || 0), 0);
  const totalPaidFromSchedule = actualPrincipalPaid + actualInterestPaid;

  const principalRemaining = totalPrincipal - actualPrincipalPaid;
  const interestRemaining = loan.total_interest - actualInterestPaid;
  const totalOutstanding = principalRemaining + interestRemaining;
  const progressPercent = (actualPrincipalPaid / totalPrincipal) * 100;

  // Calculate live interest using actual paid from transactions
  const accruedInterestToday = calculateAccruedInterest(loan);
  const liveInterestOutstanding = accruedInterestToday - actualInterestPaid;
  const isLoanActive = loan.status === 'Live' || loan.status === 'Active';

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 relative">
        {/* Processing Overlay */}
        {isProcessing && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-2xl p-6 flex flex-col items-center gap-4 min-w-[200px]">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              <p className="text-sm font-medium text-slate-700">{processingMessage}</p>
            </div>
          </div>
        )}

        <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-2 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate(-1)}
                  className="text-slate-300 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h1 className="text-base font-bold">
                  {loan.loan_number ? `#${loan.loan_number}` : `Loan ${loan.id.slice(0, 8)}`}
                  {loan.description && <span className="font-normal text-slate-300"> - {loan.description}</span>}
                  <span className="font-normal text-slate-400">, </span>
                  <span className="font-normal">{loan.borrower_name}</span>
                  <span className="font-normal text-slate-400">, </span>
                  <span className="font-normal text-slate-300">{loan.product_name}</span>
                </h1>
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
                    <DropdownMenuItem onClick={() => setIsImportRestructureOpen(true)}>
                      <Download className="w-4 h-4 mr-2 rotate-180" />
                      Import Restructure Transactions
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
          <CardContent className="px-4 py-4">
            <div className="flex flex-col lg:flex-row lg:items-stretch lg:gap-4">
              {/* Left: Loan Details */}
              <div className="flex-1 flex flex-wrap items-center gap-x-6 gap-y-3">
                {/* Fixed Charge Facility */}
                {isFixedCharge && (
                  <>
                    <div>
                      <span className="text-slate-500 text-xs">Monthly Charge</span>
                      <p className="font-bold text-lg text-purple-700">{formatCurrency(loan.monthly_charge || 0)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Duration</span>
                      <p className="font-bold text-lg">{loan.duration} months</p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Start Date</span>
                      <p className="font-bold text-lg">{format(new Date(loan.start_date), 'dd/MM/yy')}</p>
                    </div>
                    {loan.arrangement_fee > 0 && (
                      <div>
                        <span className="text-slate-500 text-xs">Setup Fee</span>
                        <p className="font-bold text-lg text-amber-600">{formatCurrency(loan.arrangement_fee)}</p>
                      </div>
                    )}
                    {loan.exit_fee > 0 && (
                      <div>
                        <span className="text-slate-500 text-xs">Exit Fee</span>
                        <p className="font-bold text-lg text-amber-600">{formatCurrency(loan.exit_fee)}</p>
                      </div>
                    )}
                  </>
                )}

                {/* Irregular Income */}
                {isIrregularIncome && (
                  <>
                    <div>
                      <span className="text-slate-500 text-xs">Principal Advanced</span>
                      <p className="font-bold text-lg">{formatCurrency(totalPrincipal)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Start Date</span>
                      <p className="font-bold text-lg">{format(new Date(loan.start_date), 'dd/MM/yy')}</p>
                    </div>
                    {loan.arrangement_fee > 0 && (
                      <div>
                        <span className="text-slate-500 text-xs">Arr. Fee</span>
                        <p className="font-bold text-lg text-red-600">{formatCurrency(loan.arrangement_fee)}</p>
                      </div>
                    )}
                  </>
                )}

                {/* Standard Loan */}
                {!isSpecialType && (
                  <>
                    <div>
                      <span className="text-slate-500 text-xs">Principal</span>
                      <p className="font-bold text-lg">{formatCurrency(totalPrincipal)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Rate{loan.override_interest_rate && ' (Custom)'}</span>
                      <p className="font-bold text-lg">
                        {loan.override_interest_rate && loan.overridden_rate != null
                          ? loan.overridden_rate
                          : loan.interest_rate}% {loan.interest_type}
                        {loan.has_penalty_rate && loan.penalty_rate && (
                          <span className="text-amber-600 text-sm ml-1" title={`Penalty rate ${loan.penalty_rate}% from ${format(new Date(loan.penalty_rate_from), 'dd/MM/yy')}`}>
                            → {loan.penalty_rate}%
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Duration</span>
                      <p className="font-bold text-lg">{loan.duration} {loan.period === 'Monthly' ? 'mo' : 'wk'}{loan.auto_extend && ' (ext)'}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Start Date</span>
                      <p className="font-bold text-lg">{format(new Date(loan.start_date), 'dd/MM/yy')}</p>
                    </div>
                    {loan.net_disbursed && (
                      <div>
                        <span className="text-slate-500 text-xs">Net Disbursed</span>
                        <p className="font-bold text-lg text-emerald-600">{formatCurrency(loan.net_disbursed)}</p>
                      </div>
                    )}
                    {product && (
                      <div className="w-full lg:w-auto text-xs text-slate-500 pt-1">
                        {product.interest_calculation_method === 'daily' ? 'Daily calc' : 'Monthly fixed'} • {product.interest_alignment === 'period_based' ? 'From start' : '1st of month'}
                        {product.interest_paid_in_advance && ' • Paid in advance'}
                        {loan.arrangement_fee > 0 && ` • Arr: ${formatCurrency(loan.arrangement_fee)}`}
                        {loan.exit_fee > 0 && ` • Exit: ${formatCurrency(loan.exit_fee)}`}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right: Financial Summary Boxes */}
              <div className="flex gap-2 mt-4 lg:mt-0 pt-4 lg:pt-0 border-t lg:border-t-0 lg:border-l border-slate-200 lg:pl-4">
                {/* Fixed Charge Summary */}
                {isFixedCharge && (
                  <>
                    <div className="flex-1 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 min-w-[120px]">
                      <p className="text-xs text-purple-600 font-medium">Charges Paid</p>
                      <p className="text-xl font-bold text-purple-900">{formatCurrency(transactions.filter(t => !t.is_deleted && t.type === 'Repayment').reduce((sum, t) => sum + t.amount, 0))}</p>
                      <p className="text-xs text-slate-500">of {formatCurrency((loan.monthly_charge || 0) * (loan.duration || 0))}</p>
                    </div>
                    <div className="flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 min-w-[120px]">
                      <p className="text-xs text-amber-600 font-medium">Outstanding</p>
                      <p className="text-xl font-bold text-amber-900">{formatCurrency(Math.max(0, ((loan.monthly_charge || 0) * (loan.duration || 0)) - transactions.filter(t => !t.is_deleted && t.type === 'Repayment').reduce((sum, t) => sum + t.amount, 0)))}</p>
                      <p className="text-xs text-slate-500">{schedule.filter(s => s.status === 'Pending').length} remaining</p>
                    </div>
                  </>
                )}

                {/* Irregular Income Summary */}
                {isIrregularIncome && (
                  <>
                    <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 min-w-[120px]">
                      <p className="text-xs text-blue-600 font-medium">Outstanding</p>
                      <p className="text-xl font-bold text-blue-900">{formatCurrency(principalRemaining)}</p>
                      <p className="text-xs text-slate-500">principal due</p>
                    </div>
                    <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 min-w-[120px]">
                      <p className="text-xs text-emerald-600 font-medium">Repaid</p>
                      <p className="text-xl font-bold text-emerald-900">{formatCurrency(actualPrincipalPaid)}</p>
                      <p className="text-xs text-slate-500">{transactions.filter(t => !t.is_deleted && t.type === 'Repayment').length} payments</p>
                    </div>
                  </>
                )}

                {/* Standard Loan Summary */}
                {!isSpecialType && (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 min-w-[110px]">
                      <p className="text-xs text-blue-600 font-medium">Principal O/S</p>
                      <p className="text-xl font-bold text-blue-900">{formatCurrency(principalRemaining)}</p>
                    </div>
                    <div className={`border rounded-lg px-3 py-2 min-w-[110px] ${interestRemaining < 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                      <p className={`text-xs font-medium ${interestRemaining < 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {interestRemaining < 0 ? 'Int Overpaid' : 'Interest O/S'}
                      </p>
                      <p className={`text-xl font-bold ${interestRemaining < 0 ? 'text-emerald-900' : 'text-amber-900'}`}>{formatCurrency(Math.abs(interestRemaining))}</p>
                    </div>
                    {isLoanActive && (() => {
                      const arrangementFeePaidInAdvance = loan.net_disbursed && loan.net_disbursed < loan.principal_amount;
                      const outstandingArrangementFee = arrangementFeePaidInAdvance ? 0 : (loan.arrangement_fee || 0);
                      const outstandingFees = outstandingArrangementFee + (loan.exit_fee || 0);
                      const settlementTotal = principalRemaining + Math.max(0, liveInterestOutstanding) + outstandingFees;
                      return (
                        <div className="bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 min-w-[120px]">
                          <p className="text-xs text-slate-600 font-medium">Settlement</p>
                          <p className="text-xl font-bold text-slate-900">{formatCurrency(settlementTotal)}</p>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for different views */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            {!isIrregularIncome && (
              <TabsTrigger value="overview">
                {isFixedCharge ? 'Schedule' : 'Overview'}
              </TabsTrigger>
            )}
            {isIrregularIncome && (
              <TabsTrigger value="journal">
                <FileText className="w-4 h-4 mr-1" />
                Journal
                <Badge variant="secondary" className="ml-2">{transactions.filter(t => !t.is_deleted).length + 1}</Badge>
              </TabsTrigger>
            )}
            <TabsTrigger value="repayments">
              {isFixedCharge ? 'Payments' : isIrregularIncome ? 'Income Received' : 'Repayments'}
              <Badge variant="secondary" className="ml-2">{transactions.filter(t => !t.is_deleted && t.type === 'Repayment').length}</Badge>
            </TabsTrigger>
            {!isFixedCharge && (
              <TabsTrigger value="disbursements">
                Disbursements
                <Badge variant="secondary" className="ml-2">{transactions.filter(t => !t.is_deleted && t.type === 'Disbursement').length + 1}</Badge>
              </TabsTrigger>
            )}
            <TabsTrigger value="security">
              <Shield className="w-4 h-4 mr-1" />
              Security
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

          {!isIrregularIncome && (
            <TabsContent value="overview" className="space-y-4">
              {/* Combined Repayment View */}
              <RepaymentScheduleTable schedule={schedule} isLoading={scheduleLoading} transactions={transactions} loan={loan} />
            </TabsContent>
          )}

          {isIrregularIncome && (
            <TabsContent value="journal">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-blue-600" />
                      Transaction Journal
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {(() => {
                    // Build all journal entries: initial disbursement + all transactions
                    const journalEntries = [];

                    // Add initial disbursement
                    journalEntries.push({
                      id: 'initial',
                      date: new Date(loan.start_date),
                      type: 'Disbursement',
                      description: 'Initial Advance',
                      debit: loan.principal_amount,
                      credit: 0,
                      reference: 'OPEN',
                      notes: 'Loan originated'
                    });

                    // Add all non-deleted transactions
                    transactions.filter(t => !t.is_deleted).forEach(t => {
                      if (t.type === 'Disbursement') {
                        journalEntries.push({
                          id: t.id,
                          date: new Date(t.date),
                          type: 'Disbursement',
                          description: 'Additional Advance',
                          debit: t.amount,
                          credit: 0,
                          reference: t.reference || '',
                          notes: t.notes || ''
                        });
                      } else if (t.type === 'Repayment') {
                        journalEntries.push({
                          id: t.id,
                          date: new Date(t.date),
                          type: 'Repayment',
                          description: 'Income Received',
                          debit: 0,
                          credit: t.amount,
                          reference: t.reference || '',
                          notes: t.notes || '',
                          principal_applied: t.principal_applied || 0,
                          interest_applied: t.interest_applied || 0
                        });
                      }
                    });

                    // Sort by date (oldest first for journal view)
                    journalEntries.sort((a, b) => a.date - b.date);

                    // Calculate running balance
                    let runningBalance = 0;
                    journalEntries.forEach(entry => {
                      runningBalance += entry.debit - entry.credit;
                      entry.balance = runningBalance;
                    });

                    const totalDebits = journalEntries.reduce((sum, e) => sum + e.debit, 0);
                    const totalCredits = journalEntries.reduce((sum, e) => sum + e.credit, 0);

                    return (
                      <>
                        {/* Summary */}
                        <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-slate-50 rounded-lg">
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Total Advanced</p>
                            <p className="text-xl font-bold text-red-600">{formatCurrency(totalDebits)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Total Received</p>
                            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalCredits)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Balance Outstanding</p>
                            <p className="text-xl font-bold text-slate-900">{formatCurrency(runningBalance)}</p>
                          </div>
                        </div>

                        {/* Journal Table */}
                        <div className="overflow-x-auto border rounded-lg">
                          <table className="w-full">
                            <thead className="bg-slate-100 border-b border-slate-200">
                              <tr>
                                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">Date</th>
                                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">Description</th>
                                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">Reference</th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-red-700">Debit (Out)</th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-emerald-700">Credit (In)</th>
                                <th className="text-right py-2 px-3 text-xs font-semibold text-slate-700">Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {journalEntries.map((entry, idx) => (
                                <tr key={entry.id} className={`hover:bg-slate-50 ${entry.type === 'Disbursement' ? 'bg-red-50/30' : 'bg-emerald-50/30'}`}>
                                  <td className="py-2 px-3 text-sm">{format(entry.date, 'dd/MM/yy')}</td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-2">
                                      {entry.type === 'Disbursement' ? (
                                        <Coins className="w-4 h-4 text-red-500" />
                                      ) : (
                                        <Banknote className="w-4 h-4 text-emerald-500" />
                                      )}
                                      <div>
                                        <p className="text-sm font-medium">{entry.description}</p>
                                        {entry.notes && <p className="text-xs text-slate-500">{entry.notes}</p>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-sm text-slate-600 font-mono">{entry.reference || '—'}</td>
                                  <td className="py-2 px-3 text-sm text-right font-medium text-red-600">
                                    {entry.debit > 0 ? formatCurrency(entry.debit) : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-sm text-right font-medium text-emerald-600">
                                    {entry.credit > 0 ? formatCurrency(entry.credit) : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-sm text-right font-bold text-slate-900">
                                    {formatCurrency(entry.balance)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                              <tr>
                                <td colSpan="3" className="py-2 px-3 text-sm font-bold text-slate-700">Totals</td>
                                <td className="py-2 px-3 text-sm text-right font-bold text-red-700">{formatCurrency(totalDebits)}</td>
                                <td className="py-2 px-3 text-sm text-right font-bold text-emerald-700">{formatCurrency(totalCredits)}</td>
                                <td className="py-2 px-3 text-sm text-right font-bold text-slate-900">{formatCurrency(runningBalance)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                        {journalEntries.length === 1 && (
                          <div className="text-center py-8 text-slate-500 mt-4">
                            <Banknote className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                            <p>No income received yet</p>
                            <p className="text-sm mt-1">Record payments as they come in to track progress</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </TabsContent>
          )}

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
                  const totalFees = repayments.reduce((sum, t) => sum + (t.fees_applied || 0), 0);

                  return (
                    <>
                      <div className={`grid ${totalFees > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-4 mb-6 p-4 bg-slate-50 rounded-lg`}>
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
                        {totalFees > 0 && (
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Fees Repaid</p>
                            <p className="text-xl font-bold text-purple-600">{formatCurrency(totalFees)}</p>
                          </div>
                        )}
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
                                {totalFees > 0 && (
                                  <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Fees</th>
                                )}
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
                                  {totalFees > 0 && (
                                    <td className="py-3 px-4 text-sm text-purple-600 text-right">{formatCurrency(tx.fees_applied || 0)}</td>
                                  )}
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

          <TabsContent value="disbursements">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Capital Movements</CardTitle>
                  <Select
                    value={disbursementSort}
                    onValueChange={setDisbursementSort}
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
                  // Build disbursement entries: initial disbursement + all capital transactions
                  const capitalTransactions = transactions
                    .filter(t => !t.is_deleted && (t.principal_applied > 0 || t.type === 'Disbursement'))
                    .map(t => ({
                      id: t.id,
                      date: new Date(t.date),
                      type: t.type === 'Disbursement' ? 'credit' : 'debit',
                      description: t.type === 'Disbursement' ? 'Additional Drawdown' : 'Capital Repayment',
                      amount: t.type === 'Disbursement' ? t.amount : t.principal_applied,
                      notes: t.notes || ''
                    }));

                  // Add initial disbursement
                  const allEntries = [
                    {
                      id: 'initial',
                      date: new Date(loan.start_date),
                      type: 'credit',
                      description: 'Initial Disbursement',
                      amount: loan.principal_amount,
                      notes: 'Loan originated'
                    },
                    ...capitalTransactions
                  ];

                  // Sort based on selection
                  const sortedEntries = [...allEntries].sort((a, b) => {
                    switch (disbursementSort) {
                      case 'date-asc': return a.date - b.date;
                      case 'date-desc': return b.date - a.date;
                      case 'amount-asc': return a.amount - b.amount;
                      case 'amount-desc': return b.amount - a.amount;
                      default: return b.date - a.date;
                    }
                  });

                  // Calculate running balance (always in date order for balance)
                  const dateOrderedEntries = [...allEntries].sort((a, b) => a.date - b.date);
                  let runningBalance = 0;
                  const balanceMap = {};
                  dateOrderedEntries.forEach(entry => {
                    if (entry.type === 'credit') {
                      runningBalance += entry.amount;
                    } else {
                      runningBalance -= entry.amount;
                    }
                    balanceMap[entry.id] = runningBalance;
                  });

                  const totalCredits = allEntries.filter(e => e.type === 'credit').reduce((sum, e) => sum + e.amount, 0);
                  const totalDebits = allEntries.filter(e => e.type === 'debit').reduce((sum, e) => sum + e.amount, 0);
                  const netBalance = totalCredits - totalDebits;

                  return (
                    <>
                      <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Total Credits (Disbursed)</p>
                          <p className="text-sm font-bold text-emerald-600">{formatCurrency(totalCredits)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Total Debits (Repaid)</p>
                          <p className="text-sm font-bold text-red-600">{formatCurrency(totalDebits)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Principal Outstanding</p>
                          <p className="text-sm font-bold text-slate-900">{formatCurrency(netBalance)}</p>
                        </div>
                      </div>

                      {sortedEntries.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                          <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                          <p>No capital movements yet</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="text-left py-1 px-2 text-xs font-semibold text-slate-700">Date</th>
                                <th className="text-left py-1 px-2 text-xs font-semibold text-slate-700">Type</th>
                                <th className="text-left py-1 px-2 text-xs font-semibold text-slate-700">Description</th>
                                <th className="text-right py-1 px-2 text-xs font-semibold text-emerald-700">Credit</th>
                                <th className="text-right py-1 px-2 text-xs font-semibold text-red-700">Debit</th>
                                <th className="text-right py-1 px-2 text-xs font-semibold text-slate-700">Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {sortedEntries.map((entry) => (
                                <tr key={entry.id} className="hover:bg-slate-50">
                                  <td className="py-1 px-2 text-xs">{format(entry.date, 'dd/MM/yy')}</td>
                                  <td className="py-1 px-2">
                                    <Badge variant={entry.type === 'credit' ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">
                                      {entry.type === 'credit' ? 'Credit' : 'Debit'}
                                    </Badge>
                                  </td>
                                  <td className="py-1 px-2 text-xs">
                                    {entry.description}
                                    {entry.notes && <span className="text-slate-400 ml-1 text-[10px]">({entry.notes})</span>}
                                  </td>
                                  <td className="py-1 px-2 text-xs text-emerald-600 text-right font-medium">
                                    {entry.type === 'credit' ? formatCurrency(entry.amount) : '-'}
                                  </td>
                                  <td className="py-1 px-2 text-xs text-red-600 text-right font-medium">
                                    {entry.type === 'debit' ? formatCurrency(entry.amount) : '-'}
                                  </td>
                                  <td className="py-1 px-2 text-xs text-slate-700 text-right font-semibold">
                                    {formatCurrency(balanceMap[entry.id])}
                                  </td>
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

          <TabsContent value="security">
            <SecurityTab loan={loan} />
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
          outstandingInterest={Math.max(0, interestRemaining)}
          outstandingPrincipal={Math.max(0, principalRemaining)}
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
          borrower={borrower}
          transactions={transactions}
          onSubmit={(data) => {
            paymentMutation.mutate(data);
            setIsSettleOpen(false);
          }}
          isLoading={paymentMutation.isPending}
        />

        {/* Import Restructure Transactions Modal */}
        <ImportRestructureModal
          isOpen={isImportRestructureOpen}
          onClose={() => setIsImportRestructureOpen(false)}
          loan={loan}
          onImportComplete={() => {
            queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] });
            queryClient.refetchQueries({ queryKey: ['loan', loanId] });
          }}
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

        {/* Delete Loan Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) {
            setDeleteReason('');
            setDeleteConfirmation('');
            setDeleteAuthorized(false);
          }
        }}>
          <AlertDialogContent className="max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                Delete Loan - Requires Authorization
              </AlertDialogTitle>
              <AlertDialogDescription className="text-left">
                This action will mark the loan as deleted. The record is preserved for audit purposes but will no longer appear in active views.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4 py-2">
              {/* Warning about payments */}
              {transactions.filter(t => !t.is_deleted && t.type === 'Repayment').length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-800">This loan has received payments</p>
                      <p className="text-amber-700 mt-1">
                        {transactions.filter(t => !t.is_deleted && t.type === 'Repayment').length} repayment(s) totaling {formatCurrency(transactions.filter(t => !t.is_deleted && t.type === 'Repayment').reduce((sum, t) => sum + t.amount, 0))} have been recorded against this loan.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Loan Summary */}
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <p className="font-medium text-slate-700 mb-2">Loan Details</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Loan Number:</span>
                    <span className="ml-1 font-mono font-semibold">{loan.loan_number || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Borrower:</span>
                    <span className="ml-1 font-medium">{loan.borrower_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Principal:</span>
                    <span className="ml-1 font-mono">{formatCurrency(totalPrincipal)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Status:</span>
                    <span className="ml-1">{loan.status}</span>
                  </div>
                </div>
              </div>

              {/* Reason for deletion */}
              <div className="space-y-2">
                <Label htmlFor="delete-reason" className="text-sm font-medium">
                  Reason for Deletion <span className="text-red-500">*</span>
                </Label>
                <textarea
                  id="delete-reason"
                  className="w-full min-h-[80px] px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Provide a detailed reason for deleting this loan (e.g., duplicate entry, data error, customer request)..."
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                />
              </div>

              {/* Confirmation input */}
              <div className="space-y-2">
                <Label htmlFor="delete-confirm" className="text-sm font-medium">
                  Type <span className="font-mono bg-slate-100 px-1 rounded">{loan.loan_number || loan.id.slice(0, 8)}</span> to confirm <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="delete-confirm"
                  className="font-mono"
                  placeholder={loan.loan_number || loan.id.slice(0, 8)}
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                />
              </div>

              {/* Authorization checkbox */}
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <input
                  type="checkbox"
                  id="delete-authorized"
                  checked={deleteAuthorized}
                  onChange={(e) => setDeleteAuthorized(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <label htmlFor="delete-authorized" className="text-sm text-red-800">
                  I confirm I am authorized to delete this loan record and understand this action will be logged for audit purposes.
                </label>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  deleteLoanMutation.mutate(deleteReason);
                  setIsDeleteDialogOpen(false);
                  setDeleteReason('');
                  setDeleteConfirmation('');
                  setDeleteAuthorized(false);
                }}
                disabled={
                  !deleteReason.trim() ||
                  deleteConfirmation !== (loan.loan_number || loan.id.slice(0, 8)) ||
                  !deleteAuthorized
                }
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Loan
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
        </div>
        );
        }