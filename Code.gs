const SHEET_NAME = "Cards";
const HEADERS = [
  "id",
  "title",
  "epic",
  "status",
  "statusOverride",
  "checklistJson",
  "dateAdded",
  "dateCompleted"
];

const STATUS = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete"
};

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || "getCards";

    if (action === "getCards") {
      return jsonResponse({ cards: getLandingCards_() });
    }

    if (action === "getArchiveCards") {
      return jsonResponse({ cards: getArchiveCards_() });
    }

    if (action === "getLandingEpics") {
      return jsonResponse({ epics: getLandingEpics_() });
    }

    if (action === "getArchiveEpics") {
      return jsonResponse({ epics: getArchiveEpics_() });
    }

    if (action === "health") {
      return jsonResponse({ ok: true, now: new Date().toISOString() });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = body.action;

    if (action === "createCard") {
      const created = createCard_(body.card || {});
      return jsonResponse({ card: created });
    }

    if (action === "updateCard") {
      const updated = updateCard_(body.id, body.card || {}, body.sourceView || "landing");
      return jsonResponse({ card: updated });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    return jsonResponse({ error: String(error) }, 500);
  }
}

function jsonResponse(payload, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function getLandingCards_() {
  const cards = getAllCards_();
  return cards.filter((card) => {
    if (card.status !== STATUS.COMPLETE) {
      return true;
    }
    if (!card.dateCompleted) {
      return false;
    }
    return isWithinLast14Days_(card.dateCompleted);
  });
}

function getArchiveCards_() {
  return getAllCards_()
    .filter((card) => card.status === STATUS.COMPLETE)
    .sort((a, b) => toMillis_(b.dateCompleted) - toMillis_(a.dateCompleted));
}

function getLandingEpics_() {
  const cards = getAllCards_();
  const set = {};
  cards.forEach((card) => {
    if (card.status === STATUS.TODO || card.status === STATUS.IN_PROGRESS) {
      set[card.epic] = true;
    }
  });
  return Object.keys(set).sort();
}

function getArchiveEpics_() {
  const cards = getAllCards_();
  const set = {};
  cards.forEach((card) => {
    if (card.status === STATUS.COMPLETE) {
      set[card.epic] = true;
    }
  });
  return Object.keys(set).sort();
}

function createCard_(input) {
  validateRequired_(input.title, "Title is required");
  validateRequired_(input.epic, "Epic is required");

  const nowIso = new Date().toISOString();
  const checklist = sanitizeChecklist_(input.checklist || []);
  const statusOverride = !!input.statusOverride || checklist.length === 0;
  const derivedStatus = deriveStatus_(checklist);
  const status = sanitizeStatus_(statusOverride ? input.status : (input.status || derivedStatus));

  const card = {
    id: Utilities.getUuid(),
    title: String(input.title).trim(),
    epic: String(input.epic).trim(),
    status: status,
    statusOverride: statusOverride,
    checklist: checklist,
    dateAdded: nowIso,
    dateCompleted: status === STATUS.COMPLETE ? nowIso : ""
  };

  appendCard_(card);
  return card;
}

function updateCard_(id, input, sourceView) {
  validateRequired_(id, "Card id is required");

  const sheet = getCardsSheet_();
  const all = sheet.getDataRange().getValues();
  if (all.length < 2) {
    throw new Error("No cards found");
  }

  const headerMap = headerMap_(all[0]);
  let targetRow = -1;
  for (let i = 1; i < all.length; i += 1) {
    if (String(all[i][headerMap.id]).trim() === String(id).trim()) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    throw new Error("Card not found");
  }

  const rowValues = sheet.getRange(targetRow, 1, 1, all[0].length).getValues()[0];
  const existing = rowToCard_(rowValues, headerMap);

  let next = {
    id: existing.id,
    title: existing.title,
    epic: existing.epic,
    status: existing.status,
    statusOverride: existing.statusOverride,
    checklist: existing.checklist,
    dateAdded: existing.dateAdded,
    dateCompleted: existing.dateCompleted
  };

  if (sourceView === "archive") {
    next.status = sanitizeStatus_(input.status || existing.status);
    next.statusOverride = existing.statusOverride;
  } else {
    next.title = String(input.title || existing.title).trim();
    next.epic = String(input.epic || existing.epic).trim();
    next.checklist = sanitizeChecklist_(input.checklist || []);
    next.statusOverride = !!input.statusOverride || next.checklist.length === 0;

    const derived = deriveStatus_(next.checklist);
    const candidateStatus = next.statusOverride ? input.status : derived;
    next.status = sanitizeStatus_(candidateStatus || existing.status);
  }

  if (next.status === STATUS.COMPLETE && !next.dateCompleted) {
    next.dateCompleted = new Date().toISOString();
  }
  if (next.status !== STATUS.COMPLETE) {
    next.dateCompleted = "";
  }

  writeCardAtRow_(sheet, targetRow, next);
  return next;
}

function getAllCards_() {
  const sheet = getCardsSheet_();
  ensureHeaders_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const map = headerMap_(values[0]);
  const cards = [];
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (!String(row[map.id] || "").trim()) {
      continue;
    }
    cards.push(rowToCard_(row, map));
  }
  return cards;
}

function rowToCard_(row, map) {
  const rawChecklist = row[map.checklistJson];
  let checklist = [];
  if (rawChecklist) {
    try {
      checklist = sanitizeChecklist_(JSON.parse(rawChecklist));
    } catch (err) {
      checklist = [];
    }
  }

  return {
    id: String(row[map.id] || ""),
    title: String(row[map.title] || ""),
    epic: String(row[map.epic] || ""),
    status: sanitizeStatus_(String(row[map.status] || STATUS.TODO)),
    statusOverride: String(row[map.statusOverride] || "").toLowerCase() === "true",
    checklist: checklist,
    dateAdded: String(row[map.dateAdded] || ""),
    dateCompleted: String(row[map.dateCompleted] || "")
  };
}

function appendCard_(card) {
  const sheet = getCardsSheet_();
  ensureHeaders_(sheet);
  const row = cardToRow_(card);
  sheet.appendRow(row);
}

function writeCardAtRow_(sheet, rowNumber, card) {
  const row = cardToRow_(card);
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}

function cardToRow_(card) {
  return [
    card.id,
    card.title,
    card.epic,
    card.status,
    String(!!card.statusOverride),
    JSON.stringify(sanitizeChecklist_(card.checklist || [])),
    card.dateAdded,
    card.dateCompleted || ""
  ];
}

function getCardsSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("Sheet not found: " + SHEET_NAME);
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  const range = sheet.getRange(1, 1, 1, HEADERS.length);
  const current = range.getValues()[0];
  const missing = HEADERS.some((h, idx) => String(current[idx] || "") !== h);
  if (missing) {
    range.setValues([HEADERS]);
  }
}

function headerMap_(headerRow) {
  const map = {};
  for (let i = 0; i < headerRow.length; i += 1) {
    map[String(headerRow[i])] = i;
  }

  HEADERS.forEach((header) => {
    if (map[header] === undefined) {
      throw new Error("Missing header: " + header);
    }
  });

  return map;
}

function sanitizeStatus_(value) {
  if (value === STATUS.TODO || value === STATUS.IN_PROGRESS || value === STATUS.COMPLETE) {
    return value;
  }
  return STATUS.TODO;
}

function sanitizeChecklist_(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const sanitized = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const text = String(item.text || "").trim();
    if (!text) {
      continue;
    }
    sanitized.push({
      text: text,
      status: sanitizeStatus_(String(item.status || STATUS.TODO))
    });
  }
  return sanitized;
}

function deriveStatus_(checklist) {
  if (!checklist || checklist.length === 0) {
    return STATUS.TODO;
  }

  const allComplete = checklist.every((item) => item.status === STATUS.COMPLETE);
  if (allComplete) {
    return STATUS.COMPLETE;
  }

  const anyInProgress = checklist.some((item) => item.status === STATUS.IN_PROGRESS);
  if (anyInProgress) {
    return STATUS.IN_PROGRESS;
  }

  return STATUS.TODO;
}

function validateRequired_(value, message) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(message);
  }
}

function isWithinLast14Days_(iso) {
  const completedMillis = toMillis_(iso);
  if (!completedMillis) {
    return false;
  }
  const now = Date.now();
  const diffDays = (now - completedMillis) / (1000 * 60 * 60 * 24);
  return diffDays <= 14;
}

function toMillis_(iso) {
  const timestamp = new Date(iso).getTime();
  if (!isFinite(timestamp)) {
    return 0;
  }
  return timestamp;
}
