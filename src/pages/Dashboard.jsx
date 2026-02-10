import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';
import { CURRENT_SCHEMA_VERSION } from '@/lib/backupSchema';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Plus,
  Clock,
  CheckCircle2,
  CircleDot,
  HardDrive,
  Loader2
} from 'lucide-react';
import { isPast, isToday, format, startOfMonth, endOfMonth, isWithinInterval, subMonths, differenceInDays } from 'date-fns';
import QuickStatsRow from '@/components/dashboard/QuickStatsRow';
import KeyMetricsGrid from '@/components/dashboard/KeyMetricsGrid';
import RecentPaymentsTable from '@/components/dashboard/RecentPaymentsTable';
import InvestorSummaryTable from '@/components/dashboard/InvestorSummaryTable';
import AlertsSection from '@/components/dashboard/AlertsSection';
import BreakdownModal from '@/components/dashboard/BreakdownModal';

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { currentOrganization, isLoadingOrgs, currentTheme } = useOrganization();
  const { isConnected: driveConnected, backupFolderId, uploadFileToFolder } = useGoogleDrive();
  const [activeBreakdown, setActiveBreakdown] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);

  // Dashboard queries use 2-minute stale time to reduce unnecessary refetches
  const DASHBOARD_STALE_TIME = 2 * 60 * 1000; // 2 minutes

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['loans', currentOrganization?.id],
    queryFn: async () => {
      const allLoans = await api.entities.Loan.list('-created_date');
      return allLoans.filter(loan => !loan.is_deleted);
    },
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  const { data: borrowers = [], isLoading: borrowersLoading } = useQuery({
    queryKey: ['borrowers', currentOrganization?.id],
    queryFn: () => api.entities.Borrower.list(),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  // Transactions still needed for Fixed Charge and Irregular Income product types
  const { data: transactions = [] } = useQuery({
    queryKey: ['all-transactions', currentOrganization?.id],
    queryFn: () => api.entities.Transaction.listAll('-date'),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  // Schedules needed for arrears calculation
  const { data: schedules = [] } = useQuery({
    queryKey: ['all-schedules', currentOrganization?.id],
    queryFn: () => api.entities.RepaymentSchedule.listAll('due_date'),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  const { data: loanProperties = [] } = useQuery({
    queryKey: ['loan-properties-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.LoanProperty.filter({ status: 'Active' }),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.Property.list(),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  const { data: investors = [] } = useQuery({
    queryKey: ['investors-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.Investor.list(),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investor-transactions-dashboard', currentOrganization?.id],
    queryFn: () => api.entities.InvestorTransaction.list('-date', 100),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  // Query for last backup date from audit logs
  const { data: lastBackup } = useQuery({
    queryKey: ['last-backup', currentOrganization?.id],
    queryFn: async () => {
      const logs = await api.entities.AuditLog.filter({ action: 'org_backup_export' }, '-created_at');
      return logs.length > 0 ? logs[0] : null;
    },
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  // Query for cached organization summary
  const { data: orgSummary } = useQuery({
    queryKey: ['org-summary', currentOrganization?.id],
    queryFn: () => api.entities.OrganizationSummary.get(),
    enabled: !!currentOrganization,
    staleTime: DASHBOARD_STALE_TIME
  });

  // Calculate metrics
  const liveLoans = useMemo(() => loans.filter(l => l.status === 'Live' || l.status === 'Active'), [loans]);
  const settledLoans = useMemo(() => loans.filter(l => l.status === 'Closed'), [loans]);
  const pendingLoans = useMemo(() => loans.filter(l => l.status === 'Pending'), [loans]);
  const writtenOffLoans = useMemo(() => loans.filter(l => l.status === 'Written Off'), [loans]);

  // Calculate live metrics for each loan using daily accrual
  // Uses cached principal_remaining from database when available for performance
  const loanMetrics = useMemo(() => liveLoans.map(loan => {
    // Transactions only needed for Fixed Charge and Irregular Income product types
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
      // Irregular Income: no interest calculation, but calculate live principal from transactions
      const principalPaid = loanTransactions
        .filter(t => !t.is_deleted && t.type === 'Repayment')
        .reduce((sum, t) => sum + (t.principal_applied || 0), 0);
      // Get further advances (disbursements after start date)
      const startDate = new Date(loan.start_date);
      startDate.setHours(0, 0, 0, 0);
      const furtherAdvances = loanTransactions
        .filter(t => !t.is_deleted && t.type === 'Disbursement')
        .filter(t => {
          const txDate = new Date(t.date);
          txDate.setHours(0, 0, 0, 0);
          return txDate > startDate;
        })
        .reduce((sum, t) => sum + ((t.gross_amount ?? t.amount) || 0), 0);
      const principalRemaining = (loan.principal_amount || 0) + furtherAdvances - principalPaid;

      return {
        loan,
        principalRemaining: Math.max(0, principalRemaining),
        interestRemaining: 0,
        interestAccrued: 0,
        interestPaid: 0,
        isIrregularIncome: true
      };
    }

    // Standard loans: use cached values (updated by queueBalanceCacheUpdate after transactions)
    const interestRemaining = loan.interest_remaining !== null && loan.interest_remaining !== undefined
      ? loan.interest_remaining
      : 0; // Fallback - cache should always exist for live loans

    const principalRemaining = loan.principal_remaining !== null && loan.principal_remaining !== undefined
      ? loan.principal_remaining
      : (loan.principal_amount || 0);

    return {
      loan,
      principalRemaining,
      interestRemaining,
      interestAccrued: 0,
      interestPaid: 0
    };
  }), [liveLoans, transactions]);

  // Calculate totals from live metrics
  // Use cached org summary when available for faster rendering, otherwise calculate live
  const { principalOutstanding, interestOutstanding, totalOutstanding } = useMemo(() => {
    const calculatedPrincipalOutstanding = loanMetrics.reduce((sum, m) => sum + Math.max(0, m.principalRemaining), 0);
    const calculatedInterestOutstanding = loanMetrics.reduce((sum, m) => sum + Math.max(0, m.interestRemaining), 0);

    // Use per-loan cached values summed up (not orgSummary - it's calculated differently by nightly job)
    return {
      principalOutstanding: calculatedPrincipalOutstanding,
      interestOutstanding: calculatedInterestOutstanding,
      totalOutstanding: calculatedPrincipalOutstanding + calculatedInterestOutstanding
    };
  }, [loanMetrics]);

  // Calculate live portfolio financial metrics
  // Use cached principal_remaining for accurate balances
  const livePortfolioMetrics = useMemo(() => liveLoans.reduce((acc, loan) => {
    // Use cached principal_remaining if available (most accurate)
    const loanMetric = loanMetrics.find(m => m.loan.id === loan.id);
    const currentPrincipalBalance = loanMetric?.principalRemaining ?? loan.principal_remaining ?? loan.principal_amount ?? 0;

    // Gross = what borrower owes (principal remaining)
    // Net = what cash we actually paid out that's still outstanding
    // The difference is the fees that were deducted at source (arrangement + additional)
    const arrangementFee = loan.arrangement_fee || 0;
    const additionalFees = loan.additional_deducted_fees || 0;
    const totalDeductions = arrangementFee + additionalFees;

    // If principal is fully repaid, net is also 0
    // Otherwise, net = gross - fees (but not less than 0)
    const grossOutstanding = Math.max(0, currentPrincipalBalance);
    const netOutstanding = Math.max(0, currentPrincipalBalance - totalDeductions);

    return {
      grossDisbursed: acc.grossDisbursed + grossOutstanding,
      netDisbursed: acc.netDisbursed + netOutstanding,
      feesDeducted: acc.feesDeducted + totalDeductions
    };
  }, { grossDisbursed: 0, netDisbursed: 0, feesDeducted: 0 }), [liveLoans, loanMetrics]);

  // Fees due = arrangement fees from live loans
  const feesDue = useMemo(() => liveLoans.reduce((sum, loan) => sum + (loan.arrangement_fee || 0), 0), [liveLoans]);

  // Exit fees due = exit fees from live loans minus fees already received
  // Calculate fees received per loan from transactions
  const feesReceivedByLoan = useMemo(() => transactions.reduce((acc, t) => {
    const feesApplied = parseFloat(t.fees_applied) || 0;
    if (t.type === 'Repayment' && feesApplied > 0) {
      acc[t.loan_id] = (acc[t.loan_id] || 0) + feesApplied;
    }
    return acc;
  }, {}), [transactions]);

  const exitFeesDue = useMemo(() => liveLoans.reduce((sum, loan) => {
    const exitFee = loan.exit_fee || 0;
    const feesReceived = feesReceivedByLoan[loan.id] || 0;
    const remaining = Math.max(0, exitFee - feesReceived);
    return sum + remaining;
  }, 0), [liveLoans, feesReceivedByLoan]);

  // Other deducted fees = additional fees deducted at source (admin fees, broker fees, etc.)
  const otherDeductedFees = useMemo(() => liveLoans.reduce((sum, loan) => sum + (loan.additional_deducted_fees || 0), 0), [liveLoans]);

  // Total outstanding investor capital (what we owe investors)
  const totalInvestorOutstanding = useMemo(() => investors
    .filter(inv => inv.status === 'Active')
    .reduce((sum, inv) => sum + (inv.current_capital_balance || 0), 0), [investors]);

  // Organization health metrics
  const healthMetrics = useMemo(() => ({
    netDisbursed: livePortfolioMetrics.netDisbursed,
    investorOutstanding: totalInvestorOutstanding,
    difference: livePortfolioMetrics.netDisbursed - totalInvestorOutstanding,
    ratio: totalInvestorOutstanding > 0
      ? (livePortfolioMetrics.netDisbursed / totalInvestorOutstanding) * 100
      : 0
  }), [livePortfolioMetrics.netDisbursed, totalInvestorOutstanding]);

  // Expected profit = gross disbursed + fees + interest outstanding - net disbursed
  // This shows: what borrowers owe (gross + fees + interest) minus what we actually paid out (net)
  const expectedProfit = useMemo(() => livePortfolioMetrics.grossDisbursed + feesDue + interestOutstanding - livePortfolioMetrics.netDisbursed, [livePortfolioMetrics.grossDisbursed, livePortfolioMetrics.netDisbursed, feesDue, interestOutstanding]);

  // Create breakdown data for each clickable metric
  // Use cached principal_remaining for accurate balances
  const breakdownData = useMemo(() => ({
    grossDisbursed: loanMetrics
      .filter(m => m.principalRemaining > 0)
      .map(m => ({ loan: m.loan, value: Math.max(0, m.principalRemaining) }))
      .sort((a, b) => b.value - a.value),

    netDisbursed: loanMetrics
      .filter(m => m.principalRemaining > 0)
      .map(m => {
        const fee = m.loan.arrangement_fee || 0;
        const additionalFees = m.loan.additional_deducted_fees || 0;
        return { loan: m.loan, value: Math.max(0, m.principalRemaining - fee - additionalFees) };
      })
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value),

    feesDue: liveLoans
      .filter(loan => (loan.arrangement_fee || 0) > 0)
      .map(loan => ({ loan, value: loan.arrangement_fee || 0 }))
      .sort((a, b) => b.value - a.value),

    exitFeesDue: liveLoans
      .map(loan => {
        const exitFee = loan.exit_fee || 0;
        const feesReceived = feesReceivedByLoan[loan.id] || 0;
        return { loan, value: Math.max(0, exitFee - feesReceived) };
      })
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value),

    otherDeductedFees: liveLoans
      .filter(loan => (loan.additional_deducted_fees || 0) > 0)
      .map(loan => ({ loan, value: loan.additional_deducted_fees || 0 }))
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
  }), [loanMetrics, liveLoans, feesReceivedByLoan]);

  const breakdownTitles = {
    grossDisbursed: 'Gross Disbursed Breakdown',
    netDisbursed: 'Net Disbursed Breakdown',
    feesDue: 'Arrangement Fees Breakdown',
    exitFeesDue: 'Exit Fees Breakdown',
    otherDeductedFees: 'Other Deducted Fees Breakdown',
    interestDue: 'Interest Due Breakdown',
    principalOS: 'Principal Outstanding Breakdown',
    borrowers: 'Active Loans'
  };

  const breakdownDescriptions = {
    grossDisbursed: 'Principal amounts owed by each borrower',
    netDisbursed: 'Cash paid out to each borrower',
    feesDue: 'Arrangement fees for each loan',
    exitFeesDue: 'Exit fees for each loan',
    otherDeductedFees: 'Additional fees deducted at source (broker, admin, etc.)',
    interestDue: 'Accrued interest outstanding per loan',
    principalOS: 'Remaining principal balance per loan',
    borrowers: 'All live loans in the portfolio'
  };

  // Filter breakdown data by search term
  const getFilteredBreakdown = useCallback((key) => {
    if (!breakdownData[key]) return [];
    return breakdownData[key].filter(item =>
      item.loan.borrower_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.loan.loan_number?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [breakdownData, searchTerm]);

  // Borrowers in credit (negative interest = overpaid)
  const borrowersInCredit = useMemo(() => loanMetrics
    .filter(m => m.interestRemaining < -0.01) // More than 1p credit
    .map(m => ({
      loan: m.loan,
      creditAmount: Math.abs(m.interestRemaining)
    }))
    .sort((a, b) => b.creditAmount - a.creditAmount), [loanMetrics]);

  // Highest interest balances (excluding Fixed Charge and Irregular Income)
  const highestInterestBalances = useMemo(() => loanMetrics
    .filter(m => !m.isFixedCharge && !m.isIrregularIncome && m.interestRemaining > 0)
    .sort((a, b) => b.interestRemaining - a.interestRemaining)
    .slice(0, 5), [loanMetrics]);

  // Highest principal balances
  const highestPrincipalBalances = useMemo(() => loanMetrics
    .filter(m => m.principalRemaining > 0)
    .sort((a, b) => b.principalRemaining - a.principalRemaining)
    .slice(0, 5), [loanMetrics]);

  // Get recent repayments (last 10)
  const recentRepayments = useMemo(() => transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .map(tx => {
      const loan = loans.find(l => l.id === tx.loan_id);
      return { ...tx, loan };
    }), [transactions, loans]);

  // Calculate further advances per loan (for backward compat with other calculations)
  const getDisbursementsForLoan = useCallback((loanId) => {
    const disbursements = transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Disbursement')
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const furtherAdvances = disbursements.slice(1);
    return furtherAdvances.reduce((sum, t) => sum + ((t.gross_amount ?? t.amount) || 0), 0);
  }, [transactions]);

  // Calculate repayments from transactions
  const getRepaymentsForLoan = useCallback((loanId) => {
    return transactions
      .filter(t => t.loan_id === loanId && !t.is_deleted && t.type === 'Repayment')
      .reduce((acc, t) => ({
        principal: acc.principal + (t.principal_applied || 0),
        interest: acc.interest + (t.interest_applied || 0),
        total: acc.total + (t.amount || 0)
      }), { principal: 0, interest: 0, total: 0 });
  }, [transactions]);

  // Total ever disbursed
  const totalDisbursed = useMemo(() => loans.reduce((sum, l) => {
    return sum + (l.principal_amount || 0) + getDisbursementsForLoan(l.id);
  }, 0), [loans, getDisbursementsForLoan]);

  // Total repaid
  const totalRepaid = useMemo(() => transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment')
    .reduce((sum, t) => sum + (t.amount || 0), 0), [transactions]);

  // Calculate arrears
  const arrears = useMemo(() => schedules
    .filter(s => {
      const loan = loans.find(l => l.id === s.loan_id);
      if (!loan || (loan.status !== 'Live' && loan.status !== 'Active')) return false;
      const isPastDue = isPast(new Date(s.due_date)) && !isToday(new Date(s.due_date));
      return isPastDue && s.status !== 'Paid';
    })
    .reduce((sum, s) => {
      const totalPaid = (s.principal_paid || 0) + (s.interest_paid || 0);
      return sum + Math.max(0, (s.total_due || 0) - totalPaid);
    }, 0), [schedules, loans]);

  // Loans maturing soon (next 30 days)
  const today = useMemo(() => new Date(), []);
  const loansMaturing = useMemo(() => liveLoans.filter(l => {
    if (!l.maturity_date) return false;
    const maturityDate = new Date(l.maturity_date);
    const daysUntil = differenceInDays(maturityDate, today);
    return daysUntil >= 0 && daysUntil <= 30;
  }), [liveLoans, today]);

  // This month's collections
  const thisMonth = useMemo(() => ({ start: startOfMonth(today), end: endOfMonth(today) }), [today]);
  const lastMonth = useMemo(() => ({ start: startOfMonth(subMonths(today, 1)), end: endOfMonth(subMonths(today, 1)) }), [today]);

  const thisMonthCollections = useMemo(() => transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment' && isWithinInterval(new Date(t.date), thisMonth))
    .reduce((sum, t) => sum + (t.amount || 0), 0), [transactions, thisMonth]);

  const lastMonthCollections = useMemo(() => transactions
    .filter(t => !t.is_deleted && t.type === 'Repayment' && isWithinInterval(new Date(t.date), lastMonth))
    .reduce((sum, t) => sum + (t.amount || 0), 0), [transactions, lastMonth]);

  const collectionsChange = useMemo(() => lastMonthCollections > 0
    ? ((thisMonthCollections - lastMonthCollections) / lastMonthCollections) * 100
    : 0, [thisMonthCollections, lastMonthCollections]);

  // This month's disbursements
  const thisMonthDisbursements = useMemo(() => transactions
    .filter(t => !t.is_deleted && t.type === 'Disbursement' && isWithinInterval(new Date(t.date), thisMonth))
    .reduce((sum, t) => sum + (t.amount || 0), 0), [transactions, thisMonth]);

  // Add initial loan disbursements for this month
  const thisMonthNewLoans = useMemo(() => loans
    .filter(l => isWithinInterval(new Date(l.start_date), thisMonth))
    .reduce((sum, l) => sum + (l.principal_amount || 0), 0), [loans, thisMonth]);

  const totalThisMonthDisbursements = useMemo(() => thisMonthDisbursements + thisMonthNewLoans, [thisMonthDisbursements, thisMonthNewLoans]);

  // Security metrics
  // Applies security valuation discount from organization settings for LTV calculations
  const securityMetrics = useMemo(() => {
    const LTV_THRESHOLD = 80;
    let loansWithHighLTV = 0;
    let totalSecurityValue = 0;

    // Get discount percentage from org settings
    const discountPercent = currentOrganization?.settings?.security_valuation_discount || 0;

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

      // Apply discount for LTV calculation
      const discountedSecurityValue = loanSecurityValue * (1 - discountPercent / 100);
      const outstandingPrincipal = (loan.principal_amount || 0) - (getRepaymentsForLoan(loan.id).principal);
      const ltv = discountedSecurityValue > 0 ? (outstandingPrincipal / discountedSecurityValue) * 100 : 0;
      if (ltv > LTV_THRESHOLD) loansWithHighLTV++;
    });

    return { loansWithHighLTV, totalSecurityValue };
  }, [liveLoans, loanProperties, properties, currentOrganization?.settings?.security_valuation_discount, getRepaymentsForLoan]);

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
      'loan_comments': 'LoanComment',
      'InvestorTransaction': 'InvestorTransaction',
      'investor_interest': 'InvestorInterest',
      'transactions': 'Transaction',
      'repayment_schedules': 'RepaymentSchedule',
      'loan_properties': 'LoanProperty',
      'expenses': 'Expense',
      'value_history': 'ValueHistory',
      'bank_statements': 'BankStatement',
      'other_income': 'OtherIncome',
      'property_documents': 'PropertyDocument',
      'borrower_loan_preferences': 'BorrowerLoanPreference',
      'receipt_drafts': 'ReceiptDraft',
      'reconciliation_patterns': 'ReconciliationPattern',
      'reconciliation_entries': 'ReconciliationEntry',
      'accepted_orphans': 'AcceptedOrphan',
      'audit_logs': 'AuditLog',
      'invitations': 'Invitation',
      'nightly_job_runs': 'NightlyJobRun',
      'organization_summary': 'OrganizationSummary',
      'letter_templates': 'LetterTemplate',
      'generated_letters': 'GeneratedLetter',
      'user_profiles': 'UserProfile'
    };
    return map[tableName] || tableName;
  };

  // Handle backup export
  const handleBackupNow = useCallback(async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);

    const backup = {
      version: '2.0',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportDate: new Date().toISOString(),
      organizationId: currentOrganization.id,
      organizationName: currentOrganization.name,
      organizationSettings: currentOrganization.settings || {},
      tables: {},
      metadata: { recordCounts: {} }
    };

    // Tables to export in FK-safe order (all org-scoped data for full rebuild)
    const tables = [
      'loan_products', 'investor_products', 'expense_types', 'first_charge_holders',
      'borrowers', 'properties', 'Investor',
      'loans', 'loan_comments', 'InvestorTransaction', 'investor_interest',
      'transactions', 'repayment_schedules', 'loan_properties', 'expenses',
      'value_history', 'bank_statements', 'other_income', 'property_documents',
      'borrower_loan_preferences', 'receipt_drafts',
      'reconciliation_patterns', 'reconciliation_entries',
      'accepted_orphans',
      'audit_logs',
      'invitations',
      'nightly_job_runs',
      'organization_summary',
      'letter_templates',
      'generated_letters',
      'user_profiles'
    ];

    try {
      for (const table of tables) {
        const entityName = getEntityName(table);
        try {
          // Use listAll to get ALL records (no 1000-row limit)
          const data = await api.entities[entityName].listAll();
          backup.tables[table] = data;
          backup.metadata.recordCounts[table] = data.length;
        } catch {
          backup.tables[table] = [];
          backup.metadata.recordCounts[table] = 0;
        }
      }

      // Generate backup JSON
      const backupJson = JSON.stringify(backup, null, 2);
      const safeName = currentOrganization.name.replace(/[^a-zA-Z0-9]/g, '-');
      const fileName = `backup-${safeName}-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;

      // Download file locally
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const totalRecords = Object.values(backup.metadata.recordCounts).reduce((a, b) => a + b, 0);

      // Upload to Google Drive if folder is configured
      let driveUploadSuccess = false;
      if (backupFolderId && driveConnected) {
        try {
          // Use compact JSON and gzip compress for Drive upload
          // This reduces ~6MB+ JSON to ~500KB-1MB, well within Edge Function limits
          const compactJson = JSON.stringify(backup);
          const encoder = new TextEncoder();
          const compressedStream = new Blob([encoder.encode(compactJson)])
            .stream()
            .pipeThrough(new CompressionStream('gzip'));
          const compressedBuffer = await new Response(compressedStream).arrayBuffer();
          const compressedBytes = new Uint8Array(compressedBuffer);
          let binary = '';
          for (let i = 0; i < compressedBytes.length; i++) {
            binary += String.fromCharCode(compressedBytes[i]);
          }
          const base64Content = btoa(binary);
          console.log(`[Backup] Compressed: ${(compactJson.length / 1024 / 1024).toFixed(1)}MB → ${(compressedBytes.length / 1024).toFixed(0)}KB`);
          await uploadFileToFolder(backupFolderId, fileName, base64Content, 'application/json', { compressed: 'gzip' });
          driveUploadSuccess = true;
        } catch (driveErr) {
          console.error('Google Drive upload failed:', driveErr);
          if (driveErr.message?.toLowerCase().includes('scopes')) {
            toast.error('Google Drive permissions outdated. Please disconnect and reconnect Google Drive in Settings.');
          }
        }
      }

      // Log audit
      await logAudit({
        action: AuditAction.ORG_BACKUP_EXPORT,
        entityType: EntityType.ORGANIZATION,
        entityId: currentOrganization.id,
        entityName: currentOrganization.name,
        details: { totalRecords, recordCounts: backup.metadata.recordCounts, uploadedToDrive: driveUploadSuccess }
      });

      if (driveUploadSuccess) {
        toast.success(`Backup complete and uploaded to Google Drive (${totalRecords.toLocaleString()} records)`);
      } else {
        toast.success(`Backup complete (${totalRecords.toLocaleString()} records)`);
      }
      queryClient.invalidateQueries(['last-backup']);
    } catch (err) {
      toast.error('Backup failed: ' + err.message);
    } finally {
      setIsBackingUp(false);
    }
  }, [isBackingUp, currentOrganization, backupFolderId, driveConnected, uploadFileToFolder, queryClient, getEntityName]);

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
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleBackupNow}
                      disabled={isBackingUp}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isBackingUp
                          ? 'bg-slate-100 text-slate-400'
                          : backupNeeded
                            ? 'bg-amber-100 hover:bg-amber-200 text-amber-600'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-500'
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
                    {backupNeeded ? (
                      <>
                        <p className="font-medium text-amber-600">Backup Recommended</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {daysSinceLastBackup === null
                            ? 'No backup on record'
                            : `Last backup: ${daysSinceLastBackup} days ago`}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">Backup Data</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Last backup: {daysSinceLastBackup} days ago
                        </p>
                      </>
                    )}
                    <p className="text-xs text-slate-400">Click to backup now</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
              {writtenOffLoans.length > 0 && (
                <Link to={createPageUrl('Loans?status=Written Off')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">{writtenOffLoans.length} Written Off</span>
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
              <div
                className="cursor-pointer hover:opacity-80 transition-opacity text-right"
                onClick={() => setActiveBreakdown('borrowers')}
              >
                <p className="text-slate-400 text-xs mb-1">Live Loans</p>
                <p className="text-2xl font-bold">{liveLoans.length}</p>
                <p className="text-slate-500 text-xs mt-1">Active loans</p>
              </div>
            </div>

            {/* Organization Health Card */}
            <div className="bg-white/10 rounded-xl p-4 mt-4 backdrop-blur-sm">
              <p className="text-slate-300 text-sm font-medium mb-3">Organization Health</p>

              {/* Net vs Investor comparison */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div
                  className="cursor-pointer hover:bg-white/10 rounded-lg p-2 -m-2 transition-colors"
                  onClick={() => setActiveBreakdown('netDisbursed')}
                >
                  <p className="text-slate-400 text-xs">Net Disbursed</p>
                  <p className="text-lg font-semibold">{formatCurrency(healthMetrics.netDisbursed)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Investor Outstanding</p>
                  <p className="text-lg font-semibold">{formatCurrency(healthMetrics.investorOutstanding)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Difference</p>
                  <p className={`text-lg font-semibold ${healthMetrics.difference >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {healthMetrics.difference >= 0 ? '+' : ''}{formatCurrency(healthMetrics.difference)}
                  </p>
                  <p className="text-slate-500 text-xs">
                    {healthMetrics.ratio.toFixed(1)}% coverage
                  </p>
                </div>
              </div>

              {/* Fees and Interest row */}
              <div className="grid grid-cols-5 gap-3 pt-3 border-t border-white/10">
                <div
                  className="cursor-pointer hover:bg-white/10 rounded-lg p-2 -m-2 transition-colors"
                  onClick={() => setActiveBreakdown('feesDue')}
                >
                  <p className="text-slate-400 text-xs">Arrangement Fees</p>
                  <p className="text-base font-semibold">{formatCurrency(feesDue)}</p>
                </div>
                <div
                  className="cursor-pointer hover:bg-white/10 rounded-lg p-2 -m-2 transition-colors"
                  onClick={() => setActiveBreakdown('exitFeesDue')}
                >
                  <p className="text-slate-400 text-xs">Exit Fees</p>
                  <p className="text-base font-semibold">{formatCurrency(exitFeesDue)}</p>
                </div>
                <div
                  className="cursor-pointer hover:bg-white/10 rounded-lg p-2 -m-2 transition-colors"
                  onClick={() => setActiveBreakdown('otherDeductedFees')}
                >
                  <p className="text-slate-400 text-xs">Other Fees</p>
                  <p className="text-base font-semibold">{formatCurrency(otherDeductedFees)}</p>
                </div>
                <div
                  className="cursor-pointer hover:bg-white/10 rounded-lg p-2 -m-2 transition-colors"
                  onClick={() => setActiveBreakdown('interestDue')}
                >
                  <p className="text-slate-400 text-xs">Interest Due</p>
                  <p className="text-base font-semibold">{formatCurrency(interestOutstanding)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Income on Accrual</p>
                  <p className={`text-base font-semibold ${expectedProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {expectedProfit >= 0 ? '+' : ''}{formatCurrency(expectedProfit)}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats Row */}
        <QuickStatsRow
          thisMonthCollections={thisMonthCollections}
          collectionsChange={collectionsChange}
          totalThisMonthDisbursements={totalThisMonthDisbursements}
          settledLoansCount={settledLoans.length}
          totalRepaid={totalRepaid}
          pendingLoans={pendingLoans}
        />

        {/* Key Metrics Grid - Highest Balances & Credits */}
        <KeyMetricsGrid
          highestInterestBalances={highestInterestBalances}
          highestPrincipalBalances={highestPrincipalBalances}
          borrowersInCredit={borrowersInCredit}
        />

        {/* Recent Payments */}
        <RecentPaymentsTable recentRepayments={recentRepayments} />

        {/* Investor Summary Card */}
        <InvestorSummaryTable investors={investors} investorTransactions={investorTransactions} />

        {/* Alerts Section */}
        <AlertsSection securityMetrics={securityMetrics} loansMaturing={loansMaturing} />

        {/* Breakdown Modal */}
        <BreakdownModal
          activeBreakdown={activeBreakdown}
          setActiveBreakdown={setActiveBreakdown}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          breakdownTitles={breakdownTitles}
          breakdownDescriptions={breakdownDescriptions}
          getFilteredBreakdown={getFilteredBreakdown}
        />
      </div>
    </div>
  );
}
