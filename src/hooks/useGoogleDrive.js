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
 * Base folder is organization-level (managed by super admins)
 * User connection (OAuth tokens) is user-level
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

export function useGoogleDrive() {
  const { user, isSuperAdmin } = useAuth();
  const { currentOrganization } = useOrganization();
  const [isConnected, setIsConnected] = useState(false);
  const [email, setEmail] = useState(null);
  const [baseFolderId, setBaseFolderId] = useState(null);
  const [baseFolderPath, setBaseFolderPath] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load connection status from user profile + base folder from organization
  const loadConnectionStatus = useCallback(async () => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    try {
      // Get user's Google Drive connection status (user-level)
      const { data: userData, error: userError } = await supabase
        .from('user_profiles')
        .select('google_drive_connected, google_drive_email')
        .eq('id', user.id)
        .single();

      if (userError) {
        console.error('Error loading Google Drive user status:', userError);
      }

      setIsConnected(userData?.google_drive_connected || false);
      setEmail(userData?.google_drive_email || null);

      // Get base folder from organization (org-level, set by super admin)
      if (currentOrganization?.id) {
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .select('google_drive_base_folder_id, google_drive_base_folder_path')
          .eq('id', currentOrganization.id)
          .single();

        if (orgError) {
          console.error('Error loading Google Drive org settings:', orgError);
        }

        setBaseFolderId(orgData?.google_drive_base_folder_id || null);
        setBaseFolderPath(orgData?.google_drive_base_folder_path || null);
      } else {
        setBaseFolderId(null);
        setBaseFolderPath(null);
      }
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
   * Initiate OAuth flow to connect Google Drive
   */
  const initiateOAuth = useCallback(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.error('VITE_GOOGLE_CLIENT_ID not configured');
      return;
    }

    const redirectUri = `${window.location.origin}/GoogleDriveCallback`;
    // Scopes needed:
    // - drive.file: Create/access files created by this app
    // - drive: Full access to browse folders and shared drives (required for folder picker)
    // - userinfo.email: Get user's email for display
    const scope = encodeURIComponent(
      'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email'
    );

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&access_type=offline` +
      `&prompt=consent`;

    window.location.href = authUrl;
  }, []);

  /**
   * Exchange authorization code for tokens (called from callback page)
   */
  const exchangeCode = useCallback(async (code) => {
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
        body: JSON.stringify({ code, redirect_uri: redirectUri })
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
   * Disconnect Google Drive
   */
  const disconnect = useCallback(async () => {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-auth?action=disconnect`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    // Clear local state
    setIsConnected(false);
    setEmail(null);
    setBaseFolderId(null);
    setBaseFolderPath(null);

    return result;
  }, []);

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
          loanDescription
        })
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  }, [isConnected, baseFolderId]);

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
          loanDescription
        })
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  }, [isConnected, baseFolderId]);

  /**
   * List shared drives
   */
  const listSharedDrives = useCallback(async () => {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-folders?action=shared-drives`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result.drives || [];
  }, []);

  /**
   * List folders in a folder
   */
  const listFolders = useCallback(async (folderId = 'root', driveId = null) => {
    const accessToken = await getAccessToken();

    let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-folders?action=list&folderId=${folderId}`;
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
      throw new Error(result.error);
    }

    return result.folders || [];
  }, []);

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
      throw new Error(result.error);
    }

    // Update local state
    setBaseFolderId(folderId);
    setBaseFolderPath(folderPath);

    return result;
  }, [isSuperAdmin, currentOrganization?.id]);

  /**
   * List files and folders in a folder (for file browser)
   */
  const listFiles = useCallback(async (folderId, driveId = null) => {
    const accessToken = await getAccessToken();

    let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-files?action=list&folderId=${folderId}`;
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
      throw new Error(result.error);
    }

    return result.items || [];
  }, []);

  /**
   * List all files recursively (for flat view)
   */
  const listFilesFlat = useCallback(async (folderId, driveId = null) => {
    const accessToken = await getAccessToken();

    let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-files?action=list-recursive&folderId=${folderId}`;
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
      throw new Error(result.error);
    }

    return result.items || [];
  }, []);

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
          driveId
        })
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result.folder;
  }, []);

  /**
   * Upload a file to a specific folder (for file browser uploads)
   */
  const uploadFileToFolder = useCallback(async (folderId, fileName, fileContent, mimeType = 'application/octet-stream') => {
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
          mimeType
        })
      }
    );

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result.file;
  }, []);

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
    refresh: loadConnectionStatus,

    // File browser actions
    listFiles,
    listFilesFlat,
    createSubfolder,
    uploadFileToFolder,
    getLoanFolderId
  };
}
