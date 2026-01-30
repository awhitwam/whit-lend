import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { supabase } from '@/lib/supabaseClient';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';
import {
  Loader2,
  Plus,
  Upload,
  Link as LinkIcon,
  Camera,
  FileSearch,
  Scale,
  Shield,
  TrendingUp,
  FileText,
  File,
  Trash2,
  ExternalLink,
  Image as ImageIcon,
  X,
  Eye
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import GoogleDriveFileBrowser from './GoogleDriveFileBrowser';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import { FolderOpen } from 'lucide-react';

// Document type configuration - exported for use in PropertyCard
export const DOCUMENT_TYPES = {
  photo: { label: 'Photo', icon: Camera, color: 'bg-blue-100 text-blue-700' },
  survey: { label: 'Survey Report', icon: FileSearch, color: 'bg-purple-100 text-purple-700' },
  title_deed: { label: 'Title Deed', icon: Scale, color: 'bg-amber-100 text-amber-700' },
  insurance: { label: 'Insurance', icon: Shield, color: 'bg-green-100 text-green-700' },
  valuation: { label: 'Valuation', icon: TrendingUp, color: 'bg-emerald-100 text-emerald-700' },
  planning: { label: 'Planning', icon: FileText, color: 'bg-orange-100 text-orange-700' },
  other: { label: 'Other', icon: File, color: 'bg-slate-100 text-slate-700' }
};

export default function PropertyDocuments({ propertyId, loan, borrower, compact = false }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addMode, setAddMode] = useState(null); // 'link', 'upload', or 'drive'
  const [selectedImage, setSelectedImage] = useState(null); // For lightbox
  const [showDriveBrowser, setShowDriveBrowser] = useState(false);
  const [newDocument, setNewDocument] = useState({
    title: '',
    document_type: 'other',
    notes: '',
    external_url: ''
  });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Check if Google Drive is connected
  const { isConnected: isDriveConnected, baseFolderId } = useGoogleDrive();

  // Fetch documents for this property
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['property-documents', propertyId],
    queryFn: () => api.entities.PropertyDocument.filter({ property_id: propertyId }, '-created_at'),
    enabled: !!propertyId
  });

  // Get signed URL for viewing uploaded images
  const getSignedUrl = useCallback(async (storagePath) => {
    const { data, error } = await supabase.storage
      .from('property-documents')
      .createSignedUrl(storagePath, 3600); // 1 hour expiry
    if (error) {
      console.error('Error getting signed URL:', error);
      return null;
    }
    return data.signedUrl;
  }, []);

  // Add document (link)
  const addLinkMutation = useMutation({
    mutationFn: async () => {
      const docData = {
        property_id: propertyId,
        title: newDocument.title,
        document_type: newDocument.document_type,
        notes: newDocument.notes,
        external_url: newDocument.external_url
      };

      const created = await api.entities.PropertyDocument.create(docData);

      await logAudit({
        action: AuditAction.CREATE,
        entityType: EntityType.PROPERTY,
        entityId: propertyId,
        entityName: `Document: ${newDocument.title}`,
        details: { document_type: newDocument.document_type, external_url: newDocument.external_url }
      });

      return created;
    },
    onSuccess: () => {
      toast.success('Document link added');
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['property-documents', propertyId] });
    },
    onError: (error) => {
      toast.error('Failed to add document: ' + error.message);
    }
  });

  // Upload image
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error('No file selected');

      setUploading(true);

      // Generate unique file path
      const fileExt = uploadFile.name.split('.').pop();
      const fileName = `${propertyId}/${Date.now()}.${fileExt}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('property-documents')
        .upload(fileName, uploadFile, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Create database record
      const docData = {
        property_id: propertyId,
        title: newDocument.title || uploadFile.name,
        document_type: newDocument.document_type,
        notes: newDocument.notes,
        storage_path: fileName,
        mime_type: uploadFile.type,
        file_size: uploadFile.size
      };

      const created = await api.entities.PropertyDocument.create(docData);

      await logAudit({
        action: AuditAction.CREATE,
        entityType: EntityType.PROPERTY,
        entityId: propertyId,
        entityName: `Upload: ${docData.title}`,
        details: { document_type: newDocument.document_type, file_size: uploadFile.size }
      });

      return created;
    },
    onSuccess: () => {
      toast.success('Image uploaded');
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['property-documents', propertyId] });
    },
    onError: (error) => {
      toast.error('Failed to upload: ' + error.message);
    },
    onSettled: () => {
      setUploading(false);
    }
  });

  // Delete document
  const deleteMutation = useMutation({
    mutationFn: async (doc) => {
      // Delete from storage if it's an uploaded file
      if (doc.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('property-documents')
          .remove([doc.storage_path]);
        if (storageError) console.error('Error deleting from storage:', storageError);
      }

      await api.entities.PropertyDocument.delete(doc.id);

      await logAudit({
        action: AuditAction.DELETE,
        entityType: EntityType.PROPERTY,
        entityId: propertyId,
        entityName: `Document: ${doc.title}`,
        details: { document_type: doc.document_type }
      });

      return doc;
    },
    onSuccess: (doc) => {
      toast.success(`Deleted: ${doc.title}`);
      queryClient.invalidateQueries({ queryKey: ['property-documents', propertyId] });
    },
    onError: (error) => {
      toast.error('Failed to delete: ' + error.message);
    }
  });

  const resetForm = () => {
    setShowAddForm(false);
    setAddMode(null);
    setUploadFile(null);
    setNewDocument({
      title: '',
      document_type: 'photo',
      notes: '',
      external_url: ''
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      // Auto-fill title if empty
      if (!newDocument.title) {
        setNewDocument(prev => ({ ...prev, title: file.name.replace(/\.[^/.]+$/, '') }));
      }
    }
  };

  const handleViewImage = async (doc) => {
    if (doc.storage_path) {
      const url = await getSignedUrl(doc.storage_path);
      if (url) {
        setSelectedImage({ url, title: doc.title });
      }
    }
  };

  const handleOpenLink = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Handle file selected from Google Drive browser
  const handleDriveFileSelect = (file) => {
    setNewDocument(prev => ({
      ...prev,
      title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension from title
      external_url: file.webViewLink
    }));
    setAddMode('link');
    setShowAddForm(true);
    setShowDriveBrowser(false);
  };

  // Group documents by type
  const photoDocuments = documents.filter(d => d.document_type === 'photo');
  const otherDocuments = documents.filter(d => d.document_type !== 'photo');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add Document Buttons */}
      {!showAddForm && (
        <div className="space-y-2">
          {/* Google Drive browse button - primary when available */}
          {isDriveConnected && baseFolderId && loan && borrower && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDriveBrowser(true)}
              className="w-full border-blue-200 hover:bg-blue-50"
            >
              <FolderOpen className="w-4 h-4 mr-2 text-blue-600" />
              Browse Google Drive
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAddForm(true); setAddMode('upload'); }}
              className="flex-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Image
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAddForm(true); setAddMode('link'); }}
              className="flex-1"
            >
              <LinkIcon className="w-4 h-4 mr-2" />
              Paste Link
            </Button>
          </div>
        </div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                {addMode === 'upload' ? 'Upload Image' : 'Add Document Link'}
              </span>
              <Button variant="ghost" size="sm" onClick={resetForm} className="h-6 w-6 p-0">
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* File upload input */}
            {addMode === 'upload' && (
              <div className="space-y-2">
                <Label>Select Image</Label>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleFileSelect}
                  className="cursor-pointer"
                />
                {uploadFile && (
                  <p className="text-xs text-slate-500">
                    {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
            )}

            {/* URL input for links */}
            {addMode === 'link' && (
              <div className="space-y-2">
                <Label>Document URL</Label>
                <Input
                  type="url"
                  value={newDocument.external_url}
                  onChange={(e) => setNewDocument(prev => ({ ...prev, external_url: e.target.value }))}
                  placeholder="https://drive.google.com/..."
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={newDocument.title}
                  onChange={(e) => setNewDocument(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Front exterior"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={newDocument.document_type}
                  onValueChange={(v) => setNewDocument(prev => ({ ...prev, document_type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOCUMENT_TYPES).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={newDocument.notes}
                onChange={(e) => setNewDocument(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional details..."
                rows={2}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetForm} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={() => addMode === 'upload' ? uploadMutation.mutate() : addLinkMutation.mutate()}
                disabled={
                  (addMode === 'upload' && !uploadFile) ||
                  (addMode === 'link' && !newDocument.external_url) ||
                  !newDocument.title ||
                  uploading ||
                  addLinkMutation.isPending
                }
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {(uploading || addLinkMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {addMode === 'upload' ? 'Upload' : 'Add Link'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Photos Section */}
      {photoDocuments.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Photos ({photoDocuments.length})
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {photoDocuments.map((doc) => (
              <DocumentThumbnail
                key={doc.id}
                doc={doc}
                onView={() => handleViewImage(doc)}
                onDelete={() => deleteMutation.mutate(doc)}
                getSignedUrl={getSignedUrl}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other Documents Section */}
      {otherDocuments.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Documents ({otherDocuments.length})
          </h4>
          <div className="space-y-2">
            {otherDocuments.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onView={() => doc.external_url ? handleOpenLink(doc.external_url) : handleViewImage(doc)}
                onDelete={() => deleteMutation.mutate(doc)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {documents.length === 0 && !showAddForm && (
        <p className="text-sm text-slate-500 text-center py-4 bg-slate-50 rounded-lg">
          No documents attached to this property
        </p>
      )}

      {/* Image Lightbox */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{selectedImage?.title}</DialogTitle>
          </DialogHeader>
          {selectedImage && (
            <div className="flex items-center justify-center">
              <img
                src={selectedImage.url}
                alt={selectedImage.title}
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Google Drive File Browser */}
      <GoogleDriveFileBrowser
        isOpen={showDriveBrowser}
        onClose={() => setShowDriveBrowser(false)}
        onSelect={handleDriveFileSelect}
        loan={loan}
        borrower={borrower}
      />
    </div>
  );
}

// Thumbnail component for photos
function DocumentThumbnail({ doc, onView, onDelete, getSignedUrl }) {
  const [thumbnailUrl, setThumbnailUrl] = useState(null);

  // Load thumbnail
  useEffect(() => {
    if (doc.storage_path && doc.mime_type?.startsWith('image/')) {
      getSignedUrl(doc.storage_path).then(url => setThumbnailUrl(url));
    }
  }, [doc.storage_path, doc.mime_type, getSignedUrl]);

  return (
    <div className="relative group aspect-square bg-slate-100 rounded-lg overflow-hidden">
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={doc.title}
          className="w-full h-full object-cover cursor-pointer"
          onClick={onView}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon className="w-8 h-8 text-slate-300" />
        </div>
      )}
      {/* Overlay on hover */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-white hover:text-white hover:bg-white/20"
          onClick={onView}
        >
          <Eye className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-white/20"
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      {/* Title overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
        <p className="text-xs text-white truncate">{doc.title}</p>
      </div>
    </div>
  );
}

// Row component for non-photo documents
function DocumentRow({ doc, onView, onDelete }) {
  const typeConfig = DOCUMENT_TYPES[doc.document_type] || DOCUMENT_TYPES.other;
  const Icon = typeConfig.icon;

  return (
    <div className="flex items-center gap-3 p-3 bg-white border rounded-lg">
      <div className={`p-2 rounded-lg ${typeConfig.color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{doc.title}</p>
        <p className="text-xs text-slate-500">
          {typeConfig.label} - {format(new Date(doc.created_at), 'dd MMM yyyy')}
        </p>
        {doc.notes && (
          <p className="text-xs text-slate-400 mt-1 truncate">{doc.notes}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {doc.external_url && (
          <Badge variant="outline" className="text-xs">
            <LinkIcon className="w-3 h-3 mr-1" />
            Link
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onView}
        >
          {doc.external_url ? <ExternalLink className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// Helper function to get document counts for PropertyCard
export function usePropertyDocumentCounts(propertyId) {
  const { data: documents = [] } = useQuery({
    queryKey: ['property-documents', propertyId],
    queryFn: () => api.entities.PropertyDocument.filter({ property_id: propertyId }),
    enabled: !!propertyId
  });

  const photos = documents.filter(d => d.document_type === 'photo').length;
  const links = documents.filter(d => d.external_url).length;
  const total = documents.length;

  return { photos, links, total, documents };
}
