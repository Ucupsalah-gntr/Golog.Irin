const SHEET_NAMES = {
  dashboard: "01_DASHBOARD",
  stock: "02_STOK_GUDANG",
  requests: "03_PERMINTAAN",
  distributions: "04_DISTRIBUSI",
  history: "05_HISTORI",
  items: "06_MASTER_BARANG",
};

const PROP_URL = "GOLOG_SYNC_URL";
const PROP_TOKEN = "GOLOG_SYNC_TOKEN";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Golog.Irin")
    .addItem("Sinkronkan sekarang", "syncGologIrin")
    .addItem("Atur koneksi", "setupGologIrin")
    .addItem("Pasang jadwal 3× sehari", "installGologTriggers")
    .addItem("Hapus jadwal otomatis", "removeGologTriggers")
    .addToUi();
}

function setupGologIrin() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const currentUrl = props.getProperty(PROP_URL) || "https://gologirin.vercel.app/api/sync/google-sheet";

  const urlPrompt = ui.prompt(
    "Koneksi Golog.Irin",
    "URL endpoint sinkronisasi:",
    ui.ButtonSet.OK_CANCEL
  );
  if (urlPrompt.getSelectedButton() !== ui.Button.OK) return;

  const tokenPrompt = ui.prompt(
    "Token sinkronisasi",
    "Masukkan GOOGLE_SHEET_SYNC_TOKEN yang sama dengan Vercel. Token disimpan di Script Properties, bukan di sheet.",
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenPrompt.getSelectedButton() !== ui.Button.OK) return;

  props.setProperties({
    [PROP_URL]: (urlPrompt.getResponseText().trim() || currentUrl),
    [PROP_TOKEN]: tokenPrompt.getResponseText().trim(),
  }, true);

  ui.alert("Koneksi tersimpan. Jalankan menu Golog.Irin → Sinkronkan sekarang.");
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = (props.getProperty(PROP_URL) || "").trim();
  const token = (props.getProperty(PROP_TOKEN) || "").trim();

  if (!url || !token) {
    throw new Error("Koneksi belum diatur. Jalankan menu Golog.Irin → Atur koneksi.");
  }

  return { url, token };
}

function syncGologIrin() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Sinkronisasi lain masih berjalan.");

  try {
    const config = getConfig_();
    const response = UrlFetchApp.fetch(config.url, {
      method: "get",
      muteHttpExceptions: true,
      headers: {
        "x-golog-sync-token": config.token,
      },
    });

    const status = response.getResponseCode();
    const body = response.getContentText();

    if (status !== 200) {
      throw new Error("Golog.Irin mengembalikan HTTP " + status + ": " + body.slice(0, 500));
    }

    const payload = JSON.parse(body);
    if (!payload.ok) {
      throw new Error(payload.message || "Sinkronisasi gagal.");
    }

    writeStock_(payload.stock || []);
    writeRequests_(payload.requests || []);
    writeDistributions_(payload.distributions || []);
    writeHistory_(payload.movements || []);
    writeItems_(payload.items || []);
    writeDashboard_(payload);

    PropertiesService.getScriptProperties()
      .setProperty("LAST_SYNC_AT", new Date().toISOString());

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function replaceData_(sheetName, headers, rows) {
  const sheet = getSheet_(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#dff5eb");

  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function writeStock_(rows) {
  const today = new Date();
  const output = rows.map(r => {
    const stock = Number(r.stockQty || 0);
    const min = Number(r.minStock || 0);
    return [
      today,
      r.sku || "",
      r.name || "",
      r.category || "",
      r.unit || "",
      stock,
      min,
      stock <= min ? "PERLU CEK" : "AMAN",
    ];
  });

  const sheet = replaceData_(
    SHEET_NAMES.stock,
    ["Tanggal Sync", "SKU", "Nama Barang", "Kategori", "Satuan", "Stok Gudang", "Minimum Stok", "Status"],
    output
  );

  if (output.length) {
    const statusRange = sheet.getRange(2, 8, output.length, 1);
    const rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("PERLU CEK")
        .setBackground("#fff2cc")
        .setFontColor("#7f6000")
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("AMAN")
        .setBackground("#e2f0d9")
        .setFontColor("#38761d")
        .setRanges([statusRange])
        .build(),
    ];
    sheet.setConditionalFormatRules(rules);
  }
}

function writeRequests_(rows) {
  replaceData_(
    SHEET_NAMES.requests,
    ["Tanggal", "No Request", "Ruangan", "Prioritas", "SKU", "Nama Barang", "Diminta", "Disetujui", "Status"],
    rows.map(r => [
      r.date ? new Date(r.date) : "",
      r.requestNo || "",
      r.room || "",
      r.priority || "",
      r.sku || "",
      r.itemName || "",
      Number(r.requestedQty || 0),
      Number(r.approvedQty || 0),
      r.status || "",
    ])
  );
}

function writeDistributions_(rows) {
  replaceData_(
    SHEET_NAMES.distributions,
    ["Tanggal", "No Request", "Ruangan", "SKU", "Nama Barang", "Jumlah"],
    rows.map(r => [
      r.date ? new Date(r.date) : "",
      r.requestNo || "",
      r.room || "",
      r.sku || "",
      r.itemName || "",
      Number(r.quantity || 0),
    ])
  );
}

function writeHistory_(rows) {
  replaceData_(
    SHEET_NAMES.history,
    ["Tanggal", "SKU", "Nama Barang", "Jenis Movement", "Jumlah", "Ruangan", "Gudang", "No Request", "Catatan"],
    rows.map(r => [
      r.date ? new Date(r.date) : "",
      r.sku || "",
      r.itemName || "",
      r.movementType || "",
      Number(r.quantity || 0),
      r.room || "",
      r.warehouse || "",
      r.requestNo || "",
      r.notes || "",
    ])
  );
}

function writeItems_(rows) {
  replaceData_(
    SHEET_NAMES.items,
    ["SKU", "Nama Barang", "Kategori", "Satuan", "Minimum Stok"],
    rows.map(r => [
      r.sku || "",
      r.name || "",
      r.category || "",
      r.unit || "",
      Number(r.minStock || 0),
    ])
  );
}

function writeDashboard_(payload) {
  const stock = payload.stock || [];
  const requests = payload.requests || [];
  const distributions = payload.distributions || [];

  const lowCount = stock.filter(r => Number(r.stockQty || 0) <= Number(r.minStock || 0)).length;
  const pendingCount = requests.filter(r => r.status === "submitted").length;

  const todayKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Jakarta", "yyyy-MM-dd");
  const distributionToday = distributions
    .filter(r => r.date && Utilities.formatDate(new Date(r.date), Session.getScriptTimeZone() || "Asia/Jakarta", "yyyy-MM-dd") === todayKey)
    .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

  const sheet = getSheet_(SHEET_NAMES.dashboard);
  sheet.clear();

  sheet.getRange("A1:F1").merge();
  sheet.getRange("A1").setValue("GOLOG.IRIN — MONITORING BMHP ICU");
  sheet.getRange("A1").setFontSize(18).setFontWeight("bold").setBackground("#c9f3d7");

  const cards = [
    ["TOTAL JENIS BARANG", stock.length],
    ["AMAN", stock.length - lowCount],
    ["PERLU CEK", lowCount],
    ["PERMINTAAN MENUNGGU", pendingCount],
    ["DISTRIBUSI HARI INI", distributionToday],
    ["HISTORI (90 HARI)", (payload.movements || []).length],
  ];

  sheet.getRange(3, 1, cards.length, 2).setValues(cards);
  sheet.getRange(3, 1, cards.length, 1).setFontWeight("bold");
  sheet.getRange(3, 2, cards.length, 1).setFontSize(14).setFontWeight("bold");

  sheet.getRange("D3:F3").merge();
  sheet.getRange("D3").setValue("TERAKHIR SINKRONISASI");
  sheet.getRange("D3").setFontWeight("bold");
  sheet.getRange("D4:F4").merge();
  sheet.getRange("D4").setValue(new Date(payload.generatedAt || new Date()));
  sheet.getRange("D4").setNumberFormat("dd mmm yyyy hh:mm:ss");

  sheet.getRange("A11:F11").merge();
  sheet.getRange("A11").setValue("BARANG PERLU PERHATIAN");
  sheet.getRange("A11").setFontWeight("bold").setBackground("#fff2cc");

  const attention = stock
    .filter(r => Number(r.stockQty || 0) <= Number(r.minStock || 0))
    .sort((a, b) => (Number(a.stockQty) - Number(a.minStock)) - (Number(b.stockQty) - Number(b.minStock)))
    .slice(0, 15)
    .map(r => [
      r.sku || "",
      r.name || "",
      Number(r.stockQty || 0),
      Number(r.minStock || 0),
      r.unit || "",
    ]);

  sheet.getRange("A12:E12").setValues([["SKU", "Barang", "Stok", "Minimum", "Satuan"]]).setFontWeight("bold");
  if (attention.length) sheet.getRange(13, 1, attention.length, 5).setValues(attention);

  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, 6);
}

function installGologTriggers() {
  removeGologTriggers();

  [7, 12, 18].forEach(hour => {
    ScriptApp.newTrigger("syncGologIrin")
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
  });

  SpreadsheetApp.getUi().alert("Jadwal sinkronisasi dipasang untuk sekitar pukul 07.00, 12.00, dan 18.00.");
}

function removeGologTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "syncGologIrin")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function testGologConnection() {
  syncGologIrin();
  SpreadsheetApp.getUi().alert("Sinkronisasi berhasil.");
}
