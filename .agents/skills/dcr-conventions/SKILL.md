---
name: dcr-conventions
description: >-
  Use this skill when working on the Device Configuration Request form or
  any Command Center endpoint that the DCR calls. Documents the form architecture,
  navigation system, API contracts, partner routing, and state management.
---

# DCR Conventions — Device Configuration Request Form

## Form Architecture

### IIFE-Wrapped Controller (`app.js`)
All form logic is in a single IIFE:
```javascript
(() => { 'use strict';
  // DOM utilities
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  // ... all logic
})();
```

### Centralized DOM Object
Frequently accessed elements are cached in a `dom` getter object:
```javascript
const dom = {
  get orderInput() { return $('#order-number'); },
  get nextBtn() { return $('#next-btn'); },
  // ...
};
```

## Multi-Step Wizard Navigation

### Navigation Chains
The form uses ordered step ID arrays to control wizard flow:

```javascript
// Custom (full) configuration flow
const CUSTOM_CHAIN = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-6'];

// Package preset flows (streamlined)
const PACKAGE_CHAINS = {
  'pkg-registration': ['step-1', 'pkg-registration', 'step-6'],
  'pkg-leadcapture':  ['step-1', 'pkg-leadcapture', 'step-6'],
  'pkg-pos':          ['step-1', 'pkg-pos', 'step-6'],
  'pkg-kiosk':        ['step-1', 'pkg-kiosk', 'step-6'],
};
```

### Dynamic Device-Group Steps
If an order includes non-iPad hardware, extra steps are dynamically spliced into `navChain` before Review (`step-6`):
- **Laptops** → `group-laptop`
- **POS terminals** (Square Register/Terminal) → `group-pos`
- **Networking gear** (Starlink, Cradlepoint, MiFi) → `group-networking`

### Navigation Labels
Human-readable labels track wizard progress:
```javascript
const CUSTOM_LABELS = ['Order Lookup', 'Device Setup', 'Apps & Layout', 'Network & Security', 'Lockdown & Media', 'Review & Submit'];
```

## Configuration Modes

| Mode | Step Chain | Use Case |
|------|-----------|----------|
| Quick Setup | Partner-dependent | Auto-configured from partner app presets |
| POS Mode | `pkg-pos` | Square, Toast, Shopify, Lightspeed |
| Check-in Mode | `pkg-registration` | Eventbrite, Cvent, Swoogo, RSVPify |
| Kiosk Mode | `pkg-kiosk` | Surveys, digital signage, guided access |
| Lead Capture Mode | `pkg-leadcapture` | iCapture, Leadature, CompuLead |
| Custom Configuration | `CUSTOM_CHAIN` | Full manual configuration |

## Partner Source Routing

The `site_source` field from the order determines partner presets:

| Code | Partner | Behavior |
|------|---------|----------|
| `SQ` | Square | Auto-loads Square POS app, free WiFi |
| `SH` | Shopify | Auto-loads Shopify POS app |
| `TO` | Toast | Auto-loads Toast TakeOut & Ordering |
| `CB` | GiveSmart (Community Brands) | Auto-loads GiveSmart app |
| `EB` | Eventbrite | Auto-loads Eventbrite Organizer |
| `TA` / `MO` | Tassel | Auto-loads Tassel app |
| `LE` | Levy | Auto-loads Levy POS app |
| `FE` | Fello (direct) | No auto-presets |

Partner orders skip manual device configuration and use a streamlined "Partner Submit" flow.

## API Contract

### Command Center Base URL
```javascript
const COMMAND_CENTER_URL = 'https://fellostarlinkcommandcenter-production.up.railway.app';
```

### 1. Order Lookup
```
GET /api/public/dcr/order/{orderNumber}
Auth: None (public proxy)
Rate limit: 10 requests / 15 min / IP → 429 with Retry-After
Valid formats: /^(FE|OR|SQ|SH|TO|CB|EB|TA|MO|LE)\d+$/i
```

**Response shape:**
```json
{
  "fly_order_id": "OR12345",
  "customer_name": "...",
  "event_name": "...",
  "event_venue": "...",
  "start_date": "2026-10-15",
  "end_date": "2026-10-18",
  "ship_name": "...", "ship_email": "...", "ship_phone": "...",
  "main_contact_email": "...",
  "site_source": "SQ",
  "rentals": [
    { "amount": 5, "model": { "model_name": "iPad 9th Gen", "model_category": 1, "operating_system": "iOS" } }
  ]
}
```

### 2. Form Submission
```
POST /api/dcr/submit
Content-Type: application/json
Auth: None (public, but rate-limited)
```

**Key payload fields:**
`orderNumber`, `eventName`, `eventDates`, `venue`, `contactName`, `company`, `email`, `phone`, `configMode`, `apps[]`, `appLinks[]`, `allAppsAllDevices`, `homeScreenLayout`, `wifiEnabled`, `wifiSsid`, `wifiPassword`, `wifiSecurity`, `lockdownMode`, `guidedAccessPasscode`, `webClips[]`, `webClipUrls[]`, `additionalComments`

**Response statuses:**
| Status | Meaning |
|--------|--------|
| `pending_review` | Validated; team will review and provision |
| `submitted` | Received; verifying order details |
| `rejected` | Failed validation — check order number |
| `success` | Generic confirmation |

### 3. Attachment Upload
```
POST /api/dcr/{submissionId}/upload
Content-Type: multipart/form-data
Fields: files (binary), categories (wallpaper|vpn_profile|config_profile|credentials|media)
```

### 4. Google Sheets Fallback
A secondary `no-cors` POST to Google Apps Script captures submissions as a backup spreadsheet row. This is a **fire-and-forget** fallback — the primary path always goes through CC.

### 5. iTunes App Search
```
GET https://itunes.apple.com/search?term={query}&entity=software&limit=8&country=US
Auth: None (public Apple API)
```
Used client-side to search and select apps with official icons and App Store URLs.

## State Persistence

### Auto-Save to localStorage
All form inputs auto-save with a 1-second debounce:
```javascript
const AUTOSAVE_DELAY = 1000;
// Key: 'fello_cmi_draft_v2'
// Restores automatically on page load
```

### File Uploads
Maintained in an in-memory `Map` keyed by field ID (`uploadedFiles`). Not persisted to localStorage.

## CSS Design System Variables

```css
/* Colors */
--cmi-yellow: #fcd230;      /* Primary CTA */
--cmi-orange: #f59231;       /* Secondary accent */
--cmi-blue: #3166ae;         /* Info, links */
--cmi-green: #05ac3f;        /* Success */
--cmi-red: #ff4d41;          /* Error */

/* Spacing (4px scale) */
--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; ...

/* Typography */
--fs-sm: 0.875rem; --fs-base: 1rem; --fs-lg: 1.125rem; ...

/* Radii */
--radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-pill: 40px;
```

All component classes are prefixed with `.cmi-` (e.g., `.cmi-step`, `.cmi-btn`, `.cmi-input`, `.cmi-card`, `.cmi-progress-*`).
