import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

function renderBillLabel(item) {
  return item.billLabel || item.title || "UNKNOWN BILL";
}

export default function SearchOverlay({
  query,
  results,
  featuredBills,
  visible,
  loading,
  noResults,
  onChangeQuery,
  onFocus,
  onBlur,
  onSelectBill,
}) {
  const featured = featuredBills || [];
  const liveResults = results || [];

  return (
    <View style={styles.shell}>
      <TextInput
        value={query}
        onChangeText={onChangeQuery}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="TYPE A BILL NAME OR NUMBER"
        placeholderTextColor="#FFFFFF"
        autoCapitalize="characters"
        autoCorrect={false}
        selectionColor="#00FF00"
        style={styles.input}
      />

      {visible ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayLabel}>
            {query.trim() ? "LIVE RESULTS" : "RECOMMENDED BILLS"}
          </Text>

          {loading ? (
            <View style={styles.stateBlock}>
              <Text style={styles.stateText}>SEARCHING...</Text>
            </View>
          ) : null}

          {!query.trim() ? (
            <View style={styles.list}>
              {featured.map((item) => (
                <Pressable
                  key={item.id || `${item.billType}-${item.billNumber}`}
                  style={styles.billRow}
                  onPress={() => onSelectBill(item)}
                >
                  <Text style={styles.billLabel}>{renderBillLabel(item)}</Text>
                  <Text style={styles.billTitle}>{item.title}</Text>
                  <Text style={styles.billDescription}>{item.plainDescription}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {query.trim() && !loading ? (
            <View style={styles.list}>
              {liveResults.map((item) => (
                <Pressable
                  key={`${item.congress}-${item.billType}-${item.billNumber}`}
                  style={styles.billRow}
                  onPress={() => onSelectBill(item)}
                >
                  <Text style={styles.billLabel}>{renderBillLabel(item)}</Text>
                  <Text style={styles.billTitle}>{item.title}</Text>
                  <Text style={styles.billDescription}>
                    {item.plainDescription || item.featuredDescription || "OFFICIAL BILL SUMMARY"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {query.trim() && noResults ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>NO BILLS FOUND</Text>
              <Text style={styles.overlayLabel}>RECOMMENDED BILLS</Text>
              <View style={styles.list}>
                {featured.map((item) => (
                  <Pressable
                    key={`${item.id || item.billNumber}-fallback`}
                    style={styles.billRow}
                    onPress={() => onSelectBill(item)}
                  >
                    <Text style={styles.billLabel}>{renderBillLabel(item)}</Text>
                    <Text style={styles.billTitle}>{item.title}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: "relative",
    zIndex: 30,
  },
  input: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  overlay: {
    position: "absolute",
    top: 58,
    left: 0,
    right: 0,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    backgroundColor: "#000000",
    padding: 12,
    gap: 10,
  },
  overlayLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  stateBlock: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  stateText: {
    color: "#00FF00",
    fontFamily: "Courier",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  list: {
    gap: 8,
  },
  billRow: {
    borderWidth: 2,
    borderColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  billLabel: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  billTitle: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 18,
    letterSpacing: -0.4,
  },
  billDescription: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 12,
    lineHeight: 16,
  },
  emptyState: {
    gap: 10,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontFamily: "Courier",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -1.4,
  },
});
