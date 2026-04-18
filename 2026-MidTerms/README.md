# 2026 MidTerms V1.0

Minimalist legislative tracker for the 2026 Midterms with a monochrome editorial UI and live congressional vote data.

## Stack

- Flask backend
- Vanilla JavaScript frontend
- Congress.gov API
- Gunicorn for production hosting

## Local Run

1. Create a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set your API key:

```bash
export CONGRESS_API_KEY=your_key_here
```

4. Start the app:

```bash
python3 server.py
```

Then open `http://127.0.0.1:8000`.

## Render Deployment

- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn server:app`

### Environment Variables

- `CONGRESS_API_KEY`

Do not commit your real API key to GitHub. Store it in Render under `Environment`.

## Notes

- The frontend is served from `static/`.
- The app includes featured bills plus searchable congressional vote history.
- House district input should use `0` for at-large districts.
