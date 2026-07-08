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

function doPost(e) {
  try {
    // Handle both form POST (payload param) and raw JSON body
    var raw = (e.parameter && e.parameter.payload) ? e.parameter.payload : e.postData.contents;
    var data = JSON.parse(raw);
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
      (data.apps || []).join(", "),
      data.allAppsAllDevices || "",
      data.homeScreenLayout || "",
      data.customLayoutDescription || "",
      data.locationServices || "",
      data.wifiEnabled || "No",
      data.wifiSsid || "",
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
    
    return ContentService
      .createTextOutput(JSON.stringify({ status: "success", message: "Submission received" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Allow GET requests (for testing)
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", message: "Fello DCR endpoint is live" }))
    .setMimeType(ContentService.MimeType.JSON);
}
