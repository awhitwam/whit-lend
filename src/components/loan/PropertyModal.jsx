import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { Loader2, Building2, Plus, Search, Landmark } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { logPropertyEvent, logLoanPropertyEvent, AuditAction } from '@/lib/auditLog';
import FirstChargeHolderModal from './FirstChargeHolderModal';

export default function PropertyModal({
  isOpen,
  onClose,
  loan,
  existingLoanProperty,
  onSuccess
}) {
  const queryClient = useQueryClient();
  const isEdit = !!existingLoanProperty;

  const [mode, setMode] = useState('new'); // 'new' or 'existing'
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [isFirstChargeHolderModalOpen, setIsFirstChargeHolderModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    address: '',
    city: '',
    postcode: '',
    country: 'UK',
    property_type: 'Residential',
    current_value: '',
    charge_type: 'First Charge',
    first_charge_holder_id: '',
    first_charge_balance: '',
    valuation_date: format(new Date(), 'yyyy-MM-dd')
  });

  // Load existing properties for selection
  const { data: existingProperties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.entities.Property.list(),
    enabled: isOpen && mode === 'existing'
  });

  // Load first charge holders
  const { data: firstChargeHolders = [] } = useQuery({
    queryKey: ['first-charge-holders'],
    queryFn: () => api.entities.FirstChargeHolder.list(),
    enabled: isOpen
  });

  // Get already linked properties to exclude from selection
  // Use a different query key to avoid overwriting the enriched data in SecurityTab
  const { data: linkedProperties = [] } = useQuery({
    queryKey: ['loan-properties-ids', loan?.id],
    queryFn: () => api.entities.LoanProperty.filter({ loan_id: loan.id, status: 'Active' }),
    enabled: isOpen && !!loan?.id && mode === 'existing'
  });

  const linkedPropertyIds = linkedProperties.map(lp => lp.property_id);
  const availableProperties = existingProperties.filter(p => !linkedPropertyIds.includes(p.id));

  // Pre-fill form if editing
  useEffect(() => {
    if (existingLoanProperty?.property) {
      setFormData({
        address: existingLoanProperty.property.address || '',
        city: existingLoanProperty.property.city || '',
        postcode: existingLoanProperty.property.postcode || '',
        country: existingLoanProperty.property.country || 'UK',
        property_type: existingLoanProperty.property.property_type || 'Residential',
        current_value: existingLoanProperty.property.current_value || '',
        charge_type: existingLoanProperty.charge_type || 'First Charge',
        first_charge_holder_id: existingLoanProperty.first_charge_holder_id || '',
        first_charge_balance: existingLoanProperty.first_charge_balance || '',
        valuation_date: format(new Date(), 'yyyy-MM-dd')
      });
    } else {
      // Reset form for new property
      setFormData({
        address: '',
        city: '',
        postcode: '',
        country: 'UK',
        property_type: 'Residential',
        current_value: '',
        charge_type: 'First Charge',
        first_charge_holder_id: '',
        first_charge_balance: '',
        valuation_date: format(new Date(), 'yyyy-MM-dd')
      });
      setSelectedPropertyId('');
      setMode('new');
    }
  }, [existingLoanProperty, isOpen]);

  const createPropertyMutation = useMutation({
    mutationFn: async () => {
      let propertyId = selectedPropertyId;
      let property = null;

      if (mode === 'new' || isEdit) {
        // Create or update property
        const propertyData = {
          address: formData.address,
          city: formData.city,
          postcode: formData.postcode,
          country: formData.country,
          property_type: formData.property_type,
          current_value: parseFloat(formData.current_value) || 0
        };

        if (isEdit && existingLoanProperty?.property_id) {
          const oldValue = existingLoanProperty.property?.current_value;
          const newValue = parseFloat(formData.current_value) || 0;

          property = await api.entities.Property.update(existingLoanProperty.property_id, propertyData);
          propertyId = existingLoanProperty.property_id;

          // If the value changed, create a new valuation history record
          if (oldValue !== newValue) {
            await api.entities.ValueHistory.create({
              property_id: propertyId,
              value_type: 'Property Valuation',
              value: newValue,
              effective_date: formData.valuation_date || format(new Date(), 'yyyy-MM-dd'),
              notes: 'Updated via property edit'
            });
          }

          await logPropertyEvent(AuditAction.PROPERTY_UPDATE, property);
        } else {
          property = await api.entities.Property.create(propertyData);
          propertyId = property.id;

          // Create initial valuation record
          await api.entities.ValueHistory.create({
            property_id: propertyId,
            value_type: 'Property Valuation',
            value: parseFloat(formData.current_value) || 0,
            effective_date: formData.valuation_date || format(new Date(), 'yyyy-MM-dd'),
            notes: 'Initial valuation'
          });

          await logPropertyEvent(AuditAction.PROPERTY_CREATE, property);
        }
      } else {
        // Using existing property
        property = existingProperties.find(p => p.id === selectedPropertyId);
      }

      // Create or update loan-property link
      const loanPropertyData = {
        loan_id: loan.id,
        property_id: propertyId,
        charge_type: formData.charge_type,
        first_charge_holder_id: formData.charge_type === 'Second Charge'
          ? formData.first_charge_holder_id || null
          : null,
        first_charge_balance: formData.charge_type === 'Second Charge'
          ? parseFloat(formData.first_charge_balance) || 0
          : null,
        status: 'Active'
      };

      let loanProperty;
      if (isEdit && existingLoanProperty?.id) {
        loanProperty = await api.entities.LoanProperty.update(existingLoanProperty.id, loanPropertyData);
      } else {
        loanProperty = await api.entities.LoanProperty.create(loanPropertyData);
        await logLoanPropertyEvent(AuditAction.LOAN_PROPERTY_LINK, loanProperty, loan, property);
      }

      // Handle first charge balance history for second charges
      if (formData.charge_type === 'Second Charge' && formData.first_charge_balance) {
        const newBalance = parseFloat(formData.first_charge_balance);
        const oldBalance = existingLoanProperty?.first_charge_balance;

        // Create history record if this is new or the balance changed
        if (!isEdit || oldBalance !== newBalance) {
          await api.entities.ValueHistory.create({
            property_id: propertyId,
            loan_property_id: loanProperty.id,
            value_type: 'First Charge Balance',
            value: newBalance,
            effective_date: formData.valuation_date || format(new Date(), 'yyyy-MM-dd'),
            notes: isEdit ? 'Updated via property edit' : 'Initial first charge balance'
          });
        }
      }

      return { property, loanProperty };
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Property updated' : 'Property added');
      queryClient.invalidateQueries({ queryKey: ['loan-properties', loan.id] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      onSuccess?.();
      onClose();
    },
    onError: (error) => {
      toast.error('Failed to save property: ' + error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createPropertyMutation.mutate();
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isFormValid = () => {
    if (mode === 'existing' && !isEdit) {
      return !!selectedPropertyId;
    }
    return formData.address && formData.current_value;
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              {isEdit ? 'Edit Property' : 'Add Property Security'}
            </DialogTitle>
            <DialogDescription>
              {isEdit ? 'Update property details and charge information.' : 'Add a property as security for this loan.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isEdit && (
              <Tabs value={mode} onValueChange={setMode}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="new">
                    <Plus className="w-4 h-4 mr-2" />
                    New Property
                  </TabsTrigger>
                  <TabsTrigger value="existing">
                    <Search className="w-4 h-4 mr-2" />
                    Existing Property
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="existing" className="mt-4">
                  {availableProperties.length === 0 ? (
                    <div className="text-center py-6 text-slate-500 bg-slate-50 rounded-lg">
                      <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-sm">No other properties available</p>
                      <p className="text-xs">Create a new property instead</p>
                    </div>
                  ) : (
                    <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select existing property..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableProperties.map(prop => (
                          <SelectItem key={prop.id} value={prop.id}>
                            {prop.address}, {prop.city} - {prop.property_type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {(mode === 'new' || isEdit) && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="address">Address *</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="123 High Street"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                      placeholder="London"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postcode">Postcode</Label>
                    <Input
                      id="postcode"
                      value={formData.postcode}
                      onChange={(e) => handleChange('postcode', e.target.value)}
                      placeholder="SW1A 1AA"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="property_type">Property Type *</Label>
                    <Select
                      value={formData.property_type}
                      onValueChange={(v) => handleChange('property_type', v)}
                    >
                      <SelectTrigger id="property_type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Residential">Residential</SelectItem>
                        <SelectItem value="Commercial">Commercial</SelectItem>
                        <SelectItem value="Land">Land</SelectItem>
                        <SelectItem value="Mixed Use">Mixed Use</SelectItem>
                        <SelectItem value="Development Build">Development Build</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="current_value">Current Value *</Label>
                    <Input
                      id="current_value"
                      type="number"
                      value={formData.current_value}
                      onChange={(e) => handleChange('current_value', e.target.value)}
                      placeholder="250000"
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="valuation_date">Valuation Date</Label>
                  <Input
                    id="valuation_date"
                    type="date"
                    value={formData.valuation_date}
                    onChange={(e) => handleChange('valuation_date', e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Charge Type Section */}
            <Card className="border-slate-200">
              <CardContent className="p-4">
                <Label className="mb-3 block">Charge Type *</Label>
                <RadioGroup
                  value={formData.charge_type}
                  onValueChange={(v) => handleChange('charge_type', v)}
                  className="grid grid-cols-2 gap-4"
                >
                  <div className={`flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    formData.charge_type === 'First Charge' ? 'border-emerald-400 bg-emerald-50' : 'hover:bg-slate-50'
                  }`}>
                    <RadioGroupItem value="First Charge" id="first" />
                    <Label htmlFor="first" className="cursor-pointer font-medium">First Charge</Label>
                  </div>
                  <div className={`flex items-center space-x-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    formData.charge_type === 'Second Charge' ? 'border-amber-400 bg-amber-50' : 'hover:bg-slate-50'
                  }`}>
                    <RadioGroupItem value="Second Charge" id="second" />
                    <Label htmlFor="second" className="cursor-pointer font-medium">Second Charge</Label>
                  </div>
                </RadioGroup>

                {formData.charge_type === 'Second Charge' && (
                  <div className="mt-4 space-y-4 pt-4 border-t">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="first_charge_holder">First Charge Holder</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsFirstChargeHolderModalOpen(true)}
                          className="text-xs h-7"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add New
                        </Button>
                      </div>
                      <Select
                        value={formData.first_charge_holder_id}
                        onValueChange={(v) => handleChange('first_charge_holder_id', v)}
                      >
                        <SelectTrigger id="first_charge_holder">
                          <SelectValue placeholder="Select lender..." />
                        </SelectTrigger>
                        <SelectContent>
                          {firstChargeHolders.map(holder => (
                            <SelectItem key={holder.id} value={holder.id}>
                              <div className="flex items-center gap-2">
                                <Landmark className="w-4 h-4 text-slate-400" />
                                {holder.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="first_charge_balance">First Charge Balance</Label>
                      <Input
                        id="first_charge_balance"
                        type="number"
                        value={formData.first_charge_balance}
                        onChange={(e) => handleChange('first_charge_balance', e.target.value)}
                        placeholder="150000"
                        step="0.01"
                        min="0"
                      />
                      <p className="text-xs text-slate-500">
                        The outstanding balance on the first charge
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createPropertyMutation.isPending || !isFormValid()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {createPropertyMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {isEdit ? 'Update Property' : 'Add Property'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <FirstChargeHolderModal
        isOpen={isFirstChargeHolderModalOpen}
        onClose={() => setIsFirstChargeHolderModalOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['first-charge-holders'] });
        }}
      />
    </>
  );
}
