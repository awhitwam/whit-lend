import { useState, useEffect } from 'react';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, History, Loader2, Search, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';

// Storage key for filter preferences
const AUDIT_FILTER_PREFS_KEY = 'audit_log_filter_prefs';

// Default filter settings
const defaultFilterPrefs = {
  showLoginActivity: false,      // Login/logout events
  showOrgSwitches: false,        // Organization switch events
  showReconciliation: true,      // Reconciliation activity
  showBulkImports: true,         // Bulk import activity
};

// Load saved preferences from localStorage
const loadFilterPrefs = () => {
  try {
    const saved = localStorage.getItem(AUDIT_FILTER_PREFS_KEY);
    if (saved) {
      return { ...defaultFilterPrefs, ...JSON.parse(saved) };
    }
  } catch (err) {
    console.error('Error loading audit filter preferences:', err);
  }
  return defaultFilterPrefs;
};

// Save preferences to localStorage
const saveFilterPrefs = (prefs) => {
  try {
    localStorage.setItem(AUDIT_FILTER_PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error('Error saving audit filter preferences:', err);
  }
};

export default function AuditLog() {
  const { currentOrganization } = useOrganization();
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilter, setAuditFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterPrefs, setFilterPrefs] = useState(loadFilterPrefs);
  const auditPerPage = 25;

  // Update a filter preference and save to localStorage
  const updateFilterPref = (key, value) => {
    const newPrefs = { ...filterPrefs, [key]: value };
    setFilterPrefs(newPrefs);
    saveFilterPrefs(newPrefs);
    setAuditPage(1); // Reset to first page when filter changes
  };

  // Fetch audit logs
  const { data: auditLogs = [], isLoading: auditLoading } = useQuery({
    queryKey: ['audit-logs', currentOrganization?.id],
    queryFn: () => api.entities.AuditLog.list('-created_at', 500),
    enabled: !!currentOrganization
  });

  // Fetch user profiles to display names in audit log
  const { data: userProfiles = [] } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: () => api.entities.UserProfile.list(),
    enabled: !!currentOrganization
  });

  // Create a lookup map for user IDs to names/emails
  const userLookup = userProfiles.reduce((acc, profile) => {
    acc[profile.id] = profile.full_name || profile.email || profile.id?.slice(0, 8);
    return acc;
  }, {});

  // Filter and paginate audit logs
  const filteredAuditLogs = auditLogs.filter(log => {
    const action = log.action?.toLowerCase() || '';

    // Apply toggle filters (exclude by default unless enabled)
    // Login activity filter (login, logout, login_failed)
    const isLoginActivity = action === 'login' || action === 'logout' || action === 'login_failed';
    if (isLoginActivity && !filterPrefs.showLoginActivity) return false;

    // Organization switch filter
    const isOrgSwitch = action === 'org_switch';
    if (isOrgSwitch && !filterPrefs.showOrgSwitches) return false;

    // Reconciliation filter
    const isReconciliation = log.entity_type === 'reconciliation' || action.includes('reconciliation');
    if (isReconciliation && !filterPrefs.showReconciliation) return false;

    // Bulk import filter
    const isBulkImport = action.includes('bulk_import');
    if (isBulkImport && !filterPrefs.showBulkImports) return false;

    // Apply dropdown filter
    if (auditFilter !== 'all') {
      switch (auditFilter) {
        case 'creates':
          if (!action.includes('create') && !action.includes('import')) return false;
          break;
        case 'updates':
          if (!action.includes('update') && !action.includes('match')) return false;
          break;
        case 'deletes':
          if (!action.includes('delete') && !action.includes('unmatch')) return false;
          break;
        case 'loans':
          if (log.entity_type !== 'loan') return false;
          break;
        case 'transactions':
          if (log.entity_type !== 'transaction') return false;
          break;
        case 'borrowers':
          if (log.entity_type !== 'borrower') return false;
          break;
        case 'reconciliation':
          if (log.entity_type !== 'reconciliation') return false;
          break;
      }
    }

    // Apply text search filter
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      const userName = userLookup[log.user_id]?.toLowerCase() || '';
      const entityName = log.entity_name?.toLowerCase() || '';
      const entityType = log.entity_type?.toLowerCase() || '';
      const subAction = (log.sub_action || '').toLowerCase();
      const details = JSON.stringify(log.details || '').toLowerCase();

      return userName.includes(search) ||
             entityName.includes(search) ||
             action.includes(search) ||
             entityType.includes(search) ||
             subAction.includes(search) ||
             details.includes(search);
    }

    return true;
  });

  const totalAuditPages = Math.ceil(filteredAuditLogs.length / auditPerPage);
  const paginatedAuditLogs = filteredAuditLogs.slice(
    (auditPage - 1) * auditPerPage,
    auditPage * auditPerPage
  );

  const getActionBadgeColor = (action) => {
    if (!action) return 'bg-slate-100 text-slate-700';
    const lowerAction = action.toLowerCase();
    if (lowerAction.includes('create') || lowerAction.includes('import')) return 'bg-green-100 text-green-700';
    if (lowerAction.includes('update') || lowerAction.includes('match')) return 'bg-blue-100 text-blue-700';
    if (lowerAction.includes('delete') || lowerAction.includes('unmatch')) return 'bg-red-100 text-red-700';
    if (lowerAction.includes('login') || lowerAction.includes('logout')) return 'bg-purple-100 text-purple-700';
    if (lowerAction === 'org_switch') return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-700';
  };

  // Parse JSON safely
  const parseJson = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  // Keys to skip in display (internal/technical fields)
  const skipKeys = ['source', 'loan_id', 'borrower_id', 'investor_id', 'draft_id', 'entity_id',
    'bank_statement_id', 'transaction_id', 'id', 'organization_id', 'user_id'];

  // Keys that are used as sub-actions and should be excluded from details display
  const subActionKeys = ['action', 'type', 'match_type', 'reconciliation_type', 'match_mode',
    'charge_type', 'value_type', 'category', 'entityType'];

  // Extract sub-action from log entry based on action type
  const getSubAction = (log) => {
    // First check if sub_action column is populated (new logs)
    if (log.sub_action) return log.sub_action;

    const details = parseJson(log.details);
    if (!details) return null;

    const action = log.action?.toLowerCase() || '';

    // Transaction events - use 'action' field (e.g., edit_disbursement, add_repayment)
    if (action.includes('transaction')) {
      if (details.action) return details.action;
      if (details.source) return details.source;
      if (details.reason) return details.reason;
    }

    // Reconciliation events - use type/match_type/match_mode
    if (action.includes('reconciliation')) {
      if (details.reconciliation_type) return details.reconciliation_type;
      if (details.type) return details.type;
      if (details.match_type) return details.match_type;
      if (details.match_mode) return details.match_mode;
    }

    // Bulk imports - use entityType
    if (action.includes('bulk_import') || action.includes('import')) {
      if (details.entityType) return details.entityType;
    }

    // Expense events - use category/type_name
    if (action.includes('expense')) {
      if (details.category) return details.category;
      if (details.type_name) return details.type_name;
    }

    // Investor transaction events - use type
    if (action.includes('investor_transaction') || action.includes('investor_interest')) {
      if (details.type) return details.type;
      if (details.transaction_type) return details.transaction_type;
    }

    // Loan property events - use charge_type
    if (action.includes('property') || action.includes('loan_property')) {
      if (details.charge_type) return details.charge_type;
      if (details.value_type) return details.value_type;
    }

    // Loan events - check for reason or status changes
    if (action.includes('loan') && !action.includes('property')) {
      if (details.edit_reason) return null; // edit_reason shows in details, not sub-action
      if (details.status && action.includes('update')) return `status: ${details.status}`;
    }

    // Backup events
    if (action.includes('backup')) {
      if (details.totalRecords) return `${details.totalRecords} records`;
      if (details.restoredRecords) return `${details.restoredRecords} records`;
    }

    return null;
  };

  // Format sub-action for display (convert snake_case to Title Case)
  const formatSubAction = (subAction) => {
    if (!subAction) return null;
    return subAction.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Check if value looks like a UUID
  const isUuid = (value) => {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  };

  // Format field name for display
  const formatFieldName = (key) => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatChanges = (log) => {
    const details = parseJson(log.details);
    const previousValues = parseJson(log.previous_values);
    const newValues = parseJson(log.new_values);

    const result = [];

    // Check for edit_reason in details (loan edits, transaction edits, etc.)
    if (details?.edit_reason) {
      result.push(
        <div key="edit_reason" className="text-xs mb-1 p-1.5 bg-amber-50 border border-amber-200 rounded">
          <span className="font-medium text-amber-700">Reason:</span>{' '}
          <span className="text-amber-900 italic">{details.edit_reason}</span>
        </div>
      );
    }

    // If we have previous and new values, show a diff
    if (previousValues && newValues) {
      const changedKeys = Object.keys(newValues).filter(k => {
        if (skipKeys.includes(k)) return false;
        if (k.endsWith('_id')) return false;
        if (k === 'edit_reason') return false; // Already shown above
        const oldVal = previousValues[k];
        const newVal = newValues[k];
        // Skip if both are null/undefined
        if ((oldVal === null || oldVal === undefined) && (newVal === null || newVal === undefined)) return false;
        return JSON.stringify(oldVal) !== JSON.stringify(newVal);
      });

      if (changedKeys.length > 0) {
        const changes = changedKeys.slice(0, 3).map(key => (
          <div key={key} className="text-xs">
            <span className="font-medium">{formatFieldName(key)}:</span>{' '}
            <span className="text-red-500 line-through mr-1">
              {formatValue(previousValues[key], key)}
            </span>
            <span className="text-green-600">
              {formatValue(newValues[key], key)}
            </span>
          </div>
        ));
        result.push(...changes);
      }
    }

    // If we have details, show them (filtered)
    if (details && typeof details === 'object' && result.length <= 1) {
      const entries = Object.entries(details).filter(([key, value]) => {
        if (skipKeys.includes(key)) return false;
        if (subActionKeys.includes(key)) return false; // Shown in Sub-Action column
        if (key === 'edit_reason') return false; // Already shown above
        if (key.endsWith('_id') && isUuid(value)) return false;
        if (value === null || value === undefined) return false;
        if (isUuid(value)) return false;
        return true;
      });

      if (entries.length > 0) {
        const detailItems = entries.slice(0, 5).map(([key, value]) => (
          <div key={key} className="text-xs">
            <span className="font-medium">{formatFieldName(key)}:</span>{' '}
            <span className="text-slate-600">{formatValue(value, key)}</span>
          </div>
        ));
        result.push(...detailItems);
      }
    }

    return result.length > 0 ? result : '-';
  };

  // Fields that should be formatted as currency
  const currencyFields = ['principal_paid', 'interest_paid', 'principal_amount', 'interest_amount',
    'amount', 'total_interest', 'fees_paid', 'fees_applied', 'principal_applied', 'interest_applied'];

  // Fields that should be formatted as dates
  const dateFields = ['transaction_date', 'date', 'start_date', 'end_date', 'due_date', 'payment_date',
    'statement_date', 'reconciled_at', 'deleted_date', 'created_date', 'maturity_date'];

  // Check if a string looks like a date (YYYY-MM-DD or ISO format)
  const isDateString = (value) => {
    if (typeof value !== 'string') return false;
    return /^\d{4}-\d{2}-\d{2}(T|$)/.test(value);
  };

  const formatValue = (value, fieldName = '') => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';

    // Format date fields
    const isDateField = dateFields.includes(fieldName) || fieldName.includes('_date');
    if (isDateField || isDateString(value)) {
      try {
        const dateVal = new Date(value);
        if (!isNaN(dateVal.getTime())) {
          return format(dateVal, 'MMM d, yyyy');
        }
      } catch {
        // Fall through to default handling
      }
    }

    if (typeof value === 'number') {
      // Format as currency for known money fields or any number that looks like money
      const isCurrencyField = currencyFields.includes(fieldName);
      if (isCurrencyField || (value >= 0 && fieldName.includes('paid'))) {
        return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return value.toLocaleString();
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : '-';
    }
    if (typeof value === 'object') {
      // For nested objects, show summary
      const keys = Object.keys(value);
      if (keys.length === 0) return '-';
      return `{${keys.length} items}`;
    }
    const strVal = String(value);
    // Don't show UUIDs
    if (isUuid(strVal)) return '-';
    return strVal.slice(0, 50);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Audit Log</h1>
          <p className="text-slate-500 mt-1">
            Track all changes made in {currentOrganization?.name || 'your organization'}
          </p>
        </div>

        {/* Content */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-slate-600" />
                <div>
                  <CardTitle>Activity History</CardTitle>
                  <CardDescription>
                    {filteredAuditLogs.length} total entries
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setAuditPage(1); }}
                    className="pl-9 w-48"
                  />
                </div>
                <Select value={auditFilter} onValueChange={(v) => { setAuditFilter(v); setAuditPage(1); }}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectItem value="creates">Creates / Imports</SelectItem>
                    <SelectItem value="updates">Updates</SelectItem>
                    <SelectItem value="deletes">Deletes</SelectItem>
                    <SelectItem value="loans">Loans Only</SelectItem>
                    <SelectItem value="transactions">Transactions Only</SelectItem>
                    <SelectItem value="borrowers">Borrowers Only</SelectItem>
                    <SelectItem value="reconciliation">Reconciliation</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilterPanel(!showFilterPanel)}
                  className="flex items-center gap-1"
                >
                  <Filter className="w-4 h-4" />
                  Filters
                  {showFilterPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </Button>
              </div>
            </div>

            {/* Collapsible Filter Panel */}
            {showFilterPanel && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <div className="flex flex-wrap gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="filter-login"
                      checked={filterPrefs.showLoginActivity}
                      onCheckedChange={(checked) => updateFilterPref('showLoginActivity', checked)}
                    />
                    <Label htmlFor="filter-login" className="text-sm cursor-pointer">
                      Login Activity
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="filter-org-switch"
                      checked={filterPrefs.showOrgSwitches}
                      onCheckedChange={(checked) => updateFilterPref('showOrgSwitches', checked)}
                    />
                    <Label htmlFor="filter-org-switch" className="text-sm cursor-pointer">
                      Org Switches
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="filter-reconciliation"
                      checked={filterPrefs.showReconciliation}
                      onCheckedChange={(checked) => updateFilterPref('showReconciliation', checked)}
                    />
                    <Label htmlFor="filter-reconciliation" className="text-sm cursor-pointer">
                      Reconciliation
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="filter-bulk-imports"
                      checked={filterPrefs.showBulkImports}
                      onCheckedChange={(checked) => updateFilterPref('showBulkImports', checked)}
                    />
                    <Label htmlFor="filter-bulk-imports" className="text-sm cursor-pointer">
                      Bulk Imports
                    </Label>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Toggle filters are saved and remembered between sessions
                </p>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {auditLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : paginatedAuditLogs.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <History className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                <p>No audit log entries found</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Timestamp</TableHead>
                      <TableHead className="w-[100px]">User</TableHead>
                      <TableHead className="w-[130px]">Action</TableHead>
                      <TableHead className="w-[120px]">Sub-Action</TableHead>
                      <TableHead className="w-[90px]">Entity</TableHead>
                      <TableHead className="w-[160px]">Name</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedAuditLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm text-slate-600">
                          {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                        </TableCell>
                        <TableCell className="text-sm">
                          {userLookup[log.user_id] || log.user_id?.slice(0, 8) || 'System'}
                        </TableCell>
                        <TableCell>
                          <Badge className={getActionBadgeColor(log.action)}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {(() => {
                            const subAction = getSubAction(log);
                            return subAction ? (
                              <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">
                                {formatSubAction(subAction)}
                              </span>
                            ) : '-';
                          })()}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {log.entity_type}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 truncate max-w-[160px]" title={log.entity_name}>
                          {log.entity_name || '-'}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          {formatChanges(log)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {totalAuditPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-slate-500">
                      Showing {(auditPage - 1) * auditPerPage + 1} to {Math.min(auditPage * auditPerPage, filteredAuditLogs.length)} of {filteredAuditLogs.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                        disabled={auditPage === 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-slate-600">
                        Page {auditPage} of {totalAuditPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAuditPage(p => Math.min(totalAuditPages, p + 1))}
                        disabled={auditPage === totalAuditPages}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
