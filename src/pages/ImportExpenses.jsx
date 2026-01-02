import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
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
  Receipt,
  FileText,
  Play,
  Settings2,
  RotateCcw
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { format } from 'date-fns';
import { logBulkImportEvent, AuditAction } from '@/lib/auditLog';

// CSV Parser that handles quoted fields AND multi-line values
function parseCSV(text) {
  // First, parse headers from the first line
  const firstNewline = text.indexOf('\n');
  const headerLine = text.substring(0, firstNewline).trim();
  const headers = [];
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

  // Now parse the data rows, handling multi-line quoted fields
  const data = [];
  const content = text.substring(firstNewline + 1);
  let i = 0;

  while (i < content.length) {
    const values = [];
    current = '';
    inQuotes = false;

    // Parse one complete row (which may span multiple lines if quoted)
    while (i < content.length) {
      const char = content[i];

      if (char === '"') {
        // Check for escaped quote ("")
        if (inQuotes && content[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
        i++;
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        // End of row
        values.push(current.trim().replace(/^"|"$/g, ''));
        // Skip any \r\n or \n\r combinations
        while (i < content.length && (content[i] === '\n' || content[i] === '\r')) {
          i++;
        }
        break;
      }

      // Regular character (including newlines inside quotes)
      if (char !== '\r') { // Skip carriage returns inside quotes too
        current += char;
      }
      i++;
    }

    // If we reached end of content, add the last value
    if (i >= content.length && current !== '') {
      values.push(current.trim().replace(/^"|"$/g, ''));
    }

    // Only add row if it has values (skip empty lines)
    if (values.length > 0 && values.some(v => v !== '')) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }
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

// Field mapping options
const EXPENSE_FIELD_OPTIONS = [
  { value: '_ignore', label: '⊘ Ignore this column' },
  { value: '_notes', label: '📝 Add to Description' },
  { value: 'type_name', label: 'Expense Type' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount' },
  { value: 'date', label: 'Date' },
  { value: '_loan_number', label: 'Loan Number (for linking)' },
  { value: '_bank_account', label: 'Bank Account (to description)' }
];

// Default mappings for Loandisc expense CSV columns
const DEFAULT_EXPENSE_MAPPINGS = {
  'Expense Type': 'type_name',
  'Description': 'description',
  'Expense Amount': 'amount',
  'Expense Date': 'date',
  'Expense Loan#': '_loan_number',
  'Bank Account': '_bank_account',
  'Expense Files': '_ignore'
};

// Reusable content component for embedding in tabs
export function ExpensesImportContent() {
  const queryClient = useQueryClient();

  // State
  const [step, setStep] = useState('upload'); // upload, mapping, preview, importing, complete
  const [csvData, setCsvData] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [fieldMappings, setFieldMappings] = useState({});
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResults, setImportResults] = useState({ created: 0, errors: [], typesCreated: 0 });
  const [isImporting, setIsImporting] = useState(false);

  // Fetch existing data
  const { data: loans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_date')
  });

  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => api.entities.ExpenseType.list('name')
  });

  // Build loan lookup by loan_number
  const loanByNumber = useMemo(() => {
    const map = {};
    loans.forEach(loan => {
      if (loan.loan_number) {
        map[loan.loan_number] = loan;
      }
    });
    return map;
  }, [loans]);

  // Handle file upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const { headers, data } = parseCSV(text);
      setCsvHeaders(headers);
      setCsvData(data);

      // Auto-map columns based on defaults
      const mappings = {};
      headers.forEach(header => {
        mappings[header] = DEFAULT_EXPENSE_MAPPINGS[header] || '_ignore';
      });
      setFieldMappings(mappings);
      setStep('mapping');
    };
    reader.readAsText(file);
  };

  // Transform CSV row to expense data
  const transformExpense = (row) => {
    const mapped = {};
    const notesFields = [];

    Object.entries(fieldMappings).forEach(([csvCol, targetField]) => {
      const value = row[csvCol]?.trim() || '';
      if (!value) return;

      if (targetField === '_ignore') {
        return;
      } else if (targetField === '_notes' || targetField === '_bank_account') {
        notesFields.push(`${csvCol}: ${value}`);
      } else if (targetField === '_loan_number') {
        mapped._loan_number = value;
      } else {
        mapped[targetField] = value;
      }
    });

    // Build description including notes fields
    let description = mapped.description || '';
    if (notesFields.length > 0) {
      description = description
        ? `${description} | ${notesFields.join(' | ')}`
        : notesFields.join(' | ');
    }

    return {
      type_name: mapped.type_name || 'Miscellaneous',
      description: description,
      amount: parseAmount(mapped.amount),
      date: parseDate(mapped.date),
      _loan_number: mapped._loan_number
    };
  };

  // Preview data
  const previewData = useMemo(() => {
    if (!csvData) return [];
    return csvData.slice(0, 10).map(row => transformExpense(row));
  }, [csvData, fieldMappings]);

  // Count unique expense types that will be created
  const typesToCreate = useMemo(() => {
    if (!csvData) return [];
    const existingTypeNames = new Set(expenseTypes.map(t => t.name.toLowerCase()));
    const newTypes = new Set();

    csvData.forEach(row => {
      const expense = transformExpense(row);
      if (expense.type_name && !existingTypeNames.has(expense.type_name.toLowerCase())) {
        newTypes.add(expense.type_name);
      }
    });

    return Array.from(newTypes);
  }, [csvData, fieldMappings, expenseTypes]);

  // Summary stats
  const summaryStats = useMemo(() => {
    if (!csvData) return null;

    let totalAmount = 0;
    let withLoan = 0;
    let withoutLoan = 0;
    let invalidDates = 0;

    csvData.forEach(row => {
      const expense = transformExpense(row);
      totalAmount += expense.amount || 0;

      if (expense._loan_number && expense._loan_number !== 'N/A') {
        withLoan++;
      } else {
        withoutLoan++;
      }

      if (!expense.date) {
        invalidDates++;
      }
    });

    return {
      total: csvData.length,
      totalAmount,
      withLoan,
      withoutLoan,
      invalidDates,
      newTypes: typesToCreate.length
    };
  }, [csvData, fieldMappings, typesToCreate]);

  // Run import
  const runImport = async () => {
    if (!csvData || csvData.length === 0) return;

    setIsImporting(true);
    setStep('importing');
    setImportProgress({ current: 0, total: csvData.length });
    setImportResults({ created: 0, errors: [], typesCreated: 0 });

    // First, create any new expense types
    const typeMap = {};
    expenseTypes.forEach(t => {
      typeMap[t.name.toLowerCase()] = t.id;
    });

    let typesCreated = 0;
    for (const typeName of typesToCreate) {
      try {
        const newType = await api.entities.ExpenseType.create({
          name: typeName,
          description: `Imported from Loandisc`
        });
        typeMap[typeName.toLowerCase()] = newType.id;
        typesCreated++;
      } catch (err) {
        console.error(`Failed to create expense type "${typeName}":`, err);
      }
    }

    // Now import expenses
    let created = 0;
    const errors = [];

    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];
      const expense = transformExpense(row);

      try {
        // Get type_id
        const typeId = typeMap[expense.type_name.toLowerCase()];
        if (!typeId) {
          throw new Error(`Expense type "${expense.type_name}" not found`);
        }

        // Get loan_id if applicable
        let loanId = null;
        let borrowerName = null;
        if (expense._loan_number && expense._loan_number !== 'N/A') {
          const loan = loanByNumber[expense._loan_number];
          if (loan) {
            loanId = loan.id;
            borrowerName = loan.borrower_name;
          }
        }

        // Validate required fields
        if (!expense.date) {
          throw new Error('Missing date');
        }
        if (!expense.amount || expense.amount <= 0) {
          throw new Error('Invalid amount');
        }

        // Create expense
        await api.entities.Expense.create({
          date: expense.date,
          type_id: typeId,
          type_name: expense.type_name,
          amount: expense.amount,
          description: expense.description || null,
          loan_id: loanId,
          borrower_name: borrowerName
        });

        created++;
      } catch (err) {
        errors.push({
          row: i + 2, // +2 for header row and 1-based index
          data: expense,
          error: err.message
        });
      }

      setImportProgress({ current: i + 1, total: csvData.length });
    }

    setImportResults({ created, errors, typesCreated });
    setIsImporting(false);
    setStep('complete');

    // Log the bulk import
    logBulkImportEvent(AuditAction.BULK_IMPORT, 'expenses', {
      created,
      typesCreated,
      total: csvData.length,
      errorCount: errors.length
    });

    // Refresh data
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
    queryClient.invalidateQueries({ queryKey: ['expense-types'] });
  };

  // Reset import
  const resetImport = () => {
    setCsvData(null);
    setCsvHeaders([]);
    setFieldMappings({});
    setImportProgress({ current: 0, total: 0 });
    setImportResults({ created: 0, errors: [], typesCreated: 0 });
    setStep('upload');
  };

  return (
    <div className="space-y-6">
            {/* Progress Steps */}
            <div className="flex items-center justify-center gap-2 text-sm">
              {['upload', 'mapping', 'preview', 'importing', 'complete'].map((s, i) => (
                <React.Fragment key={s}>
                  <span className={`px-3 py-1 rounded-full ${
                    step === s ? 'bg-slate-900 text-white' :
                    ['upload', 'mapping', 'preview', 'importing', 'complete'].indexOf(step) > i ? 'bg-emerald-100 text-emerald-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
                  </span>
                  {i < 4 && <ChevronRight className="w-4 h-4 text-slate-400" />}
                </React.Fragment>
              ))}
            </div>

            {/* Step: Upload */}
            {step === 'upload' && (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-600 mb-4">
                    Upload your Loandisc expenses CSV file
                  </p>
                  <Input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="max-w-xs mx-auto"
                  />
                </div>

                <Alert>
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    Expected columns: Expense Type, Description, Expense Amount, Expense Date, Expense Loan#, Bank Account
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {/* Step: Mapping */}
            {step === 'mapping' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Column Mapping</h3>
                  <Badge variant="outline">{csvData?.length || 0} rows found</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {csvHeaders.map(header => (
                    <div key={header} className="flex items-center gap-2">
                      <span className="text-sm font-medium w-40 truncate" title={header}>
                        {header}
                      </span>
                      <Select
                        value={fieldMappings[header] || '_ignore'}
                        onValueChange={(value) => setFieldMappings(prev => ({ ...prev, [header]: value }))}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPENSE_FIELD_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between pt-4">
                  <Button variant="outline" onClick={resetImport}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Start Over
                  </Button>
                  <Button onClick={() => setStep('preview')}>
                    Preview Import
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step: Preview */}
            {step === 'preview' && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-slate-900">{summaryStats?.total || 0}</div>
                      <div className="text-sm text-slate-500">Total Expenses</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-emerald-600">{formatCurrency(summaryStats?.totalAmount || 0)}</div>
                      <div className="text-sm text-slate-500">Total Amount</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-blue-600">{summaryStats?.withLoan || 0}</div>
                      <div className="text-sm text-slate-500">Linked to Loans</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-amber-600">{summaryStats?.newTypes || 0}</div>
                      <div className="text-sm text-slate-500">New Expense Types</div>
                    </CardContent>
                  </Card>
                </div>

                {/* New Types Alert */}
                {typesToCreate.length > 0 && (
                  <Alert>
                    <Settings2 className="w-4 h-4" />
                    <AlertDescription>
                      <strong>{typesToCreate.length} new expense type(s)</strong> will be created: {typesToCreate.slice(0, 5).join(', ')}
                      {typesToCreate.length > 5 && ` and ${typesToCreate.length - 5} more...`}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Preview Table */}
                <div>
                  <h4 className="font-medium mb-2">Preview (first 10 rows)</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Loan#</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.map((expense, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-sm">
                              {expense.date ? format(new Date(expense.date), 'dd/MM/yyyy') : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {expense.type_name}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-xs truncate text-sm text-slate-600">
                              {expense.description || '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(expense.amount)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {expense._loan_number === 'N/A' ? (
                                <span className="text-slate-400">-</span>
                              ) : (
                                <span className="font-mono">{expense._loan_number}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <Button variant="outline" onClick={() => setStep('mapping')}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Mapping
                  </Button>
                  <Button onClick={runImport} className="bg-emerald-600 hover:bg-emerald-700">
                    <Play className="w-4 h-4 mr-2" />
                    Import {csvData?.length || 0} Expenses
                  </Button>
                </div>
              </div>
            )}

            {/* Step: Importing */}
            {step === 'importing' && (
              <div className="space-y-4 py-8">
                <div className="text-center">
                  <Loader2 className="w-12 h-12 animate-spin text-slate-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium">Importing Expenses...</h3>
                  <p className="text-slate-500">
                    {importProgress.current} of {importProgress.total} processed
                  </p>
                </div>
                <Progress value={(importProgress.current / importProgress.total) * 100} />
              </div>
            )}

            {/* Step: Complete */}
            {step === 'complete' && (
              <div className="space-y-4">
                <div className="text-center py-8">
                  <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                  <h3 className="text-xl font-medium">Import Complete!</h3>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-3xl font-bold text-emerald-600">{importResults.created}</div>
                      <div className="text-sm text-slate-500">Expenses Created</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-3xl font-bold text-blue-600">{importResults.typesCreated}</div>
                      <div className="text-sm text-slate-500">Types Created</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-3xl font-bold text-red-600">{importResults.errors.length}</div>
                      <div className="text-sm text-slate-500">Errors</div>
                    </CardContent>
                  </Card>
                </div>

                {importResults.errors.length > 0 && (
                  <div className="border rounded-lg p-4 bg-red-50">
                    <h4 className="font-medium text-red-900 mb-2">Import Errors</h4>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {importResults.errors.slice(0, 20).map((err, i) => (
                        <div key={i} className="text-sm text-red-700">
                          Row {err.row}: {err.error} - {err.data.type_name} ({formatCurrency(err.data.amount)})
                        </div>
                      ))}
                      {importResults.errors.length > 20 && (
                        <div className="text-sm text-red-600 font-medium">
                          ... and {importResults.errors.length - 20} more errors
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-center gap-4 pt-4">
                  <Button variant="outline" onClick={resetImport}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Import More
                  </Button>
                  <Link to={createPageUrl('Expenses')}>
                    <Button>
                      <FileText className="w-4 h-4 mr-2" />
                      View Expenses
                    </Button>
                  </Link>
                </div>
              </div>
            )}
    </div>
  );
}

// Standalone page wrapper (default export for direct page access)
export default function ImportExpenses() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('ImportLoandisc')}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Loandisc Import
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Import Expenses from Loandisc
            </CardTitle>
            <CardDescription>
              Import expense records from a Loandisc CSV export. Expense types will be auto-created if they don't exist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExpensesImportContent />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
