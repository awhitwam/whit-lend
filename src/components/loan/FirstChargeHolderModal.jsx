import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { Loader2, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';

export default function FirstChargeHolderModal({
  isOpen,
  onClose,
  existingHolder,
  onSuccess
}) {
  const queryClient = useQueryClient();
  const isEdit = !!existingHolder;

  const [formData, setFormData] = useState({
    name: '',
    contact_email: '',
    contact_phone: ''
  });

  // Pre-fill form when editing
  useEffect(() => {
    if (existingHolder) {
      setFormData({
        name: existingHolder.name || '',
        contact_email: existingHolder.contact_email || '',
        contact_phone: existingHolder.contact_phone || ''
      });
    } else {
      setFormData({
        name: '',
        contact_email: '',
        contact_phone: ''
      });
    }
  }, [existingHolder, isOpen]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const updated = await api.entities.FirstChargeHolder.update(existingHolder.id, formData);
        await logAudit({
          action: AuditAction.FIRST_CHARGE_HOLDER_UPDATE,
          entityType: EntityType.FIRST_CHARGE_HOLDER,
          entityId: existingHolder.id,
          entityName: formData.name
        });
        return updated;
      } else {
        const created = await api.entities.FirstChargeHolder.create(formData);
        await logAudit({
          action: AuditAction.FIRST_CHARGE_HOLDER_CREATE,
          entityType: EntityType.FIRST_CHARGE_HOLDER,
          entityId: created.id,
          entityName: formData.name
        });
        return created;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Lender updated' : 'Lender added');
      queryClient.invalidateQueries({ queryKey: ['first-charge-holders'] });
      onSuccess?.();
      onClose();
    },
    onError: (error) => {
      toast.error('Failed to save lender: ' + error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-blue-600" />
            {isEdit ? 'Edit First Charge Holder' : 'Add First Charge Holder'}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update lender details.' : 'Add a lender who holds the first charge on a property.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Lender Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({...prev, name: e.target.value}))}
              placeholder="e.g., Nationwide, Barclays, NatWest"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_email">Contact Email</Label>
            <Input
              id="contact_email"
              type="email"
              value={formData.contact_email}
              onChange={(e) => setFormData(prev => ({...prev, contact_email: e.target.value}))}
              placeholder="redemptions@bank.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_phone">Contact Phone</Label>
            <Input
              id="contact_phone"
              value={formData.contact_phone}
              onChange={(e) => setFormData(prev => ({...prev, contact_phone: e.target.value}))}
              placeholder="+44 123 456 7890"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!formData.name || saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit ? 'Update' : 'Add Lender'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
