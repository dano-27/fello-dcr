// ============================================================================
// Fello DCR — Google Apps Script (Web App)
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
