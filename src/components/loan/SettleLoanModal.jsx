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

function calculateSettlementAmount(loan, settlementDate) {
  const startDate = new Date(loan.start_date);
  const settleDate = new Date(settlementDate);
  settleDate.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);
  
  const daysElapsed = Math.max(0, differenceInDays(settleDate, startDate));
  const principal = loan.principal_amount;
  const principalPaid = loan.principal_paid || 0;
  const interestPaid = loan.interest_paid || 0;
  const annualRate = loan.interest_rate / 100;
  const dailyRate = annualRate / 365;
  
  const principalRemaining = principal - principalPaid;
  
  let totalInterestDue = 0;
  const dailyBreakdown = [];
  
  if (loan.interest_type === 'Flat') {
    const totalInterest = loan.total_interest;
    const interestPerDay = totalInterest / (loan.duration * (loan.period === 'Monthly' ? 30.417 : 7));
    totalInterestDue = Math.min(interestPerDay * daysElapsed, totalInterest);
    
    for (let day = 1; day <= Math.min(daysElapsed, 14); day++) {
      dailyBreakdown.push({
        day,
        date: new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000),
        balance: principal,
        dailyInterest: interestPerDay
      });
    }
    
  } else if (loan.interest_type === 'Reducing') {
    const periodsPerYear = loan.period === 'Monthly' ? 12 : 52;
    const daysPerPeriod = loan.period === 'Monthly' ? 30.417 : 7;
    const periodRate = annualRate / periodsPerYear;
    const periodsCompleted = Math.min(Math.floor(daysElapsed / daysPerPeriod), loan.duration);
    
    let remainingBalance = principal;
    const pmt = principal * (periodRate * Math.pow(1 + periodRate, loan.duration)) / (Math.pow(1 + periodRate, loan.duration) - 1);
    
    for (let i = 0; i < periodsCompleted; i++) {
      const interestForPeriod = remainingBalance * periodRate;
      totalInterestDue += interestForPeriod;
      const principalForPeriod = pmt - interestForPeriod;
      remainingBalance -= principalForPeriod;
    }
    
    if (daysElapsed > periodsCompleted * daysPerPeriod && remainingBalance > 0) {
      const daysInPartialPeriod = daysElapsed - (periodsCompleted * daysPerPeriod);
      totalInterestDue += remainingBalance * dailyRate * daysInPartialPeriod;
    }
    
    let trackBalance = principal;
    for (let day = 1; day <= Math.min(daysElapsed, 14); day++) {
      const dayInterest = trackBalance * dailyRate;
      dailyBreakdown.push({
        day,
        date: new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000),
        balance: trackBalance,
        dailyInterest: dayInterest
      });
      
      if (day % daysPerPeriod === 0 && day / daysPerPeriod <= loan.duration) {
        const periodNum = day / daysPerPeriod;
        const interestForPeriod = trackBalance * periodRate;
        const principalForPeriod = pmt - interestForPeriod;
        trackBalance -= principalForPeriod;
      }
    }
    
  } else if (loan.interest_type === 'Interest-Only') {
    const periodsPerYear = loan.period === 'Monthly' ? 12 : 52;
    const periodRate = annualRate / periodsPerYear;
    const interestOnlyPeriod = loan.interest_only_period || loan.duration;
    const daysPerPeriod = loan.period === 'Monthly' ? 30.417 : 7;
    const periodsCompleted = Math.min(Math.floor(daysElapsed / daysPerPeriod), interestOnlyPeriod);
    
    totalInterestDue = periodsCompleted * (principal * periodRate);
    
    if (daysElapsed > periodsCompleted * daysPerPeriod && daysElapsed <= interestOnlyPeriod * daysPerPeriod) {
      const partialDays = daysElapsed - (periodsCompleted * daysPerPeriod);
      totalInterestDue += principal * dailyRate * partialDays;
    }
    
    for (let day = 1; day <= Math.min(daysElapsed, 14); day++) {
      dailyBreakdown.push({
        day,
        date: new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000),
        balance: principal,
        dailyInterest: principal * dailyRate
      });
    }
    
  } else if (loan.interest_type === 'Rolled-Up') {
    totalInterestDue = principal * (Math.pow(1 + dailyRate, daysElapsed) - 1);
    
    let compoundBalance = principal;
    for (let day = 1; day <= Math.min(daysElapsed, 14); day++) {
      const dayInterest = compoundBalance * dailyRate;
      dailyBreakdown.push({
        day,
        date: new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000),
        balance: compoundBalance,
        dailyInterest: dayInterest
      });
      compoundBalance += dayInterest;
    }
  }
  
  const interestRemaining = Math.max(0, totalInterestDue - interestPaid);
  const exitFee = loan.exit_fee || 0;
  const settlementAmount = principalRemaining + interestRemaining + exitFee;
  
  return {
    principalRemaining,
    interestRemaining,
    exitFee,
    settlementAmount,
    daysElapsed,
    dailyBreakdown: dailyBreakdown.slice(0, 14)
  };
}

export default function SettleLoanModal({ 
  isOpen, 
  onClose, 
  loan,
  onSubmit, 
  isLoading 
}) {
  const [settlementDate, setSettlementDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const settlement = loan ? calculateSettlementAmount(loan, settlementDate) : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      amount: settlement.settlementAmount,
      date: settlementDate,
      reference,
      notes: notes || `Full settlement of loan as of ${format(new Date(settlementDate), 'MMM dd, yyyy')}`,
      overpayment_option: 'credit'
    });
  };

  const handleDownloadPDF = () => {
    const settlementData = {
      settlementDate: settlementDate,
      principalRemaining: settlement.principalRemaining,
      interestDue: settlement.interestRemaining,
      exitFee: settlement.exitFee,
      totalSettlement: settlement.settlementAmount,
      dailyBreakdown: settlement.dailyBreakdown
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 mb-1">Principal Remaining</p>
                  <p className="text-xl font-bold text-slate-900">
                    {formatCurrency(settlement.principalRemaining)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 mb-1">Interest Due to Date</p>
                  <p className="text-xl font-bold text-amber-600">
                    {formatCurrency(settlement.interestRemaining)}
                  </p>
                </CardContent>
              </Card>
              {settlement.exitFee > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500 mb-1">Exit Fee</p>
                    <p className="text-xl font-bold text-blue-600">
                      {formatCurrency(settlement.exitFee)}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

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
            <h3 className="font-semibold text-slate-900">Payment Details (Optional)</h3>
            
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