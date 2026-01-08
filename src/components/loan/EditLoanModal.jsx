import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle, Percent, Zap, TrendingUp, ArrowLeft, ChevronRight, X, Edit } from 'lucide-react';
import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

export default function EditLoanPanel({
  isOpen,
  onClose,
  loan,
  onSubmit,
  isLoading
}) {
  const [formData, setFormData] = useState({
    product_id: loan?.product_id || '',
    principal_amount: loan?.principal_amount || '',
    monthly_charge: loan?.monthly_charge || '',
    arrangement_fee: loan?.arrangement_fee || '',
    exit_fee: loan?.exit_fee || '',
    interest_rate: loan?.interest_rate || '',
    interest_type: loan?.interest_type || '',
    period: loan?.period || '',
    interest_only_period: loan?.interest_only_period || 0,
    duration: loan?.duration || '',
    start_date: loan?.start_date || '',
    description: loan?.description || '',
    // Interest rate override fields
    override_interest_rate: loan?.override_interest_rate || false,
    overridden_rate: loan?.overridden_rate || '',
    // Penalty rate fields
    has_penalty_rate: loan?.has_penalty_rate || false,
    penalty_rate: loan?.penalty_rate || '',
    penalty_rate_from: loan?.penalty_rate_from || '',
    // Product type tracking
    product_type: loan?.product_type || ''
  });

  // Confirmation step state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [pendingSubmitData, setPendingSubmitData] = useState(null);

  const { data: products = [] } = useQuery({
    queryKey: ['loan-products'],
    queryFn: () => api.entities.LoanProduct.list()
  });

  // Get selected product details
  const selectedProduct = products.find(p => p.id === formData.product_id);
  const isFixedCharge = selectedProduct?.product_type === 'Fixed Charge' || formData.product_type === 'Fixed Charge';
  const isIrregularIncome = selectedProduct?.product_type === 'Irregular Income' || formData.product_type === 'Irregular Income';
  const isRent = selectedProduct?.product_type === 'Rent' || formData.product_type === 'Rent';
  const isSpecialType = isFixedCharge || isIrregularIncome || isRent;

  // Detect changes between current loan and form data
  const changes = useMemo(() => {
    if (!loan) return [];
    const changeList = [];
    const formatCurrency = (val) => `£${parseFloat(val || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
    const formatDate = (val) => val ? format(new Date(val), 'dd MMM yyyy') : '-';

    // Product change
    if (formData.product_id !== loan.product_id) {
      const oldProduct = products.find(p => p.id === loan.product_id);
      const newProduct = products.find(p => p.id === formData.product_id);
      changeList.push({
        field: 'Product',
        from: oldProduct?.name || loan.product_name || '-',
        to: newProduct?.name || '-'
      });
    }

    // Principal amount
    if (parseFloat(formData.principal_amount) !== parseFloat(loan.principal_amount || 0)) {
      changeList.push({
        field: 'Principal Amount',
        from: formatCurrency(loan.principal_amount),
        to: formatCurrency(formData.principal_amount)
      });
    }

    // Monthly charge (Fixed Charge)
    if (parseFloat(formData.monthly_charge) !== parseFloat(loan.monthly_charge || 0)) {
      changeList.push({
        field: 'Monthly Charge',
        from: formatCurrency(loan.monthly_charge),
        to: formatCurrency(formData.monthly_charge)
      });
    }

    // Interest rate
    if (parseFloat(formData.interest_rate) !== parseFloat(loan.interest_rate || 0)) {
      changeList.push({
        field: 'Interest Rate',
        from: `${loan.interest_rate || 0}%`,
        to: `${formData.interest_rate || 0}%`
      });
    }

    // Interest rate override
    if (formData.override_interest_rate !== loan.override_interest_rate) {
      changeList.push({
        field: 'Interest Rate Override',
        from: loan.override_interest_rate ? 'Enabled' : 'Disabled',
        to: formData.override_interest_rate ? 'Enabled' : 'Disabled'
      });
    }

    // Overridden rate
    if (formData.override_interest_rate && parseFloat(formData.overridden_rate) !== parseFloat(loan.overridden_rate || 0)) {
      changeList.push({
        field: 'Custom Interest Rate',
        from: `${loan.overridden_rate || 0}%`,
        to: `${formData.overridden_rate || 0}%`
      });
    }

    // Duration
    if (parseInt(formData.duration) !== parseInt(loan.duration || 0)) {
      changeList.push({
        field: 'Duration',
        from: `${loan.duration || 0} periods`,
        to: `${formData.duration || 0} periods`
      });
    }

    // Start date
    if (formData.start_date !== loan.start_date) {
      changeList.push({
        field: 'Start Date',
        from: formatDate(loan.start_date),
        to: formatDate(formData.start_date)
      });
    }

    // Arrangement fee
    if (parseFloat(formData.arrangement_fee) !== parseFloat(loan.arrangement_fee || 0)) {
      changeList.push({
        field: 'Arrangement Fee',
        from: formatCurrency(loan.arrangement_fee),
        to: formatCurrency(formData.arrangement_fee)
      });
    }

    // Exit fee
    if (parseFloat(formData.exit_fee) !== parseFloat(loan.exit_fee || 0)) {
      changeList.push({
        field: 'Exit Fee',
        from: formatCurrency(loan.exit_fee),
        to: formatCurrency(formData.exit_fee)
      });
    }

    // Penalty rate enabled
    if (formData.has_penalty_rate !== loan.has_penalty_rate) {
      changeList.push({
        field: 'Penalty Rate',
        from: loan.has_penalty_rate ? 'Enabled' : 'Disabled',
        to: formData.has_penalty_rate ? 'Enabled' : 'Disabled'
      });
    }

    // Penalty rate value
    if (formData.has_penalty_rate && parseFloat(formData.penalty_rate) !== parseFloat(loan.penalty_rate || 0)) {
      changeList.push({
        field: 'Penalty Rate Value',
        from: `${loan.penalty_rate || 0}%`,
        to: `${formData.penalty_rate || 0}%`
      });
    }

    // Penalty rate from date
    if (formData.has_penalty_rate && formData.penalty_rate_from !== loan.penalty_rate_from) {
      changeList.push({
        field: 'Penalty Rate From',
        from: formatDate(loan.penalty_rate_from),
        to: formatDate(formData.penalty_rate_from)
      });
    }

    // Description
    if ((formData.description || '') !== (loan.description || '')) {
      changeList.push({
        field: 'Description',
        from: loan.description || '(empty)',
        to: formData.description || '(empty)'
      });
    }

    return changeList;
  }, [formData, loan, products]);

  // Reset confirmation state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowConfirmation(false);
      setEditReason('');
      setPendingSubmitData(null);
    }
  }, [isOpen]);

  // Build submit data based on loan type
  const buildSubmitData = () => {
    const product = products.find(p => p.id === formData.product_id);

    // Handle Fixed Charge Facility
    if (isFixedCharge) {
      const monthlyCharge = parseFloat(formData.monthly_charge) || 0;
      const duration = parseInt(formData.duration) || 0;

      return {
        product_id: formData.product_id,
        product_name: product?.name || loan.product_name,
        product_type: 'Fixed Charge',
        principal_amount: 0,
        monthly_charge: monthlyCharge,
        arrangement_fee: parseFloat(formData.arrangement_fee) || 0,
        exit_fee: parseFloat(formData.exit_fee) || 0,
        net_disbursed: 0,
        duration: duration,
        start_date: formData.start_date,
        description: formData.description,
        interest_rate: 0,
        interest_type: null,
        period: 'Monthly',
        total_interest: 0,
        total_charges: monthlyCharge * duration,
        // Clear interest-related fields
        override_interest_rate: false,
        overridden_rate: null,
        has_penalty_rate: false,
        penalty_rate: null,
        penalty_rate_from: null
      };
    }

    // Handle Irregular Income - no interest calculation
    if (isIrregularIncome) {
      return {
        product_id: formData.product_id,
        product_name: product?.name || loan.product_name,
        product_type: 'Irregular Income',
        principal_amount: parseFloat(formData.principal_amount) || 0,
        arrangement_fee: parseFloat(formData.arrangement_fee) || 0,
        exit_fee: parseFloat(formData.exit_fee) || 0,
        net_disbursed: parseFloat(formData.principal_amount) - (parseFloat(formData.arrangement_fee) || 0),
        duration: 0,
        start_date: formData.start_date,
        description: formData.description,
        // Clear interest-related fields
        interest_rate: 0,
        interest_type: null,
        period: 'Monthly',
        override_interest_rate: false,
        overridden_rate: null,
        has_penalty_rate: false,
        penalty_rate: null,
        penalty_rate_from: null
      };
    }

    // Handle Rent - no interest calculation, rent is tracked via transactions
    if (isRent) {
      return {
        product_id: formData.product_id,
        product_name: product?.name || loan.product_name,
        product_type: 'Rent',
        principal_amount: parseFloat(formData.principal_amount) || 0,
        arrangement_fee: parseFloat(formData.arrangement_fee) || 0,
        exit_fee: parseFloat(formData.exit_fee) || 0,
        net_disbursed: parseFloat(formData.principal_amount) - (parseFloat(formData.arrangement_fee) || 0),
        duration: 0,
        start_date: formData.start_date,
        description: formData.description,
        // Clear interest-related fields
        interest_rate: 0,
        interest_type: null,
        period: 'Monthly',
        override_interest_rate: false,
        overridden_rate: null,
        has_penalty_rate: false,
        penalty_rate: null,
        penalty_rate_from: null
      };
    }

    // Standard loan handling
    const effectiveRate = formData.override_interest_rate && formData.overridden_rate
      ? parseFloat(formData.overridden_rate)
      : parseFloat(formData.interest_rate);

    return {
      product_id: formData.product_id,
      product_name: product?.name || loan.product_name,
      product_type: product?.product_type || 'Standard',
      principal_amount: parseFloat(formData.principal_amount),
      arrangement_fee: parseFloat(formData.arrangement_fee) || 0,
      exit_fee: parseFloat(formData.exit_fee) || 0,
      interest_rate: effectiveRate,
      interest_type: formData.interest_type,
      period: formData.period,
      interest_only_period: parseInt(formData.interest_only_period) || 0,
      duration: parseInt(formData.duration),
      start_date: formData.start_date,
      net_disbursed: parseFloat(formData.principal_amount) - (parseFloat(formData.arrangement_fee) || 0),
      description: formData.description,
      // Interest rate override tracking
      override_interest_rate: formData.override_interest_rate,
      overridden_rate: formData.override_interest_rate ? parseFloat(formData.overridden_rate) || null : null,
      // Penalty rate fields
      has_penalty_rate: formData.has_penalty_rate,
      penalty_rate: formData.has_penalty_rate ? parseFloat(formData.penalty_rate) || null : null,
      penalty_rate_from: formData.has_penalty_rate ? formData.penalty_rate_from || null : null
    };
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // If there are meaningful changes, show confirmation
    if (changes.length > 0) {
      const submitData = buildSubmitData();
      setPendingSubmitData(submitData);
      setShowConfirmation(true);
    } else {
      // No changes, just close
      onClose();
    }
  };

  const handleConfirmSubmit = () => {
    if (pendingSubmitData) {
      // Include the edit reason in the submission
      onSubmit({
        ...pendingSubmitData,
        _editReason: editReason.trim() || null
      });
    }
  };

  const handleBackToEdit = () => {
    setShowConfirmation(false);
    setEditReason('');
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleProductChange = (productId) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      const isSpecialType = product.product_type === 'Fixed Charge' ||
                            product.product_type === 'Irregular Income' ||
                            product.product_type === 'Rent';

      setFormData(prev => ({
        ...prev,
        product_id: productId,
        product_type: product.product_type || 'Standard',
        // Clear interest-related fields for special product types
        interest_rate: isSpecialType ? 0 : (product.interest_rate || 0),
        interest_type: isSpecialType ? null : (product.interest_type || 'Simple'),
        period: product.period || 'Monthly',
        interest_only_period: isSpecialType ? 0 : (product.interest_only_period || 0),
        // For Fixed Charge, use product's monthly_charge if available
        monthly_charge: product.product_type === 'Fixed Charge' ? (product.monthly_charge || prev.monthly_charge) : prev.monthly_charge
      }));
    }
  };

  if (!isOpen || !loan) return null;

  return (
    <div className="h-full flex flex-col bg-white border-l shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-slate-50">
        <div className="flex items-center gap-2">
          <Edit className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold">
            {showConfirmation ? 'Confirm Changes' : `Edit ${isFixedCharge ? 'Facility' : isIrregularIncome ? 'Irregular Income Loan' : 'Loan'}`}
          </h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        {showConfirmation ? (
          /* Confirmation Step */
          <div className="space-y-4">
            {/* Change Summary */}
            <div className="p-4 bg-slate-50 rounded-lg border">
              <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <ChevronRight className="w-4 h-4" />
                Changes to be applied ({changes.length})
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {changes.map((change, idx) => (
                  <div key={idx} className="flex justify-between items-start text-sm py-1 border-b border-slate-100 last:border-0">
                    <span className="text-slate-600 font-medium">{change.field}</span>
                    <div className="text-right">
                      <span className="text-red-600 line-through mr-2">{change.from}</span>
                      <span className="text-emerald-600">{change.to}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Warning about schedule recalculation */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Schedule will be recalculated</p>
                <p>The repayment schedule will be regenerated and all existing payments will be reapplied.</p>
              </div>
            </div>

            {/* Reason for changes */}
            <div className="space-y-2">
              <Label htmlFor="edit-reason" className="text-sm font-medium">
                Reason for changes <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="edit-reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Please explain why these changes are being made (e.g., 'Correcting incorrect principal amount', 'Customer requested rate adjustment')"
                rows={3}
                className="resize-none"
                autoFocus
              />
              <p className="text-xs text-slate-500">
                This reason will be recorded in the audit trail for compliance purposes.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4">
              <Button type="button" variant="outline" onClick={handleBackToEdit} disabled={isLoading} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Edit
              </Button>
              <Button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={isLoading || !editReason.trim()}
                className="flex-1"
              >
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm Changes
              </Button>
            </div>
          </div>
        ) : (
          /* Edit Form Step */
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Warning</p>
                <p>Editing this {isFixedCharge ? 'facility' : 'loan'} will recalculate the repayment schedule. Existing payments will be reapplied to the new schedule.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product">Loan Product *</Label>
            <Select
              value={formData.product_id}
              onValueChange={handleProductChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select loan product" />
              </SelectTrigger>
              <SelectContent>
                {products.map(product => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} {product.product_type === 'Fixed Charge'
                      ? '(Fixed Charge)'
                      : product.product_type === 'Irregular Income'
                        ? '(Irregular Income)'
                        : product.product_type === 'Rent'
                          ? '(Rent)'
                          : `- ${product.interest_rate}% (${product.interest_type})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fixed Charge Alert */}
          {isFixedCharge && (
            <Alert className="border-purple-200 bg-purple-50">
              <Zap className="w-4 h-4 text-purple-600" />
              <AlertDescription className="text-purple-800">
                <strong>Fixed Charge Facility:</strong> A regular monthly fee the borrower pays for the benefit of having loans with you.
              </AlertDescription>
            </Alert>
          )}

          {/* Irregular Income Alert */}
          {isIrregularIncome && (
            <Alert className="border-teal-200 bg-teal-50">
              <TrendingUp className="w-4 h-4 text-teal-600" />
              <AlertDescription className="text-teal-800">
                <strong>Irregular Income Loan:</strong> For borrowers with unpredictable income. Interest accrues daily, no fixed schedule.
              </AlertDescription>
            </Alert>
          )}

          {/* Fixed Charge: Monthly Charge instead of Principal */}
          {isFixedCharge ? (
            <div className="space-y-2">
              <Label htmlFor="monthly_charge">Monthly Charge Amount *</Label>
              <Input
                id="monthly_charge"
                type="number"
                value={formData.monthly_charge}
                onChange={(e) => handleChange('monthly_charge', e.target.value)}
                placeholder="Enter monthly charge"
                min={0}
                step="0.01"
                required
              />
            </div>
          ) : (
            /* Standard and Irregular Income: Principal Amount */
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="principal_amount">Principal Amount *</Label>
                <Input
                  id="principal_amount"
                  type="number"
                  value={formData.principal_amount}
                  onChange={(e) => handleChange('principal_amount', e.target.value)}
                  step="0.01"
                  required
                />
              </div>

              {/* Interest Rate - only for standard loans */}
              {!isSpecialType && (
                <div className="space-y-2">
                  <Label htmlFor="interest_rate">
                    Product Rate (%)
                    {formData.override_interest_rate && <span className="text-slate-400 ml-1">(overridden)</span>}
                  </Label>
                  <Input
                    id="interest_rate"
                    type="number"
                    value={formData.interest_rate}
                    onChange={(e) => handleChange('interest_rate', e.target.value)}
                    step="0.01"
                    disabled={formData.override_interest_rate}
                    className={formData.override_interest_rate ? 'bg-slate-100 text-slate-500' : ''}
                  />
                </div>
              )}
            </div>
          )}

          {/* Interest Rate Override Section - only for standard loans */}
          {!isFixedCharge && (
            <div className="p-4 border border-slate-200 rounded-lg space-y-4 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Percent className="w-4 h-4 text-blue-600" />
                  <Label htmlFor="override_interest_rate" className="font-medium cursor-pointer">
                    Override Interest Rate
                  </Label>
                </div>
                <Switch
                  id="override_interest_rate"
                  checked={formData.override_interest_rate}
                  onCheckedChange={(checked) => handleChange('override_interest_rate', checked)}
                />
              </div>

              {formData.override_interest_rate && (
                <div className="space-y-2">
                  <Label htmlFor="overridden_rate">Custom Interest Rate (%) *</Label>
                  <Input
                    id="overridden_rate"
                    type="number"
                    value={formData.overridden_rate}
                    onChange={(e) => handleChange('overridden_rate', e.target.value)}
                    step="0.01"
                    placeholder="Enter custom rate"
                    className="bg-white"
                    required={formData.override_interest_rate}
                  />
                  <p className="text-xs text-slate-500">
                    This rate will be used instead of the product's default rate
                  </p>
                </div>
              )}

              {/* Penalty Rate Section */}
              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <Label htmlFor="has_penalty_rate" className="font-medium cursor-pointer">
                      Apply Penalty Rate
                    </Label>
                  </div>
                  <Switch
                    id="has_penalty_rate"
                    checked={formData.has_penalty_rate}
                    onCheckedChange={(checked) => handleChange('has_penalty_rate', checked)}
                  />
                </div>

                {formData.has_penalty_rate && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="penalty_rate">Penalty Rate (%) *</Label>
                      <Input
                        id="penalty_rate"
                        type="number"
                        value={formData.penalty_rate}
                        onChange={(e) => handleChange('penalty_rate', e.target.value)}
                        step="0.01"
                        placeholder="e.g. 24"
                        className="bg-white"
                        required={formData.has_penalty_rate}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="penalty_rate_from">Effective From *</Label>
                      <Input
                        id="penalty_rate_from"
                        type="date"
                        value={formData.penalty_rate_from}
                        onChange={(e) => handleChange('penalty_rate_from', e.target.value)}
                        className="bg-white"
                        required={formData.has_penalty_rate}
                      />
                    </div>
                    <p className="col-span-2 text-xs text-slate-500">
                      The penalty rate will apply to interest calculations from this date onwards
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="arrangement_fee">{isFixedCharge ? 'Setup Fee' : 'Arrangement Fee'}</Label>
              <Input
                id="arrangement_fee"
                type="number"
                value={formData.arrangement_fee}
                onChange={(e) => handleChange('arrangement_fee', e.target.value)}
                step="0.01"
              />
              {!isFixedCharge && <p className="text-xs text-slate-500">Deducted from disbursement</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="exit_fee">{isFixedCharge ? 'Closing Fee' : 'Exit Fee'}</Label>
              <Input
                id="exit_fee"
                type="number"
                value={formData.exit_fee}
                onChange={(e) => handleChange('exit_fee', e.target.value)}
                step="0.01"
              />
              {!isFixedCharge && <p className="text-xs text-slate-500">Added to final payment</p>}
            </div>
          </div>

          {/* Duration - not shown for Irregular Income */}
          {!isIrregularIncome && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration">
                  Duration ({isFixedCharge ? 'Months' : selectedProduct?.period || 'Periods'}) *
                </Label>
                <Input
                  id="duration"
                  type="number"
                  value={formData.duration}
                  onChange={(e) => handleChange('duration', e.target.value)}
                  min="1"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="start_date">Start Date *</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => handleChange('start_date', e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {/* Start date for Irregular Income (no duration) */}
          {isIrregularIncome && (
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date *</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder={`Enter a description for this ${isFixedCharge ? 'facility' : 'loan'} (optional)`}
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || changes.length === 0} className="flex-1">
              {changes.length === 0 ? 'No Changes' : `Review Changes (${changes.length})`}
            </Button>
          </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
