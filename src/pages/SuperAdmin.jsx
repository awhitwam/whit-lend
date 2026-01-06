import { useState } from 'react';
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
  Plus
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
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

  // Schedule regeneration state
  const [selectedOrgForSchedules, setSelectedOrgForSchedules] = useState('');

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
          <TabsList className="grid w-full max-w-lg grid-cols-3">
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
