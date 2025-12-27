import { useState } from 'react';
import { api } from '@/api/dataClient';
import { supabase } from '@/lib/supabaseClient';
import { useOrganization } from '@/lib/OrganizationContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
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
import { UserPlus, Trash2, Loader2, Shield, Edit } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import InviteUserDialog from './InviteUserDialog';
import { toast } from 'sonner';

export default function UserManagement() {
  const { currentOrganization, canAdmin } = useOrganization();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState(null);
  const [memberToEdit, setMemberToEdit] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '' });
  const queryClient = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['organization-members', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from('organization_members')
        .select(`
          id,
          role,
          joined_at,
          is_active,
          user_id
        `)
        .eq('organization_id', currentOrganization.id)
        .eq('is_active', true)
        .order('joined_at', { ascending: false });

      if (error) throw error;

      // Fetch user data from user_profiles
      const userIds = data.map(m => m.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, full_name, email')
        .in('id', userIds);

      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
      }

      // Map profiles to members
      const profilesMap = profiles?.reduce((acc, profile) => {
        acc[profile.id] = profile;
        return acc;
      }, {}) || {};

      return data.map(member => ({
        ...member,
        full_name: profilesMap[member.user_id]?.full_name || null,
        email: profilesMap[member.user_id]?.email || 'Unknown'
      }));
    },
    enabled: !!currentOrganization
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }) => {
      return api.entities.OrganizationMember.update(memberId, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['organization-members', currentOrganization?.id]
      });
      toast.success('Role updated successfully');
    },
    onError: (error) => {
      console.error('Error updating role:', error);
      toast.error('Failed to update role', {
        description: error.message
      });
    }
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId) => {
      return api.entities.OrganizationMember.update(memberId, {
        is_active: false
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['organization-members', currentOrganization?.id]
      });
      toast.success('Member removed from organization');
      setMemberToRemove(null);
    },
    onError: (error) => {
      console.error('Error removing member:', error);
      toast.error('Failed to remove member', {
        description: error.message
      });
    }
  });

  const updateProfileMutation = useMutation({
    mutationFn: async ({ userId, data }) => {
      const { error } = await supabase
        .from('user_profiles')
        .update(data)
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['organization-members', currentOrganization?.id]
      });
      toast.success('Member updated successfully');
      setMemberToEdit(null);
    },
    onError: (error) => {
      console.error('Error updating member:', error);
      toast.error('Failed to update member', {
        description: error.message
      });
    }
  });

  const handleEditMember = (member) => {
    setMemberToEdit(member);
    setEditForm({ full_name: member.full_name || '' });
  };

  const handleSaveEdit = () => {
    if (!memberToEdit) return;
    updateProfileMutation.mutate({
      userId: memberToEdit.user_id,
      data: { full_name: editForm.full_name }
    });
  };

  if (!canAdmin()) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-slate-500">
            <Shield className="w-5 h-5" />
            <p>You don't have permission to manage users.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const adminCount = members.filter(m => m.role === 'Admin').length;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                Manage your organization's team members and their roles
              </CardDescription>
            </div>
            <Button onClick={() => setIsInviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Invite User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <p>No team members yet</p>
              <p className="text-sm mt-1">Invite users to get started</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isLastAdmin = member.role === 'Admin' && adminCount === 1;

                  return (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        {member.full_name || <span className="text-slate-400 italic">Not set</span>}
                      </TableCell>
                      <TableCell className="text-slate-600">{member.email}</TableCell>
                      <TableCell>
                        <Select
                          value={member.role}
                          onValueChange={(role) =>
                            updateRoleMutation.mutate({
                              memberId: member.id,
                              role
                            })
                          }
                          disabled={isLastAdmin || updateRoleMutation.isPending}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Viewer">Viewer</SelectItem>
                            <SelectItem value="Manager">Manager</SelectItem>
                            <SelectItem value="Admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {new Date(member.joined_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditMember(member)}
                            title="Edit member"
                          >
                            <Edit className="w-4 h-4 text-slate-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setMemberToRemove(member)}
                            disabled={isLastAdmin || removeMemberMutation.isPending}
                            title={isLastAdmin ? 'Cannot remove the last admin' : 'Remove member'}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InviteUserDialog
        open={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
      />

      <AlertDialog open={!!memberToRemove} onOpenChange={() => setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{memberToRemove?.email}</strong> from {currentOrganization?.name}?
              They will lose access to all organization data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMemberMutation.mutate(memberToRemove.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!memberToEdit} onOpenChange={() => setMemberToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              Update details for {memberToEdit?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                placeholder="Enter full name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-500">Email</Label>
              <Input
                value={memberToEdit?.email || ''}
                disabled
                className="bg-slate-50"
              />
              <p className="text-xs text-slate-500">Email cannot be changed</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberToEdit(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateProfileMutation.isPending}
            >
              {updateProfileMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
