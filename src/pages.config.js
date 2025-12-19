import Dashboard from './pages/Dashboard';
import Borrowers from './pages/Borrowers';
import BorrowerDetails from './pages/BorrowerDetails';
import Loans from './pages/Loans';
import NewLoan from './pages/NewLoan';
import LoanDetails from './pages/LoanDetails';
import Products from './pages/Products';


export const PAGES = {
    "Dashboard": Dashboard,
    "Borrowers": Borrowers,
    "BorrowerDetails": BorrowerDetails,
    "Loans": Loans,
    "NewLoan": NewLoan,
    "LoanDetails": LoanDetails,
    "Products": Products,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
};