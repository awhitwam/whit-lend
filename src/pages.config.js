import Dashboard from './pages/Dashboard';
import Borrowers from './pages/Borrowers';
import BorrowerDetails from './pages/BorrowerDetails';
import Loans from './pages/Loans';
import NewLoan from './pages/NewLoan';
import LoanDetails from './pages/LoanDetails';
import Products from './pages/Products';
import Expenses from './pages/Expenses';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Borrowers": Borrowers,
    "BorrowerDetails": BorrowerDetails,
    "Loans": Loans,
    "NewLoan": NewLoan,
    "LoanDetails": LoanDetails,
    "Products": Products,
    "Expenses": Expenses,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};