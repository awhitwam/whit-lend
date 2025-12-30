import { useState } from 'react';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, History, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function AuditLog() {
  const { currentOrganization } = useOrganization();
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilter, setAuditFilter] = useState('all');
  const auditPerPage = 25;

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
  const filteredAuditLogs = auditFilter === 'all'
    ? auditLogs
    : auditLogs.filter(log => log.action === auditFilter);

  const totalAuditPages = Math.ceil(filteredAuditLogs.length / auditPerPage);
  const paginatedAuditLogs = filteredAuditLogs.slice(
    (auditPage - 1) * auditPerPage,
    auditPage * auditPerPage
  );

  const getActionBadgeColor = (action) => {
    switch (action) {
      case 'CREATE': return 'bg-green-100 text-green-700';
      case 'UPDATE': return 'bg-blue-100 text-blue-700';
      case 'DELETE': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  const formatChanges = (changes) => {
    if (!changes) return '-';
    if (typeof changes === 'string') return changes;

    const entries = Object.entries(changes);
    if (entries.length === 0) return '-';

    return entries.slice(0, 3).map(([key, value]) => (
      <div key={key} className="text-xs">
        <span className="font-medium">{key}:</span>{' '}
        <span className="text-slate-500">
          {typeof value === 'object' ? JSON.stringify(value).slice(0, 50) : String(value).slice(0, 50)}
        </span>
      </div>
    ));
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-slate-600" />
                <div>
                  <CardTitle>Activity History</CardTitle>
                  <CardDescription>
                    {filteredAuditLogs.length} total entries
                  </CardDescription>
                </div>
              </div>
              <Select value={auditFilter} onValueChange={(v) => { setAuditFilter(v); setAuditPage(1); }}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="CREATE">Creates</SelectItem>
                  <SelectItem value="UPDATE">Updates</SelectItem>
                  <SelectItem value="DELETE">Deletes</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                      <TableHead className="w-[180px]">Timestamp</TableHead>
                      <TableHead className="w-[120px]">User</TableHead>
                      <TableHead className="w-[100px]">Action</TableHead>
                      <TableHead className="w-[120px]">Entity</TableHead>
                      <TableHead>Changes</TableHead>
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
                        <TableCell className="text-sm font-medium">
                          {log.entity_type}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          {formatChanges(log.changes)}
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
