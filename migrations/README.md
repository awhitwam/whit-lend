# Database Migration Instructions

This folder contains SQL scripts to add multi-tenancy support to WhitLend.

## ⚠️ IMPORTANT - Before You Start

1. **Backup your database** - Use Supabase dashboard to create a backup
2. **Test in development first** - Create a test project in Supabase and run there
3. **Review the scripts** - Read through both SQL files to understand what changes will be made

## Migration Order

Run the scripts in this exact order:

### 1. `001_add_multi_tenancy.sql`
Creates the multi-tenancy schema:
- New tables: `organizations`, `organization_members`, `invitations`, `user_profiles`
- Adds `organization_id` column to all existing entity tables
- Creates your first organization from existing data
- Backfills all existing records with the first organization's ID
- Creates indexes for performance

**What this does:**
- All your existing data will belong to "Default Organization"
- The first user in your database becomes an Admin
- All existing loans, borrowers, etc. are assigned to this organization

### 2. `002_add_rls_policies.sql`
Enables Row Level Security (RLS):
- Enables RLS on all tables
- Creates policies to enforce data isolation
- Implements role-based permissions (Viewer, Manager, Admin)

**What this does:**
- Users can only see data from organizations they belong to
- Viewers can read data
- Managers can create and edit data
- Admins have full control

## How to Run

### Step 1: Open Supabase SQL Editor
1. Go to your Supabase project dashboard
2. Click on "SQL Editor" in the left sidebar
3. Click "New query"

### Step 2: Run First Migration
1. Copy the entire content of `001_add_multi_tenancy.sql`
2. Paste into the SQL Editor
3. Click "Run" (or press Ctrl/Cmd + Enter)
4. **Check for errors** - Read the output messages
5. **Verify success** - You should see messages about:
   - Created organization with ID
   - Added user as Admin
   - Backfilled all existing data

### Step 3: Verify Data
Run these verification queries to ensure migration worked:

```sql
-- Check organization was created
SELECT * FROM organizations;

-- Check you're a member
SELECT * FROM organization_members;

-- Check existing data has organization_id
SELECT COUNT(*) FROM borrowers WHERE organization_id IS NOT NULL;
SELECT COUNT(*) FROM loans WHERE organization_id IS NOT NULL;
```

All counts should match your existing data.

### Step 4: Run Second Migration
1. Copy the entire content of `002_add_rls_policies.sql`
2. Paste into a new query in SQL Editor
3. Click "Run"
4. **Check for errors**

### Step 5: Test RLS
Try querying your data to ensure RLS is working:

```sql
-- This should return only your organization's data
SELECT * FROM loans LIMIT 5;
SELECT * FROM borrowers LIMIT 5;
```

## Rollback Plan

If something goes wrong:

### Option 1: Restore from Backup
1. Go to Supabase dashboard → Settings → Backups
2. Restore from the backup you created before migration

### Option 2: Manual Rollback
```sql
-- Disable RLS (temporary fix to restore access)
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE borrowers DISABLE ROW LEVEL SECURITY;
ALTER TABLE loans DISABLE ROW LEVEL SECURITY;
-- ... repeat for all tables

-- Then restore from backup or manually remove changes
```

## Post-Migration

After successful migration:

1. **Test the application** - Log in and verify you can see your data
2. **Deploy the frontend code** - The React app needs updates to work with multi-tenancy
3. **Invite users** - Use the new invitation system to add team members

## Troubleshooting

### "No users found in the database"
- Make sure you have at least one user in `auth.users` table
- Create a user account first if needed

### "Permission denied" errors
- RLS policies might be too restrictive
- Check you're logged in as the user who was made admin
- Verify `organization_members` table has your user correctly

### Data not visible after migration
- Check RLS policies are correct
- Ensure `organization_id` was backfilled properly
- Verify user is a member of the organization

## Support

If you encounter issues:
1. Check the error messages carefully
2. Review the verification queries
3. Consult the main implementation plan in the project root

## Next Steps

After running these migrations successfully:
1. Update your React application with the OrganizationContext provider
2. Test the multi-tenancy features
3. Invite additional users to your organization
