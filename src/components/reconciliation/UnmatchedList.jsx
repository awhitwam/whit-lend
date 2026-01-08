/**
 * UnmatchedList - Display unmatched entries and dismissed suggestions
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  FileQuestion,
  Trash2,
  Link2,
  Plus,
  ChevronRight,
  CheckSquare,
  Square,
  Undo2
} from 'lucide-react';
import EntryCard from './EntryCard';

export default function UnmatchedList({
  unmatchedEntries,
  dismissedEntries,
  suggestions,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onCreateNew,
  onManualMatch,
  onDelete,
  onRestore,
  isProcessing
}) {
  const [activeTab, setActiveTab] = useState('unmatched');
  const [sortBy, setSortBy] = useState('date');
  const [filterType, setFilterType] = useState('all');

  // Filter and sort entries
  const filteredUnmatched = useMemo(() => {
    let filtered = [...unmatchedEntries];

    // Apply type filter
    if (filterType === 'credits') {
      filtered = filtered.filter(e => e.amount > 0);
    } else if (filterType === 'debits') {
      filtered = filtered.filter(e => e.amount < 0);
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(a.statement_date) - new Date(b.statement_date);
      } else if (sortBy === 'amount') {
        return Math.abs(b.amount) - Math.abs(a.amount);
      }
      return 0;
    });

    return filtered;
  }, [unmatchedEntries, filterType, sortBy]);

  // Calculate selection total
  const selectionTotal = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    return unmatchedEntries
      .filter(e => selectedIds.has(e.id))
      .reduce((sum, e) => sum + e.amount, 0);
  }, [unmatchedEntries, selectedIds]);

  // Check if all selected are same type (credits or debits)
  const selectionType = useMemo(() => {
    if (selectedIds.size === 0) return null;
    const selected = unmatchedEntries.filter(e => selectedIds.has(e.id));
    const allCredits = selected.every(e => e.amount > 0);
    const allDebits = selected.every(e => e.amount < 0);
    if (allCredits) return 'credits';
    if (allDebits) return 'debits';
    return 'mixed';
  }, [unmatchedEntries, selectedIds]);

  const totalUnmatched = unmatchedEntries.length;
  const totalDismissed = dismissedEntries.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <FileQuestion className="w-5 h-5 text-slate-500" />
          Manual Processing
        </CardTitle>
        <CardDescription>
          Entries requiring manual action
        </CardDescription>
      </CardHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="px-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="unmatched" className="text-xs">
              Unmatched
              <Badge variant="secondary" className="ml-2">{totalUnmatched}</Badge>
            </TabsTrigger>
            <TabsTrigger value="dismissed" className="text-xs">
              Dismissed
              <Badge variant="secondary" className="ml-2">{totalDismissed}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Unmatched tab */}
        <TabsContent value="unmatched">
          <CardContent className="pt-3">
            {totalUnmatched === 0 ? (
              <div className="py-8 text-center text-slate-500">
                <FileQuestion className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p>No unmatched entries</p>
                <p className="text-sm">All entries have suggestions or are reconciled</p>
              </div>
            ) : (
              <>
                {/* Filters and actions bar */}
                <div className="flex items-center justify-between mb-4 pb-3 border-b">
                  <div className="flex items-center gap-3">
                    <Select value={filterType} onValueChange={setFilterType}>
                      <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="credits">Credits Only</SelectItem>
                        <SelectItem value="debits">Debits Only</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="date">By Date</SelectItem>
                        <SelectItem value="amount">By Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7"
                      onClick={selectedIds.size === totalUnmatched ? onClearSelection : onSelectAll}
                    >
                      {selectedIds.size === totalUnmatched ? (
                        <>
                          <CheckSquare className="w-3 h-3 mr-1" />
                          Deselect All
                        </>
                      ) : (
                        <>
                          <Square className="w-3 h-3 mr-1" />
                          Select All
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Selection action bar */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center justify-between p-3 mb-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="text-sm">
                      <span className="font-medium">{selectedIds.size} selected</span>
                      <span className="text-slate-500 ml-2">
                        Total: <span className={selectionTotal >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                          £{Math.abs(selectionTotal).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                        </span>
                        {selectionType && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            {selectionType === 'credits' ? 'All Credits' :
                             selectionType === 'debits' ? 'All Debits' : 'Mixed'}
                          </Badge>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={onManualMatch}
                        disabled={isProcessing || selectedIds.size === 0}
                      >
                        <Link2 className="w-3 h-3 mr-1" />
                        Manual Match
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => onDelete?.(Array.from(selectedIds))}
                        disabled={isProcessing}
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                )}

                {/* Entry list */}
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-2">
                    {filteredUnmatched.map(entry => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        suggestion={suggestions.get(entry.id)}
                        showCheckbox
                        isSelected={selectedIds.has(entry.id)}
                        onToggleSelect={onToggleSelect}
                        onCreateNew={onCreateNew}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </CardContent>
        </TabsContent>

        {/* Dismissed tab */}
        <TabsContent value="dismissed">
          <CardContent className="pt-3">
            {totalDismissed === 0 ? (
              <div className="py-8 text-center text-slate-500">
                <Undo2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p>No dismissed suggestions</p>
                <p className="text-sm">Dismissed suggestions will appear here</p>
              </div>
            ) : (
              <ScrollArea className="h-[450px] pr-4">
                <div className="space-y-2">
                  {dismissedEntries.map(entry => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      suggestion={suggestions.get(entry.id)}
                      isDismissed
                      onRestore={onRestore}
                      onCreateNew={onCreateNew}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
