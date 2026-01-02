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
import { Checkbox } from "@/components/ui/checkbox";
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
  Link2,
  ChevronRight,
  Plus,
  Trash2
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { logBulkImportEvent, AuditAction } from '@/lib/auditLog';

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

export default function ImportTransactions() {
  const [file, setFile] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [columnMapping, setColumnMapping] = useState({
    loanNumber: '',
    date: '',
    type: '',
    amount: '',
    principal: '',
    interest: '',
    fees: '',
    description: ''
  });
  const [restructureChains, setRestructureChains] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState('upload'); // upload, mapping, restructure, preview
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

  const addRestructureChain = () => {
    setRestructureChains([...restructureChains, {
      id: Date.now(),
      masterLoanNumber: '',
      sourceLoanNumbers: []
    }]);
  };

  const removeRestructureChain = (id) => {
    setRestructureChains(restructureChains.filter(c => c.id !== id));
  };

  const updateRestructureChain = (id, field, value) => {
    setRestructureChains(restructureChains.map(c =>
      c.id === id ? { ...c, [field]: value } : c
    ));
  };

  const toggleSourceLoan = (chainId, loanNumber) => {
    setRestructureChains(restructureChains.map(c => {
      if (c.id !== chainId) return c;
      const current = c.sourceLoanNumbers || [];
      if (current.includes(loanNumber)) {
        return { ...c, sourceLoanNumbers: current.filter(n => n !== loanNumber) };
      } else {
        return { ...c, sourceLoanNumbers: [...current, loanNumber] };
      }
    }));
  };

  // Transform CSV row to transaction
  const transformTransaction = (row) => {
    const loanNumber = row[columnMapping.loanNumber];

    // Check if this loan number is a source in any restructure chain
    const chain = restructureChains.find(c => c.sourceLoanNumbers?.includes(loanNumber));

    // If it's in a restructure chain, use the master loan; otherwise try to find by loan number
    let targetLoan;
    if (chain && chain.masterLoanNumber) {
      // Source loan in a chain - map to master loan
      targetLoan = loans.find(l => l.loan_number === chain.masterLoanNumber);
    } else {
      // Not in a chain - try to find the loan directly
      targetLoan = loans.find(l => l.loan_number === loanNumber);
    }

    if (!targetLoan) return null;

    // Track the target loan number for determining if original_loan_number should be stored
    const targetLoanNumber = targetLoan.loan_number;

    const rawType = row[columnMapping.type] || '';
    let type = 'Other';
    let principalApplied = 0;
    let interestApplied = 0;
    let feeApplied = 0;

    // Map transaction types
    const typeLower = rawType.toLowerCase();
    if (typeLower.includes('release') || typeLower.includes('disburs')) {
      type = 'Disbursement';
      principalApplied = parseAmount(row[columnMapping.amount] || row[columnMapping.principal]);
    } else if (typeLower.includes('principal') && typeLower.includes('collect')) {
      type = 'Repayment';
      principalApplied = parseAmount(row[columnMapping.amount] || row[columnMapping.principal]);
    } else if (typeLower.includes('interest') && typeLower.includes('collect')) {
      type = 'Repayment';
      interestApplied = parseAmount(row[columnMapping.amount] || row[columnMapping.interest]);
    } else if (typeLower.includes('fee') && typeLower.includes('collect')) {
      type = 'Repayment';
      feeApplied = parseAmount(row[columnMapping.amount] || row[columnMapping.fees]);
    } else if (typeLower.includes('repayment') || typeLower.includes('payment')) {
      type = 'Repayment';
      principalApplied = parseAmount(row[columnMapping.principal] || '0');
      interestApplied = parseAmount(row[columnMapping.interest] || '0');
      feeApplied = parseAmount(row[columnMapping.fees] || '0');
    } else if (typeLower.includes('expense')) {
      type = 'Expense';
    }

    const amount = parseAmount(row[columnMapping.amount]) ||
                   (principalApplied + interestApplied + feeApplied);

    return {
      loan_id: targetLoan.id,
      borrower_id: targetLoan.borrower_id,
      date: parseDate(row[columnMapping.date]),
      type,
      amount: Math.abs(amount),
      principal_applied: Math.abs(principalApplied),
      interest_applied: Math.abs(interestApplied),
      fees_applied: Math.abs(feeApplied),
      description: row[columnMapping.description] || `${rawType} - Imported from ${loanNumber}`,
      original_loan_number: loanNumber !== targetLoanNumber ? loanNumber : null,
      is_deleted: false
    };
  };

  // Preview data
  const previewTransactions = useMemo(() => {
    if (!csvData || !columnMapping.loanNumber) return [];
    return csvData.data
      .map(transformTransaction)
      .filter(t => t !== null)
      .slice(0, 20);
  }, [csvData, columnMapping, loans, restructureChains]);

  const handleImport = async () => {
    if (!csvData) return;

    setIsProcessing(true);
    setImportResult(null);

    try {
      const transactions = csvData.data
        .map(transformTransaction)
        .filter(t => t !== null && t.date);

      let created = 0;
      let skipped = 0;
      const errors = [];

      // Batch create transactions (much faster)
      const validTransactions = [];

      for (const transaction of transactions) {
        try {
          if (transaction.amount > 0 || transaction.principal_applied > 0 ||
              transaction.interest_applied > 0 || transaction.fees_applied > 0) {
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

      // Update loan restructure links if chains were specified
      for (const chain of restructureChains) {
        if (chain.masterLoanNumber && chain.sourceLoanNumbers?.length > 0) {
          const masterLoan = loans.find(l => l.loan_number === chain.masterLoanNumber);
          if (masterLoan) {
            // Find the most recent source loan (the direct predecessor)
            const sourceLoan = loans.find(l => l.loan_number === chain.sourceLoanNumbers[0]);
            if (sourceLoan) {
              await api.entities.Loan.update(masterLoan.id, {
                restructured_from_loan_id: sourceLoan.id
              });

              // Mark source loans as Restructured
              for (const sourceNum of chain.sourceLoanNumbers) {
                const sLoan = loans.find(l => l.loan_number === sourceNum);
                if (sLoan) {
                  await api.entities.Loan.update(sLoan.id, {
                    status: 'Restructured'
                  });
                }
              }
            }
          }
        }
      }

      const importSummary = {
        success: true,
        created,
        skipped,
        errors,
        total: csvData.data.length,
        chainsProcessed: restructureChains.filter(c => c.masterLoanNumber && c.sourceLoanNumbers?.length).length
      };

      setImportResult(importSummary);

      // Log the bulk import
      logBulkImportEvent(AuditAction.BULK_IMPORT_TRANSACTIONS, 'transactions', {
        created,
        skipped,
        total: csvData.data.length,
        chainsProcessed: importSummary.chainsProcessed,
        errorCount: errors.length
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
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Import Transactions</h1>
          <p className="text-slate-500 mt-1">Import transaction history from CSV with support for restructured loans</p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 text-sm">
          {['upload', 'mapping', 'restructure', 'preview'].map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`px-3 py-1 rounded-full ${
                step === s ? 'bg-slate-900 text-white' :
                ['upload', 'mapping', 'restructure', 'preview'].indexOf(step) > i
                  ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
              </div>
              {i < 3 && <ChevronRight className="w-4 h-4 text-slate-400 mx-1" />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV File</CardTitle>
              <CardDescription>Select a CSV file containing transaction history</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              <p className="text-xs text-slate-500">
                The CSV should contain columns for loan number, date, transaction type, and amounts.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Column Mapping */}
        {step === 'mapping' && csvData && (
          <Card>
            <CardHeader>
              <CardTitle>Map Columns</CardTitle>
              <CardDescription>Match CSV columns to transaction fields</CardDescription>
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
                  <Label>Type *</Label>
                  <Select
                    value={columnMapping.type}
                    onValueChange={(v) => setColumnMapping({...columnMapping, type: v})}
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
                  <Label>Amount</Label>
                  <Select
                    value={columnMapping.amount || '__none__'}
                    onValueChange={(v) => setColumnMapping({...columnMapping, amount: v === '__none__' ? '' : v})}
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
                <div>
                  <Label>Principal</Label>
                  <Select
                    value={columnMapping.principal || '__none__'}
                    onValueChange={(v) => setColumnMapping({...columnMapping, principal: v === '__none__' ? '' : v})}
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
                <div>
                  <Label>Interest</Label>
                  <Select
                    value={columnMapping.interest || '__none__'}
                    onValueChange={(v) => setColumnMapping({...columnMapping, interest: v === '__none__' ? '' : v})}
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
                <div>
                  <Label>Fees</Label>
                  <Select
                    value={columnMapping.fees || '__none__'}
                    onValueChange={(v) => setColumnMapping({...columnMapping, fees: v === '__none__' ? '' : v})}
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
                  onClick={() => setStep('restructure')}
                  disabled={!columnMapping.loanNumber || !columnMapping.date || !columnMapping.type}
                >
                  Next: Restructure Chains
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Restructure Chains */}
        {step === 'restructure' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="w-5 h-5" />
                Loan Restructure Chains
              </CardTitle>
              <CardDescription>
                If any loans in your CSV were restructured, specify the chain here.
                Transactions from source loans will be consolidated into the master loan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Show unmatched loan numbers */}
              {unmatchedLoanNumbers.length > 0 && (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <AlertDescription>
                    <p className="font-medium text-amber-900">
                      {unmatchedLoanNumbers.length} loan number(s) in CSV not found in system:
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {unmatchedLoanNumbers.map(num => (
                        <Badge key={num} variant="outline" className="text-amber-700 border-amber-300">
                          {num}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-sm text-amber-800 mt-2">
                      Add these as source loans in a restructure chain to import their transactions.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {/* Restructure Chains */}
              <div className="space-y-4">
                {restructureChains.map((chain) => (
                  <div key={chain.id} className="border border-slate-200 rounded-lg p-4 bg-white">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <Label>Master Loan (current active loan)</Label>
                        <Select
                          value={chain.masterLoanNumber}
                          onValueChange={(v) => updateRestructureChain(chain.id, 'masterLoanNumber', v)}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Select master loan" />
                          </SelectTrigger>
                          <SelectContent>
                            {loans.filter(l => !l.is_deleted).map(l => (
                              <SelectItem key={l.id} value={l.loan_number}>
                                {l.loan_number} - {l.borrower_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => removeRestructureChain(chain.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div>
                      <Label>Source Loans (previous loans in chain)</Label>
                      <p className="text-xs text-slate-500 mb-2">
                        Select loan numbers from the CSV that should have their transactions merged into the master loan
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {csvLoanNumbers.map(num => (
                          <div
                            key={num}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                              chain.sourceLoanNumbers?.includes(num)
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                            onClick={() => toggleSourceLoan(chain.id, num)}
                          >
                            <Checkbox
                              checked={chain.sourceLoanNumbers?.includes(num)}
                              className="pointer-events-none"
                            />
                            <span className="text-sm font-mono">{num}</span>
                            {!loans.some(l => l.loan_number === num) && (
                              <Badge variant="outline" className="text-xs">not in system</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {chain.masterLoanNumber && chain.sourceLoanNumbers?.length > 0 && (
                      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>Chain:</strong> {chain.sourceLoanNumbers.join(' → ')} → <strong>{chain.masterLoanNumber}</strong>
                        </p>
                        <p className="text-xs text-blue-600 mt-1">
                          All transactions from source loans will be imported with the master loan ID.
                          Source loans will be marked as "Restructured".
                        </p>
                      </div>
                    )}
                  </div>
                ))}

                <Button
                  variant="outline"
                  onClick={addRestructureChain}
                  className="w-full border-dashed"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Restructure Chain
                </Button>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep('mapping')}>Back</Button>
                <Button onClick={() => setStep('preview')}>
                  Next: Preview
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Preview */}
        {step === 'preview' && (
          <Card>
            <CardHeader>
              <CardTitle>Preview Import</CardTitle>
              <CardDescription>
                Review the transactions before importing. Showing first 20 rows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Loan</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Principal</TableHead>
                        <TableHead className="text-right">Interest</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewTransactions.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">
                            {loans.find(l => l.id === t.loan_id)?.loan_number}
                            {t.original_loan_number && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                from {t.original_loan_number}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{t.date}</TableCell>
                          <TableCell>
                            <Badge variant={t.type === 'Repayment' ? 'default' : 'secondary'}>
                              {t.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(t.amount)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-emerald-600">
                            {t.principal_applied > 0 ? formatCurrency(t.principal_applied) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-blue-600">
                            {t.interest_applied > 0 ? formatCurrency(t.interest_applied) : '-'}
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
                    No valid transactions found. Check your column mapping and ensure loan numbers match existing loans or are in a restructure chain.
                  </AlertDescription>
                </Alert>
              )}

              {restructureChains.filter(c => c.masterLoanNumber && c.sourceLoanNumbers?.length).length > 0 && (
                <Alert className="border-blue-200 bg-blue-50">
                  <Link2 className="w-4 h-4 text-blue-600" />
                  <AlertDescription>
                    <strong>{restructureChains.filter(c => c.masterLoanNumber && c.sourceLoanNumbers?.length).length}</strong> restructure chain(s) will be processed.
                    Source loans will be marked as "Restructured" and linked to their master loan.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setStep('restructure')}>Back</Button>
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
                      Import {csvData?.data.length || 0} Transactions
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
                        <p>Created: {importResult.created} transaction(s)</p>
                        <p>Skipped: {importResult.skipped} row(s)</p>
                        <p>Restructure chains processed: {importResult.chainsProcessed}</p>
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
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <h3 className="font-semibold text-blue-900 mb-2">How Restructure Chains Work:</h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>A restructure chain links old loans to a new "master" loan</li>
              <li>When a loan is restructured, its balance rolls into a new loan with new terms</li>
              <li>The old loan is marked as "Restructured" (essentially settled)</li>
              <li>All transactions from source loans are imported with the master loan's ID</li>
              <li>This gives you a consolidated repayment history on the master loan</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
