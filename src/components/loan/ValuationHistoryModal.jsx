import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { Loader2, History, Plus, TrendingUp, TrendingDown, Building2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatCurrency } from './LoanCalculator';
import { logAudit, AuditAction, EntityType } from '@/lib/auditLog';

export default function ValuationHistoryModal({
  isOpen,
  onClose,
  loanProperty,
  initialShowAddForm = false,
  onSuccess
}) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(initialShowAddForm);
  const [editingValuation, setEditingValuation] = useState(null); // Track which valuation is being edited

  // Sync showAddForm when initialShowAddForm prop changes (e.g., opening via "Update Valuation")
  useEffect(() => {
    setShowAddForm(initialShowAddForm);
    setEditingValuation(null); // Reset editing state when modal opens
  }, [initialShowAddForm]);

  const [newValuation, setNewValuation] = useState({
    value_type: 'Property Valuation',
    value: '',
    effective_date: format(new Date(), 'yyyy-MM-dd'),
    notes: ''
  });

  const { data: valuations = [], isLoading } = useQuery({
    queryKey: ['value-history', loanProperty?.property_id],
    queryFn: () => api.entities.ValueHistory.filter(
      { property_id: loanProperty.property_id },
      '-effective_date'
    ),
    enabled: !!loanProperty?.property_id && isOpen
  });

  const addValuationMutation = useMutation({
    mutationFn: async () => {
      const valuationData = {
        property_id: loanProperty.property_id,
        loan_property_id: loanProperty.id,
        value_type: newValuation.value_type,
        value: parseFloat(newValuation.value),
        effective_date: newValuation.effective_date,
        notes: newValuation.notes
      };

      const created = await api.entities.ValueHistory.create(valuationData);

      // Update property current_value if this is a property valuation
      if (newValuation.value_type === 'Property Valuation') {
        await api.entities.Property.update(loanProperty.property_id, {
          current_value: parseFloat(newValuation.value)
        });
      }

      // Update first charge balance if this is a balance update
      if (newValuation.value_type === 'First Charge Balance') {
        await api.entities.LoanProperty.update(loanProperty.id, {
          first_charge_balance: parseFloat(newValuation.value)
        });
      }

      // Log audit event
      await logAudit({
        action: AuditAction.VALUATION_CREATE,
        entityType: EntityType.VALUATION,
        entityId: created.id,
        entityName: `${newValuation.value_type}: ${formatCurrency(parseFloat(newValuation.value))}`,
        details: {
          property_id: loanProperty.property_id,
          value_type: newValuation.value_type,
          value: parseFloat(newValuation.value)
        }
      });

      return created;
    },
    onSuccess: () => {
      toast.success('Valuation added');
      setShowAddForm(false);
      setNewValuation({
        value_type: 'Property Valuation',
        value: '',
        effective_date: format(new Date(), 'yyyy-MM-dd'),
        notes: ''
      });
      queryClient.invalidateQueries({ queryKey: ['value-history', loanProperty?.property_id] });
      queryClient.invalidateQueries({ queryKey: ['loan-properties'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      onSuccess?.();
    },
    onError: (error) => {
      toast.error('Failed to add valuation: ' + error.message);
    }
  });

  // Update existing valuation mutation
  const updateValuationMutation = useMutation({
    mutationFn: async () => {
      const valuationData = {
        value: parseFloat(newValuation.value),
        effective_date: newValuation.effective_date,
        notes: newValuation.notes
      };

      await api.entities.ValueHistory.update(editingValuation.id, valuationData);

      // Update property current_value if this is the most recent property valuation
      if (editingValuation.value_type === 'Property Valuation') {
        const allPropertyValuations = valuations.filter(v => v.value_type === 'Property Valuation');
        const isLatest = allPropertyValuations[0]?.id === editingValuation.id;
        if (isLatest) {
          await api.entities.Property.update(loanProperty.property_id, {
            current_value: parseFloat(newValuation.value)
          });
        }
      }

      // Update first charge balance if this is the most recent balance update
      if (editingValuation.value_type === 'First Charge Balance') {
        const allBalanceHistory = valuations.filter(v => v.value_type === 'First Charge Balance');
        const isLatest = allBalanceHistory[0]?.id === editingValuation.id;
        if (isLatest) {
          await api.entities.LoanProperty.update(loanProperty.id, {
            first_charge_balance: parseFloat(newValuation.value)
          });
        }
      }

      // Log audit event
      await logAudit({
        action: AuditAction.VALUATION_UPDATE,
        entityType: EntityType.VALUATION,
        entityId: editingValuation.id,
        entityName: `${editingValuation.value_type}: ${formatCurrency(parseFloat(newValuation.value))}`,
        details: {
          property_id: loanProperty.property_id,
          value_type: editingValuation.value_type,
          old_value: editingValuation.value,
          new_value: parseFloat(newValuation.value)
        }
      });

      return editingValuation;
    },
    onSuccess: () => {
      toast.success('Valuation updated');
      cancelEdit();
      queryClient.invalidateQueries({ queryKey: ['value-history', loanProperty?.property_id] });
      queryClient.invalidateQueries({ queryKey: ['loan-properties'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      onSuccess?.();
    },
    onError: (error) => {
      toast.error('Failed to update valuation: ' + error.message);
    }
  });

  // Group valuations by type
  const propertyValuations = valuations.filter(v => v.value_type === 'Property Valuation');
  const balanceHistory = valuations.filter(v => v.value_type === 'First Charge Balance');

  // Start editing a valuation
  const startEdit = (valuation) => {
    setEditingValuation(valuation);
    setNewValuation({
      value_type: valuation.value_type,
      value: valuation.value.toString(),
      effective_date: valuation.effective_date,
      notes: valuation.notes || ''
    });
    setShowAddForm(false); // Hide add form if open
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingValuation(null);
    setNewValuation({
      value_type: 'Property Valuation',
      value: '',
      effective_date: format(new Date(), 'yyyy-MM-dd'),
      notes: ''
    });
  };

  const resetAndClose = () => {
    setShowAddForm(false);
    setEditingValuation(null);
    setNewValuation({
      value_type: 'Property Valuation',
      value: '',
      effective_date: format(new Date(), 'yyyy-MM-dd'),
      notes: ''
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            Valuation History
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            <Building2 className="w-4 h-4" />
            {loanProperty?.property?.address || 'View and add property valuations'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Add Valuation Button */}
          {!showAddForm && !editingValuation && (
            <Button
              onClick={() => setShowAddForm(true)}
              className="w-full"
              variant="outline"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Valuation
            </Button>
          )}

          {/* Add/Edit Valuation Form */}
          {(showAddForm || editingValuation) && (
            <Card className={editingValuation ? "border-amber-200 bg-amber-50/50" : "border-blue-200 bg-blue-50/50"}>
              <CardContent className="p-4 space-y-4">
                <div className="text-sm font-medium text-slate-700">
                  {editingValuation ? 'Edit Valuation' : 'Add New Valuation'}
                </div>

                {/* Type selector - only show for new valuations */}
                {!editingValuation && (
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={newValuation.value_type}
                      onValueChange={(v) => setNewValuation(prev => ({...prev, value_type: v}))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Property Valuation">Property Valuation</SelectItem>
                        {loanProperty?.charge_type === 'Second Charge' && (
                          <SelectItem value="First Charge Balance">First Charge Balance</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Show type as read-only when editing */}
                {editingValuation && (
                  <div className="text-xs text-slate-500">
                    Type: {editingValuation.value_type}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Value</Label>
                    <Input
                      type="number"
                      value={newValuation.value}
                      onChange={(e) => setNewValuation(prev => ({...prev, value: e.target.value}))}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Effective Date</Label>
                    <Input
                      type="date"
                      value={newValuation.effective_date}
                      onChange={(e) => setNewValuation(prev => ({...prev, effective_date: e.target.value}))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={newValuation.notes}
                    onChange={(e) => setNewValuation(prev => ({...prev, notes: e.target.value}))}
                    placeholder="Valuation source, surveyor name, etc."
                    rows={2}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => editingValuation ? cancelEdit() : setShowAddForm(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => editingValuation ? updateValuationMutation.mutate() : addValuationMutation.mutate()}
                    disabled={!newValuation.value || addValuationMutation.isPending || updateValuationMutation.isPending}
                    className={`flex-1 ${editingValuation ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {(addValuationMutation.isPending || updateValuationMutation.isPending) && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    {editingValuation ? 'Update' : 'Save'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Property Valuations */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Property Valuations</h3>
            {isLoading ? (
              <div className="animate-pulse h-20 bg-slate-100 rounded-lg" />
            ) : propertyValuations.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center bg-slate-50 rounded-lg">
                No valuations recorded
              </p>
            ) : (
              <div className="space-y-2">
                {propertyValuations.map((val, idx) => {
                  const prevVal = propertyValuations[idx + 1]?.value;
                  const change = prevVal ? ((val.value - prevVal) / prevVal) * 100 : null;

                  return (
                    <div key={val.id} className="p-3 bg-white border rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-lg">{formatCurrency(val.value)}</p>
                          <p className="text-xs text-slate-500">
                            {format(new Date(val.effective_date), 'dd MMM yyyy')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {change !== null && (
                            <Badge className={change >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
                              {change >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                              {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(val)}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      {val.notes && (
                        <p className="text-xs text-slate-500 mt-2">{val.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* First Charge Balance History (for second charges) */}
          {loanProperty?.charge_type === 'Second Charge' && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">First Charge Balance History</h3>
              {balanceHistory.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center bg-amber-50 rounded-lg border border-amber-200">
                  No balance history recorded
                </p>
              ) : (
                <div className="space-y-2">
                  {balanceHistory.map((val, idx) => {
                    const prevVal = balanceHistory[idx + 1]?.value;
                    const change = prevVal ? val.value - prevVal : null;

                    return (
                      <div key={val.id} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold">{formatCurrency(val.value)}</p>
                            <p className="text-xs text-slate-500">
                              {format(new Date(val.effective_date), 'dd MMM yyyy')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {change !== null && (
                              <Badge className={change <= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
                                {change <= 0 ? <TrendingDown className="w-3 h-3 mr-1" /> : <TrendingUp className="w-3 h-3 mr-1" />}
                                {change >= 0 ? '+' : ''}{formatCurrency(change)}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEdit(val)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                        {val.notes && (
                          <p className="text-xs text-slate-500 mt-2">{val.notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
