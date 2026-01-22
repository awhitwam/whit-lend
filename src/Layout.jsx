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
  AlertCircle,
  LayoutList,
  RefreshCw,
  Banknote,
  FileCheck,
  DollarSign,
  Coins,
  Info,
  Crown,
  MessageSquare,
  Mail,
  Star,
  FileBarChart
} from 'lucide-react';
import { useState, useEffect } from 'react';
import OrganizationSwitcher from '@/components/organization/OrganizationSwitcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useOrganization } from '@/lib/OrganizationContext';
import { useAuth } from '@/lib/AuthContext';
import { getOrgItem, setOrgItem, getOrgJSON, setOrgJSON } from '@/lib/orgStorage';

const navigation = [
  { name: 'Dashboard', href: 'Dashboard', icon: LayoutDashboard, iconColor: 'text-sky-400' },
  {
    name: 'Borrowers',
    icon: Users,
    iconColor: 'text-violet-400',
    children: [
      { name: 'All Borrowers', href: 'Borrowers', icon: List },
      { name: 'By Contact', href: 'BorrowersByContact', icon: UsersRound },
    ]
  },
  {
    name: 'Loans',
    icon: FileText,
    iconColor: 'text-emerald-400',
    children: [
      { name: 'Live', href: 'Loans?status=Live', icon: CircleDot },
      { name: 'Settled', href: 'Loans?status=Closed', icon: CheckCircle2 },
      { name: 'Restructured', href: 'Loans?status=Restructured', icon: RefreshCw },
      { name: 'Pending', href: 'Loans?status=Pending', icon: Clock },
      { name: 'Defaulted', href: 'Loans?status=Defaulted', icon: AlertTriangle },
      { name: 'All Loans', href: 'Loans?status=all', icon: LayoutList },
    ]
  },
  {
    name: 'Investors',
    icon: TrendingUp,
    iconColor: 'text-amber-400',
    children: [
      { name: 'All Investors', href: 'Investors', icon: List },
      { name: 'Investor Products', href: 'InvestorProducts', icon: Package },
    ]
  },
  {
    name: 'Finance',
    icon: DollarSign,
    iconColor: 'text-green-400',
    children: [
      { name: 'Ledger', href: 'Ledger', icon: Building2 },
      { name: 'Receipts', href: 'Receipts', icon: Receipt },
      { name: 'Bank Reconciliation', href: 'BankReconciliation', icon: FileCheck },
      { name: 'Orphaned Entries', href: 'OrphanedEntries', icon: AlertCircle },
      { name: 'Expenses', href: 'Expenses', icon: Banknote },
      { name: 'Other Income', href: 'OtherIncome', icon: Coins },
    ]
  },
  {
    name: 'Reports',
    icon: FileBarChart,
    iconColor: 'text-rose-400',
    children: [
      { name: 'Accountant Report', href: 'AccountantReport', icon: FileSpreadsheet },
    ]
  },
  {
    name: 'Settings',
    icon: Settings,
    iconColor: 'text-slate-400',
    children: [
      { name: 'User', href: 'Config', icon: Wrench },
      { name: 'Products', href: 'Products', icon: Package },
      { name: 'Letter Templates', href: 'LetterTemplates', icon: Mail, requiresAdmin: true },
      { name: 'Users', href: 'Users', icon: UserCog, requiresSuperAdmin: true },
      {
        name: 'Import Data',
        icon: FolderInput,
        requiresSuperAdmin: true,
        children: [
          { name: 'Loandisc Import', href: 'ImportLoandisc', icon: FileSpreadsheet },
          { name: 'Loandisc Expenses', href: 'ImportExpenses', icon: Receipt },
          { name: 'Import Comments', href: 'ImportComments', icon: MessageSquare },
          { name: 'Historical Disbursements', href: 'ImportHistoricalDisbursements', icon: FileSpreadsheet },
          { name: 'Import Investors', href: 'ImportInvestors', icon: TrendingUp },
          { name: 'Import Investor Txns', href: 'ImportInvestorTransactions', icon: CreditCard },
        ]
      },
      { name: 'Audit Log', href: 'AuditLog', icon: History, requiresSuperAdmin: true },
      { name: 'Org Admin', href: 'OrgAdmin', icon: ShieldCheck, requiresAdmin: true },
      { name: 'Super Admin', href: 'SuperAdmin', icon: Crown, requiresSuperAdmin: true },
      { name: 'About', href: 'About', icon: Info },
    ]
  },
];

// Icon lookup map for favorites (icons can't be serialized to storage)
const iconMap = {
  LayoutDashboard,
  Users,
  FileText,
  Package,
  Building2,
  Receipt,
  TrendingUp,
  Settings,
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
  AlertCircle,
  LayoutList,
  RefreshCw,
  Banknote,
  FileCheck,
  DollarSign,
  Coins,
  Info,
  Crown,
  MessageSquare,
  Mail,
  Star
};

// Function to filter navigation based on permissions
const getFilteredNavigation = (canAdmin, isSuperAdmin) => {
  const filterChildren = (children) => {
    return children
      .filter(child => {
        if (child.requiresSuperAdmin && !isSuperAdmin) return false;
        if (child.requiresAdmin && !canAdmin) return false;
        return true;
      })
      .map(child => {
        if (child.children) {
          return { ...child, children: filterChildren(child.children) };
        }
        return child;
      });
  };

  return navigation
    .filter(item => {
      if (item.requiresSuperAdmin && !isSuperAdmin) return false;
      if (item.requiresAdmin && !canAdmin) return false;
      return true;
    })
    .map(item => {
      if (item.children) {
        return { ...item, children: filterChildren(item.children) };
      }
      return item;
    });
};

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
  const [favorites, setFavorites] = useState(() => {
    return getOrgJSON('favoriteNavItems', []);
  });
  const { currentTheme, currentOrganization, canAdmin } = useOrganization();
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get filtered navigation based on user permissions
  const filteredNavigation = getFilteredNavigation(canAdmin(), isSuperAdmin);

  // Determine if we should show a back button (detail pages, not main nav pages)
  const mainPages = ['Dashboard', 'Borrowers', 'Loans', 'Investors', 'InvestorProducts', 'Ledger', 'Receipts', 'BankReconciliation', 'OrphanedEntries', 'Expenses', 'OtherIncome', 'Products', 'Config', 'LetterTemplates', 'Users', 'ImportLoandisc', 'ImportExpenses', 'ImportComments', 'ImportHistoricalDisbursements', 'ImportInvestors', 'ImportInvestorTransactions', 'AuditLog', 'SuperAdmin', 'OrgAdmin', 'About'];
  // Show back button on detail pages OR on Loans page when filtering by borrower
  const isLoansWithBorrowerFilter = currentPageName === 'Loans' &&
    (location.search.includes('borrower_ids') || location.search.includes('borrower='));
  const showBackButton = (!mainPages.includes(currentPageName) && window.history.length > 1) || isLoansWithBorrowerFilter;

  useEffect(() => {
    setOrgItem('sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    setOrgItem('expandedMenus', JSON.stringify(expandedMenus));
  }, [expandedMenus]);

  useEffect(() => {
    setOrgJSON('favoriteNavItems', favorites);
  }, [favorites]);

  // Toggle favorite status for a menu item
  const toggleFavorite = (item, e) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites(prev => {
      const exists = prev.some(f => f.href === item.href);
      if (exists) {
        return prev.filter(f => f.href !== item.href);
      }
      if (prev.length >= 5) {
        // Already at max, don't add
        return prev;
      }
      // Get icon name from the component
      const iconName = item.icon?.name || item.icon?.displayName || 'Star';
      return [...prev, {
        name: item.name,
        href: item.href,
        iconName
      }];
    });
  };

  const isFavorite = (href) => favorites.some(f => f.href === href);

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
                <item.icon className={`w-5 h-5 flex-shrink-0 ${item.iconColor || ''}`} />
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
                      {child.requiresSuperAdmin && <Crown className="w-3 h-3 text-amber-400" />}
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
              <item.icon className={`w-5 h-5 flex-shrink-0 ${!isMobile && item.iconColor ? item.iconColor : ''}`} />
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
                        <span className="flex-1 text-left flex items-center gap-1">
                          {child.name}
                          {child.requiresSuperAdmin && <Crown className="w-3 h-3 text-amber-400" />}
                        </span>
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
                              group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
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
                            <span className="flex-1">{grandchild.name}</span>
                            {grandchild.href && (
                              <button
                                onClick={(e) => toggleFavorite(grandchild, e)}
                                className={`transition-opacity ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                              >
                                <Star
                                  className={`w-3 h-3 ${isFavorite(grandchild.href) ? 'fill-amber-400 text-amber-400' : isMobile ? 'text-slate-400' : 'text-slate-500'}`}
                                />
                              </button>
                            )}
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
                      group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
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
                    <span className="flex-1">{child.name}</span>
                    {child.requiresSuperAdmin && <Crown className="w-3 h-3 text-amber-400" />}
                    {child.href && (
                      <button
                        onClick={(e) => toggleFavorite(child, e)}
                        className={`transition-opacity ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                      >
                        <Star
                          className={`w-3 h-3 ${isFavorite(child.href) ? 'fill-amber-400 text-amber-400' : isMobile ? 'text-slate-400' : 'text-slate-500'}`}
                        />
                      </button>
                    )}
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
        <item.icon className={`w-5 h-5 flex-shrink-0 ${!isMobile && item.iconColor ? item.iconColor : ''}`} />
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
            {/* Header and Collapse Toggle */}
            <div className="flex h-16 items-center justify-between px-4 border-b border-slate-800">
              {!sidebarCollapsed && (
                <span className="text-xl font-bold text-white tracking-tight">WhitLend</span>
              )}
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
              {/* Dashboard */}
              {renderNavItem(filteredNavigation[0], false)}

              {/* Favorites Section */}
              {favorites.length > 0 && (
                <div className="mt-1 mb-2 pb-2 border-b border-slate-700 ml-2">
                  {!sidebarCollapsed && (
                    <div className="text-xs font-semibold text-slate-500 px-3 py-1 uppercase tracking-wider">
                      Favorites
                    </div>
                  )}
                  {favorites.map(fav => {
                    const IconComponent = iconMap[fav.iconName] || Star;
                    const active = isActive(fav.href);
                    const linkContent = (
                      <Link
                        key={fav.href}
                        to={createPageUrl(fav.href)}
                        className={`
                          group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
                          ${sidebarCollapsed ? 'justify-center' : ''}
                          ${active
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                          }
                        `}
                      >
                        <IconComponent className="w-4 h-4 flex-shrink-0" />
                        {!sidebarCollapsed && (
                          <>
                            <span className="flex-1">{fav.name}</span>
                            <button
                              onClick={(e) => toggleFavorite(fav, e)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            </button>
                          </>
                        )}
                      </Link>
                    );

                    if (sidebarCollapsed) {
                      return (
                        <Tooltip key={fav.href}>
                          <TooltipTrigger asChild>
                            {linkContent}
                          </TooltipTrigger>
                          <TooltipContent side="right" className="bg-slate-800 text-white border-slate-700">
                            {fav.name}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }
                    return linkContent;
                  })}
                </div>
              )}

              {/* Rest of navigation */}
              {filteredNavigation.slice(1).map((item) => renderNavItem(item, false))}
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
                {/* Dashboard */}
                {renderNavItem(filteredNavigation[0], true)}

                {/* Favorites Section for Mobile */}
                {favorites.length > 0 && (
                  <div className="mt-2 mb-2 pb-2 border-b border-slate-200 ml-2">
                    <div className="text-xs font-semibold text-slate-400 px-3 py-1 uppercase tracking-wider">
                      Favorites
                    </div>
                    {favorites.map(fav => {
                      const IconComponent = iconMap[fav.iconName] || Star;
                      const active = isActive(fav.href);
                      return (
                        <Link
                          key={fav.href}
                          to={createPageUrl(fav.href)}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`
                            group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all
                            ${active
                              ? 'bg-slate-100 text-slate-900 font-medium'
                              : 'text-slate-600 hover:bg-slate-50'
                            }
                          `}
                        >
                          <IconComponent className="w-4 h-4 flex-shrink-0" />
                          <span className="flex-1">{fav.name}</span>
                          <button
                            onClick={(e) => toggleFavorite(fav, e)}
                            className="opacity-100"
                          >
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          </button>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {/* Rest of navigation */}
                {filteredNavigation.slice(1).map((item) => renderNavItem(item, true))}
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
