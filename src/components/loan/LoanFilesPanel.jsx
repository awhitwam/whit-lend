/**
 * Loan Files Panel - Google Drive file browser for loans
 *
 * Features:
 * - Tree view: Hierarchical folder navigation with breadcrumbs
 * - Flat view: All files listed with folder path
 * - Drag-and-drop file upload
 * - Create subfolder
 * - File actions: Open in Drive, Copy link
 */

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/dataClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Folder,
  FolderOpen,
  FileText,
  File,
  Image,
  FileSpreadsheet,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Upload,
  FolderPlus,
  RefreshCw,
  MoreVertical,
  ExternalLink,
  Copy,
  List,
  LayoutGrid,
  Cloud,
  AlertCircle,
  Mail,
  Download,
  CheckCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import EmailComposeModal from '@/components/email/EmailComposeModal';

// Get appropriate icon for file type
function getFileIcon(mimeType) {
  if (!mimeType) return File;
  if (mimeType === 'application/vnd.google-apps.folder') return Folder;
  if (mimeType.includes('pdf')) return FileText;
  if (mimeType.includes('image')) return Image;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return FileSpreadsheet;
  if (mimeType.includes('document') || mimeType.includes('word')) return FileText;
  return File;
}

// Format file size
function formatFileSize(bytes) {
  if (!bytes) return '';
  const num = parseInt(bytes, 10);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LoanFilesPanel({ loan, borrower }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const googleDrive = useGoogleDrive();
  const { user } = useAuth();

  // State
  const [viewMode, setViewMode] = useState('tree'); // 'tree' | 'flat'
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, name}]
  const [dragActive, setDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // File send via email state
  const [showEmailCompose, setShowEmailCompose] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [isSendingFile, setIsSendingFile] = useState(false);
  const [emailError, setEmailError] = useState(null);

  // Mark as sent state
  const [showMarkAsSentDialog, setShowMarkAsSentDialog] = useState(false);
  const [fileToMarkAsSent, setFileToMarkAsSent] = useState(null);
  const [isMarkingAsSent, setIsMarkingAsSent] = useState(false);

  // Get or create loan folder ID
  const { data: loanFolderData, isLoading: folderLoading, error: folderError } = useQuery({
    queryKey: ['loan-drive-folder', loan?.id],
    queryFn: async () => {
      const result = await googleDrive.createFolderStructure({
        borrowerId: borrower?.unique_number || loan?.borrower_id,
        borrowerDescription: borrower?.business || borrower?.full_name || '',
        loanId: loan?.loan_number || loan?.id,
        loanDescription: loan?.description || ''
      });
      return result;
    },
    enabled: googleDrive.isConnected && !!googleDrive.baseFolderId && !!loan?.id,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });

  const rootFolderId = loanFolderData?.loanFolderId;
  const activeFolderId = currentFolderId || rootFolderId;

  // List files in current folder
  const { data: items = [], isLoading: filesLoading, refetch } = useQuery({
    queryKey: ['drive-files', activeFolderId, viewMode],
    queryFn: async () => {
      if (viewMode === 'flat') {
        return googleDrive.listFilesFlat(activeFolderId);
      }
      return googleDrive.listFiles(activeFolderId);
    },
    enabled: !!activeFolderId
  });

  // Navigate to a folder
  const navigateToFolder = useCallback((folder) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
  }, []);

  // Navigate via breadcrumb
  const navigateToBreadcrumb = useCallback((index) => {
    if (index === -1) {
      // Back to root
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } else {
      const crumb = breadcrumbs[index];
      setCurrentFolderId(crumb.id);
      setBreadcrumbs(prev => prev.slice(0, index + 1));
    }
  }, [breadcrumbs]);

  // Handle file drop
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;

    await uploadFiles(files);
  }, [activeFolderId]);

  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await uploadFiles(files);
    e.target.value = ''; // Reset input
  }, [activeFolderId]);

  const uploadFiles = async (files) => {
    if (!activeFolderId) {
      toast.error('No folder selected');
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        // Convert file to base64
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await googleDrive.uploadFileToFolder(
          activeFolderId,
          file.name,
          base64,
          file.type || 'application/octet-stream'
        );
        successCount++;
      } catch (err) {
        console.error('Upload error:', err);
        errorCount++;
      }
    }

    setIsUploading(false);

    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`);
      refetch();
    }
    if (errorCount > 0) {
      toast.error(`Failed to upload ${errorCount} file${errorCount > 1 ? 's' : ''}`);
    }
  };

  // Create subfolder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }

    setIsCreatingFolder(true);
    try {
      await googleDrive.createSubfolder(activeFolderId, newFolderName.trim());
      toast.success('Folder created');
      setCreateFolderOpen(false);
      setNewFolderName('');
      refetch();
    } catch (err) {
      toast.error('Failed to create folder: ' + err.message);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Copy link to clipboard
  const copyLink = (url) => {
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  // Open in Google Drive
  const openInDrive = (url) => {
    window.open(url, '_blank');
  };

  // Download file from Google Drive
  const downloadFile = (file) => {
    // Google Drive download URL format
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
    window.open(downloadUrl, '_blank');
  };

  // Send file via email - opens email compose modal
  const handleSendFile = (file) => {
    setPendingFile(file);
    setEmailError(null);
    setShowEmailCompose(true);
  };

  // Get default email body for file send
  const getFileEmailBody = () => {
    const borrowerName = borrower?.business ||
      `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
      loan?.borrower_name || 'Borrower';
    return `Dear ${borrowerName},\n\nPlease find attached the document regarding your loan (Reference: ${loan?.loan_number || 'N/A'}).\n\nIf you have any questions, please do not hesitate to contact us.\n\nKind regards`;
  };

  // Send file email via Edge Function
  const handleFileSend = async ({ to, subject: emailSubject, body: emailBody }) => {
    if (!pendingFile) return;

    setIsSendingFile(true);
    setEmailError(null);

    try {
      // Get current session for auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      // Call Edge Function to send email with Drive file attachment
      const { data, error } = await supabase.functions.invoke('send-email-attachment', {
        body: {
          recipientEmail: to,
          subject: emailSubject,
          textBody: emailBody,
          attachment: {
            type: 'driveFile',
            fileId: pendingFile.id,
            fileName: pendingFile.name,
            mimeType: pendingFile.mimeType
          }
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to send email');
      }

      // Record in generated_letters
      await api.entities.GeneratedLetter.create({
        loan_id: loan?.id,
        borrower_id: borrower?.id,
        subject: `Sent file: ${pendingFile.name}`,
        delivery_method: 'email',
        recipient_email: to,
        google_drive_file_id: pendingFile.id,
        google_drive_file_url: pendingFile.webViewLink,
        template_name: 'Google Drive File',
        created_by: user?.id
      });

      queryClient.invalidateQueries({ queryKey: ['loan-letters', loan?.id] });
      toast.success('Email sent successfully');
      setShowEmailCompose(false);
      setPendingFile(null);
    } catch (err) {
      console.error('Error sending file email:', err);
      setEmailError(err.message || 'Failed to send email');
    } finally {
      setIsSendingFile(false);
    }
  };

  // Mark file as sent (record in activity without sending email)
  const handleMarkAsSent = (file) => {
    setFileToMarkAsSent(file);
    setShowMarkAsSentDialog(true);
  };

  const confirmMarkAsSent = async () => {
    if (!fileToMarkAsSent) return;

    setIsMarkingAsSent(true);
    try {
      await api.entities.GeneratedLetter.create({
        loan_id: loan?.id,
        borrower_id: borrower?.id,
        subject: `Sent file: ${fileToMarkAsSent.name}`,
        delivery_method: 'other',
        google_drive_file_id: fileToMarkAsSent.id,
        google_drive_file_url: fileToMarkAsSent.webViewLink,
        template_name: 'Google Drive File',
        created_by: user?.id
      });

      queryClient.invalidateQueries({ queryKey: ['loan-letters', loan?.id] });
      toast.success('File marked as sent');
      setShowMarkAsSentDialog(false);
      setFileToMarkAsSent(null);
    } catch (err) {
      console.error('Error marking file as sent:', err);
      toast.error('Failed to mark file as sent: ' + err.message);
    } finally {
      setIsMarkingAsSent(false);
    }
  };

  // Not connected state
  if (!googleDrive.isConnected) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Cloud className="w-12 h-12 mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-700 mb-2">Google Drive Not Connected</h3>
          <p className="text-sm text-slate-500 mb-4">
            Connect Google Drive to view and manage loan files.
          </p>
          <Button onClick={() => navigate('/Config')}>
            Go to Settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  // No base folder configured
  if (!googleDrive.baseFolderId) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FolderOpen className="w-12 h-12 mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-700 mb-2">No Base Folder Configured</h3>
          <p className="text-sm text-slate-500 mb-4">
            Please select a base folder in Settings before viewing files.
          </p>
          <Button onClick={() => navigate('/Config')}>
            Go to Settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (folderError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-medium text-slate-700 mb-2">Error Loading Files</h3>
          <p className="text-sm text-slate-500 mb-4">
            {folderError.message}
          </p>
          <Button variant="outline" onClick={() => queryClient.invalidateQueries(['loan-drive-folder', loan?.id])}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Separate folders and files, folders first
  const folders = items.filter(item => item.isFolder);
  const files = items.filter(item => !item.isFolder);
  const sortedItems = [...folders, ...files];

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-blue-600" />
            Files
            {items.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {files.length} file{files.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && setViewMode(v)}
              className="border rounded-md"
            >
              <ToggleGroupItem value="tree" size="sm" className="h-7 px-2">
                <LayoutGrid className="w-3 h-3" />
              </ToggleGroupItem>
              <ToggleGroupItem value="flat" size="sm" className="h-7 px-2">
                <List className="w-3 h-3" />
              </ToggleGroupItem>
            </ToggleGroup>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={filesLoading || folderLoading}
              className="gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${(filesLoading || folderLoading) ? 'animate-spin' : ''}`} />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateFolderOpen(true)}
              disabled={!activeFolderId}
              className="gap-1"
            >
              <FolderPlus className="w-3 h-3" />
              New Folder
            </Button>

            <div className="relative">
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={!activeFolderId || isUploading}
              />
              <Button
                size="sm"
                disabled={!activeFolderId || isUploading}
                className="gap-1"
              >
                {isUploading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Upload className="w-3 h-3" />
                )}
                Upload
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Breadcrumbs (tree view only) */}
        {viewMode === 'tree' && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-1 text-sm text-slate-600 flex-wrap">
            <button
              onClick={() => navigateToBreadcrumb(-1)}
              className="hover:text-blue-600 flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Root
            </button>
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center">
                <ChevronRight className="w-4 h-4 mx-1" />
                <button
                  onClick={() => navigateToBreadcrumb(index)}
                  className={`hover:text-blue-600 ${index === breadcrumbs.length - 1 ? 'font-medium text-slate-900' : ''}`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Drag and drop zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-lg transition-colors ${
            dragActive
              ? 'border-blue-400 bg-blue-50'
              : 'border-slate-200'
          }`}
        >
          {/* Drag overlay */}
          {dragActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 rounded-lg z-10">
              <div className="text-center">
                <Upload className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <p className="text-blue-700 font-medium">Drop files to upload</p>
              </div>
            </div>
          )}

          {/* File list */}
          <ScrollArea className="h-[400px]">
            {folderLoading || (filesLoading && items.length === 0) ? (
              <div className="flex items-center justify-center h-full py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : sortedItems.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Folder className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p>No files yet</p>
                <p className="text-sm">Drag and drop files here or click Upload</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {sortedItems.map((item) => {
                  const Icon = getFileIcon(item.mimeType);
                  const isFolder = item.isFolder;

                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-100 cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isFolder && viewMode === 'tree') {
                          navigateToFolder(item);
                        } else if (!isFolder && item.webViewLink) {
                          window.open(item.webViewLink, '_blank', 'noopener,noreferrer');
                        }
                      }}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 ${
                        isFolder ? 'text-amber-500' : 'text-slate-500'
                      }`} />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          {viewMode === 'flat' && item.parentPath && (
                            <span className="truncate">{item.parentPath}</span>
                          )}
                          {!isFolder && item.size && (
                            <span>{formatFileSize(item.size)}</span>
                          )}
                          {item.modifiedTime && (
                            <span>{format(new Date(item.modifiedTime), 'dd MMM yyyy')}</span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {item.webViewLink && (
                            <>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openInDrive(item.webViewLink); }}>
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Open in Drive
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); copyLink(item.webViewLink); }}>
                                <Copy className="w-4 h-4 mr-2" />
                                Copy Link
                              </DropdownMenuItem>
                              {!isFolder && (
                                <>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); downloadFile(item); }}>
                                    <Download className="w-4 h-4 mr-2" />
                                    Download
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => { e.stopPropagation(); handleSendFile(item); }}
                                    className="text-purple-700"
                                  >
                                    <Mail className="w-4 h-4 mr-2" />
                                    Send via Email
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkAsSent(item);
                                    }}
                                    className="text-green-700"
                                  >
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                    Mark as Sent
                                  </DropdownMenuItem>
                                </>
                              )}
                            </>
                          )}
                          {isFolder && viewMode === 'tree' && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigateToFolder(item); }}>
                              <FolderOpen className="w-4 h-4 mr-2" />
                              Open Folder
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
            <DialogDescription>
              Enter a name for the new folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim() || isCreatingFolder}>
              {isCreatingFolder && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Compose Modal */}
      <EmailComposeModal
        isOpen={showEmailCompose}
        onClose={() => {
          setShowEmailCompose(false);
          setPendingFile(null);
        }}
        defaultTo={borrower?.email || ''}
        defaultSubject={pendingFile ? `Document: ${pendingFile.name}` : ''}
        defaultBody={getFileEmailBody()}
        attachmentName={pendingFile?.name || ''}
        onSend={handleFileSend}
        isSending={isSendingFile}
        error={emailError}
      />

      {/* Mark as Sent Confirmation Dialog */}
      <AlertDialog open={showMarkAsSentDialog} onOpenChange={setShowMarkAsSentDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark file as sent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will record "{fileToMarkAsSent?.name}" as sent in the activity log.
              Use this if you've already sent this file via another method (e.g., printed and posted, sent from your email client).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMarkingAsSent}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmMarkAsSent}
              disabled={isMarkingAsSent}
              className="bg-green-600 hover:bg-green-700"
            >
              {isMarkingAsSent ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Mark as Sent
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
