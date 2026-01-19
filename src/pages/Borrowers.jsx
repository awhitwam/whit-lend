import { useState, useMemo } from 'react';
import { api } from '@/api/dataClient';
import { supabase } from '@/lib/supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, Users, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import BorrowerTable from '@/components/borrower/BorrowerTable';
import BorrowerForm from '@/components/borrower/BorrowerForm';
import EmptyState from '@/components/ui/EmptyState';
import { logBorrowerEvent, AuditAction } from '@/lib/auditLog';

export default function Borrowers() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBorrower, setEditingBorrower] = useState(null);
  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();

  const { data: allBorrowers = [], isLoading } = useQuery({
    queryKey: ['borrowers', currentOrganization?.id],
    queryFn: () => api.entities.Borrower.list('-created_date'),
    enabled: !!currentOrganization
  });

  // Fetch all loans to calculate counts per borrower
  const { data: allLoans = [] } = useQuery({
    queryKey: ['loans', currentOrganization?.id],
    queryFn: () => api.entities.Loan.list(),
    enabled: !!currentOrganization
  });

  // Fetch all transactions to calculate outstanding amounts
  const { data: allTransactions = [] } = useQuery({
    queryKey: ['all-transactions', currentOrganization?.id],
    queryFn: () => api.entities.Transaction.listAll(),
    enabled: !!currentOrganization
  });

  // Get suggested borrower number from organization settings
  const suggestedBorrowerNumber = String(currentOrganization?.settings?.next_borrower_number || 1000001);

  // Calculate loan counts and financial metrics per borrower
  const borrowerMetrics = useMemo(() => {
    const metrics = {};
    const activeLoans = allLoans.filter(l => !l.is_deleted);

    // First pass: calculate basic counts and principal per borrower
    activeLoans.forEach(loan => {
      if (!loan.borrower_id) return;
      if (!metrics[loan.borrower_id]) {
        metrics[loan.borrower_id] = {
          total: 0,
          live: 0,
          settled: 0,
          pending: 0,
          defaulted: 0,
          totalPrincipal: 0,
          totalInterest: 0,
          principalPaid: 0,
          interestPaid: 0,
          disbursements: 0
        };
      }

      metrics[loan.borrower_id].total++;

      if (loan.status === 'Live' || loan.status === 'Active') {
        metrics[loan.borrower_id].live++;
        // Only count exposure for live loans
        metrics[loan.borrower_id].totalPrincipal += loan.principal_amount || 0;
        metrics[loan.borrower_id].totalInterest += loan.total_interest || 0;
      } else if (loan.status === 'Closed') {
        metrics[loan.borrower_id].settled++;
      } else if (loan.status === 'Pending') {
        metrics[loan.borrower_id].pending++;
      } else if (loan.status === 'Defaulted') {
        metrics[loan.borrower_id].defaulted++;
        // Include defaulted in exposure
        metrics[loan.borrower_id].totalPrincipal += loan.principal_amount || 0;
        metrics[loan.borrower_id].totalInterest += loan.total_interest || 0;
      }
    });

    // Second pass: calculate payments and further advances from transactions
    // Group disbursements by loan to identify which are "further advances" (not the initial disbursement)
    const disbursementsByLoan = {};
    allTransactions
      .filter(t => !t.is_deleted && t.type === 'Disbursement')
      .forEach(t => {
        if (!disbursementsByLoan[t.loan_id]) {
          disbursementsByLoan[t.loan_id] = [];
        }
        disbursementsByLoan[t.loan_id].push(t);
      });

    // Sort each loan's disbursements by date and identify further advances (skip first)
    const furtherAdvanceIds = new Set();
    Object.values(disbursementsByLoan).forEach(disbursements => {
      disbursements.sort((a, b) => new Date(a.date) - new Date(b.date));
      // Skip the first disbursement (initial principal), mark rest as further advances
      disbursements.slice(1).forEach(d => furtherAdvanceIds.add(d.id));
    });

    allTransactions.filter(t => !t.is_deleted).forEach(transaction => {
      if (!transaction.borrower_id || !metrics[transaction.borrower_id]) return;

      // Find the loan for this transaction
      const loan = activeLoans.find(l => l.id === transaction.loan_id);
      if (!loan || (loan.status !== 'Live' && loan.status !== 'Active' && loan.status !== 'Defaulted')) return;

      if (transaction.type === 'Disbursement') {
        // Only count further advances (not the initial disbursement)
        if (furtherAdvanceIds.has(transaction.id)) {
          metrics[transaction.borrower_id].disbursements += transaction.amount || 0;
        }
      } else if (transaction.type === 'Repayment') {
        metrics[transaction.borrower_id].principalPaid += transaction.principal_applied || 0;
        metrics[transaction.borrower_id].interestPaid += transaction.interest_applied || 0;
      }
    });

    // Calculate outstanding for each borrower
    Object.keys(metrics).forEach(borrowerId => {
      const m = metrics[borrowerId];
      const totalPrincipalWithDisbursements = m.totalPrincipal + m.disbursements;
      const principalOutstanding = totalPrincipalWithDisbursements - m.principalPaid;
      const interestOutstanding = m.totalInterest - m.interestPaid;
      m.totalOutstanding = Math.max(0, principalOutstanding + interestOutstanding);
      m.principalOutstanding = Math.max(0, principalOutstanding);
    });

    return metrics;
  }, [allLoans, allTransactions]);

  // For backwards compatibility, extract just loan counts
  const loanCountsByBorrower = useMemo(() => {
    const counts = {};
    Object.keys(borrowerMetrics).forEach(borrowerId => {
      const m = borrowerMetrics[borrowerId];
      counts[borrowerId] = {
        total: m.total,
        live: m.live,
        settled: m.settled,
        pending: m.pending,
        defaulted: m.defaulted
      };
    });
    return counts;
  }, [borrowerMetrics]);

  const borrowers = allBorrowers
    .filter(b => !b.is_archived)
    .sort((a, b) => {
      const nameA = (a.business || `${a.first_name || ''} ${a.last_name || ''}`).trim().toLowerCase();
      const nameB = (b.business || `${b.first_name || ''} ${b.last_name || ''}`).trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });

  const createMutation = useMutation({
    mutationFn: (data) => api.entities.Borrower.create(data),
    onSuccess: async (newBorrower, variables) => {
      logBorrowerEvent(AuditAction.BORROWER_CREATE, newBorrower || { id: null, name: variables.full_name }, {
        full_name: variables.full_name,
        business: variables.business,
        email: variables.email,
        phone: variables.phone,
        unique_number: variables.unique_number
      });

      // Update organization settings with next borrower number
      if (variables.unique_number) {
        const nextNumber = parseInt(variables.unique_number) + 1;
        await supabase
          .from('organizations')
          .update({
            settings: {
              ...currentOrganization.settings,
              next_borrower_number: nextNumber
            }
          })
          .eq('id', currentOrganization.id);
      }

      queryClient.invalidateQueries({ queryKey: ['borrowers'] });
      setIsFormOpen(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.Borrower.update(id, data),
    onSuccess: (updatedBorrower, variables) => {
      logBorrowerEvent(AuditAction.BORROWER_UPDATE,
        updatedBorrower || { id: variables.id, name: variables.data.full_name || editingBorrower?.full_name },
        variables.data,
        editingBorrower
      );
      queryClient.invalidateQueries({ queryKey: ['borrowers'] });
      setIsFormOpen(false);
      setEditingBorrower(null);
    }
  });

  const handleSubmit = async (data) => {
    if (editingBorrower) {
      updateMutation.mutate({ id: editingBorrower.id, data });
    } else {
      // Auto-generate unique_number if not provided
      if (!data.unique_number) {
        let borrowerNumber = currentOrganization?.settings?.next_borrower_number || 1000001;

        // Check for uniqueness
        const { data: existingBorrowers } = await supabase
          .from('borrowers')
          .select('unique_number')
          .eq('organization_id', currentOrganization.id);
        const usedNumbers = new Set(existingBorrowers?.map(b => b.unique_number) || []);

        while (usedNumbers.has(String(borrowerNumber))) {
          borrowerNumber++;
        }
        data.unique_number = String(borrowerNumber);
      }
      // Set full_name as business name if available, otherwise first + last name
      data.full_name = data.business || `${data.first_name} ${data.last_name}`;
      createMutation.mutate(data);
    }
  };

  const handleEdit = (borrower) => {
    setEditingBorrower(borrower);
    setIsFormOpen(true);
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setEditingBorrower(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Borrowers</h1>
            <p className="text-slate-500 mt-1">Manage your borrower profiles</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to={createPageUrl('ImportBorrowers')}>
              <Button variant="outline">
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Button>
            </Link>
            <Button onClick={() => setIsFormOpen(true)} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="w-4 h-4 mr-2" />
              Add Borrower
            </Button>
          </div>
        </div>

        {/* Content */}
        {borrowers.length === 0 && !isLoading ? (
          <EmptyState
            icon={Users}
            title="No borrowers yet"
            description="Add your first borrower to start managing loans"
            action={
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Borrower
              </Button>
            }
          />
        ) : (
          <BorrowerTable
            borrowers={borrowers}
            onEdit={handleEdit}
            isLoading={isLoading}
            loanCounts={loanCountsByBorrower}
          />
        )}

        {/* Form Panel */}
        <Sheet open={isFormOpen} onOpenChange={handleClose}>
          <SheetContent className="sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle>
                {editingBorrower ? 'Edit Borrower' : 'Add New Borrower'}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <BorrowerForm
                borrower={editingBorrower}
                onSubmit={handleSubmit}
                onCancel={handleClose}
                isLoading={createMutation.isPending || updateMutation.isPending}
                suggestedBorrowerNumber={suggestedBorrowerNumber}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
