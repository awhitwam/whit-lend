import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Banknote
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';

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

function parseAmount(amountStr) {
  if (!amountStr) return 0;
  // Remove currency symbols and commas, handle negatives
  const cleaned = amountStr.replace(/[£$,\s]/g, '').replace(/\((.+)\)/, '-$1');
  const amount = parseFloat(cleaned);
  return isNaN(amount) ? 0 : amount;
}

export default function ImportDisbursements() {
  const [file, setFile] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [columnMapping, setColumnMapping] = useState({
    loanNumber: '',
    date: '',
    amount: '',
    description: ''
  });
  const [importResult, setImportResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState('upload'); // upload, mapping, preview
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch existing loans for matching
  const { data: loans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_date')
  });

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setImportResult(null);
    setCsvData(null);
    setStep('upload');

    if (selectedFile) {
      selectedFile.text().then(text => {
        const parsed = parseCSV(text);
        setCsvData(parsed);
        setStep('mapping');
      });
    }
  };

  // Get unique loan numbers from CSV
  const csvLoanNumbers = useMemo(() => {
    if (!csvData || !columnMapping.loanNumber) return [];
    const numbers = new Set();
    csvData.data.forEach(row => {
      const loanNum = row[columnMapping.loanNumber];
      if (loanNum) numbers.add(loanNum);
    });
    return Array.from(numbers).sort();
  }, [csvData, columnMapping.loanNumber]);

  // Find loans not in system
  const unmatchedLoanNumbers = useMemo(() => {
    return csvLoanNumbers.filter(num =>
      !loans.some(l => l.loan_number === num)
    );
  }, [csvLoanNumbers, loans]);

  // Transform CSV row to disbursement transaction
  const transformDisbursement = (row) => {
    const loanNumber = row[columnMapping.loanNumber];
    const targetLoan = loans.find(l => l.loan_number === loanNumber);

    if (!targetLoan) return null;

    const amount = parseAmount(row[columnMapping.amount]);
    if (amount <= 0) return null;

    return {
      loan_id: targetLoan.id,
      borrower_id: targetLoan.borrower_id,
      date: parseDate(row[columnMapping.date]),
      type: 'Disbursement',
      amount: Math.abs(amount),
      principal_applied: Math.abs(amount),
      interest_applied: 0,
      fees_applied: 0,
      description: row[columnMapping.description] || `Disbursement - Imported`,
      is_deleted: false
    };
  };

  // Preview data
  const previewTransactions = useMemo(() => {
    if (!csvData || !columnMapping.loanNumber) return [];
    return csvData.data
      .map(transformDisbursement)
      .filter(t => t !== null)
      .slice(0, 20);
  }, [csvData, columnMapping, loans]);

  // Count total valid transactions
  const totalValidTransactions = useMemo(() => {
    if (!csvData || !columnMapping.loanNumber) return 0;
    return csvData.data
      .map(transformDisbursement)
      .filter(t => t !== null && t.date).length;
  }, [csvData, columnMapping, loans]);

  const handleImport = async () => {
    if (!csvData) return;

    setIsProcessing(true);
    setImportResult(null);

    try {
      const transactions = csvData.data
        .map(transformDisbursement)
        .filter(t => t !== null && t.date);

      let created = 0;
      let skipped = 0;
      const errors = [];

      const validTransactions = [];

      for (const transaction of transactions) {
        try {
          if (transaction.amount > 0) {
            validTransactions.push(transaction);
          } else {
            skipped++;
          }
        } catch (error) {
          errors.push(`Row: ${error.message}`);
        }
      }

      if (validTransactions.length > 0) {
        await api.entities.Transaction.createMany(validTransactions);
        created = validTransactions.length;
      }

      setImportResult({
        success: true,
        created,
        skipped,
        errors,
        total: csvData.data.length
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
            Import Disbursements
          </h1>
          <p className="text-slate-500 mt-1">Import disbursement transactions from CSV</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 text-sm">
          {['upload', 'mapping', 'preview'].map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`px-3 py-1 rounded-full ${
                step === s ? 'bg-slate-900 text-white' :
                ['upload', 'mapping', 'preview'].indexOf(step) > i
                  ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
              </div>
              {i < 2 && <ChevronRight className="w-4 h-4 text-slate-400 mx-1" />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV File</CardTitle>
              <CardDescription>Select a CSV file containing disbursement records</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              <p className="text-xs text-slate-500">
                The CSV should contain columns for loan number, date, and amount.
                All imported transactions will be created as Disbursement type.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Column Mapping */}
        {step === 'mapping' && csvData && (
          <Card>
            <CardHeader>
              <CardTitle>Map Columns</CardTitle>
              <CardDescription>Match CSV columns to disbursement fields</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label>Loan Number *</Label>
                  <Select
                    value={columnMapping.loanNumber}
                    onValueChange={(v) => setColumnMapping({...columnMapping, loanNumber: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {csvData.headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date *</Label>
                  <Select
                    value={columnMapping.date}
                    onValueChange={(v) => setColumnMapping({...columnMapping, date: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {csvData.headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Amount *</Label>
                  <Select
                    value={columnMapping.amount}
                    onValueChange={(v) => setColumnMapping({...columnMapping, amount: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {csvData.headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Description</Label>
                  <Select
                    value={columnMapping.description || '__none__'}
                    onValueChange={(v) => setColumnMapping({...columnMapping, description: v === '__none__' ? '' : v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {csvData.headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Sample Data Preview */}
              {csvData.data.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-slate-700 mb-2">Sample Data (first 3 rows):</p>
                  <div className="bg-slate-50 rounded-lg p-3 overflow-x-auto">
                    <table className="text-xs">
                      <thead>
                        <tr>
                          {csvData.headers.slice(0, 8).map(h => (
                            <th key={h} className="px-2 py-1 text-left font-medium text-slate-600">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvData.data.slice(0, 3).map((row, i) => (
                          <tr key={i}>
                            {csvData.headers.slice(0, 8).map(h => (
                              <td key={h} className="px-2 py-1 text-slate-800">{row[h]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setStep('upload')}>Back</Button>
                <Button
                  onClick={() => setStep('preview')}
                  disabled={!columnMapping.loanNumber || !columnMapping.date || !columnMapping.amount}
                >
                  Next: Preview
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <Card>
            <CardHeader>
              <CardTitle>Preview Import</CardTitle>
              <CardDescription>
                Review the disbursements before importing. Showing first 20 rows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Show unmatched loan numbers */}
              {unmatchedLoanNumbers.length > 0 && (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <AlertDescription>
                    <p className="font-medium text-amber-900">
                      {unmatchedLoanNumbers.length} loan number(s) in CSV not found in system (will be skipped):
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {unmatchedLoanNumbers.slice(0, 10).map(num => (
                        <Badge key={num} variant="outline" className="text-amber-700 border-amber-300">
                          {num}
                        </Badge>
                      ))}
                      {unmatchedLoanNumbers.length > 10 && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                          +{unmatchedLoanNumbers.length - 10} more
                        </Badge>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {previewTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Loan</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewTransactions.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">
                            {loans.find(l => l.id === t.loan_id)?.loan_number}
                          </TableCell>
                          <TableCell>{t.date}</TableCell>
                          <TableCell>
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                              Disbursement
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-emerald-600">
                            {formatCurrency(t.amount)}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600 max-w-xs truncate">
                            {t.description}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <AlertDescription>
                    No valid disbursements found. Check your column mapping and ensure loan numbers match existing loans.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep('mapping')}>Back</Button>
                <Button
                  onClick={handleImport}
                  disabled={isProcessing || previewTransactions.length === 0}
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
                      Import {totalValidTransactions} Disbursement{totalValidTransactions !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
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
                        <p>Skipped: {importResult.skipped} row(s)</p>
                        <p>Total processed: {importResult.total} row(s)</p>
                      </div>
                      {importResult.errors?.length > 0 && (
                        <div className="mt-3">
                          <p className="font-medium text-amber-900">Errors:</p>
                          <ul className="text-xs text-amber-800 list-disc list-inside mt-1">
                            {importResult.errors.slice(0, 5).map((error, i) => (
                              <li key={i}>{error}</li>
                            ))}
                            {importResult.errors.length > 5 && (
                              <li>... and {importResult.errors.length - 5} more</li>
                            )}
                          </ul>
                        </div>
                      )}
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

        {/* Help Card */}
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-4">
            <h3 className="font-semibold text-emerald-900 mb-2">About Disbursement Import:</h3>
            <ul className="text-sm text-emerald-800 space-y-1 list-disc list-inside">
              <li>All imported transactions will be created as "Disbursement" type</li>
              <li>Disbursements represent funds released to the borrower</li>
              <li>The amount will be added to the loan's total disbursed amount</li>
              <li>Loan numbers must match existing loans in the system</li>
              <li>Dates can be in DD/MM/YYYY or YYYY-MM-DD format</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
