# Fello DCR — Repository Rules

## Architecture
- **Vanilla Web Stack:** Pure HTML5 + CSS3 + JavaScript (IIFE wrapped, `'use strict'`)
- **Zero Dependencies:** No npm, no bundler, no framework. Served as static files.
- **Hosting:** GitHub Pages at `https://dano-27.github.io/fello-dcr/`
- **Repo must stay public** for free-tier GitHub Pages hosting

## Branching & Deployment
- Branch: `FCCV-<ticket>` off `main`, targeting `main`
- Merge to `main` → GitHub Pages auto-deploys
- **Deployment order:** If DCR changes depend on new Command Center endpoints, the CC PR must merge and deploy to Railway first (~45s). Only then merge DCR to Pages. Otherwise public users get 401/502.

## File Structure
| File | Purpose |
|------|--------|
| `index.html` | Complete form structure — all steps, modes, and UI |
| `index.css` | Full design system — CSS variables, components, responsive breakpoints |
| `app.js` | All form logic — navigation, validation, API calls, submission |
| `fello-logo.svg` | Brand logo |
| `google-apps-script.js` | Google Sheets fallback receiver (deployed separately) |

## Legacy Naming: CMI → DCR
- Internal legacy name is **CMI** ("Custom Media Installation")
- CSS classes use `.cmi-*` prefix (`.cmi-step`, `.cmi-btn`, `.cmi-input`, `.cmi-card`)
- localStorage key: `fello_cmi_draft_v2`
- **Do NOT rename** existing `.cmi-*` classes — they're deeply entangled across 3 files

## API Integration
- All API calls go through the Command Center: `https://fellostarlinkcommandcenter-production.up.railway.app`
- See the `dcr-conventions` skill for detailed endpoint documentation

## Brand System
- Font: Montserrat (Google Fonts)
- Primary CTA: `#fcd230` (Fello Yellow)
- CSS variables: `--cmi-*` for colors, `--sp-*` for spacing (4px scale), `--fs-*` for typography, `--radius-*` for corners
- Light theme with white backgrounds and subtle borders

## No CI/CD Pipeline
- No GitHub Actions workflows
- No linters, formatters, or type checkers
- Quality is maintained through manual review and Cypress tests in the CC repo
