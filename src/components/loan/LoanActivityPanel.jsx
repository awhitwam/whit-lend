import { useState, useMemo } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Plus,
  ArrowUp,
  ArrowDown,
  Download,
  Loader2,
  X,
  Edit,
  Trash2,
  MoreVertical,
  Mail,
  FileText,
  Activity,
  ExternalLink
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

export default function LoanActivityPanel({ loan }) {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [editingComment, setEditingComment] = useState(null);
  const [editText, setEditText] = useState('');
  const [deleteConfirmComment, setDeleteConfirmComment] = useState(null);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'comments' | 'letters'

  // Fetch comments for this loan
  const { data: comments = [], isLoading: isLoadingComments } = useQuery({
    queryKey: ['loan-comments', loan.id],
    queryFn: () => api.entities.LoanComment.filter({ loan_id: loan.id }),
    enabled: !!loan?.id
  });

  // Fetch letters for this loan
  const { data: letters = [], isLoading: isLoadingLetters } = useQuery({
    queryKey: ['loan-letters', loan.id],
    queryFn: () => api.entities.GeneratedLetter.filter({ loan_id: loan.id }),
    enabled: !!loan?.id
  });

  const isLoading = isLoadingComments || isLoadingLetters;

  // Combine and sort activities
  const activities = useMemo(() => {
    const all = [
      ...comments.map(c => ({ ...c, type: 'comment' })),
      ...letters.map(l => ({ ...l, type: 'letter' }))
    ];
    return all.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sortNewestFirst ? dateB - dateA : dateA - dateB;
    });
  }, [comments, letters, sortNewestFirst]);

  // Filter activities
  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
      if (filterType === 'all') return true;
      if (filterType === 'comments') return a.type === 'comment';
      if (filterType === 'letters') return a.type === 'letter';
      return true;
    });
  }, [activities, filterType]);

  // Counts for badges
  const commentCount = comments.length;
  const letterCount = letters.length;

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
    doc.text('Loan Activity Log', margin, y);
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

    // Activity summary
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`Activity (${filteredActivities.length} items)`, margin, y);
    y += 10;

    if (filteredActivities.length === 0) {
      doc.setFont(undefined, 'italic');
      doc.setFontSize(10);
      doc.text('No activity recorded', margin, y);
    } else {
      filteredActivities.forEach((activity) => {
        // Check if we need a new page
        if (y > 260) {
          doc.addPage();
          y = 20;
        }

        // Activity header
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        const dateStr = format(new Date(activity.created_at), 'dd MMM yyyy HH:mm');

        if (activity.type === 'comment') {
          doc.text(`[Comment] ${activity.user_name || 'Unknown'}`, margin, y);
        } else {
          doc.text(`[Letter] ${activity.template_name || 'Letter'}`, margin, y);
        }

        doc.setFont(undefined, 'normal');
        doc.setTextColor(100);
        doc.text(dateStr, pageWidth - margin - doc.getTextWidth(dateStr), y);
        doc.setTextColor(0);
        y += 5;

        // Activity content
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const content = activity.type === 'comment'
          ? activity.comment
          : `Subject: ${activity.subject || 'No subject'}\nDelivery: ${activity.delivery_method || 'unknown'}`;
        const textLines = doc.splitTextToSize(content, pageWidth - margin * 2);
        textLines.forEach(line => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, margin, y);
          y += 5;
        });

        y += 8; // Space between activities
      });
    }

    // Save
    doc.save(`loan-${loan.loan_number}-activity.pdf`);
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

  const getDeliveryMethodLabel = (method) => {
    switch (method) {
      case 'email': return 'Email';
      case 'download': return 'Downloaded';
      case 'drive': return 'Google Drive';
      case 'other': return 'Other';
      default: return method || 'Unknown';
    }
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Activity
            {activities.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {activities.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Filter dropdown */}
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[140px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All ({activities.length})
                </SelectItem>
                <SelectItem value="comments">
                  Comments ({commentCount})
                </SelectItem>
                <SelectItem value="letters">
                  Letters ({letterCount})
                </SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortNewestFirst(!sortNewestFirst)}
              className="gap-1"
            >
              {sortNewestFirst ? (
                <>
                  <ArrowDown className="w-3 h-3" />
                  Newest
                </>
              ) : (
                <>
                  <ArrowUp className="w-3 h-3" />
                  Oldest
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={filteredActivities.length === 0}
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

        {/* Activity List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Activity className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p>No activity yet</p>
            <p className="text-sm">Add a comment or send a letter to start tracking activity.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredActivities.map((activity) => (
              <div key={`${activity.type}-${activity.id}`}>
                {activity.type === 'comment' ? (
                  // Comment display
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                    {editingComment?.id === activity.id ? (
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
                      // View mode
                      <div className="flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-700">
                            <span className="text-xs text-slate-500 mr-1.5">{activity.user_name || 'Unknown'}:</span>
                            {activity.comment}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-xs text-slate-400 whitespace-nowrap">
                            {format(new Date(activity.created_at), 'dd MMM yyyy HH:mm')}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                                <MoreVertical className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => startEditing(activity)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteConfirmComment(activity)}
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
                ) : (
                  // Letter display
                  <div
                    className={`px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg ${
                      activity.google_drive_file_url ? 'cursor-pointer hover:bg-purple-100 transition-colors' : ''
                    }`}
                    onClick={() => {
                      if (activity.google_drive_file_url) {
                        window.open(activity.google_drive_file_url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <Mail className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-purple-900 flex items-center gap-1">
                          {activity.subject || 'No subject'}
                          {activity.google_drive_file_url && (
                            <ExternalLink className="w-3 h-3 text-purple-400" />
                          )}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-purple-600 mt-0.5">
                          <span>{activity.template_name || 'Letter'}</span>
                          {activity.attached_reports && activity.attached_reports.length > 0 && (
                            <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs py-0">
                              {activity.attached_reports.length} attachment{activity.attached_reports.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                          <span className="text-purple-400">•</span>
                          <span>via {getDeliveryMethodLabel(activity.delivery_method)}</span>
                          {activity.recipient_email && (
                            <>
                              <span className="text-purple-400">•</span>
                              <span>to {activity.recipient_email}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-purple-400 whitespace-nowrap flex-shrink-0">
                        {format(new Date(activity.created_at), 'dd MMM yyyy HH:mm')}
                      </span>
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
