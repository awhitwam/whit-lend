/**
 * SuggestionsList - Display entries with auto-match suggestions
 *
 * Groups entries that belong to multi-entry matches (grouped_investor, grouped_disbursement)
 * to display them as a single expandable card instead of separate entries.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sparkles, CheckCheck, Filter } from 'lucide-react';
import EntryCard from './EntryCard';
import GroupedEntryCard from './GroupedEntryCard';

export default function SuggestionsList({
  entries,
  suggestions,
  onAccept,
  onDismiss,
  onViewDetails,
  onAcceptAllHighConfidence,
  isProcessing
}) {
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('confidence');

  // Group entries that belong to multi-entry matches, separate single entries
  const { groupedItems, singleEntries } = useMemo(() => {
    const groupedItems = []; // Array of { entries: [], suggestion, groupKey }
    const singleEntries = [];
    const processedEntryIds = new Set();
    const seenGroups = new Map(); // groupKey -> index in groupedItems

    for (const entry of entries) {
      if (processedEntryIds.has(entry.id)) continue;

      const suggestion = suggestions.get(entry.id);
      if (!suggestion) continue;

      // Check if this is a grouped match (multiple bank entries → single transaction)
      const isGroupedMatch = suggestion.matchMode === 'grouped_investor' ||
                             suggestion.matchMode === 'grouped_disbursement';

      if (isGroupedMatch && suggestion.groupedEntries?.length > 1) {
        // Create a unique key for this group based on the transaction it matches to
        const txId = suggestion.existingTransaction?.id || 'unknown';
        const groupKey = `${suggestion.type}-${txId}`;

        if (!seenGroups.has(groupKey)) {
          // Find all entries that belong to this group
          const groupEntries = suggestion.groupedEntries
            .map(ge => entries.find(e => e.id === ge.id))
            .filter(Boolean);

          groupedItems.push({
            entries: groupEntries,
            suggestion,
            groupKey,
            // For sorting, use the first entry's data
            sortDate: groupEntries[0]?.statement_date,
            sortAmount: groupEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0)
          });

          seenGroups.set(groupKey, groupedItems.length - 1);

          // Mark all entries in this group as processed
          for (const ge of suggestion.groupedEntries) {
            processedEntryIds.add(ge.id);
          }
        }
      } else {
        // Single entry match
        singleEntries.push(entry);
        processedEntryIds.add(entry.id);
      }
    }

    return { groupedItems, singleEntries };
  }, [entries, suggestions]);

  // Filter and sort all items (both grouped and single)
  const filteredItems = useMemo(() => {
    // Combine grouped items and single entries into a unified list
    const allItems = [];

    // Add grouped items
    for (const group of groupedItems) {
      const confidence = group.suggestion?.confidence || 0;
      if (confidenceFilter !== 'all' && confidence < parseFloat(confidenceFilter)) continue;

      allItems.push({
        type: 'grouped',
        entries: group.entries,
        suggestion: group.suggestion,
        groupKey: group.groupKey,
        confidence,
        sortDate: group.sortDate,
        sortAmount: group.sortAmount
      });
    }

    // Add single entries
    for (const entry of singleEntries) {
      const suggestion = suggestions.get(entry.id);
      const confidence = suggestion?.confidence || 0;
      if (confidenceFilter !== 'all' && confidence < parseFloat(confidenceFilter)) continue;

      allItems.push({
        type: 'single',
        entry,
        suggestion,
        confidence,
        sortDate: entry.statement_date,
        sortAmount: Math.abs(entry.amount)
      });
    }

    // Sort
    allItems.sort((a, b) => {
      if (sortBy === 'confidence') {
        return b.confidence - a.confidence;
      } else if (sortBy === 'date') {
        return new Date(a.sortDate) - new Date(b.sortDate);
      } else if (sortBy === 'amount') {
        return b.sortAmount - a.sortAmount;
      }
      return 0;
    });

    return allItems;
  }, [groupedItems, singleEntries, suggestions, confidenceFilter, sortBy]);

  // Count high confidence entries (count each grouped item as 1)
  const highConfidenceCount = useMemo(() => {
    let count = 0;
    for (const group of groupedItems) {
      if ((group.suggestion?.confidence || 0) >= 0.9) count++;
    }
    for (const entry of singleEntries) {
      const suggestion = suggestions.get(entry.id);
      if ((suggestion?.confidence || 0) >= 0.9) count++;
    }
    return count;
  }, [groupedItems, singleEntries, suggestions]);

  // Group by confidence level for stats (count items, not individual entries)
  const confidenceStats = useMemo(() => {
    const stats = { high: 0, medium: 0, low: 0 };

    for (const group of groupedItems) {
      const conf = group.suggestion?.confidence || 0;
      if (conf >= 0.9) stats.high++;
      else if (conf >= 0.7) stats.medium++;
      else stats.low++;
    }

    for (const entry of singleEntries) {
      const suggestion = suggestions.get(entry.id);
      const conf = suggestion?.confidence || 0;
      if (conf >= 0.9) stats.high++;
      else if (conf >= 0.7) stats.medium++;
      else stats.low++;
    }

    return stats;
  }, [groupedItems, singleEntries, suggestions]);

  // Total items count
  const totalItems = groupedItems.length + singleEntries.length;

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-500">
          <Sparkles className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p>No suggestions available</p>
          <p className="text-sm">Import bank statements to see auto-matched suggestions</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Auto-Match Suggestions
            </CardTitle>
            <CardDescription>
              {totalItems} suggestions ({entries.length} bank entries)
            </CardDescription>
          </div>

          {/* Confidence stats */}
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              {confidenceStats.high} High
            </Badge>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              {confidenceStats.medium} Medium
            </Badge>
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              {confidenceStats.low} Low
            </Badge>
          </div>
        </div>

        {/* Filters and bulk actions */}
        <div className="flex items-center justify-between pt-3 border-t mt-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Confidence</SelectItem>
                  <SelectItem value="0.9">90%+ (High)</SelectItem>
                  <SelectItem value="0.7">70%+ (Medium)</SelectItem>
                  <SelectItem value="0.5">50%+ (Low)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="confidence">By Confidence</SelectItem>
                <SelectItem value="date">By Date</SelectItem>
                <SelectItem value="amount">By Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {highConfidenceCount > 0 && (
            <Button
              size="sm"
              className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700"
              onClick={onAcceptAllHighConfidence}
              disabled={isProcessing}
            >
              <CheckCheck className="w-4 h-4 mr-1" />
              Accept All High ({highConfidenceCount})
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-2">
            {filteredItems.map(item => (
              item.type === 'grouped' ? (
                <GroupedEntryCard
                  key={item.groupKey}
                  entries={item.entries}
                  suggestion={item.suggestion}
                  onAccept={onAccept}
                  onDismiss={onDismiss}
                  onViewDetails={onViewDetails}
                />
              ) : (
                <EntryCard
                  key={item.entry.id}
                  entry={item.entry}
                  suggestion={item.suggestion}
                  onAccept={onAccept}
                  onDismiss={onDismiss}
                  onViewDetails={onViewDetails}
                />
              )
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
