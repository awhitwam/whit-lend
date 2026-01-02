import { Card, CardContent } from "@/components/ui/card";

// Version info - update these when releasing
const VERSION = "1.0.0";

// Git info injected at build time by Vite
const GIT_COMMIT = typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'dev';
const GIT_BRANCH = typeof __GIT_BRANCH__ !== 'undefined' ? __GIT_BRANCH__ : 'local';
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toISOString();

// Format date nicely
function formatBuildDate(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

export default function About() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col items-center text-center space-y-6">
            {/* Logo */}
            <img src="/logo.png" alt="Whit-Lend" className="h-32" />

            {/* App Name */}
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Whit-Lend</h1>
              <p className="text-slate-500 mt-1">Empowering Loans</p>
            </div>

            {/* Version Info */}
            <div className="bg-slate-50 rounded-lg px-6 py-4 w-full max-w-sm">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Version</span>
                <span className="font-medium text-slate-900">{VERSION}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-slate-500">Build</span>
                <span className="font-mono text-slate-900">{GIT_COMMIT}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-slate-500">Branch</span>
                <span className="font-mono text-slate-900">{GIT_BRANCH}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-slate-500">Built</span>
                <span className="font-medium text-slate-900">{formatBuildDate(BUILD_TIME)}</span>
              </div>
            </div>

            {/* Description */}
            <p className="text-slate-600 text-sm max-w-md">
              A comprehensive lending management system for managing loans, borrowers, investors, and financial reconciliation.
            </p>

            {/* Copyright */}
            <div className="pt-4 border-t border-slate-200 w-full">
              <p className="text-slate-400 text-sm">
                &copy; 2026 Andrew Whitwam. All rights reserved.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
