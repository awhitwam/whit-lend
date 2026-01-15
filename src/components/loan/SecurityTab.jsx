import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';
import { useOrganization } from '@/lib/OrganizationContext';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from './LoanCalculator';
import {
  Building2,
  Plus,
  TrendingUp,
  Shield,
  Loader2,
  Trash2,
  Mail
} from 'lucide-react';
import PropertyCard from './PropertyCard';
import PropertyModal from './PropertyModal';
import ValuationHistoryModal from './ValuationHistoryModal';
import ValuationRequestLetterModal from './ValuationRequestLetterModal';
import { toast } from 'sonner';
import { logLoanPropertyEvent, AuditAction } from '@/lib/auditLog';
import { format } from 'date-fns';

export default function SecurityTab({ loan }) {
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);
  const [selectedLoanProperty, setSelectedLoanProperty] = useState(null);
  const [isValuationModalOpen, setIsValuationModalOpen] = useState(false);
  const [showAddFormOnOpen, setShowAddFormOnOpen] = useState(false);
  const [propertyToRemove, setPropertyToRemove] = useState(null);
  const [activeTab, setActiveTab] = useState('active');
  const [isLetterModalOpen, setIsLetterModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();

  // Query for loan properties with related data
  const { data: loanProperties = [], isLoading } = useQuery({
    queryKey: ['loan-properties', loan.id],
    queryFn: async () => {
      const links = await api.entities.LoanProperty.filter({ loan_id: loan.id });

      // Fetch related property data and first charge holders for each link
      const enrichedLinks = await Promise.all(links.map(async (link) => {
        const [properties, firstChargeHolders, valuations] = await Promise.all([
          api.entities.Property.filter({ id: link.property_id }),
          link.first_charge_holder_id
            ? api.entities.FirstChargeHolder.filter({ id: link.first_charge_holder_id })
            : Promise.resolve([]),
          api.entities.ValueHistory.filter({ property_id: link.property_id }, '-effective_date')
        ]);

        // Get most recent property valuation date
        const lastPropertyValuation = valuations.find(v => v.value_type === 'Property Valuation');
        // Get most recent first charge balance date (for second charges)
        const lastFirstChargeBalance = valuations.find(v => v.value_type === 'First Charge Balance');

        return {
          ...link,
          property: properties[0],
          firstChargeHolder: firstChargeHolders[0],
          lastValuationDate: lastPropertyValuation?.effective_date,
          lastFirstChargeBalanceDate: lastFirstChargeBalance?.effective_date
        };
      }));

      return enrichedLinks;
    },
    enabled: !!loan.id
  });

  // Fetch borrower for letter modal
  const { data: borrower } = useQuery({
    queryKey: ['borrower', loan?.borrower_id],
    queryFn: async () => {
      const borrowers = await api.entities.Borrower.filter({ id: loan.borrower_id });
      return borrowers[0];
    },
    enabled: !!loan?.borrower_id
  });

  // Separate active and removed properties
  const activeProperties = loanProperties.filter(lp => lp.status === 'Active');
  const removedProperties = loanProperties.filter(lp => lp.status === 'Removed');

  // Remove property mutation
  const removePropertyMutation = useMutation({
    mutationFn: async (loanProperty) => {
      await api.entities.LoanProperty.update(loanProperty.id, {
        status: 'Removed',
        removed_date: new Date().toISOString(),
        removed_reason: 'Removed by user'
      });

      await logLoanPropertyEvent(
        AuditAction.LOAN_PROPERTY_REMOVE,
        loanProperty,
        loan,
        loanProperty.property
      );
    },
    onSuccess: () => {
      toast.success('Property removed from loan');
      queryClient.invalidateQueries({ queryKey: ['loan-properties', loan.id] });
      setPropertyToRemove(null);
    },
    onError: (error) => {
      toast.error('Failed to remove property: ' + error.message);
    }
  });

  // Calculate security metrics
  const calculateSecurityMetrics = () => {
    let totalSecurityValue = 0;
    let staleValuations = 0;
    let staleFirstChargeBalances = 0;
    const STALE_VALUATION_MONTHS = 12;
    const STALE_BALANCE_MONTHS = 6;

    activeProperties.forEach(lp => {
      if (!lp.property) return;

      const propertyValue = lp.property.current_value || 0;
      const securityValue = lp.charge_type === 'Second Charge'
        ? Math.max(0, propertyValue - (lp.first_charge_balance || 0))
        : propertyValue;

      totalSecurityValue += securityValue;

      // Check for stale valuations
      if (lp.lastValuationDate) {
        const monthsSinceValuation = Math.floor(
          (new Date() - new Date(lp.lastValuationDate)) / (1000 * 60 * 60 * 24 * 30)
        );
        if (monthsSinceValuation >= STALE_VALUATION_MONTHS) {
          staleValuations++;
        }
      } else {
        staleValuations++;
      }

      // Check for stale first charge balances (only for second charges)
      if (lp.charge_type === 'Second Charge') {
        if (lp.lastFirstChargeBalanceDate) {
          const monthsSinceBalance = Math.floor(
            (new Date() - new Date(lp.lastFirstChargeBalanceDate)) / (1000 * 60 * 60 * 24 * 30)
          );
          if (monthsSinceBalance >= STALE_BALANCE_MONTHS) {
            staleFirstChargeBalances++;
          }
        } else if (lp.first_charge_balance) {
          // Has a balance but no history record - consider it stale
          staleFirstChargeBalances++;
        }
      }
    });

    // Initial LTV - based on original loan amount
    const initialLtv = totalSecurityValue > 0
      ? ((loan.principal_amount || 0) / totalSecurityValue) * 100
      : 0;

    // Current LTV - based on total outstanding (principal + interest)
    // Use principal_remaining and interest_remaining fields (populated by nightly jobs/balance cache)
    const totalOutstanding = (loan.principal_remaining ?? loan.principal_amount ?? 0)
      + (loan.interest_remaining ?? 0);
    const ltv = totalSecurityValue > 0
      ? (totalOutstanding / totalSecurityValue) * 100
      : 0;

    return {
      totalSecurityValue,
      initialLtv,
      ltv,
      propertyCount: activeProperties.length,
      staleValuations,
      staleFirstChargeBalances
    };
  };

  const metrics = calculateSecurityMetrics();

  const getLtvColor = (ltv) => {
    if (ltv > 80) return { bg: 'from-red-50 to-red-100/50', border: 'border-red-200', text: 'text-red-600', value: 'text-red-900' };
    if (ltv > 70) return { bg: 'from-amber-50 to-amber-100/50', border: 'border-amber-200', text: 'text-amber-600', value: 'text-amber-900' };
    return { bg: 'from-emerald-50 to-emerald-100/50', border: 'border-emerald-200', text: 'text-emerald-600', value: 'text-emerald-900' };
  };

  const initialLtvColors = getLtvColor(metrics.initialLtv);
  const ltvColors = getLtvColor(metrics.ltv);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-blue-600 font-medium">Total Security</span>
            </div>
            <p className="text-2xl font-bold text-blue-900">
              {formatCurrency(metrics.totalSecurityValue)}
            </p>
          </CardContent>
        </Card>

        <Card className={`bg-gradient-to-br ${initialLtvColors.bg} ${initialLtvColors.border}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={`w-4 h-4 ${initialLtvColors.text}`} />
              <span className={`text-sm font-medium ${initialLtvColors.text}`}>Initial LTV</span>
            </div>
            <p className={`text-2xl font-bold ${initialLtvColors.value}`}>
              {metrics.propertyCount > 0 ? `${metrics.initialLtv.toFixed(1)}%` : 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card className={`bg-gradient-to-br ${ltvColors.bg} ${ltvColors.border}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={`w-4 h-4 ${ltvColors.text}`} />
              <span className={`text-sm font-medium ${ltvColors.text}`}>LTV</span>
            </div>
            <p className={`text-2xl font-bold ${ltvColors.value}`}>
              {metrics.propertyCount > 0 ? `${metrics.ltv.toFixed(1)}%` : 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-50 to-slate-100/50 border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4 text-slate-600" />
              <span className="text-sm text-slate-600 font-medium">Properties</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{metrics.propertyCount}</p>
            {metrics.staleValuations > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                {metrics.staleValuations} need revaluation
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-center">
            <Button onClick={() => {
              setSelectedLoanProperty(null);
              setIsPropertyModalOpen(true);
            }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Property
            </Button>
          </CardContent>
        </Card>

        {/* Request Valuation Letter - shows when valuations are stale */}
        {metrics.staleValuations > 0 && (
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200">
            <CardContent className="p-4 flex items-center justify-center">
              <Button
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-100"
                onClick={() => setIsLetterModalOpen(true)}
              >
                <Mail className="w-4 h-4 mr-2" />
                Request Valuation
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Property Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active">
            Active Securities
            <Badge variant="secondary" className="ml-2">{activeProperties.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="removed">
            <Trash2 className="w-4 h-4 mr-1" />
            Removed
            <Badge variant="secondary" className="ml-2">{removedProperties.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {/* Property List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isLoading ? (
              Array(2).fill(0).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-4 h-40 bg-slate-100" />
                </Card>
              ))
            ) : activeProperties.length === 0 ? (
              <Card className="col-span-2 border-dashed">
                <CardContent className="p-12 text-center">
                  <Building2 className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No Properties Linked</h3>
                  <p className="text-sm text-slate-500 mb-4">
                    Add properties as security for this loan
                  </p>
                  <Button onClick={() => {
                    setSelectedLoanProperty(null);
                    setIsPropertyModalOpen(true);
                  }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Property
                  </Button>
                </CardContent>
              </Card>
            ) : (
              activeProperties.map(lp => (
                <PropertyCard
                  key={lp.id}
                  loanProperty={lp}
                  lastValuationDate={lp.lastValuationDate}
                  lastFirstChargeBalanceDate={lp.lastFirstChargeBalanceDate}
                  onEdit={() => {
                    setSelectedLoanProperty(lp);
                    setIsPropertyModalOpen(true);
                  }}
                  onUpdateValuation={() => {
                    setSelectedLoanProperty(lp);
                    setShowAddFormOnOpen(true);
                    setIsValuationModalOpen(true);
                  }}
                  onViewHistory={() => {
                    setSelectedLoanProperty(lp);
                    setShowAddFormOnOpen(false);
                    setIsValuationModalOpen(true);
                  }}
                  onRemove={() => setPropertyToRemove(lp)}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="removed" className="mt-4">
          {removedProperties.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Trash2 className="w-8 h-8 mx-auto mb-3 text-slate-300" />
                <p className="text-sm text-slate-500">No removed properties</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {removedProperties.map(lp => (
                <Card key={lp.id} className="bg-slate-50 border-slate-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-700">{lp.property?.address}</span>
                          <Badge variant="outline" className="text-slate-500">{lp.charge_type}</Badge>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {lp.property?.city}, {lp.property?.postcode}
                        </p>
                        {lp.removed_date && (
                          <p className="text-xs text-slate-400 mt-2">
                            Removed: {format(new Date(lp.removed_date), 'dd MMM yyyy')}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-slate-500">Value at removal</p>
                        <p className="font-semibold">{formatCurrency(lp.property?.current_value || 0)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={!!propertyToRemove} onOpenChange={() => setPropertyToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Property from Loan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{propertyToRemove?.property?.address}</strong> as security
              for this loan. The property will be moved to the "Removed" tab for historical reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removePropertyMutation.mutate(propertyToRemove)}
              className="bg-red-600 hover:bg-red-700"
            >
              {removePropertyMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Remove Property
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modals */}
      {isPropertyModalOpen && (
        <PropertyModal
          isOpen={isPropertyModalOpen}
          onClose={() => {
            setIsPropertyModalOpen(false);
            setSelectedLoanProperty(null);
          }}
          loan={loan}
          existingLoanProperty={selectedLoanProperty}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['loan-properties', loan.id] });
          }}
        />
      )}

      {isValuationModalOpen && (
        <ValuationHistoryModal
          isOpen={isValuationModalOpen}
          onClose={() => {
            setIsValuationModalOpen(false);
            setSelectedLoanProperty(null);
            setShowAddFormOnOpen(false);
          }}
          loanProperty={selectedLoanProperty}
          initialShowAddForm={showAddFormOnOpen}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['loan-properties', loan.id] });
          }}
        />
      )}

      {isLetterModalOpen && (
        <ValuationRequestLetterModal
          isOpen={isLetterModalOpen}
          onClose={() => setIsLetterModalOpen(false)}
          loan={loan}
          loanProperties={activeProperties}
          borrower={borrower}
          organization={currentOrganization}
          ltvMetrics={metrics}
        />
      )}
    </div>
  );
}
