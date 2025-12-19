import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Calculator, ChevronRight } from 'lucide-react';
import { generateRepaymentSchedule, calculateLoanSummary, formatCurrency } from './LoanCalculator';
import { format } from 'date-fns';

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
    arrangement_fee: '',
    exit_fee: '',
    duration: '',
    start_date: format(new Date(), 'yyyy-MM-dd')
  });

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [previewSchedule, setPreviewSchedule] = useState(null);
  const [summary, setSummary] = useState(null);

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
    if (!selectedProduct || !formData.principal_amount || !formData.duration) return;

    const schedule = generateRepaymentSchedule({
      principal: parseFloat(formData.principal_amount),
      interestRate: selectedProduct.interest_rate,
      duration: parseInt(formData.duration),
      interestType: selectedProduct.interest_type,
      period: selectedProduct.period,
      startDate: formData.start_date,
      interestOnlyPeriod: selectedProduct.interest_only_period || 0
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
    if (!previewSchedule) {
      handlePreview();
      return;
    }

    const borrower = borrowers.find(b => b.id === formData.borrower_id);
    const arrangementFee = parseFloat(formData.arrangement_fee) || 0;
    const exitFee = parseFloat(formData.exit_fee) || 0;
    const principalAmount = parseFloat(formData.principal_amount);
    
    onSubmit({
      ...formData,
      principal_amount: principalAmount,
      arrangement_fee: arrangementFee,
      exit_fee: exitFee,
      net_disbursed: principalAmount - arrangementFee,
      duration: parseInt(formData.duration),
      borrower_name: `${borrower.first_name} ${borrower.last_name}`,
      product_name: selectedProduct.name,
      interest_rate: selectedProduct.interest_rate,
      interest_type: selectedProduct.interest_type,
      interest_only_period: selectedProduct.interest_only_period || 0,
      period: selectedProduct.period,
      total_interest: summary.totalInterest,
      total_repayable: summary.totalRepayable + exitFee,
      principal_paid: 0,
      interest_paid: 0,
      status: 'Pending'
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
                    {borrower.first_name} {borrower.last_name} - {borrower.phone}
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
                    {product.name} - {product.interest_rate}% ({product.interest_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProduct && (
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
              <p className="text-xs text-slate-500">Deducted from disbursement</p>
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
              <p className="text-xs text-slate-500">Added to final payment</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration">Duration ({selectedProduct?.period || 'Periods'}) *</Label>
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

          <Button 
            type="button" 
            variant="outline" 
            onClick={handlePreview}
            disabled={!formData.borrower_id || !formData.product_id || !formData.principal_amount || !formData.duration}
            className="w-full"
          >
            <Calculator className="w-4 h-4 mr-2" />
            Preview Schedule
          </Button>
        </div>

        <div className="space-y-4">
          {summary && (
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
                            P: {formatCurrency(row.principal_amount)} | I: {formatCurrency(row.interest_amount)}
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
          disabled={isLoading || !previewSchedule}
          className="min-w-[160px]"
        >
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create Loan
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </form>
  );
}