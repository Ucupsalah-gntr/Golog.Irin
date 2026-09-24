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
  const movements = payload.movements || [];

  const sessionTz = Session.getScriptTimeZone() || "Asia/Jakarta";
  const todayKey = Utilities.formatDate(new Date(), sessionTz, "yyyy-MM-dd");

  const lowStock = stock
    .filter(r => Number(r.stockQty || 0) <= Number(r.minStock || 0))
    .sort((a, b) => {
      const gapA = Number(a.stockQty || 0) - Number(a.minStock || 0);
      const gapB = Number(b.stockQty || 0) - Number(b.minStock || 0);
      return gapA - gapB;
    });

  const safeStockCount = Math.max(stock.length - lowStock.length, 0);
  const pendingRows = requests.filter(r => r.status === "submitted");

  const pendingMap = {};
  pendingRows.forEach(r => {
    const key = String(r.requestNo || "");
    if (!key) return;
    if (!pendingMap[key]) {
      pendingMap[key] = {
        requestNo: key,
        room: r.room || "Ruangan",
        priority: r.priority || "normal",
        date: r.date || "",
        requestedQty: 0,
      };
    }
    pendingMap[key].requestedQty += Number(r.requestedQty || 0);
  });

  const priorityWeight = { darurat: 0, mendesak: 1, normal: 2 };
  const pendingList = Object.keys(pendingMap)
    .map(key => pendingMap[key])
    .sort((a, b) => {
      const p = (priorityWeight[a.priority] ?? 9) - (priorityWeight[b.priority] ?? 9);
      if (p !== 0) return p;
      return new Date(b.date || 0) - new Date(a.date || 0);
    })
    .slice(0, 8);

  const distributionToday = distributions
    .filter(r => r.date && Utilities.formatDate(new Date(r.date), sessionTz, "yyyy-MM-dd") === todayKey)
    .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

  const totalWarehouseQty = stock.reduce((sum, r) => sum + Number(r.stockQty || 0), 0);

  const todayDistribution = {};
  distributions
    .filter(r => r.date && Utilities.formatDate(new Date(r.date), sessionTz, "yyyy-MM-dd") === todayKey)
    .forEach(r => {
      const room = r.room || "Ruangan";
      todayDistribution[room] = (todayDistribution[room] || 0) + Number(r.quantity || 0);
    });

  const distributionRows = Object.keys(todayDistribution)
    .map(room => [room, todayDistribution[room]])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const sheet = getSheet_(SHEET_NAMES.dashboard);
  sheet.clear();
  sheet.getCharts().forEach(chart => sheet.removeChart(chart));
  sheet.setHiddenGridlines(true);

  // Layout.
  sheet.setColumnWidth(1, 105);
  sheet.setColumnWidth(2, 145);
  sheet.setColumnWidth(3, 85);
  sheet.setColumnWidth(4, 105);
  sheet.setColumnWidth(5, 145);
  sheet.setColumnWidth(6, 85);
  sheet.setColumnWidth(7, 20);
  sheet.setColumnWidth(8, 115);
  sheet.setColumnWidth(9, 155);
  sheet.setColumnWidth(10, 90);
  sheet.setColumnWidth(11, 100);
  sheet.setColumnWidth(12, 95);

  sheet.getRange("A1:L1").merge();
  sheet.getRange("A1").setValue("GOLOG.IRIN — MONITORING BMHP ICU");
  sheet.getRange("A1").setFontSize(20).setFontWeight("bold");
  sheet.setRowHeight(1, 38);

  sheet.getRange("A2:L2").merge();
  sheet.getRange("A2").setValue("Ringkasan gudang, permintaan, dan distribusi • Sumber data utama: Golog.Irin");
  sheet.getRange("A2").setFontSize(10).setFontColor("#666666");
  sheet.setRowHeight(2, 24);

  const cards = [
    { cols: ["A", "C"], row: 4, label: "JENIS BARANG", value: stock.length, note: "item aktif" },
    { cols: ["D", "F"], row: 4, label: "STOK GUDANG", value: totalWarehouseQty, note: "total unit" },
    { cols: ["H", "J"], row: 4, label: "AMAN", value: safeStockCount, note: "di atas minimum" },
    { cols: ["K", "L"], row: 4, label: "PERLU CEK", value: lowStock.length, note: "menyentuh / di bawah minimum" },
    { cols: ["A", "C"], row: 8, label: "MENUNGGU", value: Object.keys(pendingMap).length, note: "permintaan aktif" },
    { cols: ["D", "F"], row: 8, label: "DISTRIBUSI HARI INI", value: distributionToday, note: "unit ke ruangan" },
    { cols: ["H", "J"], row: 8, label: "HISTORI 90 HARI", value: movements.length, note: "catatan movement" },
    { cols: ["K", "L"], row: 8, label: "SYNC TERAKHIR", value: payload.generatedAt ? Utilities.formatDate(new Date(payload.generatedAt), sessionTz, "dd MMM HH:mm") : "-", note: "waktu server" },
  ];

  cards.forEach(card => {
    const startCol = card.cols[0];
    const endCol = card.cols[1];
    sheet.getRange(startCol + card.row + ":" + endCol + card.row).merge();
    sheet.getRange(startCol + (card.row + 1) + ":" + endCol + (card.row + 1)).merge();
    sheet.getRange(startCol + (card.row + 2) + ":" + endCol + (card.row + 2)).merge();

    sheet.getRange(startCol + card.row).setValue(card.label);
    sheet.getRange(startCol + (card.row + 1)).setValue(card.value);
    sheet.getRange(startCol + (card.row + 2)).setValue(card.note);

    sheet.getRange(startCol + card.row)
      .setFontSize(9)
      .setFontWeight("bold")
      .setFontColor("#666666")
      .setVerticalAlignment("middle");
    sheet.getRange(startCol + (card.row + 1))
      .setFontSize(18)
      .setFontWeight("bold")
      .setVerticalAlignment("middle");
    sheet.getRange(startCol + (card.row + 2))
      .setFontSize(8)
      .setFontColor("#777777")
      .setVerticalAlignment("middle");

    sheet.getRange(startCol + card.row + ":" + endCol + (card.row + 2))
      .setBorder(true, true, true, true, false, false);
  });

  sheet.setRowHeights(4, 3, 21);
  sheet.setRowHeights(8, 3, 21);

  // Attention list.
  sheet.getRange("A12:F12").merge();
  sheet.getRange("A12").setValue("BARANG PERLU PERHATIAN");
  sheet.getRange("A12").setFontWeight("bold").setFontSize(12);

  sheet.getRange("A13:F13").setValues([["SKU", "BARANG", "STOK", "MINIMUM", "STATUS", "SATUAN"]]);
  sheet.getRange("A13:F13").setFontWeight("bold").setHorizontalAlignment("center");

  const attention = lowStock.slice(0, 10).map(r => [
    r.sku || "",
    r.name || "",
    Number(r.stockQty || 0),
    Number(r.minStock || 0),
    Number(r.stockQty || 0) <= 0 ? "KOSONG" : "PERLU CEK",
    r.unit || "",
  ]);

  if (attention.length) {
    sheet.getRange(14, 1, attention.length, 6).setValues(attention);
    sheet.getRange(14, 3, attention.length, 2).setNumberFormat("0");
  } else {
    sheet.getRange("A14:F14").merge().setValue("Tidak ada barang yang perlu perhatian.");
    sheet.getRange("A14").setFontColor("#38761d");
  }

  // Pending requests.
  sheet.getRange("H12:L12").merge();
  sheet.getRange("H12").setValue("PERMINTAAN MENUNGGU");
  sheet.getRange("H12").setFontWeight("bold").setFontSize(12);

  sheet.getRange("H13:L13").setValues([["NO REQUEST", "RUANGAN", "PRIORITAS", "TANGGAL", "QTY DIMINTA"]]);
  sheet.getRange("H13:L13").setFontWeight("bold").setHorizontalAlignment("center");

  const pendingOutput = pendingList.map(r => [
    r.requestNo,
    r.room,
    String(r.priority || "").toUpperCase(),
    r.date ? new Date(r.date) : "",
    r.requestedQty,
  ]);

  if (pendingOutput.length) {
    sheet.getRange(14, 8, pendingOutput.length, 5).setValues(pendingOutput);
    sheet.getRange(14, 11, pendingOutput.length, 1).setNumberFormat("0");
    sheet.getRange(14, 11, pendingOutput.length, 1).setHorizontalAlignment("center");
  } else {
    sheet.getRange("H14:L14").merge().setValue("Tidak ada permintaan yang menunggu.");
    sheet.getRange("H14").setFontColor("#38761d");
  }

  // Distribution today.
  sheet.getRange("A27:F27").merge();
  sheet.getRange("A27").setValue("DISTRIBUSI HARI INI");
  sheet.getRange("A27").setFontWeight("bold").setFontSize(12);

  sheet.getRange("A28:B28").setValues([["RUANGAN", "JUMLAH"]]);
  sheet.getRange("A28:B28").setFontWeight("bold");
  if (distributionRows.length) {
    sheet.getRange(29, 1, distributionRows.length, 2).setValues(distributionRows);
    sheet.getRange(29, 2, distributionRows.length, 1).setNumberFormat("0");
  } else {
    sheet.getRange("A29:B29").merge().setValue("Belum ada distribusi hari ini.");
    sheet.getRange("A29").setFontColor("#777777");
  }

  // Stock status chart.
  sheet.getRange("D27:E27").setValues([["STATUS STOK", "JUMLAH"]]);
  sheet.getRange("D27:E27").setFontWeight("bold");
  sheet.getRange("D28:E29").setValues([
    ["AMAN", safeStockCount],
    ["PERLU CEK", lowStock.length],
  ]);

  try {
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange("D27:E29"))
      .setPosition(27, 7, 0, 0)
      .setOption("title", "Status Stok Gudang")
      .setOption("pieHole", 0.45)
      .setOption("legend", { position: "right" })
      .setOption("width", 500)
      .setOption("height", 260)
      .build();
    sheet.insertChart(chart);
  } catch (error) {
    Logger.log("Dashboard chart skipped: " + error);
  }

  sheet.getRange("H27:L27").merge();
  sheet.getRange("H27").setValue("CATATAN");
  sheet.getRange("H27").setFontWeight("bold").setFontSize(12);

  sheet.getRange("H28:L31").merge();
  sheet.getRange("H28").setValue(
    "Golog.Irin adalah sumber data utama. Google Sheet digunakan untuk monitoring dan analitik.\n\n" +
    "Status stok: Stok ≤ Minimum Stok = PERLU CEK."
  );
  sheet.getRange("H28").setWrap(true).setVerticalAlignment("top");

  // General formatting.
  sheet.getRange("A1:L31")
    .setVerticalAlignment("middle")
    .setWrap(true);
  sheet.getRange("A13:L13").setFontSize(9);
  sheet.setFrozenRows(2);

  const statusRange = sheet.getRange("E14:E23");
  if (attention.length) {
    const rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("KOSONG")
        .setBackground("#f4cccc")
        .setFontColor("#990000")
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("PERLU CEK")
        .setBackground("#fff2cc")
        .setFontColor("#7f6000")
        .setRanges([statusRange])
        .build(),
    ];
    sheet.setConditionalFormatRules(rules);
  }
}
function showUiMessage_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    Logger.log(message);
  }
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

  showUiMessage_("Jadwal sinkronisasi dipasang untuk sekitar pukul 07.00, 12.00, dan 18.00.");
}

function removeGologTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "syncGologIrin")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  Logger.log("Jadwal sinkronisasi otomatis dihapus.");
}

function testGologConnection() {
  syncGologIrin();
  showUiMessage_("Sinkronisasi berhasil.");
}
