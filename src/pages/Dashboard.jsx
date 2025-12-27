import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StatCard from '@/components/ui/StatCard';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import {
  Wallet,
  TrendingUp,
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
  Receipt
} from 'lucide-react';
import { isPast, isToday, format } from 'date-fns';

export default function Dashboard() {
  const { currentOrganization, isLoadingOrgs } = useOrganization();

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
    queryFn: () => api.entities.Transaction.list('-date', 100),
    enabled: !!currentOrganization
  });

  // Calculate metrics
  const activeLoans = loans.filter(l => l.status === 'Active');

  // Helper to get disbursements for a loan
  const getDisbursementsForLoan = (loanId) => {
    return transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Disbursement')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  };

  // Total disbursed = initial principal + all disbursement transactions
  const totalDisbursed = loans
    .filter(l => ['Active', 'Closed'].includes(l.status))
    .reduce((sum, l) => sum + (l.principal_amount || 0) + getDisbursementsForLoan(l.id), 0);

  const totalRepaid = transactions
    .filter(t => {
      const loan = loans.find(l => l.id === t.loan_id);
      return t.type === 'Repayment' && loan; // Only count if loan exists and not deleted
    })
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const totalOutstanding = activeLoans.reduce((sum, l) => {
    const totalPrincipal = l.principal_amount + getDisbursementsForLoan(l.id);
    const principalRemaining = totalPrincipal - (l.principal_paid || 0);
    const interestRemaining = l.total_interest - (l.interest_paid || 0);
    return sum + principalRemaining + interestRemaining;
  }, 0);

  // Calculate arrears (overdue unpaid amounts)
  const arrears = schedules
    .filter(s => {
      const loan = loans.find(l => l.id === s.loan_id);
      if (!loan || loan.status !== 'Active') return false;
      const isPastDue = isPast(new Date(s.due_date)) && !isToday(new Date(s.due_date));
      return isPastDue && s.status !== 'Paid';
    })
    .reduce((sum, s) => {
      const totalPaid = (s.principal_paid || 0) + (s.interest_paid || 0);
      return sum + (s.total_due - totalPaid);
    }, 0);

  // Build recent activity feed from loans and transactions
  const recentActivity = [
    // Initial loan disbursements (loan creations)
    ...loans.map(loan => ({
      id: `loan-${loan.id}`,
      type: 'disbursement',
      date: new Date(loan.start_date),
      amount: loan.principal_amount,
      loanId: loan.id,
      loanNumber: loan.loan_number,
      borrowerName: loan.borrower_name,
      description: `Loan disbursed to ${loan.borrower_name}`
    })),
    // Further advances (Disbursement transactions)
    ...transactions
      .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
      .map(tx => {
        const loan = loans.find(l => l.id === tx.loan_id);
        return {
          id: `advance-${tx.id}`,
          type: 'further_advance',
          date: new Date(tx.date),
          amount: tx.amount,
          loanId: tx.loan_id,
          loanNumber: loan?.loan_number,
          borrowerName: loan?.borrower_name || 'Unknown',
          description: `Further advance to ${loan?.borrower_name || 'Unknown'}`
        };
      }),
    // Repayments
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
          description: `Payment received from ${loan?.borrower_name || 'Unknown'}`
        };
      }),
    // Loan settlements/closures
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
        description: `Loan settled by ${loan.borrower_name}`
      }))
  ]
    .sort((a, b) => b.date - a.date)
    .slice(0, 10);

  const isLoading = isLoadingOrgs || loansLoading || borrowersLoading || schedulesLoading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{currentOrganization?.name || 'Dashboard'}</h1>
            <p className="text-slate-500 mt-1">Overview of your lending portfolio</p>
          </div>
          <div className="flex gap-3">
            <Link to={createPageUrl('NewLoan')}>
              <Button className="bg-slate-900 hover:bg-slate-800">
                <Plus className="w-4 h-4 mr-2" />
                New Loan
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Active Loans"
            value={activeLoans.length}
            subtitle={`${loans.length} total loans`}
            icon={FileText}
            iconClassName="bg-blue-100"
          />
          <StatCard
            title="Total Disbursed"
            value={formatCurrency(totalDisbursed)}
            subtitle="All-time disbursements"
            icon={Wallet}
            iconClassName="bg-emerald-100"
          />
          <StatCard
            title="Total Repaid"
            value={formatCurrency(totalRepaid)}
            subtitle="All-time repayments"
            icon={DollarSign}
            iconClassName="bg-purple-100"
          />
          <StatCard
            title="Outstanding Portfolio"
            value={formatCurrency(totalOutstanding)}
            subtitle={arrears > 0 ? `${formatCurrency(arrears)} in arrears` : 'No arrears'}
            icon={arrears > 0 ? AlertTriangle : TrendingUp}
            iconClassName={arrears > 0 ? "bg-amber-100" : "bg-slate-100"}
          />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-white border-slate-200">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-blue-100">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{borrowers.length}</p>
                  <p className="text-sm text-slate-500">Total Borrowers</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-slate-200">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-amber-100">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{loans.filter(l => l.status === 'Pending').length}</p>
                  <p className="text-sm text-slate-500">Pending Approvals</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white border-slate-200">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-purple-100">
                  <CheckCircle2 className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{loans.filter(l => l.status === 'Closed').length}</p>
                  <p className="text-sm text-slate-500">Settled Loans</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Recent Activity</h2>
            <Link to={createPageUrl('Loans')}>
              <Button variant="ghost" size="sm">
                View All Loans
                <ArrowUpRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>

          {isLoading ? (
            <Card className="bg-white">
              <CardContent className="p-0">
                {Array(5).fill(0).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 border-b last:border-b-0 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-slate-200" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-200 rounded w-3/4" />
                      <div className="h-3 bg-slate-200 rounded w-1/2" />
                    </div>
                    <div className="h-5 bg-slate-200 rounded w-20" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : recentActivity.length === 0 ? (
            <Card className="bg-white border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Receipt className="w-12 h-12 text-slate-300 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-1">No activity yet</h3>
                <p className="text-sm text-slate-500 mb-4">Create your first loan to get started</p>
                <Link to={createPageUrl('NewLoan')}>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Loan
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-white">
              <CardContent className="p-0 divide-y divide-slate-100">
                {recentActivity.map((activity) => {
                  const getActivityIcon = () => {
                    switch (activity.type) {
                      case 'disbursement':
                        return (
                          <div className="p-2.5 rounded-full bg-red-100">
                            <ArrowUpRightIcon className="w-4 h-4 text-red-600" />
                          </div>
                        );
                      case 'further_advance':
                        return (
                          <div className="p-2.5 rounded-full bg-orange-100">
                            <ArrowUpRightIcon className="w-4 h-4 text-orange-600" />
                          </div>
                        );
                      case 'repayment':
                        return (
                          <div className="p-2.5 rounded-full bg-emerald-100">
                            <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                          </div>
                        );
                      case 'settlement':
                        return (
                          <div className="p-2.5 rounded-full bg-purple-100">
                            <CheckCircle2 className="w-4 h-4 text-purple-600" />
                          </div>
                        );
                      default:
                        return (
                          <div className="p-2.5 rounded-full bg-slate-100">
                            <Banknote className="w-4 h-4 text-slate-600" />
                          </div>
                        );
                    }
                  };

                  const getActivityBadge = () => {
                    switch (activity.type) {
                      case 'disbursement':
                        return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Disbursement</Badge>;
                      case 'further_advance':
                        return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Further Advance</Badge>;
                      case 'repayment':
                        return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Payment</Badge>;
                      case 'settlement':
                        return <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Settlement</Badge>;
                      default:
                        return <Badge variant="outline">Activity</Badge>;
                    }
                  };

                  return (
                    <Link
                      key={activity.id}
                      to={createPageUrl(`LoanDetails?id=${activity.loanId}`)}
                      className="flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors"
                    >
                      {getActivityIcon()}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900 truncate">
                            {activity.borrowerName}
                          </p>
                          {getActivityBadge()}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500">
                            Loan #{activity.loanNumber}
                          </span>
                          <span className="text-xs text-slate-400">•</span>
                          <span className="text-xs text-slate-500">
                            {format(activity.date, 'dd MMM yyyy')}
                          </span>
                          {activity.type === 'repayment' && (activity.principalApplied > 0 || activity.interestApplied > 0) && (
                            <>
                              <span className="text-xs text-slate-400">•</span>
                              <span className="text-xs text-slate-500">
                                P: {formatCurrency(activity.principalApplied)} / I: {formatCurrency(activity.interestApplied)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className={`text-right font-mono font-semibold ${
                        (activity.type === 'disbursement' || activity.type === 'further_advance') ? 'text-red-600' : 'text-emerald-600'
                      }`}>
                        {(activity.type === 'disbursement' || activity.type === 'further_advance') ? '-' : '+'}{formatCurrency(activity.amount)}
                      </div>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Arrears Alert */}
        {arrears > 0 && (
          <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-amber-100">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900">Attention Required</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    You have {formatCurrency(arrears)} in overdue payments. Consider following up with borrowers.
                  </p>
                </div>
                <Link to={createPageUrl('Loans')}>
                  <Button variant="outline" size="sm" className="border-amber-300 text-amber-700 hover:bg-amber-100">
                    View Loans
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}