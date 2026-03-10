/**
 * Custom hook for Google Drive integration
 *
 * Provides:
 * - Connection status and user info
 * - OAuth flow initiation
 * - File upload to Google Drive
 * - Folder browsing for picker
 * - Disconnect functionality
 *
 * Google Drive connections are per-organization.
 * Each org has its own Google account connection and folder settings.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useOrganization } from '@/lib/OrganizationContext';
import { supabase } from '@/lib/supabaseClient';

// Helper to get session access token
async function getAccessToken() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error('Not authenticated');
  }
  return session.access_token;
}

// Check if error indicates auth/token issue
const isAuthError = (errorMessage) => {
  if (!errorMessage) return false;
  const authKeywords = ['reconnect', 'expired', 'session', 'unauthorized', 'invalid token', 'scopes'];
  return authKeywords.some(keyword =>
    errorMessage.toLowerCase().includes(keyword)
  );
};

export function useGoogleDrive() {
  const { user, isSuperAdmin } = useAuth();
  const { currentOrganization } = useOrganization();
  const [isConnected, setIsConnected] = useState(false);
  const [email, setEmail] = useState(null);
  const [baseFolderId, setBaseFolderId] = useState(null);
  const [baseFolderPath, setBaseFolderPath] = useState(null);
  const [backupFolderId, setBackupFolderId] = useState(null);
  const [backupFolderPath, setBackupFolderPath] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load connection status and folder settings from organization
  const loadConnectionStatus = useCallback(async () => {
    if (!user?.id || !currentOrganization?.id) {
      setIsConnected(false);
      setEmail(null);
      setBaseFolderId(null);
      setBaseFolderPath(null);
      setBackupFolderId(null);
      setBackupFolderPath(null);
      setIsLoading(false);
      return;
    }

    try {
      // Get everything from the organization (connection status + folder settings)
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('google_drive_connected, google_drive_email, google_drive_base_folder_id, google_drive_base_folder_path, google_drive_backup_folder_id, google_drive_backup_folder_path')
        .eq('id', currentOrganization.id)
        .single();

      if (orgError) {
        console.error('Error loading Google Drive org settings:', orgError);
      }

      setIsConnected(orgData?.google_drive_connected || false);
      setEmail(orgData?.google_drive_email || null);
      setBaseFolderId(orgData?.google_drive_base_folder_id || null);
      setBaseFolderPath(orgData?.google_drive_base_folder_path || null);
      setBackupFolderId(orgData?.google_drive_backup_folder_id || null);
      setBackupFolderPath(orgData?.google_drive_backup_folder_path || null);
    } catch (err) {
      console.error('Error loading Google Drive status:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, currentOrganization?.id]);

  useEffect(() => {
    loadConnectionStatus();
  }, [loadConnectionStatus]);

  /**
   * Initiate OAuth flow to connect Google Drive for current organization
   */
  const initiateOAuth = useCallback(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '867728021178-umj71l6jen6k1ifvjm69bs1u71n8k6m4.apps.googleusercontent.com';
    if (!clientId) {
      console.error('VITE_GOOGLE_CLIENT_ID not configured');
      return { success: false, error: 'Google Drive is not configured. Please contact support.' };
    }

    if (!currentOrganization?.id) {
      console.error('No organization selected');
      return { success: false, error: 'No organization selected. Please select an organization first.' };
    }

    const redirectUri = `${window.location.origin}/GoogleDriveCallback`;
    const scope = encodeURIComponent(
      'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email'
    );

    // Pass organization_id through OAuth state parameter
    const state = encodeURIComponent(currentOrganization.id);

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${state}`;

    window.location.href = authUrl;
    return { success: true };
  }, [currentOrganization?.id]);

  /**
   * Exchange authorization code for tokens (called from callback page)
   * @param {string} code - Authorization code from Google
   * @param {string} organizationId - Organization ID from OAuth state parameter
   */
  const exchangeCode = useCallback(async (code, organizationId) => {
    const accessToken = await getAccessToken();

    const redirectUri = `${window.location.origin}/GoogleDriveCallback`;

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-auth`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code, redirect_uri: redirectUri, organization_id: organizationId })
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    // Refresh connection status
    await loadConnectionStatus();

    return result;
  }, [loadConnectionStatus]);

  /**
   * Disconnect Google Drive for current organization
   */
  const disconnect = useCallback(async () => {
    if (!currentOrganization?.id) {
      throw new Error('No organization selected');
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-auth?action=disconnect`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ organization_id: currentOrganization.id })
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    // Clear local state
    setIsConnected(false);
    setEmail(null);

    return result;
  }, [currentOrganization?.id]);

  /**
   * Upload file to Google Drive
   */
  const uploadFile = useCallback(async ({
    fileName,
    fileContent, // base64 string
    mimeType = 'application/pdf',
    borrowerId,
    borrowerDescription,
    loanId,
    loanDescription
  }) => {
    const accessToken = await getAccessToken();

    if (!isConnected) {
      throw new Error('Google Drive not connected');
    }

    if (!baseFolderId) {
      throw new Error('No base folder configured. Please select a base folder in Settings.');
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileName,
          fileContent,
          mimeType,
          borrowerId,
          borrowerDescription,
          loanId,
          loanDescription,
          organizationId: currentOrganization?.id
        })
      }
    );

    const result = await response.json();

    if (result.error) {
      // If auth error, refresh connection status to update UI
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result;
  }, [isConnected, baseFolderId, loadConnectionStatus]);

  /**
   * Create folder structure in Google Drive (without uploading a file)
   */
  const createFolderStructure = useCallback(async ({
    borrowerId,
    borrowerDescription,
    loanId,
    loanDescription
  }) => {
    const accessToken = await getAccessToken();

    if (!isConnected) {
      throw new Error('Google Drive not connected');
    }

    if (!baseFolderId) {
      throw new Error('No base folder configured. Please select a base folder in Settings.');
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'create-folders',
          borrowerId,
          borrowerDescription,
          loanId,
          loanDescription,
          organizationId: currentOrganization?.id
        })
      }
    );

    const result = await response.json();

    if (result.error) {
      // If auth error, refresh connection status to update UI
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result;
  }, [isConnected, baseFolderId, loadConnectionStatus]);

  /**
   * List shared drives
   */
  const listSharedDrives = useCallback(async () => {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-folders?action=shared-drives&organizationId=${currentOrganization?.id}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    const result = await response.json();

    if (result.error) {
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result.drives || [];
  }, [currentOrganization?.id, loadConnectionStatus]);

  /**
   * List folders in a folder
   */
  const listFolders = useCallback(async (folderId = 'root', driveId = null) => {
    const accessToken = await getAccessToken();

    let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-folders?action=list&folderId=${folderId}&organizationId=${currentOrganization?.id}`;
    if (driveId) {
      url += `&driveId=${driveId}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const result = await response.json();

    if (result.error) {
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result.folders || [];
  }, [currentOrganization?.id, loadConnectionStatus]);

  /**
   * Save base folder selection (organization-level, super admin only)
   */
  const saveBaseFolder = useCallback(async (folderId, folderPath) => {
    if (!isSuperAdmin) {
      throw new Error('Only super admins can change the base folder');
    }

    if (!currentOrganization?.id) {
      throw new Error('No organization selected');
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-folders?action=save-base`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ folderId, folderPath, organizationId: currentOrganization.id })
      }
    );

    const result = await response.json();

    if (result.error) {
      // If auth error, refresh connection status to update UI
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    // Update local state
    setBaseFolderId(folderId);
    setBaseFolderPath(folderPath);

    return result;
  }, [isSuperAdmin, currentOrganization?.id, loadConnectionStatus]);

  /**
   * Save backup folder selection (organization-level, org admin or super admin)
   */
  const saveBackupFolder = useCallback(async (folderId, folderPath) => {
    if (!currentOrganization?.id) {
      throw new Error('No organization selected');
    }

    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-folders?action=save-backup`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ folderId, folderPath, organizationId: currentOrganization.id })
      }
    );

    const result = await response.json();

    if (result.error) {
      // If auth error, refresh connection status to update UI
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    // Update local state
    setBackupFolderId(folderId);
    setBackupFolderPath(folderPath);

    return result;
  }, [currentOrganization?.id, loadConnectionStatus]);

  /**
   * List files and folders in a folder (for file browser)
   */
  const listFiles = useCallback(async (folderId, driveId = null) => {
    const accessToken = await getAccessToken();

    let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-files?action=list&folderId=${folderId}&organizationId=${currentOrganization?.id}`;
    if (driveId) {
      url += `&driveId=${driveId}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const result = await response.json();

    if (result.error) {
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result.items || [];
  }, [currentOrganization?.id, loadConnectionStatus]);

  /**
   * List all files recursively (for flat view)
   */
  const listFilesFlat = useCallback(async (folderId, driveId = null) => {
    const accessToken = await getAccessToken();

    let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-files?action=list-recursive&folderId=${folderId}&organizationId=${currentOrganization?.id}`;
    if (driveId) {
      url += `&driveId=${driveId}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const result = await response.json();

    if (result.error) {
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result.items || [];
  }, [currentOrganization?.id, loadConnectionStatus]);

  /**
   * Create a subfolder in a folder
   */
  const createSubfolder = useCallback(async (parentFolderId, folderName, driveId = null) => {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-files`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'create-folder',
          folderId: parentFolderId,
          folderName,
          driveId,
          organizationId: currentOrganization?.id
        })
      }
    );

    const result = await response.json();

    if (result.error) {
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result.folder;
  }, [currentOrganization?.id, loadConnectionStatus]);

  /**
   * Upload a file to a specific folder (for file browser uploads)
   * Supports gzip-compressed content via options.compressed = 'gzip'
   */
  const uploadFileToFolder = useCallback(async (folderId, fileName, fileContent, mimeType = 'application/octet-stream', options = {}) => {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-files`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'upload',
          folderId,
          fileName,
          fileContent,
          mimeType,
          organizationId: currentOrganization?.id,
          ...(options.compressed && { compressed: options.compressed })
        })
      }
    );

    if (!response.ok) {
      let errorMsg = `Upload failed (HTTP ${response.status})`;
      try {
        const errBody = await response.json();
        if (errBody.error) errorMsg = errBody.error;
      } catch {
        const text = await response.text().catch(() => '');
        if (text) errorMsg += `: ${text.slice(0, 200)}`;
      }
      if (isAuthError(errorMsg)) {
        await loadConnectionStatus();
      }
      throw new Error(errorMsg);
    }

    const result = await response.json();

    if (result.error) {
      if (isAuthError(result.error)) {
        await loadConnectionStatus();
      }
      throw new Error(result.error);
    }

    return result.file;
  }, [currentOrganization?.id, loadConnectionStatus]);

  /**
   * Get or create loan folder structure and return folder IDs
   * This is a convenience wrapper around createFolderStructure
   */
  const getLoanFolderId = useCallback(async (borrowerId, borrowerDescription, loanId, loanDescription) => {
    if (!isConnected) {
      throw new Error('Google Drive not connected');
    }

    if (!baseFolderId) {
      throw new Error('No base folder configured. Please select a base folder in Settings.');
    }

    const result = await createFolderStructure({
      borrowerId,
      borrowerDescription,
      loanId,
      loanDescription
    });

    return result.loanFolderId;
  }, [isConnected, baseFolderId, createFolderStructure]);

  return {
    // State
    isConnected,
    email,
    baseFolderId,
    baseFolderPath,
    backupFolderId,
    backupFolderPath,
    isLoading,
    canEditBaseFolder: isSuperAdmin, // Only super admins can change the org base folder

    // Actions
    initiateOAuth,
    exchangeCode,
    disconnect,
    uploadFile,
    createFolderStructure,
    listSharedDrives,
    listFolders,
    saveBaseFolder,
    saveBackupFolder,
    refresh: loadConnectionStatus,

    // File browser actions
    listFiles,
    listFilesFlat,
    createSubfolder,
    uploadFileToFolder,
    getLoanFolderId
  };
}
