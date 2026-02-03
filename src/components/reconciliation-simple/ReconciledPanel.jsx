/**
 * ReconciledPanel - Shows reconciled bank entries grouped by financial year
 *
 * Features:
 * - Financial year grouping (UK: Apr 1 - Mar 31)
 * - Expand/collapse controls
 * - Shows linked transactions (loans, investors, expenses, etc.)
 * - Net receipt group support (multiple bank entries reconciled together)
 * - Unreconcile functionality
 */

import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Undo2,
  Loader2,
  Trash2,
  AlertTriangle,
  Ban,
  Search
} from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { format, parseISO, isValid } from 'date-fns';
import { toast } from 'sonner';
import { api } from '@/api/dataClient';

/**
 * Get UK financial year for a date (Apr 1 - Mar 31)
 * Returns the starting year (e.g., 2025 for FY 2025/26)
 */
function getFinancialYear(date) {
  const d = new Date(date);
  const month = d.getMonth(); // 0-indexed (0 = Jan, 3 = Apr)
  const year = d.getFullYear();
  // If Jan-Mar, it's the previous calendar year's FY
  return month < 3 ? year - 1 : year;
}

/**
 * Format financial year for display (e.g., "2025/26")
 */
function formatFinancialYear(startYear) {
  return `${startYear}/${(startYear + 1).toString().slice(-2)}`;
}

export default function ReconciledPanel({
  entries,
  reconciliationEntries = [],
  loans = [],
  borrowers = [],
  transactions = [],
  investors = [],
  investorTransactions = [],
  investorInterestEntries = [],
  expenses = [],
  expenseTypes = [],
  otherIncome = [],
  onUnreconcile
}) {
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedNetReceiptGroups, setExpandedNetReceiptGroups] = useState(new Set());
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [unreconciling, setUnreconciling] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);

  // Group reconciled entries by financial year
  // Also detect net receipt groups (multiple bank entries linked to same target)
  const reconciledByFinancialYear = useMemo(() => {
    if (!entries || entries.length === 0) return [];

    // First, detect bank entries that share the same target transaction (were grouped together)
    const targetToStatements = new Map();
    entries.forEach(statement => {
      const recons = reconciliationEntries.filter(r => r.bank_statement_id === statement.id);
      recons.forEach(recon => {
        let targetKey = null;
        if (recon.loan_transaction_id) targetKey = `loan:${recon.loan_transaction_id}`;
        else if (recon.investor_transaction_id) targetKey = `inv:${recon.investor_transaction_id}`;
        else if (recon.expense_id) targetKey = `exp:${recon.expense_id}`;
        else if (recon.interest_id) targetKey = `int:${recon.interest_id}`;
        else if (recon.other_income_id) targetKey = `oi:${recon.other_income_id}`;

        if (targetKey) {
          if (!targetToStatements.has(targetKey)) {
            targetToStatements.set(targetKey, new Set());
          }
          targetToStatements.get(targetKey).add(statement.id);
        }
      });
    });

    // Find groups where multiple bank statements link to same target (net receipt matches)
    const netReceiptGroups = new Map();
    targetToStatements.forEach((statementIds) => {
      if (statementIds.size > 1) {
        const groupKey = `netgroup:${[...statementIds].sort().join(',')}`;
        netReceiptGroups.set(groupKey, statementIds);
      }
    });

    // Create virtual grouped entries for net receipt groups
    const processedStatementIds = new Set();
    const virtualStatements = [];

    netReceiptGroups.forEach((statementIds, groupKey) => {
      const statements = [...statementIds].map(id => entries.find(s => s.id === id)).filter(Boolean);
      if (statements.length < 2) return;

      const netAmount = statements.reduce((sum, s) => sum + s.amount, 0);
      const dates = statements.map(s => s.statement_date).filter(Boolean).sort();

      virtualStatements.push({
        id: groupKey,
        isNetReceiptGroup: true,
        groupStatements: statements,
        amount: netAmount,
        statement_date: dates[0],
        description: `${statements.length} grouped entries (net)`,
        is_reconciled: true
      });

      statementIds.forEach(id => processedStatementIds.add(id));
    });

    // Combine: virtual grouped statements + individual statements not in a group
    const allStatements = [
      ...virtualStatements,
      ...entries.filter(s => !processedStatementIds.has(s.id))
    ];

    // Now group by financial year
    const groups = new Map();

    allStatements.forEach(statement => {
      const fyYear = getFinancialYear(statement.statement_date);
      if (!groups.has(fyYear)) {
        groups.set(fyYear, {
          year: fyYear,
          displayDate: formatFinancialYear(fyYear),
          statements: [],
          totalIn: 0,
          totalOut: 0
        });
      }
      const group = groups.get(fyYear);
      group.statements.push(statement);
      if (statement.amount > 0) {
        group.totalIn += statement.amount;
      } else {
        group.totalOut += Math.abs(statement.amount);
      }
    });

    // Sort statements within each group by date descending
    groups.forEach(group => {
      group.statements.sort((a, b) => new Date(b.statement_date) - new Date(a.statement_date));
    });

    // Sort by financial year descending (most recent first)
    return Array.from(groups.values()).sort((a, b) => b.year - a.year);
  }, [entries, reconciliationEntries]);

  // Toggle group expansion
  const toggleGroupExpanded = (year) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  const expandAllGroups = () => {
    setExpandedGroups(new Set(reconciledByFinancialYear.map(g => g.year)));
  };

  const collapseAllGroups = () => {
    setExpandedGroups(new Set());
  };

  const toggleNetReceiptGroupExpanded = (groupId) => {
    setExpandedNetReceiptGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Toggle entry selection
  const toggleEntrySelection = (id) => {
    setSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Handle unreconcile
  const handleUnreconcile = async (entry) => {
    setUnreconciling(entry.id);
    try {
      // First delete all ReconciliationEntry records linking this bank statement to transactions
      // This is critical - without this, the linked transactions (loan_transaction_id, investor_transaction_id,
      // interest_id, expense_id, other_income_id) will still appear as "reconciled" in the matching logic
      await api.entities.ReconciliationEntry.deleteWhere({ bank_statement_id: entry.id });

      // Then update the bank statement
      await api.entities.BankStatement.update(entry.id, {
        is_reconciled: false,
        reconciled_at: null
      });
      toast.success('Entry unreconciled');
      onUnreconcile?.();
    } catch (error) {
      console.error('Error unreconciling:', error);
      toast.error(`Failed to unreconcile: ${error.message}`);
    } finally {
      setUnreconciling(null);
    }
  };

  // Handle delete all reconciled
  const handleDeleteAllReconciled = async () => {
    setIsDeleting(true);
    try {
      let deleted = 0;

      for (const entry of entries) {
        await api.entities.ReconciliationEntry.deleteWhere({ bank_statement_id: entry.id });
        await api.entities.BankStatement.delete(entry.id);
        deleted++;
      }

      setShowDeleteDialog(false);
      toast.success(`Deleted ${deleted} reconciled entries`);
      onUnreconcile?.();
    } catch (error) {
      console.error('Error deleting entries:', error);
      toast.error(`Error deleting entries: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Get detailed reconciliation info for the detail sheet
  const getReconciliationDetails = (entryId) => {
    const recons = reconciliationEntries.filter(r => r.bank_statement_id === entryId);
    const details = [];

    for (const recon of recons) {
      if (recon.loan_transaction_id) {
        const tx = transactions.find(t => t.id === recon.loan_transaction_id);
        if (tx && !tx.is_deleted) {
          const loan = loans.find(l => l.id === tx.loan_id);
          const borrower = borrowers.find(b => b.id === loan?.borrower_id);
          details.push({
            entityType: tx.type === 'Disbursement' ? 'Loan Disbursement' : 'Loan Repayment',
            amount: recon.amount,
            entityDetails: {
              amount: tx.amount,
              date: tx.date,
              loanNumber: loan?.loan_number,
              loanId: loan?.id,
              borrowerName: borrower?.name || loan?.borrower_name,
              principalApplied: tx.principal_applied,
              interestApplied: tx.interest_applied,
              feesApplied: tx.fees_applied,
              reference: tx.reference
            }
          });
        } else {
          details.push({
            entityType: 'Loan Transaction',
            isBrokenLink: true,
            brokenEntityId: recon.loan_transaction_id
          });
        }
      }
      if (recon.investor_transaction_id) {
        const tx = investorTransactions.find(t => t.id === recon.investor_transaction_id);
        const investor = tx ? investors.find(i => i.id === tx.investor_id) : null;
        if (tx) {
          details.push({
            entityType: tx.type === 'withdrawal' ? 'Investor Withdrawal' : 'Investor Deposit',
            amount: recon.amount,
            entityDetails: {
              amount: tx.amount,
              date: tx.date,
              investorName: investor?.business_name || investor?.name,
              investorId: investor?.id,
              capital: tx.capital_amount,
              interest: tx.interest_amount,
              reference: tx.reference
            }
          });
        }
      }
      if (recon.expense_id) {
        const exp = expenses.find(e => e.id === recon.expense_id);
        const expType = exp ? expenseTypes.find(t => t.id === exp.type_id) : null;
        if (exp) {
          details.push({
            entityType: 'Expense',
            amount: recon.amount,
            entityDetails: {
              amount: exp.amount,
              date: exp.date,
              description: exp.description,
              typeName: expType?.name
            }
          });
        }
      }
      if (recon.other_income_id) {
        const income = otherIncome.find(o => o.id === recon.other_income_id);
        if (income) {
          details.push({
            entityType: 'Other Income',
            amount: recon.amount,
            entityDetails: {
              amount: income.amount,
              date: income.date,
              description: income.description
            }
          });
        }
      }
      if (recon.interest_id) {
        const interest = investorInterestEntries.find(i => i.id === recon.interest_id);
        const investor = interest ? investors.find(inv => inv.id === interest.investor_id) : null;
        if (interest) {
          details.push({
            entityType: 'Interest Withdrawal',
            amount: recon.amount,
            entityDetails: {
              amount: interest.amount,
              date: interest.date,
              investorName: investor?.business_name || investor?.name,
              investorId: investor?.id,
              description: interest.description
            }
          });
        }
      }
    }

    return details;
  };

  // Build links for an entry
  const buildLinks = (entry) => {
    const recons = reconciliationEntries.filter(r => r.bank_statement_id === entry.id);
    const links = [];

    for (const recon of recons) {
      if (recon.loan_transaction_id) {
        const tx = transactions.find(t => t.id === recon.loan_transaction_id);
        if (tx && !tx.is_deleted) {
          const loan = loans.find(l => l.id === tx.loan_id);
          const borrower = borrowers.find(b => b.id === loan?.borrower_id);
          links.push({
            type: 'loan',
            label: loan ? `${tx.type || 'Loan'}: ${borrower?.name || loan.borrower_name || 'Unknown'}` : (tx.type || 'Loan Transaction'),
            loanNumber: loan?.loan_number,
            loanId: loan?.id,
            amount: recon.amount,
            txDate: tx.date
          });
        } else {
          links.push({ type: 'broken', label: 'Deleted Loan Transaction', isBroken: true });
        }
      }
      if (recon.investor_transaction_id) {
        const tx = investorTransactions.find(t => t.id === recon.investor_transaction_id);
        const investor = tx ? investors.find(i => i.id === tx.investor_id) : null;
        links.push({
          type: 'investor',
          label: investor ? `${tx?.type?.replace('_', ' ') || 'Investor'}: ${investor.business_name || investor.name}` : (tx?.type?.replace('_', ' ') || 'Investor Transaction'),
          investorId: investor?.id,
          amount: recon.amount,
          txDate: tx?.date
        });
      }
      if (recon.expense_id) {
        const exp = expenses.find(e => e.id === recon.expense_id);
        const expType = exp ? expenseTypes.find(t => t.id === exp.type_id) : null;
        links.push({
          type: 'expense',
          label: expType ? `Expense: ${expType.name}` : 'Expense',
          href: '/Expenses',
          amount: recon.amount,
          txDate: exp?.date
        });
      }
      if (recon.other_income_id) {
        const income = otherIncome.find(o => o.id === recon.other_income_id);
        links.push({
          type: 'other_income',
          label: income ? `Other Income: ${income.description || 'Income'}` : 'Other Income',
          href: '/OtherIncome',
          amount: recon.amount
        });
      }
      if (recon.interest_id) {
        const interest = investorInterestEntries.find(i => i.id === recon.interest_id);
        const investor = interest ? investors.find(inv => inv.id === interest.investor_id) : null;
        links.push({
          type: 'investor_interest',
          label: investor ? `Interest Withdrawal: ${investor.business_name || investor.name}` : 'Interest Withdrawal',
          investorId: investor?.id,
          amount: recon.amount,
          txDate: interest?.date
        });
      }
    }

    return links;
  };

  // Render links
  const renderLinks = (links) => {
    if (links.length === 0) {
      return <span className="text-xs text-slate-400">-</span>;
    }

    return (
      <div className="space-y-0.5">
        {links.map((link, idx) => {
          if (link.isBroken) {
            return (
              <div key={idx} className="text-xs truncate text-red-600 flex items-center gap-1" title="Linked entity was deleted">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span className="font-medium">{link.label}</span>
              </div>
            );
          }

          let linkHref = link.href;
          if (link.type === 'loan' && link.loanId) {
            linkHref = `/LoanDetails?id=${link.loanId}`;
          } else if ((link.type === 'investor' || link.type === 'investor_interest') && link.investorId) {
            linkHref = `/InvestorDetails?id=${link.investorId}`;
          }

          const colorClass = link.type === 'loan' ? 'text-blue-600 hover:text-blue-800' :
            link.type === 'investor' ? 'text-purple-600 hover:text-purple-800' :
            link.type === 'investor_interest' ? 'text-purple-600 hover:text-purple-800' :
            link.type === 'expense' ? 'text-orange-600 hover:text-orange-800' :
            link.type === 'other_income' ? 'text-emerald-600 hover:text-emerald-800' :
            'text-slate-600';

          return (
            <div key={idx} className={`text-xs truncate ${colorClass}`} title={link.label}>
              {linkHref ? (
                <Link to={linkHref} className="font-medium hover:underline">
                  {link.label}
                </Link>
              ) : (
                <span className="font-medium">{link.label}</span>
              )}
              {link.loanNumber && <span className="text-slate-400 ml-1">({link.loanNumber})</span>}
            </div>
          );
        })}
      </div>
    );
  };

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8 text-slate-500">
          No reconciled entries
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>{entries.length} reconciled entries</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete All
          </Button>
        </div>
        {reconciledByFinancialYear.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={expandAllGroups}>
              Expand All
            </Button>
            <Button variant="ghost" size="sm" onClick={collapseAllGroups}>
              Collapse All
            </Button>
          </div>
        )}
      </div>

      {/* Financial Year Groups */}
      {reconciledByFinancialYear.map(group => (
        <div key={group.year} className="border rounded-lg overflow-hidden">
          {/* Group Header */}
          <button
            onClick={() => toggleGroupExpanded(group.year)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <ChevronRight className={`w-4 h-4 transition-transform ${expandedGroups.has(group.year) ? 'rotate-90' : ''}`} />
              <span className="font-medium text-slate-700">FY {group.displayDate}</span>
              <Badge variant="outline" className="text-slate-600">
                {group.statements.length} item{group.statements.length !== 1 ? 's' : ''}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {group.totalIn > 0 && <span className="text-emerald-600 font-medium">+{formatCurrency(group.totalIn)}</span>}
              {group.totalOut > 0 && <span className="text-red-600 font-medium">-{formatCurrency(group.totalOut)}</span>}
            </div>
          </button>

          {/* Group Content - Expandable */}
          {expandedGroups.has(group.year) && (
            <div className="border-t">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b bg-slate-50/50">
                    <th className="px-2 py-2 w-8">
                      <Checkbox
                        checked={group.statements.length > 0 && group.statements.filter(s => !s.isNetReceiptGroup).every(s => selectedEntries.has(s.id))}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedEntries(prev => {
                              const next = new Set(prev);
                              group.statements.filter(s => !s.isNetReceiptGroup).forEach(s => next.add(s.id));
                              return next;
                            });
                          } else {
                            setSelectedEntries(prev => {
                              const next = new Set(prev);
                              group.statements.forEach(s => next.delete(s.id));
                              return next;
                            });
                          }
                        }}
                        className="border-slate-300"
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-24">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-[30%]">Description</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase min-w-[200px]">Links To</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-36">Amount</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {group.statements.map(entry => {
                    // Handle net receipt groups (grouped reconciled entries)
                    if (entry.isNetReceiptGroup) {
                      const isExpanded = expandedNetReceiptGroups.has(entry.id);
                      const netAmount = entry.amount;
                      const firstStatement = entry.groupStatements[0];
                      const groupLinks = firstStatement ? buildLinks(firstStatement) : [];

                      return (
                        <React.Fragment key={entry.id}>
                          {/* Collapsed net receipt group row */}
                          <tr className="bg-blue-50/50 hover:bg-blue-100/50">
                            <td className="px-2 py-1.5">
                              {/* No checkbox for group rows */}
                            </td>
                            <td className="px-3 py-1.5 text-sm text-slate-700">
                              {entry.statement_date && isValid(parseISO(entry.statement_date))
                                ? format(parseISO(entry.statement_date), 'dd MMM yyyy')
                                : '-'}
                            </td>
                            <td className="px-3 py-1.5">
                              <button
                                onClick={() => toggleNetReceiptGroupExpanded(entry.id)}
                                className="flex items-center gap-2 text-left group"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-blue-600" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-blue-600" />
                                )}
                                <span className="text-sm font-medium text-blue-700">
                                  {entry.groupStatements.length} grouped entries
                                </span>
                                <Badge variant="outline" className="text-xs border-blue-300 text-blue-600">
                                  Net
                                </Badge>
                              </button>
                            </td>
                            <td className="px-3 py-1.5 min-w-[200px]">
                              {renderLinks(groupLinks)}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <span className={`font-mono font-bold ${netAmount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {netAmount > 0 ? '+' : ''}{formatCurrency(netAmount)}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleNetReceiptGroupExpanded(entry.id)}
                                title={isExpanded ? "Collapse" : "Expand"}
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </Button>
                            </td>
                          </tr>
                          {/* Expanded: show individual entries */}
                          {isExpanded && entry.groupStatements.map(subEntry => (
                            <tr key={subEntry.id} className="bg-blue-50/30">
                              <td className="px-2 py-1.5">
                                {/* No checkbox for sub-entries */}
                              </td>
                              <td className="px-3 py-1.5 text-sm text-slate-500 pl-8">
                                {subEntry.statement_date && isValid(parseISO(subEntry.statement_date))
                                  ? format(parseISO(subEntry.statement_date), 'dd MMM yyyy')
                                  : '-'}
                              </td>
                              <td className="px-3 py-1.5 pl-8">
                                <div className="text-sm text-slate-600 truncate" title={subEntry.description}>
                                  {subEntry.description || '-'}
                                </div>
                                <div className="text-xs text-slate-400">{subEntry.bank_source}</div>
                              </td>
                              <td className="px-3 py-1.5 min-w-[200px]">
                                <span className="text-xs text-slate-400 italic">Part of grouped match</span>
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <span className={`text-sm ${subEntry.amount > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {subEntry.amount > 0 ? '+' : ''}{formatCurrency(subEntry.amount)}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedEntry(subEntry)}
                                  title="View details"
                                >
                                  <Search className="w-4 h-4 text-slate-400" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    }

                    // Regular (non-grouped) reconciled entry
                    const links = buildLinks(entry);
                    const recons = reconciliationEntries.filter(r => r.bank_statement_id === entry.id);
                    const isOffsetReconciliation = recons.some(r => r.reconciliation_type === 'offset');
                    const isOrphaned = entry.is_reconciled && links.length === 0 && !isOffsetReconciliation && !entry.is_unreconcilable;

                    return (
                      <tr
                        key={entry.id}
                        className={`hover:bg-slate-50 ${selectedEntries.has(entry.id) ? 'bg-purple-100/50' : ''}`}
                      >
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedEntries.has(entry.id)}
                            onCheckedChange={() => toggleEntrySelection(entry.id)}
                            className="border-slate-300"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-sm text-slate-700">
                          {entry.statement_date && isValid(parseISO(entry.statement_date))
                            ? format(parseISO(entry.statement_date), 'dd MMM yyyy')
                            : '-'}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="text-sm truncate" title={entry.description}>
                            {entry.description || '-'}
                          </div>
                          <div className="text-xs text-slate-400">{entry.bank_source}</div>
                        </td>
                        <td className="px-3 py-1.5 min-w-[200px]">
                          {entry.is_unreconcilable ? (
                            <div className="flex items-center gap-1.5">
                              <Ban className="w-4 h-4 flex-shrink-0 text-slate-500" />
                              <span className="text-xs font-medium text-slate-600">Unreconcilable</span>
                            </div>
                          ) : isOrphaned ? (
                            <div className="flex items-center gap-1.5 bg-red-600 text-white px-2 py-1 rounded">
                              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                              <span className="text-sm font-bold">Orphaned - no links</span>
                            </div>
                          ) : (
                            renderLinks(links)
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <span className={`font-mono ${entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {entry.amount > 0 ? '+' : ''}{formatCurrency(entry.amount)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedEntry(entry)}
                            title="View details"
                          >
                            <Search className="w-4 h-4 text-slate-400" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* Delete All Reconciled Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Delete All Reconciled Entries?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {entries.length} reconciled bank statement entries.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <strong>Warning:</strong> This will delete the bank statement records. Any linked transactions will remain but will no longer be associated with bank entries.
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllReconciled}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Entry Details Sheet */}
      <Sheet open={!!selectedEntry} onOpenChange={(open) => { if (!open) setSelectedEntry(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>View Reconciled Entry</SheetTitle>
            <SheetDescription>
              This bank entry has been reconciled to the following transaction(s)
            </SheetDescription>
          </SheetHeader>

          {selectedEntry && (() => {
            const reconciliationDetails = getReconciliationDetails(selectedEntry.id);
            const brokenLinks = reconciliationDetails.filter(d => d.isBrokenLink);
            const validLinks = reconciliationDetails.filter(d => !d.isBrokenLink);

            return (
              <div className="space-y-6 mt-6">
                {/* Bank Statement Summary */}
                <div className="bg-slate-100 rounded-lg p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-3 font-medium">Bank Statement</p>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm text-slate-500">
                        {selectedEntry.statement_date && isValid(parseISO(selectedEntry.statement_date))
                          ? format(parseISO(selectedEntry.statement_date), 'dd MMMM yyyy')
                          : '-'}
                      </p>
                      <p className="text-slate-700 mt-1">{selectedEntry.description}</p>
                      {selectedEntry.external_reference && (
                        <p className="text-xs text-slate-400 mt-1">Ref: {selectedEntry.external_reference}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${selectedEntry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatCurrency(Math.abs(selectedEntry.amount))}
                        <span className={`text-sm font-normal ml-2 ${selectedEntry.amount > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          ({selectedEntry.amount > 0 ? 'Credit' : 'Debit'})
                        </span>
                      </p>
                      <p className="text-xs text-slate-400">{selectedEntry.bank_source}</p>
                    </div>
                  </div>
                </div>

                {/* Unreconcilable Entry Details */}
                {selectedEntry.is_unreconcilable && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-slate-700 mb-3">
                      <Ban className="w-5 h-5" />
                      <span className="font-medium">Marked as Unreconcilable</span>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-slate-500 uppercase mb-1">Reason</p>
                        <p className="text-sm text-slate-700 bg-white p-2 rounded border">
                          {selectedEntry.unreconcilable_reason || 'No reason provided'}
                        </p>
                      </div>
                      <div className="text-xs text-slate-500">
                        Marked on {selectedEntry.unreconcilable_at && isValid(parseISO(selectedEntry.unreconcilable_at))
                          ? format(parseISO(selectedEntry.unreconcilable_at), 'dd MMM yyyy HH:mm')
                          : '-'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Linked Transactions */}
                {!selectedEntry.is_unreconcilable && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-3">
                      Reconciled to {validLinks.length} transaction{validLinks.length !== 1 ? 's' : ''}:
                      {brokenLinks.length > 0 && (
                        <span className="text-red-600 ml-2">
                          ({brokenLinks.length} broken link{brokenLinks.length !== 1 ? 's' : ''})
                        </span>
                      )}
                    </p>

                    {/* Show broken links with warning */}
                    {brokenLinks.length > 0 && (
                      <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 text-red-700 mb-2">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="font-medium text-sm">Linked entity was deleted</span>
                        </div>
                        <p className="text-xs text-red-600">
                          This bank entry was reconciled to entities that no longer exist.
                          Un-reconcile to re-match this entry.
                        </p>
                      </div>
                    )}

                    {/* Valid linked transactions */}
                    <div className="space-y-3">
                      {validLinks.map((detail, idx) => (
                        <div key={idx} className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                          <div className="flex justify-between items-start mb-3">
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
                              {detail.entityType}
                            </Badge>
                            <p className="text-lg font-bold text-slate-700">
                              {formatCurrency(Math.abs(detail.entityDetails?.amount || detail.amount))}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-slate-400 uppercase">Date</p>
                              <p className="text-slate-700">
                                {detail.entityDetails?.date && isValid(parseISO(detail.entityDetails.date))
                                  ? format(parseISO(detail.entityDetails.date), 'dd MMM yyyy')
                                  : '-'}
                              </p>
                            </div>

                            {/* Loan Repayment/Disbursement specific */}
                            {(detail.entityType === 'Loan Repayment' || detail.entityType === 'Loan Disbursement') && (
                              <>
                                <div>
                                  <p className="text-xs text-slate-400 uppercase">Loan</p>
                                  <p className="text-slate-700">{detail.entityDetails?.loanNumber || '-'}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-400 uppercase">Borrower</p>
                                  <p className="text-slate-700">{detail.entityDetails?.borrowerName || '-'}</p>
                                </div>
                                {detail.entityType === 'Loan Repayment' && (
                                  <div className="col-span-2">
                                    <p className="text-xs text-slate-400 uppercase">Allocation</p>
                                    <p className="text-slate-700">
                                      Capital: {formatCurrency(detail.entityDetails?.principalApplied || 0)}
                                      {(detail.entityDetails?.interestApplied > 0) && `, Interest: ${formatCurrency(detail.entityDetails.interestApplied)}`}
                                      {(detail.entityDetails?.feesApplied > 0) && `, Fees: ${formatCurrency(detail.entityDetails.feesApplied)}`}
                                    </p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Investor Deposit/Withdrawal specific */}
                            {(detail.entityType === 'Investor Deposit' || detail.entityType === 'Investor Withdrawal') && (
                              <>
                                <div>
                                  <p className="text-xs text-slate-400 uppercase">Investor</p>
                                  <p className="text-slate-700">{detail.entityDetails?.investorName || '-'}</p>
                                </div>
                                {detail.entityType === 'Investor Withdrawal' && (detail.entityDetails?.capital > 0 || detail.entityDetails?.interest > 0) && (
                                  <div>
                                    <p className="text-xs text-slate-400 uppercase">Split</p>
                                    <p className="text-slate-700">
                                      Capital: {formatCurrency(detail.entityDetails?.capital || 0)}
                                      {detail.entityDetails?.interest > 0 && `, Interest: ${formatCurrency(detail.entityDetails.interest)}`}
                                    </p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Expense specific */}
                            {detail.entityType === 'Expense' && (
                              <>
                                <div>
                                  <p className="text-xs text-slate-400 uppercase">Type</p>
                                  <p className="text-slate-700">{detail.entityDetails?.typeName || '-'}</p>
                                </div>
                                {detail.entityDetails?.description && (
                                  <div className="col-span-2">
                                    <p className="text-xs text-slate-400 uppercase">Description</p>
                                    <p className="text-slate-700">{detail.entityDetails.description}</p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Other Income specific */}
                            {detail.entityType === 'Other Income' && detail.entityDetails?.description && (
                              <div className="col-span-2">
                                <p className="text-xs text-slate-400 uppercase">Description</p>
                                <p className="text-slate-700">{detail.entityDetails.description}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="pt-4 border-t">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      handleUnreconcile(selectedEntry);
                      setSelectedEntry(null);
                    }}
                    disabled={unreconciling === selectedEntry.id}
                  >
                    {unreconciling === selectedEntry.id ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Unreconciling...
                      </>
                    ) : (
                      <>
                        <Undo2 className="w-4 h-4 mr-2" />
                        Unreconcile Entry
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
