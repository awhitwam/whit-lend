import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck, Building2, Plus, Trash2, AlertTriangle, Loader2, Receipt, TrendingUp, Clock, Play, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import CreateOrganizationDialog from '@/components/organization/CreateOrganizationDialog';
import { useOrganization } from '@/lib/OrganizationContext';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { supabase } from '@/lib/supabaseClient';
import { format } from 'date-fns';

export default function SuperAdmin() {
  const { canAdmin, currentOrganization } = useOrganization();
  const queryClient = useQueryClient();
  const [isCreateOrgOpen, setIsCreateOrgOpen] = useState(false);

  // Clear data state
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [clearProgress, setClearProgress] = useState({ current: 0, total: 0, step: '' });

  // Nightly jobs state
  const [runningJob, setRunningJob] = useState(null);
  const [jobResult, setJobResult] = useState(null);

  // Fetch recent job runs
  const { data: recentJobRuns = [] } = useQuery({
    queryKey: ['nightly-job-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nightly_job_runs')
        .select('*')
        .order('run_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    }
  });

  // Run nightly job mutation
  const runNightlyJobMutation = useMutation({
    mutationFn: async (tasks) => {
      setRunningJob(tasks.join(', '));
      setJobResult(null);

      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nightly-jobs`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ tasks })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to run nightly jobs');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setJobResult(data);
      setRunningJob(null);
      queryClient.invalidateQueries({ queryKey: ['nightly-job-runs'] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
    },
    onError: (error) => {
      setJobResult({ error: error.message });
      setRunningJob(null);
    }
  });

  const addLog = (message) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Clear all data function
  const clearAllData = async () => {
    addLog('Clearing existing data...');

    // Delete in correct order due to foreign key constraints
    // FK chain: value_history → loan_properties → loans → borrowers
    //           transactions → loans
    //           repayment_schedules → loans
    //           expenses → loans
    //           audit_logs (entity_id may reference loans/borrowers but no FK)

    // 1. Delete audit logs for current organization (using org-filtered API)
    setClearProgress({ current: 1, total: 11, step: 'Deleting audit logs...' });
    addLog(`  Deleting audit logs for current organization...`);
    try {
      const auditLogs = await api.entities.AuditLog.list();
      if (auditLogs.length > 0) {
        addLog(`    Found ${auditLogs.length} audit logs in current organization`);
        for (let i = 0; i < auditLogs.length; i += 100) {
          const batch = auditLogs.slice(i, i + 100);
          for (const log of batch) {
            await api.entities.AuditLog.delete(log.id);
          }
          addLog(`    Deleted ${Math.min(i + 100, auditLogs.length)} of ${auditLogs.length} audit logs...`);
        }
        addLog(`    Audit logs deletion complete: ${auditLogs.length} deleted`);
      } else {
        addLog(`    No audit logs found in current organization`);
      }
    } catch (e) {
      addLog(`  Note: Could not delete audit logs: ${e.message}`);
    }

    // 2. Delete value_history FIRST (references loan_properties via loan_property_id)
    setClearProgress({ current: 2, total: 11, step: 'Deleting value history...' });
    try {
      const valueHistory = await api.entities.ValueHistory.list();
      if (valueHistory.length > 0) {
        addLog(`  Deleting ${valueHistory.length} value history records...`);
        for (const vh of valueHistory) {
          await api.entities.ValueHistory.delete(vh.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete value history: ${e.message}`);
    }

    // 3. Delete loan_properties (references loans via loan_id, properties via property_id)
    setClearProgress({ current: 3, total: 11, step: 'Deleting loan-property links...' });
    try {
      const loanProperties = await api.entities.LoanProperty.list();
      if (loanProperties.length > 0) {
        addLog(`  Deleting ${loanProperties.length} loan-property links...`);
        for (const lp of loanProperties) {
          await api.entities.LoanProperty.delete(lp.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete loan-properties: ${e.message}`);
    }

    // 4. Delete properties (no FK to loans, but loan_properties references it)
    setClearProgress({ current: 4, total: 11, step: 'Deleting properties...' });
    try {
      const properties = await api.entities.Property.list();
      if (properties.length > 0) {
        addLog(`  Deleting ${properties.length} properties...`);
        for (const p of properties) {
          await api.entities.Property.delete(p.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete properties: ${e.message}`);
    }

    // 5. Delete transactions for current organization (using org-filtered API)
    setClearProgress({ current: 5, total: 11, step: 'Deleting transactions...' });
    addLog(`  Deleting transactions for current organization...`);
    try {
      const transactions = await api.entities.Transaction.list();
      if (transactions.length > 0) {
        addLog(`    Found ${transactions.length} transactions in current organization`);
        let deletedSoFar = 0;
        for (let i = 0; i < transactions.length; i += 100) {
          const batch = transactions.slice(i, i + 100);
          for (const tx of batch) {
            await api.entities.Transaction.delete(tx.id);
          }
          deletedSoFar = Math.min(i + 100, transactions.length);
          addLog(`    Deleted ${deletedSoFar} of ${transactions.length} transactions...`);
        }
        addLog(`    Transactions deletion complete: ${transactions.length} deleted`);
      } else {
        addLog(`    No transactions found in current organization`);
      }
    } catch (err) {
      addLog(`    Error during transaction deletion: ${err.message}`);
    }

    // 6. Delete repayment schedules for current organization (using org-filtered API)
    setClearProgress({ current: 6, total: 11, step: 'Deleting repayment schedules...' });
    addLog(`  Deleting repayment schedules for current organization...`);
    try {
      const schedules = await api.entities.RepaymentSchedule.list();
      if (schedules.length > 0) {
        addLog(`    Found ${schedules.length} schedules in current organization`);
        let deletedSoFar = 0;
        for (let i = 0; i < schedules.length; i += 100) {
          const batch = schedules.slice(i, i + 100);
          for (const sched of batch) {
            await api.entities.RepaymentSchedule.delete(sched.id);
          }
          deletedSoFar = Math.min(i + 100, schedules.length);
          addLog(`    Deleted ${deletedSoFar} of ${schedules.length} schedules...`);
        }
        addLog(`    Schedules deletion complete: ${schedules.length} deleted`);
      } else {
        addLog(`    No schedules found in current organization`);
      }
    } catch (err) {
      addLog(`    Error during schedule deletion: ${err.message}`);
    }

    // 7. Delete expenses (references loans via loan_id - nullable)
    setClearProgress({ current: 7, total: 11, step: 'Deleting expenses...' });
    try {
      const expenses = await api.entities.Expense.list();
      if (expenses.length > 0) {
        addLog(`  Deleting ${expenses.length} expenses...`);
        let expenseErrors = 0;
        for (const e of expenses) {
          try {
            await api.entities.Expense.delete(e.id);
          } catch (err) {
            expenseErrors++;
            if (expenseErrors <= 2) {
              addLog(`    Error deleting expense ${e.id}: ${err.message}`);
            }
          }
        }
        if (expenseErrors > 0) {
          addLog(`    Failed to delete ${expenseErrors} expenses`);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not list/delete expenses: ${e.message}`);
    }

    // 8. Delete investor transactions (does NOT reference loans, only investors)
    setClearProgress({ current: 8, total: 11, step: 'Deleting investor transactions...' });
    try {
      const investorTx = await api.entities.InvestorTransaction.list();
      if (investorTx.length > 0) {
        addLog(`  Deleting ${investorTx.length} investor transactions...`);
        for (const it of investorTx) {
          await api.entities.InvestorTransaction.delete(it.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete investor transactions: ${e.message}`);
    }

    // 9. Delete loans (references borrowers via borrower_id, self-references via restructured_from_loan_id)
    setClearProgress({ current: 9, total: 11, step: 'Deleting loans...' });
    let loans = await api.entities.Loan.list();
    const initialLoanCount = loans.length;
    addLog(`  Deleting ${loans.length} loans...`);

    if (loans.length > 0) {
      const withRestructureRef = loans.filter(l => l.restructured_from_loan_id).length;
      addLog(`    Found ${withRestructureRef} loans with restructure references`);

      if (withRestructureRef > 0) {
        addLog(`    Clearing all restructure references...`);
        let clearErrors = 0;
        for (const l of loans) {
          if (l.restructured_from_loan_id) {
            try {
              await api.entities.Loan.update(l.id, { restructured_from_loan_id: null });
            } catch (e) {
              clearErrors++;
              if (clearErrors <= 3) {
                addLog(`      Error clearing ref on loan ${l.loan_number}: ${e.message}`);
              }
            }
          }
        }
        if (clearErrors > 0) {
          addLog(`      Failed to clear ${clearErrors} restructure references`);
        }

        const verifyLoans = await api.entities.Loan.list();
        const stillHaveRef = verifyLoans.filter(l => l.restructured_from_loan_id).length;
        if (stillHaveRef > 0) {
          addLog(`      WARNING: ${stillHaveRef} loans still have restructure references after clearing!`);
        } else {
          addLog(`    Restructure references cleared successfully.`);
        }
      } else {
        addLog(`    No restructure references to clear.`);
      }

      let remainingLoans = loans;
      let maxPasses = 10;
      let passCount = 0;
      let lastErrorSample = '';

      while (remainingLoans.length > 0 && passCount < maxPasses) {
        passCount++;
        const failedLoans = [];

        for (const l of remainingLoans) {
          try {
            await api.entities.Loan.delete(l.id);
          } catch (err) {
            if (failedLoans.length === 0) {
              lastErrorSample = err.message || String(err);
            }
            failedLoans.push({ loan: l, error: err.message });
          }
        }

        remainingLoans = failedLoans.map(f => f.loan);

        if (remainingLoans.length > 0) {
          addLog(`    Pass ${passCount}: ${remainingLoans.length} loans remaining...`);
          if (passCount === 1) {
            addLog(`      First error: ${lastErrorSample}`);
          }
        }
      }

      if (remainingLoans.length > 0) {
        addLog(`    ERROR: Could not delete ${remainingLoans.length} loans after ${maxPasses} passes`);
        addLog(`    Last error: ${lastErrorSample}`);
        addLog(`    Sample failing loan IDs:`);
        for (const loan of remainingLoans.slice(0, 3)) {
          addLog(`      - ${loan.loan_number || 'no#'} (id: ${loan.id})`);
        }
        throw new Error(`Failed to delete all loans. ${remainingLoans.length} loans could not be deleted due to foreign key constraints. Error: ${lastErrorSample}`);
      }

      addLog(`    Deleted ${initialLoanCount} loans successfully`);
    }

    // 10. Delete borrowers (no FK references to other tables)
    setClearProgress({ current: 10, total: 11, step: 'Deleting borrowers...' });
    const borrowers = await api.entities.Borrower.list();
    addLog(`  Deleting ${borrowers.length} borrowers...`);

    let borrowerErrors = 0;
    for (const b of borrowers) {
      try {
        await api.entities.Borrower.delete(b.id);
      } catch (err) {
        borrowerErrors++;
        if (borrowerErrors <= 3) {
          addLog(`    Error deleting borrower ${b.full_name}: ${err.message}`);
        }
      }
    }

    if (borrowerErrors > 0) {
      throw new Error(`Failed to delete ${borrowerErrors} borrowers. There may be loans still referencing them.`);
    }

    // 11. Delete investors
    setClearProgress({ current: 11, total: 11, step: 'Deleting investors...' });
    try {
      const investors = await api.entities.Investor.list();
      if (investors.length > 0) {
        addLog(`  Deleting ${investors.length} investors...`);
        for (const inv of investors) {
          await api.entities.Investor.delete(inv.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete investors: ${e.message}`);
    }

    addLog('Data cleared successfully');
  };

  // Clear investor data only function
  const clearInvestorDataOnly = async () => {
    addLog('Clearing investor data...');

    // 1. Delete investor transactions first (references investors via investor_id)
    setClearProgress({ current: 1, total: 2, step: 'Deleting investor transactions...' });
    try {
      const investorTx = await api.entities.InvestorTransaction.list();
      if (investorTx.length > 0) {
        addLog(`  Found ${investorTx.length} investor transactions to delete...`);
        let deletedCount = 0;
        for (const tx of investorTx) {
          await api.entities.InvestorTransaction.delete(tx.id);
          deletedCount++;
          if (deletedCount % 50 === 0) {
            addLog(`    Deleted ${deletedCount} of ${investorTx.length} transactions...`);
          }
        }
        addLog(`  Investor transactions deletion complete: ${deletedCount} deleted`);
      } else {
        addLog(`  No investor transactions found to delete`);
      }
    } catch (e) {
      throw new Error(`Could not delete investor transactions: ${e.message}`);
    }

    // 2. Delete investors
    setClearProgress({ current: 2, total: 2, step: 'Deleting investors...' });
    try {
      const investors = await api.entities.Investor.list();
      if (investors.length > 0) {
        addLog(`  Found ${investors.length} investors to delete...`);
        let deletedCount = 0;
        let investorErrors = 0;
        for (const inv of investors) {
          try {
            await api.entities.Investor.delete(inv.id);
            deletedCount++;
            if (deletedCount % 50 === 0) {
              addLog(`    Deleted ${deletedCount} of ${investors.length} investors...`);
            }
          } catch (err) {
            investorErrors++;
            if (investorErrors <= 3) {
              addLog(`    Error deleting investor ${inv.name}: ${err.message}`);
            }
          }
        }
        addLog(`  Investors deletion complete: ${deletedCount} deleted`);
        if (investorErrors > 0) {
          addLog(`  Failed to delete ${investorErrors} investors`);
        }
      } else {
        addLog(`  No investors found to delete`);
      }
    } catch (e) {
      throw new Error(`Could not list/delete investors: ${e.message}`);
    }

    addLog('Investor data cleared successfully');
  };

  // Clear expenses only function
  const clearExpensesOnly = async () => {
    addLog('Clearing expenses...');
    setClearProgress({ current: 1, total: 1, step: 'Deleting expenses...' });

    try {
      const expenses = await api.entities.Expense.list();
      if (expenses.length > 0) {
        addLog(`  Found ${expenses.length} expenses to delete...`);
        let deletedCount = 0;
        let expenseErrors = 0;

        for (const e of expenses) {
          try {
            await api.entities.Expense.delete(e.id);
            deletedCount++;
            if (deletedCount % 50 === 0) {
              addLog(`    Deleted ${deletedCount} of ${expenses.length} expenses...`);
            }
          } catch (err) {
            expenseErrors++;
            if (expenseErrors <= 3) {
              addLog(`    Error deleting expense ${e.id}: ${err.message}`);
            }
          }
        }

        addLog(`  Expenses deletion complete: ${deletedCount} deleted`);
        if (expenseErrors > 0) {
          addLog(`  Failed to delete ${expenseErrors} expenses`);
        }
      } else {
        addLog(`  No expenses found to delete`);
      }
    } catch (e) {
      throw new Error(`Could not list/delete expenses: ${e.message}`);
    }

    addLog('Expenses cleared successfully');
  };

  // Handle clear all data
  const handleClearAllData = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL data for "${currentOrganization?.name}"?\n\nThis will delete:\n• All borrowers\n• All loans\n• All transactions\n• All repayment schedules\n• All properties and security\n• All expenses\n• All investors and investor transactions\n• All audit logs\n\nThis action CANNOT be undone!`)) {
      return;
    }

    // Double confirmation for safety
    if (!window.confirm('This is a PERMANENT deletion. Type "DELETE" in the next prompt to confirm.')) {
      return;
    }

    const confirmText = window.prompt('Type "DELETE" to confirm permanent data deletion:');
    if (confirmText !== 'DELETE') {
      alert('Deletion cancelled. You must type DELETE exactly.');
      return;
    }

    setClearing(true);
    setClearResult(null);
    setLogs([]);

    try {
      await clearAllData();
      setClearResult({ success: true, message: 'All data cleared successfully!' });
      queryClient.invalidateQueries();
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  // Handle clear investor data only
  const handleClearInvestorData = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL investor data for "${currentOrganization?.name}"?\n\nThis will delete:\n• All investor transactions\n• All investor accounts\n\nInvestor products will be preserved. This action CANNOT be undone!`)) {
      return;
    }

    setClearing(true);
    setClearResult(null);
    setLogs([]);

    try {
      await clearInvestorDataOnly();
      setClearResult({ success: true, message: 'All investor data cleared successfully!' });
      queryClient.invalidateQueries(['investors']);
      queryClient.invalidateQueries(['investorTransactions']);
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  // Handle clear expenses only
  const handleClearExpenses = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL expenses for "${currentOrganization?.name}"?\n\nThis action CANNOT be undone!`)) {
      return;
    }

    setClearing(true);
    setClearResult(null);
    setLogs([]);

    try {
      await clearExpensesOnly();
      setClearResult({ success: true, message: 'All expenses cleared successfully!' });
      queryClient.invalidateQueries(['expenses']);
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  if (!canAdmin()) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="p-4 md:p-6 space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Super Admin</h1>
            <p className="text-slate-500 mt-1">Administrative functions</p>
          </div>
          <Alert className="border-amber-200 bg-amber-50">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              You don't have permission to access this page. Admin access is required.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Super Admin</h1>
          <p className="text-slate-500 mt-1">Administrative functions for managing organizations</p>
        </div>

        <Alert className="border-purple-200 bg-purple-50">
          <ShieldCheck className="w-4 h-4 text-purple-600" />
          <AlertDescription className="text-purple-800">
            <strong>Super Admin Area</strong> - These functions affect all organizations. Use with caution.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Create Organization */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-purple-600" />
                Organizations
              </CardTitle>
              <CardDescription>
                Create and manage organizations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-4">
                Create a new organization to separate loan portfolios, borrowers, and financial data.
                Each organization has its own users, settings, and theme.
              </p>
              <Button onClick={() => setIsCreateOrgOpen(true)} className="bg-purple-600 hover:bg-purple-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Organization
              </Button>
            </CardContent>
          </Card>

          {/* Clear Expenses Only */}
          <Card className="border-amber-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <Receipt className="w-5 h-5" />
                Clear Expenses
              </CardTitle>
              <CardDescription className="text-amber-700">
                Delete all expenses for {currentOrganization?.name || 'current organization'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-4">
                This will permanently delete all expense records. Expense types will be preserved.
                Use this before re-importing expenses from Loandisc.
              </p>
              <Button
                variant="outline"
                onClick={handleClearExpenses}
                disabled={clearing}
                className="border-amber-300 text-amber-900 hover:bg-amber-100"
              >
                {clearing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear All Expenses
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Clear Investor Data Only */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <TrendingUp className="w-5 h-5" />
                Clear Investor Data
              </CardTitle>
              <CardDescription className="text-blue-700">
                Delete all investors and transactions for {currentOrganization?.name || 'current organization'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-4">
                This will permanently delete all investor accounts and their transactions.
                Investor products will be preserved. Use this before re-importing investors from Loandisc.
              </p>
              <Button
                variant="outline"
                onClick={handleClearInvestorData}
                disabled={clearing}
                className="border-blue-300 text-blue-900 hover:bg-blue-100"
              >
                {clearing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear All Investor Data
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Nightly Jobs */}
          <Card className="border-slate-200 md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-slate-600" />
                Nightly Jobs
              </CardTitle>
              <CardDescription>
                Run scheduled maintenance tasks manually or view recent automated runs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Button
                  variant="outline"
                  onClick={() => runNightlyJobMutation.mutate(['investor_interest'])}
                  disabled={!!runningJob}
                  className="justify-start"
                >
                  {runningJob?.includes('investor_interest') ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Post Investor Interest
                </Button>

                <Button
                  variant="outline"
                  onClick={() => runNightlyJobMutation.mutate(['loan_schedules'])}
                  disabled={!!runningJob}
                  className="justify-start"
                >
                  {runningJob?.includes('loan_schedules') ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Update Loan Schedules
                </Button>

                <Button
                  variant="outline"
                  onClick={() => runNightlyJobMutation.mutate(['recalculate_balances'])}
                  disabled={!!runningJob}
                  className="justify-start"
                >
                  {runningJob?.includes('recalculate_balances') ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Recalculate Balances
                </Button>
              </div>

              <Button
                onClick={() => runNightlyJobMutation.mutate(['investor_interest', 'loan_schedules'])}
                disabled={!!runningJob}
                className="w-full"
              >
                {runningJob ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Running: {runningJob}
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Run All Nightly Jobs
                  </>
                )}
              </Button>

              {/* Job Result */}
              {jobResult && (
                <Alert className={jobResult.error ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}>
                  {jobResult.error ? (
                    <XCircle className="w-4 h-4 text-red-600" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  )}
                  <AlertDescription className={jobResult.error ? 'text-red-800' : 'text-emerald-800'}>
                    {jobResult.error ? (
                      <span>Error: {jobResult.error}</span>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-medium">Job completed successfully</p>
                        <p className="text-sm">
                          Processed: {jobResult.summary?.total_processed || 0} |
                          Succeeded: {jobResult.summary?.total_succeeded || 0} |
                          Failed: {jobResult.summary?.total_failed || 0} |
                          Skipped: {jobResult.summary?.total_skipped || 0}
                        </p>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Recent Job Runs */}
              {recentJobRuns.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Recent Job Runs</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">Task</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-600">Results</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {recentJobRuns.map((run) => (
                          <tr key={run.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-700">
                              {format(new Date(run.run_date), 'dd MMM HH:mm')}
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {run.task_name === 'investor_interest' && 'Investor Interest'}
                              {run.task_name === 'loan_schedules' && 'Loan Schedules'}
                              {run.task_name === 'recalculate_balances' && 'Balance Recalc'}
                            </td>
                            <td className="px-3 py-2">
                              {run.status === 'success' && (
                                <span className="inline-flex items-center gap-1 text-emerald-700">
                                  <CheckCircle className="w-3.5 h-3.5" /> Success
                                </span>
                              )}
                              {run.status === 'partial' && (
                                <span className="inline-flex items-center gap-1 text-amber-700">
                                  <AlertCircle className="w-3.5 h-3.5" /> Partial
                                </span>
                              )}
                              {run.status === 'failed' && (
                                <span className="inline-flex items-center gap-1 text-red-700">
                                  <XCircle className="w-3.5 h-3.5" /> Failed
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {run.succeeded}/{run.processed}
                              {run.skipped > 0 && ` (${run.skipped} skipped)`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Clear All Data */}
          <Card className="border-red-200 md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-900">
                <AlertTriangle className="w-5 h-5" />
                Danger Zone: Clear All Data
              </CardTitle>
              <CardDescription className="text-red-700">
                Permanently delete all data for {currentOrganization?.name || 'current organization'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-red-300 bg-red-50">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  <strong>Warning:</strong> This will permanently delete ALL borrowers, loans, transactions,
                  repayment schedules, properties, expenses, investors, and audit logs.
                  Loan products and expense types will be preserved. This action cannot be undone!
                </AlertDescription>
              </Alert>

              <div className="flex items-center gap-4">
                <Button
                  variant="destructive"
                  onClick={handleClearAllData}
                  disabled={clearing}
                >
                  {clearing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Clearing Data...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Clear All Data
                    </>
                  )}
                </Button>
              </div>

              {/* Progress indicator */}
              {clearing && clearProgress.total > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>{clearProgress.step}</span>
                    <span>{clearProgress.current} / {clearProgress.total}</span>
                  </div>
                  <Progress value={(clearProgress.current / clearProgress.total) * 100} />
                </div>
              )}

              {/* Result message */}
              {clearResult && (
                <Alert className={clearResult.success ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}>
                  <AlertDescription className={clearResult.success ? 'text-emerald-800' : 'text-red-800'}>
                    {clearResult.message}
                  </AlertDescription>
                </Alert>
              )}

              {/* Logs */}
              {logs.length > 0 && (
                <div className="bg-slate-900 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <div className="space-y-1 text-xs text-slate-300 font-mono">
                    {logs.map((log, i) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <CreateOrganizationDialog
          open={isCreateOrgOpen}
          onClose={() => setIsCreateOrgOpen(false)}
        />
      </div>
    </div>
  );
}
