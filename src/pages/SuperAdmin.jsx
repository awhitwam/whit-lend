import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert,
  Users,
  Building2,
  Search,
  Loader2,
  Mail,
  Calendar,
  Shield,
  UserPlus,
  Trash2,
  Check,
  X,
  Crown,
  RefreshCw,
  Clock,
  Play,
  CheckCircle,
  XCircle,
  AlertCircle,
  Plus,
  HardDrive,
  Download,
  Upload,
  Receipt,
  TrendingUp,
  FileSpreadsheet,
  AlertTriangle
} from 'lucide-react';
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { api } from '@/api/dataClient';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';
import {
  CURRENT_SCHEMA_VERSION,
  tableSchemas,
  analyzeBackup,
  processRecordsForRestore
} from '@/lib/backupSchema';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { setOrganizationIdGetter } from '@/api/dataClient';
import CreateOrganizationDialog from '@/components/organization/CreateOrganizationDialog';
import { regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';

export default function SuperAdmin() {
  const { isSuperAdmin, user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('users');

  // User details modal state
  const [selectedUser, setSelectedUser] = useState(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);

  // Add to org dialog state
  const [isAddToOrgOpen, setIsAddToOrgOpen] = useState(false);
  const [selectedOrgForAdd, setSelectedOrgForAdd] = useState('');
  const [selectedRoleForAdd, setSelectedRoleForAdd] = useState('Viewer');

  // Nightly jobs state
  const [runningJob, setRunningJob] = useState(null);
  const [jobResult, setJobResult] = useState(null);

  // Create organization dialog state
  const [isCreateOrgOpen, setIsCreateOrgOpen] = useState(false);

  // Data Management state
  const [selectedOrgForData, setSelectedOrgForData] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0, step: '' });
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ current: 0, total: 0, step: '' });
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearProgress, setClearProgress] = useState({ current: 0, total: 0, step: '' });
  const [clearResult, setClearResult] = useState(null);
  const [clearLogs, setClearLogs] = useState([]);

  // Default organization state
  const [defaultOrgId, setDefaultOrgId] = useState('');
  const [isSavingDefaultOrg, setIsSavingDefaultOrg] = useState(false);

  // Schedule regeneration state
  const [selectedOrgForSchedules, setSelectedOrgForSchedules] = useState('');

  // Session timeout state
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(20);
  const [isSavingTimeout, setIsSavingTimeout] = useState(false);

  // Fetch all users across all organizations
  const { data: allUsers = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['super-admin-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .order('full_name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: isSuperAdmin
  });

  // Fetch all organizations
  const { data: allOrganizations = [], isLoading: loadingOrgs } = useQuery({
    queryKey: ['super-admin-organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: isSuperAdmin
  });

  // Fetch user's default organization preference
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile-default-org', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('default_organization_id')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: isSuperAdmin && !!user?.id,
    onSuccess: (data) => {
      if (data?.default_organization_id) {
        setDefaultOrgId(data.default_organization_id);
      }
    }
  });

  // Set default org when profile loads
  useEffect(() => {
    if (userProfile?.default_organization_id) {
      setDefaultOrgId(userProfile.default_organization_id);
    }
  }, [userProfile]);

  // Save default organization preference
  const saveDefaultOrg = async (orgId) => {
    setIsSavingDefaultOrg(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ default_organization_id: orgId || null })
        .eq('id', user.id);
      if (error) throw error;
      setDefaultOrgId(orgId);
      queryClient.invalidateQueries({ queryKey: ['user-profile-default-org'] });
    } catch (err) {
      console.error('Error saving default organization:', err);
      alert('Failed to save default organization preference');
    } finally {
      setIsSavingDefaultOrg(false);
    }
  };

  // Fetch session timeout setting
  const { data: sessionTimeoutSetting } = useQuery({
    queryKey: ['app-settings-session-timeout'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'session_timeout_minutes')
        .single();
      if (error && error.code !== 'PGRST116') throw error; // Ignore "not found" error
      return data;
    },
    enabled: isSuperAdmin
  });

  // Set session timeout when setting loads
  useEffect(() => {
    if (sessionTimeoutSetting?.value) {
      const minutes = parseInt(sessionTimeoutSetting.value, 10);
      if (minutes >= 5 && minutes <= 60) {
        setSessionTimeoutMinutes(minutes);
      }
    }
  }, [sessionTimeoutSetting]);

  // Save session timeout setting
  const saveSessionTimeout = async (minutes) => {
    if (minutes < 5 || minutes > 60) {
      alert('Session timeout must be between 5 and 60 minutes');
      return;
    }
    setIsSavingTimeout(true);
    try {
      const { error } = await supabase
        .from('app_settings')
        .upsert({
          key: 'session_timeout_minutes',
          value: minutes.toString(),
          updated_by: user.id
        }, {
          onConflict: 'key'
        });
      if (error) throw error;
      setSessionTimeoutMinutes(minutes);
      queryClient.invalidateQueries({ queryKey: ['app-settings-session-timeout'] });
    } catch (err) {
      console.error('Error saving session timeout:', err);
      alert('Failed to save session timeout setting');
    } finally {
      setIsSavingTimeout(false);
    }
  };

  // Fetch all organization memberships
  const { data: allMemberships = [], isLoading: loadingMemberships } = useQuery({
    queryKey: ['super-admin-memberships', allOrganizations.length, allUsers.length],
    queryFn: async () => {
      console.log('[SuperAdmin] Fetching memberships...');

      // First, try the simple query without joins - only get active memberships
      const { data: membershipsData, error: membershipsError } = await supabase
        .from('organization_members')
        .select('*')
        .eq('is_active', true);

      console.log('[SuperAdmin] Base memberships result:', { data: membershipsData, error: membershipsError });

      if (membershipsError) {
        console.error('[SuperAdmin] Memberships error:', membershipsError);
        throw membershipsError;
      }

      if (!membershipsData || membershipsData.length === 0) {
        return [];
      }

      // Enrich with organization and user data
      const enrichedMemberships = membershipsData.map(m => {
        const org = allOrganizations.find(o => o.id === m.organization_id);
        const user = allUsers.find(u => u.id === m.user_id);
        return {
          ...m,
          organization: org ? { id: org.id, name: org.name } : null,
          user: user ? { id: user.id, email: user.email, full_name: user.full_name } : null
        };
      });

      console.log('[SuperAdmin] Enriched memberships:', enrichedMemberships);
      return enrichedMemberships;
    },
    enabled: isSuperAdmin && allOrganizations.length > 0 && allUsers.length > 0
  });

  // Fetch recent nightly job runs
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
    },
    enabled: isSuperAdmin
  });

  // Run nightly job mutation
  const runNightlyJobMutation = useMutation({
    mutationFn: async (tasks) => {
      setRunningJob(tasks.join(', '));
      setJobResult(null);

      console.log('[NightlyJob] Calling function via supabase.functions.invoke');
      console.log('[NightlyJob] Tasks:', tasks);

      // Use supabase.functions.invoke() which handles auth automatically
      const { data, error } = await supabase.functions.invoke('nightly-jobs', {
        body: { tasks }
      });

      if (error) {
        console.error('[NightlyJob] Error:', error);
        throw new Error(error.message || 'Failed to invoke function');
      }

      console.log('[NightlyJob] Success:', data);
      return data;
    },
    onSuccess: (data) => {
      setJobResult(data);
      setRunningJob(null);
      queryClient.invalidateQueries({ queryKey: ['nightly-job-runs'] });
    },
    onError: (error) => {
      setJobResult({ error: error.message });
      setRunningJob(null);
    }
  });

  // Get user's org memberships
  const getUserMemberships = (userId) => {
    return allMemberships.filter(m => m.user_id === userId);
  };

  // Get org's members
  const getOrgMembers = (orgId) => {
    return allMemberships.filter(m => m.organization_id === orgId);
  };

  // Toggle super admin status
  const toggleSuperAdminMutation = useMutation({
    mutationFn: async ({ userId, newStatus }) => {
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_super_admin: newStatus })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-users'] });
    }
  });

  // Add user to organization
  const addToOrgMutation = useMutation({
    mutationFn: async ({ userId, organizationId, role }) => {
      const { error } = await supabase
        .from('organization_members')
        .insert({
          user_id: userId,
          organization_id: organizationId,
          role: role
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-memberships'] });
      setIsAddToOrgOpen(false);
      setSelectedOrgForAdd('');
      setSelectedRoleForAdd('Viewer');
    }
  });

  // Remove user from organization
  const removeFromOrgMutation = useMutation({
    mutationFn: async ({ userId, organizationId }) => {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('user_id', userId)
        .eq('organization_id', organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-memberships'] });
    }
  });

  // Change user role in organization
  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, organizationId, newRole }) => {
      const { error } = await supabase
        .from('organization_members')
        .update({ role: newRole })
        .eq('user_id', userId)
        .eq('organization_id', organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-memberships'] });
    }
  });

  // Filter users by search term
  const filteredUsers = allUsers.filter(u =>
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter organizations by search term
  const filteredOrgs = allOrganizations.filter(o =>
    o.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get orgs the selected user is NOT a member of
  const getAvailableOrgsForUser = (userId) => {
    const userOrgIds = getUserMemberships(userId).map(m => m.organization_id);
    return allOrganizations.filter(o => !userOrgIds.includes(o.id));
  };

  const handleOpenUserDetails = (user) => {
    setSelectedUser(user);
    setIsUserModalOpen(true);
  };

  const handleAddToOrg = () => {
    if (!selectedUser || !selectedOrgForAdd) return;
    addToOrgMutation.mutate({
      userId: selectedUser.id,
      organizationId: selectedOrgForAdd,
      role: selectedRoleForAdd
    });
  };

  // Handle regenerating all schedules for an organization
  const handleRegenerateSchedules = async () => {
    if (!selectedOrgForSchedules) return;

    setRunningJob('regenerate_schedules');
    setJobResult(null);

    const result = {
      task: 'regenerate_schedules',
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      details: []
    };

    try {
      const selectedOrg = allOrganizations.find(o => o.id === selectedOrgForSchedules);

      // Fetch Live loans for selected organization
      const { data: liveLoans, error } = await supabase
        .from('loans')
        .select('id, loan_number')
        .eq('organization_id', selectedOrgForSchedules)
        .eq('status', 'Live')
        .eq('is_deleted', false);

      if (error) throw error;

      // Process each loan
      for (const loan of (liveLoans || [])) {
        result.processed++;
        try {
          await regenerateLoanSchedule(loan.id, {
            endDate: new Date() // Regenerate up to today
          });
          result.succeeded++;
          result.details.push({
            loan: loan.loan_number,
            status: 'success'
          });
        } catch (err) {
          result.failed++;
          result.details.push({
            loan: loan.loan_number,
            status: 'failed',
            error: err.message
          });
        }
      }

      setJobResult({
        ...result,
        summary: {
          organization: selectedOrg?.name,
          total_processed: result.processed,
          total_succeeded: result.succeeded,
          total_failed: result.failed,
          total_skipped: result.skipped
        }
      });
    } catch (err) {
      setJobResult({ error: err.message });
    } finally {
      setRunningJob(null);
    }
  };

  // Helper to add log entry
  const addLog = (message) => {
    setClearLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
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
      'generated_letters': 'GeneratedLetter'
    };
    return map[tableName] || tableName;
  };

  // Helper to run operations with a specific org context
  const withOrgContext = async (orgId, operation) => {
    // Temporarily set the organization ID getter to return the target org
    setOrganizationIdGetter(() => orgId);
    try {
      return await operation();
    } finally {
      // Restore to null - the calling context should handle restoring proper state
      setOrganizationIdGetter(() => null);
    }
  };

  // Clear all data for a specific organization
  const clearAllDataForOrg = async (_orgId) => {
    addLog('Clearing existing data...');

    const totalSteps = 25;

    // 1. Delete accepted orphans
    setClearProgress({ current: 1, total: totalSteps, step: 'Deleting accepted orphans...' });
    try {
      const acceptedOrphans = await api.entities.AcceptedOrphan.listAll();
      if (acceptedOrphans.length > 0) {
        addLog(`  Deleting ${acceptedOrphans.length} accepted orphans...`);
        for (const ao of acceptedOrphans) {
          await api.entities.AcceptedOrphan.delete(ao.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete accepted orphans: ${e.message}`);
    }

    // 2. Delete borrower loan preferences
    setClearProgress({ current: 2, total: totalSteps, step: 'Deleting borrower preferences...' });
    try {
      const preferences = await api.entities.BorrowerLoanPreference.listAll();
      if (preferences.length > 0) {
        addLog(`  Deleting ${preferences.length} borrower loan preferences...`);
        for (const pref of preferences) {
          await api.entities.BorrowerLoanPreference.delete(pref.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete borrower preferences: ${e.message}`);
    }

    // 3. Delete receipt drafts
    setClearProgress({ current: 3, total: totalSteps, step: 'Deleting receipt drafts...' });
    try {
      const receipts = await api.entities.ReceiptDraft.listAll();
      if (receipts.length > 0) {
        addLog(`  Deleting ${receipts.length} receipt drafts...`);
        for (const r of receipts) {
          await api.entities.ReceiptDraft.delete(r.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete receipt drafts: ${e.message}`);
    }

    // 4. Delete audit logs
    setClearProgress({ current: 4, total: totalSteps, step: 'Deleting audit logs...' });
    addLog(`  Deleting audit logs...`);
    try {
      const auditLogs = await api.entities.AuditLog.listAll();
      if (auditLogs.length > 0) {
        addLog(`    Found ${auditLogs.length} audit logs`);
        for (let i = 0; i < auditLogs.length; i += 100) {
          const batch = auditLogs.slice(i, i + 100);
          for (const log of batch) {
            await api.entities.AuditLog.delete(log.id);
          }
          addLog(`    Deleted ${Math.min(i + 100, auditLogs.length)} of ${auditLogs.length} audit logs...`);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete audit logs: ${e.message}`);
    }

    // 5. Delete reconciliation entries
    setClearProgress({ current: 5, total: totalSteps, step: 'Deleting reconciliation entries...' });
    try {
      const entries = await api.entities.ReconciliationEntry.listAll();
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
      const patterns = await api.entities.ReconciliationPattern.listAll();
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
      const statements = await api.entities.BankStatement.listAll();
      if (statements.length > 0) {
        addLog(`  Deleting ${statements.length} bank statements...`);
        for (const stmt of statements) {
          await api.entities.BankStatement.delete(stmt.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete bank statements: ${e.message}`);
    }

    // 8. Delete value_history
    setClearProgress({ current: 8, total: totalSteps, step: 'Deleting value history...' });
    try {
      const valueHistory = await api.entities.ValueHistory.listAll();
      if (valueHistory.length > 0) {
        addLog(`  Deleting ${valueHistory.length} value history records...`);
        for (const vh of valueHistory) {
          await api.entities.ValueHistory.delete(vh.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete value history: ${e.message}`);
    }

    // 9. Delete loan_properties
    setClearProgress({ current: 9, total: totalSteps, step: 'Deleting loan-property links...' });
    try {
      const loanProperties = await api.entities.LoanProperty.listAll();
      if (loanProperties.length > 0) {
        addLog(`  Deleting ${loanProperties.length} loan-property links...`);
        for (const lp of loanProperties) {
          await api.entities.LoanProperty.delete(lp.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete loan-properties: ${e.message}`);
    }

    // 10. Delete properties
    setClearProgress({ current: 10, total: totalSteps, step: 'Deleting properties...' });
    try {
      const properties = await api.entities.Property.listAll();
      if (properties.length > 0) {
        addLog(`  Deleting ${properties.length} properties...`);
        for (const p of properties) {
          await api.entities.Property.delete(p.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete properties: ${e.message}`);
    }

    // 11. Delete transactions
    setClearProgress({ current: 11, total: totalSteps, step: 'Deleting transactions...' });
    addLog(`  Deleting transactions...`);
    try {
      const transactions = await api.entities.Transaction.listAll();
      if (transactions.length > 0) {
        addLog(`    Found ${transactions.length} transactions`);
        for (let i = 0; i < transactions.length; i += 100) {
          const batch = transactions.slice(i, i + 100);
          for (const tx of batch) {
            await api.entities.Transaction.delete(tx.id);
          }
          addLog(`    Deleted ${Math.min(i + 100, transactions.length)} of ${transactions.length} transactions...`);
        }
      }
    } catch (err) {
      addLog(`    Error during transaction deletion: ${err.message}`);
    }

    // 12. Delete repayment schedules
    setClearProgress({ current: 12, total: totalSteps, step: 'Deleting repayment schedules...' });
    addLog(`  Deleting repayment schedules...`);
    try {
      const schedules = await api.entities.RepaymentSchedule.listAll();
      if (schedules.length > 0) {
        addLog(`    Found ${schedules.length} schedules`);
        for (let i = 0; i < schedules.length; i += 100) {
          const batch = schedules.slice(i, i + 100);
          for (const sched of batch) {
            await api.entities.RepaymentSchedule.delete(sched.id);
          }
          addLog(`    Deleted ${Math.min(i + 100, schedules.length)} of ${schedules.length} schedules...`);
        }
      }
    } catch (err) {
      addLog(`    Error during schedule deletion: ${err.message}`);
    }

    // 13. Delete expenses
    setClearProgress({ current: 13, total: totalSteps, step: 'Deleting expenses...' });
    try {
      const expenses = await api.entities.Expense.listAll();
      if (expenses.length > 0) {
        addLog(`  Deleting ${expenses.length} expenses...`);
        for (const e of expenses) {
          try {
            await api.entities.Expense.delete(e.id);
          } catch {
            // Continue on error
          }
        }
      }
    } catch (e) {
      addLog(`  Note: Could not list/delete expenses: ${e.message}`);
    }

    // 14. Delete expense types
    setClearProgress({ current: 14, total: totalSteps, step: 'Deleting expense categories...' });
    try {
      const expenseTypes = await api.entities.ExpenseType.listAll();
      if (expenseTypes.length > 0) {
        addLog(`  Deleting ${expenseTypes.length} expense categories...`);
        for (const et of expenseTypes) {
          try {
            await api.entities.ExpenseType.delete(et.id);
          } catch {
            // Continue on error
          }
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete expense categories: ${e.message}`);
    }

    // 15. Delete other income
    setClearProgress({ current: 15, total: totalSteps, step: 'Deleting other income...' });
    try {
      const otherIncome = await api.entities.OtherIncome.listAll();
      if (otherIncome.length > 0) {
        addLog(`  Deleting ${otherIncome.length} other income records...`);
        for (const oi of otherIncome) {
          await api.entities.OtherIncome.delete(oi.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete other income: ${e.message}`);
    }

    // 16. Delete investor interest records
    setClearProgress({ current: 16, total: totalSteps, step: 'Deleting investor interest...' });
    try {
      const investorInterest = await api.entities.InvestorInterest.listAll();
      if (investorInterest.length > 0) {
        addLog(`  Deleting ${investorInterest.length} investor interest records...`);
        for (const ii of investorInterest) {
          await api.entities.InvestorInterest.delete(ii.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete investor interest: ${e.message}`);
    }

    // 17. Delete investor transactions
    setClearProgress({ current: 17, total: totalSteps, step: 'Deleting investor transactions...' });
    try {
      const investorTx = await api.entities.InvestorTransaction.listAll();
      if (investorTx.length > 0) {
        addLog(`  Deleting ${investorTx.length} investor transactions...`);
        for (const it of investorTx) {
          await api.entities.InvestorTransaction.delete(it.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete investor transactions: ${e.message}`);
    }

    // 18. Delete loans
    setClearProgress({ current: 18, total: totalSteps, step: 'Deleting loans...' });
    let loans = await api.entities.Loan.listAll();
    const initialLoanCount = loans.length;
    addLog(`  Deleting ${loans.length} loans...`);

    if (loans.length > 0) {
      // Clear restructure references first
      const withRestructureRef = loans.filter(l => l.restructured_from_loan_id).length;
      if (withRestructureRef > 0) {
        addLog(`    Clearing ${withRestructureRef} restructure references...`);
        for (const l of loans) {
          if (l.restructured_from_loan_id) {
            try {
              await api.entities.Loan.update(l.id, { restructured_from_loan_id: null });
            } catch {
              // Continue on error
            }
          }
        }
      }

      // Delete loans with retry
      let remainingLoans = loans;
      let maxPasses = 10;
      let passCount = 0;

      while (remainingLoans.length > 0 && passCount < maxPasses) {
        passCount++;
        const failedLoans = [];

        for (const l of remainingLoans) {
          try {
            await api.entities.Loan.delete(l.id);
          } catch {
            failedLoans.push(l);
          }
        }

        remainingLoans = failedLoans;
        if (remainingLoans.length > 0) {
          addLog(`    Pass ${passCount}: ${remainingLoans.length} loans remaining...`);
        }
      }

      if (remainingLoans.length > 0) {
        throw new Error(`Failed to delete all loans. ${remainingLoans.length} loans could not be deleted.`);
      }

      addLog(`    Deleted ${initialLoanCount} loans successfully`);
    }

    // 19. Delete borrowers
    setClearProgress({ current: 19, total: totalSteps, step: 'Deleting borrowers...' });
    const borrowers = await api.entities.Borrower.listAll();
    addLog(`  Deleting ${borrowers.length} borrowers...`);
    for (const b of borrowers) {
      try {
        await api.entities.Borrower.delete(b.id);
      } catch {
        // Continue on error
      }
    }

    // 20. Delete investors
    setClearProgress({ current: 20, total: totalSteps, step: 'Deleting investors...' });
    try {
      const investors = await api.entities.Investor.listAll();
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
      const investorProducts = await api.entities.InvestorProduct.listAll();
      if (investorProducts.length > 0) {
        addLog(`  Deleting ${investorProducts.length} investor products...`);
        for (const ip of investorProducts) {
          await api.entities.InvestorProduct.delete(ip.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete investor products: ${e.message}`);
    }

    // 22. Delete loan products
    setClearProgress({ current: 22, total: totalSteps, step: 'Deleting loan products...' });
    try {
      const loanProducts = await api.entities.LoanProduct.listAll();
      if (loanProducts.length > 0) {
        addLog(`  Deleting ${loanProducts.length} loan products...`);
        for (const lp of loanProducts) {
          await api.entities.LoanProduct.delete(lp.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete loan products: ${e.message}`);
    }

    // 23. Delete invitations
    setClearProgress({ current: 23, total: totalSteps, step: 'Deleting invitations...' });
    try {
      const invitations = await api.entities.Invitation.listAll();
      if (invitations.length > 0) {
        addLog(`  Deleting ${invitations.length} invitations...`);
        for (const inv of invitations) {
          await api.entities.Invitation.delete(inv.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete invitations: ${e.message}`);
    }

    // 24. Delete nightly job runs
    setClearProgress({ current: 24, total: totalSteps, step: 'Deleting job run history...' });
    try {
      const jobRuns = await api.entities.NightlyJobRun.listAll();
      if (jobRuns.length > 0) {
        addLog(`  Deleting ${jobRuns.length} nightly job runs...`);
        for (const jr of jobRuns) {
          await api.entities.NightlyJobRun.delete(jr.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete nightly job runs: ${e.message}`);
    }

    // 25. Organization summary (will be regenerated)
    setClearProgress({ current: 25, total: totalSteps, step: 'Deleting organization summary...' });
    addLog(`  Note: Organization summary will be recalculated by nightly job`);

    addLog('Data cleared successfully');
  };

  // Clear investor data only
  const clearInvestorDataForOrg = async () => {
    addLog('Clearing investor data...');

    setClearProgress({ current: 1, total: 2, step: 'Deleting investor transactions...' });
    try {
      const investorTx = await api.entities.InvestorTransaction.listAll();
      if (investorTx.length > 0) {
        addLog(`  Deleting ${investorTx.length} investor transactions...`);
        for (const tx of investorTx) {
          await api.entities.InvestorTransaction.delete(tx.id);
        }
      }
    } catch (e) {
      throw new Error(`Could not delete investor transactions: ${e.message}`);
    }

    setClearProgress({ current: 2, total: 2, step: 'Deleting investors...' });
    try {
      const investors = await api.entities.Investor.listAll();
      if (investors.length > 0) {
        addLog(`  Deleting ${investors.length} investors...`);
        for (const inv of investors) {
          await api.entities.Investor.delete(inv.id);
        }
      }
    } catch (e) {
      throw new Error(`Could not delete investors: ${e.message}`);
    }

    addLog('Investor data cleared successfully');
  };

  // Clear expenses only
  const clearExpensesForOrg = async () => {
    addLog('Clearing expenses and expense types...');

    setClearProgress({ current: 1, total: 2, step: 'Deleting expenses...' });
    try {
      const expenses = await api.entities.Expense.listAll();
      if (expenses.length > 0) {
        addLog(`  Deleting ${expenses.length} expenses...`);
        for (const e of expenses) {
          await api.entities.Expense.delete(e.id);
        }
      }
    } catch (e) {
      throw new Error(`Could not delete expenses: ${e.message}`);
    }

    setClearProgress({ current: 2, total: 2, step: 'Deleting expense types...' });
    try {
      const expenseTypes = await api.entities.ExpenseType.listAll();
      if (expenseTypes.length > 0) {
        addLog(`  Deleting ${expenseTypes.length} expense types...`);
        for (const et of expenseTypes) {
          await api.entities.ExpenseType.delete(et.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete expense types: ${e.message}`);
    }

    addLog('Expenses and expense types cleared successfully');
  };

  // Clear bank reconciliation data
  const clearBankReconciliationForOrg = async () => {
    addLog('Clearing bank reconciliation data...');

    setClearProgress({ current: 1, total: 3, step: 'Deleting reconciliation entries...' });
    try {
      const entries = await api.entities.ReconciliationEntry.listAll();
      if (entries.length > 0) {
        addLog(`  Deleting ${entries.length} reconciliation entries...`);
        for (const entry of entries) {
          await api.entities.ReconciliationEntry.delete(entry.id);
        }
      }
    } catch (e) {
      throw new Error(`Could not delete reconciliation entries: ${e.message}`);
    }

    setClearProgress({ current: 2, total: 3, step: 'Deleting reconciliation patterns...' });
    try {
      const patterns = await api.entities.ReconciliationPattern.listAll();
      if (patterns.length > 0) {
        addLog(`  Deleting ${patterns.length} reconciliation patterns...`);
        for (const pattern of patterns) {
          await api.entities.ReconciliationPattern.delete(pattern.id);
        }
      }
    } catch (e) {
      addLog(`  Note: Could not delete reconciliation patterns: ${e.message}`);
    }

    setClearProgress({ current: 3, total: 3, step: 'Deleting bank statements...' });
    try {
      const statements = await api.entities.BankStatement.listAll();
      if (statements.length > 0) {
        addLog(`  Deleting ${statements.length} bank statements...`);
        for (const stmt of statements) {
          await api.entities.BankStatement.delete(stmt.id);
        }
      }
    } catch (e) {
      throw new Error(`Could not delete bank statements: ${e.message}`);
    }

    addLog('Bank reconciliation data cleared successfully');
  };

  // Export backup handler
  const handleExportBackup = async (orgId) => {
    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    setIsExporting(true);
    setClearLogs([]);
    addLog('Starting backup export...');

    const backup = {
      version: '2.0',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportDate: new Date().toISOString(),
      organizationId: org.id,
      organizationName: org.name,
      organizationSettings: org.settings || {},
      tables: {},
      metadata: { recordCounts: {} }
    };

    const tables = [
      'loan_products', 'investor_products', 'expense_types', 'first_charge_holders',
      'borrowers', 'properties', 'Investor',
      'loans', 'loan_comments', 'InvestorTransaction', 'investor_interest',
      'transactions', 'repayment_schedules', 'loan_properties', 'expenses',
      'value_history', 'bank_statements', 'other_income',
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
      await withOrgContext(orgId, async () => {
        for (let i = 0; i < tables.length; i++) {
          const table = tables[i];
          const entityName = getEntityName(table);
          setExportProgress({ current: i + 1, total: tables.length, step: `Exporting ${table}...` });
          addLog(`  Exporting ${table}...`);

          try {
            const data = await api.entities[entityName].listAll();
            backup.tables[table] = data;
            backup.metadata.recordCounts[table] = data.length;
            addLog(`    Found ${data.length} records`);
          } catch (err) {
            addLog(`    Warning: Could not export ${table}: ${err.message}`);
            backup.tables[table] = [];
            backup.metadata.recordCounts[table] = 0;
          }
        }
      });

      // Generate and download file
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = org.name.replace(/[^a-zA-Z0-9]/g, '-');
      a.download = `backup-${safeName}-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const totalRecords = Object.values(backup.metadata.recordCounts).reduce((a, b) => a + b, 0);
      addLog(`Backup complete! ${totalRecords} total records exported.`);

      await logAudit({
        action: AuditAction.ORG_BACKUP_EXPORT,
        entityType: EntityType.ORGANIZATION,
        entityId: org.id,
        entityName: org.name,
        organizationId: org.id,
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
  const handleRestoreFileSelect = async (event, _orgId) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.version || !backup.tables || !backup.metadata) {
        toast.error('Invalid backup file format');
        return;
      }

      const totalRecords = Object.values(backup.metadata.recordCounts || {}).reduce((a, b) => a + b, 0);
      const analysis = analyzeBackup(backup, tableSchemas);

      setRestorePreview({
        ...backup,
        totalRecords,
        fileName: file.name,
        analysis
      });
      setRestoreConfirmText('');
    } catch (err) {
      toast.error('Could not read backup file: ' + err.message);
    }
  };

  // Execute restore
  const executeRestore = async (orgId) => {
    if (!restorePreview) return;

    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    setIsRestoring(true);
    setClearLogs([]);
    addLog('Starting restore process...');
    addLog('WARNING: This will delete ALL existing data first!');

    try {
      await withOrgContext(orgId, async () => {
        // Step 1: Clear all existing data
        addLog('Step 1: Clearing existing data...');
        setRestoreProgress({ current: 1, total: 3, step: 'Clearing existing data...' });
        await clearAllDataForOrg(orgId);

        // Step 2: Restore data in FK-safe order
        addLog('Step 2: Restoring data from backup...');
        setRestoreProgress({ current: 2, total: 3, step: 'Restoring data...' });

        const restoreOrder = [
          'loan_products', 'investor_products', 'expense_types', 'first_charge_holders',
          'borrowers', 'properties', 'Investor',
          'loans', 'loan_comments', 'InvestorTransaction', 'investor_interest',
          'transactions', 'repayment_schedules', 'loan_properties', 'expenses',
          'value_history', 'bank_statements', 'other_income',
          'borrower_loan_preferences', 'receipt_drafts',
          'reconciliation_patterns', 'reconciliation_entries',
          'accepted_orphans',
          'invitations',
          'nightly_job_runs',
          'organization_summary',
          'letter_templates',
          'generated_letters'
        ];

        let restoredCount = 0;
        const idMap = new Map();
        const remapId = (oldId) => oldId ? (idMap.get(oldId) || oldId) : null;

        const prepareRecord = (record, fkFields = []) => {
          const { id, organization_id: _orgId, created_at: _createdAt, updated_at: _updatedAt, ...rest } = record;
          rest._oldId = id;
          for (const fk of fkFields) {
            if (rest[fk]) {
              rest[fk] = remapId(rest[fk]);
            }
          }
          return rest;
        };

        const fkFieldMap = {
          'loans': ['borrower_id', 'product_id'],
          'loan_comments': ['loan_id', 'user_id'],
          'InvestorTransaction': ['investor_id', 'investor_product_id'],
          'investor_interest': ['investor_id'],
          'transactions': ['loan_id', 'borrower_id'],
          'repayment_schedules': ['loan_id'],
          'loan_properties': ['loan_id', 'property_id', 'first_charge_holder_id'],
          'expenses': ['type_id', 'loan_id'],
          'reconciliation_patterns': ['expense_type_id'],
          'value_history': ['loan_property_id'],
          'borrower_loan_preferences': ['borrower_id', 'loan_id'],
          'receipt_drafts': ['loan_id', 'borrower_id'],
          'reconciliation_entries': ['bank_statement_id', 'loan_transaction_id', 'investor_transaction_id', 'expense_id', 'other_income_id', 'interest_id'],
          'accepted_orphans': ['entity_id'],
          'organization_summary': [],
          'letter_templates': ['created_by'],
          'generated_letters': ['template_id', 'loan_id', 'borrower_id', 'created_by']
        };

        const loansWithRestructureRefs = [];

        for (const table of restoreOrder) {
          const records = restorePreview.tables[table];
          if (records && records.length > 0) {
            const entityName = getEntityName(table);
            addLog(`  Restoring ${table} (${records.length} records)...`);

            try {
              const fkFields = fkFieldMap[table] || [];
              const schemaProcessedRecords = processRecordsForRestore(table, records);
              let cleanRecords = schemaProcessedRecords.map(r => prepareRecord(r, fkFields));

              if (table === 'loans') {
                cleanRecords = cleanRecords.map(r => {
                  if (r.restructured_from_loan_id) {
                    loansWithRestructureRefs.push({
                      oldLoanId: r._oldId,
                      oldRestructuredFromId: r.restructured_from_loan_id
                    });
                    const { restructured_from_loan_id: _fromLoanId, ...rest } = r;
                    return rest;
                  }
                  return r;
                });
              }

              if (table === 'accepted_orphans') {
                cleanRecords = cleanRecords.map(r => {
                  if (r.entity_id) {
                    r.entity_id = remapId(r.entity_id);
                  }
                  return r;
                }).filter(r => r.entity_id);
              }

              if (cleanRecords.length > 0) {
                const oldIds = cleanRecords.map(r => r._oldId);
                const recordsToInsert = cleanRecords.map(r => {
                  const { _oldId, ...rest } = r;
                  return rest;
                });

                const created = await api.entities[entityName].createMany(recordsToInsert);

                if (created && created.length === oldIds.length) {
                  for (let i = 0; i < oldIds.length; i++) {
                    if (oldIds[i] && created[i]?.id) {
                      idMap.set(oldIds[i], created[i].id);
                    }
                  }
                }

                restoredCount += cleanRecords.length;
                addLog(`    Restored ${cleanRecords.length} records`);
              }
            } catch (err) {
              addLog(`    ERROR restoring ${table}: ${err.message}`);
            }
          }
        }

        // Update loan restructure references
        if (loansWithRestructureRefs.length > 0) {
          addLog(`  Updating ${loansWithRestructureRefs.length} loan restructure references...`);
          for (const ref of loansWithRestructureRefs) {
            const newLoanId = idMap.get(ref.oldLoanId);
            const newRestructuredFromId = idMap.get(ref.oldRestructuredFromId);
            if (newLoanId && newRestructuredFromId) {
              try {
                await api.entities.Loan.update(newLoanId, {
                  restructured_from_loan_id: newRestructuredFromId
                });
              } catch (err) {
                addLog(`    Failed to update restructure ref: ${err.message}`);
              }
            }
          }
        }

        // Restore organization settings if present
        if (restorePreview.organizationSettings && Object.keys(restorePreview.organizationSettings).length > 0) {
          addLog('  Restoring organization settings...');
          try {
            await supabase
              .from('organizations')
              .update({
                settings: {
                  ...org.settings,
                  ...restorePreview.organizationSettings
                }
              })
              .eq('id', org.id);
            addLog('    Organization settings restored');
          } catch (err) {
            addLog(`    Warning: Could not restore organization settings: ${err.message}`);
          }
        }

        // Step 3: Refresh queries
        addLog('Step 3: Refreshing application data...');
        setRestoreProgress({ current: 3, total: 3, step: 'Refreshing data...' });
        queryClient.invalidateQueries();

        await logAudit({
          action: AuditAction.ORG_BACKUP_RESTORE,
          entityType: EntityType.ORGANIZATION,
          entityId: org.id,
          entityName: org.name,
          organizationId: org.id,
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
      });
    } catch (err) {
      addLog(`Error during restore: ${err.message}`);
      toast.error('Failed to restore backup: ' + err.message);
    } finally {
      setIsRestoring(false);
      setRestoreProgress({ current: 0, total: 0, step: '' });
    }
  };

  // Handle clear expenses
  const handleClearExpenses = async (orgId) => {
    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    if (!window.confirm(`Are you sure you want to delete ALL expenses and expense types for "${org.name}"?\n\nThis will delete:\n• All expense records\n• All expense types/categories\n\nThis action CANNOT be undone!`)) {
      return;
    }

    setClearing(true);
    setClearResult(null);
    setClearLogs([]);

    try {
      await withOrgContext(orgId, async () => {
        await clearExpensesForOrg();
      });
      setClearResult({ success: true, message: 'All expenses and expense types cleared successfully!' });
      queryClient.invalidateQueries(['expenses']);
      queryClient.invalidateQueries(['expense-types']);
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  // Handle clear investor data
  const handleClearInvestorData = async (orgId) => {
    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    if (!window.confirm(`Are you sure you want to delete ALL investor data for "${org.name}"?\n\nThis will delete:\n• All investor transactions\n• All investor accounts\n\nInvestor products will be preserved. This action CANNOT be undone!`)) {
      return;
    }

    setClearing(true);
    setClearResult(null);
    setClearLogs([]);

    try {
      await withOrgContext(orgId, async () => {
        await clearInvestorDataForOrg();
      });
      setClearResult({ success: true, message: 'All investor data cleared successfully!' });
      queryClient.invalidateQueries(['investors']);
      queryClient.invalidateQueries(['investorTransactions']);
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  // Handle clear bank reconciliation
  const handleClearBankReconciliation = async (orgId) => {
    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    if (!window.confirm(`Are you sure you want to delete ALL bank reconciliation data for "${org.name}"?\n\nThis will delete:\n• All bank statement entries\n• All reconciliation links\n• All learned reconciliation patterns\n\nThis action CANNOT be undone!`)) {
      return;
    }

    setClearing(true);
    setClearResult(null);
    setClearLogs([]);

    try {
      await withOrgContext(orgId, async () => {
        await clearBankReconciliationForOrg();
      });
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
  const handleClearAllData = async (orgId) => {
    const org = allOrganizations.find(o => o.id === orgId);
    if (!org) return;

    if (!window.confirm(`Are you sure you want to delete ALL data for "${org.name}"?\n\nThis will delete:\n• All borrowers\n• All loans\n• All loan products\n• All transactions\n• All repayment schedules\n• All properties and security\n• All expenses and expense categories\n• All investors, investor transactions, and investor products\n• All investor interest records\n• All bank reconciliation data\n• All other income records\n• All audit logs\n\nThis action CANNOT be undone!`)) {
      return;
    }

    const expectedConfirm = `DELETE ${org.name}`;
    const confirmText = window.prompt(`Type "${expectedConfirm}" to confirm permanent data deletion:`);
    if (confirmText !== expectedConfirm) {
      alert(`Deletion cancelled. You must type "${expectedConfirm}" exactly.`);
      return;
    }

    setClearing(true);
    setClearResult(null);
    setClearLogs([]);

    try {
      await withOrgContext(orgId, async () => {
        await clearAllDataForOrg(orgId);
      });
      setClearResult({ success: true, message: 'All data cleared successfully!' });
      queryClient.invalidateQueries();
    } catch (err) {
      setClearResult({ success: false, message: err.message });
    } finally {
      setClearing(false);
    }
  };

  // Access check
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="p-4 md:p-6 space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Super Admin</h1>
            <p className="text-slate-500 mt-1">Cross-organization system management</p>
          </div>
          <Alert className="border-red-200 bg-red-50">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              You don't have permission to access this page. Super Admin access is required.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const isLoading = loadingUsers || loadingOrgs || loadingMemberships;

  // Refresh all data
  const handleRefresh = () => {
    // Invalidate with refetch to force immediate reload
    queryClient.invalidateQueries({ queryKey: ['super-admin-users'], refetchType: 'all' });
    queryClient.invalidateQueries({ queryKey: ['super-admin-orgs'], refetchType: 'all' });
    // For memberships, we need to reset the query completely since it depends on other data
    queryClient.resetQueries({ queryKey: ['super-admin-memberships'] });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
            <Crown className="w-8 h-8 text-amber-500" />
            Super Admin
          </h1>
          <p className="text-slate-500 mt-1">Cross-organization system management</p>
        </div>

        <Alert className="border-amber-200 bg-amber-50">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            <strong>Super Admin Mode</strong> - You have access to all users and organizations across the entire system.
          </AlertDescription>
        </Alert>

        {/* Default Organization Setting */}
        <Card className="max-w-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Default Organization
            </CardTitle>
            <CardDescription>
              Choose which organization to load by default when you log in
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Select
                value={defaultOrgId || 'none'}
                onValueChange={(val) => saveDefaultOrg(val === 'none' ? '' : val)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select default organization..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (use first available)</SelectItem>
                  {allOrganizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isSavingDefaultOrg && (
                <div className="flex items-center text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Session Timeout Setting */}
        <Card className="max-w-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Session Timeout
            </CardTitle>
            <CardDescription>
              Users will be logged out after this many minutes of inactivity
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={5}
                max={60}
                value={sessionTimeoutMinutes}
                onChange={(e) => setSessionTimeoutMinutes(parseInt(e.target.value, 10) || 20)}
                className="w-24"
              />
              <span className="text-sm text-slate-600">minutes</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveSessionTimeout(sessionTimeoutMinutes)}
                disabled={isSavingTimeout}
              >
                {isSavingTimeout ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Save'
                )}
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Valid range: 5-60 minutes. Changes apply to new sessions.
            </p>
          </CardContent>
        </Card>

        {/* Search and Refresh */}
        <div className="flex gap-2 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search users or organizations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh data"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users ({allUsers.length})
            </TabsTrigger>
            <TabsTrigger value="organizations" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Orgs ({allOrganizations.length})
            </TabsTrigger>
            <TabsTrigger value="jobs" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Nightly Jobs
            </TabsTrigger>
            <TabsTrigger value="data" className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Data Management
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>System Users</CardTitle>
                <CardDescription>All users across all organizations</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    No users found
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-slate-600">User</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600">Organizations</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                          <th className="px-4 py-3 text-right font-medium text-slate-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredUsers.map((u) => {
                          const memberships = getUserMemberships(u.id);
                          return (
                            <tr key={u.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <div>
                                  <div className="font-medium text-slate-900 flex items-center gap-2">
                                    {u.full_name || 'No name'}
                                    {u.is_super_admin && (
                                      <Crown className="w-4 h-4 text-amber-500" />
                                    )}
                                  </div>
                                  <div className="text-slate-500 text-xs flex items-center gap-1">
                                    <Mail className="w-3 h-3" />
                                    {u.email}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {memberships.length === 0 ? (
                                    <span className="text-slate-400 text-xs">No organizations</span>
                                  ) : (
                                    memberships.slice(0, 3).map(m => (
                                      <Badge key={m.id} variant="secondary" className="text-xs">
                                        {m.organization?.name || 'Unknown'}
                                      </Badge>
                                    ))
                                  )}
                                  {memberships.length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{memberships.length - 3} more
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {u.is_super_admin ? (
                                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                                    Super Admin
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">User</Badge>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenUserDetails(u)}
                                >
                                  Manage
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Organizations Tab */}
          <TabsContent value="organizations" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>All Organizations</CardTitle>
                  <CardDescription>System-wide organization list</CardDescription>
                </div>
                <Button onClick={() => setIsCreateOrgOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Organization
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : filteredOrgs.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    No organizations found
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-slate-600">Organization</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600">Members</th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredOrgs.map((org) => {
                          const members = getOrgMembers(org.id);
                          return (
                            <tr key={org.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <Building2 className="w-4 h-4 text-slate-400" />
                                  <span className="font-medium text-slate-900">{org.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="secondary">
                                    {members.length} member{members.length !== 1 ? 's' : ''}
                                  </Badge>
                                  {members.filter(m => m.role === 'Admin').length > 0 && (
                                    <Badge variant="outline" className="text-xs">
                                      {members.filter(m => m.role === 'Admin').length} admin{members.filter(m => m.role === 'Admin').length !== 1 ? 's' : ''}
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-sm">
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {org.created_at ? format(new Date(org.created_at), 'MMM d, yyyy') : 'Unknown'}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Nightly Jobs Tab */}
          <TabsContent value="jobs" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-slate-600" />
                  Nightly Jobs
                </CardTitle>
                <CardDescription>
                  Run scheduled maintenance tasks manually or view recent automated runs.
                  These tasks run across all organizations.
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

                {/* Regenerate Schedules Section */}
                <div className="border rounded-lg p-4 bg-slate-50 space-y-3 mt-4">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-slate-600" />
                    <span className="font-medium text-slate-900">Regenerate Schedules</span>
                  </div>
                  <p className="text-sm text-slate-500">
                    Regenerate repayment schedules for all Live loans in an organization, recalculating interest based on current transaction history.
                  </p>
                  <div className="flex gap-2">
                    <Select value={selectedOrgForSchedules} onValueChange={setSelectedOrgForSchedules}>
                      <SelectTrigger className="w-64">
                        <SelectValue placeholder="Select organization..." />
                      </SelectTrigger>
                      <SelectContent>
                        {allOrganizations.map(org => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleRegenerateSchedules}
                      disabled={!selectedOrgForSchedules || !!runningJob}
                    >
                      {runningJob === 'regenerate_schedules' ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Regenerate
                    </Button>
                  </div>
                </div>

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
                          <p className="font-medium">
                            {jobResult.task === 'regenerate_schedules'
                              ? `Schedules regenerated for ${jobResult.summary?.organization || 'organization'}`
                              : 'Job completed successfully'}
                          </p>
                          <p className="text-sm">
                            Processed: {jobResult.summary?.total_processed || 0} |
                            Succeeded: {jobResult.summary?.total_succeeded || 0} |
                            Failed: {jobResult.summary?.total_failed || 0} |
                            Skipped: {jobResult.summary?.total_skipped || 0}
                          </p>
                          {jobResult.duration_ms && (
                            <p className="text-xs text-slate-500">
                              Duration: {jobResult.duration_ms}ms
                            </p>
                          )}
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
          </TabsContent>

          {/* Data Management Tab */}
          <TabsContent value="data" className="mt-6">
            <div className="space-y-6">
              {/* Organization Selector */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Select Organization
                  </CardTitle>
                  <CardDescription>Choose an organization to manage data for</CardDescription>
                </CardHeader>
                <CardContent>
                  <Select value={selectedOrgForData} onValueChange={setSelectedOrgForData}>
                    <SelectTrigger className="w-full max-w-md">
                      <SelectValue placeholder="Select organization..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allOrganizations.map(org => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {selectedOrgForData && (
                <>
                  {/* Backup & Restore */}
                  <Card className="border-blue-200">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <HardDrive className="w-5 h-5 text-blue-600" />
                        Data Backup & Restore
                      </CardTitle>
                      <CardDescription>
                        Export and restore data for {allOrganizations.find(o => o.id === selectedOrgForData)?.name}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Export */}
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-slate-900">Export Backup</h4>
                          <p className="text-sm text-slate-600">
                            Download a complete backup of all organization data as a JSON file.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => handleExportBackup(selectedOrgForData)}
                          disabled={isExporting || isRestoring || clearing}
                          className="w-full max-w-xs"
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
                          <Progress value={(exportProgress.current / exportProgress.total) * 100} className="max-w-xs" />
                        )}
                      </div>

                      {/* Restore */}
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
                          onChange={(e) => handleRestoreFileSelect(e, selectedOrgForData)}
                          disabled={isExporting || isRestoring || clearing}
                          className="cursor-pointer max-w-xs"
                        />

                        {/* Restore Preview */}
                        {restorePreview && (
                          <div className="p-4 bg-slate-50 rounded-lg border space-y-3 max-w-lg">
                            <div className="space-y-1 text-sm">
                              <p><strong>File:</strong> {restorePreview.fileName}</p>
                              <p><strong>Backup Date:</strong> {format(new Date(restorePreview.exportDate), 'PPpp')}</p>
                              <p><strong>Total Records:</strong> {restorePreview.totalRecords.toLocaleString()}</p>
                            </div>

                            <div className="space-y-2">
                              <Label className="text-sm">
                                Type <strong>DELETE {allOrganizations.find(o => o.id === selectedOrgForData)?.name}</strong> to confirm:
                              </Label>
                              <Input
                                value={restoreConfirmText}
                                onChange={(e) => setRestoreConfirmText(e.target.value)}
                                placeholder={`DELETE ${allOrganizations.find(o => o.id === selectedOrgForData)?.name}`}
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
                              >
                                Cancel
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => executeRestore(selectedOrgForData)}
                                disabled={isRestoring || restoreConfirmText !== `DELETE ${allOrganizations.find(o => o.id === selectedOrgForData)?.name}`}
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

                        {isRestoring && restoreProgress.total > 0 && (
                          <div className="space-y-2 max-w-xs">
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
                  <Card className="border-red-200">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-red-900">
                        <AlertTriangle className="w-5 h-5" />
                        Danger Zone
                      </CardTitle>
                      <CardDescription className="text-red-700">
                        Destructive actions for {allOrganizations.find(o => o.id === selectedOrgForData)?.name}
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
                          onClick={() => handleClearExpenses(selectedOrgForData)}
                          disabled={clearing}
                          className="border-red-300 text-red-900 hover:bg-red-50"
                        >
                          {clearing ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Receipt className="w-4 h-4 mr-2" />
                          )}
                          Clear Expenses
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() => handleClearInvestorData(selectedOrgForData)}
                          disabled={clearing}
                          className="border-red-300 text-red-900 hover:bg-red-50"
                        >
                          {clearing ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <TrendingUp className="w-4 h-4 mr-2" />
                          )}
                          Clear Investor Data
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() => handleClearBankReconciliation(selectedOrgForData)}
                          disabled={clearing}
                          className="border-red-300 text-red-900 hover:bg-red-50"
                        >
                          {clearing ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <FileSpreadsheet className="w-4 h-4 mr-2" />
                          )}
                          Clear Bank Reconciliation
                        </Button>

                        <Button
                          variant="destructive"
                          onClick={() => handleClearAllData(selectedOrgForData)}
                          disabled={clearing}
                        >
                          {clearing ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4 mr-2" />
                          )}
                          Clear All Data
                        </Button>
                      </div>

                      {/* Progress */}
                      {clearing && clearProgress.total > 0 && (
                        <div className="space-y-2 max-w-xs">
                          <div className="flex justify-between text-sm text-slate-600">
                            <span>{clearProgress.step}</span>
                            <span>{clearProgress.current} / {clearProgress.total}</span>
                          </div>
                          <Progress value={(clearProgress.current / clearProgress.total) * 100} />
                        </div>
                      )}

                      {/* Result */}
                      {clearResult && (
                        <Alert className={clearResult.success ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}>
                          <AlertDescription className={clearResult.success ? 'text-emerald-800' : 'text-red-800'}>
                            {clearResult.message}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Logs */}
                      {clearLogs.length > 0 && (
                        <div className="bg-slate-900 rounded-lg p-4 max-h-64 overflow-y-auto">
                          <div className="space-y-1 text-xs text-slate-300 font-mono">
                            {clearLogs.map((log, i) => (
                              <div key={i}>{log}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* User Details Modal */}
      <Dialog open={isUserModalOpen} onOpenChange={setIsUserModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              User Details
            </DialogTitle>
            <DialogDescription>
              Manage user access and organization memberships
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6">
              {/* User Info */}
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg text-slate-900 flex items-center gap-2">
                      {selectedUser.full_name || 'No name'}
                      {selectedUser.is_super_admin && (
                        <Crown className="w-5 h-5 text-amber-500" />
                      )}
                    </h3>
                    <p className="text-slate-500 flex items-center gap-1 mt-1">
                      <Mail className="w-4 h-4" />
                      {selectedUser.email}
                    </p>
                    {selectedUser.created_at && (
                      <p className="text-slate-400 text-sm mt-1">
                        Joined {formatDistanceToNow(new Date(selectedUser.created_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                  <div>
                    {selectedUser.id !== user?.id && (
                      <Button
                        variant={selectedUser.is_super_admin ? "destructive" : "outline"}
                        size="sm"
                        onClick={() => toggleSuperAdminMutation.mutate({
                          userId: selectedUser.id,
                          newStatus: !selectedUser.is_super_admin
                        })}
                        disabled={toggleSuperAdminMutation.isPending}
                      >
                        {toggleSuperAdminMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : selectedUser.is_super_admin ? (
                          <>
                            <X className="w-4 h-4 mr-1" />
                            Remove Super Admin
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4 mr-1" />
                            Make Super Admin
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Organization Memberships */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-slate-900">Organization Memberships</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsAddToOrgOpen(true)}
                    disabled={getAvailableOrgsForUser(selectedUser.id).length === 0}
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    Add to Organization
                  </Button>
                </div>

                {getUserMemberships(selectedUser.id).length === 0 ? (
                  <div className="text-center py-6 text-slate-500 bg-slate-50 rounded-lg">
                    This user is not a member of any organization
                  </div>
                ) : (
                  <div className="space-y-2">
                    {getUserMemberships(selectedUser.id).map(membership => (
                      <div
                        key={membership.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Building2 className="w-5 h-5 text-slate-400" />
                          <div>
                            <p className="font-medium text-slate-900">
                              {membership.organization?.name || 'Unknown Organization'}
                            </p>
                            <p className="text-xs text-slate-500">
                              Added {membership.created_at ? formatDistanceToNow(new Date(membership.created_at), { addSuffix: true }) : 'unknown'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={membership.role}
                            onValueChange={(newRole) => changeRoleMutation.mutate({
                              userId: selectedUser.id,
                              organizationId: membership.organization_id,
                              newRole
                            })}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Viewer">Viewer</SelectItem>
                              <SelectItem value="Manager">Manager</SelectItem>
                              <SelectItem value="Admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              if (window.confirm(`Remove ${selectedUser.email} from ${membership.organization?.name}?`)) {
                                removeFromOrgMutation.mutate({
                                  userId: selectedUser.id,
                                  organizationId: membership.organization_id
                                });
                              }
                            }}
                            disabled={removeFromOrgMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUserModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to Organization Dialog */}
      <Dialog open={isAddToOrgOpen} onOpenChange={setIsAddToOrgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Organization</DialogTitle>
            <DialogDescription>
              Add {selectedUser?.email} to an organization
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Organization</label>
              <Select value={selectedOrgForAdd} onValueChange={setSelectedOrgForAdd}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select organization..." />
                </SelectTrigger>
                <SelectContent>
                  {selectedUser && getAvailableOrgsForUser(selectedUser.id).map(org => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Role</label>
              <Select value={selectedRoleForAdd} onValueChange={setSelectedRoleForAdd}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Viewer">Viewer</SelectItem>
                  <SelectItem value="Manager">Manager</SelectItem>
                  <SelectItem value="Admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddToOrgOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddToOrg}
              disabled={!selectedOrgForAdd || addToOrgMutation.isPending}
            >
              {addToOrgMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Add to Organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Organization Dialog */}
      <CreateOrganizationDialog
        open={isCreateOrgOpen}
        onClose={() => {
          setIsCreateOrgOpen(false);
          // Refresh organizations list after creation
          queryClient.invalidateQueries(['super-admin-organizations']);
        }}
      />
    </div>
  );
}
