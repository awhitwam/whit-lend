import UserManagement from '@/components/organization/UserManagement';
import { useOrganization } from '@/lib/OrganizationContext';

export default function Users() {
  const { currentOrganization } = useOrganization();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Users</h1>
          <p className="text-slate-500 mt-1">
            Manage team members for {currentOrganization?.name || 'your organization'}
          </p>
        </div>

        {/* Content */}
        <UserManagement />
      </div>
    </div>
  );
}
