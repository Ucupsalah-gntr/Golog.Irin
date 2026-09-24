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

  const C = {
    navy: "#111827",
    indigo: "#4F46E5",
    blueBg: "#E0F2FE",
    blueText: "#0369A1",
    greenBg: "#DCFCE7",
    greenText: "#15803D",
    amberBg: "#FEF3C7",
    amberText: "#B45309",
    redBg: "#FEE2E2",
    redText: "#B91C1C",
    purpleBg: "#EDE9FE",
    purpleText: "#6D28D9",
    tealBg: "#CCFBF1",
    tealText: "#0F766E",
    pinkBg: "#FCE7F3",
    pinkText: "#BE185D",
    slateBg: "#F8FAFC",
    border: "#E5E7EB",
    muted: "#64748B",
    white: "#FFFFFF",
    text: "#0F172A",
  };

  const toDateKey_ = value => {
    if (!value) return "";
    const date = new Date(value);
    return isNaN(date.getTime()) ? "" : Utilities.formatDate(date, sessionTz, "yyyy-MM-dd");
  };

  const lowStock = stock
    .map(r => ({
      ...r,
      stockQty: Number(r.stockQty || 0),
      minStock: Number(r.minStock || 0),
    }))
    .filter(r => r.stockQty <= r.minStock)
    .sort((a, b) => (a.stockQty - a.minStock) - (b.stockQty - b.minStock));

  const criticalStock = lowStock.filter(r => r.stockQty <= 0);
  const minimumStock = lowStock.filter(r => r.stockQty > 0);
  const safeStockCount = Math.max(stock.length - lowStock.length, 0);
  const totalWarehouseQty = stock.reduce((sum, r) => sum + Number(r.stockQty || 0), 0);
  const availabilityPct = stock.length ? Math.round((safeStockCount / stock.length) * 100) : 0;

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

  const pendingEmergency = pendingRows.filter(r => r.priority === "darurat").length;
  const pendingUrgent = pendingRows.filter(r => r.priority === "mendesak").length;

  const todayDistribution = {};
  distributions.forEach(r => {
    if (toDateKey_(r.date) !== todayKey) return;
    const room = r.room || "Ruangan";
    todayDistribution[room] = (todayDistribution[room] || 0) + Number(r.quantity || 0);
  });

  const distributionToday = Object.keys(todayDistribution)
    .reduce((sum, room) => sum + todayDistribution[room], 0);

  const last7Start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  last7Start.setHours(0, 0, 0, 0);
  const distribution7 = distributions
    .filter(r => {
      if (!r.date) return false;
      const date = new Date(r.date);
      return !isNaN(date.getTime()) && date >= last7Start;
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
  sheet.setTabColor(C.indigo);

  // Modern app-like canvas.
  const widths = [96, 154, 82, 96, 154, 82, 22, 112, 154, 86, 98, 82];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  for (let row = 1; row <= 44; row++) sheet.setRowHeight(row, 22);

  sheet.getRange("A1:L44")
    .setFontFamily("Arial")
    .setFontColor(C.text)
    .setVerticalAlignment("middle");

  // Header.
  sheet.getRange("A1:L1").merge()
    .setBackground(C.navy)
    .setFontColor(C.white);
  sheet.getRange("A1")
    .setValue("GOLOG.IRIN  /  MONITORING GUDANG")
    .setFontSize(19)
    .setFontWeight("bold")
    .setHorizontalAlignment("left");
  sheet.setRowHeight(1, 42);

  sheet.getRange("A2:L2").merge()
    .setBackground(C.navy)
    .setFontColor("#CBD5E1");
  sheet.getRange("A2")
    .setValue("BMHP ICU  •  Ringkasan stok, permintaan, dan distribusi")
    .setFontSize(10)
    .setHorizontalAlignment("left");
  sheet.setRowHeight(2, 27);

  // Accent strip.
  sheet.getRange("A3:L3").setBackground(C.indigo);
  sheet.setRowHeight(3, 6);

  const cards = [
    { range: "A4:C6", label: "JENIS BARANG", value: stock.length, note: "item aktif", bg: C.blueBg, text: C.blueText },
    { range: "D4:F6", label: "STOK GUDANG", value: totalWarehouseQty, note: "total unit", bg: C.tealBg, text: C.tealText },
    { range: "H4:J6", label: "AMAN", value: safeStockCount, note: "di atas minimum", bg: C.greenBg, text: C.greenText },
    { range: "K4:L6", label: "KOSONG", value: criticalStock.length, note: "stok = 0", bg: C.redBg, text: C.redText },
    { range: "A8:C10", label: "PERLU CEK", value: minimumStock.length, note: "menyentuh minimum", bg: C.amberBg, text: C.amberText },
    { range: "D8:F10", label: "MENUNGGU", value: Object.keys(pendingMap).length, note: "request aktif", bg: C.purpleBg, text: C.purpleText },
    { range: "H8:J10", label: "DISTRIBUSI HARI INI", value: distributionToday, note: "unit ke ruangan", bg: C.blueBg, text: C.blueText },
    { range: "K8:L10", label: "PRIORITAS TINGGI", value: pendingEmergency + pendingUrgent, note: "darurat + mendesak", bg: C.pinkBg, text: C.pinkText },
  ];

  cards.forEach(card => {
    const range = sheet.getRange(card.range);
    const r = range.getRow();
    const col = range.getColumn();
    const numCols = range.getNumColumns();

    [0, 1, 2].forEach(offset => {
      sheet.getRange(r + offset, col, 1, numCols).merge();
      sheet.getRange(r + offset, col, 1, numCols).setBackground(card.bg);
    });

    sheet.getRange(r, col).setValue(card.label);
    sheet.getRange(r + 1, col).setValue(card.value);
    sheet.getRange(r + 2, col).setValue(card.note);

    sheet.getRange(r, col)
      .setFontSize(8)
      .setFontWeight("bold")
      .setFontColor(C.muted);

    sheet.getRange(r + 1, col)
      .setFontSize(20)
      .setFontWeight("bold")
      .setFontColor(card.text);

    sheet.getRange(r + 2, col)
      .setFontSize(8)
      .setFontColor(C.muted);

    sheet.getRange(r, col, 3, numCols)
      .setVerticalAlignment("middle")
      .setBorder(true, true, true, true, false, false, C.border, SpreadsheetApp.BorderStyle.SOLID);
  });

  // Operational summary.
  sheet.getRange("A12:F12").merge()
    .setBackground(C.slateBg)
    .setFontWeight("bold")
    .setFontSize(12);
  sheet.getRange("A12").setValue("RINGKASAN OPERASIONAL");

  sheet.getRange("A13:F16").setBackground(C.white);
  sheet.getRange("A13:C16").setValues([
    ["METRIK", "NILAI", "KETERANGAN"],
    ["Ketersediaan", availabilityPct / 100, "persentase item di atas minimum"],
    ["Distribusi 7 hari", distribution7, "akumulasi unit"],
    ["Histori 90 hari", movements.length, "catatan movement"],
  ]);
  sheet.getRange("A13:C16")
    .setBorder(true, true, true, true, true, true, C.border, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("A13:C13")
    .setBackground("#F1F5F9")
    .setFontWeight("bold")
    .setFontSize(8);
  sheet.getRange("B14").setNumberFormat("0%");
  sheet.getRange("B15:B16").setNumberFormat("0");
  sheet.getRange("B14:B16").setFontWeight("bold");
  sheet.getRange("A13:C16").setWrap(true);

  sheet.getRange("H12:L12").merge()
    .setBackground(C.slateBg)
    .setFontWeight("bold")
    .setFontSize(12);
  sheet.getRange("H12").setValue("PRIORITAS TINDAKAN");

  sheet.getRange("H13:J16").setValues([
    ["KONDISI", "JUMLAH", "TINDAKAN"],
    ["KOSONG", criticalStock.length, "cek segera"],
    ["DARURAT", pendingEmergency, "review request"],
    ["MENDESAK", pendingUrgent, "review request"],
  ]);
  sheet.getRange("H13:J16")
    .setBorder(true, true, true, true, true, true, C.border, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("H13:J13")
    .setBackground("#F1F5F9")
    .setFontWeight("bold")
    .setFontSize(8);
  sheet.getRange("H14:H16").setFontWeight("bold");
  sheet.getRange("I14:I16").setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange("H14:J16").setWrap(true);

  // Attention table.
  sheet.getRange("A18:F18").merge()
    .setBackground(C.navy)
    .setFontColor(C.white)
    .setFontWeight("bold")
    .setFontSize(11);
  sheet.getRange("A18").setValue("BARANG PERLU PERHATIAN");

  sheet.getRange("A19:F19").setValues([
    ["SKU", "BARANG", "STOK", "MIN", "SELISIH", "STATUS"],
  ]);
  sheet.getRange("A19:F19")
    .setBackground("#EEF2FF")
    .setFontWeight("bold")
    .setFontSize(8)
    .setHorizontalAlignment("center");

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
    sheet.getRange(20, 1, attention.length, 6)
      .setBorder(false, false, true, false, false, false, C.border, SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(20, 3, attention.length, 3).setNumberFormat("0");
    sheet.getRange(20, 3, attention.length, 3).setHorizontalAlignment("center");
    sheet.getRange(20, 6, attention.length, 1).setFontWeight("bold").setHorizontalAlignment("center");
  } else {
    sheet.getRange("A20:F20").merge().setValue("Semua stok berada di atas minimum.");
    sheet.getRange("A20").setFontColor(C.greenText);
  }

  // Pending request table.
  sheet.getRange("H18:L18").merge()
    .setBackground(C.navy)
    .setFontColor(C.white)
    .setFontWeight("bold")
    .setFontSize(11);
  sheet.getRange("H18").setValue("PERMINTAAN MENUNGGU");

  sheet.getRange("H19:L19").setValues([
    ["NO REQUEST", "RUANGAN", "PRIORITAS", "TGL", "QTY"],
  ]);
  sheet.getRange("H19:L19")
    .setBackground("#EEF2FF")
    .setFontWeight("bold")
    .setFontSize(8)
    .setHorizontalAlignment("center");

  const pendingOutput = pendingList.map(r => [
    r.requestNo,
    r.room,
    String(r.priority || "").toUpperCase(),
    r.date ? new Date(r.date) : "",
    r.requestedQty,
  ]);

  if (pendingOutput.length) {
    sheet.getRange(20, 8, pendingOutput.length, 5).setValues(pendingOutput);
    sheet.getRange(20, 8, pendingOutput.length, 5)
      .setBorder(false, false, true, false, false, false, C.border, SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(20, 10, pendingOutput.length, 1).setHorizontalAlignment("center").setFontWeight("bold");
    sheet.getRange(20, 11, pendingOutput.length, 1).setNumberFormat("0").setHorizontalAlignment("center");
    sheet.getRange(20, 10, pendingOutput.length, 1).setNumberFormat("@");
  } else {
    sheet.getRange("H20:L20").merge().setValue("Tidak ada permintaan yang menunggu.");
    sheet.getRange("H20").setFontColor(C.greenText);
  }

  // Conditional formatting for action areas.
  if (attention.length) {
    const statusRange = sheet.getRange(20, 6, attention.length, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("KOSONG")
        .setBackground(C.redBg)
        .setFontColor(C.redText)
        .setRanges([statusRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("PERLU CEK")
        .setBackground(C.amberBg)
        .setFontColor(C.amberText)
        .setRanges([statusRange])
        .build(),
    ]);
  }

  if (pendingOutput.length) {
    const priorityRange = sheet.getRange(20, 10, pendingOutput.length, 1);
    const requestRules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("DARURAT")
        .setBackground(C.redBg)
        .setFontColor(C.redText)
        .setRanges([priorityRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("MENDESAK")
        .setBackground(C.pinkBg)
        .setFontColor(C.pinkText)
        .setRanges([priorityRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("NORMAL")
        .setBackground(C.blueBg)
        .setFontColor(C.blueText)
        .setRanges([priorityRange])
        .build(),
    ];
    sheet.setConditionalFormatRules([
      ...(attention.length ? sheet.getConditionalFormatRules() : []),
      ...requestRules,
    ]);
  }

  // Lower section.
  sheet.getRange("A32:F32").merge()
    .setBackground(C.slateBg)
    .setFontWeight("bold")
    .setFontSize(11);
  sheet.getRange("A32").setValue("DISTRIBUSI HARI INI PER RUANGAN");

  sheet.getRange("A33:B33").setValues([["RUANGAN", "JUMLAH"]]);
  sheet.getRange("A33:B33")
    .setBackground("#F1F5F9")
    .setFontWeight("bold")
    .setFontSize(8);

  if (distributionRows.length) {
    sheet.getRange(34, 1, distributionRows.length, 2).setValues(distributionRows);
    sheet.getRange(34, 1, distributionRows.length, 2)
      .setBorder(false, false, true, false, false, false, C.border, SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(34, 2, distributionRows.length, 1).setNumberFormat("0").setHorizontalAlignment("center");
  } else {
    sheet.getRange("A34:B34").merge().setValue("Belum ada distribusi hari ini.");
    sheet.getRange("A34").setFontColor(C.muted);
  }

  sheet.getRange("D32:E32").setValues([["STATUS STOK", "JUMLAH"]]);
  sheet.getRange("D32:E32")
    .setBackground("#F1F5F9")
    .setFontWeight("bold")
    .setFontSize(8);
  sheet.getRange("D33:E35").setValues(statusCounts);

  try {
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.DOUGHNUT)
      .addRange(sheet.getRange("D32:E35"))
      .setPosition(32, 7, 0, 0)
      .setOption("title", "STATUS STOK")
      .setOption("pieHole", 0.55)
      .setOption("legend", { position: "right" })
      .setOption("width", 500)
      .setOption("height", 260)
      .setOption("backgroundColor", C.white)
      .build();
    sheet.insertChart(chart);
  } catch (error) {
    Logger.log("Dashboard chart skipped: " + error);
  }

  sheet.getRange("H32:L32").merge()
    .setBackground(C.slateBg)
    .setFontWeight("bold")
    .setFontSize(11);
  sheet.getRange("H32").setValue("KETERANGAN");

  sheet.getRange("H33:L37").merge()
    .setBackground(C.white)
    .setBorder(true, true, true, true, false, false, C.border, SpreadsheetApp.BorderStyle.SOLID)
    .setWrap(true)
    .setVerticalAlignment("top");

  sheet.getRange("H33").setValue(
    "• Golog.Irin = sumber data utama\n\n" +
    "• Google Sheet = monitoring & analitik\n\n" +
    "• Stok ≤ Minimum Stok = PERLU CEK\n\n" +
    "• Distribusi ke ruangan langsung mengurangi stok gudang"
  );

  // Footer.
  sheet.getRange("A40:L40").merge()
    .setBackground(C.navy)
    .setFontColor("#CBD5E1")
    .setFontSize(8);
  sheet.getRange("A40").setValue(
    "Sync terakhir: " +
    (payload.generatedAt
      ? Utilities.formatDate(new Date(payload.generatedAt), sessionTz, "dd MMM yyyy  •  HH:mm:ss")
      : "-")
  );

  sheet.getRange("A1:L40").setWrap(true);
  sheet.setFrozenRows(3);
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
