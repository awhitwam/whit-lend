import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Users,
  User,
  Mail,
  Phone,
  FileText,
  Building2
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';

export default function ContactGroupView({ borrowers, loanCounts = {}, loans = [] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Group borrowers by contact_email
  const groupedBorrowers = useMemo(() => {
    const groups = {};

    borrowers.forEach(borrower => {
      // Use contact_email if available, otherwise use email, otherwise "No Contact Email"
      const groupKey = borrower.contact_email || borrower.email || '__no_contact__';

      if (!groups[groupKey]) {
        groups[groupKey] = {
          contactEmail: groupKey === '__no_contact__' ? null : groupKey,
          contactNames: {}, // Track frequency of contact names
          borrowers: [],
          totalLoans: 0,
          liveLoans: 0,
          totalOutstanding: 0
        };
      }

      groups[groupKey].borrowers.push(borrower);

      // Track contact name frequency
      const contactName = borrower.contact_name?.trim();
      if (contactName) {
        groups[groupKey].contactNames[contactName] = (groups[groupKey].contactNames[contactName] || 0) + 1;
      }

      // Aggregate loan counts
      const counts = loanCounts[borrower.id] || { total: 0, live: 0 };
      groups[groupKey].totalLoans += counts.total;
      groups[groupKey].liveLoans += counts.live;
    });

    // Determine the most common contact name for each group
    Object.values(groups).forEach(group => {
      const names = Object.entries(group.contactNames);
      if (names.length > 0) {
        // Sort by frequency (descending) and pick the most common
        names.sort((a, b) => b[1] - a[1]);
        group.contactName = names[0][0];
      } else {
        group.contactName = null;
      }
      delete group.contactNames; // Clean up temporary tracking object
    });

    // Calculate total outstanding per group from loans
    Object.values(groups).forEach(group => {
      group.borrowers.forEach(borrower => {
        const borrowerLoans = loans.filter(l =>
          l.borrower_id === borrower.id &&
          !l.is_deleted &&
          (l.status === 'Live' || l.status === 'Active')
        );
        borrowerLoans.forEach(loan => {
          const principalOutstanding = (loan.principal_amount || 0) - (loan.principal_paid || 0);
          const interestOutstanding = (loan.total_interest || 0) - (loan.interest_paid || 0);
          group.totalOutstanding += Math.max(0, principalOutstanding + interestOutstanding);
        });
      });
    });

    return groups;
  }, [borrowers, loanCounts, loans]);

  // Filter groups by search term
  const filteredGroups = useMemo(() => {
    const search = searchTerm.toLowerCase();
    if (!search) return groupedBorrowers;

    const filtered = {};
    Object.entries(groupedBorrowers).forEach(([key, group]) => {
      // Check if contact email or contact name matches
      const contactMatches = group.contactEmail?.toLowerCase().includes(search) ||
                            group.contactName?.toLowerCase().includes(search);

      // Check if any borrower in group matches
      const matchingBorrowers = group.borrowers.filter(b => {
        const displayName = (b.business || `${b.first_name} ${b.last_name}`).toLowerCase();
        const keywords = b.keywords || [];
        const keywordMatch = keywords.some(k => k.toLowerCase().includes(search));
        return displayName.includes(search) ||
               b.phone?.includes(search) ||
               b.unique_number?.includes(search) ||
               b.email?.toLowerCase().includes(search) ||
               b.contact_name?.toLowerCase().includes(search) ||
               keywordMatch;
      });

      if (contactMatches || matchingBorrowers.length > 0) {
        filtered[key] = {
          ...group,
          borrowers: contactMatches ? group.borrowers : matchingBorrowers
        };
      }
    });

    return filtered;
  }, [groupedBorrowers, searchTerm]);

  // Sort groups by most loans (live loans first, then total), then by outstanding
  // Exclude the "No Contact" group (borrowers without contact_email)
  const sortedGroups = useMemo(() => {
    return Object.entries(filteredGroups)
      .filter(([key]) => key !== '__no_contact__')
      .sort(([, a], [, b]) => {
        // First sort by live loans
        if (b.liveLoans !== a.liveLoans) {
          return b.liveLoans - a.liveLoans;
        }
        // Then by total loans
        if (b.totalLoans !== a.totalLoans) {
          return b.totalLoans - a.totalLoans;
        }
        // Then by total outstanding
        return b.totalOutstanding - a.totalOutstanding;
      });
  }, [filteredGroups]);

  const toggleGroup = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedGroups(new Set(Object.keys(filteredGroups)));
  };

  const collapseAll = () => {
    setExpandedGroups(new Set());
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative max-w-sm w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search contacts or borrowers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Collapse All
          </Button>
        </div>
      </div>

      <div className="text-sm text-slate-500">
        {sortedGroups.length} contact group{sortedGroups.length !== 1 ? 's' : ''} •{' '}
        {Object.values(filteredGroups).reduce((sum, g) => sum + g.borrowers.length, 0)} borrowers
      </div>

      <div className="space-y-3">
        {sortedGroups.map(([key, group]) => {
          const isExpanded = expandedGroups.has(key);
          const hasMultipleBorrowers = group.borrowers.length > 1;
          // Build display: "Name - email" or just "email" or "No Contact"
          const displayTitle = group.contactName
            ? `${group.contactName} - ${group.contactEmail || 'No Email'}`
            : group.contactEmail || 'No Contact';

          return (
            <Card key={key} className="overflow-hidden">
              <Collapsible open={isExpanded} onOpenChange={() => toggleGroup(key)}>
                <CardHeader className="py-4">
                  <div className="flex items-center justify-between">
                    <Link
                      to={createPageUrl(`Loans?contact_email=${encodeURIComponent(group.contactEmail || '')}`)}
                      className="flex items-center gap-3 flex-1 hover:bg-slate-50 -m-2 p-2 rounded-lg transition-colors"
                    >
                      <div className={`p-2 rounded-lg ${hasMultipleBorrowers ? 'bg-blue-100' : 'bg-slate-100'}`}>
                        {hasMultipleBorrowers ? (
                          <Users className={`w-5 h-5 ${hasMultipleBorrowers ? 'text-blue-600' : 'text-slate-500'}`} />
                        ) : (
                          <User className="w-5 h-5 text-slate-500" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold">
                            {displayTitle}
                          </CardTitle>
                          {hasMultipleBorrowers && (
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                              {group.borrowers.length} borrowers
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />
                            {group.liveLoans} live loan{group.liveLoans !== 1 ? 's' : ''}
                          </span>
                          {group.totalOutstanding > 0 && (
                            <span className="font-medium text-slate-700">
                              {formatCurrency(group.totalOutstanding)} outstanding
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="ml-2">
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </CardHeader>

                <CollapsibleContent>
                  <CardContent className="pt-0 pb-4">
                    <div className="border-t pt-4 space-y-3">
                      {group.borrowers.map(borrower => {
                        const displayName = borrower.business || `${borrower.first_name} ${borrower.last_name}`;
                        const counts = loanCounts[borrower.id] || { total: 0, live: 0, settled: 0 };

                        return (
                          <div
                            key={borrower.id}
                            className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                          >
                            <Link
                              to={createPageUrl(`BorrowerDetails?id=${borrower.id}`)}
                              className="flex items-center gap-3 flex-1 group"
                            >
                              <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                                {borrower.business ? (
                                  <Building2 className="w-5 h-5 text-slate-400" />
                                ) : (
                                  <User className="w-5 h-5 text-slate-400" />
                                )}
                              </div>
                              <div>
                                <p className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors">
                                  {displayName}
                                </p>
                                <div className="flex items-center gap-3 text-xs text-slate-500">
                                  <span className="font-mono">#{borrower.unique_number}</span>
                                  {borrower.phone && (
                                    <span className="flex items-center gap-1">
                                      <Phone className="w-3 h-3" />
                                      {borrower.phone}
                                    </span>
                                  )}
                                  {borrower.email && borrower.email !== group.contactEmail && (
                                    <span className="flex items-center gap-1">
                                      <Mail className="w-3 h-3" />
                                      {borrower.email}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </Link>
                            <div className="flex items-center gap-3">
                              {counts.total > 0 ? (
                                <Link to={createPageUrl(`Loans?borrower=${borrower.id}`)}>
                                  <div className="flex gap-1.5">
                                    {counts.live > 0 && (
                                      <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                                        {counts.live} Live
                                      </Badge>
                                    )}
                                    {counts.settled > 0 && (
                                      <Badge className="bg-purple-100 text-purple-700 text-xs">
                                        {counts.settled} Settled
                                      </Badge>
                                    )}
                                  </div>
                                </Link>
                              ) : (
                                <span className="text-xs text-slate-400">No loans</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}

        {sortedGroups.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            {searchTerm ? 'No contacts match your search' : 'No borrowers found'}
          </div>
        )}
      </div>
    </div>
  );
}
