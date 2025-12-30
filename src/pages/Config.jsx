import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Database, Trash2, StopCircle, Users, History, ChevronLeft, ChevronRight, RefreshCw, Calendar, ShieldAlert, Palette, ArrowRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { applyScheduleToNewLoan, regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';
import { runAutoExtend, checkLoansNeedingExtension } from '@/lib/autoExtendService';
import UserManagement from '@/components/organization/UserManagement';
import CreateOrganizationDialog from '@/components/organization/CreateOrganizationDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from 'date-fns';
import { useOrganization } from '@/lib/OrganizationContext';
import { organizationThemes, getThemeOptions } from '@/lib/organizationThemes';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { getOrgItem, setOrgItem, removeOrgItem, getOrgJSON, setOrgJSON } from '@/lib/orgStorage';

export default function Config() {
  const { canAdmin, currentOrganization, refreshOrganizations, currentTheme } = useOrganization();
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [specificLoanNumber, setSpecificLoanNumber] = useState('');
  const cancelImport = useRef(false);
  const [isCreateOrgOpen, setIsCreateOrgOpen] = useState(false);
  
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

  // Purge deleted loans state
  const [purgeLoanNumber, setPurgeLoanNumber] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);
  const [purgeError, setPurgeError] = useState(null);
  const [deletedLoans, setDeletedLoans] = useState([]);
  const [loadingDeletedLoans, setLoadingDeletedLoans] = useState(false);

  // Audit log state
  const [auditPage, setAuditPage] = useState(1);
  const [auditFilter, setAuditFilter] = useState('all');
  const auditPerPage = 25;

  // Auto-extend state
  const [autoExtending, setAutoExtending] = useState(false);
  const [autoExtendProgress, setAutoExtendProgress] = useState(null);
  const [autoExtendResult, setAutoExtendResult] = useState(null);
  const [autoExtendError, setAutoExtendError] = useState(null);
  const [loansNeedingExtension, setLoansNeedingExtension] = useState(null);

  // Fetch audit logs - only when org context is ready
  const { data: auditLogs = [], isLoading: auditLoading } = useQuery({
    queryKey: ['audit-logs', currentOrganization?.id],
    queryFn: () => api.entities.AuditLog.list('-created_at', 500),
    enabled: !!currentOrganization
  });

  // Fetch user profiles to display names in audit log
  // Note: UserProfile is NOT org-scoped (users exist across orgs)
  const { data: userProfiles = [] } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: () => api.entities.UserProfile.list(),
    enabled: !!currentOrganization
  });

  // Create a lookup map for user IDs to names/emails
  // Note: user_profiles.id matches auth.users.id (which is stored as user_id in audit_logs)
  const userLookup = userProfiles.reduce((acc, profile) => {
    acc[profile.id] = profile.full_name || profile.email || profile.id?.slice(0, 8);
    return acc;
  }, {});

  const logEndRef = useRef(null);
  
  // Load logs from org-scoped localStorage on mount
  useEffect(() => {
    const savedLogs = getOrgJSON('importLogs', []);
    const savedImporting = getOrgItem('importing');
    const savedProgress = getOrgItem('importProgress');
    const savedStatus = getOrgItem('importStatus');

    if (savedLogs.length > 0) {
      setLogs(savedLogs);
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
  
  // Save logs to org-scoped localStorage whenever they change
  useEffect(() => {
    if (logs.length > 0) {
      setOrgJSON('importLogs', logs);
    }
  }, [logs]);

  // Save import state to org-scoped localStorage
  useEffect(() => {
    setOrgItem('importing', importing.toString());
    setOrgItem('importProgress', progress.toString());
    setOrgItem('importStatus', status);
  }, [importing, progress, status]);
  

  
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
    // Try multiple patterns to extract loan information
    // Pattern 1: Mr./Mrs./Ms./Dr. Name - Loan #123456
    let match = details.match(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s+(.+?)\s+-\s+Loan\s+#(\d+)/);
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

    // Pattern 2: Any text followed by Loan #123456 (more flexible)
    match = details.match(/Loan\s+#(\d+)/i);
    if (match) {
      const loanNumber = match[1];
      // Try to extract name before "Loan #"
      const nameMatch = details.match(/^(Mr\.|Mrs\.|Ms\.|Dr\.)?\s*(.+?)\s*-?\s*Loan\s+#/i);
      if (nameMatch) {
        const title = nameMatch[1] || 'Mr.';
        const fullName = nameMatch[2].trim();
        const nameParts = fullName.split(' ');
        const lastName = nameParts.pop();
        const firstName = nameParts.join(' ');

        return {
          title,
          firstName: firstName || fullName,
          lastName: lastName || '',
          fullName: fullName,
          loanNumber
        };
      }

      // If no name found, just return the loan number
      return {
        title: 'Mr.',
        firstName: 'Unknown',
        lastName: 'Borrower',
        fullName: 'Unknown Borrower',
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
      setOrgJSON('importLogs', newLogs);
      return newLogs;
    });
  };

  const clearLogs = () => {
    setLogs([]);
    removeOrgItem('importLogs');
    removeOrgItem('importing');
    removeOrgItem('importProgress');
    removeOrgItem('importStatus');
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
          const records = await api.entities[table].list();
          deleteCounts[table] = records.length;

          // Delete all records one by one
          for (const record of records) {
            await api.entities[table].delete(record.id);
          }
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

  // Load deleted loans for purge dropdown
  const loadDeletedLoans = async () => {
    setLoadingDeletedLoans(true);
    try {
      const allLoans = await api.entities.Loan.list('-deleted_date');
      const deleted = allLoans.filter(l => l.is_deleted);
      setDeletedLoans(deleted);
    } catch (err) {
      console.error('Error loading deleted loans:', err);
    } finally {
      setLoadingDeletedLoans(false);
    }
  };

  // Purge a deleted loan permanently
  const handlePurgeLoan = async () => {
    if (!purgeLoanNumber) {
      setPurgeError('Please select a loan to purge');
      return;
    }

    const loan = deletedLoans.find(l => l.loan_number === purgeLoanNumber);
    if (!loan) {
      setPurgeError('Selected loan not found');
      return;
    }

    const confirmMessage = `Are you sure you want to PERMANENTLY delete Loan #${purgeLoanNumber} (${loan.borrower_name})?\n\nThis will also delete:\n- All repayment schedule entries\n- All transactions\n\nThis action CANNOT be undone.`;
    if (!confirm(confirmMessage)) return;

    setPurging(true);
    setPurgeError(null);
    setPurgeResult(null);

    try {
      let scheduleCount = 0;
      let transactionCount = 0;

      // Delete repayment schedule entries
      const schedules = await api.entities.RepaymentSchedule.filter({ loan_id: loan.id });
      for (const schedule of schedules) {
        await api.entities.RepaymentSchedule.delete(schedule.id);
        scheduleCount++;
      }

      // Delete transactions
      const transactions = await api.entities.Transaction.filter({ loan_id: loan.id });
      for (const tx of transactions) {
        await api.entities.Transaction.delete(tx.id);
        transactionCount++;
      }

      // Delete the loan itself
      await api.entities.Loan.delete(loan.id);

      setPurgeResult({
        loanNumber: purgeLoanNumber,
        borrowerName: loan.borrower_name,
        scheduleCount,
        transactionCount
      });
      setPurgeLoanNumber('');

      // Refresh the deleted loans list
      await loadDeletedLoans();
    } catch (err) {
      console.error('Purge error:', err);
      setPurgeError(err.message);
    } finally {
      setPurging(false);
    }
  };

  // Check for loans needing extension
  const checkExtensionStatus = async () => {
    try {
      const result = await checkLoansNeedingExtension();
      setLoansNeedingExtension(result);
    } catch (err) {
      console.error('Error checking extension status:', err);
    }
  };

  // Run auto-extend for all eligible loans
  const handleAutoExtend = async () => {
    const confirmMessage = `This will automatically extend schedules for all loans with auto-extend enabled.\n\nContinue?`;
    if (!confirm(confirmMessage)) return;

    setAutoExtending(true);
    setAutoExtendError(null);
    setAutoExtendResult(null);
    setAutoExtendProgress({ current: 0, total: 0, percent: 0 });

    try {
      const result = await runAutoExtend({
        onProgress: (progress) => {
          setAutoExtendProgress(progress);
        }
      });

      setAutoExtendResult(result);
      // Refresh the extension status
      await checkExtensionStatus();
    } catch (err) {
      console.error('Auto-extend error:', err);
      setAutoExtendError(err.message);
    } finally {
      setAutoExtending(false);
      setAutoExtendProgress(null);
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setError(null);
    setProgress(0);
    setResult(null);
    setLogs([]);
    cancelImport.current = false;
    
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
        if (cancelImport.current) {
          addLog('❌ Import cancelled by user');
          return;
        }
        try {
          // Detect if this is a Fixed Charge product
          const isFixedCharge = category.toLowerCase().includes('fixed charge') ||
                                category.toLowerCase().includes('facility charge') ||
                                category.toLowerCase().includes('facility fixed');

          // Check if product already exists
          const existing = await api.entities.LoanProduct.filter({ name: category });
          if (existing.length > 0) {
            productMap[category] = existing[0];
            addLog(`  → Product already exists: ${category}${isFixedCharge ? ' (Fixed Charge)' : ''}`);
          } else {
            const productData = isFixedCharge ? {
              name: category,
              product_type: 'Fixed Charge',
              interest_rate: 0,
              interest_type: null,
              period: 'Monthly',
              min_amount: 0,
              max_amount: 1000000,
              max_duration: 120
            } : {
              name: category,
              product_type: 'Standard',
              interest_rate: 15,
              interest_type: 'Interest-Only',
              period: 'Monthly',
              min_amount: 1000,
              max_amount: 1000000,
              max_duration: 36
            };

            const product = await api.entities.LoanProduct.create(productData);

            productMap[category] = product;
            prodCount++;
            addLog(`  ✓ Created product: ${category}${isFixedCharge ? ' (Fixed Charge)' : ''}`);
          }
          await delay(1000);
        } catch (err) {
          addLog(`  ✗ Error with product ${category}: ${err.message}`);
        }
      }
      addLog(`Total: ${prodCount} new loan products created`);
      
      setProgress(20);
      setStatus('Creating expense types...');
      
      const expenseCategories = new Set();
      rows.forEach(row => {
        if (row.Type === 'Expenses' && row.Category) {
          // Only include expenses if no specific loan or if it matches specific loan
          const borrowerInfo = extractBorrowerInfo(row['Transaction Details']);
          if (!specificLoanNumber || (borrowerInfo && borrowerInfo.loanNumber === specificLoanNumber)) {
            expenseCategories.add(row.Category);
          }
        }
      });
      addLog(`Found ${expenseCategories.size} expense categories`);

      const expenseTypeMap = {};
      for (const category of expenseCategories) {
        if (cancelImport.current) {
          addLog('❌ Import cancelled by user');
          return;
        }
        try {
          const expenseType = await api.entities.ExpenseType.create({
            name: category,
            description: `Imported from transactions`
          });
          expenseTypeMap[category] = expenseType;
          addLog(`  ✓ Created expense type: ${category}`);
          await delay(800);
        } catch (err) {
          const existing = await api.entities.ExpenseType.filter({ name: category });
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
          // Filter by specific loan number if provided
          if (specificLoanNumber && loanNum !== specificLoanNumber) {
            return;
          }
          if (!loanGroups[loanNum]) {
            loanGroups[loanNum] = [];
          }
          loanGroups[loanNum].push(row);
        }
      });
      
      if (specificLoanNumber && Object.keys(loanGroups).length === 0) {
        addLog(`❌ Loan #${specificLoanNumber} not found in CSV file`);
        addLog(`Found loan numbers: ${Array.from(new Set(rows.map(r => {
          const info = extractBorrowerInfo(r['Transaction Details']);
          return info ? info.loanNumber : null;
        }).filter(Boolean))).join(', ')}`);
        throw new Error(`Loan #${specificLoanNumber} not found in CSV file`);
      }

      const borrowerMap = {};
      const loanMap = {};
      
      let processed = 0;
      const totalLoans = Object.keys(loanGroups).length;
      
      for (const [loanNum, transactions] of Object.entries(loanGroups)) {
        if (cancelImport.current) {
          addLog('❌ Import cancelled by user');
          return;
        }
        try {
          const loanRelease = transactions.find(t => t.Type === 'Loan Released');
          const deductableFee = transactions.find(t => t.Type === 'Deductable Fee');

          // If no Loan Released row, check if loan already exists in database
          if (!loanRelease) {
            const existingLoans = await api.entities.Loan.filter({ loan_number: loanNum });
            // Find first loan (deleted or not)
            const existingLoan = existingLoans[0];
            if (existingLoan) {
              // Find the borrower
              const borrowers = await api.entities.Borrower.filter({ id: existingLoan.borrower_id });
              const borrower = borrowers[0];
              if (borrower) {
                // Overwrite loan - delete old transactions and schedule, reset status
                await api.entities.Loan.update(existingLoan.id, {
                  is_deleted: false,
                  status: 'Live',
                  principal_paid: 0,
                  interest_paid: 0
                });
                await api.entities.Transaction.deleteWhere({ loan_id: existingLoan.id });
                await api.entities.RepaymentSchedule.deleteWhere({ loan_id: existingLoan.id });

                loanMap[loanNum] = { loan: { ...existingLoan, is_deleted: false, status: 'Live' }, borrower, transactions: [] };
                addLog(`  → Loan #${loanNum}: Overwriting loan for ${borrower.full_name || 'Unknown'}`);
              }
            }
            continue;
          }

          const borrowerInfo = extractBorrowerInfo(loanRelease['Transaction Details']);
          if (!borrowerInfo) continue;
          
          let borrower = borrowerMap[borrowerInfo.fullName];
          if (!borrower) {
            const existing = await api.entities.Borrower.filter({ 
              first_name: borrowerInfo.firstName,
              last_name: borrowerInfo.lastName
            });
            
            if (existing.length > 0) {
              borrower = existing[0];
            } else {
              borrower = await api.entities.Borrower.create({
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

          // Check if this is a Fixed Charge facility
          const isFixedChargeLoan = product.product_type === 'Fixed Charge';

          // For Fixed Charge loans, calculate monthly charge from the payments
          let monthlyCharge = 0;
          if (isFixedChargeLoan) {
            const chargeTxs = transactions.filter(t => t.Type === 'Interest Collections');
            if (chargeTxs.length > 0) {
              // Get the most common charge amount (mode)
              const amounts = chargeTxs.map(t => parseFloat(t.In)).filter(a => a > 0);
              const amountCounts = {};
              amounts.forEach(a => {
                amountCounts[a] = (amountCounts[a] || 0) + 1;
              });
              monthlyCharge = parseFloat(Object.keys(amountCounts).reduce((a, b) =>
                amountCounts[a] > amountCounts[b] ? a : b
              )) || 0;
            }
          }

          // Check if loan with this number already exists (including deleted)
          const existingLoans = await api.entities.Loan.filter({ loan_number: loanNum });
          if (existingLoans.length > 0) {
            const existingLoan = existingLoans[0];

            // Preserve the existing product if it exists, otherwise use CSV product
            const loanProduct = existingLoan.product_id ? existingLoan.product_id : product.id;
            const loanProductName = existingLoan.product_name || product.name;

            // Overwrite loan data (preserving product)
            const updateData = {
              borrower_id: borrower.id,
              borrower_name: borrower.full_name,
              principal_amount: isFixedChargeLoan ? 0 : principalAmount,
              arrangement_fee: arrangementFee,
              net_disbursed: isFixedChargeLoan ? 0 : principalAmount - arrangementFee,
              start_date: parseDate(loanRelease.Date),
              is_deleted: false,
              status: 'Live',
              principal_paid: 0,
              interest_paid: 0,
              product_type: product.product_type || 'Standard'
            };

            // Add Fixed Charge specific fields
            if (isFixedChargeLoan) {
              updateData.monthly_charge = monthlyCharge;
              updateData.interest_rate = 0;
              updateData.interest_type = null;
            }

            await api.entities.Loan.update(existingLoan.id, updateData);

            // Delete old transactions and schedule for clean reimport
            await api.entities.Transaction.deleteWhere({ loan_id: existingLoan.id });
            await api.entities.RepaymentSchedule.deleteWhere({ loan_id: existingLoan.id });

            const updatedLoan = {
              ...existingLoan,
              ...updateData,
              product_id: loanProduct,
              product_name: loanProductName
            };

            loanMap[loanNum] = { loan: updatedLoan, borrower, transactions: [] };
            addLog(`  → Loan #${loanNum}: Overwriting existing loan${isFixedChargeLoan ? ' (Fixed Charge - ' + formatCurrency(monthlyCharge) + '/mo)' : ''} (preserving product: ${loanProductName})`);
            continue;
          }

          // Use default 6 month duration for all imported loans
          const calculatedDuration = 6;

          // Build loan data based on product type
          const loanData = {
            loan_number: loanNum,
            borrower_id: borrower.id,
            borrower_name: borrower.full_name,
            product_id: product.id,
            product_name: product.name,
            arrangement_fee: arrangementFee,
            exit_fee: 0,
            start_date: parseDate(loanRelease.Date),
            status: 'Live',
            product_type: product.product_type || 'Standard'
          };

          if (isFixedChargeLoan) {
            // Fixed Charge facility - no principal, just monthly charges
            loanData.principal_amount = 0;
            loanData.net_disbursed = 0;
            loanData.monthly_charge = monthlyCharge;
            loanData.interest_rate = 0;
            loanData.interest_type = null;
          } else {
            // Standard loan
            loanData.principal_amount = principalAmount;
            loanData.net_disbursed = principalAmount - arrangementFee;
          }

          // Use centralized schedule manager
          const { loan } = await applyScheduleToNewLoan(loanData, product, {
            duration: calculatedDuration,
            autoExtend: true // Enable auto-extend for all imported loans
          });

          await delay(200);

          loanMap[loanNum] = { loan, borrower, transactions: [] };

          processed++;
          if (isFixedChargeLoan) {
            addLog(`  ✓ Loan #${loanNum}: ${borrower.full_name} - Fixed Charge ${formatCurrency(monthlyCharge)}/mo`);
          } else {
            addLog(`  ✓ Loan #${loanNum}: ${borrower.full_name} - ${formatCurrency(principalAmount)}`);
          }
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

      // Group transactions by loan (repayments and disbursements)
      for (const row of rows) {
        const borrowerInfo = extractBorrowerInfo(row['Transaction Details']);
        if (!borrowerInfo || !loanMap[borrowerInfo.loanNumber]) continue;

        if (repaymentTypes.includes(row.Type)) {
          const amount = parseFloat(row.In);
          if (amount > 0) {
            loanMap[borrowerInfo.loanNumber].transactions.push({
              date: parseDate(row.Date),
              amount: amount,
              type: row.Type,
              details: row['Transaction Details']
            });
          }
        } else if (row.Type === 'Disbursement') {
          // Further advance/drawdown on existing loan
          const amount = parseFloat(row.Out);
          if (amount > 0) {
            loanMap[borrowerInfo.loanNumber].transactions.push({
              date: parseDate(row.Date),
              amount: amount,
              type: 'Disbursement',
              details: row['Transaction Details']
            });
          }
        }
      }

      // Create transaction records (without applying to schedule)
      let txCount = 0;
      let disbursementCount = 0;
      let loanCount = 0;

      for (const [loanNum, loanData] of Object.entries(loanMap)) {
        if (cancelImport.current) {
          addLog('❌ Import cancelled by user');
          return;
        }
        try {
          const { loan, borrower, transactions: loanTxs } = loanData;

          if (loanTxs.length === 0) continue;

          // Check if this is a Fixed Charge loan
          const isFixedChargeLoan = loan.product_type === 'Fixed Charge';

          // Sort transactions by date
          loanTxs.sort((a, b) => new Date(a.date) - new Date(b.date));

          // Track total disbursements for this loan to update principal
          let totalDisbursements = 0;
          let hasDisbursements = false;
          let totalChargesPaid = 0;

          // Create transaction records with raw data
          for (const tx of loanTxs) {
            if (tx.type === 'Disbursement') {
              // Further advance/drawdown - create Disbursement transaction
              await api.entities.Transaction.create({
                loan_id: loan.id,
                borrower_id: borrower.id,
                amount: tx.amount,
                date: tx.date,
                type: 'Disbursement',
                principal_applied: 0,
                interest_applied: 0,
                reference: 'Further Advance',
                notes: `Imported disbursement: ${tx.details}`
              });
              totalDisbursements += tx.amount;
              hasDisbursements = true;
              disbursementCount++;
              addLog(`    → Disbursement: ${formatCurrency(tx.amount)} on ${tx.date}`);
            } else if (isFixedChargeLoan) {
              // Fixed Charge loan - treat Interest Collections as charge payments
              await api.entities.Transaction.create({
                loan_id: loan.id,
                borrower_id: borrower.id,
                amount: tx.amount,
                date: tx.date,
                type: 'Repayment',
                principal_applied: 0,
                interest_applied: 0,
                fees_applied: tx.amount, // Treat as fees/charges
                reference: 'Facility Charge',
                notes: `Imported charge payment: ${tx.details}`
              });
              totalChargesPaid += tx.amount;
            } else {
              // Regular repayment - determine type
              const isPrincipal = tx.type === 'Principal Collections';
              const isFee = tx.type === 'Fee Collections';
              // Treat anything that's not principal or fee as interest (including 'Interest Collections')
              const isInterest = !isPrincipal && !isFee;
              await api.entities.Transaction.create({
                loan_id: loan.id,
                borrower_id: borrower.id,
                amount: tx.amount,
                date: tx.date,
                type: 'Repayment',
                principal_applied: isPrincipal ? tx.amount : 0,
                interest_applied: isInterest ? tx.amount : 0,
                fees_applied: isFee ? tx.amount : 0,
                reference: tx.type,
                notes: `Imported: ${tx.details}`
              });
            }

            txCount++;
            await delay(200);
          }

          // Fixed Charge loans should never be marked as settled based on principal
          if (isFixedChargeLoan) {
            // Update loan with charges paid but keep status as Live
            await api.entities.Loan.update(loan.id, {
              charges_paid: totalChargesPaid,
              status: 'Live' // Fixed Charge loans stay Live
            });

            addLog(`    → Fixed Charge: ${formatCurrency(totalChargesPaid)} in charges paid`);

            loanCount++;
            const chargeCount = loanTxs.filter(t => t.type !== 'Disbursement').length;
            addLog(`  ✓ Loan #${loanNum}: ${chargeCount} charge payments imported`);
            setProgress(80 + (loanCount / Object.keys(loanMap).length) * 10);
            await delay(1000);
            continue;
          }

          // Standard loan settlement logic
          // Calculate principal outstanding to determine if loan is settled
          const totalDisbursed = loan.principal_amount + totalDisbursements;
          const totalPrincipalPaid = loanTxs
            .filter(t => t.type === 'Principal Collections')
            .reduce((sum, t) => sum + t.amount, 0);
          const principalOutstanding = totalDisbursed - totalPrincipalPaid;

          // Find the date of the last principal payment (settlement date)
          const principalPayments = loanTxs
            .filter(t => t.type === 'Principal Collections')
            .sort((a, b) => new Date(b.date) - new Date(a.date));
          const settlementDate = principalPayments.length > 0 ? principalPayments[0].date : null;

          // Determine loan status based on principal outstanding
          const isSettled = principalOutstanding <= 0.01;
          const loanStatus = isSettled ? 'Closed' : 'Live';

          if (isSettled) {
            addLog(`    → Loan fully settled on ${settlementDate} (principal outstanding: ${formatCurrency(principalOutstanding)})`);
          }

          // Update loan status
          await api.entities.Loan.update(loan.id, {
            principal_paid: 0,
            interest_paid: 0,
            status: loanStatus
          });

          // Always regenerate schedule after importing transactions
          const totalPrincipal = loan.principal_amount + totalDisbursements;
          addLog(`    → Regenerating schedule (total disbursed: ${formatCurrency(totalPrincipal)})`);

          if (isSettled && settlementDate) {
            // Regenerate with end date at settlement
            await regenerateLoanSchedule(loan.id, { endDate: settlementDate });
          } else {
            await regenerateLoanSchedule(loan.id);
          }

          loanCount++;
          const repaymentCount = loanTxs.filter(t => t.type !== 'Disbursement').length;
          const loanDisbursements = loanTxs.filter(t => t.type === 'Disbursement').length;
          addLog(`  ✓ Loan #${loanNum}: ${repaymentCount} repayments, ${loanDisbursements} disbursements`);
          setProgress(80 + (loanCount / Object.keys(loanMap).length) * 10);
          await delay(1000);
        } catch (err) {
          addLog(`  ✗ Error creating transactions for loan #${loanNum}: ${err.message}`);
        }
      }

      addLog(`Total: ${txCount} transactions imported (${disbursementCount} disbursements)`);
      
      setProgress(90);
      setStatus('Creating expenses...');
      
      let expenseCount = 0;
      const expBatchSize = 3;
      let expBatch = [];
      
      for (const row of rows) {
        if (cancelImport.current) {
          addLog('❌ Import cancelled by user');
          return;
        }
        if (row.Type === 'Expenses' && row.Out) {
          // Only include expenses if no specific loan or if it matches specific loan
          const borrowerInfo = extractBorrowerInfo(row['Transaction Details']);
          if (specificLoanNumber && (!borrowerInfo || borrowerInfo.loanNumber !== specificLoanNumber)) {
            continue;
          }
          
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
                await api.entities.Expense.create(exp);
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
        await api.entities.Expense.create(exp);
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
        disbursements: disbursementCount,
        expenses: expenseCount
      });

      // If importing a specific loan, clear the loan number but keep the file
      // so user can import another loan from the same file
      if (specificLoanNumber) {
        setSpecificLoanNumber('');
      }

    } catch (err) {
      console.error('Import error:', err);
      addLog(`❌ Import failed: ${err.message}`);
      setError(err.message);
    } finally {
      setImporting(false);
      setOrgItem('importing', 'false');
      addLog('Import process ended');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
          <p className="text-slate-500 mt-1">Manage your team, view audit logs, and configure system settings</p>
        </div>

        <Tabs defaultValue="team" className="space-y-6">
          <TabsList>
            <TabsTrigger value="team">
              <Users className="w-4 h-4 mr-2" />
              Team
            </TabsTrigger>
            <TabsTrigger value="audit">
              <History className="w-4 h-4 mr-2" />
              Audit Log
            </TabsTrigger>
            {canAdmin() && (
              <TabsTrigger value="admin" className="text-amber-700">
                <ShieldAlert className="w-4 h-4 mr-2" />
                Administration
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="team" className="space-y-6">
            <div className="flex justify-end">
              <Button onClick={() => setIsCreateOrgOpen(true)}>
                Create Organization
              </Button>
            </div>

            {/* Organization Theme Selector */}
            {canAdmin() && currentOrganization && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="w-5 h-5" style={{ color: currentTheme.primary }} />
                    Organization Theme
                  </CardTitle>
                  <CardDescription>
                    Choose a color theme for {currentOrganization.name} to easily identify which organization you're working in
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
                    {getThemeOptions().map((theme) => {
                      const isSelected = (currentOrganization?.settings?.theme || 'emerald') === theme.value;
                      return (
                        <button
                          key={theme.value}
                          onClick={async () => {
                            try {
                              // Update organization settings in Supabase
                              const currentSettings = currentOrganization.settings || {};
                              const newSettings = { ...currentSettings, theme: theme.value };

                              const { error } = await supabase
                                .from('organizations')
                                .update({ settings: newSettings })
                                .eq('id', currentOrganization.id);

                              if (error) throw error;

                              // Refresh organizations to pick up the new theme
                              await refreshOrganizations();
                              toast.success(`Theme changed to ${theme.label}`);
                            } catch (err) {
                              console.error('Error updating theme:', err);
                              toast.error('Failed to update theme');
                            }
                          }}
                          className={`
                            flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all
                            ${isSelected
                              ? 'border-slate-900 bg-slate-50 shadow-md'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                            }
                          `}
                        >
                          <div
                            className={`w-8 h-8 rounded-full ${isSelected ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`}
                            style={{ backgroundColor: theme.color }}
                          />
                          <span className="text-xs font-medium text-slate-700">{theme.label}</span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-slate-700" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <UserManagement />
          </TabsContent>

          {canAdmin() && (
          <TabsContent value="admin" className="space-y-6">
            {/* Admin Warning Banner */}
            <Alert className="border-amber-200 bg-amber-50">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                <strong>Administrator Area</strong> - These tools can make significant changes to your data. Use with caution.
              </AlertDescription>
            </Alert>

            {/* Import Data Section */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-600" />
                Data Import
              </h2>

              {/* Loandisc Import - Featured */}
              <Card className="border-2 border-purple-200 bg-purple-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-purple-600" />
                    Loandisc Import
                  </CardTitle>
                  <CardDescription>
                    Import borrowers, loans, and repayments from Loandisc CSV exports with full data migration support
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-600">
                      <ul className="space-y-1">
                        <li>• Import borrowers, loans, and repayments from 3 CSV files</li>
                        <li>• Auto-create loan products and detect restructure chains</li>
                        <li>• Option to clear existing data for fresh import</li>
                      </ul>
                    </div>
                    <Link to={createPageUrl('ImportLoandisc')}>
                      <Button className="bg-purple-600 hover:bg-purple-700">
                        Open Import Wizard
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Import All Loans */}
                <Card className="border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-blue-600" />
                      Import All Loans
                    </CardTitle>
                    <CardDescription>Bulk import all loans, borrowers, and transactions from CSV</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center">
                      <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={(e) => {
                          setFile(e.target.files[0]);
                          setSpecificLoanNumber('');
                        }}
                        className="hidden"
                        id="file-upload-all"
                      />
                      <label htmlFor="file-upload-all" className="cursor-pointer">
                        <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                        <p className="text-sm text-slate-600 mb-1">
                          {file && !specificLoanNumber ? file.name : 'Click to upload CSV file'}
                        </p>
                        <p className="text-xs text-slate-400">
                          Import complete transaction history
                        </p>
                      </label>
                    </div>

                    {file && !specificLoanNumber && !importing && !result && (
                      <Button onClick={handleImport} className="w-full bg-blue-600 hover:bg-blue-700">
                        <FileText className="w-4 h-4 mr-2" />
                        Import All Loans
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Import Specific Loan */}
                <Card className="border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-emerald-600" />
                      Import Specific Loan
                    </CardTitle>
                    <CardDescription>Import a single loan by loan number with all related data</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center">
                      <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={(e) => setFile(e.target.files[0])}
                        className="hidden"
                        id="file-upload-specific"
                      />
                      <label htmlFor="file-upload-specific" className="cursor-pointer">
                        <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                        <p className="text-sm text-slate-600 mb-1">
                          {file ? file.name : 'Click to upload CSV file'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {file ? 'Click to change file' : 'Import single loan data'}
                        </p>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">
                        Loan Number
                      </label>
                      <Input
                        type="text"
                        placeholder="e.g., 1000001"
                        value={specificLoanNumber}
                        onChange={(e) => setSpecificLoanNumber(e.target.value)}
                        disabled={importing}
                        className="font-mono"
                      />
                    </div>

                    {file && specificLoanNumber && !importing && (
                      <Button onClick={() => {
                        setResult(null);
                        setError(null);
                        handleImport();
                      }} className="w-full bg-emerald-600 hover:bg-emerald-700">
                        <FileText className="w-4 h-4 mr-2" />
                        Import Loan #{specificLoanNumber}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Import Status and Logs */}
              {(importing || result || error || logs.length > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Import Status</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">

                  {importing && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                          <span className="text-sm font-medium">{status}</span>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            cancelImport.current = true;
                            addLog('Stopping import...');
                          }}
                        >
                          <StopCircle className="w-4 h-4 mr-2" />
                          Stop Import
                        </Button>
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
                            <li>- {result.products} loan products created</li>
                            <li>- {result.borrowers} borrowers created</li>
                            <li>- {result.loans} loans created</li>
                            <li>- {result.transactions} transactions imported</li>
                            {result.disbursements > 0 && <li>- {result.disbursements} disbursements (further advances)</li>}
                            <li>- {result.expenses} expenses imported</li>
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
              )}
            </div>

            {/* Auto-Extend Section */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-600" />
                Loan Schedule Management
              </h2>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    Auto-Extend Loan Schedules
                  </CardTitle>
                  <CardDescription>
                    Automatically extend repayment schedules for loans with auto-extend enabled
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <Calendar className="w-4 h-4" />
                    <AlertDescription>
                      This will extend schedules up to today's date for all loans with <strong>auto-extend enabled</strong> and status <strong>Live</strong>.
                      Payments will be re-applied after regenerating schedules.
                    </AlertDescription>
                  </Alert>

                  {loansNeedingExtension && loansNeedingExtension.count > 0 && (
                    <Alert className="border-amber-200 bg-amber-50">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      <AlertDescription>
                        <p className="font-semibold text-amber-900">{loansNeedingExtension.count} loan(s) need schedule extension:</p>
                        <ul className="text-sm text-amber-800 mt-1 space-y-0.5">
                          {loansNeedingExtension.loans.slice(0, 5).map(loan => (
                            <li key={loan.id}>
                              - #{loan.loanNumber} - {loan.borrowerName} ({loan.daysOverdue} days overdue)
                            </li>
                          ))}
                          {loansNeedingExtension.loans.length > 5 && (
                            <li>- ...and {loansNeedingExtension.loans.length - 5} more</li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {autoExtending && autoExtendProgress && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-blue-900">
                            Processing loan {autoExtendProgress.current} of {autoExtendProgress.total}...
                          </span>
                          {autoExtendProgress.loan && (
                            <span className="text-sm text-blue-700 ml-2">({autoExtendProgress.loan})</span>
                          )}
                        </div>
                      </div>
                      <Progress value={autoExtendProgress.percent} className="h-2" />
                    </div>
                  )}

                  {autoExtendResult && (
                    <Alert className="border-emerald-200 bg-emerald-50">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <AlertDescription>
                        <div className="space-y-2">
                          <p className="font-semibold text-emerald-900">Auto-extend complete!</p>
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="text-center p-2 bg-emerald-100 rounded">
                              <p className="text-lg font-bold text-emerald-700">{autoExtendResult.succeeded}</p>
                              <p className="text-emerald-600">Extended</p>
                            </div>
                            <div className="text-center p-2 bg-slate-100 rounded">
                              <p className="text-lg font-bold text-slate-700">{autoExtendResult.skipped}</p>
                              <p className="text-slate-600">Skipped</p>
                            </div>
                            <div className="text-center p-2 bg-red-100 rounded">
                              <p className="text-lg font-bold text-red-700">{autoExtendResult.failed}</p>
                              <p className="text-red-600">Failed</p>
                            </div>
                          </div>
                          <p className="text-xs text-emerald-700">
                            Completed in {(autoExtendResult.duration / 1000).toFixed(1)}s
                          </p>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {autoExtendError && (
                    <Alert variant="destructive">
                      <AlertCircle className="w-4 h-4" />
                      <AlertDescription>{autoExtendError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={checkExtensionStatus}
                      disabled={autoExtending}
                      className="flex-1"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Check Status
                    </Button>
                    <Button
                      onClick={handleAutoExtend}
                      disabled={autoExtending}
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                    >
                      {autoExtending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Extending...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Run Auto-Extend Now
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Danger Zone */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-red-600 flex items-center gap-2">
                <Trash2 className="w-5 h-5" />
                Danger Zone
              </h2>
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

              {/* Purge Deleted Loans */}
              <Card>
                <CardHeader>
                  <CardTitle>Purge Deleted Loans</CardTitle>
                  <CardDescription>Permanently remove soft-deleted loans from the database</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>
                      This permanently removes loans that were previously deleted. Use this to allow re-importing a loan with the same loan number.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Select
                        value={purgeLoanNumber}
                        onValueChange={setPurgeLoanNumber}
                        onOpenChange={(open) => open && loadDeletedLoans()}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={loadingDeletedLoans ? "Loading..." : "Select a deleted loan to purge"} />
                        </SelectTrigger>
                        <SelectContent>
                          {deletedLoans.length === 0 ? (
                            <SelectItem value="_none" disabled>No deleted loans found</SelectItem>
                          ) : (
                            deletedLoans.map(loan => (
                              <SelectItem key={loan.id} value={loan.loan_number}>
                                #{loan.loan_number} - {loan.borrower_name} (deleted {loan.deleted_date ? format(new Date(loan.deleted_date), 'dd/MM/yyyy') : 'unknown'})
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {purging && (
                    <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
                      <span className="text-sm font-medium text-amber-900">Purging loan data...</span>
                    </div>
                  )}

                  {purgeResult && (
                    <Alert className="border-emerald-200 bg-emerald-50">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <AlertDescription>
                        <div className="space-y-1">
                          <p className="font-semibold text-emerald-900">Loan #{purgeResult.loanNumber} purged successfully!</p>
                          <ul className="text-sm text-emerald-800">
                            <li>- {purgeResult.scheduleCount} schedule entries deleted</li>
                            <li>- {purgeResult.transactionCount} transactions deleted</li>
                            <li>- Loan record permanently removed</li>
                          </ul>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {purgeError && (
                    <Alert variant="destructive">
                      <AlertCircle className="w-4 h-4" />
                      <AlertDescription>{purgeError}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    variant="destructive"
                    onClick={handlePurgeLoan}
                    disabled={purging || !purgeLoanNumber}
                    className="w-full"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Purge Selected Loan
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          )}

          <TabsContent value="audit" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <History className="w-5 h-5 text-slate-600" />
                      Audit Trail
                    </CardTitle>
                    <CardDescription>Complete history of all system activities and changes</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={auditFilter} onValueChange={(v) => { setAuditFilter(v); setAuditPage(1); }}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Filter by type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Events</SelectItem>
                        <SelectItem value="login">Authentication</SelectItem>
                        <SelectItem value="loan">Loans</SelectItem>
                        <SelectItem value="transaction">Transactions</SelectItem>
                        <SelectItem value="borrower">Borrowers</SelectItem>
                        <SelectItem value="product">Products</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {auditLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <History className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>No audit events recorded yet</p>
                    <p className="text-xs text-slate-400 mt-1">Events will appear here as actions are performed</p>
                  </div>
                ) : (
                  <>
                    {/* Filter and paginate */}
                    {(() => {
                      const filtered = auditFilter === 'all'
                        ? auditLogs
                        : auditLogs.filter(log => {
                            if (auditFilter === 'login') return log.action?.startsWith('login') || log.action?.startsWith('logout');
                            if (auditFilter === 'loan') return log.entity_type === 'loan';
                            if (auditFilter === 'transaction') return log.entity_type === 'transaction';
                            if (auditFilter === 'borrower') return log.entity_type === 'borrower';
                            if (auditFilter === 'product') return log.entity_type === 'loan_product';
                            return true;
                          });

                      const totalPages = Math.ceil(filtered.length / auditPerPage);
                      const paginated = filtered.slice((auditPage - 1) * auditPerPage, auditPage * auditPerPage);

                      const getActionBadge = (action) => {
                        if (action?.includes('create')) return <Badge className="bg-emerald-100 text-emerald-700">Create</Badge>;
                        if (action?.includes('update')) return <Badge className="bg-blue-100 text-blue-700">Update</Badge>;
                        if (action?.includes('delete')) return <Badge className="bg-red-100 text-red-700">Delete</Badge>;
                        if (action?.includes('login')) return <Badge className="bg-purple-100 text-purple-700">Login</Badge>;
                        if (action?.includes('logout')) return <Badge className="bg-slate-100 text-slate-700">Logout</Badge>;
                        return <Badge variant="outline">{action}</Badge>;
                      };

                      const getEntityIcon = (entityType) => {
                        switch (entityType) {
                          case 'loan': return '💰';
                          case 'transaction': return '💳';
                          case 'borrower': return '👤';
                          case 'loan_product': return '📦';
                          case 'user': return '🔐';
                          default: return '📋';
                        }
                      };

                      return (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">Date/Time</th>
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">Action</th>
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">Entity</th>
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">Details</th>
                                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-700">User</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {paginated.map((log) => {
                                  const details = log.details ? JSON.parse(log.details) : {};
                                  const prevValues = log.previous_values ? JSON.parse(log.previous_values) : null;
                                  const newValues = log.new_values ? JSON.parse(log.new_values) : null;

                                  // Generate meaningful change descriptions
                                  const getChangeDescription = () => {
                                    if (!prevValues || !newValues) return null;
                                    const changes = [];

                                    // Product changes
                                    if (prevValues.product_name !== newValues.product_name) {
                                      changes.push(`Product: ${prevValues.product_name} → ${newValues.product_name}`);
                                    }

                                    // Principal/disbursement changes
                                    if (prevValues.principal_amount !== newValues.principal_amount) {
                                      changes.push(`Principal: £${prevValues.principal_amount?.toLocaleString()} → £${newValues.principal_amount?.toLocaleString()}`);
                                    }

                                    // Fee changes
                                    if (prevValues.arrangement_fee !== newValues.arrangement_fee) {
                                      changes.push(`Arrangement fee: £${prevValues.arrangement_fee || 0} → £${newValues.arrangement_fee || 0}`);
                                    }
                                    if (prevValues.exit_fee !== newValues.exit_fee) {
                                      changes.push(`Exit fee: £${prevValues.exit_fee || 0} → £${newValues.exit_fee || 0}`);
                                    }

                                    // Interest rate changes
                                    if (prevValues.interest_rate !== newValues.interest_rate) {
                                      changes.push(`Interest rate: ${prevValues.interest_rate}% → ${newValues.interest_rate}%`);
                                    }

                                    // Interest rate override changes
                                    if (prevValues.override_interest_rate !== newValues.override_interest_rate) {
                                      changes.push(newValues.override_interest_rate
                                        ? `Rate override enabled: ${newValues.overridden_rate}%`
                                        : 'Rate override disabled');
                                    } else if (prevValues.overridden_rate !== newValues.overridden_rate && newValues.override_interest_rate) {
                                      changes.push(`Overridden rate: ${prevValues.overridden_rate}% → ${newValues.overridden_rate}%`);
                                    }

                                    // Penalty rate changes
                                    if (prevValues.has_penalty_rate !== newValues.has_penalty_rate) {
                                      changes.push(newValues.has_penalty_rate
                                        ? `Penalty rate applied: ${newValues.penalty_rate}% from ${newValues.penalty_rate_from}`
                                        : 'Penalty rate removed');
                                    } else if (prevValues.penalty_rate !== newValues.penalty_rate && newValues.has_penalty_rate) {
                                      changes.push(`Penalty rate: ${prevValues.penalty_rate}% → ${newValues.penalty_rate}%`);
                                    }
                                    if (prevValues.penalty_rate_from !== newValues.penalty_rate_from && newValues.has_penalty_rate) {
                                      changes.push(`Penalty effective: ${prevValues.penalty_rate_from || '-'} → ${newValues.penalty_rate_from}`);
                                    }

                                    // Duration changes
                                    if (prevValues.duration !== newValues.duration) {
                                      changes.push(`Duration: ${prevValues.duration} → ${newValues.duration} periods`);
                                    }

                                    // Start date changes
                                    if (prevValues.start_date !== newValues.start_date) {
                                      changes.push(`Start date: ${prevValues.start_date} → ${newValues.start_date}`);
                                    }

                                    return changes.length > 0 ? changes : null;
                                  };

                                  const changeDescriptions = getChangeDescription();

                                  return (
                                    <tr key={log.id} className="hover:bg-slate-50">
                                      <td className="py-2 px-3 text-xs text-slate-600">
                                        {log.created_at ? format(new Date(log.created_at), 'dd/MM/yy HH:mm') : '-'}
                                      </td>
                                      <td className="py-2 px-3">
                                        {getActionBadge(log.action)}
                                      </td>
                                      <td className="py-2 px-3">
                                        <div className="flex items-center gap-1.5">
                                          <span>{getEntityIcon(log.entity_type)}</span>
                                          <span className="text-xs font-medium text-slate-700">
                                            {log.entity_name || log.entity_type || '-'}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-xs text-slate-500 max-w-md">
                                        {log.action?.includes('delete') && details.reason ? (
                                          <span className="text-red-600">Reason: {details.reason}</span>
                                        ) : log.action?.includes('update') && changeDescriptions ? (
                                          <div className="space-y-0.5">
                                            {changeDescriptions.slice(0, 3).map((change, idx) => (
                                              <div key={idx} className="truncate">{change}</div>
                                            ))}
                                            {changeDescriptions.length > 3 && (
                                              <div className="text-slate-400">+{changeDescriptions.length - 3} more changes</div>
                                            )}
                                          </div>
                                        ) : log.action?.includes('update') && prevValues ? (
                                          <span>Modified fields</span>
                                        ) : details.amount ? (
                                          <span>Amount: £{details.amount?.toLocaleString()}</span>
                                        ) : details.success === false ? (
                                          <span className="text-red-600">Failed: {details.reason}</span>
                                        ) : (
                                          '-'
                                        )}
                                      </td>
                                      <td className="py-2 px-3 text-xs text-slate-600">
                                        {log.user_id ? (
                                          <span>{userLookup[log.user_id] || log.user_id.slice(0, 8) + '...'}</span>
                                        ) : log.entity_name && log.action?.includes('login') ? (
                                          log.entity_name
                                        ) : '-'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Pagination */}
                          {totalPages > 1 && (
                            <div className="flex items-center justify-between mt-4 pt-4 border-t">
                              <p className="text-xs text-slate-500">
                                Showing {((auditPage - 1) * auditPerPage) + 1} - {Math.min(auditPage * auditPerPage, filtered.length)} of {filtered.length} events
                              </p>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                                  disabled={auditPage === 1}
                                >
                                  <ChevronLeft className="w-4 h-4" />
                                </Button>
                                <span className="text-xs text-slate-600">
                                  Page {auditPage} of {totalPages}
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setAuditPage(p => Math.min(totalPages, p + 1))}
                                  disabled={auditPage === totalPages}
                                >
                                  <ChevronRight className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <CreateOrganizationDialog
          open={isCreateOrgOpen}
          onClose={() => setIsCreateOrgOpen(false)}
        />
      </div>
    </div>
  );
}