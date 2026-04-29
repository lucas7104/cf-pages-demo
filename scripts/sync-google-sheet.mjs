import fs from "node:fs/promises";
import path from "node:path";
import xlsx from "xlsx";

const SHEETS_CONFIG_RAW = process.env.GOOGLE_SHEETS_CONFIG;
const CONTACT_URL = process.env.CONTACT_URL || "";

if (!SHEETS_CONFIG_RAW) {
  throw new Error("缺少 GOOGLE_SHEETS_CONFIG，請先到 GitHub Actions Variables 設定。");
}

let SHEETS_CONFIG = [];

try {
  SHEETS_CONFIG = JSON.parse(SHEETS_CONFIG_RAW);
} catch (error) {
  throw new Error("GOOGLE_SHEETS_CONFIG 不是合法的 JSON 格式。");
}

if (!Array.isArray(SHEETS_CONFIG) || SHEETS_CONFIG.length === 0) {
  throw new Error("GOOGLE_SHEETS_CONFIG 必須是非空陣列。");
}

const EXCLUDED_SHEETS = new Set([
  "團務",
  "缺貨清單",
  "留底表單",
  "確認購買名單",
  "現場商品預喊區(不需先匯款)",
  "表單all"
]);

const MANUAL_SKIP_SHEETS = new Set([
  "1016 現場連線蘑菇娃"
]);

const VIP_SECTIONS = {
  root: {
    label: "全部的VIP",
    parent: null,
    children: ["y2025", "y2026"],
    monthKeys: null
  },
  y2025: {
    label: "2025VIP",
    parent: "root",
    children: ["m2025-09-10", "m2025-11", "m2025-12"],
    monthKeys: ["2025-09-10", "2025-11", "2025-12"]
  },
  y2026: {
    label: "2026VIP",
    parent: "root",
    children: ["m2026-01", "m2026-02", "m2026-03", "m2026-04"],
    monthKeys: ["2026-01", "2026-02", "2026-03", "2026-04"]
  },
  "m2025-09-10": {
    label: "9/10月VIP",
    parent: "y2025",
    children: [],
    monthKeys: ["2025-09-10"]
  },
  "m2025-11": {
    label: "11月VIP",
    parent: "y2025",
    children: [],
    monthKeys: ["2025-11"]
  },
  "m2025-12": {
    label: "12月VIP",
    parent: "y2025",
    children: [],
    monthKeys: ["2025-12"]
  },
  "m2026-01": {
    label: "1月VIP",
    parent: "y2026",
    children: [],
    monthKeys: ["2026-01"]
  },
  "m2026-02": {
    label: "2月VIP",
    parent: "y2026",
    children: [],
    monthKeys: ["2026-02"]
  },
  "m2026-03": {
    label: "3月VIP",
    parent: "y2026",
    children: [],
    monthKeys: ["2026-03"]
  },
  "m2026-04": {
    label: "4月VIP",
    parent: "y2026",
    children: [],
    monthKeys: ["2026-04"]
  }
};

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;

  const text = String(value).replace(/,/g, "").trim();
  const matched = text.match(/-?\d+(\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

function cleanSheetTitle(sheetName) {
  return cleanText(sheetName).replace(/^★/, "").trim();
}

function cleanItemName(headerText) {
  return cleanText(headerText)
    .split("¥")[0]
    .trim();
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i += 1) {
    const row = rows[i] || [];
    if (row.some((cell) => cleanText(cell).includes("社群名"))) {
      return i;
    }
  }
  return -1;
}

function findIndex(headers, keywords) {
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    if (keywords.some((keyword) => header.includes(keyword))) {
      return i;
    }
  }
  return -1;
}

function buildHeaderMaps(rows, headerRowIndex) {
  const topHeaders = (rows[headerRowIndex] || []).map(cleanText);
  const subHeaders = (rows[headerRowIndex + 1] || []).map(cleanText);

  const combinedHeaders = topHeaders.map((top, index) => {
    const sub = subHeaders[index] || "";
    if (top && sub) return `${top} ${sub}`;
    return top || sub || "";
  });

  return { topHeaders, subHeaders, combinedHeaders };
}

function getCellNumber(row, index) {
  if (index === -1) return 0;
  return toNumber(row[index]);
}

function buildStatusBadges(statusText, depositPaid) {
  const badges = [];

  if (statusText.includes("已出貨")) badges.push("已出貨");
  if (statusText.includes("已抵台")) badges.push("已抵台");
  if (depositPaid > 0) badges.push("已付訂金");

  return [...new Set(badges)];
}

function inferItemColumns(headers, metaBoundaryIndex) {
  const metaKeywords = [
    "社群名",
    "商品金額",
    "總金額",
    "訂金",
    "已付訂金",
    "實際匯款金額",
    "二補",
    "境內運費",
    "國際運費",
    "刷卡手續費",
    "包材",
    "賣貨便尾款",
    "尾款",
    "付訂方式",
    "付款方式",
    "付訂日期",
    "末五碼",
    "備註",
    "出貨狀況"
  ];

  const itemColumns = [];

  for (let i = 0; i < metaBoundaryIndex; i += 1) {
    const header = headers[i];
    if (!header) continue;

    const isMeta = metaKeywords.some((keyword) => header.includes(keyword));
    if (!isMeta) {
      itemColumns.push(i);
    }
  }

  return itemColumns;
}

function normalizeSourceMonth(value) {
  return cleanText(value).replace(/_/g, "-");
}

function parseSourceMonthForSort(value) {
  const normalized = normalizeSourceMonth(value);

  // 例：2026-01
  let match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: 0
    };
  }

  // 例：2025-09-10（你這種 9/10 月合併標記）
  match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: 0
    };
  }

  return {
    year: 9999,
    month: 99,
    day: 99
  };
}

function parseTitleDateForSort(title) {
  const text = cleanText(title);

  // 取標題開頭 4 碼，例如：
  // 0103膳大黨 -> 01/03
  // 1123 咒術pochimart -> 11/23
  const match = text.match(/^(\d{2})(\d{2})/);

  if (!match) {
    return {
      month: 99,
      day: 99
    };
  }

  return {
    month: Number(match[1]),
    day: Number(match[2])
  };
}

function parseSheet(sheetName, sheet, sourceMonthLabel) {
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true
  });

  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex === -1) return [];

  const { topHeaders, subHeaders, combinedHeaders } = buildHeaderMaps(rows, headerRowIndex);

  const socialNameIndex = findIndex(combinedHeaders, ["社群名"]);
  const productAmountIndex = findIndex(combinedHeaders, ["商品金額", "總金額"]);
  const depositPaidIndex = findIndex(combinedHeaders, ["實際匯款金額", "已付訂金", "訂金"]);

  const domesticShippingIndex = findIndex(combinedHeaders, ["境內運費"]);
  const internationalShippingIndex = findIndex(combinedHeaders, ["國際運費"]);
  const cardFeeIndex = findIndex(combinedHeaders, ["刷卡手續費"]);
  const packagingFeeIndex = findIndex(combinedHeaders, ["包材"]);

  const explicitSecondPaymentIndex = topHeaders.findIndex((header, index) => {
    const top = cleanText(header);
    const sub = cleanText(subHeaders[index]);
    return top.includes("二補") && !sub;
  });

  //const balanceDueIndex = findIndex(combinedHeaders, ["賣貨便尾款", "尾款"]);

  const paymentMethodIndex = findIndex(combinedHeaders, ["付訂方式", "付款方式"]);
  const statusIndex = findIndex(combinedHeaders, ["出貨狀況"]);
  const noteIndex = findIndex(combinedHeaders, ["備註"]);

  if (socialNameIndex === -1) return [];

  const metaBoundaryCandidates = [noteIndex, statusIndex].filter((index) => index !== -1);
  const metaBoundaryIndex =
    metaBoundaryCandidates.length > 0 ? Math.min(...metaBoundaryCandidates) : topHeaders.length;

  const itemColumns = inferItemColumns(topHeaders, metaBoundaryIndex);

  const result = [];

  for (let rowIndex = headerRowIndex + 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const socialName = cleanText(row[socialNameIndex]);

    if (!socialName) continue;

    const productAmount = productAmountIndex !== -1 ? toNumber(row[productAmountIndex]) : 0;
    const depositPaid = depositPaidIndex !== -1 ? toNumber(row[depositPaidIndex]) : 0;

    const domesticShipping = getCellNumber(row, domesticShippingIndex);
    const internationalShipping = getCellNumber(row, internationalShippingIndex);
    const cardFee = getCellNumber(row, cardFeeIndex);
    const packagingFee = getCellNumber(row, packagingFeeIndex);

    const secondPayment =
      explicitSecondPaymentIndex !== -1
        ? toNumber(row[explicitSecondPaymentIndex])
        : domesticShipping + internationalShipping + cardFee + packagingFee;

    const balanceDueRaw = productAmount - depositPaid + secondPayment;
    const balanceDue = Math.max(0, Number(balanceDueRaw.toFixed(2)));
    const paymentMethod =
      paymentMethodIndex !== -1 ? cleanText(row[paymentMethodIndex]) || "未填" : "未填";
    const statusText = statusIndex !== -1 ? cleanText(row[statusIndex]) : "";
    const noteText = noteIndex !== -1 ? cleanText(row[noteIndex]) : "";

    const items = itemColumns
      .map((columnIndex) => {
        const qty = toNumber(row[columnIndex]);
        if (qty <= 0) return null;

        return {
          name: cleanItemName(topHeaders[columnIndex]),
          qty: Number.isInteger(qty) ? qty : Number(qty.toFixed(2))
        };
      })
      .filter(Boolean);

    result.push({
      socialName,
      title: cleanSheetTitle(sheetName),
      statusBadges: buildStatusBadges(statusText, depositPaid),
      productAmount,
      depositPaid,
      secondPayment,
      secondPaymentBreakdown: {
        domesticShipping,
        internationalShipping,
        cardFee,
        packagingFee
      },
      balanceDue,
      etaText: statusText || "待公告",
      paymentMethod,
      contactUrl: CONTACT_URL,
      note: noteText,
      items,
      sourceSheet: sheetName,
      sourceMonth: sourceMonthLabel
    });
  }

  return result;
}

function buildPublicOrders(orders) {
  return orders.map((order) => ({
    socialName: order.socialName,
    title: order.title,
    statusBadges: order.statusBadges,
    productAmount: order.productAmount,
    depositPaid: order.depositPaid,
    secondPayment: order.secondPayment,
    secondPaymentBreakdown: order.secondPaymentBreakdown,
    balanceDue: order.balanceDue,
    etaText: order.etaText,
    paymentMethod: order.paymentMethod,
    contactUrl: order.contactUrl,
    note: order.note,
    items: order.items
  }));
}

function buildTopTen(orders, monthKeys = null) {
  const memberMap = new Map();

  for (const order of orders) {
    const normalizedMonth = normalizeSourceMonth(order.sourceMonth);
    if (monthKeys && !monthKeys.includes(normalizedMonth)) continue;

    const socialName = cleanText(order.socialName);
    if (!socialName) continue;

    const amount = toNumber(order.productAmount);
    memberMap.set(socialName, (memberMap.get(socialName) || 0) + amount);
  }

  return Array.from(memberMap.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.name.localeCompare(b.name, "zh-Hant");
    })
    .slice(0, 10);
}

function buildVipData(orders) {
  const vipEligibleOrders = orders.filter((order) => {
    const normalizedMonth = normalizeSourceMonth(order.sourceMonth);
    return Boolean(
      normalizedMonth === "2025-09-10" ||
      normalizedMonth === "2025-11" ||
      normalizedMonth === "2025-12" ||
      normalizedMonth === "2026-01" ||
      normalizedMonth === "2026-02" ||
      normalizedMonth === "2026-03" ||
      normalizedMonth === "2026-04"
    );
  });

  const sections = {};

  for (const [key, section] of Object.entries(VIP_SECTIONS)) {
    sections[key] = {
      label: section.label,
      parent: section.parent,
      children: section.children,
      topTen: buildTopTen(vipEligibleOrders, section.monthKeys)
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    note: "VIP 不含台北動漫節資料",
    sections
  };
}

async function downloadWorkbook(sheetId) {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const response = await fetch(exportUrl);

  if (!response.ok) {
    throw new Error(`下載 Google 試算表失敗：${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function writeJson(relativePath, data) {
  const outputPath = path.resolve(relativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const orders = [];

  for (const config of SHEETS_CONFIG) {
    const label = cleanText(config.label);
    const sheetId = cleanText(config.sheetId);

    if (!label || !sheetId) {
      console.warn("略過一筆無效設定：", config);
      continue;
    }

    console.log(`開始下載 ${label} 的 Google 試算表...`);
    const workbookBuffer = await downloadWorkbook(sheetId);

    console.log(`開始解析 ${label} 的資料...`);
    const workbook = xlsx.read(workbookBuffer, {
      type: "buffer",
      cellDates: true
    });

    for (const sheetName of workbook.SheetNames) {
      if (EXCLUDED_SHEETS.has(sheetName)) continue;
      if (MANUAL_SKIP_SHEETS.has(sheetName)) continue;

      const sheet = workbook.Sheets[sheetName];
      const parsedOrders = parseSheet(sheetName, sheet, label);
      orders.push(...parsedOrders);
    }
  }

  orders.sort((a, b) => {
    const aMonth = parseSourceMonthForSort(a.sourceMonth);
    const bMonth = parseSourceMonthForSort(b.sourceMonth);

    // 先依年份排序
    if (aMonth.year !== bMonth.year) {
      return aMonth.year - bMonth.year;
    }

    // 再依月份排序
    if (aMonth.month !== bMonth.month) {
      return aMonth.month - bMonth.month;
    }

    // 同月份內，再看標題前 4 碼的月日，例如 0103 / 1123
    const aTitleDate = parseTitleDateForSort(a.title);
    const bTitleDate = parseTitleDateForSort(b.title);

    if (aTitleDate.month !== bTitleDate.month) {
      return aTitleDate.month - bTitleDate.month;
    }

    if (aTitleDate.day !== bTitleDate.day) {
      return aTitleDate.day - bTitleDate.day;
    }

    // 最後再用標題文字補排序
    return a.title.localeCompare(b.title, "zh-Hant");
  });

  const publicOrders = buildPublicOrders(orders);
  const vipData = buildVipData(orders);

  await writeJson(path.join("site-public", "orders-public.json"), publicOrders);
  await writeJson(path.join("site-admin", "orders.json"), orders);
  await writeJson(path.join("site-admin", "vip.json"), vipData);

  console.log(`同步完成，共輸出 ${orders.length} 筆管理訂單到 site-admin/orders.json`);
  console.log(`同步完成，共輸出 ${publicOrders.length} 筆公開訂單到 site-public/orders-public.json`);
  console.log(`同步完成，共輸出 VIP 排行到 site-admin/vip.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
