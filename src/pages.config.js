import BorrowerDetails from './pages/BorrowerDetails';
import Borrowers from './pages/Borrowers';
import BorrowersByContact from './pages/BorrowersByContact';
import Config from './pages/Config';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import ImportBorrowers from './pages/ImportBorrowers';
import ImportDisbursements from './pages/ImportDisbursements';
import ImportHistoricalDisbursements from './pages/ImportHistoricalDisbursements';
import ImportExpenses from './pages/ImportExpenses';
import ImportInvestors from './pages/ImportInvestors';
import ImportInvestorTransactions from './pages/ImportInvestorTransactions';
import ImportLoandisc from './pages/ImportLoandisc';
import ImportTransactions from './pages/ImportTransactions';
import InvestorDetails from './pages/InvestorDetails';
import InvestorProducts from './pages/InvestorProducts';
import Investors from './pages/Investors';
import Ledger from './pages/Ledger';
import Loans from './pages/Loans';
import NewLoan from './pages/NewLoan';
import Products from './pages/Products';
import LoanDetails from './pages/LoanDetails';
import AcceptInvitation from './pages/AcceptInvitation';
import Login from './pages/Login';
import Users from './pages/Users';
import AuditLog from './pages/AuditLog';
import SuperAdmin from './pages/SuperAdmin';
import OrgAdmin from './pages/OrgAdmin';
import BankReconciliation from './pages/BankReconciliation';
import BankReconciliation2 from './pages/BankReconciliation2';
import BankReconciliationV2 from './pages/BankReconciliationV2';
import OtherIncome from './pages/OtherIncome';
import OrphanedEntries from './pages/OrphanedEntries';
import Receipts from './pages/Receipts';
import About from './pages/About';
import __Layout from './Layout.jsx';


export const PAGES = {
    "BorrowerDetails": BorrowerDetails,
    "Borrowers": Borrowers,
    "BorrowersByContact": BorrowersByContact,
    "Config": Config,
    "Dashboard": Dashboard,
    "Expenses": Expenses,
    "ImportBorrowers": ImportBorrowers,
    "ImportDisbursements": ImportDisbursements,
    "ImportHistoricalDisbursements": ImportHistoricalDisbursements,
    "ImportExpenses": ImportExpenses,
    "ImportInvestors": ImportInvestors,
    "ImportInvestorTransactions": ImportInvestorTransactions,
    "ImportLoandisc": ImportLoandisc,
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
    "BankReconciliation2": BankReconciliation2,
    "BankReconciliationV2": BankReconciliationV2,
    "OtherIncome": OtherIncome,
    "OrphanedEntries": OrphanedEntries,
    "Receipts": Receipts,
    "About": About,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};