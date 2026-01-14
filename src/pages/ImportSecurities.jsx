import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Building2,
  Home,
  Link2
} from 'lucide-react';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { logBulkImportEvent, AuditAction } from '@/lib/auditLog';
import { format } from 'date-fns';

export default function ImportSecurities() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [backupData, setBackupData] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, step: '' });
  const [importResult, setImportResult] = useState(null);

  // Fetch existing loans to match by loan_number
  const { data: existingLoans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.listAll()
  });

  // Fetch existing first charge holders
  const { data: existingHolders = [] } = useQuery({
    queryKey: ['first-charge-holders'],
    queryFn: () => api.entities.FirstChargeHolder.listAll()
  });

  // Build loan_number -> loan map
  const loanByNumber = useMemo(() => {
    const map = new Map();
    existingLoans.forEach(loan => {
      if (loan.loan_number) {
        map.set(loan.loan_number, loan);
      }
    });
    return map;
  }, [existingLoans]);

  // Build holder name -> holder map
  const holderByName = useMemo(() => {
    const map = new Map();
    existingHolders.forEach(holder => {
      map.set(holder.name.toLowerCase(), holder);
    });
    return map;
  }, [existingHolders]);

  // Process backup data to create preview
  const preview = useMemo(() => {
    if (!backupData) return null;

    const { loans: backupLoans = [], properties: backupProperties = [] } = backupData;

    // Build backup loan_id -> loan_number map
    const backupLoanById = new Map();
    backupLoans.forEach(loan => {
      backupLoanById.set(loan.id, loan);
    });

    // Process properties
    const processedProperties = backupProperties.map(prop => {
      const backupLoan = backupLoanById.get(prop.loan_id);
      const loanNumber = backupLoan?.loan_number;
      const matchedLoan = loanNumber ? loanByNumber.get(loanNumber) : null;

      return {
        ...prop,
        backup_loan: backupLoan,
        loan_number: loanNumber,
        matched_loan: matchedLoan,
        charge_type_display: prop.charge_type === 'first' ? 'First Charge' : 'Second Charge',
        can_import: !!matchedLoan
      };
    });

    // Get unique first charge holders needed
    const holdersNeeded = new Set();
    processedProperties
      .filter(p => p.charge_type === 'second' && p.first_charge_holder)
      .forEach(p => {
        const name = p.first_charge_holder.trim();
        if (name && name !== 'Other' && name !== 'Unsure') {
          holdersNeeded.add(name);
        }
      });

    const newHolders = Array.from(holdersNeeded).filter(
      name => !holderByName.has(name.toLowerCase())
    );

    return {
      properties: processedProperties,
      totalProperties: processedProperties.length,
      matchedCount: processedProperties.filter(p => p.can_import).length,
      unmatchedCount: processedProperties.filter(p => !p.can_import).length,
      newHolders,
      existingHolderMatches: Array.from(holdersNeeded).filter(
        name => holderByName.has(name.toLowerCase())
      )
    };
  }, [backupData, loanByNumber, holderByName]);

  // Handle file upload
  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setParseError(null);
    setImportResult(null);

    try {
      const text = await uploadedFile.text();
      const data = JSON.parse(text);

      // Validate structure
      if (!data.loans || !data.properties) {
        throw new Error('Invalid file format. Expected "loans" and "properties" arrays.');
      }

      setBackupData(data);
    } catch (err) {
      setParseError(err.message);
      setBackupData(null);
    }
  };

  // Execute import
  const executeImport = async () => {
    if (!preview || importing) return;

    setImporting(true);
    setImportResult(null);

    const results = {
      holdersCreated: 0,
      propertiesCreated: 0,
      linksCreated: 0,
      valuationsCreated: 0,
      errors: []
    };

    try {
      // Step 1: Create missing first charge holders
      setImportProgress({ current: 1, total: 4, step: 'Creating first charge holders...' });

      const holderIdMap = new Map(
        existingHolders.map(h => [h.name.toLowerCase(), h.id])
      );

      for (const holderName of preview.newHolders) {
        try {
          const created = await api.entities.FirstChargeHolder.create({
            name: holderName
          });
          holderIdMap.set(holderName.toLowerCase(), created.id);
          results.holdersCreated++;
        } catch (err) {
          results.errors.push(`Failed to create holder "${holderName}": ${err.message}`);
        }
      }

      // Step 2: Create properties and links
      setImportProgress({ current: 2, total: 4, step: 'Creating properties...' });

      const propertiesToImport = preview.properties.filter(p => p.can_import);

      for (const prop of propertiesToImport) {
        try {
          // Create property
          const property = await api.entities.Property.create({
            address: prop.address,
            current_value: prop.current_value,
            notes: prop.notes || '',
            property_type: 'Residential'
          });
          results.propertiesCreated++;

          // Create loan-property link
          const chargeType = prop.charge_type === 'first' ? 'First Charge' : 'Second Charge';
          let firstChargeHolderId = null;

          if (prop.charge_type === 'second' && prop.first_charge_holder) {
            const holderName = prop.first_charge_holder.trim();
            if (holderName && holderName !== 'Other' && holderName !== 'Unsure') {
              firstChargeHolderId = holderIdMap.get(holderName.toLowerCase());
            }
          }

          await api.entities.LoanProperty.create({
            loan_id: prop.matched_loan.id,
            property_id: property.id,
            charge_type: chargeType,
            first_charge_holder_id: firstChargeHolderId,
            first_charge_balance: prop.charge_type === 'second' ? prop.first_charge_balance : null,
            status: 'Active'
          });
          results.linksCreated++;

          // Create initial valuation record
          await api.entities.ValueHistory.create({
            property_id: property.id,
            value_type: 'Property Valuation',
            value: prop.current_value,
            effective_date: prop.backup_loan?.start_date || format(new Date(), 'yyyy-MM-dd'),
            notes: 'Imported from 360 Loan Security'
          });
          results.valuationsCreated++;

          // Create first charge balance history for second charges
          if (prop.charge_type === 'second' && prop.first_charge_balance) {
            await api.entities.ValueHistory.create({
              property_id: property.id,
              value_type: 'First Charge Balance',
              value: prop.first_charge_balance,
              effective_date: prop.backup_loan?.start_date || format(new Date(), 'yyyy-MM-dd'),
              notes: 'Imported from 360 Loan Security'
            });
            results.valuationsCreated++;
          }

        } catch (err) {
          results.errors.push(`Failed to import property "${prop.address}": ${err.message}`);
        }
      }

      // Step 3: Audit log
      setImportProgress({ current: 3, total: 4, step: 'Logging audit...' });

      await logBulkImportEvent({
        action: AuditAction.BULK_IMPORT,
        details: {
          source: '360 Loan Security',
          file: file?.name,
          propertiesCreated: results.propertiesCreated,
          linksCreated: results.linksCreated,
          holdersCreated: results.holdersCreated,
          valuationsCreated: results.valuationsCreated,
          errors: results.errors.length
        }
      });

      // Step 4: Invalidate queries
      setImportProgress({ current: 4, total: 4, step: 'Refreshing data...' });

      queryClient.invalidateQueries(['loans']);
      queryClient.invalidateQueries(['properties']);
      queryClient.invalidateQueries(['loan-properties']);
      queryClient.invalidateQueries(['first-charge-holders']);
      queryClient.invalidateQueries(['value-history']);

      setImportResult(results);

    } catch (err) {
      results.errors.push(`Import failed: ${err.message}`);
      setImportResult(results);
    } finally {
      setImporting(false);
      setImportProgress({ current: 0, total: 0, step: '' });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to={createPageUrl('OrgAdmin')}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Import Securities</h1>
          <p className="text-slate-500">Import property security data from 360 Loan Security backup</p>
        </div>
      </div>

      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Backup File
          </CardTitle>
          <CardDescription>
            Select a JSON backup file exported from 360 Loan Security
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {file && (
            <p className="mt-2 text-sm text-slate-600">
              Selected: {file.name}
            </p>
          )}
          {parseError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {preview && (
        <>
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Import Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-slate-900">{preview.totalProperties}</div>
                  <div className="text-sm text-slate-500">Total Properties</div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{preview.matchedCount}</div>
                  <div className="text-sm text-slate-500">Matched to Loans</div>
                </div>
                <div className="bg-amber-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-amber-600">{preview.unmatchedCount}</div>
                  <div className="text-sm text-slate-500">Unmatched (skipped)</div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{preview.newHolders.length}</div>
                  <div className="text-sm text-slate-500">New Charge Holders</div>
                </div>
              </div>

              {preview.newHolders.length > 0 && (
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="font-medium text-blue-900 mb-1">New First Charge Holders to Create:</div>
                  <div className="flex flex-wrap gap-2">
                    {preview.newHolders.map(name => (
                      <Badge key={name} variant="outline" className="bg-white">
                        <Building2 className="w-3 h-3 mr-1" />
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Properties Table */}
          <Card>
            <CardHeader>
              <CardTitle>Properties to Import</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Address</TableHead>
                      <TableHead>Loan #</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Charge</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>First Charge</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.properties.map((prop, idx) => (
                      <TableRow key={idx} className={!prop.can_import ? 'bg-amber-50' : ''}>
                        <TableCell className="font-medium max-w-[250px]">
                          <div className="flex items-start gap-2">
                            <Home className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
                            <span className="line-clamp-2">{prop.address}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {prop.loan_number ? (
                            <Badge variant="outline">#{prop.loan_number}</Badge>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {prop.matched_loan ? (
                            <span className="text-sm">{prop.matched_loan.borrower_name}</span>
                          ) : prop.backup_loan ? (
                            <span className="text-sm text-amber-600">{prop.backup_loan.name}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={prop.charge_type === 'first' ? 'default' : 'secondary'}>
                            {prop.charge_type_display}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(prop.current_value)}
                        </TableCell>
                        <TableCell>
                          {prop.charge_type === 'second' && prop.first_charge_holder ? (
                            <div className="text-sm">
                              <div>{prop.first_charge_holder}</div>
                              {prop.first_charge_balance && (
                                <div className="text-slate-500">
                                  {formatCurrency(prop.first_charge_balance)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {prop.can_import ? (
                            <Badge className="bg-green-100 text-green-700">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Ready
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              No Match
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Import Button */}
          {preview.matchedCount > 0 && !importResult && (
            <Card>
              <CardContent className="pt-6">
                {importing ? (
                  <div className="space-y-4">
                    <Progress value={(importProgress.current / importProgress.total) * 100} />
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {importProgress.step}
                    </div>
                  </div>
                ) : (
                  <Button onClick={executeImport} className="w-full" size="lg">
                    <Link2 className="w-4 h-4 mr-2" />
                    Import {preview.matchedCount} Properties
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Import Result */}
          {importResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {importResult.errors.length === 0 ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                      Import Complete
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                      Import Complete with Warnings
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 p-3 rounded-lg text-center">
                    <div className="text-xl font-bold text-green-600">{importResult.propertiesCreated}</div>
                    <div className="text-xs text-slate-500">Properties Created</div>
                  </div>
                  <div className="bg-blue-50 p-3 rounded-lg text-center">
                    <div className="text-xl font-bold text-blue-600">{importResult.linksCreated}</div>
                    <div className="text-xs text-slate-500">Loan Links Created</div>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg text-center">
                    <div className="text-xl font-bold text-purple-600">{importResult.holdersCreated}</div>
                    <div className="text-xs text-slate-500">Holders Created</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg text-center">
                    <div className="text-xl font-bold text-slate-600">{importResult.valuationsCreated}</div>
                    <div className="text-xs text-slate-500">Valuations Created</div>
                  </div>
                </div>

                {importResult.errors.length > 0 && (
                  <Alert variant="destructive">
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>
                      <div className="font-medium mb-2">{importResult.errors.length} error(s):</div>
                      <ul className="list-disc pl-4 space-y-1">
                        {importResult.errors.map((err, idx) => (
                          <li key={idx} className="text-sm">{err}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2">
                  <Link to={createPageUrl('Loans')} className="flex-1">
                    <Button variant="outline" className="w-full">
                      View Loans
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFile(null);
                      setBackupData(null);
                      setImportResult(null);
                    }}
                  >
                    Import Another
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
