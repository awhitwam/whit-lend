import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Settings, Database } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Config() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);

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
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const extractBorrowerInfo = (details) => {
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

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const addLog = (message) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setError(null);
    setProgress(0);
    setResult(null);
    setLogs([]);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      
      setStatus('Creating loan products...');
      
      const productCategories = new Set();
      rows.forEach(row => {
        if (row.Category && (row.Type === 'Loan Released' || row.Type === 'Deductable Fee')) {
          productCategories.add(row.Category);
        }
      });

      const productMap = {};
      let prodCount = 0;
      for (const category of productCategories) {
        let interestType = 'Reducing';
        let interestRate = 15;
        
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
        prodCount++;
        await delay(500);
      }
      addLog(`Created ${prodCount} loan products`);
      
      setProgress(20);
      setStatus('Creating expense types...');
      
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
          await delay(300);
        } catch (err) {
          const existing = await base44.entities.ExpenseType.filter({ name: category });
          if (existing.length > 0) {
            expenseTypeMap[category] = existing[0];
          }
        }
      }
      
      setProgress(40);
      setStatus('Processing borrowers and loans...');
      
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
          duration: 6,
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
        await delay(800);
      }
      addLog(`Created ${processed} loans with borrowers`);
      
      setProgress(80);
      setStatus('Creating transactions...');
      
      const repaymentTypes = ['Interest Collections', 'Principal Collections', 'Fee Collections'];
      let txCount = 0;
      const txBatchSize = 5;
      let txBatch = [];
      const loanTotals = {}; // Track totals per loan
      
      for (const row of rows) {
        if (repaymentTypes.includes(row.Type)) {
          const borrowerInfo = extractBorrowerInfo(row['Transaction Details']);
          if (!borrowerInfo || !loanMap[borrowerInfo.loanNumber]) continue;
          
          const { loan, borrower } = loanMap[borrowerInfo.loanNumber];
          const amount = parseFloat(row.In);
          
          if (amount > 0) {
            const principalApplied = row.Type === 'Principal Collections' ? amount : 0;
            const interestApplied = row.Type === 'Interest Collections' ? amount : 0;
            
            // Track totals
            if (!loanTotals[loan.id]) {
              loanTotals[loan.id] = { principal: 0, interest: 0 };
            }
            loanTotals[loan.id].principal += principalApplied;
            loanTotals[loan.id].interest += interestApplied;
            
            txBatch.push({
              loan_id: loan.id,
              borrower_id: borrower.id,
              amount: amount,
              date: parseDate(row.Date),
              type: 'Repayment',
              principal_applied: principalApplied,
              interest_applied: interestApplied,
              reference: row.Type,
              notes: `Imported: ${row['Transaction Details']}`
            });
            
            if (txBatch.length >= txBatchSize) {
              for (const tx of txBatch) {
                await base44.entities.Transaction.create(tx);
                txCount++;
              }
              txBatch = [];
              await delay(1000);
              setProgress(80 + (txCount / rows.length) * 10);
            }
          }
        }
      }
      
      // Process remaining transactions
      for (const tx of txBatch) {
        await base44.entities.Transaction.create(tx);
        txCount++;
      }
      
      // Update loan totals
      setStatus('Updating loan totals...');
      for (const [loanId, totals] of Object.entries(loanTotals)) {
        await base44.entities.Loan.update(loanId, {
          principal_paid: totals.principal,
          interest_paid: totals.interest
        });
        await delay(300);
      }
      addLog(`Updated ${Object.keys(loanTotals).length} loans with payment totals`);
      
      setProgress(90);
      setStatus('Creating expenses...');
      
      let expenseCount = 0;
      const expBatchSize = 5;
      let expBatch = [];
      
      for (const row of rows) {
        if (row.Type === 'Expenses' && row.Out) {
          const amount = parseFloat(row.Out);
          const expenseType = expenseTypeMap[row.Category];
          
          if (expenseType && amount > 0) {
            expBatch.push({
              date: parseDate(row.Date),
              type_id: expenseType.id,
              type_name: expenseType.name,
              amount: amount,
              description: row['Transaction Details'] || row.Category
            });
            
            if (expBatch.length >= expBatchSize) {
              for (const exp of expBatch) {
                await base44.entities.Expense.create(exp);
                expenseCount++;
              }
              expBatch = [];
              await delay(1000);
            }
          }
        }
      }
      
      // Process remaining expenses
      for (const exp of expBatch) {
        await base44.entities.Expense.create(exp);
        expenseCount++;
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
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500 mt-1">Manage system configuration and data imports</p>
        </div>

        <Tabs defaultValue="import" className="space-y-6">
          <TabsList>
            <TabsTrigger value="import">
              <Database className="w-4 h-4 mr-2" />
              Import Data
            </TabsTrigger>
            <TabsTrigger value="general">
              <Settings className="w-4 h-4 mr-2" />
              General
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Import Transaction History</CardTitle>
                <CardDescription>Upload a CSV file to bulk import loans, borrowers, and transactions</CardDescription>
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
          </TabsContent>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>Configure general application settings</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">Additional settings can be configured here.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}