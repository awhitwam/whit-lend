import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload, CheckCircle2, AlertCircle, Loader2, Search, FileCheck,
  ArrowUpRight, ArrowDownLeft, Check, Link2, Unlink,
  Sparkles, Wand2, Zap, CheckSquare, Receipt, Coins
} from 'lucide-react';
import { format, parseISO, isValid, differenceInDays } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { parseBankStatement, getBankSources, parseCSV, detectBankFormat } from '@/lib/bankStatementParsers';

// Fuzzy matching utilities
function extractKeywords(text) {
  if (!text) return [];
  // Remove common words and extract meaningful keywords
  const stopWords = ['from', 'to', 'the', 'and', 'for', 'with', 'payment', 'transfer', 'in', 'out', 'ltd', 'limited'];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));
}

function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  const words1 = extractKeywords(s1);
  const words2 = extractKeywords(s2);
  if (words1.length === 0 || words2.length === 0) return 0;

  const matches = words1.filter(w1 =>
    words2.some(w2 => w1.includes(w2) || w2.includes(w1))
  );
  return matches.length / Math.max(words1.length, words2.length);
}

function normalizeAmount(amount) {
  return Math.abs(parseFloat(amount) || 0);
}

// Check if two dates are within a certain number of days
function datesWithinDays(date1, date2, days) {
  if (!date1 || !date2) return false;
  try {
    const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
    const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
    if (!isValid(d1) || !isValid(d2)) return false;
    const diffMs = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= days;
  } catch {
    return false;
  }
}

// Check if amounts match within a tolerance (default 1%)
function amountsMatch(amount1, amount2, tolerancePercent = 1) {
  const a1 = Math.abs(parseFloat(amount1) || 0);
  const a2 = Math.abs(parseFloat(amount2) || 0);
  if (a1 === 0 && a2 === 0) return true;
  if (a1 === 0 || a2 === 0) return false;
  const diff = Math.abs(a1 - a2);
  const tolerance = Math.max(a1, a2) * (tolerancePercent / 100);
  return diff <= tolerance;
}

// Calculate match score based on date and amount proximity
function calculateMatchScore(bankEntry, transaction, dateField = 'date') {
  const entryAmount = Math.abs(parseFloat(bankEntry.amount) || 0);
  const txAmount = Math.abs(parseFloat(transaction.amount) || 0);

  // Exact amount match is very strong
  const exactAmount = amountsMatch(entryAmount, txAmount, 0.1);
  const closeAmount = amountsMatch(entryAmount, txAmount, 5);

  // Calculate actual day difference
  const bankDate = bankEntry.statement_date ? parseISO(bankEntry.statement_date) : null;
  const txDate = transaction[dateField] ? parseISO(transaction[dateField]) : null;
  let daysDiff = Infinity;

  if (bankDate && txDate && isValid(bankDate) && isValid(txDate)) {
    daysDiff = Math.abs(differenceInDays(bankDate, txDate));
  }

  // Date proximity flags
  const sameDay = daysDiff === 0;
  const within3Days = daysDiff <= 3;
  const within7Days = daysDiff <= 7;
  const within14Days = daysDiff <= 14;
  const within30Days = daysDiff <= 30;

  // Calculate base score
  let score = 0;

  if (exactAmount && sameDay) {
    score = 0.95; // Near perfect match
  } else if (exactAmount && within3Days) {
    score = 0.85;
  } else if (exactAmount && within7Days) {
    score = 0.75;
  } else if (closeAmount && sameDay) {
    score = 0.70;
  } else if (closeAmount && within3Days) {
    score = 0.60;
  } else if (exactAmount && within14Days) {
    score = 0.50; // Amount matches but date is 8-14 days off
  } else if (closeAmount && within7Days) {
    score = 0.45;
  } else if (exactAmount && within30Days) {
    score = 0.30; // Amount matches but date is 15-30 days off
  } else if (closeAmount && within14Days) {
    score = 0.25;
  } else if (exactAmount || closeAmount) {
    // Dates are over 30 days apart - cap at 10%
    score = 0.10;
  }

  return score;
}

export default function BankReconciliation() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Import state
  const [bankSource, setBankSource] = useState('allica');
  const [file, setFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  // Filter state
  const [filter, setFilter] = useState('unreconciled'); // all, unreconciled, reconciled, suggested
  const [searchTerm, setSearchTerm] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState('all'); // all, 100, 90, 70, 50, none

  // Auto-reconcile state
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [autoMatchResults, setAutoMatchResults] = useState(null);

  // Reconciliation modal state
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [reviewingSuggestion, setReviewingSuggestion] = useState(null); // The suggestion being reviewed (null = manual mode)
  const [reconciliationType, setReconciliationType] = useState('');
  const [matchMode, setMatchMode] = useState('create'); // create or match
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [selectedInvestor, setSelectedInvestor] = useState(null);
  const [selectedExpenseType, setSelectedExpenseType] = useState(null);
  const [selectedExistingTx, setSelectedExistingTx] = useState(null);
  const [entitySearch, setEntitySearch] = useState('');
  const [splitAmounts, setSplitAmounts] = useState({ capital: 0, interest: 0, fees: 0 });
  const [expenseDescription, setExpenseDescription] = useState('');
  const [isReconciling, setIsReconciling] = useState(false);
  const [savePattern, setSavePattern] = useState(true);

  // Offset reconciliation state
  const [selectedOffsetEntries, setSelectedOffsetEntries] = useState([]);
  const [offsetNotes, setOffsetNotes] = useState('');

  // Bulk selection state
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [isBulkMatching, setIsBulkMatching] = useState(false);
  const [bulkMatchProgress, setBulkMatchProgress] = useState({ current: 0, total: 0 });

  // Bulk expense creation state
  const [entryExpenseTypes, setEntryExpenseTypes] = useState(new Map()); // Map of entryId -> expenseTypeId
  const [isBulkCreatingExpenses, setIsBulkCreatingExpenses] = useState(false);
  const [bulkExpenseProgress, setBulkExpenseProgress] = useState({ current: 0, total: 0 });

  const setEntryExpenseType = (entryId, expenseTypeId) => {
    setEntryExpenseTypes(prev => {
      const next = new Map(prev);
      if (expenseTypeId) {
        next.set(entryId, expenseTypeId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
    // Auto-select the row when an expense type is assigned
    if (expenseTypeId) {
      setSelectedEntries(prev => {
        const next = new Set(prev);
        next.add(entryId);
        return next;
      });
    }
  };

  // Bulk other income creation state
  const [entryOtherIncome, setEntryOtherIncome] = useState(new Set()); // Set of entryIds marked as Other Income
  const [isBulkCreatingOtherIncome, setIsBulkCreatingOtherIncome] = useState(false);
  const [bulkOtherIncomeProgress, setBulkOtherIncomeProgress] = useState({ current: 0, total: 0 });

  const toggleEntryOtherIncome = (entryId, checked) => {
    setEntryOtherIncome(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
    // Auto-select the row when marked as other income
    if (checked) {
      setSelectedEntries(prev => {
        const next = new Set(prev);
        next.add(entryId);
        return next;
      });
    }
  };

  // State for viewing/un-reconciling entries
  const [isUnreconciling, setIsUnreconciling] = useState(false);

  // Fetch bank statements
  const { data: bankStatements = [], isLoading: statementsLoading } = useQuery({
    queryKey: ['bank-statements'],
    queryFn: () => api.entities.BankStatement.list('-statement_date')
  });

  // Fetch reconciliation patterns
  const { data: patterns = [] } = useQuery({
    queryKey: ['reconciliation-patterns'],
    queryFn: () => api.entities.ReconciliationPattern.list('-match_count')
  });

  // Fetch loans for matching
  const { data: loans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list()
  });

  // Fetch borrowers for loan display
  const { data: borrowers = [] } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list()
  });

  // Fetch investors for matching
  const { data: investors = [] } = useQuery({
    queryKey: ['investors'],
    queryFn: () => api.entities.Investor.list()
  });

  // Fetch investor products (to check for manual entry type)
  const { data: investorProducts = [] } = useQuery({
    queryKey: ['investor-products'],
    queryFn: () => api.entities.InvestorProduct.list('name')
  });

  // Fetch expense types
  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => api.entities.ExpenseType.list()
  });

  // Fetch expenses for matching
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.entities.Expense.list('-date')
  });

  // Fetch loan transactions for matching
  const { data: loanTransactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.entities.Transaction.list('-date')
  });

  // Fetch investor transactions for matching
  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investor-transactions'],
    queryFn: () => api.entities.InvestorTransaction.list('-date')
  });

  // Fetch reconciliation entries
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['reconciliation-entries'],
    queryFn: () => api.entities.ReconciliationEntry.list()
  });

  // Get borrower name for loan
  const getBorrowerName = (borrowerId) => {
    const borrower = borrowers.find(b => b.id === borrowerId);
    return borrower?.business_name || borrower?.full_name || 'Unknown';
  };

  // Build set of already-reconciled transaction IDs for quick lookup
  const reconciledTxIds = useMemo(() => {
    const ids = new Set();
    reconciliationEntries.forEach(re => {
      if (re.loan_transaction_id) ids.add(re.loan_transaction_id);
      if (re.investor_transaction_id) ids.add(re.investor_transaction_id);
      if (re.expense_id) ids.add(re.expense_id);
    });
    return ids;
  }, [reconciliationEntries]);

  // Handle URL parameter to open a specific bank statement
  useEffect(() => {
    const viewId = searchParams.get('view');
    if (viewId && bankStatements.length > 0 && !statementsLoading) {
      const entry = bankStatements.find(s => s.id === viewId);
      if (entry) {
        setSelectedEntry(entry);
        // Switch to reconciled filter if viewing a reconciled entry
        if (entry.is_reconciled) {
          setFilter('reconciled');
        }
        // Clear the URL parameter after opening
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, bankStatements, statementsLoading, setSearchParams]);

  // Auto-match suggestions using date/amount matching (primary) and patterns (secondary)
  const suggestedMatches = useMemo(() => {
    const suggestions = new Map();

    bankStatements.filter(s => !s.is_reconciled).forEach(entry => {
      const entryKeywords = extractKeywords(entry.description);
      const entryAmount = normalizeAmount(entry.amount);
      const isCredit = entry.amount > 0;
      let bestMatch = null;
      let bestScore = 0;

      // 1. PRIORITY: Match against existing UNRECONCILED loan transactions by date/amount
      if (isCredit) {
        // Credits could be repayments
        for (const tx of loanTransactions) {
          if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
          if (tx.type !== 'Repayment') continue;

          const score = calculateMatchScore(entry, tx, 'date');
          if (score > bestScore) {
            bestScore = score;
            const loan = loans.find(l => l.id === tx.loan_id);
            const borrowerName = loan ? getBorrowerName(loan.borrower_id) : 'Unknown';
            bestMatch = {
              type: 'loan_repayment',
              matchMode: 'match',
              existingTransaction: tx,
              loan_id: tx.loan_id,
              confidence: score,
              reason: `Repayment match: ${borrowerName} - ${formatCurrency(tx.amount)} on ${tx.date ? format(parseISO(tx.date), 'dd/MM') : '?'}`
            };
          }
        }
      } else {
        // Debits could be disbursements
        for (const tx of loanTransactions) {
          if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
          if (tx.type !== 'Disbursement') continue;

          const score = calculateMatchScore(entry, tx, 'date');
          if (score > bestScore) {
            bestScore = score;
            const loan = loans.find(l => l.id === tx.loan_id);
            const borrowerName = loan ? getBorrowerName(loan.borrower_id) : 'Unknown';
            bestMatch = {
              type: 'loan_disbursement',
              matchMode: 'match',
              existingTransaction: tx,
              loan_id: tx.loan_id,
              confidence: score,
              reason: `Disbursement match: ${borrowerName} - ${formatCurrency(tx.amount)} on ${tx.date ? format(parseISO(tx.date), 'dd/MM') : '?'}`
            };
          }
        }
      }

      // 1b. GROUPED MATCH: Check if multiple repayments from same borrower/email sum to this amount
      // This handles cases where a borrower pays once for multiple loans
      // Also groups by email address for borrowers that share the same email
      if (isCredit && bestScore < 0.9) {
        // Build a map of borrower email -> borrower IDs (for grouping by shared email)
        const emailToBorrowerIds = new Map();
        for (const borrower of borrowers) {
          const email = borrower.email?.toLowerCase()?.trim();
          if (email) {
            if (!emailToBorrowerIds.has(email)) {
              emailToBorrowerIds.set(email, new Set());
            }
            emailToBorrowerIds.get(email).add(borrower.id);
          }
        }

        // Group unreconciled repayments by borrower_id
        const repaymentsByBorrower = new Map();

        for (const tx of loanTransactions) {
          if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
          if (tx.type !== 'Repayment') continue;

          // Check if date is within 3 days of bank entry
          if (!datesWithinDays(entry.statement_date, tx.date, 3)) continue;

          const key = tx.borrower_id;
          if (!repaymentsByBorrower.has(key)) {
            repaymentsByBorrower.set(key, []);
          }
          repaymentsByBorrower.get(key).push(tx);
        }

        // First, check individual borrower groups
        for (const [borrowerId, txGroup] of repaymentsByBorrower) {
          if (txGroup.length < 2) continue; // Only interested in groups of 2+

          const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

          if (amountsMatch(entryAmount, groupTotal, 1)) {
            const allSameDay = txGroup.every(tx =>
              datesWithinDays(tx.date, entry.statement_date, 1)
            );

            const score = allSameDay ? 0.92 : 0.85;

            if (score > bestScore) {
              bestScore = score;
              const borrowerName = getBorrowerName(borrowerId);
              const loanNumbers = [...new Set(txGroup.map(tx => {
                const l = loans.find(loan => loan.id === tx.loan_id);
                return l?.loan_number || '?';
              }))].join(', ');

              bestMatch = {
                type: 'loan_repayment',
                matchMode: 'match_group',
                existingTransactions: txGroup,
                borrower_id: borrowerId,
                confidence: score,
                reason: `Grouped repayments: ${borrowerName} - ${txGroup.length} payments (${loanNumbers}) = ${formatCurrency(groupTotal)}`
              };
            }
          }
        }

        // Second, check groups by shared email (combines multiple borrowers with same email)
        if (bestScore < 0.9) {
          for (const [email, borrowerIds] of emailToBorrowerIds) {
            if (borrowerIds.size < 2) continue; // Only if multiple borrowers share this email

            // Combine transactions from all borrowers with this email
            const combinedTxGroup = [];
            for (const borrowerId of borrowerIds) {
              const txs = repaymentsByBorrower.get(borrowerId) || [];
              combinedTxGroup.push(...txs);
            }

            if (combinedTxGroup.length < 2) continue;

            const groupTotal = combinedTxGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

            if (amountsMatch(entryAmount, groupTotal, 1)) {
              const allSameDay = combinedTxGroup.every(tx =>
                datesWithinDays(tx.date, entry.statement_date, 1)
              );

              const score = allSameDay ? 0.90 : 0.82; // Slightly lower confidence for email-based grouping

              if (score > bestScore) {
                bestScore = score;
                const borrowerNames = [...borrowerIds].map(id => getBorrowerName(id)).join(' / ');
                const loanNumbers = [...new Set(combinedTxGroup.map(tx => {
                  const l = loans.find(loan => loan.id === tx.loan_id);
                  return l?.loan_number || '?';
                }))].join(', ');

                bestMatch = {
                  type: 'loan_repayment',
                  matchMode: 'match_group',
                  existingTransactions: combinedTxGroup,
                  borrower_id: [...borrowerIds][0], // Use first borrower ID for display
                  confidence: score,
                  reason: `Grouped by email (${email}): ${borrowerNames} - ${combinedTxGroup.length} payments (${loanNumbers}) = ${formatCurrency(groupTotal)}`
                };
              }
            }
          }
        }
      }

      // 2. Match against existing UNRECONCILED investor transactions by date/amount
      // Note: Only capital transactions (capital_in, capital_out) are in InvestorTransaction now
      // Interest withdrawals are tracked separately in investor_interest table
      for (const tx of investorTransactions) {
        if (reconciledTxIds.has(tx.id)) continue;

        // Check direction matches - only capital transactions
        const txIsCredit = tx.type === 'capital_in';
        const txIsDebit = tx.type === 'capital_out';

        if ((isCredit && txIsCredit) || (!isCredit && txIsDebit)) {
          const score = calculateMatchScore(entry, tx, 'date');
          if (score > bestScore) {
            bestScore = score;
            const investor = investors.find(i => i.id === tx.investor_id);
            const investorName = investor?.business_name || investor?.name || 'Unknown';
            const matchType = tx.type === 'capital_in' ? 'investor_credit' : 'investor_withdrawal';

            bestMatch = {
              type: matchType,
              matchMode: 'match',
              existingTransaction: tx,
              investor_id: tx.investor_id,
              confidence: score,
              reason: `Investor match: ${investorName} - ${formatCurrency(tx.amount)} on ${tx.date ? format(parseISO(tx.date), 'dd/MM') : '?'}`
            };
          }
        }
      }

      // 3. Match against existing UNRECONCILED expenses by date/amount (debits only)
      if (!isCredit) {
        for (const exp of expenses) {
          if (reconciledTxIds.has(exp.id)) continue;

          const score = calculateMatchScore(entry, exp, 'date');
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              type: 'expense',
              matchMode: 'match',
              existingExpense: exp,
              expense_type_id: exp.type_id,
              confidence: score,
              reason: `Expense match: ${exp.type_name || 'Expense'} - ${formatCurrency(exp.amount)} on ${exp.date ? format(parseISO(exp.date), 'dd/MM') : '?'}`
            };
          }
        }
      }

      // 4. Check learned patterns (for creating new transactions)
      if (bestScore < 0.7) {
        for (const pattern of patterns) {
          const patternKeywords = extractKeywords(pattern.description_pattern);
          const keywordMatch = entryKeywords.some(kw =>
            patternKeywords.some(pk => kw.includes(pk) || pk.includes(kw))
          );

          const amountInRange = (!pattern.amount_min || entryAmount >= pattern.amount_min) &&
                               (!pattern.amount_max || entryAmount <= pattern.amount_max);

          const typeMatch = !pattern.transaction_type ||
                           (isCredit ? pattern.transaction_type === 'CRDT' : pattern.transaction_type === 'DBIT');

          if (keywordMatch && amountInRange && typeMatch) {
            const score = pattern.confidence_score * 0.85 + 0.1;
            if (score > bestScore) {
              bestScore = score;
              bestMatch = {
                type: pattern.match_type,
                matchMode: 'create',
                loan_id: pattern.loan_id,
                investor_id: pattern.investor_id,
                expense_type_id: pattern.expense_type_id,
                pattern_id: pattern.id,
                confidence: score,
                reason: `Pattern: "${pattern.description_pattern}" (used ${pattern.match_count}x)`,
                defaultSplit: {
                  capital: pattern.default_capital_ratio,
                  interest: pattern.default_interest_ratio,
                  fees: pattern.default_fees_ratio
                }
              };
            }
          }
        }
      }

      // 5. Check if description contains expense-related keywords (debits only)
      // This should take priority over name matching to prevent false positives
      if (!isCredit && bestScore < 0.6) {
        const descLower = (entry.description || '').toLowerCase();
        const expenseKeywords = ['expense', 'expenses', 'bill', 'bills', 'fee', 'fees', 'charge', 'charges',
          'utilities', 'rent', 'insurance', 'subscription', 'office', 'supplies', 'maintenance',
          'professional', 'legal', 'accounting', 'tax', 'vat', 'hmrc', 'council', 'electric', 'gas', 'water',
          'phone', 'internet', 'broadband', 'software', 'license', 'licence'];

        const hasExpenseKeyword = expenseKeywords.some(kw => descLower.includes(kw));

        if (hasExpenseKeyword) {
          // This is likely an expense - suggest creating as expense
          bestScore = 0.65;
          bestMatch = {
            type: 'expense',
            matchMode: 'create',
            expense_type_id: null,
            confidence: 0.65,
            reason: `Description contains expense keyword`
          };
        }
      }

      // 6. Try matching to loans by borrower name (for creating new)
      // Only if no expense keywords were found and score is still low
      if (bestScore < 0.5) {
        // Skip name matching if description contains expense-related words
        const descLower = (entry.description || '').toLowerCase();
        const expenseKeywords = ['expense', 'expenses', 'bill', 'bills', 'fee', 'fees'];
        const hasExpenseKeyword = expenseKeywords.some(kw => descLower.includes(kw));

        if (!hasExpenseKeyword) {
          for (const loan of loans.filter(l => l.status === 'Live' || l.status === 'Active')) {
            const borrowerName = getBorrowerName(loan.borrower_id);
            const similarity = calculateSimilarity(entry.description, borrowerName);

            if (similarity > 0.5 && similarity > bestScore) {
              bestScore = similarity;
              bestMatch = {
                type: isCredit ? 'loan_repayment' : 'loan_disbursement',
                matchMode: 'create',
                loan_id: loan.id,
                confidence: similarity,
                reason: `Borrower name: ${borrowerName} (${Math.round(similarity * 100)}%)`
              };
            }
          }
        }
      }

      // 7. Try matching to investors by name (for creating new)
      // Only if no expense keywords were found and score is still low
      if (bestScore < 0.45) {
        const descLower = (entry.description || '').toLowerCase();
        const expenseKeywords = ['expense', 'expenses', 'bill', 'bills', 'fee', 'fees'];
        const hasExpenseKeyword = expenseKeywords.some(kw => descLower.includes(kw));

        if (!hasExpenseKeyword) {
          for (const investor of investors.filter(i => i.status === 'Active')) {
            const nameSimilarity = Math.max(
              calculateSimilarity(entry.description, investor.name || ''),
              calculateSimilarity(entry.description, investor.business_name || '')
            );

            if (nameSimilarity > 0.4 && nameSimilarity > bestScore) {
              bestScore = nameSimilarity;
              let matchType = 'investor_credit';
              if (!isCredit) {
                matchType = entry.description?.toLowerCase().includes('interest')
                  ? 'interest_withdrawal'
                  : 'investor_withdrawal';
              }
              bestMatch = {
                type: matchType,
                matchMode: 'create',
                investor_id: investor.id,
                confidence: nameSimilarity,
                reason: `Investor name: ${investor.business_name || investor.name} (${Math.round(nameSimilarity * 100)}%)`
              };
            }
          }
        }
      }

      // Only suggest if confidence is above threshold (lowered to 0.35 for more matches)
      if (bestMatch && bestScore >= 0.35) {
        suggestions.set(entry.id, bestMatch);
      }
    });

    return suggestions;
  }, [bankStatements, patterns, loans, investors, borrowers, loanTransactions, investorTransactions, expenses, expenseTypes, reconciledTxIds]);

  // Filter and search bank statements
  const filteredStatements = useMemo(() => {
    let filtered = bankStatements;

    if (filter === 'unreconciled') {
      filtered = filtered.filter(s => !s.is_reconciled);
    } else if (filter === 'reconciled') {
      filtered = filtered.filter(s => s.is_reconciled);
    } else if (filter === 'suggested') {
      filtered = filtered.filter(s => !s.is_reconciled && suggestedMatches.has(s.id));
    }

    // Apply confidence filter
    if (confidenceFilter !== 'all') {
      filtered = filtered.filter(s => {
        const suggestion = suggestedMatches.get(s.id);
        if (confidenceFilter === 'none') {
          return !suggestion; // No suggestion
        }
        if (!suggestion) return false;
        const confidence = Math.round(suggestion.confidence * 100);
        // Ranges aligned with calculateMatchScore outputs:
        // 95 = exact match same day, 85 = exact within 3 days, 75 = exact within 7 days
        // 70 = close amount same day, 60 = close within 3 days, 55 = exact amount any date
        // 45 = close within 7 days, 65 = expense keyword match
        if (confidenceFilter === '100') return confidence >= 90; // 90%+ (95, 90-94 from patterns)
        if (confidenceFilter === '90') return confidence >= 80 && confidence < 90; // 80-89% (85)
        if (confidenceFilter === '70') return confidence >= 65 && confidence < 80; // 65-79% (75, 70, 65)
        if (confidenceFilter === '50') return confidence >= 50 && confidence < 65; // 50-64% (60, 55)
        if (confidenceFilter === 'low') return confidence > 0 && confidence < 50; // Below 50% (45, patterns)
        return true;
      });
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(s =>
        s.description?.toLowerCase().includes(term) ||
        String(s.amount).includes(term)
      );
    }

    // Sort by confidence (highest first) when filtering by suggested
    if (filter === 'suggested' || confidenceFilter !== 'all') {
      filtered = [...filtered].sort((a, b) => {
        const confA = suggestedMatches.get(a.id)?.confidence || 0;
        const confB = suggestedMatches.get(b.id)?.confidence || 0;
        return confB - confA;
      });
    }

    return filtered;
  }, [bankStatements, filter, searchTerm, suggestedMatches, confidenceFilter]);

  // Filter entities based on search
  const filteredLoans = useMemo(() => {
    if (!entitySearch) return loans.filter(l => l.status === 'Live' || l.status === 'Active');
    const term = entitySearch.toLowerCase();
    return loans.filter(l =>
      (l.status === 'Live' || l.status === 'Active') && (
        l.loan_number?.toLowerCase().includes(term) ||
        getBorrowerName(l.borrower_id).toLowerCase().includes(term)
      )
    );
  }, [loans, entitySearch, borrowers]);

  const filteredInvestors = useMemo(() => {
    if (!entitySearch) return investors.filter(i => i.status === 'Active');
    const term = entitySearch.toLowerCase();
    return investors.filter(i =>
      i.status === 'Active' && (
        i.name?.toLowerCase().includes(term) ||
        i.business_name?.toLowerCase().includes(term) ||
        i.account_number?.toLowerCase().includes(term)
      )
    );
  }, [investors, entitySearch]);

  // Find potential matching transactions
  const potentialMatches = useMemo(() => {
    if (!selectedEntry) return [];

    const entryDate = parseISO(selectedEntry.statement_date);
    const entryAmount = Math.abs(selectedEntry.amount);

    if (reconciliationType === 'loan_repayment' || reconciliationType === 'loan_disbursement') {
      // Filter by transaction type: Disbursement for loan_disbursement, Repayment for loan_repayment
      const expectedType = reconciliationType === 'loan_disbursement' ? 'Disbursement' : 'Repayment';
      return loanTransactions
        .filter(tx => {
          if (tx.is_deleted) return false;
          // Only show transactions of the matching type
          if (tx.type !== expectedType) return false;
          const isReconciled = reconciliationEntries.some(re => re.loan_transaction_id === tx.id);
          if (isReconciled) return false;
          const txDate = tx.date ? parseISO(tx.date) : null;
          const amountMatch = Math.abs(tx.amount - entryAmount) / entryAmount < 0.01;
          const dateMatch = txDate && Math.abs(entryDate.getTime() - txDate.getTime()) <= 3 * 24 * 60 * 60 * 1000;
          return amountMatch || dateMatch;
        })
        .slice(0, 10);
    }

    if (reconciliationType.startsWith('investor_')) {
      return investorTransactions
        .filter(tx => {
          const isReconciled = reconciliationEntries.some(re => re.investor_transaction_id === tx.id);
          if (isReconciled) return false;
          const amountMatch = Math.abs(tx.amount - entryAmount) / entryAmount < 0.01;
          const txDate = tx.date ? parseISO(tx.date) : null;
          const dateMatch = txDate && Math.abs(entryDate.getTime() - txDate.getTime()) <= 3 * 24 * 60 * 60 * 1000;
          return amountMatch || dateMatch;
        })
        .slice(0, 10);
    }

    return [];
  }, [selectedEntry, reconciliationType, loanTransactions, investorTransactions, reconciliationEntries]);

  // Handle file import
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setImportResult(null);

    if (selectedFile) {
      const text = await selectedFile.text();
      const rows = parseCSV(text);
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const detected = detectBankFormat(headers);
        if (detected) {
          setBankSource(detected);
        }
      }
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const { entries, errors } = parseBankStatement(text, bankSource);

      if (entries.length === 0) {
        setImportResult({
          success: false,
          error: 'No valid entries found in CSV',
          errors
        });
        return;
      }

      const existingRefs = new Set(bankStatements.map(s => s.external_reference));
      const newEntries = entries.filter(e => !existingRefs.has(e.external_reference));
      const duplicates = entries.length - newEntries.length;

      if (newEntries.length === 0) {
        setImportResult({
          success: true,
          created: 0,
          duplicates,
          errors,
          message: 'All entries already exist in the system'
        });
        return;
      }

      const entriesToCreate = newEntries.map(e => ({
        ...e,
        bank_source: bankSource
      }));

      await api.entities.BankStatement.createMany(entriesToCreate);

      setImportResult({
        success: true,
        created: newEntries.length,
        duplicates,
        errors,
        total: entries.length
      });

      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      setFile(null);

    } catch (error) {
      setImportResult({
        success: false,
        error: error.message
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Open reconciliation modal
  const openReconcileModal = (entry, suggestion = null) => {
    setSelectedEntry(entry);
    setReviewingSuggestion(suggestion); // Track if we're reviewing a suggestion
    setSelectedLoan(null);
    setSelectedInvestor(null);
    setSelectedExpenseType(null);
    setSelectedExistingTx(null);
    setEntitySearch('');
    setExpenseDescription(entry.description || '');
    setSavePattern(true);

    const amount = Math.abs(entry.amount);

    // If there's a suggestion, pre-populate the form
    if (suggestion) {
      setReconciliationType(suggestion.type);

      // Set match mode based on suggestion
      if (suggestion.matchMode === 'match' && (suggestion.existingTransaction || suggestion.existingExpense)) {
        setMatchMode('match');
        // Pre-select the existing transaction
        if (suggestion.existingTransaction) {
          setSelectedExistingTx(suggestion.existingTransaction);
        } else if (suggestion.existingExpense) {
          setSelectedExistingTx(suggestion.existingExpense);
        }
      } else {
        setMatchMode('create');
      }

      if (suggestion.loan_id) {
        const loan = loans.find(l => l.id === suggestion.loan_id);
        if (loan) setSelectedLoan(loan);
      }
      if (suggestion.investor_id) {
        const investor = investors.find(i => i.id === suggestion.investor_id);
        if (investor) setSelectedInvestor(investor);
      }
      if (suggestion.expense_type_id) {
        const expType = expenseTypes.find(t => t.id === suggestion.expense_type_id);
        if (expType) setSelectedExpenseType(expType);
      }

      // Apply default split ratios if available
      if (suggestion.defaultSplit) {
        setSplitAmounts({
          capital: amount * (suggestion.defaultSplit.capital || 1),
          interest: amount * (suggestion.defaultSplit.interest || 0),
          fees: amount * (suggestion.defaultSplit.fees || 0)
        });
      } else {
        setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
      }
    } else {
      // Default behavior
      setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
      if (entry.amount > 0) {
        setReconciliationType('loan_repayment');
      } else {
        setReconciliationType('expense');
      }
      setMatchMode('create');
    }
  };

  // Save or update pattern after reconciliation
  const saveReconciliationPattern = async (entry, type, loanId, investorId, expenseTypeId, splitRatios) => {
    const keywords = extractKeywords(entry.description);
    if (keywords.length === 0) return;

    const patternText = keywords.slice(0, 5).join(' '); // Use top 5 keywords
    const amount = normalizeAmount(entry.amount);

    // Check if similar pattern exists
    const existingPattern = patterns.find(p =>
      calculateSimilarity(p.description_pattern, patternText) > 0.7 &&
      p.match_type === type
    );

    if (existingPattern) {
      // Update existing pattern
      await api.entities.ReconciliationPattern.update(existingPattern.id, {
        match_count: (existingPattern.match_count || 1) + 1,
        confidence_score: Math.min(1, (existingPattern.confidence_score || 0.5) + 0.1),
        last_used_at: new Date().toISOString(),
        // Update split ratios if provided
        ...(splitRatios && {
          default_capital_ratio: splitRatios.capital,
          default_interest_ratio: splitRatios.interest,
          default_fees_ratio: splitRatios.fees
        })
      });
    } else {
      // Create new pattern
      await api.entities.ReconciliationPattern.create({
        description_pattern: patternText,
        amount_min: amount * 0.8, // Allow 20% variance
        amount_max: amount * 1.2,
        transaction_type: entry.amount > 0 ? 'CRDT' : 'DBIT',
        bank_source: entry.bank_source,
        match_type: type,
        loan_id: loanId,
        investor_id: investorId,
        expense_type_id: expenseTypeId,
        default_capital_ratio: splitRatios?.capital || 1,
        default_interest_ratio: splitRatios?.interest || 0,
        default_fees_ratio: splitRatios?.fees || 0,
        confidence_score: 0.6 // Start with moderate confidence
      });
    }

    queryClient.invalidateQueries({ queryKey: ['reconciliation-patterns'] });
  };

  // Handle reconciliation
  const handleReconcile = async () => {
    if (!selectedEntry) return;

    // Handle grouped match from review suggestion (e.g., multiple loan repayments summing to bank amount)
    if (reviewingSuggestion?.matchMode === 'match_group' && reviewingSuggestion.existingTransactions) {
      setIsReconciling(true);
      try {
        const txGroup = reviewingSuggestion.existingTransactions;
        const amount = Math.abs(selectedEntry.amount);

        // Create a reconciliation entry for each transaction in the group
        for (const tx of txGroup) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: selectedEntry.id,
            loan_transaction_id: tx.id,
            investor_transaction_id: null,
            expense_id: null,
            amount: parseFloat(tx.amount) || 0,
            reconciliation_type: 'loan_repayment',
            notes: `Grouped match: ${txGroup.length} repayments totaling ${formatCurrency(amount)}`,
            was_created: false
          });
        }

        // Mark bank statement as reconciled
        await api.entities.BankStatement.update(selectedEntry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
        queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });

        setSelectedEntry(null);
        setReviewingSuggestion(null);
      } catch (error) {
        alert(`Error: ${error.message}`);
      } finally {
        setIsReconciling(false);
      }
      return;
    }

    if (!reconciliationType) return;

    setIsReconciling(true);

    try {
      const amount = Math.abs(selectedEntry.amount);
      let transactionId = null;
      let investorTransactionId = null;
      let expenseId = null;
      let otherIncomeId = null;
      let interestId = null;

      if (matchMode === 'match' && selectedExistingTx) {
        if (reconciliationType === 'loan_repayment' || reconciliationType === 'loan_disbursement') {
          transactionId = selectedExistingTx.id;
        } else if (reconciliationType.startsWith('investor_')) {
          investorTransactionId = selectedExistingTx.id;
        }
      } else {
        if (reconciliationType === 'loan_repayment' && selectedLoan) {
          const txData = {
            loan_id: selectedLoan.id,
            borrower_id: selectedLoan.borrower_id,
            amount: amount,
            date: selectedEntry.statement_date,
            type: 'Repayment',
            principal_applied: splitAmounts.capital,
            interest_applied: splitAmounts.interest,
            fees_applied: splitAmounts.fees,
            reference: selectedEntry.external_reference,
            notes: `Bank reconciliation: ${selectedEntry.description}`
          };
          const created = await api.entities.Transaction.create(txData);
          transactionId = created.id;

        } else if (reconciliationType === 'loan_disbursement' && selectedLoan) {
          const txData = {
            loan_id: selectedLoan.id,
            borrower_id: selectedLoan.borrower_id,
            amount: amount,
            date: selectedEntry.statement_date,
            type: 'Disbursement',
            principal_applied: amount,
            reference: selectedEntry.external_reference,
            notes: `Bank reconciliation: ${selectedEntry.description}`
          };
          const created = await api.entities.Transaction.create(txData);
          transactionId = created.id;

        } else if (reconciliationType === 'investor_credit' && selectedInvestor) {
          const txData = {
            investor_id: selectedInvestor.id,
            type: 'capital_in',
            amount: amount,
            date: selectedEntry.statement_date,
            description: selectedEntry.description,
            reference: selectedEntry.external_reference
          };
          const created = await api.entities.InvestorTransaction.create(txData);
          investorTransactionId = created.id;

          await api.entities.Investor.update(selectedInvestor.id, {
            current_capital_balance: (selectedInvestor.current_capital_balance || 0) + amount,
            total_capital_contributed: (selectedInvestor.total_capital_contributed || 0) + amount
          });

        } else if (reconciliationType === 'investor_withdrawal' && selectedInvestor) {
          const txData = {
            investor_id: selectedInvestor.id,
            type: 'capital_out',
            amount: amount,
            date: selectedEntry.statement_date,
            description: selectedEntry.description,
            reference: selectedEntry.external_reference
          };
          const created = await api.entities.InvestorTransaction.create(txData);
          investorTransactionId = created.id;

          await api.entities.Investor.update(selectedInvestor.id, {
            current_capital_balance: (selectedInvestor.current_capital_balance || 0) - amount
          });

        } else if (reconciliationType === 'interest_withdrawal' && selectedInvestor) {
          // Create a debit entry in the investor_interest ledger
          const interestEntry = await api.entities.InvestorInterest.create({
            investor_id: selectedInvestor.id,
            type: 'debit',
            amount: amount,
            date: selectedEntry.statement_date,
            description: selectedEntry.description,
            reference: selectedEntry.external_reference
          });
          interestId = interestEntry.id;

        } else if (reconciliationType === 'expense') {
          const expenseData = {
            type_id: selectedExpenseType?.id || null,
            type_name: selectedExpenseType?.name || null,
            amount: amount,
            date: selectedEntry.statement_date,
            description: expenseDescription || selectedEntry.description
          };
          const created = await api.entities.Expense.create(expenseData);
          expenseId = created.id;
        } else if (reconciliationType === 'other_income') {
          const otherIncomeData = {
            amount: amount,
            date: selectedEntry.statement_date,
            description: selectedEntry.description
          };
          const created = await api.entities.OtherIncome.create(otherIncomeData);
          otherIncomeId = created.id;
        } else if (reconciliationType === 'offset') {
          // Handle offset reconciliation - mark all entries as reconciled together
          const allEntries = [selectedEntry, ...selectedOffsetEntries];
          const netAmount = allEntries.reduce((sum, e) => sum + e.amount, 0);

          // Validate balance
          if (Math.abs(netAmount) >= 0.01) {
            throw new Error(`Entries don't balance. Net: ${formatCurrency(netAmount)}`);
          }

          // Generate a unique group ID to link these offset entries together
          const offsetGroupId = `offset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const notesWithGroupId = `[${offsetGroupId}] ${offsetNotes}`;

          // Mark all entries as reconciled and create reconciliation entries
          for (const entry of allEntries) {
            await api.entities.BankStatement.update(entry.id, {
              is_reconciled: true,
              reconciled_at: new Date().toISOString()
            });

            await api.entities.ReconciliationEntry.create({
              bank_statement_id: entry.id,
              reconciliation_type: 'offset',
              amount: entry.amount,
              notes: notesWithGroupId,
              was_created: false
            });
          }

          // Refresh and close
          queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
          setSelectedEntry(null);
          setReconciliationType('');
          setSelectedOffsetEntries([]);
          setOffsetNotes('');
          setIsReconciling(false);
          return; // Exit early - offset is handled completely here
        }
      }

      // Create reconciliation entry (for non-offset types)
      await api.entities.ReconciliationEntry.create({
        bank_statement_id: selectedEntry.id,
        loan_transaction_id: transactionId,
        investor_transaction_id: investorTransactionId,
        expense_id: expenseId,
        other_income_id: otherIncomeId,
        interest_id: interestId,
        amount: amount,
        reconciliation_type: reconciliationType,
        notes: matchMode === 'match' ? 'Matched to existing transaction' : 'Created new transaction',
        was_created: matchMode === 'create'
      });

      // Mark bank statement as reconciled
      await api.entities.BankStatement.update(selectedEntry.id, {
        is_reconciled: true,
        reconciled_at: new Date().toISOString()
      });

      // Save pattern for future auto-matching (if enabled and creating new)
      if (savePattern && matchMode === 'create') {
        const splitRatios = reconciliationType === 'loan_repayment' ? {
          capital: splitAmounts.capital / amount,
          interest: splitAmounts.interest / amount,
          fees: splitAmounts.fees / amount
        } : null;

        await saveReconciliationPattern(
          selectedEntry,
          reconciliationType,
          selectedLoan?.id || null,
          selectedInvestor?.id || null,
          selectedExpenseType?.id || null,
          splitRatios
        );
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-interest'] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });

      setSelectedEntry(null);

    } catch (error) {
      console.error('Reconciliation error:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsReconciling(false);
    }
  };

  // Get reconciliation details for a bank statement entry
  const getReconciliationDetails = (entryId) => {
    const entries = reconciliationEntries.filter(re => re.bank_statement_id === entryId);
    return entries.map(re => {
      let linkedEntity = null;
      let entityType = '';
      let entityDetails = {};

      if (re.loan_transaction_id) {
        const tx = loanTransactions.find(t => t.id === re.loan_transaction_id);
        if (tx) {
          const loan = loans.find(l => l.id === tx.loan_id);
          const borrowerName = loan ? getBorrowerName(loan.borrower_id) : 'Unknown';
          linkedEntity = tx;
          entityType = tx.type === 'Repayment' ? 'Loan Repayment' : 'Loan Disbursement';
          entityDetails = {
            loanNumber: loan?.loan_number,
            borrowerName,
            date: tx.date,
            amount: tx.amount,
            principalApplied: tx.principal_applied,
            interestApplied: tx.interest_applied,
            feesApplied: tx.fees_applied,
            notes: tx.notes
          };
        }
      } else if (re.investor_transaction_id) {
        const tx = investorTransactions.find(t => t.id === re.investor_transaction_id);
        if (tx) {
          const investor = investors.find(i => i.id === tx.investor_id);
          linkedEntity = tx;
          entityType = tx.type === 'capital_in' ? 'Investor Credit' :
                       tx.type === 'capital_out' ? 'Investor Withdrawal' : 'Investor Transaction';
          entityDetails = {
            investorName: investor?.business_name || investor?.name,
            date: tx.date,
            amount: tx.amount,
            description: tx.description
          };
        }
      } else if (re.expense_id) {
        const expense = expenses.find(e => e.id === re.expense_id);
        if (expense) {
          const linkedLoan = expense.loan_id ? loans.find(l => l.id === expense.loan_id) : null;
          linkedEntity = expense;
          entityType = 'Expense';
          entityDetails = {
            expenseTypeName: expense.type_name || 'Uncategorized',
            date: expense.date,
            amount: expense.amount,
            description: expense.description,
            linkedLoan: linkedLoan ? {
              loanNumber: linkedLoan.loan_number,
              borrowerName: getBorrowerName(linkedLoan.borrower_id)
            } : null
          };
        }
      } else if (re.reconciliation_type === 'offset') {
        // For offset entries, find all other bank statements reconciled together
        // They share the same offset group ID (extracted from notes: "[offset_xxx] reason")
        const groupIdMatch = re.notes?.match(/^\[offset_[^\]]+\]/);
        const groupId = groupIdMatch ? groupIdMatch[0] : null;

        // Extract the user-readable notes (without the group ID prefix)
        const displayNotes = re.notes?.replace(/^\[offset_[^\]]+\]\s*/, '') || '';

        const offsetPartners = groupId ? reconciliationEntries
          .filter(other =>
            other.reconciliation_type === 'offset' &&
            other.bank_statement_id !== entryId &&
            other.notes?.startsWith(groupId)
          )
          .map(other => {
            const stmt = bankStatements.find(s => s.id === other.bank_statement_id);
            return stmt;
          })
          .filter(Boolean) : [];

        entityType = 'Funds Returned';
        entityDetails = {
          amount: re.amount,
          notes: displayNotes,
          offsetPartners
        };
      }

      return {
        reconciliationEntry: re,
        linkedEntity,
        entityType,
        entityDetails,
        reconciliationType: re.reconciliation_type,
        amount: re.amount,
        notes: re.notes,
        createdAt: re.created_at
      };
    });
  };

  // Helper to delete records that were created during reconciliation
  const deleteCreatedRecords = async (bankStatementId) => {
    // Get reconciliation entries for this bank statement
    const entries = reconciliationEntries.filter(re => re.bank_statement_id === bankStatementId);

    for (const entry of entries) {
      // Only delete if the record was created during reconciliation
      if (!entry.was_created) continue;

      try {
        if (entry.loan_transaction_id) {
          await api.entities.Transaction.delete(entry.loan_transaction_id);
        }

        if (entry.investor_transaction_id) {
          // Get the investor transaction to reverse balance changes
          const invTx = investorTransactions.find(t => t.id === entry.investor_transaction_id);
          if (invTx) {
            const investor = investors.find(i => i.id === invTx.investor_id);
            if (investor) {
              // Reverse the balance changes based on transaction type
              if (invTx.type === 'capital_in') {
                await api.entities.Investor.update(investor.id, {
                  current_capital_balance: (investor.current_capital_balance || 0) - invTx.amount,
                  total_capital_contributed: (investor.total_capital_contributed || 0) - invTx.amount
                });
              } else if (invTx.type === 'capital_out') {
                await api.entities.Investor.update(investor.id, {
                  current_capital_balance: (investor.current_capital_balance || 0) + invTx.amount
                });
              }
            }
          }
          await api.entities.InvestorTransaction.delete(entry.investor_transaction_id);
        }

        if (entry.interest_id) {
          // Delete interest ledger entry
          await api.entities.InvestorInterest.delete(entry.interest_id);
        }

        if (entry.expense_id) {
          await api.entities.Expense.delete(entry.expense_id);
        }

        if (entry.other_income_id) {
          await api.entities.OtherIncome.delete(entry.other_income_id);
        }
      } catch (err) {
        console.error('Error deleting created record:', err, entry);
      }
    }
  };

  // Handle un-reconciling a bank statement
  const handleUnreconcile = async () => {
    if (!selectedEntry || !selectedEntry.is_reconciled) return;

    // Check if any created records will be deleted
    const entries = reconciliationEntries.filter(re => re.bank_statement_id === selectedEntry.id);
    const hasCreatedRecords = entries.some(e => e.was_created);

    const message = hasCreatedRecords
      ? 'Are you sure you want to un-reconcile this entry? The transactions/records that were created during reconciliation will be DELETED.'
      : 'Are you sure you want to un-reconcile this entry? The linked transactions will remain.';

    if (!window.confirm(message)) {
      return;
    }

    setIsUnreconciling(true);

    try {
      // Delete any records that were created during reconciliation
      await deleteCreatedRecords(selectedEntry.id);

      // Delete all reconciliation entries for this bank statement
      await api.entities.ReconciliationEntry.deleteWhere({ bank_statement_id: selectedEntry.id });

      // Mark bank statement as not reconciled
      await api.entities.BankStatement.update(selectedEntry.id, {
        is_reconciled: false,
        reconciled_at: null,
        reconciled_by: null
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['other-income'] });

      setSelectedEntry(null);
    } catch (error) {
      console.error('Un-reconcile error:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsUnreconciling(false);
    }
  };

  // Auto-reconcile all suggested matches
  const handleAutoReconcile = async () => {
    const entriesWithHighConfidence = filteredStatements.filter(entry => {
      const suggestion = suggestedMatches.get(entry.id);
      return suggestion && suggestion.confidence >= 0.7;
    });

    if (entriesWithHighConfidence.length === 0) {
      alert('No entries with high confidence matches to auto-reconcile.');
      return;
    }

    if (!window.confirm(`Auto-reconcile ${entriesWithHighConfidence.length} entries with high confidence matches?`)) {
      return;
    }

    setIsAutoMatching(true);
    let succeeded = 0;
    let failed = 0;

    for (const entry of entriesWithHighConfidence) {
      const suggestion = suggestedMatches.get(entry.id);
      try {
        const amount = Math.abs(entry.amount);
        let transactionId = null;
        let investorTransactionId = null;
        let expenseId = null;
        let interestId = null;

        // If matching to existing transaction, just link it
        if (suggestion.matchMode === 'match') {
          if (suggestion.existingTransaction) {
            if (suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement') {
              transactionId = suggestion.existingTransaction.id;
            } else if (suggestion.type.startsWith('investor_')) {
              investorTransactionId = suggestion.existingTransaction.id;
            }
          } else if (suggestion.existingExpense) {
            expenseId = suggestion.existingExpense.id;
          }
        } else {
          // Create new transaction
          if (suggestion.type === 'loan_repayment' && suggestion.loan_id) {
            const loan = loans.find(l => l.id === suggestion.loan_id);
            if (loan) {
              const split = suggestion.defaultSplit || { capital: 1, interest: 0, fees: 0 };
              const txData = {
                loan_id: loan.id,
                borrower_id: loan.borrower_id,
                amount: amount,
                date: entry.statement_date,
                type: 'Repayment',
                principal_applied: amount * split.capital,
                interest_applied: amount * split.interest,
                fees_applied: amount * split.fees,
                reference: entry.external_reference,
                notes: `Auto-reconciled: ${entry.description}`
              };
              const created = await api.entities.Transaction.create(txData);
              transactionId = created.id;
            }
          } else if (suggestion.type === 'loan_disbursement' && suggestion.loan_id) {
            const loan = loans.find(l => l.id === suggestion.loan_id);
            if (loan) {
              const txData = {
                loan_id: loan.id,
                borrower_id: loan.borrower_id,
                amount: amount,
                date: entry.statement_date,
                type: 'Disbursement',
                principal_applied: amount,
                reference: entry.external_reference,
                notes: `Auto-reconciled: ${entry.description}`
              };
              const created = await api.entities.Transaction.create(txData);
              transactionId = created.id;
            }
          } else if (suggestion.type === 'investor_credit' && suggestion.investor_id) {
            const investor = investors.find(i => i.id === suggestion.investor_id);
            if (investor) {
              const txData = {
                investor_id: investor.id,
                type: 'capital_in',
                amount: amount,
                date: entry.statement_date,
                description: entry.description,
                reference: entry.external_reference
              };
              const created = await api.entities.InvestorTransaction.create(txData);
              investorTransactionId = created.id;

              await api.entities.Investor.update(investor.id, {
                current_capital_balance: (investor.current_capital_balance || 0) + amount,
                total_capital_contributed: (investor.total_capital_contributed || 0) + amount
              });
            }
          } else if (suggestion.type === 'investor_withdrawal' && suggestion.investor_id) {
            const investor = investors.find(i => i.id === suggestion.investor_id);
            if (investor) {
              const txData = {
                investor_id: investor.id,
                type: 'capital_out',
                amount: amount,
                date: entry.statement_date,
                description: entry.description,
                reference: entry.external_reference
              };
              const created = await api.entities.InvestorTransaction.create(txData);
              investorTransactionId = created.id;

              await api.entities.Investor.update(investor.id, {
                current_capital_balance: (investor.current_capital_balance || 0) - amount
              });
            }
          } else if (suggestion.type === 'interest_withdrawal' && suggestion.investor_id) {
            // Create a debit entry in the investor_interest ledger
            const interestEntry = await api.entities.InvestorInterest.create({
              investor_id: suggestion.investor_id,
              type: 'debit',
              amount: amount,
              date: entry.statement_date,
              description: entry.description,
              reference: entry.external_reference
            });
            interestId = interestEntry.id;
          }
        }

        // Create reconciliation entry
        if (transactionId || investorTransactionId || expenseId || interestId) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            loan_transaction_id: transactionId,
            investor_transaction_id: investorTransactionId,
            expense_id: expenseId,
            interest_id: interestId,
            amount: amount,
            reconciliation_type: suggestion.type,
            notes: `Auto-reconciled (${suggestion.matchMode === 'match' ? 'matched' : 'created'}) with ${Math.round(suggestion.confidence * 100)}% confidence`,
            was_created: suggestion.matchMode === 'create'
          });

          await api.entities.BankStatement.update(entry.id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });

          // Update pattern confidence
          if (suggestion.pattern_id) {
            const pattern = patterns.find(p => p.id === suggestion.pattern_id);
            if (pattern) {
              await api.entities.ReconciliationPattern.update(pattern.id, {
                match_count: (pattern.match_count || 1) + 1,
                confidence_score: Math.min(1, (pattern.confidence_score || 0.6) + 0.05),
                last_used_at: new Date().toISOString()
              });
            }
          }

          succeeded++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error('Auto-reconcile error for entry:', entry.id, error);
        failed++;
      }
    }

    setAutoMatchResults({ succeeded, failed });
    setIsAutoMatching(false);

    // Refresh data
    queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-patterns'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investors'] });
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
  };

  // Quick match - instantly reconcile a single entry with its suggestion (no review)
  // silent=true suppresses alert for bulk operations
  // skipInvalidation=true skips query invalidation (for bulk operations that invalidate at the end)
  const handleQuickMatch = async (entry, suggestion, silent = false, skipInvalidation = false) => {
    if (!suggestion) return;

    try {
      const amount = Math.abs(entry.amount);
      let transactionId = null;
      let investorTransactionId = null;
      let expenseId = null;
      let interestId = null;

      if (suggestion.matchMode === 'match' && (suggestion.existingTransaction || suggestion.existingExpense)) {
        // Link to existing single transaction
        if (suggestion.existingTransaction) {
          const tx = suggestion.existingTransaction;
          if (suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement') {
            transactionId = tx.id;
          } else if (suggestion.type.startsWith('investor_')) {
            investorTransactionId = tx.id;
          }
        } else if (suggestion.existingExpense) {
          expenseId = suggestion.existingExpense.id;
        }
      } else if (suggestion.matchMode === 'match_group' && suggestion.existingTransactions) {
        // Link to multiple existing transactions (grouped loan repayments)
        const txGroup = suggestion.existingTransactions;

        // Create a reconciliation entry for each transaction in the group
        for (const tx of txGroup) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: entry.id,
            loan_transaction_id: tx.id,
            investor_transaction_id: null,
            expense_id: null,
            amount: parseFloat(tx.amount) || 0,
            reconciliation_type: 'loan_repayment',
            notes: `Grouped match: ${txGroup.length} repayments totaling ${formatCurrency(amount)} with ${Math.round(suggestion.confidence * 100)}% confidence`,
            was_created: false
          });
        }

        // Mark bank statement as reconciled
        await api.entities.BankStatement.update(entry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        // Refresh data (skip if bulk operation will do it at the end)
        if (!skipInvalidation) {
          queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
          queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
        }

        return; // Early return since we handled everything
      } else if (suggestion.matchMode === 'create') {
        // Create new transaction
        if (suggestion.type === 'loan_repayment' && suggestion.loan_id) {
          const loan = loans.find(l => l.id === suggestion.loan_id);
          if (loan) {
            const split = suggestion.split || { capital: 1, interest: 0, fees: 0 };
            const txData = {
              loan_id: loan.id,
              borrower_id: loan.borrower_id,
              amount: amount,
              date: entry.statement_date,
              type: 'Repayment',
              principal_applied: amount * split.capital,
              interest_applied: amount * split.interest,
              fees_applied: amount * split.fees,
              reference: entry.external_reference,
              notes: `Quick reconcile: ${entry.description}`
            };
            const created = await api.entities.Transaction.create(txData);
            transactionId = created.id;
          }
        } else if (suggestion.type === 'loan_disbursement' && suggestion.loan_id) {
          const loan = loans.find(l => l.id === suggestion.loan_id);
          if (loan) {
            const txData = {
              loan_id: loan.id,
              borrower_id: loan.borrower_id,
              amount: amount,
              date: entry.statement_date,
              type: 'Disbursement',
              principal_applied: amount,
              reference: entry.external_reference,
              notes: `Quick reconcile: ${entry.description}`
            };
            const created = await api.entities.Transaction.create(txData);
            transactionId = created.id;
          }
        } else if (suggestion.type === 'investor_credit' && suggestion.investor_id) {
          const investor = investors.find(i => i.id === suggestion.investor_id);
          if (investor) {
            const txData = {
              investor_id: investor.id,
              type: 'capital_in',
              amount: amount,
              date: entry.statement_date,
              description: entry.description,
              reference: entry.external_reference
            };
            const created = await api.entities.InvestorTransaction.create(txData);
            investorTransactionId = created.id;

            await api.entities.Investor.update(investor.id, {
              current_capital_balance: (investor.current_capital_balance || 0) + amount,
              total_capital_contributed: (investor.total_capital_contributed || 0) + amount
            });
          }
        } else if (suggestion.type === 'investor_withdrawal' && suggestion.investor_id) {
          const investor = investors.find(i => i.id === suggestion.investor_id);
          if (investor) {
            const txData = {
              investor_id: investor.id,
              type: 'capital_out',
              amount: amount,
              date: entry.statement_date,
              description: entry.description,
              reference: entry.external_reference
            };
            const created = await api.entities.InvestorTransaction.create(txData);
            investorTransactionId = created.id;

            await api.entities.Investor.update(investor.id, {
              current_capital_balance: (investor.current_capital_balance || 0) - amount
            });
          }
        } else if (suggestion.type === 'interest_withdrawal' && suggestion.investor_id) {
          // Create a debit entry in the investor_interest ledger
          const interestEntry = await api.entities.InvestorInterest.create({
            investor_id: suggestion.investor_id,
            type: 'debit',
            amount: amount,
            date: entry.statement_date,
            description: entry.description,
            reference: entry.external_reference
          });
          interestId = interestEntry.id;
        } else if (suggestion.type === 'expense' && suggestion.expense_type_id) {
          const expType = expenseTypes.find(t => t.id === suggestion.expense_type_id);
          const expenseData = {
            type_id: suggestion.expense_type_id,
            type_name: expType?.name || null,
            amount: amount,
            date: entry.statement_date,
            description: entry.description
          };
          const created = await api.entities.Expense.create(expenseData);
          expenseId = created.id;
        }
      }

      // Create reconciliation entry
      if (transactionId || investorTransactionId || expenseId || interestId) {
        await api.entities.ReconciliationEntry.create({
          bank_statement_id: entry.id,
          loan_transaction_id: transactionId,
          investor_transaction_id: investorTransactionId,
          expense_id: expenseId,
          interest_id: interestId,
          amount: amount,
          reconciliation_type: suggestion.type,
          notes: `Quick matched (${suggestion.matchMode === 'match' ? 'matched' : 'created'}) with ${Math.round(suggestion.confidence * 100)}% confidence`,
          was_created: suggestion.matchMode === 'create'
        });

        await api.entities.BankStatement.update(entry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        // Update pattern confidence
        if (suggestion.pattern_id) {
          const pattern = patterns.find(p => p.id === suggestion.pattern_id);
          if (pattern) {
            await api.entities.ReconciliationPattern.update(pattern.id, {
              match_count: (pattern.match_count || 1) + 1,
              confidence_score: Math.min(1, (pattern.confidence_score || 0.6) + 0.05),
              last_used_at: new Date().toISOString()
            });
          }
        }

        // Refresh data (skip if bulk operation will do it at the end)
        if (!skipInvalidation) {
          queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
          queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
          queryClient.invalidateQueries({ queryKey: ['reconciliation-patterns'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
          queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
          queryClient.invalidateQueries({ queryKey: ['investor-interest'] });
          queryClient.invalidateQueries({ queryKey: ['investors'] });
          queryClient.invalidateQueries({ queryKey: ['expenses'] });
        }
      } else {
        // No transaction was created or linked - show error
        console.error('Quick match failed - no transaction created/linked:', {
          entry: entry.id,
          suggestion,
          matchMode: suggestion.matchMode,
          type: suggestion.type
        });
        throw new Error(`Could not process: missing ${suggestion.matchMode === 'match' ? 'existing transaction' : 'required data'} for ${suggestion.type}`);
      }
    } catch (error) {
      console.error('Quick match error:', error);
      if (!silent) {
        alert(`Quick match failed: ${error.message}`);
      }
      throw error; // Re-throw for bulk operations to catch
    }
  };

  // Bulk match - reconcile all selected entries with their suggestions
  const handleBulkMatch = async () => {
    if (selectedEntries.size === 0) return;

    // Count entries that will be processed
    const entriesToProcess = [...selectedEntries].filter(id => {
      const entry = bankStatements.find(s => s.id === id);
      const suggestion = suggestedMatches.get(id);
      return entry && suggestion && !entry.is_reconciled;
    });

    setIsBulkMatching(true);
    setBulkMatchProgress({ current: 0, total: entriesToProcess.length });

    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (const entryId of entriesToProcess) {
      const entry = bankStatements.find(s => s.id === entryId);
      const suggestion = suggestedMatches.get(entryId);

      try {
        await handleQuickMatch(entry, suggestion, true, true); // silent mode + skip invalidation for bulk
        succeeded++;
      } catch (error) {
        console.error('Bulk match error for entry:', entryId, error);
        errors.push(`${entry.description?.substring(0, 30) || entryId}: ${error.message}`);
        failed++;
      }

      setBulkMatchProgress({ current: succeeded + failed, total: entriesToProcess.length });
    }

    // Invalidate all queries once at the end (much faster than per-entry)
    queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-patterns'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investors'] });
    queryClient.invalidateQueries({ queryKey: ['expenses'] });

    setSelectedEntries(new Set());
    setIsBulkMatching(false);
    setBulkMatchProgress({ current: 0, total: 0 });
    setAutoMatchResults({ succeeded, failed });

    // Show summary of errors if any
    if (errors.length > 0) {
      alert(`Bulk match completed with ${failed} error(s):\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`);
    }
  };

  // Bulk un-reconcile - un-reconcile all selected reconciled entries
  const [isBulkUnreconciling, setIsBulkUnreconciling] = useState(false);

  const handleBulkUnreconcile = async () => {
    const reconciledSelected = [...selectedEntries].filter(id => {
      const entry = bankStatements.find(s => s.id === id);
      return entry?.is_reconciled;
    });

    if (reconciledSelected.length === 0) {
      alert('No reconciled entries selected');
      return;
    }

    // Check if any entries have created records
    const hasAnyCreatedRecords = reconciledSelected.some(entryId => {
      const recEntries = reconciliationEntries.filter(re => re.bank_statement_id === entryId);
      return recEntries.some(e => e.was_created);
    });

    const message = hasAnyCreatedRecords
      ? `Are you sure you want to un-reconcile ${reconciledSelected.length} entries? Transactions/records that were created during reconciliation will be DELETED.`
      : `Are you sure you want to un-reconcile ${reconciledSelected.length} entries? The linked transactions will remain.`;

    if (!window.confirm(message)) {
      return;
    }

    setIsBulkUnreconciling(true);
    let succeeded = 0;
    let failed = 0;

    for (const entryId of reconciledSelected) {
      try {
        // Delete any records that were created during reconciliation
        await deleteCreatedRecords(entryId);

        // Delete all reconciliation entries for this bank statement
        await api.entities.ReconciliationEntry.deleteWhere({ bank_statement_id: entryId });

        // Mark bank statement as not reconciled
        await api.entities.BankStatement.update(entryId, {
          is_reconciled: false,
          reconciled_at: null,
          reconciled_by: null
        });
        succeeded++;
      } catch (error) {
        console.error('Bulk un-reconcile error for entry:', entryId, error);
        failed++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['investors'] });
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
    queryClient.invalidateQueries({ queryKey: ['other-income'] });
    setSelectedEntries(new Set());
    setIsBulkUnreconciling(false);

    if (failed > 0) {
      alert(`Un-reconciled ${succeeded} entries. ${failed} failed.`);
    }
  };

  // Bulk create expenses - create expense records for selected entries with assigned expense types
  const handleBulkCreateExpenses = async () => {
    // Get selected entries that have expense types assigned
    const entriesToCreate = [...selectedEntries]
      .map(id => bankStatements.find(s => s.id === id))
      .filter(entry => entry && !entry.is_reconciled && entryExpenseTypes.has(entry.id));

    if (entriesToCreate.length === 0) return;

    if (!window.confirm(`Create ${entriesToCreate.length} expense records and reconcile them?`)) {
      return;
    }

    setIsBulkCreatingExpenses(true);
    setBulkExpenseProgress({ current: 0, total: entriesToCreate.length });

    let succeeded = 0;
    let failed = 0;

    for (const entry of entriesToCreate) {
      try {
        const expenseTypeId = entryExpenseTypes.get(entry.id);
        const expenseType = expenseTypes.find(t => t.id === expenseTypeId);
        const amount = Math.abs(entry.amount);

        // Create expense record
        const expense = await api.entities.Expense.create({
          type_id: expenseTypeId,
          type_name: expenseType?.name || null,
          amount: amount,
          date: entry.statement_date,
          description: entry.description
        });

        // Create reconciliation entry
        await api.entities.ReconciliationEntry.create({
          bank_statement_id: entry.id,
          expense_id: expense.id,
          amount: amount,
          reconciliation_type: 'expense',
          notes: 'Bulk created expense',
          was_created: true
        });

        // Mark bank statement as reconciled
        await api.entities.BankStatement.update(entry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        succeeded++;
      } catch (error) {
        console.error('Bulk expense create error:', entry.id, error);
        failed++;
      }

      setBulkExpenseProgress({ current: succeeded + failed, total: entriesToCreate.length });
    }

    // Invalidate queries once at end
    queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
    queryClient.invalidateQueries({ queryKey: ['expenses'] });

    // Clear selections and expense type assignments for created entries
    setSelectedEntries(new Set());
    // Only clear expense types for successfully processed entries
    setEntryExpenseTypes(prev => {
      const next = new Map(prev);
      for (const entry of entriesToCreate) {
        next.delete(entry.id);
      }
      return next;
    });
    setIsBulkCreatingExpenses(false);
    setAutoMatchResults({ succeeded, failed });
  };

  // Bulk create other income handler
  const handleBulkCreateOtherIncome = async () => {
    // Get selected entries that are marked as other income
    const entriesToCreate = [...selectedEntries]
      .map(id => bankStatements.find(s => s.id === id))
      .filter(entry => entry && !entry.is_reconciled && entryOtherIncome.has(entry.id));

    if (entriesToCreate.length === 0) return;

    if (!window.confirm(`Create ${entriesToCreate.length} other income records and reconcile them?`)) {
      return;
    }

    setIsBulkCreatingOtherIncome(true);
    setBulkOtherIncomeProgress({ current: 0, total: entriesToCreate.length });

    let succeeded = 0;
    let failed = 0;

    for (const entry of entriesToCreate) {
      try {
        const amount = Math.abs(entry.amount);

        // Create other income record
        const otherIncome = await api.entities.OtherIncome.create({
          amount: amount,
          date: entry.statement_date,
          description: entry.description
        });

        // Create reconciliation entry
        await api.entities.ReconciliationEntry.create({
          bank_statement_id: entry.id,
          other_income_id: otherIncome.id,
          amount: amount,
          reconciliation_type: 'other_income',
          notes: 'Bulk created other income',
          was_created: true
        });

        // Mark bank statement as reconciled
        await api.entities.BankStatement.update(entry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        succeeded++;
      } catch (error) {
        console.error('Bulk other income create error:', entry.id, error);
        failed++;
      }

      setBulkOtherIncomeProgress({ current: succeeded + failed, total: entriesToCreate.length });
    }

    // Invalidate queries once at end
    queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
    queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
    queryClient.invalidateQueries({ queryKey: ['other-income'] });

    // Clear selections and other income marks for created entries
    setSelectedEntries(new Set());
    setEntryOtherIncome(prev => {
      const next = new Set(prev);
      for (const entry of entriesToCreate) {
        next.delete(entry.id);
      }
      return next;
    });
    setIsBulkCreatingOtherIncome(false);
    setAutoMatchResults({ succeeded, failed });
  };

  // Quick un-reconcile from list view (single entry)
  const handleQuickUnreconcile = async (entry) => {
    if (!entry.is_reconciled) return;

    // Check if any created records will be deleted
    const recEntries = reconciliationEntries.filter(re => re.bank_statement_id === entry.id);
    const hasCreatedRecords = recEntries.some(e => e.was_created);

    const message = hasCreatedRecords
      ? 'Un-reconcile this entry? The transactions/records that were created will be DELETED.'
      : 'Un-reconcile this entry? The linked transactions will remain.';

    if (!window.confirm(message)) {
      return;
    }

    try {
      // Delete any records that were created during reconciliation
      await deleteCreatedRecords(entry.id);

      await api.entities.ReconciliationEntry.deleteWhere({ bank_statement_id: entry.id });
      await api.entities.BankStatement.update(entry.id, {
        is_reconciled: false,
        reconciled_at: null,
        reconciled_by: null
      });
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  // Toggle entry selection
  const toggleEntrySelection = (entryId) => {
    setSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  // Select all visible entries based on current filter view
  const selectAllVisible = () => {
    if (filter === 'reconciled') {
      // Select all reconciled entries (for un-reconcile)
      const eligibleIds = filteredStatements.filter(s => s.is_reconciled).map(s => s.id);
      setSelectedEntries(new Set(eligibleIds));
    } else {
      // Select all unreconciled entries with high-confidence suggestions (90%+)
      const eligibleIds = filteredStatements
        .filter(s => {
          if (s.is_reconciled) return false;
          const suggestion = suggestedMatches.get(s.id);
          return suggestion && suggestion.confidence >= 0.9;
        })
        .map(s => s.id);
      setSelectedEntries(new Set(eligibleIds));
    }
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedEntries(new Set());
  };

  // Calculate totals
  const totals = useMemo(() => {
    const unreconciled = bankStatements.filter(s => !s.is_reconciled);
    const withSuggestions = unreconciled.filter(s => suggestedMatches.has(s.id));
    const highConfidence = unreconciled.filter(s => {
      const suggestion = suggestedMatches.get(s.id);
      return suggestion && suggestion.confidence >= 0.7;
    });
    const unreconciledCredits = unreconciled.filter(s => s.amount > 0).reduce((sum, s) => sum + s.amount, 0);
    const unreconciledDebits = unreconciled.filter(s => s.amount < 0).reduce((sum, s) => sum + Math.abs(s.amount), 0);
    return {
      total: bankStatements.length,
      unreconciled: unreconciled.length,
      reconciled: bankStatements.length - unreconciled.length,
      withSuggestions: withSuggestions.length,
      highConfidence: highConfidence.length,
      unreconciledCredits,
      unreconciledDebits
    };
  }, [bankStatements, suggestedMatches]);

  const bankSources = getBankSources();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <FileCheck className="w-8 h-8 text-emerald-600" />
              Bank Reconciliation
            </h1>
            <p className="text-slate-500 mt-1">Import bank statements and reconcile transactions</p>
          </div>

          {/* Stats */}
          <div className="flex gap-3">
            <div className="bg-white rounded-lg px-4 py-2 border border-slate-200">
              <p className="text-xs text-slate-500">Unreconciled</p>
              <p className="text-xl font-bold text-amber-600">{totals.unreconciled}</p>
            </div>
            {totals.withSuggestions > 0 && (
              <div className="bg-purple-50 rounded-lg px-4 py-2 border border-purple-200">
                <p className="text-xs text-purple-600">Suggested</p>
                <p className="text-xl font-bold text-purple-600">{totals.withSuggestions}</p>
              </div>
            )}
            <div className="bg-white rounded-lg px-4 py-2 border border-slate-200">
              <p className="text-xs text-slate-500">Reconciled</p>
              <p className="text-xl font-bold text-emerald-600">{totals.reconciled}</p>
            </div>
          </div>
        </div>

        {/* Auto-match results */}
        {autoMatchResults && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <AlertDescription className="text-emerald-800">
              Auto-reconciled {autoMatchResults.succeeded} entries successfully
              {autoMatchResults.failed > 0 && `, ${autoMatchResults.failed} failed`}
            </AlertDescription>
          </Alert>
        )}

        {/* Import Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Import Bank Statement
            </CardTitle>
            <CardDescription>Upload a CSV file from your bank</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="w-48">
                <Label>Bank Source</Label>
                <Select value={bankSource} onValueChange={setBankSource}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bankSources.map(source => (
                      <SelectItem key={source.value} value={source.value}>
                        {source.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[200px]">
                <Label>CSV File</Label>
                <Input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileChange}
                  disabled={isImporting}
                />
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleImport}
                  disabled={!file || isImporting}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Import
                    </>
                  )}
                </Button>
              </div>
            </div>

            {importResult && (
              <Alert className={importResult.success ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}>
                {importResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600" />
                )}
                <AlertDescription className={importResult.success ? "text-emerald-800" : "text-red-800"}>
                  {importResult.success ? (
                    <span>
                      Imported {importResult.created} entries
                      {importResult.duplicates > 0 && ` (${importResult.duplicates} duplicates skipped)`}
                    </span>
                  ) : (
                    <span>{importResult.error}</span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Filters and Actions */}
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All ({totals.total})
            </Button>
            <Button
              variant={filter === 'unreconciled' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('unreconciled')}
              className={filter === 'unreconciled' ? 'bg-amber-600 hover:bg-amber-700' : ''}
            >
              Unreconciled ({totals.unreconciled})
            </Button>
            {totals.withSuggestions > 0 && (
              <Button
                variant={filter === 'suggested' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter('suggested')}
                className={filter === 'suggested' ? 'bg-purple-600 hover:bg-purple-700' : 'border-purple-300 text-purple-700'}
              >
                <Sparkles className="w-3 h-3 mr-1" />
                Suggested ({totals.withSuggestions})
              </Button>
            )}
            <Button
              variant={filter === 'reconciled' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('reconciled')}
              className={filter === 'reconciled' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              Reconciled ({totals.reconciled})
            </Button>
          </div>

          <div className="flex gap-3 items-center">
            {/* Confidence Filter */}
            <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Match %" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All confidence</SelectItem>
                <SelectItem value="100">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    90%+ (Best)
                  </span>
                </SelectItem>
                <SelectItem value="90">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    80-89% (Good)
                  </span>
                </SelectItem>
                <SelectItem value="70">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                    65-79% (Fair)
                  </span>
                </SelectItem>
                <SelectItem value="50">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    50-64% (Check)
                  </span>
                </SelectItem>
                <SelectItem value="low">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    Below 50%
                  </span>
                </SelectItem>
                <SelectItem value="none">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400"></span>
                    No suggestion
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-48"
              />
            </div>

            {totals.highConfidence > 0 && (
              <Button
                onClick={handleAutoReconcile}
                disabled={isAutoMatching}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isAutoMatching ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4 mr-2" />
                    Auto-Reconcile ({totals.highConfidence})
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {totals.unreconciled > 0 && (
          <div className="text-sm text-slate-600">
            Unreconciled: <span className="text-emerald-600 font-medium">{formatCurrency(totals.unreconciledCredits)}</span> in /
            <span className="text-red-600 font-medium ml-1">{formatCurrency(totals.unreconciledDebits)}</span> out
          </div>
        )}

        {/* Bulk Actions Bar */}
        {selectedEntries.size > 0 && (() => {
          // Count selected by type
          const selectedUnreconciledWithSuggestion = [...selectedEntries].filter(id => {
            const entry = bankStatements.find(s => s.id === id);
            if (!entry || entry.is_reconciled) return false;
            const suggestion = suggestedMatches.get(id);
            return suggestion && suggestion.confidence >= 0.9;
          }).length;
          const selectedReconciled = [...selectedEntries].filter(id => {
            const entry = bankStatements.find(s => s.id === id);
            return entry?.is_reconciled;
          }).length;
          const selectedWithExpenseType = [...selectedEntries].filter(id => {
            const entry = bankStatements.find(s => s.id === id);
            return entry && !entry.is_reconciled && entryExpenseTypes.has(id);
          }).length;
          const selectedWithOtherIncome = [...selectedEntries].filter(id => {
            const entry = bankStatements.find(s => s.id === id);
            return entry && !entry.is_reconciled && entryOtherIncome.has(id);
          }).length;

          return (
            <div className="flex items-center gap-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-purple-600" />
                <span className="font-medium text-purple-800">{selectedEntries.size} selected</span>
              </div>
              <div className="flex gap-2">
                {/* Only show Match Selected if unreconciled entries with suggestions are selected */}
                {selectedUnreconciledWithSuggestion > 0 && (
                  <Button
                    size="sm"
                    onClick={handleBulkMatch}
                    disabled={isBulkMatching || isBulkUnreconciling || isBulkCreatingExpenses}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {isBulkMatching ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Matching {bulkMatchProgress.current}/{bulkMatchProgress.total}...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Match Selected ({selectedUnreconciledWithSuggestion})
                      </>
                    )}
                  </Button>
                )}
                {/* Show Create Expenses if entries with expense types are selected */}
                {selectedWithExpenseType > 0 && (
                  <Button
                    size="sm"
                    onClick={handleBulkCreateExpenses}
                    disabled={isBulkMatching || isBulkUnreconciling || isBulkCreatingExpenses}
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {isBulkCreatingExpenses ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating {bulkExpenseProgress.current}/{bulkExpenseProgress.total}...
                      </>
                    ) : (
                      <>
                        <Receipt className="w-4 h-4 mr-2" />
                        Create Expenses ({selectedWithExpenseType})
                      </>
                    )}
                  </Button>
                )}
                {/* Show Create Other Income if entries marked as other income are selected */}
                {selectedWithOtherIncome > 0 && (
                  <Button
                    size="sm"
                    onClick={handleBulkCreateOtherIncome}
                    disabled={isBulkMatching || isBulkUnreconciling || isBulkCreatingExpenses || isBulkCreatingOtherIncome}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {isBulkCreatingOtherIncome ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating {bulkOtherIncomeProgress.current}/{bulkOtherIncomeProgress.total}...
                      </>
                    ) : (
                      <>
                        <Coins className="w-4 h-4 mr-2" />
                        Create Other Income ({selectedWithOtherIncome})
                      </>
                    )}
                  </Button>
                )}
                {/* Only show Un-reconcile Selected if reconciled entries are selected */}
                {selectedReconciled > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkUnreconcile}
                    disabled={isBulkMatching || isBulkUnreconciling}
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                  >
                    {isBulkUnreconciling ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Un-reconciling...
                      </>
                    ) : (
                      <>
                        <Unlink className="w-4 h-4 mr-2" />
                        Un-reconcile Selected ({selectedReconciled})
                      </>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearSelection}
                >
                  Clear Selection
                </Button>
              </div>
              {filter !== 'reconciled' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={selectAllVisible}
                  className="ml-auto text-purple-600 hover:text-purple-700"
                >
                  Select All 90%+ Matches
                </Button>
              )}
            </div>
          );
        })()}

        {/* Statements Table */}
        <Card>
          <CardContent className="p-0">
            {statementsLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
              </div>
            ) : filteredStatements.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                {bankStatements.length === 0
                  ? 'No bank statements imported yet. Upload a CSV file above.'
                  : 'No statements match your filters.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="px-2 py-2 w-8">
                        <Checkbox
                          checked={(() => {
                            if (selectedEntries.size === 0) return false;
                            if (filter === 'reconciled') {
                              // Check if all reconciled entries are selected
                              const allReconciled = filteredStatements.filter(s => s.is_reconciled);
                              return allReconciled.length > 0 && allReconciled.every(s => selectedEntries.has(s.id));
                            } else {
                              // Check if all entries with 90%+ suggestions are selected
                              const eligible = filteredStatements.filter(s => {
                                const suggestion = suggestedMatches.get(s.id);
                                return !s.is_reconciled && suggestion && suggestion.confidence >= 0.9;
                              });
                              return eligible.length > 0 && eligible.every(s => selectedEntries.has(s.id));
                            }
                          })()}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              selectAllVisible();
                            } else {
                              clearSelection();
                            }
                          }}
                          className="border-slate-300"
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Description</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase">Amount</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-40">Expense Type</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase w-28">Other Income</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase">Status</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredStatements.map((entry) => {
                      const suggestion = suggestedMatches.get(entry.id);
                      // Can select unreconciled entries with high-confidence suggestions OR reconciled entries (for un-reconcile)
                      const canSelectForMatch = !entry.is_reconciled && suggestion && suggestion.confidence >= 0.9;
                      // Can also select if unreconciled debit with expense type assigned (for bulk expense creation)
                      const hasExpenseTypeAssigned = entryExpenseTypes.has(entry.id);
                      const canSelectForExpense = !entry.is_reconciled && entry.amount < 0 && hasExpenseTypeAssigned;
                      // Show expense type dropdown for unreconciled debits without high-confidence suggestions
                      const showExpenseTypeDropdown = !entry.is_reconciled && entry.amount < 0 && (!suggestion || suggestion.confidence < 0.7);
                      // Can also select if marked as other income (for credits)
                      const isMarkedAsOtherIncome = entryOtherIncome.has(entry.id);
                      const canSelectForOtherIncome = !entry.is_reconciled && entry.amount > 0 && isMarkedAsOtherIncome;
                      // Show other income checkbox for unreconciled credits without high-confidence suggestions
                      const showOtherIncomeCheckbox = !entry.is_reconciled && entry.amount > 0 && (!suggestion || suggestion.confidence < 0.7);
                      const canSelect = canSelectForMatch || canSelectForExpense || canSelectForOtherIncome || entry.is_reconciled;
                      return (
                        <tr key={entry.id} className={`hover:bg-slate-50 ${suggestion ? 'bg-purple-50/30' : ''} ${selectedEntries.has(entry.id) ? 'bg-purple-100/50' : ''}`}>
                          <td className="px-2 py-1.5">
                            {canSelect && (
                              <Checkbox
                                checked={selectedEntries.has(entry.id)}
                                onCheckedChange={() => toggleEntrySelection(entry.id)}
                                className="border-slate-300"
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-sm text-slate-700">
                            {entry.statement_date && isValid(parseISO(entry.statement_date))
                              ? format(parseISO(entry.statement_date), 'dd MMM yyyy')
                              : '-'}
                          </td>
                          <td className="px-3 py-1.5">
                            <button
                              className="text-left w-full group"
                              onClick={() => suggestion ? openReconcileModal(entry, suggestion) : openReconcileModal(entry)}
                            >
                              <p className="text-sm text-slate-700 max-w-md truncate group-hover:text-blue-600 group-hover:underline cursor-pointer" title={`${entry.description} (Click to ${suggestion ? 'review' : 'reconcile'})`}>
                                {entry.description || '-'}
                              </p>
                            </button>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-xs text-slate-400">{entry.bank_source}</span>
                              {suggestion && !entry.is_reconciled && (
                                <>
                                  {/* Only show confidence percentage for actual matches, not for 'create' suggestions */}
                                  {(suggestion.matchMode === 'match' || suggestion.matchMode === 'match_group') && (
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 py-0">
                                      <Sparkles className="w-3 h-3 mr-1" />
                                      {Math.round(suggestion.confidence * 100)}%
                                    </Badge>
                                  )}
                                  <span className="text-xs text-slate-600 max-w-[250px] truncate" title={suggestion.reason}>
                                    {suggestion.reason}
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <span className={`text-sm font-medium ${entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {entry.amount > 0 ? '+' : ''}{formatCurrency(entry.amount)}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 w-40">
                            {showExpenseTypeDropdown ? (
                              <Select
                                value={entryExpenseTypes.get(entry.id) || ''}
                                onValueChange={(value) => setEntryExpenseType(entry.id, value || null)}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Select..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {expenseTypes.map(type => (
                                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center w-28">
                            {showOtherIncomeCheckbox ? (
                              <Checkbox
                                checked={entryOtherIncome.has(entry.id)}
                                onCheckedChange={(checked) => toggleEntryOtherIncome(entry.id, checked)}
                                className="border-emerald-400 data-[state=checked]:bg-emerald-600"
                              />
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {entry.is_reconciled ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 py-0 text-xs">
                                <Check className="w-3 h-3 mr-1" />
                                Reconciled
                              </Badge>
                            ) : suggestion ? (
                              suggestion.matchMode === 'match' || suggestion.matchMode === 'match_group' ? (
                                <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 py-0 text-xs">
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  Match Suggested
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 py-0 text-xs">
                                  Auto-create
                                </Badge>
                              )
                            ) : (
                              <Badge variant="outline" className="text-slate-500 border-slate-300 py-0 text-xs">
                                Pending
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex justify-end gap-0.5">
                              {!entry.is_reconciled ? (
                                <>
                                  {suggestion && (
                                    <>
                                      {suggestion.confidence >= 0.9 && (
                                        <Button
                                          size="icon"
                                          onClick={() => handleQuickMatch(entry, suggestion)}
                                          className="bg-purple-600 hover:bg-purple-700 h-7 w-7"
                                          title={`Quick match: ${suggestion.reason}`}
                                        >
                                          <Zap className="w-3.5 h-3.5" />
                                        </Button>
                                      )}
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        onClick={() => openReconcileModal(entry, suggestion)}
                                        className={`h-7 w-7 ${suggestion.matchMode === 'match' ? 'border-blue-300 text-blue-700 hover:bg-blue-50' : 'border-purple-300 text-purple-700 hover:bg-purple-50'}`}
                                        title="Review and reconcile"
                                      >
                                        <Search className="w-3.5 h-3.5" />
                                      </Button>
                                    </>
                                  )}
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => openReconcileModal(entry)}
                                    title="Manual reconciliation"
                                    className="h-7 w-7"
                                  >
                                    <Link2 className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openReconcileModal(entry)}
                                    className="h-7 text-xs px-2"
                                  >
                                    View
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => handleQuickUnreconcile(entry)}
                                    title="Un-reconcile"
                                    className="h-7 w-7 border-amber-300 text-amber-600 hover:bg-amber-50"
                                  >
                                    <Unlink className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Patterns info */}
        {patterns.length > 0 && (
          <div className="text-xs text-slate-400 text-center">
            {patterns.length} learned pattern{patterns.length !== 1 ? 's' : ''} for auto-matching
          </div>
        )}

        {/* Reconciliation Modal */}
        <Dialog open={!!selectedEntry} onOpenChange={(open) => { if (!open) { setSelectedEntry(null); setReviewingSuggestion(null); setSelectedOffsetEntries([]); setOffsetNotes(''); } }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedEntry?.is_reconciled ? 'View Reconciled Entry' : reviewingSuggestion ? 'Review Suggested Match' : 'Reconcile Bank Entry'}
              </DialogTitle>
              <DialogDescription>
                {selectedEntry?.is_reconciled
                  ? 'This bank entry has been reconciled to the following transaction(s)'
                  : reviewingSuggestion
                    ? 'Confirm or reject this suggested match'
                    : 'Match this bank entry to a system transaction or create a new one'}
              </DialogDescription>
            </DialogHeader>

            {selectedEntry && reviewingSuggestion && (() => {
              // Calculate match status for display
              const tx = reviewingSuggestion.existingTransaction;
              const exp = reviewingSuggestion.existingExpense;
              const txGroup = reviewingSuggestion.existingTransactions; // For grouped matches
              const isGrouped = reviewingSuggestion.matchMode === 'match_group' && txGroup;
              const matchedItem = tx || exp;
              const bankDate = selectedEntry.statement_date;
              const matchDate = isGrouped ? txGroup[0]?.date : matchedItem?.date;
              const bankAmount = Math.abs(selectedEntry.amount);
              const matchAmount = isGrouped
                ? txGroup.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0)
                : (matchedItem ? Math.abs(matchedItem.amount) : bankAmount);
              const dateMatches = isGrouped
                ? txGroup.every(t => datesWithinDays(bankDate, t.date, 1))
                : (matchedItem ? (bankDate === matchDate || datesWithinDays(bankDate, matchDate, 0)) : false);
              const amountMatches = amountsMatch(bankAmount, matchAmount, 1);

              return (
              /* SIMPLIFIED VIEW FOR REVIEWING A SUGGESTION - SIDE BY SIDE */
              <div className="space-y-4">
                {/* Match Status Header */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {(reviewingSuggestion.matchMode === 'match' || reviewingSuggestion.matchMode === 'match_group') && (
                      <>
                        <Badge className={dateMatches ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-200'}>
                          {dateMatches ? <Check className="w-3 h-3 mr-1" /> : null}
                          Date {dateMatches ? 'matches' : 'differs'}
                        </Badge>
                        <Badge className={amountMatches ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-200'}>
                          {amountMatches ? <Check className="w-3 h-3 mr-1" /> : null}
                          Amount {amountMatches ? 'matches' : 'differs'}
                        </Badge>
                        {dateMatches && amountMatches && (
                          <Badge className="bg-emerald-500 text-white">
                            <Check className="w-3 h-3 mr-1" />
                            100% Match
                          </Badge>
                        )}
                        {isGrouped && (
                          <Badge className="bg-purple-100 text-purple-700 border-purple-300">
                            {txGroup.length} grouped payments
                          </Badge>
                        )}
                      </>
                    )}
                    {reviewingSuggestion.matchMode === 'create' && (
                      <Badge className="bg-amber-100 text-amber-700 border-amber-300">
                        Will create new entry
                      </Badge>
                    )}
                  </div>
                  <Badge className={reviewingSuggestion.matchMode === 'match' || reviewingSuggestion.matchMode === 'match_group' ? 'bg-blue-200 text-blue-800' : 'bg-amber-200 text-amber-800'}>
                    {Math.round(reviewingSuggestion.confidence * 100)}% confidence
                  </Badge>
                </div>

                {/* Side by side comparison */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Left: Bank Statement */}
                  <div className="bg-slate-100 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-3 font-medium">Bank Statement</p>

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-slate-400 uppercase">Date</p>
                        <p className={`text-sm font-medium ${dateMatches ? 'text-emerald-600' : 'text-slate-700'}`}>
                          {selectedEntry.statement_date && isValid(parseISO(selectedEntry.statement_date))
                            ? format(parseISO(selectedEntry.statement_date), 'dd MMM yyyy')
                            : '-'}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-slate-400 uppercase">Amount</p>
                        <p className={`text-lg font-bold ${amountMatches ? 'text-emerald-600' : 'text-slate-700'}`}>
                          {formatCurrency(Math.abs(selectedEntry.amount))}
                          <span className={`text-xs font-normal ml-2 ${selectedEntry.amount > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            ({selectedEntry.amount > 0 ? 'Credit' : 'Debit'})
                          </span>
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-slate-400 uppercase">Description</p>
                        <p className="text-sm text-slate-700 break-words">{selectedEntry.description || '-'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Right: Matched/Suggested Transaction */}
                  <div className={`rounded-lg p-4 ${reviewingSuggestion.matchMode === 'match' || reviewingSuggestion.matchMode === 'match_group' ? 'bg-blue-50 border border-blue-200' : 'bg-amber-50 border border-amber-200'}`}>
                    <p className={`text-xs uppercase tracking-wide mb-3 font-medium ${reviewingSuggestion.matchMode === 'match' || reviewingSuggestion.matchMode === 'match_group' ? 'text-blue-600' : 'text-amber-600'}`}>
                      {reviewingSuggestion.matchMode === 'match_group'
                        ? `${txGroup.length} System Transactions`
                        : reviewingSuggestion.matchMode === 'match'
                          ? 'System Transaction'
                          : 'New Entry'}
                    </p>

                    {/* Grouped transactions view (loan repayments only) */}
                    {isGrouped ? (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs text-slate-400 uppercase">Total Amount</p>
                          <p className={`text-lg font-bold ${amountMatches ? 'text-emerald-600' : 'text-slate-700'}`}>
                            {formatCurrency(matchAmount)}
                            {amountMatches && ' ✓'}
                            <span className="text-xs font-normal ml-2 text-emerald-500">
                              (Credit)
                            </span>
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 uppercase">Borrower</p>
                          <p className="text-sm text-slate-700">
                            {getBorrowerName(reviewingSuggestion.borrower_id)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 uppercase mb-2">Transactions Breakdown</p>
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {txGroup.map((t, idx) => {
                              const loan = loans.find(l => l.id === t.loan_id);
                              return (
                                <div key={idx} className="flex justify-between text-sm bg-white/50 rounded px-2 py-1">
                                  <span className="text-slate-600">
                                    {loan?.loan_number || '?'} - {t.date && isValid(parseISO(t.date)) ? format(parseISO(t.date), 'dd/MM') : '?'}
                                  </span>
                                  <span className="font-medium text-slate-700">{formatCurrency(t.amount)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs text-slate-400 uppercase">Date</p>
                          <p className={`text-sm font-medium ${dateMatches ? 'text-emerald-600' : 'text-slate-700'}`}>
                            {matchedItem?.date && isValid(parseISO(matchedItem.date))
                              ? format(parseISO(matchedItem.date), 'dd MMM yyyy')
                              : selectedEntry.statement_date && isValid(parseISO(selectedEntry.statement_date))
                                ? format(parseISO(selectedEntry.statement_date), 'dd MMM yyyy')
                                : '-'}
                            {dateMatches && ' ✓'}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 uppercase">Amount</p>
                          <p className={`text-lg font-bold ${amountMatches ? 'text-emerald-600' : 'text-slate-700'}`}>
                            {formatCurrency(matchAmount)}
                            {amountMatches && ' ✓'}
                            {(() => {
                              // Determine direction label based on transaction type - use Credit/Debit to match bank terminology
                              const isDebit = ['loan_disbursement', 'investor_withdrawal', 'interest_withdrawal', 'expense'].includes(reviewingSuggestion.type) ||
                                tx?.type === 'Disbursement' || exp;
                              return (
                                <span className={`text-xs font-normal ml-2 ${isDebit ? 'text-red-500' : 'text-emerald-500'}`}>
                                  ({isDebit ? 'Debit' : 'Credit'})
                                </span>
                              );
                            })()}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 uppercase">Type</p>
                          <p className="text-sm font-medium text-slate-700">
                            {tx?.type || (exp && (exp.type_name || 'Expense')) ||
                              (reviewingSuggestion.type === 'loan_repayment' && 'Loan Repayment') ||
                              (reviewingSuggestion.type === 'loan_disbursement' && 'Loan Disbursement') ||
                              (reviewingSuggestion.type === 'investor_credit' && 'Investor Credit') ||
                              (reviewingSuggestion.type === 'investor_withdrawal' && 'Investor Withdrawal') ||
                              (reviewingSuggestion.type === 'interest_withdrawal' && 'Interest Withdrawal') ||
                              (reviewingSuggestion.type === 'expense' && 'Expense')}
                          </p>
                        </div>

                        {/* Entity info */}
                        {reviewingSuggestion.loan_id && (
                          <div>
                            <p className="text-xs text-slate-400 uppercase">Loan</p>
                            <p className="text-sm text-slate-700">
                              {loans.find(l => l.id === reviewingSuggestion.loan_id)?.loan_number} - {getBorrowerName(loans.find(l => l.id === reviewingSuggestion.loan_id)?.borrower_id)}
                            </p>
                          </div>
                        )}
                        {reviewingSuggestion.investor_id && (
                          <div>
                            <p className="text-xs text-slate-400 uppercase">Investor</p>
                            <p className="text-sm text-slate-700">
                              {investors.find(i => i.id === reviewingSuggestion.investor_id)?.business_name || investors.find(i => i.id === reviewingSuggestion.investor_id)?.name}
                            </p>
                          </div>
                        )}
                        {/* Show linked loan for expenses */}
                        {exp?.loan_id && (
                          <div>
                            <p className="text-xs text-slate-400 uppercase">Linked Loan</p>
                            <p className="text-sm text-slate-700">
                              {loans.find(l => l.id === exp.loan_id)?.loan_number} - {getBorrowerName(loans.find(l => l.id === exp.loan_id)?.borrower_id)}
                            </p>
                          </div>
                        )}
                        {(tx?.notes || exp?.description) && (
                          <div>
                            <p className="text-xs text-slate-400 uppercase">Notes</p>
                            <p className="text-sm text-slate-500 break-words">{tx?.notes || exp?.description}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Reason */}
                <p className="text-xs text-slate-400 text-center">
                  Suggested because: {reviewingSuggestion.reason}
                </p>

                {/* Action Buttons */}
                <div className="flex gap-3 justify-end pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => setReviewingSuggestion(null)}
                  >
                    Not Correct - Reconcile Manually
                  </Button>
                  <Button
                    onClick={handleReconcile}
                    disabled={isReconciling}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {isReconciling ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        {reviewingSuggestion.matchMode === 'match_group'
                          ? `Confirm & Link ${txGroup?.length || 0} Payments`
                          : reviewingSuggestion.matchMode === 'match'
                            ? 'Confirm & Link'
                            : 'Confirm & Create'}
                      </>
                    )}
                  </Button>
                </div>
              </div>
              );
            })()}

            {/* VIEW RECONCILED ENTRY */}
            {selectedEntry && selectedEntry.is_reconciled && !reviewingSuggestion && (() => {
              const reconciliationDetails = getReconciliationDetails(selectedEntry.id);

              return (
                <div className="space-y-6">
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

                  {/* Linked Transactions */}
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-3">
                      Reconciled to {reconciliationDetails.length} transaction{reconciliationDetails.length !== 1 ? 's' : ''}:
                    </p>
                    <div className="space-y-3">
                      {reconciliationDetails.map((detail, idx) => (
                        <div key={idx} className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                          <div className="flex justify-between items-start mb-3">
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
                              {detail.entityType}
                            </Badge>
                            <p className="text-lg font-bold text-slate-700">
                              {formatCurrency(Math.abs(detail.entityDetails.amount || detail.amount))}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-slate-400 uppercase">Date</p>
                              <p className="text-slate-700">
                                {detail.entityDetails.date && isValid(parseISO(detail.entityDetails.date))
                                  ? format(parseISO(detail.entityDetails.date), 'dd MMM yyyy')
                                  : '-'}
                              </p>
                            </div>

                            {/* Loan Repayment/Disbursement specific */}
                            {(detail.entityType === 'Loan Repayment' || detail.entityType === 'Loan Disbursement') && (
                              <>
                                <div>
                                  <p className="text-xs text-slate-400 uppercase">Loan</p>
                                  <p className="text-slate-700">{detail.entityDetails.loanNumber}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-400 uppercase">Borrower</p>
                                  <p className="text-slate-700">{detail.entityDetails.borrowerName}</p>
                                </div>
                                {detail.entityType === 'Loan Repayment' && (
                                  <div>
                                    <p className="text-xs text-slate-400 uppercase">Split</p>
                                    <p className="text-slate-700">
                                      Capital: {formatCurrency(detail.entityDetails.principalApplied || 0)}
                                      {(detail.entityDetails.interestApplied > 0) && `, Interest: ${formatCurrency(detail.entityDetails.interestApplied)}`}
                                      {(detail.entityDetails.feesApplied > 0) && `, Fees: ${formatCurrency(detail.entityDetails.feesApplied)}`}
                                    </p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Investor specific */}
                            {detail.entityType.startsWith('Investor') && (
                              <div>
                                <p className="text-xs text-slate-400 uppercase">Investor</p>
                                <p className="text-slate-700">{detail.entityDetails.investorName}</p>
                              </div>
                            )}

                            {/* Expense specific */}
                            {detail.entityType === 'Expense' && (
                              <>
                                <div>
                                  <p className="text-xs text-slate-400 uppercase">Category</p>
                                  <p className="text-slate-700">{detail.entityDetails.expenseTypeName}</p>
                                </div>
                                {detail.entityDetails.linkedLoan && (
                                  <div>
                                    <p className="text-xs text-slate-400 uppercase">Linked Loan</p>
                                    <p className="text-slate-700">
                                      {detail.entityDetails.linkedLoan.loanNumber} - {detail.entityDetails.linkedLoan.borrowerName}
                                    </p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Funds Returned specific */}
                            {detail.entityType === 'Funds Returned' && detail.entityDetails.offsetPartners && (
                              <div className="col-span-2">
                                <p className="text-xs text-slate-400 uppercase mb-2">Matched With</p>
                                <div className="space-y-2">
                                  {detail.entityDetails.offsetPartners.map((partner, pIdx) => (
                                    <div key={pIdx} className="bg-white rounded p-2 border border-emerald-100">
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <p className="text-xs text-slate-500">
                                            {partner.statement_date && isValid(parseISO(partner.statement_date))
                                              ? format(parseISO(partner.statement_date), 'dd MMM yyyy')
                                              : '-'}
                                          </p>
                                          <p className="text-sm text-slate-700 truncate max-w-xs" title={partner.description}>
                                            {partner.description}
                                          </p>
                                        </div>
                                        <p className={`text-sm font-medium ${partner.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                          {partner.amount > 0 ? '+' : ''}{formatCurrency(partner.amount)}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-3 pt-2 border-t border-emerald-100">
                                  <div className="flex justify-between text-sm">
                                    <span className="text-slate-500">This entry:</span>
                                    <span className={`font-medium ${selectedEntry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                      {selectedEntry.amount > 0 ? '+' : ''}{formatCurrency(selectedEntry.amount)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between text-sm mt-1">
                                    <span className="text-slate-500">Net:</span>
                                    <span className="font-bold text-slate-700">
                                      {formatCurrency(selectedEntry.amount + detail.entityDetails.offsetPartners.reduce((sum, p) => sum + p.amount, 0))}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {(detail.entityDetails.notes || detail.entityDetails.description) && (
                            <div className="mt-3 pt-3 border-t border-emerald-200">
                              <p className="text-xs text-slate-400 uppercase">Notes</p>
                              <p className="text-sm text-slate-600">{detail.entityDetails.notes || detail.entityDetails.description}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Reconciliation metadata */}
                  {selectedEntry.reconciled_at && (
                    <p className="text-xs text-slate-400 text-center">
                      Reconciled on {format(parseISO(selectedEntry.reconciled_at), 'dd MMM yyyy HH:mm')}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3 justify-end pt-4 border-t">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedEntry(null)}
                    >
                      Close
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleUnreconcile}
                      disabled={isUnreconciling}
                    >
                      {isUnreconciling ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Un-reconciling...
                        </>
                      ) : (
                        <>
                          <Link2 className="w-4 h-4 mr-2" />
                          Un-reconcile
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })()}

            {selectedEntry && !selectedEntry.is_reconciled && !reviewingSuggestion && (
              /* FULL MANUAL RECONCILIATION FORM */
              <div className="space-y-6">
                {/* Entry Summary */}
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm text-slate-500">
                        {selectedEntry.statement_date && isValid(parseISO(selectedEntry.statement_date))
                          ? format(parseISO(selectedEntry.statement_date), 'dd MMMM yyyy')
                          : '-'}
                      </p>
                      <p className="text-slate-700 mt-1">{selectedEntry.description}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${selectedEntry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {selectedEntry.amount > 0 ? '+' : ''}{formatCurrency(selectedEntry.amount)}
                      </p>
                      <p className="text-xs text-slate-400">{selectedEntry.bank_source}</p>
                    </div>
                  </div>
                </div>

                {/* Transaction Type Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Transaction Type</Label>
                  <RadioGroup
                    value={reconciliationType}
                    onValueChange={(value) => {
                      setReconciliationType(value);
                      setSelectedLoan(null);
                      setSelectedInvestor(null);
                      setSelectedExpenseType(null);
                      setSelectedExistingTx(null);
                      setEntitySearch('');
                      setSelectedOffsetEntries([]);
                      setOffsetNotes('');
                    }}
                    className="grid grid-cols-2 gap-2"
                  >
                    {selectedEntry.amount > 0 ? (
                      <>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="loan_repayment" id="loan_repayment" />
                          <Label htmlFor="loan_repayment" className="cursor-pointer">Loan Repayment</Label>
                        </div>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="investor_credit" id="investor_credit" />
                          <Label htmlFor="investor_credit" className="cursor-pointer">Investor Credit</Label>
                        </div>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="other_income" id="other_income" />
                          <Label htmlFor="other_income" className="cursor-pointer">Other Income</Label>
                        </div>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="offset" id="offset" />
                          <Label htmlFor="offset" className="cursor-pointer">Funds Returned</Label>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="loan_disbursement" id="loan_disbursement" />
                          <Label htmlFor="loan_disbursement" className="cursor-pointer">Loan Disbursement</Label>
                        </div>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="investor_withdrawal" id="investor_withdrawal" />
                          <Label htmlFor="investor_withdrawal" className="cursor-pointer">Investor Withdrawal</Label>
                        </div>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="interest_withdrawal" id="interest_withdrawal" />
                          <Label htmlFor="interest_withdrawal" className="cursor-pointer">Interest Withdrawal</Label>
                        </div>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="expense" id="expense" />
                          <Label htmlFor="expense" className="cursor-pointer">Expense</Label>
                        </div>
                        <div className="flex items-center space-x-2 border rounded-lg p-3 hover:bg-slate-50 cursor-pointer">
                          <RadioGroupItem value="offset" id="offset_debit" />
                          <Label htmlFor="offset_debit" className="cursor-pointer">Funds Returned</Label>
                        </div>
                      </>
                    )}
                  </RadioGroup>
                </div>

                {/* Match or Create Toggle */}
                {reconciliationType && reconciliationType !== 'expense' && reconciliationType !== 'offset' && reconciliationType !== 'other_income' && (
                  <Tabs value={matchMode} onValueChange={setMatchMode}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="create">Create New</TabsTrigger>
                      <TabsTrigger value="match">Match Existing</TabsTrigger>
                    </TabsList>

                    <TabsContent value="create" className="space-y-4 mt-4">
                      {/* Entity Search */}
                      {(reconciliationType === 'loan_repayment' || reconciliationType === 'loan_disbursement') && (
                        <div className="space-y-3">
                          <Label>Select Loan</Label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                              placeholder="Search by loan number or borrower..."
                              value={entitySearch}
                              onChange={(e) => setEntitySearch(e.target.value)}
                              className="pl-9"
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                            {filteredLoans.slice(0, 10).map(loan => (
                              <div
                                key={loan.id}
                                className={`p-3 cursor-pointer hover:bg-slate-50 ${selectedLoan?.id === loan.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''}`}
                                onClick={() => setSelectedLoan(loan)}
                              >
                                <div className="flex justify-between">
                                  <div>
                                    <p className="font-medium">{loan.loan_number}</p>
                                    <p className="text-sm text-slate-500">{getBorrowerName(loan.borrower_id)}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-medium">{formatCurrency(loan.principal_amount)}</p>
                                    <p className="text-xs text-slate-500">Balance: {formatCurrency((loan.principal_amount || 0) - (loan.principal_paid || 0))}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {filteredLoans.length === 0 && (
                              <p className="p-3 text-sm text-slate-500">No matching loans found</p>
                            )}
                          </div>

                          {/* Split Amounts for Repayments */}
                          {reconciliationType === 'loan_repayment' && selectedLoan && (
                            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                              <Label className="text-base">Payment Split</Label>
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <Label className="text-xs">Capital</Label>
                                  <Input
                                    type="number"
                                    value={splitAmounts.capital}
                                    onChange={(e) => setSplitAmounts(prev => ({ ...prev, capital: parseFloat(e.target.value) || 0 }))}
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">Interest</Label>
                                  <Input
                                    type="number"
                                    value={splitAmounts.interest}
                                    onChange={(e) => setSplitAmounts(prev => ({ ...prev, interest: parseFloat(e.target.value) || 0 }))}
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">Fees</Label>
                                  <Input
                                    type="number"
                                    value={splitAmounts.fees}
                                    onChange={(e) => setSplitAmounts(prev => ({ ...prev, fees: parseFloat(e.target.value) || 0 }))}
                                  />
                                </div>
                              </div>
                              <p className="text-sm text-slate-500">
                                Total: {formatCurrency(splitAmounts.capital + splitAmounts.interest + splitAmounts.fees)} /
                                Bank: {formatCurrency(Math.abs(selectedEntry.amount))}
                                {Math.abs((splitAmounts.capital + splitAmounts.interest + splitAmounts.fees) - Math.abs(selectedEntry.amount)) > 0.01 && (
                                  <span className="text-amber-600 ml-2">
                                    (Difference: {formatCurrency(Math.abs(selectedEntry.amount) - (splitAmounts.capital + splitAmounts.interest + splitAmounts.fees))})
                                  </span>
                                )}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Investor Selection */}
                      {(reconciliationType === 'investor_credit' || reconciliationType === 'investor_withdrawal' || reconciliationType === 'interest_withdrawal') && (
                        <div className="space-y-3">
                          <Label>Select Investor</Label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                              placeholder="Search by name or account number..."
                              value={entitySearch}
                              onChange={(e) => setEntitySearch(e.target.value)}
                              className="pl-9"
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                            {filteredInvestors.slice(0, 10).map(investor => (
                              <div
                                key={investor.id}
                                className={`p-3 cursor-pointer hover:bg-slate-50 ${selectedInvestor?.id === investor.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''}`}
                                onClick={() => setSelectedInvestor(investor)}
                              >
                                <div className="flex justify-between">
                                  <div>
                                    <p className="font-medium">{investor.business_name || investor.name}</p>
                                    <p className="text-sm text-slate-500">{investor.account_number}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-medium">{formatCurrency(investor.current_capital_balance || 0)}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {filteredInvestors.length === 0 && (
                              <p className="p-3 text-sm text-slate-500">No matching investors found</p>
                            )}
                          </div>

                        </div>
                      )}

                      {/* Save pattern checkbox */}
                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="checkbox"
                          id="savePattern"
                          checked={savePattern}
                          onChange={(e) => setSavePattern(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        <Label htmlFor="savePattern" className="text-sm text-slate-600 cursor-pointer">
                          Remember this match for future auto-reconciliation
                        </Label>
                      </div>
                    </TabsContent>

                    <TabsContent value="match" className="space-y-4 mt-4">
                      {/* Potential Matches */}
                      <div className="space-y-3">
                        <Label>Potential Matches</Label>
                        {potentialMatches.length > 0 ? (
                          <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                            {potentialMatches.map(tx => (
                              <div
                                key={tx.id}
                                className={`p-3 cursor-pointer hover:bg-slate-50 ${selectedExistingTx?.id === tx.id ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''}`}
                                onClick={() => setSelectedExistingTx(tx)}
                              >
                                <div className="flex justify-between">
                                  <div>
                                    <p className="text-sm text-slate-500">
                                      {tx.date && isValid(parseISO(tx.date))
                                        ? format(parseISO(tx.date), 'dd MMM yyyy')
                                        : '-'}
                                    </p>
                                    <p className="font-medium">{tx.type || tx.reference || 'Transaction'}</p>
                                    <p className="text-xs text-slate-500">{tx.notes || tx.description || '-'}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-medium">{formatCurrency(tx.amount)}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-500 p-4 border rounded-lg bg-slate-50">
                            No unreconciled transactions found with similar amount or date.
                            Try creating a new transaction instead.
                          </p>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                )}

                {/* Expense Form */}
                {reconciliationType === 'expense' && (
                  <div className="space-y-4">
                    <div>
                      <Label>Expense Type (optional)</Label>
                      <Select
                        value={selectedExpenseType?.id || ''}
                        onValueChange={(value) => setSelectedExpenseType(expenseTypes.find(t => t.id === value))}
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
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Input
                        value={expenseDescription}
                        onChange={(e) => setExpenseDescription(e.target.value)}
                        placeholder="Expense description..."
                      />
                    </div>
                    {/* Save pattern checkbox for expenses */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="savePatternExpense"
                        checked={savePattern}
                        onChange={(e) => setSavePattern(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <Label htmlFor="savePatternExpense" className="text-sm text-slate-600 cursor-pointer">
                        Remember this match for future auto-reconciliation
                      </Label>
                    </div>
                  </div>
                )}

                {/* Other Income Form */}
                {reconciliationType === 'other_income' && (
                  <div className="space-y-4">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                      <p className="text-sm text-emerald-700">
                        This will create an Other Income record with the description from the bank statement.
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-sm font-medium text-slate-700">Amount: <span className="text-emerald-600">{formatCurrency(Math.abs(selectedEntry.amount))}</span></p>
                      <p className="text-sm text-slate-600 mt-1">Description: {selectedEntry.description}</p>
                    </div>
                  </div>
                )}

                {/* Funds Returned Form */}
                {reconciliationType === 'offset' && (
                  <div className="space-y-4">
                    {/* Explanation */}
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-sm text-amber-700">
                        Select the matching bank entries for funds that were returned (e.g., funds received in error and then sent back).
                        The selected entries must balance to zero.
                      </p>
                    </div>

                    {/* Current entry summary */}
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-sm font-medium text-slate-700">This entry:</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`font-mono font-semibold ${selectedEntry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {formatCurrency(selectedEntry.amount)}
                        </span>
                        <span className="text-sm text-slate-500">
                          {format(parseISO(selectedEntry.statement_date), 'dd/MM/yyyy')}
                        </span>
                        <span className="text-sm text-slate-600 truncate">
                          {selectedEntry.description?.substring(0, 40)}...
                        </span>
                      </div>
                    </div>

                    {/* Select matching entries */}
                    <div className="space-y-2">
                      <Label>Select matching entries:</Label>
                      <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                        {bankStatements
                          .filter(e =>
                            !e.is_reconciled &&
                            e.id !== selectedEntry.id &&
                            // Show entries with opposite sign (to offset)
                            ((selectedEntry.amount > 0 && e.amount < 0) || (selectedEntry.amount < 0 && e.amount > 0))
                          )
                          .sort((a, b) => {
                            // Sort by date proximity first, then by amount match
                            const dateA = parseISO(a.statement_date);
                            const dateB = parseISO(b.statement_date);
                            const entryDate = parseISO(selectedEntry.statement_date);
                            const diffA = Math.abs(dateA - entryDate);
                            const diffB = Math.abs(dateB - entryDate);
                            return diffA - diffB;
                          })
                          .map(entry => {
                            const isSelected = selectedOffsetEntries.some(e => e.id === entry.id);
                            const toggleEntry = () => {
                              if (isSelected) {
                                setSelectedOffsetEntries(prev => prev.filter(e => e.id !== entry.id));
                              } else {
                                setSelectedOffsetEntries(prev => [...prev, entry]);
                              }
                            };
                            return (
                              <div
                                key={entry.id}
                                className={`flex items-center gap-3 p-2 cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-blue-50' : ''}`}
                                onClick={toggleEntry}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onClick={(e) => e.stopPropagation()}
                                  onCheckedChange={toggleEntry}
                                />
                                <span className="text-xs text-slate-500 w-20">
                                  {format(parseISO(entry.statement_date), 'dd/MM/yyyy')}
                                </span>
                                <span className={`font-mono text-sm w-24 ${entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {formatCurrency(entry.amount)}
                                </span>
                                <span className="text-sm text-slate-600 truncate flex-1">
                                  {entry.description?.substring(0, 50)}
                                </span>
                              </div>
                            );
                          })}
                        {bankStatements.filter(e =>
                          !e.is_reconciled &&
                          e.id !== selectedEntry.id &&
                          ((selectedEntry.amount > 0 && e.amount < 0) || (selectedEntry.amount < 0 && e.amount > 0))
                        ).length === 0 && (
                          <div className="p-4 text-center text-slate-500 text-sm">
                            No unreconciled entries with opposite sign available
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Balance summary */}
                    {selectedOffsetEntries.length > 0 && (
                      <div className="bg-slate-100 rounded-lg p-3 space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>This entry:</span>
                          <span className={`font-mono ${selectedEntry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {formatCurrency(selectedEntry.amount)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Selected entries ({selectedOffsetEntries.length}):</span>
                          <span className="font-mono">
                            {formatCurrency(selectedOffsetEntries.reduce((sum, e) => sum + e.amount, 0))}
                          </span>
                        </div>
                        <div className="border-t pt-1 mt-1 flex justify-between text-sm font-medium">
                          <span>Net:</span>
                          {(() => {
                            const net = selectedEntry.amount + selectedOffsetEntries.reduce((sum, e) => sum + e.amount, 0);
                            const isBalanced = Math.abs(net) < 0.01;
                            return (
                              <span className={`font-mono ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
                                {formatCurrency(net)} {isBalanced ? '✓ Balanced' : '⚠ Imbalanced'}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Notes field */}
                    <div className="space-y-2">
                      <Label htmlFor="offsetNotes">Reason (required) *</Label>
                      <Input
                        id="offsetNotes"
                        value={offsetNotes}
                        onChange={(e) => setOffsetNotes(e.target.value)}
                        placeholder="e.g., Funds received in error - returned same day"
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button variant="outline" onClick={() => setSelectedEntry(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleReconcile}
                    disabled={
                      isReconciling ||
                      !reconciliationType ||
                      (reconciliationType === 'loan_repayment' && matchMode === 'create' && !selectedLoan) ||
                      (reconciliationType === 'loan_disbursement' && matchMode === 'create' && !selectedLoan) ||
                      (reconciliationType.startsWith('investor_') && matchMode === 'create' && !selectedInvestor) ||
                      (reconciliationType === 'interest_withdrawal' && matchMode === 'create' && !selectedInvestor) ||
                      (matchMode === 'match' && !selectedExistingTx && reconciliationType !== 'offset') ||
                      (reconciliationType === 'offset' && (selectedOffsetEntries.length === 0 || !offsetNotes.trim() || Math.abs(selectedEntry.amount + selectedOffsetEntries.reduce((sum, e) => sum + e.amount, 0)) >= 0.01))
                    }
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {isReconciling ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : reconciliationType === 'offset' ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Mark as Funds Returned
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        {matchMode === 'match' ? 'Match & Reconcile' : 'Create & Reconcile'}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
