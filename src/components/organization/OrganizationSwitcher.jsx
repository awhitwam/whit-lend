import { useOrganization } from '@/lib/OrganizationContext';
import { useAuth } from '@/lib/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Building2, Check, ChevronDown, LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export default function OrganizationSwitcher() {
  const {
    organizations,
    currentOrganization,
    switchOrganization,
    memberRole,
    isLoadingOrgs
  } = useOrganization();
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  const handleSwitch = (orgId) => {
    switchOrganization(orgId);
    // Invalidate all queries to refetch with new org context
    queryClient.invalidateQueries();
    // Reload the page to ensure all data and UI refreshes
    window.location.reload();
  };

  if (isLoadingOrgs) {
    return (
      <div className="w-full h-10 bg-slate-100 animate-pulse rounded-md"></div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="w-full p-2 text-xs text-slate-500 text-center">
        No organizations
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between h-auto py-2 px-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 flex-shrink-0" />
            <div className="flex flex-col items-start min-w-0">
              <span className="truncate max-w-[150px] font-medium text-sm">
                {currentOrganization?.name || 'Select Organization'}
              </span>
              {memberRole && (
                <span className="text-xs text-slate-500">{memberRole}</span>
              )}
            </div>
          </div>
          <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch Organization</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSwitch(org.id)}
            className="cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">{org.name}</span>
                <span className="text-xs text-slate-500">{org.role}</span>
              </div>
              {currentOrganization?.id === org.id && (
                <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 ml-2" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="cursor-pointer text-red-600 focus:text-red-600"
        >
          <LogOut className="w-4 h-4 mr-2" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
