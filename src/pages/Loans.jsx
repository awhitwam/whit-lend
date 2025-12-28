import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, FileText, Trash2, ArrowUpDown, ChevronRight, X, User, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import EmptyState from '@/components/ui/EmptyState';

export default function Loans() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  // Read borrower filter from URL param
  const borrowerFilter = searchParams.get('borrower') || null;
  // Read initial status filter from URL param - default to 'all' when filtering by borrower
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get('status') || (borrowerFilter ? 'all' : 'Live')
  );
  // Read initial tab from URL param, default to 'active'
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'active');
  const [sortField, setSortField] = useState('created_date');
  const [sortDirection, setSortDirection] = useState('desc');

  // When borrower filter changes, update status filter to show all
  useEffect(() => {
    if (borrowerFilter && statusFilter === 'Live') {
      setStatusFilter('all');
    }
  }, [borrowerFilter]);

  const { data: allLoans = [], isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_date')
  });

  // Fetch borrower details if filtering by borrower
  const { data: filterBorrower } = useQuery({
    queryKey: ['borrower', borrowerFilter],
    queryFn: async () => {
      const borrowers = await api.entities.Borrower.filter({ id: borrowerFilter });
      return borrowers[0];
    },
    enabled: !!borrowerFilter
  });

  // Fetch all transactions to calculate disbursements per loan
  const { data: allTransactions = [] } = useQuery({
    queryKey: ['all-transactions'],
    queryFn: () => api.entities.Transaction.list()
  });

  // Fetch all schedules for next due dates
  const { data: allSchedules = [] } = useQuery({
    queryKey: ['all-schedules'],
    queryFn: () => api.entities.RepaymentSchedule.list()
  });

  // Calculate total principal (initial + disbursements) per loan
  const getDisbursementsForLoan = (loanId) => {
    return allTransactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Disbursement')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  };

  // Calculate actual payments from transactions (more accurate than loan.principal_paid/interest_paid)
  const getActualPaymentsForLoan = (loanId) => {
    const repayments = allTransactions.filter(t =>
      t.loan_id === loanId && !t.is_deleted && t.type === 'Repayment'
    );
    return {
      principalPaid: repayments.reduce((sum, t) => sum + (t.principal_applied || 0), 0),
      interestPaid: repayments.reduce((sum, t) => sum + (t.interest_applied || 0), 0)
    };
  };

  // Get last payment for a loan
  const getLastPaymentForLoan = (loanId) => {
    const repayments = allTransactions
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

  // Filter by borrower first if specified
  const borrowerFilteredLoans = useMemo(() => {
    if (!borrowerFilter) return allLoans;
    return allLoans.filter(loan => loan.borrower_id === borrowerFilter);
  }, [allLoans, borrowerFilter]);

  const loans = borrowerFilteredLoans.filter(loan => !loan.is_deleted);
  const deletedLoans = borrowerFilteredLoans.filter(loan => loan.is_deleted);

  const filteredLoans = loans.filter(loan => {
    const matchesSearch =
      loan.borrower_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan.product_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan.description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' ||
      loan.status === statusFilter ||
      (statusFilter === 'Live' && (loan.status === 'Live' || loan.status === 'Active'));

    return matchesSearch && matchesStatus;
  });

  // Function to clear borrower filter
  const clearBorrowerFilter = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('borrower');
    setSearchParams(newParams);
    setStatusFilter('all'); // Show all when clearing borrower filter
  };

  // Calculate borrower exposure totals when filtering by borrower
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
      'Restructured': 'bg-amber-100 text-amber-700',
      'Defaulted': 'bg-red-100 text-red-700'
    };
    return colors[status] || colors['Pending'];
  };

  const getStatusLabel = (status) => {
    if (status === 'Closed') return 'Settled';
    if (status === 'Restructured') return 'Restructured';
    return status;
  };

  const statusCounts = {
    all: loans.length,
    Pending: loans.filter(l => l.status === 'Pending').length,
    Live: loans.filter(l => l.status === 'Live' || l.status === 'Active').length,
    Settled: loans.filter(l => l.status === 'Closed').length,
    Defaulted: loans.filter(l => l.status === 'Defaulted').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Loans</h1>
            <p className="text-slate-500 mt-1">Manage all loan applications and active loans</p>
          </div>
          <div className="flex gap-2">
            <Link to={createPageUrl('ImportTransactions')}>
              <Button variant="outline">
                <Upload className="w-4 h-4 mr-2" />
                Import Transactions
              </Button>
            </Link>
            <Link to={createPageUrl('NewLoan')}>
              <Button className="bg-slate-900 hover:bg-slate-800">
                <Plus className="w-4 h-4 mr-2" />
                New Loan
              </Button>
            </Link>
          </div>
        </div>

        {/* Borrower Filter Banner */}
        {borrowerFilter && filterBorrower && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-blue-600 font-medium">Showing loans for</p>
                  <p className="font-semibold text-blue-900">
                    {filterBorrower.business || `${filterBorrower.first_name} ${filterBorrower.last_name}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link to={createPageUrl(`BorrowerDetails?id=${borrowerFilter}`)}>
                  <Button variant="outline" size="sm" className="border-blue-300 text-blue-700 hover:bg-blue-100">
                    View Borrower
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearBorrowerFilter}
                  className="text-blue-700 hover:bg-blue-100"
              >
                <X className="w-4 h-4 mr-1" />
                Clear Filter
              </Button>
              </div>
            </div>
            {/* Exposure Totals */}
            {borrowerTotals && borrowerTotals.totalOutstanding > 0 && (
              <div className="mt-4 pt-4 border-t border-blue-200 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-blue-600 font-medium">Live/Defaulted Loans</p>
                  <p className="text-lg font-bold text-blue-900">{borrowerTotals.liveCount}</p>
                </div>
                <div>
                  <p className="text-xs text-blue-600 font-medium">Total Outstanding</p>
                  <p className="text-lg font-bold text-blue-900">
                    {formatCurrency(borrowerTotals.totalOutstanding)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-600 font-medium">Principal Outstanding</p>
                  <p className="text-lg font-bold text-blue-900">
                    {formatCurrency(borrowerTotals.principalOutstanding)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-blue-600 font-medium">Interest Outstanding</p>
                  <p className="text-lg font-bold text-blue-900">
                    {formatCurrency(borrowerTotals.interestOutstanding)}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="active">
              Active Loans
              <Badge variant="secondary" className="ml-2">{loans.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="deleted">
              <Trash2 className="w-4 h-4 mr-2" />
              Deleted
              <Badge variant="secondary" className="ml-2">{deletedLoans.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-6">
            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search loans..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full md:w-auto">
                <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full md:w-auto">
                  <TabsTrigger value="Live" className="text-xs">
                    Live ({statusCounts.Live})
                  </TabsTrigger>
                  <TabsTrigger value="Closed" className="text-xs">
                    Settled ({statusCounts.Settled})
                  </TabsTrigger>
                  <TabsTrigger value="all" className="text-xs">
                    All ({statusCounts.all})
                  </TabsTrigger>
                  <TabsTrigger value="Pending" className="text-xs">
                    Pending ({statusCounts.Pending})
                  </TabsTrigger>
                  <TabsTrigger value="Defaulted" className="text-xs">
                    Defaulted ({statusCounts.Defaulted})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Content */}
            {isLoading ? (
              <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-8 space-y-4">
                  {Array(6).fill(0).map((_, i) => (
                    <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
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
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Create Loan
                      </Button>
                    </Link>
                  )
                }
              />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-24">
                        <button 
                          onClick={() => handleSort('loan_number')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Loan #
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('borrower_name')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Borrower
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button 
                          onClick={() => handleSort('product_name')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Product
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button 
                          onClick={() => handleSort('principal_amount')}
                          className="flex items-center gap-1 ml-auto hover:text-slate-900 font-semibold"
                        >
                          Principal
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort('last_payment')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Last Payment
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort('next_due')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Next Due
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => handleSort('status')}
                          className="flex items-center gap-1 hover:text-slate-900 font-semibold"
                        >
                          Status
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLoans.map((loan) => {
                      const loanDisbursements = getDisbursementsForLoan(loan.id);
                      const actualPayments = getActualPaymentsForLoan(loan.id);
                      const totalPrincipal = loan.principal_amount + loanDisbursements;
                      const principalRemaining = totalPrincipal - actualPayments.principalPaid;
                      const interestRemaining = (loan.total_interest || 0) - actualPayments.interestPaid;
                      const totalOutstanding = principalRemaining + interestRemaining;
                      const lastPayment = getLastPaymentForLoan(loan.id);
                      const nextDue = getNextDueForLoan(loan.id);

                      return (
                        <TableRow
                          key={loan.id}
                          className="hover:bg-slate-50 cursor-pointer"
                          onClick={() => navigate(createPageUrl(`LoanDetails?id=${loan.id}`))}
                        >
                          <TableCell className="font-mono font-semibold text-slate-700 text-sm">
                            {loan.loan_number || '-'}
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="text-sm">{loan.borrower_name}</div>
                            {loan.description && (
                              <div className="text-xs text-slate-500 font-normal truncate max-w-36">{loan.description}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-slate-600 text-sm">{loan.product_name}</TableCell>
                          <TableCell className="text-right font-mono font-semibold text-sm">
                            {formatCurrency(totalPrincipal)}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-medium text-sm ${totalOutstanding <= 0 ? 'text-emerald-600' : 'text-red-600'} ${loan.status === 'Closed' && totalOutstanding > 0 ? 'line-through opacity-60' : ''}`}>
                            {totalOutstanding <= 0 ? '£0.00' : formatCurrency(totalOutstanding)}
                          </TableCell>
                          <TableCell>
                            {lastPayment ? (
                              <div>
                                <div className="text-sm font-semibold text-slate-700">{format(new Date(lastPayment.date), 'dd/MM/yy')}</div>
                                <div className="text-xs text-emerald-600">{formatCurrency(lastPayment.amount)}</div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">No payments</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {nextDue ? (
                              <div>
                                <div className={`text-sm font-semibold ${new Date(nextDue.due_date) < new Date() ? 'text-red-600' : 'text-slate-700'}`}>
                                  {format(new Date(nextDue.due_date), 'dd/MM/yy')}
                                  {new Date(nextDue.due_date) < new Date() && <span className="text-xs font-normal ml-1">(overdue)</span>}
                                </div>
                                <div className="text-xs text-slate-500">{formatCurrency(nextDue.total_due || nextDue.interest_amount || 0)}</div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">{loan.status === 'Closed' ? 'Settled' : 'No schedule'}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(loan.status)}>
                              {getStatusLabel(loan.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
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
              <div className="space-y-3">
                {deletedLoans.map((loan) => (
                  <div key={loan.id} className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Trash2 className="w-4 h-4 text-red-600" />
                          <h3 className="font-semibold text-slate-900">{loan.borrower_name}</h3>
                          <Badge variant="outline" className="text-red-600 border-red-300">{loan.product_name}</Badge>
                        </div>
                        <div className="text-sm text-slate-600 space-y-1">
                          <p><strong>Deleted by:</strong> {loan.deleted_by}</p>
                          <p><strong>Deleted on:</strong> {format(new Date(loan.deleted_date), 'MMM dd, yyyy HH:mm')}</p>
                          {loan.deleted_reason && (
                            <p><strong>Reason:</strong> {loan.deleted_reason}</p>
                          )}
                        </div>
                      </div>
                      <Link to={createPageUrl(`LoanDetails?id=${loan.id}`)}>
                        <Button variant="outline" size="sm">View Details</Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}