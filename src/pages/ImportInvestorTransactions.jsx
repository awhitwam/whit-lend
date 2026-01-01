import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

// CSV Parser that handles quoted fields AND multi-line values
function parseCSV(text) {
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

  const data = [];
  const content = text.substring(firstNewline + 1);
  let i = 0;

  while (i < content.length) {
    const values = [];
    current = '';
    inQuotes = false;

    while (i < content.length) {
      const char = content[i];

      if (char === '"') {
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
        values.push(current.trim().replace(/^"|"$/g, ''));
        while (i < content.length && (content[i] === '\n' || content[i] === '\r')) {
          i++;
        }
        break;
      }

      if (char !== '\r') {
        current += char;
      }
      i++;
    }

    if (i >= content.length && current !== '') {
      values.push(current.trim().replace(/^"|"$/g, ''));
    }

    if (values.length > 0 && values.some(v => v !== '')) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }
  }

  return data;
}

// Parse date in format "DD/MM/YYYY, HH:MMam/pm" or "DD/MM/YYYY"
function parseDate(dateStr) {
  if (!dateStr) return null;

  // Try to extract just the date part (DD/MM/YYYY)
  const dateMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!dateMatch) return null;

  const [, day, month, year] = dateMatch;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Map CSV transaction type to database type
// Returns { type, isInterest, isInterestDebit }
// Interest accruals (credits) are SKIPPED - the nightly job handles accruals automatically
// Only interest payments/withdrawals (debits) are imported
function mapTransactionType(csvType, isCredit = true) {
  const type = csvType?.toLowerCase()?.trim();
  if (type === 'deposit') return { type: 'capital_in', isInterest: false, isInterestDebit: false };
  if (type === 'withdrawal') return { type: 'capital_out', isInterest: false, isInterestDebit: false };
  // Interest handling:
  // - Interest accruals (credits) are SKIPPED - system calculates these automatically via nightly job
  // - Interest payments/withdrawals (debits) are imported to track actual payments made to investors
  if (type === 'interest_accrual' ||
      type === 'interest_payment' ||
      type === 'interest' ||
      type === 'investor interest payment' ||
      type === 'system generated interest' ||
      type.includes('interest')) {
    // Only import interest debits (actual payments), skip credits (accruals)
    return { type: 'interest', isInterest: true, isInterestDebit: !isCredit };
  }
  return { type: 'capital_in', isInterest: false, isInterestDebit: false }; // Default
}

// Transform a single transaction row
// Supports two CSV formats:
// 1. Alternative format: Date, Name, Account#, Product, Balance, Type, Description, Debit, Credit
// 2. Original format: Transaction Id, Account Number, Transaction Type, Transaction Balance, etc.
function transformTransactionData(row, investors, isFirstRow = false) {
  // Log first row for debugging
  if (isFirstRow) {
    console.log('=== CSV COLUMN DEBUG ===');
    console.log('All column names:', Object.keys(row));
    console.log('Sample values:', row);
    console.log('========================');
  }

  // Detect format and get account number
  // Alternative format uses "Account#", original uses "Account Number"
  const accountNumber = (row['Account#'] || row['Account Number'])?.trim();

  const matchedInvestor = investors.find(inv =>
    inv.account_number === accountNumber
  );

  if (!matchedInvestor) {
    return null; // Can't import without matching investor
  }

  // Parse amount - check for Debit/Credit columns first (alternative format)
  // then fall back to Transaction Balance (original format)
  let amount = 0;
  let transactionType = '';
  let isCredit = true; // For determining interest type

  const debitStr = (row['Debit'] || '').replace(/,/g, '').trim();
  const creditStr = (row['Credit'] || '').replace(/,/g, '').trim();
  const debitAmount = parseFloat(debitStr) || 0;
  const creditAmount = parseFloat(creditStr) || 0;

  if (debitAmount > 0 || creditAmount > 0) {
    // Alternative format with Debit/Credit columns
    // Credit = money coming IN (deposit, interest accrued)
    // Debit = money going OUT (withdrawal, interest paid out)
    const typeFromCsv = row['Type']?.toLowerCase()?.trim() || '';

    if (creditAmount > 0) {
      amount = creditAmount;
      isCredit = true;
      transactionType = typeFromCsv || 'deposit';
    } else {
      amount = debitAmount;
      isCredit = false;
      transactionType = typeFromCsv || 'withdrawal';
    }
  } else {
    // Original format - use Transaction Balance
    const amountStr = (row['Transaction Balance'] || '').replace(/,/g, '');
    amount = parseFloat(amountStr) || 0;
    transactionType = row['Transaction Type']?.toLowerCase()?.trim() || '';
    // For original format, assume positive is credit
    isCredit = amount >= 0;
  }

  // Debug: log if amount is 0
  if (amount === 0) {
    console.warn('Transaction amount is 0 for row:', row);
    return null; // Skip zero amount transactions
  }

  // Parse date - alternative format uses "Date", original uses "Transaction Date"
  const dateStr = row['Date'] || row['Transaction Date'];
  const date = parseDate(dateStr);
  if (!date) {
    return null; // Can't import without date
  }

  // Get description - alternative format uses "Description", original uses "Transaction Description"
  const description = (row['Description'] || row['Transaction Description'])?.trim() || null;

  // Map transaction type - may return interest type info
  const mappedType = mapTransactionType(transactionType, isCredit);

  return {
    investor_id: matchedInvestor.id,
    type: mappedType.type,
    isInterest: mappedType.isInterest,
    isInterestDebit: mappedType.isInterestDebit, // true for interest payments (debits only)
    amount: amount,
    date: date,
    transaction_id: row['Transaction Id']?.trim() || null,
    description: description,
    bank_account: row['Bank Account']?.trim() || null,
    is_auto_generated: false
  };
}

export default function ImportInvestorTransactions() {
  const [file, setFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch investors for matching
  const { data: investors = [] } = useQuery({
    queryKey: ['investors'],
    queryFn: () => api.entities.Investor.list()
  });

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setImportResult(null);
  };

  const handleImport = async () => {
    if (!file) return;

    setIsProcessing(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const rows = parseCSV(text);

      // Fetch existing transactions for duplicate checking
      const existingTransactions = await api.entities.InvestorTransaction.list();
      const existingInterest = await api.entities.InvestorInterest.list();

      let created = 0;
      let skipped = 0;
      const errors = [];

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        try {
          const txData = transformTransactionData(row, investors, rowIndex === 0);

          if (!txData) {
            const accountNum = row['Account Number']?.trim() || row['Account#']?.trim();
            const reason = accountNum
              ? `Investor not found for account ${accountNum}`
              : 'Missing account number or date';
            errors.push(`Row ${rowIndex + 2}: ${reason}`);
            skipped++;
            continue;
          }

          // Handle interest entries - only import DEBITS (actual payments to investors)
          // Interest accruals (credits) are SKIPPED - the nightly job handles accruals automatically
          if (txData.isInterest) {
            // Skip interest accruals (credits) - system calculates these automatically
            if (!txData.isInterestDebit) {
              skipped++;
              continue;
            }

            // Check for duplicate interest debit entry by date and amount
            const existingEntry = existingInterest.find(e =>
              e.investor_id === txData.investor_id &&
              e.date === txData.date &&
              e.type === 'debit' &&
              Math.abs(e.amount - txData.amount) < 0.01
            );

            if (existingEntry) {
              skipped++;
              continue;
            }

            // Create interest debit entry (actual payment to investor)
            await api.entities.InvestorInterest.create({
              investor_id: txData.investor_id,
              date: txData.date,
              type: 'debit', // Always debit for imported interest payments
              amount: txData.amount,
              description: txData.description,
              reference: txData.transaction_id
            });
            created++;
            continue;
          }

          // Handle capital transactions (capital_in, capital_out)
          // Check if transaction already exists by transaction_id
          const existing = txData.transaction_id && existingTransactions.find(tx =>
            tx.transaction_id === txData.transaction_id
          );

          if (existing) {
            skipped++;
            continue;
          }

          // Create new capital transaction
          await api.entities.InvestorTransaction.create({
            investor_id: txData.investor_id,
            type: txData.type,
            amount: txData.amount,
            date: txData.date,
            transaction_id: txData.transaction_id,
            description: txData.description,
            bank_account: txData.bank_account,
            is_auto_generated: txData.is_auto_generated
          });
          created++;

        } catch (error) {
          errors.push(`Row ${rowIndex + 2}: ${error.message}`);
        }
      }

      setImportResult({
        success: true,
        created,
        skipped,
        errors,
        total: rows.length
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['investorTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['investor-interest'] });
      queryClient.invalidateQueries({ queryKey: ['investors'] });

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
        <Link to={createPageUrl('Investors')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Investors
          </Button>
        </Link>

        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Import Investor Transactions</h1>
          <p className="text-slate-500 mt-1">Upload a CSV file to import deposits, withdrawals, and interest payments</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>CSV File Upload</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              <p className="text-xs text-slate-500 mt-2">
                Expected columns: Transaction Id, Account Number, Transaction Type (Deposit/Withdrawal), Transaction Balance, Transaction Date, Transaction Description, Bank Account
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleImport}
                disabled={!file || isProcessing}
                className="bg-slate-900 hover:bg-slate-800"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import Transactions
                  </>
                )}
              </Button>
              {file && !isProcessing && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setFile(null);
                    setImportResult(null);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>

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
                            <p>• Created: {importResult.created} new transaction(s)</p>
                            <p>• Skipped: {importResult.skipped} row(s) (duplicates or unmatched)</p>
                            <p>• Total processed: {importResult.total} row(s)</p>
                          </div>
                          {importResult.errors.length > 0 && (
                            <div className="mt-3">
                              <p className="font-medium text-amber-900">Errors:</p>
                              <ul className="text-xs text-amber-800 list-disc list-inside mt-1 max-h-32 overflow-y-auto">
                                {importResult.errors.slice(0, 10).map((error, i) => (
                                  <li key={i}>{error}</li>
                                ))}
                                {importResult.errors.length > 10 && (
                                  <li>... and {importResult.errors.length - 10} more</li>
                                )}
                              </ul>
                            </div>
                          )}
                          <Button
                            size="sm"
                            className="mt-3"
                            onClick={() => navigate(createPageUrl('Investors'))}
                          >
                            View Investors
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
          </CardContent>
        </Card>

        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Supported CSV Formats:</h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li><strong>Format 1:</strong> Date, Name, Account#, Product, Balance, Type, Description, Debit, Credit</li>
              <li><strong>Format 2:</strong> Transaction Id, Account Number, Transaction Type, Transaction Balance, etc.</li>
            </ul>
            <h3 className="font-semibold text-blue-900 mt-3 mb-2">How it works:</h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Transactions are matched to investors by Account# or Account Number</li>
              <li>Amounts come from Debit/Credit columns or Transaction Balance</li>
              <li>Credit = deposit (capital in), Debit = withdrawal (capital out)</li>
              <li>Interest-related types are mapped to interest_payment</li>
              <li>Make sure to import Investor Accounts first</li>
            </ul>
          </CardContent>
        </Card>

        {investors.length === 0 && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <AlertDescription className="ml-2">
              <span className="font-medium text-amber-900">No investors found.</span>{' '}
              <span className="text-amber-800">
                Import investor accounts first so transactions can be matched.{' '}
                <Link to={createPageUrl('ImportInvestors')} className="underline">
                  Import Investors
                </Link>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
