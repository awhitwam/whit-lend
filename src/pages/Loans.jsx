import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, FileText } from 'lucide-react';
import LoanCard from '@/components/loan/LoanCard';
import EmptyState from '@/components/ui/EmptyState';

export default function Loans() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => base44.entities.Loan.list('-created_date')
  });

  const filteredLoans = loans.filter(loan => {
    const matchesSearch = 
      loan.borrower_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan.product_name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    all: loans.length,
    Pending: loans.filter(l => l.status === 'Pending').length,
    Approved: loans.filter(l => l.status === 'Approved').length,
    Active: loans.filter(l => l.status === 'Active').length,
    Closed: loans.filter(l => l.status === 'Closed').length,
    Defaulted: loans.filter(l => l.status === 'Defaulted').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Loans</h1>
            <p className="text-slate-500 mt-1">Manage all loan applications and active loans</p>
          </div>
          <Link to={createPageUrl('NewLoan')}>
            <Button className="bg-slate-900 hover:bg-slate-800">
              <Plus className="w-4 h-4 mr-2" />
              New Loan
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search loans..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full md:w-auto">
            <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full md:w-auto">
              <TabsTrigger value="all" className="text-xs">
                All ({statusCounts.all})
              </TabsTrigger>
              <TabsTrigger value="Pending" className="text-xs">
                Pending ({statusCounts.Pending})
              </TabsTrigger>
              <TabsTrigger value="Active" className="text-xs">
                Active ({statusCounts.Active})
              </TabsTrigger>
              <TabsTrigger value="Approved" className="text-xs">
                Approved ({statusCounts.Approved})
              </TabsTrigger>
              <TabsTrigger value="Closed" className="text-xs">
                Closed ({statusCounts.Closed})
              </TabsTrigger>
              <TabsTrigger value="Defaulted" className="text-xs">
                Defaulted ({statusCounts.Defaulted})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="h-48 bg-white rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredLoans.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={searchTerm || statusFilter !== 'all' ? "No loans match your filters" : "No loans yet"}
            description={searchTerm || statusFilter !== 'all' ? "Try adjusting your search or filters" : "Create your first loan to get started"}
            action={
              !searchTerm && statusFilter === 'all' && (
                <Link to={createPageUrl('NewLoan')}>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Loan
                  </Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredLoans.map((loan) => (
              <LoanCard key={loan.id} loan={loan} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}