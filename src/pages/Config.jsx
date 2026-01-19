import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Palette, PenLine, Loader2, Trash2, Upload, Cloud, FolderOpen, Link2Off } from 'lucide-react';
import { useOrganization } from '@/lib/OrganizationContext';
import { useAuth } from '@/lib/AuthContext';
import { getThemeOptions } from '@/lib/organizationThemes';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import GoogleDriveFolderPicker from '@/components/settings/GoogleDriveFolderPicker';

export default function Config() {
  const { canAdmin, currentOrganization, refreshOrganizations, currentTheme } = useOrganization();
  const { user } = useAuth();
  const [signatureUrl, setSignatureUrl] = useState(null);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [isLoadingSignature, setIsLoadingSignature] = useState(true);
  const signatureFileInputRef = useRef(null);

  // Google Drive integration
  const {
    isConnected: googleDriveConnected,
    email: googleDriveEmail,
    baseFolderPath: googleDriveBasePath,
    isLoading: googleDriveLoading,
    canEditBaseFolder,
    initiateOAuth: connectGoogleDrive,
    disconnect: disconnectGoogleDrive,
    refresh: refreshGoogleDrive
  } = useGoogleDrive();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Load current user's signature
  useEffect(() => {
    const loadSignature = async () => {
      if (!user?.id) return;

      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('signature_image_url')
          .eq('id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading signature:', error);
        }

        setSignatureUrl(data?.signature_image_url || null);
      } catch (err) {
        console.error('Error loading signature:', err);
      } finally {
        setIsLoadingSignature(false);
      }
    };

    loadSignature();
  }, [user?.id]);

  const handleSignatureUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 1MB)
    if (file.size > 1 * 1024 * 1024) {
      toast.error('Image must be less than 1MB');
      return;
    }

    setIsUploadingSignature(true);
    try {
      // Create a unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-signature-${Date.now()}.${fileExt}`;
      const filePath = `signatures/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('organization-assets')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('organization-assets')
        .getPublicUrl(filePath);

      // Update user profile
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ signature_image_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setSignatureUrl(publicUrl);
      toast.success('Signature uploaded successfully');
    } catch (err) {
      console.error('Error uploading signature:', err);
      toast.error('Failed to upload signature');
    } finally {
      setIsUploadingSignature(false);
      // Reset file input
      if (signatureFileInputRef.current) {
        signatureFileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveSignature = async () => {
    setIsUploadingSignature(true);
    try {
      // Update user profile to remove signature URL
      const { error } = await supabase
        .from('user_profiles')
        .update({ signature_image_url: null })
        .eq('id', user.id);

      if (error) throw error;

      setSignatureUrl(null);
      toast.success('Signature removed');
    } catch (err) {
      console.error('Error removing signature:', err);
      toast.error('Failed to remove signature');
    } finally {
      setIsUploadingSignature(false);
    }
  };

  const handleDisconnectGoogleDrive = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectGoogleDrive();
      toast.success('Google Drive disconnected');
    } catch (err) {
      console.error('Error disconnecting Google Drive:', err);
      toast.error('Failed to disconnect: ' + err.message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">User Settings</h1>
          <p className="text-slate-500 mt-1">Configure your personal and organization settings</p>
        </div>

        {/* My Signature Card - Available to all users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenLine className="w-5 h-5 text-blue-600" />
              My Signature
            </CardTitle>
            <CardDescription>
              Upload your signature image to use in letter templates. Use a transparent PNG for best results.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-6">
              {/* Signature Preview */}
              <div className="flex-shrink-0">
                {isLoadingSignature ? (
                  <div className="h-20 w-48 border rounded-lg flex items-center justify-center bg-slate-50">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : signatureUrl ? (
                  <div className="relative group">
                    <img
                      src={signatureUrl}
                      alt="Your signature"
                      className="h-20 w-auto max-w-[200px] object-contain border rounded-lg p-2 bg-white"
                    />
                  </div>
                ) : (
                  <div className="h-20 w-48 border-2 border-dashed rounded-lg flex items-center justify-center bg-slate-50">
                    <PenLine className="w-8 h-8 text-slate-300" />
                  </div>
                )}
              </div>

              {/* Upload Controls */}
              <div className="flex-1 space-y-3">
                <input
                  ref={signatureFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleSignatureUpload}
                  className="hidden"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => signatureFileInputRef.current?.click()}
                    disabled={isUploadingSignature}
                  >
                    {isUploadingSignature ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    {signatureUrl ? 'Replace Signature' : 'Upload Signature'}
                  </Button>
                  {signatureUrl && (
                    <Button
                      variant="ghost"
                      onClick={handleRemoveSignature}
                      disabled={isUploadingSignature}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Recommended: PNG with transparent background, max 1MB.
                  Use the <code className="bg-slate-100 px-1 rounded">{'{{signature}}'}</code> placeholder in letter templates.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Google Drive Integration Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-600" />
              Google Drive Integration
            </CardTitle>
            <CardDescription>
              Save generated letters directly to Google Drive with automatic folder organization by borrower and loan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {googleDriveLoading ? (
              <div className="flex items-center gap-2 text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            ) : !googleDriveConnected ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Connect your Google account to save correspondence directly to Google Drive.
                  Files will be organized in folders by borrower and loan.
                </p>
                <Button onClick={connectGoogleDrive}>
                  <Cloud className="w-4 h-4 mr-2" />
                  Connect Google Drive
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Connected status */}
                <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-md">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Connected as <strong>{googleDriveEmail}</strong></span>
                </div>

                {/* Base folder selection (organization-level, super admin only) */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    Organization Base Folder
                    {!canEditBaseFolder && (
                      <span className="text-xs text-slate-400 font-normal ml-2">(Set by admin)</span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1 px-3 py-2 bg-slate-50 border rounded-md text-sm">
                      {googleDriveBasePath || (
                        <span className="text-slate-400 italic">No folder selected</span>
                      )}
                    </div>
                    {canEditBaseFolder && (
                      <Button variant="outline" onClick={() => setFolderPickerOpen(true)}>
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Browse
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Letters will be saved to: <code className="bg-slate-100 px-1 rounded">{'{base folder}'}/{'{borrower_id} {name}'}/{'{loan_id} {description}'}/</code>
                  </p>
                </div>

                {/* Disconnect button */}
                <div className="pt-2 border-t">
                  <Button
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={handleDisconnectGoogleDrive}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Link2Off className="w-4 h-4 mr-2" />
                    )}
                    Disconnect Google Drive
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Folder Picker Modal */}
        <GoogleDriveFolderPicker
          open={folderPickerOpen}
          onClose={() => setFolderPickerOpen(false)}
          onSelect={() => {
            refreshGoogleDrive();
            setFolderPickerOpen(false);
          }}
        />

        {/* Organization Theme Selector */}
        {canAdmin() && currentOrganization && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" style={{ color: currentTheme.primary }} />
                Organization Theme
              </CardTitle>
              <CardDescription>
                Choose a color theme for {currentOrganization.name} to easily identify which organization you're working in
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
                {getThemeOptions().map((theme) => {
                  const isSelected = (currentOrganization?.settings?.theme || 'emerald') === theme.value;
                  return (
                    <button
                      key={theme.value}
                      onClick={async () => {
                        try {
                          // Update organization settings in Supabase
                          const currentSettings = currentOrganization.settings || {};
                          const newSettings = { ...currentSettings, theme: theme.value };

                          const { error } = await supabase
                            .from('organizations')
                            .update({ settings: newSettings })
                            .eq('id', currentOrganization.id);

                          if (error) throw error;

                          // Refresh organizations to pick up the new theme
                          await refreshOrganizations();
                          toast.success(`Theme changed to ${theme.label}`);
                        } catch (err) {
                          console.error('Error updating theme:', err);
                          toast.error('Failed to update theme');
                        }
                      }}
                      className={`
                        flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all
                        ${isSelected
                          ? 'border-slate-900 bg-slate-50 shadow-md'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }
                      `}
                    >
                      <div
                        className={`w-8 h-8 rounded-full ${isSelected ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`}
                        style={{ backgroundColor: theme.color }}
                      />
                      <span className="text-xs font-medium text-slate-700">{theme.label}</span>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-slate-700" />
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {!canAdmin() && (
          <Card>
            <CardContent className="p-6">
              <p className="text-slate-500">
                You need admin permissions to change organization settings.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
