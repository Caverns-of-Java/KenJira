const GAS_URL = "https://script.google.com/macros/s/AKfycbzf92SvbIL16WbwoKLbf7t67z7uui7ZIp42Do9cdb-b3FimeNwxoFI87vTDKEv5hMFy/exec";
const PASSCODE_HASH = "a90ef855d6ad7ff0a716e37f45f300fe95613959d426b7e593793cec7a4caeec";

const STATUS = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete"
};

const appState = {
  cards: [],
  archiveCards: [],
  epicsLanding: [],
  epicsArchive: [],
  activeEpic: "ALL",
  archiveEpic: "ALL",
  editingCardId: null,
  isArchiveView: false,
  mobileInitialized: false,
  draggedCardId: null,
  suppressNextCardClick: false,
  isBootstrapped: false
};

const el = {
  landingView: document.getElementById("landingView"),
  archiveView: document.getElementById("archiveView"),
  archiveList: document.getElementById("archiveList"),
  epicFilter: document.getElementById("epicFilter"),
  archiveEpicFilter: document.getElementById("archiveEpicFilter"),
  addBtn: document.getElementById("addBtn"),
  archiveBtn: document.getElementById("archiveBtn"),
  backToLandingBtn: document.getElementById("backToLandingBtn"),
  cardModal: document.getElementById("cardModal"),
  cardForm: document.getElementById("cardForm"),
  cardModalTitle: document.getElementById("cardModalTitle"),
  cardId: document.getElementById("cardId"),
  titleInput: document.getElementById("titleInput"),
  epicSelect: document.getElementById("epicSelect"),
  newEpicInput: document.getElementById("newEpicInput"),
  statusInput: document.getElementById("statusInput"),
  statusOverrideInput: document.getElementById("statusOverrideInput"),
  checklistEditor: document.getElementById("checklistEditor"),
  addChecklistItemBtn: document.getElementById("addChecklistItemBtn"),
  cancelModalBtn: document.getElementById("cancelModalBtn"),
  passcodeDialog: document.getElementById("passcodeDialog"),
  passcodeForm: document.getElementById("passcodeForm"),
  passcodeInput: document.getElementById("passcodeInput"),
  passcodeError: document.getElementById("passcodeError"),
  cardTemplate: document.getElementById("cardTemplate")
};

async function init() {
  registerServiceWorker();
  wireEvents();
  if (!sessionStorage.getItem("kenjira_unlocked")) {
    document.body.classList.add("locked");
    el.passcodeDialog.showModal();
    return;
  }

  await bootstrapApp();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}

async function bootstrapApp() {
  if (appState.isBootstrapped) {
    return;
  }

  appState.isBootstrapped = true;
  document.body.classList.remove("locked");
  await refreshData();
  render();
}

function wireEvents() {
  el.addBtn.addEventListener("click", () => openCardModal());
  el.archiveBtn.addEventListener("click", async () => {
    appState.isArchiveView = true;
    await refreshArchive();
    render();
  });
  el.backToLandingBtn.addEventListener("click", () => {
    appState.isArchiveView = false;
    render();
  });

  el.epicFilter.addEventListener("change", () => {
    appState.activeEpic = el.epicFilter.value;
    renderLanding();
  });

  el.archiveEpicFilter.addEventListener("change", () => {
    appState.archiveEpic = el.archiveEpicFilter.value;
    renderArchive();
  });

  el.addChecklistItemBtn.addEventListener("click", () => addChecklistEditorRow());

  el.cancelModalBtn.addEventListener("click", () => {
    el.cardModal.close();
  });

  el.cardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = readCardFormPayload();
    if (!payload) {
      return;
    }

    if (appState.editingCardId) {
      await apiPost("updateCard", { id: appState.editingCardId, card: payload, sourceView: appState.isArchiveView ? "archive" : "landing" });
    } else {
      await apiPost("createCard", { card: payload });
    }

    el.cardModal.close();
    await refreshData();
    if (appState.isArchiveView) {
      await refreshArchive();
    }
    render();
  });

  el.passcodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = el.passcodeInput.value.trim();
    const hash = await sha256(value);
    if (hash !== PASSCODE_HASH) {
      el.passcodeError.textContent = "Incorrect passcode.";
      return;
    }

    sessionStorage.setItem("kenjira_unlocked", "1");
    el.passcodeError.textContent = "";
    el.passcodeDialog.close();
    await bootstrapApp();
  });
}

function readCardFormPayload() {
  const title = el.titleInput.value.trim();
  const selectedEpic = el.epicSelect.value.trim();
  const newEpic = el.newEpicInput.value.trim();
  const epic = newEpic || selectedEpic;

  if (!title || !epic) {
    alert("Title and Epic are required.");
    return null;
  }

  const checklist = collectChecklistEditorItems();
  return {
    title,
    epic,
    status: el.statusInput.value,
    statusOverride: !!el.statusOverrideInput.checked,
    checklist
  };
}

async function refreshData() {
  if (!isConfigured()) {
    appState.cards = [];
    appState.epicsLanding = [];
    return;
  }

  const [cards, epics] = await Promise.all([
    apiGet("getCards"),
    apiGet("getLandingEpics")
  ]);

  appState.cards = cards.cards || [];
  appState.epicsLanding = epics.epics || [];
  if (window.matchMedia("(max-width: 760px)").matches && !appState.mobileInitialized) {
    appState.activeEpic = pickMobileDefaultEpic(appState.cards);
    appState.mobileInitialized = true;
  }

  if (!window.matchMedia("(max-width: 760px)").matches && appState.activeEpic === "") {
    appState.activeEpic = "ALL";
  }

  if (!appState.activeEpic) {
    appState.activeEpic = "ALL";
  }
}

async function refreshArchive() {
  if (!isConfigured()) {
    appState.archiveCards = [];
    appState.epicsArchive = [];
    return;
  }

  const [cards, epics] = await Promise.all([
    apiGet("getArchiveCards"),
    apiGet("getArchiveEpics")
  ]);

  appState.archiveCards = cards.cards || [];
  appState.epicsArchive = epics.epics || [];
}

function render() {
  el.landingView.classList.toggle("active", !appState.isArchiveView);
  el.archiveView.classList.toggle("active", appState.isArchiveView);
  if (appState.isArchiveView) {
    renderArchive();
  } else {
    renderLanding();
  }
}

function renderLanding() {
  renderEpicFilter(el.epicFilter, appState.epicsLanding, appState.activeEpic, true);

  const root = el.landingView;
  root.innerHTML = "";
  if (window.matchMedia("(max-width: 760px)").matches) {
    renderLandingMobile(root);
    return;
  }

  const visibleCards = appState.cards.filter((card) => {
    return appState.activeEpic === "ALL" || card.epic === appState.activeEpic;
  });

  const desktopGrid = document.createElement("div");
  desktopGrid.className = "landing-desktop-grid";

  const statusHeaderRow = document.createElement("div");
  statusHeaderRow.className = "status-header-row";
  [STATUS.TODO, STATUS.IN_PROGRESS, STATUS.COMPLETE].forEach((status) => {
    const heading = document.createElement("h2");
    heading.textContent = status;
    statusHeaderRow.appendChild(heading);
  });
  desktopGrid.appendChild(statusHeaderRow);

  const epicRows = document.createElement("div");
  epicRows.className = "epic-rows";
  const epics = getLandingEpicOrder(visibleCards);

  epics.forEach((epic) => {
    const epicRow = document.createElement("section");
    epicRow.className = "epic-row";

    const epicTitle = document.createElement("h3");
    epicTitle.className = "epic-row-title";
    epicTitle.textContent = epic;
    epicRow.appendChild(epicTitle);

    const rowColumns = document.createElement("div");
    rowColumns.className = "epic-row-columns";

    [STATUS.TODO, STATUS.IN_PROGRESS, STATUS.COMPLETE].forEach((status) => {
      const laneCell = document.createElement("div");
      laneCell.className = "epic-cell";
      laneCell.dataset.epic = epic;
      laneCell.dataset.status = status;

      laneCell.addEventListener("dragover", (event) => {
        const draggedCard = appState.cards.find((card) => card.id === appState.draggedCardId);
        if (!draggedCard || draggedCard.epic !== epic) {
          return;
        }
        event.preventDefault();
        laneCell.classList.add("drag-over");
      });

      laneCell.addEventListener("dragleave", () => {
        laneCell.classList.remove("drag-over");
      });

      laneCell.addEventListener("drop", async (event) => {
        event.preventDefault();
        laneCell.classList.remove("drag-over");

        const draggedCard = appState.cards.find((card) => card.id === appState.draggedCardId);
        appState.draggedCardId = null;
        clearDropHighlights();

        if (!draggedCard || draggedCard.epic !== epic || draggedCard.status === status) {
          return;
        }

        try {
          await applyManualStatusOverride(draggedCard, status);
        } catch (error) {
          console.error(error);
          alert("Unable to move card. Please try again.");
        }
      });

      visibleCards
        .filter((card) => card.epic === epic && card.status === status)
        .forEach((card) => {
          laneCell.appendChild(renderCard(card, false, true));
        });

      rowColumns.appendChild(laneCell);
    });

    epicRow.appendChild(rowColumns);
    epicRows.appendChild(epicRow);
  });

  desktopGrid.appendChild(epicRows);
  root.appendChild(desktopGrid);
}

function renderLandingMobile(root) {
  const columns = document.createElement("div");
  columns.className = "landing-columns";

  const landingEpicOrder = getLandingEpicOrder(
    appState.cards.filter((card) => appState.activeEpic === "ALL" || card.epic === appState.activeEpic)
  );

  [STATUS.TODO, STATUS.IN_PROGRESS, STATUS.COMPLETE].forEach((status) => {
    const column = document.createElement("section");
    column.className = "status-column";
    const heading = document.createElement("h2");
    heading.textContent = status;
    column.appendChild(heading);

    const cardsInColumn = appState.cards.filter((card) => {
      const statusMatch = card.status === status;
      const epicMatch = appState.activeEpic === "ALL" || card.epic === appState.activeEpic;
      return statusMatch && epicMatch;
    });

    const byEpic = groupByEpic(cardsInColumn);
    landingEpicOrder.filter((epic) => !!byEpic[epic]).forEach((epic) => {
      const lane = document.createElement("div");
      lane.className = "epic-lane";
      const laneTitle = document.createElement("h3");
      laneTitle.textContent = epic;
      lane.appendChild(laneTitle);

      byEpic[epic].forEach((card) => {
        lane.appendChild(renderCard(card, false, false));
      });

      column.appendChild(lane);
    });

    columns.appendChild(column);
  });

  root.appendChild(columns);
}

function getLandingEpicOrder(cards) {
  const stats = new Map();
  cards.forEach((card) => {
    const epic = card.epic;
    const timestamp = new Date(card.dateAdded).getTime();
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
    const existing = stats.get(epic) || { latest: 0, count: 0 };
    existing.latest = Math.max(existing.latest, safeTimestamp);
    existing.count += 1;
    stats.set(epic, existing);
  });

  return [...stats.entries()]
    .sort((a, b) => {
      if (b[1].latest !== a[1].latest) {
        return b[1].latest - a[1].latest;
      }
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count;
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([epic]) => epic);
}

function renderArchive() {
  renderEpicFilter(el.archiveEpicFilter, appState.epicsArchive, appState.archiveEpic, true);
  el.archiveList.innerHTML = "";

  const cards = appState.archiveCards
    .filter((card) => appState.archiveEpic === "ALL" || card.epic === appState.archiveEpic)
    .sort((a, b) => new Date(b.dateCompleted).getTime() - new Date(a.dateCompleted).getTime());

  for (const card of cards) {
    el.archiveList.appendChild(renderCard(card, true, false));
  }
}

function renderCard(card, isArchive, canDrag) {
  const fragment = el.cardTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".card");
  fragment.querySelector(".card-title").textContent = card.title;
  fragment.querySelector(".card-meta").textContent = `Epic: ${card.epic}`;
  fragment.querySelector(".card-status").textContent = `Status: ${card.status}`;

  if (canDrag) {
    article.classList.add("draggable-card");
    article.setAttribute("draggable", "true");
    article.addEventListener("dragstart", (event) => {
      appState.draggedCardId = card.id;
      event.dataTransfer.effectAllowed = "move";
      article.classList.add("dragging");
    });
    article.addEventListener("dragend", () => {
      article.classList.remove("dragging");
      appState.draggedCardId = null;
      appState.suppressNextCardClick = true;
      clearDropHighlights();
      setTimeout(() => {
        appState.suppressNextCardClick = false;
      }, 0);
    });
  }

  article.addEventListener("click", () => {
    if (appState.suppressNextCardClick) {
      return;
    }
    openCardModal(card, isArchive);
  });
  return fragment;
}

function clearDropHighlights() {
  el.landingView.querySelectorAll(".epic-cell.drag-over").forEach((node) => {
    node.classList.remove("drag-over");
  });
}

async function applyManualStatusOverride(card, nextStatus) {
  const payload = {
    title: card.title,
    epic: card.epic,
    status: nextStatus,
    statusOverride: true,
    checklist: Array.isArray(card.checklist) ? card.checklist : []
  };

  await apiPost("updateCard", {
    id: card.id,
    card: payload,
    sourceView: "landing"
  });

  await refreshData();
  renderLanding();
}

function renderEpicFilter(selectEl, epics, selected, includeAll) {
  selectEl.innerHTML = "";
  if (includeAll) {
    const option = document.createElement("option");
    option.value = "ALL";
    option.textContent = "All Epics";
    selectEl.appendChild(option);
  }

  epics.slice().sort().forEach((epic) => {
    const option = document.createElement("option");
    option.value = epic;
    option.textContent = epic;
    selectEl.appendChild(option);
  });

  const target = selected || (includeAll ? "ALL" : epics[0] || "");
  if ([...selectEl.options].some((opt) => opt.value === target)) {
    selectEl.value = target;
  }
}

function openCardModal(card = null, isArchive = false) {
  appState.editingCardId = card ? card.id : null;
  el.cardModalTitle.textContent = card ? "Edit Card" : "Add Card";
  el.cardId.value = card ? card.id : "";
  el.titleInput.value = card ? card.title : "";

  const allEpics = new Set([
    ...appState.epicsLanding,
    ...appState.epicsArchive,
    ...appState.cards.map((c) => c.epic),
    ...appState.archiveCards.map((c) => c.epic)
  ]);

  el.epicSelect.innerHTML = "";
  [...allEpics].sort().forEach((epic) => {
    const option = document.createElement("option");
    option.value = epic;
    option.textContent = epic;
    el.epicSelect.appendChild(option);
  });

  el.newEpicInput.value = "";
  if (card) {
    if ([...el.epicSelect.options].some((opt) => opt.value === card.epic)) {
      el.epicSelect.value = card.epic;
    }
  }

  el.statusInput.value = card ? card.status : STATUS.TODO;
  el.statusOverrideInput.checked = card ? !!card.statusOverride : false;
  el.statusInput.disabled = false;
  el.statusOverrideInput.disabled = false;
  el.titleInput.readOnly = false;
  el.epicSelect.disabled = false;
  el.newEpicInput.disabled = false;

  const checklist = card && Array.isArray(card.checklist) ? card.checklist : [];
  renderChecklistEditor(checklist);

  if (isArchive) {
    el.titleInput.readOnly = true;
    el.epicSelect.disabled = true;
    el.newEpicInput.disabled = true;
    lockChecklistEditor(true);
    el.statusOverrideInput.disabled = true;
  } else {
    lockChecklistEditor(false);
  }

  el.cardModal.showModal();
}

function renderChecklistEditor(items) {
  el.checklistEditor.innerHTML = "";
  if (!items.length) {
    addChecklistEditorRow();
    return;
  }

  for (const item of items) {
    addChecklistEditorRow(item.text, item.status);
  }
}

function addChecklistEditorRow(text = "", status = STATUS.TODO) {
  const row = document.createElement("div");
  row.className = "checklist-item-row";

  const textInput = document.createElement("input");
  textInput.placeholder = "Checklist item";
  textInput.value = text;
  textInput.className = "checklist-text";

  const statusInput = document.createElement("select");
  statusInput.className = "checklist-status";
  [STATUS.TODO, STATUS.IN_PROGRESS, STATUS.COMPLETE].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    statusInput.appendChild(option);
  });
  statusInput.value = status;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "Remove";
  removeBtn.className = "checklist-remove";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(textInput, statusInput, removeBtn);
  el.checklistEditor.appendChild(row);
}

function lockChecklistEditor(isLocked) {
  const inputs = el.checklistEditor.querySelectorAll("input, select, button");
  inputs.forEach((node) => {
    node.disabled = isLocked;
  });
  el.addChecklistItemBtn.disabled = isLocked;
}

function collectChecklistEditorItems() {
  const rows = [...el.checklistEditor.querySelectorAll(".checklist-item-row")];
  return rows
    .map((row) => {
      const text = row.querySelector(".checklist-text").value.trim();
      const status = row.querySelector(".checklist-status").value;
      return { text, status };
    })
    .filter((item) => item.text.length > 0);
}

function groupByEpic(cards) {
  return cards.reduce((acc, card) => {
    if (!acc[card.epic]) {
      acc[card.epic] = [];
    }
    acc[card.epic].push(card);
    return acc;
  }, {});
}

function pickMobileDefaultEpic(cards) {
  const active = cards.filter((card) => card.status === STATUS.TODO || card.status === STATUS.IN_PROGRESS);
  if (!active.length) {
    return "ALL";
  }

  const score = new Map();
  for (const card of active) {
    const prev = score.get(card.epic) || { latest: 0, count: 0 };
    const timestamp = new Date(card.dateAdded).getTime();
    prev.latest = Math.max(prev.latest, Number.isFinite(timestamp) ? timestamp : 0);
    prev.count += 1;
    score.set(card.epic, prev);
  }

  return [...score.entries()]
    .sort((a, b) => {
      if (b[1].latest !== a[1].latest) {
        return b[1].latest - a[1].latest;
      }
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count;
      }
      return a[0].localeCompare(b[0]);
    })[0][0];
}

async function apiGet(action) {
  const response = await fetch(`${GAS_URL}?action=${encodeURIComponent(action)}`);
  if (!response.ok) {
    throw new Error(`API request failed: ${action}`);
  }
  return response.json();
}

async function apiPost(action, payload) {
  const plainBody = JSON.stringify({ action, ...payload });
  const response = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: plainBody
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${action}`);
  }

  return response.json();
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isConfigured() {
  return GAS_URL && !GAS_URL.startsWith("REPLACE_WITH");
}

init().catch((error) => {
  console.error(error);
  alert("Initialization failed. Confirm your Apps Script URL and backend deployment.");
});
