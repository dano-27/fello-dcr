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

  const getActivePackage = () => $('input[name="configPackage"]:checked')?.value || '';

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

    if (config) {
      navChain = config.chain;
      navLabels = config.labels;
    } else {
      navChain = CUSTOM_CHAIN;
      navLabels = CUSTOM_LABELS;
    }

    // If we're still on step 1, just rebuild progress bar
    if (navIndex === 0) {
      rebuildProgressBar();
    }
  };

  const goToStep = (targetIndex, skipValidation = false) => {
    // Validate current step when moving forward
    if (targetIndex > navIndex && !skipValidation) {
      if (!validateStep(navChain[navIndex])) return;
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
    // Home Screen Layout Custom
    const layoutRadios = $$('input[name="homeScreenLayout"]');
    const customLayoutContent = $('#customLayoutContent');
    layoutRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (!customLayoutContent) return;
        if (radio.value === 'Custom') {
          customLayoutContent.classList.add('open');
          customLayoutContent.style.maxHeight = customLayoutContent.scrollHeight + 'px';
          setTimeout(() => customLayoutContent.style.maxHeight = 'none', 400);
        } else {
          customLayoutContent.style.maxHeight = customLayoutContent.scrollHeight + 'px';
          customLayoutContent.offsetHeight;
          customLayoutContent.style.maxHeight = '0';
          customLayoutContent.classList.remove('open');
        }
        triggerAutoSave();
      });
    });

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

  const initLookupOrder = () => {
    const btn = $('#btnLookup');
    const orderNumber = $('#orderNumber');
    
    if (!btn || !orderNumber) return;
    
    btn.addEventListener('click', () => {
      if (!orderNumber.value.trim()) {
        showToast('Please enter an order number first.', 'error');
        return;
      }
      
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      btn.disabled = true;
      
      // Simulate API call
      setTimeout(() => {
        // Auto-fill mock data
        $('#eventName').value = 'Tech Conference 2026';
        $('#eventDates').value = 'Nov 1 - Nov 5, 2026';
        $('#venueName').value = 'Moscone Center';
        $('#companyName').value = 'Acme Corp';
        $('#primaryContactName').value = 'Jane Doe';
        $('#contactEmail').value = 'jane@acme.com';
        $('#contactPhone').value = '(555) 123-4567';
        
        // Populate Device Info
        const deviceDisplay = $('#deviceListDisplay');
        if (deviceDisplay) {
          deviceDisplay.dataset.totalDevices = '20';
          deviceDisplay.innerHTML = `
            <ul style="list-style: none; padding: 0; margin: 0; font-weight: 500;">
              <li style="margin-bottom: 8px;"><i class="fa-solid fa-check" style="color: var(--cmi-success); margin-right: 8px;"></i> 15x iPad Pro 12.9"</li>
              <li><i class="fa-solid fa-check" style="color: var(--cmi-success); margin-right: 8px;"></i> 5x iPhone 14</li>
            </ul>
          `;
        }
        
        // Recalculate app costs with new device count
        updateAppCostIndicator();
        
        // Reset button
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Found';
        btn.disabled = false;
        
        showToast('Order details found and populated.', 'success');
        triggerAutoSave();
      }, 1000);
    });
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
    orderHtml += buildRow('Configuration Mode', pkg);
    html += buildSection('Order & Event Info', orderHtml, 'fa-address-card');

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

      // Device Lockdown Mode (Kiosk)
      const lockdownMode = $('input[name="pkgKioskLockdownMode"]:checked')?.value;
      if (lockdownMode) {
        configHtml += buildRow('Device Lockdown Mode', lockdownMode);
        if (lockdownMode === 'Guided Access') {
          configHtml += buildRow('Guided Access Passcode', $(`#pkgKioskGuidedAccessPasscode`)?.value || '(not set)');
        }
      }

      // Web Clips (Kiosk)
      if (getToggleValue('pkgKioskWebClipToggle') === 'yes') {
        const clips = $$('input[name="pkgKioskWebClipName[]"]').map(i => i.value).filter(Boolean);
        if (clips.length) configHtml += buildRow('Web Clips', clips.join(', '));
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

  const submitForm = async () => {
    if (!validateStep('step-6')) return;

    dom.btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
    dom.btnSubmit.disabled = true;

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      showToast('CMI Configuration submitted successfully!', 'success');
      localStorage.removeItem(STORAGE_KEY);
      
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (e) {
      showToast('An error occurred during submission. Please try again.', 'error');
      dom.btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit';
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

  const selectedApps = [];          // Array of { trackId, name, developer, icon, price }
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
      bundleId:  app.bundleId
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
      <div class="cmi-app-result" data-track-id="${app.trackId}" data-name="${escapeAttr(app.name)}" data-developer="${escapeAttr(app.developer)}" data-icon="${escapeAttr(app.icon)}" data-price="${escapeAttr(app.price)}" data-bundle-id="${escapeAttr(app.bundleId || '')}">
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
        bundleId:  item.dataset.bundleId
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
                 data-price="${escapeAttr(app.price || 'Free')}" data-bundle-id="${escapeAttr(app.bundleId || '')}">
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
          bundleId: item.dataset.bundleId
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

    const hasAddon = customAddon || pkgAddon;

    const baseRate = hasAddon ? 10 : 5;
    const addonUpcharge = hasAddon ? 5 * totalDevices : 0;
    const baseCost = 5 * totalDevices;

    // Get app licensing cost from the existing indicator
    const appCostText = $('#appCostValue')?.textContent || '$0.00';
    const appLicenseCost = parseFloat(appCostText.replace(/[^0-9.]/g, '')) || 0;

    const grandTotal = (baseRate * totalDevices) + appLicenseCost;

    // Update UI
    const el = (id) => document.getElementById(id);
    if (el('cmiBaseRate')) el('cmiBaseRate').textContent = `$${hasAddon ? '10.00' : '5.00'}`;
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
      radios.forEach(radio => {
        radio.addEventListener('change', () => {
          customArea.style.display = radio.value === 'Custom' && radio.checked ? 'block' : 'none';
        });
      });
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
