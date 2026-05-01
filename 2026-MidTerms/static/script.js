const appState = {
  location: null,
  representatives: [],
  featuredBills: [],
  receipts: [],
  pendingBill: null,
  activeQuery: "",
};

const elements = {
  billSearch: document.querySelector("#billSearch"),
  useLocationButton: document.querySelector("#useLocationButton"),
  manualToggle: document.querySelector("#manualToggle"),
  manualPanel: document.querySelector("#manualPanel"),
  stateSelect: document.querySelector("#stateSelect"),
  districtInput: document.querySelector("#districtInput"),
  manualApplyButton: document.querySelector("#manualApplyButton"),
  infoToggle: document.querySelector("#infoToggle"),
  infoPanel: document.querySelector("#infoPanel"),
  infoCloseButton: document.querySelector("#infoCloseButton"),
  statusMessage: document.querySelector("#statusMessage"),
  searchOverlay: document.querySelector("#searchOverlay"),
  overlayLabel: document.querySelector("#overlayLabel"),
  matchCount: document.querySelector("#matchCount"),
  searchResults: document.querySelector("#searchResults"),
  delegationRow: document.querySelector("#delegationRow"),
  emptyState: document.querySelector("#emptyState"),
  receiptStack: document.querySelector("#receiptStack"),
};

let searchTimer = null;

function setStatus(message, tone = "") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.remove("location-loading", "search-loading");
  if (tone) {
    elements.statusMessage.classList.add(tone);
  }
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

async function fetchJson(path, params = {}) {
  const query = buildQuery(params);
  const response = await fetch(`${path}${query ? `?${query}` : ""}`, {
    headers: {
      Accept: "application/json",
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || "REQUEST FAILED.");
  }
  return payload;
}

function normalizeDistrict(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return String(Number.parseInt(digits, 10));
}

function normalizeParty(party) {
  const normalized = String(party || "").trim().toUpperCase();
  if (normalized === "DEMOCRAT" || normalized === "DEMOCRATIC") {
    return "D";
  }
  if (normalized === "REPUBLICAN") {
    return "R";
  }
  return normalized || "I";
}

function memberName(member) {
  return (
    String(member.displayName || "").trim()
    || `${String(member.firstName || "").trim()} ${String(member.lastName || "").trim()}`.trim()
    || String(member.listName || "").trim()
    || "UNKNOWN MEMBER"
  );
}

function voteTone(value) {
  const lowered = String(value || "").toLowerCase();
  if (lowered.includes("yea") || lowered.includes("aye") || lowered === "yes") {
    return "yea";
  }
  if (lowered.includes("nay") || lowered.includes("no")) {
    return "nay";
  }
  return "neutral";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function openOverlay() {
  elements.searchOverlay.classList.remove("hidden");
}

function closeOverlay() {
  elements.searchOverlay.classList.add("hidden");
}

function refreshOverlayFromCurrentQuery() {
  const query = elements.billSearch.value.trim();
  if (query.length >= 2) {
    void performSearch(query);
    return;
  }
  renderOverlayResults(recommendedBills(), false);
  openOverlay();
}

function toggleManualPanel(force) {
  const shouldOpen = typeof force === "boolean"
    ? force
    : elements.manualPanel.classList.contains("hidden");
  elements.manualPanel.classList.toggle("hidden", !shouldOpen);
  elements.manualToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function toggleInfoPanel(force) {
  const shouldOpen = typeof force === "boolean"
    ? force
    : elements.infoPanel.classList.contains("hidden");
  elements.infoPanel.classList.toggle("hidden", !shouldOpen);
  elements.infoToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function renderStateOptions(states) {
  elements.stateSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "STATE";
  elements.stateSelect.append(placeholder);

  states.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.code;
    option.textContent = entry.code;
    elements.stateSelect.append(option);
  });
}

function renderDelegation() {
  if (!appState.representatives.length) {
    elements.delegationRow.classList.add("hidden");
    return;
  }

  elements.delegationRow.innerHTML = appState.representatives
    .map((member) => {
      const party = normalizeParty(member.party);
      const toneClass = party === "D" ? "party-democrat" : party === "R" ? "party-republican" : "party-independent";
      const score = member?.trumpScore?.scoreLabel || "NO DATA";
      return `
        <article class="delegation-card ${toneClass}">
          <p class="rep-name">${escapeHtml(memberName(member))}</p>
          <p class="rep-meta">(${party}) · ${escapeHtml(member.roleLabel || "MEMBER")}</p>
          <p class="rep-score">${escapeHtml(score)} ALIGNMENT</p>
        </article>
      `;
    })
    .join("");

  elements.delegationRow.classList.remove("hidden");
  elements.emptyState.classList.add("hidden");
}

function recommendedBills() {
  return appState.featuredBills.length ? appState.featuredBills : [];
}

function renderOverlayResults(results, queryActive = false) {
  elements.searchResults.innerHTML = "";
  elements.matchCount.textContent = String(results.length);
  elements.overlayLabel.textContent = queryActive ? "SEARCH RESULTS" : "RECOMMENDED BILLS";

  if (!results.length && queryActive) {
    const empty = document.createElement("div");
    empty.className = "overlay-empty";
    empty.innerHTML = `
      <strong class="overlay-empty-title">NO BILLS FOUND</strong>
      <p class="overlay-empty-copy">RECOMMENDED BILLS</p>
    `;
    elements.searchResults.append(empty);
    results = recommendedBills();
    elements.overlayLabel.textContent = "RECOMMENDED BILLS";
  }

  results.forEach((bill) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = bill.featured ? "recommended-option" : "result-option";
    button.innerHTML = `
      <div class="result-option-head">
        <span class="result-label">${escapeHtml(bill.billLabel)}</span>
        ${bill.featured ? '<span class="recommended-tag">RECOMMENDED</span>' : ""}
      </div>
      <p class="result-title">${escapeHtml(bill.title)}</p>
      ${bill.plainDescription || bill.featuredDescription ? `<p class="result-summary">${escapeHtml(bill.plainDescription || bill.featuredDescription)}</p>` : ""}
    `;
    button.addEventListener("click", () => {
      elements.billSearch.value = bill.billLabel;
      appState.pendingBill = bill;
      closeOverlay();
      if (!appState.location) {
        setStatus("LOCATION REQUIRED. TAP USE MY LOCATION TO LOAD THE RECEIPT.");
        return;
      }
      void loadBillReceipt(bill);
    });
    elements.searchResults.append(button);
  });
}

function renderVoteRows(payload) {
  const memberVotes = [];
  (payload.votes || []).forEach((vote) => {
    (vote.members || []).forEach((member) => {
      memberVotes.push({
        name: member.name,
        roleLabel: member.roleLabel || "MEMBER",
        position: member.position || member.vote || "NOT VOTING",
        explanation: member.explanation || "",
      });
    });
  });

  return memberVotes
    .map((member) => {
      const tone = voteTone(member.position);
      const toneClass = tone === "yea" ? "status-yea" : tone === "nay" ? "status-nay" : "status-neutral";
      return `
        <div class="vote-row">
          <div>
            <p class="vote-name">${escapeHtml(member.name)}</p>
            <p class="vote-role">${escapeHtml(member.roleLabel)}</p>
          </div>
          <span class="vote-pill ${toneClass}">${escapeHtml(String(member.position).toUpperCase())}</span>
        </div>
      `;
    })
    .join("");
}

function deriveReceiptStatus(payload) {
  let yeaCount = 0;
  let nayCount = 0;

  (payload.votes || []).forEach((vote) => {
    (vote.members || []).forEach((member) => {
      const tone = voteTone(member.position || member.vote);
      if (tone === "yea") {
        yeaCount += 1;
      } else if (tone === "nay") {
        nayCount += 1;
      }
    });
  });

  if (yeaCount > nayCount) {
    return { label: "YEA", className: "status-yea" };
  }
  if (nayCount > yeaCount) {
    return { label: "NAY", className: "status-nay" };
  }
  return { label: "SPLIT", className: "status-split" };
}

function renderReceipts() {
  elements.receiptStack.innerHTML = "";

  appState.receipts.forEach((payload, index) => {
    const status = deriveReceiptStatus(payload);
    const receipt = document.createElement("article");
    receipt.className = "receipt-card";
    receipt.innerHTML = `
      <button class="accordion-toggle" type="button" aria-expanded="false">
        <div class="accordion-strip">
          <span class="accordion-title">${escapeHtml(payload.bill.title)}</span>
          <span class="status-block ${status.className}">${status.label}</span>
        </div>
      </button>
      <div class="receipt-body hidden">
        <div class="detail-grid">
          <p class="summary-line">${escapeHtml(payload.bill.billLabel)} · ${escapeHtml(payload.bill.latestActionDate || payload.bill.introducedDate || "UNKNOWN DATE")}</p>
          <p class="detail-summary">${escapeHtml(payload.bill.plainDescription || "OFFICIAL BILL SUMMARY")}</p>
        </div>
        <div class="vote-list">${renderVoteRows(payload)}</div>
        <div class="receipt-links">
          ${payload.bill.billUrl ? `<a class="external-link" href="${payload.bill.billUrl}" target="_blank" rel="noreferrer">CONGRESS.GOV</a>` : ""}
          <a class="external-link" href="https://api.congress.gov/" target="_blank" rel="noreferrer">METHOD</a>
        </div>
      </div>
    `;

    const toggle = receipt.querySelector(".accordion-toggle");
    const body = receipt.querySelector(".receipt-body");
    toggle.addEventListener("click", () => {
      const isOpen = !body.classList.contains("hidden");
      body.classList.toggle("hidden", isOpen);
      toggle.setAttribute("aria-expanded", isOpen ? "false" : "true");
    });

    elements.receiptStack.append(receipt);
    if (index === 0) {
      receipt.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });
}

async function loadFeaturedBills() {
  const payload = await fetchJson("/api/search-bills", { featured: "1" });
  appState.featuredBills = payload.results || [];
  renderOverlayResults(appState.featuredBills, false);
}

async function performSearch(query) {
  appState.activeQuery = query.trim();
  openOverlay();

  if (appState.activeQuery.length < 2) {
    renderOverlayResults(recommendedBills(), false);
    return;
  }

  setStatus(`SEARCHING FOR ${appState.activeQuery.toUpperCase()}...`, "search-loading");
  const payload = await fetchJson("/api/search-bills", { q: appState.activeQuery });
  renderOverlayResults(payload.results || [], true);
  setStatus(payload.results?.length ? "SELECT A BILL TO LOAD THE RECEIPT." : "NO BILLS FOUND.");
}

async function loadBillReceipt(bill) {
  if (!appState.location) {
    appState.pendingBill = bill;
    setStatus("LOCATION REQUIRED. TAP USE MY LOCATION TO LOAD THE RECEIPT.");
    return;
  }

  setStatus(`LOADING ${bill.billLabel}...`, "search-loading");
  const payload = await fetchJson("/api/bill-votes", {
    congress: bill.congress,
    billType: bill.billType,
    billNumber: bill.billNumber,
    state: appState.location.state,
    district: appState.location.district,
  });

  appState.receipts = [
    payload,
    ...appState.receipts.filter(
      (entry) => `${entry.bill.congress}-${entry.bill.billType}-${entry.bill.billNumber}`
        !== `${payload.bill.congress}-${payload.bill.billType}-${payload.bill.billNumber}`
    ),
  ];

  renderReceipts();
  setStatus(`RECEIPT LOADED FOR ${payload.bill.billLabel}.`);
}

async function loadLocation(stateCode, districtCode) {
  setStatus("LOADING YOUR DELEGATION...", "location-loading");
  const repsPayload = await fetchJson("/api/representatives", {
    state: stateCode,
    district: districtCode,
  });

  appState.location = {
    state: repsPayload.state,
    district: repsPayload.district,
  };
  appState.representatives = repsPayload.representatives || [];
  renderDelegation();

  if (appState.pendingBill) {
    await loadBillReceipt(appState.pendingBill);
    return;
  }

  const spotlight = appState.featuredBills[0];
  if (spotlight) {
    await loadBillReceipt(spotlight);
    return;
  }

  setStatus("DELEGATION LOADED.");
}

function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `repJsonp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement("script");
    const separator = url.includes("?") ? "&" : "?";

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("DISTRICT LOOKUP FAILED."));
    };

    script.src = `${url}${separator}format=jsonp&callback=${callbackName}`;
    document.body.append(script);
  });
}

function extractDistrictInfo(payload, states) {
  const geographies = payload?.result?.geographies;
  if (!geographies) {
    throw new Error("DISTRICT LOOKUP FAILED.");
  }

  const stateName = geographies?.States?.[0]?.NAME;
  const matchedState = states.find((entry) => entry.name === stateName);
  const districtEntries =
    geographies["119th Congressional Districts"]
    || geographies["118th Congressional Districts"]
    || [];
  const rawDistrict = districtEntries[0]?.CD119 || districtEntries[0]?.CD118 || districtEntries[0]?.DISTRICT;
  const district = normalizeDistrict(rawDistrict);

  if (!matchedState?.code || district === "") {
    throw new Error("I COULD NOT MAP THAT LOCATION TO A HOUSE DISTRICT.");
  }

  return {
    state: matchedState.code,
    district,
  };
}

async function reverseGeocodeLocation(latitude, longitude, states) {
  const params = new URLSearchParams({
    x: String(longitude),
    y: String(latitude),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
  });
  const payload = await loadJsonp(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${params.toString()}`);
  return extractDistrictInfo(payload, states);
}

async function handleUseLocation() {
  if (!navigator.geolocation) {
    setStatus("THIS BROWSER DOES NOT SUPPORT GEOLOCATION.");
    return;
  }

  setStatus("REQUESTING YOUR LOCATION...", "location-loading");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const config = await fetchJson("/api/config");
        const location = await reverseGeocodeLocation(
          position.coords.latitude,
          position.coords.longitude,
          config.states || []
        );
        await loadLocation(location.state, location.district);
      } catch (error) {
        setStatus(error.message || "LOCATION LOOKUP FAILED.");
      }
    },
    () => {
      setStatus("LOCATION ACCESS WAS DENIED.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    }
  );
}

function wireEvents() {
  elements.useLocationButton.addEventListener("click", handleUseLocation);
  elements.manualToggle.addEventListener("click", () => {
    toggleManualPanel();
  });
  elements.manualApplyButton.addEventListener("click", async () => {
    const stateCode = elements.stateSelect.value;
    const district = normalizeDistrict(elements.districtInput.value);

    if (!stateCode || !district) {
      setStatus("STATE AND DISTRICT ARE REQUIRED.");
      return;
    }

    try {
      await loadLocation(stateCode, district);
      toggleManualPanel(false);
    } catch (error) {
      setStatus(error.message || "DISTRICT LOOKUP FAILED.");
    }
  });

  elements.infoToggle.addEventListener("click", () => toggleInfoPanel());
  elements.infoCloseButton.addEventListener("click", () => toggleInfoPanel(false));

  elements.billSearch.addEventListener("focus", () => {
    refreshOverlayFromCurrentQuery();
  });

  elements.billSearch.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      refreshOverlayFromCurrentQuery();
    }, 180);
  });

  elements.billSearch.addEventListener("click", () => {
    refreshOverlayFromCurrentQuery();
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (
      !elements.searchOverlay.contains(event.target)
      && event.target !== elements.billSearch
    ) {
      closeOverlay();
    }
  });
}

async function bootstrap() {
  try {
    const config = await fetchJson("/api/config");
    renderStateOptions(config.states || []);
    await loadFeaturedBills();
    wireEvents();
    elements.billSearch.focus({ preventScroll: true });
  } catch (error) {
    setStatus(error.message || "BOOT FAILED.");
  }
}

bootstrap();
