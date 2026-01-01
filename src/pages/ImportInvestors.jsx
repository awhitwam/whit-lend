import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

// CSV Parser that handles quoted fields AND multi-line values
function parseCSV(text) {
  const firstNewline = text.indexOf('\n');
  const headerLine = text.substring(0, firstNewline).trim();
  const headers = [];
  let current = '';
  let inQuotes = false;

  for (let j = 0; j < headerLine.length; j++) {
    const char = headerLine[j];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headers.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  headers.push(current.trim().replace(/^"|"$/g, ''));

  const data = [];
  const content = text.substring(firstNewline + 1);
  let i = 0;

  while (i < content.length) {
    const values = [];
    current = '';
    inQuotes = false;

    while (i < content.length) {
      const char = content[i];

      if (char === '"') {
        if (inQuotes && content[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
        i++;
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
        i++;
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        while (i < content.length && (content[i] === '\n' || content[i] === '\r')) {
          i++;
        }
        break;
      }

      if (char !== '\r') {
        current += char;
      }
      i++;
    }

    if (i >= content.length && current !== '') {
      values.push(current.trim().replace(/^"|"$/g, ''));
    }

    if (values.length > 0 && values.some(v => v !== '')) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }
  }

  return data;
}

function transformInvestorData(row, products) {
  // Match product by name
  const productName = row['Investor Product']?.trim();
  const matchedProduct = products.find(p =>
    p.name.toLowerCase() === productName?.toLowerCase()
  );

  // Parse current balance (remove commas)
  const balanceStr = row['Investor Account Balance']?.replace(/,/g, '');
  const balance = parseFloat(balanceStr) || 0;

  // Parse interest rate
  const rateStr = row['Interest Rate Per Annum']?.replace(/,/g, '');
  const rate = parseFloat(rateStr) || (matchedProduct?.interest_rate_per_annum || 0);

  return {
    name: row['Investor Name']?.trim() || '',
    email: row['Email']?.trim() || null,
    phone: row['Mobile']?.trim() || null,
    account_number: row['Account Number']?.trim() || null,
    investor_number: row['Investor #']?.trim() || null,
    business_name: row['Business Name']?.trim() || null,
    first_name: row['First Name']?.trim() || null,
    last_name: row['Last Name']?.trim() || null,
    investor_product_id: matchedProduct?.id || null,
    annual_interest_rate: rate,
    current_capital_balance: balance,
    status: 'Active'
  };
}

export default function ImportInvestors() {
  const [file, setFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch investor products for matching
  const { data: products = [] } = useQuery({
    queryKey: ['investorProducts'],
    queryFn: () => api.entities.InvestorProduct.list()
  });

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setImportResult(null);
  };

  const handleImport = async () => {
    if (!file) return;

    setIsProcessing(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const rows = parseCSV(text);

      // Fetch existing investors
      const existingInvestors = await api.entities.Investor.list();

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors = [];

      for (const row of rows) {
        try {
          const investorData = transformInvestorData(row, products);

          // Skip if no name
          if (!investorData.name) {
            skipped++;
            continue;
          }

          // Find existing by account_number or investor_number
          const existing = existingInvestors.find(inv =>
            (investorData.account_number && inv.account_number === investorData.account_number) ||
            (investorData.investor_number && inv.investor_number === investorData.investor_number) ||
            (investorData.email && inv.email === investorData.email)
          );

          if (existing) {
            // Update existing
            await api.entities.Investor.update(existing.id, investorData);
            updated++;
          } else {
            // Create new
            await api.entities.Investor.create(investorData);
            created++;
          }
        } catch (error) {
          errors.push(`Row ${rows.indexOf(row) + 1}: ${error.message}`);
        }
      }

      setImportResult({
        success: true,
        created,
        updated,
        skipped,
        errors,
        total: rows.length
      });

      // Refresh investors list
      queryClient.invalidateQueries({ queryKey: ['investors'] });

    } catch (error) {
      setImportResult({
        success: false,
        error: error.message
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <Link to={createPageUrl('Investors')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Investors
          </Button>
        </Link>

        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Import Investors</h1>
          <p className="text-slate-500 mt-1">Upload a CSV file to import or update investor accounts</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>CSV File Upload</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              <p className="text-xs text-slate-500 mt-2">
                Expected columns: Email, Mobile, Investor Name, Account Number, Investor Product, Investor #, Business Name, Interest Rate Per Annum, Investor Account Balance, First Name, Last Name
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleImport}
                disabled={!file || isProcessing}
                className="bg-slate-900 hover:bg-slate-800"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import & Sync
                  </>
                )}
              </Button>
              {file && !isProcessing && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setFile(null);
                    setImportResult(null);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>

            {importResult && (
              <Alert className={importResult.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
                <div className="flex items-start gap-3">
                  {importResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <AlertDescription>
                      {importResult.success ? (
                        <div className="space-y-2">
                          <p className="font-medium text-green-900">Import completed successfully!</p>
                          <div className="text-sm text-green-800">
                            <p>• Created: {importResult.created} new investor(s)</p>
                            <p>• Updated: {importResult.updated} existing investor(s)</p>
                            <p>• Skipped: {importResult.skipped} row(s)</p>
                            <p>• Total processed: {importResult.total} row(s)</p>
                          </div>
                          {importResult.errors.length > 0 && (
                            <div className="mt-3">
                              <p className="font-medium text-amber-900">Errors:</p>
                              <ul className="text-xs text-amber-800 list-disc list-inside mt-1">
                                {importResult.errors.slice(0, 5).map((error, i) => (
                                  <li key={i}>{error}</li>
                                ))}
                                {importResult.errors.length > 5 && (
                                  <li>... and {importResult.errors.length - 5} more</li>
                                )}
                              </ul>
                            </div>
                          )}
                          <Button
                            size="sm"
                            className="mt-3"
                            onClick={() => navigate(createPageUrl('Investors'))}
                          >
                            View Investors
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium text-red-900">Import failed</p>
                          <p className="text-sm text-red-800 mt-1">{importResult.error}</p>
                        </div>
                      )}
                    </AlertDescription>
                  </div>
                </div>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <h3 className="font-semibold text-blue-900 mb-2">How it works:</h3>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Existing investors are matched by Account Number, Investor #, or Email</li>
              <li>Matched investors will be updated with new data</li>
              <li>New investors will be created automatically</li>
              <li>Investor Product column is matched to existing Investor Products by name</li>
              <li>Make sure to create Investor Products first before importing</li>
            </ul>
          </CardContent>
        </Card>

        {products.length === 0 && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <AlertDescription className="ml-2">
              <span className="font-medium text-amber-900">No Investor Products found.</span>{' '}
              <span className="text-amber-800">
                Create Investor Products first so imported investors can be matched to their product types.{' '}
                <Link to={createPageUrl('InvestorProducts')} className="underline">
                  Create Investor Products
                </Link>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
