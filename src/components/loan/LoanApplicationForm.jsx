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

export default function LoanApplicationForm({ 
  borrowers, 
  products, 
  onSubmit, 
  onPreview,
  isLoading,
  preselectedBorrowerId 
}) {
  const [formData, setFormData] = useState({
    borrower_id: preselectedBorrowerId || '',
    product_id: '',
    principal_amount: '',
    monthly_charge: '',
    arrangement_fee: '',
    exit_fee: '',
    duration: '',
    start_date: format(new Date(), 'yyyy-MM-dd'),
    status: 'Live',
    description: ''
  });

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [previewSchedule, setPreviewSchedule] = useState(null);
  const [summary, setSummary] = useState(null);

  // Helper to check product type
  const isFixedCharge = selectedProduct?.product_type === 'Fixed Charge';
  const isIrregularIncome = selectedProduct?.product_type === 'Irregular Income';
  const isSpecialType = isFixedCharge || isIrregularIncome;

  useEffect(() => {
    if (formData.product_id) {
      const product = products.find(p => p.id === formData.product_id);
      setSelectedProduct(product);
    }
  }, [formData.product_id, products]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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
        principal_amount: 0,
        monthly_charge: monthlyCharge,
        arrangement_fee: arrangementFee,
        exit_fee: exitFee,
        net_disbursed: 0,
        duration: duration,
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
        principal_amount: principalAmount,
        arrangement_fee: arrangementFee,
        exit_fee: exitFee,
        net_disbursed: principalAmount - arrangementFee,
        duration: null,
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

    // Standard loan submission
    const principalAmount = parseFloat(formData.principal_amount);

    onSubmit({
      ...formData,
      principal_amount: principalAmount,
      arrangement_fee: arrangementFee,
      exit_fee: exitFee,
      net_disbursed: principalAmount - arrangementFee,
      duration: parseInt(formData.duration),
      borrower_name: borrower.business || `${borrower.first_name} ${borrower.last_name}`,
      product_name: selectedProduct.name,
      product_type: selectedProduct.product_type || 'Standard',
      interest_rate: selectedProduct.interest_rate,
      interest_type: selectedProduct.interest_type,
      interest_only_period: selectedProduct.interest_only_period || 0,
      period: selectedProduct.period,
      total_interest: summary.totalInterest,
      total_repayable: summary.totalRepayable + exitFee,
      principal_paid: 0,
      interest_paid: 0,
      status: formData.status
    }, previewSchedule);
  };

  const selectedBorrower = borrowers.find(b => b.id === formData.borrower_id);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
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

          {selectedProduct && !isSpecialType && (
            <div className="p-4 bg-slate-50 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Interest Rate:</span>
                <span className="font-medium">{selectedProduct.interest_rate}% per {selectedProduct.period === 'Monthly' ? 'year' : 'year'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Interest Type:</span>
                <span className="font-medium">{selectedProduct.interest_type}</span>
              </div>
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

          {/* Standard loans: Principal amount */}
          {!isSpecialType && (
            <div className="space-y-2">
              <Label htmlFor="principal_amount">Loan Amount *</Label>
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
            <Card className="border-2 border-blue-100 bg-blue-50/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Loan Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between py-2 border-b border-blue-100">
                  <span className="text-slate-600">Principal Amount</span>
                  <span className="font-semibold">{formatCurrency(summary.totalPrincipal)}</span>
                </div>
                {formData.arrangement_fee && parseFloat(formData.arrangement_fee) > 0 && (
                  <>
                    <div className="flex justify-between py-2 border-b border-blue-100">
                      <span className="text-slate-600">Arrangement Fee</span>
                      <span className="font-semibold text-red-600">-{formatCurrency(parseFloat(formData.arrangement_fee))}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-blue-100">
                      <span className="text-slate-600">Net Disbursed</span>
                      <span className="font-bold text-emerald-600">{formatCurrency(parseFloat(formData.principal_amount) - parseFloat(formData.arrangement_fee))}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between py-2 border-b border-blue-100">
                  <span className="text-slate-600">Total Interest</span>
                  <span className="font-semibold text-amber-600">{formatCurrency(summary.totalInterest)}</span>
                </div>
                {formData.exit_fee && parseFloat(formData.exit_fee) > 0 && (
                  <div className="flex justify-between py-2 border-b border-blue-100">
                    <span className="text-slate-600">Exit Fee</span>
                    <span className="font-semibold text-amber-600">{formatCurrency(parseFloat(formData.exit_fee))}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b border-blue-100">
                  <span className="text-slate-600">Total Repayable</span>
                  <span className="font-bold text-lg">{formatCurrency(summary.totalRepayable + (parseFloat(formData.exit_fee) || 0))}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-600">{selectedProduct?.period} Installment</span>
                  <span className="font-semibold text-emerald-600">{formatCurrency(summary.installmentAmount)}</span>
                </div>
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
                      className="flex items-center justify-between p-3 bg-slate-50 rounded-lg text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-medium text-slate-600">
                          {row.installment_number}
                        </div>
                        <div>
                          <p className="font-medium">{format(new Date(row.due_date), 'MMM dd, yyyy')}</p>
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