import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { supabase } from '@/lib/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Users,
  FileText,
  CreditCard,
  Trash2,
  Link2,
  Play,
  Settings2,
  RotateCcw,
  XCircle
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';
import { getOrgItem, setOrgItem, removeOrgItem } from '@/lib/orgStorage';
import { logBulkImportEvent, AuditAction } from '@/lib/auditLog';

// CSV Parser that handles quoted fields
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = [];
  let headerLine = lines[0];
  let current = '';
  let inQuotes = false;

  for (let j = 0; j < headerLine.length; j++) {
    const char = headerLine[j];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headers.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  headers.push(current.trim().replace(/^"|"$/g, ''));

  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = [];
    current = '';
    inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    data.push(row);
  }

  return { headers, data };
}

// Parse UK date format DD/MM/YYYY
function parseDate(dateStr) {
  if (!dateStr) return null;
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const [, day, month, year] = ukMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return dateStr;
}

// Parse amount (remove currency symbols and commas)
function parseAmount(amountStr) {
  if (!amountStr) return 0;
  const cleaned = amountStr.replace(/[£$,\s]/g, '').replace(/\((.+)\)/, '-$1');
  const amount = parseFloat(cleaned);
  return isNaN(amount) ? 0 : amount;
}

// Parse interest rate from "X%/Year" or "X%/Month" format
// If rate < 2 and marked as Year, assume it's actually a monthly rate and convert to annual
function parseInterestRate(rateStr) {
  if (!rateStr) return { rate: 0, period: 'yearly', wasConverted: false };
  const match = rateStr.match(/(\d+\.?\d*)%\/(Year|Month|Loan|Day)/i);
  if (!match) return { rate: 0, period: 'yearly', wasConverted: false };
  let rate = parseFloat(match[1]);
  const period = match[2].toLowerCase();
  let wasConverted = false;

  // If rate is marked as "Year" but is < 2, it's likely a monthly rate
  // Convert to annual by multiplying by 12
  if (period === 'year' && rate > 0 && rate < 2) {
    rate = rate * 12;
    wasConverted = true;
  }

  // If explicitly marked as Month, convert to annual
  if (period === 'month' && rate > 0) {
    rate = rate * 12;
    wasConverted = true;
  }

  return { rate, period: 'yearly', wasConverted };
}

// Map Loandisc status to app status
function mapLoanStatus(loandiscStatus) {
  const statusMap = {
    'Current': 'Live',
    'Fully Paid': 'Closed',  // Map to Closed (Settled)
    'Restructured': 'Restructured',
    'Write-Off': 'Default',
    'Past Maturity': 'Live',
    'Missed Repayment': 'Live',
    'Arrears': 'Live',
    'Not Taken Up': 'Cancelled'
  };
  return statusMap[loandiscStatus] || 'Live';
}

// STRICT FIELD WHITELISTS - Only these fields exist in the database
const VALID_BORROWER_FIELDS = [
  'unique_number', 'full_name', 'first_name', 'last_name', 'business',
  'email', 'contact_email', 'address', 'phone', 'mobile', 'landline', 'gender',
  'city', 'zipcode', 'country', 'notes', 'status'
];

const VALID_LOAN_FIELDS = [
  'loan_number', 'borrower_id', 'borrower_name', 'product_id', 'product_name',
  'principal_amount', 'arrangement_fee', 'exit_fee', 'net_disbursed',
  'duration', 'start_date', 'interest_rate', 'interest_type', 'interest_only_period',
  'period', 'total_interest', 'total_repayable', 'principal_paid', 'interest_paid',
  'status', 'description', 'override_interest_rate', 'overridden_rate',
  'product_type', 'monthly_charge', 'total_charges', 'charges_paid',
  'restructured_from_loan_id', 'restructured_from_loan_number', 'auto_extend',
  'has_penalty_rate', 'penalty_rate', 'penalty_rate_from'
];

const VALID_TRANSACTION_FIELDS = [
  'loan_id', 'borrower_id', 'date', 'type', 'amount',
  'principal_applied', 'interest_applied', 'fees_applied',
  'reference', 'notes'
];

// Filter object to only include valid fields
function filterFields(obj, validFields) {
  const filtered = {};
  for (const key of validFields) {
    if (obj[key] !== undefined) {
      filtered[key] = obj[key];
    }
  }
  return filtered;
}

// ============================================================================
// FIELD MAPPING CONFIGURATION
// ============================================================================

// Define target fields with descriptions for user-friendly mapping
const BORROWER_FIELD_OPTIONS = [
  { value: '_ignore', label: '⊘ Ignore this column' },
  { value: '_notes', label: '📝 Add to Notes' },
  { value: 'unique_number', label: 'Unique Number (ID)' },
  { value: 'full_name', label: 'Full Name' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'business', label: 'Business/Company Name' },
  { value: 'email', label: 'Email' },
  { value: 'contact_email', label: 'Contact Email (for grouping)' },
  { value: 'address', label: 'Address' },
  { value: 'phone', label: 'Phone (Primary)' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'landline', label: 'Landline' },
  { value: 'gender', label: 'Gender' },
  { value: 'city', label: 'City' },
  { value: 'zipcode', label: 'Postcode/Zipcode' },
  { value: 'country', label: 'Country' },
  { value: 'notes', label: 'Notes (replace)' },
  { value: 'status', label: 'Status' }
];

const LOAN_FIELD_OPTIONS = [
  { value: '_ignore', label: '⊘ Ignore this column' },
  { value: '_notes', label: '📝 Add to Description' },
  { value: 'loan_number', label: 'Loan Number' },
  { value: '_borrower_number', label: 'Borrower Number (for linking)' },
  { value: 'borrower_name', label: 'Borrower Name' },
  { value: '_product_name', label: 'Product Name (for linking)' },
  { value: 'principal_amount', label: 'Principal Amount' },
  { value: 'arrangement_fee', label: 'Arrangement Fee' },
  { value: 'exit_fee', label: 'Exit Fee' },
  { value: 'start_date', label: 'Start/Released Date' },
  { value: '_maturity_date', label: 'Maturity Date (for notes)' },
  { value: '_interest_rate', label: 'Interest Rate (e.g. 10%/Year)' },
  { value: 'duration', label: 'Duration (months)' },
  { value: '_status', label: 'Loan Status' },
  { value: 'description', label: 'Description/Title' }
];

const REPAYMENT_FIELD_OPTIONS = [
  { value: '_ignore', label: '⊘ Ignore this column' },
  { value: '_notes', label: '📝 Add to Description' },
  { value: '_loan_number', label: 'Loan Number (for linking)' },
  { value: 'date', label: 'Payment Date' },
  { value: 'principal_applied', label: 'Principal Paid' },
  { value: 'interest_applied', label: 'Interest Paid' },
  { value: 'penalty_applied', label: 'Penalty Paid' },
  { value: 'fees_applied', label: 'Fees Paid' },
  { value: 'method', label: 'Payment Method' },
  { value: 'description', label: 'Description' }
];

// Default mappings for Loandisc CSV columns
const DEFAULT_BORROWER_MAPPINGS = {
  'Unique Number': 'unique_number',
  'Full Name': 'full_name',
  'First Name': 'first_name',
  'Last Name': 'last_name',
  'Business': 'business',
  'Email': 'email',
  'Address': 'address',
  'Mobile': 'mobile',
  'Landline': 'landline',
  'Gender': 'gender',
  'City': 'city',
  'Zipcode': 'zipcode',
  'Country': 'country',
  'Contact': '_notes',
  'Short Name': '_notes',
  'Group Name': '_notes',
  'Borrower Id': '_notes',
  'Borrower Status Name': '_ignore',
  'Province': '_notes',
  // Ignore calculated/aggregate fields
  'Total Paid Amount': '_ignore',
  'Open Loans Balance': '_ignore',
  'Credit Score': '_ignore',
  'Working Status': '_ignore',
  'Age': '_ignore',
  'Date 0f Birth': '_ignore',
  'Savings Ledger Balance': '_ignore',
  'Savings Available Balance': '_ignore',
  'Loan Officer': '_ignore',
  'Number of Loans': '_ignore',
  'Number of Open Loans': '_ignore',
  'Number of Fully Paid Loans': '_ignore',
  'Number of Defaulted Loans': '_ignore',
  'Number of Processing Loans': '_ignore',
  'Number of Not Taken Up Loans': '_ignore',
  'Number of Denied Loans': '_ignore',
  'Number of Restructured Loans': '_ignore',
  'Total Paid Amount for Open Loans': '_ignore',
  'Total Paid Amount for Fully Paid Loans': '_ignore',
  'Total Paid Amount for Default Loans': '_ignore',
  'Total Paid Amount for Restructured Loans': '_ignore',
  'Created Date': '_ignore'
};

const DEFAULT_LOAN_MAPPINGS = {
  'Loan #': 'loan_number',
  'Borrower #': '_borrower_number',
  'Business Name': 'borrower_name',
  'Full Name': '_ignore', // Use Business Name instead
  'Loan Product': '_product_name',
  'Principal Amount': 'principal_amount',
  'Arragement Fee': 'arrangement_fee',
  'Facility Exit Fee': 'exit_fee',
  'Released Date': 'start_date',
  'Maturity Date': '_maturity_date',
  'Interest Rate': '_interest_rate',
  'Loan Status Name': '_status',
  'Loan Title': 'description',
  'Notes': '_ignore',
  'Loan Id': '_ignore',
  'Loan Duration': 'duration',
  // Ignore calculated/aggregate fields
  'Interest Amount': '_ignore',
  'Total Due Amount': '_ignore',
  'Paid Amount': '_ignore',
  'Balance Amount': '_ignore',
  'Non Deductable Fees': '_ignore',
  'Penalty Amount': '_ignore',
  'Next Due Date': '_ignore',
  'Deductable Fees': 'arrangement_fee',
  'Loan Officer': '_ignore',
  'Collateral Status': '_ignore',
  'Borrower Mobile': '_ignore',
  'Borrower Landline': '_ignore',
  'Borrower Email': '_ignore',
  'Savings Ledger Balance': '_ignore',
  'Days Past Due': '_ignore',
  'Past Due': '_ignore',
  'Amortization Due': '_ignore',
  'Pending Due': '_ignore',
  'Last Repayment': '_ignore',
  'Total Principal Balance': '_ignore',
  'Total Principal Paid': '_total_principal_paid',
  'Total Interest Paid': '_ignore',
  'Total Penalty Paid': '_ignore',
  'Total Fees Paid': '_ignore',
  'Days To Maturity': '_ignore',
  'Savings Available Balance': '_ignore',
  'Group Name': '_ignore',
  'Borrower Age': '_ignore',
  'Borrower Date 0f Birth': '_ignore',
  'Principal Released After Deductable Fees': '_principal_released',
  'Days Past Maturity': '_ignore',
  'Total Penalty Balance': '_ignore',
  'Total Fees Balance': '_ignore',
  'Total Interest Balance': '_ignore',
  'Balloon Repayment Amount': '_ignore',
  'Borrower Country': '_ignore',
  'Borrower Zipcode': '_ignore',
  'Borrower Province': '_ignore',
  'Borrower City': '_ignore',
  'Borrower Gender': '_ignore',
  'Borrower Address': '_ignore',
  'Borrower Credit Score': '_ignore',
  'Bank Account (Loan Released)': '_ignore',
  'Pending Principal Due': '_ignore',
  'Pending Interest Due': '_ignore',
  'Pending Fees Due': '_ignore',
  'Pending Penalty Due': '_ignore',
  'Next Installment Amount': '_ignore',
  'Next Installment Date': '_ignore',
  'Previous Installment Amount': '_ignore',
  'Previous Installment Date': '_ignore',
  'Interest Start Date': '_ignore',
  'Last Payment Date': '_ignore',
  'Last Payment Amount': '_ignore',
  'Status': '_ignore',
  'Repayment Cycle': '_ignore',
  'Disbursed By': '_ignore',
  'Deed of Variation Fee': '_ignore',
  'Legal Recovery Fees': '_ignore',
  'Manual Loan Adjustment Amount': '_ignore',
  'Setup Fee': '_ignore'
};

const DEFAULT_REPAYMENT_MAPPINGS = {
  'Loan #': '_loan_number',
  'Collection Date': 'date',
  'Principal Paid Amount': 'principal_applied',
  'Interest Paid Amount': 'interest_applied',
  'Penalty Paid Amount': 'penalty_applied',
  'Fees Paid Amount': 'fees_applied',
  'Repayment Method': 'method',
  'Description': 'description',
  // Ignore other fields
  'Repayment Id': '_ignore',
  'Borrower #': '_ignore',
  'Business Name': '_ignore',
  'Full Name': '_ignore'
};

// Storage keys for persisting mappings
const STORAGE_KEY_BORROWER = 'loandisc_borrower_mappings';
const STORAGE_KEY_LOAN = 'loandisc_loan_mappings';
const STORAGE_KEY_REPAYMENT = 'loandisc_repayment_mappings';

// Storage keys for persisting CSV data
const STORAGE_KEY_BORROWER_CSV = 'loandisc_borrower_csv';
const STORAGE_KEY_LOAN_CSV = 'loandisc_loan_csv';
const STORAGE_KEY_REPAYMENT_CSV = 'loandisc_repayment_csv';

// Load saved mappings from org-scoped localStorage
function loadSavedMappings(storageKey, defaultMappings) {
  try {
    const saved = getOrgItem(storageKey);
    if (saved) {
      return { ...defaultMappings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load saved mappings:', e);
  }
  return defaultMappings;
}

// Save mappings to org-scoped localStorage
function saveMappings(storageKey, mappings) {
  try {
    setOrgItem(storageKey, JSON.stringify(mappings));
  } catch (e) {
    console.warn('Failed to save mappings:', e);
  }
}

// Save CSV data to org-scoped localStorage (with file metadata)
function saveCsvData(storageKey, fileName, data) {
  try {
    setOrgItem(storageKey, JSON.stringify({ fileName, data, savedAt: Date.now() }));
  } catch (e) {
    console.warn('Failed to save CSV data:', e);
  }
}

// Load CSV data from org-scoped localStorage
function loadCsvData(storageKey) {
  try {
    const saved = getOrgItem(storageKey);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load CSV data:', e);
  }
  return null;
}

// Clear saved CSV data from org-scoped localStorage
function clearCsvData(storageKey) {
  try {
    removeOrgItem(storageKey);
  } catch (e) {
    console.warn('Failed to clear CSV data:', e);
  }
}

// FieldMapper Component
function FieldMapper({ csvHeaders, mappings, onChange, fieldOptions, sampleData }) {
  const [showAll, setShowAll] = useState(false);

  // Filter to show only mapped or unmapped columns
  const displayHeaders = showAll
    ? csvHeaders
    : csvHeaders.filter(h => !mappings[h] || mappings[h] !== '_ignore');

  const unmappedCount = csvHeaders.filter(h => !mappings[h]).length;
  const ignoredCount = csvHeaders.filter(h => mappings[h] === '_ignore').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          <span className="font-medium">{csvHeaders.length}</span> columns found
          {unmappedCount > 0 && (
            <Badge variant="outline" className="ml-2 text-amber-600 border-amber-300">
              {unmappedCount} unmapped
            </Badge>
          )}
          {ignoredCount > 0 && (
            <Badge variant="outline" className="ml-2 text-slate-400">
              {ignoredCount} ignored
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll(!showAll)}
          className="text-xs"
        >
          {showAll ? 'Hide ignored' : 'Show all columns'}
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-slate-50">
            <TableRow>
              <TableHead className="w-1/3">CSV Column</TableHead>
              <TableHead className="w-1/3">Map To</TableHead>
              <TableHead className="w-1/3">Sample Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayHeaders.map(header => (
              <TableRow key={header} className={mappings[header] === '_ignore' ? 'opacity-50' : ''}>
                <TableCell className="font-mono text-xs py-2">{header}</TableCell>
                <TableCell className="py-2">
                  <Select
                    value={mappings[header] || ''}
                    onValueChange={(value) => onChange(header, value)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select mapping..." />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-xs text-slate-500 truncate max-w-32 py-2">
                  {sampleData?.[header] || '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Apply user mappings to transform a row
function applyMappings(row, mappings, parseOptions = {}) {
  const result = {};
  const noteParts = [];

  for (const [csvColumn, targetField] of Object.entries(mappings)) {
    const value = row[csvColumn];
    if (!value || value.trim() === '') continue;

    if (targetField === '_ignore') {
      continue;
    } else if (targetField === '_notes') {
      noteParts.push(`${csvColumn}: ${value.trim()}`);
    } else if (targetField.startsWith('_')) {
      // Special handling fields (like _borrower_number, _loan_number, etc.)
      // Still apply amount parsing if specified in amountFields
      let parsedValue = value.trim();
      if (parseOptions.amountFields?.includes(targetField)) {
        parsedValue = parseAmount(parsedValue);
      }
      result[targetField] = parsedValue;
    } else {
      // Regular field - apply parsing if needed
      let parsedValue = value.trim();

      if (parseOptions.dateFields?.includes(targetField)) {
        parsedValue = parseDate(parsedValue);
      } else if (parseOptions.amountFields?.includes(targetField)) {
        parsedValue = parseAmount(parsedValue);
      }

      result[targetField] = parsedValue;
    }
  }

  // Add notes if any
  if (noteParts.length > 0) {
    result._additionalNotes = noteParts.join('; ');
  }

  return result;
}

export default function ImportLoandisc() {
  const [step, setStep] = useState('options'); // options, borrowers, loans, repayments, review, importing
  const [debugLoanNumber, setDebugLoanNumber] = useState(''); // Loan number to debug (e.g., "1000017")
  const [showMappings, setShowMappings] = useState({ borrowers: false, loans: false, repayments: false });

  // File states - load from localStorage on init
  const [borrowersFile, setBorrowersFile] = useState(() => {
    const saved = loadCsvData(STORAGE_KEY_BORROWER_CSV);
    return saved ? { name: saved.fileName, fromStorage: true } : null;
  });
  const [borrowersData, setBorrowersData] = useState(() => {
    const saved = loadCsvData(STORAGE_KEY_BORROWER_CSV);
    return saved?.data || null;
  });
  const [loansFile, setLoansFile] = useState(() => {
    const saved = loadCsvData(STORAGE_KEY_LOAN_CSV);
    return saved ? { name: saved.fileName, fromStorage: true } : null;
  });
  const [loansData, setLoansData] = useState(() => {
    const saved = loadCsvData(STORAGE_KEY_LOAN_CSV);
    return saved?.data || null;
  });
  const [repaymentsFile, setRepaymentsFile] = useState(() => {
    const saved = loadCsvData(STORAGE_KEY_REPAYMENT_CSV);
    return saved ? { name: saved.fileName, fromStorage: true } : null;
  });
  const [repaymentsData, setRepaymentsData] = useState(() => {
    const saved = loadCsvData(STORAGE_KEY_REPAYMENT_CSV);
    return saved?.data || null;
  });

  // Field mapping states - load from localStorage on init
  const [borrowerMappings, setBorrowerMappings] = useState(() =>
    loadSavedMappings(STORAGE_KEY_BORROWER, DEFAULT_BORROWER_MAPPINGS)
  );
  const [loanMappings, setLoanMappings] = useState(() =>
    loadSavedMappings(STORAGE_KEY_LOAN, DEFAULT_LOAN_MAPPINGS)
  );
  const [repaymentMappings, setRepaymentMappings] = useState(() =>
    loadSavedMappings(STORAGE_KEY_REPAYMENT, DEFAULT_REPAYMENT_MAPPINGS)
  );

  // Import state
  const [importing, setImporting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const cancelRef = useRef(false);
  const [progress, setProgress] = useState({ stage: '', current: 0, total: 0, percent: 0 });
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [logs, setLogs] = useState([]);

  // Cancel import handler
  const handleCancelImport = () => {
    cancelRef.current = true;
    setCancelled(true);
    addLog('Cancellation requested - stopping after current operation...');
  };

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Save mappings when they change
  useEffect(() => {
    saveMappings(STORAGE_KEY_BORROWER, borrowerMappings);
  }, [borrowerMappings]);

  useEffect(() => {
    saveMappings(STORAGE_KEY_LOAN, loanMappings);
  }, [loanMappings]);

  useEffect(() => {
    saveMappings(STORAGE_KEY_REPAYMENT, repaymentMappings);
  }, [repaymentMappings]);

  // Handler for updating mappings
  const updateBorrowerMapping = (csvColumn, targetField) => {
    setBorrowerMappings(prev => ({ ...prev, [csvColumn]: targetField }));
  };

  const updateLoanMapping = (csvColumn, targetField) => {
    setLoanMappings(prev => ({ ...prev, [csvColumn]: targetField }));
  };

  const updateRepaymentMapping = (csvColumn, targetField) => {
    setRepaymentMappings(prev => ({ ...prev, [csvColumn]: targetField }));
  };

  // Reset mappings to defaults
  const resetMappings = (type) => {
    if (type === 'borrowers') {
      setBorrowerMappings(DEFAULT_BORROWER_MAPPINGS);
    } else if (type === 'loans') {
      setLoanMappings(DEFAULT_LOAN_MAPPINGS);
    } else if (type === 'repayments') {
      setRepaymentMappings(DEFAULT_REPAYMENT_MAPPINGS);
    }
  };

  // Fetch existing data for matching
  const { data: existingBorrowers = [] } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list()
  });

  const { data: existingLoans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list()
  });

  const { data: existingProducts = [] } = useQuery({
    queryKey: ['loan-products'],
    queryFn: () => api.entities.LoanProduct.list()
  });

  const addLog = (message) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  // Transform borrower row using user-defined mappings
  const transformBorrower = (row) => {
    const mapped = applyMappings(row, borrowerMappings, {
      // No special parsing needed for borrower fields
    });

    // Build result with defaults
    const result = {
      unique_number: mapped.unique_number || '',
      business: mapped.business || '',
      full_name: mapped.full_name || mapped.business || 'Unknown',
      first_name: mapped.first_name || '',
      last_name: mapped.last_name || '',
      email: mapped.email || '',
      contact_email: mapped.contact_email || mapped.email || '',  // Default to email if not separately provided
      mobile: mapped.mobile || '',
      landline: mapped.landline || '',
      phone: mapped.phone || mapped.mobile || mapped.landline || '',
      address: mapped.address || '',
      city: mapped.city || '',
      zipcode: mapped.zipcode || '',
      country: mapped.country || 'United Kingdom',
      gender: mapped.gender || '',
      notes: mapped._additionalNotes || mapped.notes || '',
      status: mapped.status || 'Active'
    };

    // Handle empty full_name (space only)
    if (!result.full_name || result.full_name.trim() === '') {
      result.full_name = result.business || 'Unknown';
    }

    return result;
  };

  // Transform loan row using user-defined mappings
  const transformLoan = (row) => {
    const mapped = applyMappings(row, loanMappings, {
      dateFields: ['start_date'],
      amountFields: ['principal_amount', 'arrangement_fee', 'exit_fee', '_total_principal_paid', '_principal_released']
    });

    // Parse interest rate if provided
    const rateInfo = mapped._interest_rate ? parseInterestRate(mapped._interest_rate) : { rate: 0, period: 'yearly' };

    // Parse loan number - handle composite formats like "1000121, R:1000120"
    // where the first number is the primary loan number
    let loanNumber = mapped.loan_number || '';
    let restructuredFromNumber = null;
    if (loanNumber.includes(',')) {
      const parts = loanNumber.split(',').map(p => p.trim());
      loanNumber = parts[0]; // Primary loan number
      // Check for "R:XXXX" restructure reference
      for (const part of parts.slice(1)) {
        if (part.startsWith('R:')) {
          restructuredFromNumber = part.substring(2).trim();
        }
      }
    }

    // For active loans, calculate arrangement fee if missing
    // arrangement_fee = Total Principal Paid - Principal Released After Deductable Fees
    const loandiscStatus = mapped._status || '';
    const isActiveLoan = ['Current', 'Past Maturity', 'Missed Repayment', 'Arrears'].includes(loandiscStatus);
    let arrangementFee = mapped.arrangement_fee || 0;
    let netDisbursed = null;

    if (isActiveLoan) {
      const totalPrincipalPaid = mapped._total_principal_paid || 0;
      const principalReleased = mapped._principal_released || 0;

      // Calculate arrangement fee if not provided and we have the required fields
      if (arrangementFee === 0 && totalPrincipalPaid > 0 && principalReleased > 0) {
        const calculatedFee = totalPrincipalPaid - principalReleased;
        if (calculatedFee > 0) {
          arrangementFee = calculatedFee;
        }
      }

      // Use Principal Released After Deductable Fees as net_disbursed
      if (principalReleased > 0) {
        netDisbursed = principalReleased;
      }
    }

    // Only use Loan Title as description - nothing else
    return {
      loan_number: loanNumber,
      restructured_from_loan_number: restructuredFromNumber, // Stored in dedicated field
      _borrower_number: mapped._borrower_number || '',
      borrower_name: mapped.borrower_name || '',
      _product_name: mapped._product_name || '',
      principal_amount: mapped.principal_amount || 0,
      arrangement_fee: arrangementFee,
      exit_fee: mapped.exit_fee || 0,
      net_disbursed: netDisbursed,
      start_date: mapped.start_date || null,
      duration: mapped.duration ? parseInt(mapped.duration) : null,
      status: mapped._status ? mapLoanStatus(mapped._status) : 'Live',
      description: mapped.description || '',
      override_interest_rate: rateInfo.rate > 0,
      overridden_rate: rateInfo.rate
    };
  };

  // Transform repayment row using user-defined mappings
  const transformRepayment = (row) => {
    const mapped = applyMappings(row, repaymentMappings, {
      dateFields: ['date'],
      amountFields: ['principal_applied', 'interest_applied', 'penalty_applied', 'fees_applied']
    });

    const descParts = [];
    if (mapped.description) descParts.push(mapped.description);
    if (mapped._additionalNotes) descParts.push(mapped._additionalNotes);

    return {
      _loan_number: mapped._loan_number || '',
      date: mapped.date || null,
      principal_applied: mapped.principal_applied || 0,
      interest_applied: mapped.interest_applied || 0,
      penalty_applied: mapped.penalty_applied || 0,
      fees_applied: mapped.fees_applied || 0,
      method: mapped.method || '',
      description: descParts.join(' | ') || 'Imported from Loandisc'
    };
  };

  // Preview borrowers
  const borrowerPreview = useMemo(() => {
    if (!borrowersData) return [];
    return borrowersData.data.slice(0, 10).map(transformBorrower);
  }, [borrowersData, borrowerMappings]);

  // Preview loans
  const loanPreview = useMemo(() => {
    if (!loansData) return [];
    return loansData.data.slice(0, 10).map(transformLoan);
  }, [loansData, loanMappings]);

  // Preview repayments
  const repaymentPreview = useMemo(() => {
    if (!repaymentsData) return [];
    return repaymentsData.data.slice(0, 10).map(transformRepayment);
  }, [repaymentsData, repaymentMappings]);

  // Summary counts
  const summary = useMemo(() => ({
    borrowers: borrowersData?.data?.length || 0,
    loans: loansData?.data?.length || 0,
    repayments: repaymentsData?.data?.length || 0
  }), [borrowersData, loansData, repaymentsData]);

  // Handle file upload
  const handleFileUpload = (fileType, file) => {
    if (!file) return;

    file.text().then(text => {
      const parsed = parseCSV(text);
      switch (fileType) {
        case 'borrowers':
          setBorrowersFile(file);
          setBorrowersData(parsed);
          saveCsvData(STORAGE_KEY_BORROWER_CSV, file.name, parsed);
          break;
        case 'loans':
          setLoansFile(file);
          setLoansData(parsed);
          saveCsvData(STORAGE_KEY_LOAN_CSV, file.name, parsed);
          break;
        case 'repayments':
          setRepaymentsFile(file);
          setRepaymentsData(parsed);
          saveCsvData(STORAGE_KEY_REPAYMENT_CSV, file.name, parsed);
          break;
      }
    });
  };

  // Clear a specific file selection
  const clearFileSelection = (fileType) => {
    switch (fileType) {
      case 'borrowers':
        setBorrowersFile(null);
        setBorrowersData(null);
        clearCsvData(STORAGE_KEY_BORROWER_CSV);
        break;
      case 'loans':
        setLoansFile(null);
        setLoansData(null);
        clearCsvData(STORAGE_KEY_LOAN_CSV);
        break;
      case 'repayments':
        setRepaymentsFile(null);
        setRepaymentsData(null);
        clearCsvData(STORAGE_KEY_REPAYMENT_CSV);
        break;
    }
  };

  // Clear all file selections
  const clearAllFileSelections = () => {
    clearFileSelection('borrowers');
    clearFileSelection('loans');
    clearFileSelection('repayments');
  };

  // Main import function
  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    setLogs([]);
    cancelRef.current = false;
    setCancelled(false);

    try {
      const result = {
        borrowers: { created: 0, updated: 0, errors: 0 },
        products: { created: 0, existing: 0 },
        loans: { created: 0, updated: 0, errors: 0 },
        repayments: { created: 0, errors: 0 },
        restructureChains: 0
      };

      // Build borrower lookup map
      const borrowerMap = {};
      let existingBorrowersList = await api.entities.Borrower.list();

      // Step 2: Import borrowers
      if (borrowersData?.data?.length > 0) {
        addLog(`Importing ${borrowersData.data.length} borrowers...`);
        const total = borrowersData.data.length;

        for (let i = 0; i < borrowersData.data.length; i++) {
          // Check for cancellation
          if (cancelRef.current) {
            addLog('Import cancelled by user');
            throw new Error('Import cancelled');
          }

          const row = borrowersData.data[i];
          const borrowerData = transformBorrower(row);

          setProgress({
            stage: 'Importing borrowers',
            current: i + 1,
            total,
            percent: 10 + (i / total) * 20
          });

          try {
            // Skip only if we have no way to identify or name the borrower
            // Note: We do NOT use email as a unique identifier - multiple borrowers can share the same email
            if (!borrowerData.unique_number && !borrowerData.full_name && !borrowerData.business) {
              continue;
            }

            // Check for existing borrower - ONLY match on unique_number
            // Email is NOT a unique identifier - multiple borrowers can legitimately share the same email/contact_email
            const existing = borrowerData.unique_number
              ? existingBorrowersList.find(b => b.unique_number === borrowerData.unique_number)
              : null;

            // Filter to only valid database fields
            const filteredBorrowerData = filterFields(borrowerData, VALID_BORROWER_FIELDS);

            if (existing) {
              await api.entities.Borrower.update(existing.id, filteredBorrowerData);
              borrowerMap[borrowerData.unique_number] = existing.id;
              result.borrowers.updated++;
            } else {
              const created = await api.entities.Borrower.create(filteredBorrowerData);
              borrowerMap[borrowerData.unique_number] = created.id;
              existingBorrowersList.push(created);
              result.borrowers.created++;
            }
          } catch (err) {
            result.borrowers.errors++;
            addLog(`  Error importing borrower ${borrowerData.unique_number}: ${err.message}`);
          }
        }
        addLog(`Borrowers: ${result.borrowers.created} created, ${result.borrowers.updated} updated`);
      }

      // Build product lookup map
      const productMap = {};
      let existingProductsList = await api.entities.LoanProduct.list();

      // Step 3: Import loans
      const loanMap = {}; // loan_number -> loan record
      if (loansData?.data?.length > 0) {
        addLog(`Importing ${loansData.data.length} loans...`);

        // First pass: collect unique products
        const uniqueProducts = new Set();
        loansData.data.forEach(row => {
          const product = row['Loan Product']?.trim();
          if (product) uniqueProducts.add(product);
        });

        // Create missing products
        addLog(`  Processing ${uniqueProducts.size} loan products...`);
        for (const productName of uniqueProducts) {
          const existing = existingProductsList.find(p => p.name === productName);
          if (existing) {
            productMap[productName] = existing;
            result.products.existing++;
          } else {
            // Create with sensible defaults
            const newProduct = await api.entities.LoanProduct.create({
              name: productName,
              interest_rate: 10,
              interest_type: 'Interest-Only',
              period: 'Monthly',
              product_type: 'Standard'
            });
            productMap[productName] = newProduct;
            existingProductsList.push(newProduct);
            result.products.created++;
            addLog(`    Created product: ${productName}`);
          }
        }

        // Second pass: import loans
        const total = loansData.data.length;
        let existingLoansList = await api.entities.Loan.list();

        for (let i = 0; i < loansData.data.length; i++) {
          // Check for cancellation
          if (cancelRef.current) {
            addLog('Import cancelled by user');
            throw new Error('Import cancelled');
          }

          const row = loansData.data[i];
          let filteredLoanData = null; // Declare outside try for error logging

          setProgress({
            stage: 'Importing loans',
            current: i + 1,
            total,
            percent: 30 + (i / total) * 35
          });

          try {
            let rawLoanNumber = row['Loan #']?.trim() || '';
            const borrowerNumber = row['Borrower #']?.trim();

            if (!rawLoanNumber) continue;

            // Parse composite loan number format like "1000121, R:1000120"
            // Extract primary loan number (first part before comma)
            let loanNumber = rawLoanNumber;
            let restructuredFromNumber = null;
            if (rawLoanNumber.includes(',')) {
              const parts = rawLoanNumber.split(',').map(p => p.trim());
              loanNumber = parts[0]; // Primary loan number
              // Check for "R:XXXX" restructure reference
              for (const part of parts.slice(1)) {
                if (part.startsWith('R:')) {
                  restructuredFromNumber = part.substring(2).trim();
                }
              }
            }

            // Find borrower
            let borrowerId = borrowerMap[borrowerNumber];
            if (!borrowerId) {
              // Try to find in existing borrowers
              const existingBorrower = existingBorrowersList.find(b => b.unique_number === borrowerNumber);
              if (existingBorrower) {
                borrowerId = existingBorrower.id;
                borrowerMap[borrowerNumber] = borrowerId;
              }
            }

            // Get product
            const productName = row['Loan Product']?.trim();
            const product = productMap[productName];

            // Parse interest rate
            const rateInfo = parseInterestRate(row['Interest Rate']);

            // Only use Loan Title as description - nothing else
            const loanTitle = row['Loan Title']?.trim() || '';
            const maturityDate = parseDate(row['Maturity Date']);

            // Calculate duration from start date and maturity date if possible
            const startDate = parseDate(row['Released Date']);
            let duration = 12; // Default to 12 months
            if (startDate && maturityDate) {
              const start = new Date(startDate);
              const end = new Date(maturityDate);
              const monthsDiff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
              if (monthsDiff > 0) {
                duration = monthsDiff;
              }
            }

            // Build loan data
            // Parse gross principal and arrangement fee from CSV
            const grossPrincipal = parseAmount(row['Principal Amount']);
            const arrangementFee = parseAmount(row['Deductable Fees']) || parseAmount(row['Arragement Fee']) || 0;

            // principal_amount should be what the borrower owes (net amount after fees deducted upfront)
            // If there's an arrangement fee that was deducted, the borrower only received and owes the net amount
            const netPrincipal = grossPrincipal - arrangementFee;

            const loanData = {
              loan_number: loanNumber,
              borrower_id: borrowerId,
              borrower_name: row['Business Name']?.trim() || row['Full Name']?.trim(),
              product_id: product?.id,
              product_name: product?.name,
              principal_amount: netPrincipal > 0 ? netPrincipal : grossPrincipal, // Use net if fee was deducted, otherwise gross
              start_date: startDate,
              duration: duration,
              status: mapLoanStatus(row['Loan Status Name']),
              description: loanTitle,
              arrangement_fee: arrangementFee,
              exit_fee: parseAmount(row['Facility Exit Fee']),
              override_interest_rate: rateInfo.rate > 0,
              overridden_rate: rateInfo.rate,
              restructured_from_loan_number: restructuredFromNumber || null
            };

            // net_disbursed = amount actually sent to borrower (same as principal_amount when fee is deducted)
            loanData.net_disbursed = loanData.principal_amount;

            // Filter to only valid database fields
            filteredLoanData = filterFields(loanData, VALID_LOAN_FIELDS);

            // Debug logging for specific loan
            const isDebugLoan = debugLoanNumber && (loanNumber === debugLoanNumber || rawLoanNumber.includes(debugLoanNumber));
            if (isDebugLoan) {
              addLog(`[DEBUG LOAN ${loanNumber}] === RAW CSV DATA ===`);
              addLog(`  Raw Loan #: "${rawLoanNumber}"`);
              addLog(`  Borrower #: "${borrowerNumber}"`);
              addLog(`  Business Name: "${row['Business Name']?.trim() || ''}"`);
              addLog(`  Principal Amount (CSV): "${row['Principal Amount']}" → gross: ${grossPrincipal}`);
              addLog(`  Deductable Fees (CSV): "${row['Deductable Fees'] || row['Arragement Fee']}" → fee: ${arrangementFee}`);
              addLog(`  Calculated: gross ${grossPrincipal} - fee ${arrangementFee} = net ${netPrincipal}`);
              addLog(`  Final principal_amount: ${loanData.principal_amount}`);
              addLog(`  Interest Rate: "${row['Interest Rate']}" → parsed as ${rateInfo.rate}% (converted: ${rateInfo.wasConverted})`);
              addLog(`  Released Date: "${row['Released Date']}" → "${startDate}"`);
              addLog(`  Maturity Date: "${row['Maturity Date']}" → "${maturityDate}"`);
              addLog(`  Loan Status Name: "${row['Loan Status Name']}" → "${loanData.status}"`);
              addLog(`  Loan Product: "${productName}" → product_id: ${product?.id}`);
              addLog(`  Duration calculated: ${duration} months`);
              addLog(`  Restructured From: ${restructuredFromNumber || 'none'}`);
              addLog(`[DEBUG LOAN ${loanNumber}] === LOAN DATA TO SAVE ===`);
              Object.entries(filteredLoanData).forEach(([key, value]) => {
                addLog(`  ${key}: ${JSON.stringify(value)}`);
              });
              addLog(`  borrower_id found: ${borrowerId ? 'yes' : 'NO - MISSING!'}`);
            }

            // Check for existing loan
            const existingLoan = existingLoansList.find(l => l.loan_number === loanNumber);

            if (existingLoan) {
              await api.entities.Loan.update(existingLoan.id, filteredLoanData);
              loanMap[loanNumber] = { ...existingLoan, ...filteredLoanData };
              result.loans.updated++;
              if (isDebugLoan) {
                addLog(`[DEBUG LOAN ${loanNumber}] Updated existing loan (id: ${existingLoan.id})`);
              }
            } else {
              const created = await api.entities.Loan.create(filteredLoanData);
              loanMap[loanNumber] = created;
              existingLoansList.push(created);
              result.loans.created++;
              if (isDebugLoan) {
                addLog(`[DEBUG LOAN ${loanNumber}] Created new loan (id: ${created.id})`);
              }

              // Create initial Disbursement transaction if loan is released (has start_date)
              if (created.start_date && created.status !== 'Pending') {
                const disbursementAmount = created.net_disbursed ||
                  (created.principal_amount - (created.arrangement_fee || 0));
                if (disbursementAmount > 0) {
                  await api.entities.Transaction.create({
                    loan_id: created.id,
                    borrower_id: created.borrower_id,
                    date: created.start_date,
                    type: 'Disbursement',
                    amount: disbursementAmount,
                    principal_applied: disbursementAmount,
                    interest_applied: 0,
                    fees_applied: 0,
                    notes: 'Initial loan disbursement (import)'
                  });
                  if (isDebugLoan) {
                    addLog(`[DEBUG LOAN ${loanNumber}] Created Disbursement transaction: ${disbursementAmount}`);
                  }
                }
              }
            }
          } catch (err) {
            result.loans.errors++;
            console.error('Loan import error:', err, 'Data:', filteredLoanData);
            addLog(`  Error importing loan ${row['Loan #']}: ${err.message}`);
            if (debugLoanNumber && row['Loan #']?.includes(debugLoanNumber)) {
              addLog(`[DEBUG LOAN] Error details: ${err.stack || err.message}`);
            }
          }
        }
        addLog(`Loans: ${result.loans.created} created, ${result.loans.updated} updated`);
        addLog(`Products: ${result.products.created} created, ${result.products.existing} existing`);
      }

      // Step 4: Import repayments
      if (repaymentsData?.data?.length > 0) {
        addLog(`Importing ${repaymentsData.data.length} repayments...`);
        addLog(`  Loans in memory: ${Object.keys(loanMap).length} (${Object.keys(loanMap).slice(0, 5).join(', ')}${Object.keys(loanMap).length > 5 ? '...' : ''})`);
        const total = repaymentsData.data.length;
        let skippedNoLoan = 0;
        let skippedZeroAmount = 0;

        // Log the CSV headers for debugging
        addLog(`  CSV columns: ${repaymentsData.headers.join(', ')}`);

        // Log first few repayment loan numbers for debugging
        const firstFewRepayments = repaymentsData.data.slice(0, 5).map(r => {
          const transformed = transformRepayment(r);
          return transformed._loan_number || '(empty)';
        });
        addLog(`  First repayment loan #s: ${firstFewRepayments.join(', ')}`);

        for (let i = 0; i < repaymentsData.data.length; i++) {
          // Check for cancellation
          if (cancelRef.current) {
            addLog('Import cancelled by user');
            throw new Error('Import cancelled');
          }

          const row = repaymentsData.data[i];

          setProgress({
            stage: 'Importing repayments',
            current: i + 1,
            total,
            percent: 65 + (i / total) * 25
          });

          try {
            // Use the transformRepayment function which respects field mappings
            const repaymentData = transformRepayment(row);
            const loanNumber = repaymentData._loan_number;

            // Check if this is the debug loan
            const isDebugLoan = debugLoanNumber && loanNumber === debugLoanNumber;

            if (!loanNumber) {
              skippedNoLoan++;
              if (skippedNoLoan <= 3) {
                // Show what's in the row for debugging
                const rowKeys = Object.keys(row).filter(k => row[k] && row[k].trim());
                addLog(`  Row ${i + 1}: No loan number found. Row has: ${rowKeys.slice(0, 5).join(', ')}${rowKeys.length > 5 ? '...' : ''}`);
              }
              continue;
            }

            let targetLoan = loanMap[loanNumber];

            if (!targetLoan) {
              // Try to find in database
              const dbLoan = (await api.entities.Loan.filter({ loan_number: loanNumber }))[0];
              if (!dbLoan) {
                skippedNoLoan++;
                if (skippedNoLoan <= 5) {
                  addLog(`  Skipped: Loan ${loanNumber} not found`);
                }
                if (isDebugLoan) {
                  addLog(`[DEBUG REPAYMENT] Loan ${loanNumber} not found in loanMap or database!`);
                  addLog(`  loanMap keys: ${Object.keys(loanMap).slice(0, 10).join(', ')}...`);
                }
                continue;
              }
              loanMap[loanNumber] = dbLoan;
              targetLoan = dbLoan;
            }

            const principal = repaymentData.principal_applied || 0;
            const interest = repaymentData.interest_applied || 0;
            const penalty = repaymentData.penalty_applied || 0;
            const fees = repaymentData.fees_applied || 0;
            const totalAmount = principal + interest + penalty + fees;

            if (totalAmount <= 0) {
              skippedZeroAmount++;
              if (isDebugLoan) {
                addLog(`[DEBUG REPAYMENT] Row ${i + 1} skipped - zero amount (P:${principal} I:${interest} Pen:${penalty} F:${fees})`);
              }
              continue;
            }

            const transactionData = {
              loan_id: targetLoan.id,
              borrower_id: targetLoan.borrower_id,
              date: repaymentData.date,
              type: 'Repayment',
              amount: totalAmount,
              principal_applied: principal,
              interest_applied: interest,
              fees_applied: fees + penalty, // Include penalty in fees
              reference: repaymentData.method || 'Import',
              notes: repaymentData.description || 'Imported from Loandisc'
            };

            // Debug logging for specific loan repayments
            if (isDebugLoan) {
              addLog(`[DEBUG REPAYMENT ${loanNumber}] Row ${i + 1}: ${repaymentData.date}`);
              addLog(`  Raw CSV: Date="${row['Collection Date'] || row['Date']}", Principal="${row['Principal Paid Amount']}", Interest="${row['Interest Paid Amount']}"`);
              addLog(`  Parsed: Principal=${principal}, Interest=${interest}, Penalty=${penalty}, Fees=${fees}, Total=${totalAmount}`);
              addLog(`  Target loan: id=${targetLoan.id}, borrower_id=${targetLoan.borrower_id}`);
            }

            // Filter to only valid database fields
            const filteredTransactionData = filterFields(transactionData, VALID_TRANSACTION_FIELDS);
            await api.entities.Transaction.create(filteredTransactionData);

            if (isDebugLoan) {
              addLog(`[DEBUG REPAYMENT ${loanNumber}] Created transaction successfully`);
            }

            result.repayments.created++;
          } catch (err) {
            result.repayments.errors++;
            addLog(`  Error importing repayment row ${i + 1}: ${err.message}`);
            if (debugLoanNumber && row['Loan #']?.includes(debugLoanNumber)) {
              addLog(`[DEBUG REPAYMENT] Error details: ${err.stack || err.message}`);
            }
          }
        }
        addLog(`Repayments: ${result.repayments.created} created`);
        if (skippedNoLoan > 0) {
          addLog(`  Skipped ${skippedNoLoan} repayments (loan not found or no loan number)`);
        }
        if (skippedZeroAmount > 0) {
          addLog(`  Skipped ${skippedZeroAmount} repayments (zero amount)`);
        }
        if (result.repayments.errors > 0) {
          addLog(`  ${result.repayments.errors} repayments failed with errors`);
        }
      }

      // Step 5: Detect and link restructure chains
      setProgress({ stage: 'Detecting restructure chains', current: 0, total: 1, percent: 92 });
      addLog('Detecting restructure chains...');

      const allLoans = await api.entities.Loan.list();
      const restructuredLoans = allLoans.filter(l => l.status === 'Restructured');

      for (const sourceLoan of restructuredLoans) {
        // Find potential successor: same borrower, started after the source loan's start date
        // (since we don't have maturity_date, we use start_date as approximation)
        const sourceStartDate = sourceLoan.start_date ? new Date(sourceLoan.start_date) : null;
        if (!sourceStartDate) continue;

        const successor = allLoans.find(l =>
          l.borrower_id === sourceLoan.borrower_id &&
          l.id !== sourceLoan.id &&
          l.status !== 'Restructured' &&
          l.start_date &&
          new Date(l.start_date) > sourceStartDate
        );

        if (successor && !successor.restructured_from_loan_id) {
          await api.entities.Loan.update(successor.id, {
            restructured_from_loan_id: sourceLoan.id
          });
          result.restructureChains++;
          addLog(`  Linked: ${sourceLoan.loan_number} → ${successor.loan_number}`);
        }
      }

      if (result.restructureChains > 0) {
        addLog(`Restructure chains: ${result.restructureChains} linked`);
      }

      // Step 6: Enable auto-extend for all live loans
      const loansToProcess = await api.entities.Loan.list();
      const liveLoans = loansToProcess.filter(l => l.status === 'Live' || l.status === 'Pending');

      if (liveLoans.length > 0) {
        // Enable auto-extend for all live loans - batch update
        const loansNeedingAutoExtend = liveLoans.filter(l => !l.auto_extend);
        addLog(`Enabling auto-extend for ${loansNeedingAutoExtend.length} of ${liveLoans.length} active loans...`);

        setProgress({
          stage: 'Enabling auto-extend',
          current: 0,
          total: loansNeedingAutoExtend.length,
          percent: 92
        });

        // Update in parallel batches of 10
        const batchSize = 10;
        for (let i = 0; i < loansNeedingAutoExtend.length; i += batchSize) {
          const batch = loansNeedingAutoExtend.slice(i, i + batchSize);
          await Promise.all(batch.map(loan =>
            api.entities.Loan.update(loan.id, { auto_extend: true }).catch(err => {
              addLog(`  Error enabling auto-extend for loan ${loan.loan_number}: ${err.message}`);
            })
          ));
          setProgress({
            stage: 'Enabling auto-extend',
            current: Math.min(i + batchSize, loansNeedingAutoExtend.length),
            total: loansNeedingAutoExtend.length,
            percent: 92
          });
        }

        addLog(`Auto-extend: ${loansNeedingAutoExtend.length} loans updated`);

        // Re-fetch live loans to get updated auto_extend values
        const refreshedLoans = await api.entities.Loan.list();
        const refreshedLiveLoans = refreshedLoans.filter(l => l.status === 'Live' || l.status === 'Pending');

        // Step 7: Regenerate schedules for all live loans
        // Optimization: run in parallel batches to speed up
        addLog(`Regenerating schedules for ${refreshedLiveLoans.length} active loans...`);
        let schedulesGenerated = 0;
        let scheduleErrors = 0;

        // Process in parallel batches of 5 (to avoid overwhelming the database)
        const scheduleBatchSize = 5;
        for (let i = 0; i < refreshedLiveLoans.length; i += scheduleBatchSize) {
          const batch = refreshedLiveLoans.slice(i, i + scheduleBatchSize);

          setProgress({
            stage: 'Regenerating schedules',
            current: i,
            total: refreshedLiveLoans.length,
            percent: 93 + (i / refreshedLiveLoans.length) * 6
          });

          const results = await Promise.allSettled(
            batch.map(async (loan) => {
              const isDebugLoan = debugLoanNumber && loan.loan_number === debugLoanNumber;
              if (isDebugLoan) {
                addLog(`[DEBUG SCHEDULE ${loan.loan_number}] Starting schedule regeneration...`);
                addLog(`  Loan: id=${loan.id}, auto_extend=${loan.auto_extend}, duration=${loan.duration}, status=${loan.status}`);
              }
              const scheduleResult = await regenerateLoanSchedule(loan.id, { endDate: new Date(), skipDisbursement: true });
              if (isDebugLoan) {
                addLog(`[DEBUG SCHEDULE ${loan.loan_number}] Generated ${scheduleResult.schedule.length} schedule entries`);
                addLog(`  Total interest: ${scheduleResult.summary.totalInterest}, Total repayable: ${scheduleResult.summary.totalRepayable}`);
                scheduleResult.schedule.forEach((entry, entryIdx) => {
                  addLog(`  [${entryIdx + 1}] ${entry.due_date}: Interest=${entry.interest_amount}, Principal=${entry.principal_amount}, Extension=${entry.is_extension_period}`);
                });
              }
              return scheduleResult;
            })
          );

          results.forEach((result, idx) => {
            const loan = batch[idx];
            if (result.status === 'fulfilled') {
              schedulesGenerated++;
            } else {
              scheduleErrors++;
              addLog(`  Error regenerating schedule for loan ${loan.loan_number}: ${result.reason?.message || 'Unknown error'}`);
              if (debugLoanNumber && loan.loan_number === debugLoanNumber) {
                addLog(`[DEBUG SCHEDULE] Error details: ${result.reason?.stack || result.reason?.message}`);
              }
            }
          });
        }

        setProgress({
          stage: 'Regenerating schedules',
          current: refreshedLiveLoans.length,
          total: refreshedLiveLoans.length,
          percent: 99
        });

        addLog(`Schedules: ${schedulesGenerated} regenerated${scheduleErrors > 0 ? `, ${scheduleErrors} errors` : ''}`);
      }

      setProgress({ stage: 'Complete', current: 1, total: 1, percent: 100 });
      setImportResult(result);
      addLog('Import completed successfully!');

      // Log the bulk import
      logBulkImportEvent(AuditAction.BULK_IMPORT_LOANS, 'loandisc', {
        borrowers: result.borrowers,
        loans: result.loans,
        repayments: result.repayments,
        products: result.products,
        restructureChains: result.restructureChains
      });

      // Mark queries as stale - they'll refetch when the user navigates to those pages
      // Using refetchType: 'none' prevents immediate refetching which would block the UI
      queryClient.invalidateQueries({ queryKey: ['borrowers'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['loans'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['transactions'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['all-transactions'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['loan-products'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['schedules'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['all-schedules'], refetchType: 'none' });

    } catch (err) {
      console.error('Import error:', err);
      setImportError(err.message);
      addLog(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const steps = ['options', 'borrowers', 'loans', 'repayments', 'review'];
  const stepLabels = {
    options: 'Options',
    borrowers: 'Borrowers',
    loans: 'Loans',
    repayments: 'Repayments',
    review: 'Import'
  };
  const currentStepIndex = steps.indexOf(step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <Link to={createPageUrl('Config')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Settings
          </Button>
        </Link>

        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Loandisc Import</h1>
          <p className="text-slate-500 mt-1">Import borrowers, loans, and repayments from Loandisc CSV exports</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center">
              <button
                onClick={() => !importing && setStep(s)}
                disabled={importing}
                className={`px-3 py-1 rounded-full transition-colors ${
                  step === s ? 'bg-slate-900 text-white' :
                    currentStepIndex > i
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-slate-100 text-slate-500'
                } ${importing ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {i + 1}. {stepLabels[s]}
              </button>
              {i < steps.length - 1 && <ChevronRight className="w-4 h-4 text-slate-400 mx-1" />}
            </div>
          ))}
        </div>

        {/* Step 1: Options */}
        {step === 'options' && (
          <Card>
            <CardHeader>
              <CardTitle>Import Options</CardTitle>
              <CardDescription>Configure import settings before uploading files</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Debug loan number input */}
              <div className="p-4 border rounded-lg bg-slate-50 border-slate-200">
                <label htmlFor="debug-loan" className="block font-medium text-slate-700 mb-2">
                  Debug Loan Number (optional)
                </label>
                <Input
                  id="debug-loan"
                  type="text"
                  placeholder="e.g., 1000017"
                  value={debugLoanNumber}
                  onChange={(e) => setDebugLoanNumber(e.target.value.trim())}
                  className="max-w-xs"
                />
                <p className="text-sm text-slate-500 mt-1">
                  Enter a loan number to see detailed logging for that specific loan during import.
                </p>
              </div>

              <Alert>
                <FileText className="w-4 h-4" />
                <AlertDescription>
                  <strong>Expected CSV files from Loandisc:</strong>
                  <ul className="mt-2 space-y-1 text-sm">
                    <li>• <strong>Borrowers</strong> - Contains borrower details (name, address, contact info)</li>
                    <li>• <strong>Loans</strong> - Contains loan details (principal, dates, status, rates)</li>
                    <li>• <strong>Repayments</strong> - Contains payment transactions (principal, interest, fees paid)</li>
                  </ul>
                </AlertDescription>
              </Alert>

              {/* Previously loaded files summary */}
              {(borrowersFile || loansFile || repaymentsFile) && (
                <div className="p-4 border rounded-lg bg-blue-50 border-blue-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-blue-900">Previously loaded files:</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAllFileSelections}
                      className="text-xs text-blue-600 hover:text-red-600"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Clear all files
                    </Button>
                  </div>
                  <ul className="text-sm text-blue-800 space-y-1">
                    {borrowersFile && (
                      <li className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        {borrowersFile.name} ({borrowersData?.data?.length || 0} rows)
                      </li>
                    )}
                    {loansFile && (
                      <li className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {loansFile.name} ({loansData?.data?.length || 0} rows)
                      </li>
                    )}
                    {repaymentsFile && (
                      <li className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4" />
                        {repaymentsFile.name} ({repaymentsData?.data?.length || 0} rows)
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={() => setStep('borrowers')}>
                  Next: Upload Borrowers
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Borrowers */}
        {step === 'borrowers' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Upload Borrowers CSV
              </CardTitle>
              <CardDescription>Upload the borrowers export file from Loandisc</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center relative">
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => handleFileUpload('borrowers', e.target.files[0])}
                  className="hidden"
                  id="borrowers-upload"
                />
                <label htmlFor="borrowers-upload" className="cursor-pointer">
                  <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600 mb-1">
                    {borrowersFile ? borrowersFile.name : 'Click to upload borrowers CSV'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {borrowersData ? `${borrowersData.data.length} rows found` : 'borrowers_branch1.csv'}
                  </p>
                  {borrowersFile?.fromStorage && (
                    <Badge variant="outline" className="mt-2 text-xs text-blue-600 border-blue-300">
                      Restored from previous session
                    </Badge>
                  )}
                </label>
                {borrowersFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.preventDefault(); clearFileSelection('borrowers'); }}
                    className="absolute top-2 right-2 h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {/* Field Mapping Section */}
              {borrowersData && (
                <div className="border rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => setShowMappings(prev => ({ ...prev, borrowers: !prev.borrowers }))}
                      className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      <Settings2 className="w-4 h-4" />
                      Field Mappings
                      <ChevronRight className={`w-4 h-4 transition-transform ${showMappings.borrowers ? 'rotate-90' : ''}`} />
                    </button>
                    {showMappings.borrowers && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetMappings('borrowers')}
                        className="text-xs text-slate-500"
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset to defaults
                      </Button>
                    )}
                  </div>
                  {showMappings.borrowers && (
                    <FieldMapper
                      csvHeaders={borrowersData.headers}
                      mappings={borrowerMappings}
                      onChange={updateBorrowerMapping}
                      fieldOptions={BORROWER_FIELD_OPTIONS}
                      sampleData={borrowersData.data[0]}
                    />
                  )}
                </div>
              )}

              {borrowersData && borrowerPreview.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Preview (first 10 rows after mapping):</p>
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Unique #</TableHead>
                          <TableHead>Business/Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {borrowerPreview.map((b, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{b.unique_number}</TableCell>
                            <TableCell>{b.business || b.full_name}</TableCell>
                            <TableCell className="text-xs">{b.email}</TableCell>
                            <TableCell className="text-xs">{b.phone}</TableCell>
                            <TableCell>{b.city}</TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-32 truncate">{b.notes}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Badge className="mt-2" variant="secondary">
                    {borrowersData.data.length} borrowers ready to import
                  </Badge>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('options')}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button onClick={() => setStep('loans')}>
                  Next: Upload Loans
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Loans */}
        {step === 'loans' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-600" />
                Upload Loans CSV
              </CardTitle>
              <CardDescription>Upload the loans export file from Loandisc</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center relative">
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => handleFileUpload('loans', e.target.files[0])}
                  className="hidden"
                  id="loans-upload"
                />
                <label htmlFor="loans-upload" className="cursor-pointer">
                  <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600 mb-1">
                    {loansFile ? loansFile.name : 'Click to upload loans CSV'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {loansData ? `${loansData.data.length} rows found` : 'loans_branch1.csv'}
                  </p>
                  {loansFile?.fromStorage && (
                    <Badge variant="outline" className="mt-2 text-xs text-blue-600 border-blue-300">
                      Restored from previous session
                    </Badge>
                  )}
                </label>
                {loansFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.preventDefault(); clearFileSelection('loans'); }}
                    className="absolute top-2 right-2 h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {/* Field Mapping Section */}
              {loansData && (
                <div className="border rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => setShowMappings(prev => ({ ...prev, loans: !prev.loans }))}
                      className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      <Settings2 className="w-4 h-4" />
                      Field Mappings
                      <ChevronRight className={`w-4 h-4 transition-transform ${showMappings.loans ? 'rotate-90' : ''}`} />
                    </button>
                    {showMappings.loans && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetMappings('loans')}
                        className="text-xs text-slate-500"
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset to defaults
                      </Button>
                    )}
                  </div>
                  {showMappings.loans && (
                    <FieldMapper
                      csvHeaders={loansData.headers}
                      mappings={loanMappings}
                      onChange={updateLoanMapping}
                      fieldOptions={LOAN_FIELD_OPTIONS}
                      sampleData={loansData.data[0]}
                    />
                  )}
                </div>
              )}

              {loansData && loanPreview.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Preview (first 10 rows after mapping):</p>
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Loan #</TableHead>
                          <TableHead>Borrower</TableHead>
                          <TableHead>Principal</TableHead>
                          <TableHead>Start Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loanPreview.map((l, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{l.loan_number}</TableCell>
                            <TableCell>{l.borrower_name}</TableCell>
                            <TableCell className="font-mono">{formatCurrency(l.principal_amount)}</TableCell>
                            <TableCell className="text-xs">{l.start_date}</TableCell>
                            <TableCell>
                              <Badge variant={l.status === 'Fully Paid' ? 'default' : 'secondary'}>
                                {l.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-32 truncate">{l.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Badge className="mt-2" variant="secondary">
                    {loansData.data.length} loans ready to import
                  </Badge>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('borrowers')}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button onClick={() => setStep('repayments')}>
                  Next: Upload Repayments
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Repayments */}
        {step === 'repayments' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-purple-600" />
                Upload Repayments CSV
              </CardTitle>
              <CardDescription>Upload the repayments export file from Loandisc</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center relative">
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => handleFileUpload('repayments', e.target.files[0])}
                  className="hidden"
                  id="repayments-upload"
                />
                <label htmlFor="repayments-upload" className="cursor-pointer">
                  <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                  <p className="text-sm text-slate-600 mb-1">
                    {repaymentsFile ? repaymentsFile.name : 'Click to upload repayments CSV'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {repaymentsData ? `${repaymentsData.data.length} rows found` : 'repayments_branch1.csv'}
                  </p>
                  {repaymentsFile?.fromStorage && (
                    <Badge variant="outline" className="mt-2 text-xs text-blue-600 border-blue-300">
                      Restored from previous session
                    </Badge>
                  )}
                </label>
                {repaymentsFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.preventDefault(); clearFileSelection('repayments'); }}
                    className="absolute top-2 right-2 h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {/* Field Mapping Section */}
              {repaymentsData && (
                <div className="border rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => setShowMappings(prev => ({ ...prev, repayments: !prev.repayments }))}
                      className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      <Settings2 className="w-4 h-4" />
                      Field Mappings
                      <ChevronRight className={`w-4 h-4 transition-transform ${showMappings.repayments ? 'rotate-90' : ''}`} />
                    </button>
                    {showMappings.repayments && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetMappings('repayments')}
                        className="text-xs text-slate-500"
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Reset to defaults
                      </Button>
                    )}
                  </div>
                  {showMappings.repayments && (
                    <FieldMapper
                      csvHeaders={repaymentsData.headers}
                      mappings={repaymentMappings}
                      onChange={updateRepaymentMapping}
                      fieldOptions={REPAYMENT_FIELD_OPTIONS}
                      sampleData={repaymentsData.data[0]}
                    />
                  )}
                </div>
              )}

              {repaymentsData && repaymentPreview.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Preview (first 10 rows after mapping):</p>
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Loan #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Principal</TableHead>
                          <TableHead>Interest</TableHead>
                          <TableHead>Fees</TableHead>
                          <TableHead>Method</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {repaymentPreview.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{r._loan_number}</TableCell>
                            <TableCell className="text-xs">{r.date}</TableCell>
                            <TableCell className="font-mono text-emerald-600">
                              {r.principal_applied > 0 ? formatCurrency(r.principal_applied) : '-'}
                            </TableCell>
                            <TableCell className="font-mono text-blue-600">
                              {r.interest_applied > 0 ? formatCurrency(r.interest_applied) : '-'}
                            </TableCell>
                            <TableCell className="font-mono">
                              {r.fees_applied > 0 ? formatCurrency(r.fees_applied) : '-'}
                            </TableCell>
                            <TableCell className="text-xs">{r.method}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Badge className="mt-2" variant="secondary">
                    {repaymentsData.data.length} repayments ready to import
                  </Badge>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('loans')}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button onClick={() => setStep('review')}>
                  Next: Review & Import
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Review & Import */}
        {step === 'review' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Review Import</CardTitle>
                <CardDescription>Review your import settings before proceeding</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg text-center">
                    <Users className="w-6 h-6 mx-auto text-blue-600 mb-2" />
                    <p className="text-2xl font-bold text-blue-700">{summary.borrowers}</p>
                    <p className="text-sm text-blue-600">Borrowers</p>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-lg text-center">
                    <FileText className="w-6 h-6 mx-auto text-emerald-600 mb-2" />
                    <p className="text-2xl font-bold text-emerald-700">{summary.loans}</p>
                    <p className="text-sm text-emerald-600">Loans</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg text-center">
                    <CreditCard className="w-6 h-6 mx-auto text-purple-600 mb-2" />
                    <p className="text-2xl font-bold text-purple-700">{summary.repayments}</p>
                    <p className="text-sm text-purple-600">Repayments</p>
                  </div>
                </div>

                <Alert className="border-blue-200 bg-blue-50">
                  <Link2 className="w-4 h-4 text-blue-600" />
                  <AlertDescription className="text-blue-800">
                    <strong>Restructure chains:</strong> Loans with "Restructured" status will automatically be linked to their successor loans.
                  </AlertDescription>
                </Alert>

                {summary.borrowers === 0 && summary.loans === 0 && summary.repayments === 0 && (
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <AlertDescription className="text-amber-800">
                      No files have been uploaded. Please go back and upload at least one CSV file.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex justify-between pt-4">
                  <Button variant="outline" onClick={() => setStep('repayments')}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={importing || (summary.borrowers === 0 && summary.loans === 0 && summary.repayments === 0)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Import
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Progress */}
            {importing && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Import Progress</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelImport}
                      disabled={cancelled}
                      className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      {cancelled ? 'Cancelling...' : 'Cancel Import'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{progress.stage}</span>
                      <span className="text-slate-500">
                        {progress.current} / {progress.total}
                      </span>
                    </div>
                    <Progress value={progress.percent} className="h-2" />
                  </div>
                  {cancelled && (
                    <Alert className="border-amber-200 bg-amber-50">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      <AlertDescription className="text-amber-800">
                        Cancellation requested. The import will stop after the current operation completes.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Result */}
            {importResult && (
              <Card className="border-emerald-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-emerald-700">
                    <CheckCircle2 className="w-5 h-5" />
                    Import Complete
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 bg-emerald-50 rounded-lg">
                      <p className="text-lg font-bold text-emerald-700">
                        {importResult.borrowers.created}
                      </p>
                      <p className="text-xs text-emerald-600">Borrowers Created</p>
                      {importResult.borrowers.updated > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                          ({importResult.borrowers.updated} updated)
                        </p>
                      )}
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-lg">
                      <p className="text-lg font-bold text-emerald-700">
                        {importResult.loans.created}
                      </p>
                      <p className="text-xs text-emerald-600">Loans Created</p>
                      {importResult.loans.updated > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                          ({importResult.loans.updated} updated)
                        </p>
                      )}
                    </div>
                    <div className="p-3 bg-emerald-50 rounded-lg">
                      <p className="text-lg font-bold text-emerald-700">
                        {importResult.repayments.created}
                      </p>
                      <p className="text-xs text-emerald-600">Repayments Created</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-lg font-bold text-blue-700">
                        {importResult.restructureChains}
                      </p>
                      <p className="text-xs text-blue-600">Restructure Chains</p>
                    </div>
                  </div>

                  {importResult.products.created > 0 && (
                    <p className="text-sm text-slate-600 mt-4">
                      {importResult.products.created} new loan products were created automatically.
                    </p>
                  )}

                  <div className="flex gap-3 mt-6">
                    <Button onClick={() => navigate(createPageUrl('Loans'))}>
                      View Loans
                    </Button>
                    <Button variant="outline" onClick={() => navigate(createPageUrl('Borrowers'))}>
                      View Borrowers
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Error */}
            {importError && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <strong>Import failed:</strong> {importError}
                </AlertDescription>
              </Alert>
            )}

            {/* Logs */}
            {logs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Import Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-slate-50 rounded-lg p-3 max-h-64 overflow-y-auto">
                    <div className="space-y-1 text-xs text-slate-600 font-mono">
                      {logs.map((log, i) => (
                        <div key={i}>{log}</div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
