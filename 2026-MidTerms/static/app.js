const state = {
  selectedBill: null,
  activeQuery: "",
  lastLocationKey: "",
  stateNameToCode: {},
  suppressLocationEvents: false,
};

const DEFAULT_EMPTY_STATE_TITLE = "Pick a bill to unlock the vote breakdown";
const DEFAULT_EMPTY_STATE_BODY =
  "This prototype focuses on enacted laws from the 118th and 119th Congresses, plus a small featured comparison set. Choose a result on the left and we will pull the official House and Senate roll calls.";
const LOCATION_READY_EMPTY_STATE_TITLE = "Pick a featured bill to unlock the vote breakdown";
const LOCATION_READY_EMPTY_STATE_BODY =
  "Your representatives are pinned above. Select a featured bill to compare their recorded votes.";

const elements = {
  billSearch: document.querySelector("#billSearch"),
  stateSelect: document.querySelector("#stateSelect"),
  districtInput: document.querySelector("#districtInput"),
  districtSelectField: document.querySelector("#districtSelectField"),
  districtSelect: document.querySelector("#districtSelect"),
  zipInput: document.querySelector("#zipInput"),
  useLocationButton: document.querySelector("#useLocationButton"),
  infoButton: document.querySelector("#infoButton"),
  infoPanel: document.querySelector("#infoPanel"),
  searchResults: document.querySelector("#searchResults"),
  statusMessage: document.querySelector("#statusMessage"),
  matchCount: document.querySelector("#matchCount"),
  clearButton: document.querySelector("#clearButton"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateTitle: document.querySelector("#emptyState h2"),
  emptyStateBody: document.querySelector("#emptyState p"),
  representativesModule: document.querySelector("#representativesModule"),
  representativesMeta: document.querySelector("#representativesMeta"),
  representativesCards: document.querySelector("#representativesCards"),
  billDetail: document.querySelector("#billDetail"),
  billLabel: document.querySelector("#billLabel"),
  billTitle: document.querySelector("#billTitle"),
  lawBadge: document.querySelector("#lawBadge"),
  billMeta: document.querySelector("#billMeta"),
  delegationCards: document.querySelector("#delegationCards"),
  voteTimeline: document.querySelector("#voteTimeline"),
};

let searchTimer = null;
let zipTimer = null;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error("The server returned an invalid response.");
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong.");
  }

  return payload;
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, value);
    }
  });
  return query.toString();
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function normalizedDistrictValue() {
  const digits = (elements.districtInput.value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return String(Number.parseInt(digits, 10));
}

function normalizedZipValue() {
  const digits = (elements.zipInput?.value || "").replace(/\D/g, "");
  return digits.slice(0, 5);
}

function hasManualLocationSelection() {
  return Boolean(elements.stateSelect.value && normalizedDistrictValue());
}

function hasZipSelection() {
  return normalizedZipValue().length === 5;
}

function currentLocationKey() {
  if (hasZipSelection()) {
    return `zip:${normalizedZipValue()}:${elements.stateSelect.value}:${normalizedDistrictValue()}`;
  }

  if (hasManualLocationSelection()) {
    return `manual:${elements.stateSelect.value}:${normalizedDistrictValue()}`;
  }

  return "";
}

function syncDistrictInput() {
  const normalizedDistrict = normalizedDistrictValue();
  if (normalizedDistrict) {
    elements.districtInput.value = normalizedDistrict;
  }
}

function syncZipInput() {
  if (!elements.zipInput) {
    return;
  }
  elements.zipInput.value = normalizedZipValue();
}

function setEmptyStateCopy(title, body = "") {
  if (elements.emptyStateTitle) {
    elements.emptyStateTitle.textContent = title;
  }
  if (elements.emptyStateBody) {
    elements.emptyStateBody.textContent = body;
    elements.emptyStateBody.hidden = !body;
  }
}

function showDefaultEmptyState() {
  if (state.selectedBill) {
    return;
  }
  elements.billDetail.classList.add("detail-hidden");
  elements.emptyState.style.display = "";
  elements.emptyState.hidden = false;
  elements.emptyState.classList.remove("detail-hidden");
  setEmptyStateCopy(DEFAULT_EMPTY_STATE_TITLE, DEFAULT_EMPTY_STATE_BODY);
}

function showLocationReadyEmptyState() {
  if (state.selectedBill) {
    return;
  }
  elements.billDetail.classList.add("detail-hidden");
  elements.emptyState.style.display = "";
  elements.emptyState.hidden = false;
  elements.emptyState.classList.remove("detail-hidden");
  setEmptyStateCopy(LOCATION_READY_EMPTY_STATE_TITLE, LOCATION_READY_EMPTY_STATE_BODY);
}

function hideInstructionState() {
  elements.emptyState.style.display = "none";
  elements.emptyState.hidden = true;
  elements.emptyState.classList.add("detail-hidden");
  setEmptyStateCopy("", "");
}

function hidePinnedRepresentatives() {
  if (!elements.representativesModule) {
    return;
  }
  elements.representativesModule.classList.add("detail-hidden");
}

function renderStateOptions(states) {
  elements.stateSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a state";
  elements.stateSelect.append(placeholder);

  states.forEach((stateOption) => {
    state.stateNameToCode[stateOption.name] = stateOption.code;
    const option = document.createElement("option");
    option.value = stateOption.code;
    option.textContent = `${stateOption.name} (${stateOption.code})`;
    elements.stateSelect.append(option);
  });
}

function setLocationButtonState(isLoading) {
  if (!elements.useLocationButton) {
    return;
  }

  elements.useLocationButton.disabled = isLoading;
  elements.useLocationButton.textContent = isLoading ? "Finding..." : "Locate";
}

function toggleInfoPanel(forceOpen) {
  if (!elements.infoButton || !elements.infoPanel) {
    return;
  }

  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : elements.infoPanel.classList.contains("detail-hidden");

  elements.infoPanel.classList.toggle("detail-hidden", !shouldOpen);
  elements.infoButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `codexJsonp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      reject(new Error("Could not look up your district from those coordinates."));
    };

    script.src = `${url}${separator}format=jsonp&callback=${callbackName}`;
    document.body.append(script);
  });
}

function findStateCodeByName(stateName) {
  return state.stateNameToCode[stateName] || "";
}

function extractDistrictInfo(payload) {
  const geographies = payload?.result?.geographies;
  if (!geographies) {
    throw new Error("The reverse geocoder did not return geography data.");
  }

  const states = geographies.States || [];
  const stateName = states[0]?.NAME;
  const stateCode = findStateCodeByName(stateName);
  if (!stateCode) {
    throw new Error("I found your location, but could not match it to a supported state.");
  }

  const congressionalKey =
    Object.keys(geographies).find((key) => key === "119th Congressional Districts") ||
    Object.keys(geographies).find((key) => key.includes("Congressional Districts"));
  const districtEntries = congressionalKey ? geographies[congressionalKey] || [] : [];
  const rawDistrict = districtEntries[0]?.CD119 || districtEntries[0]?.CD118 || districtEntries[0]?.DISTRICT;

  if (rawDistrict === undefined || rawDistrict === null) {
    throw new Error("I found your state, but not a congressional district for that location.");
  }

  const districtNumber = String(Number.parseInt(rawDistrict, 10));
  if (Number.isNaN(Number.parseInt(districtNumber, 10))) {
    throw new Error("I could not read the congressional district for that location.");
  }

  return {
    stateCode,
    stateName,
    district: districtNumber,
  };
}

async function reverseGeocodeLocation(latitude, longitude) {
  const baseUrl = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
  const params = new URLSearchParams({
    x: String(longitude),
    y: String(latitude),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
  });

  const payload = await loadJsonp(`${baseUrl}?${params.toString()}`);
  return extractDistrictInfo(payload);
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    });
  });
}

function representativeLocationLabel(stateCode, district) {
  if (!stateCode) {
    return "";
  }
  if (district === "0") {
    return `${stateCode} AT-LARGE`;
  }
  if (district === "98") {
    return `${stateCode} DELEGATE`;
  }
  return district ? `${stateCode}-${district}` : stateCode;
}

function normalizePartyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "D" || normalized === "DEMOCRAT" || normalized === "DEMOCRATIC") {
    return "D";
  }
  if (normalized === "R" || normalized === "REPUBLICAN") {
    return "R";
  }
  return normalized || "";
}

function partyToneClass(partyCode) {
  if (partyCode === "D") {
    return "party-democrat";
  }
  if (partyCode === "R") {
    return "party-republican";
  }
  return "party-independent";
}

function displayMemberName(member) {
  const displayName = String(member.displayName || "").trim();
  if (displayName) {
    return displayName;
  }

  const firstName = String(member.firstName || "").trim();
  const lastName = String(member.lastName || "").trim();
  const combined = `${firstName} ${lastName}`.trim();
  if (combined) {
    return combined;
  }

  const listName = String(member.listName || "").trim();
  if (listName) {
    return listName;
  }

  return "Unknown member";
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildContactMarkup(url, label, options = {}) {
  if (!url) {
    return `<span class="muted contact-link-disabled">${options.fallback || `${label} unavailable`}</span>`;
  }

  const attributes = [
    `href="${escapeAttribute(url)}"`,
    `class="contact-link"`,
  ];

  if (options.newTab !== false && !url.startsWith("tel:") && !url.startsWith("mailto:")) {
    attributes.push('target="_blank"');
    attributes.push('rel="noreferrer"');
  }

  if (options.title) {
    attributes.push(`title="${escapeAttribute(options.title)}"`);
  }

  if (options.ariaLabel) {
    attributes.push(`aria-label="${escapeAttribute(options.ariaLabel)}"`);
  }

  return `<a ${attributes.join(" ")}>${label}</a>`;
}

function buildRepresentativeCardMarkup(member, extraLabel = "") {
  const displayName = displayMemberName(member);
  const partyCode = normalizePartyCode(member.party);
  const partyMarkup = partyCode
    ? `<span class="party-pill ${partyToneClass(partyCode)}" aria-label="Party ${partyCode}">(${partyCode})</span>`
    : "";
  const phoneMarkup = buildContactMarkup(
    member.phone ? `tel:${member.phone}` : "",
    "Phone",
    {
      newTab: false,
      title: member.phone || "",
      ariaLabel: member.phone
        ? `Call ${displayName || "this office"} at ${member.phone}`
        : "",
      fallback: "Phone unavailable",
    }
  );
  const contactUrl = member.email ? `mailto:${member.email}` : member.website;
  const contactLabel = member.email ? "Email" : "Contact";
  const contactMarkup = buildContactMarkup(contactUrl || "", contactLabel, {
    newTab: !member.email,
    title: member.email || member.website || "",
    ariaLabel: member.email
      ? `Email ${displayName || "this office"}`
      : `Open official contact page for ${displayName || "this office"}`,
    fallback: member.email ? "Email unavailable" : "Contact unavailable",
  });
  const financeMarkup = buildContactMarkup(member.financeUrl || "", "OpenSecrets", {
    title: "Open campaign finance profile on OpenSecrets",
    ariaLabel: `Open OpenSecrets finance data for ${displayName || "this office"}`,
    fallback: "Finance data unavailable",
  });
  const locationLabel = representativeLocationLabel(member.state, member.district);

  return `
    <p class="delegate-role">${member.roleLabel || "Representative"}</p>
    <div class="delegate-heading-row">
      <div class="delegate-name-group">
        <h3>${displayName}</h3>
        ${partyMarkup}
      </div>
    </div>
    <p class="delegate-meta">${member.party || "Unknown party"}${locationLabel ? ` · ${locationLabel}` : ""}</p>
    ${extraLabel ? `<p class="delegate-select-label">${extraLabel}</p>` : ""}
    <div class="contact-row">
      ${phoneMarkup}
      ${contactMarkup}
      ${financeMarkup}
    </div>
  `;
}

function resetRepresentativesModule() {
  if (!elements.representativesModule) {
    return;
  }
  elements.representativesModule.classList.add("detail-hidden");
  elements.representativesCards.innerHTML = "";
  elements.representativesMeta.textContent = "Set your location to pin your current delegation here.";
}

function renderPinnedRepresentatives(representatives, locationLabel) {
  if (!elements.representativesModule) {
    return;
  }

  elements.representativesCards.innerHTML = "";
  elements.representativesModule.classList.remove("detail-hidden");
  elements.representativesMeta.textContent = locationLabel
    ? `Pinned for ${locationLabel}. These members stay visible while you browse bills.`
    : "Pinned current delegation.";

  if (!representatives.length) {
    const note = document.createElement("p");
    note.className = "inline-note";
    note.textContent = "No representatives were returned for that location.";
    elements.representativesCards.append(note);
    return;
  }

  representatives.forEach((member) => {
    const card = document.createElement("article");
    card.className = "delegate-card delegate-card-pinned";
    card.innerHTML = buildRepresentativeCardMarkup(member);
    elements.representativesCards.append(card);
  });
}

function formatBillMeta(bill) {
  const segments = [];
  if (bill.lawNumber) {
    segments.push(`LAW: ${bill.lawNumber}`);
    if (bill.latestActionDate) {
      segments.push(`SIGNED: ${bill.latestActionDate}`);
    }
    return segments.join(" | ");
  }

  if (bill.billLabel) {
    segments.push(`BILL: ${bill.billLabel}`);
  }
  if (bill.latestActionDate) {
    segments.push(`LAST ACTION: ${bill.latestActionDate}`);
  }
  return segments.join(" | ") || "Official congressional bill activity";
}

function renderDistrictSelector(options, selectedState, selectedDistrict) {
  if (!elements.districtSelectField || !elements.districtSelect) {
    return;
  }

  elements.districtSelect.innerHTML = "";

  if (!options.length || options.length === 1) {
    elements.districtSelectField.classList.add("detail-hidden");
    return;
  }

  options.forEach((option) => {
    const selectOption = document.createElement("option");
    selectOption.value = `${option.state}|${option.district}`;
    const coverageLabel = option.coveragePercent ? ` · ${option.coveragePercent}% OF ZIP` : "";
    selectOption.textContent = `${option.label}${coverageLabel}`;
    if (option.state === selectedState && option.district === selectedDistrict) {
      selectOption.selected = true;
    }
    elements.districtSelect.append(selectOption);
  });

  elements.districtSelectField.classList.remove("detail-hidden");
}

async function loadRepresentatives(options = {}) {
  const zip = options.zip ?? normalizedZipValue();
  const stateCode = options.state ?? elements.stateSelect.value;
  const district = options.district ?? normalizedDistrictValue();
  const query = {};

  if (zip && zip.length === 5) {
    query.zip = zip;
    if (stateCode) {
      query.state = stateCode;
    }
    if (district) {
      query.district = district;
    }
  } else if (stateCode && district) {
    query.state = stateCode;
    query.district = district;
  } else {
    resetRepresentativesModule();
    renderDistrictSelector([], "", "");
    return null;
  }

  if (!options.quiet) {
    setStatus("Loading your representatives...");
  }

  const payload = await fetchJson(`/api/representatives?${buildQuery(query)}`);

  state.suppressLocationEvents = true;
  elements.stateSelect.value = payload.state || "";
  elements.districtInput.value = payload.district || "";
  if (payload.zip && elements.zipInput) {
    elements.zipInput.value = payload.zip;
  }
  state.suppressLocationEvents = false;

  renderDistrictSelector(payload.districtOptions || [], payload.state, payload.district);
  renderPinnedRepresentatives(
    payload.representatives || [],
    representativeLocationLabel(payload.state, payload.district)
  );

  return payload;
}

function renderSearchResults(results) {
  elements.searchResults.innerHTML = "";
  elements.matchCount.textContent = `${results.length} result${results.length === 1 ? "" : "s"}`;

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "No matching bills were found.";
    elements.searchResults.append(empty);
    return;
  }

  const featuredResults = results.filter((result) => result.featured);
  const standardResults = results.filter((result) => !result.featured);

  const appendSection = (label, sectionResults) => {
    if (!sectionResults.length) {
      return;
    }

    if (label) {
      const sectionLabel = document.createElement("p");
      sectionLabel.className = "search-section-label";
      sectionLabel.textContent = label;
      elements.searchResults.append(sectionLabel);
    }

    sectionResults.forEach((result) => {
      const badgeMarkup = result.featured
        ? `<span class="featured-tag">${result.featuredLabel || "FEATURED"}</span>`
        : "";
      const detailLabel = result.lawNumber
        ? result.lawNumber
        : `${result.congressLabel || `${result.congress}th`} Congress`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-card";
      button.dataset.congress = result.congress;
      button.dataset.billType = result.billType;
      button.dataset.billNumber = result.billNumber;
      button.innerHTML = `
        <div class="result-card-top">
          <div class="result-card-tags">
            <span class="result-label">${result.billLabel}</span>
            ${badgeMarkup}
          </div>
          <span class="result-arrow" aria-hidden="true">View</span>
        </div>
        <strong>${result.title}</strong>
        <span class="result-meta">${result.latestActionDate || result.introducedDate || "Unknown date"} · ${detailLabel}</span>
      `;
      button.addEventListener("click", () => {
        state.selectedBill = result;
        loadBillVotes(result);
      });
      elements.searchResults.append(button);
    });
  };

  if (featuredResults.length) {
    appendSection("FEATURED BILLS", featuredResults);
  }

  appendSection(featuredResults.length && standardResults.length ? "MATCHES" : "", standardResults);
}

function renderDelegation(representatives) {
  elements.delegationCards.innerHTML = "";

  if (!representatives.length) {
    const note = document.createElement("p");
    note.className = "inline-note";
    note.textContent = "No delegation members were returned for that state and district.";
    elements.delegationCards.append(note);
    return;
  }

  representatives.forEach((member) => {
    const card = document.createElement("article");
    card.className = "delegate-card";
    card.innerHTML = buildRepresentativeCardMarkup(member);
    elements.delegationCards.append(card);
  });
}

function voteTone(vote) {
  const lowered = (vote || "").toLowerCase();
  if (lowered.includes("yea") || lowered.includes("aye") || lowered === "yes") {
    return "vote-yes";
  }
  if (lowered.includes("nay") || lowered.includes("no")) {
    return "vote-no";
  }
  if (lowered.includes("present")) {
    return "vote-present";
  }
  return "vote-neutral";
}

function voteSymbol(vote) {
  const tone = voteTone(vote);
  if (tone === "vote-yes") {
    return "✓";
  }
  if (tone === "vote-no") {
    return "✕";
  }
  if (tone === "vote-present") {
    return "•";
  }
  return "–";
}

function renderVotes(votes) {
  elements.voteTimeline.innerHTML = "";

  if (!votes.length) {
    const note = document.createElement("p");
    note.className = "inline-note";
    note.textContent = "No passage-related roll calls were found for this bill.";
    elements.voteTimeline.append(note);
    return;
  }

  votes.forEach((vote) => {
    const card = document.createElement("article");
    card.className = "vote-card";
    const memberList = vote.members || vote.positions || [];

    const memberMarkup = memberList
      .map(
        (member) => `
          <div class="member-vote">
            <div>
              <p class="member-name">${member.name}</p>
              <p class="member-role">${member.roleLabel || "Delegation member"}</p>
              ${member.explanation ? `<p class="member-note">${member.explanation}</p>` : ""}
            </div>
            <span class="vote-badge ${voteTone(member.position || member.vote)}">
              <span class="vote-icon" aria-hidden="true">${voteSymbol(member.position || member.vote)}</span>
              <span>${member.position || member.vote}</span>
            </span>
          </div>
        `
      )
      .join("");

    card.innerHTML = `
      <div class="vote-topline">
        <span class="vote-chamber">${vote.chamber || "Vote"}</span>
        <span class="vote-roll">Roll ${vote.rollNumber || "?"}</span>
      </div>
      <h3>${vote.question || vote.actionText}</h3>
      <p class="vote-meta">${vote.voteDate || "Unknown date"}${vote.result ? ` · ${vote.result}` : ""}</p>
      <p class="vote-description">${vote.actionText}</p>
      <div class="member-votes">${memberMarkup}</div>
      <a class="source-link" href="${vote.sourceUrl}" target="_blank" rel="noreferrer">Open official roll call source</a>
    `;
    elements.voteTimeline.append(card);
  });
}

function showDetail(payload) {
  hideInstructionState();
  hidePinnedRepresentatives();
  elements.billDetail.classList.remove("detail-hidden");

  elements.billLabel.textContent = payload.bill.billLabel;
  elements.billTitle.textContent = payload.bill.title;
  elements.lawBadge.textContent =
    payload.bill.lawNumber
      ? "Public Law"
      : `${payload.bill.congressLabel || `${payload.bill.congress}th`} Congress Bill`;
  elements.billMeta.textContent = formatBillMeta(payload.bill);

  renderDelegation(payload.representatives || []);
  renderVotes(payload.votes || []);
}

async function loadBillVotes(result) {
  const stateCode = elements.stateSelect.value;
  const district = normalizedDistrictValue();

  if (!stateCode) {
    setStatus("Choose a state or ZIP code first so I can look up the right delegation.");
    return;
  }

  if (!district) {
    setStatus("Add a House district number too, then pick the bill again.");
    return;
  }

  setStatus(`Loading vote history for ${result.billLabel}...`);
  hideInstructionState();
  hidePinnedRepresentatives();
  elements.billDetail.classList.remove("detail-hidden");
  elements.delegationCards.innerHTML = "";
  elements.voteTimeline.innerHTML = "";

  try {
    const query = buildQuery({
      congress: result.congress,
      billType: result.billType,
      billNumber: result.billNumber,
      state: stateCode,
      district,
    });
    const payload = await fetchJson(`/api/bill-votes?${query}`);
    showDetail(payload);
    setStatus(`Showing official vote records for ${payload.bill.billLabel}.`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function runSearch(options = {}) {
  const forceFeatured = options.featured === true;
  const query = forceFeatured ? "" : elements.billSearch.value.trim();
  state.activeQuery = query;
  if (forceFeatured) {
    elements.billSearch.value = "";
  }
  const isFeaturedMode = forceFeatured || query.length < 2;
  const queryString = buildQuery(forceFeatured ? { featured: "1" } : { q: query });
  const url = queryString ? `/api/search-bills?${queryString}` : "/api/search-bills";

  setStatus(isFeaturedMode ? "Loading featured bills..." : `Searching for “${query}”...`);

  try {
    const payload = await fetchJson(url);
    if (state.activeQuery !== query) {
      return;
    }
    renderSearchResults(payload.results || []);
    if (isFeaturedMode) {
      const featuredStatus = options.statusMessage
        || (payload.results?.length
          ? "Featured bills loaded. Pick one to see the delegation vote cards."
          : "No featured bills are available right now.");
      setStatus(featuredStatus);
    } else {
      setStatus(payload.results?.length ? "Pick a result to see the delegation vote cards." : "No close matches yet.");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function handleLocationReady(statusPrefix = "Location set.", force = false) {
  syncDistrictInput();
  syncZipInput();

  const locationKey = currentLocationKey();
  if (!locationKey) {
    state.lastLocationKey = "";
    resetRepresentativesModule();
    renderDistrictSelector([], "", "");
    showDefaultEmptyState();
    return;
  }

  if (!force && locationKey === state.lastLocationKey) {
    return;
  }

  state.lastLocationKey = locationKey;

  try {
    const payload = await loadRepresentatives({ quiet: true });
    if (!payload) {
      showDefaultEmptyState();
      return;
    }

    state.lastLocationKey = payload.zip
      ? `zip:${payload.zip}:${payload.state}:${payload.district || ""}`
      : `manual:${payload.state}:${payload.district || ""}`;

    const locationLabel = representativeLocationLabel(payload.state, payload.district);

    if (state.selectedBill) {
      await loadBillVotes(state.selectedBill);
      return;
    }

    showLocationReadyEmptyState();
    const statusMessage = payload.hasMultipleDistrictMatches
      ? `${statusPrefix} Representatives pinned for ${locationLabel}. This ZIP crosses multiple districts, so use the selector if needed, then choose a featured bill below to view votes.`
      : `${statusPrefix} Representatives pinned for ${locationLabel}. Select a featured bill below to view votes.`;

    await runSearch({
      featured: true,
      statusMessage,
    });
  } catch (error) {
    resetRepresentativesModule();
    setStatus(error.message || "I could not load your representatives just now.");
  }
}

function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 250);
}

function scheduleZipLookup() {
  window.clearTimeout(zipTimer);
  zipTimer = window.setTimeout(async () => {
    if (normalizedZipValue().length === 5) {
      await handleLocationReady("ZIP code set.", true);
    }
  }, 180);
}

function clearZipContext() {
  if (elements.zipInput) {
    elements.zipInput.value = "";
  }
  renderDistrictSelector([], "", "");
}

async function applyDetectedLocation(locationInfo) {
  state.suppressLocationEvents = true;
  clearZipContext();
  elements.stateSelect.value = locationInfo.stateCode;
  elements.districtInput.value = locationInfo.district;
  state.suppressLocationEvents = false;
  await handleLocationReady(`Location set for ${locationInfo.stateName}, district ${locationInfo.district}.`, true);
}

async function handleUseMyLocation() {
  setLocationButtonState(true);
  setStatus("Requesting your location...");

  try {
    const position = await getCurrentPosition();
    setStatus("Looking up your congressional district...");

    const locationInfo = await reverseGeocodeLocation(
      position.coords.latitude,
      position.coords.longitude
    );

    await applyDetectedLocation(locationInfo);
  } catch (error) {
    if (error?.code === 1) {
      setStatus("Location access was denied. You can still enter a ZIP code or choose your district manually.");
    } else if (error?.code === 2) {
      setStatus("Your location could not be determined. Please try again or enter a ZIP code.");
    } else if (error?.code === 3) {
      setStatus("The location request timed out. Please try again.");
    } else {
      setStatus(error.message || "I could not use your location just now.");
    }
  } finally {
    setLocationButtonState(false);
  }
}

function wireEvents() {
  elements.billSearch.addEventListener("input", scheduleSearch);
  elements.useLocationButton.addEventListener("click", handleUseMyLocation);

  if (elements.infoButton) {
    elements.infoButton.addEventListener("click", () => {
      toggleInfoPanel();
    });
  }

  elements.clearButton.addEventListener("click", () => {
    state.selectedBill = null;
    state.activeQuery = "";
    state.lastLocationKey = "";
    state.suppressLocationEvents = true;
    elements.billSearch.value = "";
    elements.zipInput.value = "";
    elements.stateSelect.value = "";
    elements.districtInput.value = "";
    state.suppressLocationEvents = false;
    renderDistrictSelector([], "", "");
    resetRepresentativesModule();
    showDefaultEmptyState();
    runSearch();
  });

  elements.stateSelect.addEventListener("change", async () => {
    if (state.suppressLocationEvents) {
      return;
    }
    clearZipContext();
    elements.districtInput.value = "";
    await handleLocationReady("Location set.");
  });

  elements.districtInput.addEventListener("input", async () => {
    if (state.suppressLocationEvents) {
      return;
    }
    clearZipContext();
    await handleLocationReady("Location set.");
  });

  elements.districtInput.addEventListener("change", async () => {
    if (state.suppressLocationEvents) {
      return;
    }
    clearZipContext();
    await handleLocationReady("Location set.");
  });

  elements.zipInput.addEventListener("input", () => {
    if (state.suppressLocationEvents) {
      return;
    }
    syncZipInput();
    if (normalizedZipValue().length === 5) {
      scheduleZipLookup();
      return;
    }

    renderDistrictSelector([], "", "");
    if (!hasManualLocationSelection() && !normalizedZipValue()) {
      state.lastLocationKey = "";
      resetRepresentativesModule();
      showDefaultEmptyState();
      setStatus("Enter a 5-digit ZIP code to load your representatives instantly.");
    }
  });

  elements.zipInput.addEventListener("change", async () => {
    if (state.suppressLocationEvents) {
      return;
    }
    syncZipInput();
    if (normalizedZipValue().length === 5) {
      await handleLocationReady("ZIP code set.", true);
    }
  });

  if (elements.districtSelect) {
    elements.districtSelect.addEventListener("change", async () => {
      const [selectedState, selectedDistrict] = (elements.districtSelect.value || "").split("|");
      if (!selectedState || !selectedDistrict) {
        return;
      }

      state.suppressLocationEvents = true;
      elements.stateSelect.value = selectedState;
      elements.districtInput.value = selectedDistrict;
      state.suppressLocationEvents = false;
      await handleLocationReady("District selected.", true);
    });
  }

  document.addEventListener("click", (event) => {
    const billButton = event.target instanceof Element
      ? event.target.closest(".result-card")
      : null;
    if (!billButton) {
      return;
    }
    hideInstructionState();
  });
}

async function bootstrap() {
  try {
    const config = await fetchJson("/api/config");
    renderStateOptions(config.states || []);

    if (!config.hasApiKey) {
      setStatus("This app needs a Congress.gov API key in CONGRESS_API_KEY before search can work.");
      return;
    }

    resetRepresentativesModule();
    wireEvents();
    await runSearch();
  } catch (error) {
    setStatus(error.message);
  }
}

bootstrap();
