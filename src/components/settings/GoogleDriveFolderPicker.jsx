/**
 * Google Drive Folder Picker Modal
 *
 * Allows users to browse and select a base folder for correspondence storage
 */

import { useState, useEffect } from 'react';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  HardDrive,
  Loader2,
  ArrowLeft
} from 'lucide-react';
import { toast } from 'sonner';

export default function GoogleDriveFolderPicker({ open, onClose, onSelect }) {
  const { listSharedDrives, listFolders, saveBaseFolder } = useGoogleDrive();

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [drives, setDrives] = useState([]);
  const [folders, setFolders] = useState([]);
  const [currentDrive, setCurrentDrive] = useState(null);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([]); // [{id, name}]
  const [selectedFolder, setSelectedFolder] = useState(null);

  // Load shared drives when modal opens
  useEffect(() => {
    if (open) {
      loadDrives();
    }
  }, [open]);

  const loadDrives = async () => {
    setIsLoading(true);
    try {
      console.log('[FolderPicker] Loading drives...');
      const driveList = await listSharedDrives();
      console.log('[FolderPicker] Drives loaded:', driveList);
      setDrives(driveList);
      // Reset state
      setCurrentDrive(null);
      setCurrentFolder(null);
      setBreadcrumbs([]);
      setFolders([]);
      setSelectedFolder(null);
    } catch (err) {
      console.error('[FolderPicker] Error loading drives:', err);
      toast.error('Failed to load drives: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const selectDrive = async (drive) => {
    setIsLoading(true);
    setCurrentDrive(drive);
    setBreadcrumbs([{ id: drive.id, name: drive.name }]);
    setSelectedFolder({ id: drive.id, name: drive.name, path: drive.name });

    try {
      const folderList = await listFolders(drive.id, drive.type === 'shared' ? drive.id : null);
      setFolders(folderList);
      setCurrentFolder(drive.id);
    } catch (err) {
      console.error('Error loading folders:', err);
      toast.error('Failed to load folders: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToFolder = async (folder) => {
    setIsLoading(true);
    const newBreadcrumbs = [...breadcrumbs, { id: folder.id, name: folder.name }];
    setBreadcrumbs(newBreadcrumbs);

    const path = newBreadcrumbs.map(b => b.name).join(' / ');
    setSelectedFolder({ id: folder.id, name: folder.name, path });

    try {
      const folderList = await listFolders(folder.id, currentDrive?.type === 'shared' ? currentDrive.id : null);
      setFolders(folderList);
      setCurrentFolder(folder.id);
    } catch (err) {
      console.error('Error loading folders:', err);
      toast.error('Failed to load folders: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToBreadcrumb = async (index) => {
    if (index === -1) {
      // Go back to drive list
      setCurrentDrive(null);
      setCurrentFolder(null);
      setBreadcrumbs([]);
      setFolders([]);
      setSelectedFolder(null);
      return;
    }

    const crumb = breadcrumbs[index];
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);

    const path = newBreadcrumbs.map(b => b.name).join(' / ');
    setSelectedFolder({ id: crumb.id, name: crumb.name, path });

    setIsLoading(true);
    try {
      const folderList = await listFolders(crumb.id, currentDrive?.type === 'shared' ? currentDrive.id : null);
      setFolders(folderList);
      setCurrentFolder(crumb.id);
    } catch (err) {
      console.error('Error loading folders:', err);
      toast.error('Failed to load folders: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFolder) {
      toast.error('Please select a folder');
      return;
    }

    setIsSaving(true);
    try {
      await saveBaseFolder(selectedFolder.id, selectedFolder.path);
      toast.success('Base folder saved');
      onSelect?.(selectedFolder);
      onClose();
    } catch (err) {
      console.error('Error saving folder:', err);
      toast.error('Failed to save folder: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Base Folder</DialogTitle>
          <DialogDescription>
            Choose the folder where correspondence will be saved.
            Subfolders will be created for each borrower and loan.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <div className="flex items-center gap-1 text-sm text-slate-600 flex-wrap">
            <button
              onClick={() => navigateToBreadcrumb(-1)}
              className="hover:text-blue-600 flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Drives
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

        {/* Content */}
        <ScrollArea className="h-[300px] border rounded-md p-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : !currentDrive ? (
            // Drive list
            <div className="space-y-1">
              {drives.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  No drives available
                </p>
              ) : (
                drives.map(drive => (
                  <button
                    key={drive.id}
                    onClick={() => selectDrive(drive)}
                    className="w-full flex items-center gap-3 p-3 rounded-md hover:bg-slate-100 text-left"
                  >
                    <HardDrive className={`w-5 h-5 ${drive.type === 'shared' ? 'text-blue-600' : 'text-slate-600'}`} />
                    <div>
                      <p className="font-medium">{drive.name}</p>
                      <p className="text-xs text-slate-500">
                        {drive.type === 'shared' ? 'Shared Drive' : 'Personal Drive'}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 ml-auto text-slate-400" />
                  </button>
                ))
              )}
            </div>
          ) : (
            // Folder list
            <div className="space-y-1">
              {folders.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  No subfolders in this folder
                </p>
              ) : (
                folders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => navigateToFolder(folder)}
                    className="w-full flex items-center gap-3 p-3 rounded-md hover:bg-slate-100 text-left"
                  >
                    <Folder className="w-5 h-5 text-amber-500" />
                    <span className="flex-1 truncate">{folder.name}</span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </button>
                ))
              )}
            </div>
          )}
        </ScrollArea>

        {/* Selected folder display */}
        {selectedFolder && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-blue-900">Selected folder:</p>
                <p className="text-sm text-blue-700">{selectedFolder.path}</p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!selectedFolder || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Select Folder'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
