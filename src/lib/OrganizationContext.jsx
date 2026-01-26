import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { setOrganizationIdGetter } from '@/api/dataClient';
import { getOrganizationTheme } from '@/lib/organizationThemes';
import { logOrgSwitchEvent } from '@/lib/auditLog';

const OrganizationContext = createContext();

export const OrganizationProvider = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [currentOrganization, setCurrentOrganization] = useState(null);
  const [memberRole, setMemberRole] = useState(null);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);

  // Fetch user's organizations
  useEffect(() => {
    if (isAuthenticated && user) {
      fetchOrganizations();
    } else {
      setOrganizations([]);
      setCurrentOrganization(null);
      setMemberRole(null);
      setIsLoadingOrgs(false);
    }
  }, [user, isAuthenticated]);

  // Provide organization ID to dataClient
  // SECURITY: Only provide org ID from verified context, never from localStorage
  // This prevents users from manipulating localStorage to access other orgs' data
  useEffect(() => {
    setOrganizationIdGetter(() => {
      return currentOrganization?.id || null;
    });
  }, [currentOrganization]);

  const fetchOrganizations = async () => {
    try {
      setIsLoadingOrgs(true);

      // First, fetch memberships
      const { data: memberships, error: memberError } = await supabase
        .from('organization_members')
        .select('organization_id, role, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (memberError) {
        console.error('Error fetching memberships:', memberError);
        throw memberError;
      }

      if (!memberships || memberships.length === 0) {
        // No active memberships - user needs to accept pending invitations
        // through the AcceptInvitation flow, not auto-activated here
        setOrganizations([]);
        setIsLoadingOrgs(false);
        return;
      }

      // Then, fetch organization details separately
      const orgIds = memberships.map(m => m.organization_id);

      const { data: organizations, error: orgError } = await supabase
        .from('organizations')
        .select('id, name, slug, description, logo_url, settings, address_line1, address_line2, city, postcode, country, phone, email, website')
        .in('id', orgIds);

      if (orgError) {
        console.error('Error fetching organizations:', orgError);
        throw orgError;
      }

      // Combine memberships with organization details
      const orgs = memberships.map(m => {
        const org = organizations.find(o => o.id === m.organization_id);
        return {
          ...org,
          role: m.role
        };
      }).filter(o => o.id); // Filter out any that didn't match

      setOrganizations(orgs);

      // Set current organization priority:
      // 1. From sessionStorage (for tab continuity)
      // 2. From user_profiles.default_organization_id (user preference)
      // 3. First organization in list (fallback)
      const savedOrgId = sessionStorage.getItem('currentOrganizationId');
      const savedOrg = orgs.find(o => o.id === savedOrgId);

      if (savedOrg) {
        setCurrentOrganization(savedOrg);
        setMemberRole(savedOrg.role);
      } else {
        // Check for user's default organization preference
        let defaultOrg = null;
        try {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('default_organization_id')
            .eq('id', user.id)
            .single();

          if (profile?.default_organization_id) {
            defaultOrg = orgs.find(o => o.id === profile.default_organization_id);
          }
        } catch (err) {
          console.error('Error fetching default organization:', err);
        }

        // Use default org if found, otherwise first in list
        const orgToUse = defaultOrg || orgs[0];
        if (orgToUse) {
          setCurrentOrganization(orgToUse);
          setMemberRole(orgToUse.role);
          sessionStorage.setItem('currentOrganizationId', orgToUse.id);
        }
      }
    } catch (error) {
      console.error('Error fetching organizations:', error);
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  const switchOrganization = (organizationId) => {
    const org = organizations.find(o => o.id === organizationId);
    if (org) {
      // Capture previous org for audit logging
      const previousOrg = currentOrganization;

      // CRITICAL: Update the organization ID getter SYNCHRONOUSLY before state change
      // This prevents a race condition where queries fire with the old org ID
      // during React's async state update cycle
      setOrganizationIdGetter(() => org.id);

      setCurrentOrganization(org);
      setMemberRole(org.role);
      sessionStorage.setItem('currentOrganizationId', organizationId);

      // Log organization switch to audit trail
      if (previousOrg && previousOrg.id !== org.id) {
        logOrgSwitchEvent(previousOrg, org, user?.id);
      }

      // Invalidate all queries to refetch with new organization context
      // This will be handled by queryClient in consuming components
    }
  };

  const hasPermission = (requiredRole) => {
    if (!memberRole) return false;

    const roleHierarchy = { 'Viewer': 1, 'Manager': 2, 'Admin': 3 };
    return roleHierarchy[memberRole] >= roleHierarchy[requiredRole];
  };

  const canView = () => hasPermission('Viewer');
  const canEdit = () => hasPermission('Manager');
  const canAdmin = () => hasPermission('Admin');

  // Get current organization theme
  const currentTheme = getOrganizationTheme(currentOrganization);

  return (
    <OrganizationContext.Provider value={{
      organizations,
      currentOrganization,
      memberRole,
      isLoadingOrgs,
      switchOrganization,
      hasPermission,
      canView,
      canEdit,
      canAdmin,
      refreshOrganizations: fetchOrganizations,
      currentTheme
    }}>
      {children}
    </OrganizationContext.Provider>
  );
};

export const useOrganization = () => {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
};
