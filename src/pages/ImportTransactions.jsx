import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { parse } from 'date-fns';

export default function ImportTransactions() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',');
    
    return lines.slice(1).map(line => {
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let char of line) {
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
      headers.forEach((header, i) => {
        row[header.trim()] = values[i] || '';
      });
      return row;
    });
  };

  const parseDate = (dateStr) => {
    // Format: DD/MM/YYYY
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const extractBorrowerInfo = (details) => {
    // Extract borrower name from "Mr. John Doe - Loan #1000001"
    const match = details.match(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s+(.+?)\s+-\s+Loan\s+#(\d+)/);
    if (match) {
      const [, title, fullName, loanNumber] = match;
      const nameParts = fullName.trim().split(' ');
      const lastName = nameParts.pop();
      const firstName = nameParts.join(' ');
      
      return {
        title,
        firstName,
        lastName,
        fullName: `${title} ${fullName}`,
        loanNumber
      };
    }
    return null;
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setError(null);
    setProgress(0);
    setResult(null);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      
      setStatus('Creating loan products...');
      
      // Extract unique loan product categories
      const productCategories = new Set();
      rows.forEach(row => {
        if (row.Category && (row.Type === 'Loan Released' || row.Type === 'Deductable Fee')) {
          productCategories.add(row.Category);
        }
      });

      const productMap = {};
      for (const category of productCategories) {
        // Determine interest type from category name
        let interestType = 'Reducing';
        let interestRate = 15; // Default
        
        if (category.toLowerCase().includes('rollup')) {
          interestType = 'Rolled-Up';
        } else if (category.toLowerCase().includes('serviced')) {
          interestType = 'Reducing';
        }
        
        const product = await base44.entities.LoanProduct.create({
          name: category,
          interest_rate: interestRate,
          interest_type: interestType,
          period: 'Monthly',
          min_amount: 1000,
          max_amount: 1000000,
          max_duration: 36
        });
        
        productMap[category] = product;
      }
      
      setProgress(20);
      setStatus('Creating expense types...');
      
      // Create expense types
      const expenseCategories = new Set();
      rows.forEach(row => {
        if (row.Type === 'Expenses' && row.Category) {
          expenseCategories.add(row.Category);
        }
      });

      const expenseTypeMap = {};
      for (const category of expenseCategories) {
        try {
          const expenseType = await base44.entities.ExpenseType.create({
            name: category,
            description: `Imported from transactions`
          });
          expenseTypeMap[category] = expenseType;
        } catch (err) {
          // Type might already exist, try to find it
          const existing = await base44.entities.ExpenseType.filter({ name: category });
          if (existing.length > 0) {
            expenseTypeMap[category] = existing[0];
          }
        }
      }
      
      setProgress(40);
      setStatus('Processing borrowers and loans...');
      
      // Group transactions by loan
      const loanGroups = {};
      rows.forEach(row => {
        const borrowerInfo = extractBorrowerInfo(row['Transaction Details']);
        if (borrowerInfo) {
          const loanNum = borrowerInfo.loanNumber;
          if (!loanGroups[loanNum]) {
            loanGroups[loanNum] = [];
          }
          loanGroups[loanNum].push(row);
        }
      });

      const borrowerMap = {};
      const loanMap = {};
      
      let processed = 0;
      const totalLoans = Object.keys(loanGroups).length;
      
      for (const [loanNum, transactions] of Object.entries(loanGroups)) {
        const loanRelease = transactions.find(t => t.Type === 'Loan Released');
        const deductableFee = transactions.find(t => t.Type === 'Deductable Fee');
        
        if (!loanRelease) continue;
        
        const borrowerInfo = extractBorrowerInfo(loanRelease['Transaction Details']);
        if (!borrowerInfo) continue;
        
        // Create or get borrower
        let borrower = borrowerMap[borrowerInfo.fullName];
        if (!borrower) {
          const existing = await base44.entities.Borrower.filter({ 
            first_name: borrowerInfo.firstName,
            last_name: borrowerInfo.lastName
          });
          
          if (existing.length > 0) {
            borrower = existing[0];
          } else {
            borrower = await base44.entities.Borrower.create({
              first_name: borrowerInfo.firstName,
              last_name: borrowerInfo.lastName,
              full_name: borrowerInfo.fullName,
              phone: '000000000',
              status: 'Active'
            });
          }
          borrowerMap[borrowerInfo.fullName] = borrower;
        }
        
        // Create loan
        const principalAmount = parseFloat(loanRelease.Out);
        const arrangementFee = deductableFee ? parseFloat(deductableFee.In) : 0;
        const product = productMap[loanRelease.Category];
        
        if (!product) continue;
        
        const loan = await base44.entities.Loan.create({
          borrower_id: borrower.id,
          borrower_name: borrower.full_name,
          product_id: product.id,
          product_name: product.name,
          principal_amount: principalAmount,
          arrangement_fee: arrangementFee,
          exit_fee: 0,
          net_disbursed: principalAmount - arrangementFee,
          interest_rate: product.interest_rate,
          interest_type: product.interest_type,
          period: product.period,
          duration: 6, // Default to 6 months from category
          start_date: parseDate(loanRelease.Date),
          status: 'Live',
          total_interest: 0,
          total_repayable: principalAmount,
          principal_paid: 0,
          interest_paid: 0
        });
        
        loanMap[loanNum] = { loan, borrower };
        
        processed++;
        setProgress(40 + (processed / totalLoans) * 40);
      }
      
      setProgress(80);
      setStatus('Creating transactions...');
      
      // Create repayment transactions
      const repaymentTypes = ['Interest Collections', 'Principal Collections', 'Fee Collections'];
      let txCount = 0;
      
      for (const row of rows) {
        if (repaymentTypes.includes(row.Type)) {
          const borrowerInfo = extractBorrowerInfo(row['Transaction Details']);
          if (!borrowerInfo || !loanMap[borrowerInfo.loanNumber]) continue;
          
          const { loan, borrower } = loanMap[borrowerInfo.loanNumber];
          const amount = parseFloat(row.In);
          
          if (amount > 0) {
            await base44.entities.Transaction.create({
              loan_id: loan.id,
              borrower_id: borrower.id,
              amount: amount,
              date: parseDate(row.Date),
              type: 'Repayment',
              principal_applied: row.Type === 'Principal Collections' ? amount : 0,
              interest_applied: row.Type === 'Interest Collections' ? amount : 0,
              reference: row.Type,
              notes: `Imported: ${row['Transaction Details']}`
            });
            txCount++;
          }
        }
      }
      
      setProgress(90);
      setStatus('Creating expenses...');
      
      // Create expenses
      let expenseCount = 0;
      for (const row of rows) {
        if (row.Type === 'Expenses' && row.Out) {
          const amount = parseFloat(row.Out);
          const expenseType = expenseTypeMap[row.Category];
          
          if (expenseType && amount > 0) {
            await base44.entities.Expense.create({
              date: parseDate(row.Date),
              type_id: expenseType.id,
              type_name: expenseType.name,
              amount: amount,
              description: row['Transaction Details'] || row.Category
            });
            expenseCount++;
          }
        }
      }
      
      setProgress(100);
      setStatus('Import complete!');
      setResult({
        products: Object.keys(productMap).length,
        borrowers: Object.keys(borrowerMap).length,
        loans: Object.keys(loanMap).length,
        transactions: txCount,
        expenses: expenseCount
      });
      
    } catch (err) {
      console.error('Import error:', err);
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Import Transactions</h1>
          <p className="text-slate-500 mt-1">Upload your transaction history CSV file</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upload Transaction File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => setFile(e.target.files[0])}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                <p className="text-sm text-slate-600 mb-2">
                  {file ? file.name : 'Click to upload CSV file'}
                </p>
                <p className="text-xs text-slate-400">
                  Expected format: Date, Type, Category, Transaction Details, In, Out, Balance
                </p>
              </label>
            </div>

            {file && !importing && !result && (
              <Button onClick={handleImport} className="w-full" size="lg">
                <FileText className="w-4 h-4 mr-2" />
                Start Import
              </Button>
            )}

            {importing && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span className="text-sm font-medium">{status}</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-slate-500 text-center">{progress}% complete</p>
              </div>
            )}

            {result && (
              <Alert className="border-emerald-200 bg-emerald-50">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <AlertDescription>
                  <div className="space-y-2">
                    <p className="font-semibold text-emerald-900">Import completed successfully!</p>
                    <ul className="text-sm text-emerald-800 space-y-1">
                      <li>• {result.products} loan products created</li>
                      <li>• {result.borrowers} borrowers created</li>
                      <li>• {result.loans} loans created</li>
                      <li>• {result.transactions} transactions imported</li>
                      <li>• {result.expenses} expenses imported</li>
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p>This tool will:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Create loan products from unique categories</li>
              <li>Extract and create borrowers from transaction details</li>
              <li>Create loans with proper fees and amounts</li>
              <li>Import all repayment transactions (interest, principal, fees)</li>
              <li>Create expense records for all business expenses</li>
            </ol>
            <p className="text-amber-600 font-medium mt-4">
              ⚠️ Note: Balance column is ignored. Loan calculations will be based on the imported data.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}