import { useState } from 'react';
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  MoreHorizontal,
  Repeat,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  Zap,
  Coins,
  Link2,
  Receipt,
  ArrowRight,
  Landmark,
  Layers,
  ShieldCheck
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import EditLoanPanel from '@/components/loan/EditLoanModal';
import SettleLoanModal from '@/components/loan/SettleLoanModal';
import { formatCurrency, applyPaymentWaterfall, applyManualPayment, calculateLiveInterestOutstanding, calculateAccruedInterest, calculateAccruedInterestWithTransactions, exportScheduleCalculationData, calculateLoanInterestBalance, buildCapitalEvents, calculateInterestFromLedger, queueBalanceCacheUpdate } from '@/components/loan/LoanCalculator';
import { regenerateLoanSchedule, maybeRegenerateScheduleAfterCapitalChange } from '@/components/loan/LoanScheduleManager';
import { generateLoanStatementPDF } from '@/components/loan/LoanPDFGenerator';
import SecurityTab from '@/components/loan/SecurityTab';
import { getScheduler } from '@/lib/schedule';
import ReceiptEntryPanel from '@/components/receipts/ReceiptEntryPanel';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [disbursementSort, setDisbursementSort] = useState('date-desc');
  const [activeTab, setActiveTab] = useState('schedule');
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
  const [deleteTransactionDialogOpen, setDeleteTransactionDialogOpen] = useState(false);
  const [deleteTransactionTarget, setDeleteTransactionTarget] = useState(null);
  const [deleteTransactionReason, setDeleteTransactionReason] = useState('');
  const [selectedDisbursements, setSelectedDisbursements] = useState(new Set());
  const [deleteDisbursementsDialogOpen, setDeleteDisbursementsDialogOpen] = useState(false);
  const [isDeletingDisbursements, setIsDeletingDisbursements] = useState(false);
  const [editReceiptDialogOpen, setEditReceiptDialogOpen] = useState(false);
  const [editReceiptTarget, setEditReceiptTarget] = useState(null);
  const [editReceiptValues, setEditReceiptValues] = useState({ principal: 0, interest: 0, fees: 0, amount: 0, date: '', reference: '' });
  const [isSavingReceipt, setIsSavingReceipt] = useState(false);
  const [editDisbursementDialogOpen, setEditDisbursementDialogOpen] = useState(false);
  const [editDisbursementTarget, setEditDisbursementTarget] = useState(null);
  const [editDisbursementValues, setEditDisbursementValues] = useState({
    date: '',
    gross_amount: '',
    deducted_fee: '',
    deducted_interest: '',
    notes: ''
  });
  const [isSavingDisbursement, setIsSavingDisbursement] = useState(false);
  const [convertingExpense, setConvertingExpense] = useState(null);
  const [isConvertingExpense, setIsConvertingExpense] = useState(false);
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

  // Fetch reconciliation entries to show which transactions are matched to bank statements
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['loan-reconciliation-entries', loanId],
    queryFn: () => api.entities.ReconciliationEntry.list(),
    enabled: !!loanId
  });

  // Fetch bank statements to show details about matched entries
  const { data: bankStatements = [] } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api.entities.BankStatement.list(),
    enabled: reconciliationEntries.length > 0
  });

  // Build a map of transaction ID -> array of bank statement details for quick lookup
  // Uses arrays to support transactions matched to multiple bank entries
  const reconciliationMap = new Map();
  reconciliationEntries
    .filter(entry => entry.loan_transaction_id)
    .forEach(entry => {
      const bankStatement = bankStatements.find(bs => bs.id === entry.bank_statement_id);
      const existing = reconciliationMap.get(entry.loan_transaction_id) || [];
      existing.push({ entry, bankStatement });
      reconciliationMap.set(entry.loan_transaction_id, existing);
    });

  // Keep the Set for simple boolean checks
  const reconciledTransactionIds = new Set(reconciliationMap.keys());

  // Fetch accepted orphans for loan transactions
  const { data: acceptedOrphans = [] } = useQuery({
    queryKey: ['accepted-orphans-loan-transactions'],
    queryFn: () => api.entities.AcceptedOrphan.filter({ entity_type: 'loan_transaction' }),
    enabled: !!loanId
  });

  // Build a map of transaction ID -> accepted orphan record
  const acceptedOrphanMap = new Map();
  acceptedOrphans.forEach(ao => acceptedOrphanMap.set(ao.entity_id, ao));

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

      // Extract edit reason before processing (don't save to database)
      const editReason = updatedData._editReason;
      delete updatedData._editReason;

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

      // Log loan update to audit trail with edit reason
      await logLoanEvent(AuditAction.LOAN_UPDATE, loan, {
        ...updatedData,
        edit_reason: editReason
      }, previousValues);

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

      // Update initial disbursement transaction if principal or arrangement fee changed
      const newPrincipal = updatedData.principal_amount ?? loan.principal_amount;
      const newArrangementFee = updatedData.arrangement_fee ?? loan.arrangement_fee ?? 0;
      const newNetDisbursed = updatedData.net_disbursed ?? (newPrincipal - newArrangementFee);
      const oldNetDisbursed = loan.net_disbursed ?? (loan.principal_amount - (loan.arrangement_fee || 0));

      // Check if any disbursement-related fields changed
      const principalChanged = Math.abs(newPrincipal - loan.principal_amount) > 0.01;
      const feeChanged = Math.abs(newArrangementFee - (loan.arrangement_fee || 0)) > 0.01;

      if (principalChanged || feeChanged) {
        // Find and update the initial disbursement transaction
        const allTx = await api.entities.Transaction.filter({ loan_id: loanId });
        const disbursementTx = allTx.find(t => t.type === 'Disbursement' && !t.is_deleted);

        if (disbursementTx) {
          // Preserve existing deducted_interest if any
          const existingDeductedInterest = disbursementTx.deducted_interest || 0;
          const netAmount = newPrincipal - newArrangementFee - existingDeductedInterest;

          await api.entities.Transaction.update(disbursementTx.id, {
            gross_amount: newPrincipal,
            deducted_fee: newArrangementFee,
            deducted_interest: existingDeductedInterest,
            amount: netAmount,
            principal_applied: newPrincipal,  // Full gross amount
            fees_applied: newArrangementFee,
            interest_applied: existingDeductedInterest
          });
          console.log(`Updated disbursement: gross=${newPrincipal}, fee=${newArrangementFee}, net=${netAmount}`);
        }
      }
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

      // Handle reconciliation cleanup - unreconcile any linked bank statements
      try {
        const reconEntries = await api.entities.ReconciliationEntry.filter({
          loan_transaction_id: transactionId
        });

        for (const entry of reconEntries) {
          const bankStatementId = entry.bank_statement_id;

          // Mark bank statement as unreconciled
          await api.entities.BankStatement.update(bankStatementId, {
            is_reconciled: false,
            reconciled_at: null
          });

          // Delete ALL reconciliation entries for this bank statement
          const allEntriesForBank = await api.entities.ReconciliationEntry.filter({
            bank_statement_id: bankStatementId
          });
          for (const e of allEntriesForBank) {
            await api.entities.ReconciliationEntry.delete(e.id);
          }
        }
      } catch (err) {
        console.warn('Failed to clean up reconciliation entries:', err);
        // Continue with delete even if reconciliation cleanup fails
      }

      // Mark transaction as deleted (audit trail)
      await api.entities.Transaction.update(transactionId, {
        is_deleted: true,
        deleted_by: user?.email || 'unknown',
        deleted_date: new Date().toISOString(),
        deleted_reason: reason
      });

      // Log transaction deletion to audit trail
      await logTransactionEvent(AuditAction.TRANSACTION_DELETE, transaction, loan, {
        transaction_date: transaction.date,
        amount: transaction.amount,
        principal_applied: transaction.principal_applied,
        interest_applied: transaction.interest_applied,
        reason
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

      // If the deleted transaction affected capital, regenerate schedule
      if (transaction.type === 'Disbursement' || (transaction.principal_applied && transaction.principal_applied > 0)) {
        await maybeRegenerateScheduleAfterCapitalChange(loanId, transaction, 'delete');
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      queueBalanceCacheUpdate(loanId);
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
    onSuccess: async (_, newStatus) => {
      // Audit log: status change
      await logLoanEvent(
        AuditAction.LOAN_UPDATE,
        { id: loanId, loan_number: loan.loan_number },
        { status: newStatus },
        { status: loan.status }
      );
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
      // Audit log: auto-extend toggle
      await logLoanEvent(
        AuditAction.LOAN_UPDATE,
        { id: loanId, loan_number: loan.loan_number },
        { auto_extend: !loan.auto_extend },
        { auto_extend: loan.auto_extend }
      );
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
      // Audit log: schedule regeneration
      await logLoanEvent(
        AuditAction.LOAN_UPDATE,
        { id: loanId, loan_number: loan.loan_number },
        { action: 'schedule_regeneration' }
      );
      setProcessingMessage('Refreshing data...');
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      queueBalanceCacheUpdate(loanId);
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
    // Calculate schedule-based interest at the time of generation
    const interestCalc = calculateAccruedInterestWithTransactions(loan, transactions, new Date(), schedule, product);
    generateLoanStatementPDF(loan, schedule, transactions, product, interestCalc);
  };

  const handleExportScheduleCSV = () => {
    // Use exact same timestamp for both calculations to ensure consistency
    const asOfDate = new Date();

    // DEBUG: Log inputs to verify they're identical
    console.log('[CSV Export DEBUG] Inputs:', {
      loanNumber: loan.loan_number,
      loanId: loan.id,
      scheduleLength: schedule.length,
      transactionsLength: transactions.length,
      asOfDate: asOfDate.toISOString(),
      loanInterestRate: loan.interest_rate,
      loanPenaltyRate: loan.penalty_rate,
      loanPenaltyRateFrom: loan.penalty_rate_from,
      loanStartDate: loan.start_date,
      loanPrincipal: loan.principal_amount
    });

    // Get CSV export calculation (pass product for scheduler decision trail)
    const data = exportScheduleCalculationData(loan, schedule, transactions, asOfDate, product);

    // Get UI header calculation (for comparison) - this is what the LoanDetails header shows
    const uiCalc = calculateLoanInterestBalance(loan, schedule, transactions, asOfDate, product);

    // DEBUG: Log results
    console.log('[CSV Export DEBUG] Results:', {
      csvInterestDue: data.summary.totalInterestDue,
      uiInterestDue: uiCalc.totalInterestDue,
      difference: Math.abs(data.summary.totalInterestDue - uiCalc.totalInterestDue),
      csvInterestPaid: data.summary.totalInterestReceived,
      uiInterestPaid: uiCalc.totalInterestPaid
    });

    // Simplified CSV with clear field names
    // Key fields:
    // - Principal O/S: Principal balance at start of this period (what the interest is calculated on)
    // - Interest Due (Calculated): The recalculated interest based on actual principal and rate
    // - Interest Received: Sum of interest_applied from transactions assigned to this period
    // - Interest O/S (Running): Cumulative interest due - cumulative interest received

    const headers = [
      'Period',
      'Due Date',
      'Period Start',
      'Period End',
      'Days in Period',
      'Principal O/S (at period start)',
      'Rate % (annual)',
      'Penalty Rate?',
      'Daily Interest (£/day)',
      'Interest Due (Period)',
      'How Calculated',
      'Interest Due (Ledger)',
      'Interest Received',
      'Interest Bal (Period)',
      'Interest Bal (Ledger)',
      'Scheduler Decision Trail'
    ];

    // Build CSV rows
    const rows = data.periods.map(p => {
      // Calculate daily interest amount (principal × annual rate / 365)
      const dailyInterestAmount = p.principalAtPeriodStart * (p.rateUsed / 100) / 365;

      // Build detailed calculation description
      let howCalculated = '';
      if (p.calculationMethod === 'simple') {
        howCalculated = `Interest due at ${p.rateUsed}% pa, ${p.days}d × £${dailyInterestAmount.toFixed(2)}/day`;
      } else if (p.calculationMethod === 'segmented' && p.calculationDetails?.segments) {
        // Build segmented description like "27d × £13.70/day + 4d × £8.22/day"
        const segmentDescs = p.calculationDetails.segments.map(seg => {
          const segDailyRate = seg.principal * (p.rateUsed / 100) / 365;
          return `${seg.days}d × £${segDailyRate.toFixed(2)}/day`;
        });
        howCalculated = `Interest due at ${p.rateUsed}% pa, ${segmentDescs.join(' + ')}`;
      } else if (p.ledgerSegments && p.ledgerSegments.length > 0) {
        // Use ledger segments if available
        const segmentDescs = p.ledgerSegments.map(seg =>
          `${seg.days}d × £${(seg.dailyInterest || 0).toFixed(2)}/day`
        );
        howCalculated = `Interest due at ${p.rateUsed}% pa, ${segmentDescs.join(' + ')}`;
      } else {
        howCalculated = `${dailyInterestAmount.toFixed(2)} x ${p.days} days`;
      }

      // Escape CSV values that might contain commas or quotes
      const escapeCSV = (val) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      return [
        p.periodNumber,
        p.dueDate,
        p.periodStart,
        p.periodEnd,
        p.days,
        p.principalAtPeriodStart,
        p.rateUsed,
        p.isPenaltyRate ? 'YES' : '',
        Math.round(dailyInterestAmount * 100) / 100,
        p.interestDueThisPeriod,
        escapeCSV(howCalculated),
        p.ledgerInterestDue,
        p.interestReceivedThisPeriod,
        p.runningInterestBalance,
        p.runningLedgerInterestBalance,
        escapeCSV(p.schedulerDecisionTrail || '')
      ];
    });

    // Add summary section with comparison
    rows.push([]);
    rows.push(['=== SUMMARY ===']);
    rows.push(['Loan', data.summary.loanNumber]);
    rows.push(['Borrower', data.summary.borrower]);
    rows.push(['Calculated As Of', format(asOfDate, 'yyyy-MM-dd HH:mm:ss')]);
    rows.push([]);
    rows.push(['Original Principal', data.summary.originalPrincipal]);
    rows.push(['Standard Rate', `${data.summary.interestRate}%`]);
    if (data.summary.penaltyRate) {
      rows.push(['Penalty Rate', `${data.summary.penaltyRate}%`]);
      rows.push(['Penalty From', data.summary.penaltyRateFrom]);
    }
    rows.push(['Interest Paid In Advance?', data.summary.isInterestPaidInAdvance ? 'YES' : 'NO']);
    rows.push([]);
    rows.push(['--- CSV Export Calculation (Period-Based) ---']);
    rows.push(['Interest Due (Period)', data.summary.totalInterestDue]);
    rows.push(['Interest Received', data.summary.totalInterestReceived]);
    rows.push(['Interest O/S (Period)', data.summary.interestBalance]);
    rows.push([]);
    rows.push(['--- Ledger-Based Calculation (Same as UI Schedule Table) ---']);
    rows.push(['Interest Due (Ledger)', data.summary.totalLedgerInterestDue]);
    rows.push(['Interest Received', data.summary.totalInterestReceived]);
    rows.push(['Interest O/S (Ledger)', data.summary.ledgerInterestBalance]);
    rows.push([]);
    rows.push(['--- UI Header Calculation (calculateLoanInterestBalance) ---']);
    rows.push(['Interest Due (UI Header)', uiCalc.totalInterestDue]);
    rows.push(['Interest Paid (UI Header)', uiCalc.totalInterestPaid]);
    rows.push(['Interest O/S (UI Header)', uiCalc.interestBalance]);
    rows.push([]);
    rows.push(['--- Comparison ---']);
    const ledgerDiff = Math.abs(data.summary.ledgerInterestBalance - uiCalc.interestBalance);
    rows.push(['Ledger vs UI Header Match?', ledgerDiff < 0.01 ? 'YES' : 'NO']);
    if (ledgerDiff >= 0.01) {
      rows.push(['Ledger vs UI Header Difference', ledgerDiff.toFixed(2)]);
    }
    const diff = Math.abs(data.summary.interestBalance - uiCalc.interestBalance);
    rows.push(['Period vs UI Header Match?', diff < 0.01 ? 'YES' : 'NO']);
    if (diff >= 0.01) {
      rows.push(['Period vs UI Header Difference', diff.toFixed(2)]);
    }
    rows.push([]);
    rows.push(['Principal Balance', data.summary.finalPrincipalBalance]);
    rows.push([]);
    rows.push(['--- Input Counts ---']);
    rows.push(['Schedule Periods (Total)', schedule.length]);
    rows.push(['Schedule Periods (Processed)', data.summary.periodsProcessed]);
    rows.push(['UI Periods Processed', uiCalc.periods?.length || 'N/A']);
    rows.push(['Transactions (Total)', transactions.length]);
    rows.push(['Repayment Transactions', data.summary.totalRepaymentTransactions]);
    rows.push(['Disbursements', data.summary.totalDisbursements]);

    // Calculate total days from schedule periods vs continuous day-count
    const scheduleTotalDays = data.periods.reduce((sum, p) => sum + (p.days || 0), 0);
    const loanStartForDays = new Date(loan.start_date);
    loanStartForDays.setHours(0, 0, 0, 0);
    const asOfForDays = new Date(asOfDate);
    asOfForDays.setHours(0, 0, 0, 0);
    const continuousDays = Math.floor((asOfForDays - loanStartForDays) / (1000 * 60 * 60 * 24));

    // Find last schedule period date to show what the schedule covers
    const lastScheduleDate = data.periods.length > 0 ? data.periods[data.periods.length - 1].dueDate : 'N/A';

    rows.push([]);
    rows.push(['--- Days Analysis (Key to Understanding Discrepancy) ---']);
    rows.push(['Schedule Total Days (sum of period days)', scheduleTotalDays]);
    rows.push(['Continuous Days (start to asOfDate)', continuousDays]);
    rows.push(['Days Difference', continuousDays - scheduleTotalDays]);
    rows.push(['Schedule Covers Up To', lastScheduleDate]);
    rows.push(['asOfDate', format(asOfDate, 'yyyy-MM-dd')]);
    rows.push([]);
    rows.push(['Explanation: Schedule-based interest uses period boundaries (month-to-month).']);
    rows.push(['Settlement-style uses continuous day-count from loan start to settlement date.']);
    rows.push(['The difference in days x daily rate = difference in interest.']);

    // Per-period comparison to find discrepancy
    if (uiCalc.periods && uiCalc.periods.length > 0) {
      rows.push([]);
      rows.push(['=== PER-PERIOD COMPARISON ===']);
      rows.push(['Period', 'Due Date', 'Days', 'CSV Principal', 'UI Principal', 'CSV Interest', 'UI Interest', 'Diff', 'CSV Method', 'UI Cap Chg?']);

      const csvPeriods = data.periods || [];
      const uiPeriods = uiCalc.periods || [];

      // Create a map of UI periods by period number for lookup
      const uiPeriodMap = new Map(uiPeriods.map(p => [p.periodNumber, p]));

      let totalDifference = 0;
      csvPeriods.forEach(csvP => {
        const uiP = uiPeriodMap.get(csvP.periodNumber);
        const csvInterest = csvP.interestDueThisPeriod || 0;
        const uiInterest = uiP?.expectedInterest || 0;
        const periodDiff = Math.abs(csvInterest - uiInterest);
        totalDifference += periodDiff;

        // Show ALL periods with differences OR with capital changes (to debug)
        if (periodDiff >= 0.01 || csvP.calculationMethod === 'segmented' || uiP?.hadCapitalChanges) {
          rows.push([
            csvP.periodNumber,
            csvP.dueDate,
            csvP.days,
            csvP.principalAtPeriodStart,
            uiP?.principalAtPeriodStart || 'N/A',
            csvInterest,
            uiInterest,
            periodDiff >= 0.01 ? periodDiff.toFixed(2) : '',
            csvP.calculationMethod,
            uiP?.hadCapitalChanges ? 'YES' : 'no'
          ]);
        }
      });

      if (totalDifference < 0.01) {
        rows.push(['All periods match!']);
      } else {
        rows.push([]);
        rows.push(['Total Period Differences', '', '', '', '', '', '', totalDifference.toFixed(2)]);
      }
    }

    // Add SETTLEMENT-STYLE calculation for comparison
    // This uses simple day-count from loan start to asOfDate, splitting only at capital changes
    rows.push([]);
    rows.push(['=== SETTLEMENT-STYLE CALCULATION (Day-Count Method) ===']);
    rows.push(['This is how the Settlement Calculator computes interest - simple day count, not schedule-based']);
    rows.push([]);

    // Use shared capital events ledger functions
    const loanStartDate = new Date(loan.start_date);
    loanStartDate.setHours(0, 0, 0, 0);
    const settlementEndDate = new Date(asOfDate);
    settlementEndDate.setHours(0, 0, 0, 0);

    // Build capital events using the shared function
    const capitalEvents = buildCapitalEvents(loan, transactions);

    // Calculate interest using the shared ledger function
    const ledgerResult = calculateInterestFromLedger(loan, capitalEvents, loanStartDate, settlementEndDate);
    const settlementTotalInterest = ledgerResult.totalInterest;

    // Output the segment breakdown for CSV
    rows.push(['Period', 'Start Date', 'End Date', 'Days', 'Principal', 'Daily Rate', 'Interest', 'Event']);

    ledgerResult.segments.forEach((segment, idx) => {
      // Find if this segment ends at a capital event
      const event = capitalEvents.find(e => e.date.getTime() === segment.endDate.getTime());
      const eventDescription = event ? event.description : '';

      rows.push([
        idx + 1,
        format(segment.startDate, 'dd/MM/yyyy'),
        format(segment.endDate, 'dd/MM/yyyy'),
        segment.days,
        segment.principal.toFixed(2),
        (segment.dailyRate * 100).toFixed(6) + '%',
        segment.interest.toFixed(2),
        eventDescription
      ]);
    });

    // Sum up interest paid
    const totalInterestPaid = transactions
      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
      .reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);

    rows.push([]);
    rows.push(['Settlement Method Totals:']);
    rows.push(['Total Days', Math.floor((settlementEndDate - loanStartDate) / (1000 * 60 * 60 * 24))]);
    rows.push(['Interest Accrued (Settlement)', settlementTotalInterest.toFixed(2)]);
    rows.push(['Interest Paid', totalInterestPaid.toFixed(2)]);
    rows.push(['Interest O/S (Settlement)', (settlementTotalInterest - totalInterestPaid).toFixed(2)]);
    rows.push([]);
    rows.push(['=== COMPARISON: Schedule vs Settlement ===']);
    rows.push(['Interest Due (Schedule)', data.summary.totalInterestDue]);
    rows.push(['Interest Due (Settlement)', settlementTotalInterest.toFixed(2)]);
    rows.push(['Difference', Math.abs(data.summary.totalInterestDue - settlementTotalInterest).toFixed(2)]);
    rows.push(['Schedule includes periods up to', data.periods.length > 0 ? data.periods[data.periods.length - 1].dueDate : 'N/A']);
    rows.push(['Settlement calculates to', format(settlementEndDate, 'dd/MM/yyyy')]);

    // Calculate expected interest difference based on day difference
    const scheduleDaysTotal = data.periods.reduce((sum, p) => sum + (p.days || 0), 0);
    const settlementDaysTotal = Math.floor((settlementEndDate - new Date(loan.start_date)) / (1000 * 60 * 60 * 24));
    const dayDifference = settlementDaysTotal - scheduleDaysTotal;
    const avgDailyRate = (loan.interest_rate / 100) / 365;
    const avgPrincipal = loan.principal_amount; // simplified - actual varies
    const expectedInterestDiff = dayDifference * avgPrincipal * avgDailyRate;

    rows.push([]);
    rows.push(['--- Why The Difference? ---']);
    rows.push(['Schedule Total Days', scheduleDaysTotal]);
    rows.push(['Settlement Total Days', settlementDaysTotal]);
    rows.push(['Day Difference', dayDifference]);
    rows.push(['At avg daily rate', (avgDailyRate * 100).toFixed(6) + '% (£' + (avgPrincipal * avgDailyRate).toFixed(2) + '/day at full principal)']);
    rows.push(['Expected Interest Diff (simplified)', expectedInterestDiff.toFixed(2)]);
    rows.push(['Actual Interest Diff', Math.abs(data.summary.totalInterestDue - settlementTotalInterest).toFixed(2)]);
    rows.push([]);
    rows.push(['NOTE: Schedule calculates to the last period DUE DATE (01/01/2026 in this case).']);
    rows.push(['Settlement calculates to TODAY. The extra days after Jan 1 contribute to the difference.']);
    rows.push(['Also, monthly periods may have slightly different day counts than continuous day-counting.']);

    // Convert to CSV string
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => {
        // Escape commas and quotes in cell values
        const str = String(cell ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','))
    ].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-calc-${loan.loan_number}-${format(asOfDate, 'yyyy-MM-dd-HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('Schedule calculation exported to CSV');
  };

  const executeExpenseConversion = async (expense) => {
    if (!expense || !loan) return;

    setIsConvertingExpense(true);
    toast.loading('Converting expense to disbursement...', { id: 'convert-expense' });

    try {
      // 1. Create disbursement transaction
      await api.entities.Transaction.create({
        loan_id: loan.id,
        borrower_id: loan.borrower_id,
        date: expense.date,
        type: 'Disbursement',
        amount: expense.amount,
        principal_applied: expense.amount,
        interest_applied: 0,
        fees_applied: 0,
        notes: `Converted from expense: ${expense.type_name}`,
        reference: expense.description || ''
      });

      // 2. Delete the expense
      await api.entities.Expense.delete(expense.id);

      // 3. Regenerate loan schedule
      await regenerateLoanSchedule(loan.id);

      // 4. Log audit - use logLoanEvent(action, loan, details)
      await logLoanEvent(AuditAction.LOAN_UPDATE, loan, {
        action: 'expense_converted_to_disbursement',
        expense_id: expense.id,
        expense_type: expense.type_name,
        expense_amount: expense.amount,
        expense_date: expense.date,
        converted_by: user?.email
      });

      // 5. Refresh data - invalidate to force refetch
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['loan', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loan-transactions', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loan-expenses', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);

      // Update balance cache asynchronously
      queueBalanceCacheUpdate(loanId);

      toast.success('Expense converted to disbursement', { id: 'convert-expense' });
      setConvertingExpense(null);
    } catch (error) {
      console.error('Failed to convert expense:', error);
      toast.error('Failed to convert expense to disbursement', { id: 'convert-expense' });
    } finally {
      setIsConvertingExpense(false);
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
        .reduce((sum, tx) => sum + ((tx.gross_amount ?? tx.amount) || 0), 0);
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
    onSuccess: async (result, paymentData) => {
      setProcessingMessage('Refreshing data...');

      // If principal was applied, regenerate the schedule to update future interest amounts
      if (result.totalPrincipalApplied > 0) {
        await maybeRegenerateScheduleAfterCapitalChange(loanId, {
          type: 'Repayment',
          principal_applied: result.totalPrincipalApplied,
          date: paymentData.date
        }, 'create');
      }

      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
        queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      queueBalanceCacheUpdate(loanId);
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

  // Calculate further advances (disbursements beyond the first one, which is the initial principal)
  const allDisbursements = transactions
    .filter(t => !t.is_deleted && t.type === 'Disbursement')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const furtherAdvances = allDisbursements.slice(1); // Skip the first disbursement (initial principal)
  const totalFurtherAdvances = furtherAdvances.reduce((sum, tx) => sum + ((tx.gross_amount ?? tx.amount) || 0), 0);

  // Total principal = initial amount + further advances only (not the initial disbursement again)
  const totalPrincipal = loan.principal_amount + totalFurtherAdvances;

  // Calculate total net disbursed (actual cash paid out) from all disbursements
  // Uses tx.amount which is the net amount (after deductions)
  const totalNetDisbursed = allDisbursements.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  // Calculate totals from repayment schedule
  const schedulePrincipalPaid = schedule.reduce((sum, row) => sum + (row.principal_paid || 0), 0);
  const scheduleInterestPaid = schedule.reduce((sum, row) => sum + (row.interest_paid || 0), 0);
  const totalPaidFromSchedule = actualPrincipalPaid + actualInterestPaid;

  const principalRemaining = totalPrincipal - actualPrincipalPaid;

  // Calculate live interest using schedule-based method
  // Pass schedule and product to use schedule-based interest (handles rate changes correctly)
  const liveInterestCalc = calculateAccruedInterestWithTransactions(loan, transactions, new Date(), schedule, product);
  const interestRemaining = liveInterestCalc.interestRemaining;

  const totalOutstanding = principalRemaining + interestRemaining;
  const progressPercent = (actualPrincipalPaid / totalPrincipal) * 100;

  const liveInterestOutstanding = liveInterestCalc.interestRemaining;
  const isLoanActive = loan.status === 'Live' || loan.status === 'Active';

  // Use the schedule-based interest calculation for consistency with InterestOnlyScheduleView
  // This ensures the settlement card matches the TODAY row in the schedule view
  const settlementInterestOwed = liveInterestCalc.interestRemaining;

    return (
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 flex overflow-hidden">
        {/* Processing Overlay */}
        {isProcessing && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-white rounded-xl shadow-2xl p-6 flex flex-col items-center gap-4 min-w-[200px]">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              <p className="text-sm font-medium text-slate-700">{processingMessage}</p>
            </div>
          </div>
        )}

        {/* Main content area - shrinks when side panel is open */}
        <div className={cn(
          "flex-1 flex flex-col overflow-hidden transition-all duration-300",
          (isSettleOpen || isEditOpen) && "mr-0"
        )}>
        <div className="p-4 md:p-6 space-y-4 flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-4 py-2 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-base font-bold flex items-center gap-1.5">
                  {loan.loan_number ? `#${loan.loan_number}` : `Loan ${loan.id.slice(0, 8)}`}
                  {loan.restructured_from_loan_number && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link2 className="w-4 h-4 text-amber-400 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Restructured from loan #{loan.restructured_from_loan_number}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {loan.description && <span className="font-normal text-slate-300"> - {loan.description}</span>}
                  <span className="font-normal text-slate-400">, </span>
                  <span className="font-normal">{loan.borrower_name}</span>
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
                      variant={isSettleOpen ? "default" : "secondary"}
                      onClick={() => setIsSettleOpen(!isSettleOpen)}
                      className={cn("h-7 text-xs", isSettleOpen && "bg-slate-700 hover:bg-slate-800")}
                    >
                      Settle
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setIsReceiptDialogOpen(!isReceiptDialogOpen)}
                      className={cn("h-7 text-xs", isReceiptDialogOpen ? "bg-emerald-700 hover:bg-emerald-800" : "bg-emerald-600 hover:bg-emerald-700")}
                    >
                      <Receipt className="w-3 h-3 mr-1" />
                      Receipt
                    </Button>
                  </>
                )}
                {loan.status !== 'Closed' && (
                  <Button
                    size="sm"
                    variant={isEditOpen ? "default" : "secondary"}
                    onClick={() => setIsEditOpen(!isEditOpen)}
                    className={cn("h-7 text-xs", isEditOpen && "bg-blue-600 hover:bg-blue-700")}
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
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
                    <DropdownMenuItem onClick={handleExportScheduleCSV}>
                      <Download className="w-4 h-4 mr-2" />
                      Export Schedule CSV
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
                    {totalNetDisbursed !== totalPrincipal && (
                      <div>
                        <span className="text-slate-500 text-xs">Net Disbursed</span>
                        <p className="font-bold text-lg text-emerald-600">{formatCurrency(totalNetDisbursed)}</p>
                      </div>
                    )}
                    {product && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">
                        <p className="font-medium text-slate-700">{product.name}</p>
                        <p className="text-slate-500">
                          {product.interest_calculation_method === 'daily' ? 'Daily calc' : 'Monthly fixed'}
                          {' • '}
                          {product.interest_paid_in_advance
                            ? (product.interest_alignment === 'monthly_first' ? 'In advance (1st)' : 'In advance')
                            : 'In arrears'}
                        </p>
                        {(loan.arrangement_fee > 0 || loan.exit_fee > 0) && (
                          <p className="text-slate-400 mt-0.5">
                            {loan.arrangement_fee > 0 && `Arr: ${formatCurrency(loan.arrangement_fee)}`}
                            {loan.arrangement_fee > 0 && loan.exit_fee > 0 && ' • '}
                            {loan.exit_fee > 0 && `Exit: ${formatCurrency(loan.exit_fee)}`}
                          </p>
                        )}
                        {product.scheduler_type && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="text-slate-400 text-[10px] font-mono mt-1 cursor-help">
                                  {product.scheduler_type} → {getScheduler(product.scheduler_type)?.ViewComponent ? 'Custom' : 'Table'}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-xs">
                                <div className="text-xs">
                                  <p className="font-semibold mb-1">Scheduler: {getScheduler(product.scheduler_type)?.displayName || product.scheduler_type}</p>
                                  <p className="text-slate-400">
                                    View: {getScheduler(product.scheduler_type)?.ViewComponent ? 'Custom view component' : 'Standard Table'}
                                  </p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
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
                        {interestRemaining < 0 ? 'Int Overpaid' : `Interest O/S${product?.interest_paid_in_advance ? ' (in Advance)' : ''}`}
                      </p>
                      <p className={`text-xl font-bold ${interestRemaining < 0 ? 'text-emerald-900' : 'text-amber-900'}`}>{formatCurrency(Math.abs(interestRemaining))}</p>
                    </div>
                    {isLoanActive && (() => {
                      // Only include exit fee in settlement - arrangement fee was already deducted from disbursement
                      const outstandingFees = loan.exit_fee || 0;
                      const settlementTotal = principalRemaining + Math.max(0, settlementInterestOwed) + outstandingFees;
                      return (
                        <div className="bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 min-w-[140px]">
                          <p className="text-xs text-slate-600 font-medium">Settlement</p>
                          <p className="text-xl font-bold text-slate-900">{formatCurrency(settlementTotal)}</p>
                          <p className={`text-xs ${settlementInterestOwed <= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                            {settlementInterestOwed <= 0
                              ? `Int overpaid ${formatCurrency(Math.abs(settlementInterestOwed))}`
                              : `Inc. ${formatCurrency(settlementInterestOwed)} int`}
                          </p>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content area with unified header */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Schedule view - always rendered but may be hidden when other tabs active */}
          {activeTab === 'schedule' && (
            <RepaymentScheduleTable
              schedule={schedule}
              isLoading={scheduleLoading}
              transactions={transactions}
              loan={loan}
              product={product}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              expenses={expenses}
            />
          )}

          {/* Non-schedule tab content - render RepaymentScheduleTable header with tab content below */}
          {activeTab !== 'schedule' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
              {/* Header bar with tabs */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-50 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 bg-slate-200 rounded p-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveTab('schedule')}
                      className="gap-1 h-6 text-xs px-2"
                    >
                      <Layers className="w-3 h-3" />
                      Schedule
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveTab('schedule')}
                      className="gap-1 h-6 text-xs px-2"
                    >
                      <FileText className="w-3 h-3" />
                      Ledger
                    </Button>
                  </div>
                  {/* Separator */}
                  <div className="h-4 w-px bg-slate-300" />
                  {/* Content tabs */}
                  <div className="flex items-center gap-0.5 bg-slate-200 rounded p-0.5">
                    <Button
                      variant={activeTab === 'receipts' ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab('receipts')}
                      className="gap-1 h-6 text-xs px-2"
                    >
                      <Receipt className="w-3 h-3" />
                      Receipts
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {transactions.filter(t => !t.is_deleted && t.type === 'Repayment').length}
                      </Badge>
                    </Button>
                    {!isFixedCharge && (
                      <Button
                        variant={activeTab === 'disbursements' ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab('disbursements')}
                        className="gap-1 h-6 text-xs px-2"
                      >
                        <Banknote className="w-3 h-3" />
                        Disbursements
                        <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                          {transactions.filter(t => !t.is_deleted && t.type === 'Disbursement').length}
                        </Badge>
                      </Button>
                    )}
                    <Button
                      variant={activeTab === 'security' ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab('security')}
                      className="gap-1 h-6 text-xs px-2"
                    >
                      <Shield className="w-3 h-3" />
                      Security
                    </Button>
                    <Button
                      variant={activeTab === 'expenses' ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setActiveTab('expenses')}
                      className="gap-1 h-6 text-xs px-2"
                    >
                      <Coins className="w-3 h-3" />
                      Expenses
                      <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                        {expenses.length}
                      </Badge>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Tab content */}
              <div className="flex-1 min-h-0 overflow-y-auto">

          {activeTab === 'receipts' && (
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Receipt History</CardTitle>
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
              <CardContent className="pt-0">
                {(() => {
                  const repayments = transactions.filter(t => !t.is_deleted && t.type === 'Repayment');
                  const totalAmount = repayments.reduce((sum, t) => sum + t.amount, 0);
                  const totalPrincipal = repayments.reduce((sum, t) => sum + (t.principal_applied || 0), 0);
                  const totalInterest = repayments.reduce((sum, t) => sum + (t.interest_applied || 0), 0);
                  const totalFees = repayments.reduce((sum, t) => sum + (t.fees_applied || 0), 0);

                  return (
                    <>
                      <div className={`flex flex-wrap items-center gap-4 mb-3 px-3 py-1.5 bg-slate-50 rounded text-sm`}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500">Total:</span>
                          <span className="font-bold text-slate-900">{formatCurrency(totalAmount)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500">Principal:</span>
                          <span className="font-bold text-emerald-600">{formatCurrency(totalPrincipal)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500">Interest:</span>
                          <span className="font-bold text-amber-600">{formatCurrency(totalInterest)}</span>
                        </div>
                        {totalFees > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Fees:</span>
                            <span className="font-bold text-purple-600">{formatCurrency(totalFees)}</span>
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
                                <th className="text-left py-1.5 px-2 text-xs font-semibold text-slate-700">Date</th>
                                <th className="text-left py-1.5 px-2 text-xs font-semibold text-slate-700">Reference</th>
                                <th className="text-right py-1.5 px-2 text-xs font-semibold text-slate-700">Amount</th>
                                <th className="text-right py-1.5 px-2 text-xs font-semibold text-slate-700">Principal</th>
                                <th className="text-right py-1.5 px-2 text-xs font-semibold text-slate-700">Interest</th>
                                {totalFees > 0 && (
                                  <th className="text-right py-1.5 px-2 text-xs font-semibold text-slate-700">Fees</th>
                                )}
                                <th className="text-left py-1.5 px-2 text-xs font-semibold text-slate-700">Notes</th>
                                <th className="w-6 py-1.5 px-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Landmark className="w-3 h-3 text-slate-400" />
                                    </TooltipTrigger>
                                    <TooltipContent><p>Bank Reconciled</p></TooltipContent>
                                  </Tooltip>
                                </th>
                                <th className="w-8"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {repayments.map((tx) => (
                                <tr key={tx.id} className="hover:bg-slate-50">
                                  <td className="py-1 px-2 text-sm font-medium">{format(new Date(tx.date), 'dd/MM/yy')}</td>
                                  <td className="py-1 px-2 text-sm text-slate-600">{tx.reference || '—'}</td>
                                  <td className="py-1 px-2 text-sm font-semibold text-emerald-600 text-right">{formatCurrency(tx.amount)}</td>
                                  <td className="py-1 px-2 text-sm text-slate-600 text-right">{(tx.principal_applied || 0) > 0 ? formatCurrency(tx.principal_applied) : ''}</td>
                                  <td className="py-1 px-2 text-sm text-slate-600 text-right">{(tx.interest_applied || 0) > 0 ? formatCurrency(tx.interest_applied) : ''}</td>
                                  {totalFees > 0 && (
                                    <td className="py-1 px-2 text-sm text-purple-600 text-right">{(tx.fees_applied || 0) > 0 ? formatCurrency(tx.fees_applied) : ''}</td>
                                  )}
                                  <td className="py-1 px-2 text-sm text-slate-500 max-w-[200px] truncate" title={tx.notes || ''}>{tx.notes || '—'}</td>
                                  <td className="py-1 px-1 text-center">
                                    {reconciledTransactionIds.has(tx.id) ? (
                                      (() => {
                                        const matches = reconciliationMap.get(tx.id) || [];
                                        return (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Landmark className="w-3.5 h-3.5 text-emerald-500 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-xs">
                                              <div className="space-y-2">
                                                <p className="font-medium text-emerald-400">
                                                  Matched to {matches.length > 1 ? `${matches.length} bank entries` : 'Bank Statement'}
                                                </p>
                                                {matches.map((match, idx) => {
                                                  const bs = match?.bankStatement;
                                                  return (
                                                    <div key={idx} className={matches.length > 1 ? 'border-t border-slate-600 pt-1' : ''}>
                                                      {bs ? (
                                                        <>
                                                          <p className="text-xs"><span className="text-slate-400">Date:</span> {format(new Date(bs.statement_date), 'dd/MM/yyyy')}</p>
                                                          <p className="text-xs"><span className="text-slate-400">Amount:</span> {formatCurrency(Math.abs(bs.amount))}</p>
                                                          <p className="text-xs"><span className="text-slate-400">Source:</span> {bs.bank_source}</p>
                                                          {bs.description && <p className="text-xs text-slate-300 truncate max-w-[200px]">{bs.description}</p>}
                                                        </>
                                                      ) : (
                                                        <p className="text-xs text-slate-400">Bank statement details loading...</p>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </TooltipContent>
                                          </Tooltip>
                                        );
                                      })()
                                    ) : acceptedOrphanMap.has(tx.id) ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <ShieldCheck className="w-3.5 h-3.5 text-amber-500 cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                          <p className="font-medium text-amber-400">Accepted Orphan</p>
                                          <p className="text-xs text-slate-300 mt-1">{acceptedOrphanMap.get(tx.id).reason}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                  <td className="py-0.5 px-1">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7">
                                          <MoreHorizontal className="w-4 h-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setEditReceiptTarget(tx);
                                            setEditReceiptValues({
                                              principal: tx.principal_applied || 0,
                                              interest: tx.interest_applied || 0,
                                              fees: tx.fees_applied || 0,
                                              amount: parseFloat(tx.amount) || 0,
                                              date: tx.date?.split('T')[0] || '',
                                              reference: tx.reference || ''
                                            });
                                            setEditReceiptDialogOpen(true);
                                          }}
                                        >
                                          <Edit className="w-4 h-4 mr-2" />
                                          Edit Receipt
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-red-600"
                                          onClick={() => {
                                            setDeleteTransactionTarget(tx);
                                            setDeleteTransactionReason('');
                                            setDeleteTransactionDialogOpen(true);
                                          }}
                                        >
                                          <Trash2 className="w-4 h-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
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
          )}

          {activeTab === 'disbursements' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Disbursements</CardTitle>
                  <div className="flex items-center gap-2">
                    {selectedDisbursements.size > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteDisbursementsDialogOpen(true)}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete ({selectedDisbursements.size})
                      </Button>
                    )}
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
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  // Get all disbursement transactions sorted by date (ONLY disbursements, no repayments)
                  const disbursementTransactions = transactions
                    .filter(t => !t.is_deleted && t.type === 'Disbursement')
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                  // Build entries from disbursement transactions only
                  // First disbursement is "Initial Disbursement", rest are "Additional Drawdown"
                  const disbursementEntries = disbursementTransactions.map((t, index) => ({
                    id: t.id,
                    date: new Date(t.date),
                    description: index === 0 ? 'Initial Disbursement' : 'Additional Drawdown',
                    gross_amount: t.gross_amount ?? t.amount,  // Gross amount (or amount for legacy)
                    deducted_fee: t.deducted_fee || 0,
                    deducted_interest: t.deducted_interest || 0,
                    amount: t.amount,  // Net amount (cash paid)
                    notes: t.notes || (index === 0 ? 'Loan originated' : ''),
                    hasDeductions: (t.deducted_fee || 0) > 0 || (t.deducted_interest || 0) > 0
                  }));

                  // Sort based on selection
                  const sortedEntries = [...disbursementEntries].sort((a, b) => {
                    switch (disbursementSort) {
                      case 'date-asc': return a.date - b.date;
                      case 'date-desc': return b.date - a.date;
                      case 'amount-asc': return a.amount - b.amount;
                      case 'amount-desc': return b.amount - a.amount;
                      default: return b.date - a.date;
                    }
                  });

                  // Calculate running balance (in date order) - use GROSS for principal tracking
                  const dateOrderedEntries = [...disbursementEntries].sort((a, b) => a.date - b.date);
                  let runningBalance = 0;
                  const balanceMap = {};
                  dateOrderedEntries.forEach(entry => {
                    runningBalance += entry.gross_amount;  // Use gross for principal balance
                    balanceMap[entry.id] = runningBalance;
                  });

                  const totalGross = disbursementEntries.reduce((sum, e) => sum + e.gross_amount, 0);
                  const totalNet = disbursementEntries.reduce((sum, e) => sum + e.amount, 0);
                  const totalDeductions = totalGross - totalNet;

                  // Toggle select all
                  const allSelected = disbursementEntries.length > 0 && disbursementEntries.every(e => selectedDisbursements.has(e.id));
                  const someSelected = disbursementEntries.some(e => selectedDisbursements.has(e.id));

                  const handleSelectAll = () => {
                    if (allSelected) {
                      setSelectedDisbursements(new Set());
                    } else {
                      setSelectedDisbursements(new Set(disbursementEntries.map(e => e.id)));
                    }
                  };

                  const handleSelectOne = (id) => {
                    const newSelected = new Set(selectedDisbursements);
                    if (newSelected.has(id)) {
                      newSelected.delete(id);
                    } else {
                      newSelected.add(id);
                    }
                    setSelectedDisbursements(newSelected);
                  };

                  return (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Gross Disbursed</p>
                          <p className="text-sm font-bold text-slate-900">{formatCurrency(totalGross)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Deductions</p>
                          <p className="text-sm font-bold text-amber-600">{totalDeductions > 0 ? `-${formatCurrency(totalDeductions)}` : '-'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Net Paid Out</p>
                          <p className="text-sm font-bold text-emerald-600">{formatCurrency(totalNet)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">Count</p>
                          <p className="text-sm font-bold text-slate-900">{disbursementEntries.length}</p>
                        </div>
                      </div>

                      {sortedEntries.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                          <Banknote className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                          <p>No disbursements yet</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="w-8 py-1 px-2">
                                  <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={handleSelectAll}
                                    className={someSelected && !allSelected ? 'data-[state=checked]:bg-slate-400' : ''}
                                  />
                                </th>
                                <th className="text-left py-1 px-2 text-xs font-semibold text-slate-700">Date</th>
                                <th className="text-left py-1 px-2 text-xs font-semibold text-slate-700">Description</th>
                                <th className="text-right py-1 px-2 text-xs font-semibold text-slate-700">Gross</th>
                                <th className="text-right py-1 px-2 text-xs font-semibold text-amber-600">Deductions</th>
                                <th className="text-right py-1 px-2 text-xs font-semibold text-emerald-700">Net</th>
                                <th className="text-right py-1 px-2 text-xs font-semibold text-slate-700">Principal</th>
                                <th className="w-6 py-1 px-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Landmark className="w-3 h-3 text-slate-400" />
                                    </TooltipTrigger>
                                    <TooltipContent><p>Bank Reconciled</p></TooltipContent>
                                  </Tooltip>
                                </th>
                                <th className="w-8 py-1 px-1"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {sortedEntries.map((entry) => (
                                <tr key={entry.id} className={`hover:bg-slate-50 ${selectedDisbursements.has(entry.id) ? 'bg-blue-50' : ''}`}>
                                  <td className="py-1 px-2">
                                    <Checkbox
                                      checked={selectedDisbursements.has(entry.id)}
                                      onCheckedChange={() => handleSelectOne(entry.id)}
                                    />
                                  </td>
                                  <td className="py-1 px-2 text-xs">{format(entry.date, 'dd/MM/yy')}</td>
                                  <td className="py-1 px-2 text-xs">
                                    <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                      {entry.description}
                                    </Badge>
                                    {entry.notes && (
                                      <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[150px]" title={entry.notes}>
                                        {entry.notes}
                                      </p>
                                    )}
                                  </td>
                                  <td className="py-1 px-2 text-xs text-slate-700 text-right font-medium">
                                    {formatCurrency(entry.gross_amount)}
                                  </td>
                                  <td className="py-1 px-2 text-xs text-right">
                                    {entry.hasDeductions ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="text-amber-600 cursor-help">
                                            -{formatCurrency(entry.deducted_fee + entry.deducted_interest)}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="left">
                                          <div className="text-xs space-y-1">
                                            {entry.deducted_fee > 0 && (
                                              <p>Fee: {formatCurrency(entry.deducted_fee)}</p>
                                            )}
                                            {entry.deducted_interest > 0 && (
                                              <p>Interest: {formatCurrency(entry.deducted_interest)}</p>
                                            )}
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="text-slate-300">-</span>
                                    )}
                                  </td>
                                  <td className="py-1 px-2 text-xs text-emerald-600 text-right font-medium">
                                    {formatCurrency(entry.amount)}
                                  </td>
                                  <td className="py-1 px-2 text-xs text-slate-700 text-right font-semibold">
                                    {formatCurrency(balanceMap[entry.id])}
                                  </td>
                                  <td className="py-1 px-1 text-center">
                                    {reconciledTransactionIds.has(entry.id) ? (
                                      (() => {
                                        const matches = reconciliationMap.get(entry.id) || [];
                                        return (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Landmark className="w-3.5 h-3.5 text-emerald-500 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-xs">
                                              <div className="space-y-2">
                                                <p className="font-medium text-emerald-400">
                                                  Matched to {matches.length > 1 ? `${matches.length} bank entries` : 'Bank Statement'}
                                                </p>
                                                {matches.map((match, idx) => {
                                                  const bs = match?.bankStatement;
                                                  return (
                                                    <div key={idx} className={matches.length > 1 ? 'border-t border-slate-600 pt-1' : ''}>
                                                      {bs ? (
                                                        <>
                                                          <p className="text-xs"><span className="text-slate-400">Date:</span> {format(new Date(bs.statement_date), 'dd/MM/yyyy')}</p>
                                                          <p className="text-xs"><span className="text-slate-400">Amount:</span> {formatCurrency(Math.abs(bs.amount))}</p>
                                                          <p className="text-xs"><span className="text-slate-400">Source:</span> {bs.bank_source}</p>
                                                          {bs.description && <p className="text-xs text-slate-300 truncate max-w-[200px]">{bs.description}</p>}
                                                        </>
                                                      ) : (
                                                        <p className="text-xs text-slate-400">Bank statement details loading...</p>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </TooltipContent>
                                          </Tooltip>
                                        );
                                      })()
                                    ) : acceptedOrphanMap.has(entry.id) ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <ShieldCheck className="w-3.5 h-3.5 text-amber-500 cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                          <p className="font-medium text-amber-400">Accepted Orphan</p>
                                          <p className="text-xs text-slate-300 mt-1">{acceptedOrphanMap.get(entry.id).reason}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                  <td className="py-0.5 px-1">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-6 w-6">
                                          <MoreHorizontal className="w-3.5 h-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                          onClick={() => {
                                            // Find the original transaction to get all fields
                                            const tx = transactions.find(t => t.id === entry.id);
                                            setEditDisbursementTarget(tx);
                                            setEditDisbursementValues({
                                              date: tx?.date || '',
                                              gross_amount: (tx?.gross_amount ?? tx?.amount)?.toString() || '',
                                              deducted_fee: (tx?.deducted_fee || 0).toString(),
                                              deducted_interest: (tx?.deducted_interest || 0).toString(),
                                              notes: tx?.notes || ''
                                            });
                                            setEditDisbursementDialogOpen(true);
                                          }}
                                        >
                                          <Edit className="w-4 h-4 mr-2" />
                                          Edit Disbursement
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
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
          )}

          {activeTab === 'security' && (
            <SecurityTab loan={loan} />
          )}

          {activeTab === 'expenses' && (
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
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-red-600">{formatCurrency(expense.amount)}</p>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => setConvertingExpense(expense)}
                              >
                                <ArrowRight className="w-4 h-4 text-blue-600" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Convert to Disbursement</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

              </div>
            </div>
          )}
        </div>

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



        {/* Receipt Entry Panel */}
        <ReceiptEntryPanel
          open={isReceiptDialogOpen}
          onOpenChange={setIsReceiptDialogOpen}
          mode="loan"
          borrowerId={loan.borrower_id}
          borrower={borrower}
          loanId={loanId}
          loan={loan}
          onFileComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
            queryClient.invalidateQueries({ queryKey: ['loan-transactions', loanId] });
            queryClient.invalidateQueries({ queryKey: ['loan-schedule', loanId] });
            queueBalanceCacheUpdate(loanId);
            setIsReceiptDialogOpen(false);
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

        {/* Delete Transaction Dialog */}
        <AlertDialog open={deleteTransactionDialogOpen} onOpenChange={(open) => {
          setDeleteTransactionDialogOpen(open);
          if (!open) {
            setDeleteTransactionTarget(null);
            setDeleteTransactionReason('');
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="w-5 h-5" />
                Delete Transaction
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will delete the transaction and reverse its effects on the loan. Any linked bank reconciliation entries will also be removed.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {deleteTransactionTarget && (
              <div className="space-y-4 py-2">
                <div className="bg-slate-50 rounded-lg p-3 text-sm">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Date:</span>
                      <span className="ml-1 font-medium">{format(new Date(deleteTransactionTarget.date), 'dd/MM/yyyy')}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Amount:</span>
                      <span className="ml-1 font-mono font-semibold text-emerald-600">{formatCurrency(deleteTransactionTarget.amount)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Principal:</span>
                      <span className="ml-1 font-mono">{formatCurrency(deleteTransactionTarget.principal_applied || 0)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Interest:</span>
                      <span className="ml-1 font-mono">{formatCurrency(deleteTransactionTarget.interest_applied || 0)}</span>
                    </div>
                    {deleteTransactionTarget.reference && (
                      <div className="col-span-2">
                        <span className="text-slate-500">Reference:</span>
                        <span className="ml-1">{deleteTransactionTarget.reference}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tx-delete-reason" className="text-sm font-medium">
                    Reason for Deletion <span className="text-red-500">*</span>
                  </Label>
                  <textarea
                    id="tx-delete-reason"
                    className="w-full min-h-[60px] px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Enter reason for deleting this transaction..."
                    value={deleteTransactionReason}
                    onChange={(e) => setDeleteTransactionReason(e.target.value)}
                  />
                </div>
              </div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (deleteTransactionTarget) {
                    deleteTransactionMutation.mutate({
                      transactionId: deleteTransactionTarget.id,
                      reason: deleteTransactionReason
                    });
                    setDeleteTransactionDialogOpen(false);
                    setDeleteTransactionTarget(null);
                    setDeleteTransactionReason('');
                  }
                }}
                disabled={!deleteTransactionReason.trim() || deleteTransactionMutation.isPending}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {deleteTransactionMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Transaction
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Disbursements Dialog */}
        <AlertDialog open={deleteDisbursementsDialogOpen} onOpenChange={(open) => {
          setDeleteDisbursementsDialogOpen(open);
          if (!open) {
            setIsDeletingDisbursements(false);
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="w-5 h-5" />
                Delete {selectedDisbursements.size} Disbursement{selectedDisbursements.size !== 1 ? 's' : ''}
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the selected disbursement transactions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="py-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">Warning</p>
                    <p className="text-amber-700 mt-1">
                      Deleting disbursements will affect the loan's total principal amount and may impact related calculations.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingDisbursements}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setIsDeletingDisbursements(true);
                  toast.loading(`Deleting ${selectedDisbursements.size} disbursement(s)...`, { id: 'delete-disbursements' });

                  try {
                    // Delete each selected disbursement
                    for (const txId of selectedDisbursements) {
                      await api.entities.Transaction.delete(txId);
                    }

                    // Refresh data
                    await Promise.all([
                      queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
                      queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
                      queryClient.invalidateQueries({ queryKey: ['loans'] })
                    ]);

                    toast.success(`Deleted ${selectedDisbursements.size} disbursement(s)`, { id: 'delete-disbursements' });
                    setSelectedDisbursements(new Set());
                    setDeleteDisbursementsDialogOpen(false);
                  } catch (error) {
                    console.error('Failed to delete disbursements:', error);
                    toast.error('Failed to delete disbursements', { id: 'delete-disbursements' });
                  } finally {
                    setIsDeletingDisbursements(false);
                  }
                }}
                disabled={isDeletingDisbursements}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {isDeletingDisbursements ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete {selectedDisbursements.size} Disbursement{selectedDisbursements.size !== 1 ? 's' : ''}
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Edit Receipt Dialog */}
        <AlertDialog open={editReceiptDialogOpen} onOpenChange={(open) => {
          setEditReceiptDialogOpen(open);
          if (!open) {
            setEditReceiptTarget(null);
            setIsSavingReceipt(false);
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Edit className="w-5 h-5" />
                Edit Receipt
              </AlertDialogTitle>
              <AlertDialogDescription>
                Update the receipt details and allocation. The allocation total must equal the receipt amount.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {editReceiptTarget && (
              <div className="py-4 space-y-4">
                {/* Receipt Details Section */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="edit-receipt-date" className="text-sm font-medium">Date</Label>
                      <Input
                        id="edit-receipt-date"
                        type="date"
                        value={editReceiptValues.date || ''}
                        onChange={(e) => setEditReceiptValues(prev => ({
                          ...prev,
                          date: e.target.value
                        }))}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-receipt-amount" className="text-sm font-medium">Amount</Label>
                      <Input
                        id="edit-receipt-amount"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editReceiptValues.amount || ''}
                        onChange={(e) => setEditReceiptValues(prev => ({
                          ...prev,
                          amount: parseFloat(e.target.value) || 0
                        }))}
                        className="mt-1"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="edit-receipt-reference" className="text-sm font-medium">Reference</Label>
                    <Input
                      id="edit-receipt-reference"
                      type="text"
                      value={editReceiptValues.reference || ''}
                      onChange={(e) => setEditReceiptValues(prev => ({
                        ...prev,
                        reference: e.target.value
                      }))}
                      className="mt-1"
                      placeholder="Payment reference..."
                    />
                  </div>
                </div>

                {/* Allocation Section */}
                <div className="border-t pt-4">
                  <div className="text-sm font-medium text-slate-700 mb-3">Allocation</div>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="edit-principal" className="text-sm font-medium">Principal</Label>
                      <Input
                        id="edit-principal"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editReceiptValues.principal || ''}
                        onChange={(e) => setEditReceiptValues(prev => ({
                          ...prev,
                          principal: parseFloat(e.target.value) || 0
                        }))}
                        className="mt-1"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-interest" className="text-sm font-medium">Interest</Label>
                      <Input
                        id="edit-interest"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editReceiptValues.interest || ''}
                        onChange={(e) => setEditReceiptValues(prev => ({
                          ...prev,
                          interest: parseFloat(e.target.value) || 0
                        }))}
                        className="mt-1"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-fees" className="text-sm font-medium">Fees</Label>
                      <Input
                        id="edit-fees"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editReceiptValues.fees || ''}
                        onChange={(e) => setEditReceiptValues(prev => ({
                          ...prev,
                          fees: parseFloat(e.target.value) || 0
                        }))}
                        className="mt-1"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                {/* Allocation Summary */}
                {(() => {
                  const total = (editReceiptValues.principal || 0) + (editReceiptValues.interest || 0) + (editReceiptValues.fees || 0);
                  const receiptAmount = editReceiptValues.amount || 0;
                  const diff = receiptAmount - total;
                  const isBalanced = Math.abs(diff) < 0.01;
                  return (
                    <div className={`p-3 rounded-lg border ${isBalanced ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className="flex justify-between items-center text-sm">
                        <span className={isBalanced ? 'text-green-700' : 'text-amber-700'}>Receipt Amount:</span>
                        <span className={`font-medium ${isBalanced ? 'text-green-700' : 'text-amber-700'}`}>
                          {formatCurrency(receiptAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span className={isBalanced ? 'text-green-700' : 'text-amber-700'}>Allocated:</span>
                        <span className={`font-medium ${isBalanced ? 'text-green-700' : 'text-amber-700'}`}>
                          {formatCurrency(total)}
                        </span>
                      </div>
                      {!isBalanced && (
                        <div className="flex justify-between items-center text-sm mt-1">
                          <span className="text-amber-600">{diff > 0 ? 'Remaining:' : 'Over by:'}</span>
                          <span className="font-medium text-amber-600">{formatCurrency(Math.abs(diff))}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSavingReceipt}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (!editReceiptTarget) return;

                  const receiptAmount = editReceiptValues.amount || 0;
                  const total = (editReceiptValues.principal || 0) + (editReceiptValues.interest || 0) + (editReceiptValues.fees || 0);
                  if (Math.abs(receiptAmount - total) >= 0.01) {
                    toast.error('Allocation must equal the receipt amount');
                    return;
                  }

                  if (!editReceiptValues.date) {
                    toast.error('Date is required');
                    return;
                  }

                  setIsSavingReceipt(true);

                  try {
                    // Calculate the difference from previous values
                    const prevAmount = parseFloat(editReceiptTarget.amount) || 0;
                    const prevPrincipal = editReceiptTarget.principal_applied || 0;
                    const prevInterest = editReceiptTarget.interest_applied || 0;
                    const principalDiff = editReceiptValues.principal - prevPrincipal;
                    const interestDiff = editReceiptValues.interest - prevInterest;

                    // Update the transaction with all fields
                    await api.entities.Transaction.update(editReceiptTarget.id, {
                      amount: receiptAmount,
                      date: editReceiptValues.date,
                      reference: editReceiptValues.reference || null,
                      principal_applied: editReceiptValues.principal,
                      interest_applied: editReceiptValues.interest,
                      fees_applied: editReceiptValues.fees
                    });

                    // Update loan paid amounts
                    await api.entities.Loan.update(loan.id, {
                      principal_paid: (loan.principal_paid || 0) + principalDiff,
                      interest_paid: (loan.interest_paid || 0) + interestDiff
                    });

                    // Log the change
                    await logTransactionEvent(
                      AuditAction.TRANSACTION_UPDATE,
                      { id: editReceiptTarget.id, type: 'Repayment', amount: receiptAmount, loan_id: loan.id },
                      { loan_number: loan.loan_number },
                      {
                        action: 'edit_receipt',
                        previous_amount: prevAmount,
                        previous_date: editReceiptTarget.date,
                        previous_reference: editReceiptTarget.reference,
                        previous_principal: prevPrincipal,
                        previous_interest: editReceiptTarget.interest_applied || 0,
                        previous_fees: editReceiptTarget.fees_applied || 0,
                        new_amount: receiptAmount,
                        new_date: editReceiptValues.date,
                        new_reference: editReceiptValues.reference,
                        new_principal: editReceiptValues.principal,
                        new_interest: editReceiptValues.interest,
                        new_fees: editReceiptValues.fees
                      }
                    );

                    // Refresh data
                    await Promise.all([
                      queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
                      queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
                      queryClient.invalidateQueries({ queryKey: ['loans'] })
                    ]);

                    toast.success('Receipt updated');
                    setEditReceiptDialogOpen(false);
                    setEditReceiptTarget(null);
                  } catch (error) {
                    console.error('Failed to update receipt:', error);
                    toast.error('Failed to update receipt');
                  } finally {
                    setIsSavingReceipt(false);
                  }
                }}
                disabled={isSavingReceipt || !editReceiptValues.date || (editReceiptTarget && Math.abs((editReceiptValues.amount || 0) - ((editReceiptValues.principal || 0) + (editReceiptValues.interest || 0) + (editReceiptValues.fees || 0))) >= 0.01)}
              >
                {isSavingReceipt ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Edit Disbursement Dialog */}
        <AlertDialog open={editDisbursementDialogOpen} onOpenChange={(open) => {
          setEditDisbursementDialogOpen(open);
          if (!open) {
            setEditDisbursementTarget(null);
            setIsSavingDisbursement(false);
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Edit className="w-5 h-5" />
                Edit Disbursement
              </AlertDialogTitle>
              <AlertDialogDescription>
                Update the disbursement details. Changes will be audit logged.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {editDisbursementTarget && (
              <div className="py-4 space-y-4">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="edit-disb-date" className="text-sm font-medium">Date</Label>
                    <Input
                      id="edit-disb-date"
                      type="date"
                      value={editDisbursementValues.date?.split('T')[0] || ''}
                      onChange={(e) => setEditDisbursementValues(prev => ({
                        ...prev,
                        date: e.target.value
                      }))}
                      className="mt-1"
                    />
                  </div>

                  {/* Gross Amount and Net Amount (calculated) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="edit-disb-gross" className="text-sm font-medium">Gross Amount *</Label>
                      <Input
                        id="edit-disb-gross"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editDisbursementValues.gross_amount || ''}
                        onChange={(e) => setEditDisbursementValues(prev => ({
                          ...prev,
                          gross_amount: e.target.value
                        }))}
                        className="mt-1"
                        placeholder="0.00"
                      />
                      <p className="text-xs text-slate-500 mt-1">Added to principal</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Net Amount</Label>
                      <Input
                        type="text"
                        value={formatCurrency(
                          (parseFloat(editDisbursementValues.gross_amount) || 0) -
                          (parseFloat(editDisbursementValues.deducted_fee) || 0) -
                          (parseFloat(editDisbursementValues.deducted_interest) || 0)
                        )}
                        disabled
                        className="mt-1 bg-slate-50"
                      />
                      <p className="text-xs text-slate-500 mt-1">Cash paid out</p>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="edit-disb-fee" className="text-sm font-medium">Deducted Fee</Label>
                      <Input
                        id="edit-disb-fee"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editDisbursementValues.deducted_fee || ''}
                        onChange={(e) => setEditDisbursementValues(prev => ({
                          ...prev,
                          deducted_fee: e.target.value
                        }))}
                        className="mt-1"
                        placeholder="0.00"
                      />
                      <p className="text-xs text-slate-500 mt-1">Arrangement fee</p>
                    </div>
                    <div>
                      <Label htmlFor="edit-disb-interest" className="text-sm font-medium">Deducted Interest</Label>
                      <Input
                        id="edit-disb-interest"
                        type="number"
                        step="0.01"
                        min="0"
                        value={editDisbursementValues.deducted_interest || ''}
                        onChange={(e) => setEditDisbursementValues(prev => ({
                          ...prev,
                          deducted_interest: e.target.value
                        }))}
                        className="mt-1"
                        placeholder="0.00"
                      />
                      <p className="text-xs text-slate-500 mt-1">Applied to schedule</p>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="edit-disb-notes" className="text-sm font-medium">Notes</Label>
                    <Input
                      id="edit-disb-notes"
                      type="text"
                      value={editDisbursementValues.notes || ''}
                      onChange={(e) => setEditDisbursementValues(prev => ({
                        ...prev,
                        notes: e.target.value
                      }))}
                      className="mt-1"
                      placeholder="Optional notes"
                    />
                  </div>
                </div>

                {/* Change Summary */}
                {(() => {
                  const newGross = parseFloat(editDisbursementValues.gross_amount) || 0;
                  const newFee = parseFloat(editDisbursementValues.deducted_fee) || 0;
                  const newInterest = parseFloat(editDisbursementValues.deducted_interest) || 0;
                  const newNet = newGross - newFee - newInterest;

                  const oldGross = editDisbursementTarget.gross_amount ?? editDisbursementTarget.amount ?? 0;
                  const oldFee = editDisbursementTarget.deducted_fee ?? 0;
                  const oldInterest = editDisbursementTarget.deducted_interest ?? 0;
                  const oldNet = oldGross - oldFee - oldInterest;

                  const grossChanged = Math.abs(newGross - oldGross) > 0.01;
                  const feeChanged = Math.abs(newFee - oldFee) > 0.01;
                  const interestChanged = Math.abs(newInterest - oldInterest) > 0.01;
                  const dateChanged = editDisbursementValues.date?.split('T')[0] !== editDisbursementTarget.date?.split('T')[0];
                  const notesChanged = editDisbursementValues.notes !== (editDisbursementTarget.notes || '');
                  const hasChanges = grossChanged || feeChanged || interestChanged || dateChanged || notesChanged;

                  return hasChanges ? (
                    <div className="p-3 rounded-lg border bg-amber-50 border-amber-200">
                      <div className="text-sm font-medium text-amber-700 mb-2">Changes:</div>
                      <div className="space-y-1 text-sm">
                        {grossChanged && (
                          <div className="flex justify-between">
                            <span className="text-amber-600">Gross amount:</span>
                            <span>
                              <span className="text-slate-400 line-through mr-2">{formatCurrency(oldGross)}</span>
                              <span className="text-emerald-600 font-medium">{formatCurrency(newGross)}</span>
                            </span>
                          </div>
                        )}
                        {feeChanged && (
                          <div className="flex justify-between">
                            <span className="text-amber-600">Deducted fee:</span>
                            <span>
                              <span className="text-slate-400 line-through mr-2">{formatCurrency(oldFee)}</span>
                              <span className="text-emerald-600 font-medium">{formatCurrency(newFee)}</span>
                            </span>
                          </div>
                        )}
                        {interestChanged && (
                          <div className="flex justify-between">
                            <span className="text-amber-600">Deducted interest:</span>
                            <span>
                              <span className="text-slate-400 line-through mr-2">{formatCurrency(oldInterest)}</span>
                              <span className="text-emerald-600 font-medium">{formatCurrency(newInterest)}</span>
                            </span>
                          </div>
                        )}
                        {(grossChanged || feeChanged || interestChanged) && (
                          <div className="flex justify-between pt-1 border-t border-amber-200 mt-1">
                            <span className="text-amber-700 font-medium">Net disbursement:</span>
                            <span>
                              <span className="text-slate-400 line-through mr-2">{formatCurrency(oldNet)}</span>
                              <span className="text-emerald-600 font-medium">{formatCurrency(newNet)}</span>
                            </span>
                          </div>
                        )}
                        {dateChanged && (
                          <div className="text-amber-600">Date will be updated</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg border bg-slate-50 border-slate-200">
                      <div className="text-sm text-slate-500">No changes made</div>
                    </div>
                  );
                })()}
              </div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSavingDisbursement}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (!editDisbursementTarget) return;

                  const newGross = parseFloat(editDisbursementValues.gross_amount) || 0;
                  const newFee = parseFloat(editDisbursementValues.deducted_fee) || 0;
                  const newInterest = parseFloat(editDisbursementValues.deducted_interest) || 0;
                  const newNet = newGross - newFee - newInterest;

                  if (newGross <= 0) {
                    toast.error('Gross amount must be greater than 0');
                    return;
                  }
                  if (newNet < 0) {
                    toast.error('Deductions cannot exceed gross amount');
                    return;
                  }

                  setIsSavingDisbursement(true);

                  try {
                    const oldGross = editDisbursementTarget.gross_amount ?? editDisbursementTarget.amount ?? 0;
                    const oldFee = editDisbursementTarget.deducted_fee ?? 0;
                    const oldInterest = editDisbursementTarget.deducted_interest ?? 0;
                    const oldNet = oldGross - oldFee - oldInterest;
                    const oldDate = editDisbursementTarget.date;
                    const oldNotes = editDisbursementTarget.notes || '';

                    // Build notes with deduction info
                    let finalNotes = editDisbursementValues.notes || '';
                    if (newInterest > 0 && !finalNotes.includes('advance interest')) {
                      const autoNote = `Includes ${formatCurrency(newInterest)} advance interest deducted`;
                      finalNotes = finalNotes ? `${finalNotes}. ${autoNote}` : autoNote;
                    }

                    // Update the disbursement transaction
                    await api.entities.Transaction.update(editDisbursementTarget.id, {
                      date: editDisbursementValues.date,
                      gross_amount: newGross,
                      deducted_fee: newFee,
                      deducted_interest: newInterest,
                      amount: newNet,  // Net amount (cash paid out)
                      principal_applied: newGross,  // Full gross amount added to principal
                      interest_applied: 0,  // Interest is handled by linked repayment
                      fees_applied: newFee,
                      notes: finalNotes || null
                    });

                    // Handle linked repayment for deducted interest
                    // Find any existing linked repayment for this disbursement
                    const allTx = await api.entities.Transaction.filter(
                      { loan_id: loan.id, is_deleted: false },
                      'date'
                    );
                    const existingLinkedRepayment = allTx.find(
                      tx => tx.linked_disbursement_id === editDisbursementTarget.id
                    );

                    if (newInterest > 0) {
                      // Need a linked repayment
                      if (existingLinkedRepayment) {
                        // Update existing linked repayment
                        await api.entities.Transaction.update(existingLinkedRepayment.id, {
                          date: editDisbursementValues.date,
                          amount: newInterest,
                          interest_applied: newInterest,
                          notes: 'Advance interest deducted from disbursement'
                        });
                      } else {
                        // Create new linked repayment
                        await api.entities.Transaction.create({
                          loan_id: loan.id,
                          borrower_id: loan.borrower_id,
                          date: editDisbursementValues.date,
                          type: 'Repayment',
                          amount: newInterest,
                          principal_applied: 0,
                          interest_applied: newInterest,
                          fees_applied: 0,
                          linked_disbursement_id: editDisbursementTarget.id,
                          notes: 'Advance interest deducted from disbursement'
                        });
                      }
                    } else if (existingLinkedRepayment) {
                      // No deducted interest but linked repayment exists - delete it
                      await api.entities.Transaction.update(existingLinkedRepayment.id, {
                        is_deleted: true
                      });
                    }

                    // Log the change with full details
                    await logTransactionEvent(
                      AuditAction.TRANSACTION_UPDATE,
                      { id: editDisbursementTarget.id, type: 'Disbursement', amount: newNet, loan_id: loan.id },
                      { loan_number: loan.loan_number },
                      {
                        action: 'edit_disbursement',
                        previous_gross: oldGross,
                        new_gross: newGross,
                        previous_deducted_fee: oldFee,
                        new_deducted_fee: newFee,
                        previous_deducted_interest: oldInterest,
                        new_deducted_interest: newInterest,
                        previous_net: oldNet,
                        new_net: newNet,
                        previous_date: oldDate,
                        new_date: editDisbursementValues.date,
                        previous_notes: oldNotes,
                        new_notes: finalNotes || ''
                      }
                    );

                    // Regenerate schedule if disbursement amount changed (affects capital)
                    if (newGross !== oldGross) {
                      await maybeRegenerateScheduleAfterCapitalChange(loan.id, {
                        type: 'Disbursement',
                        amount: newGross,
                        date: editDisbursementValues.date
                      }, 'update');
                    }

                    // Refresh data
                    await Promise.all([
                      queryClient.refetchQueries({ queryKey: ['loan', loanId] }),
                      queryClient.refetchQueries({ queryKey: ['loan-transactions', loanId] }),
                      queryClient.refetchQueries({ queryKey: ['loan-schedule', loanId] }),
                      queryClient.invalidateQueries({ queryKey: ['loans'] })
                    ]);

                    toast.success('Disbursement updated');
                    setEditDisbursementDialogOpen(false);
                    setEditDisbursementTarget(null);
                  } catch (error) {
                    console.error('Failed to update disbursement:', error);
                    toast.error('Failed to update disbursement');
                  } finally {
                    setIsSavingDisbursement(false);
                  }
                }}
                disabled={isSavingDisbursement || !editDisbursementValues.gross_amount || parseFloat(editDisbursementValues.gross_amount) <= 0}
              >
                {isSavingDisbursement ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Convert Expense to Disbursement Dialog */}
        <AlertDialog open={!!convertingExpense} onOpenChange={(open) => !open && setConvertingExpense(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Convert to Disbursement?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  This will convert the expense <strong>"{convertingExpense?.type_name}"</strong> ({formatCurrency(convertingExpense?.amount || 0)})
                  into a loan disbursement.
                </p>
                <p className="text-amber-600 font-medium">
                  The amount will be added to the loan principal and will accrue interest from {convertingExpense?.date ? format(new Date(convertingExpense.date), 'MMM dd, yyyy') : 'the expense date'}.
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isConvertingExpense}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => executeExpenseConversion(convertingExpense)}
                disabled={isConvertingExpense}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isConvertingExpense ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Converting...
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4 mr-2" />
                    Convert to Disbursement
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
        </div>

        {/* Settlement Panel - slides in from right */}
        {isSettleOpen && (
          <div className="w-[600px] flex-shrink-0 h-full overflow-hidden">
            <SettleLoanModal
              isOpen={isSettleOpen}
              onClose={() => setIsSettleOpen(false)}
              loan={loan}
              borrower={borrower}
              transactions={transactions}
              schedule={schedule}
              product={product}
            />
          </div>
        )}

        {/* Edit Loan Panel - slides in from right */}
        {isEditOpen && (
          <div className="w-[500px] flex-shrink-0 h-full overflow-hidden">
            <EditLoanPanel
              isOpen={isEditOpen}
              onClose={() => setIsEditOpen(false)}
              loan={loan}
              onSubmit={(data) => editLoanMutation.mutate(data)}
              isLoading={editLoanMutation.isPending}
            />
          </div>
        )}
        </div>
        );
        }