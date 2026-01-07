import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock, Banknote, Calculator, ArrowRight } from 'lucide-react';

export default function ProductSettingsGuide() {
  return (
    <div className="space-y-4">
      <Accordion type="multiple" className="space-y-2">
        {/* Interest Type */}
        <AccordionItem value="interest-type" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span className="font-semibold">Interest Type</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Flat Rate */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Flat Rate</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Interest calculated on the <strong>original principal</strong> throughout the entire loan term.
                  Simple to understand but results in higher total interest.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: £100,000 at 12% for 12 months</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Monthly interest: £100,000 × 12% ÷ 12 = <strong>£1,000</strong> (same every month)</li>
                    <li>• Total interest paid: <strong>£12,000</strong></li>
                  </ul>
                </div>
              </div>

              {/* Reducing Balance */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Reducing Balance</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Interest calculated on the <strong>remaining balance</strong>. Standard amortization method —
                  as you pay down principal, interest decreases.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: £100,000 at 12% for 12 months</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Month 1 interest: £100,000 × 12% ÷ 12 = <strong>£1,000</strong></li>
                    <li>• Month 12 interest: £8,885 × 12% ÷ 12 = <strong>£89</strong></li>
                    <li>• Total interest paid: <strong>£6,619</strong> (45% less than flat rate)</li>
                  </ul>
                </div>
              </div>

              {/* Interest-Only */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Interest-Only</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Only interest is paid during the term. Principal is repaid as a <strong>balloon payment</strong> at
                  the end (or after an interest-only period).
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: £100,000 at 12% for 12 months</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Months 1-11: <strong>£1,000</strong> (interest only)</li>
                    <li>• Month 12: <strong>£101,000</strong> (final interest + full principal)</li>
                  </ul>
                </div>
              </div>

              {/* Rolled-Up */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Rolled-Up / Capitalized</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  <strong>No payments</strong> during the term. Interest compounds monthly and is added to the balance.
                  Everything is paid at maturity. Common for development finance.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: £100,000 at 12% for 12 months</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Monthly payments: <strong>£0</strong></li>
                    <li>• Balance grows: £100,000 → £101,000 → £102,010 → ...</li>
                    <li>• Final payment: <strong>£112,683</strong> (principal + compounded interest)</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Calculation Method */}
        <AccordionItem value="calculation-method" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-purple-600" />
              <span className="font-semibold">Calculation Method</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Daily */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">Daily (variable)</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Interest = Principal × (Rate ÷ 365) × Days in period.
                  Payments <strong>vary by month length</strong> (28-31 days).
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: £100,000 at 12%</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• February (28 days): £100,000 × 12% ÷ 365 × 28 = <strong>£920.55</strong></li>
                    <li>• March (31 days): £100,000 × 12% ÷ 365 × 31 = <strong>£1,019.18</strong></li>
                  </ul>
                </div>
              </div>

              {/* Monthly Fixed */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">Monthly Fixed (365/12)</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Interest = Principal × (Rate ÷ 12). <strong>Same amount every month</strong> regardless of actual days.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: £100,000 at 12%</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• February: £100,000 × 12% ÷ 12 = <strong>£1,000</strong></li>
                    <li>• March: £100,000 × 12% ÷ 12 = <strong>£1,000</strong></li>
                  </ul>
                  <p className="text-xs text-slate-500 mt-2 italic">
                    Note: First payment always uses daily calculation (pro-rated from start date)
                  </p>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Interest Timing */}
        <AccordionItem value="interest-timing" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-green-600" />
              <span className="font-semibold">Interest Timing</span>
              <Badge variant="secondary" className="text-xs">Monthly only</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Advance */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Advance</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Interest is due at the <strong>start of each period</strong>. First payment on disbursement date.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: Loan starts January 15</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Jan 15: First interest payment (disbursement day)</li>
                    <li>• Feb 15: Second interest payment</li>
                    <li>• Mar 15: Third interest payment...</li>
                  </ul>
                </div>
              </div>

              {/* Advance, aligned to 1st */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Advance, aligned to 1st of Month</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  First payment on <strong>disbursement date</strong> (pro-rated), then all subsequent payments on the <strong>1st of each month</strong>.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: Loan starts January 15</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Jan 15: Interest for Jan 15-31 (17 days, pro-rated)</li>
                    <li>• Feb 1: Interest for full February</li>
                    <li>• Mar 1: Interest for full March...</li>
                  </ul>
                </div>
              </div>

              {/* Arrears */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Arrears</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Interest is due at the <strong>end of each period</strong> (after it accrues). First payment 1 month after disbursement.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: Loan starts January 15</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Feb 15: First interest payment (covers January)</li>
                    <li>• Mar 15: Second interest payment (covers February)</li>
                    <li>• Apr 15: Third interest payment...</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Interest-Only Period */}
        <AccordionItem value="interest-only-period" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Banknote className="w-4 h-4 text-teal-600" />
              <span className="font-semibold">Interest-Only Period</span>
              <Badge variant="secondary" className="text-xs">Interest-Only type</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Empty */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">Empty / 0</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  <strong>Entire term</strong> is interest-only with a balloon payment at the end.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: 12-month loan</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Months 1-11: Interest only</li>
                    <li>• Month 12: Interest + full principal (balloon)</li>
                  </ul>
                </div>
              </div>

              {/* N periods */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">N periods</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  First N periods are interest-only, then the loan <strong>switches to amortizing</strong>
                  for the remaining term.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: 24-month loan, 12-period interest-only</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Months 1-12: <strong>£1,000/month</strong> (interest only)</li>
                    <li>• Months 13-24: <strong>£8,885/month</strong> (principal + interest amortizing)</li>
                  </ul>
                  <p className="text-xs text-slate-500 mt-2 italic">
                    Useful for construction loans: interest-only during build phase, then repayment begins
                  </p>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Extend for Full Period */}
        <AccordionItem value="extend-full-period" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              <span className="font-semibold">Extend for Full Period</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {/* Off */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">Off (default)</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  If the loan ends mid-period, the final payment is <strong>pro-rated</strong>
                  (partial interest for the days remaining).
                </p>
              </div>

              {/* On */}
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">On</Badge>
                </div>
                <p className="text-sm text-slate-600 mb-2">
                  Loan is <strong>extended to complete the full final period</strong>.
                  Borrower pays full interest for the last period.
                </p>
                <div className="bg-white p-3 rounded border text-sm">
                  <p className="font-medium text-slate-700 mb-1">Example: Loan ends mid-March</p>
                  <ul className="text-slate-600 space-y-1">
                    <li>• Off: Final payment covers days up to settlement date</li>
                    <li>• On: Final payment covers full March (extended to March 31)</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Payment Period */}
        <AccordionItem value="payment-period" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-600" />
              <span className="font-semibold">Payment Period</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">Monthly</Badge>
                </div>
                <p className="text-sm text-slate-600">
                  12 payments per year. Rate applied as Annual Rate ÷ 12.
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">Weekly</Badge>
                </div>
                <p className="text-sm text-slate-600">
                  52 payments per year. Rate applied as Annual Rate ÷ 52.
                </p>
                <p className="text-xs text-slate-500 mt-2 italic">
                  Note: Interest Alignment is not available for weekly loans
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
