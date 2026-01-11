import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useOrganization } from '@/lib/OrganizationContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Loader2, Mail, CheckCircle, User } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

export default function InviteUserDialog({ open, onClose }) {
  const { currentOrganization } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Viewer');

  const inviteMutation = useMutation({
    mutationFn: async ({ fullName, email, role }) => {
      // Call the invite-user Edge Function
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          full_name: fullName.trim(),
          email: email.toLowerCase().trim(),
          role,
          organization_id: currentOrganization.id
        }
      });

      // Handle edge function errors - check both error object and data.error
      if (error) {
        // Try to extract error message from response body if available
        const errorMessage = error.context?.body
          ? (typeof error.context.body === 'string' ? JSON.parse(error.context.body)?.error : error.context.body?.error)
          : error.message;
        throw new Error(errorMessage || 'Failed to send invitation');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return { ...data, email: email.toLowerCase().trim() };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ['members', currentOrganization?.id]
      });

      if (result.existingUser) {
        // User already existed and was added directly
        toast.success('User added!', {
          description: `${result.email} has been added to ${currentOrganization.name}`,
          icon: <CheckCircle className="w-4 h-4 text-green-500" />
        });
      } else {
        // New user - invitation email sent
        toast.success('Invitation sent!', {
          description: `An email invitation has been sent to ${result.email}`,
          icon: <Mail className="w-4 h-4 text-blue-500" />
        });
      }

      setFullName('');
      setEmail('');
      setRole('Viewer');
      onClose();
    },
    onError: (error) => {
      console.error('Error sending invitation:', error);
      toast.error('Failed to send invitation', {
        description: error.message
      });
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!fullName.trim()) {
      toast.error('Please enter the user\'s full name');
      return;
    }

    if (!email || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    inviteMutation.mutate({ fullName, email, role });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User to {currentOrganization?.name}</DialogTitle>
          <DialogDescription>
            Send an email invitation to join your organization. If the user already has an account, they will be added immediately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Smith"
                className="pl-10"
                required
                disabled={inviteMutation.isPending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="pl-10"
                required
                disabled={inviteMutation.isPending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select value={role} onValueChange={setRole} disabled={inviteMutation.isPending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Viewer">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Viewer</span>
                    <span className="text-xs text-slate-500">Can view all data</span>
                  </div>
                </SelectItem>
                <SelectItem value="Manager">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Manager</span>
                    <span className="text-xs text-slate-500">Can create and edit</span>
                  </div>
                </SelectItem>
                <SelectItem value="Admin">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Admin</span>
                    <span className="text-xs text-slate-500">Full control</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={inviteMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Send Invitation
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
