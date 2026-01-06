import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { logInvestorEvent, AuditAction } from '@/lib/auditLog';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Users, TrendingUp, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import InvestorForm from '@/components/investor/InvestorForm';
import EmptyState from '@/components/ui/EmptyState';
import { calculateAccruedInterest } from '@/lib/interestCalculation';

export default function Investors() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState(null);
  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();

  const { data: investors = [], isLoading } = useQuery({
    queryKey: ['investors', currentOrganization?.id],
    queryFn: () => api.entities.Investor.list(),
    enabled: !!currentOrganization
  });

  // Fetch all interest entries to calculate due/accruing amounts
  const { data: allInterestEntries = [] } = useQuery({
    queryKey: ['allInvestorInterest', currentOrganization?.id],
    queryFn: () => api.entities.InvestorInterest.list(),
    enabled: !!currentOrganization
  });

  // Calculate interest due and accruing for each investor
  const investorInterestData = useMemo(() => {
    const data = {};

    investors.forEach(investor => {
      const entries = allInterestEntries.filter(e => e.investor_id === investor.id);
      const annualRate = investor.annual_interest_rate || 0;
      const currentBalance = investor.current_capital_balance || 0;

      // Calculate interest due (credits not yet withdrawn since last_accrual_date)
      const cutoffDate = investor.last_accrual_date;
      let interestDue = 0;
      if (cutoffDate) {
        const recentCredits = entries
          .filter(e => e.type === 'credit' && e.date >= cutoffDate)
          .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const recentDebits = entries
          .filter(e => e.type === 'debit' && e.date >= cutoffDate)
          .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        interestDue = Math.max(0, recentCredits - recentDebits);
      }

      // Calculate interest accruing (only for investors with annual rate)
      let accruing = 0;
      if (annualRate > 0 && currentBalance > 0) {
        const accrued = calculateAccruedInterest(currentBalance, annualRate, investor.last_accrual_date);
        accruing = accrued.accruedInterest;
      }

      data[investor.id] = { interestDue, accruing };
    });

    return data;
  }, [investors, allInterestEntries]);

  const createMutation = useMutation({
    mutationFn: (data) => api.entities.Investor.create(data),
    onSuccess: (newInvestor, variables) => {
      logInvestorEvent(AuditAction.INVESTOR_CREATE, newInvestor, {
        name: variables.name,
        email: variables.email,
        interest_calculation_type: variables.interest_calculation_type,
        annual_interest_rate: variables.annual_interest_rate,
        status: variables.status
      });
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      setIsFormOpen(false);
      setEditingInvestor(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.Investor.update(id, data),
    onSuccess: (updatedInvestor, variables) => {
      logInvestorEvent(AuditAction.INVESTOR_UPDATE, updatedInvestor, variables.data, editingInvestor);
      queryClient.invalidateQueries({ queryKey: ['investors'] });
      setIsFormOpen(false);
      setEditingInvestor(null);
    }
  });

  const handleSubmit = (data) => {
    if (editingInvestor) {
      updateMutation.mutate({ id: editingInvestor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const totalCapital = investors.reduce((sum, inv) => sum + (inv.current_capital_balance || 0), 0);
  const activeInvestors = investors.filter(inv => inv.status === 'Active');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Investors</h1>
            <p className="text-slate-500 mt-1">Manage investor capital and interest payments</p>
          </div>
          <Button onClick={() => { setEditingInvestor(null); setIsFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            Add Investor
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Investors</p>
                  <p className="text-2xl font-bold">{investors.length}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-100">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Active Investors</p>
                  <p className="text-2xl font-bold">{activeInvestors.length}</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-100">
                  <Users className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Capital</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalCapital)}</p>
                </div>
                <div className="p-3 rounded-xl bg-purple-100">
                  <TrendingUp className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-8 space-y-4">
              {Array(5).fill(0).map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </CardContent>
          </Card>
        ) : investors.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No investors yet"
            description="Add your first investor to start tracking capital and interest"
            action={
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Investor
              </Button>
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Name</TableHead>
                    <TableHead>Interest Type</TableHead>
                    <TableHead className="text-right">Current Capital</TableHead>
                    <TableHead className="text-right">Interest Due</TableHead>
                    <TableHead className="text-right">Accruing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {investors.map((investor) => {
                    const interestData = investorInterestData[investor.id] || { interestDue: 0, accruing: 0 };
                    return (
                      <TableRow key={investor.id} className="hover:bg-slate-50">
                        <TableCell className="font-medium">{investor.name}</TableCell>
                        <TableCell>
                          {investor.interest_calculation_type === 'annual_rate' && investor.annual_interest_rate > 0 ? (
                            <span className="text-sm">{investor.annual_interest_rate}% p.a.</span>
                          ) : (
                            <span className="text-sm text-slate-500 italic">Manual</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(investor.current_capital_balance || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          <span className={interestData.interestDue > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                            {formatCurrency(interestData.interestDue)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          <span className={interestData.accruing > 0 ? 'text-blue-600' : 'text-slate-400'}>
                            {formatCurrency(interestData.accruing)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={investor.status === 'Active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-700'
                          }>
                            {investor.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link to={createPageUrl(`InvestorDetails?id=${investor.id}`)}>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingInvestor ? 'Edit Investor' : 'Add Investor'}</DialogTitle>
            </DialogHeader>
            <InvestorForm
              investor={editingInvestor}
              onSubmit={handleSubmit}
              onCancel={() => { setIsFormOpen(false); setEditingInvestor(null); }}
              isLoading={createMutation.isPending || updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}