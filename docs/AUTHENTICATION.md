# Authentication & MFA Documentation

Technical documentation for authentication flows and Multi-Factor Authentication (MFA).

---

## 1. AUTHENTICATION OVERVIEW

### 1.1 Technologies

- **Supabase Auth**: Core authentication provider
- **TOTP MFA**: Time-based One-Time Password (authenticator apps)
- **Magic Links**: Email-based passwordless login
- **Trusted Devices**: Device remembering for MFA

### 1.2 Auth Flow Summary

```
User → Login Page
        ↓
   Email/Password OR Magic Link
        ↓
   Check MFA enrollment
        ↓
   ┌─ MFA Required? ─────────────────┐
   │ YES: → MFA Verify Page          │
   │       → Check trusted device    │
   │       → Enter TOTP code         │
   │                                 │
   │ NO:  → Dashboard                │
   └─────────────────────────────────┘
```

---

## 2. LOGIN FLOW

### 2.1 Location
- Page: `src/pages/Login.jsx`
- Route: `/login`

### 2.2 Login Options

**Email/Password:**
```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});
```

**Magic Link:**
```javascript
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: `${window.location.origin}/`
  }
});
```

### 2.3 Post-Login Flow

After successful login:
1. Check if MFA is enrolled (`mfa_verified` in user_profiles)
2. If MFA enabled → Redirect to `/mfa-verify`
3. If MFA not enabled → Redirect to dashboard

---

## 3. MULTI-FACTOR AUTHENTICATION (MFA)

### 3.1 MFA Setup

**Location:** `src/pages/MFASetup.jsx`
**Route:** `/mfa-setup`

**Setup Flow:**
1. User navigates to MFA setup (from account settings)
2. System calls `supabase.auth.mfa.enroll({ factorType: 'totp' })`
3. QR code displayed with TOTP secret
4. User scans with authenticator app (Google Authenticator, Authy, etc.)
5. User enters verification code
6. System calls `supabase.auth.mfa.challenge()` and `verify()`
7. On success, updates `user_profiles.mfa_verified = true`

### 3.2 MFA Verification

**Location:** `src/pages/MFAVerify.jsx`
**Route:** `/mfa-verify`

**Verification Flow:**
1. Check for existing trusted device (browser fingerprint)
2. If trusted → Skip MFA, redirect to dashboard
3. If not trusted:
   - Display TOTP input
   - User enters 6-digit code from authenticator
   - System verifies via `supabase.auth.mfa.verify()`
4. Option to "Trust this device" for 30 days

### 3.3 TOTP Details

- **Algorithm:** TOTP (RFC 6238)
- **Code Length:** 6 digits
- **Time Step:** 30 seconds
- **Issuer:** Configured in Supabase
- **Apps:** Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.

---

## 4. TRUSTED DEVICES

### 4.1 Purpose

Allow users to skip MFA verification on recognized devices for a configured period.

### 4.2 Database Schema

```sql
CREATE TABLE trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, device_fingerprint)
);
```

### 4.3 Device Fingerprinting

Fingerprint components:
- User agent string
- Screen resolution
- Timezone
- Browser language
- Platform

```javascript
const getDeviceFingerprint = () => {
  const components = [
    navigator.userAgent,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.platform
  ];
  // SHA-256 hash of components
  return sha256(components.join('|'));
};
```

### 4.4 Trust Duration

- Default: 30 days
- Configurable per-device
- Automatically expired on logout (optional)

---

## 5. USER INVITATION FLOW

### 5.1 Invitation Process

**Admin Side:**
1. Admin opens Invite User dialog
2. Enters email and selects role
3. Clicks "Send Invitation"

**System Side:**
1. Edge Function `invite-user` called
2. Creates pending `organization_members` record
3. Generates magic link with invitation token
4. Sends invitation email

**User Side:**
1. User receives email with magic link
2. Clicks link → redirected to `/accept-invitation?token=...`
3. AcceptInvitation page validates token
4. If existing user → Links to organization
5. If new user → Creates account, then links
6. Sets `organization_members.is_active = true`
7. Redirects to dashboard

### 5.2 Invitation Edge Function

**Location:** `supabase/functions/invite-user/index.ts`

```typescript
// Creates pending membership
await supabase.from('organization_members').insert({
  user_id: inviteeId,
  organization_id: organizationId,
  role: role,
  is_active: false  // Activated on acceptance
});

// Sends magic link
await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email: email,
  options: {
    redirectTo: `${origin}/accept-invitation`
  }
});
```

---

## 6. AUTH CONTEXT

### 6.1 Location
`src/lib/AuthContext.jsx`

### 6.2 Provided Values

```javascript
const AuthContext = {
  user,           // Current Supabase user
  userProfile,    // User profile from user_profiles table
  loading,        // Auth loading state
  isSuperAdmin,   // Boolean - is user a super admin
  mfaVerified,    // Boolean - has user completed MFA
  signOut,        // Sign out function
  refreshProfile  // Refresh user profile from DB
};
```

### 6.3 Usage

```javascript
import { useAuth } from '@/lib/AuthContext';

function Component() {
  const { user, isSuperAdmin, signOut } = useAuth();

  if (isSuperAdmin) {
    // Show admin features
  }
}
```

---

## 7. PROTECTED ROUTES

### 7.1 Route Protection

Routes are protected via:
1. `AuthContext` checks user state
2. Redirect to `/login` if not authenticated
3. Redirect to `/mfa-verify` if MFA required but not verified

### 7.2 Role-Based Access

```javascript
// In component
const { canAdmin } = useOrganization();

if (!canAdmin()) {
  return <AccessDenied />;
}
```

---

## 8. KEY SOURCE FILES

| File | Purpose |
|------|---------|
| `src/lib/AuthContext.jsx` | Auth state management |
| `src/pages/Login.jsx` | Login page UI |
| `src/pages/MFASetup.jsx` | MFA enrollment UI |
| `src/pages/MFAVerify.jsx` | MFA verification UI |
| `src/pages/AcceptInvitation.jsx` | Invitation acceptance |
| `src/components/auth/` | Auth-related components |
| `supabase/functions/invite-user/index.ts` | Invitation Edge Function |
| `supabase/migrations/038_trusted_devices.sql` | Trusted devices schema |

---

## 9. SECURITY CONSIDERATIONS

### 9.1 Session Management

- Sessions managed by Supabase Auth
- JWT tokens with configurable expiry
- Refresh tokens for session extension

### 9.2 Password Requirements

- Minimum length: Configured in Supabase dashboard
- Complexity rules: Configured in Supabase dashboard

### 9.3 Rate Limiting

- Login attempts: Supabase handles rate limiting
- MFA attempts: Limited to prevent brute force

### 9.4 Audit Logging

- Login events logged to `audit_logs` table
- MFA setup/verification logged
- Organization membership changes logged

---

*Last updated: January 2026*
