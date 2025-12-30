import BorrowerDetails from './pages/BorrowerDetails';
import Borrowers from './pages/Borrowers';
import BorrowersByContact from './pages/BorrowersByContact';
import Config from './pages/Config';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import ImportBorrowers from './pages/ImportBorrowers';
import ImportLoandisc from './pages/ImportLoandisc';
import ImportTransactions from './pages/ImportTransactions';
import InvestorDetails from './pages/InvestorDetails';
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
import __Layout from './Layout.jsx';


export const PAGES = {
    "BorrowerDetails": BorrowerDetails,
    "Borrowers": Borrowers,
    "BorrowersByContact": BorrowersByContact,
    "Config": Config,
    "Dashboard": Dashboard,
    "Expenses": Expenses,
    "ImportBorrowers": ImportBorrowers,
    "ImportLoandisc": ImportLoandisc,
    "ImportTransactions": ImportTransactions,
    "InvestorDetails": InvestorDetails,
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
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};