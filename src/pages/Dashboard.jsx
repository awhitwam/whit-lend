import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency, calculateAccruedInterestWithTransactions } from '@/components/loan/LoanCalculator';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';
import { toast } from 'sonner';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Plus,
  Clock,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight as ArrowUpRightIcon,
  Shield,
  ChevronRight,
  CircleDot,
  Building2,
  CreditCard,
  Flame,
  Search,
  X,
  Calendar,
  HardDrive,
  Loader2
} from 'lucide-react';
import { isPast, isToday, format, startOfMonth, endOfMonth, isWithinInterval, subMonths, differenceInDays } from 'date-fns';

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentOrganization, isLoadingOrgs, currentTheme } = useOrganization();
  const [activeBreakdown, setActiveBreakdown] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['loans', currentOrganization?.id],
    queryFn: async () => {
      const allLoans = await api.entities.Loan.list('-created_date');
      return allLoans.filter(loan => !loan.is_deleted);
    },
    enabled: !!currentOrganization
  });

  const { data: borrowers = [], isLoading: borrowersLoading } = useQuery({
    queryKey: ['borrowers', currentOrganization?.id],
    queryFn: () => api.entities.Borrower.list(),
    enabled: !!currentOrganization
  });

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ['schedules', currentOrganization?.id],
    queryFn: () => api.entities.RepaymentSchedule.list('-due_date', 1000),
    enabled: !!currentOrganization
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', currentOrganization?.id],
    queryFn: () => api.entities.Transaction.list('-date', 500),
    enabled: !!currentOrganization
  });

  const { data: loanProperties = [] } = useQuery({
    queryKey: ['loan-properties-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.LoanProperty.filter({ status: 'Active' }),
    enabled: !!currentOrganization
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.Property.list(),
    enabled: !!currentOrganization
  });

  const { data: investors = [] } = useQuery({
    queryKey: ['investors-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.Investor.list(),
    enabled: !!currentOrganization
  });

  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investor-transactions-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.InvestorTransaction.list('-date', 100),
    enabled: !!currentOrganization
  });

  // Query for last backup date from audit logs
  const { data: lastBackup } = useQuery({
    queryKey: ['last-backup', currentOrganization?.id],
    queryFn: async () => {
      const logs = await api.entities.AuditLog.filter({ action: 'org_backup_export' }, '-created_at');
      return logs.length > 0 ? logs[0] : null;
    },
    enabled: !!currentOrganization
  });

  // Calculate metrics
  const liveLoans = loans.filter(l => l.status === 'Live' || l.status === 'Active');
  const settledLoans = loans.filter(l => l.status === 'Closed');
  const pendingLoans = loans.filter(l => l.status === 'Pending');
  const defaultedLoans = loans.filter(l => l.status === 'Defaulted' || l.status === 'Default');

  // Calculate live metrics for each loan using daily accrual
  // Uses cached principal_remaining from database when available for performance
  const loanMetrics = liveLoans.map(loan => {
    const loanTransactions = transactions.filter(t => t.loan_id === loan.id);

    // Handle different product types
    if (loan.product_type === 'Fixed Charge') {
      // Fixed Charge: use charges outstanding instead of interest
      const totalCharges = (loan.monthly_charge || 0) * (loan.duration || 0);
      const chargesPaid = loanTransactions
        .filter(t => !t.is_deleted && t.type === 'Repayment')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      const chargesOutstanding = Math.max(0, totalCharges - chargesPaid);

      return {
        loan,
        principalRemaining: loan.principal_amount || 0, // FC loans don't reduce principal typically
        interestRemaining: chargesOutstanding,
        interestAccrued: totalCharges,
        interestPaid: chargesPaid,
        isFixedCharge: true
      };
    } else if (loan.product_type === 'Irregular Income') {
      // Irregular Income: no interest calculation
      return {
        loan,
        principalRemaining: loan.principal_amount || 0,
        interestRemaining: 0,
        interestAccrued: 0,
        interestPaid: 0,
        isIrregularIncome: true
      };
    }

    // Standard loans: use cached principal_remaining if available, otherwise calculate
    const calc = calculateAccruedInterestWithTransactions(loan, loanTransactions);
    const principalRemaining = loan.principal_remaining !== null && loan.principal_remaining !== undefined
      ? loan.principal_remaining
      : calc.principalRemaining;

    return {
      loan,
      principalRemaining,
      interestRemaining: calc.interestRemaining,
      interestAccrued: calc.interestAccrued,
      interestPaid: calc.interestPaid
    };
  });

  // Calculate totals from live metrics
  const principalOutstanding = loanMetrics.reduce((sum, m) => sum + Math.max(0, m.principalRemaining), 0);
  const interestOutstanding = loanMetrics.reduce((sum, m) => sum + Math.max(0, m.interestRemaining), 0);
  const totalOutstanding = principalOutstanding + interestOutstanding;

  // Calculate live portfolio financial metrics
  // Use cached principal_remaining for accurate balances
  const livePortfolioMetrics = liveLoans.reduce((acc, loan) => {
    // Use cached principal_remaining if available (most accurate)
    const loanMetric = loanMetrics.find(m => m.loan.id === loan.id);
    const currentPrincipalBalance = loanMetric?.principalRemaining ?? loan.principal_remaining ?? loan.principal_amount ?? 0;

    // Gross = what borrower owes (principal remaining)
    // Net = what cash we actually paid out that's still outstanding
    // The difference is the arrangement fee that was deducted at source
    const arrangementFee = loan.arrangement_fee || 0;

    // If principal is fully repaid, net is also 0
    // Otherwise, net = gross - fee (but not less than 0)
    const grossOutstanding = Math.max(0, currentPrincipalBalance);
    const netOutstanding = Math.max(0, currentPrincipalBalance - arrangementFee);

    return {
      grossDisbursed: acc.grossDisbursed + grossOutstanding,
      netDisbursed: acc.netDisbursed + netOutstanding,
      feesDeducted: acc.feesDeducted + arrangementFee
    };
  }, { grossDisbursed: 0, netDisbursed: 0, feesDeducted: 0 });

  // Fees due = arrangement fees from live loans
  const feesDue = liveLoans.reduce((sum, loan) => sum + (loan.arrangement_fee || 0), 0);

  // Expected profit = gross disbursed + fees + interest outstanding - net disbursed
  // This shows: what borrowers owe (gross + fees + interest) minus what we actually paid out (net)
  const expectedProfit = livePortfolioMetrics.grossDisbursed + feesDue + interestOutstanding - livePortfolioMetrics.netDisbursed;

  // Create breakdown data for each clickable metric
  // Use cached principal_remaining for accurate balances
  const breakdownData = {
    grossDisbursed: loanMetrics
      .filter(m => m.principalRemaining > 0)
      .map(m => ({ loan: m.loan, value: Math.max(0, m.principalRemaining) }))
      .sort((a, b) => b.value - a.value),

    netDisbursed: loanMetrics
      .filter(m => m.principalRemaining > 0)
      .map(m => {
        const fee = m.loan.arrangement_fee || 0;
        return { loan: m.loan, value: Math.max(0, m.principalRemaining - fee) };
      })
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value),

    feesDue: liveLoans
      .filter(loan => (loan.arrangement_fee || 0) > 0)
      .map(loan => ({ loan, value: loan.arrangement_fee || 0 }))
      .sort((a, b) => b.value - a.value),

    interestDue: loanMetrics
      .filter(m => m.interestRemaining > 0)
      .map(m => ({ loan: m.loan, value: Math.max(0, m.interestRemaining) }))
      .sort((a, b) => b.value - a.value),

    principalOS: loanMetrics
      .filter(m => m.principalRemaining > 0)
      .map(m => ({ loan: m.loan, value: Math.max(0, m.principalRemaining) }))
      .sort((a, b) => b.value - a.value),

    borrowers: liveLoans.map(loan => ({ loan, value: 1 }))
  };

  const breakdownTitles = {
    grossDisbursed: 'Gross Disbursed Breakdown',
    netDisbursed: 'Net Disbursed Breakdown',
    feesDue: 'Fees Due Breakdown',
    interestDue: 'Interest Due Breakdown',
    principalOS: 'Principal Outstanding Breakdown',
    borrowers: 'Active Loans'
  };

  const breakdownDescriptions = {
    grossDisbursed: 'Principal amounts owed by each borrower',
    netDisbursed: 'Cash paid out to each borrower',
    feesDue: 'Arrangement fees for each loan',
    interestDue: 'Accrued interest outstanding per loan',
    principalOS: 'Remaining principal balance per loan',
    borrowers: 'All live loans in the portfolio'
  };

  // Filter breakdown data by search term
  const getFilteredBreakdown = (key) => {
    if (!breakdownData[key]) return [];
    return breakdownData[key].filter(item =>
      item.loan.borrower_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.loan.loan_number?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  // Borrowers in credit (negative interest = overpaid)
  const borrowersInCredit = loanMetrics
    .filter(m => m.interestRemaining < -0.01) // More than 1p credit
    .map(m => ({
      loan: m.loan,
      creditAmount: Math.abs(m.interestRemaining)
    }))
    .sort((a, b) => b.creditAmount - a.creditAmount);

  // Highest interest balances (excluding Fixed Charge and Irregular Income)
  const highestInterestBalances = loanMetrics
    .filter(m => !m.isFixedCharge && !m.isIrregularIncome && m.interestRemaining > 0)
    .sort((a, b) => b.interestRemaining - a.interestRemaining)
    .slice(0, 5);

  // Highest principal balances
  const highestPrincipalBalances = loanMetrics
    .filter(m => m.principalRemaining > 0)
    .sort((a, b) => b.principalRemaining - a.principalRemaining)
    .slice(0, 5);

  // Get recent repayments (last 10)
  const recentRepayments = transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(tx => {
      const loan = loans.find(l => l.id === tx.loan_id);
      return { ...tx, loan };
    });

  // Calculate further advances per loan (for backward compat with other calculations)
  const getDisbursementsForLoan = (loanId) => {
    const disbursements = transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Disbursement')
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const furtherAdvances = disbursements.slice(1);
    return furtherAdvances.reduce((sum, t) => sum + ((t.gross_amount ?? t.amount) || 0), 0);
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

  // Calculate if backup is needed (more than 5 days since last backup)
  const BACKUP_WARNING_DAYS = 5;
  const daysSinceLastBackup = lastBackup?.created_at
    ? differenceInDays(today, new Date(lastBackup.created_at))
    : null;
  const backupNeeded = daysSinceLastBackup === null || daysSinceLastBackup >= BACKUP_WARNING_DAYS;

  // Entity name mapping for backup
  const getEntityName = (tableName) => {
    const map = {
      'loan_products': 'LoanProduct',
      'investor_products': 'InvestorProduct',
      'expense_types': 'ExpenseType',
      'first_charge_holders': 'FirstChargeHolder',
      'borrowers': 'Borrower',
      'properties': 'Property',
      'Investor': 'Investor',
      'loans': 'Loan',
      'InvestorTransaction': 'InvestorTransaction',
      'investor_interest': 'InvestorInterest',
      'transactions': 'Transaction',
      'repayment_schedules': 'RepaymentSchedule',
      'loan_properties': 'LoanProperty',
      'expenses': 'Expense',
      'value_history': 'ValueHistory',
      'bank_statements': 'BankStatement',
      'other_income': 'OtherIncome',
      'borrower_loan_preferences': 'BorrowerLoanPreference',
      'receipt_drafts': 'ReceiptDraft',
      'reconciliation_patterns': 'ReconciliationPattern',
      'reconciliation_entries': 'ReconciliationEntry',
      'accepted_orphans': 'AcceptedOrphan',
      'audit_logs': 'AuditLog'
    };
    return map[tableName] || tableName;
  };

  // Handle backup export
  const handleBackupNow = async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);

    const backup = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      organizationId: currentOrganization.id,
      organizationName: currentOrganization.name,
      tables: {},
      metadata: { recordCounts: {} }
    };

    const tables = [
      'loan_products', 'investor_products', 'expense_types', 'first_charge_holders',
      'borrowers', 'properties', 'Investor',
      'loans', 'InvestorTransaction', 'investor_interest',
      'transactions', 'repayment_schedules', 'loan_properties', 'expenses',
      'value_history', 'bank_statements', 'other_income',
      'borrower_loan_preferences', 'receipt_drafts',
      'reconciliation_patterns', 'reconciliation_entries',
      'accepted_orphans', 'audit_logs'
    ];

    try {
      for (const table of tables) {
        const entityName = getEntityName(table);
        try {
          const data = await api.entities[entityName].list();
          backup.tables[table] = data;
          backup.metadata.recordCounts[table] = data.length;
        } catch {
          backup.tables[table] = [];
          backup.metadata.recordCounts[table] = 0;
        }
      }

      // Generate and download file
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = currentOrganization.name.replace(/[^a-zA-Z0-9]/g, '-');
      a.download = `backup-${safeName}-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const totalRecords = Object.values(backup.metadata.recordCounts).reduce((a, b) => a + b, 0);

      // Log audit
      await logAudit({
        action: AuditAction.ORG_BACKUP_EXPORT,
        entityType: EntityType.ORGANIZATION,
        entityId: currentOrganization.id,
        entityName: currentOrganization.name,
        details: { totalRecords, recordCounts: backup.metadata.recordCounts }
      });

      toast.success(`Backup complete (${totalRecords.toLocaleString()} records)`);
      queryClient.invalidateQueries(['last-backup']);
    } catch (err) {
      toast.error('Backup failed: ' + err.message);
    } finally {
      setIsBackingUp(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                {currentOrganization?.name || 'Dashboard'}
              </h1>
              {backupNeeded && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleBackupNow}
                        disabled={isBackingUp}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isBackingUp
                            ? 'bg-slate-100 text-slate-400'
                            : 'bg-amber-100 hover:bg-amber-200 text-amber-600'
                        }`}
                      >
                        {isBackingUp ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <HardDrive className="w-5 h-5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="font-medium">Backup Recommended</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {daysSinceLastBackup === null
                          ? 'No backup on record'
                          : `Last backup: ${daysSinceLastBackup} days ago`}
                      </p>
                      <p className="text-xs text-slate-400">Click to backup now</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="text-slate-500 mt-1">
              {format(today, 'EEEE, d MMMM yyyy')}
              {lastBackup && (
                <span className="ml-2 text-xs text-slate-400">
                  • Last backup: {format(new Date(lastBackup.created_at), 'd MMM')}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Loan Status Badges */}
            <div className="flex items-center gap-2">
              <Link to={createPageUrl('Loans?status=Live')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                <CircleDot className="w-3.5 h-3.5" />
                <span className="text-sm font-medium">{liveLoans.length} Live</span>
              </Link>
              <Link to={createPageUrl('Loans?status=Closed')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="text-sm font-medium">{settledLoans.length} Settled</span>
              </Link>
              {pendingLoans.length > 0 && (
                <Link to={createPageUrl('Loans?status=Pending')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">{pendingLoans.length} Pending</span>
                </Link>
              )}
              {defaultedLoans.length > 0 && (
                <Link to={createPageUrl('Loans?status=Defaulted')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">{defaultedLoans.length} Defaulted</span>
                </Link>
              )}
            </div>
            <Link to={createPageUrl('NewLoan')}>
              <Button style={{ backgroundColor: currentTheme?.primary }} className="hover:opacity-90">
                <Plus className="w-4 h-4 mr-2" />
                New Loan
              </Button>
            </Link>
          </div>
        </div>

        {/* Active Portfolio Overview - Hero Section */}
        <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24" />
          <CardContent className="p-6 relative">
            <div className="flex items-start justify-between mb-4">
              <div
                className="cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setActiveBreakdown('grossDisbursed')}
              >
                <p className="text-slate-400 text-sm font-medium mb-1">Active Portfolio ({liveLoans.length} Live Loans)</p>
                <p className="text-3xl font-bold tracking-tight">{formatCurrency(livePortfolioMetrics.grossDisbursed)}</p>
                <p className="text-slate-400 text-xs mt-1">Gross Disbursed (click for breakdown)</p>
              </div>
              <div className="text-right">
                <p className="text-slate-400 text-xs mb-1">Income on Accrual</p>
                <p className={`text-2xl font-bold ${expectedProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {expectedProfit >= 0 ? '+' : ''}{formatCurrency(expectedProfit)}
                </p>
                <p className="text-slate-500 text-xs mt-1">Gross + Fees + Interest - Net</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <div
                className="bg-white/10 rounded-xl p-3 cursor-pointer hover:bg-white/20 transition-colors"
                onClick={() => setActiveBreakdown('netDisbursed')}
              >
                <p className="text-slate-300 text-xs font-medium mb-0.5">Net Disbursed</p>
                <p className="text-lg font-semibold">{formatCurrency(livePortfolioMetrics.netDisbursed)}</p>
                <p className="text-slate-400 text-xs">Cash paid out</p>
              </div>
              <div
                className="bg-white/10 rounded-xl p-3 cursor-pointer hover:bg-white/20 transition-colors"
                onClick={() => setActiveBreakdown('feesDue')}
              >
                <p className="text-slate-300 text-xs font-medium mb-0.5">Fees Due</p>
                <p className="text-lg font-semibold">{formatCurrency(feesDue)}</p>
                <p className="text-slate-400 text-xs">Arrangement fees</p>
              </div>
              <div
                className="bg-white/10 rounded-xl p-3 cursor-pointer hover:bg-white/20 transition-colors"
                onClick={() => setActiveBreakdown('interestDue')}
              >
                <p className="text-slate-300 text-xs font-medium mb-0.5">Interest Due</p>
                <p className="text-lg font-semibold">{formatCurrency(interestOutstanding)}</p>
                <p className="text-slate-400 text-xs">Accrued to date</p>
              </div>
              <div
                className="bg-white/10 rounded-xl p-3 cursor-pointer hover:bg-white/20 transition-colors"
                onClick={() => setActiveBreakdown('borrowers')}
              >
                <p className="text-slate-300 text-xs font-medium mb-0.5">Live Loans</p>
                <p className="text-lg font-semibold">{liveLoans.length}</p>
                <p className="text-slate-400 text-xs">Active loans</p>
              </div>
            </div>
          </CardContent>
        </Card>

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

        {/* Key Metrics Grid - Highest Balances & Credits */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Highest Interest Balances */}
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Flame className="w-5 h-5 text-orange-500" />
                  Highest Interest O/S
                </CardTitle>
              </div>
              <p className="text-xs text-slate-500 mt-1">Live accrued interest balances</p>
            </CardHeader>
            <CardContent className="p-0">
              {highestInterestBalances.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">
                  No interest outstanding
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {highestInterestBalances.map((m, idx) => (
                    <Link
                      key={m.loan.id}
                      to={createPageUrl(`LoanDetails?id=${m.loan.id}`)}
                      className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0 ? 'bg-orange-100 text-orange-700' :
                        idx === 1 ? 'bg-slate-200 text-slate-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {m.loan.borrower_name}
                        </p>
                        <p className="text-xs text-slate-500">#{m.loan.loan_number}</p>
                      </div>
                      <p className="text-sm font-semibold text-red-600">
                        {formatCurrency(m.interestRemaining)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Highest Principal Balances */}
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-blue-500" />
                  Highest Principal O/S
                </CardTitle>
              </div>
              <p className="text-xs text-slate-500 mt-1">Largest outstanding balances</p>
            </CardHeader>
            <CardContent className="p-0">
              {highestPrincipalBalances.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">
                  No principal outstanding
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {highestPrincipalBalances.map((m, idx) => (
                    <Link
                      key={m.loan.id}
                      to={createPageUrl(`LoanDetails?id=${m.loan.id}`)}
                      className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0 ? 'bg-blue-100 text-blue-700' :
                        idx === 1 ? 'bg-slate-200 text-slate-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {m.loan.borrower_name}
                        </p>
                        <p className="text-xs text-slate-500">#{m.loan.loan_number}</p>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatCurrency(m.principalRemaining)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Borrowers in Credit */}
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-emerald-500" />
                  Borrowers in Credit
                </CardTitle>
              </div>
              <p className="text-xs text-slate-500 mt-1">Interest overpaid (credit balance)</p>
            </CardHeader>
            <CardContent className="p-0">
              {borrowersInCredit.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-500">
                  No borrowers in credit
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {borrowersInCredit.slice(0, 5).map((item) => (
                    <Link
                      key={item.loan.id}
                      to={createPageUrl(`LoanDetails?id=${item.loan.id}`)}
                      className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="p-1.5 rounded-full bg-emerald-100">
                        <ArrowDownLeft className="w-3 h-3 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {item.loan.borrower_name}
                        </p>
                        <p className="text-xs text-slate-500">#{item.loan.loan_number}</p>
                      </div>
                      <p className="text-sm font-semibold text-emerald-600">
                        +{formatCurrency(item.creditAmount)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Payments */}
        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
                Recent Payments
              </CardTitle>
              <Link to={createPageUrl('Ledger')}>
                <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900">
                  View Ledger
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentRepayments.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">
                No recent payments
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-t bg-slate-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Borrower</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">Loan</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Principal</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Interest</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentRepayments.map(tx => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-sm text-slate-600">
                          {format(new Date(tx.date), 'dd MMM')}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link
                            to={createPageUrl(`LoanDetails?id=${tx.loan_id}`)}
                            className="text-sm font-medium text-slate-900 hover:text-blue-600"
                          >
                            {tx.loan?.borrower_name || 'Unknown'}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-500">
                          #{tx.loan?.loan_number}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono text-slate-600">
                          {tx.principal_applied > 0 ? formatCurrency(tx.principal_applied) : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono text-slate-600">
                          {tx.interest_applied > 0 ? formatCurrency(tx.interest_applied) : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-mono font-semibold text-emerald-600">
                          {formatCurrency(tx.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

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
        {(securityMetrics.loansWithHighLTV > 0 || loansMaturing.length > 0) && (
          <div className="space-y-4">
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

        {/* Breakdown Modal */}
        <Dialog open={!!activeBreakdown} onOpenChange={(open) => { if (!open) { setActiveBreakdown(null); setSearchTerm(''); } }}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{breakdownTitles[activeBreakdown]}</DialogTitle>
              <DialogDescription>
                {breakdownDescriptions[activeBreakdown]} - Click a row to view loan details
              </DialogDescription>
            </DialogHeader>

            {/* Search Box */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by borrower or loan #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Results Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 text-sm font-medium text-slate-500">Loan #</th>
                    <th className="text-left py-2 px-2 text-sm font-medium text-slate-500">Borrower</th>
                    <th className="text-right py-2 px-2 text-sm font-medium text-slate-500">
                      {activeBreakdown === 'borrowers' ? 'Status' : 'Amount'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredBreakdown(activeBreakdown).map(item => (
                    <tr
                      key={item.loan.id}
                      className="border-b hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => {
                        navigate(createPageUrl(`LoanDetails?id=${item.loan.id}`));
                        setActiveBreakdown(null);
                        setSearchTerm('');
                      }}
                    >
                      <td className="py-2.5 px-2 text-sm font-mono text-slate-600">#{item.loan.loan_number}</td>
                      <td className="py-2.5 px-2 text-sm font-medium text-slate-900">{item.loan.borrower_name}</td>
                      <td className="py-2.5 px-2 text-right text-sm font-mono font-semibold text-slate-700">
                        {activeBreakdown === 'borrowers' ? (
                          <span className="text-emerald-600">{item.loan.status}</span>
                        ) : (
                          formatCurrency(item.value)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {activeBreakdown !== 'borrowers' && (
                  <tfoot className="sticky bottom-0 bg-white border-t-2">
                    <tr className="font-bold">
                      <td colSpan={2} className="py-2.5 px-2 text-sm text-slate-900">
                        Total ({getFilteredBreakdown(activeBreakdown).length} loans)
                      </td>
                      <td className="py-2.5 px-2 text-right text-sm font-mono text-slate-900">
                        {formatCurrency(getFilteredBreakdown(activeBreakdown).reduce((sum, d) => sum + (d.value || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>

              {getFilteredBreakdown(activeBreakdown).length === 0 && (
                <div className="py-8 text-center text-slate-500">
                  {searchTerm ? 'No loans match your search' : 'No data available'}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
