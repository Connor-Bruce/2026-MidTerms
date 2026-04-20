#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import os
import re
import time
from functools import lru_cache
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from flask import Flask, jsonify, send_from_directory, request

# --- 1. CONFIG & ENVIRONMENT ---
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "static"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
CONGRESS_API_ROOT = "https://api.congress.gov/v3"
CURRENT_CONGRESS = 119
SUPPORTED_CONGRESSES = (119, 118)
SUPPORTED_YEARS = {"2023", "2024", "2025", "2026"}
CONGRESS_API_KEY = os.environ.get("CONGRESS_API_KEY", "").strip()
OPENSECRETS_API_KEY = os.environ.get("OPENSECRETS_API_KEY", "").strip()
USER_AGENT = "CivicVotesPrototype/1.0"
CACHE_TTL_SECONDS = 60 * 30
OPENSECRETS_SEARCH_ROOT = "https://www.opensecrets.org/search"
LEGISLATORS_CURRENT_JSON_URL = "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages/legislators-current.json"
INFLUENCE_ID_CACHE_TTL_SECONDS = 60 * 60 * 24
CENSUS_ZIP_CROSSWALK_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt"
ZIP_CROSSWALK_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7

PASSAGE_ACTION_TERMS = (
    "passed",
    "agreed to",
    "passage",
)
MAJOR_2024_BILL_TITLES = (
    "further consolidated appropriations act 2024",
    "consolidated appropriations act 2024",
    "national security supplemental appropriations act 2024",
    "faa reauthorization act of 2024",
)
FEATURED_BILL_SPECS = (
    {
        "congress": 119,
        "billType": "hr",
        "billNumber": "1",
        "titleOverride": "One Big Beautiful Bill Act of 2025",
        "featuredLabel": "RECOMMENDED",
        "featuredDescription": "The foundational budget and tax-cut package of the current administration. Tracks major shifts in health care funding, social safety nets, and federal tax structures.",
    },
    {
        "congress": 119,
        "billType": "hr",
        "billNumber": "4405",
        "titleOverride": "Epstein Files Transparency Act",
        "featuredLabel": "RECOMMENDED",
        "featuredDescription": "A records-disclosure measure requiring DOJ to publish searchable, downloadable unclassified Epstein investigation files and report what was released or withheld.",
    },
    {
        "congress": 119,
        "billType": "hr",
        "billNumber": "22",
        "titleOverride": "Safeguard American Voter Eligibility (SAVE) Act",
        "featuredLabel": "RECOMMENDED",
        "featuredDescription": "The central election-integrity bill in the 119th Congress. Requires documentary proof of citizenship for federal voter registration and tighter voter-roll verification.",
    },
)
FEATURED_BILL_LIMIT = 3
TRUMP_SCORE_METHODOLOGY_LABEL = "VoteHub-style methodology"
TRUMP_SCORE_METHODOLOGY_URL = "https://votehub.com/2026/02/04/republicans-in-congress-voted-in-lockstep-with-trump-in-2025/"
TRUMP_SCORE_TRACKED_VOTES = (
    {
        "chamber": "House",
        "congress": 119,
        "billType": "hr",
        "billNumber": "29",
        "title": "Laken Riley Act",
        "voteUrl": "https://clerk.house.gov/evs/2025/roll006.xml",
        "rollNumber": "6",
        "voteDate": "2025-01-07",
        "trumpPosition": "support",
    },
    {
        "chamber": "House",
        "congress": 119,
        "billType": "hr",
        "billNumber": "27",
        "title": "HALT Fentanyl Act",
        "voteUrl": "https://clerk.house.gov/evs/2025/roll033.xml",
        "rollNumber": "33",
        "voteDate": "2025-02-06",
        "trumpPosition": "support",
    },
    {
        "chamber": "House",
        "congress": 119,
        "billType": "hr",
        "billNumber": "22",
        "title": "Safeguard American Voter Eligibility (SAVE) Act",
        "voteUrl": "https://clerk.house.gov/evs/2025/roll102.xml",
        "rollNumber": "102",
        "voteDate": "2025-04-10",
        "trumpPosition": "support",
    },
    {
        "chamber": "House",
        "congress": 119,
        "billType": "hr",
        "billNumber": "1",
        "title": "One Big Beautiful Bill Act of 2025",
        "voteUrl": "https://clerk.house.gov/evs/2025/roll145.xml",
        "rollNumber": "145",
        "voteDate": "2025-05-22",
        "trumpPosition": "support",
    },
    {
        "chamber": "House",
        "congress": 119,
        "billType": "hr",
        "billNumber": "4",
        "title": "Rescissions Act of 2025",
        "voteUrl": "https://clerk.house.gov/evs/2025/roll168.xml",
        "rollNumber": "168",
        "voteDate": "2025-06-12",
        "trumpPosition": "support",
    },
    {
        "chamber": "Senate",
        "congress": 119,
        "billType": "s",
        "billNumber": "5",
        "title": "Laken Riley Act",
        "voteUrl": "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00007.xml",
        "rollNumber": "7",
        "voteDate": "2025-01-20",
        "trumpPosition": "support",
    },
    {
        "chamber": "Senate",
        "congress": 119,
        "billType": "s",
        "billNumber": "331",
        "title": "HALT Fentanyl Act",
        "voteUrl": "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00127.xml",
        "rollNumber": "127",
        "voteDate": "2025-03-14",
        "trumpPosition": "support",
    },
    {
        "chamber": "Senate",
        "congress": 119,
        "billType": "hr",
        "billNumber": "1",
        "title": "One Big Beautiful Bill Act of 2025",
        "voteUrl": "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00372.xml",
        "rollNumber": "372",
        "voteDate": "2025-07-01",
        "trumpPosition": "support",
    },
    {
        "chamber": "Senate",
        "congress": 119,
        "billType": "hr",
        "billNumber": "4",
        "title": "Rescissions Act of 2025",
        "voteUrl": "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00411.xml",
        "rollNumber": "411",
        "voteDate": "2025-07-17",
        "trumpPosition": "support",
    },
)
FUNDING_SEGMENTS = (
    {
        "key": "energy",
        "label": "Big Oil / Energy PACs",
        "percent": 37,
        "color": "#000000",
    },
    {
        "key": "aipac",
        "label": "AIPAC / Pro-Israel Groups",
        "percent": 20,
        "color": "#173a8f",
    },
    {
        "key": "gun",
        "label": "Gun Lobby / NRA",
        "percent": 16,
        "color": "#8a1c1c",
    },
    {
        "key": "pharma",
        "label": "Pharmaceutical Industry",
        "percent": 11,
        "color": "#b5961a",
    },
    {
        "key": "smaller",
        "label": "Combined Smaller PACs",
        "percent": 12,
        "color": "#6d6d6d",
    },
    {
        "key": "other",
        "label": "Other",
        "percent": 4,
        "color": "#d9d9d9",
    },
)
MOCK_FUNDING_TOTALS = {
    "S001150": 5_760_000,
    "S001231": 4_980_000,
    "P000197": 6_420_000,
}
MOCK_FUNDING_CANDIDATES = {
    "S001150": {
        "displayName": "Adam Schiff",
        "sourceLabel": "Mock OpenSecrets Industry Mix",
    },
    "S001231": {
        "displayName": "Lateefah Simon",
        "sourceLabel": "Mock OpenSecrets Industry Mix",
    },
    "P000197": {
        "displayName": "Alex Padilla",
        "sourceLabel": "Mock OpenSecrets Industry Mix",
    },
}

STATE_OPTIONS = [
    ("AL", "Alabama"),
    ("AK", "Alaska"),
    ("AZ", "Arizona"),
    ("AR", "Arkansas"),
    ("CA", "California"),
    ("CO", "Colorado"),
    ("CT", "Connecticut"),
    ("DE", "Delaware"),
    ("DC", "District of Columbia"),
    ("FL", "Florida"),
    ("GA", "Georgia"),
    ("HI", "Hawaii"),
    ("ID", "Idaho"),
    ("IL", "Illinois"),
    ("IN", "Indiana"),
    ("IA", "Iowa"),
    ("KS", "Kansas"),
    ("KY", "Kentucky"),
    ("LA", "Louisiana"),
    ("ME", "Maine"),
    ("MD", "Maryland"),
    ("MA", "Massachusetts"),
    ("MI", "Michigan"),
    ("MN", "Minnesota"),
    ("MS", "Mississippi"),
    ("MO", "Missouri"),
    ("MT", "Montana"),
    ("NE", "Nebraska"),
    ("NV", "Nevada"),
    ("NH", "New Hampshire"),
    ("NJ", "New Jersey"),
    ("NM", "New Mexico"),
    ("NY", "New York"),
    ("NC", "North Carolina"),
    ("ND", "North Dakota"),
    ("OH", "Ohio"),
    ("OK", "Oklahoma"),
    ("OR", "Oregon"),
    ("PA", "Pennsylvania"),
    ("RI", "Rhode Island"),
    ("SC", "South Carolina"),
    ("SD", "South Dakota"),
    ("TN", "Tennessee"),
    ("TX", "Texas"),
    ("UT", "Utah"),
    ("VT", "Vermont"),
    ("VA", "Virginia"),
    ("WA", "Washington"),
    ("WV", "West Virginia"),
    ("WI", "Wisconsin"),
    ("WY", "Wyoming"),
]

_TEXT_CACHE: dict[str, tuple[float, str]] = {}
STATE_NAME_TO_CODE = {name: code for code, name in STATE_OPTIONS}
PARTY_NAME_TO_ABBREV = {
    "Democratic": "D",
    "Republican": "R",
    "Independent": "I",
    "Independent Democrat": "ID",
    "Libertarian": "L",
}
STATE_FIPS_TO_CODE = {
    "01": "AL",
    "02": "AK",
    "04": "AZ",
    "05": "AR",
    "06": "CA",
    "08": "CO",
    "09": "CT",
    "10": "DE",
    "11": "DC",
    "12": "FL",
    "13": "GA",
    "15": "HI",
    "16": "ID",
    "17": "IL",
    "18": "IN",
    "19": "IA",
    "20": "KS",
    "21": "KY",
    "22": "LA",
    "23": "ME",
    "24": "MD",
    "25": "MA",
    "26": "MI",
    "27": "MN",
    "28": "MS",
    "29": "MO",
    "30": "MT",
    "31": "NE",
    "32": "NV",
    "33": "NH",
    "34": "NJ",
    "35": "NM",
    "36": "NY",
    "37": "NC",
    "38": "ND",
    "39": "OH",
    "40": "OK",
    "41": "OR",
    "42": "PA",
    "44": "RI",
    "45": "SC",
    "46": "SD",
    "47": "TN",
    "48": "TX",
    "49": "UT",
    "50": "VT",
    "51": "VA",
    "53": "WA",
    "54": "WV",
    "55": "WI",
    "56": "WY",
}
SUPPORTED_STATE_CODES = {code for code, _ in STATE_OPTIONS}

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
app.json.sort_keys = False


# --- 2. XML + API HELPERS ---
def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", unescape(value)).strip()
    return normalized or None


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def find_child(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    for child in list(element):
        if local_name(child.tag) == name:
            return child
    return None


def find_children(element: ET.Element | None, name: str) -> list[ET.Element]:
    if element is None:
        return []
    return [child for child in list(element) if local_name(child.tag) == name]


def find_descendant(element: ET.Element | None, name: str) -> ET.Element | None:
    if element is None:
        return None
    for child in element.iter():
        if local_name(child.tag) == name:
            return child
    return None


def descendant_text(element: ET.Element | None, names: tuple[str, ...]) -> str | None:
    if element is None:
        return None
    for child in element.iter():
        if local_name(child.tag) in names:
            text = clean_text(child.text)
            if text:
                return text
    return None


def child_text(element: ET.Element | None, path: str) -> str | None:
    current = element
    for part in path.split("/"):
        current = find_child(current, part)
        if current is None:
            return None
    return clean_text(current.text)


def normalize_query(value: str) -> str:
    lowered = value.lower().strip()
    return re.sub(r"[^a-z0-9]+", " ", lowered).strip()


def compact_bill_label(bill_type: str, bill_number: str) -> str:
    letters = re.sub(r"[^a-z]", "", bill_type.lower())
    return f"{letters}{bill_number}"


def pretty_bill_type(bill_type: str) -> str:
    mapping = {
        "hr": "H.R.",
        "s": "S.",
        "hjres": "H.J.Res.",
        "sjres": "S.J.Res.",
        "hconres": "H.Con.Res.",
        "sconres": "S.Con.Res.",
        "hres": "H.Res.",
        "sres": "S.Res.",
    }
    return mapping.get(bill_type.lower(), bill_type.upper())


def ordinal_congress(congress: int) -> str:
    if 10 <= congress % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(congress % 10, "th")
    return f"{congress}{suffix}"


def normalize_district(value: str | None) -> str | None:
    if value is None:
        return None
    digits = re.sub(r"\D", "", value.strip())
    if not digits:
        return None
    return str(int(digits))


def normalize_zip_code(value: str | None) -> str | None:
    if value is None:
        return None
    digits = re.sub(r"\D", "", value.strip())
    if not digits:
        return None
    normalized = digits[:5]
    if len(normalized) != 5:
        raise ValueError("ZIP code must be 5 digits.")
    return normalized


def district_option_label(state: str, district: str) -> str:
    normalized_district = normalize_district(district) or district
    if normalized_district == "0":
        return f"{state} AT-LARGE"
    if normalized_district == "98":
        return f"{state} DELEGATE"
    return f"{state}-{normalized_district}"


def slugify_opensecrets_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


@lru_cache(maxsize=1)
def load_legislator_influence_index() -> dict[str, dict[str, str]]:
    raw_data = fetch_text(LEGISLATORS_CURRENT_JSON_URL, cache_ttl=INFLUENCE_ID_CACHE_TTL_SECONDS)
    items = json.loads(raw_data)
    index: dict[str, dict[str, str]] = {}

    for item in items:
        identifier = item.get("id") or {}
        bioguide_id = identifier.get("bioguide")
        opensecrets_id = identifier.get("opensecrets")
        if not bioguide_id or not opensecrets_id:
            continue

        name_data = item.get("name") or {}
        full_name = " ".join(
            piece
            for piece in [
                name_data.get("first"),
                name_data.get("middle"),
                name_data.get("last"),
            ]
            if piece
        ).strip() or name_data.get("official_full") or ""

        index[bioguide_id.upper()] = {
            "opensecretsId": opensecrets_id,
            "slug": slugify_opensecrets_name(full_name or name_data.get("official_full") or ""),
        }

    return index


def build_opensecrets_search_url(member: dict[str, Any]) -> str:
    query_parts: list[str] = []
    display_name = member.get("displayName") or member.get("listName") or ""
    if display_name:
        query_parts.append(display_name)

    state_code = (member.get("state") or "").upper()
    district = normalize_district(member.get("district"))
    chamber = (member.get("chamber") or "").lower()

    if chamber == "senate":
        if state_code:
            query_parts.extend([state_code, "Senate"])
    elif state_code and district:
        if district == "0":
            query_parts.extend([state_code, "at large"])
        else:
            query_parts.extend([state_code, district])
    elif state_code:
        query_parts.append(state_code)

    query = " ".join(part for part in query_parts if part).strip()
    return f"{OPENSECRETS_SEARCH_ROOT}?{urlencode({'q': query})}"


def build_opensecrets_member_url(member: dict[str, Any]) -> str:
    bioguide_id = (member.get("bioguideId") or "").upper()
    try:
        influence_record = load_legislator_influence_index().get(bioguide_id)
    except Exception:
        influence_record = None

    if not influence_record:
        return build_opensecrets_search_url(member)

    slug = influence_record.get("slug") or slugify_opensecrets_name(
        " ".join(piece for piece in [member.get("firstName"), member.get("lastName")] if piece)
    )
    opensecrets_id = influence_record.get("opensecretsId")
    if not slug or not opensecrets_id:
        return build_opensecrets_search_url(member)

    return f"https://www.opensecrets.org/members-of-congress/{slug}/summary?{urlencode({'cid': opensecrets_id})}"


def split_name(name: str | None) -> tuple[str | None, str | None]:
    if not name:
        return None, None
    if "," in name:
        last, first = [piece.strip() for piece in name.split(",", 1)]
        return first or None, last or None
    pieces = name.split()
    if len(pieces) == 1:
        return None, pieces[0]
    return " ".join(pieces[:-1]), pieces[-1]


def parse_member_service_terms(terms_container: ET.Element | None) -> list[dict[str, Any]]:
    parsed_terms = []
    for term in member_term_items(terms_container):
        congress_text = child_text(term, "congress")
        congress = int(congress_text) if congress_text and congress_text.isdigit() else None
        state_code = child_text(term, "stateCode")
        state_name = child_text(term, "stateName")
        parsed_terms.append(
            {
                "congress": congress,
                "chamber": child_text(term, "chamber"),
                "state": state_code or STATE_NAME_TO_CODE.get(state_name or "", state_name),
                "district": normalize_district(child_text(term, "district")),
                "startYear": child_text(term, "startYear"),
                "endYear": child_text(term, "endYear"),
            }
        )
    return parsed_terms


def member_term_items(terms_container: ET.Element | None) -> list[ET.Element]:
    if terms_container is None:
        return []

    items = []
    for node in terms_container.iter():
        if local_name(node.tag) != "item":
            continue
        if child_text(node, "chamber"):
            items.append(node)
    return items


def party_abbreviation(party_name: str | None) -> str | None:
    if not party_name:
        return None
    return PARTY_NAME_TO_ABBREV.get(party_name, party_name)


def latest_party_abbreviation(member_element: ET.Element | None) -> str | None:
    history = find_children(find_child(member_element, "partyHistory"), "item")
    if history:
        latest = history[-1]
        return child_text(latest, "partyAbbreviation") or party_abbreviation(child_text(latest, "partyName"))
    return None


def build_congress_url(path_or_url: str, params: dict[str, Any] | None = None) -> str:
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        base_url = path_or_url
        if "api.congress.gov" in path_or_url:
            query: dict[str, Any] = {"api_key": CONGRESS_API_KEY, "format": "xml"}
        else:
            query = {}
    else:
        base_url = f"{CONGRESS_API_ROOT}{path_or_url}"
        query = {"api_key": CONGRESS_API_KEY, "format": "xml"}

    if params:
        query.update({key: value for key, value in params.items() if value is not None})

    if not query:
        return base_url

    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}{urlencode(query)}"


def fetch_text(url: str, *, cache_ttl: int = CACHE_TTL_SECONDS) -> str:
    cached = _TEXT_CACHE.get(url)
    if cached and time.time() - cached[0] < cache_ttl:
        return cached[1]

    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=20) as response:
        content = response.read().decode("utf-8")

    _TEXT_CACHE[url] = (time.time(), content)
    return content


def fetch_xml(url: str, *, cache_ttl: int = CACHE_TTL_SECONDS) -> ET.Element:
    text = fetch_text(url, cache_ttl=cache_ttl)
    return ET.fromstring(text)


def fetch_congress_xml(path_or_url: str, params: dict[str, Any] | None = None) -> ET.Element:
    if not CONGRESS_API_KEY:
        raise RuntimeError(
            "Missing CONGRESS_API_KEY. Sign up for a free key at https://api.congress.gov/sign-up/."
        )
    return fetch_xml(build_congress_url(path_or_url, params))


def fetch_all_congress_items(
    path: str,
    *,
    container_name: str,
    item_name: str,
    params: dict[str, Any] | None = None,
) -> list[ET.Element]:
    page_url = build_congress_url(path, {"limit": 250, "offset": 0, **(params or {})})
    collected: list[ET.Element] = []

    for _ in range(40):
        root = fetch_xml(page_url)
        container = find_descendant(root, container_name)
        collected.extend(find_children(container, item_name))
        pagination = find_descendant(root, "pagination")
        next_url = child_text(pagination, "next")
        if not next_url:
            break
        page_url = build_congress_url(next_url)

    return collected


@lru_cache(maxsize=1)
def load_zip_district_index() -> dict[str, list[dict[str, Any]]]:
    text = fetch_text(CENSUS_ZIP_CROSSWALK_URL, cache_ttl=ZIP_CROSSWALK_CACHE_TTL_SECONDS).lstrip("\ufeff")
    reader = csv.DictReader(text.splitlines(), delimiter="|")
    grouped: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}

    for row in reader:
        zip_code = (row.get("GEOID_ZCTA5_20") or "").strip()
        congressional_geoid = (row.get("GEOID_CD119_20") or "").strip()
        if not zip_code or len(congressional_geoid) != 4:
            continue

        state_code = STATE_FIPS_TO_CODE.get(congressional_geoid[:2])
        if not state_code or state_code not in SUPPORTED_STATE_CODES:
            continue

        district_code = normalize_district(congressional_geoid[2:])
        if district_code is None:
            continue

        land_part = int((row.get("AREALAND_PART") or "0").strip() or "0")
        water_part = int((row.get("AREAWATER_PART") or "0").strip() or "0")
        coverage_value = land_part or water_part

        bucket = grouped.setdefault(zip_code, {})
        key = (state_code, district_code)
        entry = bucket.setdefault(
            key,
            {
                "state": state_code,
                "district": district_code,
                "coverageValue": 0,
            },
        )
        entry["coverageValue"] += coverage_value

    index: dict[str, list[dict[str, Any]]] = {}
    for zip_code, bucket in grouped.items():
        options = list(bucket.values())
        total_coverage = sum(item["coverageValue"] for item in options) or 1
        options.sort(key=lambda item: (-item["coverageValue"], item["state"], int(item["district"])))
        index[zip_code] = [
            {
                "state": option["state"],
                "district": option["district"],
                "label": district_option_label(option["state"], option["district"]),
                "coveragePercent": max(1, round((option["coverageValue"] / total_coverage) * 100)),
            }
            for option in options
        ]

    return index


def lookup_zip_districts(zip_code: str) -> list[dict[str, Any]]:
    normalized_zip = normalize_zip_code(zip_code)
    if not normalized_zip:
        raise ValueError("ZIP code must be 5 digits.")

    options = load_zip_district_index().get(normalized_zip, [])
    if not options:
        raise ValueError("I could not map that ZIP code to a current congressional district.")

    return [dict(option) for option in options]


# --- 3. BILL SEARCH ---
def extract_law_number(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"(\d{1,3}-\d{1,4})", text)
    return match.group(1) if match else None


def bill_key(congress: int | str | None, bill_type: str | None, bill_number: str | None) -> tuple[int | None, str, str]:
    normalized_congress = int(congress) if congress is not None else None
    normalized_type = (bill_type or "").lower()
    normalized_number = str(int(str(bill_number))) if bill_number else ""
    return normalized_congress, normalized_type, normalized_number


def featured_bill_spec_for(congress: int, bill_type: str, bill_number: str) -> dict[str, Any] | None:
    target_key = bill_key(congress, bill_type, bill_number)
    for order, spec in enumerate(FEATURED_BILL_SPECS, start=1):
        if bill_key(spec["congress"], spec["billType"], spec["billNumber"]) == target_key:
            return {**spec, "featuredOrder": order}
    return None


def law_item_to_summary(item: ET.Element) -> dict[str, Any]:
    congress_text = child_text(item, "congress")
    congress = int(congress_text) if congress_text and congress_text.isdigit() else CURRENT_CONGRESS
    bill_type = (child_text(item, "type") or "").lower()
    bill_number = child_text(item, "number") or ""
    title = child_text(item, "title") or f"{pretty_bill_type(bill_type)} {bill_number}"
    latest_action_date = child_text(item, "latestAction/actionDate") or ""
    latest_action_text = child_text(item, "latestAction/text") or ""
    introduced_date = child_text(item, "introducedDate") or latest_action_date
    law_number = child_text(item, "laws/number") or extract_law_number(latest_action_text)
    bill_label = f"{pretty_bill_type(bill_type)} {bill_number}".strip()

    return {
        "billType": bill_type,
        "congress": congress,
        "congressLabel": ordinal_congress(congress),
        "type": bill_type.upper(),
        "billNumber": bill_number,
        "number": bill_number,
        "billLabel": bill_label,
        "compactBillLabel": compact_bill_label(bill_type, bill_number),
        "title": title,
        "introducedDate": introduced_date,
        "latestActionDate": latest_action_date,
        "latestActionText": latest_action_text,
        "lawNumber": law_number,
        "lawType": child_text(item, "laws/type"),
        "originChamber": child_text(item, "originChamber"),
        "billUrl": child_text(item, "url"),
    }


def apply_featured_metadata(summary: dict[str, Any]) -> dict[str, Any]:
    featured_spec = featured_bill_spec_for(summary["congress"], summary["billType"], summary["billNumber"])
    if not featured_spec:
        enriched = dict(summary)
        enriched["featured"] = False
        return enriched

    enriched = dict(summary)
    enriched["featured"] = True
    enriched["featuredLabel"] = featured_spec.get("featuredLabel") or "FEATURED"
    enriched["featuredOrder"] = featured_spec["featuredOrder"]
    enriched["featuredNote"] = featured_spec.get("featuredNote")
    enriched["featuredDescription"] = featured_spec.get("featuredDescription")
    if featured_spec.get("titleOverride"):
        enriched["officialTitle"] = summary["title"]
        enriched["title"] = featured_spec["titleOverride"]
    return enriched


@lru_cache(maxsize=128)
def fetch_bill_summary(congress: int, bill_type: str, bill_number: str) -> dict[str, Any]:
    root = fetch_congress_xml(f"/bill/{congress}/{bill_type}/{int(bill_number)}")
    bill_element = find_descendant(root, "bill") or root
    summary = law_item_to_summary(bill_element)
    if not summary.get("billType") or not summary.get("billNumber"):
        raise ValueError(f"Could not load bill details for {pretty_bill_type(bill_type)} {bill_number}.")
    return apply_featured_metadata(summary)


@lru_cache(maxsize=1)
def load_law_index() -> list[dict[str, Any]]:
    laws = []
    for congress in SUPPORTED_CONGRESSES:
        items = fetch_all_congress_items(
            f"/law/{congress}/pub",
            container_name="bills",
            item_name="bill",
        )
        for item in items:
            summary = apply_featured_metadata(law_item_to_summary(item))
            if summary["latestActionDate"][:4] not in SUPPORTED_YEARS:
                continue
            laws.append(summary)

    laws.sort(key=lambda entry: (entry["latestActionDate"], entry["congress"], entry["billLabel"]), reverse=True)
    return laws


@lru_cache(maxsize=1)
def load_featured_bill_catalog() -> list[dict[str, Any]]:
    featured_bills = []
    for spec in FEATURED_BILL_SPECS:
        summary = fetch_bill_summary(spec["congress"], spec["billType"], spec["billNumber"])
        if not bill_has_quality_roll_call(summary["congress"], summary["billType"], summary["billNumber"]):
            raise RuntimeError(
                f"Featured bill {summary['billLabel']} does not have an official roll call vote available."
            )
        featured_bills.append(summary)

    featured_bills.sort(key=lambda bill: bill.get("featuredOrder") or 999)
    return featured_bills


def featured_laws(limit: int = FEATURED_BILL_LIMIT) -> list[dict[str, Any]]:
    return [dict(bill) for bill in load_featured_bill_catalog()[:limit]]


def mock_funding_total(candidate_id: str) -> int:
    normalized = candidate_id.upper()
    if normalized in MOCK_FUNDING_TOTALS:
        return MOCK_FUNDING_TOTALS[normalized]

    seed = sum(ord(char) for char in normalized)
    return 3_500_000 + (seed % 35) * 125_000


def build_mock_candidate_funding(candidate_id: str) -> dict[str, Any]:
    normalized = candidate_id.upper()
    total_amount = mock_funding_total(normalized)
    segments = []
    allocated = 0

    for index, segment in enumerate(FUNDING_SEGMENTS):
        if index == len(FUNDING_SEGMENTS) - 1:
            amount = total_amount - allocated
        else:
            amount = round(total_amount * (segment["percent"] / 100))
            allocated += amount

        segments.append(
            {
                **segment,
                "amount": amount,
            }
        )

    candidate_info = MOCK_FUNDING_CANDIDATES.get(normalized, {})
    return {
        "candidateId": normalized,
        "displayName": candidate_info.get("displayName") or normalized,
        "totalAmount": total_amount,
        "sourceLabel": candidate_info.get("sourceLabel") or "Mock OpenSecrets Industry Mix",
        "sourceMode": "mock",
        "openSecretsReady": bool(OPENSECRETS_API_KEY),
        "categories": segments,
        "updatedAt": "2026-04-18",
    }


def build_candidate_funding_payload(candidate_id: str) -> dict[str, Any]:
    normalized = candidate_id.strip().upper()
    if not normalized:
        raise ValueError("Candidate id is required.")

    # Integration point:
    # If you later wire the OpenSecrets candidate/industry endpoints, this
    # function can swap in live percentages while keeping the frontend payload
    # shape exactly the same.
    return build_mock_candidate_funding(normalized)


@lru_cache(maxsize=1)
def load_search_catalog() -> list[dict[str, Any]]:
    merged: dict[tuple[int | None, str, str], dict[str, Any]] = {}

    for law in load_law_index():
        merged[bill_key(law["congress"], law["billType"], law["billNumber"])] = dict(law)

    for featured in load_featured_bill_catalog():
        key = bill_key(featured["congress"], featured["billType"], featured["billNumber"])
        existing = merged.get(key, {})
        merged[key] = {**existing, **featured}

    return list(merged.values())


def resolve_bill_summary(congress: int | None, bill_type: str, bill_number: str) -> dict[str, Any]:
    normalized_type = bill_type.lower()
    normalized_number = str(int(bill_number))

    for bill in load_search_catalog():
        if bill["billType"] != normalized_type or bill["billNumber"] != normalized_number:
            continue
        if congress is not None and bill["congress"] != congress:
            continue
        return bill

    if congress is None:
        raise ValueError("That bill was not found in the current search index.")

    summary = fetch_bill_summary(congress, normalized_type, normalized_number)
    if not bill_has_quality_roll_call(summary["congress"], summary["billType"], summary["billNumber"]):
        raise ValueError("That bill does not have a recorded roll call available.")
    return summary


def search_laws(query: str) -> list[dict[str, Any]]:
    normalized_query = normalize_query(query)
    if len(normalized_query) < 2:
        return featured_laws()

    results: list[tuple[int, dict[str, Any]]] = []
    for law in load_search_catalog():
        title_query = normalize_query(law["title"])
        label_query = normalize_query(law["billLabel"])
        official_title_query = normalize_query(law.get("officialTitle") or "")
        note_query = normalize_query(law.get("featuredNote") or "")
        law_query = normalize_query(law["lawNumber"] or "")
        haystack = " ".join(
            filter(None, [title_query, official_title_query, label_query, law_query, note_query, law["compactBillLabel"]])
        )
        tokens = normalized_query.split()

        score = 0
        if label_query == normalized_query or law["compactBillLabel"] == normalized_query.replace(" ", ""):
            score += 120
        if law_query and law_query == normalized_query:
            score += 110
        if title_query.startswith(normalized_query):
            score += 100
        if normalized_query in title_query:
            score += 80
        if official_title_query and normalized_query in official_title_query:
            score += 65
        if normalized_query in haystack:
            score += 50
        if tokens and all(token in haystack for token in tokens):
            score += 30
        if law.get("featured"):
            score += 18
        if law["congress"] == 118 and law["latestActionDate"].startswith("2024"):
            if any(priority_title in title_query for priority_title in MAJOR_2024_BILL_TITLES):
                score += 90
            elif "appropriations act 2024" in title_query:
                score += 55
            elif "2024" in normalized_query:
                score += 20

        if score:
            results.append((score, law))

    results.sort(
        key=lambda item: (
            item[0],
            item[1]["latestActionDate"],
            item[1]["congress"],
        ),
        reverse=True,
    )

    filtered_results = []
    for _, law in results:
        if bill_has_quality_roll_call(law["congress"], law["billType"], law["billNumber"]):
            filtered_results.append(law)
        if len(filtered_results) == 12:
            break

    return filtered_results


# --- 4. MEMBER + VOTE HELPERS ---
def parse_member_list_item(item: ET.Element) -> dict[str, Any]:
    terms = member_term_items(find_child(item, "terms"))
    current_term = terms[-1] if terms else None
    first_name, inferred_last_name = split_name(child_text(item, "name"))
    state_name = child_text(item, "state")

    return {
        "bioguideId": child_text(item, "bioguideId"),
        "listName": child_text(item, "name"),
        "state": child_text(current_term, "stateCode") or STATE_NAME_TO_CODE.get(state_name or "", state_name),
        "party": party_abbreviation(child_text(item, "partyAbbreviation") or child_text(item, "partyName")),
        "district": normalize_district(child_text(item, "district") or child_text(current_term, "district")),
        "chamber": child_text(current_term, "chamber"),
        "url": child_text(item, "url"),
        "firstName": first_name,
        "lastName": inferred_last_name,
    }


def parse_member_detail(item: ET.Element) -> dict[str, Any]:
    terms_container = find_child(item, "terms")
    terms = member_term_items(terms_container)
    current_term = terms[-1] if terms else None
    state_name = child_text(item, "state")

    return {
        "displayName": child_text(item, "directOrderName") or child_text(item, "name") or "",
        "firstName": child_text(item, "firstName"),
        "lastName": child_text(item, "lastName"),
        "state": child_text(current_term, "stateCode") or STATE_NAME_TO_CODE.get(state_name or "", state_name),
        "district": normalize_district(child_text(item, "district") or child_text(current_term, "district")),
        "chamber": child_text(current_term, "chamber"),
        "party": latest_party_abbreviation(item),
        "website": child_text(item, "officialWebsiteUrl"),
        "office": child_text(item, "addressInformation/officeAddress"),
        "phone": child_text(item, "addressInformation/phoneNumber"),
        "serviceTerms": parse_member_service_terms(terms_container),
    }


def hydrate_member(entry: dict[str, Any]) -> dict[str, Any]:
    detail_url = entry.get("url")
    if not detail_url:
        return entry

    root = fetch_congress_xml(detail_url)
    member_element = find_descendant(root, "member")
    detail = parse_member_detail(member_element or root)

    enriched = dict(entry)
    enriched.update(detail)
    if not enriched.get("firstName") or not enriched.get("lastName"):
        first_name, last_name = split_name(enriched.get("displayName") or enriched.get("listName"))
        enriched["firstName"] = enriched.get("firstName") or first_name
        enriched["lastName"] = enriched.get("lastName") or last_name
    return enriched


def is_house_chamber(chamber: str | None) -> bool:
    return (chamber or "").lower() in {"house", "house of representatives"}


def fetch_representatives(state: str, district: str | None) -> list[dict[str, Any]]:
    normalized_state = state.upper()
    normalized_district = normalize_district(district)

    state_members = fetch_all_congress_items(
        f"/member/congress/{CURRENT_CONGRESS}/{normalized_state}",
        container_name="members",
        item_name="member",
        params={"currentMember": "true"},
    )

    senators: list[dict[str, Any]] = []
    for item in state_members:
        parsed = parse_member_list_item(item)
        if (parsed.get("chamber") or "").lower() == "senate":
            senators.append(parsed)

    house_members: list[dict[str, Any]] = []
    if normalized_district is not None:
        district_members = fetch_all_congress_items(
            f"/member/congress/{CURRENT_CONGRESS}/{normalized_state}/{normalized_district}",
            container_name="members",
            item_name="member",
            params={"currentMember": "true"},
        )
        for item in district_members:
            parsed = parse_member_list_item(item)
            if is_house_chamber(parsed.get("chamber")):
                house_members.append(parsed)

    selected = sorted(senators, key=lambda member: member.get("listName") or "")
    if house_members:
        selected.append(house_members[0])

    enriched = []
    for member in selected:
        hydrated = hydrate_member(member)
        chamber = hydrated.get("chamber")
        hydrated["roleLabel"] = "Senator" if (chamber or "").lower() == "senate" else "Representative"
        hydrated["financeUrl"] = build_opensecrets_member_url(hydrated)
        try:
            hydrated["trumpScore"] = build_member_trump_score(hydrated)
        except Exception:
            hydrated["trumpScore"] = {
                "score": None,
                "alignedVotes": 0,
                "votesConsidered": 0,
                "classification": "unavailable",
                "methodology": TRUMP_SCORE_METHODOLOGY_LABEL,
                "methodologyUrl": TRUMP_SCORE_METHODOLOGY_URL,
                "scope": "Current 119th Congress tracked floor votes where Trump publicly stated a position before the vote.",
                "sourceMode": "unavailable",
                "trackedBills": [],
            }
        enriched.append(hydrated)

    return enriched


def build_representatives_payload(
    state: str | None = None,
    district: str | None = None,
    zip_code: str | None = None,
) -> dict[str, Any]:
    normalized_zip = normalize_zip_code(zip_code) if zip_code else None
    normalized_state = (state or "").strip().upper() or None
    normalized_district = normalize_district(district)
    district_options: list[dict[str, Any]] = []

    if normalized_zip:
        district_options = lookup_zip_districts(normalized_zip)
        selected_option = None
        if normalized_state or normalized_district:
            for option in district_options:
                if normalized_state and option["state"] != normalized_state:
                    continue
                if normalized_district and option["district"] != normalized_district:
                    continue
                selected_option = option
                break

        selected_option = selected_option or district_options[0]
        normalized_state = selected_option["state"]
        normalized_district = selected_option["district"]

    if not normalized_state:
        raise ValueError("Choose a state and district, or enter a 5-digit ZIP code first.")

    representatives = fetch_representatives(normalized_state, normalized_district)
    return {
        "lookupMode": "zip" if normalized_zip else "manual",
        "zip": normalized_zip,
        "state": normalized_state,
        "district": normalized_district,
        "districtOptions": district_options,
        "hasMultipleDistrictMatches": len(district_options) > 1,
        "representatives": representatives,
    }


def member_served_in_context(
    member: dict[str, Any],
    congress: int,
    chamber: str,
    state: str,
    district: str | None = None,
) -> tuple[bool, bool]:
    matching_congress_terms = [
        term
        for term in member.get("serviceTerms", [])
        if term.get("congress") == congress
    ]
    if not matching_congress_terms:
        return False, False

    normalized_state = state.upper()
    normalized_district = normalize_district(district)
    if chamber == "Senate":
        for term in matching_congress_terms:
            if (term.get("chamber") or "").lower() == "senate" and (term.get("state") or "").upper() == normalized_state:
                return True, True
        return False, True

    for term in matching_congress_terms:
        if not is_house_chamber(term.get("chamber")):
            continue
        if (term.get("state") or "").upper() != normalized_state:
            continue
        if normalized_district and normalize_district(term.get("district")) != normalized_district:
            continue
        return True, True
    return False, True


def member_absence_message(member: dict[str, Any], congress: int, chamber: str, had_congress_service: bool) -> str:
    congress_label = ordinal_congress(congress)
    role_label = member.get("roleLabel") or ("Senator" if chamber == "Senate" else "Representative")
    role_lower = role_label.lower()

    if not had_congress_service:
        if role_label == "Representative" and congress == 118:
            return "This representative was not a member of the 118th Congress and did not participate in this vote."
        return f"This {role_lower} was not a member of the {congress_label} Congress and did not participate in this vote."

    if chamber == "Senate":
        return f"This {role_lower} was not serving in the Senate during the {congress_label} Congress and did not participate in this vote."
    return f"This {role_lower} was not serving this district during the {congress_label} Congress and did not participate in this vote."


def action_matches_passage(action_text: str) -> bool:
    normalized = normalize_query(action_text)
    return any(term in normalized for term in PASSAGE_ACTION_TERMS)


def infer_vote_chamber(vote_url: str | None, chamber: str | None) -> str | None:
    if chamber:
        return chamber
    if not vote_url:
        return None

    lowered = vote_url.lower()
    if "clerk.house.gov" in lowered:
        return "House"
    if "senate.gov" in lowered:
        return "Senate"
    return None


def extract_roll_number(action_text: str | None) -> str | None:
    if not action_text:
        return None

    patterns = (
        r"record vote number:\s*(\d+)",
        r"roll no\.\s*(\d+)",
        r"roll number:\s*(\d+)",
    )
    for pattern in patterns:
        match = re.search(pattern, action_text, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return None


@lru_cache(maxsize=512)
def collect_bill_votes(congress: int, bill_type: str, bill_number: str) -> list[dict[str, Any]]:
    action_items = fetch_all_congress_items(
        f"/bill/{congress}/{bill_type}/{bill_number}/actions",
        container_name="actions",
        item_name="item",
    )

    all_votes = []
    matched_votes = []
    seen_votes: set[tuple[str, str, str]] = set()
    for action in action_items:
        action_text = child_text(action, "text") or ""
        is_passage_action = action_matches_passage(action_text)
        recorded_votes = find_children(find_child(action, "recordedVotes"), "recordedVote")
        if not recorded_votes:
            continue

        for recorded_vote in recorded_votes:
            vote_url = child_text(recorded_vote, "url")
            chamber = infer_vote_chamber(vote_url, child_text(recorded_vote, "chamber"))
            roll_number = child_text(recorded_vote, "rollNumber") or extract_roll_number(action_text)
            vote_key = (chamber or "", roll_number or "", vote_url or "")

            if not vote_url or vote_key in seen_votes:
                continue
            seen_votes.add(vote_key)

            vote_entry = {
                "url": vote_url,
                "chamber": chamber,
                "rollNumber": roll_number,
                "voteDate": child_text(recorded_vote, "date"),
                "actionDate": child_text(action, "actionDate"),
                "actionText": action_text,
            }
            all_votes.append(vote_entry)
            if is_passage_action:
                matched_votes.append(vote_entry)

    selected_votes = matched_votes
    if not selected_votes:
        latest_by_chamber: dict[str, dict[str, Any]] = {}
        for vote in all_votes:
            chamber = vote.get("chamber") or "Unknown"
            current = latest_by_chamber.get(chamber)
            if current is None or (vote.get("voteDate") or "") > (current.get("voteDate") or ""):
                latest_by_chamber[chamber] = vote
        selected_votes = list(latest_by_chamber.values())

    selected_votes.sort(key=lambda vote: (vote.get("voteDate") or vote.get("actionDate") or ""), reverse=True)
    return selected_votes[:10]


@lru_cache(maxsize=512)
def bill_has_quality_roll_call(congress: int, bill_type: str, bill_number: str) -> bool:
    return bool(collect_bill_votes(congress, bill_type, bill_number))


def normalize_member_position(raw_vote: str | None) -> str:
    if not raw_vote:
        return "Not Voting"

    cleaned = clean_text(raw_vote) or "Not Voting"
    normalized = normalize_query(cleaned)
    if normalized in {"yea", "aye", "yes"} or normalized.startswith("yea "):
        return "Yea"
    if normalized in {"nay", "no"} or normalized.startswith("nay "):
        return "Nay"
    if "not voting" in normalized or "did not vote" in normalized or normalized == "absent":
        return "Not Voting"
    if "present" in normalized:
        return "Present"
    return cleaned


@lru_cache(maxsize=128)
def load_trump_score_vote_entries() -> tuple[dict[str, Any], ...]:
    tracked_votes = sorted(
        TRUMP_SCORE_TRACKED_VOTES,
        key=lambda item: (
            item.get("voteDate") or "",
            item.get("rollNumber") or "",
        ),
        reverse=True,
    )
    return tuple(tracked_votes)


def is_vote_aligned_with_trump(position: str | None, trump_position: str) -> bool:
    normalized = normalize_member_position(position)
    if trump_position == "oppose":
        return normalized == "Nay"
    return normalized == "Yea"


def classify_trump_score(score: int | None) -> str:
    if score is None:
        return "unavailable"
    if score >= 80:
        return "in_alignment"
    if score < 25:
        return "against"
    return "mixed"


@lru_cache(maxsize=256)
def parse_house_vote(url: str) -> dict[str, Any]:
    root = fetch_xml(url)
    vote_metadata = find_child(root, "vote-metadata")
    vote_data = find_child(root, "vote-data")

    positions: dict[str, dict[str, Any]] = {}
    for recorded_vote in find_children(vote_data, "recorded-vote"):
        legislator = find_child(recorded_vote, "legislator")
        if legislator is None:
            continue
        bioguide_id = (legislator.get("name-id") or "").upper()
        if not bioguide_id:
            continue
        positions[bioguide_id] = {
            "vote": child_text(recorded_vote, "vote"),
            "name": clean_text(legislator.text),
            "state": legislator.get("state"),
            "district": normalize_district(legislator.get("district")),
        }

    return {
        "question": child_text(vote_metadata, "vote-question") or child_text(vote_metadata, "vote-desc"),
        "result": child_text(vote_metadata, "vote-result"),
        "measure": child_text(vote_metadata, "legis-num"),
        "actionDate": child_text(vote_metadata, "action-date"),
        "rollNumber": child_text(vote_metadata, "rollcall-num"),
        "positions": positions,
    }


@lru_cache(maxsize=256)
def parse_senate_vote(url: str) -> dict[str, Any]:
    root = fetch_xml(url)

    positions = []
    for node in root.iter():
        if local_name(node.tag) != "member":
            continue
        state = child_text(node, "state")
        vote_cast = child_text(node, "vote_cast") or child_text(node, "vote")
        if not state or not vote_cast:
            continue
        positions.append(
            {
                "state": state.upper(),
                "lastName": child_text(node, "last_name") or child_text(node, "lastName"),
                "firstName": child_text(node, "first_name") or child_text(node, "firstName"),
                "fullName": child_text(node, "member_full") or child_text(node, "memberFull"),
                "vote": vote_cast,
            }
        )

    return {
        "question": descendant_text(root, ("question", "vote_question", "vote_question_text")),
        "result": descendant_text(root, ("vote_result_text", "vote_result")),
        "measure": descendant_text(root, ("measure_number", "measure_num")),
        "actionDate": descendant_text(root, ("vote_date", "vote_datetime")),
        "rollNumber": descendant_text(root, ("vote_number", "vote_num")),
        "positions": positions,
    }


def normalize_name_token(value: str | None) -> str:
    return re.sub(r"[^a-z]", "", (value or "").lower())


def match_house_position(vote_data: dict[str, Any], member: dict[str, Any]) -> dict[str, Any] | None:
    bioguide_id = (member.get("bioguideId") or "").upper()
    if bioguide_id and bioguide_id in vote_data["positions"]:
        return vote_data["positions"][bioguide_id]

    target_last = normalize_name_token(member.get("lastName"))
    target_state = member.get("state")
    target_district = normalize_district(member.get("district"))

    for position in vote_data["positions"].values():
        if target_state and position.get("state") != target_state:
            continue
        position_district = normalize_district(position.get("district"))
        if target_district and position_district and position_district != target_district:
            continue
        if target_last and target_last in normalize_name_token(position.get("name")):
            return position
    return None


def match_senate_position(vote_data: dict[str, Any], member: dict[str, Any]) -> dict[str, Any] | None:
    target_state = (member.get("state") or "").upper()
    target_last = normalize_name_token(member.get("lastName"))
    target_first = normalize_name_token(member.get("firstName"))

    same_state = [position for position in vote_data["positions"] if position.get("state") == target_state]
    for position in same_state:
        if normalize_name_token(position.get("lastName")) == target_last:
            return position

    for position in same_state:
        full_name = normalize_name_token(position.get("fullName"))
        if target_last and target_last in full_name and (not target_first or target_first in full_name):
            return position

    return same_state[0] if len(same_state) == 1 else None


def build_member_trump_score(member: dict[str, Any]) -> dict[str, Any]:
    chamber = member.get("chamber")
    if is_house_chamber(chamber):
        chamber_label = "House"
    elif (chamber or "").lower() == "senate":
        chamber_label = "Senate"
    else:
        return {
            "score": None,
            "alignedVotes": 0,
            "votesConsidered": 0,
            "classification": "unavailable",
            "methodology": TRUMP_SCORE_METHODOLOGY_LABEL,
            "methodologyUrl": TRUMP_SCORE_METHODOLOGY_URL,
            "scope": "Current 119th Congress tracked floor votes where Trump publicly stated a position before the vote.",
            "sourceMode": "tracked_legislation",
            "trackedBills": [],
        }

    chamber_votes = [tracked_vote for tracked_vote in load_trump_score_vote_entries() if tracked_vote["chamber"] == chamber_label]
    aligned_votes = 0
    votes_considered = 0
    tracked_bills = []

    for tracked_vote in chamber_votes:
        if not tracked_vote.get("voteUrl"):
            continue

        if chamber_label == "House":
            feed = parse_house_vote(tracked_vote["voteUrl"])
            matched_position = match_house_position(feed, member)
            normalized_position = normalize_member_position(matched_position.get("vote") if matched_position else None)
        else:
            feed = parse_senate_vote(tracked_vote["voteUrl"])
            matched_position = match_senate_position(feed, member)
            normalized_position = normalize_member_position(matched_position.get("vote") if matched_position else None)

        aligned = False
        if normalized_position != "Not Voting":
            votes_considered += 1
            aligned = is_vote_aligned_with_trump(normalized_position, tracked_vote["trumpPosition"])
            if aligned:
                aligned_votes += 1

        tracked_bills.append(
            {
                "title": tracked_vote["title"],
                "billNumber": tracked_vote["billNumber"],
                "billType": tracked_vote["billType"],
                "position": normalized_position,
                "aligned": aligned,
                "chamber": chamber_label,
                "voteDate": tracked_vote.get("voteDate"),
                "rollNumber": tracked_vote.get("rollNumber"),
            }
        )

    participation_rate = (votes_considered / len(chamber_votes)) if chamber_votes else 0
    score = round((aligned_votes / votes_considered) * 100) if votes_considered and participation_rate > 0.5 else None
    return {
        "score": score,
        "alignedVotes": aligned_votes,
        "votesConsidered": votes_considered,
        "participationRate": round(participation_rate * 100) if chamber_votes else 0,
        "classification": classify_trump_score(score),
        "methodology": TRUMP_SCORE_METHODOLOGY_LABEL,
        "methodologyUrl": TRUMP_SCORE_METHODOLOGY_URL,
        "scope": "Current 119th Congress tracked floor votes where Trump publicly stated a position before the vote.",
        "sourceMode": "tracked_legislation",
        "trackedBills": tracked_bills,
    }


def build_bill_vote_payload(
    congress: int | None,
    bill_type: str,
    bill_number: str,
    state: str,
    district: str | None,
) -> dict[str, Any]:
    selected_bill = resolve_bill_summary(congress, bill_type.lower(), bill_number)

    representatives = fetch_representatives(state, district)
    votes = collect_bill_votes(selected_bill["congress"], bill_type.lower(), str(int(bill_number)))

    detailed_votes = []
    for vote in votes:
        chamber = infer_vote_chamber(vote.get("url"), vote.get("chamber"))
        if chamber == "House":
            feed = parse_house_vote(vote["url"])
            relevant_members = [member for member in representatives if is_house_chamber(member.get("chamber"))]
            mapped = []
            for member in relevant_members:
                served_in_context, had_congress_service = member_served_in_context(
                    member,
                    selected_bill["congress"],
                    "House",
                    state,
                    district,
                )
                if served_in_context:
                    position = match_house_position(feed, member)
                    normalized_position = normalize_member_position(position.get("vote") if position else None)
                    explanation = None
                else:
                    normalized_position = "Not In Office"
                    explanation = member_absence_message(member, selected_bill["congress"], "House", had_congress_service)
                mapped.append(
                    {
                        "memberId": member.get("bioguideId"),
                        "name": member.get("displayName") or member.get("listName"),
                        "roleLabel": member.get("roleLabel"),
                        "party": member.get("party"),
                        "trumpScore": member.get("trumpScore"),
                        "explanation": explanation,
                        "position": normalized_position,
                        "vote": normalized_position,
                    }
                )
        else:
            feed = parse_senate_vote(vote["url"])
            relevant_members = [member for member in representatives if (member.get("chamber") or "").lower() == "senate"]
            mapped = []
            for member in relevant_members:
                served_in_context, had_congress_service = member_served_in_context(
                    member,
                    selected_bill["congress"],
                    "Senate",
                    state,
                )
                if served_in_context:
                    position = match_senate_position(feed, member)
                    normalized_position = normalize_member_position(position.get("vote") if position else None)
                    explanation = None
                else:
                    normalized_position = "Not In Office"
                    explanation = member_absence_message(member, selected_bill["congress"], "Senate", had_congress_service)
                mapped.append(
                    {
                        "memberId": member.get("bioguideId"),
                        "name": member.get("displayName") or member.get("listName"),
                        "roleLabel": member.get("roleLabel"),
                        "party": member.get("party"),
                        "trumpScore": member.get("trumpScore"),
                        "explanation": explanation,
                        "position": normalized_position,
                        "vote": normalized_position,
                    }
                )

        detailed_votes.append(
            {
                "chamber": chamber,
                "rollNumber": vote.get("rollNumber") or feed.get("rollNumber"),
                "actionText": vote.get("actionText"),
                "voteDate": vote.get("voteDate") or feed.get("actionDate"),
                "question": feed.get("question"),
                "result": feed.get("result"),
                "measure": feed.get("measure"),
                "members": mapped,
                "positions": [{"name": member["name"], "position": member["position"]} for member in mapped],
                "sourceUrl": vote.get("url"),
            }
        )

    representatives.sort(key=lambda item: (item.get("chamber") != "Senate", item.get("displayName") or ""))
    return {
        "bill": selected_bill,
        "representatives": representatives,
        "votes": detailed_votes,
    }


# --- 5. FLASK ROUTES ---
def query_value(key: str) -> str:
    value = request.args.get(key, "").strip()
    if not value:
        raise ValueError(f"Missing required query parameter: {key}")
    return value


def optional_query_value(key: str) -> str | None:
    value = request.args.get(key, "").strip()
    return value or None


def error_status(error: Exception) -> int:
    if isinstance(error, ValueError):
        return 400
    if isinstance(error, RuntimeError):
        return 412
    if isinstance(error, (HTTPError, URLError)):
        return 502
    return 500


@app.get("/")
def index() -> Any:
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/billblaster-demo")
@app.get("/billblaster-demo/")
def billblaster_demo() -> Any:
    return send_from_directory(STATIC_DIR, "billblaster_demo.html")


@app.get("/api/config")
def api_config() -> Any:
    return jsonify(
        {
            "hasApiKey": bool(CONGRESS_API_KEY),
            "congress": CURRENT_CONGRESS,
            "supportedYears": sorted(SUPPORTED_YEARS),
            "states": [{"code": code, "name": name} for code, name in STATE_OPTIONS],
        }
    )


@app.get("/api/search-bills")
def api_search_bills() -> Any:
    try:
        featured_only = optional_query_value("featured")
        query = optional_query_value("q") or ""
        results = featured_laws() if (featured_only or "").lower() in {"1", "true", "yes"} else search_laws(query)
        return jsonify({"results": results})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), error_status(exc)


@app.get("/api/representatives")
def api_representatives() -> Any:
    try:
        payload = build_representatives_payload(
            state=optional_query_value("state"),
            district=optional_query_value("district"),
            zip_code=optional_query_value("zip"),
        )
        return jsonify(payload)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), error_status(exc)


@app.get("/api/bill-votes")
def api_bill_votes() -> Any:
    try:
        congress_value = optional_query_value("congress")
        bill_type = query_value("billType").lower()
        bill_number = query_value("billNumber")
        state = query_value("state").upper()
        district = optional_query_value("district")
        payload = build_bill_vote_payload(int(congress_value) if congress_value else None, bill_type, bill_number, state, district)
        return jsonify(payload)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), error_status(exc)


@app.get("/api/candidate/funding/<candidate_id>")
def api_candidate_funding(candidate_id: str) -> Any:
    try:
        return jsonify(build_candidate_funding_payload(candidate_id))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), error_status(exc)


def main() -> None:
    print(f"--- DEBUG: API Key found? {'YES' if CONGRESS_API_KEY else 'NO'} ---")
    print(f"Serving at http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()
