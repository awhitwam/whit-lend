import { useState } from 'react';
import UserManagement from '@/components/organization/UserManagement';
import MFAManagement from '@/components/auth/MFAManagement';
import { useOrganization } from '@/lib/OrganizationContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users as UsersIcon, Shield } from 'lucide-react';

export default function Users() {
  const { currentOrganization } = useOrganization();
  const [activeTab, setActiveTab] = useState('team');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Users & Security</h1>
          <p className="text-slate-500 mt-1">
            Manage team members and security settings
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="team" className="flex items-center gap-2">
              <UsersIcon className="h-4 w-4" />
              Team Members
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              My Security
            </TabsTrigger>
          </TabsList>

          <TabsContent value="team" className="mt-6">
            <UserManagement />
          </TabsContent>

          <TabsContent value="security" className="mt-6">
            <MFAManagement />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
