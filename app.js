/**
 * ══════════════════════════════════════════════════════════════════════════════
 * Fello CMI (Device Configuration Request) – app.js
 * Vanilla JS multi-step wizard form controller (6-Step Version)
 * ══════════════════════════════════════════════════════════════════════════════
 */

(() => {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS & CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  const STORAGE_KEY = 'fello_cmi_draft_v2';
  const TOTAL_STEPS = 6;
  const SUBMIT_ENDPOINT = '/api/cmi/submit';
  const MAX_FILE_SIZE_MEDIA = 10 * 1024 * 1024;   // 10 MB
  const MAX_FILE_SIZE_IMAGE = 2 * 1024 * 1024;     // 2 MB
  const AUTOSAVE_DELAY = 1000;                      // 1 second debounce
  const TOAST_DURATION = 4000;                      // 4 seconds

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  // currentStep replaced by navIndex (see navigation section)
  let autoSaveTimer = null;
  const uploadedFiles = new Map(); // keyed by field ID → File or File[]
  let enterpriseAppCounter = 0;   // tracks IDs for enterprise app entries

  // ═══════════════════════════════════════════════════════════════════════════
  // DOM REFERENCES
  // ═══════════════════════════════════════════════════════════════════════════

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const dom = {
    get steps()        { return $$('.cmi-step'); },
    get progressSteps(){ return $$('.cmi-progress-step'); },
    get progressFill() { return $('.cmi-progress-fill'); },
    get btnBack()      { return $('#btnBack'); },
    get btnNext()      { return $('#btnNext'); },
    get btnSubmit()    { return $('#btnSubmit'); },
    get toastContainer(){ return $('#toastContainer'); },
    get reviewSummary(){ return $('#reviewSummary'); },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. STEP NAVIGATION (Dual-Flow: Package vs Custom)
  // ═══════════════════════════════════════════════════════════════════════════

  // Navigation chains define the ordered section IDs for each flow
  const CUSTOM_CHAIN = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-6'];
  const CUSTOM_LABELS = ['Order Info', 'Apps', 'Branding', 'Security', 'Media', 'Review'];

  const PACKAGE_CHAINS = {
    'Check-in Mode': { chain: ['step-1', 'pkg-registration', 'step-6'], labels: ['Order Info', 'Configure', 'Review'] },
    'Lead Capture Mode': { chain: ['step-1', 'pkg-leadcapture', 'step-6'], labels: ['Order Info', 'Configure', 'Review'] },
    'POS Mode': { chain: ['step-1', 'pkg-pos', 'step-6'], labels: ['Order Info', 'Configure', 'Review'] },
    'Kiosk Mode': { chain: ['step-1', 'pkg-kiosk', 'step-6'], labels: ['Order Info', 'Configure', 'Review'] },
  };

  let navChain = CUSTOM_CHAIN;
  let navLabels = CUSTOM_LABELS;
  let navIndex = 0; // index into navChain
  let quickSubmitMode = false; // true when submitting via Quick Setup
  let isPartnerOrder = false;  // true for partner site sources (SQ, SH, etc.)

  const getActivePackage = () => $('input[name="configPackage"]:checked')?.value || '';

  /** Build nav chain appending POS/Networking steps if those groups exist */
  const buildGroupNavChain = (baseChain, baseLabels) => {
    const chain = [...baseChain];
    const labels = [...baseLabels];
    // Insert group steps before 'step-6' (Review)
    const reviewIdx = chain.indexOf('step-6');
    if (reviewIdx === -1) return { chain, labels };
    const insertAt = reviewIdx;
    if (window._dcrHasLaptop) {
      chain.splice(insertAt, 0, 'group-laptop');
      labels.splice(insertAt, 0, 'Laptops');
    }
    if (window._dcrHasPOS) {
      chain.splice(insertAt, 0, 'group-pos');
      labels.splice(insertAt, 0, 'POS');
    }
    if (window._dcrHasNet) {
      const netIdx = chain.indexOf('step-6');
      chain.splice(netIdx, 0, 'group-networking');
      labels.splice(netIdx, 0, 'Network');
    }
    return { chain, labels };
  };

  /** Rebuild the progress bar dots/labels for the current chain */
  const rebuildProgressBar = () => {
    const container = $('.cmi-progress-steps');
    if (!container) return;

    container.innerHTML = navLabels.map((label, i) => `
      <div class="cmi-progress-step${i === navIndex ? ' active' : (i < navIndex ? ' completed' : '')}" data-step="${i + 1}">
        <div class="cmi-progress-dot"><span>${i + 1}</span></div>
        <div class="cmi-progress-label">${label}</div>
      </div>
    `).join('');

    // Update fill bar
    const fillPercent = navIndex === 0 ? 0 : (navIndex / (navChain.length - 1)) * 100;
    if (dom.progressFill) dom.progressFill.style.width = `${fillPercent}%`;
  };

  /** Switch flow when package selection changes */
  const updateFlowForPackage = () => {
    const pkg = getActivePackage();
    const config = PACKAGE_CHAINS[pkg];

    let baseChain, baseLabels;
    if (config) {
      baseChain = config.chain;
      baseLabels = config.labels;
    } else {
      baseChain = CUSTOM_CHAIN;
      baseLabels = CUSTOM_LABELS;
    }

    // Append POS/Networking group steps if those device groups exist
    const built = buildGroupNavChain(baseChain, baseLabels);
    navChain = built.chain;
    navLabels = built.labels;

    // If we're still on step 1, just rebuild progress bar
    if (navIndex === 0) {
      rebuildProgressBar();
    }
  };

  const goToStep = (targetIndex, skipValidation = false) => {
    // Validate current step when moving forward
    if (targetIndex > navIndex && !skipValidation) {
      if (!validateStep(navChain[navIndex])) return;

      // If moving forward from step-1 in advanced mode, ensure config mode selected
      if (navChain[navIndex] === 'step-1' && !quickSubmitMode) {
        const advancedVisible = $('#advancedModeSelector')?.style.display !== 'none';
        if (advancedVisible && !getActivePackage()) {
          showToast('Please select a Configuration Mode.', 'error');
          $('#advancedModeSelector')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    }

    // Clamp target
    if (targetIndex < 0 || targetIndex >= navChain.length) return;

    navIndex = targetIndex;

    // Hide ALL sections (steps + packages)
    $$('.cmi-step').forEach(s => s.classList.remove('active'));

    // Show the active section
    const activeSectionId = navChain[navIndex];
    const activeSection = $(`#${activeSectionId}`);
    if (activeSection) activeSection.classList.add('active');

    // Update progress bar
    rebuildProgressBar();

    // Update nav buttons
    dom.btnBack.hidden = navIndex === 0;
    dom.btnNext.hidden = navIndex === navChain.length - 1;

    // Generate review on last step
    if (activeSectionId === 'step-6') {
      generateReview();
    }

    // Update naming preview on Step 5
    if (activeSectionId === 'step-5') {
      updateNamingPreview();
    }

    // Scroll to top of form
    $('.cmi-container').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Auto-save
    saveFormData();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. TOGGLES & CONDITIONALS
  // ═══════════════════════════════════════════════════════════════════════════

  const initToggles = () => {
    $$('.cmi-toggle-group').forEach(group => {
      const toggleKey = group.dataset.toggle;
      const buttons = $$('.cmi-toggle-btn', group);
      const contentEl = $(`[data-toggle-content="${toggleKey}"]`);

      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          // Update active state
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          // Show/hide conditional content
          if (contentEl) {
            const invert = contentEl.dataset.toggleInvert === 'true';
            const shouldOpen = invert ? btn.dataset.value === 'no' : btn.dataset.value === 'yes';
            if (shouldOpen) {
              contentEl.classList.add('open');
              contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
              // Re-measure after transition
              setTimeout(() => {
                if (contentEl.classList.contains('open')) {
                  contentEl.style.maxHeight = 'none';
                }
              }, 400);
            } else {
              contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
              contentEl.offsetHeight; // force reflow
              contentEl.style.maxHeight = '0';
              contentEl.classList.remove('open');
              clearValidationErrors(contentEl);
            }
          }

          triggerAutoSave();
        });
      });
    });
  };

  const getToggleValue = (toggleKey) => {
    const group = $(`[data-toggle="${toggleKey}"]`);
    if (!group) return null;
    const active = $('.cmi-toggle-btn.active', group);
    return active ? active.dataset.value : null;
  };

  const initRadioConditionals = () => {
    // Naming Convention Custom
    const namingRadios = $$('input[name="namingConvention"]');
    const customNamingContent = $('#customNamingContent');
    namingRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (!customNamingContent) return;
        if (radio.value === 'Custom Naming Convention') {
          customNamingContent.classList.add('open');
          customNamingContent.style.maxHeight = customNamingContent.scrollHeight + 'px';
          setTimeout(() => customNamingContent.style.maxHeight = 'none', 400);
        } else {
          customNamingContent.style.maxHeight = customNamingContent.scrollHeight + 'px';
          customNamingContent.offsetHeight;
          customNamingContent.style.maxHeight = '0';
          customNamingContent.classList.remove('open');
        }
        triggerAutoSave();
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ORDER LOOKUP
  // ═══════════════════════════════════════════════════════════════════════════

  const IMS_API_BASE = 'https://ims-v4-migration-prod-876702752852.us-east4.run.app/api/nextgen/v1';
  const IMS_API_TOKEN = 'Bearer 2423|rydhEvIv6ZsEABia67jH5ffhMUJLthtu3YrfySpx93f5cc0e';

  // Partner app presets (real iTunes data)
  const PARTNER_APPS = {
    'SQ': [
      { trackId: 335393788, name: 'Square Point of Sale (POS)', developer: 'Block, Inc.', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/ce/36/02/ce360217-c50d-779c-3f6b-280340952e14/AppIcon-0-0-1x_U007epad-0-1-85-220.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/square-point-of-sale-pos/id335393788', locked: true },
      { trackId: 1200091899, name: 'Square: Retail Point of Sale', developer: 'Block, Inc.', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ff/3d/b5/ff3db5b5-2719-2d0a-488a-92718637f1fe/RetailAppIcon-0-0-1x_U007epad-0-1-85-220.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/square-retail-point-of-sale/id1200091899', locked: true },
    ],
    'SH': [
      { trackId: 686830644, name: 'Shopify Point of Sale (POS)', developer: 'Shopify Inc.', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cd/6f/96/cd6f9685-43db-8d01-6417-874663d514a2/PosAppIcon-0-0-1x_U007epad-0-1-sRGB-85-220.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/shopify-point-of-sale-pos/id686830644', locked: true },
    ],
    'TO': [
      { trackId: 6444586410, name: 'Toast Now', developer: 'Toast, Inc.', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ed/d1/83/edd1833f-8e45-550c-2253-cec3f962fbfe/AppIcon-0-0-1x_U007ephone-0-1-0-sRGB-85-220.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/toast-now/id6444586410', locked: true },
    ],
    'CB': [
      { trackId: 966012143, name: 'GiveSmart Fundraise', developer: 'MobileCause Inc', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/9c/59/76/9c5976b0-251c-57e0-ca7b-8379ac2560c0/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/givesmart-fundraise/id966012143', locked: true },
    ],
    'EB': [
      { trackId: 487922291, name: 'Eventbrite', developer: 'Eventbrite', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/fc/66/1e/fc661e89-1364-9ba1-1aed-e2a37617344b/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/eventbrite/id487922291', locked: true },
      { trackId: 368260521, name: 'Eventbrite Organizer', developer: 'Eventbrite', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/0b/79/80/0b7980a8-8c95-e095-e2f6-cb629ba59e79/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/eventbrite-organizer/id368260521', locked: true },
    ],
    'TA': [
      { trackId: 991294851, name: 'Tassel Tickets', developer: 'Navona Investments', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/d8/6d/1a/d86d1a84-c7b4-2cf0-a354-41888adccdae/AppIcon-1x_U007emarketing-0-8-0-0-85-220-0.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/tassel-tickets/id991294851', locked: true },
    ],
    'MO': [
      { trackId: 991294851, name: 'Tassel Tickets', developer: 'Navona Investments', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/d8/6d/1a/d86d1a84-c7b4-2cf0-a354-41888adccdae/AppIcon-1x_U007emarketing-0-8-0-0-85-220-0.png/100x100bb.jpg', price: 'Free', url: 'https://apps.apple.com/us/app/tassel-tickets/id991294851', locked: true },
    ],
    'LE': [],
  };
  const PARTNER_SOURCES = new Set(['SQ', 'SH', 'TO', 'CB', 'EB', 'TA', 'MO', 'LE']);

  /** Activate partner mode: auto-add apps, show partner panel, hide quick setup */
  const activatePartnerMode = (siteSource, partnerLabel) => {
    const partnerSetup = $('#partnerSetup');
    const quickSetup = $('#quickSetup');
    const partnerAppsList = $('#partnerAppsList');
    if (!partnerSetup) return;

    isPartnerOrder = true;

    // Auto-add partner apps to selectedApps
    const apps = PARTNER_APPS[siteSource] || [];
    apps.forEach(app => {
      if (!selectedApps.some(a => a.trackId === app.trackId)) {
        selectedApps.push(app);
      }
    });

    // Render locked apps in the partner panel
    if (partnerAppsList) {
      partnerAppsList.innerHTML = apps.map(app => `
        <div class="cmi-selected-app locked" data-track-id="${app.trackId}">
          <img class="cmi-selected-app-icon" src="${app.icon}" alt="${escapeAttr(app.name)}" loading="lazy">
          <div class="cmi-selected-app-info">
            <div class="cmi-selected-app-name">${escapeHtml(app.name)} <span class="cmi-app-free-tag">Free</span></div>
            <div class="cmi-selected-app-developer">${escapeHtml(app.developer)}</div>
          </div>
        </div>
      `).join('');
    }

    // Update banner text
    const bannerTitle = $('#partnerBannerTitle');
    const bannerDesc = $('#partnerBannerDesc');
    if (bannerTitle) bannerTitle.textContent = `${partnerLabel} order detected`;
    if (bannerDesc) bannerDesc.textContent = `Standard ${partnerLabel} configuration will be applied with ${apps.length} partner app${apps.length !== 1 ? 's' : ''} pre-installed.`;

    // Show partner panel, hide quick setup
    partnerSetup.style.display = '';
    if (quickSetup) quickSetup.style.display = 'none';

    // Partner orders: Wi-Fi is free — remove "Additional Fee" tags from Wi-Fi tiles
    ['#posWifiToggle', '#netWifiToggle', '#laptopWifiToggle', '#partnerWifiToggle'].forEach(id => {
      const tile = $(id)?.closest('.cmi-quick-tile');
      if (tile) {
        const tag = tile.querySelector('.cmi-addon-tag');
        if (tag) tag.style.display = 'none';
      }
    });

    // Wire up partner tile toggles
    [
      { toggle: '#partnerWifiToggle', body: '#partnerWifiBody', tile: '#partnerTileWifi' },
      { toggle: '#partnerWallpaperToggle', body: '#partnerWallpaperBody', tile: '#partnerTileWallpaper' },
    ].forEach(({ toggle, body, tile }) => {
      const toggleEl = $(toggle);
      const bodyEl = $(body);
      const tileEl = $(tile);
      const headerEl = tileEl?.querySelector('.cmi-quick-tile-header');
      if (!toggleEl || !bodyEl || !tileEl) return;

      const update = () => {
        bodyEl.style.display = toggleEl.checked ? '' : 'none';
        tileEl.classList.toggle('active', toggleEl.checked);
      };
      toggleEl.addEventListener('change', update);
      headerEl?.addEventListener('click', (e) => {
        if (e.target.closest('.cmi-switch')) return;
        toggleEl.checked = !toggleEl.checked;
        toggleEl.dispatchEvent(new Event('change'));
      });
    });

    // Partner submit → walk through group steps then review
    $('#btnPartnerSubmit')?.addEventListener('click', () => {
      quickSubmitMode = true;
      const built = buildGroupNavChain(['step-1', 'step-6'], ['Order Info', 'Review']);
      navChain = built.chain;
      navLabels = built.labels;
      navIndex = 1;
      goToStep(1, true);
    });

    // Escape hatch → show full flow
    $('#btnPartnerFullCustom')?.addEventListener('click', () => {
      quickSubmitMode = false;
      partnerSetup.style.display = 'none';
      if (quickSetup) quickSetup.style.display = '';
      const advancedSelector = $('#advancedModeSelector');
      if (advancedSelector) {
        advancedSelector.style.display = '';
        advancedSelector.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    // Also render in main selectedApps list for review
    renderSelectedApps();
  };

  const initLookupOrder = () => {
    const btn = $('#btnLookup');
    const orderInput = $('#orderNumber');
    
    if (!btn || !orderInput) return;
    
    btn.addEventListener('click', async () => {
      const orderNumber = orderInput.value.trim();
      if (!orderNumber) {
        showToast('Please enter an order number first.', 'error');
        return;
      }
      
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Looking up...';
      btn.disabled = true;
      
      try {
        const resp = await fetch(`${IMS_API_BASE}/orders/${encodeURIComponent(orderNumber)}`, {
          headers: { 'Authorization': IMS_API_TOKEN }
        });

        if (resp.status === 404) {
          showToast(`Order "${orderNumber}" not found in IMS NextGen.`, 'error');
          btn.innerHTML = originalText;
          btn.disabled = false;
          return;
        }

        if (!resp.ok) {
          showToast(`IMS API error (${resp.status}). Please try again.`, 'error');
          btn.innerHTML = originalText;
          btn.disabled = false;
          return;
        }

        const raw = await resp.json();

        // Auto-fill form fields
        if (raw.event_name)      setFieldValue('#eventName', raw.event_name);
        if (raw.event_venue)     setFieldValue('#venueName', raw.event_venue);
        if (raw.customer_name)   setFieldValue('#companyName', raw.customer_name);
        if (raw.ship_name)       setFieldValue('#primaryContactName', raw.ship_name);
        if (raw.ship_email || raw.main_contact_email)
          setFieldValue('#contactEmail', raw.ship_email || raw.main_contact_email);
        if (raw.ship_phone || raw.customer_phone)
          setFieldValue('#contactPhone', raw.ship_phone || raw.customer_phone);

        // Build date range
        if (raw.start_date || raw.end_date) {
          const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const start = raw.start_date ? fmt(raw.start_date) : '';
          const end = raw.end_date ? fmt(raw.end_date) : '';
          setFieldValue('#eventDates', start && end ? `${start} - ${end}` : start || end);
        }
        // Site Source badge
        const siteSourceBadge = $('#siteSourceBadge');
        if (siteSourceBadge && raw.site_source) {
          const SOURCE_MAP = {
            'CB': { label: 'GiveSmart', key: 'givesmart' },
            'EB': { label: 'Eventbrite', key: 'eventbrite' },
            'FE': { label: 'Fello', key: 'fello' },
            'SH': { label: 'Shopify', key: 'shopify' },
            'SQ': { label: 'Square', key: 'square' },
            'TA': { label: 'Tassel', key: 'tassel' },
            'MO': { label: 'Tassel', key: 'tassel' },
            'LE': { label: 'Levy', key: 'levy' },
            'TO': { label: 'Toast', key: 'toast' },
            'or': { label: 'Fello', key: 'fello' },
            'OR': { label: 'Fello', key: 'fello' },
          };
          const src = SOURCE_MAP[raw.site_source] || { label: raw.site_source, key: 'other' };
          siteSourceBadge.textContent = src.label;
          siteSourceBadge.dataset.source = src.key;
          siteSourceBadge.hidden = false;

          // Activate partner mode if applicable
          if (PARTNER_SOURCES.has(raw.site_source)) {
            activatePartnerMode(raw.site_source, src.label);
          }
        }

        // Populate Device Info from rentals — categorized by group
        const DEVICE_GROUPS = {
          ios: new Set([
            'ipad 5th gen', 'ipad 6th gen', 'ipad 7th gen', 'ipad 8th gen', 'ipad 9th gen',
            'ipad mini 4th gen', 'ipad mini 5th gen', 'ipad mini 6th gen',
            'ipad pro 9.7', 'ipad pro 11', 'ipad pro 12.9', 'ipad pro 12.9" 2nd gen', 'ipad pro 13',
            'iphone se 2nd gen', 'iphone x',
            'test ipad 5th gen',
          ]),
          laptop: new Set(['basic laptop', 'lenovo e15 (gen 1)', 'dell latitude 3410', 'apple macbook pro',
                           'lenovo e16 i7 (13th gen)', 'microsoft surface pro (gen 7)', 'hp probook 840']),
          pos: new Set(['square register; us', 'square terminal; us', 'square handheld (us)', 'clover go']),
          networking: new Set(['mcc router', 'mobile hotspot', 'mobile hotspot; 5g', 'starlink receiver gen 3', 'starlink router gen 3']),
        };
        const GROUP_META = {
          ios: { label: 'iPads & iPhones', icon: 'fa-solid fa-tablet-screen-button', order: 1 },
          laptop: { label: 'Laptops', icon: 'fa-solid fa-laptop', order: 2 },
          pos: { label: 'POS Devices', icon: 'fa-solid fa-cash-register', order: 3 },
          networking: { label: 'Networking', icon: 'fa-solid fa-wifi', order: 4 },
        };

        // Categorize rentals
        const grouped = { ios: {}, laptop: {}, pos: {}, networking: {} };
        (raw.rentals || []).forEach(r => {
          const name = (r.model?.model_name || '').toLowerCase();
          const displayName = r.model?.model_name || 'Unknown';
          const qty = r.amount || 0;
          for (const [group, names] of Object.entries(DEVICE_GROUPS)) {
            if (names.has(name)) {
              grouped[group][displayName] = (grouped[group][displayName] || 0) + qty;
              break;
            }
          }
        });

        // Merge paired Starlink components into single "Starlink Gen 3"
        const net = grouped.networking;
        const slReceiver = net['Starlink Receiver Gen 3'] || 0;
        const slRouter = net['Starlink Router Gen 3'] || 0;
        if (slReceiver || slRouter) {
          delete net['Starlink Receiver Gen 3'];
          delete net['Starlink Router Gen 3'];
          net['Starlink Gen 3'] = Math.max(slReceiver, slRouter);
        }

        // Store for dynamic nav chain
        window._dcrGroups = grouped;

        const deviceDisplay = $('#deviceListDisplay');
        const activeGroups = Object.entries(grouped).filter(([, map]) => Object.keys(map).length > 0);

        if (deviceDisplay && activeGroups.length > 0) {
          const totalDevices = activeGroups.reduce((sum, [, map]) =>
            sum + Object.values(map).reduce((a, b) => a + b, 0), 0);
          deviceDisplay.dataset.totalDevices = totalDevices.toString();

          const groupHtml = activeGroups
            .sort(([a], [b]) => GROUP_META[a].order - GROUP_META[b].order)
            .map(([group, map]) => {
              const meta = GROUP_META[group];
              const items = Object.entries(map).map(([name, qty]) => `
                <li style="margin-bottom: 6px; padding-left: 8px;">
                  <i class="fa-solid fa-check" style="color: var(--cmi-success); margin-right: 8px;"></i>
                  ${qty}x ${escapeHtml(name)}
                </li>
              `).join('');
              return `
                <div style="margin-bottom: 16px;">
                  <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--cmi-text-secondary); margin-bottom: 8px;">
                    <i class="${meta.icon}" style="margin-right: 6px;"></i>${meta.label}
                  </div>
                  <ul style="list-style: none; padding: 0; margin: 0; font-weight: 500;">
                    ${items}
                  </ul>
                </div>
              `;
            }).join('');

          deviceDisplay.innerHTML = groupHtml;
        }

        // Recalculate app costs with new device count
        updateAppCostIndicator();

        // Build dynamic nav chain based on device groups present
        const hasIos = Object.keys(grouped.ios).length > 0;
        const hasLaptop = Object.keys(grouped.laptop).length > 0;
        const hasPOS = Object.keys(grouped.pos).length > 0;
        const hasNet = Object.keys(grouped.networking).length > 0;

        // Partner orders: only show pre-installed apps if iOS devices are present
        // POS devices (Square/Shopify/Toast) have built-in software
        if (isPartnerOrder && !hasIos) {
          const appsSection = document.querySelector('.cmi-partner-apps-section');
          if (appsSection) appsSection.style.display = 'none';
          // Also clear the auto-added partner apps since there are no iOS devices
          selectedApps = selectedApps.filter(a => !a.locked);
          // Update banner to not mention apps
          const bannerDesc = $('#partnerBannerDesc');
          if (bannerDesc) bannerDesc.textContent = 'Standard partner configuration will be applied.';
        }

        // Populate Laptop device list
        if (hasLaptop) {
          const laptopListEl = $('#laptopDeviceList');
          if (laptopListEl) {
            laptopListEl.innerHTML = Object.entries(grouped.laptop).map(([name, qty]) => `
              <div style="margin-bottom: 6px; font-weight: 500;">
                <i class="fa-solid fa-check" style="color: var(--cmi-success); margin-right: 8px;"></i>
                ${qty}x ${escapeHtml(name)}
              </div>
            `).join('');
          }
        }

        // Populate POS device list
        if (hasPOS) {
          const posListEl = $('#posDeviceList');
          if (posListEl) {
            posListEl.innerHTML = Object.entries(grouped.pos).map(([name, qty]) => `
              <div style="margin-bottom: 6px; font-weight: 500;">
                <i class="fa-solid fa-check" style="color: var(--cmi-success); margin-right: 8px;"></i>
                ${qty}x ${escapeHtml(name)}
              </div>
            `).join('');
          }
        }

        // Populate Networking device list
        if (hasNet) {
          const netListEl = $('#netDeviceList');
          if (netListEl) {
            netListEl.innerHTML = Object.entries(grouped.networking).map(([name, qty]) => `
              <div style="margin-bottom: 6px; font-weight: 500;">
                <i class="fa-solid fa-check" style="color: var(--cmi-success); margin-right: 8px;"></i>
                ${qty}x ${escapeHtml(name)}
              </div>
            `).join('');
          }
        }

        // Wire up POS/Networking tile toggles
        [
          { toggle: '#laptopWifiToggle', body: '#laptopWifiBody' },
          { toggle: '#laptopAppsToggle', body: '#laptopAppsBody' },
          { toggle: '#laptopWallpaperToggle', body: '#laptopWallpaperBody' },
          { toggle: '#posWifiToggle', body: '#posWifiBody' },
          { toggle: '#posLoginToggle', body: '#posLoginBody' },
          { toggle: '#netWifiToggle', body: '#netWifiBody' },
        ].forEach(({ toggle, body }) => {
          const t = $(toggle), b = $(body);
          if (t && b) {
            t.addEventListener('change', () => { b.style.display = t.checked ? '' : 'none'; });
          }
        });

        // CSV Upload for POS App Login
        const csvInput = $('#posLoginCsvInput');
        if (csvInput) {
          const parseCsv = (text) => {
            const lines = text.trim().split(/\r?\n/);
            if (lines.length < 2) return null;
            const headers = lines[0].split(',').map(h => h.trim());
            const rows = lines.slice(1).filter(l => l.trim()).map(line => {
              const vals = line.split(',').map(v => v.trim());
              const row = {};
              headers.forEach((h, i) => { row[h] = vals[i] || ''; });
              return row;
            });
            return { headers, rows };
          };

          const renderCsvPreview = (data) => {
            const preview = $('#posLoginPreview');
            const table = $('#posLoginTable');
            const countEl = $('#posLoginRowCount');
            if (!preview || !table || !data) return;

            const thead = table.querySelector('thead tr');
            thead.innerHTML = data.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');

            const tbody = table.querySelector('tbody');
            tbody.innerHTML = data.rows.map(row =>
              `<tr>${data.headers.map(h => {
                const val = row[h] || '';
                // Mask password column
                const masked = h.toLowerCase().includes('password') && val ? '••••••••' : escapeHtml(val);
                return `<td>${masked || '<span style="color:var(--cmi-text-muted);">—</span>'}</td>`;
              }).join('')}</tr>`
            ).join('');

            countEl.textContent = `${data.rows.length} credential${data.rows.length !== 1 ? 's' : ''}`;
            preview.style.display = '';

            // Store for submission
            window._dcrLoginCsvData = data;
          };

          csvInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.name.endsWith('.csv')) {
              showToast('Please upload a CSV file.', 'error');
              return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => {
              const data = parseCsv(ev.target.result);
              if (!data || data.rows.length === 0) {
                showToast('CSV is empty or invalid. Please check the template format.', 'error');
                return;
              }
              renderCsvPreview(data);
              showToast(`${data.rows.length} login credential${data.rows.length !== 1 ? 's' : ''} loaded.`, 'success');
            };
            reader.readAsText(file);
          });

          // Wire up the file drop zone for CSV
          const dropZone = csvInput.closest('.cmi-file-drop');
          if (dropZone) {
            const browseLink = dropZone.querySelector('.cmi-file-browse');
            browseLink?.addEventListener('click', () => csvInput.click());
            dropZone.addEventListener('click', (e) => {
              if (!e.target.closest('.cmi-file-browse') && !e.target.closest('.cmi-file-preview')) {
                csvInput.click();
              }
            });
            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
            dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); });
            dropZone.addEventListener('drop', (e) => {
              e.preventDefault();
              dropZone.classList.remove('dragover');
              const file = e.dataTransfer.files[0];
              if (file) {
                csvInput.files = e.dataTransfer.files;
                csvInput.dispatchEvent(new Event('change'));
              }
            });
          }
        }

        // Wi-Fi sharing: "Use same as iOS"
        const wireWifiShare = (checkboxId, fieldsId, ssidId, pwdId, secId) => {
          const cb = $(checkboxId);
          const fields = $(fieldsId);
          if (!cb || !fields) return;
          cb.addEventListener('change', () => {
            fields.style.display = cb.checked ? 'none' : '';
            if (cb.checked) {
              // Copy from iOS Wi-Fi (Quick Setup or custom flow)
              const iosSsid = $('#quickWifiSsid')?.value || $('#wifiSsid')?.value || '';
              const iosPwd = $('#quickWifiPassword')?.value || $('#wifiPassword')?.value || '';
              const iosSec = $('#quickWifiSecurity')?.value || $('#wifiSecurity')?.value || 'WPA2 Personal';
              $(ssidId).value = iosSsid;
              $(pwdId).value = iosPwd;
              $(secId).value = iosSec;
            }
          });
        };
        wireWifiShare('#posWifiSameAsIos', '#posWifiFields', '#posWifiSsid', '#posWifiPassword', '#posWifiSecurity');
        wireWifiShare('#netWifiSameAsIos', '#netWifiFields', '#netWifiSsid', '#netWifiPassword', '#netWifiSecurity');
        wireWifiShare('#laptopWifiSameAsIos', '#laptopWifiFields', '#laptopWifiSsid', '#laptopWifiPassword', '#laptopWifiSecurity');

        // Laptop software "Add" button
        $('#btnAddLaptopApp')?.addEventListener('click', () => {
          const list = $('#laptopAppList');
          if (!list) return;
          const row = document.createElement('div');
          row.className = 'cmi-laptop-app-row';
          row.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px;';
          row.innerHTML = `
            <input type="text" class="cmi-input laptop-app-input" placeholder="e.g. Google Chrome, Zoom, Microsoft Office" style="flex: 1;">
            <button type="button" class="cmi-btn-icon" onclick="this.closest('.cmi-laptop-app-row').remove()" style="color: var(--cmi-error); background: none; border: none; cursor: pointer; padding: 8px;">
              <i class="fa-solid fa-xmark"></i>
            </button>
          `;
          list.appendChild(row);
          row.querySelector('input')?.focus();
        });

        // Store group flags
        window._dcrHasIos = hasIos;
        window._dcrHasLaptop = hasLaptop;
        window._dcrHasPOS = hasPOS;
        window._dcrHasNet = hasNet;

        // Only show "Use same Wi-Fi" checkboxes when iOS is present alongside other groups
        const groupCount = [hasIos, hasLaptop, hasPOS, hasNet].filter(Boolean).length;
        if (!hasIos || groupCount < 2) {
          ['#laptopWifiSameAsIos', '#posWifiSameAsIos', '#netWifiSameAsIos'].forEach(id => {
            const cb = $(id);
            if (cb) cb.closest('label').style.display = 'none';
          });
        }

        // Build group selector hub (when multiple groups or any non-iOS group)
        if (groupCount > 1 || (hasLaptop || hasPOS || hasNet)) {
          const hub = $('#groupSelectorHub');
          const cards = $('#groupCards');
          if (hub && cards) {
            hub.style.display = '';

            // Hide Quick Setup & Advanced selector when hub is active
            const quickSetup = $('#quickSetup');
            const advancedSelector = $('#advancedModeSelector');
            if (quickSetup) quickSetup.style.display = 'none';
            if (advancedSelector) advancedSelector.style.display = 'none';

            const GROUP_CARD_CONFIG = [
              { key: 'ios', has: hasIos, icon: 'fa-solid fa-tablet-screen-button', label: 'iPads & iPhones', stepId: null, devices: grouped.ios },
              { key: 'laptop', has: hasLaptop, icon: 'fa-solid fa-laptop', label: 'Laptops', stepId: 'group-laptop', devices: grouped.laptop },
              { key: 'pos', has: hasPOS, icon: 'fa-solid fa-cash-register', label: 'POS Devices', stepId: 'group-pos', devices: grouped.pos },
              { key: 'networking', has: hasNet, icon: 'fa-solid fa-wifi', label: 'Networking', stepId: 'group-networking', devices: grouped.networking },
            ];

            // Track configured state
            window._dcrGroupConfigured = {};

            cards.innerHTML = GROUP_CARD_CONFIG.filter(g => g.has).map(g => {
              const count = Object.values(g.devices).reduce((a, b) => a + b, 0);
              const deviceList = Object.entries(g.devices).map(([n, q]) => `${q}x ${n}`).join(', ');
              // iOS uses the existing Quick Setup / Advanced flow below
              const isIos = g.key === 'ios';
              return `
                <div class="cmi-group-card" data-group="${g.key}" data-step="${g.stepId || ''}">
                  <div class="cmi-group-card-badge"><i class="fa-solid fa-circle-check"></i></div>
                  <div class="cmi-group-card-icon"><i class="${g.icon}"></i></div>
                  <div class="cmi-group-card-title">${g.label}</div>
                  <div class="cmi-group-card-count">${count} device${count !== 1 ? 's' : ''} — ${deviceList}</div>
                  <div class="cmi-group-card-btn">
                    <i class="fa-solid fa-arrow-right"></i> Configure
                  </div>
                </div>
              `;
            }).join('');

            // Card click handlers
            cards.querySelectorAll('.cmi-group-card').forEach(card => {
              card.addEventListener('click', () => {
                const group = card.dataset.group;
                const stepId = card.dataset.step;

                if (group === 'ios') {
                  // Show Quick Setup section for iOS config
                  const qs = $('#quickSetup');
                  if (qs) {
                    qs.style.display = '';
                    qs.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                  return;
                }

                if (stepId) {
                  // Navigate to group config step
                  $$('.cmi-step').forEach(s => s.classList.remove('active'));
                  const section = $(`#${stepId}`);
                  if (section) {
                    section.classList.add('active');
                    // Hide progress bar (we're in hub mode, not linear)
                    dom.btnBack.hidden = true;
                    dom.btnNext.hidden = true;
                    $('.cmi-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }
              });
            });

            // Group Submit → Review
            $('#btnGroupSubmit')?.addEventListener('click', () => {
              quickSubmitMode = true;
              const built = buildGroupNavChain(['step-1', 'step-6'], ['Order Info', 'Review']);
              navChain = built.chain;
              navLabels = built.labels;
              // Jump straight to review (last in chain)
              navIndex = navChain.length - 1;
              goToStep(navIndex, true);
            });
          }
        }

        // Inject "Done — Back to Groups" button into POS and Networking steps
        ['group-laptop', 'group-pos', 'group-networking'].forEach(stepId => {
          const section = $(`#${stepId}`);
          if (!section) return;
          // Remove existing done button if any
          section.querySelector('.cmi-group-done-btn')?.remove();
          const doneBtn = document.createElement('button');
          doneBtn.type = 'button';
          doneBtn.className = 'cmi-btn cmi-btn-primary cmi-group-done-btn';
          doneBtn.style.cssText = 'width: 100%; max-width: 400px; padding: 14px 24px; font-size: 1rem; margin: 24px auto 0; display: block;';
          doneBtn.innerHTML = '<i class="fa-solid fa-check"></i> Done — Back to Groups';
          doneBtn.addEventListener('click', () => {
            // Mark group as configured
            const groupKey = stepId === 'group-pos' ? 'pos' : stepId === 'group-laptop' ? 'laptop' : 'networking';
            window._dcrGroupConfigured[groupKey] = true;
            const card = document.querySelector(`.cmi-group-card[data-group="${groupKey}"]`);
            if (card) card.classList.add('configured');

            // Return to Step 1
            $$('.cmi-step').forEach(s => s.classList.remove('active'));
            $('#step-1')?.classList.add('active');
            navIndex = 0;
            dom.btnBack.hidden = true;
            dom.btnNext.hidden = true;
            $('.cmi-container').scrollIntoView({ behavior: 'smooth', block: 'start' });

            showToast(`${groupKey === 'pos' ? 'POS' : 'Networking'} configuration saved.`, 'success');
          });
          section.appendChild(doneBtn);
        });

        btn.innerHTML = '<i class="fa-solid fa-check"></i> Found';
        btn.disabled = false;

        showToast(`Order ${raw.fly_order_id} loaded — ${raw.customer_name}`, 'success');
        triggerAutoSave();

      } catch (err) {
        console.error('Order lookup error:', err);
        showToast('Failed to look up order. Please try again.', 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  };

  /** Helper: set field value only if element exists */
  const setFieldValue = (selector, value) => {
    const el = $(selector);
    if (el) el.value = value;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DYNAMIC REPEATERS
  // ═══════════════════════════════════════════════════════════════════════════

  const addRepeaterRow = (repeaterId) => {
    const repeater = $(`#${repeaterId}`);
    if (!repeater) return;

    const body = $('.cmi-repeater-body', repeater);
    const firstRow = $('.cmi-repeater-row', body);
    if (!firstRow) return;

    const newRow = firstRow.cloneNode(true);
    $$('input, textarea, select', newRow).forEach(input => {
      input.value = '';
      input.classList.remove('has-error');
    });
    $$('.cmi-error-msg', newRow).forEach(e => e.remove());

    body.appendChild(newRow);
    bindRemoveButtons(repeater);
    triggerAutoSave();
  };

  const removeRepeaterRow = (button) => {
    const row = button.closest('.cmi-repeater-row');
    const body = row?.closest('.cmi-repeater-body');
    if (!body) return;

    const rows = $$('.cmi-repeater-row', body);
    if (rows.length <= 1) {
      showToast('At least one row is required.', 'info');
      return;
    }

    row.style.opacity = '0';
    row.style.transform = 'translateX(20px)';
    setTimeout(() => {
      row.remove();
      triggerAutoSave();
    }, 250);
  };

  const bindRemoveButtons = (repeater) => {
    $$('.cmi-btn-remove-row', repeater).forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', () => removeRepeaterRow(newBtn));
    });
  };

  const initRepeaters = () => {
    $$('.cmi-btn-add-row[data-repeater]').forEach(btn => {
      btn.addEventListener('click', () => addRepeaterRow(btn.dataset.repeater));
    });
    $$('.cmi-repeater').forEach(repeater => bindRemoveButtons(repeater));
  };

  const initEnterpriseApps = () => {
    const addBtn = $('#addEnterpriseApp');
    if (!addBtn) return;

    addBtn.addEventListener('click', () => {
      enterpriseAppCounter++;
      const container = $('#enterpriseApps');
      const card = document.createElement('div');
      card.className = 'cmi-enterprise-card';
      card.innerHTML = `
        <div class="cmi-form-grid">
          <div class="cmi-field cmi-col-full">
            <label class="cmi-label">App Name</label>
            <input type="text" class="cmi-input" name="enterpriseName[]" placeholder="Enterprise app name">
          </div>
          <div class="cmi-field cmi-col-full">
            <label class="cmi-label">IPA File</label>
            <div class="cmi-file-drop" data-file-id="enterpriseIpa_${enterpriseAppCounter}">
              <input type="file" class="cmi-file-input" accept=".ipa" hidden>
              <div class="cmi-file-drop-content">
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <p>Drag &amp; drop your IPA file here or <span class="cmi-file-browse">browse</span></p>
              </div>
              <div class="cmi-file-preview" hidden></div>
            </div>
          </div>
          <div class="cmi-field cmi-col-full">
            <label class="cmi-label">Installation Instructions</label>
            <div class="cmi-file-drop" data-file-id="enterpriseInstructions_${enterpriseAppCounter}">
              <input type="file" class="cmi-file-input" accept=".pdf,.txt,.doc,.docx" hidden>
              <div class="cmi-file-drop-content">
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <p>Drag &amp; drop your Instructions file here or <span class="cmi-file-browse">browse</span></p>
              </div>
              <div class="cmi-file-preview" hidden></div>
            </div>
          </div>
          <div class="cmi-field cmi-col-full">
            <label class="cmi-label">Certificates (if applicable)</label>
            <div class="cmi-file-drop cmi-file-drop-multi" data-file-id="enterpriseCerts_${enterpriseAppCounter}">
              <input type="file" class="cmi-file-input" multiple hidden>
              <div class="cmi-file-drop-content">
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <p>Drag &amp; drop your Certificates here or <span class="cmi-file-browse">browse</span></p>
              </div>
              <div class="cmi-file-preview cmi-file-preview-multi" hidden></div>
            </div>
          </div>
        </div>
        <button type="button" class="cmi-btn-icon cmi-btn-remove-enterprise" title="Remove app"><i class="fa-solid fa-xmark"></i></button>
      `;
      container.appendChild(card);

      $('.cmi-btn-remove-enterprise', card).addEventListener('click', () => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(-10px)';
        setTimeout(() => card.remove(), 250);
      });

      $$('.cmi-file-drop', card).forEach(initFileDropZone);
    });

    $$('.cmi-btn-remove-enterprise').forEach(btn => {
      btn.addEventListener('click', () => {
        const cards = $$('.cmi-enterprise-card');
        if (cards.length <= 1) {
          showToast('At least one enterprise app entry is required.', 'info');
          return;
        }
        const card = btn.closest('.cmi-enterprise-card');
        card.style.opacity = '0';
        card.style.transform = 'translateY(-10px)';
        setTimeout(() => card.remove(), 250);
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE UPLOADS
  // ═══════════════════════════════════════════════════════════════════════════

  const initFileDropZone = (dropZone) => {
    if (!dropZone) return;

    const fileInput = $('.cmi-file-input', dropZone);
    const browseLink = $('.cmi-file-browse', dropZone);
    const fileId = dropZone.dataset.fileId;
    const isMulti = dropZone.classList.contains('cmi-file-drop-multi');

    if (browseLink) {
      browseLink.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });
    }

    dropZone.addEventListener('click', (e) => {
      if (e.target.closest('.cmi-file-preview') || e.target.closest('.cmi-file-remove')) return;
      fileInput.click();
    });

    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const files = isMulti ? [...e.dataTransfer.files] : [e.dataTransfer.files[0]];
      handleFiles(fileId, files, dropZone, isMulti);
    });

    fileInput.addEventListener('change', () => {
      const files = isMulti ? [...fileInput.files] : [fileInput.files[0]];
      handleFiles(fileId, files, dropZone, isMulti);
      fileInput.value = ''; 
    });
  };

  const handleFiles = (fileId, files, dropZone, isMulti) => {
    if (!files || files.length === 0) return;

    const dropContent = $('.cmi-file-drop-content', dropZone);
    const previewEl = $('.cmi-file-preview', dropZone);
    const isImageField = !fileId.startsWith('media') && !fileId.startsWith('enterprise') && !fileId.startsWith('vpn') && !fileId.startsWith('config');
    const maxSize = isImageField ? MAX_FILE_SIZE_IMAGE : MAX_FILE_SIZE_MEDIA;

    const validFiles = [];
    for (const file of files) {
      if (file.size > maxSize) {
        const maxMB = maxSize / (1024 * 1024);
        showToast(`"${file.name}" exceeds the ${maxMB}MB file size limit.`, 'error');
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) return;

    if (isMulti) {
      const existing = uploadedFiles.get(fileId) || [];
      const combined = [...existing, ...validFiles];
      uploadedFiles.set(fileId, combined);
      renderMultiFilePreview(fileId, combined, previewEl, dropContent);
    } else {
      uploadedFiles.set(fileId, validFiles[0]);
      renderSingleFilePreview(fileId, validFiles[0], previewEl, dropContent);
    }

    triggerAutoSave();
  };

  const renderSingleFilePreview = (fileId, file, previewEl, dropContent) => {
    dropContent.hidden = true;
    previewEl.hidden = false;

    const isImage = file.type.startsWith('image/');

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewEl.innerHTML = `
          <div class="cmi-file-preview-item">
            <img src="${e.target.result}" alt="${file.name}" class="cmi-file-thumb">
            <div class="cmi-file-info">
              <span class="cmi-file-name">${file.name}</span>
              <span class="cmi-file-size">${formatFileSize(file.size)}</span>
            </div>
            <button type="button" class="cmi-btn-icon cmi-file-remove" title="Remove file"><i class="fa-solid fa-xmark"></i></button>
          </div>
        `;
        bindFileRemove(fileId, previewEl, dropContent, false);
      };
      reader.readAsDataURL(file);
    } else {
      previewEl.innerHTML = `
        <div class="cmi-file-preview-item">
          <div class="cmi-file-icon"><i class="fa-solid fa-file"></i></div>
          <div class="cmi-file-info">
            <span class="cmi-file-name">${file.name}</span>
            <span class="cmi-file-size">${formatFileSize(file.size)}</span>
          </div>
          <button type="button" class="cmi-btn-icon cmi-file-remove" title="Remove file"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
      bindFileRemove(fileId, previewEl, dropContent, false);
    }
  };

  const renderMultiFilePreview = (fileId, files, previewEl, dropContent) => {
    if (files.length === 0) {
      previewEl.hidden = true;
      dropContent.hidden = false;
      return;
    }

    dropContent.hidden = true;
    previewEl.hidden = false;

    previewEl.innerHTML = files.map((file, idx) => {
      const icon = file.type.startsWith('image/') ? 'fa-image' :
                   file.type.startsWith('video/') ? 'fa-film' : 'fa-file';
      return `
        <div class="cmi-file-preview-item" data-file-index="${idx}">
          <div class="cmi-file-icon"><i class="fa-solid ${icon}"></i></div>
          <div class="cmi-file-info">
            <span class="cmi-file-name">${file.name}</span>
            <span class="cmi-file-size">${formatFileSize(file.size)}</span>
          </div>
          <button type="button" class="cmi-btn-icon cmi-file-remove" data-index="${idx}" title="Remove file"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
    }).join('');

    previewEl.innerHTML += `
      <div class="cmi-file-add-more">
        <i class="fa-solid fa-plus"></i> Add more files
      </div>
    `;

    $$('.cmi-file-remove', previewEl).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        const currentFiles = uploadedFiles.get(fileId) || [];
        currentFiles.splice(idx, 1);
        uploadedFiles.set(fileId, currentFiles);
        renderMultiFilePreview(fileId, currentFiles, previewEl, dropContent);
        triggerAutoSave();
      });
    });
  };

  const bindFileRemove = (fileId, previewEl, dropContent) => {
    const removeBtn = $('.cmi-file-remove', previewEl);
    if (!removeBtn) return;
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadedFiles.delete(fileId);
      previewEl.hidden = true;
      previewEl.innerHTML = '';
      dropContent.hidden = false;
      triggerAutoSave();
    });
  };

  const initAllFileDropZones = () => {
    $$('.cmi-file-drop').forEach(initFileDropZone);
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const initPasswordToggles = () => {
    $$('.cmi-password-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = $(`#${targetId}`);
        if (!input) return;

        const icon = $('i', btn);
        if (input.type === 'password') {
          input.type = 'text';
          icon.classList.replace('fa-eye', 'fa-eye-slash');
          btn.title = 'Hide password';
        } else {
          input.type = 'password';
          icon.classList.replace('fa-eye-slash', 'fa-eye');
          btn.title = 'Show password';
        }
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validateStep = (sectionId) => {
    // Accept section ID string or step number
    const stepEl = typeof sectionId === 'string' ? $(`#${sectionId}`) : $(`#step-${sectionId}`);
    if (!stepEl) return true;

    let isValid = true;
    const fields = $$('input, textarea, select', stepEl);

    fields.forEach(field => {
      if (!isFieldVisible(field)) return;

      const isRequired = field.hasAttribute('required') ||
        (field.hasAttribute('data-conditional-required') && isInsideOpenToggle(field));

      // Radio groups must be validated explicitly if required
      if (field.type === 'radio' && isRequired) {
        removeFieldError(field);
        const name = field.name;
        const checked = $(`input[name="${name}"]:checked`);
        if (!checked) {
          setFieldError(field, 'Please select an option.');
          isValid = false;
        }
        return;
      }

      if (!isRequired) return;

      if (field.type === 'checkbox' && !field.hasAttribute('required')) return;

      removeFieldError(field);

      if (field.type === 'checkbox') {
        if (!field.checked) {
          setFieldError(field, 'This field is required.');
          isValid = false;
        }
        return;
      }

      const value = field.value.trim();
      if (!value) {
        setFieldError(field, 'This field is required.');
        isValid = false;
        return;
      }

      if (field.type === 'email' && !EMAIL_REGEX.test(value)) {
        setFieldError(field, 'Please enter a valid email address.');
        isValid = false;
        return;
      }
    });

    if (!isValid) {
      showToast('Please fix the highlighted errors before continuing.', 'error');
      const firstError = $('.has-error', stepEl);
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    return isValid;
  };

  const isFieldVisible = (field) => {
    let el = field;
    while (el) {
      if (el.hidden || (el.style && el.style.display === 'none')) return false;
      if (el.classList?.contains('cmi-toggle-content') && !el.classList.contains('open')) return false;
      el = el.parentElement;
    }
    return true;
  };

  const isInsideOpenToggle = (field) => {
    const toggleContent = field.closest('.cmi-toggle-content');
    return toggleContent ? toggleContent.classList.contains('open') : false;
  };

  const setFieldError = (field, message) => {
    field.classList.add('has-error');
    const parent = field.closest('.cmi-field') || field.closest('.cmi-checkbox-label')?.parentElement || field.closest('.cmi-radio-card-grid');
    if (parent && !$('.cmi-error-msg', parent)) {
      const errorEl = document.createElement('span');
      errorEl.className = 'cmi-error-msg';
      errorEl.textContent = message;
      parent.appendChild(errorEl);
    }
  };

  const removeFieldError = (field) => {
    field.classList.remove('has-error');
    const parent = field.closest('.cmi-field') || field.closest('.cmi-checkbox-label')?.parentElement || field.closest('.cmi-radio-card-grid');
    if (parent) {
      const errorEl = $('.cmi-error-msg', parent);
      if (errorEl) errorEl.remove();
    }
  };

  const clearValidationErrors = (container) => {
    $$('.has-error', container).forEach(el => el.classList.remove('has-error'));
    $$('.cmi-error-msg', container).forEach(el => el.remove());
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCAL STORAGE AUTO-SAVE
  // ═══════════════════════════════════════════════════════════════════════════

  const saveFormData = () => {
    // Only basic JSON-serializable data
    const data = {
      currentStep: navIndex,
      orderNumber: $('#orderNumber')?.value || '',
      eventName: $('#eventName')?.value || '',
      eventDates: $('#eventDates')?.value || '',
      venueName: $('#venueName')?.value || '',
      companyName: $('#companyName')?.value || '',
      primaryContactName: $('#primaryContactName')?.value || '',
      contactEmail: $('#contactEmail')?.value || '',
      contactPhone: $('#contactPhone')?.value || '',
      

      configPackage: $('input[name="configPackage"]:checked')?.value || '',
      
      homeScreenLayout: $('input[name="homeScreenLayout"]:checked')?.value || '',
      namingConvention: $('input[name="namingConvention"]:checked')?.value || '',
      customNamingFormat: $('#customNamingFormat')?.value || '',
      
      wifiSsid: $('#wifiSsid')?.value || '',
      wifiPassword: $('#wifiPassword')?.value || '',
      wifiSecurity: $('#wifiSecurity')?.value || '',
      wifiHidden: $('input[name="wifiHidden"]:checked')?.value || 'No',
      
      restrictions: $$('input[name="restrictions"]:checked').map(cb => cb.value),
      locationServices: $('input[name="locationServices"]:checked')?.value || 'Enable Location Services',
      
      mediaUsage: $$('input[name="mediaUsage"]:checked').map(cb => cb.value),
      mediaInstructions: $('#mediaInstructions')?.value || '',
      
      anythingElse: $('#anythingElse')?.value || '',
      
      toggles: {}
    };

    $$('.cmi-toggle-group').forEach(group => {
      const key = group.dataset.toggle;
      const activeBtn = $('.cmi-toggle-btn.active', group);
      data.toggles[key] = activeBtn ? activeBtn.dataset.value : null;
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Could not save form data to localStorage:', e);
    }
  };

  const triggerAutoSave = () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(saveFormData, AUTOSAVE_DELAY);
  };

  const initAutoSaveListeners = () => {
    document.addEventListener('input', (e) => {
      if (e.target.matches('input, textarea, select')) {
        triggerAutoSave();
        if (e.target.classList.contains('has-error')) {
          removeFieldError(e.target);
        }
      }
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"], input[type="radio"], select')) {
        triggerAutoSave();
      }
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEW & SUBMIT
  // ═══════════════════════════════════════════════════════════════════════════

  const generateReview = () => {
    if (!dom.reviewSummary) return;

    let html = '';

    const buildSection = (title, content, icon = 'fa-check') => {
      if (!content) return '';
      return `
        <div class="cmi-review-section open">
          <div class="cmi-review-section-header">
            <div style="display:flex;align-items:center;gap:10px;">
              <i class="${icon.startsWith('fa-brands') ? icon : 'fa-solid ' + icon}" style="color:var(--cmi-accent);"></i>
              <span class="cmi-review-section-title">${title}</span>
            </div>
            <span class="cmi-review-section-toggle"><i class="fa-solid fa-chevron-down"></i></span>
          </div>
          <div class="cmi-review-section-body">
            ${content}
          </div>
        </div>
      `;
    };

    const buildRow = (label, value) => {
      if (!value) return '';
      return `<div class="cmi-review-item"><span class="cmi-review-label">${label}:</span><span class="cmi-review-value">${value}</span></div>`;
    };

    // Step 1: Order
    let orderHtml = buildRow('Order #', $('#orderNumber')?.value);
    orderHtml += buildRow('Event', $('#eventName')?.value);
    orderHtml += buildRow('Dates', $('#eventDates')?.value);
    orderHtml += buildRow('Venue', $('#venueName')?.value);
    orderHtml += buildRow('Contact', `${$('#primaryContactName')?.value} (${$('#companyName')?.value})`);
    orderHtml += buildRow('Email', $('#contactEmail')?.value);
    orderHtml += buildRow('Phone', $('#contactPhone')?.value);
    const pkg = getActivePackage();
    orderHtml += buildRow('Configuration Mode', quickSubmitMode ? 'Quick Setup' : pkg);
    html += buildSection('Order & Event Info', orderHtml, 'fa-address-card');

    // Quick Submit: simplified review
    if (quickSubmitMode) {
      // Apps
      if (selectedApps.length > 0) {
        let appsHtml = buildRow('Apps to Install', selectedApps.map(a => a.name).join(', '));
        appsHtml += buildRow('Total Apps', selectedApps.length);
        html += buildSection('App Installation', appsHtml, 'fa-brands fa-app-store-ios');
      }

      // Wi-Fi
      if ($('#quickWifiToggle')?.checked) {
        let wifiHtml = buildRow('Network (SSID)', $('#quickWifiSsid')?.value);
        wifiHtml += buildRow('Security', $('#quickWifiSecurity')?.value);
        html += buildSection('Pre-configured Wi-Fi', wifiHtml, 'fa-wifi');
      }

      // Wallpaper
      if ($('#quickWallpaperToggle')?.checked) {
        html += buildSection('Custom Wallpaper', buildRow('Wallpaper', 'Uploaded'), 'fa-image');
      }

      dom.reviewSummary.innerHTML = html;
      initReviewAccordions();
      return;
    }

    const isCustom = !PACKAGE_CHAINS[pkg];

    if (isCustom) {
      // ── CUSTOM FLOW: read from Steps 2–5 ──
      let appsHtml = '';
      const allDevicesMode = getToggleValue('allAppsAllDevicesToggle') !== 'no';
      if (selectedApps.length > 0) {
        appsHtml += buildRow('App Store Apps', selectedApps.map(a => a.name).join(', '));
        appsHtml += buildRow('Total Apps Selected', selectedApps.length);
      }
      if (getToggleValue('webClipToggle') === 'yes') {
        const clips = $$('input[name="webClipName[]"]').map(i => i.value).filter(Boolean);
        if (clips.length) appsHtml += buildRow('Web Clips', clips.join(', '));
      }
      appsHtml += buildRow('All Apps on All Devices', allDevicesMode ? 'Yes' : 'No');
      if (!allDevicesMode) {
        const devices = getOrderDevices();
        const assignContainer = $('#perDeviceAssignmentList');
        selectedApps.forEach(app => {
          const assignments = [];
          devices.forEach((dev, idx) => {
            const input = assignContainer?.querySelector(`input[name="assign_app_${app.trackId}_qty_${idx}"]`);
            const qty = parseInt(input?.value) || 0;
            if (qty > 0) assignments.push(`${qty}x ${dev.name}`);
          });
          if (assignments.length) appsHtml += buildRow(`\u2514 ${app.name}`, assignments.join(', '));
        });
      }
      if (getToggleValue('appLoginToggle') === 'yes') {
        const loginApps = $$('input[name="appLogin"]:checked').map(cb => cb.value);
        if (loginApps.length) appsHtml += buildRow('Fello Login Required', loginApps.join(', '));
      }
      if (!appsHtml) appsHtml = '<p class="cmi-text-muted">No apps requested.</p>';
      html += buildSection('Applications', appsHtml, 'fa-brands fa-app-store-ios');

      let brandingHtml = '';
      if (getToggleValue('wallpaperToggle') === 'yes') brandingHtml += buildRow('Custom Wallpaper', 'Yes (Uploaded)');
      brandingHtml += buildRow('Home Screen Layout', $('input[name="homeScreenLayout"]:checked')?.value);
      html += buildSection('Branding & Appearance', brandingHtml || '<p class="cmi-text-muted">Standard settings.</p>', 'fa-palette');

      let securityHtml = '';
      if (getToggleValue('wifiToggle') === 'yes') {
        securityHtml += buildRow('Wi-Fi SSID', $('#wifiSsid')?.value);
        securityHtml += buildRow('Wi-Fi Security', $('#wifiSecurity')?.value);
      }
      if (getToggleValue('vpnToggle') === 'yes') securityHtml += buildRow('VPN Profile', 'Yes (Uploaded)');
      if (getToggleValue('configProfileToggle') === 'yes') securityHtml += buildRow('Apple Config Profile', 'Yes (Uploaded)');
      if (getToggleValue('restrictionsToggle') === 'yes') {
        const rType = $('input[name="restrictionType"]:checked')?.value || 'Whitelist';
        const urls = $$('input[name="restrictionUrl[]"]').map(i => i.value).filter(Boolean);
        securityHtml += buildRow('Website Restrictions', rType);
        if (urls.length) securityHtml += buildRow(rType + ' URLs', urls.join(', '));
      }
      if (getToggleValue('guidedAccessToggle') === 'yes') {
        securityHtml += buildRow('Guided Access', `Enabled (Passcode: ${$('#guidedAccessPasscode')?.value || '(not set)'})`);
      }
      securityHtml += buildRow('Location Services', $('input[name="locationServices"]:checked')?.value);
      html += buildSection('Network & Security', securityHtml, 'fa-shield-halved');

      let mediaHtml = '';
      if (getToggleValue('mediaToggle') === 'yes') {
        mediaHtml += buildRow('Media Files', 'Uploaded');
      }
      const naming = $('input[name="namingConvention"]:checked')?.value;
      if (naming === 'Custom Naming Convention') {
        mediaHtml += buildRow('Naming Convention', `Custom: ${$('#customNamingFormat')?.value}`);
      } else {
        mediaHtml += buildRow('Naming Convention', naming);
      }
      html += buildSection('Media & Naming', mediaHtml, 'fa-photo-film');

    } else {
      // ── PACKAGE FLOW: read from active package section ──
      const prefixMap = {
        'Check-in Mode': 'Reg',
        'Lead Capture Mode': 'Lc',
        'POS Mode': 'Pos',
        'Kiosk Mode': 'Kiosk',
      };
      const p = prefixMap[pkg] || '';

      // Apps (package pages use the same selectedApps array)
      let configHtml = '';
      if (selectedApps.length > 0) {
        configHtml += buildRow('Apps to Install', selectedApps.map(a => a.name).join(', '));
      }

      // Per-device assignment
      const pkgAllAppsToggle = `pkg${p}AllAppsToggle`;
      const pkgAllAppsMode = getToggleValue(pkgAllAppsToggle) !== 'no';
      configHtml += buildRow('All Apps on All Devices', pkgAllAppsMode ? 'Yes' : 'No');

      if (!pkgAllAppsMode) {
        const devices = getOrderDevices();
        const pkgContainerId = { Reg: 'pkgRegPerDeviceAssignmentList', Lc: 'pkgLcPerDeviceAssignmentList', Pos: 'pkgPosPerDeviceAssignmentList', Kiosk: 'pkgKioskPerDeviceAssignmentList' };
        const assignContainer = $(`#${pkgContainerId[p]}`);
        selectedApps.forEach(app => {
          const assignments = [];
          devices.forEach((dev, idx) => {
            const input = assignContainer?.querySelector(`input[name="assign_app_${app.trackId}_qty_${idx}"]`);
            const qty = parseInt(input?.value) || 0;
            if (qty > 0) assignments.push(`${qty}x ${dev.name}`);
          });
          if (assignments.length) configHtml += buildRow(`\u2514 ${app.name}`, assignments.join(', '));
        });
      }

      // Wi-Fi
      if (getToggleValue(`pkg${p}WifiToggle`) === 'yes') {
        configHtml += buildRow('Wi-Fi SSID', $(`#pkg${p}WifiSsid`)?.value);
        configHtml += buildRow('Wi-Fi Security', $(`#pkg${p}WifiSecurity`)?.value);
      }

      // Location Services
      const locSvc = $(`input[name="pkg${p}LocationServices"]:checked`)?.value;
      if (locSvc) configHtml += buildRow('Location Services', locSvc);

      // Wallpaper
      if (getToggleValue(`pkg${p}WallpaperToggle`) === 'yes') {
        configHtml += buildRow('Custom Wallpaper', 'Yes (Uploaded)');
      }

      // Home Screen Layout
      const layout = $(`input[name="pkg${p}HomeScreenLayout"]:checked`)?.value;
      if (layout) configHtml += buildRow('Home Screen Layout', layout);

      // Restrictions (POS & Kiosk)
      if (getToggleValue(`pkg${p}RestrictionsToggle`) === 'yes') {
        const rType = $(`input[name="pkg${p}RestrictionType"]:checked`)?.value || 'Whitelist';
        const urls = $$(`input[name="pkg${p}RestrictionUrl[]"]`).map(i => i.value).filter(Boolean);
        configHtml += buildRow('Website Restrictions', rType);
        if (urls.length) configHtml += buildRow(rType + ' URLs', urls.join(', '));
      }

      // Device Lockdown Mode (Kiosk only)
      if (p === 'Kiosk') {
        const lockdownMode = $('input[name="pkgKioskLockdownMode"]:checked')?.value;
        if (lockdownMode) {
          configHtml += buildRow('Device Lockdown Mode', lockdownMode);
          if (lockdownMode === 'Guided Access') {
            configHtml += buildRow('Guided Access Passcode', $(`#pkgKioskGuidedAccessPasscode`)?.value || '(not set)');
          }
        }

        // Web Clips (Kiosk only)
        if (getToggleValue('pkgKioskWebClipToggle') === 'yes') {
          const clips = $$('input[name="pkgKioskWebClipName[]"]').map(i => i.value).filter(Boolean);
          if (clips.length) configHtml += buildRow('Web Clips', clips.join(', '));
        }
      }

      // App Login
      if (getToggleValue(`pkg${p}AppLoginToggle`) === 'yes') {
        const loginApps = $$('.pkg-app-login-checkboxes input[name="pkgAppLogin"]:checked').map(cb => cb.value);
        configHtml += buildRow('Fello Login Required', loginApps.length ? loginApps.join(', ') : 'Yes (no apps selected)');
      }

      html += buildSection('Mode Configuration', configHtml || '<p class="cmi-text-muted">Standard settings.</p>', 'fa-sliders');
    }

    dom.reviewSummary.innerHTML = html;

    // Wire up accordion toggles
    dom.reviewSummary.querySelectorAll('.cmi-review-section-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.cmi-review-section').classList.toggle('open');
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE SHEETS INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════
  // COMMAND CENTER SUBMIT ENDPOINT:
  // DCR form submits directly to the Fello Command Center for auto-provisioning.
  // Update this URL to your deployed Command Center address.
  const COMMAND_CENTER_URL = 'https://fellostarlinkcommandcenter-production.up.railway.app';
  // Legacy Google Apps Script URL (kept for reference):
  // const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwidaqayX2Zk3DwamqyT7t4IjIosWs1o5HeIKG8KlPRlQWyoHn4X24GG0PzPwMwK9beug/exec';

  /** Collect all form data into a flat object for submission */
  const collectSubmissionData = () => {
    const pkg = getActivePackage();
    const isCustom = !PACKAGE_CHAINS[pkg];
    const prefixMap = {
      'Check-in Mode': 'Reg',
      'Lead Capture Mode': 'Lc',
      'POS Mode': 'Pos',
      'Kiosk Mode': 'Kiosk',
    };
    const p = prefixMap[pkg] || '';

    const data = {
      orderNumber: $('#orderNumber')?.value || '',
      eventName: $('#eventName')?.value || '',
      eventDates: $('#eventDates')?.value || '',
      venue: $('#venueName')?.value || '',
      contactName: $('#primaryContactName')?.value || '',
      company: $('#companyName')?.value || '',
      email: $('#contactEmail')?.value || '',
      phone: $('#contactPhone')?.value || '',
      configMode: quickSubmitMode ? 'Quick Setup' : pkg,
      apps: selectedApps.map(a => a.name),
      appLinks: selectedApps.map(a => ({ name: a.name, url: a.url || '' })),
    };

    // Quick Submit mode — only capture Quick Setup fields
    if (quickSubmitMode) {
      data.wifiEnabled = $('#quickWifiToggle')?.checked ? 'Yes' : 'No';
      data.wifiSsid = $('#quickWifiSsid')?.value || '';
      data.wifiPassword = $('#quickWifiPassword')?.value || '';
      data.wifiSecurity = $('#quickWifiSecurity')?.value || '';
      data.customWallpaper = $('#quickWallpaperToggle')?.checked ? 'Yes' : 'No';
      return data;
    }

    if (isCustom) {
      // Custom flow fields
      data.allAppsAllDevices = getToggleValue('allAppsAllDevicesToggle') !== 'no' ? 'Yes' : 'No';
      data.homeScreenLayout = $('input[name="homeScreenLayout"]:checked')?.value || '';
      data.customLayoutDescription = $('[name="customLayoutDesc"]')?.value || '';
      data.locationServices = $('input[name="locationServices"]:checked')?.value || '';
      data.wifiEnabled = getToggleValue('wifiToggle') === 'yes' ? 'Yes' : 'No';
      data.wifiSsid = $('#wifiSsid')?.value || '';
      data.wifiPassword = $('#wifiPassword')?.value || '';
      data.wifiSecurity = $('#wifiSecurity')?.value || '';
      data.wifiHidden = $('input[name="wifiHidden"]:checked')?.value || 'No';
      data.customWallpaper = getToggleValue('wallpaperToggle') === 'yes' ? 'Yes' : 'No';
      data.namingConvention = $('input[name="namingConvention"]:checked')?.value || '';
      data.customNamingFormat = $('#customNamingFormat')?.value || '';
      data.restrictionsEnabled = getToggleValue('restrictionsToggle') === 'yes' ? 'Yes' : 'No';
      data.restrictionType = $('input[name="restrictionType"]:checked')?.value || '';
      data.restrictionUrls = $$('input[name="restrictionUrl[]"]').map(i => i.value).filter(Boolean);
      data.guidedAccessPasscode = getToggleValue('guidedAccessToggle') === 'yes' ? ($('#guidedAccessPasscode')?.value || '') : '';
      data.lockdownMode = getToggleValue('guidedAccessToggle') === 'yes' ? 'Guided Access' : '';
      data.appLoginEnabled = getToggleValue('appLoginToggle') === 'yes' ? 'Yes' : 'No';
      const loginApps = $$('.app-login-checkboxes input[name="appLogin"]:checked').map(cb => cb.value);
      data.appLoginApps = loginApps;
      // Web clips
      const webClipNames = $$('input[name="webClipName[]"]').map(i => i.value).filter(Boolean);
      const webClipUrls = $$('input[name="webClipUrl[]"]').map(i => i.value).filter(Boolean);
      if (webClipNames.length) data.webClips = webClipNames;
      if (webClipUrls.length) data.webClipUrls = webClipUrls;
      data.mediaInstructions = $('#mediaInstructions')?.value || '';
      data.additionalComments = $('#anythingElse')?.value || '';
    } else {
      // Package/Mode flow fields
      data.allAppsAllDevices = getToggleValue(`pkg${p}AllAppsToggle`) !== 'no' ? 'Yes' : 'No';
      data.homeScreenLayout = $(`input[name="pkg${p}HomeScreenLayout"]:checked`)?.value || '';
      data.customLayoutDescription = $(`[name="pkg${p}CustomLayoutDesc"]`)?.value || '';
      data.locationServices = $(`input[name="pkg${p}LocationServices"]:checked`)?.value || '';
      data.wifiEnabled = getToggleValue(`pkg${p}WifiToggle`) === 'yes' ? 'Yes' : 'No';
      data.wifiSsid = $(`#pkg${p}WifiSsid`)?.value || '';
      data.wifiPassword = $(`#pkg${p}WifiPassword`)?.value || '';
      data.wifiSecurity = $(`#pkg${p}WifiSecurity`)?.value || '';
      data.wifiHidden = $(`input[name="pkg${p}WifiHidden"]:checked`)?.value || 'No';
      data.customWallpaper = getToggleValue(`pkg${p}WallpaperToggle`) === 'yes' ? 'Yes' : 'No';
      data.restrictionsEnabled = getToggleValue(`pkg${p}RestrictionsToggle`) === 'yes' ? 'Yes' : 'No';
      data.appLoginEnabled = getToggleValue(`pkg${p}AppLoginToggle`) === 'yes' ? 'Yes' : 'No';

      if (p === 'Kiosk') {
        data.lockdownMode = $('input[name="pkgKioskLockdownMode"]:checked')?.value || '';
        data.guidedAccessPasscode = $(`#pkgKioskGuidedAccessPasscode`)?.value || '';
        const clips = $$('input[name="pkgKioskWebClipName[]"]').map(i => i.value).filter(Boolean);
        data.webClips = clips;
        const clipUrls = $$('input[name="pkgKioskWebClipUrl[]"]').map(i => i.value).filter(Boolean);
        data.webClipUrls = clipUrls;
        // Restriction type (Whitelist/Blacklist) and URLs
        data.restrictionType = $('input[name="pkgKioskRestrictionType"]:checked')?.value || '';
        data.restrictionUrls = $$('input[name="pkgKioskRestrictionUrl[]"]').map(i => i.value).filter(Boolean);
      }

      const loginApps = $$('.pkg-app-login-checkboxes input[name="pkgAppLogin"]:checked').map(cb => cb.value);
      data.appLoginApps = loginApps;
    }

    return data;
  };

  const submitForm = async () => {
    if (!validateStep('step-6')) return;

    if (!COMMAND_CENTER_URL || COMMAND_CENTER_URL.includes('YOUR_COMMAND_CENTER')) {
      showToast('Command Center URL not configured. Update COMMAND_CENTER_URL in app.js.', 'warning');
      return;
    }

    dom.btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
    dom.btnSubmit.disabled = true;

    try {
      const data = collectSubmissionData();

      const res = await fetch(`${COMMAND_CENTER_URL}/api/dcr/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (result.status === 'success' || result.status === 'partial') {
        // Upload any attached files from the dropzone Map
        const fileFieldMap = [
          { id: 'wallpaperArtwork', category: 'wallpaper' },
          { id: 'quickWallpaper', category: 'wallpaper' },
          { id: 'pkgRegWallpaper', category: 'wallpaper' },
          { id: 'pkgKioskWallpaper', category: 'wallpaper' },
          { id: 'vpnProfile', category: 'vpn_profile' },
          { id: 'configProfile', category: 'config_profile' },
          { id: 'appLoginCredentials', category: 'credentials' },
          { id: 'pkgRegLoginCredentials', category: 'credentials' },
          { id: 'pkgLcLoginCredentials', category: 'credentials' },
          { id: 'pkgPosLoginCredentials', category: 'credentials' },
          { id: 'pkgKioskLoginCredentials', category: 'credentials' },
          { id: 'mediaUpload', category: 'media' },
        ];

        const submissionId = result.id;
        if (submissionId) {
          const formData = new FormData();
          let hasFiles = false;
          fileFieldMap.forEach(({ id: fileId, category }) => {
            const stored = uploadedFiles.get(fileId);
            if (!stored) return;
            const files = Array.isArray(stored) ? stored : [stored];
            files.forEach(file => {
              if (file instanceof File) {
                formData.append('files', file);
                formData.append('categories', category);
                hasFiles = true;
              }
            });
          });
          if (hasFiles) {
            try {
              const uploadRes = await fetch(`${COMMAND_CENTER_URL}/api/dcr/${submissionId}/upload`, {
                method: 'POST',
                body: formData,
              });
              const uploadResult = await uploadRes.json();
              console.log('[DCR] Files uploaded successfully:', uploadResult);
            } catch (e) {
              console.warn('[DCR] File upload failed:', e.message);
            }
          } else {
            console.log('[DCR] No files to upload');
          }
        }

        showToast('Configuration submitted successfully! Provisioning has been triggered.', 'success');
        localStorage.removeItem(STORAGE_KEY);

        setTimeout(() => {
          window.location.reload();
        }, 2500);
      } else {
        throw new Error(result.message || 'Submission failed');
      }

    } catch (e) {
      console.error('Submission error:', e);
      showToast('An error occurred during submission. Please try again.', 'error');
      dom.btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Configuration';
      dom.btnSubmit.disabled = false;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // UI HELPERS (TOAST)
  // ═══════════════════════════════════════════════════════════════════════════

  const showToast = (message, type = 'info') => {
    const container = dom.toastContainer;
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `cmi-toast cmi-toast-${type}`;
    
    const iconMap = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      info: 'fa-circle-info',
      warning: 'fa-triangle-exclamation'
    };
    
    toast.innerHTML = `
      <i class="fa-solid ${iconMap[type]}"></i>
      <div class="cmi-toast-msg">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, TOAST_DURATION);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // APP STORE SEARCH (iTunes Search API)
  // ═══════════════════════════════════════════════════════════════════════════

  const selectedApps = [];          // Array of { trackId, name, developer, icon, price, url }
  let appSearchTimer = null;
  const APP_SEARCH_DELAY = 350;     // ms debounce

  /** Search the iTunes Search API for iPad/iPhone apps */
  const searchAppStore = async (query) => {
    if (!query || query.length < 2) return [];

    const mapResults = (data) => (data.results || []).map(app => ({
      trackId:   app.trackId,
      name:      app.trackName,
      developer: app.artistName,
      icon:      app.artworkUrl100 || app.artworkUrl60,
      price:     app.formattedPrice || 'Free',
      bundleId:  app.bundleId,
      url:       app.trackViewUrl || ''
    }));

    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=software&limit=8&country=US`;

    // Try direct fetch first (works if CORS allows it)
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        return mapResults(data);
      }
    } catch (_) { /* CORS blocked, fall through to JSONP */ }

    // Fallback: JSONP
    return new Promise((resolve) => {
      const cbName = 'itunesCb' + Date.now();
      const timer = setTimeout(() => { done([]); }, 6000);

      const done = (results) => {
        clearTimeout(timer);
        try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
        document.querySelector(`script[data-cb="${cbName}"]`)?.remove();
        resolve(results);
      };

      window[cbName] = (data) => done(mapResults(data));

      const s = document.createElement('script');
      s.setAttribute('data-cb', cbName);
      s.src = `${url}&callback=${cbName}`;
      s.onerror = () => done([]);
      document.head.appendChild(s);
    });
  };

  /** Render search results dropdown */
  const renderSearchResults = (results) => {
    const container = $('#appSearchResults');
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = `
        <div class="cmi-app-search-empty">
          <i class="fa-solid fa-magnifying-glass"></i>
          No apps found. Try a different search term.
        </div>`;
      container.hidden = false;
      return;
    }

    // Filter out already-selected apps
    const filtered = results.filter(r => !selectedApps.some(s => s.trackId === r.trackId));

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="cmi-app-search-empty">
          <i class="fa-solid fa-circle-check"></i>
          All matching apps are already selected.
        </div>`;
      container.hidden = false;
      return;
    }

    container.innerHTML = filtered.map(app => `
      <div class="cmi-app-result" data-track-id="${app.trackId}" data-name="${escapeAttr(app.name)}" data-developer="${escapeAttr(app.developer)}" data-icon="${escapeAttr(app.icon)}" data-price="${escapeAttr(app.price)}" data-bundle-id="${escapeAttr(app.bundleId || '')}" data-url="${escapeAttr(app.url || '')}">
        <img class="cmi-app-result-icon" src="${app.icon}" alt="${escapeAttr(app.name)}" loading="lazy">
        <div class="cmi-app-result-info">
          <div class="cmi-app-result-name">${escapeHtml(app.name)}</div>
          <div class="cmi-app-result-developer">${escapeHtml(app.developer)}</div>
        </div>
        <span class="cmi-app-result-price">${escapeHtml(app.price)}</span>
      </div>`).join('');

    container.hidden = false;
  };

  /** Add an app to the selected list */
  const selectApp = (appData) => {
    if (selectedApps.some(a => a.trackId === appData.trackId)) return;

    selectedApps.push(appData);
    renderSelectedApps();
    triggerAutoSave();
  };

  /** Remove an app from the selected list */
  const removeSelectedApp = (trackId) => {
    const idx = selectedApps.findIndex(a => a.trackId === trackId);
    if (idx !== -1) {
      selectedApps.splice(idx, 1);
      renderSelectedApps();
      triggerAutoSave();
    }
  };

  /** Render the selected apps chips */
  const renderSelectedApps = () => {
    const list = $('#selectedAppsList');
    const countEl = $('#selectedAppsCount');

    const appHtml = selectedApps.length === 0 ? '' : selectedApps.map(app => {
      const isPaid = app.price && app.price !== 'Free';
      return `
      <div class="cmi-selected-app${isPaid ? ' cmi-selected-app-paid' : ''}" data-track-id="${app.trackId}">
        <img class="cmi-selected-app-icon" src="${app.icon}" alt="${escapeAttr(app.name)}" loading="lazy">
        <div class="cmi-selected-app-info">
          <div class="cmi-selected-app-name">${escapeHtml(app.name)}${isPaid ? ` <span class="cmi-app-price-tag">${escapeHtml(app.price)}</span>` : ' <span class="cmi-app-free-tag">Free</span>'}</div>
          <div class="cmi-selected-app-developer">${escapeHtml(app.developer)}</div>
          ${isPaid ? `<div class="cmi-app-license-notice"><i class="fa-solid fa-triangle-exclamation"></i> Fello installs apps with licenses (not an Apple\u00A0ID). Each device installing this app will be charged <strong>${escapeHtml(app.price)}</strong> per device.</div>` : ''}
        </div>
        <button type="button" class="cmi-selected-app-remove" data-track-id="${app.trackId}" title="Remove ${escapeAttr(app.name)}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`;
    }).join('');

    // Render into ALL selected apps containers (main + package-specific)
    const allLists = $$('.cmi-selected-apps');
    allLists.forEach(el => { el.innerHTML = appHtml; });

    // Update all count elements
    const allCounts = $$('.cmi-selected-apps-count');
    allCounts.forEach(el => {
      if (selectedApps.length === 0) {
        el.hidden = true;
      } else {
        el.hidden = false;
        const span = el.querySelector('span');
        if (span) span.textContent = selectedApps.length;
      }
    });

    // Update cost indicator
    updateAppCostIndicator();
  };

  /** Calculate and display estimated app licensing cost */
  const updateAppCostIndicator = () => {
    const costEl = $('#appCostValue');
    const indicator = $('#appCostIndicator');
    if (!costEl) return;

    // Determine which "all apps" toggle is active based on the current package
    const pkg = getActivePackage();
    const prefixMap = {
      'Check-in Mode': 'Reg',
      'Lead Capture Mode': 'Lc',
      'POS Mode': 'Pos',
      'Kiosk Mode': 'Kiosk',
    };
    const p = prefixMap[pkg];
    const toggleName = p ? `pkg${p}AllAppsToggle` : 'allAppsAllDevicesToggle';
    const allDevicesMode = getToggleValue(toggleName) !== 'no';

    // Determine the correct per-device assignment container
    const containerMap = {
      Reg: 'pkgRegPerDeviceAssignmentList',
      Lc: 'pkgLcPerDeviceAssignmentList',
      Pos: 'pkgPosPerDeviceAssignmentList',
      Kiosk: 'pkgKioskPerDeviceAssignmentList',
    };
    const assignContainerId = p ? containerMap[p] : 'perDeviceAssignmentList';

    let totalCost = 0;

    if (allDevicesMode) {
      // All apps on all devices: per-device cost × total devices
      let perDeviceCost = 0;
      selectedApps.forEach(app => {
        if (app.price && app.price !== 'Free') {
          const priceNum = parseFloat(app.price.replace(/[^0-9.]/g, ''));
          if (!isNaN(priceNum)) perDeviceCost += priceNum;
        }
      });

      let totalDevices = 0;
      const deviceDisplay = $('#deviceListDisplay');
      if (deviceDisplay) {
        if (deviceDisplay.dataset.totalDevices) {
          totalDevices = parseInt(deviceDisplay.dataset.totalDevices) || 0;
        } else {
          const matches = deviceDisplay.textContent.match(/(\d+)\s*x\s/gi);
          if (matches) {
            matches.forEach(m => {
              const num = parseInt(m);
              if (!isNaN(num)) totalDevices += num;
            });
          }
        }
      }
      if (totalDevices === 0) totalDevices = 1;
      totalCost = perDeviceCost * totalDevices;

    } else {
      // Per-device assignment mode: sum assigned quantities for each paid app
      const assignContainer = $(`#${assignContainerId}`);
      selectedApps.forEach(app => {
        if (app.price && app.price !== 'Free') {
          const priceNum = parseFloat(app.price.replace(/[^0-9.]/g, ''));
          if (isNaN(priceNum)) return;

          // Query only within the active assignment container
          let appDeviceCount = 0;
          if (assignContainer) {
            const qtyInputs = assignContainer.querySelectorAll(`input[name^="assign_app_${app.trackId}_qty_"]`);
            qtyInputs.forEach(input => {
              const qty = parseInt(input.value) || 0;
              if (qty > 0) appDeviceCount += qty;
            });
          }
          totalCost += priceNum * appDeviceCount;
        }
      });
    }

    costEl.textContent = `$${totalCost.toFixed(2)}`;

    if (indicator) {
      indicator.classList.toggle('has-cost', totalCost > 0);
    }

    // Sync to all package cost indicators
    $$('.pkg-app-cost-value').forEach(el => {
      el.textContent = `$${totalCost.toFixed(2)}`;
    });
    $$('.pkg-cost-indicator').forEach(el => {
      el.classList.toggle('has-cost', totalCost > 0);
    });

    // Sync overall cost summary
    if (typeof updateOverallCost === 'function') updateOverallCost();
  };

  /** HTML/attr escape helpers */
  const escapeHtml = (str) => {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  const escapeAttr = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  /** Initialize App Store search listeners */
  const initAppSearch = () => {
    const input = $('#appSearchInput');
    const results = $('#appSearchResults');
    const spinner = $('#appSearchSpinner');
    console.log('[CMI] initAppSearch:', { input: !!input, results: !!results, spinner: !!spinner });
    if (!input) return;

    // Dynamic placeholder based on selected config package
    const packagePlaceholders = {
      'Check-in Mode': 'Search for Eventbrite, Cvent, Swoogo, Splash, RSVPify...',
      'Lead Capture Mode': 'Search for iCapture, Leadature, CompuLead, Cvent LeadCapture...',
      'POS Mode': 'Search for Square, Toast, Shopify, Lightspeed, Stripe...',
      'Kiosk Mode': 'Search for KioWare, SureFox, Kiosk Pro, SurveyMonkey...',
      'Custom Configuration': 'Start typing an app name...'
    };
    const defaultPlaceholder = 'Start typing an app name...';

    document.querySelectorAll('input[name="configPackage"]').forEach(radio => {
      radio.addEventListener('change', () => {
        input.placeholder = packagePlaceholders[radio.value] || defaultPlaceholder;
      });
    });

    // Debounced search on keyup
    input.addEventListener('input', () => {
      clearTimeout(appSearchTimer);
      const query = input.value.trim();

      if (query.length < 2) {
        results.hidden = true;
        results.innerHTML = '';
        spinner.hidden = true;
        return;
      }

      spinner.hidden = false;

      appSearchTimer = setTimeout(async () => {
        const apps = await searchAppStore(query);
        spinner.hidden = true;
        renderSearchResults(apps);
      }, APP_SEARCH_DELAY);
    });

    // Click on a search result to select it
    results.addEventListener('click', (e) => {
      const item = e.target.closest('.cmi-app-result');
      if (!item) return;

      selectApp({
        trackId:   parseInt(item.dataset.trackId),
        name:      item.dataset.name,
        developer: item.dataset.developer,
        icon:      item.dataset.icon,
        price:     item.dataset.price,
        bundleId:  item.dataset.bundleId,
        url:       item.dataset.url || ''
      });

      // Clear search
      input.value = '';
      results.hidden = true;
      results.innerHTML = '';
      input.focus();

      showToast(`Added "${item.dataset.name}"`, 'success');
    });

    // Remove selected app
    document.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.cmi-selected-app-remove');
      if (!removeBtn) return;

      const trackId = parseInt(removeBtn.dataset.trackId);
      const app = selectedApps.find(a => a.trackId === trackId);
      removeSelectedApp(trackId);
      if (app) showToast(`Removed "${app.name}"`, 'info');
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.cmi-app-search-wrapper')) {
        results.hidden = true;
      }
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        results.hidden = true;
      }
    });
  };

  /** Wire up all package app search inputs to share the same selectedApps */
  const initPackageAppSearches = () => {
    const prefixes = ['pkg-reg-', 'pkg-lc-', 'pkg-pos-', 'pkg-kiosk-'];

    prefixes.forEach(prefix => {
      const input = $(`#${prefix}appSearchInput`);
      const results = $(`#${prefix}appSearchResults`);
      const spinner = $(`#${prefix}appSearchSpinner`);
      if (!input || !results) return;

      // Update placeholder based on package
      const pkgPlaceholders = {
        'pkg-reg-': 'Search for Eventbrite, Cvent, Swoogo, Splash, RSVPify...',
        'pkg-lc-': 'Search for iCapture, Leadature, CompuLead, Cvent LeadCapture...',
        'pkg-pos-': 'Search for Square, Toast, Shopify, Lightspeed, Stripe...',
        'pkg-kiosk-': 'Search for KioWare, SureFox, Kiosk Pro, SurveyMonkey...',
      };
      if (pkgPlaceholders[prefix]) input.placeholder = pkgPlaceholders[prefix];

      input.addEventListener('input', () => {
        clearTimeout(appSearchTimer);
        const query = input.value.trim();

        if (query.length < 2) {
          results.hidden = true;
          results.innerHTML = '';
          if (spinner) spinner.hidden = true;
          return;
        }

        if (spinner) spinner.hidden = false;

        appSearchTimer = setTimeout(async () => {
          const apps = await searchAppStore(query);
          if (spinner) spinner.hidden = true;

          // Render results into this package's results container
          if (!apps.length) {
            results.innerHTML = '<div class="cmi-app-result-empty">No apps found.</div>';
            results.hidden = false;
            return;
          }

          results.innerHTML = apps.map(app => `
            <div class="cmi-app-result" data-track-id="${app.trackId}" data-name="${escapeAttr(app.name)}"
                 data-developer="${escapeAttr(app.developer || '')}" data-icon="${escapeAttr(app.icon || '')}"
                 data-price="${escapeAttr(app.price || 'Free')}" data-bundle-id="${escapeAttr(app.bundleId || '')}" data-url="${escapeAttr(app.url || '')}">
              <img class="cmi-app-result-icon" src="${escapeAttr(app.icon || '')}" alt="" loading="lazy">
              <div class="cmi-app-result-info">
                <span class="cmi-app-result-name">${escapeHtml(app.name)}</span>
                <span class="cmi-app-result-dev">${escapeHtml(app.developer || '')}</span>
              </div>
              <span class="cmi-app-result-price">${escapeHtml(app.price || 'Free')}</span>
            </div>
          `).join('');
          results.hidden = false;
        }, APP_SEARCH_DELAY);
      });

      results.addEventListener('click', (e) => {
        const item = e.target.closest('.cmi-app-result');
        if (!item) return;

        selectApp({
          trackId: parseInt(item.dataset.trackId),
          name: item.dataset.name,
          developer: item.dataset.developer,
          icon: item.dataset.icon,
          price: item.dataset.price,
          bundleId: item.dataset.bundleId,
          url: item.dataset.url || ''
        });

        input.value = '';
        results.hidden = true;
        results.innerHTML = '';
        input.focus();
        showToast(`Added "${item.dataset.name}"`, 'success');
      });

      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.cmi-app-search-wrapper')) {
          results.hidden = true;
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') results.hidden = true;
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PER-DEVICE APP ASSIGNMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get the device types from the order lookup */
  const getOrderDevices = () => {
    const deviceDisplay = $('#deviceListDisplay');
    if (!deviceDisplay) return [];

    const devices = [];
    const text = deviceDisplay.textContent;
    const regex = /(\d+)\s*x\s+(.+?)(?:\n|$)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      devices.push({ qty: parseInt(match[1]), name: match[2].trim() });
    }
    return devices;
  };

  /** Refresh the per-device assignment UI for a specific container */
  const refreshPerDeviceAssignmentFor = (container) => {
    if (!container) return;

    const devices = getOrderDevices();

    // Gather all items: selected apps + web clips
    const items = [];
    selectedApps.forEach(app => {
      items.push({ id: `app_${app.trackId}`, name: app.name, icon: app.icon, source: 'App Store' });
    });
    $$('input[name="webClipName[]"]').forEach((input, i) => {
      const name = input.value.trim();
      if (name) items.push({ id: `webclip_${i}`, name, icon: null, source: 'Web Clip' });
    });

    // Hide placeholder if present
    const placeholder = container.querySelector('.cmi-text-muted');
    if (placeholder) placeholder.hidden = items.length > 0;

    // Remove old cards
    container.querySelectorAll('.cmi-device-assign-card').forEach(el => el.remove());

    if (items.length === 0) return;

    let html = '';
    items.forEach(item => {
      const iconHtml = item.icon
        ? `<img src="${item.icon}" alt="" style="width:32px;height:32px;border-radius:8px;">`
        : `<i class="fa-solid fa-globe" style="font-size:24px;color:var(--cmi-accent);width:32px;text-align:center;"></i>`;

      let deviceRows = '';
      if (devices.length > 0) {
        devices.forEach((dev, idx) => {
          deviceRows += `
            <div class="cmi-device-assign-row">
              <label class="cmi-checkbox-label" style="flex:1;margin:0;">
                <input type="checkbox" class="cmi-checkbox" name="assign_${item.id}_device_${idx}" value="${escapeAttr(dev.name)}">
                <span class="cmi-checkbox-custom"></span> ${escapeHtml(dev.name)}
              </label>
              <div style="display:flex;align-items:center;gap:6px;">
                <label style="font-size:var(--fs-xs);color:var(--cmi-text-muted);">Qty:</label>
                <input type="number" class="cmi-input" name="assign_${item.id}_qty_${idx}" value="0" min="0" max="${dev.qty}" style="width:70px;padding:6px 8px;font-size:var(--fs-sm);">
                <span style="font-size:var(--fs-xs);color:var(--cmi-text-muted);">of ${dev.qty}</span>
              </div>
            </div>`;
        });
      } else {
        deviceRows = `<p class="cmi-text-muted" style="margin:0;font-size:var(--fs-xs);">Look up your order on Step 1 to see available devices.</p>`;
      }

      html += `
        <div class="cmi-device-assign-card">
          <div class="cmi-device-assign-header">
            ${iconHtml}
            <div>
              <div style="font-weight:600;color:var(--cmi-text);">${escapeHtml(item.name)}</div>
              <div style="font-size:var(--fs-xs);color:var(--cmi-text-muted);">${item.source}</div>
            </div>
          </div>
          <div class="cmi-device-assign-body">
            ${deviceRows}
          </div>
        </div>`;
    });

    container.insertAdjacentHTML('beforeend', html);
  };

  /** Refresh ALL per-device assignment containers */
  const refreshPerDeviceAssignment = () => {
    const containerIds = [
      'perDeviceAssignmentList',
      'pkgRegPerDeviceAssignmentList',
      'pkgLcPerDeviceAssignmentList',
      'pkgPosPerDeviceAssignmentList',
      'pkgKioskPerDeviceAssignmentList'
    ];
    containerIds.forEach(id => {
      const el = $(`#${id}`);
      if (el) refreshPerDeviceAssignmentFor(el);
    });
  };

  const initPerDeviceAssignment = () => {
    // Bind all "all apps" toggle buttons (custom + packages)
    const allToggleNames = [
      'allAppsAllDevicesToggle',
      'pkgRegAllAppsToggle',
      'pkgLcAllAppsToggle',
      'pkgPosAllAppsToggle',
      'pkgKioskAllAppsToggle'
    ];

    allToggleNames.forEach(toggleName => {
      const toggleBtns = $$(`[data-toggle="${toggleName}"] .cmi-toggle-btn`);
      toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.value === 'no') {
            setTimeout(refreshPerDeviceAssignment, 100);
          }
          setTimeout(updateAppCostIndicator, 150);
        });
      });
    });

    // Recalculate cost when assignment quantities change (delegated)
    const containerIds = [
      'perDeviceAssignmentList',
      'pkgRegPerDeviceAssignmentList',
      'pkgLcPerDeviceAssignmentList',
      'pkgPosPerDeviceAssignmentList',
      'pkgKioskPerDeviceAssignmentList'
    ];
    containerIds.forEach(id => {
      const container = $(`#${id}`);
      if (container) {
        container.addEventListener('input', (e) => {
          if (e.target.matches('input[type="number"]')) {
            updateAppCostIndicator();
          }
        });
      }
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // APP LOGIN CHECKBOXES (dynamic from selected apps + web clips)
  // ═══════════════════════════════════════════════════════════════════════════

  const refreshAppLoginCheckboxes = () => {
    // Gather dynamic apps
    const dynamicApps = [];
    selectedApps.forEach(app => {
      dynamicApps.push({ name: app.name, source: 'App Store' });
    });
    $$('input[name="webClipName[]"]').forEach(input => {
      const name = input.value.trim();
      if (name) dynamicApps.push({ name, source: 'Web Clip' });
    });

    // Update the custom flow container
    const container = $('#appLoginCheckboxes');
    const placeholder = $('#appLoginPlaceholder');
    if (container) {
      container.querySelectorAll('.cmi-app-login-dynamic').forEach(el => el.remove());
      if (placeholder) placeholder.hidden = dynamicApps.length > 0;
      const refNode = container.firstChild;
      dynamicApps.forEach(app => {
        const label = document.createElement('label');
        label.className = 'cmi-checkbox-label cmi-app-login-dynamic';
        label.innerHTML = `
          <input type="checkbox" name="appLogin" value="${escapeAttr(app.name)}" class="cmi-checkbox">
          <span class="cmi-checkbox-custom"></span> ${escapeHtml(app.name)} <span style="color:var(--cmi-text-muted);font-size:var(--fs-xs);margin-left:4px;">(${app.source})</span>
        `;
        container.insertBefore(label, refNode);
      });
    }

    // Update all package login checkbox grids
    $$('.pkg-app-login-checkboxes').forEach(pkgContainer => {
      pkgContainer.querySelectorAll('.cmi-app-login-dynamic').forEach(el => el.remove());
      const pkgPlaceholder = pkgContainer.querySelector('.pkg-app-login-placeholder');
      if (pkgPlaceholder) pkgPlaceholder.hidden = dynamicApps.length > 0;
      const ref = pkgContainer.firstChild;
      dynamicApps.forEach(app => {
        const label = document.createElement('label');
        label.className = 'cmi-checkbox-label cmi-app-login-dynamic';
        label.innerHTML = `
          <input type="checkbox" name="pkgAppLogin" value="${escapeAttr(app.name)}" class="cmi-checkbox">
          <span class="cmi-checkbox-custom"></span> ${escapeHtml(app.name)} <span style="color:var(--cmi-text-muted);font-size:var(--fs-xs);margin-left:4px;">(${app.source})</span>
        `;
        pkgContainer.insertBefore(label, ref);
      });
    });
  };

  const initAppLoginCheckboxes = () => {
    // Bind all login toggles (custom + packages)
    const loginToggleNames = [
      'appLoginToggle',
      'pkgRegAppLoginToggle',
      'pkgLcAppLoginToggle',
      'pkgPosAppLoginToggle',
      'pkgKioskAppLoginToggle'
    ];
    loginToggleNames.forEach(toggleName => {
      const toggleBtns = $$(`[data-toggle="${toggleName}"] .cmi-toggle-btn`);
      toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.value === 'yes') {
            setTimeout(refreshAppLoginCheckboxes, 50);
          }
        });
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // OVERALL CMI COST CALCULATOR
  // ═══════════════════════════════════════════════════════════════════════════

  const updateOverallCost = () => {
    // Get total devices
    let totalDevices = 0;
    const deviceDisplay = $('#deviceListDisplay');
    if (deviceDisplay && deviceDisplay.dataset.totalDevices) {
      totalDevices = parseInt(deviceDisplay.dataset.totalDevices) || 0;
    } else if (deviceDisplay) {
      const matches = deviceDisplay.textContent.match(/(\d+)\s*x\s/gi);
      if (matches) matches.forEach(m => { totalDevices += parseInt(m) || 0; });
    }

    // Check if any "Additional Fee" options are active (custom flow)
    const customAddon =
      getToggleValue('webClipToggle') === 'yes' ||
      getToggleValue('guidedAccessToggle') === 'yes' ||
      getToggleValue('mediaToggle') === 'yes' ||
      getToggleValue('appLoginToggle') === 'yes';

    // Check package-specific "Additional Fee" options
    const pkgAddon =
      getToggleValue('pkgRegAppLoginToggle') === 'yes' ||
      getToggleValue('pkgLcAppLoginToggle') === 'yes' ||
      getToggleValue('pkgPosAppLoginToggle') === 'yes' ||
      getToggleValue('pkgKioskAppLoginToggle') === 'yes' ||
      ($('input[name="pkgKioskLockdownMode"]:checked')?.value === 'Guided Access') ||
      getToggleValue('pkgKioskWebClipToggle') === 'yes';

    // Check partner panel addons — only app login (device sign-in) incurs a fee
    // Wi-Fi config is FREE for partner orders
    const partnerAddon = isPartnerOrder && (
      $('#posLoginToggle')?.checked || false
    );

    const hasAddon = customAddon || pkgAddon || partnerAddon;

    // Partner orders: $0 base, $5/device ONLY for app login (device sign-in)
    // Wi-Fi and all other partner configs are free
    // Fello/OR orders: $5/device base, $10/device with addons
    let baseRate, baseCost;
    if (isPartnerOrder) {
      baseRate = partnerAddon ? 5 : 0;
      baseCost = 0;
    } else {
      baseRate = hasAddon ? 10 : 5;
      baseCost = 5 * totalDevices;
    }
    const addonUpcharge = hasAddon ? 5 * totalDevices : 0;

    // Get app licensing cost from the existing indicator
    const appCostText = $('#appCostValue')?.textContent || '$0.00';
    const appLicenseCost = parseFloat(appCostText.replace(/[^0-9.]/g, '')) || 0;

    const grandTotal = (baseRate * totalDevices) + appLicenseCost;

    // Update UI
    const el = (id) => document.getElementById(id);
    if (el('cmiBaseRate')) el('cmiBaseRate').textContent = `$${baseRate.toFixed(2)}`;
    if (el('cmiDeviceCount')) el('cmiDeviceCount').textContent = totalDevices;
    if (el('cmiBaseCost')) el('cmiBaseCost').textContent = `$${baseCost.toFixed(2)}`;

    const addonLine = el('cmiAddonLine');
    if (addonLine) {
      addonLine.hidden = !hasAddon;
      if (el('cmiAddonCost')) el('cmiAddonCost').textContent = `$${addonUpcharge.toFixed(2)}`;
    }

    if (el('cmiAppLicenseCost')) el('cmiAppLicenseCost').textContent = `$${appLicenseCost.toFixed(2)}`;
    if (el('cmiGrandTotal')) el('cmiGrandTotal').textContent = `$${grandTotal.toFixed(2)}`;
    if (el('cmiTotalCost')) el('cmiTotalCost').textContent = `$${grandTotal.toFixed(2)}`;
  };

  const initOverallCost = () => {
    // Toggle the cost breakdown open/closed
    const toggle = $('#cmiCostSummaryToggle');
    const body = $('#cmiCostSummaryBody');
    if (toggle && body) {
      toggle.addEventListener('click', () => {
        body.classList.toggle('open');
        toggle.classList.toggle('open');
      });
    }

    // Listen for any toggle button clicks to recalculate
    document.addEventListener('click', (e) => {
      if (e.target.closest('.cmi-toggle-btn')) {
        setTimeout(updateOverallCost, 200);
      }
    });

    // Initial calculation
    updateOverallCost();
  };

  // Patch updateAppCostIndicator to also update overall cost
  const _origUpdateAppCost = updateAppCostIndicator;

  // ═══════════════════════════════════════════════════════════════════════════
  // KIOSK LOCKDOWN MODE
  // ═══════════════════════════════════════════════════════════════════════════

  const initKioskLockdownMode = () => {
    const radios = $$('input[name="pkgKioskLockdownMode"]');
    const guidedAccessField = $('#pkgKioskGuidedAccessField');
    if (!radios.length) return;

    const update = () => {
      const mode = $('input[name="pkgKioskLockdownMode"]:checked')?.value;
      if (guidedAccessField) guidedAccessField.hidden = mode !== 'Guided Access';
      // Trigger cost recalculation since Guided Access has an additional fee
      if (typeof updateOverallCost === 'function') setTimeout(updateOverallCost, 50);
    };

    radios.forEach(r => r.addEventListener('change', update));
    update(); // Set initial state
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // NAMING CONVENTION PREVIEW
  // ═══════════════════════════════════════════════════════════════════════════

  const updateNamingPreview = () => {
    const preview = $('#namingPreview');
    if (!preview) return;
    const company = $('#companyName')?.value?.trim() || 'Company Name';
    preview.textContent = `${company} 01, ${company} 02, ...`;
  };

  const initNamingPreview = () => {
    const companyInput = $('#companyName');
    if (companyInput) {
      companyInput.addEventListener('input', updateNamingPreview);
    }
    // Also update when navigating to Step 5
    updateNamingPreview();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. CUSTOM LAYOUT TEXTAREA TOGGLE
  // ═══════════════════════════════════════════════════════════════════════════

  const initCustomLayoutToggles = () => {
    const layoutNames = ['pkgRegHomeScreenLayout', 'pkgLcHomeScreenLayout', 'pkgPosHomeScreenLayout', 'homeScreenLayout'];
    layoutNames.forEach(name => {
      const radios = document.querySelectorAll(`input[name="${name}"]`);
      const customArea = document.querySelector(`[data-layout-custom="${name}"]`);
      if (!radios.length || !customArea) return;

      const updateVisibility = () => {
        const selected = document.querySelector(`input[name="${name}"]:checked`);
        if (selected && selected.value === 'Custom') {
          customArea.classList.add('open');
          customArea.style.maxHeight = customArea.scrollHeight + 'px';
          setTimeout(() => customArea.style.maxHeight = 'none', 400);
        } else {
          customArea.style.maxHeight = customArea.scrollHeight + 'px';
          customArea.offsetHeight;
          customArea.style.maxHeight = '0';
          customArea.classList.remove('open');
        }
      };

      radios.forEach(radio => {
        radio.addEventListener('change', updateVisibility);
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // QUICK SETUP
  // ═══════════════════════════════════════════════════════════════════════════

  const initQuickSetup = () => {
    const quickSetup = $('#quickSetup');
    const advancedSelector = $('#advancedModeSelector');
    if (!quickSetup) return;

    // --- Toggle tile expand/collapse ---
    const tiles = [
      { toggle: '#quickAppsToggle', body: '#quickAppsBody', tile: '#quickTileApps' },
      { toggle: '#quickWifiToggle', body: '#quickWifiBody', tile: '#quickTileWifi' },
      { toggle: '#quickWallpaperToggle', body: '#quickWallpaperBody', tile: '#quickTileWallpaper' },
    ];

    tiles.forEach(({ toggle, body, tile }) => {
      const toggleEl = $(toggle);
      const bodyEl = $(body);
      const tileEl = $(tile);
      const headerEl = tileEl?.querySelector('.cmi-quick-tile-header');
      if (!toggleEl || !bodyEl || !tileEl) return;

      const update = () => {
        const checked = toggleEl.checked;
        bodyEl.style.display = checked ? '' : 'none';
        tileEl.classList.toggle('active', checked);
      };

      toggleEl.addEventListener('change', update);
      // Clicking the header also toggles (unless clicking the switch itself)
      headerEl?.addEventListener('click', (e) => {
        if (e.target.closest('.cmi-switch')) return;
        toggleEl.checked = !toggleEl.checked;
        toggleEl.dispatchEvent(new Event('change'));
      });
    });

    // --- Quick App Search (mirrors main app search but for quick setup) ---
    const quickInput = $('#quickAppSearchInput');
    const quickResults = $('#quickAppSearchResults');
    const quickSpinner = $('#quickAppSearchSpinner');
    const quickSelectedContainer = $('#quickSelectedAppsContainer');

    if (quickInput && quickResults) {
      let quickTimer = null;

      quickInput.addEventListener('input', () => {
        clearTimeout(quickTimer);
        const query = quickInput.value.trim();
        if (query.length < 2) {
          quickResults.hidden = true;
          quickResults.innerHTML = '';
          if (quickSpinner) quickSpinner.hidden = true;
          return;
        }
        if (quickSpinner) quickSpinner.hidden = false;

        quickTimer = setTimeout(async () => {
          const apps = await searchAppStore(query);
          if (quickSpinner) quickSpinner.hidden = true;
          if (!apps.length) {
            quickResults.innerHTML = '<div class="cmi-app-result-empty">No apps found.</div>';
            quickResults.hidden = false;
            return;
          }
          const filtered = apps.filter(r => !selectedApps.some(s => s.trackId === r.trackId));
          quickResults.innerHTML = filtered.map(app => `
            <div class="cmi-app-result" data-track-id="${app.trackId}" data-name="${escapeAttr(app.name)}"
                 data-developer="${escapeAttr(app.developer || '')}" data-icon="${escapeAttr(app.icon || '')}"
                 data-price="${escapeAttr(app.price || 'Free')}" data-bundle-id="${escapeAttr(app.bundleId || '')}" data-url="${escapeAttr(app.url || '')}">
              <img class="cmi-app-result-icon" src="${escapeAttr(app.icon || '')}" alt="" loading="lazy">
              <div class="cmi-app-result-info">
                <span class="cmi-app-result-name">${escapeHtml(app.name)}</span>
                <span class="cmi-app-result-dev">${escapeHtml(app.developer || '')}</span>
              </div>
              <span class="cmi-app-result-price">${escapeHtml(app.price || 'Free')}</span>
            </div>
          `).join('');
          quickResults.hidden = false;
        }, APP_SEARCH_DELAY);
      });

      quickResults.addEventListener('click', (e) => {
        const item = e.target.closest('.cmi-app-result');
        if (!item) return;
        selectApp({
          trackId: parseInt(item.dataset.trackId),
          name: item.dataset.name,
          developer: item.dataset.developer,
          icon: item.dataset.icon,
          price: item.dataset.price,
          bundleId: item.dataset.bundleId,
          url: item.dataset.url || ''
        });
        quickInput.value = '';
        quickResults.hidden = true;
        quickResults.innerHTML = '';
        showToast(`Added "${item.dataset.name}"`, 'success');
      });

      // Close results when clicking outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#quickTileApps')) {
          quickResults.hidden = true;
        }
      });
    }

    // --- "Submit Configuration" button (Quick Submit) ---
    $('#btnQuickSubmit')?.addEventListener('click', () => {
      // Validate step 1 fields (Order, Event, Contact)
      if (!validateStep('step-1')) return;

      // Validate quick Wi-Fi fields if enabled
      const wifiOn = $('#quickWifiToggle')?.checked;
      if (wifiOn) {
        const ssid = $('#quickWifiSsid')?.value?.trim();
        const pass = $('#quickWifiPassword')?.value?.trim();
        if (!ssid || !pass) {
          showToast('Please fill in the Wi-Fi network name and password.', 'error');
          return;
        }
      }

      // Set quick submit mode and go through group steps
      quickSubmitMode = true;

      // If group hub is active, mark iOS as configured and return to hub
      const hubActive = $('#groupSelectorHub')?.style.display !== 'none';
      if (hubActive) {
        window._dcrGroupConfigured = window._dcrGroupConfigured || {};
        window._dcrGroupConfigured.ios = true;
        const iosCard = document.querySelector('.cmi-group-card[data-group="ios"]');
        if (iosCard) iosCard.classList.add('configured');

        // Hide Quick Setup, scroll back to hub
        const qs = $('#quickSetup');
        if (qs) qs.style.display = 'none';
        $('#groupSelectorHub')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('iOS device configuration saved.', 'success');
        return;
      }

      const built = buildGroupNavChain(['step-1', 'step-6'], ['Order Info', 'Review']);
      navChain = built.chain;
      navLabels = built.labels;
      navIndex = 1;
      goToStep(1, true);
    });

    // --- "More Customizations" button ---
    $('#btnMoreCustomizations')?.addEventListener('click', () => {
      quickSubmitMode = false;
      quickSetup.style.display = 'none';
      advancedSelector.style.display = '';
      advancedSelector.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALISATION
  // ═══════════════════════════════════════════════════════════════════════════

  const init = () => {
    // Bind main nav buttons
    dom.btnBack?.addEventListener('click', () => goToStep(navIndex - 1, true));
    dom.btnNext?.addEventListener('click', () => goToStep(navIndex + 1));
    dom.btnSubmit?.addEventListener('click', submitForm);

    // Bind package selection to switch flow
    $$('input[name="configPackage"]').forEach(radio => {
      radio.addEventListener('change', updateFlowForPackage);
    });

    // Initialise UI components
    initToggles();
    initRadioConditionals();
    initRepeaters();

    initAllFileDropZones();
    initPasswordToggles();
    initLookupOrder();
    initAppSearch();
    initPackageAppSearches();
    initCustomLayoutToggles();
    initNamingPreview();
    initAppLoginCheckboxes();
    initPerDeviceAssignment();
    initOverallCost();
    initAutoSaveListeners();
    initKioskLockdownMode();
    initQuickSetup();

    // Recalculate app cost when device quantities change
    document.addEventListener('input', (e) => {
      if (e.target.matches('input[name="ipadQty[]"]')) {
        updateAppCostIndicator();
      }
    });

    goToStep(0, true); // Start at first step (index 0)
  };

  // Run on load
  document.addEventListener('DOMContentLoaded', init);

})();
