import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    data.push(row);
  }
  
  return data;
}

function transformBorrowerData(row) {
  const business = row['Business'];
  const firstName = row['First Name'];
  const lastName = row['Last Name'];
  
  return {
    unique_number: row['Unique#'],
    full_name: business || `${firstName} ${lastName}`,
    first_name: firstName,
    last_name: lastName,
    business: business,
    email: row['Email'],
    gender: row['Gender'],
    address: row['Address'],
    city: row['City'],
    zipcode: row['Zipcode'],
    country: row['Country'],
    mobile: row['Mobile'],
    landline: row['Landline'],
    phone: row['Mobile'] || row['Landline'],
    import_created_date: row['Created'],
    status: 'Active'
  };
}

export default function ImportBorrowers() {
  const [file, setFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
      
      // Fetch existing borrowers
      const existingBorrowers = await api.entities.Borrower.list();
      
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors = [];

      for (const row of rows) {
        try {
          const borrowerData = transformBorrowerData(row);
          
          // Skip if no name
          if (!borrowerData.first_name && !borrowerData.last_name) {
            skipped++;
            continue;
          }

          // Find existing by unique_number or email
          const existing = existingBorrowers.find(b => 
            (borrowerData.unique_number && b.unique_number === borrowerData.unique_number) ||
            (borrowerData.email && b.email === borrowerData.email)
          );

          if (existing) {
            // Update existing
            await api.entities.Borrower.update(existing.id, borrowerData);
            updated++;
          } else {
            // Create new
            await api.entities.Borrower.create(borrowerData);
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

      // Refresh borrowers list
      queryClient.invalidateQueries({ queryKey: ['borrowers'] });

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
        <Link to={createPageUrl('Borrowers')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Borrowers
          </Button>
        </Link>

        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Import Borrowers</h1>
          <p className="text-slate-500 mt-1">Upload a CSV file to import or update borrowers</p>
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
                Expected columns: Unique#, Full Name, Business, Email, Created, Zipcode, First Name, Gender, Address, City, Country, Landline, Last Name, Mobile
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
                            <p>• Created: {importResult.created} new borrower(s)</p>
                            <p>• Updated: {importResult.updated} existing borrower(s)</p>
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
                            onClick={() => navigate(createPageUrl('Borrowers'))}
                          >
                            View Borrowers
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
              <li>Existing borrowers are matched by Unique# or Email</li>
              <li>Matched borrowers will be updated with new data</li>
              <li>New borrowers will be created automatically</li>
              <li>The Status column from CSV is ignored</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}