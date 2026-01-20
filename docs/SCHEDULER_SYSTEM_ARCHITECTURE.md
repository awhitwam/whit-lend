# Scheduler System Architecture

**Last Updated:** January 2025

This document explains the plugin-based scheduler system that controls how loan schedules are generated and displayed in WhitLend.

---

## Table of Contents

1. [Overview](#overview)
2. [Key Files](#key-files)
3. [Self-Registration Pattern](#self-registration-pattern)
4. [Registry Functions](#registry-functions)
5. [BaseScheduler Class](#basescheduler-class)
6. [View Selection Flow](#view-selection-flow)
7. [Registered Schedulers](#registered-schedulers)
8. [InterestOnlyScheduleView Component](#interestonlyscheduleview-component)
9. [Why RepaymentScheduleTable is a "Dispatcher"](#why-repaymentscheduletable-is-a-dispatcher)
10. [Adding a New Scheduler](#adding-a-new-scheduler-with-custom-view)
11. [Circular Import Avoidance](#circular-import-avoidance)

---

## Overview

The scheduler system is a **plugin-based architecture** where each loan type can have its own:

1. **Schedule generation logic** - How interest and principal are calculated each period
2. **Custom view component** - How the schedule is displayed to users in the UI

This allows new loan types to be added without modifying core rendering logic. Each scheduler can optionally provide a custom React component for rendering, or fall back to the default table view.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/schedule/registry.js` | Central registry - stores all schedulers in a `Map` |
| `src/lib/schedule/BaseScheduler.js` | Abstract base class with `ViewComponent` property |
| `src/lib/schedule/schedulers/*.js` | Individual scheduler implementations |
| `src/lib/schedule/schedulers/index.js` | Auto-imports all schedulers to trigger registration |
| `src/components/loan/RepaymentScheduleTable.jsx` | **View Dispatcher** - decides which view to render |
| `src/components/loan/InterestOnlyScheduleView.jsx` | Custom view for interest-only loans (~1500 lines) |
| `src/components/loan/RentScheduleView.jsx` | Custom view for rent/quarterly loans |

---

## Self-Registration Pattern

Schedulers register themselves automatically when imported. This pattern eliminates the need for a central configuration file.

```javascript
// In src/lib/schedule/schedulers/InterestOnlyScheduler.js

import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import InterestOnlyScheduleView from '@/components/loan/InterestOnlyScheduleView';

export class InterestOnlyScheduler extends BaseScheduler {
  static id = 'interest_only';
  static displayName = 'Interest-Only (Balloon)';
  static description = 'Interest payments each period, principal balloon at end';
  static category = 'interest-only';
  static ViewComponent = InterestOnlyScheduleView;  // Custom view!

  async generateSchedule({ loan, product, options }) {
    // ... schedule generation logic
  }
}

// Auto-registers when this file is imported
registerScheduler(InterestOnlyScheduler);
```

The registry maintains a `Map<string, SchedulerClass>`:
- **Key:** Scheduler ID (e.g., `'interest_only'`)
- **Value:** The scheduler class itself (not an instance)

All scheduler files are imported in `src/lib/schedule/schedulers/index.js`, which triggers registration at app startup.

---

## Registry Functions

**Location:** `src/lib/schedule/registry.js`

| Function | Purpose | Returns |
|----------|---------|---------|
| `registerScheduler(Class)` | Add a scheduler to the registry | `void` |
| `getScheduler(id)` | Get scheduler class by ID | `Class \| undefined` |
| `getAllSchedulers()` | Get metadata for all schedulers (for dropdowns) | `Array<Object>` |
| `getSchedulersByCategory(cat)` | Filter by category | `Array<Object>` |
| `createScheduler(id, config)` | Instantiate a scheduler with config | `Object \| null` |
| `hasScheduler(id)` | Check if scheduler exists | `boolean` |
| `listSchedulerIds()` | Debug: list all registered IDs | `Array<string>` |
| `getSchedulerCount()` | Get count of registered schedulers | `number` |

**Example usage:**

```javascript
import { getScheduler, getAllSchedulers } from '@/lib/schedule';

// Get a specific scheduler class
const SchedulerClass = getScheduler('interest_only');
const CustomView = SchedulerClass?.ViewComponent;

// Get all schedulers for a dropdown
const allSchedulers = getAllSchedulers();
// Returns: [{ id, displayName, description, category, ViewComponent, ... }, ...]
```

---

## BaseScheduler Class

**Location:** `src/lib/schedule/BaseScheduler.js`

All schedulers extend this base class. The key static properties are:

```javascript
class BaseScheduler {
  // === Identification ===
  static id = 'base';                    // Unique identifier (used in DB)
  static displayName = 'Base Scheduler'; // Human-readable name for UI
  static description = '...';            // Description shown in product config
  static category = 'standard';          // 'standard' | 'interest-only' | 'special'
  static generatesSchedule = true;       // false for irregular_income (no schedule)

  // === View Configuration ===
  static ViewComponent = null;           // ⭐ Custom view component (null = use default table)

  static displayConfig = {               // Customization for default table view
    showInterestColumn: true,
    showPrincipalColumn: true,
    interestColumnLabel: 'Interest',
    principalColumnLabel: 'Principal',
    showCalculationDetails: true
  };

  // === Product Configuration Schema ===
  static configSchema = {
    common: {
      period: { type: 'select', options: ['Monthly', 'Weekly'], default: 'Monthly' },
      interest_calculation_method: { type: 'select', options: ['daily', 'monthly'] },
      interest_paid_in_advance: { type: 'boolean', default: false }
    },
    specific: {
      // Scheduler-specific settings go here
    }
  };

  // === Required Methods (must be implemented by subclasses) ===
  async generateSchedule({ loan, product, options }) {
    throw new Error('Subclasses must implement generateSchedule()');
  }

  calculatePeriodInterest({ principal, annualRate, periodStart, periodEnd }) {
    throw new Error('Subclasses must implement calculatePeriodInterest()');
  }
}
```

**Important:** The `ViewComponent` static property is what enables custom schedule views. If `null`, the system uses the default `RepaymentScheduleTable` rendering.

---

## View Selection Flow

This is the core logic that decides which view component renders a loan's schedule.

**Location:** `src/components/loan/RepaymentScheduleTable.jsx` (lines 39-42, 1306-1325)

### Flow Diagram

```
Step 1: Product stores scheduler_type = 'interest_only' (in database)
        ↓
Step 2: RepaymentScheduleTable receives product prop
        ↓
Step 3: getScheduler('interest_only') → InterestOnlyScheduler class
        ↓
Step 4: CustomViewComponent = InterestOnlyScheduler.ViewComponent
        → Returns: InterestOnlyScheduleView component
        ↓
Step 5: Render decision in JSX:
        ├─ CustomViewComponent exists? → <CustomViewComponent ... />
        ├─ isRent fallback? → <RentScheduleView ... />
        └─ Default → Standard table (nested or ledger view)
```

### Code Implementation

```javascript
// RepaymentScheduleTable.jsx lines 39-42
const schedulerType = product?.scheduler_type;
const SchedulerClass = schedulerType ? getScheduler(schedulerType) : null;
const CustomViewComponent = SchedulerClass?.ViewComponent;

// Lines 1306-1325 (in the render)
return CustomViewComponent ? (
  // Scheduler provides a custom view component
  <div className="absolute inset-0 overflow-auto p-4">
    <CustomViewComponent
      schedule={schedule}
      transactions={transactions}
      loan={loan}
      product={product}
    />
  </div>
) : isRent ? (
  // Fallback for legacy rent products without scheduler_type
  <div className="absolute inset-0 overflow-auto p-4">
    <RentScheduleView
      schedule={schedule}
      transactions={transactions}
      loan={loan}
      product={product}
    />
  </div>
) : viewMode === 'nested' ? (
  // Standard nested table view
  <Table>...</Table>
) : (
  // Ledger/smart view
  ...
);
```

---

## Registered Schedulers

| Scheduler ID | Class | Category | ViewComponent | Description |
|--------------|-------|----------|---------------|-------------|
| `reducing_balance` | ReducingBalanceScheduler | standard | `null` (default) | Standard amortizing loan |
| `flat_rate` | FlatRateScheduler | standard | `null` (default) | Interest on original principal |
| `interest_only` | InterestOnlyScheduler | interest-only | **InterestOnlyScheduleView** | Interest payments, balloon at end |
| `rolled_up` | RolledUpScheduler | interest-only | `null` (default) | Interest compounds, balloon at end |
| `roll_up_serviced` | RollUpServicedScheduler | interest-only | **InterestOnlyScheduleView** | Roll-up then monthly serviced |
| `fixed_charge` | FixedChargeScheduler | special | `null` (default) | Fixed monthly fee |
| `irregular_income` | IrregularIncomeScheduler | special | `null` (default) | No schedule, ad-hoc repayments |
| `rent` | RentScheduler | special | **RentScheduleView** | Quarterly rent collection |

### Scheduler to View Component Mapping

| ViewComponent | Schedulers Using It |
|---------------|---------------------|
| **InterestOnlyScheduleView** | `interest_only`, `roll_up_serviced` |
| **RentScheduleView** | `rent` |
| **RepaymentScheduleTable** (default) | `reducing_balance`, `flat_rate`, `rolled_up`, `fixed_charge`, `irregular_income` |

**Note:** When modifying a view component, changes will affect all schedulers that use it. For example, changes to `InterestOnlyScheduleView.jsx` will affect both interest-only and roll-up-serviced loans.

---

## InterestOnlyScheduleView Component

**File:** `src/components/loan/InterestOnlyScheduleView.jsx` (~1500 lines)

**Purpose:** Provides a specialized "Reality vs Expectations" view for interest-only and "In Advance" loans.

### Visual Structure

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Date    │ Int Received │ Expected Int │ Int Balance │ Principal │ Prin Bal │ Notes │
├─────────┼──────────────┼──────────────┼─────────────┼───────────┼──────────┼───────┤
│ 01/01   │ -£500        │ £500         │ £0.00       │ +£100,000 │ £100,000 │ ...   │
│ 15/01   │ -£200        │ —            │ -£200.00    │ —         │ —        │ ...   │
│ 01/02   │ —            │ £493         │ £293.00     │ —         │ —        │ ...   │
│ TODAY   │ —            │ +£82 accrued │ £375.00     │ —         │ £100,000 │ 5d... │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Left columns (Reality)** | What actually happened (transactions from ledger) |
| **Right columns (Expectations)** | What's due based on the schedule |
| **Month grouping** | Collapsible month groups with summary totals |
| **TODAY marker** | Shows current position with accrued interest calculation |
| **Balance gauge** | Visual indicator (red = behind, green = ahead of schedule) |
| **Rate change rows** | Special rows displayed when penalty rates kick in |
| **Disbursement details** | Tooltips showing gross, deductions, and net amounts |

### Internal Components

| Component | Lines | Purpose |
|-----------|-------|---------|
| `buildTimeline()` | 24-346 | Merges transactions + schedule into unified timeline |
| `groupRowsByMonth()` | 353-475 | Groups timeline rows by calendar month |
| `MonthGroupRow` | 645-786 | Renders collapsible month header with totals |
| `TimelineRow` | 866-1184 | Renders individual row (transaction or schedule entry) |
| `TodayStandaloneRow` | 791-861 | Special row for current date with accrued interest |
| `TotalsRow` | 1189-1235 | Grand totals at bottom of table |
| `BalanceGauge` | ~500-600 | Visual gauge showing position vs monthly expected |

### Data Flow

```
Props: { loan, product, schedule, transactions }
        ↓
buildTimeline()
  - Adds disbursement rows
  - Adds repayment rows
  - Adds schedule entry rows (due dates)
  - Adds rate change rows (if penalty rate applies)
  - Inserts TODAY marker at correct position
  - Calculates running balances
        ↓
groupRowsByMonth()
  - Groups rows by calendar month
  - Calculates month-level totals
  - Handles special rows (TODAY, rate changes)
        ↓
Component State:
  - expandedMonths: Set<string> - which months are expanded
  - flatView: boolean - grouped vs flat display
  - sortOrder: 'asc' | 'desc' - oldest or newest first
        ↓
Render: Month groups with expandable child rows
```

---

## Why RepaymentScheduleTable is a "Dispatcher"

### Common Misconception

The name `RepaymentScheduleTable` suggests it renders a table. However, it's actually a **view dispatcher** that:

1. Reads `product.scheduler_type`
2. Looks up the scheduler class from the registry
3. Checks if the scheduler has a `ViewComponent`
4. Either delegates to the custom view OR renders its own default table

### When Confusion Happens

A developer might:
1. Want to change how "In Advance" loans display their schedule
2. Open `RepaymentScheduleTable.jsx` and make changes
3. Wonder why nothing changed in the UI

**The reason:** "In Advance" loans use `interest_only` scheduler, which has `ViewComponent = InterestOnlyScheduleView`. The changes need to be made in `InterestOnlyScheduleView.jsx` instead.

### Quick Reference

| Loan Type | Scheduler Type | View Used |
|-----------|----------------|-----------|
| Standard amortizing | `reducing_balance` | RepaymentScheduleTable (default) |
| Flat rate | `flat_rate` | RepaymentScheduleTable (default) |
| Interest-only | `interest_only` | **InterestOnlyScheduleView** |
| Interest-only (In Advance) | `interest_only` | **InterestOnlyScheduleView** |
| Rolled-up | `rolled_up` | RepaymentScheduleTable (default) |
| Fixed charge | `fixed_charge` | RepaymentScheduleTable (default) |
| Rent | `rent` | **RentScheduleView** |

---

## Adding a New Scheduler with Custom View

### Step 1: Create the Scheduler Class

```javascript
// src/lib/schedule/schedulers/MyNewScheduler.js

import { BaseScheduler } from '../BaseScheduler.js';
import { registerScheduler } from '../registry.js';
import MyNewScheduleView from '@/components/loan/MyNewScheduleView';

export class MyNewScheduler extends BaseScheduler {
  static id = 'my_new_type';
  static displayName = 'My New Loan Type';
  static description = 'Description for product configuration UI';
  static category = 'special';  // 'standard' | 'interest-only' | 'special'
  static ViewComponent = MyNewScheduleView;  // Custom view

  static configSchema = {
    common: BaseScheduler.configSchema.common,
    specific: {
      // Add any scheduler-specific config options
      myCustomOption: {
        type: 'boolean',
        default: false,
        label: 'Enable Custom Feature'
      }
    }
  };

  async generateSchedule({ loan, product, options }) {
    // Fetch transaction data
    const { transactions } = await this.fetchLoanData(loan.id);
    const principalState = this.calculatePrincipalState(transactions);

    // Build schedule entries
    const schedule = [];
    // ... your schedule generation logic

    // Save to database
    await this.saveSchedule(loan.id, schedule);

    // Calculate totals
    const summary = this.calculateSummary(schedule, principalState.currentOutstanding);

    return { loan, schedule, summary };
  }

  calculatePeriodInterest({ principal, annualRate, periodStart, periodEnd }) {
    // Your interest calculation logic
    const dailyRate = annualRate / 100 / 365;
    const days = differenceInDays(periodEnd, periodStart);
    return principal * dailyRate * days;
  }
}

// Auto-register when file is imported
registerScheduler(MyNewScheduler);
```

### Step 2: Create the View Component

```javascript
// src/components/loan/MyNewScheduleView.jsx

import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from './LoanCalculator';

export default function MyNewScheduleView({ loan, product, schedule, transactions }) {
  // Your custom rendering logic
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">My Custom Schedule View</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Amount</TableHead>
            {/* ... your columns */}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.map((row, idx) => (
            <TableRow key={idx}>
              <TableCell>{row.due_date}</TableCell>
              <TableCell>{formatCurrency(row.total_due)}</TableCell>
              {/* ... your cells */}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

### Step 3: Register the Import

```javascript
// src/lib/schedule/schedulers/index.js

// Add this line to import and auto-register your new scheduler
import './MyNewScheduler.js';
```

### Step 4: Done!

Products configured with `scheduler_type = 'my_new_type'` will now:
1. Use `MyNewScheduler.generateSchedule()` for schedule calculation
2. Display using `MyNewScheduleView` component

---

## Circular Import Avoidance

**Problem:** Scheduler files in `lib/` importing view components from `components/` can cause circular imports if those components import back from `lib/`.

### Solution 1: Direct Import (Simple Cases)

Works when the view component has no circular dependencies:

```javascript
// In scheduler file
import InterestOnlyScheduleView from '@/components/loan/InterestOnlyScheduleView';

export class InterestOnlyScheduler extends BaseScheduler {
  static ViewComponent = InterestOnlyScheduleView;
}
```

### Solution 2: Lazy Getter/Setter (Complex Cases)

For components with potential circular dependencies:

```javascript
// In RentScheduler.js
let RentScheduleViewComponent = null;

export class RentScheduler extends BaseScheduler {
  static get ViewComponent() {
    return RentScheduleViewComponent;
  }
  static set ViewComponent(component) {
    RentScheduleViewComponent = component;
  }
}

registerScheduler(RentScheduler);
```

```javascript
// At the end of RentScheduleView.jsx
import { RentScheduler } from '@/lib/schedule/schedulers/RentScheduler';

// Self-register the view component
RentScheduler.ViewComponent = RentScheduleView;
```

This pattern defers the assignment until after all modules have loaded, avoiding the circular dependency issue.

---

## Related Documentation

- [APPLICATION_ANALYSIS_REPORT.md](./APPLICATION_ANALYSIS_REPORT.md) - Overall application architecture
- [LoanCalculator.jsx](../src/components/loan/LoanCalculator.jsx) - Interest calculation functions
- [LoanScheduleManager.jsx](../src/components/loan/LoanScheduleManager.jsx) - Schedule generation orchestration
