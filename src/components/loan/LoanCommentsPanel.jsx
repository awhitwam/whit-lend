import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { useAuth } from '@/lib/AuthContext';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  MessageSquare,
  Plus,
  ArrowUp,
  ArrowDown,
  Download,
  Loader2,
  User,
  Calendar,
  X,
  Edit,
  Trash2,
  MoreVertical
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from 'date-fns';
import { toast } from 'sonner';
import jsPDF from 'jspdf';

export default function LoanCommentsPanel({ loan }) {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [editingComment, setEditingComment] = useState(null);
  const [editText, setEditText] = useState('');
  const [deleteConfirmComment, setDeleteConfirmComment] = useState(null);

  // Fetch comments for this loan
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['loan-comments', loan.id],
    queryFn: () => api.entities.LoanComment.filter(
      { loan_id: loan.id },
      sortNewestFirst ? '-created_at' : 'created_at'
    ),
    enabled: !!loan?.id
  });

  // Sort comments client-side when sort order changes (to avoid refetch)
  const sortedComments = [...comments].sort((a, b) => {
    const dateA = new Date(a.created_at);
    const dateB = new Date(b.created_at);
    return sortNewestFirst ? dateB - dateA : dateA - dateB;
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async (commentText) => {
      return api.entities.LoanComment.create({
        loan_id: loan.id,
        user_id: user?.id || null,
        user_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        comment: commentText
      });
    },
    onSuccess: () => {
      toast.success('Comment added');
      setNewComment('');
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ['loan-comments', loan.id] });
    },
    onError: (error) => {
      toast.error('Failed to add comment: ' + error.message);
    }
  });

  // Update comment mutation
  const updateCommentMutation = useMutation({
    mutationFn: async ({ id, comment }) => {
      return api.entities.LoanComment.update(id, { comment });
    },
    onSuccess: () => {
      toast.success('Comment updated');
      setEditingComment(null);
      setEditText('');
      queryClient.invalidateQueries({ queryKey: ['loan-comments', loan.id] });
    },
    onError: (error) => {
      toast.error('Failed to update comment: ' + error.message);
    }
  });

  // Delete comment mutation
  const deleteCommentMutation = useMutation({
    mutationFn: async (id) => {
      return api.entities.LoanComment.delete(id);
    },
    onSuccess: () => {
      toast.success('Comment deleted');
      setDeleteConfirmComment(null);
      queryClient.invalidateQueries({ queryKey: ['loan-comments', loan.id] });
    },
    onError: (error) => {
      toast.error('Failed to delete comment: ' + error.message);
    }
  });

  // Generate PDF export
  const handleExportPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = 20;

    // Header
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('Loan Comments', margin, y);
    y += 10;

    // Loan info
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text(`Loan: ${loan.loan_number}`, margin, y);
    y += 6;
    doc.text(`Borrower: ${loan.borrower_name}`, margin, y);
    y += 6;
    doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, margin, y);
    y += 6;

    if (currentOrganization?.name) {
      doc.text(`Organization: ${currentOrganization.name}`, margin, y);
      y += 6;
    }

    y += 8;

    // Divider line
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Comments
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`Comments (${sortedComments.length})`, margin, y);
    y += 10;

    if (sortedComments.length === 0) {
      doc.setFont(undefined, 'italic');
      doc.setFontSize(10);
      doc.text('No comments recorded', margin, y);
    } else {
      sortedComments.forEach((comment, idx) => {
        // Check if we need a new page
        if (y > 260) {
          doc.addPage();
          y = 20;
        }

        // Comment header: User + Date
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        const dateStr = format(new Date(comment.created_at), 'dd MMM yyyy HH:mm');
        doc.text(`${comment.user_name || 'Unknown'}`, margin, y);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100);
        doc.text(dateStr, pageWidth - margin - doc.getTextWidth(dateStr), y);
        doc.setTextColor(0);
        y += 5;

        // Comment text - wrap long text
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const textLines = doc.splitTextToSize(comment.comment, pageWidth - margin * 2);
        textLines.forEach(line => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, margin, y);
          y += 5;
        });

        y += 8; // Space between comments
      });
    }

    // Save
    doc.save(`loan-${loan.loan_number}-comments.pdf`);
    toast.success('PDF exported');
  };

  const handleSubmit = () => {
    if (!newComment.trim()) {
      toast.error('Please enter a comment');
      return;
    }
    addCommentMutation.mutate(newComment.trim());
  };

  const handleEditSave = () => {
    if (!editText.trim()) {
      toast.error('Comment cannot be empty');
      return;
    }
    updateCommentMutation.mutate({ id: editingComment.id, comment: editText.trim() });
  };

  const startEditing = (comment) => {
    setEditingComment(comment);
    setEditText(comment.comment);
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            Comments
            {comments.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {comments.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortNewestFirst(!sortNewestFirst)}
              className="gap-1"
            >
              {sortNewestFirst ? (
                <>
                  <ArrowDown className="w-3 h-3" />
                  Newest First
                </>
              ) : (
                <>
                  <ArrowUp className="w-3 h-3" />
                  Oldest First
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={comments.length === 0}
              className="gap-1"
            >
              <Download className="w-3 h-3" />
              PDF
            </Button>
            {!showAddForm && (
              <Button
                size="sm"
                onClick={() => setShowAddForm(true)}
                className="gap-1"
              >
                <Plus className="w-3 h-3" />
                Add Comment
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Comment Form */}
        {showAddForm && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-900">New Comment</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setNewComment('');
                }}
                className="h-6 w-6 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Enter your comment..."
              rows={3}
              className="bg-white"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setNewComment('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!newComment.trim() || addCommentMutation.isPending}
              >
                {addCommentMutation.isPending && (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                )}
                Save Comment
              </Button>
            </div>
          </div>
        )}

        {/* Comments List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : sortedComments.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p>No comments yet</p>
            <p className="text-sm">Add a comment to keep track of important notes about this loan.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedComments.map((comment) => (
              <div
                key={comment.id}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
              >
                {editingComment?.id === comment.id ? (
                  // Edit mode
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Edit Comment</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingComment(null);
                          setEditText('');
                        }}
                        className="h-6 w-6 p-0"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="bg-white"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingComment(null);
                          setEditText('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleEditSave}
                        disabled={!editText.trim() || updateCommentMutation.isPending}
                      >
                        {updateCommentMutation.isPending && (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View mode - compact single row layout
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700">
                        <span className="text-xs text-slate-500 mr-1.5">{comment.user_name || 'Unknown'}:</span>
                        {comment.comment}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {format(new Date(comment.created_at), 'dd MMM yyyy HH:mm')}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                            <MoreVertical className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => startEditing(comment)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteConfirmComment(comment)}
                            className="text-red-600"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmComment} onOpenChange={(open) => !open && setDeleteConfirmComment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this comment. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCommentMutation.mutate(deleteConfirmComment.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteCommentMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
