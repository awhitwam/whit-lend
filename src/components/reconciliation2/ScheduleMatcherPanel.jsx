import { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Check, AlertTriangle, Calendar, Banknote } from 'lucide-react';
import { findMatchingSchedules } from '@/lib/reconciliation2/scheduleMatching';

export default function ScheduleMatcherPanel({
  entry,
  loans = [],
  schedules = [],
  suggestedMatch,
  onMatch
}) {
  const paymentAmount = Math.abs(entry.amount);

  // Find matching schedules based on entry
  const matchingSchedules = useMemo(() => {
    return findMatchingSchedules(entry, loans, schedules);
  }, [entry, loans, schedules]);

  // State for selection
  const [selectedLoanId, setSelectedLoanId] = useState(
    suggestedMatch?.loan?.id || matchingSchedules[0]?.loan.id || ''
  );
  const [selectedScheduleId, setSelectedScheduleId] = useState(
    suggestedMatch?.schedule?.id || matchingSchedules[0]?.schedule?.id || 'none'
  );
  const [splitMode, setSplitMode] = useState('auto'); // 'auto' or 'manual'
  const [manualSplit, setManualSplit] = useState({
    principal: 0,
    interest: 0,
    fees: 0
  });

  // Get selected loan and schedule
  const selectedLoan = loans.find(l => l.id === selectedLoanId);
  const selectedSchedule = selectedScheduleId && selectedScheduleId !== 'none'
    ? schedules.find(s => s.id === selectedScheduleId)
    : null;

  // Get schedules for selected loan
  const loanSchedules = useMemo(() => {
    return schedules.filter(s =>
      s.loan_id === selectedLoanId &&
      (s.status === 'Pending' || s.status === 'Overdue')
    ).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  }, [schedules, selectedLoanId]);

  // Calculate auto split based on schedule or amount
  const autoSplit = useMemo(() => {
    if (selectedSchedule) {
      const expectedTotal = (selectedSchedule.principal_amount || 0) +
        (selectedSchedule.interest_amount || 0);

      // If payment matches expected, use schedule amounts
      if (Math.abs(paymentAmount - expectedTotal) < expectedTotal * 0.05) {
        return {
          principal: selectedSchedule.principal_amount || 0,
          interest: selectedSchedule.interest_amount || 0,
          fees: 0
        };
      }

      // If overpayment, apply extra to principal
      if (paymentAmount > expectedTotal) {
        return {
          principal: (selectedSchedule.principal_amount || 0) + (paymentAmount - expectedTotal),
          interest: selectedSchedule.interest_amount || 0,
          fees: 0
        };
      }

      // If underpayment, apply to interest first
      if (paymentAmount < expectedTotal) {
        const interestDue = selectedSchedule.interest_amount || 0;
        if (paymentAmount <= interestDue) {
          return {
            principal: 0,
            interest: paymentAmount,
            fees: 0
          };
        }
        return {
          principal: paymentAmount - interestDue,
          interest: interestDue,
          fees: 0
        };
      }
    }

    // No schedule - default split (interest first approach would need accrued interest calc)
    return {
      principal: paymentAmount,
      interest: 0,
      fees: 0
    };
  }, [selectedSchedule, paymentAmount]);

  // Current split values
  const currentSplit = splitMode === 'auto' ? autoSplit : manualSplit;
  const splitTotal = currentSplit.principal + currentSplit.interest + currentSplit.fees;
  const splitMismatch = Math.abs(splitTotal - paymentAmount) > 0.01;

  // Payment type detection
  const paymentType = useMemo(() => {
    if (!selectedSchedule) return null;
    const expectedTotal = (selectedSchedule.principal_amount || 0) +
      (selectedSchedule.interest_amount || 0);
    const diff = paymentAmount - expectedTotal;
    const pct = diff / expectedTotal;

    if (Math.abs(pct) < 0.01) return { type: 'exact', label: 'Exact Match' };
    if (pct > 0.05) return { type: 'over', label: 'Overpayment' };
    if (pct < -0.05) return { type: 'partial', label: 'Partial Payment' };
    return { type: 'close', label: 'Close Match' };
  }, [selectedSchedule, paymentAmount]);

  // Handle manual split changes
  const handleManualSplitChange = (field, value) => {
    const numValue = parseFloat(value) || 0;
    setManualSplit(prev => ({ ...prev, [field]: numValue }));
  };

  // Handle confirm
  const handleConfirm = () => {
    if (selectedLoan && onMatch) {
      onMatch(selectedLoan, selectedSchedule, currentSplit);
    }
  };

  return (
    <div className="space-y-4">
      {/* Loan Selection */}
      <div className="space-y-2">
        <Label>Select Loan</Label>
        <Select value={selectedLoanId} onValueChange={(id) => {
          setSelectedLoanId(id);
          setSelectedScheduleId('none');
        }}>
          <SelectTrigger>
            <SelectValue placeholder="Select loan..." />
          </SelectTrigger>
          <SelectContent>
            {/* Show matching loans first */}
            {matchingSchedules.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-slate-500 font-medium">Suggested Matches</div>
                {matchingSchedules.map(({ loan, score }) => (
                  <SelectItem key={loan.id} value={loan.id}>
                    <div className="flex items-center gap-2">
                      <span>{loan.loan_number} - {loan.borrower_name}</span>
                      <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                        {Math.round(score)}%
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
                <div className="border-t my-1" />
              </>
            )}
            <div className="px-2 py-1 text-xs text-slate-500 font-medium">All Live Loans</div>
            {loans.filter(l => l.status === 'Live').map(loan => (
              <SelectItem key={loan.id} value={loan.id}>
                {loan.loan_number} - {loan.borrower_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule Selection */}
      {selectedLoan && loanSchedules.length > 0 && (
        <div className="space-y-2">
          <Label>Payment Schedule</Label>
          <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
            <SelectTrigger>
              <SelectValue placeholder="Select schedule entry..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No specific schedule</SelectItem>
              {loanSchedules.map(schedule => {
                const total = (schedule.principal_amount || 0) + (schedule.interest_amount || 0);
                return (
                  <SelectItem key={schedule.id} value={schedule.id}>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {format(new Date(schedule.due_date), 'dd MMM yyyy')}
                      <span className="text-slate-500">-</span>
                      <span className="font-mono">{formatCurrency(total)}</span>
                      {schedule.status === 'Overdue' && (
                        <Badge variant="destructive" className="text-xs">Overdue</Badge>
                      )}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Payment Type Badge */}
      {paymentType && (
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              paymentType.type === 'exact' ? 'bg-green-50 text-green-700' :
                paymentType.type === 'over' ? 'bg-blue-50 text-blue-700' :
                  paymentType.type === 'partial' ? 'bg-amber-50 text-amber-700' :
                    'bg-slate-50 text-slate-700'
            }
          >
            {paymentType.label}
          </Badge>
          {selectedSchedule && (
            <span className="text-xs text-slate-500">
              Expected: {formatCurrency((selectedSchedule.principal_amount || 0) + (selectedSchedule.interest_amount || 0))}
            </span>
          )}
        </div>
      )}

      {/* Split Mode */}
      {selectedLoan && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Payment Split</Label>
            <RadioGroup
              value={splitMode}
              onValueChange={setSplitMode}
              className="flex gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="auto" id="auto" />
                <Label htmlFor="auto" className="text-sm font-normal cursor-pointer">Auto</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="manual" id="manual" />
                <Label htmlFor="manual" className="text-sm font-normal cursor-pointer">Manual</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Split Inputs */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Principal</Label>
              <Input
                type="number"
                step="0.01"
                value={splitMode === 'auto' ? autoSplit.principal : manualSplit.principal}
                onChange={(e) => handleManualSplitChange('principal', e.target.value)}
                disabled={splitMode === 'auto'}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Interest</Label>
              <Input
                type="number"
                step="0.01"
                value={splitMode === 'auto' ? autoSplit.interest : manualSplit.interest}
                onChange={(e) => handleManualSplitChange('interest', e.target.value)}
                disabled={splitMode === 'auto'}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Fees</Label>
              <Input
                type="number"
                step="0.01"
                value={splitMode === 'auto' ? autoSplit.fees : manualSplit.fees}
                onChange={(e) => handleManualSplitChange('fees', e.target.value)}
                disabled={splitMode === 'auto'}
                className="font-mono text-sm"
              />
            </div>
          </div>

          {/* Split Total */}
          <div className={`flex items-center justify-between p-2 rounded ${splitMismatch ? 'bg-red-50' : 'bg-green-50'}`}>
            <span className="text-sm">Split Total:</span>
            <div className="flex items-center gap-2">
              <span className={`font-mono font-medium ${splitMismatch ? 'text-red-600' : 'text-green-600'}`}>
                {formatCurrency(splitTotal)}
              </span>
              {splitMismatch ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : (
                <Check className="w-4 h-4 text-green-500" />
              )}
            </div>
          </div>

          {splitMismatch && (
            <p className="text-xs text-red-600">
              Split total ({formatCurrency(splitTotal)}) does not match payment amount ({formatCurrency(paymentAmount)})
            </p>
          )}
        </div>
      )}

      {/* Confirm Button */}
      <Button
        onClick={handleConfirm}
        disabled={!selectedLoan || splitMismatch}
        className="w-full"
        size="sm"
      >
        <Banknote className="w-4 h-4 mr-2" />
        Apply Match
      </Button>
    </div>
  );
}
