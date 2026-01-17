import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Calculator, ChevronRight, Zap, Coins, Info } from 'lucide-react';
import { generateRepaymentSchedule, calculateLoanSummary, formatCurrency } from './LoanCalculator';
import { format, addMonths } from 'date-fns';
import { calculateRollUpAmount } from '@/lib/loanCalculations';

export default function LoanApplicationForm({
  borrowers,
  products,
  onSubmit,
  onPreview,
  isLoading,
  preselectedBorrowerId,
  suggestedLoanNumber
}) {
  const [formData, setFormData] = useState({
    borrower_id: preselectedBorrowerId || '',
    product_id: '',
    loan_number: suggestedLoanNumber || '',
    principal_amount: '',
    monthly_charge: '',
    arrangement_fee: '',
    exit_fee: '',
    duration: '',
    start_date: format(new Date(), 'yyyy-MM-dd'),
    status: 'Live',
    description: '',
    // Roll-Up & Serviced fields
    roll_up_length: '',
    roll_up_amount: '',
    // Additional deducted fees (applies to all products)
    additional_deducted_fees: '',
    additional_deducted_fees_note: ''
  });

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [previewSchedule, setPreviewSchedule] = useState(null);
  const [summary, setSummary] = useState(null);

  // Helper to check product type
  const isFixedCharge = selectedProduct?.product_type === 'Fixed Charge';
  const isIrregularIncome = selectedProduct?.product_type === 'Irregular Income';
  const isRollUpServiced = selectedProduct?.product_type === 'Roll-Up & Serviced';
  const isSpecialType = isFixedCharge || isIrregularIncome;

  useEffect(() => {
    if (formData.product_id) {
      const product = products.find(p => p.id === formData.product_id);
      setSelectedProduct(product);
    }
  }, [formData.product_id, products]);

  // Auto-calculate roll-up amount when relevant fields change
  // Uses shared utility - principal IS the gross amount (no additional fees added)
  useEffect(() => {
    if (isRollUpServiced && selectedProduct && formData.principal_amount && formData.roll_up_length) {
      const calculated = calculateRollUpAmount(
        formData.principal_amount,
        selectedProduct.interest_rate,
        formData.roll_up_length
      );
      // Only auto-update if the field is empty or hasn't been manually edited
      if (!formData.roll_up_amount) {
        setFormData(prev => ({ ...prev, roll_up_amount: calculated }));
      }
    }
  }, [isRollUpServiced, selectedProduct, formData.principal_amount, formData.roll_up_length]);

  const handleChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };

      // Auto-recalculate roll-up amount when dependencies change (unless manually editing roll_up_amount)
      // Uses shared utility - principal IS the gross amount (no additional fees added)
      if (field !== 'roll_up_amount' && isRollUpServiced && selectedProduct) {
        const principal = field === 'principal_amount' ? value : prev.principal_amount;
        const rollUpLength = field === 'roll_up_length' ? value : prev.roll_up_length;

        if (principal && rollUpLength) {
          updated.roll_up_amount = calculateRollUpAmount(
            principal,
            selectedProduct.interest_rate,
            rollUpLength
          );
        }
      }

      return updated;
    });
    setPreviewSchedule(null);
    setSummary(null);
  };

  const handlePreview = () => {
    // For Irregular Income, no preview needed (no schedule)
    if (isIrregularIncome) {
      if (!formData.principal_amount) return;
      const principalAmount = parseFloat(formData.principal_amount);
      const irregularSummary = {
        totalPrincipal: principalAmount,
        totalInterest: 0,
        totalRepayable: principalAmount,
        installmentAmount: 0
      };
      setSummary(irregularSummary);
      setPreviewSchedule([]);  // Empty schedule
      return;
    }

    // For Fixed Charge Facility, generate simple monthly schedule
    if (isFixedCharge) {
      if (!formData.monthly_charge || !formData.duration) return;
      const monthlyCharge = parseFloat(formData.monthly_charge);
      const duration = parseInt(formData.duration);
      const startDate = new Date(formData.start_date);

      const schedule = [];
      for (let i = 1; i <= duration; i++) {
        const dueDate = addMonths(startDate, i);
        schedule.push({
          installment_number: i,
          due_date: format(dueDate, 'yyyy-MM-dd'),
          principal_amount: 0,
          interest_amount: 0,
          charge_amount: monthlyCharge,
          total_due: monthlyCharge,
          status: 'Pending'
        });
      }

      const fixedChargeSummary = {
        totalPrincipal: 0,
        totalInterest: 0,
        totalCharges: monthlyCharge * duration,
        totalRepayable: monthlyCharge * duration,
        installmentAmount: monthlyCharge
      };
      setPreviewSchedule(schedule);
      setSummary(fixedChargeSummary);

      if (onPreview) {
        onPreview(schedule, fixedChargeSummary);
      }
      return;
    }

    // Roll-Up & Serviced preview - generate a simplified preview
    if (isRollUpServiced) {
      if (!formData.principal_amount || !formData.duration || !formData.roll_up_length) return;

      // Principal amount IS the gross amount (what borrower owes)
      // Additional fees are deducted from disbursement but don't add to principal
      const principalAmount = parseFloat(formData.principal_amount);
      const rollUpLength = parseInt(formData.roll_up_length);
      const duration = parseInt(formData.duration);
      const startDate = new Date(formData.start_date);
      const dailyRate = selectedProduct.interest_rate / 100 / 365;

      // Calculate roll-up interest on the principal amount
      const daysInRollUp = rollUpLength * 30.44;
      const rollUpInterest = principalAmount * dailyRate * daysInRollUp;

      // Calculate serviced periods
      const servicedPeriods = Math.max(0, duration - rollUpLength);
      const servicedBase = principalAmount + rollUpInterest;

      // Build preview schedule
      const schedule = [];
      let installmentNumber = 1;

      // Roll-up due entry
      const rollUpDueDate = addMonths(startDate, rollUpLength);
      const actualDaysInRollUp = Math.round(daysInRollUp);
      schedule.push({
        installment_number: installmentNumber++,
        due_date: format(rollUpDueDate, 'yyyy-MM-dd'),
        principal_amount: 0,
        interest_amount: Math.round(rollUpInterest * 100) / 100,
        total_due: Math.round(rollUpInterest * 100) / 100,
        status: 'Pending',
        is_roll_up_period: true,
        calculation_days: actualDaysInRollUp,
        calculation_principal_start: principalAmount
      });

      // Serviced period entries
      let totalServicedInterest = 0;
      for (let i = 1; i <= servicedPeriods; i++) {
        const periodEnd = addMonths(rollUpDueDate, i);
        const daysInPeriod = 30; // Approximate monthly period
        const periodInterest = servicedBase * dailyRate * daysInPeriod;
        totalServicedInterest += periodInterest;

        const isFinal = i === servicedPeriods;
        schedule.push({
          installment_number: installmentNumber++,
          due_date: format(periodEnd, 'yyyy-MM-dd'),
          principal_amount: isFinal ? principalAmount : 0,
          interest_amount: Math.round(periodInterest * 100) / 100,
          total_due: Math.round((periodInterest + (isFinal ? principalAmount : 0)) * 100) / 100,
          status: 'Pending',
          is_serviced_period: true,
          calculation_days: daysInPeriod,
          calculation_principal_start: servicedBase
        });
      }

      // If no serviced periods, balloon payment on roll-up
      if (servicedPeriods === 0) {
        schedule[0].principal_amount = principalAmount;
        schedule[0].total_due = Math.round((rollUpInterest + principalAmount) * 100) / 100;
      }

      const totalInterest = rollUpInterest + totalServicedInterest;
      const rollUpSummary = {
        totalPrincipal: principalAmount,
        totalInterest: Math.round(totalInterest * 100) / 100,
        totalRepayable: Math.round((principalAmount + totalInterest) * 100) / 100,
        installmentAmount: servicedPeriods > 0 ? Math.round((servicedBase * dailyRate * 30.44) * 100) / 100 : 0,
        rollUpInterest: Math.round(rollUpInterest * 100) / 100
      };

      setPreviewSchedule(schedule);
      setSummary(rollUpSummary);

      if (onPreview) {
        onPreview(schedule, rollUpSummary);
      }
      return;
    }

    // Standard loan preview
    if (!selectedProduct || !formData.principal_amount || !formData.duration) return;

    const schedule = generateRepaymentSchedule({
      principal: parseFloat(formData.principal_amount),
      interestRate: selectedProduct.interest_rate,
      duration: parseInt(formData.duration),
      interestType: selectedProduct.interest_type,
      period: selectedProduct.period,
      startDate: formData.start_date,
      interestOnlyPeriod: selectedProduct.interest_only_period || 0,
      interestAlignment: selectedProduct.interest_alignment || 'period_based',
      extendForFullPeriod: selectedProduct.extend_for_full_period || false
    });

    const loanSummary = calculateLoanSummary(schedule);
    setPreviewSchedule(schedule);
    setSummary(loanSummary);

    if (onPreview) {
      onPreview(schedule, loanSummary);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // For Irregular Income, allow submission without preview
    if (isIrregularIncome && !summary) {
      handlePreview();
    }

    if (!isIrregularIncome && !previewSchedule) {
      handlePreview();
      return;
    }

    const borrower = borrowers.find(b => b.id === formData.borrower_id);
    const arrangementFee = parseFloat(formData.arrangement_fee) || 0;
    const exitFee = parseFloat(formData.exit_fee) || 0;

    // Handle Fixed Charge Facility
    if (isFixedCharge) {
      const monthlyCharge = parseFloat(formData.monthly_charge) || 0;
      const duration = parseInt(formData.duration) || 0;

      onSubmit({
        ...formData,
        loan_number: formData.loan_number || null,
        principal_amount: 0,
        monthly_charge: monthlyCharge,
        arrangement_fee: arrangementFee,
        exit_fee: exitFee,
        net_disbursed: 0,
        duration: duration,
        original_term: duration,
        borrower_name: borrower.business || `${borrower.first_name} ${borrower.last_name}`,
        product_name: selectedProduct.name,
        product_type: 'Fixed Charge',
        interest_rate: 0,
        interest_type: null,
        period: 'Monthly',
        total_interest: 0,
        total_charges: monthlyCharge * duration,
        total_repayable: (monthlyCharge * duration) + arrangementFee + exitFee,
        principal_paid: 0,
        interest_paid: 0,
        charges_paid: 0,
        status: formData.status
      }, previewSchedule);
      return;
    }

    // Handle Irregular Income
    if (isIrregularIncome) {
      const principalAmount = parseFloat(formData.principal_amount) || 0;

      onSubmit({
        ...formData,
        loan_number: formData.loan_number || null,
        principal_amount: principalAmount,
        arrangement_fee: arrangementFee,
        exit_fee: exitFee,
        net_disbursed: principalAmount - arrangementFee,
        duration: null,
        original_term: null,
        borrower_name: borrower.business || `${borrower.first_name} ${borrower.last_name}`,
        product_name: selectedProduct.name,
        product_type: 'Irregular Income',
        interest_rate: 0,
        interest_type: null,
        period: null,
        total_interest: 0,
        total_repayable: principalAmount + exitFee,
        principal_paid: 0,
        interest_paid: 0,
        status: formData.status
      }, []);  // Empty schedule
      return;
    }

    // Standard loan submission (including Roll-Up & Serviced)
    const principalAmount = parseFloat(formData.principal_amount);
    const additionalDeductedFees = parseFloat(formData.additional_deducted_fees) || 0;

    // Calculate net disbursed (principal - arrangement_fee - additional_deducted_fees)
    const netDisbursed = principalAmount - arrangementFee - additionalDeductedFees;

    // Build clean loan data object (don't spread formData to avoid empty strings)
    const loanDuration = parseInt(formData.duration);
    onSubmit({
      borrower_id: formData.borrower_id,
      product_id: formData.product_id,
      loan_number: formData.loan_number || null,
      start_date: formData.start_date,
      status: formData.status,
      description: formData.description || null,
      principal_amount: principalAmount,
      arrangement_fee: arrangementFee,
      exit_fee: exitFee,
      additional_deducted_fees: additionalDeductedFees,
      additional_deducted_fees_note: formData.additional_deducted_fees_note || null,
      net_disbursed: netDisbursed,
      duration: loanDuration,
      original_term: loanDuration,
      borrower_name: borrower.business || `${borrower.first_name} ${borrower.last_name}`,
      product_name: selectedProduct.name,
      product_type: selectedProduct.product_type || 'Standard',
      interest_rate: selectedProduct.interest_rate,
      interest_type: isRollUpServiced ? 'Roll-Up & Serviced' : selectedProduct.interest_type,
      interest_only_period: selectedProduct.interest_only_period || 0,
      period: selectedProduct.period,
      total_interest: summary?.totalInterest || 0,
      total_repayable: (summary?.totalRepayable || principalAmount) + exitFee,
      principal_paid: 0,
      interest_paid: 0,
      // Roll-Up & Serviced fields
      roll_up_length: formData.roll_up_length ? parseInt(formData.roll_up_length) : null,
      roll_up_amount: formData.roll_up_amount ? parseFloat(formData.roll_up_amount) : null
    }, previewSchedule);
  };

  const selectedBorrower = borrowers.find(b => b.id === formData.borrower_id);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="loan_number">Loan Number</Label>
            <Input
              id="loan_number"
              value={formData.loan_number}
              onChange={(e) => handleChange('loan_number', e.target.value)}
              placeholder="Auto-generated"
            />
            <p className="text-xs text-slate-500">Auto-generated, edit to override</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="borrower">Borrower *</Label>
            <Select
              value={formData.borrower_id}
              onValueChange={(value) => handleChange('borrower_id', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select borrower" />
              </SelectTrigger>
              <SelectContent>
                {borrowers.filter(b => b.status === 'Active').map((borrower) => (
                  <SelectItem key={borrower.id} value={borrower.id}>
                    {borrower.business || `${borrower.first_name} ${borrower.last_name}`} - {borrower.phone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="product">Loan Product *</Label>
            <Select
              value={formData.product_id}
              onValueChange={(value) => handleChange('product_id', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select loan product" />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} {product.product_type === 'Fixed Charge'
                      ? '(Fixed Charge)'
                      : product.product_type === 'Irregular Income'
                        ? '(Irregular Income)'
                        : product.product_type === 'Rent'
                          ? '(Rent)'
                          : product.product_type === 'Roll-Up & Serviced'
                            ? `- ${product.interest_rate}% (Roll-Up & Serviced)`
                            : `- ${product.interest_rate}% (${product.interest_type})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status *</Label>
            <Select 
              value={formData.status} 
              onValueChange={(value) => handleChange('status', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Live">Live</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">Live loans are immediately active. Use Pending for applications under review.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Enter a description for this loan (optional)"
              rows={2}
              className="resize-none"
            />
          </div>

          {selectedProduct && isFixedCharge && (
            <Alert className="border-purple-200 bg-purple-50">
              <Zap className="w-4 h-4 text-purple-600" />
              <AlertDescription className="text-purple-800">
                <strong>Fixed Charge Facility:</strong> A regular monthly fee the borrower pays for the benefit of having loans with you.
                Set the monthly charge amount and duration below.
              </AlertDescription>
            </Alert>
          )}

          {selectedProduct && isIrregularIncome && (
            <Alert className="border-amber-200 bg-amber-50">
              <Coins className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                <strong>Irregular Income:</strong> A loan with no fixed repayment schedule.
                Record payments as and when the borrower makes them. No interest is calculated.
              </AlertDescription>
            </Alert>
          )}

          {selectedProduct && isRollUpServiced && (
            <Alert className="border-indigo-200 bg-indigo-50">
              <Info className="w-4 h-4 text-indigo-600" />
              <AlertDescription className="text-indigo-800">
                <strong>Roll-Up & Serviced:</strong> Interest rolls up during an initial period, then monthly serviced payments begin.
                Set the roll-up period below. The rolled-up interest is tracked separately.
              </AlertDescription>
            </Alert>
          )}

          {selectedProduct && (!isSpecialType || isRollUpServiced) && (
            <div className="p-4 bg-slate-50 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Interest Rate:</span>
                <span className="font-medium">{selectedProduct.interest_rate}% per {selectedProduct.period === 'Monthly' ? 'year' : 'year'}</span>
              </div>
              {!isRollUpServiced && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Interest Type:</span>
                  <span className="font-medium">{selectedProduct.interest_type}</span>
                </div>
              )}
              {isRollUpServiced && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Product Type:</span>
                  <span className="font-medium">Roll-Up & Serviced</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Repayment:</span>
                <span className="font-medium">{selectedProduct.period}</span>
              </div>
              {selectedProduct.max_amount && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Max Amount:</span>
                  <span className="font-medium">{formatCurrency(selectedProduct.max_amount)}</span>
                </div>
              )}
            </div>
          )}

          {/* Fixed Charge Facility: Monthly charge instead of principal */}
          {isFixedCharge && (
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
          )}

          {/* Irregular Income: Principal amount (loan to track) */}
          {isIrregularIncome && (
            <div className="space-y-2">
              <Label htmlFor="principal_amount">Principal Advanced *</Label>
              <Input
                id="principal_amount"
                type="number"
                value={formData.principal_amount}
                onChange={(e) => handleChange('principal_amount', e.target.value)}
                placeholder="Enter total amount advanced"
                min={0}
                step="0.01"
                required
              />
              <p className="text-xs text-slate-500">Total principal amount given to borrower</p>
            </div>
          )}

          {/* Standard loans (including Roll-Up & Serviced): Principal amount */}
          {(!isSpecialType || isRollUpServiced) && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="principal_amount">Principal (Gross) *</Label>
                <Input
                  id="principal_amount"
                  type="number"
                  value={formData.principal_amount}
                  onChange={(e) => handleChange('principal_amount', e.target.value)}
                  placeholder="Enter loan amount"
                  min={selectedProduct?.min_amount || 0}
                  max={selectedProduct?.max_amount || undefined}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Net Disbursed</Label>
                <Input
                  type="text"
                  value={formData.principal_amount ? formatCurrency(
                    parseFloat(formData.principal_amount) -
                    (parseFloat(formData.arrangement_fee) || 0) -
                    (parseFloat(formData.additional_deducted_fees) || 0)
                  ) : '—'}
                  disabled
                  className="bg-slate-50 text-slate-600"
                />
                <p className="text-xs text-slate-500">Gross minus fees</p>
              </div>
            </div>
          )}

          {/* Roll-Up & Serviced: Roll-up configuration */}
          {isRollUpServiced && (
            <div className="space-y-4 p-4 bg-indigo-50 rounded-lg">
              <h4 className="font-medium text-indigo-900">Roll-Up Configuration</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="roll_up_length">Roll-Up Period (Months) *</Label>
                  <Input
                    id="roll_up_length"
                    type="number"
                    value={formData.roll_up_length}
                    onChange={(e) => handleChange('roll_up_length', e.target.value)}
                    placeholder="e.g. 6"
                    min={1}
                    max={120}
                    required
                  />
                  <p className="text-xs text-slate-500">Interest rolls up for this period</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roll_up_amount">Roll-Up Amount</Label>
                  <Input
                    id="roll_up_amount"
                    type="number"
                    value={formData.roll_up_amount}
                    onChange={(e) => handleChange('roll_up_amount', e.target.value)}
                    placeholder="Auto-calculated"
                    step="0.01"
                  />
                  <p className="text-xs text-slate-500">Auto-calculated, edit to override</p>
                </div>
              </div>
            </div>
          )}

          {/* Additional Deducted Fees (for Roll-Up & Serviced and standard loans) */}
          {(!isSpecialType || isRollUpServiced) && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="additional_deducted_fees">Additional Deducted Fees</Label>
                <Input
                  id="additional_deducted_fees"
                  type="number"
                  value={formData.additional_deducted_fees}
                  onChange={(e) => handleChange('additional_deducted_fees', e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step="0.01"
                />
                <p className="text-xs text-slate-500">Added to gross principal but not disbursed</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="additional_deducted_fees_note">Fees Note</Label>
                <Input
                  id="additional_deducted_fees_note"
                  value={formData.additional_deducted_fees_note}
                  onChange={(e) => handleChange('additional_deducted_fees_note', e.target.value)}
                  placeholder="e.g. Broker fee"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="arrangement_fee">Arrangement Fee</Label>
              <Input
                id="arrangement_fee"
                type="number"
                value={formData.arrangement_fee}
                onChange={(e) => handleChange('arrangement_fee', e.target.value)}
                placeholder="0.00"
                min={0}
                step="0.01"
              />
              <p className="text-xs text-slate-500">{isFixedCharge ? 'Setup fee' : 'Deducted from disbursement'}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="exit_fee">Exit Fee</Label>
              <Input
                id="exit_fee"
                type="number"
                value={formData.exit_fee}
                onChange={(e) => handleChange('exit_fee', e.target.value)}
                placeholder="0.00"
                min={0}
                step="0.01"
              />
              <p className="text-xs text-slate-500">{isFixedCharge ? 'Closing fee' : 'Added to final payment'}</p>
            </div>
          </div>

          {/* Duration only for Fixed Charge and Standard loans */}
          {!isIrregularIncome && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration">Duration ({isFixedCharge ? 'Months' : selectedProduct?.period || 'Periods'}) *</Label>
                <Input
                  id="duration"
                  type="number"
                  value={formData.duration}
                  onChange={(e) => handleChange('duration', e.target.value)}
                  placeholder="e.g. 12"
                  min={1}
                  max={selectedProduct?.max_duration || 60}
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

          {/* Start date only for Irregular Income */}
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

          {/* Preview button - different conditions for different product types */}
          {!isIrregularIncome && (
            <Button
              type="button"
              variant="outline"
              onClick={handlePreview}
              disabled={!formData.borrower_id || !formData.product_id ||
                (isFixedCharge ? !formData.monthly_charge : !formData.principal_amount) ||
                !formData.duration || !selectedProduct}
              className="w-full"
            >
              <Calculator className="w-4 h-4 mr-2" />
              Preview Schedule
            </Button>
          )}
        </div>

        <div className="space-y-4">
          {/* Summary for Fixed Charge */}
          {summary && isFixedCharge && (
            <Card className="border-2 border-purple-100 bg-purple-50/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Facility Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between py-2 border-b border-purple-100">
                  <span className="text-slate-600">Monthly Charge</span>
                  <span className="font-semibold">{formatCurrency(parseFloat(formData.monthly_charge) || 0)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-purple-100">
                  <span className="text-slate-600">Duration</span>
                  <span className="font-semibold">{formData.duration} months</span>
                </div>
                {formData.arrangement_fee && parseFloat(formData.arrangement_fee) > 0 && (
                  <div className="flex justify-between py-2 border-b border-purple-100">
                    <span className="text-slate-600">Arrangement Fee</span>
                    <span className="font-semibold text-amber-600">{formatCurrency(parseFloat(formData.arrangement_fee))}</span>
                  </div>
                )}
                {formData.exit_fee && parseFloat(formData.exit_fee) > 0 && (
                  <div className="flex justify-between py-2 border-b border-purple-100">
                    <span className="text-slate-600">Exit Fee</span>
                    <span className="font-semibold text-amber-600">{formatCurrency(parseFloat(formData.exit_fee))}</span>
                  </div>
                )}
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">Total Charges</span>
                  <span className="font-bold text-lg">{formatCurrency(summary.totalCharges + (parseFloat(formData.arrangement_fee) || 0) + (parseFloat(formData.exit_fee) || 0))}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary for Irregular Income */}
          {isIrregularIncome && formData.principal_amount && (
            <Card className="border-2 border-amber-100 bg-amber-50/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Loan Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between py-2 border-b border-amber-100">
                  <span className="text-slate-600">Principal Advanced</span>
                  <span className="font-semibold">{formatCurrency(parseFloat(formData.principal_amount) || 0)}</span>
                </div>
                {formData.arrangement_fee && parseFloat(formData.arrangement_fee) > 0 && (
                  <>
                    <div className="flex justify-between py-2 border-b border-amber-100">
                      <span className="text-slate-600">Arrangement Fee</span>
                      <span className="font-semibold text-red-600">-{formatCurrency(parseFloat(formData.arrangement_fee))}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-amber-100">
                      <span className="text-slate-600">Net Disbursed</span>
                      <span className="font-bold text-emerald-600">{formatCurrency(parseFloat(formData.principal_amount) - parseFloat(formData.arrangement_fee))}</span>
                    </div>
                  </>
                )}
                {formData.exit_fee && parseFloat(formData.exit_fee) > 0 && (
                  <div className="flex justify-between py-2 border-b border-amber-100">
                    <span className="text-slate-600">Exit Fee</span>
                    <span className="font-semibold text-amber-600">{formatCurrency(parseFloat(formData.exit_fee))}</span>
                  </div>
                )}
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">Total to Repay</span>
                  <span className="font-bold text-lg">{formatCurrency((parseFloat(formData.principal_amount) || 0) + (parseFloat(formData.exit_fee) || 0))}</span>
                </div>
                <p className="text-xs text-slate-500 pt-2">No interest calculated. Record payments as received.</p>
              </CardContent>
            </Card>
          )}

          {/* Summary for Standard loans */}
          {summary && !isSpecialType && (
            <Card className={`border-2 ${isRollUpServiced ? 'border-indigo-100 bg-indigo-50/30' : 'border-blue-100 bg-blue-50/30'}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  {isRollUpServiced ? 'Roll-Up & Serviced Summary' : 'Loan Summary'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className={`flex justify-between py-2 border-b ${isRollUpServiced ? 'border-indigo-100' : 'border-blue-100'}`}>
                  <span className="text-slate-600">Principal Amount</span>
                  <div className="text-right">
                    <span className="font-semibold">{formatCurrency(summary.totalPrincipal)}</span>
                    {((formData.arrangement_fee && parseFloat(formData.arrangement_fee) > 0) || (formData.additional_deducted_fees && parseFloat(formData.additional_deducted_fees) > 0)) && (
                      <span className="text-slate-500 text-sm ml-2">
                        (net: {formatCurrency(parseFloat(formData.principal_amount) - (parseFloat(formData.arrangement_fee) || 0) - (parseFloat(formData.additional_deducted_fees) || 0))})
                      </span>
                    )}
                  </div>
                </div>
                {formData.arrangement_fee && parseFloat(formData.arrangement_fee) > 0 && (
                  <div className={`flex justify-between py-2 border-b ${isRollUpServiced ? 'border-indigo-100' : 'border-blue-100'}`}>
                    <span className="text-slate-600">Arrangement Fee</span>
                    <span className="font-semibold text-red-600">-{formatCurrency(parseFloat(formData.arrangement_fee))}</span>
                  </div>
                )}
                {formData.additional_deducted_fees && parseFloat(formData.additional_deducted_fees) > 0 && (
                  <div className={`flex justify-between py-2 border-b ${isRollUpServiced ? 'border-indigo-100' : 'border-blue-100'}`}>
                    <span className="text-slate-600">Additional Deducted Fees</span>
                    <span className="font-semibold text-red-600">-{formatCurrency(parseFloat(formData.additional_deducted_fees))}</span>
                  </div>
                )}
                {((formData.arrangement_fee && parseFloat(formData.arrangement_fee) > 0) || (formData.additional_deducted_fees && parseFloat(formData.additional_deducted_fees) > 0)) && (
                  <div className={`flex justify-between py-2 border-b ${isRollUpServiced ? 'border-indigo-100' : 'border-blue-100'}`}>
                    <span className="text-slate-600">Net Disbursed</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(parseFloat(formData.principal_amount) - (parseFloat(formData.arrangement_fee) || 0) - (parseFloat(formData.additional_deducted_fees) || 0))}</span>
                  </div>
                )}
                {isRollUpServiced && summary.rollUpInterest && (
                  <div className={`flex justify-between py-2 border-b border-indigo-100 bg-indigo-50 -mx-3 px-3`}>
                    <span className="text-indigo-700 font-medium">Roll-Up Interest ({formData.roll_up_length} months)</span>
                    <span className="font-semibold text-indigo-700">{formatCurrency(summary.rollUpInterest)}</span>
                  </div>
                )}
                <div className={`flex justify-between py-2 border-b ${isRollUpServiced ? 'border-indigo-100' : 'border-blue-100'}`}>
                  <span className="text-slate-600">Total Interest</span>
                  <span className="font-semibold text-amber-600">{formatCurrency(summary.totalInterest)}</span>
                </div>
                {formData.exit_fee && parseFloat(formData.exit_fee) > 0 && (
                  <div className={`flex justify-between py-2 border-b ${isRollUpServiced ? 'border-indigo-100' : 'border-blue-100'}`}>
                    <span className="text-slate-600">Exit Fee</span>
                    <span className="font-semibold text-amber-600">{formatCurrency(parseFloat(formData.exit_fee))}</span>
                  </div>
                )}
                <div className={`flex justify-between py-2 border-b ${isRollUpServiced ? 'border-indigo-100' : 'border-blue-100'}`}>
                  <span className="text-slate-600">Total Repayable</span>
                  <span className="font-bold text-lg">{formatCurrency(summary.totalRepayable + (parseFloat(formData.exit_fee) || 0))}</span>
                </div>
                {isRollUpServiced ? (
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600">Serviced Interest (Monthly)</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(summary.installmentAmount)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between py-2">
                    <span className="text-slate-600">{selectedProduct?.period} Installment</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(summary.installmentAmount)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {previewSchedule && previewSchedule.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Schedule Preview (First 6)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {previewSchedule.slice(0, 6).map((row) => (
                    <div
                      key={row.installment_number}
                      className={`flex items-center justify-between p-3 rounded-lg text-sm ${
                        row.is_roll_up_period
                          ? 'bg-indigo-50 border border-indigo-200'
                          : row.is_serviced_period
                            ? 'bg-emerald-50 border border-emerald-200'
                            : 'bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-medium ${
                          row.is_roll_up_period
                            ? 'bg-indigo-200 text-indigo-700'
                            : row.is_serviced_period
                              ? 'bg-emerald-200 text-emerald-700'
                              : 'bg-slate-200 text-slate-600'
                        }`}>
                          {row.installment_number}
                        </div>
                        <div>
                          <p className="font-medium">
                            {format(new Date(row.due_date), 'MMM dd, yyyy')}
                            {row.is_roll_up_period && (
                              <span className="ml-2 text-xs font-normal text-indigo-600">Roll-Up Due</span>
                            )}
                            {row.is_serviced_period && row.principal_amount > 0 && (
                              <span className="ml-2 text-xs font-normal text-emerald-600">Final + Balloon</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">
                            {isFixedCharge
                              ? `Charge: ${formatCurrency(row.charge_amount)}`
                              : `P: ${formatCurrency(row.principal_amount)} | I: ${formatCurrency(row.interest_amount)}`
                            }
                          </p>
                        </div>
                      </div>
                      <span className="font-semibold">{formatCurrency(row.total_due)}</span>
                    </div>
                  ))}
                  {previewSchedule.length > 6 && (
                    <p className="text-center text-sm text-slate-500 py-2">
                      + {previewSchedule.length - 6} more installments
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button
          type="submit"
          disabled={isLoading || (!isIrregularIncome && !previewSchedule) || (isIrregularIncome && !formData.principal_amount)}
          className="min-w-[160px]"
        >
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isFixedCharge ? 'Create Facility' : 'Create Loan'}
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </form>
  );
}