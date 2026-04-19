const state = {
  selectedBill: null,
  selectedCandidateId: null,
  activeQuery: "",
  lastLocationKey: "",
  fundingSlices: [],
  fundingInnerRadius: 0,
  fundingOuterRadius: 0,
  fundingHoverIndex: -1,
  stateNameToCode: {},
};

const DEFAULT_EMPTY_STATE_TITLE = "Pick a bill to unlock the vote breakdown";
const DEFAULT_EMPTY_STATE_BODY =
  "This prototype focuses on enacted laws from the 118th and 119th Congresses, plus a small featured comparison set. Choose a result on the left and we will pull the official House and Senate roll calls.";
const LOCATION_READY_EMPTY_STATE_TITLE =
  "LOCATION SET. SELECT A FEATURED BILL BELOW TO VIEW VOTES.";

const elements = {
  billSearch: document.querySelector("#billSearch"),
  stateSelect: document.querySelector("#stateSelect"),
  districtInput: document.querySelector("#districtInput"),
  useLocationButton: document.querySelector("#useLocationButton"),
  searchResults: document.querySelector("#searchResults"),
  statusMessage: document.querySelector("#statusMessage"),
  matchCount: document.querySelector("#matchCount"),
  clearButton: document.querySelector("#clearButton"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateTitle: document.querySelector("#emptyState h2"),
  emptyStateBody: document.querySelector("#emptyState p"),
  billDetail: document.querySelector("#billDetail"),
  billLabel: document.querySelector("#billLabel"),
  billTitle: document.querySelector("#billTitle"),
  lawBadge: document.querySelector("#lawBadge"),
  billMeta: document.querySelector("#billMeta"),
  delegationCards: document.querySelector("#delegationCards"),
  voteTimeline: document.querySelector("#voteTimeline"),
  fundingPanel: document.querySelector("#fundingPanel"),
  fundingSource: document.querySelector("#fundingSource"),
  fundingEmpty: document.querySelector("#fundingEmpty"),
  fundingDetail: document.querySelector("#fundingDetail"),
  fundingCandidateRole: document.querySelector("#fundingCandidateRole"),
  fundingCandidateName: document.querySelector("#fundingCandidateName"),
  fundingCandidateMeta: document.querySelector("#fundingCandidateMeta"),
  fundingChart: document.querySelector("#fundingChart"),
  fundingLegend: document.querySelector("#fundingLegend"),
  fundingTooltip: document.querySelector("#fundingTooltip"),
};

let searchTimer = null;

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
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

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatCompactCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function candidateMeta(member) {
  return `${member.party || "Unknown party"} · ${member.state}${member.district ? `-${member.district}` : ""}`;
}

function normalizedDistrictValue() {
  const digits = (elements.districtInput.value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return String(Number.parseInt(digits, 10));
}

function hasLocationSelection() {
  return Boolean(elements.stateSelect.value && normalizedDistrictValue());
}

function currentLocationKey() {
  if (!hasLocationSelection()) {
    return "";
  }
  return `${elements.stateSelect.value}:${normalizedDistrictValue()}`;
}

function syncDistrictInput() {
  const normalizedDistrict = normalizedDistrictValue();
  if (normalizedDistrict) {
    elements.districtInput.value = normalizedDistrict;
  }
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
  elements.emptyState.classList.remove("detail-hidden");
  setEmptyStateCopy(DEFAULT_EMPTY_STATE_TITLE, DEFAULT_EMPTY_STATE_BODY);
}

function showLocationReadyEmptyState() {
  if (state.selectedBill) {
    return;
  }
  elements.billDetail.classList.add("detail-hidden");
  elements.emptyState.classList.remove("detail-hidden");
  setEmptyStateCopy(LOCATION_READY_EMPTY_STATE_TITLE);
}

function renderStateOptions(states) {
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
  elements.useLocationButton.textContent = isLoading ? "LOCATING..." : "LOCATE";
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

async function applyDetectedLocation(locationInfo) {
  elements.stateSelect.value = locationInfo.stateCode;
  elements.districtInput.value = locationInfo.district;
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
      setStatus("Location access was denied. You can still choose your state and district manually.");
    } else if (error?.code === 2) {
      setStatus("Your location could not be determined. Please try again or enter it manually.");
    } else if (error?.code === 3) {
      setStatus("The location request timed out. Please try again.");
    } else {
      setStatus(error.message || "I could not use your location just now.");
    }
  } finally {
    setLocationButtonState(false);
  }
}

function hideFundingTooltip() {
  if (!elements.fundingTooltip) {
    return;
  }
  elements.fundingTooltip.classList.add("detail-hidden");
}

function resetFundingChart() {
  state.fundingSlices = [];
  state.fundingHoverIndex = -1;
  state.fundingInnerRadius = 0;
  state.fundingOuterRadius = 0;
  if (!elements.fundingChart) {
    return;
  }
  const context = elements.fundingChart.getContext("2d");
  if (!context) {
    return;
  }
  context.clearRect(0, 0, elements.fundingChart.width, elements.fundingChart.height);
}

function resetFundingPanel(message = "Select a delegation member above to view a PAC spending profile.") {
  hideFundingTooltip();
  resetFundingChart();
  if (elements.fundingEmpty) {
    elements.fundingEmpty.textContent = message;
    elements.fundingEmpty.classList.remove("detail-hidden");
  }
  if (elements.fundingDetail) {
    elements.fundingDetail.classList.add("detail-hidden");
  }
  if (elements.fundingSource) {
    elements.fundingSource.textContent = "Select a candidate in your delegation to view PAC spending.";
  }
  if (elements.fundingLegend) {
    elements.fundingLegend.innerHTML = "";
  }
}

function fundingTooltipMarkup(segment) {
  return `
    <strong>${segment.label}</strong>
    <span>${formatCurrency(segment.amount)} · ${segment.percent}%</span>
  `;
}

function drawFundingChart(payload, hoverIndex = -1) {
  const canvas = elements.fundingChart;
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(width, height) / 2 - 18;
  const innerRadius = outerRadius * 0.56;
  const totalAmount = payload.totalAmount || 0;

  state.fundingSlices = [];
  state.fundingOuterRadius = outerRadius;
  state.fundingInnerRadius = innerRadius;

  context.clearRect(0, 0, width, height);

  let startAngle = -Math.PI / 2;
  payload.categories.forEach((segment, index) => {
    const sliceAngle = (segment.percent / 100) * Math.PI * 2;
    const endAngle = startAngle + sliceAngle;

    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, outerRadius, startAngle, endAngle);
    context.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
    context.closePath();
    context.fillStyle = segment.color;
    context.fill();
    context.lineWidth = hoverIndex === index ? 2 : 1;
    context.strokeStyle = "#000000";
    context.stroke();

    state.fundingSlices.push({
      ...segment,
      startAngle,
      endAngle,
    });
    startAngle = endAngle;
  });

  context.beginPath();
  context.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = "#000000";
  context.stroke();

  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = '900 13px "SFMono-Regular", Menlo, Consolas, monospace';
  context.fillText("PAC MIX", centerX, centerY - 14);
  context.font = '900 24px "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
  context.fillText(formatCompactCurrency(totalAmount), centerX, centerY + 16);
}

function fundingSliceAtEvent(event) {
  const canvas = elements.fundingChart;
  if (!canvas) {
    return -1;
  }

  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const deltaX = x - centerX;
  const deltaY = y - centerY;
  const distance = Math.sqrt((deltaX ** 2) + (deltaY ** 2));

  if (distance < state.fundingInnerRadius || distance > state.fundingOuterRadius) {
    return -1;
  }

  let angle = Math.atan2(deltaY, deltaX);
  if (angle < -Math.PI / 2) {
    angle += Math.PI * 2;
  }

  return state.fundingSlices.findIndex((segment) => angle >= segment.startAngle && angle <= segment.endAngle);
}

function updateFundingTooltip(segment, event) {
  if (!elements.fundingTooltip || !elements.fundingChart) {
    return;
  }

  const rect = elements.fundingChart.getBoundingClientRect();
  const left = event.clientX - rect.left + 12;
  const top = event.clientY - rect.top + 12;

  elements.fundingTooltip.innerHTML = fundingTooltipMarkup(segment);
  elements.fundingTooltip.style.left = `${left}px`;
  elements.fundingTooltip.style.top = `${top}px`;
  elements.fundingTooltip.classList.remove("detail-hidden");
}

function renderFundingLegend(payload) {
  if (!elements.fundingLegend) {
    return;
  }

  elements.fundingLegend.innerHTML = payload.categories
    .map(
      (segment) => `
        <div class="funding-legend-item">
          <span class="funding-swatch" style="background:${segment.color};"></span>
          <div>
            <p class="funding-legend-label">${segment.label}</p>
            <p class="funding-legend-meta">${segment.percent}% · ${formatCurrency(segment.amount)}</p>
          </div>
        </div>
      `
    )
    .join("");
}

function renderFunding(payload, member) {
  if (elements.fundingEmpty) {
    elements.fundingEmpty.classList.add("detail-hidden");
  }
  if (elements.fundingDetail) {
    elements.fundingDetail.classList.remove("detail-hidden");
  }
  if (elements.fundingSource) {
    const sourceTail = payload.openSecretsReady
      ? "OpenSecrets API key detected. Mock profile shown until the live endpoint is wired."
      : "Mocked prototype data shaped for a future OpenSecrets integration.";
    elements.fundingSource.textContent = `${payload.sourceLabel} · ${sourceTail}`;
  }
  elements.fundingCandidateRole.textContent = member.roleLabel || "Candidate";
  elements.fundingCandidateName.textContent = member.displayName || member.listName || payload.displayName;
  elements.fundingCandidateMeta.textContent = `${candidateMeta(member)} · Total ${formatCompactCurrency(payload.totalAmount)}`;

  drawFundingChart(payload);
  renderFundingLegend(payload);
}

function wireFundingChartInteractions(payload) {
  if (!elements.fundingChart) {
    return;
  }

  elements.fundingChart.onmousemove = (event) => {
    const hoverIndex = fundingSliceAtEvent(event);
    if (hoverIndex === -1) {
      if (state.fundingHoverIndex !== -1) {
        state.fundingHoverIndex = -1;
        drawFundingChart(payload);
      }
      hideFundingTooltip();
      return;
    }

    if (hoverIndex !== state.fundingHoverIndex) {
      state.fundingHoverIndex = hoverIndex;
      drawFundingChart(payload, hoverIndex);
    }
    updateFundingTooltip(payload.categories[hoverIndex], event);
  };

  elements.fundingChart.onmouseleave = () => {
    state.fundingHoverIndex = -1;
    drawFundingChart(payload);
    hideFundingTooltip();
  };
}

function syncSelectedDelegationCard() {
  const cards = elements.delegationCards.querySelectorAll(".delegate-card");
  cards.forEach((card) => {
    const selected = card.dataset.candidateId === state.selectedCandidateId;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", selected ? "true" : "false");
    const label = card.querySelector(".delegate-select-label");
    if (label) {
      label.textContent = selected ? "Funding selected" : "Select for funding";
    }
  });
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

async function loadCandidateFunding(member, options = {}) {
  const candidateId = member?.bioguideId;
  if (!candidateId) {
    resetFundingPanel("Funding data is unavailable because this candidate is missing an id.");
    return;
  }

  state.selectedCandidateId = candidateId;
  syncSelectedDelegationCard();

  if (!options.quiet) {
    setStatus(`Loading PAC spending for ${member.displayName || member.listName}...`);
  }

  try {
    const payload = await fetchJson(`/api/candidate/funding/${encodeURIComponent(candidateId)}`);
    renderFunding(payload, member);
    wireFundingChartInteractions(payload);
    if (!options.quiet) {
      setStatus(`Showing PAC spending for ${member.displayName || member.listName}.`);
    }
  } catch (error) {
    resetFundingPanel(error.message);
    if (!options.quiet) {
      setStatus(error.message);
    }
  }
}

function renderDelegation(representatives) {
  elements.delegationCards.innerHTML = "";

  if (!representatives.length) {
    state.selectedCandidateId = null;
    resetFundingPanel("No delegation members are available for PAC spending data.");
    const note = document.createElement("p");
    note.className = "inline-note";
    note.textContent = "No delegation members were returned for that state and district.";
    elements.delegationCards.append(note);
    return;
  }

  let selectedMember = null;
  representatives.forEach((member) => {
    const card = document.createElement("article");
    card.className = "delegate-card";
    card.dataset.candidateId = member.bioguideId || "";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const phoneMarkup = member.phone ? `<a href="tel:${member.phone}" class="contact-link">${member.phone}</a>` : "<span class='muted'>Phone unavailable</span>";
    const siteMarkup = member.website ? `<a href="${member.website}" target="_blank" rel="noreferrer" class="contact-link">Website</a>` : "<span class='muted'>Website unavailable</span>";
    card.innerHTML = `
      <p class="delegate-role">${member.roleLabel}</p>
      <h3>${member.displayName || member.listName}</h3>
      <p class="delegate-meta">${candidateMeta(member)}</p>
      <p class="delegate-select-label">${member.bioguideId === state.selectedCandidateId ? "Funding selected" : "Select for funding"}</p>
      <div class="contact-row">
        ${phoneMarkup}
        ${siteMarkup}
      </div>
    `;

    card.addEventListener("click", () => {
      void loadCandidateFunding(member);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void loadCandidateFunding(member);
      }
    });
    card.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });

    if (member.bioguideId === state.selectedCandidateId) {
      selectedMember = member;
    }
    elements.delegationCards.append(card);
  });

  syncSelectedDelegationCard();

  if (selectedMember) {
    void loadCandidateFunding(selectedMember, { quiet: true });
  } else {
    state.selectedCandidateId = null;
    resetFundingPanel("Select a delegation member above to view a PAC spending profile.");
  }
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
  elements.emptyState.classList.add("detail-hidden");
  elements.billDetail.classList.remove("detail-hidden");

  elements.billLabel.textContent = payload.bill.billLabel;
  elements.billTitle.textContent = payload.bill.title;
  elements.lawBadge.textContent =
    payload.bill.lawNumber || `${payload.bill.congressLabel || `${payload.bill.congress}th`} Congress Bill`;
  elements.billMeta.textContent = `${payload.bill.latestActionDate || "Unknown date"} · ${payload.bill.latestActionText || "Official congressional bill activity"}`;

  renderDelegation(payload.representatives || []);
  renderVotes(payload.votes || []);
}

async function loadBillVotes(result) {
  const stateCode = elements.stateSelect.value;
  const district = normalizedDistrictValue();

  if (!stateCode) {
    setStatus("Choose a state first so I can look up the right senators and House member.");
    return;
  }

  if (!district) {
    setStatus("Add a House district number too, then pick the bill again.");
    return;
  }

  setStatus(`Loading vote history for ${result.billLabel}...`);

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
  const locationKey = currentLocationKey();

  if (!locationKey) {
    state.lastLocationKey = "";
    showDefaultEmptyState();
    return;
  }

  if (!force && locationKey === state.lastLocationKey) {
    return;
  }

  state.lastLocationKey = locationKey;

  if (state.selectedBill) {
    await loadBillVotes(state.selectedBill);
    return;
  }

  showLocationReadyEmptyState();
  await runSearch({
    featured: true,
    statusMessage: `${statusPrefix} Select a featured bill below to view votes.`,
  });
}

function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 250);
}

function wireEvents() {
  elements.billSearch.addEventListener("input", scheduleSearch);
  elements.useLocationButton.addEventListener("click", handleUseMyLocation);

  elements.clearButton.addEventListener("click", () => {
    state.selectedBill = null;
    state.selectedCandidateId = null;
    state.activeQuery = "";
    state.lastLocationKey = "";
    elements.billSearch.value = "";
    elements.districtInput.value = "";
    elements.billDetail.classList.add("detail-hidden");
    elements.emptyState.classList.remove("detail-hidden");
    setEmptyStateCopy(DEFAULT_EMPTY_STATE_TITLE, DEFAULT_EMPTY_STATE_BODY);
    resetFundingPanel();
    runSearch();
  });

  elements.stateSelect.addEventListener("change", async () => {
    await handleLocationReady("Location set.");
  });

  elements.districtInput.addEventListener("input", async () => {
    await handleLocationReady("Location set.");
  });

  elements.districtInput.addEventListener("change", async () => {
    await handleLocationReady("Location set.");
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

    wireEvents();
    await runSearch();
  } catch (error) {
    setStatus(error.message);
  }
}

bootstrap();
