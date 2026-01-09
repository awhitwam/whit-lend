import React, { useMemo } from 'react';
import { format, differenceInDays, startOfQuarter, endOfQuarter } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Home, TrendingUp, Calendar, AlertCircle, CheckCircle2, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency } from './LoanCalculator';

/**
 * RentScheduleView - Specialized display for Rent product type loans
 *
 * Features:
 * - Groups payments by quarter
 * - Shows quarterly rent summaries
 * - Displays predicted next rent with confidence level
 * - Visual distinction from regular schedules
 */
export default function RentScheduleView({ schedule, transactions = [], loan, product }) {
  // Analyze the schedule and transactions to build quarterly view
  const { quarters, prediction, pattern } = useMemo(() => {
    const repaymentTransactions = transactions
      .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const disbursementTransactions = transactions
      .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Group payments by quarter
    const quarterMap = new Map();

    repaymentTransactions.forEach(tx => {
      const txDate = new Date(tx.date);
      const year = txDate.getFullYear();
      const quarter = Math.ceil((txDate.getMonth() + 1) / 3);
      const key = `${year}-Q${quarter}`;

      if (!quarterMap.has(key)) {
        const qStart = startOfQuarter(txDate);
        const qEnd = endOfQuarter(txDate);
        quarterMap.set(key, {
          key,
          year,
          quarter,
          label: `Q${quarter} ${year}`,
          startDate: qStart,
          endDate: qEnd,
          payments: [],
          totalRent: 0,
          principalApplied: 0
        });
      }

      const q = quarterMap.get(key);
      q.payments.push(tx);
      q.totalRent += tx.amount || 0;
      q.principalApplied += tx.principal_applied || 0;
    });

    // Convert to sorted array
    const quarters = Array.from(quarterMap.values())
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.quarter - b.quarter;
      });

    // Analyze payment pattern for prediction
    let prediction = null;
    let pattern = { frequency: 'unknown', confidence: 'low', averageAmount: 0 };

    if (repaymentTransactions.length >= 2) {
      // Calculate intervals between payments
      const intervals = [];
      for (let i = 1; i < repaymentTransactions.length; i++) {
        const days = differenceInDays(
          new Date(repaymentTransactions[i].date),
          new Date(repaymentTransactions[i - 1].date)
        );
        intervals.push(days);
      }

      const avgInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;

      // Determine frequency
      let frequency;
      let normalizedInterval;
      if (avgInterval >= 300 && avgInterval <= 400) {
        frequency = 'annual';
        normalizedInterval = 365;
      } else if (avgInterval >= 75 && avgInterval <= 120) {
        frequency = 'quarterly';
        normalizedInterval = 91;
      } else if (avgInterval >= 25 && avgInterval <= 40) {
        frequency = 'monthly';
        normalizedInterval = 30;
      } else {
        frequency = 'irregular';
        normalizedInterval = Math.round(avgInterval);
      }

      // Calculate weighted average amount (more weight on recent payments)
      const recentPayments = repaymentTransactions.slice(-4);
      const weights = recentPayments.map((_, i) => i + 1);
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      const weightedSum = recentPayments.reduce((sum, p, i) => sum + (p.amount * weights[i]), 0);
      const averageAmount = weightedSum / totalWeight;

      // Calculate confidence from variance
      const variance = intervals.reduce((sum, d) => sum + Math.pow(d - avgInterval, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      const confidence = stdDev < 15 ? 'high' : stdDev < 30 ? 'medium' : 'low';

      pattern = {
        frequency,
        confidence,
        averageAmount: Math.round(averageAmount * 100) / 100,
        intervalDays: normalizedInterval,
        avgIntervalDays: Math.round(avgInterval),
        stdDev: Math.round(stdDev),
        paymentCount: repaymentTransactions.length
      };

      // Predict next payment
      const lastPayment = repaymentTransactions[repaymentTransactions.length - 1];
      const lastDate = new Date(lastPayment.date);
      let nextDate;

      switch (frequency) {
        case 'quarterly':
          nextDate = new Date(lastDate);
          nextDate.setMonth(nextDate.getMonth() + 3);
          break;
        case 'annual':
          nextDate = new Date(lastDate);
          nextDate.setFullYear(nextDate.getFullYear() + 1);
          break;
        case 'monthly':
          nextDate = new Date(lastDate);
          nextDate.setMonth(nextDate.getMonth() + 1);
          break;
        default:
          nextDate = new Date(lastDate);
          nextDate.setDate(nextDate.getDate() + normalizedInterval);
      }

      const today = new Date();
      if (nextDate > today) {
        const nextQuarter = Math.ceil((nextDate.getMonth() + 1) / 3);
        const nextYear = nextDate.getFullYear();
        prediction = {
          date: nextDate,
          amount: averageAmount,
          quarter: `Q${nextQuarter} ${nextYear}`,
          daysUntil: differenceInDays(nextDate, today),
          confidence
        };
      }
    } else if (repaymentTransactions.length === 1) {
      pattern = {
        frequency: 'insufficient_data',
        confidence: 'low',
        averageAmount: repaymentTransactions[0].amount,
        paymentCount: 1
      };
    }

    return { quarters, prediction, pattern, disbursementTransactions };
  }, [schedule, transactions]);

  // Calculate totals
  const totalRentReceived = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
    .reduce((sum, tx) => sum + (tx.amount || 0), 0);

  const totalPrincipalRepaid = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Repayment')
    .reduce((sum, tx) => sum + (tx.principal_applied || 0), 0);

  const principalBalance = (loan?.principal_amount || 0) - totalPrincipalRepaid;

  // Get initial disbursement
  const initialDisbursement = transactions
    .filter(tx => !tx.is_deleted && tx.type === 'Disbursement')
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  const getConfidenceBadge = (confidence) => {
    switch (confidence) {
      case 'high':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">High confidence</Badge>;
      case 'medium':
        return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Medium confidence</Badge>;
      default:
        return <Badge className="bg-slate-100 text-slate-600 border-slate-200">Low confidence</Badge>;
    }
  };

  const getFrequencyLabel = (frequency) => {
    switch (frequency) {
      case 'quarterly': return 'Quarterly';
      case 'annual': return 'Annual';
      case 'monthly': return 'Monthly';
      case 'irregular': return 'Irregular';
      case 'insufficient_data': return 'Insufficient data';
      default: return 'Unknown';
    }
  };

  return (
    <div className="space-y-4">
      {/* Pattern Detection Summary */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Home className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-emerald-900">Rent Income Analysis</h3>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-emerald-600">Detected Pattern</p>
                <p className="font-semibold text-emerald-900">{getFrequencyLabel(pattern.frequency)}</p>
              </div>
              <div>
                <p className="text-emerald-600">Average Rent</p>
                <p className="font-semibold text-emerald-900">{formatCurrency(pattern.averageAmount)}</p>
              </div>
              <div>
                <p className="text-emerald-600">Payments Analyzed</p>
                <p className="font-semibold text-emerald-900">{pattern.paymentCount || 0}</p>
              </div>
              <div>
                <p className="text-emerald-600">Pattern Confidence</p>
                {getConfidenceBadge(pattern.confidence)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Prediction Card */}
      {prediction && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-blue-900">Next Expected Rent</h3>
                {getConfidenceBadge(prediction.confidence)}
              </div>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-blue-600">Expected Date</p>
                  <p className="font-semibold text-blue-900">{format(prediction.date, 'dd MMM yyyy')}</p>
                </div>
                <div>
                  <p className="text-blue-600">Quarter</p>
                  <p className="font-semibold text-blue-900">{prediction.quarter}</p>
                </div>
                <div>
                  <p className="text-blue-600">Expected Amount</p>
                  <p className="font-semibold text-blue-900">{formatCurrency(prediction.amount)}</p>
                </div>
                <div>
                  <p className="text-blue-600">Days Until Due</p>
                  <p className="font-semibold text-blue-900">
                    {prediction.daysUntil} days
                    {prediction.daysUntil <= 14 && (
                      <Badge className="ml-2 bg-amber-100 text-amber-700">Soon</Badge>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Totals */}
      <div className="bg-slate-100 rounded-lg p-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-slate-600">Principal Outstanding</p>
            <p className="font-bold text-lg text-slate-900">{formatCurrency(principalBalance)}</p>
          </div>
          <div>
            <p className="text-slate-600">Total Rent Received</p>
            <p className="font-bold text-lg text-emerald-600">{formatCurrency(totalRentReceived)}</p>
          </div>
          <div>
            <p className="text-slate-600">Quarters with Rent</p>
            <p className="font-bold text-lg text-slate-900">{quarters.length}</p>
          </div>
        </div>
      </div>

      {/* Quarterly Rent Table */}
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="font-semibold">Quarter</TableHead>
            <TableHead className="font-semibold">Period</TableHead>
            <TableHead className="font-semibold text-center">Payments</TableHead>
            <TableHead className="font-semibold text-right">Total Rent</TableHead>
            <TableHead className="font-semibold text-right">Principal Applied</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Initial Disbursement Row */}
          {initialDisbursement && (
            <TableRow className="bg-red-50/50 border-l-4 border-red-500">
              <TableCell className="font-semibold text-red-700">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Initial Investment
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {format(new Date(initialDisbursement.date), 'dd MMM yyyy')}
              </TableCell>
              <TableCell className="text-center">—</TableCell>
              <TableCell className="text-right font-mono">—</TableCell>
              <TableCell className="text-right font-mono text-red-600 font-semibold">
                {formatCurrency(initialDisbursement.amount)}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  Disbursed
                </Badge>
              </TableCell>
            </TableRow>
          )}

          {/* Quarterly Rows */}
          {quarters.map((q) => (
            <TableRow key={q.key} className="hover:bg-emerald-50/30">
              <TableCell className="font-semibold">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <span className="text-xs font-bold text-emerald-700">Q{q.quarter}</span>
                  </div>
                  <span className="text-emerald-900">{q.label}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-600">
                {format(q.startDate, 'dd MMM')} - {format(q.endDate, 'dd MMM yyyy')}
              </TableCell>
              <TableCell className="text-center">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="bg-slate-50">
                        {q.payments.length} payment{q.payments.length !== 1 ? 's' : ''}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      <div className="space-y-1 text-xs">
                        <p className="font-semibold">Payments in {q.label}:</p>
                        {q.payments.map((p, idx) => (
                          <p key={idx}>
                            {format(new Date(p.date), 'dd MMM yyyy')}: {formatCurrency(p.amount)}
                            {p.reference && ` (${p.reference})`}
                          </p>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell className="text-right font-mono font-semibold text-emerald-600">
                {formatCurrency(q.totalRent)}
              </TableCell>
              <TableCell className="text-right font-mono text-slate-600">
                {q.principalApplied > 0 ? formatCurrency(q.principalApplied) : '—'}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Received
                </Badge>
              </TableCell>
            </TableRow>
          ))}

          {/* Predicted Next Quarter */}
          {prediction && (
            <TableRow className="bg-blue-50/50 border-l-4 border-blue-400 border-dashed">
              <TableCell className="font-semibold">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center border-2 border-dashed border-blue-300">
                    <span className="text-xs font-bold text-blue-700">
                      Q{Math.ceil((prediction.date.getMonth() + 1) / 3)}
                    </span>
                  </div>
                  <span className="text-blue-800">{prediction.quarter}</span>
                  <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
                    Predicted
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="text-sm text-blue-600">
                Expected: {format(prediction.date, 'dd MMM yyyy')}
              </TableCell>
              <TableCell className="text-center">
                <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">
                  Expected
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-blue-600">
                ~{formatCurrency(prediction.amount)}
              </TableCell>
              <TableCell className="text-right font-mono text-slate-400">—</TableCell>
              <TableCell>
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  <Clock className="w-3 h-3 mr-1" />
                  Pending
                </Badge>
              </TableCell>
            </TableRow>
          )}

          {/* Empty state */}
          {quarters.length === 0 && !prediction && (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                <p>No rent payments recorded yet.</p>
                <p className="text-sm mt-1">Record rent payments to see quarterly analysis and predictions.</p>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// Self-register with RentScheduler to avoid circular import issues
// (RentScheduler can't import this component directly)
import { getScheduler } from '@/lib/schedule';
const RentSchedulerClass = getScheduler('rent');
if (RentSchedulerClass) {
  RentSchedulerClass.ViewComponent = RentScheduleView;
}
