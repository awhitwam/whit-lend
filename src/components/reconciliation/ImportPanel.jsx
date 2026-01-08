/**
 * ImportPanel - CSV import section for bank statements
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { getBankSources } from '@/lib/bankStatementParsers';

export default function ImportPanel({ onImport, isProcessing }) {
  const [selectedBank, setSelectedBank] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);

  const bankSources = getBankSources();

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const processFile = useCallback(async (file) => {
    if (!file) return;

    setError(null);
    setImportResult(null);

    // Check file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }

    try {
      const text = await file.text();

      const result = await onImport(text, selectedBank || null);

      setImportResult(result);
    } catch (err) {
      setError(err.message || 'Error importing file');
    }
  }, [onImport, selectedBank]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [processFile]);

  const handleFileSelect = useCallback((e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  }, [processFile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Import Bank Statement
        </CardTitle>
        <CardDescription>
          Upload a CSV file from your bank to import transactions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bank selection */}
        <div className="flex items-center gap-4">
          <Select value={selectedBank} onValueChange={setSelectedBank}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Auto-detect bank" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Auto-detect</SelectItem>
              {bankSources.map(bank => (
                <SelectItem key={bank.value} value={bank.value}>
                  {bank.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-slate-500">
            Select bank format or let the system auto-detect
          </span>
        </div>

        {/* Drop zone */}
        <div
          className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? 'border-blue-400 bg-blue-50'
              : 'border-slate-200 hover:border-slate-300'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {isProcessing ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <p className="text-sm text-slate-600">Importing transactions...</p>
            </div>
          ) : (
            <>
              <FileText className="w-10 h-10 mx-auto text-slate-400 mb-3" />
              <p className="text-sm text-slate-600 mb-2">
                Drag and drop a CSV file here, or click to browse
              </p>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Button variant="outline" className="pointer-events-none">
                Browse Files
              </Button>
            </>
          )}
        </div>

        {/* Success message */}
        {importResult && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <AlertDescription className="text-emerald-800">
              Successfully imported {importResult.imported} transactions.
              {importResult.skipped > 0 && (
                <span className="text-slate-600"> ({importResult.skipped} duplicates skipped)</span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Error message */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Supported formats */}
        <div className="text-xs text-slate-500">
          <p className="font-medium mb-1">Supported banks:</p>
          <ul className="list-disc list-inside">
            {bankSources.map(bank => (
              <li key={bank.value}>{bank.label}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
