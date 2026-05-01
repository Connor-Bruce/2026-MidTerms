const state = {
  selectedBill: null,
  instantInsightBill: null,
  activeQuery: "",
  lastLocationKey: "",
  featuredResults: [],
  stateNameToCode: {},
  suppressLocationEvents: false,
  autoLocationAttempted: false,
};

const DEFAULT_EMPTY_STATE_TITLE = "Find your delegation first";
const DEFAULT_EMPTY_STATE_BODY =
  "Tap current location to identify your delegation, then search bills or open a featured vote receipt.";
const LOCATION_READY_EMPTY_STATE_TITLE = "Live search unlocked";
const LOCATION_READY_EMPTY_STATE_BODY =
  "Your delegation is pinned above. Focus the search bar to open recommended bills or type a law name live.";
const TRUMP_SCORE_FOOTNOTE = "Based on 282 selected votes where Trump had a stated position.";

const elements = {
  billSearch: document.querySelector("#billSearch"),
  searchOverlay: document.querySelector("#searchOverlay"),
  searchOverlayLabel: document.querySelector("#searchOverlayLabel"),
  stateSelect: document.querySelector("#stateSelect"),
  districtInput: document.querySelector("#districtInput"),
  districtSelectField: document.querySelector("#districtSelectField"),
  districtSelect: document.querySelector("#districtSelect"),
  zipInput: document.querySelector("#zipInput"),
  useLocationButton: document.querySelector("#useLocationButton"),
  infoButton: document.querySelector("#infoButton"),
  infoPanel: document.querySelector("#infoPanel"),
  infoCloseButton: document.querySelector("#infoCloseButton"),
  searchResults: document.querySelector("#searchResults"),
  searchPanel: document.querySelector("#searchPanel"),
  statusMessage: document.querySelector("#statusMessage"),
  instantInsightPanel: document.querySelector("#instantInsightPanel"),
  instantInsightHeadline: document.querySelector("#instantInsightHeadline"),
  instantInsightSummary: document.querySelector("#instantInsightSummary"),
  instantInsightMembers: document.querySelector("#instantInsightMembers"),
  instantInsightMeta: document.querySelector("#instantInsightMeta"),
  instantInsightButton: document.querySelector("#instantInsightButton"),
  stickyDelegationBar: document.querySelector("#stickyDelegationBar"),
  matchCount: document.querySelector("#matchCount"),
  clearButton: document.querySelector("#clearButton"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateTitle: document.querySelector("#emptyState h2"),
  emptyStateBody: document.querySelector("#emptyState p"),
  representativesModule: document.querySelector("#representativesModule"),
  representativesMeta: document.querySelector("#representativesMeta"),
  representativesCards: document.querySelector("#representativesCards"),
  billDetail: document.querySelector("#billDetail"),
  delegationPanel: document.querySelector(".delegation-panel"),
  billLabel: document.querySelector("#billLabel"),
  billTitle: document.querySelector("#billTitle"),
  lawBadge: document.querySelector("#lawBadge"),
  billMeta: document.querySelector("#billMeta"),
  billDescription: document.querySelector("#billDescription"),
  billSourceLink: document.querySelector("#billSourceLink"),
  billMethodologyLink: document.querySelector("#billMethodologyLink"),
  delegationCards: document.querySelector("#delegationCards"),
  voteTimeline: document.querySelector("#voteTimeline"),
};

let searchTimer = null;
let zipTimer = null;

function isBillBlasterDemo() {
  return document.body.classList.contains("billblaster-demo");
}

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
  const text = String(message || "");
  elements.statusMessage.textContent = text;
  elements.statusMessage.dataset.loading = /(loading|finding|looking up|searching|requesting)/i.test(text)
    ? "true"
    : "false";
}

function isV1App() {
  return document.body.classList.contains("v1-app");
}

function setLocationUiReady(isReady) {
  if (!isV1App()) {
    return;
  }
  document.body.classList.toggle("location-locked", !isReady);
  document.body.classList.toggle("location-ready", isReady);
}

function setSearchOverlayOpen(isOpen) {
  if (!elements.searchOverlay) {
    return;
  }
  elements.searchOverlay.classList.toggle("detail-hidden", !isOpen);
  document.body.classList.toggle("search-overlay-open", isOpen);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
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
  if (!elements.emptyState || !elements.emptyState.isConnected) {
    return;
  }
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
  if (!elements.emptyState || !elements.emptyState.isConnected) {
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
  if (!elements.emptyState || !elements.emptyState.isConnected) {
    return;
  }
  elements.billDetail.classList.add("detail-hidden");
  elements.emptyState.style.display = "";
  elements.emptyState.hidden = false;
  elements.emptyState.classList.remove("detail-hidden");
  setEmptyStateCopy(LOCATION_READY_EMPTY_STATE_TITLE, LOCATION_READY_EMPTY_STATE_BODY);
}

function hideInstructionState() {
  if (!elements.emptyState) {
    return;
  }
  if (isBillBlasterDemo()) {
    if (elements.emptyState.isConnected) {
      elements.emptyState.remove();
    }
    return;
  }
  if (!elements.emptyState.isConnected) {
    return;
  }
  elements.emptyState.style.display = "none";
  elements.emptyState.hidden = true;
  elements.emptyState.classList.add("detail-hidden");
  setEmptyStateCopy("", "");
}

function hidePinnedRepresentatives() {
  if (!elements.representativesModule) {
    return;
  }
  return;
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
  elements.useLocationButton.innerHTML = isLoading
    ? '<span class="location-pin-glyph" aria-hidden="true">⌖</span><span>CURRENT LOCATION / FINDING...</span>'
    : '<span class="location-pin-glyph" aria-hidden="true">⌖</span><span>CURRENT LOCATION</span>';
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

function representativeToneClass(member) {
  return partyToneClass(normalizePartyCode(member?.party));
}

function normalizedTrumpScore(member) {
  const rawScore = member?.trumpScore?.score;
  return Number.isFinite(rawScore) ? rawScore : null;
}

function trumpScoreToneClass(score) {
  if (score === null) {
    return "alignment-score-unavailable";
  }
  if (score >= 80) {
    return "alignment-score-strong";
  }
  if (score < 25) {
    return "alignment-score-breaking";
  }
  return "alignment-score-mixed";
}

function buildTrumpScoreMarkup(member) {
  const score = normalizedTrumpScore(member);
  const scoreValue = member?.trumpScore?.scoreLabel || (score === null ? "NO DATA" : `${score}%`);
  const sourceUrl = member?.trumpScore?.methodologyUrl || "https://votehub.com/trump-score";
  const alignedVotes = member?.trumpScore?.alignedVotes;
  const votesConsidered = member?.trumpScore?.votesConsidered;
  const methodologyDetail = member?.trumpScore?.methodologyDetail || TRUMP_SCORE_FOOTNOTE;
  const title = Number.isFinite(alignedVotes) && Number.isFinite(votesConsidered) && votesConsidered > 0
    ? `${alignedVotes} of ${votesConsidered} tracked 119th Congress votes were cast with Trump.`
    : "Open VoteHub's Trump Score source page for methodology and live published scores.";
  const scoreMarkup = score === null
    ? `<span class="alignment-score-link">${scoreValue}</span>`
    : `<a class="alignment-score-link" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer" title="${escapeAttribute(title)}">${scoreValue}</a>`;

  return `
    <div class="alignment-block" title="${escapeAttribute(title)}">
      <p class="alignment-score ${trumpScoreToneClass(score)}">
        <span class="alignment-score-value">${scoreMarkup}</span>
        <span class="alignment-score-label">alignment (VoteHub methodology)</span>
      </p>
      <p class="alignment-score-footnote">${methodologyDetail}</p>
    </div>
  `;
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
  const financeMarkup = buildContactMarkup(member.financeUrl || "", "Finance Data", {
    title: "Open campaign finance profile on OpenSecrets",
    ariaLabel: `Open OpenSecrets finance data for ${displayName || "this office"}`,
    fallback: "Finance data unavailable",
  });
  const locationLabel = representativeLocationLabel(member.state, member.district);
  const trumpScoreMarkup = buildTrumpScoreMarkup(member);

  return `
    <p class="delegate-role">${member.roleLabel || "Representative"}</p>
    <div class="delegate-heading-row">
      <div class="delegate-name-group">
        <h3>${displayName}</h3>
        ${partyMarkup}
      </div>
      ${trumpScoreMarkup}
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

function buildRepresentativeVoteMarkup(vote, memberVote) {
  const votePosition = (memberVote.position || memberVote.vote || "Unknown").toUpperCase();
  const voteToneClass = voteTone(memberVote.position || memberVote.vote);

  return `
    <div class="delegate-current-vote">
      <p class="delegate-current-vote-value ${voteToneClass}">VOTE: ${votePosition}</p>
      <p class="delegate-current-vote-meta">${vote.billLabel || "SELECTED BILL"}${vote.chamber ? ` · ${vote.chamber.toUpperCase()}` : ""}${vote.rollNumber ? ` · ROLL ${vote.rollNumber}` : ""}</p>
      ${memberVote.explanation ? `<p class="delegate-current-vote-note">${memberVote.explanation}</p>` : ""}
    </div>
  `;
}

function buildStickyRepresentativeMarkup(member) {
  const displayName = displayMemberName(member);
  const partyCode = normalizePartyCode(member.party);
  const partyMarkup = partyCode
    ? `<span class="party-pill ${partyToneClass(partyCode)}" aria-label="Party ${partyCode}">(${partyCode})</span>`
    : "";
  const scoreValue = member?.trumpScore?.scoreLabel || "NO DATA";
  const scoreTone = trumpScoreToneClass(normalizedTrumpScore(member));
  const scoreUrl = member?.trumpScore?.methodologyUrl || "https://votehub.com/trump-score";

  return `
    <article class="sticky-rep-card ${representativeToneClass(member)}">
      <div class="sticky-rep-heading">
        <span class="sticky-rep-name">${displayName}</span>
        ${partyMarkup}
      </div>
      <a class="sticky-rep-score ${scoreTone}" href="${escapeAttribute(scoreUrl)}" target="_blank" rel="noreferrer">
        ${scoreValue} ALIGNMENT
      </a>
    </article>
  `;
}

function normalizeLookupText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function representativeLookupKey(member) {
  return member.bioguideId
    || `${normalizeLookupText(displayMemberName(member))}|${normalizeLookupText(member.roleLabel || member.chamber || "member")}`;
}

function representativeVoteLookupKey(memberVote) {
  return memberVote.memberId
    || `${normalizeLookupText(memberVote.name)}|${normalizeLookupText(memberVote.roleLabel || "member")}`;
}

function resetRepresentativesModule() {
  if (!elements.representativesModule) {
    return;
  }
  elements.representativesModule.classList.add("detail-hidden");
  elements.representativesCards.innerHTML = "";
  elements.representativesMeta.textContent = "Set your location to pin your current delegation here.";
  if (elements.stickyDelegationBar) {
    elements.stickyDelegationBar.innerHTML = "";
    elements.stickyDelegationBar.classList.add("detail-hidden");
  }
}

function renderStickyDelegationBar(representatives, locationLabel) {
  if (!elements.stickyDelegationBar || !isV1App()) {
    return;
  }

  if (!representatives.length) {
    elements.stickyDelegationBar.innerHTML = "";
    elements.stickyDelegationBar.classList.add("detail-hidden");
    return;
  }

  const cardMarkup = representatives.map((member) => buildStickyRepresentativeMarkup(member)).join("");
  elements.stickyDelegationBar.innerHTML = `
    <div class="sticky-delegation-inner">
      <div class="sticky-delegation-label">
        <span class="eyebrow">Your Delegation</span>
        <span class="sticky-delegation-meta">${locationLabel || "Current delegation"}</span>
      </div>
      <div class="sticky-delegation-cards">${cardMarkup}</div>
    </div>
  `;
  elements.stickyDelegationBar.classList.remove("detail-hidden");
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
  renderStickyDelegationBar(representatives, locationLabel);

  if (!representatives.length) {
    const note = document.createElement("p");
    note.className = "inline-note";
    note.textContent = "No representatives were returned for that location.";
    elements.representativesCards.append(note);
    return;
  }

  representatives.forEach((member) => {
    const card = document.createElement("article");
    card.className = `delegate-card delegate-card-pinned ${representativeToneClass(member)}`;
    card.dataset.memberKey = representativeLookupKey(member);
    card.innerHTML = buildRepresentativeCardMarkup(member);
    elements.representativesCards.append(card);
  });
}

function resetInstantInsight(message = "Tap current location to load a live vote snapshot before you search.") {
  if (!elements.instantInsightPanel) {
    return;
  }
  state.instantInsightBill = null;
  elements.instantInsightHeadline.textContent = "Finding your delegation…";
  elements.instantInsightSummary.textContent = message;
  elements.instantInsightMembers.innerHTML = "";
  elements.instantInsightMeta.textContent =
    "We use Congress.gov bill data, official House and Senate roll calls, and VoteHub methodology references.";
  elements.instantInsightButton.classList.add("detail-hidden");
}

function renderInstantInsightMembers(members) {
  if (!elements.instantInsightMembers) {
    return;
  }
  elements.instantInsightMembers.innerHTML = "";

  (members || []).forEach((member) => {
    const item = document.createElement("div");
    item.className = "instant-insight-member";
    item.innerHTML = `
      <span class="instant-insight-member-name">${escapeHtml(member.name)}</span>
      <span class="instant-insight-member-vote ${voteTone(member.position)}">${escapeHtml((member.position || "").toUpperCase())}</span>
    `;
    elements.instantInsightMembers.append(item);
  });
}

function renderInstantInsight(payload) {
  if (!elements.instantInsightPanel) {
    return;
  }
  state.instantInsightBill = payload.bill || null;
  elements.instantInsightHeadline.textContent = payload.headline || "Your delegation has a live vote record.";
  elements.instantInsightSummary.textContent = payload.summary || "Open the vote breakdown to see who lined up where.";
  renderInstantInsightMembers(payload.members || []);
  const locationText = payload.location?.label ? `${payload.location.label} · ` : "";
  const billText = payload.bill?.billLabel ? `${payload.bill.billLabel} · ` : "";
  elements.instantInsightMeta.textContent = `${locationText}${billText}${payload.trustLabel || "Official congressional roll call data."}`;
  elements.instantInsightButton.classList.remove("detail-hidden");
}

async function loadInstantInsight(options = {}) {
  if (!elements.instantInsightPanel) {
    return null;
  }
  const query = buildQuery({
    zip: options.zip ?? normalizedZipValue(),
    state: options.state ?? elements.stateSelect.value,
    district: options.district ?? normalizedDistrictValue(),
  });
  if (!query) {
    resetInstantInsight();
    return null;
  }

  try {
    const payload = await fetchJson(`/api/instant-insight?${query}`);
    renderInstantInsight(payload);
    return payload;
  } catch (error) {
    resetInstantInsight(error.message || "Tap current location to unlock an instant vote insight.");
    return null;
  }
}

function clearPinnedRepresentativeVoteCards() {
  if (!elements.representativesCards) {
    return;
  }
  elements.representativesCards.querySelectorAll(".delegate-current-vote").forEach((node) => {
    node.remove();
  });
}

function updatePinnedRepresentativeVoteCards(payload) {
  if (!elements.representativesCards) {
    return;
  }

  clearPinnedRepresentativeVoteCards();

  const cardLookup = new Map();
  elements.representativesCards.querySelectorAll(".delegate-card-pinned").forEach((card) => {
    if (card.dataset.memberKey) {
      cardLookup.set(card.dataset.memberKey, card);
    }
  });

  (payload.votes || []).forEach((vote) => {
    (vote.members || []).forEach((memberVote) => {
      const card = cardLookup.get(representativeVoteLookupKey(memberVote));
      if (!card) {
        return;
      }

      const headingRow = card.querySelector(".delegate-heading-row");
      const voteMarkup = buildRepresentativeVoteMarkup(
        {
          billLabel: payload.bill?.billLabel || "",
          chamber: vote.chamber,
          rollNumber: vote.rollNumber,
        },
        memberVote
      );

      if (headingRow) {
        headingRow.insertAdjacentHTML("afterend", voteMarkup);
      } else {
        card.insertAdjacentHTML("beforeend", voteMarkup);
      }
    });
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
  if (!elements.searchResults) {
    return;
  }
  elements.searchResults.innerHTML = "";
  if (elements.matchCount) {
    elements.matchCount.textContent = `${results.length} result${results.length === 1 ? "" : "s"}`;
  }

  const queryActive = state.activeQuery.trim().length >= 2;

  if (!results.length) {
    if (elements.searchOverlayLabel) {
      elements.searchOverlayLabel.textContent = queryActive ? "NO BILLS FOUND" : "RECOMMENDED BILLS";
    }

    if (queryActive) {
      const empty = document.createElement("div");
      empty.className = "search-empty search-empty-large";
      empty.innerHTML = `
        <strong class="search-empty-title">NO BILLS FOUND</strong>
        <span class="result-description">TRY A DIFFERENT BILL NAME OR OPEN A RECOMMENDED VOTE BELOW.</span>
      `;
      elements.searchResults.append(empty);

      if (state.featuredResults.length) {
        results = state.featuredResults;
      } else {
        return;
      }
    } else {
      const empty = document.createElement("div");
      empty.className = "search-empty";
      empty.textContent = "NO FEATURED BILLS AVAILABLE.";
      elements.searchResults.append(empty);
      return;
    }
  }

  const featuredResults = results.filter((result) => result.featured);
  const standardResults = results.filter((result) => !result.featured);
  if (featuredResults.length) {
    state.featuredResults = featuredResults;
  }

  if (elements.searchOverlayLabel && !queryActive) {
    elements.searchOverlayLabel.textContent = "RECOMMENDED BILLS";
  }

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
      const descriptionMarkup = (result.plainDescription || result.featuredDescription)
        ? `<span class="result-description">${result.plainDescription || result.featuredDescription}</span>`
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
        ${descriptionMarkup}
        <span class="result-meta">${result.latestActionDate || result.introducedDate || "Unknown date"} · ${detailLabel}</span>
      `;
      button.addEventListener("click", () => {
        state.selectedBill = result;
        setSearchOverlayOpen(false);
        loadBillVotes(result);
      });
      elements.searchResults.append(button);
    });
  };

  if (featuredResults.length) {
    appendSection("RECOMMENDED BILLS", featuredResults);
  }

  appendSection(queryActive ? "MATCHES" : featuredResults.length && standardResults.length ? "MATCHES" : "", standardResults);
}

function renderDelegation(representatives) {
  if (!elements.delegationCards) {
    return;
  }
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
    card.className = `delegate-card ${representativeToneClass(member)}`;
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
      <div class="vote-trust-row">
        <a class="source-link" href="${vote.sourceUrl}" target="_blank" rel="noreferrer">${vote.sourceLabel || `Congress roll call #${vote.rollNumber || "?"}`}</a>
        ${vote.billUrl ? `<a class="source-link" href="${vote.billUrl}" target="_blank" rel="noreferrer">Congress.gov bill page</a>` : ""}
        <a class="methodology-link" href="https://api.congress.gov/" target="_blank" rel="noreferrer" title="Bill text and actions come from Congress.gov. Member vote positions come from official House and Senate roll call feeds. Alignment scores link out to VoteHub's methodology page.">Methodology</a>
      </div>
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
  if (elements.billDescription) {
    elements.billDescription.textContent = payload.bill.plainDescription || "";
  }
  if (elements.billSourceLink) {
    if (payload.bill.billUrl) {
      elements.billSourceLink.href = payload.bill.billUrl;
      elements.billSourceLink.classList.remove("detail-hidden");
    } else {
      elements.billSourceLink.classList.add("detail-hidden");
    }
  }

  if (elements.delegationPanel) {
    elements.delegationPanel.classList.add("detail-hidden");
  }

  updatePinnedRepresentativeVoteCards(payload);
  renderVotes(payload.votes || []);
}

async function loadBillVotes(result) {
  const stateCode = elements.stateSelect.value;
  const district = normalizedDistrictValue();

  if (!stateCode) {
    setStatus("TAP CURRENT LOCATION FIRST SO I CAN MAP THE BILL TO YOUR DELEGATION.");
    return;
  }

  if (!district) {
    setStatus("I STILL NEED A HOUSE DISTRICT BEFORE I CAN LOAD THIS VOTE RECEIPT.");
    return;
  }

  setStatus(`Loading vote history for ${result.billLabel}...`);
  setSearchOverlayOpen(false);
  hideInstructionState();
  hidePinnedRepresentatives();
  elements.billDetail.classList.remove("detail-hidden");
  clearPinnedRepresentativeVoteCards();
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
  if (forceFeatured && !options.preserveInput) {
    elements.billSearch.value = "";
  }
  const isFeaturedMode = forceFeatured || query.length < 2;
  const queryString = buildQuery(forceFeatured ? { featured: "1" } : { q: query });
  const url = queryString ? `/api/search-bills?${queryString}` : "/api/search-bills";

  setStatus(isFeaturedMode ? "LOADING RECOMMENDED BILLS..." : `SEARCHING FOR ${query.toUpperCase()}...`);

  try {
    const payload = await fetchJson(url);
    if (state.activeQuery !== query) {
      return;
    }
    renderSearchResults(payload.results || []);
    if (isFeaturedMode) {
      const featuredStatus = options.statusMessage
        || (payload.results?.length
          ? "RECOMMENDED BILLS LOADED. PICK ONE TO SEE THE VOTE RECEIPT."
          : "NO FEATURED BILLS ARE AVAILABLE RIGHT NOW.");
      setStatus(featuredStatus);
    } else {
      setStatus(payload.results?.length ? "PICK A BILL TO LOAD THE RECEIPT." : "NO BILLS FOUND.");
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
    setLocationUiReady(false);
    resetRepresentativesModule();
    resetInstantInsight();
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
      resetInstantInsight();
      showDefaultEmptyState();
      return;
    }

    state.lastLocationKey = payload.zip
      ? `zip:${payload.zip}:${payload.state}:${payload.district || ""}`
      : `manual:${payload.state}:${payload.district || ""}`;

    const locationLabel = representativeLocationLabel(payload.state, payload.district);
    setLocationUiReady(true);
    const insightPayload = await loadInstantInsight({
      zip: payload.zip,
      state: payload.state,
      district: payload.district,
    });

    if (state.selectedBill) {
      await loadBillVotes(state.selectedBill);
      return;
    }

    const statusMessage = payload.hasMultipleDistrictMatches
      ? `${statusPrefix.toUpperCase()} DELEGATION PINNED FOR ${locationLabel}. THIS LOCATION CROSSES MULTIPLE DISTRICTS.`
      : `${statusPrefix.toUpperCase()} DELEGATION PINNED FOR ${locationLabel}.`;

    await runSearch({
      featured: true,
      preserveInput: true,
      statusMessage,
    });

    if (isV1App() && insightPayload?.bill) {
      state.selectedBill = insightPayload.bill;
      await loadBillVotes(insightPayload.bill);
      setStatus(`${statusPrefix.toUpperCase()} DELEGATION PINNED FOR ${locationLabel}. SHOWING ${insightPayload.bill.billLabel} AUTOMATICALLY.`);
      return;
    }

    showLocationReadyEmptyState();
  } catch (error) {
    setLocationUiReady(false);
    resetRepresentativesModule();
    resetInstantInsight(error.message || "Tap current location to unlock an instant vote insight.");
    setStatus((error.message || "I could not load your representatives just now.").toUpperCase());
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
  setStatus("REQUESTING YOUR LOCATION...");

  try {
    const position = await getCurrentPosition();
    setStatus("LOOKING UP YOUR CONGRESSIONAL DISTRICT...");

    const locationInfo = await reverseGeocodeLocation(
      position.coords.latitude,
      position.coords.longitude
    );

    await applyDetectedLocation(locationInfo);
  } catch (error) {
    if (error?.code === 1) {
      setStatus("LOCATION ACCESS WAS DENIED.");
    } else if (error?.code === 2) {
      setStatus("YOUR LOCATION COULD NOT BE DETERMINED.");
    } else if (error?.code === 3) {
      setStatus("THE LOCATION REQUEST TIMED OUT.");
    } else {
      setStatus(error.message || "I could not use your location just now.");
    }
  } finally {
    setLocationButtonState(false);
  }
}

async function fetchGeoIpLocation() {
  return fetchJson("/api/geoip-location");
}

async function applyIpDetectedLocation() {
  const payload = await fetchGeoIpLocation();
  state.suppressLocationEvents = true;
  if (payload.zip && elements.zipInput) {
    elements.zipInput.value = payload.zip;
  }
  elements.stateSelect.value = payload.state || "";
  elements.districtInput.value = payload.district || "";
  state.suppressLocationEvents = false;
  await handleLocationReady("Location found.", true);
}

async function attemptAutomaticLocation() {
  if (state.autoLocationAttempted || currentLocationKey()) {
    return;
  }
  state.autoLocationAttempted = true;
    resetInstantInsight("Looking up your location for a live vote snapshot…");

  try {
    const position = await getCurrentPosition();
    const locationInfo = await reverseGeocodeLocation(
      position.coords.latitude,
      position.coords.longitude
    );
    await applyDetectedLocation(locationInfo);
    return;
  } catch (_error) {
    // Fall back to IP-based lookup below.
  }

  try {
    await applyIpDetectedLocation();
  } catch (_error) {
    resetInstantInsight("Allow location access to unlock an instant delegation insight.");
  }
}

function wireEvents() {
  elements.billSearch.addEventListener("input", () => {
    setSearchOverlayOpen(true);
    scheduleSearch();
  });
  elements.billSearch.addEventListener("focus", () => {
    setSearchOverlayOpen(true);
    if (elements.billSearch.value.trim().length >= 2) {
      void runSearch();
      return;
    }
    void runSearch({ featured: true, preserveInput: true });
  });
  elements.billSearch.addEventListener("click", () => {
    setSearchOverlayOpen(true);
    if (elements.billSearch.value.trim().length < 2) {
      void runSearch({ featured: true, preserveInput: true });
    }
  });
  elements.useLocationButton.addEventListener("click", handleUseMyLocation);
  if (elements.instantInsightButton) {
    elements.instantInsightButton.addEventListener("click", () => {
      if (!state.instantInsightBill) {
        return;
      }
      state.selectedBill = state.instantInsightBill;
      loadBillVotes(state.instantInsightBill);
    });
  }

  if (elements.infoButton) {
    elements.infoButton.addEventListener("click", () => {
      toggleInfoPanel();
    });
  }
  if (elements.infoCloseButton) {
    elements.infoCloseButton.addEventListener("click", () => {
      toggleInfoPanel(false);
    });
  }

  elements.clearButton.addEventListener("click", () => {
    state.selectedBill = null;
    state.instantInsightBill = null;
    state.activeQuery = "";
    state.lastLocationKey = "";
    state.suppressLocationEvents = true;
    elements.billSearch.value = "";
    elements.zipInput.value = "";
    elements.stateSelect.value = "";
    elements.districtInput.value = "";
    state.suppressLocationEvents = false;
    renderDistrictSelector([], "", "");
    setLocationUiReady(false);
    resetRepresentativesModule();
    resetInstantInsight();
    showDefaultEmptyState();
    if (!isV1App()) {
      runSearch();
    } else {
      setStatus("TAP CURRENT LOCATION TO IDENTIFY YOUR DELEGATION.");
    }
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
      setLocationUiReady(false);
      resetRepresentativesModule();
      resetInstantInsight();
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
    if (!(event.target instanceof Element)) {
      return;
    }
    const billButton = event.target.closest(".result-card");
    if (billButton) {
      hideInstructionState();
      return;
    }
    if (
      elements.searchOverlay &&
      !elements.searchOverlay.contains(event.target) &&
      event.target !== elements.billSearch
    ) {
      setSearchOverlayOpen(false);
    }
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

    setLocationUiReady(false);
    resetRepresentativesModule();
    resetInstantInsight();
    wireEvents();
    if (!isV1App()) {
      await runSearch();
    } else {
      showDefaultEmptyState();
      setStatus("TAP CURRENT LOCATION TO IDENTIFY YOUR DELEGATION.");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

bootstrap();
