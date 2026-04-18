# Civic Votes Search Prototype

This is a small Python + vanilla JavaScript prototype for searching 2025-2026 laws from the 119th Congress and showing how a user's senators and House member voted on those measures.

## What it does

- Searches enacted 119th Congress laws by title, bill number, or public law number.
- Looks up the user's delegation from the official Congress.gov member API.
- Pulls passage-related House and Senate roll calls from the official Clerk of the House and Senate vote feeds.
- Renders a simple frontend with result cards, delegation cards, and vote cards.

## Data sources

- Congress.gov API for laws, bill actions, and member lookups
- Clerk of the House XML roll-call feed
- Senate.gov XML roll-call feed

## Setup

1. Get a free Congress.gov API key: https://api.congress.gov/sign-up/
2. Run the server with the key in your environment:

```bash
CONGRESS_API_KEY=your_key_here python3 server.py
```

3. Open `http://127.0.0.1:8000`

## Notes

- This version focuses on the 119th Congress, which covers 2025 and 2026.
- The UI expects a state and House district. For at-large districts, use `0`.
- The bill search is intentionally scoped to enacted laws so the results stay fast and easy to understand.
