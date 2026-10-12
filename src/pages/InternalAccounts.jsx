/**
 * InternalAccounts - the organisation's own accounts (savings pots, reserves) and the
 * money sitting in each.
 *
 * These are not investors and not expenses. Money moved into a pot has not left the
 * business, so none of these figures appear in the accountant or income & expenditure
 * reports - the balances here are simply where some of the cash currently is.
 */

import { useState, useMemo } from 'react';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, PiggyBank, Edit, Trash2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import EmptyState from '@/components/ui/EmptyState';
import { internalAccountBalances, internalAccountTotals } from '@/lib/internalAccounts';

const EMPTY_FORM = { name: '', description: '', match_keyword: '' };

export default function InternalAccounts() {
  const { currentOrganization } = useOrganization();
  const queryClient = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [selectedAccountId, setSelectedAccountId] = useState(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['internal-accounts', currentOrganization?.id],
    queryFn: () => api.entities.InternalAccount.list('name'),
    enabled: !!currentOrganization
  });

  const { data: transfers = [] } = useQuery({
    queryKey: ['internal-transfers', currentOrganization?.id],
    queryFn: () => api.entities.InternalTransfer.list('-date'),
    enabled: !!currentOrganization
  });

  const balances = useMemo(() => internalAccountBalances(transfers), [transfers]);
  const totalHeld = useMemo(
    () => [...balances.values()].reduce((sum, v) => sum + v, 0),
    [balances]
  );

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || null;
  const selectedTransfers = useMemo(
    () => transfers.filter(t => t.internal_account_id === selectedAccountId),
    [transfers, selectedAccountId]
  );
  const selectedTotals = useMemo(
    () => internalAccountTotals(transfers, selectedAccountId),
    [transfers, selectedAccountId]
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['internal-accounts'] });
    queryClient.invalidateQueries({ queryKey: ['internal-transfers'] });
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingAccount(null);
    setFormData(EMPTY_FORM);
  };

  const saveMutation = useMutation({
    mutationFn: ({ id, data }) =>
      id ? api.entities.InternalAccount.update(id, data) : api.entities.InternalAccount.create(data),
    onSuccess: () => {
      invalidate();
      closeDialog();
      toast.success(editingAccount ? 'Account updated' : 'Account created');
    },
    onError: (e) => toast.error(`Failed to save: ${e.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.InternalAccount.delete(id),
    onSuccess: () => {
      invalidate();
      setSelectedAccountId(null);
      toast.success('Account deleted');
    },
    // The FK is ON DELETE RESTRICT, so the database refuses while transfers reference it.
    onError: () =>
      toast.error('Cannot delete an account that still has transfers against it. Unreconcile them first.')
  });

  const openNew = () => {
    setEditingAccount(null);
    setFormData(EMPTY_FORM);
    setIsDialogOpen(true);
  };

  const openEdit = (account) => {
    setEditingAccount(account);
    setFormData({
      name: account.name || '',
      description: account.description || '',
      match_keyword: account.match_keyword || ''
    });
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }
    saveMutation.mutate({
      id: editingAccount?.id,
      data: {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        match_keyword: formData.match_keyword.trim() || null
      }
    });
  };

  const handleDelete = (account) => {
    const held = balances.get(account.id) ?? 0;
    const warning = Math.abs(held) > 0.01
      ? `\n\nIt currently holds ${formatCurrency(held)}.`
      : '';
    if (window.confirm(`Delete "${account.name}"?${warning}`)) {
      deleteMutation.mutate(account.id);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <PiggyBank className="w-6 h-6 text-indigo-500" />
            Internal Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Your own savings pots and reserve accounts. Money moved here has not left the
            business, so it is excluded from income, expenditure and investor figures &mdash;
            these balances just show where the cash is sitting.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {accounts.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-slate-500">Total held</p>
              <p className="text-xl font-bold text-slate-900">{formatCurrency(totalHeld)}</p>
            </div>
          )}
          <Button onClick={openNew}>
            <Plus className="w-4 h-4 mr-1" />
            New Account
          </Button>
        </div>
      </div>

      {/* Accounts */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={PiggyBank}
              title="No internal accounts yet"
              description="Add a savings pot or reserve account, then file transfers against it from Bank Reconciliation."
              action={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />New Account</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Bank description contains</TableHead>
                  <TableHead className="text-right">Movements</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map(account => {
                  const balance = balances.get(account.id) ?? 0;
                  const totals = internalAccountTotals(transfers, account.id);
                  const isSelected = account.id === selectedAccountId;
                  return (
                    <TableRow
                      key={account.id}
                      className={`cursor-pointer ${isSelected ? 'bg-indigo-50' : ''}`}
                      onClick={() => setSelectedAccountId(isSelected ? null : account.id)}
                    >
                      <TableCell>
                        <div className="font-medium text-slate-900">{account.name}</div>
                        {account.description && (
                          <div className="text-xs text-slate-500">{account.description}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {account.match_keyword ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            {account.match_keyword}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-500">
                        {totals.count}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${
                        balance < -0.01 ? 'text-red-600' : 'text-slate-900'
                      }`}>
                        {formatCurrency(balance)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-8 w-8"
                                  onClick={() => openEdit(account)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600"
                                  onClick={() => handleDelete(account)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Movements for the selected account */}
      {selectedAccount && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h2 className="font-semibold text-slate-900">{selectedAccount.name}</h2>
                <p className="text-xs text-slate-500">
                  {formatCurrency(selectedTotals.in)} in &middot;{' '}
                  {formatCurrency(selectedTotals.out)} out &middot;{' '}
                  <span className="font-medium text-slate-700">
                    {formatCurrency(selectedTotals.balance)} held
                  </span>
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedAccountId(null)}>
                Close
              </Button>
            </div>
            {selectedTransfers.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                No movements yet. File a bank entry against this account from Bank Reconciliation.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-32">Direction</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-32">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTransfers.map(t => {
                    const isIn = t.direction !== 'out';
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm text-slate-600">
                          {t.date ? format(new Date(t.date), 'dd MMM yyyy') : '—'}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                            isIn ? 'text-indigo-600' : 'text-emerald-600'
                          }`}>
                            {isIn
                              ? <><ArrowDownLeft className="w-3.5 h-3.5" /> Into pot</>
                              : <><ArrowUpRight className="w-3.5 h-3.5" /> Back out</>}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 truncate max-w-md">
                          {t.description || '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${
                          isIn ? 'text-slate-900' : 'text-emerald-600'
                        }`}>
                          {isIn ? '+' : '−'}{formatCurrency(Math.abs(parseFloat(t.amount) || 0))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / edit */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader className="space-y-1">
            <DialogTitle>{editingAccount ? 'Edit Account' : 'New Internal Account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ia-name">Name</Label>
              <Input
                id="ia-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Savings Pot"
              />
            </div>
            <div>
              <Label htmlFor="ia-keyword">Bank description contains</Label>
              <Input
                id="ia-keyword"
                value={formData.match_keyword}
                onChange={(e) => setFormData({ ...formData, match_keyword: e.target.value })}
                placeholder="e.g. SAVINGS POT"
              />
              <p className="text-xs text-slate-500 mt-1">
                Optional. If the bank puts a consistent label on these lines, enter it here and
                the account will be pre-selected when you reconcile one.
              </p>
            </div>
            <div>
              <Label htmlFor="ia-description">Description</Label>
              <Input
                id="ia-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional note"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {editingAccount ? 'Save Changes' : 'Create Account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
