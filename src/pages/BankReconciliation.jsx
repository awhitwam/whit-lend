import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload, CheckCircle2, AlertCircle, Loader2, Search, FileCheck,
  ArrowUpRight, ArrowDownLeft, Check, Link2, Unlink,
  Sparkles, Wand2, Zap, CheckSquare, Receipt, Coins, Tag, Plus, X, Undo2,
  ChevronUp, ChevronDown, ChevronRight, Trash2, AlertTriangle, Ban
} from 'lucide-react';
import { format, parseISO, isValid, differenceInDays } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { parseBankStatement, getBankSources, parseCSV, detectBankFormat } from '@/lib/bankStatementParsers';
import { logReconciliationEvent, AuditAction } from '@/lib/auditLog';

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

/**
 * Check if a matchMode indicates matching to an existing transaction (vs creating new)
 */
function isMatchType(matchMode) {
  return matchMode === 'match' || matchMode === 'match_group' || matchMode === 'grouped_disbursement' || matchMode === 'grouped_investor';
}

/**
 * Find subset of entries that sum to target amount (within 1% tolerance)
 * mustIncludeId: the entry that must be in the subset
 */
function findSubsetSum(entries, targetAmount, mustIncludeId) {
  const mustInclude = entries.find(e => e.id === mustIncludeId);
  if (!mustInclude) return null;

  const others = entries.filter(e => e.id !== mustIncludeId);
  const mustIncludeAmount = Math.abs(mustInclude.amount);

  // If just the must-include entry matches, not a grouped match
  if (amountsMatch(mustIncludeAmount, targetAmount, 1)) return null;

  // Try combinations of increasing size (prefer smaller groups)
  for (let size = 1; size <= Math.min(others.length, 5); size++) {
    const combo = findComboOfSize(others, size, targetAmount - mustIncludeAmount);
    if (combo) {
      return [mustInclude, ...combo];
    }
  }

  return null;
}

/**
 * Find combination of exactly `size` entries that sum to target
 */
function findComboOfSize(entries, size, target) {
  if (size === 1) {
    const match = entries.find(e => amountsMatch(Math.abs(e.amount), target, 1));
    return match ? [match] : null;
  }

  // Recursive: try each entry as first element
  for (let i = 0; i < entries.length - size + 1; i++) {
    const first = entries[i];
    const remaining = entries.slice(i + 1);
    const subCombo = findComboOfSize(remaining, size - 1, target - Math.abs(first.amount));
    if (subCombo) {
      return [first, ...subCombo];
    }
  }

  return null;
}

/**
 * Check if two bank descriptions appear to be parts of the same transaction
 * (e.g., "TOBIE HOLBROOK LOAN PART1" and "TOBIE HOLBROOK LOAN PART2")
 */
function descriptionsAreRelated(desc1, desc2) {
  if (!desc1 || !desc2) return false;

  const norm1 = desc1.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const norm2 = desc2.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

  // Extract words (3+ chars)
  const words1 = norm1.split(/\s+/).filter(w => w.length >= 3);
  const words2 = norm2.split(/\s+/).filter(w => w.length >= 3);

  if (words1.length === 0 || words2.length === 0) return false;

  // Count matching words
  const matches = words1.filter(w => words2.includes(w));

  // Require at least 50% word overlap
  const overlapRatio = matches.length / Math.min(words1.length, words2.length);
  return overlapRatio >= 0.5;
}

/**
 * Check if ALL entries in a group have related descriptions
 */
function groupHasRelatedDescriptions(entries) {
  if (entries.length < 2) return true;

  const firstDesc = entries[0].description;
  return entries.slice(1).every(e => descriptionsAreRelated(firstDesc, e.description));
}

/**
 * Check if bank description contains a name (borrower/investor)
 * Returns a score 0-1 indicating match strength
 */
function descriptionContainsName(description, name, businessName) {
  if (!description) return 0;

  // Normalize name for comparison (remove Ltd, Limited, etc)
  const normalizeName = (n) => {
    if (!n) return '';
    return n.toLowerCase()
      .replace(/\b(ltd|limited|plc|inc|llc|llp|co|company)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const nameNorm = normalizeName(name);
  const bizNorm = normalizeName(businessName);
  const descNorm = normalizeName(description);

  // Check business name first (more specific)
  if (bizNorm && bizNorm.length >= 3 && descNorm.includes(bizNorm)) {
    return 1.0; // Strong match
  }

  // Check individual name
  if (nameNorm && nameNorm.length >= 3 && descNorm.includes(nameNorm)) {
    return 0.9;
  }

  // Check significant words from business name
  if (bizNorm) {
    const words = bizNorm.split(' ').filter(w => w.length >= 4);
    for (const word of words) {
      if (descNorm.includes(word)) {
        return 0.7; // Partial match
      }
    }
  }

  return 0;
}

// Calculate date proximity score (0-1)
function dateProximityScore(date1, date2) {
  if (!date1 || !date2) return 0;
  try {
    const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
    const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
    if (!isValid(d1) || !isValid(d2)) return 0;

    const daysDiff = Math.abs(differenceInDays(d1, d2));
    if (daysDiff === 0) return 1;
    if (daysDiff <= 1) return 0.95;
    if (daysDiff <= 3) return 0.85;
    if (daysDiff <= 7) return 0.70;
    if (daysDiff <= 14) return 0.50;
    if (daysDiff <= 30) return 0.30;
    return 0.1;
  } catch {
    return 0;
  }
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
    score = 0.40; // Amount matches but date is 15-30 days off - still show as suggestion since exact amount is strong signal
  } else if (closeAmount && within14Days) {
    score = 0.25;
  } else if (exactAmount || closeAmount) {
    // Dates are over 30 days apart - cap at 10%
    score = 0.10;
  }

  return score;
}

// Generate human-readable explanation of match confidence
function getMatchExplanation(bankEntry, transaction, dateField = 'date') {
  const entryAmount = Math.abs(parseFloat(bankEntry.amount) || 0);
  const txAmount = Math.abs(parseFloat(transaction.amount) || 0);

  const exactAmount = amountsMatch(entryAmount, txAmount, 0.1);
  const closeAmount = amountsMatch(entryAmount, txAmount, 5);

  const bankDate = bankEntry.statement_date ? parseISO(bankEntry.statement_date) : null;
  const txDate = transaction[dateField] ? parseISO(transaction[dateField]) : null;
  let daysDiff = null;

  if (bankDate && txDate && isValid(bankDate) && isValid(txDate)) {
    daysDiff = Math.abs(differenceInDays(bankDate, txDate));
  }

  const amountExplanation = exactAmount
    ? { text: 'Exact match', icon: 'check', color: 'emerald' }
    : closeAmount
    ? { text: `Within 5% (${formatCurrency(Math.abs(entryAmount - txAmount))} difference)`, icon: 'approx', color: 'amber' }
    : { text: `${formatCurrency(Math.abs(entryAmount - txAmount))} difference`, icon: 'x', color: 'red' };

  let dateExplanation;
  if (daysDiff === null) {
    dateExplanation = { text: 'Date unknown', icon: 'x', color: 'slate' };
  } else if (daysDiff === 0) {
    dateExplanation = { text: 'Same day', icon: 'check', color: 'emerald' };
  } else if (daysDiff <= 3) {
    dateExplanation = { text: `${daysDiff} day${daysDiff > 1 ? 's' : ''} apart`, icon: 'check', color: 'emerald' };
  } else if (daysDiff <= 7) {
    dateExplanation = { text: `${daysDiff} days apart`, icon: 'approx', color: 'amber' };
  } else if (daysDiff <= 14) {
    dateExplanation = { text: `${daysDiff} days apart (moderate gap)`, icon: 'warning', color: 'amber' };
  } else {
    dateExplanation = { text: `${daysDiff} days apart (large gap)`, icon: 'x', color: 'red' };
  }

  return { amount: amountExplanation, date: dateExplanation, daysDiff };
}

// Enhanced keyword extraction for vendor names - cleans messy bank descriptions
function extractVendorKeywords(text) {
  if (!text) return [];

  let cleaned = text.toLowerCase();

  // Remove URLs and domains (www., .com, .co.uk, etc.)
  cleaned = cleaned.replace(/www\./gi, ' ');
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/gi, ' ');
  cleaned = cleaned.replace(/\.(com|co\.uk|org|net|io|app|co|uk|au|de|fr|es|it|nl|ie|ca|nz)/gi, ' ');

  // Remove phone numbers (various formats)
  cleaned = cleaned.replace(/\+?\d{1,4}[\s\-]?\d{6,14}/g, ' '); // +61280056782 format
  cleaned = cleaned.replace(/\d{3}[\s\-]?\d{3}[\s\-]?\d{4}/g, ' '); // 123-456-7890 format

  // Remove 2-letter country codes at word boundaries
  const countryCodes = ['gb', 'uk', 'au', 'us', 'de', 'fr', 'es', 'it', 'nl', 'ie', 'ca', 'nz'];
  cleaned = cleaned.replace(/\b([a-z]{2})\b/g, (match) =>
    countryCodes.includes(match) ? ' ' : match
  );

  // Remove common reference patterns
  cleaned = cleaned.replace(/\b\d{5,}\b/g, ' '); // Reference numbers (5+ digits)
  cleaned = cleaned.replace(/\b[a-z]{1,2}\d{5,}\b/gi, ' '); // Codes like AB12345

  // Remove non-alphanumeric (keep spaces)
  cleaned = cleaned.replace(/[^a-z0-9\s]/g, ' ');

  // Stop words including payment-related terms
  const stopWords = [
    'from', 'to', 'the', 'and', 'for', 'with', 'payment', 'transfer',
    'in', 'out', 'ltd', 'limited', 'plc', 'inc', 'corp', 'llc',
    'card', 'visa', 'mastercard', 'debit', 'credit', 'pos', 'atm',
    'ref', 'reference', 'direct', 'faster', 'bacs', 'chaps', 'fps',
    'gbp', 'usd', 'eur', 'aud', 'purchase', 'sale', 'fee', 'charge'
  ];

  return cleaned
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .slice(0, 5); // Keep only top 5 keywords for matching
}

// Levenshtein distance-based similarity (0-1 scale)
function levenshteinSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);

  // Quick reject for very different lengths
  if (Math.abs(len1 - len2) / maxLen > 0.5) return 0;

  // Create distance matrix
  const matrix = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return 1 - matrix[len1][len2] / maxLen;
}

// Expense Type Combobox with search
function ExpenseTypeCombobox({ expenseTypes, selectedTypeId, expenseSuggestion, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);

  const selectedType = expenseTypes.find(t => t.id === selectedTypeId);

  // Filter expense types based on search
  const filteredTypes = useMemo(() => {
    if (!search.trim()) return expenseTypes;
    const searchLower = search.toLowerCase();
    return expenseTypes.filter(type =>
      type.name.toLowerCase().includes(searchLower)
    );
  }, [expenseTypes, search]);

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleSelect = (typeId) => {
    onSelect(typeId);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-xs hover:underline cursor-pointer">
          {selectedType ? (
            <>
              <Tag className="w-3 h-3 text-amber-600" />
              <span className="text-amber-700">{selectedType.name}</span>
            </>
          ) : expenseSuggestion ? (
            <>
              <Sparkles className="w-3 h-3 text-purple-500" />
              <span className="text-purple-600">{expenseSuggestion.expenseTypeName}?</span>
            </>
          ) : (
            <span className="text-slate-400">+ type</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="pb-1">
          <Input
            ref={inputRef}
            placeholder="Search expense types..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {expenseSuggestion && !search && (
            <>
              <button
                onClick={() => handleSelect(expenseSuggestion.expenseTypeId)}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-purple-50 flex items-center gap-1.5 bg-purple-50/50"
              >
                <Sparkles className="w-3 h-3 text-purple-600 flex-shrink-0" />
                <span className="flex-1 text-purple-900">{expenseSuggestion.expenseTypeName}</span>
                <span className="text-purple-500">{Math.round(expenseSuggestion.confidence * 100)}%</span>
              </button>
              <div className="border-b border-slate-100 my-1" />
            </>
          )}
          {filteredTypes.length === 0 ? (
            <div className="px-2 py-2 text-xs text-slate-400 text-center">No matches found</div>
          ) : (
            filteredTypes
              .filter(type => !expenseSuggestion || type.id !== expenseSuggestion.expenseTypeId || search)
              .map(type => (
                <button
                  key={type.id}
                  onClick={() => handleSelect(type.id)}
                  className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-slate-100 ${selectedTypeId === type.id ? 'bg-slate-100 font-medium' : ''}`}
                >
                  {type.name}
                </button>
              ))
          )}
          {selectedTypeId && (
            <>
              <div className="border-t border-slate-100 mt-1 pt-1" />
              <button
                onClick={() => handleSelect(null)}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-red-50 text-red-600"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Loan Combobox with search for linking expenses to loans
function LoanSelectCombobox({ loans, selectedLoan, onSelect, getBorrowerName }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);

  // Filter loans based on search
  const filteredLoans = useMemo(() => {
    const activeLoans = loans.filter(l => !l.is_deleted);
    if (!search.trim()) return activeLoans;
    const searchLower = search.toLowerCase();
    return activeLoans.filter(loan =>
      loan.borrower_name?.toLowerCase().includes(searchLower) ||
      loan.loan_number?.toLowerCase().includes(searchLower) ||
      loan.description?.toLowerCase().includes(searchLower) ||
      getBorrowerName?.(loan.borrower_id)?.toLowerCase().includes(searchLower)
    );
  }, [loans, search, getBorrowerName]);

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleSelect = (loan) => {
    onSelect(loan);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          {selectedLoan ? (
            <span className="truncate">
              {selectedLoan.borrower_name} - {selectedLoan.loan_number}
            </span>
          ) : (
            <span className="text-slate-500">No loan linked</span>
          )}
          <ChevronDown className="w-4 h-4 ml-2 opacity-50 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-2" align="start">
        <div className="pb-2">
          <Input
            ref={inputRef}
            placeholder="Search by borrower, loan number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {/* None option */}
          <button
            onClick={() => handleSelect(null)}
            className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100 ${!selectedLoan ? 'bg-slate-100 font-medium' : ''}`}
          >
            <span className="text-slate-500">No loan linked</span>
          </button>

          <div className="border-t border-slate-100 my-1" />

          {filteredLoans.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-400 text-center">No loans found</div>
          ) : (
            filteredLoans.map(loan => (
              <button
                key={loan.id}
                onClick={() => handleSelect(loan)}
                className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100 ${selectedLoan?.id === loan.id ? 'bg-blue-50 border border-blue-200' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{loan.borrower_name}</span>
                  <span className="text-xs text-slate-500">{loan.loan_number}</span>
                </div>
                {loan.description && (
                  <div className="text-xs text-slate-500 truncate mt-0.5">{loan.description}</div>
                )}
                <div className="flex items-center justify-between mt-0.5">
                  {loan.start_date && (
                    <span className="text-xs text-slate-400">
                      {format(parseISO(loan.start_date), 'dd MMM yyyy')}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
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
  const [activeTab, setActiveTab] = useState('match'); // 'match' (Match to Existing) or 'create' (Create New)
  const [filter, setFilter] = useState('unreconciled'); // all, unreconciled, reconciled, suggested
  const [searchTerm, setSearchTerm] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState('all'); // all, 100, 90, 70, 50, none
  const [sortBy, setSortBy] = useState('date'); // date, amount, linksTo
  const [sortDirection, setSortDirection] = useState('desc'); // asc, desc
  const [expandedGroups, setExpandedGroups] = useState(new Set()); // For grouped reconciled view
  const [expandedNetReceiptGroups, setExpandedNetReceiptGroups] = useState(new Set()); // For net receipt groups in reconciled view

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
  const [selectedExpenseLoan, setSelectedExpenseLoan] = useState(null); // Link expense to a loan
  const [selectedExistingTxs, setSelectedExistingTxs] = useState([]); // Array for multi-select matching
  const [entitySearch, setEntitySearch] = useState('');
  const [splitAmounts, setSplitAmounts] = useState({ capital: 0, interest: 0, fees: 0 });
  const [investorWithdrawalSplit, setInvestorWithdrawalSplit] = useState({ capital: 0, interest: 0 });
  // Multi-loan repayment allocation state
  const [multiLoanAllocations, setMultiLoanAllocations] = useState([]); // [{ loan, principal: 0, interest: 0, fees: 0 }, ...]
  const [multiLoanBorrowerId, setMultiLoanBorrowerId] = useState(null); // Lock to one borrower when adding loans
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

  // Delete unreconciled entries state
  const [showDeleteUnreconciledDialog, setShowDeleteUnreconciledDialog] = useState(false);
  const [isDeletingUnreconciled, setIsDeletingUnreconciled] = useState(false);

  // Mark as unreconcilable state
  const [showUnreconcilableDialog, setShowUnreconcilableDialog] = useState(false);
  const [unreconcilableReason, setUnreconcilableReason] = useState('');
  const [isMarkingUnreconcilable, setIsMarkingUnreconcilable] = useState(false);

  // Simple setter - the propagation logic will be in a separate function defined after data is loaded
  const setEntryExpenseTypeSimple = (entryId, expenseTypeId) => {
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

  // Dismissed suggestions - entries where user wants to ignore the auto-match and create new instead
  // Persisted to localStorage so dismissals survive page refreshes
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => {
    try {
      const stored = localStorage.getItem('bankRecon_dismissedSuggestions');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Persist dismissed suggestions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('bankRecon_dismissedSuggestions', JSON.stringify([...dismissedSuggestions]));
    } catch {
      // Ignore storage errors
    }
  }, [dismissedSuggestions]);

  const dismissSuggestion = (entryId) => {
    setDismissedSuggestions(prev => {
      const next = new Set(prev);
      next.add(entryId);
      return next;
    });
  };

  const restoreSuggestion = (entryId) => {
    setDismissedSuggestions(prev => {
      const next = new Set(prev);
      next.delete(entryId);
      return next;
    });
  };
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

  // Grouped entries state - allows combining multiple bank entries into one for matching
  // Map of groupId -> Set of entryIds
  const [entryGroups, setEntryGroups] = useState(new Map());
  // Track which user-created bank entry groups are expanded in the UI
  const [expandedBankGroups, setExpandedBankGroups] = useState(new Set());

  // Reverse lookup: entryId -> groupId (for quick checks)
  const entryToGroup = useMemo(() => {
    const map = new Map();
    entryGroups.forEach((entryIds, groupId) => {
      entryIds.forEach(id => map.set(id, groupId));
    });
    return map;
  }, [entryGroups]);

  // Group selected entries together
  const handleGroupSelected = () => {
    if (selectedEntries.size < 2) return;

    // Check if any selected entries are already in a group
    const alreadyGrouped = [...selectedEntries].some(id => entryToGroup.has(id));
    if (alreadyGrouped) {
      alert('Some selected entries are already in a group. Ungroup them first.');
      return;
    }

    const groupId = `group-${Date.now()}`;
    setEntryGroups(prev => {
      const next = new Map(prev);
      next.set(groupId, new Set(selectedEntries));
      return next;
    });
    setExpandedBankGroups(prev => {
      const next = new Set(prev);
      next.add(groupId); // Auto-expand newly created group
      return next;
    });
    setSelectedEntries(new Set());
  };

  // Ungroup entries
  const handleUngroupEntries = (groupId) => {
    setEntryGroups(prev => {
      const next = new Map(prev);
      next.delete(groupId);
      return next;
    });
    setExpandedBankGroups(prev => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  };

  // Toggle bank entry group expansion
  const toggleBankGroupExpanded = (groupId) => {
    setExpandedBankGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Multi-loan allocation helper functions
  const addLoanToAllocation = (loan) => {
    // Check if loan is already in the allocation
    if (multiLoanAllocations.some(a => a.loan.id === loan.id)) {
      return;
    }
    // Can only add loans from same borrower
    if (multiLoanBorrowerId && loan.borrower_id !== multiLoanBorrowerId) {
      return;
    }
    if (!multiLoanBorrowerId) {
      setMultiLoanBorrowerId(loan.borrower_id);
    }
    // If this is the first loan being added, default interest to full amount
    // (most common case for interest-only loans)
    const isFirstLoan = multiLoanAllocations.length === 0;
    const defaultInterest = isFirstLoan && selectedEntry ? Math.abs(selectedEntry.amount) : 0;
    setMultiLoanAllocations(prev => [
      ...prev,
      { loan, principal: 0, interest: defaultInterest, fees: 0 }
    ]);
  };

  const removeLoanFromAllocation = (index) => {
    setMultiLoanAllocations(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setMultiLoanBorrowerId(null);
      }
      return next;
    });
  };

  const updateLoanAllocation = (index, field, value) => {
    setMultiLoanAllocations(prev => prev.map((a, i) =>
      i === index ? { ...a, [field]: parseFloat(value) || 0 } : a
    ));
  };

  // Calculate total allocated across all loans
  const totalMultiLoanAllocated = useMemo(() => {
    return multiLoanAllocations.reduce((sum, a) =>
      sum + (a.principal || 0) + (a.interest || 0) + (a.fees || 0), 0
    );
  }, [multiLoanAllocations]);

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
    queryFn: () => api.entities.Transaction.listAll('-date')
  });

  // Fetch investor transactions for matching
  const { data: investorTransactions = [] } = useQuery({
    queryKey: ['investor-transactions'],
    queryFn: () => api.entities.InvestorTransaction.list('-date')
  });

  // Fetch investor interest entries for display
  const { data: investorInterestEntries = [] } = useQuery({
    queryKey: ['investor-interest'],
    queryFn: () => api.entities.InvestorInterest.list('-date')
  });

  // Fetch repayment schedules for expected payment info
  const { data: repaymentSchedules = [] } = useQuery({
    queryKey: ['repayment-schedules'],
    queryFn: () => api.entities.RepaymentSchedule.listAll('due_date')
  });

  // Fetch reconciliation entries
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['reconciliation-entries'],
    queryFn: () => api.entities.ReconciliationEntry.listAll()
  });

  // Get borrower name for loan
  const getBorrowerName = (borrowerId) => {
    const borrower = borrowers.find(b => b.id === borrowerId);
    return borrower?.business_name || borrower?.full_name || 'Unknown';
  };

  // Get the last repayment for a loan
  const getLastPayment = (loanId) => {
    const repayments = loanTransactions
      .filter(tx => tx.loan_id === loanId && tx.type === 'Repayment' && !tx.is_deleted)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return repayments[0] || null;
  };

  // Get the most recent unpaid schedule entry (could be overdue)
  const getNextDuePayment = (loanId) => {
    const unpaid = repaymentSchedules
      .filter(s => s.loan_id === loanId && !s.is_paid)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    return unpaid[0] || null;
  };

  // Build set of already-reconciled transaction IDs for quick lookup
  const reconciledTxIds = useMemo(() => {
    const ids = new Set();
    reconciliationEntries.forEach(re => {
      if (re.loan_transaction_id) ids.add(re.loan_transaction_id);
      if (re.investor_transaction_id) ids.add(re.investor_transaction_id);
      if (re.interest_id) ids.add(re.interest_id);
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
  // Uses transaction claiming to prevent multiple bank entries from matching to the same ledger transaction
  const suggestedMatches = useMemo(() => {
    const suggestions = new Map();

    // Track which transactions have been claimed by earlier entries
    const claimedTxIds = new Set();
    const claimedExpenseIds = new Set();
    const claimedInterestIds = new Set();

    // Sort entries by date (oldest first) for deterministic matching order
    const sortedEntries = [...bankStatements.filter(s => !s.is_reconciled)]
      .sort((a, b) => new Date(a.statement_date) - new Date(b.statement_date));

    sortedEntries.forEach(entry => {
      const entryKeywords = extractKeywords(entry.description);
      const entryAmount = normalizeAmount(entry.amount);
      const isCredit = entry.amount > 0;
      let bestMatch = null;
      let bestScore = 0;

      // 1. PRIORITY: Match against existing UNRECONCILED loan transactions by date/amount
      // Now includes name matching bonus to disambiguate same-date/amount transactions
      if (isCredit) {
        // Credits could be repayments
        for (const tx of loanTransactions) {
          if (tx.is_deleted || reconciledTxIds.has(tx.id)) continue;
          if (claimedTxIds.has(tx.id)) continue; // Skip transactions claimed by earlier entries
          if (tx.type !== 'Repayment') continue;

          let score = calculateMatchScore(entry, tx, 'date');

          // BOOST: If bank description contains borrower name, increase score
          const loan = loans.find(l => l.id === tx.loan_id);
          if (loan && score > 0) {
            const borrower = borrowers.find(b => b.id === loan.borrower_id);
            const nameMatch = descriptionContainsName(
              entry.description,
              borrower?.name || loan.borrower_name,
              borrower?.business_name
            );

            if (nameMatch > 0) {
              // Boost score by up to 15% for name match
              score = Math.min(0.99, score + (nameMatch * 0.15));
            }
          }

          if (score > bestScore) {
            bestScore = score;
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
        console.log(`[MATCH DEBUG] Bank entry: ${entry.statement_date} amount=${entry.amount} desc="${entry.description?.substring(0, 50)}"`);
        console.log(`[MATCH DEBUG] Checking ${loanTransactions.filter(tx => tx.type === 'Disbursement').length} disbursement transactions`);

        for (const tx of loanTransactions) {
          if (tx.is_deleted) {
            console.log(`[MATCH DEBUG] Skipping tx ${tx.id} - is_deleted`);
            continue;
          }
          if (reconciledTxIds.has(tx.id)) {
            console.log(`[MATCH DEBUG] Skipping tx ${tx.id} - already reconciled`);
            continue;
          }
          if (claimedTxIds.has(tx.id)) {
            console.log(`[MATCH DEBUG] Skipping tx ${tx.id} - claimed by earlier entry`);
            continue;
          }
          if (tx.type !== 'Disbursement') continue;

          const loan = loans.find(l => l.id === tx.loan_id);
          console.log(`[MATCH DEBUG] Checking disbursement: tx.id=${tx.id} loan=${loan?.loan_number} borrower=${loan?.borrower_name} date=${tx.date} amount=${tx.amount} loan.restructured=${loan?.restructured}`);

          let score = calculateMatchScore(entry, tx, 'date');
          console.log(`[MATCH DEBUG] calculateMatchScore returned: ${score}`);

          // BOOST: If bank description contains borrower name, increase score
          if (loan && score > 0) {
            const borrower = borrowers.find(b => b.id === loan.borrower_id);
            const nameMatch = descriptionContainsName(
              entry.description,
              borrower?.name || loan.borrower_name,
              borrower?.business_name
            );

            if (nameMatch > 0) {
              // Boost score by up to 15% for name match
              score = Math.min(0.99, score + (nameMatch * 0.15));
              console.log(`[MATCH DEBUG] Name boost applied, new score: ${score}`);
            }
          }

          if (score > bestScore) {
            console.log(`[MATCH DEBUG] New best match! score=${score} > bestScore=${bestScore}`);
            bestScore = score;
            const borrowerName = loan ? getBorrowerName(loan.borrower_id) : 'Unknown';
            bestMatch = {
              type: 'loan_disbursement',
              matchMode: 'match',
              existingTransaction: tx,
              loan_id: tx.loan_id,
              confidence: score,
              reason: `Disbursement match: ${borrowerName} - ${formatCurrency(tx.amount)} on ${tx.date ? format(parseISO(tx.date), 'dd/MM') : '?'}`
            };
          } else if (score > 0) {
            console.log(`[MATCH DEBUG] Score ${score} not better than bestScore ${bestScore}`);
          }
        }
        console.log(`[MATCH DEBUG] After disbursement check: bestScore=${bestScore}, bestMatch=${bestMatch?.type || 'none'}`);
      }

      // 1c. GROUPED DISBURSEMENT MATCH: Multiple bank debits → single disbursement transaction
      // This handles cases where a loan disbursement is paid out in multiple tranches
      if (!isCredit && bestScore < 0.9) {
        // Find all unreconciled debits within 3 days of this entry (including this entry)
        const nearbyDebits = sortedEntries.filter(other => {
          if (other.amount >= 0) return false; // Must be debit
          if (other.id !== entry.id && claimedTxIds.has(other.id)) return false;
          return datesWithinDays(entry.statement_date, other.statement_date, 3);
        });

        // For each Disbursement transaction, check if any subset of debits sums to it
        for (const tx of loanTransactions) {
          if (tx.type !== 'Disbursement') continue;
          if (tx.is_deleted || reconciledTxIds.has(tx.id) || claimedTxIds.has(tx.id)) continue;

          const disbursementAmount = Math.abs(tx.amount);

          // Skip if this single entry already matches (handled above)
          if (amountsMatch(entryAmount, disbursementAmount, 1)) continue;

          // Skip if this entry is larger than the disbursement
          if (entryAmount > disbursementAmount * 1.01) continue;

          // Find subset of debits that sum to disbursement (must include current entry)
          const matchingSubset = findSubsetSum(
            nearbyDebits,
            disbursementAmount,
            entry.id // Must include this entry
          );

          if (matchingSubset && matchingSubset.length >= 2) {
            const loan = loans.find(l => l.id === tx.loan_id);

            // CRITICAL: Check that bank entries are within reasonable date range of the disbursement transaction
            // A grouped match with 181+ days gap makes no sense
            const txDate = tx.date;
            const maxDaysFromTransaction = 14; // Bank entries must be within 14 days of the disbursement
            const allEntriesNearTransaction = matchingSubset.every(e =>
              datesWithinDays(e.statement_date, txDate, maxDaysFromTransaction)
            );

            // Skip if bank entries are too far from the transaction date
            if (!allEntriesNearTransaction) {
              continue; // Try next disbursement
            }

            // Validate that grouped entries are actually related
            // (similar descriptions OR borrower name appears in descriptions)
            const entriesAreRelated = groupHasRelatedDescriptions(matchingSubset);
            const borrowerName = loan?.borrower_name || '';
            const hasBorrowerName = borrowerName && matchingSubset.some(e =>
              descriptionContainsName(e.description, borrowerName, null) > 0.5
            );

            // Skip if entries don't appear to be related to each other or to this loan
            if (!entriesAreRelated && !hasBorrowerName) {
              continue; // Try next disbursement
            }

            const allSameDay = matchingSubset.every(e =>
              datesWithinDays(e.statement_date, entry.statement_date, 0)
            );

            // Also factor in proximity to the transaction date
            const allNearTransaction = matchingSubset.every(e =>
              datesWithinDays(e.statement_date, txDate, 3)
            );

            // Score based on both same-day grouping AND proximity to transaction
            let score;
            if (allSameDay && allNearTransaction) {
              score = 0.92; // Same day entries, within 3 days of transaction
            } else if (allSameDay) {
              score = 0.75; // Same day entries, but further from transaction (4-14 days)
            } else if (allNearTransaction) {
              score = 0.80; // Different day entries, but close to transaction
            } else {
              score = 0.60; // Different days, further from transaction
            }

            if (score > bestScore) {
              bestScore = score;
              const borrowerDisplayName = loan ? getBorrowerName(loan.borrower_id) : 'Unknown';
              bestMatch = {
                type: 'loan_disbursement',
                matchMode: 'grouped_disbursement',
                existingTransaction: tx,
                groupedEntries: matchingSubset,
                loan,
                confidence: score,
                reason: `Split disbursement: ${matchingSubset.length} payments → ${loan?.loan_number || 'Unknown'} (${borrowerDisplayName})`
              };
              break; // Stop at first match
            }
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
          if (claimedTxIds.has(tx.id)) continue; // Skip transactions claimed by earlier entries
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
        if (claimedTxIds.has(tx.id)) continue; // Skip transactions claimed by earlier entries

        // Check direction matches - only capital transactions
        const txIsCredit = tx.type === 'capital_in';
        const txIsDebit = tx.type === 'capital_out';

        if ((isCredit && txIsCredit) || (!isCredit && txIsDebit)) {
          let score = calculateMatchScore(entry, tx, 'date');

          // BOOST: If bank description contains investor name, increase score
          const investor = investors.find(i => i.id === tx.investor_id);
          if (investor && score > 0) {
            const nameMatch = descriptionContainsName(
              entry.description,
              investor.name,
              investor.business_name
            );

            if (nameMatch > 0) {
              // Boost score by up to 15% for name match
              score = Math.min(0.99, score + (nameMatch * 0.15));
            }
          }

          if (score > bestScore) {
            bestScore = score;
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

      // 2b. Match against existing UNRECONCILED investor interest entries (debits = withdrawals only)
      if (!isCredit) {
        for (const interest of investorInterestEntries) {
          if (reconciledTxIds.has(interest.id)) continue;
          if (claimedInterestIds.has(interest.id)) continue; // Skip interest claimed by earlier entries
          if (interest.type !== 'debit') continue; // Only match interest withdrawals for bank debits

          let score = calculateMatchScore(entry, interest, 'date');

          // BOOST: If bank description contains investor name, increase score
          const investor = investors.find(i => i.id === interest.investor_id);
          if (investor && score > 0) {
            const nameMatch = descriptionContainsName(
              entry.description,
              investor.name,
              investor.business_name
            );

            if (nameMatch > 0) {
              // Boost score by up to 15% for name match
              score = Math.min(0.99, score + (nameMatch * 0.15));
            }
          }

          if (score > bestScore) {
            bestScore = score;
            const investorName = investor?.business_name || investor?.name || 'Unknown';

            bestMatch = {
              type: 'interest_withdrawal',
              matchMode: 'match',
              existingInterest: interest,
              investor_id: interest.investor_id,
              confidence: score,
              reason: `Interest withdrawal: ${investorName} - ${formatCurrency(interest.amount)} on ${interest.date ? format(parseISO(interest.date), 'dd/MM') : '?'}`
            };
          }
        }
      }

      // 2c. Check for grouped investor transactions (multiple transactions from same investor summing to bank amount)
      // This handles cases where investor makes multiple payments on the same day
      if (bestScore < 0.9) {
        // Group investor capital transactions by investor_id that are within 3 days of entry
        const investorTxByInvestor = new Map();

        for (const tx of investorTransactions) {
          if (reconciledTxIds.has(tx.id)) continue;
          if (claimedTxIds.has(tx.id)) continue; // Skip transactions claimed by earlier entries

          // Check direction matches
          const txIsCredit = tx.type === 'capital_in';
          const txIsDebit = tx.type === 'capital_out';
          if (!((isCredit && txIsCredit) || (!isCredit && txIsDebit))) continue;

          // Check date proximity (within 3 days)
          const dateScore = dateProximityScore(entry.statement_date, tx.date);
          if (dateScore < 0.85) continue; // Within 3 days

          const investorId = tx.investor_id;
          if (!investorTxByInvestor.has(investorId)) {
            investorTxByInvestor.set(investorId, []);
          }
          investorTxByInvestor.get(investorId).push(tx);
        }

        // Check if any investor's grouped transactions sum to the entry amount
        for (const [investorId, txGroup] of investorTxByInvestor) {
          if (txGroup.length < 2) continue; // Need at least 2 to be a group

          const groupTotal = txGroup.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

          if (amountsMatch(entryAmount, groupTotal, 1)) {
            const investor = investors.find(i => i.id === investorId);
            const investorName = investor?.business_name || investor?.name || 'Unknown';
            const groupScore = 0.90; // High confidence for exact amount match

            if (groupScore > bestScore) {
              bestScore = groupScore;
              bestMatch = {
                type: isCredit ? 'investor_credit' : 'investor_withdrawal',
                matchMode: 'match_group',
                existingTransactions: txGroup,
                investor_id: investorId,
                confidence: groupScore,
                reason: `Grouped: ${investorName} - ${txGroup.length} transactions totalling ${formatCurrency(groupTotal)}`
              };
            }
          }
        }

        // Also check grouped investor interest entries (debits = withdrawals only)
        if (!isCredit) {
          const interestByInvestor = new Map();

          for (const interest of investorInterestEntries) {
            if (reconciledTxIds.has(interest.id)) continue;
            if (interest.type !== 'debit') continue; // Only match interest withdrawals for bank debits

            // Check date proximity (within 3 days)
            const dateScore = dateProximityScore(entry.statement_date, interest.date);
            if (dateScore < 0.85) continue;

            const investorId = interest.investor_id;
            if (!interestByInvestor.has(investorId)) {
              interestByInvestor.set(investorId, []);
            }
            interestByInvestor.get(investorId).push(interest);
          }

          // Check if any investor's grouped interest entries sum to the entry amount
          for (const [investorId, interestGroup] of interestByInvestor) {
            if (interestGroup.length < 2) continue;

            const groupTotal = interestGroup.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

            if (amountsMatch(entryAmount, groupTotal, 1)) {
              const investor = investors.find(i => i.id === investorId);
              const investorName = investor?.business_name || investor?.name || 'Unknown';
              const groupScore = 0.90;

              if (groupScore > bestScore) {
                bestScore = groupScore;
                bestMatch = {
                  type: 'interest_withdrawal',
                  matchMode: 'match_group',
                  existingInterestEntries: interestGroup,
                  investor_id: investorId,
                  confidence: groupScore,
                  reason: `Grouped interest: ${investorName} - ${interestGroup.length} entries totalling ${formatCurrency(groupTotal)}`
                };
              }
            }
          }
        }
      }

      // 2d. Cross-table grouped matching: combine capital transactions AND interest entries for same investor
      // This handles cases like £516 = Capital Out £462.96 + Interest £53.04
      if (!isCredit && bestScore < 0.9) {
        const combinedByInvestor = new Map();

        // Add capital_out transactions
        for (const tx of investorTransactions) {
          if (reconciledTxIds.has(tx.id)) continue;
          if (tx.type !== 'capital_out') continue;

          const dateScore = dateProximityScore(entry.statement_date, tx.date);
          if (dateScore < 0.85) continue; // Within 3 days

          const investorId = tx.investor_id;
          if (!combinedByInvestor.has(investorId)) {
            combinedByInvestor.set(investorId, { capitalTxs: [], interestEntries: [] });
          }
          combinedByInvestor.get(investorId).capitalTxs.push(tx);
        }

        // Add interest entries to same investor groups (only debit = withdrawals)
        for (const interest of investorInterestEntries) {
          if (reconciledTxIds.has(interest.id)) continue;
          if (interest.type !== 'debit') continue; // Only match interest withdrawals for bank debits

          const dateScore = dateProximityScore(entry.statement_date, interest.date);
          if (dateScore < 0.85) continue; // Within 3 days

          const investorId = interest.investor_id;
          if (!combinedByInvestor.has(investorId)) {
            combinedByInvestor.set(investorId, { capitalTxs: [], interestEntries: [] });
          }
          combinedByInvestor.get(investorId).interestEntries.push(interest);
        }

        // Check if any investor's COMBINED transactions sum to entry amount
        for (const [investorId, { capitalTxs, interestEntries }] of combinedByInvestor) {
          // Must have at least one from EACH table (single-table matches handled in 2c)
          if (capitalTxs.length === 0 || interestEntries.length === 0) continue;

          const capitalTotal = capitalTxs.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
          const interestTotal = interestEntries.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
          const combinedTotal = capitalTotal + interestTotal;

          if (amountsMatch(entryAmount, combinedTotal, 1)) {
            const investor = investors.find(i => i.id === investorId);
            const investorName = investor?.business_name || investor?.name || 'Unknown';
            const groupScore = 0.92; // High confidence for cross-table exact match

            if (groupScore > bestScore) {
              bestScore = groupScore;
              bestMatch = {
                type: 'investor_withdrawal',
                matchMode: 'match_group',
                existingTransactions: capitalTxs,
                existingInterestEntries: interestEntries,
                investor_id: investorId,
                confidence: groupScore,
                reason: `Combined: ${investorName} - ${capitalTxs.length} capital + ${interestEntries.length} interest = ${formatCurrency(combinedTotal)}`
              };
            }
          }
        }
      }

      // 2e. GROUPED INVESTOR MATCH: Multiple bank entries → single investor transaction
      // This handles cases where an investor deposit is received in multiple tranches
      if (bestScore < 0.9) {
        // Find all unreconciled bank entries within 3 days of this entry (same direction)
        const nearbyEntries = sortedEntries.filter(other => {
          // Must be same direction (both credits or both debits)
          if ((other.amount > 0) !== isCredit) return false;
          if (other.id !== entry.id && claimedTxIds.has(other.id)) return false;
          return datesWithinDays(entry.statement_date, other.statement_date, 3);
        });

        // For each unreconciled investor transaction, check if subset of bank entries sums to it
        for (const invTx of investorTransactions) {
          // Check direction matches: credits → capital_in, debits → capital_out
          const txIsCredit = invTx.type === 'capital_in';
          if (txIsCredit !== isCredit) continue;

          if (reconciledTxIds.has(invTx.id) || claimedTxIds.has(invTx.id)) continue;

          const txAmount = Math.abs(invTx.amount);

          // Skip if single entry already matches (handled earlier)
          if (amountsMatch(entryAmount, txAmount, 1)) continue;

          // Skip if this entry is larger than the transaction
          if (entryAmount > txAmount * 1.01) continue;

          // Find subset of bank entries that sum to transaction (must include current entry)
          const matchingSubset = findSubsetSum(nearbyEntries, txAmount, entry.id);

          if (matchingSubset && matchingSubset.length >= 2) {
            const investor = investors.find(i => i.id === invTx.investor_id);

            // Validate: bank entries must be within 14 days of the investor transaction
            const maxDaysFromTransaction = 14;
            const allEntriesNearTransaction = matchingSubset.every(e =>
              datesWithinDays(e.statement_date, invTx.date, maxDaysFromTransaction)
            );
            if (!allEntriesNearTransaction) continue;

            // Validate: entries should be related (similar descriptions or investor name appears)
            const entriesAreRelated = groupHasRelatedDescriptions(matchingSubset);
            const investorName = investor?.business_name || investor?.name || '';
            const hasInvestorName = investorName && matchingSubset.some(e =>
              descriptionContainsName(e.description, investorName, null) > 0.5
            );
            if (!entriesAreRelated && !hasInvestorName) continue;

            const allSameDay = matchingSubset.every(e =>
              datesWithinDays(e.statement_date, entry.statement_date, 0)
            );
            const allNearTransaction = matchingSubset.every(e =>
              datesWithinDays(e.statement_date, invTx.date, 3)
            );

            let score;
            if (allSameDay && allNearTransaction) {
              score = 0.92;
            } else if (allSameDay) {
              score = 0.75;
            } else if (allNearTransaction) {
              score = 0.80;
            } else {
              score = 0.60;
            }

            if (score > bestScore) {
              bestScore = score;
              const investorDisplayName = investor?.business_name || investor?.name || 'Unknown';
              bestMatch = {
                type: isCredit ? 'investor_credit' : 'investor_withdrawal',
                matchMode: 'grouped_investor',
                existingTransaction: invTx,
                groupedEntries: matchingSubset,
                investor,
                confidence: score,
                reason: `Split deposit: ${matchingSubset.length} payments → ${investorDisplayName} (${formatCurrency(txAmount)})`
              };
              break; // Stop at first match
            }
          }
        }
      }

      // 3. Match against existing UNRECONCILED expenses by date/amount (debits only)
      if (!isCredit) {
        for (const exp of expenses) {
          if (reconciledTxIds.has(exp.id)) continue;
          if (claimedExpenseIds.has(exp.id)) continue; // Skip expenses claimed by earlier entries

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
      // Use enhanced vendor keyword extraction for better matching
      if (bestScore < 0.7) {
        const entryVendorKeywords = extractVendorKeywords(entry.description);

        for (const pattern of patterns) {
          const patternKeywords = extractVendorKeywords(pattern.description_pattern);
          if (patternKeywords.length === 0) continue;

          // Calculate fuzzy match score
          let matchCount = 0;
          for (const entryKw of entryVendorKeywords) {
            for (const patternKw of patternKeywords) {
              if (entryKw === patternKw) {
                matchCount += 1;
              } else if (entryKw.includes(patternKw) || patternKw.includes(entryKw)) {
                matchCount += 0.7;
              } else if (levenshteinSimilarity(entryKw, patternKw) >= 0.75) {
                matchCount += 0.5;
              }
            }
          }

          const keywordScore = matchCount / Math.max(patternKeywords.length, 1);
          const amountInRange = (!pattern.amount_min || entryAmount >= pattern.amount_min) &&
                               (!pattern.amount_max || entryAmount <= pattern.amount_max);

          const typeMatch = !pattern.transaction_type ||
                           (isCredit ? pattern.transaction_type === 'CRDT' : pattern.transaction_type === 'DBIT');

          if (keywordScore >= 0.5 && amountInRange && typeMatch) {
            // Include usage count boost in confidence calculation
            const usageBoost = Math.min((pattern.match_count || 1) / 20, 0.15);
            const score = (pattern.confidence_score || 0.5) * 0.6 + keywordScore * 0.25 + usageBoost;
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
                reason: `Pattern: "${pattern.description_pattern}" (used ${pattern.match_count || 1}x)`,
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
              const matchType = isCredit ? 'investor_credit' : 'investor_withdrawal';
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

        // Claim matched transactions to prevent other entries from matching them
        if (bestMatch.existingTransaction) {
          claimedTxIds.add(bestMatch.existingTransaction.id);
        }
        if (bestMatch.existingExpense) {
          claimedExpenseIds.add(bestMatch.existingExpense.id);
        }
        if (bestMatch.existingInterest) {
          claimedInterestIds.add(bestMatch.existingInterest.id);
        }
        // Handle grouped transactions
        if (bestMatch.existingTransactions) {
          bestMatch.existingTransactions.forEach(tx => claimedTxIds.add(tx.id));
        }
      }
    });

    return suggestions;
  }, [bankStatements, patterns, loans, investors, borrowers, loanTransactions, investorTransactions, investorInterestEntries, expenses, expenseTypes, reconciledTxIds]);

  // Detect conflicts: bank entries that suggest matching the same target transaction/expense
  const matchConflicts = useMemo(() => {
    const targetToEntries = new Map(); // targetId -> Set of entry IDs

    bankStatements.filter(s => !s.is_reconciled).forEach(entry => {
      const suggestion = suggestedMatches.get(entry.id);
      if (!suggestion || suggestion.matchMode === 'create') return;

      // Collect all target IDs this entry wants to match
      const targetIds = [];
      if (suggestion.existingTransaction) {
        targetIds.push(`tx:${suggestion.existingTransaction.id}`);
      }
      if (suggestion.existingExpense) {
        targetIds.push(`exp:${suggestion.existingExpense.id}`);
      }
      if (suggestion.existingTransactions) {
        suggestion.existingTransactions.forEach(tx => targetIds.push(`tx:${tx.id}`));
      }

      // Map each target to this entry
      targetIds.forEach(targetId => {
        if (!targetToEntries.has(targetId)) {
          targetToEntries.set(targetId, new Set());
        }
        targetToEntries.get(targetId).add(entry.id);
      });
    });

    // Build entry -> conflicting entries map
    const entryConflicts = new Map(); // entryId -> Set of conflicting entry IDs

    for (const [_targetId, entryIds] of targetToEntries) {
      if (entryIds.size > 1) {
        // These entries conflict with each other
        const idsArray = [...entryIds];
        idsArray.forEach(id => {
          if (!entryConflicts.has(id)) {
            entryConflicts.set(id, new Set());
          }
          idsArray.forEach(otherId => {
            if (otherId !== id) {
              entryConflicts.get(id).add(otherId);
            }
          });
        });
      }
    }

    return entryConflicts;
  }, [bankStatements, suggestedMatches]);

  // Track entries that are part of grouped payment suggestions (as secondary entries)
  // This is used to show a warning when someone tries to create a new transaction for an entry
  // that's already part of a grouped match suggestion
  const entriesInGroupedSuggestions = useMemo(() => {
    const grouped = new Map(); // Map<entryId, { primaryEntryId, suggestion }>

    for (const [primaryEntryId, suggestion] of suggestedMatches) {
      // Check grouped_disbursement (multiple bank debits → single disbursement)
      if (suggestion.matchMode === 'grouped_disbursement' && suggestion.groupedEntries) {
        for (const groupedEntry of suggestion.groupedEntries) {
          // Mark all entries in the group (including the primary)
          grouped.set(groupedEntry.id, {
            primaryEntryId,
            suggestion,
            groupType: 'disbursement'
          });
        }
      }
      // Check grouped_investor (multiple bank entries → single investor transaction)
      if (suggestion.matchMode === 'grouped_investor' && suggestion.groupedEntries) {
        for (const groupedEntry of suggestion.groupedEntries) {
          // Mark all entries in the group (including the primary)
          grouped.set(groupedEntry.id, {
            primaryEntryId,
            suggestion,
            groupType: 'investor'
          });
        }
      }
      // Check grouped_payment (single bank credit → multiple repayments)
      if (suggestion.matchMode === 'grouped' && suggestion.existingTransactions) {
        // This is for grouped repayments - mark the primary entry
        grouped.set(primaryEntryId, {
          primaryEntryId,
          suggestion,
          groupType: 'payment'
        });
      }
    }

    return grouped;
  }, [suggestedMatches]);

  // Compute expense type suggestions for unreconciled debits (for dropdown pre-selection)
  const expenseTypeSuggestions = useMemo(() => {
    const suggestions = new Map(); // Map<entryId, { expenseTypeId, expenseTypeName, confidence, reason }>

    bankStatements.filter(s => !s.is_reconciled && s.amount < 0).forEach(entry => {
      // Skip if already has a high-confidence suggestion from suggestedMatches
      const existingSuggestion = suggestedMatches.get(entry.id);
      if (existingSuggestion && existingSuggestion.confidence >= 0.7 && existingSuggestion.expense_type_id) {
        return; // Let the main suggestion system handle this
      }

      const entryKeywords = extractVendorKeywords(entry.description);
      if (entryKeywords.length === 0) return;

      let bestMatch = null;
      let bestScore = 0;

      // Check patterns that have expense_type_id set
      for (const pattern of patterns) {
        if (!pattern.expense_type_id) continue;
        if (pattern.transaction_type && pattern.transaction_type !== 'DBIT') continue;

        const patternKeywords = extractVendorKeywords(pattern.description_pattern);
        if (patternKeywords.length === 0) continue;

        // Calculate match score using fuzzy matching
        let matchCount = 0;
        for (const entryKw of entryKeywords) {
          for (const patternKw of patternKeywords) {
            // Check exact match, partial match, or fuzzy match
            if (entryKw === patternKw) {
              matchCount += 1;
            } else if (entryKw.includes(patternKw) || patternKw.includes(entryKw)) {
              matchCount += 0.8;
            } else if (levenshteinSimilarity(entryKw, patternKw) >= 0.75) {
              matchCount += 0.6;
            }
          }
        }

        if (matchCount === 0) continue;

        // Score based on: keyword match ratio, pattern confidence, usage count
        const keywordScore = matchCount / Math.max(entryKeywords.length, patternKeywords.length);
        const usageBoost = Math.min((pattern.match_count || 1) / 10, 0.2); // Up to 0.2 boost for frequently used
        const score = (keywordScore * 0.6) + ((pattern.confidence_score || 0.5) * 0.2) + usageBoost;

        if (score > bestScore && score >= 0.3) {
          bestScore = score;
          const expenseType = expenseTypes.find(t => t.id === pattern.expense_type_id);
          if (expenseType) {
            bestMatch = {
              expenseTypeId: pattern.expense_type_id,
              expenseTypeName: expenseType.name,
              confidence: Math.min(score, 0.99), // Cap at 99%
              reason: `Pattern: "${pattern.description_pattern}" (used ${pattern.match_count || 1}x)`,
              patternId: pattern.id
            };
          }
        }
      }

      if (bestMatch) {
        suggestions.set(entry.id, bestMatch);
      }
    });

    return suggestions;
  }, [bankStatements, patterns, expenseTypes, suggestedMatches]);

  // Set expense type with propagation to similar entries
  const setEntryExpenseType = (entryId, expenseTypeId) => {
    // First, set the expense type for the source entry
    setEntryExpenseTypeSimple(entryId, expenseTypeId);

    if (!expenseTypeId) return; // Only propagate when setting, not clearing

    // Find the source entry to get its description
    const sourceEntry = bankStatements.find(s => s.id === entryId);
    if (!sourceEntry || !sourceEntry.description) return;

    // Extract keywords from source entry description
    const sourceKeywords = extractVendorKeywords(sourceEntry.description);
    if (sourceKeywords.length === 0) return;

    // Find similar unclassified debit entries
    const similarEntries = bankStatements.filter(entry => {
      // Skip the source entry itself
      if (entry.id === entryId) return false;
      // Only consider unreconciled debit entries (negative amounts)
      if (entry.is_reconciled || entry.amount >= 0) return false;
      // Skip entries that already have an expense type set
      if (entryExpenseTypes.has(entry.id)) return false;
      // Skip entries with high-confidence match suggestions (they're for matching, not creating)
      const suggestion = suggestedMatches.get(entry.id);
      if (suggestion && suggestion.confidence >= 0.7 && isMatchType(suggestion.matchMode)) return false;

      // Extract keywords from this entry's description
      const entryKeywords = extractVendorKeywords(entry.description);
      if (entryKeywords.length === 0) return false;

      // Calculate fuzzy match score
      let matchCount = 0;
      for (const sourceKw of sourceKeywords) {
        for (const entryKw of entryKeywords) {
          if (sourceKw === entryKw) {
            matchCount += 1;
          } else if (sourceKw.includes(entryKw) || entryKw.includes(sourceKw)) {
            matchCount += 0.7;
          } else if (levenshteinSimilarity(sourceKw, entryKw) >= 0.75) {
            matchCount += 0.5;
          }
        }
      }

      // Require at least 50% keyword match
      const keywordScore = matchCount / Math.max(sourceKeywords.length, entryKeywords.length);
      return keywordScore >= 0.5;
    });

    // Propagate the expense type to similar entries
    if (similarEntries.length > 0) {
      setEntryExpenseTypes(prev => {
        const next = new Map(prev);
        similarEntries.forEach(entry => {
          next.set(entry.id, expenseTypeId);
        });
        return next;
      });

      // Auto-select those entries for bulk processing
      setSelectedEntries(prev => {
        const next = new Set(prev);
        similarEntries.forEach(entry => {
          next.add(entry.id);
        });
        return next;
      });
    }
  };

  // Auto-apply high-confidence expense type suggestions to dropdown
  useEffect(() => {
    expenseTypeSuggestions.forEach((suggestion, entryId) => {
      // Only auto-apply if confidence is high (70%+) and not already set by user
      if (suggestion.confidence >= 0.7 && !entryExpenseTypes.has(entryId)) {
        // Verify entry still exists and is unreconciled debit
        const entry = bankStatements.find(s => s.id === entryId);
        if (entry && !entry.is_reconciled && entry.amount < 0) {
          setEntryExpenseType(entryId, suggestion.expenseTypeId);
        }
      }
    });
  }, [expenseTypeSuggestions]); // Only run when suggestions change

  // Filter and search bank statements
  const filteredStatements = useMemo(() => {
    let filtered = bankStatements;

    // First, filter by active tab (Match vs Create)
    if (activeTab === 'match') {
      // Match tab: show entries with EXISTING transactions to match (matchMode='match', 'match_group', or 'grouped_disbursement')
      if (filter === 'reconciled') {
        filtered = filtered.filter(s => s.is_reconciled);
      } else {
        filtered = filtered.filter(s => {
          if (s.is_reconciled) return false;
          if (dismissedSuggestions.has(s.id)) return false;
          const suggestion = suggestedMatches.get(s.id);
          // Must have a match-type suggestion (links to existing transaction)
          return suggestion && isMatchType(suggestion.matchMode);
        });
      }
    } else {
      // Create New tab: entries that need new transactions created
      if (filter === 'reconciled') {
        filtered = [];
      } else {
        filtered = filtered.filter(s => {
          if (s.is_reconciled) return false;
          if (dismissedSuggestions.has(s.id)) return true; // Dismissed entries show here
          const suggestion = suggestedMatches.get(s.id);
          // No suggestion OR create-type suggestion
          return !suggestion || suggestion.matchMode === 'create';
        });
      }
    }

    // Apply confidence filter (only on Match tab - Create tab shows all entries that need new transactions)
    if (activeTab === 'match' && confidenceFilter !== 'all') {
      filtered = filtered.filter(s => {
        const suggestion = suggestedMatches.get(s.id);
        if (confidenceFilter === 'none') {
          // No suggestion OR suggestion is not a match (create mode without good match)
          return !suggestion || !isMatchType(suggestion.matchMode);
        }
        // For confidence filters, only consider actual match suggestions (not create mode)
        if (!suggestion) return false;
        if (!isMatchType(suggestion.matchMode)) return false;
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
      filtered = filtered.filter(s => {
        // Search in basic fields
        if (s.description?.toLowerCase().includes(term)) return true;
        if (String(s.amount).includes(term)) return true;
        if (s.external_reference?.toLowerCase().includes(term)) return true;

        // Search in date
        if (s.statement_date) {
          const dateStr = format(parseISO(s.statement_date), 'dd MMM yyyy').toLowerCase();
          if (dateStr.includes(term)) return true;
        }

        // For reconciled entries, also search in linked entity names
        if (s.is_reconciled) {
          const reconDetails = reconciliationEntries.filter(re => re.bank_statement_id === s.id);
          for (const re of reconDetails) {
            // Search in linked loan/borrower
            if (re.loan_transaction_id) {
              const tx = loanTransactions.find(t => t.id === re.loan_transaction_id);
              if (tx) {
                const loan = loans.find(l => l.id === tx.loan_id);
                if (loan) {
                  const borrowerName = getBorrowerName(loan.borrower_id);
                  if (borrowerName.toLowerCase().includes(term)) return true;
                  if (loan.loan_number?.toLowerCase().includes(term)) return true;
                }
              }
            }
            // Search in linked investor
            if (re.investor_transaction_id) {
              const invTx = investorTransactions.find(t => t.id === re.investor_transaction_id);
              if (invTx) {
                const investor = investors.find(i => i.id === invTx.investor_id);
                if (investor) {
                  const investorName = investor.business_name || investor.name || '';
                  if (investorName.toLowerCase().includes(term)) return true;
                }
              }
            }
            // Search in expense type
            if (re.expense_id) {
              const expense = expenses.find(e => e.id === re.expense_id);
              if (expense?.type_name?.toLowerCase().includes(term)) return true;
            }
          }
        }

        return false;
      });
    }

    // Helper to get "links to" sort key for an entry
    const getLinksToKey = (entry) => {
      if (entry.is_reconciled) {
        const recons = reconciliationEntries.filter(r => r.bank_statement_id === entry.id);
        if (recons.length === 0) return 'z'; // No links - sort last

        // Get the first link type
        const recon = recons[0];
        if (recon.loan_transaction_id) {
          const tx = loanTransactions.find(t => t.id === recon.loan_transaction_id);
          const loan = tx ? loans.find(l => l.id === tx.loan_id) : null;
          return `a_loan_${loan?.borrower_name || ''}`;
        }
        if (recon.investor_transaction_id) {
          const tx = investorTransactions.find(t => t.id === recon.investor_transaction_id);
          const investor = tx ? investors.find(i => i.id === tx.investor_id) : null;
          return `b_investor_${investor?.business_name || investor?.name || ''}`;
        }
        if (recon.interest_id) {
          const interest = investorInterestEntries.find(i => i.id === recon.interest_id);
          const investor = interest ? investors.find(i => i.id === interest.investor_id) : null;
          return `c_interest_${investor?.business_name || investor?.name || ''}`;
        }
        if (recon.expense_id) {
          const exp = expenses.find(e => e.id === recon.expense_id);
          const expType = exp ? expenseTypes.find(t => t.id === exp.type_id) : null;
          return `d_expense_${expType?.name || ''}`;
        }
        return 'z';
      }

      // For unreconciled entries, use suggestion
      const suggestion = suggestedMatches.get(entry.id);
      if (!suggestion) return 'z';

      if (isMatchType(suggestion.matchMode)) {
        // Existing transaction match
        if (suggestion.existingLoan?.borrower_name) {
          return `a_loan_${suggestion.existingLoan.borrower_name}`;
        }
        if (suggestion.loan?.borrower_name) {
          // For grouped_disbursement matches
          return `a_loan_${suggestion.loan.borrower_name}`;
        }
        if (suggestion.existingInvestor?.business_name || suggestion.existingInvestor?.name) {
          return `b_investor_${suggestion.existingInvestor.business_name || suggestion.existingInvestor.name}`;
        }
        if (suggestion.existingInterest) {
          const investor = investors.find(i => i.id === suggestion.existingInterest.investor_id);
          return `c_interest_${investor?.business_name || investor?.name || ''}`;
        }
        if (suggestion.existingExpense) {
          const expType = expenseTypes.find(t => t.id === suggestion.existingExpense.type_id);
          return `d_expense_${expType?.name || ''}`;
        }
        if (suggestion.investor_id) {
          const investor = investors.find(i => i.id === suggestion.investor_id);
          return `b_investor_${investor?.business_name || investor?.name || ''}`;
        }
        return `e_${suggestion.type || ''}`;
      } else {
        // Create new - prefix with 'y' to sort after matches
        return `y_create_${suggestion.type || ''}`;
      }
    };

    // Sort based on sortBy state
    filtered = [...filtered].sort((a, b) => {
      let result = 0;

      if (sortBy === 'linksTo') {
        const keyA = getLinksToKey(a).toLowerCase();
        const keyB = getLinksToKey(b).toLowerCase();
        result = keyA.localeCompare(keyB);
      } else if (sortBy === 'amount') {
        result = Math.abs(b.amount) - Math.abs(a.amount);
      } else {
        // Default: sort by confidence on match tab, by date on create tab
        if (activeTab === 'match') {
          const confA = suggestedMatches.get(a.id)?.confidence || 0;
          const confB = suggestedMatches.get(b.id)?.confidence || 0;
          result = confB - confA;
        } else {
          result = new Date(b.statement_date).getTime() - new Date(a.statement_date).getTime();
        }
      }

      // Apply sort direction
      return sortDirection === 'asc' ? result : -result;
    });

    return filtered;
  }, [bankStatements, activeTab, filter, searchTerm, suggestedMatches, confidenceFilter, dismissedSuggestions, reconciliationEntries, loanTransactions, loans, borrowers, investorTransactions, investors, expenses, sortBy, sortDirection, investorInterestEntries, expenseTypes]);

  // Prepare display list with grouped entries
  // - Removes individual entries that are part of a group
  // - Adds virtual "group" entries that represent collapsed groups
  const displayStatements = useMemo(() => {
    // On Create New tab, handle groups
    if (activeTab !== 'create') {
      return filteredStatements;
    }

    // Get IDs of entries that are in groups
    const groupedEntryIds = new Set();
    entryGroups.forEach(entryIds => {
      entryIds.forEach(id => groupedEntryIds.add(id));
    });

    // Filter out individual entries that are in groups
    const ungroupedEntries = filteredStatements.filter(s => !groupedEntryIds.has(s.id));

    // Create virtual entries for each group
    const groupEntries = [...entryGroups.entries()].map(([groupId, entryIds]) => {
      const entries = [...entryIds]
        .map(id => bankStatements.find(s => s.id === id))
        .filter(Boolean);

      if (entries.length === 0) return null;

      // Calculate net amount
      const netAmount = entries.reduce((sum, e) => sum + e.amount, 0);
      // Use earliest date from the group
      const dates = entries.map(e => e.statement_date).filter(Boolean).sort();
      const earliestDate = dates[0] || null;

      return {
        id: groupId,
        isGroup: true,
        groupEntryIds: [...entryIds],
        groupEntries: entries,
        amount: netAmount,
        statement_date: earliestDate,
        description: `${entries.length} grouped entries`,
        bank_source: entries[0]?.bank_source || 'Mixed'
      };
    }).filter(Boolean);

    // Combine and sort (groups at top)
    return [...groupEntries, ...ungroupedEntries];
  }, [filteredStatements, entryGroups, bankStatements, activeTab]);

  // Get financial year for a date (UK financial year: Apr 1 - Mar 31)
  // Returns the starting year of the financial year (e.g., 2025 for FY 2025/26)
  const getFinancialYear = (date) => {
    const d = new Date(date);
    const month = d.getMonth(); // 0-indexed (0 = Jan, 3 = Apr)
    const year = d.getFullYear();
    // If Jan-Mar, it's the previous calendar year's FY
    // If Apr-Dec, it's the current calendar year's FY
    return month < 3 ? year - 1 : year;
  };

  // Format financial year for display (e.g., "2025/26")
  const formatFinancialYear = (startYear) => {
    return `${startYear}/${(startYear + 1).toString().slice(-2)}`;
  };

  // Group reconciled statements by financial year for collapsed view
  // Also detect bank entries that were reconciled together (net receipt matches)
  const reconciledByFinancialYear = useMemo(() => {
    if (filter !== 'reconciled') return null;

    const reconciled = filteredStatements.filter(s => s.is_reconciled);

    // First, detect bank entries that share the same target transaction (were grouped together)
    // Build a map of targetKey -> [bank statement ids]
    const targetToStatements = new Map();
    reconciled.forEach(statement => {
      const recons = reconciliationEntries.filter(r => r.bank_statement_id === statement.id);
      recons.forEach(recon => {
        // Create a unique key for the target
        let targetKey = null;
        if (recon.loan_transaction_id) targetKey = `loan:${recon.loan_transaction_id}`;
        else if (recon.investor_transaction_id) targetKey = `inv:${recon.investor_transaction_id}`;
        else if (recon.expense_id) targetKey = `exp:${recon.expense_id}`;
        else if (recon.interest_id) targetKey = `int:${recon.interest_id}`;

        if (targetKey) {
          if (!targetToStatements.has(targetKey)) {
            targetToStatements.set(targetKey, new Set());
          }
          targetToStatements.get(targetKey).add(statement.id);
        }
      });
    });

    // Find groups where multiple bank statements link to same target (net receipt matches)
    const netReceiptGroups = new Map(); // groupKey -> Set of statement ids
    const statementToNetGroup = new Map(); // statementId -> groupKey
    targetToStatements.forEach((statementIds, targetKey) => {
      if (statementIds.size > 1) {
        // Multiple bank entries linked to same target - this is a net receipt group
        const groupKey = `netgroup:${[...statementIds].sort().join(',')}`;
        netReceiptGroups.set(groupKey, statementIds);
        statementIds.forEach(id => statementToNetGroup.set(id, groupKey));
      }
    });

    // Create virtual grouped entries for net receipt groups
    const processedStatementIds = new Set();
    const virtualStatements = [];

    netReceiptGroups.forEach((statementIds, groupKey) => {
      const statements = [...statementIds].map(id => reconciled.find(s => s.id === id)).filter(Boolean);
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
      ...reconciled.filter(s => !processedStatementIds.has(s.id))
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
  }, [filteredStatements, filter, reconciliationEntries]);

  // Toggle expand/collapse for reconciled groups
  const toggleGroupExpanded = (groupDate) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupDate)) {
        next.delete(groupDate);
      } else {
        next.add(groupDate);
      }
      return next;
    });
  };

  const expandAllGroups = () => {
    if (reconciledByFinancialYear) {
      setExpandedGroups(new Set(reconciledByFinancialYear.map(g => g.year)));
    }
  };

  const collapseAllGroups = () => {
    setExpandedGroups(new Set());
  };

  // Toggle expand/collapse for net receipt groups in reconciled view
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

  // Calculate counts for each confidence level (for Match tab dropdown)
  const confidenceCounts = useMemo(() => {
    // Get matchable entries (unreconciled with match-type suggestions)
    const matchable = bankStatements.filter(s => {
      if (s.is_reconciled) return false;
      if (dismissedSuggestions.has(s.id)) return false;
      const suggestion = suggestedMatches.get(s.id);
      return suggestion && isMatchType(suggestion.matchMode);
    });

    const counts = { all: matchable.length, '100': 0, '90': 0, '70': 0, '50': 0, low: 0 };

    matchable.forEach(s => {
      const suggestion = suggestedMatches.get(s.id);
      if (!suggestion) return;
      const confidence = Math.round(suggestion.confidence * 100);

      if (confidence >= 90) counts['100']++;
      else if (confidence >= 80) counts['90']++;
      else if (confidence >= 65) counts['70']++;
      else if (confidence >= 50) counts['50']++;
      else if (confidence > 0) counts['low']++;
    });

    return counts;
  }, [bankStatements, suggestedMatches, dismissedSuggestions]);

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

    // For match_group suggestions, use the pre-identified transactions
    if (reviewingSuggestion?.matchMode === 'match_group' && reviewingSuggestion.existingTransactions) {
      return reviewingSuggestion.existingTransactions;
    }

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
          // Exclude transactions already part of the current suggestion
          if (reviewingSuggestion?.existingTransaction?.id === tx.id) return false;
          if (reviewingSuggestion?.existingTransactions?.some(t => t.id === tx.id)) return false;
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
  }, [selectedEntry, reconciliationType, loanTransactions, investorTransactions, reconciliationEntries, reviewingSuggestion]);

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

      // Check for duplicates using hybrid lookup:
      // 1. Match by external_reference (primary)
      // 2. Match by date + amount + description (fallback for old format references)
      const existingRefs = new Set(bankStatements.map(s => s.external_reference).filter(Boolean));

      // Build composite keys for fallback matching (date|amount)
      const existingCompositeKeys = new Set(
        bankStatements.map(s => {
          const date = s.statement_date || '';
          const amount = Math.round((parseFloat(s.amount) || 0) * 100);
          return `${date}|${amount}`;
        })
      );

      // Build map for detailed matching (date+amount -> array of descriptions)
      const existingByDateAmount = new Map();
      bankStatements.forEach(s => {
        const date = s.statement_date || '';
        const amount = Math.round((parseFloat(s.amount) || 0) * 100);
        const key = `${date}|${amount}`;
        if (!existingByDateAmount.has(key)) {
          existingByDateAmount.set(key, []);
        }
        existingByDateAmount.get(key).push((s.description || '').toLowerCase().trim());
      });

      const newEntries = entries.filter(e => {
        // Check by external_reference first
        if (existingRefs.has(e.external_reference)) {
          return false;
        }

        // Fallback: check by date + amount + description
        // This catches duplicates when reference format changed
        const date = e.statement_date;
        const amount = Math.round((parseFloat(e.amount) || 0) * 100);
        const compositeKey = `${date}|${amount}`;
        const newDesc = (e.description || '').toLowerCase().trim();

        if (existingCompositeKeys.has(compositeKey)) {
          const existingDescs = existingByDateAmount.get(compositeKey) || [];
          const descMatch = existingDescs.some(existingDesc => {
            if (existingDesc === newDesc) return true;
            if (existingDesc.includes(newDesc) || newDesc.includes(existingDesc)) return true;
            if (existingDesc.slice(0, 20) === newDesc.slice(0, 20) && existingDesc.length > 10) return true;
            return false;
          });
          if (descMatch) {
            return false;
          }
        }

        return true;
      });
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
    setSelectedExpenseLoan(null);
    setSelectedExistingTxs([]); // Clear multi-select
    setEntitySearch('');
    setExpenseDescription(entry.description || '');
    setSavePattern(true);
    // Reset multi-loan allocation state
    setMultiLoanAllocations([]);
    setMultiLoanBorrowerId(null);

    const amount = Math.abs(entry.amount);

    // Special handling for user-created grouped entries
    if (entry.isGroup) {
      // Default to match mode for groups - they need to select an existing transaction
      setMatchMode('match');
      // Determine type based on net amount direction
      if (entry.amount > 0) {
        // Net positive = likely repayment
        setReconciliationType('loan_repayment');
        setSplitAmounts({ capital: 0, interest: amount, fees: 0 });
      } else {
        // Net negative = likely disbursement
        setReconciliationType('loan_disbursement');
        setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
      }
      setInvestorWithdrawalSplit({ capital: amount, interest: 0 });
      return; // Don't run suggestion-based initialization
    }

    // If there's a suggestion, pre-populate the form
    if (suggestion) {
      setReconciliationType(suggestion.type);

      // Set match mode based on suggestion
      if (suggestion.matchMode === 'match' && (suggestion.existingTransaction || suggestion.existingExpense || suggestion.existingInterest)) {
        setMatchMode('match');
        // Pre-select the existing transaction (as array)
        if (suggestion.existingTransaction) {
          setSelectedExistingTxs([suggestion.existingTransaction]);
        } else if (suggestion.existingExpense) {
          setSelectedExistingTxs([suggestion.existingExpense]);
        } else if (suggestion.existingInterest) {
          setSelectedExistingTxs([suggestion.existingInterest]);
        }
      } else if (suggestion.matchMode === 'match_group' && (suggestion.existingTransactions || suggestion.existingInterestEntries)) {
        // Grouped match - should default to "Match Existing" tab
        setMatchMode('match');
        // Pre-select all transactions from the group
        if (suggestion.existingTransactions?.length > 0) {
          setSelectedExistingTxs(suggestion.existingTransactions);
        } else if (suggestion.existingInterestEntries?.length > 0) {
          setSelectedExistingTxs(suggestion.existingInterestEntries);
        }
      } else if (suggestion.matchMode === 'grouped_disbursement' && suggestion.existingTransaction) {
        // Grouped disbursement - multiple bank debits → single disbursement transaction
        setMatchMode('match');
        setSelectedExistingTxs([suggestion.existingTransaction]);
        // Also set the loan if available
        if (suggestion.loan) {
          setSelectedLoan(suggestion.loan);
        }
      } else {
        setMatchMode('create');
      }

      if (suggestion.loan_id) {
        const loan = loans.find(l => l.id === suggestion.loan_id);
        if (loan) {
          setSelectedLoan(loan);
          // Pre-fill entity search with borrower name to filter loan list
          const borrowerName = getBorrowerName(loan.borrower_id);
          if (borrowerName) {
            setEntitySearch(borrowerName);
          }
        }
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
        // Also apply to investor withdrawal split if this is an investor withdrawal
        if (suggestion.type === 'investor_withdrawal' || suggestion.type === 'interest_withdrawal') {
          setInvestorWithdrawalSplit({
            capital: Math.round(amount * (suggestion.defaultSplit.capital || 1) * 100) / 100,
            interest: Math.round(amount * (suggestion.defaultSplit.interest || 0) * 100) / 100
          });
        } else {
          setInvestorWithdrawalSplit({ capital: amount, interest: 0 });
        }
      } else {
        setSplitAmounts({ capital: 0, interest: amount, fees: 0 });
        setInvestorWithdrawalSplit({ capital: amount, interest: 0 });
      }
    } else {
      // Default behavior - use amount-based heuristics
      setInvestorWithdrawalSplit({ capital: amount, interest: 0 });

      // Check for expense type suggestion from our learning system
      const expenseSuggestion = expenseTypeSuggestions.get(entry.id);

      // Apply amount-based heuristics for default type selection
      if (entry.amount > 0) {
        // Credits (money in)
        if (amount < 10000) {
          setReconciliationType('loan_repayment');  // Small credit = likely loan repayment
          // Default loan repayments to interest (most common for interest-only loans)
          setSplitAmounts({ capital: 0, interest: amount, fees: 0 });
        } else {
          setReconciliationType('investor_credit');  // Large credit = likely investor capital
          setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
        }
      } else {
        // Debits (money out)
        // If we have an expense type suggestion, default to expense type
        if (expenseSuggestion) {
          setReconciliationType('expense');
          const expType = expenseTypes.find(t => t.id === expenseSuggestion.expenseTypeId);
          if (expType) setSelectedExpenseType(expType);
          setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
        } else if (amount < 2000) {
          setReconciliationType('expense');  // Small debit = likely expense
          setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
        } else {
          setReconciliationType('loan_disbursement');  // Large debit = investor payment or loan disbursement
          setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
        }
      }
      setMatchMode('create');
    }

    // Also check if there's an expense type suggestion even when we have a main suggestion
    // but it didn't include an expense_type_id (e.g., generic "expense" suggestion)
    if (suggestion && suggestion.type === 'expense' && !suggestion.expense_type_id) {
      const expenseSuggestion = expenseTypeSuggestions.get(entry.id);
      if (expenseSuggestion) {
        const expType = expenseTypes.find(t => t.id === expenseSuggestion.expenseTypeId);
        if (expType) setSelectedExpenseType(expType);
      }
    }
  };

  // Save or update pattern after reconciliation
  const saveReconciliationPattern = async (entry, type, loanId, investorId, expenseTypeId, splitRatios) => {
    // Use enhanced vendor keyword extraction for better matching
    const keywords = extractVendorKeywords(entry.description);
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

    // Handle user-created grouped entries (multiple bank entries grouped together)
    // Can match to single transaction OR multiple transactions (multi-select)
    if (selectedEntry.isGroup && matchMode === 'match' && selectedExistingTxs.length > 0) {
      setIsReconciling(true);
      try {
        const groupEntries = selectedEntry.groupEntries;
        const netAmount = selectedEntry.amount;
        const isLoanType = reconciliationType === 'loan_repayment' || reconciliationType === 'loan_disbursement';
        const isInvestorType = reconciliationType === 'investor_credit' || reconciliationType === 'investor_withdrawal';

        // Validate amounts match
        const selectedTotal = selectedExistingTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
        if (Math.abs(Math.abs(netAmount) - selectedTotal) > 0.01) {
          alert('Selected transactions must equal bank entry total');
          setIsReconciling(false);
          return;
        }

        // Create reconciliation entries linking bank entries to selected transactions
        for (const bankEntry of groupEntries) {
          for (const tx of selectedExistingTxs) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: bankEntry.id,
              loan_transaction_id: isLoanType ? tx.id : null,
              investor_transaction_id: isInvestorType ? tx.id : null,
              expense_id: null,
              amount: Math.abs(tx.amount), // Use transaction amount for each link
              reconciliation_type: reconciliationType,
              notes: selectedExistingTxs.length > 1
                ? `Multi-match: ${selectedExistingTxs.length} transactions, ${groupEntries.length} bank entries`
                : `Net receipt match: ${groupEntries.length} entries (net ${formatCurrency(netAmount)})`,
              was_created: false
            });
          }

          // Mark each bank statement as reconciled
          await api.entities.BankStatement.update(bankEntry.id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });
        }

        // Log the grouped reconciliation
        logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
          bank_statement_id: groupEntries[0]?.id,
          description: `Grouped: ${groupEntries.length} entries → ${selectedExistingTxs.length} transactions`,
          amount: Math.abs(netAmount),
          bank_entry_count: groupEntries.length,
          transaction_count: selectedExistingTxs.length,
          net_amount: netAmount,
          match_type: selectedExistingTxs.length > 1 ? 'multi_transaction_match' : 'user_grouped_net'
        });

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
        queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });

        // Remove the group since all entries are now reconciled
        handleUngroupEntries(selectedEntry.id);

        // Clean up dismissed state for all reconciled entries
        setDismissedSuggestions(prev => {
          const next = new Set(prev);
          for (const bankEntry of groupEntries) {
            next.delete(bankEntry.id);
          }
          return next;
        });

        setSelectedEntry(null);
        setSelectedExistingTxs([]); // Clear selection
      } catch (error) {
        alert(`Error: ${error.message}`);
      } finally {
        setIsReconciling(false);
      }
      return;
    }

    // Handle multi-transaction match for single bank entry (one bank entry → multiple transactions)
    if (!selectedEntry.isGroup && matchMode === 'match' && selectedExistingTxs.length > 1) {
      setIsReconciling(true);
      try {
        const entryAmount = Math.abs(selectedEntry.amount);
        const isLoanType = reconciliationType === 'loan_repayment' || reconciliationType === 'loan_disbursement';
        const isInvestorType = reconciliationType === 'investor_credit' || reconciliationType === 'investor_withdrawal';

        // Validate amounts match
        const selectedTotal = selectedExistingTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
        if (Math.abs(entryAmount - selectedTotal) > 0.01) {
          alert('Selected transactions must equal bank entry amount');
          setIsReconciling(false);
          return;
        }

        // Create reconciliation entry for each selected transaction
        for (const tx of selectedExistingTxs) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: selectedEntry.id,
            loan_transaction_id: isLoanType ? tx.id : null,
            investor_transaction_id: isInvestorType ? tx.id : null,
            expense_id: null,
            amount: Math.abs(tx.amount),
            reconciliation_type: reconciliationType,
            notes: `Multi-match: ${selectedExistingTxs.length} transactions`,
            was_created: false
          });
        }

        // Mark bank entry as reconciled
        await api.entities.BankStatement.update(selectedEntry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        // Log the reconciliation
        logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
          bank_statement_id: selectedEntry.id,
          description: `Multi-match: 1 bank entry → ${selectedExistingTxs.length} transactions`,
          amount: entryAmount,
          transaction_count: selectedExistingTxs.length,
          match_type: 'multi_transaction_match'
        });

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
        queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });

        // Clean up dismissed state
        setDismissedSuggestions(prev => {
          const next = new Set(prev);
          next.delete(selectedEntry.id);
          return next;
        });

        setSelectedEntry(null);
        setSelectedExistingTxs([]); // Clear selection
      } catch (error) {
        alert(`Error: ${error.message}`);
      } finally {
        setIsReconciling(false);
      }
      return;
    }

    // Handle grouped match from review suggestion (e.g., multiple loan repayments or investor withdrawals)
    if (reviewingSuggestion?.matchMode === 'match_group' && (reviewingSuggestion.existingTransactions || reviewingSuggestion.existingInterestEntries)) {
      setIsReconciling(true);
      try {
        const amount = Math.abs(selectedEntry.amount);
        const isInvestorType = reviewingSuggestion.type === 'investor_withdrawal' ||
                               reviewingSuggestion.type === 'investor_credit' ||
                               reviewingSuggestion.type === 'interest_withdrawal';
        const isLoanType = reviewingSuggestion.type === 'loan_repayment' || reviewingSuggestion.type === 'loan_disbursement';

        // Handle investor/capital transactions if present
        if (reviewingSuggestion.existingTransactions) {
          const txGroup = reviewingSuggestion.existingTransactions.filter(tx => !tx.is_deleted);

          for (const tx of txGroup) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: selectedEntry.id,
              loan_transaction_id: isLoanType ? tx.id : null,
              investor_transaction_id: isInvestorType ? tx.id : null,
              expense_id: null,
              amount: parseFloat(tx.amount) || 0,
              reconciliation_type: reviewingSuggestion.type,
              notes: `Grouped match: ${formatCurrency(amount)}`,
              was_created: false
            });
          }
        }

        // Handle interest ledger entries if present
        if (reviewingSuggestion.existingInterestEntries) {
          for (const interest of reviewingSuggestion.existingInterestEntries) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: selectedEntry.id,
              loan_transaction_id: null,
              investor_transaction_id: null,
              expense_id: null,
              interest_id: interest.id,
              amount: parseFloat(interest.amount) || 0,
              reconciliation_type: 'interest_withdrawal',
              notes: `Grouped interest match: ${formatCurrency(amount)}`,
              was_created: false
            });
          }
        }

        // Mark bank statement as reconciled
        await api.entities.BankStatement.update(selectedEntry.id, {
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });

        // Log the grouped match reconciliation
        const txCount = (reviewingSuggestion.existingTransactions?.length || 0) +
                        (reviewingSuggestion.existingInterestEntries?.length || 0);
        logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
          bank_statement_id: selectedEntry.id,
          description: selectedEntry.description,
          amount: amount,
          transaction_count: txCount,
          match_type: isInvestorType ? 'grouped_investor' : 'grouped_repayments'
        });

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
        queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });

        // Clean up dismissed state for reconciled entry
        setDismissedSuggestions(prev => {
          const next = new Set(prev);
          next.delete(selectedEntry.id);
          return next;
        });

        setSelectedEntry(null);
        setReviewingSuggestion(null);
      } catch (error) {
        alert(`Error: ${error.message}`);
      } finally {
        setIsReconciling(false);
      }
      return;
    }

    // Handle grouped disbursement match (multiple bank debits → single disbursement transaction)
    if (reviewingSuggestion?.matchMode === 'grouped_disbursement' && reviewingSuggestion.existingTransaction) {
      setIsReconciling(true);
      try {
        const tx = reviewingSuggestion.existingTransaction;
        const groupedEntries = reviewingSuggestion.groupedEntries;

        // Create reconciliation entry for each bank debit, linking to same disbursement
        for (const bankEntry of groupedEntries) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: bankEntry.id,
            loan_transaction_id: tx.id,
            investor_transaction_id: null,
            expense_id: null,
            amount: Math.abs(bankEntry.amount),
            reconciliation_type: 'loan_disbursement',
            notes: `Grouped disbursement: ${groupedEntries.length} payments`,
            was_created: false
          });

          // Mark each bank statement as reconciled
          await api.entities.BankStatement.update(bankEntry.id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });
        }

        // Log the grouped disbursement reconciliation
        logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
          bank_statement_id: selectedEntry.id,
          description: selectedEntry.description,
          amount: Math.abs(tx.amount),
          bank_entry_count: groupedEntries.length,
          match_type: 'grouped_disbursement'
        });

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
        queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });

        // Clean up dismissed state for all reconciled entries
        setDismissedSuggestions(prev => {
          const next = new Set(prev);
          for (const bankEntry of groupedEntries) {
            next.delete(bankEntry.id);
          }
          return next;
        });

        setSelectedEntry(null);
        setReviewingSuggestion(null);
      } catch (error) {
        alert(`Error: ${error.message}`);
      } finally {
        setIsReconciling(false);
      }
      return;
    }

    // Handle grouped investor match (multiple bank entries → single investor transaction)
    if (reviewingSuggestion?.matchMode === 'grouped_investor' && reviewingSuggestion.existingTransaction) {
      setIsReconciling(true);
      try {
        const invTx = reviewingSuggestion.existingTransaction;
        const groupedEntries = reviewingSuggestion.groupedEntries;
        const recType = reviewingSuggestion.type; // 'investor_credit' or 'investor_withdrawal'

        // Create reconciliation entry for each bank entry, linking to same investor transaction
        for (const bankEntry of groupedEntries) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: bankEntry.id,
            loan_transaction_id: null,
            investor_transaction_id: invTx.id,
            expense_id: null,
            amount: Math.abs(bankEntry.amount),
            reconciliation_type: recType,
            notes: `Grouped investor: ${groupedEntries.length} payments`,
            was_created: false
          });

          // Mark each bank statement as reconciled
          await api.entities.BankStatement.update(bankEntry.id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });
        }

        // Log the grouped investor reconciliation
        logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
          bank_statement_id: selectedEntry.id,
          description: selectedEntry.description,
          amount: Math.abs(invTx.amount),
          bank_entry_count: groupedEntries.length,
          match_type: 'grouped_investor'
        });

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
        queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
        queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });

        // Clean up dismissed state for all reconciled entries
        setDismissedSuggestions(prev => {
          const next = new Set(prev);
          for (const bankEntry of groupedEntries) {
            next.delete(bankEntry.id);
          }
          return next;
        });

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

      if (matchMode === 'match' && selectedExistingTxs.length === 1) {
        // Single transaction match (already handled multi-transaction above)
        const selectedTx = selectedExistingTxs[0];
        // Check if transaction has been deleted
        if (selectedTx.is_deleted) {
          alert('Error: This transaction has been deleted and cannot be matched');
          setIsReconciling(false);
          return;
        }
        if (reconciliationType === 'loan_repayment' || reconciliationType === 'loan_disbursement') {
          transactionId = selectedTx.id;
        } else if (reconciliationType === 'investor_withdrawal' || reconciliationType === 'investor_credit') {
          investorTransactionId = selectedTx.id;
        } else if (reconciliationType === 'interest_withdrawal') {
          // Matching to existing investor interest entry
          interestId = selectedTx.id;
        } else if (reconciliationType === 'expense') {
          expenseId = selectedTx.id;
        } else if (reconciliationType === 'other_income') {
          otherIncomeId = selectedTx.id;
        }
      } else {
        if (reconciliationType === 'loan_repayment' && multiLoanAllocations.length > 0) {
          // Multi-loan repayment: create a transaction for each loan
          const createdTransactionIds = [];
          for (const allocation of multiLoanAllocations) {
            const allocationAmount = (allocation.principal || 0) + (allocation.interest || 0) + (allocation.fees || 0);
            if (allocationAmount <= 0) continue; // Skip loans with no allocation

            const txData = {
              loan_id: allocation.loan.id,
              borrower_id: allocation.loan.borrower_id,
              amount: allocationAmount,
              date: selectedEntry.statement_date,
              type: 'Repayment',
              principal_applied: allocation.principal || 0,
              interest_applied: allocation.interest || 0,
              fees_applied: allocation.fees || 0,
              reference: selectedEntry.external_reference,
              notes: multiLoanAllocations.length > 1
                ? `Bank reconciliation (split ${multiLoanAllocations.length} loans): ${selectedEntry.description}`
                : `Bank reconciliation: ${selectedEntry.description}`
            };
            const created = await api.entities.Transaction.create(txData);
            createdTransactionIds.push({ id: created.id, amount: allocationAmount, loan: allocation.loan });
          }

          // For multi-loan, we'll create reconciliation entries for each and skip the single entry below
          if (createdTransactionIds.length > 0) {
            for (const { id, amount: txAmount, loan } of createdTransactionIds) {
              await api.entities.ReconciliationEntry.create({
                bank_statement_id: selectedEntry.id,
                loan_transaction_id: id,
                investor_transaction_id: null,
                expense_id: null,
                amount: txAmount,
                reconciliation_type: 'loan_repayment',
                notes: `Split repayment: Loan ${loan.loan_number}`,
                was_created: true
              });
            }

            // Mark bank statement as reconciled
            await api.entities.BankStatement.update(selectedEntry.id, {
              is_reconciled: true,
              reconciled_at: new Date().toISOString()
            });

            // Log the multi-loan reconciliation
            logReconciliationEvent(AuditAction.RECONCILIATION_CREATE, {
              bank_statement_id: selectedEntry.id,
              description: selectedEntry.description,
              amount: amount,
              type: 'multi_loan_repayment',
              loan_count: createdTransactionIds.length,
              loan_numbers: createdTransactionIds.map(t => t.loan.loan_number).join(', ')
            });

            // If pattern saving is enabled, save the split ratios
            if (savePattern && selectedEntry.description) {
              const totalAmount = multiLoanAllocations.reduce((sum, a) =>
                sum + (a.principal || 0) + (a.interest || 0) + (a.fees || 0), 0
              );

              await saveReconciliationPattern({
                description_pattern: selectedEntry.description.toLowerCase().slice(0, 50),
                match_type: 'loan_repayment',
                loan_id: null, // Multi-loan patterns don't have a single loan
                investor_id: null,
                expense_type_id: null,
                split_ratios: {
                  multiLoan: true,
                  borrower_id: multiLoanBorrowerId,
                  allocations: multiLoanAllocations.map(a => ({
                    loan_number: a.loan.loan_number,
                    principal_ratio: totalAmount > 0 ? (a.principal || 0) / totalAmount : 0,
                    interest_ratio: totalAmount > 0 ? (a.interest || 0) / totalAmount : 0,
                    fees_ratio: totalAmount > 0 ? (a.fees || 0) / totalAmount : 0
                  }))
                }
              });
            }

            // Refresh data
            queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
            queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['loans'] });

            // Clean up dismissed state for reconciled entry
            setDismissedSuggestions(prev => {
              const next = new Set(prev);
              next.delete(selectedEntry.id);
              return next;
            });

            setSelectedEntry(null);
            setReviewingSuggestion(null);
            setIsReconciling(false);
            return; // Exit early - we handled everything for multi-loan
          }

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
          // Handle split between capital and interest withdrawal
          const capitalAmount = investorWithdrawalSplit.capital || 0;
          const interestAmount = investorWithdrawalSplit.interest || 0;

          // Create capital withdrawal if there's capital amount
          if (capitalAmount > 0) {
            const txData = {
              investor_id: selectedInvestor.id,
              type: 'capital_out',
              amount: capitalAmount,
              date: selectedEntry.statement_date,
              description: selectedEntry.description,
              reference: selectedEntry.external_reference
            };
            const created = await api.entities.InvestorTransaction.create(txData);
            investorTransactionId = created.id;

            await api.entities.Investor.update(selectedInvestor.id, {
              current_capital_balance: (selectedInvestor.current_capital_balance || 0) - capitalAmount
            });
          }

          // Create interest withdrawal if there's interest amount
          if (interestAmount > 0) {
            // Check if investor has manual interest calculation (via their product)
            const investorProduct = investorProducts.find(p => p.id === selectedInvestor.product_id);
            const isManualInterest = investorProduct?.interest_calculation_type === 'manual';

            // For manual interest investors, create a credit entry first (accrual)
            // This represents the interest that was owed before the payment
            if (isManualInterest) {
              await api.entities.InvestorInterest.create({
                investor_id: selectedInvestor.id,
                type: 'credit',
                amount: interestAmount,
                date: selectedEntry.statement_date,
                description: `Interest accrued (auto-created for withdrawal): ${selectedEntry.description}`,
                reference: selectedEntry.external_reference
              });
            }

            // Create the debit (withdrawal/payment) entry
            const interestEntry = await api.entities.InvestorInterest.create({
              investor_id: selectedInvestor.id,
              type: 'debit',
              amount: interestAmount,
              date: selectedEntry.statement_date,
              description: selectedEntry.description,
              reference: selectedEntry.external_reference
            });
            interestId = interestEntry.id;
          }

        } else if (reconciliationType === 'expense') {
          const expenseData = {
            type_id: selectedExpenseType?.id || null,
            type_name: selectedExpenseType?.name || null,
            amount: amount,
            date: selectedEntry.statement_date,
            description: expenseDescription || selectedEntry.description,
            loan_id: selectedExpenseLoan?.id || null
          };
          const created = await api.entities.Expense.create(expenseData);
          expenseId = created.id;
          console.log('[Reconcile] Created expense:', expenseId);
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

      // Defensive check: ensure expenseId is set when reconciling as expense
      if (reconciliationType === 'expense' && matchMode === 'create' && !expenseId) {
        console.error('[Reconcile] CRITICAL: Expense type but no expenseId!', {
          reconciliationType,
          matchMode,
          expenseId
        });
        throw new Error('Expense reconciliation failed: expenseId not set after creation');
      }

      // Create reconciliation entry (for non-offset types)
      // Wrap in try-catch to rollback created entities if ReconciliationEntry fails
      try {
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
      } catch (reconError) {
        // Rollback: if we created an expense/other_income but ReconciliationEntry failed, delete it
        console.error('[Reconcile] ReconciliationEntry creation failed:', reconError);
        if (matchMode === 'create') {
          if (expenseId) {
            console.error('[Reconcile] Rolling back expense:', expenseId);
            try {
              await api.entities.Expense.delete(expenseId);
            } catch (deleteError) {
              console.error('[Reconcile] Failed to rollback expense:', deleteError);
            }
          }
          if (otherIncomeId) {
            console.error('[Reconcile] Rolling back other_income:', otherIncomeId);
            try {
              await api.entities.OtherIncome.delete(otherIncomeId);
            } catch (deleteError) {
              console.error('[Reconcile] Failed to rollback other_income:', deleteError);
            }
          }
        }
        throw reconError; // Re-throw to be caught by outer catch
      }

      // Mark bank statement as reconciled
      await api.entities.BankStatement.update(selectedEntry.id, {
        is_reconciled: true,
        reconciled_at: new Date().toISOString()
      });

      // Save pattern for future auto-matching (if enabled and creating new)
      if (savePattern && matchMode === 'create') {
        let splitRatios = null;
        if (reconciliationType === 'loan_repayment') {
          splitRatios = {
            capital: splitAmounts.capital / amount,
            interest: splitAmounts.interest / amount,
            fees: splitAmounts.fees / amount
          };
        } else if (reconciliationType === 'investor_withdrawal') {
          // Save investor withdrawal split as capital/interest ratios
          splitRatios = {
            capital: investorWithdrawalSplit.capital / amount,
            interest: investorWithdrawalSplit.interest / amount,
            fees: 0
          };
        }

        await saveReconciliationPattern(
          selectedEntry,
          reconciliationType,
          selectedLoan?.id || null,
          selectedInvestor?.id || null,
          selectedExpenseType?.id || null,
          splitRatios
        );
      }

      // Log the reconciliation
      logReconciliationEvent(
        matchMode === 'match' ? AuditAction.RECONCILIATION_MATCH : AuditAction.RECONCILIATION_CREATE,
        {
          bank_statement_id: selectedEntry.id,
          description: selectedEntry.description,
          amount: amount,
          reconciliation_type: reconciliationType,
          match_mode: matchMode,
          loan_id: selectedLoan?.id,
          loan_number: selectedLoan?.loan_number,
          investor_id: selectedInvestor?.id,
          investor_name: selectedInvestor?.name,
          transaction_id: transactionId,
          investor_transaction_id: investorTransactionId,
          expense_id: expenseId
        }
      );

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-interest'] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });

      // Clean up dismissed state for reconciled entry
      setDismissedSuggestions(prev => {
        const next = new Set(prev);
        next.delete(selectedEntry.id);
        return next;
      });

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
    const results = [];

    entries.forEach(re => {
      // Handle loan transactions
      if (re.loan_transaction_id) {
        const tx = loanTransactions.find(t => t.id === re.loan_transaction_id);
        if (tx) {
          const loan = loans.find(l => l.id === tx.loan_id);
          const borrowerName = loan ? getBorrowerName(loan.borrower_id) : 'Unknown';
          results.push({
            reconciliationEntry: re,
            linkedEntity: tx,
            entityType: tx.type === 'Repayment' ? 'Loan Repayment' : 'Loan Disbursement',
            entityDetails: {
              loanNumber: loan?.loan_number,
              borrowerName,
              date: tx.date,
              amount: tx.amount,
              principalApplied: tx.principal_applied,
              interestApplied: tx.interest_applied,
              feesApplied: tx.fees_applied,
              notes: tx.notes
            },
            reconciliationType: re.reconciliation_type,
            amount: tx.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        } else {
          // Broken link - loan transaction was deleted
          results.push({
            reconciliationEntry: re,
            linkedEntity: null,
            entityType: re.reconciliation_type === 'loan_disbursement' ? 'Loan Disbursement' : 'Loan Repayment',
            isBrokenLink: true,
            brokenEntityId: re.loan_transaction_id,
            reconciliationType: re.reconciliation_type,
            amount: re.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        }
      }

      // Handle investor capital transactions
      if (re.investor_transaction_id) {
        const tx = investorTransactions.find(t => t.id === re.investor_transaction_id);
        if (tx) {
          const investor = investors.find(i => i.id === tx.investor_id);
          results.push({
            reconciliationEntry: re,
            linkedEntity: tx,
            entityType: tx.type === 'capital_in' ? 'Investor Credit' :
                         tx.type === 'capital_out' ? 'Investor Withdrawal' : 'Investor Transaction',
            entityDetails: {
              investorName: investor?.business_name || investor?.name,
              date: tx.date,
              amount: tx.amount,
              description: tx.description
            },
            reconciliationType: re.reconciliation_type,
            amount: tx.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        } else {
          // Broken link - investor transaction was deleted
          results.push({
            reconciliationEntry: re,
            linkedEntity: null,
            entityType: re.reconciliation_type === 'investor_withdrawal' ? 'Investor Withdrawal' : 'Investor Credit',
            isBrokenLink: true,
            brokenEntityId: re.investor_transaction_id,
            reconciliationType: re.reconciliation_type,
            amount: re.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        }
      }

      // Handle investor interest withdrawals (can be in addition to capital withdrawal)
      if (re.interest_id) {
        const interestEntry = investorInterestEntries.find(i => i.id === re.interest_id);
        if (interestEntry) {
          const investor = investors.find(i => i.id === interestEntry.investor_id);
          results.push({
            reconciliationEntry: re,
            linkedEntity: interestEntry,
            entityType: 'Interest Withdrawal',
            entityDetails: {
              investorName: investor?.business_name || investor?.name,
              date: interestEntry.date,
              amount: interestEntry.amount,
              description: interestEntry.description
            },
            reconciliationType: re.reconciliation_type,
            amount: interestEntry.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        } else {
          // Broken link - interest entry was deleted
          results.push({
            reconciliationEntry: re,
            linkedEntity: null,
            entityType: 'Interest Withdrawal',
            isBrokenLink: true,
            brokenEntityId: re.interest_id,
            reconciliationType: re.reconciliation_type,
            amount: re.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        }
      }

      // Handle expenses
      if (re.expense_id) {
        const expense = expenses.find(e => e.id === re.expense_id);
        if (expense) {
          const linkedLoan = expense.loan_id ? loans.find(l => l.id === expense.loan_id) : null;
          results.push({
            reconciliationEntry: re,
            linkedEntity: expense,
            entityType: 'Expense',
            entityDetails: {
              expenseTypeName: expense.type_name || 'Uncategorized',
              date: expense.date,
              amount: expense.amount,
              description: expense.description,
              linkedLoan: linkedLoan ? {
                loanNumber: linkedLoan.loan_number,
                borrowerName: getBorrowerName(linkedLoan.borrower_id)
              } : null
            },
            reconciliationType: re.reconciliation_type,
            amount: expense.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        } else {
          // Broken link - expense was deleted
          results.push({
            reconciliationEntry: re,
            linkedEntity: null,
            entityType: 'Expense',
            isBrokenLink: true,
            brokenEntityId: re.expense_id,
            reconciliationType: re.reconciliation_type,
            amount: re.amount,
            notes: re.notes,
            createdAt: re.created_at
          });
        }
      }

      // Handle offset entries
      if (re.reconciliation_type === 'offset' && !re.loan_transaction_id && !re.investor_transaction_id && !re.expense_id && !re.interest_id) {
        const groupIdMatch = re.notes?.match(/^\[offset_[^\]]+\]/);
        const groupId = groupIdMatch ? groupIdMatch[0] : null;
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

        results.push({
          reconciliationEntry: re,
          linkedEntity: null,
          entityType: 'Funds Returned',
          entityDetails: {
            amount: re.amount,
            notes: displayNotes,
            offsetPartners
          },
          reconciliationType: re.reconciliation_type,
          amount: re.amount,
          notes: re.notes,
          createdAt: re.created_at
        });
      }
    });

    return results;
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

      // Log the un-reconcile action
      logReconciliationEvent(AuditAction.RECONCILIATION_UNMATCH, {
        bank_statement_id: selectedEntry.id,
        description: selectedEntry.description,
        amount: selectedEntry.amount,
        deleted_created_records: hasCreatedRecords
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
        if (suggestion.matchMode === 'match' || suggestion.matchMode === 'grouped_disbursement') {
          if (suggestion.existingTransaction) {
            // Skip if transaction has been deleted or no longer exists in database
            if (suggestion.existingTransaction.is_deleted) {
              failed++;
              continue;
            }
            // Verify transaction still exists in current data
            const txExists = suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement'
              ? loanTransactions.some(tx => tx.id === suggestion.existingTransaction.id && !tx.is_deleted)
              : investorTransactions.some(tx => tx.id === suggestion.existingTransaction.id);
            if (!txExists) {
              console.warn('Skipping auto-reconcile: transaction no longer exists', suggestion.existingTransaction.id);
              failed++;
              continue;
            }
            if (suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement') {
              transactionId = suggestion.existingTransaction.id;
            } else if (suggestion.type.startsWith('investor_')) {
              investorTransactionId = suggestion.existingTransaction.id;
            }
          } else if (suggestion.existingExpense) {
            expenseId = suggestion.existingExpense.id;
          }
        } else if (suggestion.matchMode === 'match_group' && suggestion.existingTransactions) {
          // Handle grouped matches (multiple transactions summing to bank amount)
          // Filter out any deleted transactions AND verify they still exist in database
          const txGroup = suggestion.existingTransactions.filter(tx =>
            !tx.is_deleted && loanTransactions.some(lt => lt.id === tx.id && !lt.is_deleted)
          );
          if (txGroup.length === 0) {
            failed++;
            continue; // Skip - all transactions in group were deleted or no longer exist
          }

          // Create a reconciliation entry for each transaction in the group
          for (const tx of txGroup) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: entry.id,
              loan_transaction_id: tx.id,
              investor_transaction_id: null,
              expense_id: null,
              amount: parseFloat(tx.amount) || 0,
              reconciliation_type: 'loan_repayment',
              notes: `Auto-reconciled grouped match: ${txGroup.length} repayments with ${Math.round(suggestion.confidence * 100)}% confidence`,
              was_created: false
            });
          }

          // Mark bank statement as reconciled
          await api.entities.BankStatement.update(entry.id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });

          succeeded++;
          continue; // Skip the normal reconciliation entry creation below
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
          } else if ((suggestion.type === 'investor_withdrawal' || suggestion.type === 'interest_withdrawal') && suggestion.investor_id) {
            // Handle both investor_withdrawal and legacy interest_withdrawal patterns
            // For auto-reconciliation, default to capital withdrawal
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

      if (suggestion.matchMode === 'match' && (suggestion.existingTransaction || suggestion.existingExpense || suggestion.existingInterest)) {
        // Link to existing single transaction (1:1 match)
        if (suggestion.existingTransaction) {
          const tx = suggestion.existingTransaction;
          // Skip if transaction has been deleted
          if (tx.is_deleted) {
            return { success: false, error: 'Transaction has been deleted' };
          }
          // Verify transaction still exists in current data
          const isLoanTx = suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement';
          const txExists = isLoanTx
            ? loanTransactions.some(lt => lt.id === tx.id && !lt.is_deleted)
            : investorTransactions.some(it => it.id === tx.id);
          if (!txExists) {
            return { success: false, error: 'Transaction no longer exists' };
          }
          if (isLoanTx) {
            transactionId = tx.id;
          } else if (suggestion.type.startsWith('investor_')) {
            investorTransactionId = tx.id;
          }
        } else if (suggestion.existingExpense) {
          expenseId = suggestion.existingExpense.id;
        } else if (suggestion.existingInterest) {
          interestId = suggestion.existingInterest.id;
        }
      } else if (suggestion.matchMode === 'grouped_disbursement' && suggestion.existingTransaction && suggestion.groupedEntries) {
        // Grouped disbursement: multiple bank debits → single disbursement transaction
        // Process ALL entries in the group, not just the one passed in
        const tx = suggestion.existingTransaction;
        if (tx.is_deleted) {
          return { success: false, error: 'Transaction has been deleted' };
        }
        const txExists = loanTransactions.some(lt => lt.id === tx.id && !lt.is_deleted);
        if (!txExists) {
          return { success: false, error: 'Transaction no longer exists' };
        }

        // Create reconciliation entry for each bank debit in the group
        for (const bankEntry of suggestion.groupedEntries) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: bankEntry.id,
            loan_transaction_id: tx.id,
            investor_transaction_id: null,
            expense_id: null,
            amount: Math.abs(bankEntry.amount),
            reconciliation_type: 'loan_disbursement',
            notes: `Grouped disbursement: ${suggestion.groupedEntries.length} payments`,
            was_created: false
          });

          // Mark each bank statement as reconciled
          await api.entities.BankStatement.update(bankEntry.id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });
        }

        // Refresh data (skip if bulk operation will do it at the end)
        if (!skipInvalidation) {
          queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
          queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });

          // Clean up dismissed state for all reconciled entries
          setDismissedSuggestions(prev => {
            const next = new Set(prev);
            for (const bankEntry of suggestion.groupedEntries) {
              next.delete(bankEntry.id);
            }
            return next;
          });
        }

        return { success: true, groupedCount: suggestion.groupedEntries.length }; // Early return - we handled everything
      } else if (suggestion.matchMode === 'grouped_investor' && suggestion.existingTransaction && suggestion.groupedEntries) {
        // Grouped investor: multiple bank entries → single investor transaction
        // Process ALL entries in the group
        const invTx = suggestion.existingTransaction;
        const txExists = investorTransactions.some(it => it.id === invTx.id);
        if (!txExists) {
          return { success: false, error: 'Transaction no longer exists' };
        }

        const recType = suggestion.type; // 'investor_credit' or 'investor_withdrawal'

        // Create reconciliation entry for each bank entry in the group
        for (const bankEntry of suggestion.groupedEntries) {
          await api.entities.ReconciliationEntry.create({
            bank_statement_id: bankEntry.id,
            loan_transaction_id: null,
            investor_transaction_id: invTx.id,
            expense_id: null,
            amount: Math.abs(bankEntry.amount),
            reconciliation_type: recType,
            notes: `Grouped investor: ${suggestion.groupedEntries.length} payments`,
            was_created: false
          });

          // Mark each bank statement as reconciled
          await api.entities.BankStatement.update(bankEntry.id, {
            is_reconciled: true,
            reconciled_at: new Date().toISOString()
          });
        }

        // Refresh data (skip if bulk operation will do it at the end)
        if (!skipInvalidation) {
          queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
          queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });
          queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });

          // Clean up dismissed state for all reconciled entries
          setDismissedSuggestions(prev => {
            const next = new Set(prev);
            for (const bankEntry of suggestion.groupedEntries) {
              next.delete(bankEntry.id);
            }
            return next;
          });
        }

        return { success: true, groupedCount: suggestion.groupedEntries.length }; // Early return - we handled everything
      } else if (suggestion.matchMode === 'match_group' && (suggestion.existingTransactions || suggestion.existingInterestEntries)) {
        // Link to multiple existing transactions (grouped payments)
        // NOTE: For cross-table matches, BOTH existingTransactions AND existingInterestEntries may be present

        if (suggestion.existingTransactions) {
          // Grouped loan repayments or investor transactions
          // Filter out any deleted transactions AND verify they exist in database
          const isLoanTx = suggestion.type === 'loan_repayment' || suggestion.type === 'loan_disbursement';
          const txGroup = suggestion.existingTransactions.filter(tx => {
            if (tx.is_deleted) return false;
            return isLoanTx
              ? loanTransactions.some(lt => lt.id === tx.id && !lt.is_deleted)
              : investorTransactions.some(it => it.id === tx.id);
          });

          for (const tx of txGroup) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: entry.id,
              loan_transaction_id: isLoanTx ? tx.id : null,
              investor_transaction_id: !isLoanTx ? tx.id : null,
              expense_id: null,
              interest_id: null,
              amount: parseFloat(tx.amount) || 0,
              reconciliation_type: suggestion.type,
              notes: `Grouped match: ${txGroup.length} transactions totaling ${formatCurrency(amount)} with ${Math.round(suggestion.confidence * 100)}% confidence`,
              was_created: false
            });
          }
        }

        // Also process interest entries if present (can be in ADDITION to capital transactions for cross-table match)
        if (suggestion.existingInterestEntries) {
          // Grouped investor interest entries
          const interestGroup = suggestion.existingInterestEntries;

          for (const interest of interestGroup) {
            await api.entities.ReconciliationEntry.create({
              bank_statement_id: entry.id,
              loan_transaction_id: null,
              investor_transaction_id: null,
              expense_id: null,
              interest_id: interest.id,
              amount: parseFloat(interest.amount) || 0,
              reconciliation_type: 'interest_withdrawal',
              notes: `Grouped interest match: ${interestGroup.length} entries totaling ${formatCurrency(amount)} with ${Math.round(suggestion.confidence * 100)}% confidence`,
              was_created: false
            });
          }
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
          queryClient.invalidateQueries({ queryKey: ['investor-transactions'] });
          queryClient.invalidateQueries({ queryKey: ['investor-interest'] });

          // Clean up dismissed state for reconciled entry
          setDismissedSuggestions(prev => {
            const next = new Set(prev);
            next.delete(entry.id);
            return next;
          });
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
        } else if ((suggestion.type === 'investor_withdrawal' || suggestion.type === 'interest_withdrawal') && suggestion.investor_id) {
          // Handle both investor_withdrawal and legacy interest_withdrawal patterns
          // For quick match, default to capital withdrawal
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

          // Clean up dismissed state for reconciled entry
          setDismissedSuggestions(prev => {
            const next = new Set(prev);
            next.delete(entry.id);
            return next;
          });
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
    let skipped = 0;
    const errors = [];
    const skippedDetails = []; // Track details of skipped entries for debugging

    // Track which transactions/expenses have been used in this bulk operation
    // to prevent duplicate matching to the same existing record
    const usedTransactionIds = new Set();
    const usedExpenseIds = new Set();
    // Track which bank entries have been processed as part of a grouped match
    // so we don't try to process them again when their individual entry comes up
    const processedGroupedEntryIds = new Set();

    for (const entryId of entriesToProcess) {
      // Skip if this entry was already processed as part of a grouped match
      if (processedGroupedEntryIds.has(entryId)) {
        skipped++;
        setBulkMatchProgress({ current: succeeded + failed + skipped, total: entriesToProcess.length });
        continue;
      }

      const entry = bankStatements.find(s => s.id === entryId);
      const suggestion = suggestedMatches.get(entryId);

      // Check if this suggestion references an already-used transaction
      if (suggestion.matchMode === 'match') {
        if (suggestion.existingTransaction) {
          if (usedTransactionIds.has(suggestion.existingTransaction.id)) {
            const txInfo = suggestion.existingTransaction;
            skippedDetails.push({
              bankEntry: `${entry.statement_date} | ${formatCurrency(entry.amount)} | ${entry.description?.substring(0, 40)}`,
              reason: 'Transaction already matched in this batch',
              duplicateTx: `${txInfo.date} | ${formatCurrency(txInfo.amount)} | ${txInfo.description?.substring(0, 40) || suggestion.type}`
            });
            skipped++;
            setBulkMatchProgress({ current: succeeded + failed + skipped, total: entriesToProcess.length });
            continue; // Skip - transaction already used in this bulk operation
          }
        }
        if (suggestion.existingExpense) {
          if (usedExpenseIds.has(suggestion.existingExpense.id)) {
            const expInfo = suggestion.existingExpense;
            skippedDetails.push({
              bankEntry: `${entry.statement_date} | ${formatCurrency(entry.amount)} | ${entry.description?.substring(0, 40)}`,
              reason: 'Expense already matched in this batch',
              duplicateTx: `${expInfo.date} | ${formatCurrency(expInfo.amount)} | ${expInfo.description?.substring(0, 40) || 'Expense'}`
            });
            skipped++;
            setBulkMatchProgress({ current: succeeded + failed + skipped, total: entriesToProcess.length });
            continue; // Skip - expense already used in this bulk operation
          }
        }
        // Check for grouped transactions
        if (suggestion.existingTransactions) {
          const anyUsed = suggestion.existingTransactions.some(tx => usedTransactionIds.has(tx.id));
          if (anyUsed) {
            const usedTx = suggestion.existingTransactions.find(tx => usedTransactionIds.has(tx.id));
            skippedDetails.push({
              bankEntry: `${entry.statement_date} | ${formatCurrency(entry.amount)} | ${entry.description?.substring(0, 40)}`,
              reason: 'Grouped transaction already matched in this batch',
              duplicateTx: usedTx ? `${usedTx.date} | ${formatCurrency(usedTx.amount)} | ${usedTx.description?.substring(0, 40) || 'Grouped tx'}` : 'Unknown'
            });
            skipped++;
            setBulkMatchProgress({ current: succeeded + failed + skipped, total: entriesToProcess.length });
            continue; // Skip - one of the grouped transactions already used
          }
        }
      }

      try {
        await handleQuickMatch(entry, suggestion, true, true); // silent mode + skip invalidation for bulk
        succeeded++;

        // Mark the transaction/expense as used
        if (suggestion.matchMode === 'match') {
          if (suggestion.existingTransaction) {
            usedTransactionIds.add(suggestion.existingTransaction.id);
          }
          if (suggestion.existingExpense) {
            usedExpenseIds.add(suggestion.existingExpense.id);
          }
          if (suggestion.existingTransactions) {
            suggestion.existingTransactions.forEach(tx => usedTransactionIds.add(tx.id));
          }
        }
        // For grouped matches, mark all entries in the group as processed
        // so we don't try to process them again individually
        if ((suggestion.matchMode === 'grouped_disbursement' || suggestion.matchMode === 'grouped_investor') && suggestion.groupedEntries) {
          for (const groupedEntry of suggestion.groupedEntries) {
            processedGroupedEntryIds.add(groupedEntry.id);
          }
          if (suggestion.existingTransaction) {
            usedTransactionIds.add(suggestion.existingTransaction.id);
          }
        }
      } catch (error) {
        console.error('Bulk match error for entry:', entryId, error);
        errors.push(`${entry.description?.substring(0, 30) || entryId}: ${error.message}`);
        failed++;
      }

      setBulkMatchProgress({ current: succeeded + failed + skipped, total: entriesToProcess.length });
    }

    // Clean up dismissed state for all reconciled entries
    setDismissedSuggestions(prev => {
      const next = new Set(prev);
      for (const entryId of entriesToProcess) {
        next.delete(entryId);
      }
      return next;
    });

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
    setAutoMatchResults({ succeeded, failed, skipped });

    // Show summary of errors/skipped if any
    if (errors.length > 0 || skipped > 0) {
      let message = `Bulk match completed: ${succeeded} succeeded`;
      if (skipped > 0) {
        message += `, ${skipped} skipped (duplicate transaction references)`;
        // Add detailed skip info
        message += '\n\n--- SKIPPED ENTRIES ---';
        skippedDetails.slice(0, 10).forEach((detail, i) => {
          message += `\n\n${i + 1}. Bank Entry: ${detail.bankEntry}`;
          message += `\n   Reason: ${detail.reason}`;
          message += `\n   Already matched to: ${detail.duplicateTx}`;
        });
        if (skippedDetails.length > 10) {
          message += `\n\n...and ${skippedDetails.length - 10} more`;
        }
      }
      if (failed > 0) {
        message += `\n\n--- FAILED ENTRIES ---\n${failed} failed:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`;
      }
      alert(message);
      // Also log to console for easier inspection
      if (skippedDetails.length > 0) {
        console.log('Bulk match skipped entries:', skippedDetails);
      }
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
    // Get selected entries that have expense types assigned (manually or via pattern)
    const entriesToCreate = [...selectedEntries]
      .map(id => bankStatements.find(s => s.id === id))
      .filter(entry => entry && !entry.is_reconciled && (entryExpenseTypes.has(entry.id) || expenseTypeSuggestions.has(entry.id)));

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
        // Use manually assigned expense type first, then fall back to pattern suggestion
        // Note: expenseTypeSuggestions stores objects with { expenseTypeId, ... }
        const patternSuggestion = expenseTypeSuggestions.get(entry.id);
        const expenseTypeId = entryExpenseTypes.get(entry.id) || patternSuggestion?.expenseTypeId;
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

        // Save/update pattern for learning (enables future auto-suggestions)
        try {
          await saveReconciliationPattern(entry, 'expense', null, null, expenseTypeId, null);
        } catch (patternError) {
          console.warn('Could not save pattern:', patternError);
          // Don't fail the whole operation if pattern save fails
        }

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
    queryClient.invalidateQueries({ queryKey: ['reconciliation-patterns'] });
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
    // Clean up dismissed state for reconciled entries
    setDismissedSuggestions(prev => {
      const next = new Set(prev);
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
    // Clean up dismissed state for reconciled entries
    setDismissedSuggestions(prev => {
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

  // Delete all unreconciled bank statement entries
  const handleDeleteAllUnreconciled = async () => {
    setIsDeletingUnreconciled(true);
    try {
      const unreconciledEntries = bankStatements.filter(s => !s.is_reconciled);
      let deleted = 0;

      for (const entry of unreconciledEntries) {
        // Delete any reconciliation entries just in case
        await api.entities.ReconciliationEntry.deleteWhere({ bank_statement_id: entry.id });
        // Delete the bank statement entry
        await api.entities.BankStatement.delete(entry.id);
        deleted++;
      }

      // Clear selections and refresh data
      setSelectedEntries(new Set());
      setEntryExpenseTypes(new Map());
      setEntryOtherIncome(new Map());
      setDismissedSuggestions(new Set());

      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation-entries'] });

      setShowDeleteUnreconciledDialog(false);
      alert(`Deleted ${deleted} unreconciled entries`);
    } catch (error) {
      alert(`Error deleting entries: ${error.message}`);
    } finally {
      setIsDeletingUnreconciled(false);
    }
  };

  // Mark selected entries as unreconcilable
  const handleMarkUnreconcilable = async () => {
    if (!unreconcilableReason.trim()) return;

    setIsMarkingUnreconcilable(true);
    try {
      const entriesToMark = selectedEntries.size > 0
        ? bankStatements.filter(s => selectedEntries.has(s.id))
        : selectedEntry ? [selectedEntry] : [];

      if (entriesToMark.length === 0) return;

      // Generate a group ID if marking multiple entries together
      const groupId = entriesToMark.length > 1 ? crypto.randomUUID() : null;

      for (const entry of entriesToMark) {
        await api.entities.BankStatement.update(entry.id, {
          is_unreconcilable: true,
          unreconcilable_reason: unreconcilableReason.trim(),
          unreconcilable_at: new Date().toISOString(),
          unreconcilable_group_id: groupId,
          // Also mark as reconciled so it moves to reconciled list
          is_reconciled: true,
          reconciled_at: new Date().toISOString()
        });
      }

      // Clear selection and close dialog
      setSelectedEntries(new Set());
      setSelectedEntry(null);
      setShowUnreconcilableDialog(false);
      setUnreconcilableReason('');

      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });

      // Log audit event
      logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
        action: 'mark_unreconcilable',
        entry_count: entriesToMark.length,
        group_id: groupId,
        reason: unreconcilableReason.trim()
      });
    } catch (error) {
      console.error('Error marking entries as unreconcilable:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsMarkingUnreconcilable(false);
    }
  };

  // Undo unreconcilable status (handles grouped entries)
  const handleUndoUnreconcilable = async (entry) => {
    try {
      // Find all entries in the same group (if grouped)
      const entriesToUndo = entry.unreconcilable_group_id
        ? bankStatements.filter(s => s.unreconcilable_group_id === entry.unreconcilable_group_id)
        : [entry];

      for (const e of entriesToUndo) {
        await api.entities.BankStatement.update(e.id, {
          is_unreconcilable: false,
          unreconcilable_reason: null,
          unreconcilable_at: null,
          unreconcilable_by: null,
          unreconcilable_group_id: null,
          is_reconciled: false,
          reconciled_at: null
        });
      }

      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });

      // Log audit event
      logReconciliationEvent(AuditAction.RECONCILIATION_MATCH, {
        action: 'undo_unreconcilable',
        entry_count: entriesToUndo.length,
        group_id: entry.unreconcilable_group_id
      });
    } catch (error) {
      console.error('Error undoing unreconcilable status:', error);
      alert(`Error: ${error.message}`);
    }
  };

  // Toggle entry selection (auto-deselects conflicting entries)
  const toggleEntrySelection = (entryId) => {
    setSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
        // Auto-deselect any conflicting entries (those wanting the same transaction)
        const conflicts = matchConflicts.get(entryId);
        if (conflicts) {
          conflicts.forEach(conflictId => next.delete(conflictId));
        }
      }
      return next;
    });
  };

  // Select all visible entries based on current filter view
  // Skips conflicting entries - picks highest confidence first
  const selectAllVisible = () => {
    if (filter === 'reconciled') {
      // Select all reconciled entries (for un-reconcile)
      const eligibleIds = filteredStatements.filter(s => s.is_reconciled).map(s => s.id);
      setSelectedEntries(new Set(eligibleIds));
    } else {
      // Select all unreconciled entries with high-confidence suggestions (90%+)
      // But skip entries that would conflict (want the same target transaction)
      const eligible = filteredStatements
        .filter(s => {
          if (s.is_reconciled) return false;
          const suggestion = suggestedMatches.get(s.id);
          return suggestion && suggestion.confidence >= 0.9;
        });

      // Sort by confidence (highest first) so we keep the best matches
      eligible.sort((a, b) => {
        const aConf = suggestedMatches.get(a.id)?.confidence || 0;
        const bConf = suggestedMatches.get(b.id)?.confidence || 0;
        return bConf - aConf;
      });

      const selected = new Set();
      const usedTargets = new Set(); // Track which targets are already claimed

      for (const entry of eligible) {
        const suggestion = suggestedMatches.get(entry.id);
        const targetIds = [];

        // Collect all target IDs this entry wants to match
        if (suggestion?.existingTransaction) targetIds.push(`tx:${suggestion.existingTransaction.id}`);
        if (suggestion?.existingExpense) targetIds.push(`exp:${suggestion.existingExpense.id}`);
        if (suggestion?.existingTransactions) {
          suggestion.existingTransactions.forEach(tx => targetIds.push(`tx:${tx.id}`));
        }

        // Check if any targets are already claimed by a previously selected entry
        const hasConflict = targetIds.some(id => usedTargets.has(id));
        if (!hasConflict) {
          selected.add(entry.id);
          targetIds.forEach(id => usedTargets.add(id));
        }
      }

      setSelectedEntries(selected);
    }
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedEntries(new Set());
  };

  // Calculate totals
  const totals = useMemo(() => {
    const unreconciled = bankStatements.filter(s => !s.is_reconciled);
    const reconciled = bankStatements.filter(s => s.is_reconciled);

    // Match tab: entries with match-type suggestions (links to existing transactions)
    const matchableEntries = unreconciled.filter(s => {
      if (dismissedSuggestions.has(s.id)) return false;
      const suggestion = suggestedMatches.get(s.id);
      return suggestion && isMatchType(suggestion.matchMode);
    });

    // Create New tab: entries that need new transactions created
    const createEntries = unreconciled.filter(s => {
      if (dismissedSuggestions.has(s.id)) return true; // Dismissed entries go here
      const suggestion = suggestedMatches.get(s.id);
      // No suggestion OR create-type suggestion
      return !suggestion || suggestion.matchMode === 'create';
    });

    // High confidence matches (for auto-reconcile button)
    const highConfidence = matchableEntries.filter(s => {
      const suggestion = suggestedMatches.get(s.id);
      return suggestion && suggestion.confidence >= 0.9;
    });

    const unreconciledCredits = unreconciled.filter(s => s.amount > 0).reduce((sum, s) => sum + s.amount, 0);
    const unreconciledDebits = unreconciled.filter(s => s.amount < 0).reduce((sum, s) => sum + Math.abs(s.amount), 0);

    // Credits/debits for each tab
    const matchCredits = matchableEntries.filter(s => s.amount > 0).reduce((sum, s) => sum + s.amount, 0);
    const matchDebits = matchableEntries.filter(s => s.amount < 0).reduce((sum, s) => sum + Math.abs(s.amount), 0);
    const createCredits = createEntries.filter(s => s.amount > 0).reduce((sum, s) => sum + s.amount, 0);
    const createDebits = createEntries.filter(s => s.amount < 0).reduce((sum, s) => sum + Math.abs(s.amount), 0);

    return {
      total: bankStatements.length,
      unreconciled: unreconciled.length,
      reconciled: reconciled.length,
      matchable: matchableEntries.length,
      createNew: createEntries.length,
      highConfidence: highConfidence.length,
      unreconciledCredits,
      unreconciledDebits,
      matchCredits,
      matchDebits,
      createCredits,
      createDebits
    };
  }, [bankStatements, suggestedMatches, dismissedSuggestions]);

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
          <div className="flex gap-3 items-center">
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
            {totals.unreconciled > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteUnreconciledDialog(true)}
                className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete All Unreconciled
              </Button>
            )}
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

        {/* Main Tabs: Match to Existing vs Create New */}
        <div className="flex flex-col gap-4">
          {/* Tab Buttons */}
          <div className="flex gap-2 border-b border-slate-200 pb-2">
            <Button
              variant={activeTab === 'match' ? 'default' : 'ghost'}
              size="lg"
              onClick={() => { setActiveTab('match'); setFilter('unreconciled'); }}
              className={activeTab === 'match' ? 'bg-purple-600 hover:bg-purple-700' : 'text-slate-600'}
            >
              <Link2 className="w-4 h-4 mr-2" />
              Match to Existing ({totals.matchable})
            </Button>
            <Button
              variant={activeTab === 'create' ? 'default' : 'ghost'}
              size="lg"
              onClick={() => { setActiveTab('create'); setFilter('unreconciled'); }}
              className={activeTab === 'create' ? 'bg-amber-600 hover:bg-amber-700' : 'text-slate-600'}
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New ({totals.createNew})
            </Button>
            <div className="flex-1" />
            <Button
              variant={filter === 'reconciled' ? 'default' : 'outline'}
              size="lg"
              onClick={() => { setActiveTab('match'); setFilter('reconciled'); }}
              className={filter === 'reconciled' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Reconciled ({totals.reconciled})
            </Button>
          </div>

          {/* Tab Description and Summary */}
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div>
              {activeTab === 'match' && filter !== 'reconciled' && (
                <div className="text-sm text-slate-600">
                  <span className="font-medium text-purple-700">Bank entries matched to existing system transactions.</span>
                  <span className="ml-2 text-slate-500">
                    {formatCurrency(totals.matchCredits)} in / {formatCurrency(totals.matchDebits)} out
                  </span>
                </div>
              )}
              {activeTab === 'create' && (
                <div className="text-sm text-slate-600">
                  <span className="font-medium text-amber-700">Bank entries requiring new transactions to be created.</span>
                  <span className="ml-2 text-slate-500">
                    {formatCurrency(totals.createCredits)} in / {formatCurrency(totals.createDebits)} out
                  </span>
                </div>
              )}
              {filter === 'reconciled' && (
                <div className="text-sm text-slate-600">
                  <span className="font-medium text-emerald-700">Previously reconciled entries.</span>
                </div>
              )}
            </div>

          <div className="flex gap-3 items-center">
            {/* Confidence Filter - only on Match tab */}
            {activeTab === 'match' && filter !== 'reconciled' && (
              <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Match %" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center justify-between w-full gap-3">
                      <span>All confidence</span>
                      <span className="text-slate-400 text-xs">{confidenceCounts.all}</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="100">
                    <span className="flex items-center justify-between w-full gap-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        90%+ (Best)
                      </span>
                      <span className="text-slate-400 text-xs">{confidenceCounts['100']}</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="90">
                    <span className="flex items-center justify-between w-full gap-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        80-89% (Good)
                      </span>
                      <span className="text-slate-400 text-xs">{confidenceCounts['90']}</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="70">
                    <span className="flex items-center justify-between w-full gap-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                        65-79% (Fair)
                      </span>
                      <span className="text-slate-400 text-xs">{confidenceCounts['70']}</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="50">
                    <span className="flex items-center justify-between w-full gap-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                        50-64% (Check)
                      </span>
                      <span className="text-slate-400 text-xs">{confidenceCounts['50']}</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="low">
                    <span className="flex items-center justify-between w-full gap-3">
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        Below 50%
                      </span>
                      <span className="text-slate-400 text-xs">{confidenceCounts.low}</span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search description, amount, borrower..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-64"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Auto-Reconcile - only on Match tab */}
            {activeTab === 'match' && filter !== 'reconciled' && totals.highConfidence > 0 && (
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
        </div>

        {/* Bulk Actions Bar */}
        {selectedEntries.size > 0 && (() => {
          // Count selected by type
          const selectedUnreconciledWithSuggestion = [...selectedEntries].filter(id => {
            const entry = bankStatements.find(s => s.id === id);
            if (!entry || entry.is_reconciled) return false;
            const suggestion = suggestedMatches.get(id);
            return suggestion && suggestion.confidence >= 0.8;
          }).length;
          const selectedReconciled = [...selectedEntries].filter(id => {
            const entry = bankStatements.find(s => s.id === id);
            return entry?.is_reconciled;
          }).length;
          const selectedWithExpenseType = [...selectedEntries].filter(id => {
            const entry = bankStatements.find(s => s.id === id);
            // Include both manually set expense types AND pattern-matched expense suggestions
            const hasManualExpenseType = entryExpenseTypes.has(id);
            const hasPatternExpenseType = expenseTypeSuggestions.has(id);
            return entry && !entry.is_reconciled && (hasManualExpenseType || hasPatternExpenseType);
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
                {/* Show Create Expenses if entries with expense types are selected (only on Create New tab) */}
                {selectedWithExpenseType > 0 && activeTab === 'create' && (
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
                {/* Show Create Other Income if entries marked as other income are selected (only on Create New tab) */}
                {selectedWithOtherIncome > 0 && activeTab === 'create' && (
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
                {/* Group Selected - only show if 2+ unreconciled entries selected and none already grouped */}
                {(() => {
                  const selectedUnreconciled = [...selectedEntries].filter(id => {
                    const entry = bankStatements.find(s => s.id === id);
                    return entry && !entry.is_reconciled && !entryToGroup.has(id);
                  });
                  return selectedUnreconciled.length >= 2 && activeTab === 'create' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleGroupSelected}
                      className="border-blue-300 text-blue-700 hover:bg-blue-50"
                    >
                      <Link2 className="w-4 h-4 mr-2" />
                      Group Selected ({selectedUnreconciled.length})
                    </Button>
                  );
                })()}
                {/* Mark Unreconcilable - for entries that can't be matched */}
                {(() => {
                  const selectedUnreconciledCount = [...selectedEntries].filter(id => {
                    const entry = bankStatements.find(s => s.id === id);
                    return entry && !entry.is_reconciled;
                  }).length;
                  return selectedUnreconciledCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowUnreconcilableDialog(true)}
                      className="border-slate-400 text-slate-700 hover:bg-slate-50"
                    >
                      <Ban className="w-4 h-4 mr-2" />
                      Mark Unreconcilable ({selectedUnreconciledCount})
                    </Button>
                  );
                })()}
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
            ) : displayStatements.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                {bankStatements.length === 0
                  ? 'No bank statements imported yet. Upload a CSV file above.'
                  : 'No statements match your filters.'}
              </div>
            ) : filter === 'reconciled' && reconciledByFinancialYear ? (
              /* Grouped view for reconciled items */
              <div className="p-4 space-y-3">
                {reconciledByFinancialYear.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    No reconciled items to display.
                  </div>
                ) : (
                  <>
                    {/* Expand/Collapse controls */}
                    {reconciledByFinancialYear.length > 1 && (
                      <div className="flex items-center justify-end gap-2 text-sm mb-2">
                        <Button variant="ghost" size="sm" onClick={expandAllGroups}>
                          Expand All
                        </Button>
                        <Button variant="ghost" size="sm" onClick={collapseAllGroups}>
                          Collapse All
                        </Button>
                      </div>
                    )}
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
                            <Badge variant="outline" className="text-slate-600">{group.statements.length} item{group.statements.length !== 1 ? 's' : ''}</Badge>
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
                                      checked={group.statements.length > 0 && group.statements.every(s => selectedEntries.has(s.id))}
                                      onCheckedChange={(checked) => {
                                        if (checked) {
                                          // Select all in this group
                                          setSelectedEntries(prev => {
                                            const next = new Set(prev);
                                            group.statements.forEach(s => next.add(s.id));
                                            return next;
                                          });
                                        } else {
                                          // Deselect all in this group
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
                                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase min-w-[280px]">Links To</th>
                                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-28">Amount</th>
                                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-28">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {group.statements.map(entry => {
                                  // Handle net receipt groups (grouped reconciled entries)
                                  if (entry.isNetReceiptGroup) {
                                    const isExpanded = expandedNetReceiptGroups.has(entry.id);
                                    const netAmount = entry.amount;

                                    // Get link info from first statement's reconciliation
                                    const firstStatement = entry.groupStatements[0];
                                    const firstRecons = reconciliationEntries.filter(r => r.bank_statement_id === firstStatement?.id);
                                    const groupLinks = [];
                                    for (const recon of firstRecons) {
                                      if (recon.loan_transaction_id) {
                                        const tx = loanTransactions.find(t => t.id === recon.loan_transaction_id);
                                        const loan = tx ? loans.find(l => l.id === tx.loan_id) : null;
                                        groupLinks.push({
                                          type: 'loan',
                                          label: loan ? `${tx?.type || 'Loan'}: ${loan.borrower_name}` : (tx?.type || 'Loan Transaction'),
                                          loanNumber: loan?.loan_number,
                                          loanId: loan?.id,
                                          txDate: tx?.date
                                        });
                                      }
                                      if (recon.investor_transaction_id) {
                                        const tx = investorTransactions.find(t => t.id === recon.investor_transaction_id);
                                        const investor = tx ? investors.find(i => i.id === tx.investor_id) : null;
                                        groupLinks.push({
                                          type: 'investor',
                                          label: investor ? `${tx?.type?.replace('_', ' ') || 'Investor'}: ${investor.business_name || investor.name}` : (tx?.type?.replace('_', ' ') || 'Investor Transaction'),
                                          investorId: investor?.id,
                                          txDate: tx?.date
                                        });
                                      }
                                      if (recon.expense_id) {
                                        const exp = expenses.find(e => e.id === recon.expense_id);
                                        const expType = exp ? expenseTypes.find(t => t.id === exp.type_id) : null;
                                        groupLinks.push({
                                          type: 'expense',
                                          label: expType ? `Expense: ${expType.name}` : 'Expense',
                                          href: '/Expenses',
                                          txDate: exp?.date
                                        });
                                      }
                                    }

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
                                          <td className="px-3 py-1.5 min-w-[280px]">
                                            {groupLinks.length === 0 ? (
                                              <span className="text-xs text-slate-400">-</span>
                                            ) : (
                                              <div className="space-y-0.5">
                                                {groupLinks.map((link, idx) => {
                                                  let linkHref = link.href;
                                                  if (link.type === 'loan' && link.loanId) {
                                                    linkHref = `/LoanDetails?id=${link.loanId}`;
                                                  } else if ((link.type === 'investor' || link.type === 'interest') && link.investorId) {
                                                    linkHref = `/InvestorDetails?id=${link.investorId}`;
                                                  }
                                                  const colorClass = link.type === 'loan' ? 'text-blue-600 hover:text-blue-800' :
                                                    link.type === 'investor' ? 'text-purple-600 hover:text-purple-800' :
                                                    link.type === 'expense' ? 'text-orange-600 hover:text-orange-800' :
                                                    'text-emerald-600 hover:text-emerald-800';
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
                                            )}
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
                                            <td className="px-3 py-1.5 min-w-[280px]">
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
                                  // Get reconciliation entries for this bank statement
                                  const recons = reconciliationEntries.filter(r => r.bank_statement_id === entry.id);

                                  // Build links summary (same as original view)
                                  const links = [];
                                  for (const recon of recons) {
                                    if (recon.loan_transaction_id) {
                                      const tx = loanTransactions.find(t => t.id === recon.loan_transaction_id);
                                      const loan = tx ? loans.find(l => l.id === tx.loan_id) : null;
                                      links.push({
                                        type: 'loan',
                                        label: loan ? `${tx?.type || 'Loan'}: ${loan.borrower_name}` : (tx?.type || 'Loan Transaction'),
                                        loanNumber: loan?.loan_number,
                                        loanId: loan?.id,
                                        amount: recon.amount,
                                        txDate: tx?.date
                                      });
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
                                    if (recon.interest_id) {
                                      const interest = investorInterestEntries.find(i => i.id === recon.interest_id);
                                      const investor = interest ? investors.find(i => i.id === interest.investor_id) : null;
                                      links.push({
                                        type: 'interest',
                                        label: investor ? `Interest: ${investor.business_name || investor.name}` : 'Interest',
                                        investorId: investor?.id,
                                        amount: recon.amount,
                                        txDate: interest?.date
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
                                      links.push({
                                        type: 'other_income',
                                        label: 'Other Income',
                                        href: '/OtherIncome',
                                        amount: recon.amount
                                      });
                                    }
                                  }

                                  return (
                                    <tr
                                      key={entry.id}
                                      className={`hover:bg-slate-50 cursor-pointer ${selectedEntries.has(entry.id) ? 'bg-purple-100/50' : ''}`}
                                      onClick={(e) => {
                                        // Don't open details if clicking checkbox
                                        if (e.target.closest('button') || e.target.closest('[role="checkbox"]')) return;
                                        setSelectedEntry(entry);
                                      }}
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
                                      <td className="px-3 py-1.5 min-w-[280px]" onClick={(e) => e.stopPropagation()}>
                                        {/* Check for unreconcilable entries first */}
                                        {entry.is_unreconcilable ? (
                                          <div className="flex items-center gap-1.5">
                                            <Ban className="w-4 h-4 flex-shrink-0 text-slate-500" />
                                            <div className="flex flex-col">
                                              <span className="text-xs font-medium text-slate-600">Unreconcilable</span>
                                              {entry.unreconcilable_group_id && (() => {
                                                const groupCount = bankStatements.filter(s =>
                                                  s.unreconcilable_group_id === entry.unreconcilable_group_id
                                                ).length;
                                                return groupCount > 1 && (
                                                  <span className="text-xs text-slate-400">Grouped ({groupCount})</span>
                                                );
                                              })()}
                                            </div>
                                          </div>
                                        ) : links.length === 0 ? (
                                          // Check if this is an orphaned entry (reconciled but no recon entries, excluding legitimate patterns)
                                          (() => {
                                            const desc = (entry.description || '').toLowerCase();
                                            const isLegitimate = desc.includes('funds returned') ||
                                                                 desc.includes('transfer') ||
                                                                 desc.includes('internal');
                                            if (entry.is_reconciled && recons.length === 0 && !isLegitimate) {
                                              return (
                                                <div className="flex items-center gap-1.5">
                                                  <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-500" />
                                                  <span className="text-xs font-semibold text-red-600">Orphaned - no links</span>
                                                </div>
                                              );
                                            }
                                            return <span className="text-xs text-slate-400">-</span>;
                                          })()
                                        ) : (
                                          <div className="space-y-0.5">
                                            {links.map((link, idx) => {
                                              // Determine the href for the link
                                              let linkHref = link.href;
                                              if (link.type === 'loan' && link.loanId) {
                                                linkHref = `/LoanDetails?id=${link.loanId}`;
                                              } else if ((link.type === 'investor' || link.type === 'interest') && link.investorId) {
                                                linkHref = `/InvestorDetails?id=${link.investorId}`;
                                              }

                                              const colorClass = link.type === 'loan' ? 'text-blue-600 hover:text-blue-800' :
                                                link.type === 'investor' ? 'text-purple-600 hover:text-purple-800' :
                                                link.type === 'interest' ? 'text-amber-600 hover:text-amber-800' :
                                                link.type === 'expense' ? 'text-orange-600 hover:text-orange-800' :
                                                'text-emerald-600 hover:text-emerald-800';

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
                                                  {link.txDate && (
                                                    <span className="text-slate-400 ml-1">
                                                      {format(parseISO(link.txDate), 'dd MMM')}
                                                    </span>
                                                  )}
                                                  {link.amount && Math.abs(link.amount) !== Math.abs(entry.amount) && (
                                                    <span className="text-slate-400 ml-1">{formatCurrency(link.amount)}</span>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-right">
                                        <span className={`text-sm font-medium ${entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
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
                                          <Search className="w-4 h-4" />
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
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="px-2 py-2 w-8">
                        <Checkbox
                          checked={(() => {
                            if (selectedEntries.size === 0) return false;
                            // Check if all visible non-group entries are selected
                            const selectableEntries = displayStatements.filter(s => !s.isGroup);
                            return selectableEntries.length > 0 && selectableEntries.every(s => selectedEntries.has(s.id));
                          })()}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              // Select all visible non-group entries
                              const allIds = displayStatements.filter(s => !s.isGroup).map(s => s.id);
                              setSelectedEntries(new Set(allIds));
                            } else {
                              clearSelection();
                            }
                          }}
                          className="border-slate-300"
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-24">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase w-[30%]">Description</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase min-w-[280px]">
                        <button
                          onClick={() => {
                            if (sortBy === 'linksTo') {
                              setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy('linksTo');
                              setSortDirection('asc');
                            }
                          }}
                          className="flex items-center gap-1 hover:text-slate-700"
                        >
                          Links To
                          {sortBy === 'linksTo' && (
                            sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-28">Amount</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase w-20">Status</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {displayStatements.map((entry) => {
                      // Handle grouped entries
                      if (entry.isGroup) {
                        const isExpanded = expandedBankGroups.has(entry.id);
                        const netAmount = entry.amount;
                        return (
                          <React.Fragment key={entry.id}>
                            {/* Collapsed group row */}
                            <tr className="bg-blue-50/70 hover:bg-blue-100/70">
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
                                  onClick={() => toggleBankGroupExpanded(entry.id)}
                                  className="flex items-center gap-2 text-left group"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-blue-600" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-blue-600" />
                                  )}
                                  <span className="text-sm font-medium text-blue-700">
                                    {entry.groupEntries.length} grouped entries
                                  </span>
                                  <Badge variant="outline" className="text-xs border-blue-300 text-blue-600">
                                    Net
                                  </Badge>
                                </button>
                              </td>
                              <td className="px-3 py-1.5 min-w-[280px]">
                                <span className="text-xs text-slate-500">
                                  Select a transaction to match to this group
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <span className={`font-mono font-bold ${netAmount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {formatCurrency(netAmount)}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <Badge variant="outline" className="border-blue-300 text-blue-700 text-xs">
                                  Group
                                </Badge>
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <div className="flex items-center justify-end gap-0.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openReconcileModal(entry)}
                                    className="h-6 px-2 text-xs"
                                  >
                                    Match
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      // Select all entries in the group and open unreconcilable dialog
                                      setSelectedEntries(new Set(entry.groupEntryIds));
                                      setShowUnreconcilableDialog(true);
                                    }}
                                    className="h-6 w-6 p-0 text-slate-500 hover:text-slate-700"
                                    title="Mark group as unreconcilable"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleUngroupEntries(entry.id)}
                                    className="h-6 w-6 p-0 text-slate-500 hover:text-red-600"
                                    title="Ungroup entries"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {/* Expanded: show individual entries */}
                            {isExpanded && entry.groupEntries.map((subEntry, idx) => (
                              <tr key={subEntry.id} className="bg-blue-50/30">
                                <td className="px-2 py-1"></td>
                                <td className="px-3 py-1 text-xs text-slate-500">
                                  {subEntry.statement_date && isValid(parseISO(subEntry.statement_date))
                                    ? format(parseISO(subEntry.statement_date), 'dd MMM')
                                    : '-'}
                                </td>
                                <td className="px-3 py-1 pl-10">
                                  <p className="text-xs text-slate-600 truncate">{subEntry.description}</p>
                                </td>
                                <td className="px-3 py-1"></td>
                                <td className="px-3 py-1 text-right">
                                  <span className={`text-xs font-mono ${subEntry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {formatCurrency(subEntry.amount)}
                                  </span>
                                </td>
                                <td className="px-3 py-1"></td>
                                <td className="px-3 py-1"></td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      }

                      const suggestion = suggestedMatches.get(entry.id);
                      // Can select unreconciled entries with high-confidence suggestions OR reconciled entries (for un-reconcile)
                      const canSelectForMatch = !entry.is_reconciled && suggestion && suggestion.confidence >= 0.9;
                      // Can also select if unreconciled debit with expense type assigned (for bulk expense creation)
                      const hasExpenseTypeAssigned = entryExpenseTypes.has(entry.id);
                      const canSelectForExpense = !entry.is_reconciled && entry.amount < 0 && hasExpenseTypeAssigned;
                      // Show expense type dropdown for unreconciled debits that either:
                      // 1. Have no suggestion or low-confidence suggestion, OR
                      // 2. Have an expense-type suggestion (from pattern matching) - so user can override
                      // Check: suggestion.type === 'expense', OR suggestion has expense_type_id (pattern with expense), OR expenseTypeSuggestions has entry
                      const isExpenseSuggestion = suggestion?.type === 'expense' || suggestion?.expense_type_id || expenseTypeSuggestions.has(entry.id);
                      const showExpenseTypeDropdown = !entry.is_reconciled && entry.amount < 0 &&
                        (!suggestion || suggestion.confidence < 0.7 || isExpenseSuggestion);
                      // Can also select if marked as other income (for credits)
                      const isMarkedAsOtherIncome = entryOtherIncome.has(entry.id);
                      const canSelectForOtherIncome = !entry.is_reconciled && entry.amount > 0 && isMarkedAsOtherIncome;
                      // Show other income checkbox for unreconciled credits without high-confidence suggestions
                      const showOtherIncomeCheckbox = !entry.is_reconciled && entry.amount > 0 && (!suggestion || suggestion.confidence < 0.7);
                      const canSelect = true; // Show checkbox for all rows - bulk action bar filters by type
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
                          <td className="px-3 py-1.5 overflow-hidden w-[30%]">
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                className="text-left group min-w-0 flex-1 overflow-hidden"
                                onClick={() => suggestion ? openReconcileModal(entry, suggestion) : openReconcileModal(entry)}
                              >
                                <p className="text-sm text-slate-700 truncate group-hover:text-blue-600 group-hover:underline cursor-pointer" title={`${entry.description} (Click to ${suggestion ? 'review' : 'reconcile'})`}>
                                  {entry.description || '-'}
                                </p>
                              </button>
                            </div>
                            <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                              <span className="text-xs text-slate-400 shrink-0">{entry.bank_source}</span>
                            </div>
                          </td>
                          {/* Links To column */}
                          <td className="px-3 py-1.5 min-w-[280px]">
                            {(() => {
                              // Check for unreconcilable entries first
                              if (entry.is_unreconcilable) {
                                const groupCount = entry.unreconcilable_group_id
                                  ? bankStatements.filter(s => s.unreconcilable_group_id === entry.unreconcilable_group_id).length
                                  : 0;
                                return (
                                  <div className="flex items-center gap-1.5">
                                    <Ban className="w-4 h-4 flex-shrink-0 text-slate-500" />
                                    <div className="flex flex-col">
                                      <span className="text-xs font-medium text-slate-600">Unreconcilable</span>
                                      {groupCount > 1 && (
                                        <span className="text-xs text-slate-400">Grouped ({groupCount})</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              }

                              // For reconciled entries, show what it was reconciled to
                              if (entry.is_reconciled) {
                                // Get reconciliation entries for this bank statement
                                const recons = reconciliationEntries.filter(r => r.bank_statement_id === entry.id);
                                if (recons.length === 0) {
                                  // Check if this is a legitimate standalone reconciliation
                                  const desc = (entry.description || '').toLowerCase();
                                  const isLegitimate = desc.includes('funds returned') ||
                                                       desc.includes('transfer') ||
                                                       desc.includes('internal');
                                  if (!isLegitimate) {
                                    return (
                                      <div className="flex items-center gap-1.5">
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-500" />
                                        <span className="text-xs font-semibold text-red-600">Orphaned - no links</span>
                                      </div>
                                    );
                                  }
                                  return <span className="text-xs text-slate-400">-</span>;
                                }

                                // Build a summary of what it's linked to
                                const links = [];
                                for (const recon of recons) {
                                  if (recon.loan_transaction_id) {
                                    const tx = loanTransactions.find(t => t.id === recon.loan_transaction_id);
                                    if (tx) {
                                      const loan = loans.find(l => l.id === tx.loan_id);
                                      links.push({
                                        type: 'loan',
                                        label: loan ? `${tx.type || 'Loan'}: ${loan.borrower_name}` : (tx.type || 'Loan Transaction'),
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
                                    if (tx) {
                                      const investor = investors.find(i => i.id === tx.investor_id);
                                      links.push({
                                        type: 'investor',
                                        label: investor ? `${tx.type?.replace('_', ' ') || 'Investor'}: ${investor.business_name || investor.name}` : (tx.type?.replace('_', ' ') || 'Investor Transaction'),
                                        investorId: investor?.id,
                                        amount: recon.amount,
                                        txDate: tx.date
                                      });
                                    } else {
                                      links.push({ type: 'broken', label: 'Deleted Investor Transaction', isBroken: true });
                                    }
                                  }
                                  if (recon.interest_id) {
                                    const interest = investorInterestEntries.find(i => i.id === recon.interest_id);
                                    if (interest) {
                                      const investor = investors.find(i => i.id === interest.investor_id);
                                      links.push({
                                        type: 'interest',
                                        label: investor ? `Interest: ${investor.business_name || investor.name}` : 'Interest',
                                        investorId: investor?.id,
                                        amount: recon.amount,
                                        txDate: interest.date
                                      });
                                    } else {
                                      links.push({ type: 'broken', label: 'Deleted Interest Entry', isBroken: true });
                                    }
                                  }
                                  if (recon.expense_id) {
                                    const exp = expenses.find(e => e.id === recon.expense_id);
                                    if (exp) {
                                      const expType = expenseTypes.find(t => t.id === exp.type_id);
                                      links.push({
                                        type: 'expense',
                                        label: expType ? `Expense: ${expType.name}` : 'Expense',
                                        amount: recon.amount,
                                        txDate: exp.date
                                      });
                                    } else {
                                      links.push({ type: 'broken', label: 'Deleted Expense', isBroken: true });
                                    }
                                  }
                                  if (recon.other_income_id) {
                                    const otherInc = otherIncome.find(o => o.id === recon.other_income_id);
                                    if (otherInc) {
                                      links.push({
                                        type: 'other_income',
                                        label: otherInc.description ? `Other Income: ${otherInc.description}` : 'Other Income',
                                        amount: recon.amount,
                                        txDate: otherInc.date
                                      });
                                    } else {
                                      links.push({ type: 'broken', label: 'Deleted Other Income', isBroken: true });
                                    }
                                  }
                                }

                                if (links.length === 0) {
                                  return <span className="text-xs text-slate-400">-</span>;
                                }

                                return (
                                  <div className="space-y-0.5">
                                    {links.map((link, idx) => {
                                      // Determine the href for the link
                                      let linkHref = null;
                                      if (link.type === 'loan' && link.loanId) {
                                        linkHref = `/LoanDetails?id=${link.loanId}`;
                                      } else if ((link.type === 'investor' || link.type === 'interest') && link.investorId) {
                                        linkHref = `/InvestorDetails?id=${link.investorId}`;
                                      } else if (link.type === 'expense') {
                                        linkHref = '/Expenses';
                                      } else if (link.type === 'other_income') {
                                        linkHref = '/OtherIncome';
                                      }

                                      // Handle broken links
                                      if (link.isBroken) {
                                        return (
                                          <div key={idx} className="text-xs truncate text-red-600 flex items-center gap-1" title="Linked entity was deleted - un-reconcile to re-match">
                                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                            <span className="font-medium">{link.label}</span>
                                          </div>
                                        );
                                      }

                                      const colorClass = link.type === 'loan' ? 'text-blue-600 hover:text-blue-800' :
                                        link.type === 'investor' ? 'text-purple-600 hover:text-purple-800' :
                                        link.type === 'interest' ? 'text-amber-600 hover:text-amber-800' :
                                        link.type === 'expense' ? 'text-orange-600 hover:text-orange-800' :
                                        'text-emerald-600 hover:text-emerald-800';

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
                                          {link.txDate && (
                                            <span className="text-slate-400 ml-1">
                                              {format(parseISO(link.txDate), 'dd MMM')}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              }

                              // For unreconciled entries with suggestions
                              if (suggestion && !entry.is_reconciled) {
                                if (isMatchType(suggestion.matchMode)) {
                                  // Link to existing transaction
                                  let linkText = suggestion.existingTransaction?.type || suggestion.type?.replace('_', ' ') || '';
                                  if (suggestion.existingLoan?.borrower_name) {
                                    linkText += `: ${suggestion.existingLoan.borrower_name}`;
                                  } else if (suggestion.loan?.borrower_name) {
                                    // For grouped_disbursement matches
                                    linkText += `: ${suggestion.loan.borrower_name}`;
                                  } else if (suggestion.loan_id || suggestion.existingTransaction?.loan_id) {
                                    // Look up loan by ID for individual loan transaction matches
                                    const loanId = suggestion.loan_id || suggestion.existingTransaction?.loan_id;
                                    const loan = loans.find(l => l.id === loanId);
                                    if (loan?.borrower_name) {
                                      linkText += `: ${loan.borrower_name}`;
                                    }
                                  } else if (suggestion.existingInvestor?.name || suggestion.existingInvestor?.business_name) {
                                    linkText += `: ${suggestion.existingInvestor.business_name || suggestion.existingInvestor.name}`;
                                  } else if (suggestion.existingExpense) {
                                    const expType = expenseTypes.find(t => t.id === suggestion.existingExpense.type_id);
                                    linkText = `Expense: ${expType?.name || 'Expense'}`;
                                  } else if (suggestion.existingInterest) {
                                    const investor = investors.find(i => i.id === suggestion.existingInterest.investor_id);
                                    linkText = `Interest: ${investor?.business_name || investor?.name || 'Unknown'}`;
                                  } else if (suggestion.investor_id) {
                                    const investor = investors.find(i => i.id === suggestion.investor_id);
                                    linkText += investor ? `: ${investor.business_name || investor.name}` : '';
                                  }

                                  // For grouped matches, show count
                                  if (suggestion.matchMode === 'match_group') {
                                    const txCount = (suggestion.existingTransactions?.length || 0) + (suggestion.existingInterestEntries?.length || 0);
                                    linkText = `${txCount} items: ${linkText}`;
                                  } else if (suggestion.matchMode === 'grouped_disbursement') {
                                    linkText = `${suggestion.groupedEntries?.length || 0} debits → ${suggestion.loan?.loan_number || 'Unknown'}`;
                                  }

                                  // Get match explanation for amount/date
                                  const matchTx = suggestion.existingTransaction || suggestion.existingExpense || suggestion.existingInterest;
                                  let matchExplanation = null;
                                  if (matchTx) {
                                    // For grouped matches, use combined amount from all grouped entries
                                    if ((suggestion.matchMode === 'grouped_disbursement' || suggestion.matchMode === 'grouped_investor') && suggestion.groupedEntries) {
                                      const groupedTotal = suggestion.groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
                                      const syntheticEntry = { amount: groupedTotal, statement_date: entry.statement_date };
                                      matchExplanation = getMatchExplanation(syntheticEntry, matchTx, matchTx.date ? 'date' : 'statement_date');
                                    } else {
                                      matchExplanation = getMatchExplanation(entry, matchTx, matchTx.date ? 'date' : 'statement_date');
                                    }
                                  }

                                  // For grouped matches, show the other bank entries in the group
                                  const otherGroupedEntries = (suggestion.matchMode === 'grouped_disbursement' || suggestion.matchMode === 'grouped_investor') && suggestion.groupedEntries
                                    ? suggestion.groupedEntries.filter(e => e.id !== entry.id)
                                    : [];

                                  return (
                                    <div className="space-y-0.5">
                                      <div className="text-xs text-blue-600 font-medium truncate" title={linkText}>
                                        → {linkText}
                                      </div>
                                      {matchExplanation ? (
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className={`${matchExplanation.amount.color === 'emerald' ? 'text-emerald-600' : matchExplanation.amount.color === 'amber' ? 'text-amber-600' : 'text-red-500'}`}>
                                            {matchExplanation.amount.text}
                                          </span>
                                          <span className="text-slate-300">•</span>
                                          <span className={`${matchExplanation.date.color === 'emerald' ? 'text-emerald-600' : matchExplanation.date.color === 'amber' ? 'text-amber-600' : 'text-slate-400'}`}>
                                            {matchExplanation.date.text}
                                          </span>
                                        </div>
                                      ) : (
                                        <div className="text-xs text-slate-400 truncate" title={suggestion.reason}>
                                          {suggestion.reason}
                                        </div>
                                      )}
                                      {/* Show other bank entries in grouped disbursement */}
                                      {otherGroupedEntries.length > 0 && (
                                        <div className="text-xs text-purple-600 truncate" title={otherGroupedEntries.map(e => `${format(parseISO(e.statement_date), 'dd/MM')}: ${formatCurrency(Math.abs(e.amount))}`).join(', ')}>
                                          + {otherGroupedEntries.map(e => formatCurrency(Math.abs(e.amount))).join(' + ')} = {formatCurrency(suggestion.groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                } else {
                                  // Will create new transaction
                                  let createText = suggestion.type === 'expense' ? 'Expense' : (suggestion.type?.replace('_', ' ') || 'Transaction');
                                  if (suggestion.loan_id) {
                                    const loan = loans.find(l => l.id === suggestion.loan_id);
                                    createText += loan ? `: ${loan.borrower_name}` : '';
                                  } else if (suggestion.investor_id) {
                                    const investor = investors.find(i => i.id === suggestion.investor_id);
                                    createText += investor ? `: ${investor.business_name || investor.name}` : '';
                                  }

                                  // Check if this entry is part of a grouped suggestion elsewhere
                                  const groupedInfoCreate = entriesInGroupedSuggestions.get(entry.id);
                                  const isPartOfGroupCreate = groupedInfoCreate && groupedInfoCreate.primaryEntryId !== entry.id;

                                  // For expense suggestions with expense_type_id (pattern matches), show dropdown to allow override
                                  const isExpenseWithType = suggestion.expense_type_id || suggestion.type === 'expense';
                                  const expenseSuggestionForCreate = expenseTypeSuggestions.get(entry.id);
                                  // Pre-select the pattern's expense type if not already set by user
                                  const currentExpenseType = entryExpenseTypes.get(entry.id) || suggestion.expense_type_id || '';

                                  if (isExpenseWithType && entry.amount < 0) {
                                    return (
                                      <div className="space-y-0.5">
                                        <div className="flex items-center gap-1">
                                          <span className="text-xs text-amber-600 font-medium">+ Expense</span>
                                          <ExpenseTypeCombobox
                                            expenseTypes={expenseTypes}
                                            selectedTypeId={currentExpenseType}
                                            expenseSuggestion={expenseSuggestionForCreate || (suggestion.expense_type_id ? { expenseTypeId: suggestion.expense_type_id, reason: suggestion.reason } : null)}
                                            onSelect={(typeId) => setEntryExpenseType(entry.id, typeId)}
                                          />
                                        </div>
                                        <div className="text-xs text-slate-400 truncate" title={suggestion.reason}>
                                          {suggestion.reason}
                                        </div>
                                        {/* Warning if part of grouped suggestion */}
                                        {isPartOfGroupCreate && groupedInfoCreate.groupType === 'disbursement' && (
                                          <div
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-red-700 text-xs font-medium"
                                            title={`Part of grouped disbursement: ${groupedInfoCreate.suggestion.groupedEntries?.map(e => formatCurrency(Math.abs(e.amount))).join(' + ')} → ${groupedInfoCreate.suggestion.loan?.borrower_name || 'Unknown'}`}
                                          >
                                            <Link2 className="w-3 h-3 flex-shrink-0" />
                                            Combined payment
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }

                                  return (
                                    <div className="space-y-0.5">
                                      <div className="text-xs text-amber-600 font-medium truncate" title={createText}>
                                        + {createText}
                                      </div>
                                      <div className="text-xs text-slate-400 truncate" title={suggestion.reason}>
                                        {suggestion.reason}
                                      </div>
                                      {/* Warning if part of grouped suggestion */}
                                      {isPartOfGroupCreate && groupedInfoCreate.groupType === 'disbursement' && (
                                        <div
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-red-700 text-xs font-medium"
                                          title={`Part of grouped disbursement: ${groupedInfoCreate.suggestion.groupedEntries?.map(e => formatCurrency(Math.abs(e.amount))).join(' + ')} → ${groupedInfoCreate.suggestion.loan?.borrower_name || 'Unknown'}`}
                                        >
                                          <Link2 className="w-3 h-3 flex-shrink-0" />
                                          Combined payment
                                        </div>
                                      )}
                                    </div>
                                  );
                                }
                              }

                              // Check if this entry is part of a grouped suggestion (e.g., grouped disbursement)
                              const groupedInfo = entriesInGroupedSuggestions.get(entry.id);
                              const isPartOfGroupedSuggestion = groupedInfo && groupedInfo.primaryEntryId !== entry.id;

                              // For unreconciled debits without high-confidence suggestion, show expense type selector
                              if (showExpenseTypeDropdown) {
                                const expenseSuggestion = expenseTypeSuggestions.get(entry.id);
                                const currentValue = entryExpenseTypes.get(entry.id) || '';

                                return (
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-amber-600 font-medium">+ Expense</span>
                                      <ExpenseTypeCombobox
                                        expenseTypes={expenseTypes}
                                        selectedTypeId={currentValue}
                                        expenseSuggestion={expenseSuggestion}
                                        onSelect={(typeId) => setEntryExpenseType(entry.id, typeId)}
                                      />
                                    </div>
                                    {/* Warning if part of grouped suggestion */}
                                    {isPartOfGroupedSuggestion && groupedInfo.groupType === 'disbursement' && (
                                      <div
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-red-700 text-xs font-medium"
                                        title={`Part of grouped disbursement: ${groupedInfo.suggestion.groupedEntries?.map(e => formatCurrency(Math.abs(e.amount))).join(' + ')} → ${groupedInfo.suggestion.loan?.borrower_name || 'Unknown'}`}
                                      >
                                        <Link2 className="w-3 h-3 flex-shrink-0" />
                                        Combined payment
                                      </div>
                                    )}
                                  </div>
                                );
                              }

                              // For unreconciled credits without high-confidence suggestion, show other income toggle
                              if (showOtherIncomeCheckbox) {
                                return (
                                  <div className="space-y-0.5">
                                    <button
                                      onClick={() => toggleEntryOtherIncome(entry.id, !entryOtherIncome.has(entry.id))}
                                      className="flex items-center gap-1 text-xs hover:underline cursor-pointer"
                                    >
                                      {entryOtherIncome.has(entry.id) ? (
                                        <>
                                          <Coins className="w-3 h-3 text-emerald-600" />
                                          <span className="text-emerald-700">Other Income</span>
                                        </>
                                      ) : (
                                        <span className="text-slate-400">+ income</span>
                                      )}
                                    </button>
                                    {/* Warning if part of grouped suggestion */}
                                    {isPartOfGroupedSuggestion && groupedInfo.groupType === 'disbursement' && (
                                      <div
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-red-700 text-xs font-medium"
                                        title={`Part of grouped disbursement: ${groupedInfo.suggestion.groupedEntries?.map(e => formatCurrency(Math.abs(e.amount))).join(' + ')} → ${groupedInfo.suggestion.loan?.borrower_name || 'Unknown'}`}
                                      >
                                        <Link2 className="w-3 h-3 flex-shrink-0" />
                                        Combined payment
                                      </div>
                                    )}
                                  </div>
                                );
                              }

                              return <span className="text-xs text-slate-400">-</span>;
                            })()}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <span className={`text-sm font-medium ${entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {entry.amount > 0 ? '+' : ''}{formatCurrency(entry.amount)}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              {entry.is_reconciled ? (
                                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 py-0 text-xs">
                                  <Check className="w-3 h-3 mr-1" />
                                  Reconciled
                                </Badge>
                              ) : activeTab === 'match' && suggestion ? (
                                <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 py-0 text-xs">
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  {Math.round(suggestion.confidence * 100)}%
                                </Badge>
                              ) : activeTab === 'create' && suggestion ? (
                                <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 py-0 text-xs">
                                  Suggested
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-slate-500 border-slate-300 py-0 text-xs">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  Review
                                </Badge>
                              )}
                              {/* Show conflict warning if multiple bank entries want the same transaction */}
                              {matchConflicts.has(entry.id) && (
                                <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 py-0 text-xs" title="Multiple bank entries are trying to match to the same transaction">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  {matchConflicts.get(entry.id).size} conflict{matchConflicts.get(entry.id).size > 1 ? 's' : ''}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex justify-end gap-0.5">
                              {!entry.is_reconciled ? (
                                <>
                                  {/* Match tab: Show dismiss button to move to Create tab */}
                                  {activeTab === 'match' && suggestion && !dismissedSuggestions.has(entry.id) && (
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      onClick={() => dismissSuggestion(entry.id)}
                                      className="h-7 w-7 border-slate-300 text-slate-500 hover:bg-slate-50"
                                      title="Dismiss match - move to Create tab"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  {/* Create tab: Show restore button for dismissed entries */}
                                  {activeTab === 'create' && dismissedSuggestions.has(entry.id) && (
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      onClick={() => restoreSuggestion(entry.id)}
                                      className="h-7 w-7 border-purple-300 text-purple-600 hover:bg-purple-50"
                                      title="Restore match suggestion"
                                    >
                                      <Undo2 className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  {suggestion && (
                                    <>
                                      {suggestion.confidence >= 0.9 && (
                                        <Button
                                          size="icon"
                                          onClick={() => handleQuickMatch(entry, suggestion)}
                                          className="bg-purple-600 hover:bg-purple-700 h-7 w-7"
                                          title={activeTab === 'match'
                                            ? `Quick link to existing transaction`
                                            : `Quick create new transaction`}
                                        >
                                          <Zap className="w-3.5 h-3.5" />
                                        </Button>
                                      )}
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        onClick={() => openReconcileModal(entry, suggestion)}
                                        className={`h-7 w-7 ${activeTab === 'match' ? 'border-blue-300 text-blue-700 hover:bg-blue-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                                        title={activeTab === 'match'
                                          ? "Review & link to existing transaction"
                                          : "Review & create new transaction"}
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

        {/* Reconciliation Panel */}
        <Sheet open={!!selectedEntry} onOpenChange={(open) => { if (!open) { setSelectedEntry(null); setReviewingSuggestion(null); setSelectedOffsetEntries([]); setOffsetNotes(''); setSelectedExistingTxs([]); } }}>
          <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>
                {selectedEntry?.is_reconciled ? 'View Reconciled Entry' : 'Reconcile Bank Entry'}
              </SheetTitle>
              <SheetDescription>
                {selectedEntry?.is_reconciled
                  ? 'This bank entry has been reconciled to the following transaction(s)'
                  : 'Match this bank entry to a system transaction or create a new one'}
              </SheetDescription>
            </SheetHeader>

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
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>
                            Marked on {selectedEntry.unreconcilable_at && isValid(parseISO(selectedEntry.unreconcilable_at))
                              ? format(parseISO(selectedEntry.unreconcilable_at), 'dd MMM yyyy HH:mm')
                              : '-'}
                          </span>
                          {selectedEntry.unreconcilable_group_id && (() => {
                            const groupCount = bankStatements.filter(s =>
                              s.unreconcilable_group_id === selectedEntry.unreconcilable_group_id
                            ).length;
                            return groupCount > 1 && (
                              <span className="bg-slate-200 px-2 py-0.5 rounded">
                                Part of group ({groupCount} entries)
                              </span>
                            );
                          })()}
                        </div>

                        {/* Show other entries in the group */}
                        {selectedEntry.unreconcilable_group_id && (() => {
                          const groupEntries = bankStatements.filter(s =>
                            s.unreconcilable_group_id === selectedEntry.unreconcilable_group_id &&
                            s.id !== selectedEntry.id
                          );
                          return groupEntries.length > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs text-slate-500 uppercase mb-2">Other entries in this group</p>
                              <div className="space-y-1">
                                {groupEntries.map(entry => (
                                  <div key={entry.id} className="flex items-center justify-between text-xs bg-white p-2 rounded border">
                                    <span className="truncate flex-1 text-slate-600">{entry.description?.substring(0, 40)}</span>
                                    <span className={entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}>
                                      {formatCurrency(entry.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUndoUnreconcilable(selectedEntry)}
                          className="w-full mt-2"
                        >
                          <Undo2 className="w-4 h-4 mr-2" />
                          {selectedEntry.unreconcilable_group_id && bankStatements.filter(s =>
                            s.unreconcilable_group_id === selectedEntry.unreconcilable_group_id
                          ).length > 1
                            ? 'Undo All in Group'
                            : 'Undo & Return to Unreconciled'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Linked Transactions - only show for non-unreconcilable entries */}
                  {!selectedEntry.is_unreconcilable && (
                  <div>
                    {(() => {
                      const brokenLinks = reconciliationDetails.filter(d => d.isBrokenLink);
                      const validLinks = reconciliationDetails.filter(d => !d.isBrokenLink);
                      return (
                        <>
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
                              <p className="text-xs text-red-600 mb-2">
                                This bank entry was reconciled to {brokenLinks.map(b => b.entityType.toLowerCase()).join(', ')} that no longer exist{brokenLinks.length === 1 ? 's' : ''}.
                                Un-reconcile to re-match this entry.
                              </p>
                              {brokenLinks.map((broken, idx) => (
                                <div key={idx} className="text-xs text-red-500 font-mono">
                                  {broken.entityType}: {broken.brokenEntityId?.slice(0, 8)}...
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div className="space-y-3">
                      {reconciliationDetails.filter(d => !d.isBrokenLink).map((detail, idx) => (
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
                  )}

                  {/* Reconciliation metadata */}
                  {selectedEntry.reconciled_at && !selectedEntry.is_unreconcilable && (
                    <p className="text-xs text-slate-400 text-center">
                      Reconciled on {format(parseISO(selectedEntry.reconciled_at), 'dd MMM yyyy HH:mm')}
                    </p>
                  )}

                  {/* Action Buttons - different for unreconcilable entries */}
                  {!selectedEntry.is_unreconcilable && (
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
                  )}
                </div>
              );
            })()}

            {selectedEntry && !selectedEntry.is_reconciled && (
              /* UNIFIED RECONCILIATION VIEW - Side by side layout */
              <div className="space-y-4">
                {/* Suggestion badge with match explanation */}
                {reviewingSuggestion && (() => {
                  // Get match explanation - use selectedExistingTxs if user has changed selection, otherwise use suggestion's transaction
                  // For match_group with combined transactions, calculate the combined total
                  let explanation = null;

                  if (reviewingSuggestion.matchMode === 'match_group' &&
                      (reviewingSuggestion.existingTransactions || reviewingSuggestion.existingInterestEntries)) {
                    // Calculate combined total for grouped matches
                    const capitalTxs = reviewingSuggestion.existingTransactions || [];
                    const interestEntries = reviewingSuggestion.existingInterestEntries || [];
                    const capitalTotal = capitalTxs.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
                    const interestTotal = interestEntries.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
                    const combinedTotal = capitalTotal + interestTotal;

                    // Get date from first transaction for comparison
                    const firstTx = capitalTxs[0] || interestEntries[0];
                    const txDate = firstTx?.date;

                    // Create a synthetic transaction object with combined amount for getMatchExplanation
                    const syntheticTx = { amount: combinedTotal, date: txDate };
                    explanation = selectedEntry ? getMatchExplanation(selectedEntry, syntheticTx, 'date') : null;
                  } else if (reviewingSuggestion.matchMode === 'grouped_disbursement' && reviewingSuggestion.groupedEntries) {
                    // For grouped disbursement: multiple bank entries → single transaction
                    // Create a synthetic bank entry with the combined amount from all grouped entries
                    const groupedTotal = reviewingSuggestion.groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
                    const syntheticBankEntry = {
                      amount: groupedTotal,
                      statement_date: selectedEntry?.statement_date
                    };
                    const txToCompare = reviewingSuggestion.existingTransaction;
                    explanation = txToCompare
                      ? getMatchExplanation(syntheticBankEntry, txToCompare, 'date')
                      : null;
                  } else {
                    const txToCompare = (selectedExistingTxs.length > 0 ? selectedExistingTxs[0] : null) ||
                      reviewingSuggestion.existingTransaction ||
                      (reviewingSuggestion.existingTransactions?.[0]);
                    explanation = txToCompare && selectedEntry
                      ? getMatchExplanation(selectedEntry, txToCompare, 'date')
                      : null;
                  }

                  // Determine if this is a name-based suggestion (for create mode)
                  const isNameBasedSuggestion = reviewingSuggestion.matchMode === 'create' &&
                    (reviewingSuggestion.reason?.includes('name:') || reviewingSuggestion.reason?.includes('Investor name') || reviewingSuggestion.reason?.includes('Borrower'));

                  return (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge className={isMatchType(reviewingSuggestion.matchMode) ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-amber-100 text-amber-700 border-amber-300'}>
                          <Sparkles className="w-3 h-3 mr-1" />
                          {Math.round(reviewingSuggestion.confidence * 100)}% confidence
                        </Badge>
                        <span className="text-xs text-slate-500">{reviewingSuggestion.reason}</span>
                      </div>
                      {/* For grouped disbursement matches, show all entries in the group */}
                      {reviewingSuggestion.matchMode === 'grouped_disbursement' && reviewingSuggestion.groupedEntries && (
                        <div className="text-xs text-blue-600 border-t border-slate-200 pt-2">
                          <div className="font-medium mb-1">Bank entries in this group:</div>
                          {reviewingSuggestion.groupedEntries.map((e, idx) => (
                            <div key={e.id} className="flex justify-between text-slate-600">
                              <span>{format(parseISO(e.statement_date), 'dd/MM/yyyy')}: {e.description?.substring(0, 30)}...</span>
                              <span className="font-medium">{formatCurrency(Math.abs(e.amount))}</span>
                            </div>
                          ))}
                          <div className="flex justify-between font-medium text-blue-700 border-t border-slate-300 pt-1 mt-1">
                            <span>Total:</span>
                            <span>{formatCurrency(reviewingSuggestion.groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0))}</span>
                          </div>
                        </div>
                      )}
                      {/* For grouped investor matches, show all bank entries in the group */}
                      {reviewingSuggestion.matchMode === 'grouped_investor' && reviewingSuggestion.groupedEntries && (
                        <div className="text-xs text-amber-600 border-t border-slate-200 pt-2">
                          <div className="font-medium mb-1">Bank entries matching investor transaction:</div>
                          {reviewingSuggestion.groupedEntries.map((e, idx) => (
                            <div key={e.id} className="flex justify-between text-slate-600">
                              <span>{format(parseISO(e.statement_date), 'dd/MM/yyyy')}: {e.description?.substring(0, 30)}...</span>
                              <span className="font-medium">{formatCurrency(Math.abs(e.amount))}</span>
                            </div>
                          ))}
                          <div className="flex justify-between font-medium text-amber-700 border-t border-slate-300 pt-1 mt-1">
                            <span>Total:</span>
                            <span>{formatCurrency(reviewingSuggestion.groupedEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0))}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            → Matches investor: {reviewingSuggestion.investor?.business_name || reviewingSuggestion.investor?.name || 'Unknown'}
                          </div>
                        </div>
                      )}
                      {/* Match explanation breakdown - for existing transaction matches */}
                      {explanation && isMatchType(reviewingSuggestion.matchMode) && (
                        <div className="flex items-center gap-4 text-xs pt-1 border-t border-slate-200">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500">Amount:</span>
                            <span className={`font-medium ${
                              explanation.amount.color === 'emerald' ? 'text-emerald-600' :
                              explanation.amount.color === 'amber' ? 'text-amber-600' : 'text-red-600'
                            }`}>
                              {explanation.amount.icon === 'check' && <Check className="w-3 h-3 inline mr-0.5" />}
                              {explanation.amount.text}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500">Date:</span>
                            <span className={`font-medium ${
                              explanation.date.color === 'emerald' ? 'text-emerald-600' :
                              explanation.date.color === 'amber' ? 'text-amber-600' :
                              explanation.date.color === 'red' ? 'text-red-600' : 'text-slate-500'
                            }`}>
                              {explanation.date.icon === 'check' && <Check className="w-3 h-3 inline mr-0.5" />}
                              {explanation.date.icon === 'approx' && <span className="inline mr-0.5">~</span>}
                              {explanation.date.icon === 'warning' && <AlertCircle className="w-3 h-3 inline mr-0.5" />}
                              {explanation.date.icon === 'x' && <X className="w-3 h-3 inline mr-0.5" />}
                              {explanation.date.text}
                            </span>
                          </div>
                        </div>
                      )}
                      {/* Explanation for name-based create suggestions */}
                      {isNameBasedSuggestion && (
                        <div className="text-xs pt-1 border-t border-slate-200 text-slate-600">
                          <span className="text-amber-600 font-medium">Name match</span> - Found entity name in bank description. Will create a new transaction.
                        </div>
                      )}
                      {/* Warning if this entry is part of a grouped suggestion elsewhere */}
                      {(() => {
                        const groupedInfoDialog = entriesInGroupedSuggestions.get(selectedEntry?.id);
                        const isPartOfGroup = groupedInfoDialog && groupedInfoDialog.primaryEntryId !== selectedEntry?.id;
                        if (!isPartOfGroup || groupedInfoDialog?.groupType !== 'disbursement') return null;

                        const groupedSuggestion = groupedInfoDialog.suggestion;
                        return (
                          <div className="pt-2 border-t border-red-200 mt-2 bg-red-50 rounded-lg p-2">
                            <div className="flex items-start gap-2 text-red-700">
                              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              <div className="text-xs">
                                <div className="font-medium mb-1">Part of combined payment</div>
                                <div className="text-red-600">
                                  This entry is suggested as part of a grouped disbursement:
                                </div>
                                <div className="text-red-600 mt-1">
                                  {groupedSuggestion.groupedEntries?.map(e => formatCurrency(Math.abs(e.amount))).join(' + ')} → {groupedSuggestion.loan?.borrower_name || 'Unknown'}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      {/* Warning if this entry is part of a grouped investor suggestion elsewhere */}
                      {(() => {
                        const groupedInfoDialog = entriesInGroupedSuggestions.get(selectedEntry?.id);
                        const isPartOfGroup = groupedInfoDialog && groupedInfoDialog.primaryEntryId !== selectedEntry?.id;
                        if (!isPartOfGroup || groupedInfoDialog?.groupType !== 'investor') return null;

                        const groupedSuggestion = groupedInfoDialog.suggestion;
                        return (
                          <div className="pt-2 border-t border-amber-200 mt-2 bg-amber-50 rounded-lg p-2">
                            <div className="flex items-start gap-2 text-amber-700">
                              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              <div className="text-xs">
                                <div className="font-medium mb-1">Part of combined investor deposit</div>
                                <div className="text-amber-600">
                                  This entry is suggested as part of a grouped investor transaction:
                                </div>
                                <div className="text-amber-600 mt-1">
                                  {groupedSuggestion.groupedEntries?.map(e => formatCurrency(Math.abs(e.amount))).join(' + ')} → {groupedSuggestion.investor?.business_name || groupedSuggestion.investor?.name || 'Unknown'}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* Two column layout */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Left: Bank Statement */}
                  <div className="bg-slate-100 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-3 font-medium">Bank Statement</p>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-slate-400 uppercase">Date</p>
                        <p className="text-sm font-medium text-slate-700">
                          {selectedEntry.statement_date && isValid(parseISO(selectedEntry.statement_date))
                            ? format(parseISO(selectedEntry.statement_date), 'dd MMM yyyy')
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 uppercase">Amount</p>
                        <p className={`text-lg font-bold ${selectedEntry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
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
                      <div>
                        <p className="text-xs text-slate-400 uppercase">Source</p>
                        <p className="text-sm text-slate-500">{selectedEntry.bank_source}</p>
                      </div>
                    </div>
                  </div>

                  {/* Right: Transaction Details */}
                  <div className={`${matchMode === 'match' ? 'bg-blue-50 border-blue-200' : 'bg-emerald-50 border-emerald-200'} border rounded-lg p-4`}>
                    <p className={`text-xs ${matchMode === 'match' ? 'text-blue-600' : 'text-emerald-600'} uppercase tracking-wide mb-3 font-medium`}>
                      {matchMode === 'match' ? 'Match to Existing' : 'Create Transaction'}
                    </p>

                    {/* Grouped Match Summary - show when we have multiple transactions to link */}
                    {matchMode === 'match' && reviewingSuggestion?.matchMode === 'match_group' && (reviewingSuggestion.existingTransactions || reviewingSuggestion.existingInterestEntries) && (
                      <div className="mb-4 space-y-2">
                        {(() => {
                          const capitalTxs = reviewingSuggestion.existingTransactions || [];
                          const interestEntries = reviewingSuggestion.existingInterestEntries || [];
                          const totalItems = capitalTxs.length + interestEntries.length;
                          const isLoanType = reviewingSuggestion.type === 'loan_repayment' || reviewingSuggestion.type === 'loan_disbursement';
                          const isInvestorType = reviewingSuggestion.type === 'investor_withdrawal' || reviewingSuggestion.type === 'investor_credit' || reviewingSuggestion.type === 'interest_withdrawal';

                          // Calculate totals
                          const capitalTotal = capitalTxs.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
                          const interestTotal = interestEntries.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
                          const grandTotal = capitalTotal + interestTotal;

                          return (
                            <>
                              <p className="text-sm font-medium text-blue-800">
                                Linking to {totalItems} existing {isLoanType ? 'repayment' : 'transaction'}{totalItems > 1 ? 's' : ''}:
                              </p>
                              <div className="bg-white rounded-lg border border-blue-200 divide-y divide-blue-100 max-h-48 overflow-y-auto">
                                {/* Capital transactions (loans or investor capital) */}
                                {capitalTxs.map((tx, idx) => {
                                  if (isLoanType) {
                                    const loan = loans.find(l => l.id === tx.loan_id);
                                    const borrowerName = loan ? getBorrowerName(loan.borrower_id) : 'Unknown';
                                    return (
                                      <div key={tx.id || `tx-${idx}`} className="p-2 flex justify-between items-center text-sm">
                                        <div className="flex-1 min-w-0 mr-2">
                                          <p className="font-medium text-slate-700">{loan?.loan_number || 'Unknown Loan'}</p>
                                          <p className="text-xs text-slate-500">{borrowerName}</p>
                                        </div>
                                        <p className="font-mono font-semibold text-emerald-600 whitespace-nowrap">{formatCurrency(tx.amount)}</p>
                                      </div>
                                    );
                                  } else {
                                    // Investor capital transaction
                                    const investor = investors.find(i => i.id === tx.investor_id);
                                    const investorName = investor?.business_name || investor?.name || 'Unknown';
                                    return (
                                      <div key={tx.id || `tx-${idx}`} className="p-2 flex justify-between items-center text-sm">
                                        <div className="flex-1 min-w-0 mr-2">
                                          <p className="font-medium text-slate-700">{tx.type?.replace('_', ' ') || 'Capital'}</p>
                                          <p className="text-xs text-slate-500">{investorName}</p>
                                        </div>
                                        <p className="font-mono font-semibold text-red-600 whitespace-nowrap">{formatCurrency(tx.amount)}</p>
                                      </div>
                                    );
                                  }
                                })}
                                {/* Interest entries */}
                                {interestEntries.map((interest, idx) => {
                                  const investor = investors.find(i => i.id === interest.investor_id);
                                  const investorName = investor?.business_name || investor?.name || 'Unknown';
                                  return (
                                    <div key={interest.id || `int-${idx}`} className="p-2 flex justify-between items-center text-sm">
                                      <div className="flex-1 min-w-0 mr-2">
                                        <p className="font-medium text-slate-700">Interest Withdrawal</p>
                                        <p className="text-xs text-slate-500">{investorName}</p>
                                      </div>
                                      <p className="font-mono font-semibold text-red-600 whitespace-nowrap">{formatCurrency(interest.amount)}</p>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex justify-between text-sm pt-1 border-t border-blue-200">
                                <span className="font-medium text-blue-800">Total:</span>
                                <span className="font-mono font-bold text-blue-800">
                                  {formatCurrency(grandTotal)}
                                </span>
                              </div>
                              {Math.abs(grandTotal - Math.abs(selectedEntry.amount)) < 0.01 && (
                                <p className="text-xs text-emerald-600 flex items-center gap-1">
                                  <Check className="w-3 h-3" />
                                  Amounts match exactly
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* Transaction Type Dropdown - hide when showing grouped match */}
                    {!(matchMode === 'match' && reviewingSuggestion?.matchMode === 'match_group') && (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs text-slate-500 uppercase">Transaction Type</Label>
                        <Select
                          value={reconciliationType}
                          onValueChange={(value) => {
                            setReconciliationType(value);
                            setSelectedLoan(null);
                            setSelectedInvestor(null);
                            setSelectedExpenseType(null);
                            setSelectedExpenseLoan(null);
                            setSelectedExistingTxs([]); // Clear multi-select
                            setEntitySearch('');
                            setSelectedOffsetEntries([]);
                            setOffsetNotes('');
                            // Reset multi-loan state when type changes
                            setMultiLoanAllocations([]);
                            setMultiLoanBorrowerId(null);
                            // Set appropriate default split amounts based on type
                            const amount = Math.abs(selectedEntry.amount);
                            if (value === 'loan_repayment') {
                              // Default loan repayments to interest (most common for interest-only loans)
                              setSplitAmounts({ capital: 0, interest: amount, fees: 0 });
                            } else {
                              setSplitAmounts({ capital: amount, interest: 0, fees: 0 });
                            }
                          }}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Select type..." />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedEntry.amount > 0 ? (
                              <>
                                <SelectItem value="loan_repayment">Loan Repayment</SelectItem>
                                <SelectItem value="investor_credit">Investor Credit</SelectItem>
                                <SelectItem value="other_income">Other Income</SelectItem>
                                <SelectItem value="offset">Funds Returned</SelectItem>
                              </>
                            ) : (
                              <>
                                <SelectItem value="expense">Expense</SelectItem>
                                <SelectItem value="loan_disbursement">Loan Disbursement</SelectItem>
                                <SelectItem value="investor_withdrawal">Investor Capital Withdrawal</SelectItem>
                                <SelectItem value="interest_withdrawal">Investor Interest Withdrawal</SelectItem>
                                <SelectItem value="offset">Funds Returned</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Selected Entity Display */}
                      {selectedInvestor && (reconciliationType === 'investor_withdrawal' || reconciliationType === 'investor_credit' || reconciliationType === 'interest_withdrawal') && (
                        <div className="bg-white rounded-lg p-2 border border-emerald-300">
                          <p className="text-xs text-slate-400 uppercase">Investor Account</p>
                          <p className="text-sm font-semibold text-slate-900">{selectedInvestor.business_name || selectedInvestor.name}</p>
                          {selectedInvestor.account_number && (
                            <p className="text-xs text-slate-500">{selectedInvestor.account_number}</p>
                          )}
                        </div>
                      )}

                      {/* Single loan display for disbursements */}
                      {selectedLoan && reconciliationType === 'loan_disbursement' && (
                        <div className="bg-white rounded-lg p-2 border border-emerald-300">
                          <p className="text-xs text-slate-400 uppercase">Loan</p>
                          <p className="text-sm font-semibold text-slate-900">{selectedLoan.loan_number}</p>
                          <p className="text-xs text-slate-500">{getBorrowerName(selectedLoan.borrower_id)}</p>
                        </div>
                      )}

                      {/* Multi-loan display for repayments */}
                      {multiLoanAllocations.length > 0 && reconciliationType === 'loan_repayment' && (
                        <div className="bg-white rounded-lg p-2 border border-emerald-300">
                          <p className="text-xs text-slate-400 uppercase">Loan{multiLoanAllocations.length > 1 ? 's' : ''}</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {multiLoanAllocations.length === 1
                              ? multiLoanAllocations[0].loan.loan_number
                              : `${multiLoanAllocations.length} loans`}
                          </p>
                          <p className="text-xs text-slate-500">
                            {multiLoanAllocations.length === 1
                              ? getBorrowerName(multiLoanAllocations[0].loan.borrower_id)
                              : `${getBorrowerName(multiLoanBorrowerId)} (${multiLoanAllocations.map(a => a.loan.loan_number).join(', ')})`}
                          </p>
                        </div>
                      )}

                      {/* Amount - show selected transaction amount when matching */}
                      <div>
                        <p className="text-xs text-slate-400 uppercase">Amount</p>
                        <p className="text-lg font-bold text-emerald-600">
                          {matchMode === 'match' && selectedExistingTxs.length > 0
                            ? formatCurrency(selectedExistingTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0))
                            : formatCurrency(Math.abs(selectedEntry.amount))} ✓
                        </p>
                      </div>

                      {/* Date - show selected transaction date when matching, otherwise bank date */}
                      <div>
                        <p className="text-xs text-slate-400 uppercase">Date</p>
                        {(() => {
                          // When matching, show the transaction date (first selected)
                          const firstSelectedTx = selectedExistingTxs.length > 0 ? selectedExistingTxs[0] : null;
                          const displayDate = matchMode === 'match' && firstSelectedTx?.date
                            ? firstSelectedTx.date
                            : selectedEntry.statement_date;
                          const bankDate = selectedEntry.statement_date;
                          const txDate = firstSelectedTx?.date;

                          // Check if dates match (for match mode)
                          const datesMatch = matchMode === 'match' && txDate && bankDate
                            ? Math.abs(differenceInDays(parseISO(txDate), parseISO(bankDate))) === 0
                            : true;

                          return (
                            <p className={`text-sm font-medium ${datesMatch ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {displayDate && isValid(parseISO(displayDate))
                                ? format(parseISO(displayDate), 'dd MMM yyyy')
                                : '-'}
                              {datesMatch ? ' ✓' : ` (bank: ${bankDate ? format(parseISO(bankDate), 'dd MMM') : '?'})`}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                    )}
                  </div>
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
                          <div className="flex items-center justify-between">
                            <Label>Select Loan{reconciliationType === 'loan_repayment' && 's'}</Label>
                            {reconciliationType === 'loan_repayment' && multiLoanAllocations.length > 0 && (
                              <span className="text-xs text-slate-500">
                                {multiLoanAllocations.length} loan{multiLoanAllocations.length > 1 ? 's' : ''} selected
                              </span>
                            )}
                          </div>
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
                            {filteredLoans
                              .filter(loan => {
                                // For repayments with multi-loan mode: filter to same borrower if one is selected
                                if (reconciliationType === 'loan_repayment' && multiLoanBorrowerId) {
                                  return loan.borrower_id === multiLoanBorrowerId;
                                }
                                return true;
                              })
                              .slice(0, 10).map(loan => {
                                const isInAllocation = multiLoanAllocations.some(a => a.loan.id === loan.id);
                                const isSelected = reconciliationType === 'loan_disbursement'
                                  ? selectedLoan?.id === loan.id
                                  : isInAllocation;
                                const lastPayment = getLastPayment(loan.id);
                                const nextDue = getNextDuePayment(loan.id);
                                const isOverdue = nextDue && new Date(nextDue.due_date) < new Date();
                                return (
                                  <div
                                    key={loan.id}
                                    className={`p-3 cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''} ${isInAllocation ? 'opacity-60' : ''}`}
                                    onClick={() => {
                                      if (reconciliationType === 'loan_repayment') {
                                        // Multi-loan mode for repayments
                                        if (!isInAllocation) {
                                          addLoanToAllocation(loan);
                                        }
                                      } else {
                                        // Single loan mode for disbursements
                                        setSelectedLoan(loan);
                                      }
                                    }}
                                  >
                                    <div className="flex justify-between">
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium">{loan.loan_number}</p>
                                        <p className="text-sm text-slate-500">{getBorrowerName(loan.borrower_id)}</p>
                                        {loan.description && (
                                          <p className="text-xs text-slate-400 truncate">{loan.description}</p>
                                        )}
                                        {/* Last payment info */}
                                        {lastPayment && (
                                          <p className="text-xs text-slate-400 mt-1">
                                            Last: {formatCurrency(lastPayment.amount)} on {format(parseISO(lastPayment.date), 'dd MMM')}
                                          </p>
                                        )}
                                      </div>
                                      <div className="text-right shrink-0 ml-2">
                                        <p className="text-xs text-slate-500">Balance: {formatCurrency((loan.principal_amount || 0) - (loan.principal_paid || 0))}</p>
                                        {/* Expected payment info */}
                                        {nextDue && (
                                          <div className={`text-xs mt-1 ${isOverdue ? 'text-red-600 font-medium' : 'text-blue-600'}`}>
                                            <p>{isOverdue ? 'Overdue' : 'Due'}: {formatCurrency(nextDue.total_due || nextDue.amount || 0)}</p>
                                            <p className="text-slate-400">{format(parseISO(nextDue.due_date), 'dd MMM')}</p>
                                          </div>
                                        )}
                                        {!nextDue && (
                                          <p className="text-xs text-slate-400 mt-1">No schedule</p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            {filteredLoans.length === 0 && (
                              <p className="p-3 text-sm text-slate-500">No matching loans found</p>
                            )}
                            {multiLoanBorrowerId && (
                              <div className="p-2 bg-blue-50 text-center">
                                <button
                                  className="text-xs text-blue-600 hover:underline"
                                  onClick={() => {
                                    setMultiLoanAllocations([]);
                                    setMultiLoanBorrowerId(null);
                                  }}
                                >
                                  Clear selection to see all borrowers
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Multi-Loan Allocations for Repayments */}
                          {reconciliationType === 'loan_repayment' && multiLoanAllocations.length > 0 && (
                            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                              <Label className="text-base">Payment Allocation</Label>
                              <p className="text-xs text-slate-500">
                                Allocate {formatCurrency(Math.abs(selectedEntry.amount))} across {multiLoanAllocations.length} loan{multiLoanAllocations.length > 1 ? 's' : ''}
                              </p>

                              {multiLoanAllocations.map((allocation, idx) => (
                                <div key={allocation.loan.id} className="border border-slate-200 rounded-lg p-3 bg-white">
                                  <div className="flex justify-between items-center mb-2">
                                    <div>
                                      <span className="font-medium text-sm">{allocation.loan.loan_number}</span>
                                      <span className="text-xs text-slate-500 ml-2">
                                        (Balance: {formatCurrency((allocation.loan.principal_amount || 0) - (allocation.loan.principal_paid || 0))})
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      className="text-slate-400 hover:text-red-500 p-1"
                                      onClick={() => removeLoanFromAllocation(idx)}
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2">
                                    <div>
                                      <Label className="text-xs">Principal</Label>
                                      <Input
                                        type="number"
                                        value={allocation.principal || ''}
                                        onChange={(e) => updateLoanAllocation(idx, 'principal', e.target.value)}
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs">Interest</Label>
                                      <Input
                                        type="number"
                                        value={allocation.interest || ''}
                                        onChange={(e) => updateLoanAllocation(idx, 'interest', e.target.value)}
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <Label className="text-xs">Fees</Label>
                                      <Input
                                        type="number"
                                        value={allocation.fees || ''}
                                        onChange={(e) => updateLoanAllocation(idx, 'fees', e.target.value)}
                                        className="h-8 text-sm"
                                      />
                                    </div>
                                  </div>
                                  <p className="text-xs text-slate-500 mt-1">
                                    Subtotal: {formatCurrency((allocation.principal || 0) + (allocation.interest || 0) + (allocation.fees || 0))}
                                  </p>
                                </div>
                              ))}

                              {/* Running total */}
                              <div className={`p-2 rounded ${Math.abs(totalMultiLoanAllocated - Math.abs(selectedEntry.amount)) < 0.01 ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                                <p className={`text-sm font-medium ${Math.abs(totalMultiLoanAllocated - Math.abs(selectedEntry.amount)) < 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                  Total Allocated: {formatCurrency(totalMultiLoanAllocated)} / Bank: {formatCurrency(Math.abs(selectedEntry.amount))}
                                  {Math.abs(totalMultiLoanAllocated - Math.abs(selectedEntry.amount)) >= 0.01 && (
                                    <span className="ml-2">
                                      (Remaining: {formatCurrency(Math.abs(selectedEntry.amount) - totalMultiLoanAllocated)})
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Legacy single-loan split (for disbursements only) */}
                          {reconciliationType === 'loan_disbursement' && selectedLoan && (
                            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                              <Label className="text-base">Selected Loan</Label>
                              <p className="text-sm">{selectedLoan.loan_number} - {getBorrowerName(selectedLoan.borrower_id)}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Investor Selection */}
                      {(reconciliationType === 'investor_credit' || reconciliationType === 'investor_withdrawal') && (
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

                          {/* Split Amounts for Investor Withdrawal */}
                          {reconciliationType === 'investor_withdrawal' && selectedInvestor && (
                            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                              <Label className="text-base">Withdrawal Split</Label>
                              <p className="text-xs text-slate-500">Allocate the withdrawal between capital and interest</p>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label className="text-xs">Capital</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={investorWithdrawalSplit.capital || ''}
                                    onChange={(e) => {
                                      const capitalVal = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                      const bankAmount = Math.abs(selectedEntry.amount);
                                      const interestVal = Math.round((bankAmount - capitalVal) * 100) / 100;
                                      setInvestorWithdrawalSplit({
                                        capital: capitalVal,
                                        interest: Math.max(0, interestVal)
                                      });
                                    }}
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">Interest</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={investorWithdrawalSplit.interest || ''}
                                    onChange={(e) => {
                                      const interestVal = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                      setInvestorWithdrawalSplit(prev => ({ ...prev, interest: interestVal }));
                                    }}
                                  />
                                </div>
                              </div>
                              <p className="text-sm text-slate-500">
                                Total: {formatCurrency(investorWithdrawalSplit.capital + investorWithdrawalSplit.interest)} /
                                Bank: {formatCurrency(Math.abs(selectedEntry.amount))}
                                {Math.abs((investorWithdrawalSplit.capital + investorWithdrawalSplit.interest) - Math.abs(selectedEntry.amount)) > 0.01 && (
                                  <span className="text-amber-600 ml-2">
                                    (Difference: {formatCurrency(Math.abs(selectedEntry.amount) - (investorWithdrawalSplit.capital + investorWithdrawalSplit.interest))})
                                  </span>
                                )}
                              </p>
                            </div>
                          )}
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
                      {/* Potential Matches - Multi-select with checkboxes */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Potential Matches</Label>
                          <span className="text-xs text-slate-500">Select one or more to match</span>
                        </div>
                        {potentialMatches.length > 0 ? (
                          <>
                            <div className="max-h-52 overflow-y-auto border rounded-lg divide-y">
                              {potentialMatches.map(tx => {
                                const isSelected = selectedExistingTxs.some(t => t.id === tx.id);
                                return (
                                  <div
                                    key={tx.id}
                                    className={`p-3 cursor-pointer hover:bg-slate-50 ${isSelected ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''}`}
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedExistingTxs(prev => prev.filter(t => t.id !== tx.id));
                                      } else {
                                        setSelectedExistingTxs(prev => [...prev, tx]);
                                      }
                                    }}
                                  >
                                    <div className="flex items-center gap-3">
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={(checked) => {
                                          if (checked) {
                                            setSelectedExistingTxs(prev => [...prev, tx]);
                                          } else {
                                            setSelectedExistingTxs(prev => prev.filter(t => t.id !== tx.id));
                                          }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="border-slate-300"
                                      />
                                      <div className="flex-1">
                                        <p className="text-sm text-slate-500">
                                          {tx.date && isValid(parseISO(tx.date))
                                            ? format(parseISO(tx.date), 'dd MMM yyyy')
                                            : '-'}
                                        </p>
                                        <p className="font-medium">{tx.type || tx.reference || 'Transaction'}</p>
                                        <p className="text-xs text-slate-500">{tx.notes || tx.description || '-'}</p>
                                      </div>
                                      <div className="text-right">
                                        <p className="font-mono font-medium">{formatCurrency(tx.amount)}</p>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Selection Summary */}
                            {selectedExistingTxs.length > 0 && (() => {
                              const selectedTotal = selectedExistingTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
                              const bankAmount = Math.abs(selectedEntry?.amount || 0);
                              const difference = Math.abs(bankAmount - selectedTotal);
                              const isBalanced = difference < 0.01;

                              return (
                                <div className="p-3 bg-slate-50 border rounded-lg space-y-2">
                                  <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Selected ({selectedExistingTxs.length})</span>
                                    <span className="font-mono font-medium">{formatCurrency(selectedTotal)}</span>
                                  </div>
                                  <div className="flex justify-between text-sm">
                                    <span className="text-slate-600">Bank Entry</span>
                                    <span className="font-mono">{formatCurrency(bankAmount)}</span>
                                  </div>
                                  <div className={`flex justify-between text-sm pt-2 border-t ${isBalanced ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    <span>{isBalanced ? '✓ Amounts match' : 'Difference'}</span>
                                    {!isBalanced && <span className="font-mono">{formatCurrency(difference)}</span>}
                                  </div>
                                </div>
                              );
                            })()}
                          </>
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
                      <Label>Link to Loan (optional)</Label>
                      <LoanSelectCombobox
                        loans={loans}
                        selectedLoan={selectedExpenseLoan}
                        onSelect={setSelectedExpenseLoan}
                        getBorrowerName={getBorrowerName}
                      />
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
                    disabled={(() => {
                      if (isReconciling) return true;
                      if (!reconciliationType) return true;
                      if (reconciliationType === 'loan_repayment' && matchMode === 'create' && multiLoanAllocations.length === 0) return true;
                      if (reconciliationType === 'loan_disbursement' && matchMode === 'create' && !selectedLoan) return true;
                      if (reconciliationType.startsWith('investor_') && matchMode === 'create' && !selectedInvestor) return true;
                      if (matchMode === 'match' && selectedExistingTxs.length === 0 && reconciliationType !== 'offset') return true;
                      // For multi-select matching, ensure amounts balance
                      if (matchMode === 'match' && selectedExistingTxs.length > 0) {
                        const selectedTotal = selectedExistingTxs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
                        const bankAmount = Math.abs(selectedEntry?.amount || 0);
                        if (Math.abs(bankAmount - selectedTotal) >= 0.01) return true;
                      }
                      if (reconciliationType === 'offset' && (selectedOffsetEntries.length === 0 || !offsetNotes.trim() || Math.abs(selectedEntry.amount + selectedOffsetEntries.reduce((sum, e) => sum + e.amount, 0)) >= 0.01)) return true;
                      return false;
                    })()}
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
          </SheetContent>
        </Sheet>

        {/* Delete All Unreconciled Confirmation Dialog */}
        <AlertDialog open={showDeleteUnreconciledDialog} onOpenChange={setShowDeleteUnreconciledDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="w-5 h-5" />
                Delete All Unreconciled Entries?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {totals.unreconciled} unreconciled bank statement entries.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>Note:</strong> Only unreconciled entries will be deleted. Reconciled entries will be preserved.
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingUnreconciled}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteAllUnreconciled}
                disabled={isDeletingUnreconciled}
                className="bg-red-600 hover:bg-red-700"
              >
                {isDeletingUnreconciled ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete {totals.unreconciled} Entries
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mark as Unreconcilable Dialog */}
        <Dialog open={showUnreconcilableDialog} onOpenChange={(open) => {
          setShowUnreconcilableDialog(open);
          if (!open) setUnreconcilableReason('');
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Ban className="w-5 h-5 text-slate-600" />
                Mark as Unreconcilable
              </DialogTitle>
              <DialogDescription>
                These entries will be moved to the reconciled list but marked as unreconcilable.
                You can undo this later if needed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Show selected entries summary */}
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <p className="font-medium text-slate-700 mb-2">
                  {selectedEntries.size > 0 ? `${[...selectedEntries].filter(id => {
                    const entry = bankStatements.find(s => s.id === id);
                    return entry && !entry.is_reconciled;
                  }).length} entries selected` : '1 entry selected'}
                </p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {(selectedEntries.size > 0
                    ? bankStatements.filter(s => selectedEntries.has(s.id) && !s.is_reconciled)
                    : selectedEntry ? [selectedEntry] : []
                  ).slice(0, 5).map(entry => (
                    <div key={entry.id} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1 text-slate-600">{entry.description?.substring(0, 40)}</span>
                      <span className={entry.amount > 0 ? 'text-emerald-600' : 'text-red-600'}>
                        {formatCurrency(entry.amount)}
                      </span>
                    </div>
                  ))}
                  {(selectedEntries.size > 0
                    ? bankStatements.filter(s => selectedEntries.has(s.id) && !s.is_reconciled).length
                    : selectedEntry ? 1 : 0
                  ) > 5 && (
                    <p className="text-xs text-slate-500 italic">
                      ...and {(selectedEntries.size > 0
                        ? bankStatements.filter(s => selectedEntries.has(s.id) && !s.is_reconciled).length
                        : 1) - 5} more
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unreconcilable-reason">Reason *</Label>
                <Textarea
                  id="unreconcilable-reason"
                  value={unreconcilableReason}
                  onChange={(e) => setUnreconcilableReason(e.target.value)}
                  placeholder="Why can't this be reconciled? e.g., Bank error, duplicate entry, internal transfer..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowUnreconcilableDialog(false);
                  setUnreconcilableReason('');
                }}
                disabled={isMarkingUnreconcilable}
              >
                Cancel
              </Button>
              <Button
                onClick={handleMarkUnreconcilable}
                disabled={!unreconcilableReason.trim() || isMarkingUnreconcilable}
              >
                {isMarkingUnreconcilable ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Marking...
                  </>
                ) : (
                  <>
                    <Ban className="w-4 h-4 mr-2" />
                    Mark Unreconcilable
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
