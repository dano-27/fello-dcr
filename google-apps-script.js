// ============================================================================
// Fello DCR - Google Apps Script (Web App)
// 
// SETUP INSTRUCTIONS:
// 1. Go to https://sheets.google.com and create a new spreadsheet
// 2. Name it "Fello DCR Submissions"
// 3. Go to Extensions > Apps Script
// 4. Delete the default code and paste this entire script
// 5. Click "Deploy" > "New deployment"
// 6. Select type: "Web app"
// 7. Set "Execute as": Me
// 8. Set "Who has access": Anyone
// 9. Click "Deploy" and authorize when prompted
// 10. Copy the Web App URL and paste it into app.js (GOOGLE_SCRIPT_URL)
// ============================================================================

/** Shared function: write a parsed data object to the Submissions sheet */
function writeToSheet(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Submissions") || ss.insertSheet("Submissions");
  
  // Create headers on first run
  if (sheet.getLastRow() === 0) {
    var headers = [
      "Timestamp",
      "Order #",
      "Event Name",
      "Event Dates",
      "Venue",
      "Contact Name",
      "Company",
      "Email",
      "Phone",
      "Configuration Mode",
      "Apps to Install",
      "All Apps on All Devices",
      "Home Screen Layout",
      "Custom Layout Description",
      "Location Services",
      "Wi-Fi Enabled",
      "Wi-Fi SSID",
      "Wi-Fi Password",
      "Wi-Fi Security",
      "Custom Wallpaper",
      "Naming Convention",
      "Custom Naming Format",
      "Restrictions Enabled",
      "Restriction Details",
      "Device Lockdown Mode",
      "Guided Access Passcode",
      "Web Clips",
      "App Login Enabled",
      "App Login Apps",
      "Media Instructions",
      "Additional Comments",
      "Raw JSON"
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  
  // Format apps: each app on its own line with URL below it
  var appsText = (data.apps || []).join(", ");
  var appLinks = data.appLinks || [];
  if (appLinks.length > 0) {
    appsText = appLinks.map(function(app) {
      return app.url ? app.name + " | " + app.url : app.name;
    }).join("\n");
  }

  // Build the row
  var row = [
    new Date().toLocaleString(),
    data.orderNumber || "",
    data.eventName || "",
    data.eventDates || "",
    data.venue || "",
    data.contactName || "",
    data.company || "",
    data.email || "",
    data.phone || "",
    data.configMode || "",
    appsText,
    data.allAppsAllDevices || "",
    data.homeScreenLayout || "",
    data.customLayoutDescription || "",
    data.locationServices || "",
    data.wifiEnabled || "No",
    data.wifiSsid || "",
    data.wifiPassword || "",
    data.wifiSecurity || "",
    data.customWallpaper || "No",
    data.namingConvention || "",
    data.customNamingFormat || "",
    data.restrictionsEnabled || "No",
    data.restrictionDetails || "",
    data.lockdownMode || "",
    data.guidedAccessPasscode || "",
    (data.webClips || []).join(", "),
    data.appLoginEnabled || "No",
    (data.appLoginApps || []).join(", "),
    data.mediaInstructions || "",
    data.additionalComments || "",
    JSON.stringify(data)
  ];
  
  sheet.appendRow(row);
  
  // ── Trigger SimpleMDM provisioning via Command Center ──
  // Replace COMMAND_CENTER_URL with your deployed server URL
  var COMMAND_CENTER_URL = 'https://YOUR_COMMAND_CENTER_URL';
  var SIMPLEMDM_API_KEY = 'YOUR_SIMPLEMDM_API_KEY';
  
  try {
    UrlFetchApp.fetch(COMMAND_CENTER_URL + '/api/automation/provision', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-simplemdm-key': SIMPLEMDM_API_KEY
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    });
    Logger.log('Provisioning triggered for: ' + (data.eventName || 'Unknown'));
  } catch (e) {
    Logger.log('Provisioning trigger failed: ' + e.toString());
  }
}

/** Handle GET requests — primary submission method (avoids POST redirect 405) */
function doGet(e) {

  // ── Order Lookup Proxy (IMS NextGen) ──
  if (e.parameter && e.parameter.action === 'lookupOrder') {
    return lookupOrder(e.parameter.orderNumber || '');
  }

  if (e.parameter && e.parameter.payload) {
    try {
      var data = JSON.parse(e.parameter.payload);
      writeToSheet(data);
      return ContentService
        .createTextOutput(JSON.stringify({ status: "success", message: "Submission received" }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", message: "Fello DCR endpoint is live" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Proxy: Look up an order from IMS NextGen and return relevant fields */
function lookupOrder(orderNumber) {
  var IMS_BASE = 'https://ims-v4-migration-prod-876702752852.us-east4.run.app/api/nextgen/v1';
  var IMS_TOKEN = 'Bearer 2423|rydhEvIv6ZsEABia67jH5ffhMUJLthtu3YrfySpx93f5cc0e';

  if (!orderNumber) {
    return jsonResponse({ status: 'error', message: 'Missing order number' });
  }

  try {
    var response = UrlFetchApp.fetch(IMS_BASE + '/orders/' + orderNumber, {
      method: 'get',
      headers: { 'Authorization': IMS_TOKEN },
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code === 404) {
      return jsonResponse({ status: 'not_found', message: 'Order not found: ' + orderNumber });
    }
    if (code !== 200) {
      return jsonResponse({ status: 'error', message: 'IMS API returned ' + code });
    }

    var raw = JSON.parse(response.getContentText());

    // Extract devices from rentals
    var devices = (raw.rentals || []).map(function(r) {
      var model = r.model || {};
      return {
        name: model.model_name || 'Unknown',
        quantity: r.amount || 0,
        category: model.model_category || 0,
        isIpad: r.is_ipad || 0,
        os: model.operating_system || ''
      };
    });

    // Build clean response
    var result = {
      status: 'success',
      order: {
        id: raw.fly_order_id,
        internalId: raw.id,
        customerName: raw.customer_name || '',
        customerPhone: raw.customer_phone || '',
        eventName: raw.event_name || '',
        eventType: raw.event_type || '',
        eventVenue: raw.event_venue || '',
        startDate: raw.start_date || '',
        endDate: raw.end_date || '',
        shipName: raw.ship_name || '',
        shipEmail: raw.ship_email || '',
        shipPhone: raw.ship_phone || '',
        mainContactEmail: raw.main_contact_email || '',
        notes: raw.notes || '',
        status: raw.status || '',
        shipCmi: raw.ship_cmi || '',
        mediaInstallation: raw.media_installation || '',
        devices: devices
      }
    };

    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

/** Helper: return JSON response */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Handle POST requests (fallback) */
function doPost(e) {
  try {
    var raw = (e.parameter && e.parameter.payload) ? e.parameter.payload : e.postData.contents;
    var data = JSON.parse(raw);
    writeToSheet(data);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "success", message: "Submission received" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
