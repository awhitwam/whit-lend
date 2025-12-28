import { useState, useMemo } from 'react';
import { api } from '@/api/dataClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText
} from 'lucide-react';
import { formatCurrency } from './LoanCalculator';
import { toast } from 'sonner';

// CSV parsing utility
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    data.push(row);
  }

  return { headers, data };
}

// Extract loan number from text like "Sean Flatley - Loan #1000120"
function extractLoanNumber(text) {
  if (!text) return null;
  // Try to find patterns like "#1000120" or "Loan #1000120" or "Loan 1000120"
  const patterns = [
    /#(\d{5,})/,           // #1000120
    /Loan\s*#?\s*(\d{5,})/i, // Loan #1000120 or Loan 1000120
    /Account\s*#?\s*(\d{5,})/i, // Account #1000120
    /\b(\d{7})\b/           // Just a 7-digit number (common loan number format)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Auto-detect column mapping based on common header names
function autoDetectColumns(headers) {
  const mapping = {
    loanNumber: '',
    loanNumberExtract: false, // Flag to indicate we need to extract from description
    date: '',
    type: '',
    amount: '',
    amountIn: '',
    amountOut: '',
    principal: '',
    interest: '',
    fees: '',
    description: ''
  };

  console.log('CSV Headers:', headers);
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  // Find loan number column - try multiple patterns
  const loanPatterns = ['loan', 'account', 'acct', 'acc no', 'accno', 'loan_number', 'loannumber', 'loan no', 'loanno'];
  for (const pattern of loanPatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern) && !h.includes('detail') && !h.includes('desc'));
    if (idx !== -1) {
      mapping.loanNumber = headers[idx];
      break;
    }
  }

  // Find description/details column (may contain loan number)
  const descPatterns = ['transaction details', 'details', 'description', 'narrative', 'particulars', 'category'];
  for (const pattern of descPatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.description = headers[idx];
      // If no dedicated loan number column, extract from description
      if (!mapping.loanNumber) {
        mapping.loanNumber = headers[idx];
        mapping.loanNumberExtract = true;
        console.log('Will extract loan number from:', headers[idx]);
      }
      break;
    }
  }

  // Find date column
  const datePatterns = ['date', 'trans_date', 'transaction_date', 'transdate', 'dt'];
  for (const pattern of datePatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.date = headers[idx];
      break;
    }
  }

  // Find type column
  const typePatterns = ['type', 'transaction_type', 'trans_type', 'trans type', 'category'];
  for (const pattern of typePatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern) && !h.includes('amount'));
    if (idx !== -1 && headers[idx] !== mapping.description) {
      mapping.type = headers[idx];
      break;
    }
  }

  // Find In/Out columns (bank statement format)
  const inIdx = lowerHeaders.findIndex(h => h === 'in' || h === 'credit' || h === 'cr');
  const outIdx = lowerHeaders.findIndex(h => h === 'out' || h === 'debit' || h === 'dr');
  if (inIdx !== -1) mapping.amountIn = headers[inIdx];
  if (outIdx !== -1) mapping.amountOut = headers[outIdx];

  // Find amount column
  const amountPatterns = ['amount', 'value', 'sum', 'total', 'amt'];
  for (const pattern of amountPatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern) && !h.includes('principal') && !h.includes('interest') && !h.includes('fee'));
    if (idx !== -1) {
      mapping.amount = headers[idx];
      break;
    }
  }

  // Find principal column
  const principalPatterns = ['principal', 'capital', 'prin', 'cap'];
  for (const pattern of principalPatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.principal = headers[idx];
      break;
    }
  }

  // Find interest column
  const interestPatterns = ['interest', 'int'];
  for (const pattern of interestPatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.interest = headers[idx];
      break;
    }
  }

  // Find fees column
  const feePatterns = ['fee', 'charge', 'penalty', 'charges'];
  for (const pattern of feePatterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern));
    if (idx !== -1) {
      mapping.fees = headers[idx];
      break;
    }
  }

  console.log('Detected mapping:', mapping);
  return mapping;
}

// Date parsing utility
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Try DD/MM/YYYY first (UK format)
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const [, day, month, year] = ukMatch;
    return new Date(year, month - 1, day).toISOString().split('T')[0];
  }

  // Try ISO format
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return dateStr;
  }

  // Fallback to Date parsing
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

// Amount parsing utility
function parseAmount(amountStr) {
  if (!amountStr) return 0;
  const cleaned = amountStr.replace(/[£$,\s]/g, '').replace(/\((.+)\)/, '-$1');
  const amount = parseFloat(cleaned);
  return isNaN(amount) ? 0 : amount;
}

const STEPS = ['upload', 'sources', 'preview'];
const STEP_LABELS = {
  upload: 'Upload CSV',
  sources: 'Select Source Loans',
  preview: 'Preview & Import'
};

export default function ImportRestructureModal({
  isOpen,
  onClose,
  loan,
  onImportComplete
}) {
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [columnMapping, setColumnMapping] = useState(null);
  const [selectedSourceLoans, setSelectedSourceLoans] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Handle file selection
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setCsvData(null);
    setColumnMapping(null);
    setImportResult(null);

    if (selectedFile) {
      selectedFile.text().then(text => {
        const parsed = parseCSV(text);
        setCsvData(parsed);

        // Auto-detect columns
        const detected = autoDetectColumns(parsed.headers);
        setColumnMapping(detected);

        // Auto-advance to source selection
        setStep('sources');
      });
    }
  };

  // Helper to get loan number from a row (handles extraction if needed)
  const getLoanNumberFromRow = (row) => {
    if (!columnMapping?.loanNumber) return null;
    const rawValue = row[columnMapping.loanNumber];
    if (!rawValue) return null;

    if (columnMapping.loanNumberExtract) {
      return extractLoanNumber(rawValue);
    }
    return rawValue.trim();
  };

  // Get unique loan numbers from CSV (excluding current loan)
  const csvLoanNumbers = useMemo(() => {
    if (!csvData || !columnMapping?.loanNumber) {
      console.log('No CSV data or loan number column', { csvData: !!csvData, loanNumberCol: columnMapping?.loanNumber });
      return [];
    }
    const numbers = new Set();
    csvData.data.forEach((row, idx) => {
      const loanNum = getLoanNumberFromRow(row);
      if (idx < 3) console.log(`Row ${idx} loan number:`, loanNum, 'from:', row[columnMapping.loanNumber], 'Current loan:', loan?.loan_number);
      if (loanNum && loanNum !== loan?.loan_number) {
        numbers.add(loanNum);
      }
    });
    console.log('Found loan numbers:', Array.from(numbers));
    return Array.from(numbers).sort();
  }, [csvData, columnMapping, loan?.loan_number]);

  // Get transaction count per loan number
  const getTransactionCount = (loanNumber) => {
    if (!csvData || !columnMapping?.loanNumber) return 0;
    return csvData.data.filter(row => getLoanNumberFromRow(row) === loanNumber).length;
  };

  // Toggle source loan selection
  const toggleSourceLoan = (loanNumber, checked) => {
    if (checked) {
      setSelectedSourceLoans([...selectedSourceLoans, loanNumber]);
    } else {
      setSelectedSourceLoans(selectedSourceLoans.filter(n => n !== loanNumber));
    }
  };

  // Transform CSV row to transaction
  const transformTransaction = (row) => {
    const sourceLoanNumber = getLoanNumberFromRow(row);

    // Only include if source loan is selected
    if (!sourceLoanNumber || !selectedSourceLoans.includes(sourceLoanNumber)) return null;

    const rawType = row[columnMapping.type] || '';
    let type = 'Other';
    let principalApplied = 0;
    let interestApplied = 0;
    let feeApplied = 0;

    // Get amount from In/Out columns or Amount column
    let rowAmount = 0;
    if (columnMapping.amountIn || columnMapping.amountOut) {
      // Bank statement format with In/Out columns
      const inAmount = parseAmount(row[columnMapping.amountIn] || '0');
      const outAmount = parseAmount(row[columnMapping.amountOut] || '0');
      rowAmount = inAmount || outAmount; // Use whichever has a value
    } else if (columnMapping.amount) {
      rowAmount = parseAmount(row[columnMapping.amount]);
    }

    // Map transaction types
    const typeLower = rawType.toLowerCase();
    if (typeLower.includes('release') || typeLower.includes('disburs')) {
      type = 'Disbursement';
      principalApplied = rowAmount || parseAmount(row[columnMapping.principal] || '0');
    } else if (typeLower.includes('principal') && typeLower.includes('collect')) {
      type = 'Repayment';
      principalApplied = rowAmount || parseAmount(row[columnMapping.principal] || '0');
    } else if (typeLower.includes('interest') && typeLower.includes('collect')) {
      type = 'Repayment';
      interestApplied = rowAmount || parseAmount(row[columnMapping.interest] || '0');
    } else if (typeLower.includes('fee') && typeLower.includes('collect')) {
      type = 'Repayment';
      feeApplied = rowAmount || parseAmount(row[columnMapping.fees] || '0');
    } else if (typeLower.includes('repayment') || typeLower.includes('payment')) {
      type = 'Repayment';
      principalApplied = parseAmount(row[columnMapping.principal] || '0');
      interestApplied = parseAmount(row[columnMapping.interest] || '0');
      feeApplied = parseAmount(row[columnMapping.fees] || '0');
    } else if (typeLower.includes('expense')) {
      type = 'Expense';
    }

    const amount = rowAmount || (principalApplied + interestApplied + feeApplied);

    const date = parseDate(row[columnMapping.date]);
    if (!date) return null;

    // Build notes - include the original loan number for reference
    const baseNotes = row[columnMapping.description] || rawType;
    const notes = `[From Loan #${sourceLoanNumber}] ${baseNotes}`;

    return {
      loan_id: loan.id,
      borrower_id: loan.borrower_id,
      date,
      type,
      amount: Math.abs(amount),
      principal_applied: Math.abs(principalApplied),
      interest_applied: Math.abs(interestApplied),
      fees_applied: Math.abs(feeApplied),  // Database uses 'fees_applied' not 'fee_applied'
      reference: `Restructure - ${sourceLoanNumber}`,
      notes,
      is_deleted: false,
      // For preview display only (not saved to DB)
      _sourceLoan: sourceLoanNumber,
      _displayNotes: baseNotes
    };
  };

  // Preview transactions
  const previewTransactions = useMemo(() => {
    if (!csvData || !columnMapping?.loanNumber || selectedSourceLoans.length === 0) return [];
    return csvData.data
      .map(transformTransaction)
      .filter(t => t !== null);
  }, [csvData, columnMapping, selectedSourceLoans, loan]);

  // Handle import
  const handleImport = async () => {
    if (previewTransactions.length === 0) return;

    setIsImporting(true);
    toast.loading('Importing transactions...', { id: 'import-restructure' });

    try {
      // Filter valid transactions and strip display-only fields
      const validTransactions = previewTransactions
        .filter(t => t.amount > 0 || t.principal_applied > 0 || t.interest_applied > 0 || t.fees_applied > 0)
        .map(({ _sourceLoan, _displayNotes, ...tx }) => tx);  // Remove display-only fields

      if (validTransactions.length > 0) {
        await api.entities.Transaction.createMany(validTransactions);
      }

      setImportResult({
        success: true,
        created: validTransactions.length,
        skipped: previewTransactions.length - validTransactions.length,
        total: previewTransactions.length
      });

      toast.success(`Imported ${validTransactions.length} transactions`, { id: 'import-restructure' });

      if (onImportComplete) {
        onImportComplete();
      }
    } catch (error) {
      console.error('Import error:', error);
      setImportResult({
        success: false,
        error: error.message
      });
      toast.error('Failed to import transactions', { id: 'import-restructure' });
    } finally {
      setIsImporting(false);
    }
  };

  // Reset modal state
  const handleClose = () => {
    setStep('upload');
    setFile(null);
    setCsvData(null);
    setColumnMapping(null);
    setSelectedSourceLoans([]);
    setImportResult(null);
    onClose();
  };

  // Navigation
  const canProceed = () => {
    switch (step) {
      case 'upload':
        return csvData !== null && columnMapping?.loanNumber;
      case 'sources':
        return selectedSourceLoans.length > 0;
      case 'preview':
        return previewTransactions.length > 0;
      default:
        return false;
    }
  };

  const goNext = () => {
    const currentIndex = STEPS.indexOf(step);
    if (currentIndex < STEPS.length - 1) {
      setStep(STEPS[currentIndex + 1]);
    }
  };

  const goBack = () => {
    const currentIndex = STEPS.indexOf(step);
    if (currentIndex > 0) {
      setStep(STEPS[currentIndex - 1]);
    }
  };

  const currentStepIndex = STEPS.indexOf(step);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Import Restructure Transactions
          </DialogTitle>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i < currentStepIndex ? 'bg-emerald-500 text-white' :
                i === currentStepIndex ? 'bg-slate-900 text-white' :
                'bg-slate-200 text-slate-500'
              }`}>
                {i < currentStepIndex ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
              </div>
              <span className={`ml-2 text-sm ${i === currentStepIndex ? 'font-medium' : 'text-slate-500'}`}>
                {STEP_LABELS[s]}
              </span>
              {i < STEPS.length - 1 && (
                <ChevronRight className="w-4 h-4 mx-3 text-slate-300" />
              )}
            </div>
          ))}
        </div>

        {/* Target Loan Info */}
        <Card className="bg-blue-50 border-blue-200 mb-4">
          <CardContent className="p-3">
            <p className="text-sm text-blue-700">
              Importing transactions into: <span className="font-bold">{loan?.loan_number}</span>
            </p>
          </CardContent>
        </Card>

        {/* Step Content */}
        <div className="min-h-[300px]">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                <FileText className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                <Label htmlFor="csv-file" className="cursor-pointer">
                  <span className="text-lg font-medium text-slate-700">
                    {file ? file.name : 'Choose a CSV file'}
                  </span>
                  <p className="text-sm text-slate-500 mt-1">
                    Upload the same CSV format used for transaction imports
                  </p>
                </Label>
                <Input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => document.getElementById('csv-file').click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Select File
                </Button>
              </div>

              {csvData && columnMapping && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Found {csvData.data.length} rows. Detected columns: {columnMapping.loanNumber && `Loan: "${columnMapping.loanNumber}"`}
                    {columnMapping.date && `, Date: "${columnMapping.date}"`}
                    {columnMapping.type && `, Type: "${columnMapping.type}"`}
                  </AlertDescription>
                </Alert>
              )}

              {csvData && !columnMapping?.loanNumber && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Could not detect loan number column. Please ensure your CSV has a column for loan numbers.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 2: Select Source Loans */}
          {step === 'sources' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 mb-4">
                Select the loan numbers whose transactions you want to import into <strong>{loan?.loan_number}</strong>.
              </p>

              {csvLoanNumbers.length === 0 ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No loan numbers found in the CSV that differ from the current loan.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <Label>Source Loan Numbers ({csvLoanNumbers.length} found)</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (selectedSourceLoans.length === csvLoanNumbers.length) {
                          setSelectedSourceLoans([]);
                        } else {
                          setSelectedSourceLoans([...csvLoanNumbers]);
                        }
                      }}
                    >
                      {selectedSourceLoans.length === csvLoanNumbers.length ? 'Deselect All' : 'Select All'}
                    </Button>
                  </div>

                  <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
                    {csvLoanNumbers.map(num => (
                      <div key={num} className="flex items-center justify-between p-3 hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            id={`loan-${num}`}
                            checked={selectedSourceLoans.includes(num)}
                            onCheckedChange={(checked) => toggleSourceLoan(num, checked)}
                          />
                          <label htmlFor={`loan-${num}`} className="font-mono text-sm cursor-pointer">
                            {num}
                          </label>
                        </div>
                        <Badge variant="secondary">
                          {getTransactionCount(num)} transactions
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {selectedSourceLoans.length > 0 && (
                    <p className="text-sm text-slate-600 mt-2">
                      Selected: {selectedSourceLoans.length} loan(s) with{' '}
                      {selectedSourceLoans.reduce((sum, num) => sum + getTransactionCount(num), 0)} transactions
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview & Import */}
          {step === 'preview' && (
            <div className="space-y-4">
              {importResult ? (
                <div className="space-y-4">
                  {importResult.success ? (
                    <Alert className="bg-emerald-50 border-emerald-200">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <AlertDescription className="text-emerald-800">
                        Successfully imported {importResult.created} transactions.
                        {importResult.skipped > 0 && ` Skipped ${importResult.skipped} rows with zero amounts.`}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Import failed: {importResult.error}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-600">
                      {previewTransactions.length} transactions ready to import
                    </p>
                  </div>

                  <div className="border rounded-lg overflow-auto max-h-[300px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Source Loan</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Description</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewTransactions.slice(0, 50).map((tx, i) => (
                          <TableRow key={i}>
                            <TableCell>{tx.date}</TableCell>
                            <TableCell className="font-mono text-xs">{tx._sourceLoan}</TableCell>
                            <TableCell>
                              <Badge variant={tx.type === 'Repayment' ? 'default' : 'secondary'}>
                                {tx.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(tx.amount)}</TableCell>
                            <TableCell className="text-sm text-slate-500 max-w-[200px] truncate">
                              {tx._displayNotes}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {previewTransactions.length > 50 && (
                    <p className="text-sm text-slate-500 text-center">
                      Showing first 50 of {previewTransactions.length} transactions
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between mt-6">
          <div>
            {currentStepIndex > 0 && !importResult && (
              <Button variant="outline" onClick={goBack} disabled={isImporting}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={isImporting}>
              {importResult?.success ? 'Close' : 'Cancel'}
            </Button>
            {step !== 'preview' ? (
              <Button onClick={goNext} disabled={!canProceed()}>
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            ) : !importResult && (
              <Button onClick={handleImport} disabled={isImporting || previewTransactions.length === 0}>
                {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Import {previewTransactions.length} Transactions
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
