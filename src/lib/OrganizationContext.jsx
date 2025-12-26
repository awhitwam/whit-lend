import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { setOrganizationIdGetter } from '@/api/base44Client';

const OrganizationContext = createContext();

export const OrganizationProvider = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [currentOrganization, setCurrentOrganization] = useState(null);
  const [memberRole, setMemberRole] = useState(null);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);

  // Fetch user's organizations
  useEffect(() => {
    console.log('[OrganizationContext] Auth state:', { isAuthenticated, hasUser: !!user, userId: user?.id });

    if (isAuthenticated && user) {
      console.log('[OrganizationContext] Calling fetchOrganizations');
      fetchOrganizations();
    } else {
      console.log('[OrganizationContext] Not authenticated or no user, skipping fetch');
      setOrganizations([]);
      setCurrentOrganization(null);
      setMemberRole(null);
      setIsLoadingOrgs(false);
    }
  }, [user, isAuthenticated]);

  // Provide organization ID to base44Client
  useEffect(() => {
    setOrganizationIdGetter(() => currentOrganization?.id || null);
  }, [currentOrganization]);

  const fetchOrganizations = async () => {
    try {
      setIsLoadingOrgs(true);
      console.log('[OrganizationContext] Fetching organizations for user:', user?.id);

      // First, fetch memberships
      const { data: memberships, error: memberError } = await supabase
        .from('organization_members')
        .select('organization_id, role, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true);

      console.log('[OrganizationContext] Memberships query result:', { memberships, memberError });

      if (memberError) {
        console.error('[OrganizationContext] Memberships error:', memberError);
        throw memberError;
      }

      if (!memberships || memberships.length === 0) {
        console.warn('[OrganizationContext] No memberships found - user has no organizations');
        setOrganizations([]);
        setIsLoadingOrgs(false);
        return;
      }

      // Then, fetch organization details separately
      const orgIds = memberships.map(m => m.organization_id);
      console.log('[OrganizationContext] Fetching org details for IDs:', orgIds);

      const { data: organizations, error: orgError } = await supabase
        .from('organizations')
        .select('id, name, slug, description, logo_url, settings')
        .in('id', orgIds);

      console.log('[OrganizationContext] Organizations query result:', { organizations, orgError });

      if (orgError) {
        console.error('[OrganizationContext] Organizations error:', orgError);
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

      console.log('[OrganizationContext] Final combined orgs:', orgs);
      setOrganizations(orgs);

      // Set current organization from localStorage or default to first
      const savedOrgId = localStorage.getItem('currentOrganizationId');
      const savedOrg = orgs.find(o => o.id === savedOrgId);

      if (savedOrg) {
        setCurrentOrganization(savedOrg);
        setMemberRole(savedOrg.role);
      } else if (orgs.length > 0) {
        setCurrentOrganization(orgs[0]);
        setMemberRole(orgs[0].role);
        localStorage.setItem('currentOrganizationId', orgs[0].id);
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
      setCurrentOrganization(org);
      setMemberRole(org.role);
      localStorage.setItem('currentOrganizationId', organizationId);

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
      refreshOrganizations: fetchOrganizations
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
