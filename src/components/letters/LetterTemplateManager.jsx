import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  Copy,
  Loader2,
  Paperclip,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/dataClient';

export default function LetterTemplateManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['letter-templates'],
    queryFn: () => api.entities.LetterTemplate.list('name')
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.LetterTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['letter-templates'] });
      toast.success('Template deleted');
    },
    onError: (err) => {
      toast.error('Failed to delete template: ' + err.message);
    }
  });

  const handleEdit = (template) => {
    navigate(`/LetterTemplateEditor?id=${template.id}`);
  };

  const handleNew = () => {
    navigate('/LetterTemplateEditor');
  };

  const handleDuplicate = async (template) => {
    try {
      await api.entities.LetterTemplate.create({
        name: `${template.name} (Copy)`,
        description: template.description || '',
        category: template.category || 'General',
        subject_template: template.subject_template || '',
        body_template: template.body_template || '',
        default_attachments: template.default_attachments || [],
        is_active: true
      });
      queryClient.invalidateQueries({ queryKey: ['letter-templates'] });
      toast.success('Template duplicated');
    } catch (err) {
      toast.error('Failed to duplicate template: ' + err.message);
    }
  };

  const handleDelete = (template) => {
    if (confirm(`Are you sure you want to delete "${template.name}"?`)) {
      deleteMutation.mutate(template.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-end">
        <Button onClick={handleNew}>
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      {/* Templates List */}
      {templates.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No letter templates yet. Create your first template to get started.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map(template => (
            <Card key={template.id} className={template.is_active === false ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-base">{template.name}</CardTitle>
                  </div>
                  {template.is_active === false && (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {template.description && (
                  <p className="text-sm text-slate-600">{template.description}</p>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{template.category || 'General'}</Badge>
                  {template.default_attachments?.length > 0 && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Paperclip className="w-3 h-3" />
                      {template.default_attachments.length}
                    </Badge>
                  )}
                </div>

                {/* Preview of body */}
                <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded line-clamp-2">
                  {template.body_template?.slice(0, 100)}...
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(template)}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDuplicate(template)}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => handleDelete(template)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
