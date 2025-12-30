import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  FileText,
  Package,
  Menu,
  X,
  Building2,
  Receipt,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
  ArrowLeft,
  UserCog,
  History,
  Wrench,
  FileSpreadsheet,
  CreditCard,
  FolderInput,
  ShieldCheck,
  List,
  UsersRound,
  CircleDot,
  CheckCircle2,
  Clock,
  AlertTriangle,
  LayoutList,
  RefreshCw
} from 'lucide-react';
import { useState, useEffect } from 'react';
import OrganizationSwitcher from '@/components/organization/OrganizationSwitcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useOrganization } from '@/lib/OrganizationContext';
import { getOrgItem, setOrgItem } from '@/lib/orgStorage';

const navigation = [
  { name: 'Dashboard', href: 'Dashboard', icon: LayoutDashboard },
  {
    name: 'Borrowers',
    icon: Users,
    children: [
      { name: 'All Borrowers', href: 'Borrowers', icon: List },
      { name: 'By Contact', href: 'BorrowersByContact', icon: UsersRound },
    ]
  },
  {
    name: 'Loans',
    icon: FileText,
    children: [
      { name: 'Live', href: 'Loans?status=Live', icon: CircleDot },
      { name: 'Settled', href: 'Loans?status=Closed', icon: CheckCircle2 },
      { name: 'Fully Paid', href: 'Loans?status=Fully Paid', icon: CheckCircle2 },
      { name: 'Restructured', href: 'Loans?status=Restructured', icon: RefreshCw },
      { name: 'Pending', href: 'Loans?status=Pending', icon: Clock },
      { name: 'Defaulted', href: 'Loans?status=Defaulted', icon: AlertTriangle },
      { name: 'All Loans', href: 'Loans?status=all', icon: LayoutList },
    ]
  },
  { name: 'Investors', href: 'Investors', icon: TrendingUp },
  { name: 'Ledger', href: 'Ledger', icon: Building2 },
  { name: 'Expenses', href: 'Expenses', icon: Receipt },
  {
    name: 'Settings',
    icon: Settings,
    children: [
      { name: 'General', href: 'Config', icon: Wrench },
      { name: 'Products', href: 'Products', icon: Package },
      { name: 'Users', href: 'Users', icon: UserCog },
      {
        name: 'Import Data',
        icon: FolderInput,
        children: [
          { name: 'Loandisc Import', href: 'ImportLoandisc', icon: FileSpreadsheet },
          { name: 'Import Borrowers', href: 'ImportBorrowers', icon: Users },
          { name: 'Import Transactions', href: 'ImportTransactions', icon: CreditCard },
        ]
      },
      { name: 'Audit Log', href: 'AuditLog', icon: History },
      { name: 'Super Admin', href: 'SuperAdmin', icon: ShieldCheck },
    ]
  },
];

export default function Layout({ children, currentPageName }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = getOrgItem('sidebarCollapsed');
    return saved === 'true';
  });
  const [expandedMenus, setExpandedMenus] = useState(() => {
    const saved = getOrgItem('expandedMenus');
    return saved ? JSON.parse(saved) : ['Settings'];
  });
  const { currentTheme, currentOrganization } = useOrganization();
  const navigate = useNavigate();
  const location = useLocation();

  // Determine if we should show a back button (detail pages, not main nav pages)
  const mainPages = ['Dashboard', 'Borrowers', 'Loans', 'Investors', 'Ledger', 'Expenses', 'Products', 'Config', 'Users', 'ImportLoandisc', 'ImportBorrowers', 'ImportTransactions', 'AuditLog', 'SuperAdmin'];
  const showBackButton = !mainPages.includes(currentPageName) && window.history.length > 1;

  useEffect(() => {
    setOrgItem('sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    setOrgItem('expandedMenus', JSON.stringify(expandedMenus));
  }, [expandedMenus]);

  const isActive = (pageName) => {
    if (!pageName) return false;
    // Handle query params in href (e.g., 'Loans?status=Live')
    const [basePage, queryString] = pageName.split('?');
    const isBasePage = currentPageName === basePage ||
                       currentPageName?.startsWith(basePage.replace('s', ''));

    // If no query params in href, just check base page
    if (!queryString) return isBasePage;

    // If query params exist, check if they match current URL
    if (isBasePage) {
      const params = new URLSearchParams(queryString);
      const currentParams = new URLSearchParams(location.search);
      // Check if all params in href match current URL params
      for (const [key, value] of params.entries()) {
        if (currentParams.get(key) !== value) return false;
      }
      return true;
    }
    return false;
  };

  const isChildActive = (item) => {
    if (!item.children) return false;
    return item.children.some(child => {
      if (child.children) {
        return child.children.some(grandchild => isActive(grandchild.href));
      }
      return isActive(child.href);
    });
  };

  const toggleMenu = (menuName) => {
    setExpandedMenus(prev =>
      prev.includes(menuName)
        ? prev.filter(m => m !== menuName)
        : [...prev, menuName]
    );
  };

  const sidebarWidth = sidebarCollapsed ? 'w-16' : 'w-64';
  const mainPadding = sidebarCollapsed ? 'md:pl-16' : 'md:pl-64';

  // Render a single nav item (either a link or a submenu)
  const renderNavItem = (item, isMobile = false) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedMenus.includes(item.name);
    const childActive = isChildActive(item);

    if (hasChildren) {
      // Render submenu
      if (sidebarCollapsed && !isMobile) {
        // When collapsed, show tooltip with submenu items
        return (
          <Tooltip key={item.name}>
            <TooltipTrigger asChild>
              <button
                className={`
                  w-full flex items-center justify-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${childActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }
                `}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-slate-800 text-white border-slate-700 p-0">
              <div className="py-1">
                <div className="px-3 py-2 text-xs font-semibold text-slate-400 border-b border-slate-700">
                  {item.name}
                </div>
                {item.children.map(child => (
                  child.children ? (
                    <div key={child.name}>
                      <div className="px-3 py-2 text-xs font-semibold text-slate-500 mt-1">
                        {child.name}
                      </div>
                      {child.children.map(grandchild => (
                        <Link
                          key={grandchild.name}
                          to={createPageUrl(grandchild.href)}
                          className={`
                            flex items-center gap-2 px-3 py-2 text-sm transition-colors pl-5
                            ${isActive(grandchild.href)
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                            }
                          `}
                        >
                          <grandchild.icon className="w-4 h-4" />
                          {grandchild.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Link
                      key={child.name}
                      to={createPageUrl(child.href)}
                      className={`
                        flex items-center gap-2 px-3 py-2 text-sm transition-colors
                        ${isActive(child.href)
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                        }
                      `}
                    >
                      <child.icon className="w-4 h-4" />
                      {child.name}
                    </Link>
                  )
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      }

      // Expanded sidebar or mobile - show collapsible submenu
      return (
        <Collapsible
          key={item.name}
          open={isExpanded}
          onOpenChange={() => toggleMenu(item.name)}
        >
          <CollapsibleTrigger asChild>
            <button
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                ${childActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }
                ${isMobile ? 'text-slate-600 hover:bg-slate-50' : ''}
                ${isMobile && childActive ? 'bg-slate-100 text-slate-900' : ''}
              `}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1 text-left">{item.name}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className={`mt-1 space-y-1 ${isMobile ? 'ml-4' : 'ml-4 pl-4 border-l border-slate-700'}`}>
              {item.children.map(child => (
                child.children ? (
                  // Nested submenu
                  <Collapsible
                    key={child.name}
                    open={expandedMenus.includes(child.name)}
                    onOpenChange={() => toggleMenu(child.name)}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        className={`
                          w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
                          ${isChildActive(child)
                            ? isMobile
                              ? 'bg-slate-100 text-slate-900 font-medium'
                              : 'bg-slate-800 text-white'
                            : isMobile
                              ? 'text-slate-600 hover:bg-slate-50'
                              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                          }
                        `}
                      >
                        <child.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="flex-1 text-left">{child.name}</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${expandedMenus.includes(child.name) ? 'rotate-180' : ''}`} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className={`mt-1 space-y-1 ${isMobile ? 'ml-4' : 'ml-4 pl-4 border-l border-slate-600'}`}>
                        {child.children.map(grandchild => (
                          <Link
                            key={grandchild.name}
                            to={createPageUrl(grandchild.href)}
                            onClick={isMobile ? () => setMobileMenuOpen(false) : undefined}
                            className={`
                              flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
                              ${isActive(grandchild.href)
                                ? isMobile
                                  ? 'bg-slate-100 text-slate-900 font-medium'
                                  : 'bg-slate-800 text-white'
                                : isMobile
                                  ? 'text-slate-600 hover:bg-slate-50'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                              }
                            `}
                          >
                            <grandchild.icon className="w-4 h-4 flex-shrink-0" />
                            {grandchild.name}
                          </Link>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <Link
                    key={child.name}
                    to={createPageUrl(child.href)}
                    onClick={isMobile ? () => setMobileMenuOpen(false) : undefined}
                    className={`
                      flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
                      ${isActive(child.href)
                        ? isMobile
                          ? 'bg-slate-100 text-slate-900 font-medium'
                          : 'bg-slate-800 text-white'
                        : isMobile
                          ? 'text-slate-600 hover:bg-slate-50'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }
                    `}
                  >
                    <child.icon className="w-4 h-4 flex-shrink-0" />
                    {child.name}
                  </Link>
                )
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      );
    }

    // Regular nav item (no children)
    const active = isActive(item.href);
    const linkContent = (
      <Link
        key={item.name}
        to={createPageUrl(item.href)}
        onClick={isMobile ? () => setMobileMenuOpen(false) : undefined}
        className={`
          flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
          ${sidebarCollapsed && !isMobile ? 'justify-center' : ''}
          ${active
            ? isMobile
              ? 'bg-slate-100 text-slate-900'
              : 'bg-slate-800 text-white'
            : isMobile
              ? 'text-slate-600 hover:bg-slate-50'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }
        `}
      >
        <item.icon className="w-5 h-5 flex-shrink-0" />
        {(!sidebarCollapsed || isMobile) && item.name}
      </Link>
    );

    if (sidebarCollapsed && !isMobile) {
      return (
        <Tooltip key={item.name}>
          <TooltipTrigger asChild>
            {linkContent}
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-800 text-white border-slate-700">
            {item.name}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-screen bg-slate-50 overflow-hidden flex flex-col">
        {/* Desktop Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-50 ${sidebarWidth} bg-slate-900 hidden md:block transition-all duration-300`}>
          {/* Theme accent bar at top */}
          <div
            className="h-1 w-full transition-colors duration-300"
            style={{ backgroundColor: currentTheme.primary }}
          />
          <div className="flex h-full flex-col">
            {/* Logo and Collapse Toggle */}
            <div className="flex h-16 items-center justify-between px-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div
                  className="p-2 rounded-lg flex-shrink-0 transition-colors duration-300"
                  style={{ backgroundColor: currentTheme.primary }}
                >
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                {!sidebarCollapsed && (
                  <span className="text-xl font-bold text-white tracking-tight">WhitLend</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="text-slate-400 hover:text-white hover:bg-slate-800/50 h-8 w-8"
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </Button>
            </div>

            {/* Organization Switcher */}
            {!sidebarCollapsed && (
              <div className="px-3 py-4 border-b border-slate-800">
                <OrganizationSwitcher />
              </div>
            )}

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-2 py-4 overflow-y-auto">
              {navigation.map((item) => renderNavItem(item, false))}
            </nav>

            {/* Footer */}
            {!sidebarCollapsed && (
              <div className="p-4 border-t border-slate-800">
                <p className="text-xs text-slate-500 text-center">
                  © 2024 WhitLend
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Mobile Header */}
        <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-slate-200">
          {/* Theme accent bar */}
          <div
            className="h-1 w-full transition-colors duration-300"
            style={{ backgroundColor: currentTheme.primary }}
          />
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center gap-2">
              {showBackButton && (
                <button
                  onClick={() => navigate(-1)}
                  className="text-slate-600 hover:text-slate-900 transition-colors p-1 -ml-1 rounded"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div
                className="p-1.5 rounded-lg transition-colors duration-300"
                style={{ backgroundColor: currentTheme.primary }}
              >
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold text-slate-900">WhitLend</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </header>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setMobileMenuOpen(false)}>
            <div
              className="absolute top-14 left-0 right-0 bg-white border-b border-slate-200 shadow-lg max-h-[calc(100vh-3.5rem)] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Organization Switcher for Mobile */}
              <div className="px-3 py-3 border-b border-slate-200">
                <OrganizationSwitcher />
              </div>
              <nav className="p-2">
                {navigation.map((item) => renderNavItem(item, true))}
              </nav>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className={`${mainPadding} pt-14 md:pt-0 transition-all duration-300 flex-1 flex flex-col overflow-hidden`}>
          {/* Desktop header with organization name and theme color */}
          <div className="hidden md:block flex-shrink-0">
            <div
              className="h-12 flex items-center px-6 transition-colors duration-300"
              style={{ backgroundColor: currentTheme.primary }}
            >
              <div className="flex items-center gap-3">
                {showBackButton && (
                  <button
                    onClick={() => navigate(-1)}
                    className="text-white/70 hover:text-white transition-colors p-1 -ml-1 rounded hover:bg-white/10"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <Building2 className="w-5 h-5 text-white/80" />
                <span className="text-white font-medium">
                  {currentOrganization?.name || 'Select Organization'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto relative">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
