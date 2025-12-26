import { useState } from 'react';
import { api } from '@/api/dataClient';
import { supabase } from '@/lib/supabaseClient';
import { useOrganization } from '@/lib/OrganizationContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CreateOrganizationDialog({ open, onClose }) {
  const { refreshOrganizations } = useOrganization();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: ''
  });

  const createOrgMutation = useMutation({
    mutationFn: async (orgData) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create organization
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({
          name: orgData.name,
          slug: orgData.slug,
          description: orgData.description || null,
          created_by: user.id
        })
        .select()
        .single();

      if (orgError) throw orgError;

      // Add current user as admin
      const { error: memberError } = await supabase
        .from('organization_members')
        .insert({
          organization_id: org.id,
          user_id: user.id,
          role: 'Admin',
          is_active: true
        });

      if (memberError) throw memberError;

      return org;
    },
    onSuccess: () => {
      toast.success('Organization created successfully');
      refreshOrganizations();
      setFormData({ name: '', slug: '', description: '' });
      onClose();
    },
    onError: (error) => {
      console.error('Error creating organization:', error);

      // Handle duplicate slug error specifically
      if (error.code === '23505' && error.message.includes('slug')) {
        toast.error('Organization slug already exists', {
          description: 'Please choose a different name or modify the slug'
        });
      } else {
        toast.error('Failed to create organization', {
          description: error.message
        });
      }
    }
  });

  const handleNameChange = (name) => {
    setFormData(prev => ({
      ...prev,
      name,
      // Auto-generate slug from name if slug hasn't been manually edited
      slug: name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    if (!formData.slug.trim()) {
      toast.error('Organization slug is required');
      return;
    }

    createOrgMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
            <DialogDescription>
              Create a new organization to manage loans, borrowers, and team members separately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name *</Label>
              <Input
                id="name"
                placeholder="e.g., ABC Lending Company"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={createOrgMutation.isPending}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">URL Slug *</Label>
              <Input
                id="slug"
                placeholder="e.g., abc-lending-company"
                value={formData.slug}
                onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                disabled={createOrgMutation.isPending}
                required
              />
              <p className="text-xs text-slate-500">
                Used for URLs and identification. Letters, numbers, and hyphens only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of this organization (optional)"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                disabled={createOrgMutation.isPending}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={createOrgMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createOrgMutation.isPending}>
              {createOrgMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Create Organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
