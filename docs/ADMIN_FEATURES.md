# Admin Features Documentation

Technical documentation for Super Admin and Organization Admin functionality.

---

## 1. ACCESS LEVELS

### 1.1 Role Hierarchy

| Role | Scope | Description |
|------|-------|-------------|
| Super Admin | System-wide | Cross-organization access, system management |
| Org Admin | Organization | Administrative functions for current org |
| Manager | Organization | Standard user with management permissions |
| Viewer | Organization | Read-only access |

### 1.2 How Roles are Determined

**Super Admin:**
- Stored in `user_profiles.is_super_admin` boolean
- Checked via `useAuth().isSuperAdmin`
- Grants access to `/super-admin` page

**Organization Admin:**
- Stored in `organization_members.role = 'Admin'`
- Checked via `useOrganization().canAdmin()`
- Grants access to `/org-admin` page

---

## 2. SUPER ADMIN (`/super-admin`)

### 2.1 Location
- Page: `src/pages/SuperAdmin.jsx`
- Route: `/super-admin`
- Access: `is_super_admin = true` only

### 2.2 Features

#### Users Tab
- View all users across all organizations
- Search users by name or email
- Manage user organization memberships
- Grant/revoke Super Admin status
- Add users to organizations with role selection

#### Organizations Tab
- View all organizations in system
- See member counts and admin counts
- View creation dates

#### Nightly Jobs Tab
- **Post Investor Interest**: Run daily interest posting for all investors
- **Update Loan Schedules**: Update overdue/partial status on schedule entries
- **Recalculate Balances**: Reconcile investor balances against transactions
- **Run All Nightly Jobs**: Execute all jobs in sequence
- View recent job run history with status

### 2.3 RLS Policies for Super Admin

Super admins bypass organization-scoped RLS policies via:

```sql
-- Helper function (SECURITY DEFINER to avoid recursion)
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_super_admin = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Example policy
CREATE POLICY "Super admins can view all organizations" ON organizations
  FOR SELECT
  USING (is_super_admin());
```

**Tables with Super Admin policies:**
- `organizations` - View all
- `organization_members` - View/manage all memberships
- `user_profiles` - View/update all profiles

---

## 3. ORGANIZATION ADMIN (`/org-admin`)

### 3.1 Location
- Page: `src/pages/OrgAdmin.jsx`
- Route: `/org-admin`
- Access: Organization role = 'Admin'

### 3.2 Features

#### Create Organization
- Create new organizations
- Each organization has separate data, users, and settings

#### Loan Schedules Card
- **Regenerate All Loan Schedules**: Bulk regeneration for all Live and Closed loans
- Processes loans sequentially with progress reporting
- For Closed loans, regenerates up to settlement date
- Shows success/failure counts and error details

#### Danger Zone (Destructive Actions)

**Clear Expenses**
- Deletes all expense records
- Deletes all expense types/categories

**Clear Investor Data**
- Deletes all investor transactions
- Deletes all investor accounts
- Preserves investor products

**Clear Bank Reconciliation**
- Deletes reconciliation entries
- Deletes reconciliation patterns
- Deletes bank statements

**Clear All Data**
- Comprehensive deletion of all organization data
- Requires triple confirmation (confirm → type DELETE → confirm again)
- Deletes in FK-safe order:
  1. Audit logs
  2. Reconciliation entries/patterns
  3. Bank statements
  4. Value history
  5. Loan-property links
  6. Properties
  7. Transactions
  8. Repayment schedules
  9. Expenses
  10. Expense types
  11. Other income
  12. Investor interest records
  13. Investor transactions
  14. Loans (with restructure reference cleanup)
  15. Borrowers
  16. Investors
  17. Investor products

---

## 4. USER MANAGEMENT

### 4.1 Inviting Users

**Location:** Users page → Invite User dialog

**Flow:**
1. Admin enters email and selects role
2. System calls `invite-user` Edge Function
3. Edge Function:
   - Creates pending invitation in `organization_members`
   - Sends magic link email via Supabase Auth
4. User clicks magic link
5. User is redirected to `/accept-invitation?token=...`
6. AcceptInvitation page:
   - Validates token
   - Creates/links user account
   - Activates organization membership
   - Redirects to dashboard

### 4.2 Member Roles

| Role | Can View | Can Edit | Can Admin |
|------|----------|----------|-----------|
| Viewer | ✓ | - | - |
| Manager | ✓ | ✓ | - |
| Admin | ✓ | ✓ | ✓ |

---

## 5. MULTI-ORGANIZATION SUPPORT

### 5.1 Organization Switching

- Users can belong to multiple organizations
- Organization selector in top nav (Layout.jsx)
- Current organization stored in `OrganizationContext`
- All data queries scoped via `organization_id` filter

### 5.2 Data Isolation

Every organization has isolated:
- Borrowers
- Loans
- Transactions
- Investors
- Expenses
- Bank statements
- Audit logs

### 5.3 RLS Implementation

All tables include organization-scoped policies:

```sql
CREATE POLICY "Users can view own org data" ON loans
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
```

---

## 6. KEY SOURCE FILES

| File | Purpose |
|------|---------|
| `src/pages/SuperAdmin.jsx` | Super Admin UI and logic |
| `src/pages/OrgAdmin.jsx` | Organization Admin UI and logic |
| `src/pages/Users.jsx` | User management within organization |
| `src/lib/AuthContext.jsx` | Authentication state, `isSuperAdmin` check |
| `src/lib/OrganizationContext.jsx` | Organization state, `canAdmin()` check |
| `src/components/organization/InviteUserDialog.jsx` | User invitation UI |
| `supabase/functions/invite-user/index.ts` | User invitation Edge Function |
| `supabase/migrations/039_super_admin.sql` | Super Admin user_profiles migration |
| `supabase/migrations/040_super_admin_rls_policies.sql` | Super Admin RLS policies |

---

*Last updated: January 2026*
