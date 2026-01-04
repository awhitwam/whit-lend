import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/dataClient';

/**
 * Hook for managing borrower loan preferences
 * Remembers default loan selections per borrower for future receipts
 */
export function useBorrowerPreferences(borrowerId) {
  const queryClient = useQueryClient();

  // Load preferences for a specific borrower
  const {
    data: preferences,
    isLoading
  } = useQuery({
    queryKey: ['borrower-preferences', borrowerId],
    queryFn: async () => {
      if (!borrowerId) return null;
      const results = await api.entities.BorrowerLoanPreference.filter({ borrower_id: borrowerId });
      return results[0] || null;
    },
    enabled: !!borrowerId
  });

  // Save or update preferences
  const savePreferencesMutation = useMutation({
    mutationFn: async ({ borrowerId, loanIds, allocationPattern }) => {
      if (!borrowerId) return null;

      // Check if preferences exist
      const existing = await api.entities.BorrowerLoanPreference.filter({ borrower_id: borrowerId });

      const data = {
        borrower_id: borrowerId,
        default_loan_ids: loanIds || [],
        last_allocation_pattern: allocationPattern || null,
        updated_at: new Date().toISOString()
      };

      if (existing.length > 0) {
        return api.entities.BorrowerLoanPreference.update(existing[0].id, data);
      } else {
        return api.entities.BorrowerLoanPreference.create(data);
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['borrower-preferences', variables.borrowerId] });
    }
  });

  // Get default loan IDs for a borrower
  const getDefaultLoanIds = useCallback(() => {
    return preferences?.default_loan_ids || [];
  }, [preferences]);

  // Get last allocation pattern
  const getLastAllocationPattern = useCallback(() => {
    return preferences?.last_allocation_pattern || {};
  }, [preferences]);

  // Save current selections as new defaults
  const saveDefaults = useCallback((loanIds, allocations) => {
    if (!borrowerId) return;

    // Convert allocations to percentage-based pattern
    const allocationPattern = {};
    const totalAmount = Object.values(allocations).reduce((sum, a) => {
      return sum + (parseFloat(a.principal) || 0) + (parseFloat(a.interest) || 0) + (parseFloat(a.fees) || 0);
    }, 0);

    if (totalAmount > 0) {
      for (const [loanId, alloc] of Object.entries(allocations)) {
        const loanTotal = (parseFloat(alloc.principal) || 0) + (parseFloat(alloc.interest) || 0) + (parseFloat(alloc.fees) || 0);
        if (loanTotal > 0) {
          allocationPattern[loanId] = {
            principal_pct: (parseFloat(alloc.principal) || 0) / loanTotal,
            interest_pct: (parseFloat(alloc.interest) || 0) / loanTotal,
            fees_pct: (parseFloat(alloc.fees) || 0) / loanTotal,
            amount_pct: loanTotal / totalAmount
          };
        }
      }
    }

    savePreferencesMutation.mutate({
      borrowerId,
      loanIds,
      allocationPattern
    });
  }, [borrowerId, savePreferencesMutation]);

  // Apply last allocation pattern to a new amount
  const applyPattern = useCallback((totalAmount, loanIds) => {
    const pattern = preferences?.last_allocation_pattern || {};
    const allocations = {};

    if (!pattern || Object.keys(pattern).length === 0) {
      // No pattern - distribute evenly as principal
      const perLoan = loanIds.length > 0 ? totalAmount / loanIds.length : 0;
      for (const loanId of loanIds) {
        allocations[loanId] = {
          principal: perLoan,
          interest: 0,
          fees: 0
        };
      }
    } else {
      // Apply saved pattern
      for (const loanId of loanIds) {
        const loanPattern = pattern[loanId];
        if (loanPattern) {
          const loanAmount = totalAmount * (loanPattern.amount_pct || 0);
          allocations[loanId] = {
            principal: loanAmount * (loanPattern.principal_pct || 1),
            interest: loanAmount * (loanPattern.interest_pct || 0),
            fees: loanAmount * (loanPattern.fees_pct || 0)
          };
        } else {
          // Loan not in pattern - give it equal share as principal
          const unknownLoans = loanIds.filter(id => !pattern[id]);
          const patternedTotal = Object.values(pattern)
            .filter((_, i) => loanIds.includes(Object.keys(pattern)[i]))
            .reduce((sum, p) => sum + (p.amount_pct || 0), 0);
          const remainingAmount = totalAmount * (1 - patternedTotal);
          const perUnknown = unknownLoans.length > 0 ? remainingAmount / unknownLoans.length : 0;

          allocations[loanId] = {
            principal: perUnknown,
            interest: 0,
            fees: 0
          };
        }
      }
    }

    return allocations;
  }, [preferences]);

  return {
    preferences,
    isLoading,
    getDefaultLoanIds,
    getLastAllocationPattern,
    saveDefaults,
    applyPattern,
    isSaving: savePreferencesMutation.isPending
  };
}

export default useBorrowerPreferences;
