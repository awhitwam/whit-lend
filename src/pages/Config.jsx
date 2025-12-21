import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Settings, Database, Trash2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateRepaymentSchedule, calculateLoanSummary, applyPaymentWaterfall } from '@/components/loan/LoanCalculator';

export default function Config() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  
  const [selectedTables, setSelectedTables] = useState({
    RepaymentSchedule: false,
    Transaction: false,
    Expense: false,
    ExpenseType: false,
    Loan: false,
    Borrower: false,
    InvestorTransaction: false,
    Investor: false,
    LoanProduct: false
  });
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  
  const logEndRef = useRef(null);
  
  // Load logs from localStorage on mount
  useEffect(() => {
    const savedLogs = localStorage.getItem('importLogs');
    const savedImporting = localStorage.getItem('importing');
    const savedProgress = localStorage.getItem('importProgress');
    const savedStatus = localStorage.getItem('importStatus');
    
    if (savedLogs) {
      setLogs(JSON.parse(savedLogs));
    }
    if (savedImporting === 'true') {
      setImporting(true);
    }
    if (savedProgress) {
      setProgress(Number(savedProgress));
    }
    if (savedStatus) {
      setStatus(savedStatus);
    }
  }, []);
  
  // Save logs to localStorage whenever they change
  useEffect(() => {
    if (logs.length > 0) {
      localStorage.setItem('importLogs', JSON.stringify(logs));
    }
  }, [logs]);
  
  // Save import state
  useEffect(() => {
    localStorage.setItem('importing', importing.toString());
    localStorage.setItem('importProgress', progress.toString());
    localStorage.setItem('importStatus', status);
  }, [importing, progress, status]);
  
  // Auto-scroll to latest log
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);
  
  // Prevent page unload during import
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (importing) {
        e.preventDefault();
        e.returnValue = 'Import in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [importing]);

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

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0
    }).format(amount || 0);
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
    const logEntry = `${new Date().toLocaleTimeString()}: ${message}`;
    setLogs(prev => {
      const newLogs = [...prev, logEntry];
      localStorage.setItem('importLogs', JSON.stringify(newLogs));
      return newLogs;
    });
  };
  
  const clearLogs = () => {
    setLogs([]);
    localStorage.removeItem('importLogs');
    localStorage.removeItem('importing');
    localStorage.removeItem('importProgress');
    localStorage.removeItem('importStatus');
  };

  const handleDeleteData = async () => {
    const selectedCount = Object.values(selectedTables).filter(Boolean).length;
    if (selectedCount === 0) {
      setDeleteError('Please select at least one table to delete');
      return;
    }

    const confirmMessage = `Are you sure you want to delete all data from ${selectedCount} table(s)? This action cannot be undone.`;
    if (!confirm(confirmMessage)) return;

    setDeleting(true);
    setDeleteError(null);
    setDeleteResult(null);

    try {
      const deleteCounts = {};
      
      // Delete in order to respect foreign key constraints
      const deleteOrder = [
        'RepaymentSchedule',
        'Transaction',
        'Expense',
        'Loan',
        'InvestorTransaction',
        'Investor',
        'Borrower',
        'ExpenseType',
        'LoanProduct'
      ];

      for (const table of deleteOrder) {
        if (selectedTables[table]) {
          const records = await base44.entities[table].list();
          deleteCounts[table] = records.length;
          
          // Bulk delete using filter with empty query to match all
          await fetch(`/api/entities/${table}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: {} })
          });
        }
      }

      setDeleteResult(deleteCounts);
    } catch (err) {
      console.error('Delete error:', err);
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const toggleTable = (table) => {
    setSelectedTables(prev => ({ ...prev, [table]: !prev[table] }));
  };

  const selectAll = () => {
    const allSelected = Object.values(selectedTables).every(Boolean);
    const newState = {};
    Object.keys(selectedTables).forEach(key => {
      newState[key] = !allSelected;
    });
    setSelectedTables(newState);
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setError(null);
    setProgress(0);
    setResult(null);
    setLogs([]);
    
    addLog('🚀 Starting import process...');

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      addLog(`File loaded: ${rows.length} rows found`);
      
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
        try {
          const product = await base44.entities.LoanProduct.create({
            name: category,
            interest_rate: 15,
            interest_type: 'Interest-Only',
            period: 'Monthly',
            min_amount: 1000,
            max_amount: 1000000,
            max_duration: 36
          });
          
          productMap[category] = product;
          prodCount++;
          addLog(`  ✓ Created product: ${category}`);
          await delay(1000);
        } catch (err) {
          addLog(`  ✗ Error creating product ${category}: ${err.message}`);
        }
      }
      addLog(`Total: ${prodCount} loan products created`);
      
      setProgress(20);
      setStatus('Creating expense types...');
      
      const expenseCategories = new Set();
      rows.forEach(row => {
        if (row.Type === 'Expenses' && row.Category) {
          expenseCategories.add(row.Category);
        }
      });
      addLog(`Found ${expenseCategories.size} expense categories`);

      const expenseTypeMap = {};
      for (const category of expenseCategories) {
        try {
          const expenseType = await base44.entities.ExpenseType.create({
            name: category,
            description: `Imported from transactions`
          });
          expenseTypeMap[category] = expenseType;
          addLog(`  ✓ Created expense type: ${category}`);
          await delay(800);
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
        try {
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
          
          // Generate repayment schedule
          const schedule = generateRepaymentSchedule({
            principal: principalAmount,
            interestRate: product.interest_rate,
            duration: 6,
            interestType: product.interest_type,
            period: product.period,
            startDate: parseDate(loanRelease.Date),
            interestOnlyPeriod: 0,
            interestAlignment: 'period_based',
            extendForFullPeriod: false
          });

          const summary = calculateLoanSummary(schedule);

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
            total_interest: summary.totalInterest,
            total_repayable: summary.totalRepayable,
            principal_paid: 0,
            interest_paid: 0
          });

          // Create repayment schedule
          for (const row of schedule) {
            await base44.entities.RepaymentSchedule.create({
              loan_id: loan.id,
              ...row
            });
            await delay(200);
          }

          loanMap[loanNum] = { loan, borrower, transactions: [] };

          processed++;
          addLog(`  ✓ Loan #${loanNum}: ${borrower.full_name} - ${formatCurrency(principalAmount)}`);
          setProgress(40 + (processed / totalLoans) * 40);
          await delay(1500);
        } catch (err) {
          addLog(`  ✗ Error processing loan #${loanNum}: ${err.message}`);
        }
        }
        addLog(`Total: ${processed} loans created`);
      
      setProgress(80);
      setStatus('Processing transactions...');

      const repaymentTypes = ['Interest Collections', 'Principal Collections', 'Fee Collections'];

      // Group transactions by loan
      for (const row of rows) {
        if (repaymentTypes.includes(row.Type)) {
          const borrowerInfo = extractBorrowerInfo(row['Transaction Details']);
          if (!borrowerInfo || !loanMap[borrowerInfo.loanNumber]) continue;

          const amount = parseFloat(row.In);
          if (amount > 0) {
            loanMap[borrowerInfo.loanNumber].transactions.push({
              date: parseDate(row.Date),
              amount: amount,
              type: row.Type,
              details: row['Transaction Details']
            });
          }
        }
      }

      // Apply payments to each loan's schedule
      let txCount = 0;
      let loanCount = 0;

      for (const [loanNum, loanData] of Object.entries(loanMap)) {
        try {
          const { loan, borrower, transactions: loanTxs } = loanData;

          if (loanTxs.length === 0) continue;

          // Sort transactions by date
          loanTxs.sort((a, b) => new Date(a.date) - new Date(b.date));

          // Get schedule
          const schedule = await base44.entities.RepaymentSchedule.filter({ loan_id: loan.id }, 'installment_number');

          let totalPrincipalPaid = 0;
          let totalInterestPaid = 0;

          // Apply each payment
          for (const tx of loanTxs) {
            const { updates } = applyPaymentWaterfall(tx.amount, schedule, 0, 'credit');

            // Update schedule rows
            for (const update of updates) {
              await base44.entities.RepaymentSchedule.update(update.id, {
                interest_paid: update.interest_paid,
                principal_paid: update.principal_paid,
                status: update.status
              });
              totalPrincipalPaid += update.principalApplied || 0;
              totalInterestPaid += update.interestApplied || 0;
              await delay(200);
            }

            // Create transaction record
            await base44.entities.Transaction.create({
              loan_id: loan.id,
              borrower_id: borrower.id,
              amount: tx.amount,
              date: tx.date,
              type: 'Repayment',
              principal_applied: updates.reduce((sum, u) => sum + (u.principalApplied || 0), 0),
              interest_applied: updates.reduce((sum, u) => sum + (u.interestApplied || 0), 0),
              reference: tx.type,
              notes: `Imported: ${tx.details}`
            });

            txCount++;
          }

          // Update loan totals
          const status = totalPrincipalPaid >= loan.principal_amount ? 'Closed' : 'Live';
          await base44.entities.Loan.update(loan.id, {
            principal_paid: totalPrincipalPaid,
            interest_paid: totalInterestPaid,
            status: status
          });

          loanCount++;
          addLog(`  ✓ Loan #${loanNum}: Applied ${loanTxs.length} payments`);
          setProgress(80 + (loanCount / Object.keys(loanMap).length) * 10);
          await delay(1500);
        } catch (err) {
          addLog(`  ✗ Error applying payments for loan #${loanNum}: ${err.message}`);
        }
      }

      addLog(`Total: ${txCount} transactions created and applied`);
      
      setProgress(90);
      setStatus('Creating expenses...');
      
      let expenseCount = 0;
      const expBatchSize = 3;
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
                await delay(300);
              }
              addLog(`  ✓ Created ${expBatchSize} expenses (total: ${expenseCount})`);
              expBatch = [];
              await delay(1500);
            }
          }
        }
      }
      
      // Process remaining expenses
      for (const exp of expBatch) {
        await base44.entities.Expense.create(exp);
        expenseCount++;
      }
      if (expBatch.length > 0) {
        addLog(`  ✓ Created remaining ${expBatch.length} expenses`);
      }
      addLog(`Total: ${expenseCount} expenses created`);
      addLog(`✓ Import completed successfully!`);
      
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
      addLog(`❌ Import failed: ${err.message}`);
      setError(err.message);
    } finally {
      setImporting(false);
      localStorage.setItem('importing', 'false');
      addLog('Import process ended');
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

                {logs.length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm text-slate-700">Import Log ({logs.length} entries)</h3>
                      <Button variant="ghost" size="sm" onClick={clearLogs}>
                        Clear Log
                      </Button>
                    </div>
                    <div className="space-y-1 text-xs text-slate-600 font-mono max-h-64 overflow-y-auto">
                      {[...logs].reverse().map((log, idx) => (
                        <div key={idx}>{log}</div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </div>
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
                <CardTitle>Delete Data</CardTitle>
                <CardDescription>Permanently delete data from selected tables</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    <strong>Warning:</strong> This action cannot be undone. All data from selected tables will be permanently deleted.
                  </AlertDescription>
                </Alert>

                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b">
                    <span className="text-sm font-medium">Select Tables</span>
                    <Button variant="outline" size="sm" onClick={selectAll}>
                      {Object.values(selectedTables).every(Boolean) ? 'Deselect All' : 'Select All'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.keys(selectedTables).map(table => (
                      <label
                        key={table}
                        className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTables[table]}
                          onChange={() => toggleTable(table)}
                          className="w-4 h-4 rounded border-slate-300"
                        />
                        <span className="text-sm font-medium">{table}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {deleting && (
                  <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">Deleting data...</span>
                  </div>
                )}

                {deleteResult && (
                  <Alert className="border-emerald-200 bg-emerald-50">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <AlertDescription>
                      <div className="space-y-2">
                        <p className="font-semibold text-emerald-900">Data deleted successfully!</p>
                        <ul className="text-sm text-emerald-800 space-y-1">
                          {Object.entries(deleteResult).map(([table, count]) => (
                            <li key={table}>• {table}: {count} records deleted</li>
                          ))}
                        </ul>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {deleteError && (
                  <Alert variant="destructive">
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>{deleteError}</AlertDescription>
                  </Alert>
                )}

                <Button 
                  variant="destructive" 
                  onClick={handleDeleteData}
                  disabled={deleting || Object.values(selectedTables).every(v => !v)}
                  className="w-full"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Selected Data
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}