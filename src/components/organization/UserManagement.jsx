import { useState } from 'react';
import { base44 } from '@/api/base44Client';
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
import { UserPlus, Trash2, Loader2, Shield } from 'lucide-react';
import InviteUserDialog from './InviteUserDialog';
import { toast } from 'sonner';

export default function UserManagement() {
  const { currentOrganization, canAdmin } = useOrganization();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState(null);
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
      return base44.entities.OrganizationMember.update(memberId, { role });
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
      return base44.entities.OrganizationMember.update(memberId, {
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
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isLastAdmin = member.role === 'Admin' && adminCount === 1;

                  return (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.email}</TableCell>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setMemberToRemove(member)}
                          disabled={isLastAdmin || removeMemberMutation.isPending}
                          title={isLastAdmin ? 'Cannot remove the last admin' : 'Remove member'}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
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
    </>
  );
}
