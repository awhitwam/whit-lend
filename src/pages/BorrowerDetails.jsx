import { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrgJSON, setOrgJSON } from '@/lib/orgStorage';
import { logBorrowerEvent, AuditAction } from '@/lib/auditLog';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Edit,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Plus,
  FileText,
  User,
  Users,
  Calendar,
  Trash2,
  Archive,
  DollarSign,
  Search,
  ArrowUpDown,
  ChevronRight,
  Eye,
  EyeOff,
  Receipt
} from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import BorrowerForm from '@/components/borrower/BorrowerForm';
import BorrowerPaymentModal from '@/components/borrower/BorrowerPaymentModal';
import ReceiptEntryPanel from '@/components/receipts/ReceiptEntryPanel';
import { formatCurrency, applyManualPayment } from '@/components/loan/LoanCalculator';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function BorrowerDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const borrowerId = urlParams.get('id');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyLive, setShowOnlyLive] = useState(true);
  const [sortField, setSortField] = useState('created_date');
  const [sortDirection, setSortDirection] = useState('desc');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: borrower, isLoading: borrowerLoading } = useQuery({
    queryKey: ['borrower', borrowerId],
    queryFn: async () => {
      const borrowers = await api.entities.Borrower.filter({ id: borrowerId });
      return borrowers[0];
    },
    enabled: !!borrowerId
  });

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['borrower-loans', borrowerId],
    queryFn: async () => {
      const allLoans = await api.entities.Loan.filter({ borrower_id: borrowerId }, '-created_date');
      return allLoans.filter(loan => !loan.is_deleted);
    },
    enabled: !!borrowerId
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['borrower-transactions', borrowerId],
    queryFn: () => api.entities.Transaction.filter({ borrower_id: borrowerId }, '-date'),
    enabled: !!borrowerId
  });

  // Fetch all schedules for borrower's loans to get next due dates
  const { data: allSchedules = [] } = useQuery({
    queryKey: ['borrower-schedules', borrowerId],
    queryFn: async () => {
      if (loans.length === 0) return [];
      const schedules = await Promise.all(
        loans.map(loan => api.entities.RepaymentSchedule.filter({ loan_id: loan.id }, 'due_date'))
      );
      return schedules.flat();
    },
    enabled: !!borrowerId && loans.length > 0
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.entities.Borrower.update(borrowerId, data),
    onSuccess: (_result, variables) => {
      logBorrowerEvent(AuditAction.BORROWER_UPDATE,
        { id: borrowerId, name: borrower?.full_name },
        variables,
        borrower
      );
      queryClient.invalidateQueries({ queryKey: ['borrower', borrowerId] });
      setIsEditOpen(false);
    }
  });

  const deleteOrArchiveMutation = useMutation({
    mutationFn: async () => {
      if (loans.length === 0) {
        // Delete if no loans
        await api.entities.Borrower.delete(borrowerId);
        return { action: 'deleted' };
      } else {
        // Archive if has loans
        await api.entities.Borrower.update(borrowerId, {
          is_archived: true,
          archived_by: user?.email || 'unknown',
          archived_date: new Date().toISOString()
        });
        return { action: 'archived' };
      }
    },
    onSuccess: (result) => {
      // Log the delete or archive action
      if (result.action === 'deleted') {
        logBorrowerEvent(AuditAction.BORROWER_DELETE, { id: borrowerId, name: borrower?.full_name }, {
          reason: 'No loans associated'
        });
      } else {
        logBorrowerEvent(AuditAction.BORROWER_UPDATE, { id: borrowerId, name: borrower?.full_name }, {
          is_archived: true,
          archived_by: user?.email,
          archived_date: new Date().toISOString()
        }, borrower);
      }
      queryClient.invalidateQueries({ queryKey: ['borrowers'] });
      navigate(createPageUrl('Borrowers'));
    }
  });

  // Multi-loan payment mutation
  const borrowerPaymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      setIsProcessingPayment(true);
      toast.loading('Processing payment...', { id: 'borrower-payment' });

      const results = [];

      // Process each loan allocation
      for (const allocation of paymentData.allocations) {
        // Fetch loan and schedule
        const [loanData] = await api.entities.Loan.filter({ id: allocation.loan_id });
        const scheduleData = await api.entities.RepaymentSchedule.filter(
          { loan_id: allocation.loan_id },
          'installment_number'
        );

        if (!loanData) continue;

        // Apply manual payment to this loan
        const { updates, principalReduction, creditAmount } = applyManualPayment(
          allocation.interest_amount,
          allocation.principal_amount,
          scheduleData,
          loanData.overpayment_credit || 0,
          paymentData.overpayment_option
        );

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

        // Create transaction for this loan
        await api.entities.Transaction.create({
          loan_id: allocation.loan_id,
          borrower_id: paymentData.borrower_id,
          amount: allocation.interest_amount + allocation.principal_amount,
          date: paymentData.date,
          type: 'Repayment',
          reference: paymentData.reference,
          notes: paymentData.notes || `Multi-loan payment`,
          principal_applied: totalPrincipalApplied,
          interest_applied: totalInterestApplied
        });

        // Update loan totals
        const newPrincipalPaid = (loanData.principal_paid || 0) + totalPrincipalApplied;
        const newInterestPaid = (loanData.interest_paid || 0) + totalInterestApplied;

        const updateData = {
          principal_paid: newPrincipalPaid,
          interest_paid: newInterestPaid,
          overpayment_credit: creditAmount
        };

        // Check if loan is fully paid
        if (newPrincipalPaid >= loanData.principal_amount && newInterestPaid >= loanData.total_interest) {
          updateData.status = 'Closed';
        }

        await api.entities.Loan.update(allocation.loan_id, updateData);

        results.push({
          loan_id: allocation.loan_id,
          principal_applied: totalPrincipalApplied,
          interest_applied: totalInterestApplied
        });
      }

      return results;
    },
    onSuccess: async () => {
      setIsProcessingPayment(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['borrower-loans', borrowerId] }),
        queryClient.invalidateQueries({ queryKey: ['borrower-transactions', borrowerId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      toast.success('Payment recorded successfully', { id: 'borrower-payment' });
      setIsPaymentOpen(false);
    },
    onError: (error) => {
      setIsProcessingPayment(false);
      toast.error('Failed to record payment: ' + error.message, { id: 'borrower-payment' });
    }
  });

  const handleDeleteOrArchive = () => {
    const message = loans.length === 0
      ? 'Are you sure you want to delete this borrower? This action cannot be undone.'
      : `This borrower has ${loans.length} loan(s). They will be archived instead of deleted. Continue?`;

    if (window.confirm(message)) {
      deleteOrArchiveMutation.mutate();
    }
  };

  // Calculate further advances per loan (disbursements beyond the first one)
  // The first disbursement represents the initial principal, so we skip it
  const getDisbursementsForLoan = (loanId) => {
    const disbursements = transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Disbursement')
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    // Skip the first disbursement (initial principal) and sum only further advances
    const furtherAdvances = disbursements.slice(1);
    return furtherAdvances.reduce((sum, t) => sum + (t.amount || 0), 0);
  };

  // Calculate actual payments from transactions
  const getActualPaymentsForLoan = (loanId) => {
    const repayments = transactions.filter(t =>
      t.loan_id === loanId && !t.is_deleted && t.type === 'Repayment'
    );
    return {
      principalPaid: repayments.reduce((sum, t) => sum + (t.principal_applied || 0), 0),
      interestPaid: repayments.reduce((sum, t) => sum + (t.interest_applied || 0), 0)
    };
  };

  // Get last payment for a loan
  const getLastPaymentForLoan = (loanId) => {
    const repayments = transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Repayment')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return repayments.length > 0 ? repayments[0] : null;
  };

  // Get next due date for a loan (first pending schedule item)
  const getNextDueForLoan = (loanId) => {
    const loanSchedule = allSchedules
      .filter(s => s.loan_id === loanId && s.status === 'Pending')
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    return loanSchedule.length > 0 ? loanSchedule[0] : null;
  };

  // Filter loans by search and live status
  const filteredLoans = useMemo(() => {
    return loans.filter(loan => {
      const matchesSearch =
        loan.product_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        loan.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        loan.loan_number?.toLowerCase().includes(searchTerm.toLowerCase());

      const isLiveOrActive = loan.status === 'Live' || loan.status === 'Active';
      const matchesLiveFilter = !showOnlyLive || isLiveOrActive;

      return matchesSearch && matchesLiveFilter;
    });
  }, [loans, searchTerm, showOnlyLive]);

  // Sort loans
  const sortedLoans = useMemo(() => {
    return [...filteredLoans].sort((a, b) => {
      let aVal, bVal;

      switch(sortField) {
        case 'loan_number':
          aVal = a.loan_number || '';
          bVal = b.loan_number || '';
          break;
        case 'product_name':
          aVal = a.product_name || '';
          bVal = b.product_name || '';
          break;
        case 'principal_amount':
          aVal = (a.principal_amount || 0) + getDisbursementsForLoan(a.id);
          bVal = (b.principal_amount || 0) + getDisbursementsForLoan(b.id);
          break;
        case 'start_date':
          aVal = new Date(a.start_date);
          bVal = new Date(b.start_date);
          break;
        case 'last_payment':
          const aLastPay = getLastPaymentForLoan(a.id);
          const bLastPay = getLastPaymentForLoan(b.id);
          aVal = aLastPay ? new Date(aLastPay.date) : new Date(0);
          bVal = bLastPay ? new Date(bLastPay.date) : new Date(0);
          break;
        case 'next_due':
          const aNextDue = getNextDueForLoan(a.id);
          const bNextDue = getNextDueForLoan(b.id);
          aVal = aNextDue ? new Date(aNextDue.due_date) : new Date('9999-12-31');
          bVal = bNextDue ? new Date(bNextDue.due_date) : new Date('9999-12-31');
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'created_date':
        default:
          aVal = new Date(a.created_date);
          bVal = new Date(b.created_date);
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredLoans, sortField, sortDirection, transactions, allSchedules]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'Pending': 'bg-slate-100 text-slate-700',
      'Live': 'bg-emerald-100 text-emerald-700',
      'Active': 'bg-emerald-100 text-emerald-700',
      'Closed': 'bg-purple-100 text-purple-700',
      'Defaulted': 'bg-red-100 text-red-700'
    };
    return colors[status] || colors['Pending'];
  };

  const getStatusLabel = (status) => {
    const labels = {
      'Closed': 'Settled',
      'Restructured': 'Restruct',
      'Defaulted': 'Default'
    };
    return labels[status] || status;
  };

  // Product name abbreviation
  const getProductAbbreviation = (productName) => {
    if (!productName) return '-';
    const name = productName.toLowerCase();
    const abbreviations = {
      'bridging': 'BRG',
      'development': 'DEV',
      'commercial': 'COM',
      'residential': 'RES',
      'buy to let': 'BTL',
      'btl': 'BTL',
      'refurbishment': 'REF',
      'refurb': 'REF',
      'rolled up': 'RU',
      'roll up': 'RU',
      'interest only': 'IO',
      'amortizing': 'AMT',
      'bullet': 'BLT',
      'mezzanine': 'MEZ',
      'senior': 'SNR',
      'junior': 'JNR',
      'first charge': '1ST',
      'second charge': '2ND',
    };

    let abbr = '';
    for (const [keyword, code] of Object.entries(abbreviations)) {
      if (name.includes(keyword)) {
        abbr += (abbr ? '-' : '') + code;
      }
    }

    if (!abbr) {
      const words = productName.split(/[\s-]+/);
      abbr = words.map(w => w[0]?.toUpperCase()).join('').slice(0, 4);
    }

    return abbr || productName.slice(0, 4).toUpperCase();
  };

  const liveCount = loans.filter(l => l.status === 'Live' || l.status === 'Active').length;
  const nonLiveCount = loans.length - liveCount;

  // Column configuration - order and widths
  const defaultColumnOrder = ['loan_number', 'description', 'date', 'product', 'principal', 'arr_fee', 'exit_fee', 'outstanding', 'last_payment', 'next_due', 'status'];
  const defaultColumnWidths = {
    loan_number: 80,
    description: 150,
    date: 75,
    product: 55,
    principal: 90,
    arr_fee: 75,
    exit_fee: 75,
    outstanding: 90,
    last_payment: 80,
    next_due: 80,
    status: 70,
  };

  const [columnOrder, setColumnOrder] = useState(() => {
    const saved = getOrgJSON('borrower_loans_column_order', null);
    return saved || defaultColumnOrder;
  });
  const [columnWidths, setColumnWidths] = useState(() => {
    const saved = getOrgJSON('borrower_loans_column_widths', null);
    return saved ? { ...defaultColumnWidths, ...saved } : defaultColumnWidths;
  });
  const resizingRef = useRef(null);
  const dragRef = useRef(null);

  // Save column settings to localStorage when they change
  useEffect(() => {
    setOrgJSON('borrower_loans_column_widths', columnWidths);
  }, [columnWidths]);

  useEffect(() => {
    setOrgJSON('borrower_loans_column_order', columnOrder);
  }, [columnOrder]);

  // Column resize handlers
  const startResize = (column, e) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = {
      column,
      startX: e.clientX,
      startWidth: columnWidths[column]
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResize);
  };

  const handleMouseMove = (e) => {
    if (!resizingRef.current) return;
    const { column, startX, startWidth } = resizingRef.current;
    const diff = e.clientX - startX;
    const newWidth = Math.max(40, startWidth + diff);
    setColumnWidths(prev => ({ ...prev, [column]: newWidth }));
  };

  const stopResize = () => {
    resizingRef.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResize);
  };

  // Column drag handlers for reordering
  const handleDragStart = (e, column) => {
    dragRef.current = column;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', column);
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    dragRef.current = null;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetColumn) => {
    e.preventDefault();
    const sourceColumn = dragRef.current;
    if (!sourceColumn || sourceColumn === targetColumn) return;

    const newOrder = [...columnOrder];
    const sourceIndex = newOrder.indexOf(sourceColumn);
    const targetIndex = newOrder.indexOf(targetColumn);

    newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, sourceColumn);
    setColumnOrder(newOrder);
  };

  const ResizeHandle = ({ column }) => (
    <div
      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300"
      onMouseDown={(e) => startResize(column, e)}
    />
  );

  // Column definitions with render functions
  const columnDefs = {
    loan_number: {
      header: 'Loan#',
      sortKey: 'loan_number',
      align: 'left',
      render: (loan) => (
        <span className="font-mono font-semibold text-slate-700 text-sm">
          {loan.loan_number || '-'}
        </span>
      )
    },
    description: {
      header: 'Description',
      sortKey: null,
      align: 'left',
      render: (loan) => (
        <span className="text-sm text-slate-600">
          {loan.description || '-'}
        </span>
      )
    },
    date: {
      header: 'Date',
      sortKey: 'start_date',
      align: 'left',
      render: (loan) => (
        <span className="text-sm text-slate-600">
          {loan.start_date ? format(new Date(loan.start_date), 'dd/MM/yy') : '-'}
        </span>
      )
    },
    product: {
      header: 'Prod',
      sortKey: 'product_name',
      align: 'center',
      render: (loan) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm font-medium text-slate-700 cursor-help">
              {getProductAbbreviation(loan.product_name)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">{loan.product_name}</p>
          </TooltipContent>
        </Tooltip>
      )
    },
    principal: {
      header: 'Principal',
      sortKey: 'principal_amount',
      align: 'right',
      render: (loan, { totalPrincipal }) => (
        <span className="font-mono font-semibold text-sm text-slate-700">
          {formatCurrency(totalPrincipal)}
        </span>
      )
    },
    arr_fee: {
      header: 'Arr Fee',
      sortKey: 'arrangement_fee',
      align: 'right',
      render: (loan) => (
        <span className="font-mono text-sm text-slate-600">
          {loan.arrangement_fee > 0 ? formatCurrency(loan.arrangement_fee) : '-'}
        </span>
      )
    },
    exit_fee: {
      header: 'Exit Fee',
      sortKey: 'exit_fee',
      align: 'right',
      render: (loan) => (
        <span className="font-mono text-sm text-slate-600">
          {loan.exit_fee > 0 ? formatCurrency(loan.exit_fee) : '-'}
        </span>
      )
    },
    outstanding: {
      header: 'Outstanding',
      sortKey: null,
      align: 'right',
      render: (loan, { totalOutstandingLoan }) => (
        <span className={`font-mono font-medium text-sm ${totalOutstandingLoan <= 0 ? 'text-emerald-600' : 'text-red-600'} ${loan.status === 'Closed' && totalOutstandingLoan > 0 ? 'line-through opacity-60' : ''}`}>
          {totalOutstandingLoan <= 0 ? '£0' : formatCurrency(totalOutstandingLoan)}
        </span>
      )
    },
    last_payment: {
      header: 'Last Pay',
      sortKey: 'last_payment',
      align: 'left',
      render: (loan, { lastPayment }) => (
        lastPayment ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm font-medium text-slate-700 cursor-help">
                {format(new Date(lastPayment.date), 'dd/MM/yy')}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">{formatCurrency(lastPayment.amount)}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-sm text-slate-400">-</span>
        )
      )
    },
    next_due: {
      header: 'Next Due',
      sortKey: 'next_due',
      align: 'left',
      render: (loan, { nextDue }) => (
        nextDue ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`text-sm font-medium cursor-help ${new Date(nextDue.due_date) < new Date() ? 'text-red-600' : 'text-slate-700'}`}>
                {format(new Date(nextDue.due_date), 'dd/MM/yy')}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">
                {formatCurrency(nextDue.total_due || nextDue.interest_amount || 0)}
                {new Date(nextDue.due_date) < new Date() && ' (Overdue)'}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-sm text-slate-400">-</span>
        )
      )
    },
    status: {
      header: 'Status',
      sortKey: 'status',
      align: 'left',
      render: (loan) => (
        <Badge className={`${getStatusColor(loan.status)} text-xs px-1.5 py-0`}>
          {getStatusLabel(loan.status)}
        </Badge>
      )
    }
  };

  if (borrowerLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="h-64 bg-white rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!borrower) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold text-slate-900">Borrower not found</h2>
          <Link to={createPageUrl('Borrowers')}>
            <Button className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Borrowers
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const activeLoans = loans.filter(l => l.status === 'Active' || l.status === 'Live');
  const totalRepaid = transactions.filter(t => t.type === 'Repayment').reduce((sum, t) => sum + (t.amount || 0), 0);

  // Calculate exposure totals for live/defaulted loans
  const exposureLoans = loans.filter(l => l.status === 'Live' || l.status === 'Active' || l.status === 'Defaulted');
  const disbursements = transactions
    .filter(t => t.type === 'Disbursement' && !t.is_deleted && exposureLoans.some(l => l.id === t.loan_id))
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const repayments = transactions
    .filter(t => t.type === 'Repayment' && !t.is_deleted && exposureLoans.some(l => l.id === t.loan_id));
  const principalPaid = repayments.reduce((sum, t) => sum + (t.principal_applied || 0), 0);
  const interestPaid = repayments.reduce((sum, t) => sum + (t.interest_applied || 0), 0);

  const totalPrincipal = exposureLoans.reduce((sum, l) => sum + (l.principal_amount || 0), 0) + disbursements;
  const totalInterest = exposureLoans.reduce((sum, l) => sum + (l.total_interest || 0), 0);
  const principalOutstanding = Math.max(0, totalPrincipal - principalPaid);
  const interestOutstanding = Math.max(0, totalInterest - interestPaid);
  const totalOutstanding = principalOutstanding + interestOutstanding;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Back Button */}
        <Link to={createPageUrl('Borrowers')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Borrowers
          </Button>
        </Link>

        {/* Profile Header */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-6 text-white">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                  <User className="w-8 h-8" />
                </div>
                <div>
                  {borrower.business && (
                    <p className="text-lg font-semibold text-slate-200">{borrower.business}</p>
                  )}
                  <h1 className="text-2xl font-bold">{borrower.first_name} {borrower.last_name}</h1>
                  <p className="text-slate-300">#{borrower.unique_number || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge 
                  className={borrower.status === 'Active' 
                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400' 
                    : 'bg-red-500/20 text-red-200 border-red-400'
                  }
                >
                  {borrower.status}
                </Badge>
                <Button variant="secondary" size="sm" onClick={() => setIsEditOpen(true)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
                {loans.filter(l => l.status === 'Live' || l.status === 'Active').length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => setIsReceiptDialogOpen(true)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Receipt className="w-4 h-4 mr-2" />
                    Receipt
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteOrArchive}
                  disabled={deleteOrArchiveMutation.isPending}
                >
                  {loans.length === 0 ? (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100">
                  <Phone className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Phone</p>
                  <p className="font-medium">{borrower.phone}</p>
                </div>
              </div>
              {borrower.email && (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100">
                    <Mail className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
                    <p className="font-medium text-sm">{borrower.email}</p>
                  </div>
                </div>
              )}
              {(borrower.address || borrower.city || borrower.zipcode) && (
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100">
                    <MapPin className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Address</p>
                    <div className="font-medium text-sm">
                      {borrower.address && <p>{borrower.address}</p>}
                      {(borrower.city || borrower.zipcode) && (
                        <p className="text-slate-600">
                          {[borrower.city, borrower.zipcode].filter(Boolean).join(', ')}
                        </p>
                      )}
                      {borrower.country && (
                        <p className="text-slate-500">{borrower.country}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100">
                  <Calendar className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Member Since</p>
                  <p className="font-medium">{borrower.created_date ? format(new Date(borrower.created_date), 'MMM dd, yyyy') : 'N/A'}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Active Loans</p>
                  <p className="text-2xl font-bold">{activeLoans.length}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-100">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
            <CardContent className="p-5">
              <div>
                <p className="text-sm text-amber-700 font-medium">Total Outstanding</p>
                <p className="text-2xl font-bold text-amber-900">{formatCurrency(totalOutstanding)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div>
                <p className="text-sm text-slate-500">Principal Outstanding</p>
                <p className="text-2xl font-bold">{formatCurrency(principalOutstanding)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div>
                <p className="text-sm text-slate-500">Interest Outstanding</p>
                <p className="text-2xl font-bold">{formatCurrency(interestOutstanding)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Repaid</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalRepaid)}</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-100">
                  <CreditCard className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="loans" className="space-y-4">
          <TabsList>
            <TabsTrigger value="loans">Loans ({loans.length})</TabsTrigger>
            <TabsTrigger value="transactions">Transactions ({transactions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="loans" className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div className="flex flex-col md:flex-row gap-4 items-center flex-1">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search loans..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="show-only-live"
                    checked={showOnlyLive}
                    onCheckedChange={setShowOnlyLive}
                  />
                  <label
                    htmlFor="show-only-live"
                    className="text-sm text-slate-600 cursor-pointer flex items-center gap-1.5"
                  >
                    {showOnlyLive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    Live only
                    <span className="text-xs text-slate-400">
                      ({showOnlyLive ? liveCount : loans.length})
                    </span>
                  </label>
                </div>
              </div>
              <Link to={createPageUrl(`NewLoan?borrower=${borrowerId}`)}>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  New Loan
                </Button>
              </Link>
            </div>

            {/* Loans Table */}
            {loans.length === 0 ? (
              <Card className="border-dashed border-2">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="w-12 h-12 text-slate-300 mb-4" />
                  <p className="text-slate-500">No loans found</p>
                  <Link to={createPageUrl(`NewLoan?borrower=${borrowerId}`)} className="mt-4">
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Loan
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : filteredLoans.length === 0 ? (
              <Card className="border-dashed border-2">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="w-12 h-12 text-slate-300 mb-4" />
                  <p className="text-slate-500">No loans match your filters</p>
                  <p className="text-sm text-slate-400 mt-1">Try adjusting your search or status filter</p>
                </CardContent>
              </Card>
            ) : (
              <TooltipProvider>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm table-fixed" style={{ minWidth: '700px' }}>
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {columnOrder.map((colKey) => {
                            const col = columnDefs[colKey];
                            if (!col) return null;
                            return (
                              <th
                                key={colKey}
                                className={`relative group px-2 py-2 font-medium text-slate-600 cursor-grab active:cursor-grabbing select-none text-${col.align} overflow-hidden`}
                                style={{ width: columnWidths[colKey] }}
                                draggable
                                onDragStart={(e) => handleDragStart(e, colKey)}
                                onDragEnd={handleDragEnd}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, colKey)}
                              >
                                {col.sortKey ? (
                                  <button
                                    onClick={() => handleSort(col.sortKey)}
                                    className={`flex items-center gap-1 hover:text-slate-900 ${col.align === 'right' ? 'ml-auto' : col.align === 'center' ? 'mx-auto' : ''}`}
                                  >
                                    {col.header} <ArrowUpDown className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <span className={col.align === 'right' ? 'block text-right' : col.align === 'center' ? 'block text-center' : ''}>
                                    {col.header}
                                  </span>
                                )}
                                <ResizeHandle column={colKey} />
                              </th>
                            );
                          })}
                          <th className="w-6 px-1"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedLoans.map((loan) => {
                          const loanDisbursements = getDisbursementsForLoan(loan.id);
                          const actualPayments = getActualPaymentsForLoan(loan.id);
                          const totalPrincipal = loan.principal_amount + loanDisbursements;
                          const principalRemaining = totalPrincipal - actualPayments.principalPaid;
                          const interestRemaining = (loan.total_interest || 0) - actualPayments.interestPaid;
                          const totalOutstandingLoan = principalRemaining + interestRemaining;
                          const lastPayment = getLastPaymentForLoan(loan.id);
                          const nextDue = getNextDueForLoan(loan.id);

                          const cellContext = { totalPrincipal, totalOutstandingLoan, lastPayment, nextDue };

                          return (
                            <tr
                              key={loan.id}
                              className="hover:bg-slate-50 cursor-pointer h-9"
                              onClick={() => navigate(createPageUrl(`LoanDetails?id=${loan.id}`))}
                            >
                              {columnOrder.map((colKey) => {
                                const col = columnDefs[colKey];
                                if (!col) return null;
                                return (
                                  <td
                                    key={colKey}
                                    className={`px-2 py-1.5 text-${col.align} overflow-hidden whitespace-nowrap`}
                                    style={{ maxWidth: columnWidths[colKey] }}
                                  >
                                    {col.render(loan, cellContext)}
                                  </td>
                                );
                              })}
                              <td className="px-1 py-1.5">
                                <ChevronRight className="w-3 h-3 text-slate-400" />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TooltipProvider>
            )}
          </TabsContent>

          <TabsContent value="transactions">
            {transactions.length === 0 ? (
              <Card className="border-dashed border-2">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CreditCard className="w-12 h-12 text-slate-300 mb-4" />
                  <p className="text-slate-500">No transactions found</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${tx.type === 'Repayment' ? 'bg-emerald-100' : 'bg-blue-100'}`}>
                            <CreditCard className={`w-4 h-4 ${tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`} />
                          </div>
                          <div>
                            <p className="font-medium">{tx.type}</p>
                            <p className="text-sm text-slate-500">{format(new Date(tx.date), 'MMM dd, yyyy')}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`}>
                            {tx.type === 'Repayment' ? '+' : '-'}{formatCurrency(tx.amount)}
                          </p>
                          {tx.reference && <p className="text-xs text-slate-500">{tx.reference}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Borrower</DialogTitle>
            </DialogHeader>
            <BorrowerForm
              borrower={borrower}
              onSubmit={(data) => updateMutation.mutate(data)}
              onCancel={() => setIsEditOpen(false)}
              isLoading={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>

        {/* Borrower Payment Modal */}
        <BorrowerPaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          borrower={borrower}
          loans={loans}
          onSubmit={(data) => borrowerPaymentMutation.mutate(data)}
          isLoading={borrowerPaymentMutation.isPending || isProcessingPayment}
        />

        {/* Receipt Entry Panel */}
        <ReceiptEntryPanel
          open={isReceiptDialogOpen}
          onOpenChange={setIsReceiptDialogOpen}
          mode="borrower"
          borrowerId={borrowerId}
          borrower={borrower}
          onFileComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['borrower-loans', borrowerId] });
            queryClient.invalidateQueries({ queryKey: ['borrower-transactions', borrowerId] });
            queryClient.invalidateQueries({ queryKey: ['loans'] });
            setIsReceiptDialogOpen(false);
          }}
        />
      </div>
    </div>
  );
}