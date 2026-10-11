# FluenZ

FluenZ is a voice-first English-learning demo for Hindi-speaking beginners. The web app uses the official LiveKit browser SDK; FastAPI issues a short-lived, room-scoped token and dispatches the Python LiveKit Agent. The core lesson uses LiveKit Inference for speech recognition, language generation, and speech synthesis. Guest progress is stored locally; optional Supabase Auth and PostgreSQL synchronize progress under row-level security.

## Project layout

- `apps/web/`: React, Vite, strict TypeScript, Tailwind CSS, LiveKit client, and optional Supabase Auth/progress.
- `services/agent/`: FastAPI health/session-token API and the Python LiveKit Agent.
- `contracts/events.md`: validated browser/agent lesson event protocol.
- `supabase/migrations/`: user-owned profile and lesson progress schema with RLS.
- `supabase/tests/`: pgTAP checks for cross-user isolation.

## Requirements

- Windows PowerShell, Node.js 20.19+ and npm.
- Python 3.10+.
- A LiveKit Cloud project with Agents and the configured LiveKit Inference STT, LLM, and TTS models enabled. Model IDs and billing availability are project-dependent; credentials alone do not establish model access.
- A Supabase project is optional and only required for cloud accounts/progress.

The project was checked against `livekit-agents` 1.8.6, `livekit-api` 1.2.1, and browser packages `livekit-client` 2.22.4 and `@livekit/components-react` 2.9.24. Dependency lockfiles pin the frontend graph. The Python constraints permit compatible updates; the tested versions above are recorded here for reproducibility.

## Setup (PowerShell)

Run these commands from the repository root. Create local environment files from the templates and fill them in privately:

```powershell
Copy-Item .\services\agent\.env.example .\services\agent\.env
Copy-Item .\apps\web\.env.example .\apps\web\.env.local

Set-Location .\services\agent
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.[test]'
Set-Location ..\..

Set-Location .\apps\web
npm ci
Set-Location ..\..
```

Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` only in `services\agent\.env`. The API key and secret previously exposed in chat and the original environment template must be revoked and replaced before live use. Never add credentials to source control or put them in any `VITE_*` variable. The checked-in environment template contains placeholders only. The Python settings loader reads `services\agent\.env` using an absolute path derived from the settings module, independent of the current terminal directory. The agent uses the same server-side settings and configured `LIVEKIT_*_MODEL`/`LIVEKIT_TTS_VOICE` values. Confirm all three model integrations are enabled in the LiveKit project.

`CORS_ORIGINS` in `services\agent\.env` must be a comma-separated list of explicit web origins, such as `http://localhost:5173`; wildcards and paths are rejected. `LIVEKIT_TOKEN_TTL_SECONDS` must be 60–900 seconds.

For optional Supabase, put only the project URL and public publishable/anon key in `apps\web\.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These values are public in a browser build. Never configure a service-role key in the frontend. The app remains usable in guest mode if Supabase is absent.

Apply both versioned migrations under `supabase\migrations\` in timestamp order. The second adds the user's display name and owner-scoped completed-practice history, with an authenticated RPC that derives ownership from `auth.uid()` and deduplicates completion by session ID. Browser clients cannot directly insert or update session/aggregate progress rows. When guest progress is imported, session records merge by UUID and legacy aggregate-only XP/count values use the maximum rather than addition to avoid double-counting unknown overlap; cloud/local snapshots also de-duplicate by UUID and choose streak data from the latest activity date. Configure Supabase Auth email/password sign-in and allow `http://localhost:5173` as an application URL. To apply migrations to a linked hosted project, install the Supabase CLI, then run `supabase link --project-ref <project-ref>` and `supabase db push` from `supabase\`. To run the database RLS tests, start a disposable local database with `supabase start` from `supabase\`, then run `supabase test db` from the same directory. The tests create fixture users and roll back their data; never run them against a production database. No live Supabase project or second-user RLS verification is bundled with this demo.

## Run locally

Start each process in a separate PowerShell terminal from the repository root:

**Terminal 1 — FastAPI:**

```powershell
Set-Location .\services\agent
.\.venv\Scripts\python.exe -m uvicorn fluenz_api.main:app --reload --port 8000
```

**Terminal 2 — LiveKit Agent:**

```powershell
Set-Location .\services\agent
.\.venv\Scripts\python.exe agent.py dev
```

**Terminal 3 — web app:**

```powershell
Set-Location .\apps\web
npm run dev
```

Open the Vite URL shown in Terminal 3 (normally `http://localhost:5173`). The browser requests microphone permission when a voice session starts. `GET http://localhost:8000/` returns the API name and a pointer to `/health`; it is not the health check. `GET http://localhost:8000/health` reports missing LiveKit setting names without values, or makes a bounded LiveKit API request to verify connectivity. A healthy result means the LiveKit management API responded; it does not verify that the tutor agent is running, inference models are entitled, or an end-to-end voice session succeeds.

On first use, learners choose English or Hindi for the interface, then select a cafe, shop, introduction, directions, or custom conversation and choose from several speaking prompts. The target phrase stays hidden in the picker until the learner asks to see an example; the tutor still speaks its target during the real lesson. Custom situations are limited to 200 characters. In Hindi mode, tutor turns are instructed to say the English teaching line first, give a concise Hindi explanation, then return to English practice. Tutor subtitles use finalized LiveKit transcript segments from the agent, not UI-generated guesses; Hindi/English labels are inferred from the transcript's writing system. During voice practice, finalized speech may also produce up to three short vocabulary cards from the session's existing LLM. The coach uses only a small recent user/assistant text window and excludes system instructions; cards are validated, make no pronunciation claims, and fade after about five seconds. Fluency coaching watches the existing LiveKit speech/transcription state, waits 1.5 seconds by default, and asks the same configured LLM whether a thought is unfinished before it counts a hesitation or speaks a short prompt. Set `FLUENCY_PAUSE_THRESHOLD_SECONDS` (0.5–5 seconds) to adjust that wait. The learner can interrupt a hint by speaking again. A tutor/model failure does not change lesson scoring or block the normal conversation. Transcript acceptance is not pronunciation scoring. Only genuinely completed lessons are saved; retries and detected hesitation counts are retained, along with session-linked vocabulary terms and available meanings, while raw audio and full transcripts are not saved. Response time and speaking duration are not yet measured reliably, so the dashboard does not report them or claim improvement. Guest progress remains local; signed-in sync is best-effort and does not keep the voice lesson dependent on the database.

The API limits new session requests to 10 per minute per direct client address within that API process; it does not trust forwarded-IP headers. This is a lightweight expo safeguard, not a distributed production rate limiter (clients behind one proxy share its limit); use an edge/API gateway limit before public deployment.

## Checks

From the repository root:

```powershell
Set-Location .\apps\web
npm run lint
npm run typecheck
npm test
npm run build
```

```powershell
Set-Location .\services\agent
.\.venv\Scripts\python.exe -m pytest
```

Unit tests do not make real LiveKit or Supabase connections. The API token test validates signed token claims locally; it is not a Cloud join test. Complete a real smoke test only after using newly rotated credentials, confirming model access, running both backend processes, and speaking through a microphone-enabled browser. Confirm Supabase RLS with two authenticated test users before enabling cloud sync for real learners.

## Two-minute demo sequence

1. Open the Vite app, choose English or Hindi for the interface, and select a practice scenario.
2. Select **Start speaking practice** and grant microphone permission. Follow the tutor's spoken prompts.
3. Repeat the exact target sentence shown by the tutor. If the transcript is unclear, try again; matching words does not score pronunciation.
4. Finish both speaking challenges, then show the updated progress and daily streak.

For a recovery, check `http://localhost:8000/health`, confirm the agent is running in Terminal 2, check browser microphone permission and network access, then use the in-app retry to create a fresh session. If LiveKit/model access or the network is unavailable, do not present a mock or claim the live journey works: show the local progress screen and explain that voice is unavailable until connectivity is restored. Guest progress remains on the same browser.

To reset the guest demo between rehearsals, open the browser developer console on the app origin and run `localStorage.removeItem('fluenz-progress-v1:guest'); location.reload();`. This only clears guest progress on that browser; use guest mode so no cloud account data is affected.

## Lesson event protocol

See `contracts/events.md` for the versioned, validated JSON data-packet topics and shapes. Events carry lesson phase/outcome/attempt only; they do not contain raw audio or transcript text. Replay uses fixed text-to-speech and does not invoke the language model.
#   F l u e n Z - A I  
 