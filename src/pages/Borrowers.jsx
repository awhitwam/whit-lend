import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Users, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import BorrowerTable from '@/components/borrower/BorrowerTable';
import BorrowerForm from '@/components/borrower/BorrowerForm';
import EmptyState from '@/components/ui/EmptyState';

export default function Borrowers() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBorrower, setEditingBorrower] = useState(null);
  const queryClient = useQueryClient();

  const { data: borrowers = [], isLoading } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => base44.entities.Borrower.list('-created_date')
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Borrower.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrowers'] });
      setIsFormOpen(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Borrower.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrowers'] });
      setIsFormOpen(false);
      setEditingBorrower(null);
    }
  });

  const handleSubmit = (data) => {
    if (editingBorrower) {
      updateMutation.mutate({ id: editingBorrower.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (borrower) => {
    setEditingBorrower(borrower);
    setIsFormOpen(true);
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setEditingBorrower(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Borrowers</h1>
            <p className="text-slate-500 mt-1">Manage your borrower profiles</p>
          </div>
          <div className="flex gap-2">
            <Link to={createPageUrl('ImportBorrowers')}>
              <Button variant="outline">
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Button>
            </Link>
            <Button onClick={() => setIsFormOpen(true)} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="w-4 h-4 mr-2" />
              Add Borrower
            </Button>
          </div>
        </div>

        {/* Content */}
        {borrowers.length === 0 && !isLoading ? (
          <EmptyState
            icon={Users}
            title="No borrowers yet"
            description="Add your first borrower to start managing loans"
            action={
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Borrower
              </Button>
            }
          />
        ) : (
          <BorrowerTable 
            borrowers={borrowers} 
            onEdit={handleEdit}
            isLoading={isLoading}
          />
        )}

        {/* Form Dialog */}
        <Dialog open={isFormOpen} onOpenChange={handleClose}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingBorrower ? 'Edit Borrower' : 'Add New Borrower'}
              </DialogTitle>
            </DialogHeader>
            <BorrowerForm
              borrower={editingBorrower}
              onSubmit={handleSubmit}
              onCancel={handleClose}
              isLoading={createMutation.isPending || updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}