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
  const now = new Date();
  const todayKey = Utilities.formatDate(now, sessionTz, "yyyy-MM-dd");

  const toDateKey_ = value => {
    if (!value) return "";
    const date = new Date(value);
    return isNaN(date.getTime()) ? "" : Utilities.formatDate(date, sessionTz, "yyyy-MM-dd");
  };

  const lowStock = stock
    .filter(r => Number(r.stockQty || 0) <= Number(r.minStock || 0))
    .map(r => ({
      ...r,
      stockQty: Number(r.stockQty || 0),
      minStock: Number(r.minStock || 0),
    }))
    .sort((a, b) => {
      const gapA = a.stockQty - a.minStock;
      const gapB = b.stockQty - b.minStock;
      return gapA - gapB;
    });

  const criticalStock = lowStock.filter(r => r.stockQty <= 0);
  const minimumStock = lowStock.filter(r => r.stockQty > 0);
  const safeStockCount = Math.max(stock.length - lowStock.length, 0);
  const totalWarehouseQty = stock.reduce((sum, r) => sum + Number(r.stockQty || 0), 0);

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
        lines: 0,
      };
    }

    pendingMap[key].requestedQty += Number(r.requestedQty || 0);
    pendingMap[key].lines += 1;
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

  const pendingEmergency = pendingRows.filter(r => r.priority === "darurat");
  const pendingUrgent = pendingRows.filter(r => r.priority === "mendesak");

  const todayDistribution = {};
  distributions.forEach(r => {
    if (toDateKey_(r.date) !== todayKey) return;
    const room = r.room || "Ruangan";
    todayDistribution[room] = (todayDistribution[room] || 0) + Number(r.quantity || 0);
  });

  const distributionToday = Object.keys(todayDistribution)
    .reduce((sum, room) => sum + todayDistribution[room], 0);

  const last7Key = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const distribution7 = distributions
    .filter(r => {
      if (!r.date) return false;
      const date = new Date(r.date);
      return !isNaN(date.getTime()) && date >= new Date(last7Key.getFullYear(), last7Key.getMonth(), last7Key.getDate());
    })
    .reduce((sum, r) => sum + Number(r.quantity || 0), 0);

  const distributionRows = Object.keys(todayDistribution)
    .map(room => [room, todayDistribution[room]])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const statusCounts = [
    ["AMAN", safeStockCount],
    ["PERLU CEK", minimumStock.length],
    ["KOSONG", criticalStock.length],
  ];

  const sheet = getSheet_(SHEET_NAMES.dashboard);
  sheet.clear();
  sheet.getCharts().forEach(chart => sheet.removeChart(chart));
  sheet.setConditionalFormatRules([]);
  sheet.setHiddenGridlines(true);

  // Canvas.
  sheet.setColumnWidth(1, 105);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 75);
  sheet.setColumnWidth(4, 105);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 75);
  sheet.setColumnWidth(7, 20);
  sheet.setColumnWidth(8, 115);
  sheet.setColumnWidth(9, 150);
  sheet.setColumnWidth(10, 88);
  sheet.setColumnWidth(11, 105);
  sheet.setColumnWidth(12, 85);

  for (let r = 1; r <= 42; r++) sheet.setRowHeight(r, 21);

  // Header.
  sheet.getRange("A1:L1").merge();
  sheet.getRange("A1").setValue("GOLOG.IRIN — MONITORING KEPALA GUDANG");
  sheet.getRange("A1")
    .setFontSize(20)
    .setFontWeight("bold")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);

  sheet.getRange("A2:L2").merge();
  sheet.getRange("A2").setValue(
    "BMHP ICU • Fokus: kondisi stok, barang kritis, permintaan, dan distribusi"
  );
  sheet.getRange("A2")
    .setFontSize(10)
    .setFontColor("#666666")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 24);

  // KPI blocks.
  const cards = [
    { range: "A4:C6", label: "JENIS BARANG", value: stock.length, note: "item aktif" },
    { range: "D4:F6", label: "STOK GUDANG", value: totalWarehouseQty, note: "total unit" },
    { range: "H4:J6", label: "AMAN", value: safeStockCount, note: "di atas minimum" },
    { range: "K4:L6", label: "KOSONG", value: criticalStock.length, note: "stok = 0" },
    { range: "A8:C10", label: "PERLU CEK", value: minimumStock.length, note: "menyentuh minimum" },
    { range: "D8:F10", label: "MENUNGGU", value: Object.keys(pendingMap).length, note: "request aktif" },
    { range: "H8:J10", label: "DISTRIBUSI HARI INI", value: distributionToday, note: "unit ke ruangan" },
    { range: "K8:L10", label: "DARURAT / MENDESAK", value: pendingEmergency.length + pendingUrgent.length, note: "baris prioritas tinggi" },
  ];

  cards.forEach(card => {
    const range = sheet.getRange(card.range);
    const startRow = range.getRow();
    const startCol = range.getColumn();
    const numCols = range.getNumColumns();

    [0, 1, 2].forEach(offset => {
      sheet.getRange(startRow + offset, startCol, 1, numCols).merge();
    });

    sheet.getRange(startRow, startCol).setValue(card.label);
    sheet.getRange(startRow + 1, startCol).setValue(card.value);
    sheet.getRange(startRow + 2, startCol).setValue(card.note);

    sheet.getRange(startRow, startCol, 3, numCols)
      .setBorder(true, true, true, true, false, false)
      .setVerticalAlignment("middle");

    sheet.getRange(startRow, startCol)
      .setFontSize(9)
      .setFontWeight("bold")
      .setFontColor("#666666");

    sheet.getRange(startRow + 1, startCol)
      .setFontSize(18)
      .setFontWeight("bold");

    sheet.getRange(startRow + 2, startCol)
      .setFontSize(8)
      .setFontColor("#777777");
  });

  // Operational summary.
  sheet.getRange("A12:F12").merge();
  sheet.getRange("A12").setValue("RINGKASAN OPERASIONAL");
  sheet.getRange("A12").setFontSize(12).setFontWeight("bold");

  sheet.getRange("A13:F16").setValues([
    ["Indikator", "Nilai", "Keterangan", "", "", ""],
    ["Distribusi 7 hari", distribution7, "akumulasi unit", "", "", ""],
    ["Histori 90 hari", movements.length, "catatan movement", "", "", ""],
    ["Sync terakhir", payload.generatedAt ? new Date(payload.generatedAt) : "", "waktu server", "", "", ""],
  ]);
  sheet.getRange("A13:C16").setBorder(true, true, true, true, true, true);
  sheet.getRange("A13:C13").setFontWeight("bold");
  sheet.getRange("B15").setNumberFormat("0");
  sheet.getRange("B16").setNumberFormat("dd MMM yyyy HH:mm");

  sheet.getRange("H12:L12").merge();
  sheet.getRange("H12").setValue("PRIORITAS TINDAKAN");
  sheet.getRange("H12").setFontSize(12).setFontWeight("bold");

  sheet.getRange("H13:L16").setValues([
    ["Kondisi", "Jumlah", "Makna", "", ""],
    ["KOSONG", criticalStock.length, "perlu tindakan segera", "", ""],
    ["DARURAT", pendingEmergency.length, "permintaan prioritas tinggi", "", ""],
    ["MENDESAK", pendingUrgent.length, "permintaan prioritas", "", ""],
  ]);
  sheet.getRange("H13:L16").setBorder(true, true, true, true, true, true);
  sheet.getRange("H13:J13").setFontWeight("bold");

  // Attention list.
  sheet.getRange("A18:F18").merge();
  sheet.getRange("A18").setValue("BARANG PERLU PERHATIAN");
  sheet.getRange("A18").setFontSize(12).setFontWeight("bold");

  sheet.getRange("A19:F19").setValues([
    ["SKU", "BARANG", "STOK", "MINIMUM", "SELISIH", "STATUS"],
  ]);
  sheet.getRange("A19:F19").setFontWeight("bold").setHorizontalAlignment("center");

  const attention = lowStock.slice(0, 10).map(r => [
    r.sku || "",
    r.name || "",
    r.stockQty,
    r.minStock,
    r.stockQty - r.minStock,
    r.stockQty <= 0 ? "KOSONG" : "PERLU CEK",
  ]);

  if (attention.length) {
    sheet.getRange(20, 1, attention.length, 6).setValues(attention);
    sheet.getRange(20, 3, attention.length, 3).setNumberFormat("0");
  } else {
    sheet.getRange("A20:F20").merge().setValue("Semua stok berada di atas minimum.");
    sheet.getRange("A20").setFontColor("#38761d");
  }

  // Pending requests.
  sheet.getRange("H18:L18").merge();
  sheet.getRange("H18").setValue("PERMINTAAN MENUNGGU");
  sheet.getRange("H18").setFontSize(12).setFontWeight("bold");

  sheet.getRange("H19:L19").setValues([
    ["NO REQUEST", "RUANGAN", "PRIORITAS", "TGL", "QTY"],
  ]);
  sheet.getRange("H19:L19").setFontWeight("bold").setHorizontalAlignment("center");

  const pendingOutput = pendingList.map(r => [
    r.requestNo,
    r.room,
    String(r.priority || "").toUpperCase(),
    r.date ? new Date(r.date) : "",
    r.requestedQty,
  ]);

  if (pendingOutput.length) {
    sheet.getRange(20, 8, pendingOutput.length, 5).setValues(pendingOutput);
    sheet.getRange(20, 11, pendingOutput.length, 1).setNumberFormat("0");
    sheet.getRange(20, 10, pendingOutput.length, 1).setNumberFormat("dd MMM");
  } else {
    sheet.getRange("H20:L20").merge().setValue("Tidak ada permintaan yang menunggu.");
    sheet.getRange("H20").setFontColor("#38761d");
  }

  // Distribution today + chart source.
  sheet.getRange("A32:F32").merge();
  sheet.getRange("A32").setValue("DISTRIBUSI HARI INI PER RUANGAN");
  sheet.getRange("A32").setFontSize(12).setFontWeight("bold");

  sheet.getRange("A33:B33").setValues([["RUANGAN", "JUMLAH"]]);
  sheet.getRange("A33:B33").setFontWeight("bold");

  if (distributionRows.length) {
    sheet.getRange(34, 1, distributionRows.length, 2).setValues(distributionRows);
    sheet.getRange(34, 2, distributionRows.length, 1).setNumberFormat("0");
  } else {
    sheet.getRange("A34:B34").merge().setValue("Belum ada distribusi hari ini.");
    sheet.getRange("A34").setFontColor("#777777");
  }

  sheet.getRange("D32:E32").setValues([["STATUS STOK", "JUMLAH"]]);
  sheet.getRange("D32:E32").setFontWeight("bold");
  sheet.getRange("D33:E35").setValues(statusCounts);

  try {
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange("D32:E35"))
      .setPosition(32, 7, 0, 0)
      .setOption("title", "Komposisi Status Stok")
      .setOption("pieHole", 0.48)
      .setOption("legend", { position: "right" })
      .setOption("width", 500)
      .setOption("height", 255)
      .build();
    sheet.insertChart(chart);
  } catch (error) {
    Logger.log("Dashboard chart skipped: " + error);
  }

  sheet.getRange("A42:L42").merge();
  sheet.getRange("A42").setValue(
    "Catatan: Golog.Irin adalah sumber data utama. Google Sheet digunakan untuk monitoring dan analitik. " +
    "Status stok: Stok ≤ Minimum Stok = PERLU CEK."
  );
  sheet.getRange("A42")
    .setFontSize(9)
    .setFontColor("#666666")
    .setWrap(true);

  // Number/date formatting + freeze.
  sheet.getRange("A1:L42").setVerticalAlignment("middle").setWrap(true);
  sheet.setFrozenRows(2);

  // Attention status highlighting.
  if (attention.length) {
    const statusRange = sheet.getRange(20, 6, attention.length, 1);
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

  // Light emphasis for action numbers.
  if (criticalStock.length) {
    sheet.getRange("K5:L5").setFontColor("#990000");
  }
  if (minimumStock.length) {
    sheet.getRange("A9:C9").setFontColor("#7f6000");
  }
  if (pendingList.length) {
    sheet.getRange("D9:F9").setFontColor("#b45f06");
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
