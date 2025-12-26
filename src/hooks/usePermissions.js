import { useOrganization } from '@/lib/OrganizationContext';

/**
 * Convenience hook for checking user permissions within the current organization
 *
 * @returns {Object} Permission helpers and current role
 * @property {boolean} isViewer - User has Viewer role
 * @property {boolean} isManager - User has Manager role
 * @property {boolean} isAdmin - User has Admin role
 * @property {Function} canView - Check if user can view (Viewer or higher)
 * @property {Function} canEdit - Check if user can edit (Manager or higher)
 * @property {Function} canAdmin - Check if user is Admin
 * @property {string} memberRole - Current user's role (Viewer, Manager, or Admin)
 */
export const usePermissions = () => {
  const { memberRole, canView, canEdit, canAdmin } = useOrganization();

  return {
    isViewer: memberRole === 'Viewer',
    isManager: memberRole === 'Manager',
    isAdmin: memberRole === 'Admin',
    canView,
    canEdit,
    canAdmin,
    memberRole
  };
};
