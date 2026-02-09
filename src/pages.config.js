import { lazy } from 'react';
import __Layout from './Layout.jsx';

const BorrowerDetails = lazy(() => import('./pages/BorrowerDetails'));
const Borrowers = lazy(() => import('./pages/Borrowers'));
const BorrowersByContact = lazy(() => import('./pages/BorrowersByContact'));
const Config = lazy(() => import('./pages/Config'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Expenses = lazy(() => import('./pages/Expenses'));
const ImportBorrowers = lazy(() => import('./pages/ImportBorrowers'));
const ImportComments = lazy(() => import('./pages/ImportComments'));
const ImportDisbursements = lazy(() => import('./pages/ImportDisbursements'));
const ImportHistoricalDisbursements = lazy(() => import('./pages/ImportHistoricalDisbursements'));
const ImportExpenses = lazy(() => import('./pages/ImportExpenses'));
const ImportInvestors = lazy(() => import('./pages/ImportInvestors'));
const ImportInvestorTransactions = lazy(() => import('./pages/ImportInvestorTransactions'));
const ImportLoandisc = lazy(() => import('./pages/ImportLoandisc'));
const ImportSecurities = lazy(() => import('./pages/ImportSecurities'));
const ImportTransactions = lazy(() => import('./pages/ImportTransactions'));
const InvestorDetails = lazy(() => import('./pages/InvestorDetails'));
const InvestorProducts = lazy(() => import('./pages/InvestorProducts'));
const Investors = lazy(() => import('./pages/Investors'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Loans = lazy(() => import('./pages/Loans'));
const NewLoan = lazy(() => import('./pages/NewLoan'));
const Products = lazy(() => import('./pages/Products'));
const LoanDetails = lazy(() => import('./pages/LoanDetails'));
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation'));
const Login = lazy(() => import('./pages/Login'));
const Users = lazy(() => import('./pages/Users'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const OrgAdmin = lazy(() => import('./pages/OrgAdmin'));
const BankReconciliation = lazy(() => import('./pages/BankReconciliation'));
const BankReconciliationSimple = lazy(() => import('./pages/BankReconciliationSimple'));
const OtherIncome = lazy(() => import('./pages/OtherIncome'));
const OrphanedEntries = lazy(() => import('./pages/OrphanedEntries'));
const Receipts = lazy(() => import('./pages/Receipts'));
const About = lazy(() => import('./pages/About'));
const UpdatePassword = lazy(() => import('./pages/UpdatePassword'));
const LetterTemplateEditor = lazy(() => import('./components/letters/LetterTemplateEditor'));
const LetterTemplates = lazy(() => import('./pages/LetterTemplates'));
const GoogleDriveCallback = lazy(() => import('./pages/GoogleDriveCallback'));
const AccountantReport = lazy(() => import('./pages/AccountantReport'));

export const PAGES = {
    "BorrowerDetails": BorrowerDetails,
    "Borrowers": Borrowers,
    "BorrowersByContact": BorrowersByContact,
    "Config": Config,
    "Dashboard": Dashboard,
    "Expenses": Expenses,
    "ImportBorrowers": ImportBorrowers,
    "ImportComments": ImportComments,
    "ImportDisbursements": ImportDisbursements,
    "ImportHistoricalDisbursements": ImportHistoricalDisbursements,
    "ImportExpenses": ImportExpenses,
    "ImportInvestors": ImportInvestors,
    "ImportInvestorTransactions": ImportInvestorTransactions,
    "ImportLoandisc": ImportLoandisc,
    "ImportSecurities": ImportSecurities,
    "ImportTransactions": ImportTransactions,
    "InvestorDetails": InvestorDetails,
    "InvestorProducts": InvestorProducts,
    "Investors": Investors,
    "Ledger": Ledger,
    "Loans": Loans,
    "NewLoan": NewLoan,
    "Products": Products,
    "LoanDetails": LoanDetails,
    "AcceptInvitation": AcceptInvitation,
    "Login": Login,
    "Users": Users,
    "AuditLog": AuditLog,
    "SuperAdmin": SuperAdmin,
    "OrgAdmin": OrgAdmin,
    "BankReconciliation": BankReconciliation,
    "BankReconciliationSimple": BankReconciliationSimple,
    "OtherIncome": OtherIncome,
    "OrphanedEntries": OrphanedEntries,
    "Receipts": Receipts,
    "About": About,
    "UpdatePassword": UpdatePassword,
    "LetterTemplateEditor": LetterTemplateEditor,
    "LetterTemplates": LetterTemplates,
    "GoogleDriveCallback": GoogleDriveCallback,
    "AccountantReport": AccountantReport,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
