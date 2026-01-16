import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calculator, Calendar, TrendingDown, FileText, Download, ChevronDown, ArrowRight, Receipt, X } from 'lucide-react';
import { formatCurrency, calculateAccruedInterestWithTransactions } from './LoanCalculator';
import { generateSettlementStatementPDF } from './LoanPDFGenerator';
import { format, differenceInDays, isValid } from 'date-fns';
import { useOrganization } from '@/lib/OrganizationContext';
import { cn } from '@/lib/utils';

function calculateSettlementAmount(loan, settlementDate, transactions = [], schedule = [], product = null) {
  const startDate = new Date(loan.start_date);
  const settleDate = new Date(settlementDate);

  // Return null if dates are invalid (e.g., while user is typing)
  if (!isValid(settleDate) || !isValid(startDate)) {
    return null;
  }

  settleDate.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);

  // Add 1 to include the settlement day itself in the interest calculation
  // Interest accrues up to and including the settlement date
  const daysElapsed = Math.max(0, differenceInDays(settleDate, startDate) + 1);
  const principal = loan.principal_amount;

  // Handle penalty rates - use effective rate at settlement date
  const hasPenaltyRate = loan.has_penalty_rate && loan.penalty_rate && loan.penalty_rate_from;
  const penaltyRateFrom = hasPenaltyRate ? new Date(loan.penalty_rate_from) : null;
  if (penaltyRateFrom) penaltyRateFrom.setHours(0, 0, 0, 0);
  const baseRate = loan.interest_rate;
  const effectiveRate = (hasPenaltyRate && penaltyRateFrom && settleDate >= penaltyRateFrom)
    ? loan.penalty_rate
    : baseRate;
  const annualRate = effectiveRate / 100;
  const dailyRate = annualRate / 365;

  // Use the shared calculation function for accurate interest calculation
  // Pass schedule and product to enable penalty rate support
  const liveCalc = calculateAccruedInterestWithTransactions(loan, transactions, settleDate, schedule, product);

  // Get repayment transactions sorted by date
  const repayments = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Get disbursement transactions (further advances) - exclude initial disbursement on start date
  const startDateKey = startDate.toISOString().split('T')[0];
  const disbursements = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
    .filter(tx => {
      const txDate = new Date(tx.date);
      txDate.setHours(0, 0, 0, 0);
      return txDate.toISOString().split('T')[0] !== startDateKey;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Use authoritative values from the shared calculation
  const totalInterestAccrued = liveCalc.interestAccrued;
  const totalInterestPaid = liveCalc.interestPaid;
  const principalRemaining = liveCalc.principalRemaining;

  // Calculate totals for reference
  const totalPrincipalPaid = repayments.reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

  // Build detailed interest periods for display purposes
  const interestPeriods = [];
  let runningPrincipal = principal;
  let periodStartDate = startDate;

  // Get all dates where principal changed (payments with principal applied OR further advances)
  const principalChangeEvents = [
    // Repayments reduce principal
    ...repayments
      .filter(tx => tx.principal_applied > 0)
      .map(tx => ({
        date: new Date(tx.date),
        principalApplied: tx.principal_applied,
        disbursementAmount: 0,
        interestApplied: tx.interest_applied || 0,
        amount: tx.amount,
        reference: tx.reference || tx.description || '',
        type: 'repayment'
      })),
    // Further advances increase principal
    ...disbursements.map(tx => ({
      date: new Date(tx.date),
      principalApplied: 0,
      disbursementAmount: tx.amount,
      interestApplied: 0,
      amount: tx.amount,
      reference: tx.reference || tx.description || '',
      type: 'disbursement'
    }))
  ].sort((a, b) => a.date - b.date);

  // The calculation end date is the day AFTER settlement (to include settlement day's interest)
  // This matches how calculateAccruedInterestWithTransactions works
  const calculationEndDate = new Date(settleDate);
  calculationEndDate.setDate(calculationEndDate.getDate() + 1);

  // Build interest periods for display (principal changes BEFORE daily interest calculation)
  let eventIndex = 0;
  while (periodStartDate < calculationEndDate) {
    // Find the end of this period (next principal change or end date)
    let periodEndDate;
    let principalPayment = 0;
    let disbursementAmount = 0;
    let eventDetails = null;

    if (eventIndex < principalChangeEvents.length) {
      const nextEvent = principalChangeEvents[eventIndex];
      if (nextEvent.date <= settleDate) {
        periodEndDate = nextEvent.date;
        principalPayment = nextEvent.principalApplied || 0;
        disbursementAmount = nextEvent.disbursementAmount || 0;
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
      // Calculate interest for this period (for display purposes)
      const periodInterest = runningPrincipal * dailyRate * daysInPeriod;

      // Principal change: add disbursements first, then subtract repayments (matching LoanCalculator order)
      const principalChange = disbursementAmount - principalPayment;

      interestPeriods.push({
        startDate: new Date(periodStartDate),
        endDate: new Date(periodEndDate),
        days: daysInPeriod,
        openingPrincipal: runningPrincipal,
        dailyRate,
        periodInterest,
        principalPayment,
        disbursementAmount,
        closingPrincipal: runningPrincipal + principalChange,
        eventDetails
      });

      // Update principal for next period
      runningPrincipal = Math.max(0, runningPrincipal + principalChange);
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

  // Combine repayments and further advances, sorted by date
  const allTransactions = [
    ...repayments.map(tx => ({ ...tx, txType: 'repayment' })),
    ...disbursements.map(tx => ({ ...tx, txType: 'disbursement' }))
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Process each transaction
  for (const tx of allTransactions) {
    const txDate = new Date(tx.date);

    if (tx.txType === 'repayment') {
      // Repayment reduces principal
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
    } else {
      // Further advance increases principal
      runningPrincipalBal += tx.amount;

      transactionHistory.push({
        date: txDate,
        type: 'Disbursement',
        description: tx.reference || tx.description || 'Further advance',
        amount: tx.amount,
        principalApplied: 0,
        interestApplied: 0,
        principalBalance: runningPrincipalBal
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
  schedule = [],
  product = null
}) {
  const { currentOrganization } = useOrganization();
  const [settlementDate, setSettlementDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showInterestDetails, setShowInterestDetails] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);

  const settlement = loan ? calculateSettlementAmount(loan, settlementDate, transactions, schedule, product) : null;

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
    generateSettlementStatementPDF(loan, settlementData, schedule, transactions, product);
  };

  if (!isOpen || !loan) return null;

  return (
    <div className="h-full flex flex-col bg-white border-l shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-slate-50">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-emerald-600" />
          <h2 className="text-lg font-semibold">Settlement Calculator</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleDownloadPDF} disabled={!settlement}>
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
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
              {settlement ? `${settlement.daysElapsed} days elapsed since loan start` : 'Enter a valid date'}
            </p>
          </div>

          {!settlement ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
              Please enter a valid settlement date to calculate the amount.
            </div>
          ) : (
            <>

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
                      As of {isValid(new Date(settlementDate)) ? format(new Date(settlementDate), 'MMM dd, yyyy') : 'Invalid date'}
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

          </>
          )}

        </div>
      </div>
    </div>
  );
}