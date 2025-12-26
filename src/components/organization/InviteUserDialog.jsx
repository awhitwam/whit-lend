import { useState } from 'react';
import { api } from '@/api/dataClient';
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
import { Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

export default function InviteUserDialog({ open, onClose }) {
  const { currentOrganization } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Viewer');

  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }) => {
      // Generate secure token
      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      const invitation = await api.entities.Invitation.create({
        organization_id: currentOrganization.id,
        email: email.toLowerCase().trim(),
        role,
        invited_by: user.id,
        token,
        expires_at: expiresAt.toISOString(),
        status: 'pending'
      });

      return invitation;
    },
    onSuccess: (invitation) => {
      queryClient.invalidateQueries({
        queryKey: ['invitations', currentOrganization?.id]
      });

      // Show invitation link (in production, this would be sent via email)
      const inviteUrl = `${window.location.origin}/AcceptInvitation?token=${invitation.token}`;

      toast.success('Invitation created!', {
        description: (
          <div className="space-y-2">
            <p className="text-sm">Send this link to {invitation.email}:</p>
            <div className="bg-slate-100 p-2 rounded text-xs break-all">
              {inviteUrl}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(inviteUrl);
                toast.success('Link copied to clipboard!');
              }}
            >
              Copy Link
            </Button>
          </div>
        ),
        duration: 10000
      });

      setEmail('');
      setRole('Viewer');
      onClose();
    },
    onError: (error) => {
      console.error('Error creating invitation:', error);
      toast.error('Failed to create invitation', {
        description: error.message
      });
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }

    inviteMutation.mutate({ email, role });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User to {currentOrganization?.name}</DialogTitle>
          <DialogDescription>
            Send an invitation to join your organization. The invitation will expire in 7 days.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
