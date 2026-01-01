import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  ArrowUpRight,
  Plus,
  FileText,
  DollarSign,
  Clock,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight as ArrowUpRightIcon,
  Banknote,
  Receipt,
  Shield,
  Calendar,
  PieChart,
  Activity,
  Eye,
  ChevronRight,
  CircleDot,
  Building2
} from 'lucide-react';
import { isPast, isToday, format, differenceInDays, startOfMonth, endOfMonth, isWithinInterval, subMonths } from 'date-fns';

export default function Dashboard() {
  const { currentOrganization, isLoadingOrgs, currentTheme } = useOrganization();

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: async () => {
      const allLoans = await api.entities.Loan.list('-created_date');
      return allLoans.filter(loan => !loan.is_deleted);
    },
    enabled: !!currentOrganization
  });

  const { data: borrowers = [], isLoading: borrowersLoading } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list(),
    enabled: !!currentOrganization
  });

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.entities.RepaymentSchedule.list('-due_date', 1000),
    enabled: !!currentOrganization
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.entities.Transaction.list('-date', 500),
    enabled: !!currentOrganization
  });

  const { data: loanProperties = [] } = useQuery({
    queryKey: ['loan-properties-dashboard'],
    queryFn: () => api.entities.LoanProperty.filter({ status: 'Active' }),
    enabled: !!currentOrganization
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties-dashboard'],
    queryFn: () => api.entities.Property.list(),
    enabled: !!currentOrganization
  });

  const { data: investors = [] } = useQuery({
    queryKey: ['investors-dashboard'],
    queryFn: () => api.entities.Investor.list(),
    enabled: !!currentOrganization
  });

  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investor-transactions-dashboard'],
    queryFn: () => api.entities.InvestorTransaction.list('-date', 100),
    enabled: !!currentOrganization
  });

  // Calculate metrics
  const liveLoans = loans.filter(l => l.status === 'Live' || l.status === 'Active');
  const settledLoans = loans.filter(l => l.status === 'Closed');
  const pendingLoans = loans.filter(l => l.status === 'Pending');
  const defaultedLoans = loans.filter(l => l.status === 'Defaulted' || l.status === 'Default');

  // Helper to get disbursements for a loan
  const getDisbursementsForLoan = (loanId) => {
    return transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Disbursement')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  };

  // Calculate repayments from transactions
  const getRepaymentsForLoan = (loanId) => {
    return transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Repayment')
      .reduce((acc, t) => ({
        principal: acc.principal + (t.principal_applied || 0),
        interest: acc.interest + (t.interest_applied || 0),
        total: acc.total + (t.amount || 0)
      }), { principal: 0, interest: 0, total: 0 });
  };

  // Total portfolio value (outstanding)
  const totalOutstanding = liveLoans.reduce((sum, l) => {
    const totalPrincipal = (l.principal_amount || 0) + getDisbursementsForLoan(l.id);
    const repayments = getRepaymentsForLoan(l.id);
    const principalRemaining = totalPrincipal - repayments.principal;
    const interestRemaining = (l.total_interest || 0) - repayments.interest;
    return sum + Math.max(0, principalRemaining) + Math.max(0, interestRemaining);
  }, 0);

  // Principal outstanding only
  const principalOutstanding = liveLoans.reduce((sum, l) => {
    const totalPrincipal = (l.principal_amount || 0) + getDisbursementsForLoan(l.id);
    const repayments = getRepaymentsForLoan(l.id);
    return sum + Math.max(0, totalPrincipal - repayments.principal);
  }, 0);

  // Interest outstanding only
  const interestOutstanding = liveLoans.reduce((sum, l) => {
    const repayments = getRepaymentsForLoan(l.id);
    return sum + Math.max(0, (l.total_interest || 0) - repayments.interest);
  }, 0);

  // Total ever disbursed
  const totalDisbursed = loans.reduce((sum, l) => {
    return sum + (l.principal_amount || 0) + getDisbursementsForLoan(l.id);
  }, 0);

  // Total repaid
  const totalRepaid = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  // Calculate arrears
  const arrears = schedules
    .filter(s => {
      const loan = loans.find(l => l.id === s.loan_id);
      if (!loan || (loan.status !== 'Live' && loan.status !== 'Active')) return false;
      const isPastDue = isPast(new Date(s.due_date)) && !isToday(new Date(s.due_date));
      return isPastDue && s.status !== 'Paid';
    })
    .reduce((sum, s) => {
      const totalPaid = (s.principal_paid || 0) + (s.interest_paid || 0);
      return sum + Math.max(0, (s.total_due || 0) - totalPaid);
    }, 0);

  // Loans maturing soon (next 30 days)
  const today = new Date();
  const loansMaturing = liveLoans.filter(l => {
    if (!l.maturity_date) return false;
    const maturityDate = new Date(l.maturity_date);
    const daysUntil = differenceInDays(maturityDate, today);
    return daysUntil >= 0 && daysUntil <= 30;
  });

  // This month's collections
  const thisMonth = { start: startOfMonth(today), end: endOfMonth(today) };
  const lastMonth = { start: startOfMonth(subMonths(today, 1)), end: endOfMonth(subMonths(today, 1)) };

  const thisMonthCollections = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment' && isWithinInterval(new Date(t.date), thisMonth))
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const lastMonthCollections = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment' && isWithinInterval(new Date(t.date), lastMonth))
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const collectionsChange = lastMonthCollections > 0
    ? ((thisMonthCollections - lastMonthCollections) / lastMonthCollections) * 100
    : 0;

  // This month's disbursements
  const thisMonthDisbursements = transactions
    .filter(t => !t.is_deleted && t.type === 'Disbursement' && isWithinInterval(new Date(t.date), thisMonth))
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  // Add initial loan disbursements for this month
  const thisMonthNewLoans = loans
    .filter(l => isWithinInterval(new Date(l.start_date), thisMonth))
    .reduce((sum, l) => sum + (l.principal_amount || 0), 0);

  const totalThisMonthDisbursements = thisMonthDisbursements + thisMonthNewLoans;

  // Security metrics
  const calculateSecurityMetrics = () => {
    const LTV_THRESHOLD = 80;
    let loansWithHighLTV = 0;
    let totalSecurityValue = 0;

    liveLoans.forEach(loan => {
      const loanProps = loanProperties.filter(lp => lp.loan_id === loan.id);
      if (loanProps.length === 0) return;

      let loanSecurityValue = 0;
      loanProps.forEach(lp => {
        const property = properties.find(p => p.id === lp.property_id);
        if (!property) return;
        const value = lp.charge_type === 'Second Charge'
          ? Math.max(0, (property.current_value || 0) - (lp.first_charge_balance || 0))
          : property.current_value || 0;
        loanSecurityValue += value;
      });

      totalSecurityValue += loanSecurityValue;
      const outstandingPrincipal = (loan.principal_amount || 0) - (getRepaymentsForLoan(loan.id).principal);
      const ltv = loanSecurityValue > 0 ? (outstandingPrincipal / loanSecurityValue) * 100 : 0;
      if (ltv > LTV_THRESHOLD) loansWithHighLTV++;
    });

    return { loansWithHighLTV, totalSecurityValue };
  };

  const securityMetrics = calculateSecurityMetrics();

  // Average LTV
  const avgLTV = securityMetrics.totalSecurityValue > 0
    ? (principalOutstanding / securityMetrics.totalSecurityValue) * 100
    : 0;

  // Recent activity
  const recentActivity = [
    ...transactions
      .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
      .map(tx => {
        const loan = loans.find(l => l.id === tx.loan_id);
        return {
          id: `advance-${tx.id}`,
          type: 'disbursement',
          date: new Date(tx.date),
          amount: tx.amount,
          loanId: tx.loan_id,
          loanNumber: loan?.loan_number,
          borrowerName: loan?.borrower_name || 'Unknown',
        };
      }),
    ...transactions
      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
      .map(tx => {
        const loan = loans.find(l => l.id === tx.loan_id);
        return {
          id: `tx-${tx.id}`,
          type: 'repayment',
          date: new Date(tx.date),
          amount: tx.amount,
          loanId: tx.loan_id,
          loanNumber: loan?.loan_number,
          borrowerName: loan?.borrower_name || 'Unknown',
          principalApplied: tx.principal_applied || 0,
          interestApplied: tx.interest_applied || 0,
        };
      }),
    ...loans
      .filter(loan => loan.status === 'Closed' && loan.settlement_date)
      .map(loan => ({
        id: `settled-${loan.id}`,
        type: 'settlement',
        date: new Date(loan.settlement_date),
        amount: loan.settlement_amount || 0,
        loanId: loan.id,
        loanNumber: loan.loan_number,
        borrowerName: loan.borrower_name,
      })),
    ...loans.map(loan => ({
      id: `loan-${loan.id}`,
      type: 'new_loan',
      date: new Date(loan.start_date),
      amount: loan.principal_amount,
      loanId: loan.id,
      loanNumber: loan.loan_number,
      borrowerName: loan.borrower_name,
    }))
  ]
    .sort((a, b) => b.date - a.date)
    .slice(0, 8);

  // Upcoming payments (next 7 days)
  const upcomingPayments = schedules
    .filter(s => {
      const loan = loans.find(l => l.id === s.loan_id);
      if (!loan || (loan.status !== 'Live' && loan.status !== 'Active')) return false;
      if (s.status === 'Paid') return false;
      const dueDate = new Date(s.due_date);
      const daysUntil = differenceInDays(dueDate, today);
      return daysUntil >= 0 && daysUntil <= 7;
    })
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 5)
    .map(s => {
      const loan = loans.find(l => l.id === s.loan_id);
      return { ...s, loan };
    });

  const isLoading = isLoadingOrgs || loansLoading || borrowersLoading || schedulesLoading;

  // Portfolio health score (0-100)
  const calculateHealthScore = () => {
    let score = 100;
    // Deduct for arrears
    if (arrears > 0) score -= Math.min(30, (arrears / totalOutstanding) * 100);
    // Deduct for defaults
    if (defaultedLoans.length > 0) score -= Math.min(20, defaultedLoans.length * 5);
    // Deduct for high LTV loans
    if (securityMetrics.loansWithHighLTV > 0) score -= Math.min(15, securityMetrics.loansWithHighLTV * 3);
    // Deduct for maturing loans
    if (loansMaturing.length > liveLoans.length * 0.3) score -= 10;
    return Math.max(0, Math.round(score));
  };

  const healthScore = calculateHealthScore();
  const healthColor = healthScore >= 80 ? 'emerald' : healthScore >= 60 ? 'amber' : 'red';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              {currentOrganization?.name || 'Dashboard'}
            </h1>
            <p className="text-slate-500 mt-1">
              {format(today, 'EEEE, d MMMM yyyy')}
            </p>
          </div>
          <div className="flex gap-3">
            <Link to={createPageUrl('NewLoan')}>
              <Button style={{ backgroundColor: currentTheme?.primary }} className="hover:opacity-90">
                <Plus className="w-4 h-4 mr-2" />
                New Loan
              </Button>
            </Link>
          </div>
        </div>

        {/* Portfolio Overview - Hero Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Portfolio Card */}
          <Card className="lg:col-span-2 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24" />
            <CardContent className="p-6 relative">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-slate-400 text-sm font-medium mb-1">Total Portfolio Value</p>
                  <p className="text-4xl font-bold tracking-tight">{formatCurrency(totalOutstanding)}</p>
                </div>
                <div className="p-3 rounded-xl bg-white/10">
                  <Wallet className="w-6 h-6" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <div className="bg-white/10 rounded-xl p-3">
                  <p className="text-slate-400 text-xs mb-1">Principal</p>
                  <p className="text-lg font-semibold">{formatCurrency(principalOutstanding)}</p>
                </div>
                <div className="bg-white/10 rounded-xl p-3">
                  <p className="text-slate-400 text-xs mb-1">Interest</p>
                  <p className="text-lg font-semibold">{formatCurrency(interestOutstanding)}</p>
                </div>
                <div className="bg-white/10 rounded-xl p-3">
                  <p className="text-slate-400 text-xs mb-1">Live Loans</p>
                  <p className="text-lg font-semibold">{liveLoans.length}</p>
                </div>
                <div className="bg-white/10 rounded-xl p-3">
                  <p className="text-slate-400 text-xs mb-1">Borrowers</p>
                  <p className="text-lg font-semibold">{borrowers.filter(b => !b.is_archived).length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Health Score Card */}
          <Card className="bg-white border-slate-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Portfolio Health</h3>
                <Activity className={`w-5 h-5 text-${healthColor}-500`} />
              </div>
              <div className="flex items-center justify-center mb-4">
                <div className="relative w-32 h-32">
                  <svg className="w-32 h-32 transform -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="currentColor"
                      strokeWidth="12"
                      fill="none"
                      className="text-slate-100"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="currentColor"
                      strokeWidth="12"
                      fill="none"
                      strokeDasharray={`${healthScore * 3.52} 352`}
                      strokeLinecap="round"
                      className={`text-${healthColor}-500`}
                      style={{ color: healthScore >= 80 ? '#10b981' : healthScore >= 60 ? '#f59e0b' : '#ef4444' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-3xl font-bold text-slate-900">{healthScore}</span>
                  </div>
                </div>
              </div>
              <p className="text-center text-sm text-slate-500">
                {healthScore >= 80 ? 'Excellent condition' : healthScore >= 60 ? 'Needs attention' : 'Action required'}
              </p>

              <div className="mt-4 space-y-2">
                {arrears > 0 && (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{formatCurrency(arrears)} in arrears</span>
                  </div>
                )}
                {securityMetrics.loansWithHighLTV > 0 && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <Shield className="w-4 h-4" />
                    <span>{securityMetrics.loansWithHighLTV} high LTV loan{securityMetrics.loansWithHighLTV !== 1 ? 's' : ''}</span>
                  </div>
                )}
                {loansMaturing.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <Calendar className="w-4 h-4" />
                    <span>{loansMaturing.length} maturing within 30 days</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-100">
                  <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500 truncate">This Month Collections</p>
                  <p className="text-lg font-bold text-slate-900">{formatCurrency(thisMonthCollections)}</p>
                  {collectionsChange !== 0 && (
                    <div className={`flex items-center gap-1 text-xs ${collectionsChange > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {collectionsChange > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      <span>{Math.abs(collectionsChange).toFixed(0)}% vs last month</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-100">
                  <ArrowUpRightIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500 truncate">This Month Disbursed</p>
                  <p className="text-lg font-bold text-slate-900">{formatCurrency(totalThisMonthDisbursements)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-100">
                  <CheckCircle2 className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500 truncate">Settled Loans</p>
                  <p className="text-lg font-bold text-slate-900">{settledLoans.length}</p>
                  <p className="text-xs text-slate-400">{formatCurrency(totalRepaid)} repaid</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-100">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500 truncate">Pending Approval</p>
                  <p className="text-lg font-bold text-slate-900">{pendingLoans.length}</p>
                  <p className="text-xs text-slate-400">
                    {pendingLoans.length > 0
                      ? formatCurrency(pendingLoans.reduce((s, l) => s + (l.principal_amount || 0), 0))
                      : 'No pending'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Activity */}
          <Card className="lg:col-span-2 bg-white border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold">Recent Activity</CardTitle>
                <Link to={createPageUrl('Loans?status=all')}>
                  <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900">
                    View All
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="divide-y divide-slate-100">
                  {Array(5).fill(0).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
                      <div className="w-10 h-10 rounded-full bg-slate-200" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-slate-200 rounded w-3/4" />
                        <div className="h-3 bg-slate-200 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Receipt className="w-12 h-12 text-slate-300 mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">No activity yet</h3>
                  <p className="text-sm text-slate-500 mb-4 text-center">Create your first loan to get started</p>
                  <Link to={createPageUrl('NewLoan')}>
                    <Button size="sm">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Loan
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentActivity.map((activity) => (
                    <Link
                      key={activity.id}
                      to={createPageUrl(`LoanDetails?id=${activity.loanId}`)}
                      className="flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors"
                    >
                      <div className={`p-2.5 rounded-full ${
                        activity.type === 'repayment' ? 'bg-emerald-100' :
                        activity.type === 'settlement' ? 'bg-purple-100' :
                        activity.type === 'new_loan' ? 'bg-blue-100' :
                        'bg-amber-100'
                      }`}>
                        {activity.type === 'repayment' ? (
                          <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                        ) : activity.type === 'settlement' ? (
                          <CheckCircle2 className="w-4 h-4 text-purple-600" />
                        ) : activity.type === 'new_loan' ? (
                          <FileText className="w-4 h-4 text-blue-600" />
                        ) : (
                          <ArrowUpRightIcon className="w-4 h-4 text-amber-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900 truncate">{activity.borrowerName}</p>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {activity.type === 'repayment' ? 'Payment' :
                             activity.type === 'settlement' ? 'Settled' :
                             activity.type === 'new_loan' ? 'New Loan' : 'Advance'}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Loan #{activity.loanNumber} &bull; {format(activity.date, 'dd MMM yyyy')}
                        </p>
                      </div>
                      <div className={`text-right font-mono font-semibold ${
                        activity.type === 'repayment' || activity.type === 'settlement' ? 'text-emerald-600' : 'text-slate-900'
                      }`}>
                        {activity.type === 'repayment' || activity.type === 'settlement' ? '+' : ''}{formatCurrency(activity.amount)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Upcoming Payments */}
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Due This Week</CardTitle>
                  <Calendar className="w-5 h-5 text-slate-400" />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {upcomingPayments.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-500">
                    No payments due this week
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {upcomingPayments.map((payment) => (
                      <Link
                        key={payment.id}
                        to={createPageUrl(`LoanDetails?id=${payment.loan_id}`)}
                        className="flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors"
                      >
                        <div className={`w-2 h-2 rounded-full ${
                          differenceInDays(new Date(payment.due_date), today) === 0 ? 'bg-red-500' :
                          differenceInDays(new Date(payment.due_date), today) <= 2 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {payment.loan?.borrower_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {format(new Date(payment.due_date), 'EEE, dd MMM')}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">
                          {formatCurrency(payment.total_due || 0)}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Loan Status Breakdown */}
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Loan Status</CardTitle>
                  <PieChart className="w-5 h-5 text-slate-400" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Link to={createPageUrl('Loans?status=Live')} className="block">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <CircleDot className="w-4 h-4 text-emerald-500" />
                        <span className="text-sm text-slate-700">Live</span>
                      </div>
                      <span className="text-sm font-semibold">{liveLoans.length}</span>
                    </div>
                    <Progress value={loans.length > 0 ? (liveLoans.length / loans.length) * 100 : 0} className="h-2 bg-slate-100" />
                  </Link>

                  <Link to={createPageUrl('Loans?status=Closed')} className="block">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-purple-500" />
                        <span className="text-sm text-slate-700">Settled</span>
                      </div>
                      <span className="text-sm font-semibold">{settledLoans.length}</span>
                    </div>
                    <Progress value={loans.length > 0 ? (settledLoans.length / loans.length) * 100 : 0} className="h-2 bg-slate-100" />
                  </Link>

                  <Link to={createPageUrl('Loans?status=Pending')} className="block">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <span className="text-sm text-slate-700">Pending</span>
                      </div>
                      <span className="text-sm font-semibold">{pendingLoans.length}</span>
                    </div>
                    <Progress value={loans.length > 0 ? (pendingLoans.length / loans.length) * 100 : 0} className="h-2 bg-slate-100" />
                  </Link>

                  {defaultedLoans.length > 0 && (
                    <Link to={createPageUrl('Loans?status=Defaulted')} className="block">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                          <span className="text-sm text-slate-700">Defaulted</span>
                        </div>
                        <span className="text-sm font-semibold">{defaultedLoans.length}</span>
                      </div>
                      <Progress value={loans.length > 0 ? (defaultedLoans.length / loans.length) * 100 : 0} className="h-2 bg-slate-100" />
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Link to={createPageUrl('NewLoan')}>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Plus className="w-4 h-4 mr-2" />
                    New Loan
                  </Button>
                </Link>
                <Link to={createPageUrl('Borrowers')}>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Users className="w-4 h-4 mr-2" />
                    Borrowers
                  </Button>
                </Link>
                <Link to={createPageUrl('Loans?status=Live')}>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Eye className="w-4 h-4 mr-2" />
                    Live Loans
                  </Button>
                </Link>
                <Link to={createPageUrl('Ledger')}>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Receipt className="w-4 h-4 mr-2" />
                    Ledger
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Investor Summary Card */}
        {investors.length > 0 && (
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-purple-600" />
                  Investor Accounts
                </CardTitle>
                <Link to={createPageUrl('Investors')}>
                  <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900">
                    View All
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
              <div className="flex items-center gap-4 mt-2">
                <div className="text-sm text-slate-500">
                  Total Balance: <span className="font-semibold text-slate-900">{formatCurrency(investors.reduce((sum, inv) => sum + (inv.current_capital_balance || 0), 0))}</span>
                </div>
                <div className="text-sm text-slate-500">
                  {investors.length} investor{investors.length !== 1 ? 's' : ''}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-t bg-slate-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Business Name</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Balance</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Last Transaction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {investors
                      .filter(inv => inv.status === 'Active')
                      .sort((a, b) => (b.current_capital_balance || 0) - (a.current_capital_balance || 0))
                      .slice(0, 8)
                      .map(investor => {
                        const lastTx = investorTransactions.find(tx => tx.investor_id === investor.id);
                        return (
                          <tr key={investor.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5">
                              <Link to={createPageUrl(`InvestorDetails?id=${investor.id}`)} className="hover:text-purple-600">
                                <p className="font-medium text-slate-900">{investor.business_name || investor.name}</p>
                                {investor.business_name && investor.name !== investor.business_name && (
                                  <p className="text-xs text-slate-500">{investor.name}</p>
                                )}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <p className="font-semibold text-purple-600">{formatCurrency(investor.current_capital_balance || 0)}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              {lastTx ? (
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className={
                                      lastTx.type === 'capital_in' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                      lastTx.type === 'capital_out' ? 'bg-red-50 text-red-700 border-red-200' :
                                      lastTx.type === 'interest_accrual' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                      'bg-blue-50 text-blue-700 border-blue-200'
                                    }
                                  >
                                    {lastTx.type === 'capital_in' ? 'In' :
                                     lastTx.type === 'capital_out' ? 'Out' :
                                     lastTx.type === 'interest_accrual' ? 'Accrued' : 'Interest'}
                                  </Badge>
                                  <span className="text-sm text-slate-600">{formatCurrency(lastTx.amount)}</span>
                                  <span className="text-xs text-slate-400">{format(new Date(lastTx.date), 'dd MMM')}</span>
                                </div>
                              ) : (
                                <span className="text-sm text-slate-400">No transactions</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alerts Section */}
        {(arrears > 0 || securityMetrics.loansWithHighLTV > 0 || loansMaturing.length > 0) && (
          <div className="space-y-4">
            {arrears > 0 && (
              <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-amber-100">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-amber-900">Overdue Payments</h3>
                      <p className="text-sm text-amber-700">
                        {formatCurrency(arrears)} in overdue payments require follow-up
                      </p>
                    </div>
                    <Link to={createPageUrl('Loans?status=Live')}>
                      <Button variant="outline" size="sm" className="border-amber-300 text-amber-700 hover:bg-amber-100">
                        Review
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {securityMetrics.loansWithHighLTV > 0 && (
              <Card className="bg-gradient-to-r from-red-50 to-orange-50 border-red-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-red-100">
                      <Shield className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-red-900">High LTV Warning</h3>
                      <p className="text-sm text-red-700">
                        {securityMetrics.loansWithHighLTV} loan{securityMetrics.loansWithHighLTV !== 1 ? 's' : ''} with LTV over 80%
                      </p>
                    </div>
                    <Link to={createPageUrl('Loans?status=Live')}>
                      <Button variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-100">
                        Review
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {loansMaturing.length > 0 && (
              <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-blue-100">
                      <Calendar className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-blue-900">Upcoming Maturities</h3>
                      <p className="text-sm text-blue-700">
                        {loansMaturing.length} loan{loansMaturing.length !== 1 ? 's' : ''} maturing in the next 30 days
                      </p>
                    </div>
                    <Link to={createPageUrl('Loans?status=Live')}>
                      <Button variant="outline" size="sm" className="border-blue-300 text-blue-700 hover:bg-blue-100">
                        View
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
