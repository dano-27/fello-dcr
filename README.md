# Fello Device Configuration Request (DCR)

A premium web-based form tool for configuring iPad, iPhone, hotspot, and mobile router setups for events. Built by [Fello](https://events.fello.com) to streamline the Custom Media Installation (CMI) process between clients and the Fello operations team.

## Overview

The Device Configuration Request form guides clients through a structured, multi-step wizard to specify exactly how their rented devices should be configured — from app installations and network settings to display preferences and security controls.

### Configuration Modes

| Mode | Use Case |
|------|----------|
| **POS Mode** | Square, Toast, Shopify, Lightspeed, Stripe, and other point-of-sale systems |
| **Check-in Mode** | Eventbrite, Cvent, Swoogo, Splash, RSVPify, and other registration/check-in apps |
| **Kiosk Mode** | Surveys, digital signage, self-service stations with guided access lockdown |
| **Lead Capture Mode** | iCapture, Leadature, CompuLead, and other trade show lead capture tools |
| **Custom Configuration** | Full manual configuration with granular control over every setting |

### Features

- **Smart App Search** — Search and select from a curated database of 100+ event, POS, and lead capture apps
- **Conditional Logic** — Form sections dynamically show/hide based on selections (Wi-Fi, guided access, app login, etc.)
- **Real-Time Cost Estimation** — Automatic per-device fee calculation as premium options are toggled
- **Home Screen Layout Options** — Standard, Single App, or Custom layout with description field
- **Device Lockdown** — Choose between Single App Mode or Guided Access for kiosk deployments
- **Wi-Fi Pre-Configuration** — Pre-load network credentials with support for WPA2/WPA3 security types
- **Review Summary** — Collapsible accordion review of all selections before submission
- **Auto-Save** — Form progress is saved to localStorage and restored on return
- **Responsive Design** — Works on desktop, tablet, and mobile

## Tech Stack

- **HTML5** — Semantic, accessible markup
- **CSS3** — Custom design system with CSS variables, animations, and responsive breakpoints
- **Vanilla JavaScript** — Zero dependencies, no framework required
- **Google Fonts** — Montserrat typeface
- **Font Awesome 6** — Icon library

## Getting Started

### View Live
Visit the GitHub Pages deployment:
**[https://dano-27.github.io/fello-dcr/](https://dano-27.github.io/fello-dcr/)**

### Run Locally

```bash
git clone https://github.com/dano-27/fello-dcr.git
cd fello-dcr
python3 -m http.server 3000
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
fello-dcr/
├── index.html        # Main form structure (all steps and modes)
├── index.css         # Complete design system and component styles
├── app.js            # Form logic, navigation, validation, and submission
└── fello-logo.svg    # Fello brand logo
```

## Brand

The tool follows the [Fello brand guidelines](https://events.fello.com) with:

- **Primary CTA**: `#fcd230` (Fello Yellow)
- **Secondary Accent**: `#f59231` (Fello Orange)
- **Typography**: Montserrat
- **Light mode** design with clean whites, subtle borders, and warm accents

## License

Internal tool — proprietary to Fello.
