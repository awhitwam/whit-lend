import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import { toast } from 'sonner';
import {
  Folder,
  FolderOpen,
  FileText,
  File,
  Image,
  ChevronRight,
  Loader2,
  ArrowLeft,
  ExternalLink,
  AlertCircle
} from 'lucide-react';

// Get icon based on MIME type
const getFileIcon = (mimeType) => {
  if (!mimeType) return File;
  if (mimeType.includes('folder')) return Folder;
  if (mimeType.includes('image')) return Image;
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return FileText;
  return File;
};

// Format file size
const formatSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function GoogleDriveFileBrowser({
  isOpen,
  onClose,
  onSelect,
  loan,
  borrower
}) {
  const {
    isConnected,
    baseFolderId,
    listFiles,
    getLoanFolderId,
    isLoading: isDriveLoading
  } = useGoogleDrive();

  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [loanFolderId, setLoanFolderId] = useState(null);

  // Initialize - get or create the loan folder and load its contents
  useEffect(() => {
    if (!isOpen || !isConnected || !baseFolderId || !loan || !borrower) return;

    const initializeBrowser = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Get/create the loan folder structure
        // Use loan_number as the folder prefix (not UUIDs) to match existing folder structure
        const borrowerDescription = borrower.full_name || borrower.business_name || `${borrower.first_name} ${borrower.last_name}`;
        const loanDescription = loan.description || `Loan ${loan.loan_number}`;
        const loanNumber = loan.loan_number;

        const folderId = await getLoanFolderId(
          loanNumber,  // Borrower folder uses loan number as prefix
          borrowerDescription,
          loanNumber,  // Loan folder also uses loan number as prefix
          loanDescription
        );

        setLoanFolderId(folderId);
        setCurrentFolderId(folderId);
        const folderDisplayName = `${loanNumber} ${loanDescription}`;
        setBreadcrumbs([{ id: folderId, name: folderDisplayName }]);

        // Load files in the loan folder
        const files = await listFiles(folderId);
        setItems(files);
      } catch (err) {
        console.error('Error initializing Drive browser:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    initializeBrowser();
  }, [isOpen, isConnected, baseFolderId, loan, borrower, getLoanFolderId, listFiles]);

  // Navigate into a folder
  const navigateToFolder = async (folder) => {
    setIsLoading(true);
    setError(null);
    try {
      const files = await listFiles(folder.id);
      setItems(files);
      setCurrentFolderId(folder.id);
      setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
      setSelectedFile(null);
    } catch (err) {
      console.error('Error loading folder:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Navigate back via breadcrumb
  const navigateToBreadcrumb = async (index) => {
    const target = breadcrumbs[index];
    if (target.id === currentFolderId) return;

    setIsLoading(true);
    setError(null);
    try {
      const files = await listFiles(target.id);
      setItems(files);
      setCurrentFolderId(target.id);
      setBreadcrumbs(prev => prev.slice(0, index + 1));
      setSelectedFile(null);
    } catch (err) {
      console.error('Error navigating:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Go back one level
  const goBack = () => {
    if (breadcrumbs.length > 1) {
      navigateToBreadcrumb(breadcrumbs.length - 2);
    }
  };

  // Handle item click
  const handleItemClick = (item) => {
    if (item.isFolder) {
      navigateToFolder(item);
    } else {
      setSelectedFile(item);
    }
  };

  // Handle selection confirm
  const handleSelect = () => {
    if (selectedFile) {
      onSelect({
        id: selectedFile.id,
        name: selectedFile.name,
        mimeType: selectedFile.mimeType,
        webViewLink: selectedFile.webViewLink,
        size: selectedFile.size
      });
      onClose();
    }
  };

  // Separate folders and files
  const folders = items.filter(i => i.isFolder);
  const files = items.filter(i => !i.isFolder);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-blue-600" />
            Select Document from Google Drive
          </DialogTitle>
          <DialogDescription>
            Browse the loan's folder structure and select a document to link
          </DialogDescription>
        </DialogHeader>

        {/* Not connected state */}
        {!isConnected && !isDriveLoading && (
          <div className="py-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-amber-500" />
            <p className="text-slate-600 mb-2">Google Drive not connected</p>
            <p className="text-sm text-slate-500">
              Please connect Google Drive in Settings to browse files
            </p>
          </div>
        )}

        {/* No base folder configured */}
        {isConnected && !baseFolderId && !isDriveLoading && (
          <div className="py-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-amber-500" />
            <p className="text-slate-600 mb-2">No base folder configured</p>
            <p className="text-sm text-slate-500">
              Please select a base folder in Settings
            </p>
          </div>
        )}

        {/* Main browser content */}
        {isConnected && baseFolderId && (
          <>
            {/* Breadcrumbs */}
            <div className="flex items-center gap-1 text-sm border-b pb-2 overflow-x-auto">
              {breadcrumbs.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  className="h-6 px-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              )}
              {breadcrumbs.map((crumb, index) => (
                <div key={crumb.id} className="flex items-center">
                  {index > 0 && <ChevronRight className="w-4 h-4 text-slate-400 mx-1" />}
                  <button
                    onClick={() => navigateToBreadcrumb(index)}
                    className={`px-2 py-1 rounded hover:bg-slate-100 truncate max-w-[150px] ${
                      index === breadcrumbs.length - 1 ? 'font-medium text-slate-900' : 'text-slate-600'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </div>
              ))}
            </div>

            {/* Error state */}
            {error && (
              <div className="py-4 text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
                <p className="text-sm text-red-600">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => loanFolderId && navigateToBreadcrumb(0)}
                >
                  Try Again
                </Button>
              </div>
            )}

            {/* Loading state */}
            {isLoading && (
              <div className="py-8 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            )}

            {/* File list */}
            {!isLoading && !error && (
              <ScrollArea className="flex-1 min-h-[300px] max-h-[400px]">
                <div className="space-y-1 p-1">
                  {/* Folders first */}
                  {folders.map((folder) => {
                    const Icon = FolderOpen;
                    return (
                      <button
                        key={folder.id}
                        onClick={() => handleItemClick(folder)}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 text-left"
                      >
                        <Icon className="w-5 h-5 text-amber-500 flex-shrink-0" />
                        <span className="flex-1 truncate">{folder.name}</span>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </button>
                    );
                  })}

                  {/* Files */}
                  {files.map((file) => {
                    const Icon = getFileIcon(file.mimeType);
                    const isSelected = selectedFile?.id === file.id;
                    return (
                      <button
                        key={file.id}
                        onClick={() => handleItemClick(file)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                          isSelected
                            ? 'bg-blue-100 border border-blue-300'
                            : 'hover:bg-slate-100'
                        }`}
                      >
                        <Icon className={`w-5 h-5 flex-shrink-0 ${
                          file.mimeType?.includes('image') ? 'text-purple-500' :
                          file.mimeType?.includes('pdf') ? 'text-red-500' :
                          'text-blue-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm">{file.name}</p>
                          {file.size && (
                            <p className="text-xs text-slate-500">{formatSize(file.size)}</p>
                          )}
                        </div>
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 text-slate-400 hover:text-blue-600"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </button>
                    );
                  })}

                  {/* Empty state */}
                  {folders.length === 0 && files.length === 0 && (
                    <div className="py-8 text-center text-slate-500">
                      <File className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-sm">This folder is empty</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            {/* Selected file preview */}
            {selectedFile && (
              <div className="border-t pt-3 mt-2">
                <div className="flex items-center gap-3 p-2 bg-blue-50 rounded-lg">
                  {(() => {
                    const Icon = getFileIcon(selectedFile.mimeType);
                    return <Icon className="w-5 h-5 text-blue-600 flex-shrink-0" />;
                  })()}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                    {selectedFile.size && (
                      <p className="text-xs text-slate-500">{formatSize(selectedFile.size)}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={!selectedFile}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Select Document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
