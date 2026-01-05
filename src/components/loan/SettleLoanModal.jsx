import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Calculator, Calendar, TrendingDown, DollarSign, FileText, Download, ChevronDown, ArrowRight, Receipt } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';
import { generateSettlementStatementPDF } from './LoanPDFGenerator';
import { format, differenceInDays } from 'date-fns';
import { useOrganization } from '@/lib/OrganizationContext';
import { cn } from '@/lib/utils';

function calculateSettlementAmount(loan, settlementDate, transactions = []) {
  const startDate = new Date(loan.start_date);
  const settleDate = new Date(settlementDate);
  settleDate.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  // Add 1 to include the settlement day itself in the interest calculation
  // Interest accrues up to and including the settlement date
  const daysElapsed = Math.max(0, differenceInDays(settleDate, startDate) + 1);
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

  // Build detailed interest periods between principal-changing events
  const interestPeriods = [];
  let runningPrincipal = principal;
  let periodStartDate = startDate;
  let totalInterestAccrued = 0;

  // Get all dates where principal changed (payments with principal applied)
  const principalChangeEvents = repayments
    .filter(tx => tx.principal_applied > 0)
    .map(tx => ({
      date: new Date(tx.date),
      principalApplied: tx.principal_applied,
      interestApplied: tx.interest_applied || 0,
      amount: tx.amount,
      reference: tx.reference || tx.description || ''
    }))
    .sort((a, b) => a.date - b.date);

  // The calculation end date is the day AFTER settlement (to include settlement day's interest)
  // This matches how calculateAccruedInterestWithTransactions works
  const calculationEndDate = new Date(settleDate);
  calculationEndDate.setDate(calculationEndDate.getDate() + 1);

  // Calculate interest for each period between principal changes
  let eventIndex = 0;
  while (periodStartDate < calculationEndDate) {
    // Find the end of this period (next principal change or end date)
    let periodEndDate;
    let principalPayment = 0;
    let eventDetails = null;

    if (eventIndex < principalChangeEvents.length) {
      const nextEvent = principalChangeEvents[eventIndex];
      if (nextEvent.date <= settleDate) {
        periodEndDate = nextEvent.date;
        principalPayment = nextEvent.principalApplied;
        eventDetails = nextEvent;
        eventIndex++;
      } else {
        periodEndDate = calculationEndDate;
      }
    } else {
      periodEndDate = calculationEndDate;
    }

    // Calculate days in this period
    const daysInPeriod = differenceInDays(periodEndDate, periodStartDate);

    if (daysInPeriod > 0) {
      // Calculate interest for this period
      const periodInterest = runningPrincipal * dailyRate * daysInPeriod;
      totalInterestAccrued += periodInterest;

      interestPeriods.push({
        startDate: new Date(periodStartDate),
        endDate: new Date(periodEndDate),
        days: daysInPeriod,
        openingPrincipal: runningPrincipal,
        dailyRate,
        periodInterest,
        principalPayment,
        closingPrincipal: runningPrincipal - principalPayment,
        eventDetails
      });

      // Update principal for next period
      runningPrincipal = Math.max(0, runningPrincipal - principalPayment);
    }

    periodStartDate = periodEndDate;
  }

  // Build transaction summary with running balances
  const transactionHistory = [];
  let runningPrincipalBal = principal;

  // Add initial disbursement
  transactionHistory.push({
    date: startDate,
    type: 'Disbursement',
    description: 'Loan disbursement',
    amount: principal,
    principalApplied: 0,
    interestApplied: 0,
    principalBalance: principal
  });

  // Process each repayment
  for (const tx of repayments) {
    const txDate = new Date(tx.date);

    // Apply the payment
    runningPrincipalBal -= (tx.principal_applied || 0);

    transactionHistory.push({
      date: txDate,
      type: tx.type,
      description: tx.reference || tx.description || 'Payment',
      amount: tx.amount,
      principalApplied: tx.principal_applied || 0,
      interestApplied: tx.interest_applied || 0,
      principalBalance: Math.max(0, runningPrincipalBal)
    });
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
    annualRate,
    interestPeriods,
    transactionHistory,
    repaymentCount: repayments.length
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
  const [showInterestDetails, setShowInterestDetails] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);

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
      interestPeriods: settlement.interestPeriods,
      transactionHistory: settlement.transactionHistory,
      daysElapsed: settlement.daysElapsed,
      dailyRate: settlement.dailyRate,
      annualRate: settlement.annualRate,
      organization: currentOrganization || null,
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

          {/* Detailed Interest Calculation */}
          <Collapsible open={showInterestDetails} onOpenChange={setShowInterestDetails}>
            <Card className="border-amber-200">
              <CollapsibleTrigger asChild>
                <button className="w-full p-4 text-left hover:bg-amber-50/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                      <TrendingDown className="w-4 h-4 text-amber-600" />
                      Interest Calculation Details
                    </h3>
                    <ChevronDown className={cn(
                      "w-5 h-5 text-slate-400 transition-transform",
                      showInterestDetails && "rotate-180"
                    )} />
                  </div>
                  <p className="text-sm text-slate-600 mt-1">
                    {settlement.daysElapsed} days @ {(settlement.annualRate * 100).toFixed(2)}% p.a.
                    ({(settlement.dailyRate * 100).toFixed(6)}% daily)
                    {settlement.interestPeriods.length > 1 && ` across ${settlement.interestPeriods.length} periods`}
                  </p>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 pb-4 px-4">
                  {/* Formula Explanation */}
                  <div className="bg-slate-50 rounded-lg p-3 mb-4 text-sm">
                    <p className="font-medium text-slate-700 mb-2">Calculation Formula:</p>
                    <code className="text-xs bg-white px-2 py-1 rounded border block">
                      Daily Interest = Principal Balance × (Annual Rate ÷ 365)
                    </code>
                    <p className="text-slate-500 mt-2 text-xs">
                      Rate: {(settlement.annualRate * 100).toFixed(2)}% ÷ 365 = {(settlement.dailyRate * 100).toFixed(6)}% per day
                    </p>
                  </div>

                  {/* Interest Periods Table */}
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">Period</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-slate-600">Days</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-slate-600">Principal</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-slate-600">Interest</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {settlement.interestPeriods.map((period, idx) => (
                          <tr key={idx} className={cn(
                            period.principalPayment > 0 && "bg-green-50"
                          )}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1 text-xs">
                                <span>{format(period.startDate, 'dd/MM/yy')}</span>
                                <ArrowRight className="w-3 h-3 text-slate-400" />
                                <span>{format(period.endDate, 'dd/MM/yy')}</span>
                              </div>
                              {period.principalPayment > 0 && (
                                <div className="text-xs text-green-600 mt-0.5">
                                  Payment: {formatCurrency(period.principalPayment)} principal
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{period.days}</td>
                            <td className="px-3 py-2 text-right">
                              <span className="font-medium">{formatCurrency(period.openingPrincipal)}</span>
                              {period.principalPayment > 0 && (
                                <span className="text-xs text-slate-400 block">
                                  → {formatCurrency(period.closingPrincipal)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-amber-600">
                              {formatCurrency(period.periodInterest)}
                            </td>
                          </tr>
                        ))}
                        {/* Totals Row */}
                        <tr className="bg-amber-50 font-medium">
                          <td className="px-3 py-2">Total Accrued</td>
                          <td className="px-3 py-2 text-right font-mono">{settlement.daysElapsed}</td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2 text-right text-amber-700">
                            {formatCurrency(settlement.interestAccrued)}
                          </td>
                        </tr>
                        <tr className="bg-green-50">
                          <td className="px-3 py-2 text-green-700">Less: Interest Paid</td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2 text-right text-green-600">
                            ({formatCurrency(settlement.interestPaid)})
                          </td>
                        </tr>
                        <tr className="bg-amber-100 font-bold">
                          <td className="px-3 py-2 text-amber-800">Interest Outstanding</td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2 text-right text-amber-800">
                            {formatCurrency(settlement.interestRemaining)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Transaction History */}
          {settlement.transactionHistory.length > 1 && (
            <Collapsible open={showTransactions} onOpenChange={setShowTransactions}>
              <Card className="border-blue-200">
                <CollapsibleTrigger asChild>
                  <button className="w-full p-4 text-left hover:bg-blue-50/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-blue-600" />
                        Transaction History
                      </h3>
                      <ChevronDown className={cn(
                        "w-5 h-5 text-slate-400 transition-transform",
                        showTransactions && "rotate-180"
                      )} />
                    </div>
                    <p className="text-sm text-slate-600 mt-1">
                      {settlement.repaymentCount} repayment{settlement.repaymentCount !== 1 ? 's' : ''} recorded
                    </p>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-4 px-4">
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">Date</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">Description</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-slate-600">Amount</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-slate-600">Principal</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-slate-600">Interest</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-slate-600">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {settlement.transactionHistory.map((tx, idx) => (
                            <tr key={idx} className={cn(
                              tx.type === 'Disbursement' && "bg-blue-50",
                              tx.type === 'Repayment' && "bg-green-50/50"
                            )}>
                              <td className="px-3 py-2 text-xs">
                                {format(tx.date, 'dd/MM/yyyy')}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "text-xs px-1.5 py-0.5 rounded",
                                    tx.type === 'Disbursement' && "bg-blue-100 text-blue-700",
                                    tx.type === 'Repayment' && "bg-green-100 text-green-700"
                                  )}>
                                    {tx.type}
                                  </span>
                                  <span className="text-slate-600 truncate max-w-[120px]" title={tx.description}>
                                    {tx.description}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-medium">
                                {tx.type === 'Disbursement' ? (
                                  <span className="text-blue-600">{formatCurrency(tx.amount)}</span>
                                ) : (
                                  <span className="text-green-600">{formatCurrency(tx.amount)}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-xs">
                                {tx.principalApplied > 0 && (
                                  <span className="text-green-600">-{formatCurrency(tx.principalApplied)}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-xs">
                                {tx.interestApplied > 0 && (
                                  <span className="text-amber-600">-{formatCurrency(tx.interestApplied)}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-medium">
                                {formatCurrency(tx.principalBalance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
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