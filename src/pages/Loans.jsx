import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Search, FileText, Trash2, ArrowUpDown, ChevronRight, X, User, Users, Upload, Link2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import EmptyState from '@/components/ui/EmptyState';
import { getOrgJSON, setOrgJSON } from '@/lib/orgStorage';

// Product name abbreviations
const getProductAbbreviation = (productName) => {
  if (!productName) return '-';
  // Common abbreviations
  const abbreviations = {
    'bridging': 'BRG',
    'bridge': 'BRG',
    'development': 'DEV',
    'commercial': 'COM',
    'residential': 'RES',
    'buy to let': 'BTL',
    'buy-to-let': 'BTL',
    'refurbishment': 'REF',
    'refurb': 'REF',
    'light refurbishment': 'LRF',
    'heavy refurbishment': 'HRF',
    'ground up': 'GUD',
    'mezzanine': 'MEZ',
    'senior': 'SNR',
    'junior': 'JNR',
    'second charge': '2ND',
    'first charge': '1ST',
    'standard': 'STD',
    'interest only': 'IO',
    'rolled up': 'RU',
    'rolled-up': 'RU',
    'serviced': 'SVC',
    'retained': 'RET',
  };

  const lower = productName.toLowerCase();

  // Check for exact matches first
  if (abbreviations[lower]) return abbreviations[lower];

  // Build abbreviation from matching keywords
  let abbr = '';
  for (const [key, val] of Object.entries(abbreviations)) {
    if (lower.includes(key)) {
      abbr += val;
      if (abbr.length >= 6) break; // Max 6 chars
    }
  }

  // If no matches, take first letters of each word (max 4)
  if (!abbr) {
    abbr = productName
      .split(/[\s-]+/)
      .slice(0, 4)
      .map(word => word[0]?.toUpperCase() || '')
      .join('');
  }

  return abbr || productName.slice(0, 3).toUpperCase();
};

export default function Loans() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const borrowerFilter = searchParams.get('borrower') || null;
  const contactEmailFilter = searchParams.get('contact_email') || null;
  const hasFilter = borrowerFilter || contactEmailFilter;
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get('status') || (hasFilter ? 'all' : 'Live')
  );
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'active');
  const [sortField, setSortField] = useState('created_date');
  const [sortDirection, setSortDirection] = useState('desc');

  // Column configuration - order and widths
  const defaultColumnOrder = ['loan_number', 'description', 'date', 'borrower', 'product', 'principal', 'arr_fee', 'exit_fee', 'outstanding', 'last_payment', 'next_due', 'status'];
  const defaultColumnWidths = {
    loan_number: 80,
    description: 150,
    date: 75,
    borrower: 140,
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
    const saved = getOrgJSON('loans_column_order', null);
    return saved || defaultColumnOrder;
  });
  const [columnWidths, setColumnWidths] = useState(() => {
    const saved = getOrgJSON('loans_column_widths', null);
    return saved ? { ...defaultColumnWidths, ...saved } : defaultColumnWidths;
  });
  const resizingRef = useRef(null);
  const dragRef = useRef(null);

  // Save column settings to localStorage when they change
  useEffect(() => {
    setOrgJSON('loans_column_widths', columnWidths);
  }, [columnWidths]);

  useEffect(() => {
    setOrgJSON('loans_column_order', columnOrder);
  }, [columnOrder]);

  // Sync status filter with URL param when it changes
  useEffect(() => {
    const urlStatus = searchParams.get('status');
    if (urlStatus && urlStatus !== statusFilter) {
      setStatusFilter(urlStatus);
    }
  }, [searchParams]);

  useEffect(() => {
    if (hasFilter && statusFilter === 'Live') {
      setStatusFilter('all');
    }
  }, [hasFilter]);

  const { data: allLoans = [], isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_date')
  });

  const { data: filterBorrower } = useQuery({
    queryKey: ['borrower', borrowerFilter],
    queryFn: async () => {
      const borrowers = await api.entities.Borrower.filter({ id: borrowerFilter });
      return borrowers[0];
    },
    enabled: !!borrowerFilter
  });

  const { data: allBorrowers = [] } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list(),
    enabled: !!contactEmailFilter
  });

  const contactBorrowerIds = useMemo(() => {
    if (!contactEmailFilter || !allBorrowers.length) return [];
    return allBorrowers
      .filter(b => b.contact_email === contactEmailFilter || b.email === contactEmailFilter)
      .map(b => b.id);
  }, [contactEmailFilter, allBorrowers]);

  const { data: allTransactions = [] } = useQuery({
    queryKey: ['all-transactions'],
    queryFn: () => api.entities.Transaction.list()
  });

  const { data: allSchedules = [] } = useQuery({
    queryKey: ['all-schedules'],
    queryFn: () => api.entities.RepaymentSchedule.list()
  });

  const getDisbursementsForLoan = (loanId) => {
    return allTransactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Disbursement')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  };

  const getActualPaymentsForLoan = (loanId) => {
    const repayments = allTransactions.filter(t =>
      t.loan_id === loanId && !t.is_deleted && t.type === 'Repayment'
    );
    return {
      principalPaid: repayments.reduce((sum, t) => sum + (t.principal_applied || 0), 0),
      interestPaid: repayments.reduce((sum, t) => sum + (t.interest_applied || 0), 0)
    };
  };

  const getLastPaymentForLoan = (loanId) => {
    const repayments = allTransactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Repayment')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return repayments.length > 0 ? repayments[0] : null;
  };

  const getNextDueForLoan = (loanId) => {
    const loanSchedule = allSchedules
      .filter(s => s.loan_id === loanId && s.status === 'Pending')
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    return loanSchedule.length > 0 ? loanSchedule[0] : null;
  };

  const borrowerFilteredLoans = useMemo(() => {
    if (borrowerFilter) {
      return allLoans.filter(loan => loan.borrower_id === borrowerFilter);
    }
    if (contactEmailFilter && contactBorrowerIds.length > 0) {
      return allLoans.filter(loan => contactBorrowerIds.includes(loan.borrower_id));
    }
    return allLoans;
  }, [allLoans, borrowerFilter, contactEmailFilter, contactBorrowerIds]);

  const loans = borrowerFilteredLoans.filter(loan => !loan.is_deleted);
  const deletedLoans = borrowerFilteredLoans.filter(loan => loan.is_deleted);

  const filteredLoans = loans.filter(loan => {
    const matchesSearch =
      loan.borrower_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan.loan_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan.product_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan.description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' ||
      loan.status === statusFilter ||
      (statusFilter === 'Live' && (loan.status === 'Live' || loan.status === 'Active'));

    return matchesSearch && matchesStatus;
  });

  const clearBorrowerFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('borrower');
    newParams.delete('contact_email');
    setSearchParams(newParams);
    setStatusFilter('all');
  };

  const borrowerTotals = useMemo(() => {
    if (!borrowerFilter) return null;

    const activeLoans = loans.filter(l =>
      l.status === 'Live' || l.status === 'Active' || l.status === 'Defaulted'
    );

    let totalPrincipal = 0;
    let totalInterest = 0;
    let principalPaid = 0;
    let interestPaid = 0;
    let disbursements = 0;

    activeLoans.forEach(loan => {
      totalPrincipal += loan.principal_amount || 0;
      totalInterest += loan.total_interest || 0;
      disbursements += getDisbursementsForLoan(loan.id);
      const payments = getActualPaymentsForLoan(loan.id);
      principalPaid += payments.principalPaid;
      interestPaid += payments.interestPaid;
    });

    const totalPrincipalWithDisbursements = totalPrincipal + disbursements;
    const principalOutstanding = Math.max(0, totalPrincipalWithDisbursements - principalPaid);
    const interestOutstanding = Math.max(0, totalInterest - interestPaid);
    const totalOutstanding = principalOutstanding + interestOutstanding;

    return {
      liveCount: activeLoans.length,
      totalOutstanding,
      principalOutstanding,
      interestOutstanding
    };
  }, [borrowerFilter, loans, allTransactions]);

  const sortedLoans = useMemo(() => {
    return [...filteredLoans].sort((a, b) => {
      let aVal, bVal;

      switch(sortField) {
        case 'loan_number':
          aVal = a.loan_number || '';
          bVal = b.loan_number || '';
          break;
        case 'borrower_name':
          aVal = a.borrower_name || '';
          bVal = b.borrower_name || '';
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
  }, [filteredLoans, sortField, sortDirection, allTransactions, allSchedules]);

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
      'Fully Paid': 'bg-purple-100 text-purple-700',
      'Restructured': 'bg-amber-100 text-amber-700',
      'Defaulted': 'bg-red-100 text-red-700',
      'Default': 'bg-red-100 text-red-700'
    };
    return colors[status] || colors['Pending'];
  };

  const getStatusLabel = (status) => {
    if (status === 'Closed' || status === 'Fully Paid') return 'Settled';
    if (status === 'Restructured') return 'Restruct';
    if (status === 'Defaulted' || status === 'Default') return 'Default';
    if (status === 'Active') return 'Live';
    return status;
  };

  const statusCounts = {
    all: loans.length,
    Pending: loans.filter(l => l.status === 'Pending').length,
    Live: loans.filter(l => l.status === 'Live' || l.status === 'Active').length,
    Settled: loans.filter(l => l.status === 'Closed' || l.status === 'Fully Paid').length,
    Defaulted: loans.filter(l => l.status === 'Defaulted' || l.status === 'Default').length,
  };

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
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-semibold text-slate-700">
            {loan.loan_number || '-'}
          </span>
          {loan.restructured_from_loan_number && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link2 className="w-3 h-3 text-amber-500 flex-shrink-0" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>From #{loan.restructured_from_loan_number}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
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
    borrower: {
      header: 'Borrower',
      sortKey: 'borrower_name',
      align: 'left',
      render: (loan) => (
        <span className="text-sm font-medium text-slate-900">
          {loan.borrower_name}
        </span>
      )
    },
    product: {
      header: 'Prod',
      sortKey: 'product_name',
      align: 'center',
      render: (loan, { productAbbr }) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded cursor-help">
                {productAbbr}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{loan.product_name}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    },
    principal: {
      header: 'Principal',
      sortKey: 'principal_amount',
      align: 'right',
      render: (loan, { totalPrincipal }) => (
        <span className="font-mono text-sm font-semibold text-slate-700">
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
      render: (loan, { totalOutstanding }) => (
        <span className={`font-mono text-sm font-semibold ${
          totalOutstanding <= 0 ? 'text-emerald-600' : 'text-red-600'
        } ${loan.status === 'Closed' && totalOutstanding > 0 ? 'line-through opacity-60' : ''}`}>
          {totalOutstanding <= 0 ? '£0' : formatCurrency(totalOutstanding)}
        </span>
      )
    },
    last_payment: {
      header: 'Last Pay',
      sortKey: 'last_payment',
      align: 'left',
      render: (loan, { lastPayment }) => (
        lastPayment ? (
          <span className="text-sm text-slate-600">{format(new Date(lastPayment.date), 'dd/MM/yy')}</span>
        ) : (
          <span className="text-sm text-slate-400">-</span>
        )
      )
    },
    next_due: {
      header: 'Next Due',
      sortKey: 'next_due',
      align: 'left',
      render: (loan, { nextDue, isOverdue }) => (
        nextDue ? (
          <span className={isOverdue ? 'text-sm text-red-600 font-medium' : 'text-sm text-slate-600'}>
            {format(new Date(nextDue.due_date), 'dd/MM/yy')}
          </span>
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
        <Badge className={`${getStatusColor(loan.status)} text-sm px-1.5 py-0 h-5`}>
          {getStatusLabel(loan.status)}
        </Badge>
      )
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Loans</h1>
            <p className="text-slate-500 mt-1">Manage all loan applications and active loans</p>
          </div>
          <div className="flex gap-2">
            <Link to={createPageUrl('ImportTransactions')}>
              <Button variant="outline" size="sm">
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
            </Link>
            <Link to={createPageUrl('NewLoan')}>
              <Button className="bg-slate-900 hover:bg-slate-800" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                New Loan
              </Button>
            </Link>
          </div>
        </div>

        {/* Borrower Filter Banner */}
        {borrowerFilter && filterBorrower && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-blue-600">Filtering by</p>
                  <p className="font-semibold text-blue-900 text-sm">
                    {filterBorrower.business || `${filterBorrower.first_name} ${filterBorrower.last_name}`}
                  </p>
                </div>
                {borrowerTotals && borrowerTotals.totalOutstanding > 0 && (
                  <div className="hidden md:flex items-center gap-4 ml-4 pl-4 border-l border-blue-200">
                    <div>
                      <p className="text-xs text-blue-600">Live</p>
                      <p className="font-bold text-blue-900">{borrowerTotals.liveCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600">Outstanding</p>
                      <p className="font-bold text-blue-900">{formatCurrency(borrowerTotals.totalOutstanding)}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Link to={createPageUrl(`BorrowerDetails?id=${borrowerFilter}`)}>
                  <Button variant="outline" size="sm" className="border-blue-300 text-blue-700 hover:bg-blue-100 h-7 text-xs">
                    View
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearBorrowerFilter}
                  className="text-blue-700 hover:bg-blue-100 h-7"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Contact Email Filter Banner */}
        {contactEmailFilter && contactBorrowerIds.length > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                  <Users className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-purple-600">Contact group</p>
                  <p className="font-semibold text-purple-900 text-sm">{contactEmailFilter}</p>
                </div>
                <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs">
                  {contactBorrowerIds.length} borrower{contactBorrowerIds.length !== 1 ? 's' : ''}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearBorrowerFilter}
                className="text-purple-700 hover:bg-purple-100 h-7"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="h-8">
            <TabsTrigger value="active" className="text-xs h-7">
              Active
              <Badge variant="secondary" className="ml-1.5 h-5 text-xs">{loans.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="deleted" className="text-xs h-7">
              <Trash2 className="w-3 h-3 mr-1" />
              Deleted
              <Badge variant="secondary" className="ml-1.5 h-5 text-xs">{deletedLoans.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full md:w-auto">
                <TabsList className="grid grid-cols-5 w-full md:w-auto h-8">
                  <TabsTrigger value="Live" className="text-xs h-7 px-2">
                    Live ({statusCounts.Live})
                  </TabsTrigger>
                  <TabsTrigger value="Closed" className="text-xs h-7 px-2">
                    Settled ({statusCounts.Settled})
                  </TabsTrigger>
                  <TabsTrigger value="all" className="text-xs h-7 px-2">
                    All ({statusCounts.all})
                  </TabsTrigger>
                  <TabsTrigger value="Pending" className="text-xs h-7 px-2">
                    Pend ({statusCounts.Pending})
                  </TabsTrigger>
                  <TabsTrigger value="Defaulted" className="text-xs h-7 px-2">
                    Def ({statusCounts.Defaulted})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Content */}
            {isLoading ? (
              <div className="bg-white rounded-lg border border-slate-200">
                <div className="p-4 space-y-2">
                  {Array(8).fill(0).map((_, i) => (
                    <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />
                  ))}
                </div>
              </div>
            ) : filteredLoans.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={searchTerm || statusFilter !== 'all' ? "No loans match your filters" : "No loans yet"}
                description={searchTerm || statusFilter !== 'all' ? "Try adjusting your search or filters" : "Create your first loan to get started"}
                action={
                  !searchTerm && statusFilter === 'all' && (
                    <Link to={createPageUrl('NewLoan')}>
                      <Button size="sm">
                        <Plus className="w-4 h-4 mr-2" />
                        Create Loan
                      </Button>
                    </Link>
                  )
                }
              />
            ) : (
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed" style={{ minWidth: '800px' }}>
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
                        const totalOutstanding = principalRemaining + interestRemaining;
                        const lastPayment = getLastPaymentForLoan(loan.id);
                        const nextDue = getNextDueForLoan(loan.id);
                        const isOverdue = nextDue && new Date(nextDue.due_date) < new Date();
                        const productAbbr = getProductAbbreviation(loan.product_name);

                        const cellContext = { columnWidths, totalPrincipal, totalOutstanding, lastPayment, nextDue, isOverdue, productAbbr };

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
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="deleted">
            {deletedLoans.length === 0 ? (
              <EmptyState
                icon={Trash2}
                title="No deleted loans"
                description="Deleted loans will appear here"
              />
            ) : (
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-red-50 border-b border-red-200">
                      <th className="text-left px-3 py-2 font-medium text-red-700">Loan#</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Borrower</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Product</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Deleted By</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Deleted On</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">Reason</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {deletedLoans.map((loan) => (
                      <tr key={loan.id} className="hover:bg-red-50/50">
                        <td className="px-3 py-2 font-mono text-xs">{loan.loan_number || '-'}</td>
                        <td className="px-3 py-2 text-xs font-medium">{loan.borrower_name}</td>
                        <td className="px-3 py-2 text-xs">{loan.product_name}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{loan.deleted_by}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {loan.deleted_date ? format(new Date(loan.deleted_date), 'dd/MM/yy HH:mm') : '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600 max-w-xs truncate">{loan.deleted_reason || '-'}</td>
                        <td className="px-2 py-2">
                          <Link to={createPageUrl(`LoanDetails?id=${loan.id}`)}>
                            <ChevronRight className="w-4 h-4 text-slate-400 hover:text-slate-600" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
