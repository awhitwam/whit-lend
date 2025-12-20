import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, MoreHorizontal, Eye, Edit, Phone, Mail, User } from 'lucide-react';

export default function BorrowerTable({ borrowers, onEdit, isLoading }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredBorrowers = borrowers.filter(b => {
    const displayName = (b.business || `${b.first_name} ${b.last_name}`).toLowerCase();
    const search = searchTerm.toLowerCase();
    return displayName.includes(search) || 
           b.phone?.includes(search) || 
           b.unique_number?.includes(search) ||
           b.email?.toLowerCase().includes(search);
  });

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
              <TableHead className="font-semibold">ID</TableHead>
              <TableHead className="font-semibold">Name / Business</TableHead>
              <TableHead className="font-semibold">Contact</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5} className="h-16">
                    <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4"></div>
                  </TableCell>
                </TableRow>
              ))
            ) : filteredBorrowers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                  {searchTerm ? 'No borrowers match your search' : 'No borrowers found'}
                </TableCell>
              </TableRow>
            ) : (
              filteredBorrowers.map((borrower) => {
                const displayName = borrower.business || `${borrower.first_name} ${borrower.last_name}`;
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