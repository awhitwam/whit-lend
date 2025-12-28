import { useState } from 'react';
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
import { Building2, Check, ChevronDown, LogOut, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getOrganizationTheme } from '@/lib/organizationThemes';

export default function OrganizationSwitcher() {
  const {
    organizations,
    currentOrganization,
    switchOrganization,
    memberRole,
    isLoadingOrgs,
    currentTheme
  } = useOrganization();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);

  const handleSwitch = async (orgId) => {
    // Don't switch if already on this org
    if (currentOrganization?.id === orgId) return;

    // Show loading overlay
    setIsSwitching(true);

    // Clear all React Query cache to prevent stale data
    await queryClient.cancelQueries();
    queryClient.clear();

    // Switch organization (updates localStorage synchronously)
    switchOrganization(orgId);

    // Force complete page reload to reset all state
    setTimeout(() => {
      window.location.href = window.location.href.split('?')[0];
    }, 300);
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-auto py-2 px-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              {/* Color indicator for current org */}
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: currentTheme.primary }}
              />
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
          {organizations.map((org) => {
            const orgTheme = getOrganizationTheme(org);
            return (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Color indicator for this org */}
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: orgTheme.primary }}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{org.name}</span>
                      <span className="text-xs text-slate-500">{org.role}</span>
                    </div>
                  </div>
                  {currentOrganization?.id === org.id && (
                    <Check className="w-4 h-4 flex-shrink-0 ml-2" style={{ color: orgTheme.primary }} />
                  )}
                </div>
              </DropdownMenuItem>
            );
          })}
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

      {/* Switching overlay */}
      {isSwitching && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
            <p className="text-sm font-medium text-slate-700">Switching organization...</p>
          </div>
        </div>
      )}
    </>
  );
}
