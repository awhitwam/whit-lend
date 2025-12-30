import { api } from '@/api/dataClient';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import ContactGroupView from '@/components/borrower/ContactGroupView';
import EmptyState from '@/components/ui/EmptyState';

export default function BorrowersByContact() {
  const { data: allBorrowers = [], isLoading } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list('-created_date')
  });

  // Fetch all loans to calculate counts per borrower
  const { data: allLoans = [] } = useQuery({
    queryKey: ['loans-for-counts'],
    queryFn: () => api.entities.Loan.list()
  });

  // Filter out deleted borrowers
  const borrowers = allBorrowers.filter(b => !b.is_deleted);

  // Calculate loan counts per borrower
  const loanCountsByBorrower = {};
  borrowers.forEach(b => {
    const borrowerLoans = allLoans.filter(l => l.borrower_id === b.id && !l.is_deleted);
    loanCountsByBorrower[b.id] = {
      total: borrowerLoans.length,
      live: borrowerLoans.filter(l => l.status === 'Live' || l.status === 'Active').length,
      settled: borrowerLoans.filter(l => l.status === 'Closed' || l.status === 'Fully Paid').length
    };
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Borrowers by Contact</h1>
          <p className="text-slate-500 mt-1">View borrowers grouped by their contact email</p>
        </div>

        {/* Content */}
        {borrowers.length === 0 && !isLoading ? (
          <EmptyState
            icon={Users}
            title="No borrowers yet"
            description="Add borrowers to see them grouped by contact"
          />
        ) : (
          <ContactGroupView
            borrowers={borrowers}
            loanCounts={loanCountsByBorrower}
            loans={allLoans}
          />
        )}
      </div>
    </div>
  );
}
