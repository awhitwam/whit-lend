import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { X, Check, AlertTriangle, Layers } from 'lucide-react';
import { INTENT_CONFIG } from './IntentBadge';
import ScheduleMatcherPanel from './ScheduleMatcherPanel';
import GuardrailAlerts from './GuardrailAlerts';

// Intent options grouped by direction
const CREDIT_INTENTS = ['loan_repayment', 'interest_only_payment', 'investor_funding'];
const DEBIT_INTENTS = ['loan_disbursement', 'investor_withdrawal', 'investor_interest', 'operating_expense', 'platform_fee'];

export default function InboxRowExpanded({
  entry,
  classification,
  loans = [],
  investors = [],
  schedules = [],
  expenseTypes = [],
  onClose,
  onReconcile
}) {
  const isCredit = entry.amount > 0;
  const [selectedIntent, setSelectedIntent] = useState(classification?.intent || 'unknown');
  const [matchedEntity, setMatchedEntity] = useState(null);
  const [splitData, setSplitData] = useState(null);
  const [guardrails] = useState([]);

  // Get the suggested match if classification found one
  const suggestedMatch = classification?.suggestedMatch;
  const isGroupedMatch = suggestedMatch?.matchMode === 'match_group';

  // Initialize matchedEntity from classification when it changes
  useEffect(() => {
    if (suggestedMatch) {
      if (isGroupedMatch && suggestedMatch.existingTransactions) {
        // For grouped matches, set up the entity with the transactions
        setMatchedEntity({
          type: 'loan_group',
          existingTransactions: suggestedMatch.existingTransactions,
          borrowerId: suggestedMatch.borrowerId
        });
      } else if (suggestedMatch.loan) {
        setMatchedEntity({ type: 'loan', loan: suggestedMatch.loan });
      } else if (suggestedMatch.investor) {
        setMatchedEntity({ type: 'investor', investor: suggestedMatch.investor });
      } else if (suggestedMatch.expenseType) {
        setMatchedEntity({ type: 'expense', expenseType: suggestedMatch.expenseType });
      }
    }
  }, [suggestedMatch, isGroupedMatch]);

  // Get available intents based on transaction direction
  const availableIntents = isCredit ? CREDIT_INTENTS : DEBIT_INTENTS;

  // Determine which panel to show based on intent
  const renderIntentPanel = () => {
    // Show grouped match panel if we have a grouped match
    if (isGroupedMatch && matchedEntity?.type === 'loan_group' && selectedIntent === 'loan_repayment') {
      const txGroup = matchedEntity.existingTransactions || [];
      const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <Label className="text-blue-700">Grouped Payment Match</Label>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              {txGroup.length} loans
            </Badge>
          </div>
          <div className="bg-blue-50 rounded-lg border border-blue-200 divide-y divide-blue-100 max-h-48 overflow-y-auto">
            {txGroup.map((tx, idx) => {
              const loan = loans.find(l => l.id === tx.loan_id);
              return (
                <div key={tx.id || idx} className="p-2 flex justify-between items-center text-sm">
                  <div>
                    <p className="font-medium">{loan?.loan_number || 'Unknown'}</p>
                    <p className="text-xs text-slate-500">{loan?.borrower_name}</p>
                  </div>
                  <span className="font-mono text-emerald-600">{formatCurrency(tx.amount)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between items-center p-2 bg-blue-100 rounded-lg">
            <span className="font-medium text-blue-800">Total:</span>
            <span className="font-mono font-bold text-blue-800">{formatCurrency(groupTotal)}</span>
          </div>
          {Math.abs(groupTotal - Math.abs(entry.amount)) < 0.01 && (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <Check className="w-3 h-3" />
              Amounts match exactly
            </p>
          )}
        </div>
      );
    }

    switch (selectedIntent) {
      case 'loan_repayment':
      case 'interest_only_payment':
        return (
          <ScheduleMatcherPanel
            entry={entry}
            loans={loans}
            schedules={schedules}
            suggestedMatch={suggestedMatch}
            onMatch={(loan, schedule, split) => {
              setMatchedEntity({ type: 'loan', loan, schedule });
              setSplitData(split);
            }}
          />
        );

      case 'loan_disbursement':
        return (
          <div className="space-y-3">
            <Label>Select Loan</Label>
            <Select
              value={matchedEntity?.loan?.id || ''}
              onValueChange={(id) => {
                const loan = loans.find(l => l.id === id);
                setMatchedEntity({ type: 'loan', loan });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select loan..." />
              </SelectTrigger>
              <SelectContent>
                {loans.filter(l => l.status === 'Approved' || l.status === 'Live').map(loan => (
                  <SelectItem key={loan.id} value={loan.id}>
                    {loan.loan_number} - {loan.borrower_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case 'investor_funding':
      case 'investor_withdrawal':
      case 'investor_interest':
        return (
          <div className="space-y-3">
            <Label>Select Investor</Label>
            <Select
              value={matchedEntity?.investor?.id || ''}
              onValueChange={(id) => {
                const investor = investors.find(i => i.id === id);
                setMatchedEntity({ type: 'investor', investor });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select investor..." />
              </SelectTrigger>
              <SelectContent>
                {investors.filter(i => i.status === 'Active').map(investor => (
                  <SelectItem key={investor.id} value={investor.id}>
                    {investor.name}
                    {investor.account_number && ` (${investor.account_number})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedIntent === 'investor_interest' && matchedEntity?.investor && (
              <div className="p-3 bg-slate-100 rounded-lg text-sm">
                <p className="text-slate-600">Interest payment to investor</p>
                <p className="font-medium">{formatCurrency(Math.abs(entry.amount))}</p>
              </div>
            )}
          </div>
        );

      case 'operating_expense':
        return (
          <div className="space-y-3">
            <Label>Expense Type</Label>
            <Select
              value={matchedEntity?.expenseType?.id || ''}
              onValueChange={(id) => {
                const expenseType = expenseTypes.find(t => t.id === id);
                setMatchedEntity({ type: 'expense', expenseType });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select expense type..." />
              </SelectTrigger>
              <SelectContent>
                {expenseTypes.map(type => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-2">
              <Label>Associated Loan (Optional)</Label>
              <Select
                value={matchedEntity?.loan?.id || 'none'}
                onValueChange={(id) => {
                  if (id === 'none') {
                    setMatchedEntity(prev => ({ ...prev, loan: null }));
                  } else {
                    const loan = loans.find(l => l.id === id);
                    setMatchedEntity(prev => ({ ...prev, loan }));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No loan (platform expense)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No loan (platform expense)</SelectItem>
                  {loans.filter(l => l.status === 'Live').map(loan => (
                    <SelectItem key={loan.id} value={loan.id}>
                      {loan.loan_number} - {loan.borrower_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      default:
        return (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            Select a classification to continue
          </div>
        );
    }
  };

  const handleReconcile = () => {
    if (onReconcile) {
      onReconcile({
        entryId: entry.id,
        intent: selectedIntent,
        matchedEntity,
        splitData
      });
    }
  };

  const canReconcile = selectedIntent !== 'unknown' && matchedEntity;

  return (
    <div className="p-4 border-t border-slate-200">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Bank Entry Details */}
        <Card className="bg-white">
          <CardContent className="p-4 space-y-3">
            <h4 className="font-medium text-sm text-slate-500">Bank Entry</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Date:</span>
                <span className="font-medium">
                  {entry.statement_date
                    ? format(new Date(entry.statement_date), 'dd MMM yyyy')
                    : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount:</span>
                <span className={`font-mono font-bold ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(entry.amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Reference:</span>
                <span className="font-medium truncate max-w-[150px]">
                  {entry.reference || '-'}
                </span>
              </div>
              <div className="pt-2 border-t">
                <span className="text-slate-500 text-xs">Description:</span>
                <p className="text-slate-700 mt-1">{entry.description || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Middle: Intent Selection & Matching */}
        <Card className="bg-white">
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-sm text-slate-500">Classification</Label>
              <Select value={selectedIntent} onValueChange={setSelectedIntent}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableIntents.map(intent => (
                    <SelectItem key={intent} value={intent}>
                      <div className="flex items-center gap-2">
                        {INTENT_CONFIG[intent]?.label || intent}
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem value="unknown">Unknown / Skip</SelectItem>
                </SelectContent>
              </Select>
              {classification?.confidence > 0 && (
                <p className="text-xs text-slate-500">
                  Auto-classified with {Math.round(classification.confidence)}% confidence
                </p>
              )}
            </div>

            {renderIntentPanel()}
          </CardContent>
        </Card>

        {/* Right: Preview & Actions */}
        <Card className="bg-white">
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-slate-500">Preview</h4>

            {matchedEntity && (
              <div className="p-3 bg-slate-50 rounded-lg space-y-2 text-sm">
                {matchedEntity.type === 'loan_group' && matchedEntity.existingTransactions && (
                  <>
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-600" />
                      <p className="font-medium text-blue-700">Grouped Payment</p>
                    </div>
                    <p className="text-slate-500">
                      {matchedEntity.existingTransactions.length} loan repayments
                    </p>
                    <div className="flex justify-between pt-2 border-t">
                      <span>Total:</span>
                      <span className="font-mono font-bold text-emerald-600">
                        {formatCurrency(matchedEntity.existingTransactions.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0))}
                      </span>
                    </div>
                  </>
                )}
                {matchedEntity.type === 'loan' && matchedEntity.loan && (
                  <>
                    <p className="font-medium">{matchedEntity.loan.borrower_name}</p>
                    <p className="text-slate-500">{matchedEntity.loan.loan_number}</p>
                    {splitData && (
                      <div className="pt-2 border-t space-y-1">
                        <div className="flex justify-between">
                          <span>Principal:</span>
                          <span className="font-mono">{formatCurrency(splitData.principal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Interest:</span>
                          <span className="font-mono">{formatCurrency(splitData.interest)}</span>
                        </div>
                        {splitData.fees > 0 && (
                          <div className="flex justify-between">
                            <span>Fees:</span>
                            <span className="font-mono">{formatCurrency(splitData.fees)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                {matchedEntity.type === 'investor' && matchedEntity.investor && (
                  <>
                    <p className="font-medium">{matchedEntity.investor.name}</p>
                    {matchedEntity.investor.account_number && (
                      <p className="text-slate-500">Account: {matchedEntity.investor.account_number}</p>
                    )}
                  </>
                )}
                {matchedEntity.type === 'expense' && matchedEntity.expenseType && (
                  <>
                    <p className="font-medium">{matchedEntity.expenseType.name}</p>
                    {matchedEntity.loan && (
                      <p className="text-slate-500">Linked to: {matchedEntity.loan.borrower_name}</p>
                    )}
                  </>
                )}
              </div>
            )}

            <GuardrailAlerts alerts={guardrails} />

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!canReconcile}
                onClick={handleReconcile}
              >
                <Check className="w-4 h-4 mr-2" />
                Reconcile
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
