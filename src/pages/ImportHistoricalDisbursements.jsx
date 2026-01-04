import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  AlertTriangle,
  Loader2,
  ChevronRight,
  Banknote,
  Copy
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { logBulkImportEvent, AuditAction } from '@/lib/auditLog';

/**
 * Parse the ADW historical disbursements format:
 *
 * loan 1000113
 *
 * 07/11/2024	132,000.00	0%/Year	Lump-Sum	0	0	0	132,000.00	0
 * 05/11/2024	133,300.00	0%/Year	Lump-Sum	0	0	0	133,300.00	0
 * ...
 *
 * loan 1000116 / comment to ignore
 *
 * 09/12/2025	50,000.00	0%/Day	Lump-Sum	0	0	0	50,000.00	0
 * ...
 */
function parseADWFormat(text) {
  const lines = text.split('\n');
  const disbursements = [];
  let currentLoanNumber = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check for loan header: "loan 1000113" or "loan 1000114  / comment"
    // Extract just the loan number, ignore anything after / or whitespace
    const loanMatch = trimmed.match(/^loan\s+(\d+)/i);
    if (loanMatch) {
      currentLoanNumber = loanMatch[1];
      continue;
    }

    // If we have a current loan and this is a data line (starts with date pattern)
    if (currentLoanNumber && /^\d{2}\/\d{2}\/\d{4}/.test(trimmed)) {
      // Split by tabs
      const parts = trimmed.split('\t');
      if (parts.length >= 2) {
        const dateStr = parts[0].trim();
        const amountStr = parts[1].trim();

        disbursements.push({
          loanNumber: currentLoanNumber,
          date: dateStr,
          amount: amountStr,
          rawLine: trimmed
        });
      }
    }
  }

  return disbursements;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Parse DD/MM/YYYY format
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseAmount(amountStr) {
  if (!amountStr) return 0;
  // Remove commas and parse
  const cleaned = amountStr.replace(/,/g, '');
  const amount = parseFloat(cleaned);
  return isNaN(amount) ? 0 : Math.abs(amount);
}

export default function ImportHistoricalDisbursements() {
  const [file, setFile] = useState(null);
  const [parsedData, setParsedData] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState('upload'); // upload, preview
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch existing loans for matching
  const { data: loans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_date')
  });

  // Fetch existing disbursement transactions to detect duplicates
  const { data: existingDisbursements = [] } = useQuery({
    queryKey: ['transactions', 'disbursements'],
    queryFn: () => api.entities.Transaction.filter({ type: 'Disbursement' })
  });

  // Create a Set of existing disbursement keys for fast lookup
  // Key format: "loan_id|date|amount"
  const existingDisbursementKeys = useMemo(() => {
    const keys = new Set();
    existingDisbursements.forEach(tx => {
      // Round amount to 2 decimal places for comparison
      const roundedAmount = Math.round(parseFloat(tx.amount) * 100) / 100;
      const key = `${tx.loan_id}|${tx.date}|${roundedAmount}`;
      keys.add(key);
    });
    return keys;
  }, [existingDisbursements]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setImportResult(null);
    setParsedData([]);
    setStep('upload');

    if (selectedFile) {
      selectedFile.text().then(text => {
        const parsed = parseADWFormat(text);
        setParsedData(parsed);
        setStep('preview');
      });
    }
  };

  // Get unique loan numbers from parsed data
  const parsedLoanNumbers = useMemo(() => {
    const numbers = new Set();
    parsedData.forEach(d => numbers.add(d.loanNumber));
    return Array.from(numbers).sort();
  }, [parsedData]);

  // Find loans not in system
  const unmatchedLoanNumbers = useMemo(() => {
    return parsedLoanNumbers.filter(num =>
      !loans.some(l => l.loan_number === num)
    );
  }, [parsedLoanNumbers, loans]);

  // Find matched loans
  const matchedLoanNumbers = useMemo(() => {
    return parsedLoanNumbers.filter(num =>
      loans.some(l => l.loan_number === num)
    );
  }, [parsedLoanNumbers, loans]);

  // Transform to transactions
  const transformedDisbursements = useMemo(() => {
    return parsedData.map(d => {
      const targetLoan = loans.find(l => l.loan_number === d.loanNumber);
      const date = parseDate(d.date);
      const amount = parseAmount(d.amount);

      // Check for duplicate
      let isDuplicate = false;
      if (targetLoan && date && amount > 0) {
        const roundedAmount = Math.round(amount * 100) / 100;
        const key = `${targetLoan.id}|${date}|${roundedAmount}`;
        isDuplicate = existingDisbursementKeys.has(key);
      }

      return {
        loanNumber: d.loanNumber,
        loan: targetLoan,
        date,
        amount,
        isDuplicate,
        isValid: targetLoan && date && amount > 0 && !isDuplicate,
        transaction: targetLoan && date && amount > 0 && !isDuplicate ? {
          loan_id: targetLoan.id,
          borrower_id: targetLoan.borrower_id,
          date,
          type: 'Disbursement',
          amount,
          principal_applied: amount,
          interest_applied: 0,
          fees_applied: 0,
          notes: 'Loandisc Import',
          is_deleted: false
        } : null
      };
    });
  }, [parsedData, loans, existingDisbursementKeys]);

  // Valid transactions only
  const validTransactions = useMemo(() => {
    return transformedDisbursements.filter(d => d.isValid);
  }, [transformedDisbursements]);

  // Count duplicates
  const duplicateCount = useMemo(() => {
    return transformedDisbursements.filter(d => d.isDuplicate).length;
  }, [transformedDisbursements]);

  // Group by loan for summary
  const byLoan = useMemo(() => {
    const grouped = {};
    transformedDisbursements.forEach(d => {
      if (!grouped[d.loanNumber]) {
        grouped[d.loanNumber] = {
          loanNumber: d.loanNumber,
          loan: d.loan,
          disbursements: [],
          total: 0
        };
      }
      grouped[d.loanNumber].disbursements.push(d);
      if (d.isValid) {
        grouped[d.loanNumber].total += d.amount;
      }
    });
    return Object.values(grouped);
  }, [transformedDisbursements]);

  const handleImport = async () => {
    if (validTransactions.length === 0) return;

    setIsProcessing(true);
    setImportResult(null);

    try {
      let totalCreated = 0;
      let loansUpdated = 0;

      // Process each loan group
      for (const group of byLoan) {
        if (!group.loan) continue;

        const validDisbursements = group.disbursements.filter(d => d.isValid);
        if (validDisbursements.length === 0) continue;

        // Sort by date to find earliest (initial) disbursement
        const sortedByDate = [...validDisbursements].sort((a, b) =>
          new Date(a.date) - new Date(b.date)
        );
        const initialAmount = sortedByDate[0].amount;

        // 1. Delete existing disbursement transactions for this loan
        const existingTx = await api.entities.Transaction.filter({
          loan_id: group.loan.id,
          type: 'Disbursement'
        });
        for (const tx of existingTx) {
          await api.entities.Transaction.delete(tx.id);
        }

        // 2. Update loan's principal_amount to the initial (earliest) disbursement
        await api.entities.Loan.update(group.loan.id, {
          principal_amount: initialAmount
        });

        // 3. Create all disbursement transactions
        const transactions = validDisbursements.map(d => d.transaction);
        await api.entities.Transaction.createMany(transactions);

        totalCreated += transactions.length;
        loansUpdated++;
      }

      setImportResult({
        success: true,
        created: totalCreated,
        skipped: parsedData.length - totalCreated,
        duplicates: duplicateCount,
        total: parsedData.length,
        loansUpdated
      });

      // Log the bulk import
      logBulkImportEvent(AuditAction.BULK_IMPORT_DISBURSEMENTS, 'disbursements', {
        created: totalCreated,
        skipped: parsedData.length - totalCreated,
        total: parsedData.length,
        loans: loansUpdated
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['loans'] });

    } catch (error) {
      setImportResult({
        success: false,
        error: error.message
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <Link to={createPageUrl('Loans')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Loans
          </Button>
        </Link>

        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Banknote className="w-8 h-8 text-emerald-600" />
            Import Historical Disbursements
          </h1>
          <p className="text-slate-500 mt-1">Import disbursements from ADW export format</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 text-sm">
          {['upload', 'preview'].map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`px-3 py-1 rounded-full ${
                step === s ? 'bg-slate-900 text-white' :
                ['upload', 'preview'].indexOf(step) > i
                  ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
              </div>
              {i < 1 && <ChevronRight className="w-4 h-4 text-slate-400 mx-1" />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <Card>
            <CardHeader>
              <CardTitle>Upload Disbursements File</CardTitle>
              <CardDescription>Select a file exported from ADW containing historical disbursements</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept=".txt,.csv"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              <div className="bg-slate-50 rounded-lg p-4 text-sm">
                <h4 className="font-medium text-slate-700 mb-2">Expected Format:</h4>
                <pre className="text-xs text-slate-600 font-mono bg-white p-3 rounded border overflow-x-auto">
{`loan 1000113

07/11/2024	132,000.00	0%/Year	Lump-Sum	...
05/11/2024	133,300.00	0%/Year	Lump-Sum	...

loan 1000116

09/12/2025	50,000.00	0%/Day	Lump-Sum	...`}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm text-slate-500">Total Disbursements</div>
                  <div className="text-2xl font-bold text-slate-900">{parsedData.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm text-slate-500">Loans Found</div>
                  <div className="text-2xl font-bold text-slate-900">{parsedLoanNumbers.length}</div>
                </CardContent>
              </Card>
              <Card className={unmatchedLoanNumbers.length > 0 ? "border-amber-200" : ""}>
                <CardContent className="p-4">
                  <div className="text-sm text-slate-500">Matched Loans</div>
                  <div className="text-2xl font-bold text-emerald-600">{matchedLoanNumbers.length}</div>
                </CardContent>
              </Card>
              <Card className={duplicateCount > 0 ? "border-blue-200" : ""}>
                <CardContent className="p-4">
                  <div className="text-sm text-slate-500">Duplicates</div>
                  <div className="text-2xl font-bold text-blue-600">{duplicateCount}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-sm text-slate-500">Valid to Import</div>
                  <div className="text-2xl font-bold text-emerald-600">{validTransactions.length}</div>
                </CardContent>
              </Card>
            </div>

            {/* Duplicate Warning */}
            {duplicateCount > 0 && (
              <Alert className="border-blue-200 bg-blue-50">
                <Copy className="w-4 h-4 text-blue-600" />
                <AlertDescription>
                  <p className="font-medium text-blue-900">
                    {duplicateCount} disbursement(s) already exist in the system and will be skipped.
                  </p>
                  <p className="text-sm text-blue-700 mt-1">
                    Duplicates are detected by matching loan, date, and amount.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {/* Unmatched Loan Warning */}
            {unmatchedLoanNumbers.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <AlertDescription>
                  <p className="font-medium text-amber-900">
                    {unmatchedLoanNumbers.length} loan(s) not found in system (disbursements will be skipped):
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {unmatchedLoanNumbers.map(num => (
                      <Badge key={num} variant="outline" className="text-amber-700 border-amber-300">
                        {num}
                      </Badge>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* By Loan Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Disbursements by Loan</CardTitle>
                <CardDescription>Summary of disbursements grouped by loan</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {byLoan.map(group => (
                    <div
                      key={group.loanNumber}
                      className={`border rounded-lg p-4 ${group.loan ? 'bg-white' : 'bg-slate-50 border-amber-200'}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-medium text-lg">
                            Loan {group.loanNumber}
                          </span>
                          {group.loan ? (
                            <Badge className="bg-emerald-100 text-emerald-700">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Matched
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Not Found
                            </Badge>
                          )}
                          {group.loan && (
                            <span className="text-sm text-slate-500">
                              {group.loan.borrower_name}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-slate-500">{group.disbursements.length} disbursement(s)</div>
                          <div className="font-medium text-emerald-600">{formatCurrency(group.total)}</div>
                        </div>
                      </div>

                      {/* Disbursement list for this loan */}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-32">Date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="w-24 text-center">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.disbursements.map((d, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-sm">{d.date}</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(d.amount)}
                              </TableCell>
                              <TableCell className="text-center">
                                {d.isValid ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" />
                                ) : d.isDuplicate ? (
                                  <span className="inline-flex items-center gap-1 text-blue-600">
                                    <Copy className="w-4 h-4" />
                                    <span className="text-xs">Exists</span>
                                  </span>
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-amber-500 inline" />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Warning about replacing existing disbursements */}
            {matchedLoanNumbers.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription>
                  <p className="font-medium text-amber-900">
                    This will replace existing disbursements
                  </p>
                  <p className="text-sm text-amber-700 mt-1">
                    For each matched loan, existing disbursement transactions will be deleted and the loan's principal will be updated to match the imported historical data.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setStep('upload'); setParsedData([]); setFile(null); }}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={isProcessing || validTransactions.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import {validTransactions.length} Disbursement{validTransactions.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* Import Result */}
        {importResult && (
          <Alert className={importResult.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
            <div className="flex items-start gap-3">
              {importResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              )}
              <div className="flex-1">
                <AlertDescription>
                  {importResult.success ? (
                    <div className="space-y-2">
                      <p className="font-medium text-green-900">Import completed successfully!</p>
                      <div className="text-sm text-green-800">
                        <p>Created: {importResult.created} disbursement(s)</p>
                        <p>Loans updated: {importResult.loansUpdated}</p>
                        {importResult.duplicates > 0 && (
                          <p>Duplicates skipped: {importResult.duplicates}</p>
                        )}
                        <p>Other skipped: {importResult.skipped - (importResult.duplicates || 0)} row(s)</p>
                        <p>Total processed: {importResult.total} row(s)</p>
                      </div>
                      <Button
                        size="sm"
                        className="mt-3"
                        onClick={() => navigate(createPageUrl('Loans'))}
                      >
                        View Loans
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium text-red-900">Import failed</p>
                      <p className="text-sm text-red-800 mt-1">{importResult.error}</p>
                    </div>
                  )}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}
      </div>
    </div>
  );
}
