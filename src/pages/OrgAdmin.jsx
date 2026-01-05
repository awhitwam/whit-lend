import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Building2, Trash2, AlertTriangle, Loader2, Receipt, TrendingUp, FileSpreadsheet, RefreshCw, CheckCircle, XCircle, Save, MapPin, Phone, Mail, Globe, Download, Upload, HardDrive } from 'lucide-react';
import { useOrganization } from '@/lib/OrganizationContext';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { supabase } from '@/lib/supabaseClient';
import { regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function OrgAdmin() {
  const { canAdmin, currentOrganization, refreshOrganizations } = useOrganization();
  const queryClient = useQueryClient();

  // Clear data state
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [clearProgress, setClearProgress] = useState({ current: 0, total: 0, step: '' });

  // Schedule regeneration state
  const [regeneratingSchedules, setRegeneratingSchedules] = useState(false);
  const [scheduleRegenerationResult, setScheduleRegenerationResult] = useState(null);

  // Organization details state
  const [orgDetails, setOrgDetails] = useState({
    name: '',
    description: '',
    address_line1: '',
    address_line2: '',
    city: '',
    postcode: '',
    country: '',
    phone: '',
    email: '',
    website: ''
  });
  const [orgDetailsChanged, setOrgDetailsChanged] = useState(false);

  // Backup/Restore state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0, step: '' });
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ current: 0, total: 0, step: '' });
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');

  // Reset clear data state when organization changes
  useEffect(() => {
    setClearing(false);
    setClearResult(null);
    setLogs([]);
    setClearProgress({ current: 0, total: 0, step: '' });
    setScheduleRegenerationResult(null);
  }, [currentOrganization?.id]);

  // Load organization details when org changes
  useEffect(() => {
    if (currentOrganization) {
      setOrgDetails({
        name: currentOrganization.name || '',
        description: currentOrganization.description || '',
        address_line1: currentOrganization.address_line1 || '',
        address_line2: currentOrganization.address_line2 || '',
        city: currentOrganization.city || '',
        postcode: currentOrganization.postcode || '',
        country: currentOrganization.country || '',
        phone: currentOrganization.phone || '',
        email: currentOrganization.email || '',
        website: currentOrganization.website || ''
      });
      setOrgDetailsChanged(false);
    }
  }, [currentOrganization]);

  // Update organization details mutation
  const updateOrgDetailsMutation = useMutation({
    mutationFn: async (details) => {
      const { error } = await supabase
        .from('organizations')
        .update({
          name: details.name,
          description: details.description || null,
          address_line1: details.address_line1 || null,
          address_line2: details.address_line2 || null,
          city: details.city || null,
          postcode: details.postcode || null,
          country: details.country || null,
          phone: details.phone || null,
          email: details.email || null,
          website: details.website || null
        })
        .eq('id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Organization details saved');
      refreshOrganizations();
      setOrgDetailsChanged(false);
    },
    onError: (error) => {
      toast.error('Failed to save organization details', { description: error.message });
    }
  });

  const handleOrgDetailsChange = (field, value) => {
    setOrgDetails(prev => ({ ...prev, [field]: value }));
    setOrgDetailsChanged(true);
  };

  const handleSaveOrgDetails = () => {
    if (!orgDetails.name.trim()) {
      toast.error('Organization name is required');
      return;
    }
    updateOrgDetailsMutation.mutate(orgDetails);
  };

  // Regenerate all loan schedules for current org
  const regenerateSchedulesMutation = useMutation({
    mutationFn: async () => {
      setRegeneratingSchedules(true);
      setScheduleRegenerationResult(null);

      console.log('[RegenerateSchedules] Fetching loans for current organization...');

      // Fetch all loans for current org using org-scoped API
      // Include Live loans and Closed/Settled loans (to fix historical schedules)
      const allLoans = await api.entities.Loan.list();
      const loansToProcess = allLoans.filter(l =>
        l.status === 'Live' || l.status === 'Active' || l.status === 'Closed'
      );

      console.log(`[RegenerateSchedules] Found ${loansToProcess.length} loans to regenerate (live + settled)`);

      const results = {
        total: loansToProcess.length,
        succeeded: 0,
        failed: 0,
        errors: []
      };

      for (const loan of loansToProcess) {
        try {
          console.log(`[RegenerateSchedules] Regenerating loan ${loan.loan_number} (status: ${loan.status})...`);

          // For closed/settled loans, pass the settlement date so the schedule
          // is generated only up to the actual settlement date
          const options = {};
          if (loan.status === 'Closed' && loan.settlement_date) {
            options.endDate = loan.settlement_date;
            console.log(`[RegenerateSchedules]   → Using settlement date: ${loan.settlement_date}`);
          }

          await regenerateLoanSchedule(loan.id, options);
          results.succeeded++;
        } catch (error) {
          console.error(`[RegenerateSchedules] Failed for loan ${loan.loan_number}:`, error);
          results.failed++;
          results.errors.push({ loan: loan.loan_number, error: error.message });
        }
      }

      console.log('[RegenerateSchedules] Complete:', results);
      return results;
    },
    onSuccess: (data) => {
      setScheduleRegenerationResult(data);
      setRegeneratingSchedules(false);
      queryClient.invalidateQueries(['repayment-schedule']);
      queryClient.invalidateQueries(['loans']);
    },
    onError: (error) => {
      setScheduleRegenerationResult({ error: error.message });
      setRegeneratingSchedules(false);
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
    //           expenses → expense_types
    //           reconciliation_entries → bank_statements
    //           investor_interest → investors
    //           investor_transactions → investors
    //           audit_logs (entity_id may reference loans/borrowers but no FK)

    const totalSteps = 22;

    // 1. Delete accepted orphans (no FK dependencies)
    setClearProgress({ current: 1, total: totalSteps, step: 'Deleting accepted orphans...' });
    try {
      const acceptedOrphans = await api.entities.AcceptedOrphan.list();
      if (acceptedOrphans.length > 0) {
        addLog(`  Deleting ${acceptedOrphans.length} accepted orphans...`);
        for (const ao of acceptedOrphans) {
          await api.entities.AcceptedOrphan.delete(ao.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete accepted orphans: ${e.message}`);
    }

    // 2. Delete borrower loan preferences (no FK dependencies)
    setClearProgress({ current: 2, total: totalSteps, step: 'Deleting borrower preferences...' });
    try {
      const preferences = await api.entities.BorrowerLoanPreference.list();
      if (preferences.length > 0) {
        addLog(`  Deleting ${preferences.length} borrower loan preferences...`);
        for (const pref of preferences) {
          await api.entities.BorrowerLoanPreference.delete(pref.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete borrower preferences: ${e.message}`);
    }

    // 3. Delete receipt drafts (no FK dependencies)
    setClearProgress({ current: 3, total: totalSteps, step: 'Deleting receipt drafts...' });
    try {
      const receipts = await api.entities.ReceiptDraft.list();
      if (receipts.length > 0) {
        addLog(`  Deleting ${receipts.length} receipt drafts...`);
        for (const r of receipts) {
          await api.entities.ReceiptDraft.delete(r.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete receipt drafts: ${e.message}`);
    }

    // 4. Delete audit logs for current organization (using org-filtered API)
    setClearProgress({ current: 4, total: totalSteps, step: 'Deleting audit logs...' });
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

    // 5. Delete reconciliation entries (references bank_statements)
    setClearProgress({ current: 5, total: totalSteps, step: 'Deleting reconciliation entries...' });
    try {
      const entries = await api.entities.ReconciliationEntry.list();
      if (entries.length > 0) {
        addLog(`  Deleting ${entries.length} reconciliation entries...`);
        for (const entry of entries) {
          await api.entities.ReconciliationEntry.delete(entry.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete reconciliation entries: ${e.message}`);
    }

    // 6. Delete reconciliation patterns
    setClearProgress({ current: 6, total: totalSteps, step: 'Deleting reconciliation patterns...' });
    try {
      const patterns = await api.entities.ReconciliationPattern.list();
      if (patterns.length > 0) {
        addLog(`  Deleting ${patterns.length} reconciliation patterns...`);
        for (const pattern of patterns) {
          await api.entities.ReconciliationPattern.delete(pattern.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete reconciliation patterns: ${e.message}`);
    }

    // 7. Delete bank statements
    setClearProgress({ current: 7, total: totalSteps, step: 'Deleting bank statements...' });
    try {
      const statements = await api.entities.BankStatement.list();
      if (statements.length > 0) {
        addLog(`  Deleting ${statements.length} bank statements...`);
        for (const stmt of statements) {
          await api.entities.BankStatement.delete(stmt.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete bank statements: ${e.message}`);
    }

    // 8. Delete value_history (references loan_properties via loan_property_id)
    setClearProgress({ current: 8, total: totalSteps, step: 'Deleting value history...' });
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

    // 9. Delete loan_properties (references loans via loan_id, properties via property_id)
    setClearProgress({ current: 9, total: totalSteps, step: 'Deleting loan-property links...' });
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

    // 10. Delete properties (no FK to loans, but loan_properties references it)
    setClearProgress({ current: 10, total: totalSteps, step: 'Deleting properties...' });
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

    // 11. Delete transactions for current organization (using org-filtered API)
    setClearProgress({ current: 11, total: totalSteps, step: 'Deleting transactions...' });
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

    // 12. Delete repayment schedules for current organization (using org-filtered API)
    setClearProgress({ current: 12, total: totalSteps, step: 'Deleting repayment schedules...' });
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

    // 13. Delete expenses (references expense_types via expense_type_id - nullable)
    setClearProgress({ current: 13, total: totalSteps, step: 'Deleting expenses...' });
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

    // 14. Delete expense types (categories)
    setClearProgress({ current: 14, total: totalSteps, step: 'Deleting expense categories...' });
    try {
      const expenseTypes = await api.entities.ExpenseType.list();
      if (expenseTypes.length > 0) {
        addLog(`  Deleting ${expenseTypes.length} expense categories...`);
        let typeErrors = 0;
        for (const et of expenseTypes) {
          try {
            await api.entities.ExpenseType.delete(et.id);
          } catch (err) {
            typeErrors++;
            if (typeErrors <= 2) {
              addLog(`    Error deleting expense type ${et.name}: ${err.message}`);
            }
          }
        }
        if (typeErrors > 0) {
          addLog(`    Failed to delete ${typeErrors} expense categories`);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete expense categories: ${e.message}`);
    }

    // 15. Delete other income
    setClearProgress({ current: 15, total: totalSteps, step: 'Deleting other income...' });
    try {
      const otherIncome = await api.entities.OtherIncome.list();
      if (otherIncome.length > 0) {
        addLog(`  Deleting ${otherIncome.length} other income records...`);
        for (const oi of otherIncome) {
          await api.entities.OtherIncome.delete(oi.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete other income: ${e.message}`);
    }

    // 16. Delete investor interest records (references investors)
    setClearProgress({ current: 16, total: totalSteps, step: 'Deleting investor interest...' });
    try {
      const investorInterest = await api.entities.InvestorInterest.list();
      if (investorInterest.length > 0) {
        addLog(`  Deleting ${investorInterest.length} investor interest records...`);
        for (const ii of investorInterest) {
          await api.entities.InvestorInterest.delete(ii.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete investor interest: ${e.message}`);
    }

    // 17. Delete investor transactions (references investors)
    setClearProgress({ current: 17, total: totalSteps, step: 'Deleting investor transactions...' });
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

    // 18. Delete loans (references borrowers via borrower_id, self-references via restructured_from_loan_id)
    setClearProgress({ current: 18, total: totalSteps, step: 'Deleting loans...' });
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

    // 19. Delete borrowers (no FK references to other tables)
    setClearProgress({ current: 19, total: totalSteps, step: 'Deleting borrowers...' });
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

    // 20. Delete investors
    setClearProgress({ current: 20, total: totalSteps, step: 'Deleting investors...' });
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

    // 21. Delete investor products
    setClearProgress({ current: 21, total: totalSteps, step: 'Deleting investor products...' });
    try {
      const investorProducts = await api.entities.InvestorProduct.list();
      if (investorProducts.length > 0) {
        addLog(`  Deleting ${investorProducts.length} investor products...`);
        for (const ip of investorProducts) {
          await api.entities.InvestorProduct.delete(ip.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete investor products: ${e.message}`);
    }

    // 22. Delete loan products (must be after loans since loans reference them)
    setClearProgress({ current: 22, total: totalSteps, step: 'Deleting loan products...' });
    try {
      const loanProducts = await api.entities.LoanProduct.list();
      if (loanProducts.length > 0) {
        addLog(`  Deleting ${loanProducts.length} loan products...`);
        for (const lp of loanProducts) {
          await api.entities.LoanProduct.delete(lp.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete loan products: ${e.message}`);
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
    addLog('Clearing expenses and expense types...');

    // 1. Delete expenses first (they reference expense_types)
    setClearProgress({ current: 1, total: 2, step: 'Deleting expenses...' });
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

    // 2. Delete expense types
    setClearProgress({ current: 2, total: 2, step: 'Deleting expense types...' });
    try {
      const expenseTypes = await api.entities.ExpenseType.list();
      if (expenseTypes.length > 0) {
        addLog(`  Found ${expenseTypes.length} expense types to delete...`);
        let deletedCount = 0;
        let typeErrors = 0;

        for (const et of expenseTypes) {
          try {
            await api.entities.ExpenseType.delete(et.id);
            deletedCount++;
          } catch (err) {
            typeErrors++;
            if (typeErrors <= 3) {
              addLog(`    Error deleting expense type ${et.name}: ${err.message}`);
            }
          }
        }

        addLog(`  Expense types deletion complete: ${deletedCount} deleted`);
        if (typeErrors > 0) {
          addLog(`  Failed to delete ${typeErrors} expense types`);
        }
      } else {
        addLog(`  No expense types found to delete`);
      }
    } catch (e) {
      addLog(`  Note: Could not list/delete expense types: ${e.message}`);
    }

    addLog('Expenses and expense types cleared successfully');
  };

  // Clear bank reconciliation data function
  const clearBankReconciliationData = async () => {
    addLog('Clearing bank reconciliation data...');

    // 1. Delete reconciliation entries first (references bank_statements)
    setClearProgress({ current: 1, total: 3, step: 'Deleting reconciliation entries...' });
    try {
      const entries = await api.entities.ReconciliationEntry.list();
      if (entries.length > 0) {
        addLog(`  Found ${entries.length} reconciliation entries to delete...`);
        let deletedCount = 0;
        let entryErrors = 0;

        for (const entry of entries) {
          try {
            await api.entities.ReconciliationEntry.delete(entry.id);
            deletedCount++;
            if (deletedCount % 100 === 0) {
              addLog(`    Deleted ${deletedCount} of ${entries.length} entries...`);
            }
          } catch (err) {
            entryErrors++;
            if (entryErrors <= 3) {
              addLog(`    Error deleting entry ${entry.id}: ${err.message}`);
            }
          }
        }

        addLog(`  Reconciliation entries deletion complete: ${deletedCount} deleted`);
        if (entryErrors > 0) {
          addLog(`  Failed to delete ${entryErrors} entries`);
        }
      } else {
        addLog(`  No reconciliation entries found to delete`);
      }
    } catch (e) {
      throw new Error(`Could not delete reconciliation entries: ${e.message}`);
    }

    // 2. Delete reconciliation patterns
    setClearProgress({ current: 2, total: 3, step: 'Deleting reconciliation patterns...' });
    try {
      const patterns = await api.entities.ReconciliationPattern.list();
      if (patterns.length > 0) {
        addLog(`  Found ${patterns.length} reconciliation patterns to delete...`);
        let deletedCount = 0;

        for (const pattern of patterns) {
          try {
            await api.entities.ReconciliationPattern.delete(pattern.id);
            deletedCount++;
          } catch (err) {
            addLog(`    Error deleting pattern ${pattern.id}: ${err.message}`);
          }
        }

        addLog(`  Reconciliation patterns deletion complete: ${deletedCount} deleted`);
      } else {
        addLog(`  No reconciliation patterns found to delete`);
      }
    } catch (e) {
      addLog(`  Note: Could not list/delete reconciliation patterns: ${e.message}`);
    }

    // 3. Delete bank statements
    setClearProgress({ current: 3, total: 3, step: 'Deleting bank statements...' });
    try {
      const statements = await api.entities.BankStatement.list();
      if (statements.length > 0) {
        addLog(`  Found ${statements.length} bank statements to delete...`);
        let deletedCount = 0;
        let statementErrors = 0;

        for (const stmt of statements) {
          try {
            await api.entities.BankStatement.delete(stmt.id);
            deletedCount++;
            if (deletedCount % 100 === 0) {
              addLog(`    Deleted ${deletedCount} of ${statements.length} statements...`);
            }
          } catch (err) {
            statementErrors++;
            if (statementErrors <= 3) {
              addLog(`    Error deleting statement ${stmt.id}: ${err.message}`);
            }
          }
        }

        addLog(`  Bank statements deletion complete: ${deletedCount} deleted`);
        if (statementErrors > 0) {
          addLog(`  Failed to delete ${statementErrors} statements`);
        }
      } else {
        addLog(`  No bank statements found to delete`);
      }
    } catch (e) {
      throw new Error(`Could not delete bank statements: ${e.message}`);
    }

    addLog('Bank reconciliation data cleared successfully');
  };

  // Handle clear bank reconciliation data
  const handleClearBankReconciliation = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL bank reconciliation data for "${currentOrganization?.name}"?\n\nThis will delete:\n• All bank statement entries\n• All reconciliation links\n• All learned reconciliation patterns\n\nThis action CANNOT be undone!`)) {
      return;
    }

    setClearing(true);
    setClearResult(null);
    setLogs([]);

    try {
      await clearBankReconciliationData();
      setClearResult({ success: true, message: 'All bank reconciliation data cleared successfully!' });
      queryClient.invalidateQueries(['bank-statements']);
      queryClient.invalidateQueries(['reconciliation-entries']);
      queryClient.invalidateQueries(['reconciliation-patterns']);
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  // Handle clear all data
  const handleClearAllData = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL data for "${currentOrganization?.name}"?\n\nThis will delete:\n• All borrowers\n• All loans\n• All loan products\n• All transactions\n• All repayment schedules\n• All properties and security\n• All expenses and expense categories\n• All investors, investor transactions, and investor products\n• All investor interest records\n• All bank reconciliation data (statements, entries, patterns)\n• All other income records\n• All audit logs\n\nThis action CANNOT be undone!`)) {
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
    if (!window.confirm(`Are you sure you want to delete ALL expenses and expense types for "${currentOrganization?.name}"?\n\nThis will delete:\n• All expense records\n• All expense types/categories\n\nThis action CANNOT be undone!`)) {
      return;
    }

    setClearing(true);
    setClearResult(null);
    setLogs([]);

    try {
      await clearExpensesOnly();
      setClearResult({ success: true, message: 'All expenses and expense types cleared successfully!' });
      queryClient.invalidateQueries(['expenses']);
      queryClient.invalidateQueries(['expense-types']);
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  // Entity name mapping for backup/restore
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

  // Export backup function
  const handleExportBackup = async () => {
    setIsExporting(true);
    setLogs([]);
    addLog('Starting backup export...');

    const backup = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      organizationId: currentOrganization.id,
      organizationName: currentOrganization.name,
      tables: {},
      metadata: { recordCounts: {} }
    };

    // Tables to export in FK-safe order
    const tables = [
      'loan_products', 'investor_products', 'expense_types', 'first_charge_holders',
      'borrowers', 'properties', 'Investor',
      'loans', 'InvestorTransaction', 'investor_interest',
      'transactions', 'repayment_schedules', 'loan_properties', 'expenses',
      'value_history', 'bank_statements', 'other_income',
      'borrower_loan_preferences', 'receipt_drafts',
      'reconciliation_patterns', 'reconciliation_entries',
      'accepted_orphans',
      'audit_logs'
    ];

    try {
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        const entityName = getEntityName(table);
        setExportProgress({ current: i + 1, total: tables.length, step: `Exporting ${table}...` });
        addLog(`  Exporting ${table}...`);

        try {
          const data = await api.entities[entityName].list();
          backup.tables[table] = data;
          backup.metadata.recordCounts[table] = data.length;
          addLog(`    Found ${data.length} records`);
        } catch (err) {
          addLog(`    Warning: Could not export ${table}: ${err.message}`);
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

      // Calculate total records
      const totalRecords = Object.values(backup.metadata.recordCounts).reduce((a, b) => a + b, 0);
      addLog(`Backup complete! ${totalRecords} total records exported.`);

      // Log audit
      await logAudit({
        action: AuditAction.ORG_BACKUP_EXPORT,
        entityType: EntityType.ORGANIZATION,
        entityId: currentOrganization.id,
        entityName: currentOrganization.name,
        details: {
          totalRecords,
          recordCounts: backup.metadata.recordCounts
        }
      });

      toast.success(`Backup exported successfully (${totalRecords} records)`);
    } catch (err) {
      addLog(`Error: ${err.message}`);
      toast.error('Failed to export backup');
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0, step: '' });
    }
  };

  // Handle file selection for restore
  const handleRestoreFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      // Validate backup structure
      if (!backup.version || !backup.tables || !backup.metadata) {
        toast.error('Invalid backup file format');
        return;
      }

      // Calculate total records
      const totalRecords = Object.values(backup.metadata.recordCounts || {}).reduce((a, b) => a + b, 0);

      setRestorePreview({
        ...backup,
        totalRecords,
        fileName: file.name
      });
      setRestoreConfirmText('');
    } catch (err) {
      toast.error('Could not read backup file: ' + err.message);
    }
  };

  // Execute restore
  const executeRestore = async () => {
    if (!restorePreview) return;

    setIsRestoring(true);
    setLogs([]);
    addLog('Starting restore process...');
    addLog('WARNING: This will delete ALL existing data first!');

    try {
      // Step 1: Clear all existing data
      addLog('Step 1: Clearing existing data...');
      setRestoreProgress({ current: 1, total: 3, step: 'Clearing existing data...' });
      await clearAllData();

      // Step 2: Restore data in FK-safe order
      addLog('Step 2: Restoring data from backup...');
      setRestoreProgress({ current: 2, total: 3, step: 'Restoring data...' });

      const restoreOrder = [
        'loan_products', 'investor_products', 'expense_types', 'first_charge_holders',
        'borrowers', 'properties', 'Investor',
        'loans', 'InvestorTransaction', 'investor_interest',
        'transactions', 'repayment_schedules', 'loan_properties', 'expenses',
        'value_history', 'bank_statements', 'other_income',
        'borrower_loan_preferences', 'receipt_drafts',
        'reconciliation_patterns', 'reconciliation_entries',
        'accepted_orphans'
      ];

      let restoredCount = 0;
      for (const table of restoreOrder) {
        const records = restorePreview.tables[table];
        if (records && records.length > 0) {
          const entityName = getEntityName(table);
          addLog(`  Restoring ${table} (${records.length} records)...`);

          try {
            // Strip organization_id - createMany will inject current org
            const cleanRecords = records.map(r => {
              const { organization_id, ...rest } = r;
              return rest;
            });

            await api.entities[entityName].createMany(cleanRecords);
            restoredCount += records.length;
            addLog(`    Restored ${records.length} records`);
          } catch (err) {
            addLog(`    ERROR restoring ${table}: ${err.message}`);
          }
        }
      }

      // Step 3: Refresh queries
      addLog('Step 3: Refreshing application data...');
      setRestoreProgress({ current: 3, total: 3, step: 'Refreshing data...' });
      queryClient.invalidateQueries();

      // Log audit
      await logAudit({
        action: AuditAction.ORG_BACKUP_RESTORE,
        entityType: EntityType.ORGANIZATION,
        entityId: currentOrganization.id,
        entityName: currentOrganization.name,
        details: {
          sourceOrgId: restorePreview.organizationId,
          sourceOrgName: restorePreview.organizationName,
          backupDate: restorePreview.exportDate,
          restoredRecords: restoredCount
        }
      });

      addLog(`Restore complete! ${restoredCount} records restored.`);
      toast.success(`Backup restored successfully (${restoredCount} records)`);
      setRestorePreview(null);
      setRestoreConfirmText('');
    } catch (err) {
      addLog(`Error during restore: ${err.message}`);
      toast.error('Failed to restore backup: ' + err.message);
    } finally {
      setIsRestoring(false);
      setRestoreProgress({ current: 0, total: 0, step: '' });
    }
  };

  if (!canAdmin()) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="p-4 md:p-6 space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Organization Admin</h1>
            <p className="text-slate-500 mt-1">Administrative functions for your organization</p>
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
          <h1 className="text-3xl font-bold text-slate-900">Organization Admin</h1>
          <p className="text-slate-500 mt-1">Administrative functions for {currentOrganization?.name || 'your organization'}</p>
        </div>

        <Alert className="border-blue-200 bg-blue-50">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <strong>Organization Admin Area</strong> - These functions affect only your current organization: <strong>{currentOrganization?.name}</strong>
          </AlertDescription>
        </Alert>

        {/* Organization Details Card - Full Width */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              Organization Details
            </CardTitle>
            <CardDescription>
              Manage your organization's name, address, and contact information
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              {/* Left Column - Basic Info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name *</Label>
                  <Input
                    id="org-name"
                    value={orgDetails.name}
                    onChange={(e) => handleOrgDetailsChange('name', e.target.value)}
                    placeholder="Organization name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-description">Description</Label>
                  <Textarea
                    id="org-description"
                    value={orgDetails.description}
                    onChange={(e) => handleOrgDetailsChange('description', e.target.value)}
                    placeholder="Brief description of the organization"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-email" className="flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Email
                  </Label>
                  <Input
                    id="org-email"
                    type="email"
                    value={orgDetails.email}
                    onChange={(e) => handleOrgDetailsChange('email', e.target.value)}
                    placeholder="contact@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-phone" className="flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Phone
                  </Label>
                  <Input
                    id="org-phone"
                    value={orgDetails.phone}
                    onChange={(e) => handleOrgDetailsChange('phone', e.target.value)}
                    placeholder="+44 123 456 7890"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-website" className="flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Website
                  </Label>
                  <Input
                    id="org-website"
                    value={orgDetails.website}
                    onChange={(e) => handleOrgDetailsChange('website', e.target.value)}
                    placeholder="https://example.com"
                  />
                </div>
              </div>

              {/* Right Column - Address */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <MapPin className="w-4 h-4" /> Address
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-address1">Address Line 1</Label>
                  <Input
                    id="org-address1"
                    value={orgDetails.address_line1}
                    onChange={(e) => handleOrgDetailsChange('address_line1', e.target.value)}
                    placeholder="Street address"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-address2">Address Line 2</Label>
                  <Input
                    id="org-address2"
                    value={orgDetails.address_line2}
                    onChange={(e) => handleOrgDetailsChange('address_line2', e.target.value)}
                    placeholder="Apartment, suite, etc. (optional)"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="org-city">City</Label>
                    <Input
                      id="org-city"
                      value={orgDetails.city}
                      onChange={(e) => handleOrgDetailsChange('city', e.target.value)}
                      placeholder="City"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-postcode">Postcode</Label>
                    <Input
                      id="org-postcode"
                      value={orgDetails.postcode}
                      onChange={(e) => handleOrgDetailsChange('postcode', e.target.value)}
                      placeholder="Postcode"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-country">Country</Label>
                  <Input
                    id="org-country"
                    value={orgDetails.country}
                    onChange={(e) => handleOrgDetailsChange('country', e.target.value)}
                    placeholder="Country"
                  />
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleSaveOrgDetails}
                disabled={!orgDetailsChanged || updateOrgDetailsMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {updateOrgDetailsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Details
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">

          {/* Schedule Regeneration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-emerald-600" />
                Loan Schedules
              </CardTitle>
              <CardDescription>
                Regenerate repayment schedules for all loans
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                Regenerate repayment schedules for all active loans in this organization.
                Use this after fixing calculation bugs or updating interest rates.
              </p>
              <Button
                variant="outline"
                onClick={() => regenerateSchedulesMutation.mutate()}
                disabled={regeneratingSchedules || clearing}
                className="w-full"
              >
                {regeneratingSchedules ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Regenerating Schedules...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Regenerate All Loan Schedules
                  </>
                )}
              </Button>

              {/* Schedule Regeneration Result */}
              {scheduleRegenerationResult && (
                <Alert className={scheduleRegenerationResult.error ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}>
                  {scheduleRegenerationResult.error ? (
                    <XCircle className="w-4 h-4 text-red-600" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  )}
                  <AlertDescription className={scheduleRegenerationResult.error ? 'text-red-800' : 'text-emerald-800'}>
                    {scheduleRegenerationResult.error ? (
                      <span>Error: {scheduleRegenerationResult.error}</span>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-medium">Schedule regeneration complete</p>
                        <p className="text-sm">
                          Total: {scheduleRegenerationResult.total} |
                          Succeeded: {scheduleRegenerationResult.succeeded} |
                          Failed: {scheduleRegenerationResult.failed}
                        </p>
                        {scheduleRegenerationResult.errors?.length > 0 && (
                          <div className="text-xs mt-2">
                            <p className="font-medium text-red-600">Failed loans:</p>
                            {scheduleRegenerationResult.errors.map((e, i) => (
                              <p key={i}>• {e.loan}: {e.error}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Data Backup & Restore */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-blue-600" />
                Data Backup & Restore
              </CardTitle>
              <CardDescription>
                Export and restore complete organization data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Export Section */}
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium text-slate-900">Export Backup</h4>
                  <p className="text-sm text-slate-600">
                    Download a complete backup of all organization data as a JSON file.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleExportBackup}
                  disabled={isExporting || isRestoring || clearing}
                  className="w-full"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {exportProgress.step || 'Exporting...'}
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Export Backup
                    </>
                  )}
                </Button>
                {isExporting && exportProgress.total > 0 && (
                  <Progress value={(exportProgress.current / exportProgress.total) * 100} />
                )}
              </div>

              {/* Restore Section */}
              <div className="border-t pt-4 space-y-3">
                <div>
                  <h4 className="font-medium text-slate-900">Restore Backup</h4>
                  <p className="text-sm text-slate-600">
                    Upload a backup file to restore organization data.
                  </p>
                </div>
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 text-sm">
                    Restoring will <strong>DELETE all current data</strong> and replace it with the backup.
                  </AlertDescription>
                </Alert>
                <Input
                  type="file"
                  accept=".json"
                  onChange={handleRestoreFileSelect}
                  disabled={isExporting || isRestoring || clearing}
                  className="cursor-pointer"
                />

                {/* Restore Preview */}
                {restorePreview && (
                  <div className="p-4 bg-slate-50 rounded-lg border space-y-3">
                    <div className="space-y-1 text-sm">
                      <p><strong>File:</strong> {restorePreview.fileName}</p>
                      <p><strong>Organization:</strong> {restorePreview.organizationName}</p>
                      <p><strong>Backup Date:</strong> {format(new Date(restorePreview.exportDate), 'PPpp')}</p>
                      <p><strong>Total Records:</strong> {restorePreview.totalRecords.toLocaleString()}</p>
                    </div>

                    {/* Record counts breakdown */}
                    <div className="text-xs text-slate-600 max-h-24 overflow-y-auto">
                      {Object.entries(restorePreview.metadata.recordCounts || {})
                        .filter(([, count]) => count > 0)
                        .map(([table, count]) => (
                          <span key={table} className="inline-block mr-3">
                            {table}: {count}
                          </span>
                        ))}
                    </div>

                    {/* Confirmation */}
                    <div className="space-y-2">
                      <Label htmlFor="restore-confirm" className="text-sm">
                        Type <strong>RESTORE</strong> to confirm:
                      </Label>
                      <Input
                        id="restore-confirm"
                        value={restoreConfirmText}
                        onChange={(e) => setRestoreConfirmText(e.target.value)}
                        placeholder="RESTORE"
                        className="font-mono"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setRestorePreview(null);
                          setRestoreConfirmText('');
                        }}
                        disabled={isRestoring}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={executeRestore}
                        disabled={isRestoring || restoreConfirmText !== 'RESTORE'}
                        className="flex-1"
                      >
                        {isRestoring ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Restoring...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            Restore Backup
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Restore Progress */}
                {isRestoring && restoreProgress.total > 0 && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>{restoreProgress.step}</span>
                      <span>{restoreProgress.current} / {restoreProgress.total}</span>
                    </div>
                    <Progress value={(restoreProgress.current / restoreProgress.total) * 100} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-red-200 md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-900">
                <AlertTriangle className="w-5 h-5" />
                Danger Zone
              </CardTitle>
              <CardDescription className="text-red-700">
                Destructive actions for {currentOrganization?.name || 'current organization'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-red-300 bg-red-50">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  <strong>Warning:</strong> These actions permanently delete data and cannot be undone.
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleClearExpenses}
                  disabled={clearing}
                  className="border-red-300 text-red-900 hover:bg-red-50"
                >
                  {clearing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4 mr-2" />
                      Clear Expenses
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleClearInvestorData}
                  disabled={clearing}
                  className="border-red-300 text-red-900 hover:bg-red-50"
                >
                  {clearing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    <>
                      <TrendingUp className="w-4 h-4 mr-2" />
                      Clear Investor Data
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={handleClearBankReconciliation}
                  disabled={clearing}
                  className="border-red-300 text-red-900 hover:bg-red-50"
                >
                  {clearing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4 mr-2" />
                      Clear Bank Reconciliation
                    </>
                  )}
                </Button>

                <Button
                  variant="destructive"
                  onClick={handleClearAllData}
                  disabled={clearing}
                >
                  {clearing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Clearing...
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
      </div>
    </div>
  );
}
