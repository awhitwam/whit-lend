import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Calculator, Calendar, TrendingDown, DollarSign, FileText, Download } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';
import { generateSettlementStatementPDF } from './LoanPDFGenerator';
import { format, differenceInDays } from 'date-fns';
import { useOrganization } from '@/lib/OrganizationContext';

function calculateSettlementAmount(loan, settlementDate, transactions = []) {
  const startDate = new Date(loan.start_date);
  const settleDate = new Date(settlementDate);
  settleDate.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  const daysElapsed = Math.max(0, differenceInDays(settleDate, startDate));
  const principal = loan.principal_amount;
  const annualRate = loan.interest_rate / 100;
  const dailyRate = annualRate / 365;

  // Get repayment transactions sorted by date
  const repayments = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate totals from actual transactions
  const totalPrincipalPaid = repayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);
  const totalInterestPaid = repayments.reduce((sum, tx) => sum + (tx.interest_applied || 0), 0);
  const principalRemaining = principal - totalPrincipalPaid;

  // Calculate interest day by day, adjusting principal when payments occur
  let totalInterestAccrued = 0;
  let runningPrincipal = principal;
  const dailyBreakdown = [];

  // Create a map of principal payments by date
  const principalPaymentsByDate = {};
  repayments.forEach(tx => {
    if (tx.principal_applied > 0) {
      const dateKey = format(new Date(tx.date), 'yyyy-MM-dd');
      principalPaymentsByDate[dateKey] = (principalPaymentsByDate[dateKey] || 0) + tx.principal_applied;
    }
  });

  // Calculate interest day by day
  for (let day = 0; day < daysElapsed; day++) {
    const currentDate = new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000);
    const dateKey = format(currentDate, 'yyyy-MM-dd');

    // Check if principal was reduced on this day
    if (principalPaymentsByDate[dateKey]) {
      runningPrincipal -= principalPaymentsByDate[dateKey];
      runningPrincipal = Math.max(0, runningPrincipal);
    }

    // Calculate interest for this day based on current principal
    const dayInterest = runningPrincipal * dailyRate;
    totalInterestAccrued += dayInterest;

    // Store first 14 days for breakdown display
    if (day < 14) {
      dailyBreakdown.push({
        day: day + 1,
        date: currentDate,
        balance: runningPrincipal,
        dailyInterest: dayInterest
      });
    }
  }

  const interestRemaining = Math.max(0, totalInterestAccrued - totalInterestPaid);
  const exitFee = loan.exit_fee || 0;
  const settlementAmount = principalRemaining + interestRemaining + exitFee;

  return {
    originalPrincipal: principal,
    principalPaid: totalPrincipalPaid,
    principalRemaining,
    interestAccrued: totalInterestAccrued,
    interestPaid: totalInterestPaid,
    interestRemaining,
    exitFee,
    settlementAmount,
    daysElapsed,
    dailyRate,
    dailyBreakdown
  };
}

export default function SettleLoanModal({
  isOpen,
  onClose,
  loan,
  borrower,
  transactions = [],
  onSubmit,
  isLoading
}) {
  const { currentOrganization } = useOrganization();
  const [settlementDate, setSettlementDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [settlementAmount, setSettlementAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const settlement = loan ? calculateSettlementAmount(loan, settlementDate, transactions) : null;

  // Update settlement amount when calculation changes
  useState(() => {
    if (settlement) {
      setSettlementAmount(settlement.settlementAmount.toString());
    }
  }, [settlement?.settlementAmount]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      amount: parseFloat(settlementAmount) || settlement.settlementAmount,
      date: settlementDate,
      reference,
      notes: notes || `Settlement of loan as of ${format(new Date(settlementDate), 'MMM dd, yyyy')}`,
      overpayment_option: 'credit',
      loan_id: loan.id,
      borrower_id: loan.borrower_id,
      type: 'Repayment'
    });
  };

  const handleDownloadPDF = () => {
    const settlementData = {
      settlementDate: settlementDate,
      principalRemaining: settlement.principalRemaining,
      interestAccrued: settlement.interestAccrued,
      interestPaid: settlement.interestPaid,
      interestDue: settlement.interestRemaining,
      exitFee: settlement.exitFee,
      totalSettlement: settlement.settlementAmount,
      dailyBreakdown: settlement.dailyBreakdown,
      daysElapsed: settlement.daysElapsed,
      dailyRate: settlement.dailyRate,
      organizationName: currentOrganization?.name || '',
      borrower: borrower || null
    };
    generateSettlementStatementPDF(loan, settlementData);
  };

  if (!loan || !settlement) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-emerald-600" />
            Loan Settlement Calculator
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="p-4 bg-slate-50 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Borrower</span>
              <span className="font-medium">{loan.borrower_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Loan Product</span>
              <span className="font-medium">{loan.product_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Interest Type</span>
              <span className="font-medium">{loan.interest_type}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settlement_date" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Settlement Date *
            </Label>
            <Input
              id="settlement_date"
              type="date"
              value={settlementDate}
              onChange={(e) => setSettlementDate(e.target.value)}
              min={loan.start_date}
              required
            />
            <p className="text-xs text-slate-500">
              {settlement.daysElapsed} days elapsed since loan start
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Settlement Breakdown
            </h3>

            {/* Principal Section */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-500 mb-1">Original Principal</p>
                  <p className="text-lg font-bold text-slate-900">
                    {formatCurrency(settlement.originalPrincipal)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-500 mb-1">Principal Paid</p>
                  <p className="text-lg font-bold text-emerald-600">
                    {formatCurrency(settlement.principalPaid)}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-slate-400">
                <CardContent className="p-3">
                  <p className="text-xs text-slate-500 mb-1">Principal Outstanding</p>
                  <p className="text-lg font-bold text-slate-900">
                    {formatCurrency(settlement.principalRemaining)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Interest Section */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-500 mb-1">Interest Accrued</p>
                  <p className="text-lg font-bold text-amber-600">
                    {formatCurrency(settlement.interestAccrued)}
                  </p>
                  <p className="text-xs text-slate-400">
                    @ {(settlement.dailyRate * 100).toFixed(4)}%/day
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-500 mb-1">Interest Paid</p>
                  <p className="text-lg font-bold text-emerald-600">
                    {formatCurrency(settlement.interestPaid)}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-amber-400">
                <CardContent className="p-3">
                  <p className="text-xs text-slate-500 mb-1">Interest Outstanding</p>
                  <p className="text-lg font-bold text-amber-600">
                    {formatCurrency(settlement.interestRemaining)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Exit Fee */}
            {settlement.exitFee > 0 && (
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-500 mb-1">Exit Fee</p>
                  <p className="text-lg font-bold text-blue-600">
                    {formatCurrency(settlement.exitFee)}
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-emerald-700 font-medium">Total Settlement Amount</p>
                    <p className="text-xs text-emerald-600 mt-1">
                      As of {format(new Date(settlementDate), 'MMM dd, yyyy')}
                    </p>
                  </div>
                  <p className="text-3xl font-bold text-emerald-900">
                    {formatCurrency(settlement.settlementAmount)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {settlement.dailyBreakdown.length > 0 && (
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="p-4">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-3">
                  <TrendingDown className="w-4 h-4" />
                  Interest Calculation
                </h3>
                <div className="text-sm">
                  <p className="text-slate-700">
                    <span className="font-semibold">{settlement.daysElapsed} days</span>
                    {' @ '}
                    <span className="font-semibold text-amber-600">
                      {formatCurrency(settlement.interestRemaining / settlement.daysElapsed)} per day
                    </span>
                    {' = '}
                    <span className="font-bold text-amber-700">
                      {formatCurrency(settlement.interestRemaining)}
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4 border-t pt-4">
            <h3 className="font-semibold text-slate-900">Payment Details</h3>
            
            <div className="space-y-2">
              <Label htmlFor="settlement_amount" className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Settlement Amount *
              </Label>
              <Input
                id="settlement_amount"
                type="number"
                step="0.01"
                value={settlementAmount || settlement?.settlementAmount || ''}
                onChange={(e) => setSettlementAmount(e.target.value)}
                placeholder={formatCurrency(settlement?.settlementAmount || 0)}
                required
              />
              <p className="text-xs text-slate-500">
                Calculated amount: {formatCurrency(settlement?.settlementAmount || 0)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference">Reference Number</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. Transaction reference"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional settlement notes..."
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="secondary" onClick={handleDownloadPDF}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <DollarSign className="w-4 h-4 mr-2" />
              Record Settlement Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}