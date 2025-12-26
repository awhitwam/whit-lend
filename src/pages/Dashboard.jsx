import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatCard from '@/components/ui/StatCard';
import LoanCard from '@/components/loan/LoanCard';
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
  CheckCircle2
} from 'lucide-react';
import { isPast, isToday } from 'date-fns';

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
  
  const totalDisbursed = loans
    .filter(l => ['Active', 'Closed'].includes(l.status))
    .reduce((sum, l) => sum + (l.principal_amount || 0), 0);

  const totalRepaid = transactions
    .filter(t => {
      const loan = loans.find(l => l.id === t.loan_id);
      return t.type === 'Repayment' && loan; // Only count if loan exists and not deleted
    })
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const totalOutstanding = activeLoans.reduce((sum, l) => {
    const principalRemaining = l.principal_amount - (l.principal_paid || 0);
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

  const recentLoans = loans.slice(0, 6);
  const isLoading = isLoadingOrgs || loansLoading || borrowersLoading || schedulesLoading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
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

        {/* Recent Loans */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Recent Loans</h2>
            <Link to={createPageUrl('Loans')}>
              <Button variant="ghost" size="sm">
                View All
                <ArrowUpRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array(6).fill(0).map((_, i) => (
                <Card key={i} className="h-48 animate-pulse bg-slate-100" />
              ))}
            </div>
          ) : recentLoans.length === 0 ? (
            <Card className="bg-white border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="w-12 h-12 text-slate-300 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-1">No loans yet</h3>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentLoans.map((loan) => (
                <LoanCard key={loan.id} loan={loan} />
              ))}
            </div>
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