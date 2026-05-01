import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Location from "expo-location";
import SearchOverlay from "./SearchOverlay";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://your-render-service.onrender.com";

const FEATURED_BILLS = [
  {
    id: "hr1",
    congress: 119,
    billType: "hr",
    billNumber: "1",
    billLabel: "H.R. 1",
    title: "One Big Beautiful Bill Act of 2025",
    plainDescription:
      "The foundational budget and tax-cut package of the current administration.",
  },
  {
    id: "save",
    congress: 119,
    billType: "hr",
    billNumber: "22",
    billLabel: "SAVE ACT",
    title: "Safeguard American Voter Eligibility Act",
    plainDescription:
      "A federal election integrity bill centered on citizenship verification and registration controls.",
  },
  {
    id: "epstein",
    congress: 119,
    billType: "hr",
    billNumber: "4405",
    billLabel: "H.R. 4405",
    title: "Epstein Files Transparency Act",
    plainDescription:
      "A disclosure bill focused on the release of federal records and investigative files.",
  },
];

const INFO_COPY = `KNOW YOUR REPS compresses official congressional voting records into fast mobile vote receipts.

LOCATION identifies your House district and Senate delegation instantly.

ALIGNMENT scores follow VoteHub methodology references and should be read as context, not spin.

DATA comes from Congress.gov, official House and Senate roll calls, and the current delegation map.`;

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
  const url = `${API_BASE_URL}${path}${query ? `?${query}` : ""}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    payload = JSON.parse(text);
  }

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function normalizeDistrict(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return String(Number.parseInt(digits, 10));
}

function normalizePartyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "D" || normalized === "DEMOCRAT" || normalized === "DEMOCRATIC") {
    return "D";
  }
  if (normalized === "R" || normalized === "REPUBLICAN") {
    return "R";
  }
  return normalized || "I";
}

function displayMemberName(member) {
  return (
    String(member?.displayName || "").trim() ||
    `${String(member?.firstName || "").trim()} ${String(member?.lastName || "").trim()}`.trim() ||
    String(member?.listName || "").trim() ||
    "UNKNOWN MEMBER"
  );
}

function voteTone(vote) {
  const lowered = String(vote || "").toLowerCase();
  if (lowered.includes("yea") || lowered.includes("aye") || lowered === "yes") {
    return "yea";
  }
  if (lowered.includes("nay") || lowered.includes("no")) {
    return "nay";
  }
  return "neutral";
}

function voteColor(vote) {
  const tone = voteTone(vote);
  if (tone === "yea") {
    return "#00FF00";
  }
  if (tone === "nay") {
    return "#FF0000";
  }
  return "#888888";
}

function partyBackground(party) {
  const code = normalizePartyCode(party);
  if (code === "D") {
    return "#0044FF";
  }
  if (code === "R") {
    return "#FF0000";
  }
  return "#111111";
}

function partyInk(party) {
  const code = normalizePartyCode(party);
  return code === "R" ? "#000000" : "#FFFFFF";
}

function alignmentColor(score) {
  if (!Number.isFinite(score)) {
    return "#FFFFFF";
  }
  if (score < 25) {
    return "#FF0000";
  }
  return "#FFFFFF";
}

function formatAlignment(member) {
  const score = Number.isFinite(member?.trumpScore?.score) ? member.trumpScore.score : null;
  return {
    value: member?.trumpScore?.scoreLabel || (score === null ? "NO DATA" : `${score}%`),
    color: alignmentColor(score),
  };
}

function findFeaturedBillById(id) {
  return FEATURED_BILLS.find((bill) => bill.id === id) || FEATURED_BILLS[0];
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationLabel, setLocationLabel] = useState("");
  const [representatives, setRepresentatives] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedBill, setSelectedBill] = useState(null);
  const [selectedVotePayload, setSelectedVotePayload] = useState(null);
  const [instantInsight, setInstantInsight] = useState(null);
  const [locationContext, setLocationContext] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const recommendedBills = useMemo(() => FEATURED_BILLS, []);

  const loadBillVotes = useCallback(
    async (bill, contextOverride) => {
      const context = contextOverride || locationContext;
      if (!bill || !context?.state || !context?.district) {
        return;
      }

      setErrorMessage("");
      const payload = await fetchJson("/api/bill-votes", {
        congress: bill.congress,
        billType: bill.billType,
        billNumber: bill.billNumber,
        state: context.state,
        district: context.district,
      });
      setSelectedBill(bill);
      setSelectedVotePayload(payload);
    },
    [locationContext]
  );

  const handleSelectBill = useCallback(
    async (bill) => {
      setSearchFocused(false);
      setSearchQuery(bill.billLabel || bill.title || "");
      await loadBillVotes(bill);
    },
    [loadBillVotes]
  );

  const resolveDelegationFromLocation = useCallback(async () => {
    try {
      setLocationLoading(true);
      setErrorMessage("");

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Location permission was denied.");
      }

      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const fccResponse = await fetch(
        `https://geo.fcc.gov/api/census/area?lat=${currentPosition.coords.latitude}&lon=${currentPosition.coords.longitude}&format=json`
      );
      const fccPayload = await fccResponse.json();
      const firstResult = fccPayload?.results?.[0];

      const stateCode = firstResult?.state_code;
      const districtCode = normalizeDistrict(firstResult?.congressional_district);

      if (!stateCode || districtCode === "") {
        throw new Error("District lookup failed for your current location.");
      }

      const context = {
        state: stateCode,
        district: districtCode,
        label: districtCode === "0" ? `${stateCode} AT-LARGE` : `${stateCode}-${districtCode}`,
      };
      setLocationContext(context);
      setLocationLabel(context.label);

      const [repsPayload, insightPayload] = await Promise.all([
        fetchJson("/api/representatives", {
          state: context.state,
          district: context.district,
        }),
        fetchJson("/api/instant-insight", {
          state: context.state,
          district: context.district,
        }),
      ]);

      const reps = repsPayload.representatives || [];
      setRepresentatives(reps);
      setInstantInsight(insightPayload);

      const featuredBill = insightPayload?.bill || findFeaturedBillById("hr1");
      await loadBillVotes(featuredBill, context);
    } catch (error) {
      setErrorMessage(error.message || "Location lookup failed.");
    } finally {
      setLocationLoading(false);
    }
  }, [loadBillVotes]);

  useEffect(() => {
    let cancelled = false;

    async function searchBills() {
      if (!searchFocused) {
        return;
      }

      if (!searchQuery.trim()) {
        setSearchResults(recommendedBills);
        return;
      }

      try {
        setSearchLoading(true);
        const payload = await fetchJson("/api/search-bills", { q: searchQuery.trim() });
        if (!cancelled) {
          setSearchResults(payload.results || []);
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
          setErrorMessage(error.message || "Search failed.");
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }

    const timer = setTimeout(searchBills, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchFocused, searchQuery, recommendedBills]);

  const hasNoResults = searchQuery.trim().length > 0 && !searchLoading && searchResults.length === 0;

  const infoAction = useCallback(() => {
    Alert.alert("INFO", INFO_COPY);
  }, []);

  const spotlightHeadline = instantInsight?.headline || "SET LOCATION TO LOAD LIVE VOTE RECEIPTS";
  const spotlightSummary =
    instantInsight?.summary ||
    "Tap the location pin to identify your House district and Senate delegation instantly.";

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        stickyHeaderIndices={locationContext ? [1] : []}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroBlock}>
          <View style={styles.topRow}>
            <Text style={styles.title}>KNOW YOUR REPS</Text>
            <Pressable style={styles.infoButton} onPress={infoAction}>
              <Text style={styles.infoButtonText}>?</Text>
            </Pressable>
          </View>

          <Text style={styles.subtitle}>SEARCH BILLS. SEE THE RECEIPTS.</Text>

          <View style={styles.searchShell}>
            <SearchOverlay
              query={searchQuery}
              results={searchResults}
              featuredBills={recommendedBills}
              visible={searchFocused}
              loading={searchLoading}
              noResults={hasNoResults}
              onChangeQuery={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                setTimeout(() => {
                  setSearchFocused(false);
                }, 120);
              }}
              onSelectBill={handleSelectBill}
            />
          </View>

          <Pressable
            style={[styles.locationPinButton, locationLoading && styles.loadingBlock]}
            onPress={resolveDelegationFromLocation}
          >
            <Text style={styles.locationPinGlyph}>⌖</Text>
            <Text style={styles.locationPinLabel}>
              {locationLoading ? "CURRENT LOCATION / FINDING..." : "CURRENT LOCATION"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.stickyDelegationHeader}>
          {locationContext ? (
            <View style={styles.delegationHeaderInner}>
              <Text style={styles.delegationHeaderLabel}>{locationLabel}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.delegationHeaderRows}>
                  {representatives.map((member) => {
                    const alignment = formatAlignment(member);
                    return (
                      <View key={`${member.bioguideId || displayMemberName(member)}-sticky`} style={styles.delegationMiniCard}>
                        <Text style={styles.delegationMiniName}>
                          {displayMemberName(member)} ({normalizePartyCode(member.party)})
                        </Text>
                        <Text style={[styles.delegationMiniScore, { color: alignment.color }]}>
                          {alignment.value} ALIGNMENT
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={styles.delegationHeaderInner}>
              <Text style={styles.delegationHeaderLabel}>LOCATION LOCKED</Text>
            </View>
          )}
        </View>

        <View style={styles.spotlightCard}>
          <Text style={styles.sectionLabel}>SPOTLIGHT</Text>
          <Text style={styles.spotlightHeadline}>{spotlightHeadline}</Text>
          <Text style={styles.spotlightCopy}>{spotlightSummary}</Text>
          {!!instantInsight?.members?.length && (
            <View style={styles.spotlightMembers}>
              {instantInsight.members.map((member) => (
                <View key={`${member.name}-${member.roleLabel}`} style={styles.spotlightMemberRow}>
                  <Text style={styles.spotlightMemberName}>{member.name}</Text>
                  <Text style={[styles.spotlightMemberVote, { color: voteColor(member.position) }]}>
                    {(member.position || "").toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {!!errorMessage && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage.toUpperCase()}</Text>
          </View>
        )}

        {!searchFocused && hasNoResults && (
          <View style={styles.errorCard}>
            <Text style={styles.noResultsTitle}>NO BILLS FOUND</Text>
            <Text style={styles.noResultsCopy}>RECOMMENDED BILLS</Text>
            <View style={styles.recommendedStack}>
              {recommendedBills.map((bill) => (
                <Pressable
                  key={bill.id}
                  style={styles.recommendedCard}
                  onPress={() => handleSelectBill(bill)}
                >
                  <Text style={styles.recommendedLabel}>{bill.billLabel}</Text>
                  <Text style={styles.recommendedTitle}>{bill.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {!!representatives.length && (
          <View style={styles.repStack}>
            {representatives.map((member) => {
              const backgroundColor = partyBackground(member.party);
              const ink = partyInk(member.party);
              const alignment = formatAlignment(member);
              const currentVote =
                selectedVotePayload?.votes
                  ?.flatMap((vote) => vote.members || [])
                  ?.find((voteMember) => voteMember.name === displayMemberName(member)) || null;

              return (
                <View
                  key={member.bioguideId || displayMemberName(member)}
                  style={[styles.repCard, { backgroundColor, borderColor: ink, shadowColor: ink }]}
                >
                  <Text style={[styles.repRole, { color: ink }]}>
                    {member.roleLabel || "MEMBER"} / {normalizePartyCode(member.party)}
                  </Text>
                  <View style={styles.repTopline}>
                    <Text style={[styles.repName, { color: ink }]}>{displayMemberName(member)}</Text>
                    <Text style={[styles.repAlignment, { color: alignment.color }]}>{alignment.value}</Text>
                  </View>
                  <Text style={[styles.repAlignmentLabel, { color: ink }]}>TRUMP ALIGNMENT</Text>
                  <Text style={[styles.repMeta, { color: ink }]}>
                    {(member.state || "").toUpperCase()} {member.district ? `DISTRICT ${member.district}` : ""}
                  </Text>
                  <View style={[styles.voteReceipt, { borderColor: ink }]}>
                    <Text style={[styles.voteReceiptLabel, { color: ink }]}>VOTE RECEIPT</Text>
                    <Text
                      style={[
                        styles.voteReceiptValue,
                        { color: voteColor(currentVote?.position || currentVote?.vote || "NOT VOTING") },
                      ]}
                    >
                      VOTE: {String(currentVote?.position || currentVote?.vote || "NOT VOTING").toUpperCase()}
                    </Text>
                    {currentVote?.explanation ? (
                      <Text style={[styles.voteReceiptNote, { color: ink }]}>{currentVote.explanation}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {selectedVotePayload?.bill ? (
          <View style={styles.billReceiptCard}>
            <Text style={styles.sectionLabel}>VOTE RECEIPT</Text>
            <Text style={styles.billLabel}>{selectedVotePayload.bill.billLabel}</Text>
            <Text style={styles.billTitle}>{selectedVotePayload.bill.title}</Text>
            <Text style={styles.billDescription}>
              {selectedVotePayload.bill.plainDescription || "OFFICIAL BILL SUMMARY"}
            </Text>

            {(selectedVotePayload.votes || []).map((vote) => (
              <View key={`${vote.chamber}-${vote.rollNumber}`} style={styles.voteLedgerCard}>
                <Text style={styles.voteLedgerTopline}>
                  {String(vote.chamber || "ROLL CALL").toUpperCase()} / #{vote.rollNumber || "?"}
                </Text>
                <Text style={styles.voteLedgerQuestion}>{vote.question || vote.actionText}</Text>
                <Text style={styles.voteLedgerMeta}>
                  {vote.voteDate || "UNKNOWN DATE"} {vote.result ? ` / ${vote.result}` : ""}
                </Text>
                <Text style={styles.voteLedgerSource}>
                  {vote.sourceLabel || `CONGRESS ROLL CALL #${vote.rollNumber || "?"}`}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderText}>SET LOCATION TO LOAD YOUR FIRST VOTE RECEIPT.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#000000",
  },
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 64,
    gap: 12,
  },
  heroBlock: {
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flex: 1,
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 34,
  },
  subtitle: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
  },
  infoButton: {
    width: 48,
    height: 48,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  infoButtonText: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 18,
    fontWeight: "900",
  },
  searchShell: {
    position: "relative",
    zIndex: 20,
  },
  locationPinButton: {
    minHeight: 52,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  locationPinGlyph: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 20,
    fontWeight: "900",
  },
  locationPinLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  loadingBlock: {
    backgroundColor: "#111111",
  },
  stickyDelegationHeader: {
    backgroundColor: "#000000",
  },
  delegationHeaderInner: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    padding: 10,
    gap: 8,
  },
  delegationHeaderLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  delegationHeaderRows: {
    flexDirection: "row",
    gap: 8,
  },
  delegationMiniCard: {
    minWidth: 176,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  delegationMiniName: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  delegationMiniScore: {
    fontFamily: "Courier",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -1,
  },
  spotlightCard: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    padding: 14,
    gap: 10,
  },
  sectionLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  spotlightHeadline: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 24,
    letterSpacing: -1.5,
  },
  spotlightCopy: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 18,
  },
  spotlightMembers: {
    gap: 8,
  },
  spotlightMemberRow: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  spotlightMemberName: {
    flex: 1,
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  spotlightMemberVote: {
    fontFamily: "Courier",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  errorCard: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    padding: 14,
    gap: 8,
  },
  errorText: {
    color: "#FF0000",
    fontFamily: "Courier",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  noResultsTitle: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1.6,
  },
  noResultsCopy: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  recommendedStack: {
    gap: 8,
  },
  recommendedCard: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  recommendedLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  recommendedTitle: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  repStack: {
    gap: 12,
  },
  repCard: {
    borderWidth: 2,
    padding: 14,
    gap: 8,
    shadowOffset: {
      width: 4,
      height: 4,
    },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 0,
  },
  repRole: {
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  repTopline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  repName: {
    flex: 1,
    fontFamily: "Courier",
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 28,
    letterSpacing: -1.4,
  },
  repAlignment: {
    fontFamily: "Courier",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 30,
    letterSpacing: -2,
  },
  repAlignmentLabel: {
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  repMeta: {
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  voteReceipt: {
    marginTop: 6,
    borderWidth: 2,
    padding: 12,
    gap: 6,
    backgroundColor: "#000000",
  },
  voteReceiptLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  voteReceiptValue: {
    fontFamily: "Courier",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -1,
  },
  voteReceiptNote: {
    fontFamily: "Courier",
    fontSize: 11,
    lineHeight: 15,
  },
  billReceiptCard: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    padding: 14,
    gap: 10,
  },
  billLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
  },
  billTitle: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 26,
    letterSpacing: -1.3,
  },
  billDescription: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 18,
  },
  voteLedgerCard: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    padding: 12,
    gap: 6,
  },
  voteLedgerTopline: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  voteLedgerQuestion: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  voteLedgerMeta: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  voteLedgerSource: {
    color: "#00FF00",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  placeholderCard: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    padding: 16,
  },
  placeholderText: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 22,
    letterSpacing: -0.8,
  },
});
