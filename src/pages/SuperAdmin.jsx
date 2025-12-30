import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, Building2, Plus } from 'lucide-react';
import CreateOrganizationDialog from '@/components/organization/CreateOrganizationDialog';
import { useOrganization } from '@/lib/OrganizationContext';

export default function SuperAdmin() {
  const { canAdmin } = useOrganization();
  const [isCreateOrgOpen, setIsCreateOrgOpen] = useState(false);

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
        </div>

        <CreateOrganizationDialog
          open={isCreateOrgOpen}
          onClose={() => setIsCreateOrgOpen(false)}
        />
      </div>
    </div>
  );
}
