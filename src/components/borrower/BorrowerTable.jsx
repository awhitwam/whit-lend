import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, MoreHorizontal, Eye, Edit, Phone, Mail, User, FileText, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export default function BorrowerTable({ borrowers, onEdit, isLoading, loanCounts = {} }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState(() => localStorage.getItem('borrowers-sort-field') || 'name');
  const [sortDirection, setSortDirection] = useState(() => localStorage.getItem('borrowers-sort-direction') || 'asc');

  const filteredBorrowers = borrowers.filter(b => {
    const displayName = (b.business || `${b.first_name} ${b.last_name}`).toLowerCase();
    const search = searchTerm.toLowerCase();
    const keywords = b.keywords || [];
    const keywordMatch = keywords.some(k => k.toLowerCase().includes(search));
    return displayName.includes(search) ||
           b.phone?.includes(search) ||
           b.unique_number?.includes(search) ||
           b.email?.toLowerCase().includes(search) ||
           keywordMatch;
  });

  const sortedBorrowers = useMemo(() => {
    return [...filteredBorrowers].sort((a, b) => {
      let aVal, bVal;

      switch (sortField) {
        case 'id':
          aVal = parseInt(a.unique_number) || 0;
          bVal = parseInt(b.unique_number) || 0;
          break;
        case 'name':
          aVal = (a.business || `${a.first_name || ''} ${a.last_name || ''}`).trim().toLowerCase();
          bVal = (b.business || `${b.first_name || ''} ${b.last_name || ''}`).trim().toLowerCase();
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredBorrowers, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      setSortDirection(newDirection);
      localStorage.setItem('borrowers-sort-direction', newDirection);
    } else {
      setSortField(field);
      setSortDirection('asc');
      localStorage.setItem('borrowers-sort-field', field);
      localStorage.setItem('borrowers-sort-direction', 'asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search borrowers..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/50">
              <TableHead className="font-semibold">
                <button
                  onClick={() => handleSort('id')}
                  className="flex items-center hover:text-slate-900"
                >
                  ID <SortIcon field="id" />
                </button>
              </TableHead>
              <TableHead className="font-semibold">
                <button
                  onClick={() => handleSort('name')}
                  className="flex items-center hover:text-slate-900"
                >
                  Name / Business <SortIcon field="name" />
                </button>
              </TableHead>
              <TableHead className="font-semibold">Contact</TableHead>
              <TableHead className="font-semibold">Loans</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6} className="h-16">
                    <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4"></div>
                  </TableCell>
                </TableRow>
              ))
            ) : sortedBorrowers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                  {searchTerm ? 'No borrowers match your search' : 'No borrowers found'}
                </TableCell>
              </TableRow>
            ) : (
              sortedBorrowers.map((borrower) => {
                const displayName = borrower.business || `${borrower.first_name} ${borrower.last_name}`;
                const counts = loanCounts[borrower.id] || { total: 0, live: 0, settled: 0, pending: 0, defaulted: 0 };
                return (
                <TableRow key={borrower.id} className="hover:bg-slate-50/50 transition-colors">
                  <TableCell className="font-mono font-semibold text-slate-700">
                    #{borrower.unique_number}
                  </TableCell>
                  <TableCell>
                    <Link
                      to={createPageUrl(`BorrowerDetails?id=${borrower.id}`)}
                      className="flex items-center gap-3 group"
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                        <User className="w-5 h-5 text-slate-500" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors">
                          {displayName}
                        </p>
                        {borrower.business && (
                          <p className="text-xs text-slate-500">{borrower.first_name} {borrower.last_name}</p>
                        )}
                        <p className="text-xs text-slate-500">Added {new Date(borrower.created_date).toLocaleDateString()}</p>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Phone className="w-3.5 h-3.5" />
                        {borrower.phone}
                      </div>
                      {borrower.email && (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Mail className="w-3.5 h-3.5" />
                          {borrower.email}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {counts.total === 0 ? (
                      <span className="text-sm text-slate-400">No loans</span>
                    ) : (
                      <Link
                        to={createPageUrl(`Loans?borrower=${borrower.id}`)}
                        className="group"
                      >
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {counts.live > 0 && (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-xs">
                              {counts.live} Live
                            </Badge>
                          )}
                          {counts.settled > 0 && (
                            <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-200 text-xs">
                              {counts.settled} Settled
                            </Badge>
                          )}
                          {counts.pending > 0 && (
                            <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs">
                              {counts.pending} Pending
                            </Badge>
                          )}
                          {counts.defaulted > 0 && (
                            <Badge className="bg-red-100 text-red-700 hover:bg-red-200 text-xs">
                              {counts.defaulted} Defaulted
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 group-hover:text-blue-600 mt-1">
                          View all {counts.total} loan{counts.total !== 1 ? 's' : ''}
                        </p>
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={borrower.status === 'Active' ? 'default' : 'destructive'}
                      className={borrower.status === 'Active'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                      }
                    >
                      {borrower.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={createPageUrl(`BorrowerDetails?id=${borrower.id}`)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </Link>
                        </DropdownMenuItem>
                        {counts.total > 0 && (
                          <DropdownMenuItem asChild>
                            <Link to={createPageUrl(`Loans?borrower=${borrower.id}`)}>
                              <FileText className="w-4 h-4 mr-2" />
                              View Loans ({counts.total})
                            </Link>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => onEdit(borrower)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );})
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}