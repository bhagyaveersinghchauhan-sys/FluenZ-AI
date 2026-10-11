# FluenZ 🎙️

### Your AI-powered English speaking partner

**FluenZ** is a voice-first English-learning application designed to help Hindi-speaking beginners build confidence in spoken English through real-time AI conversations, contextual vocabulary support, bilingual explanations, and personalized practice.

Instead of simply memorizing vocabulary, learners practise speaking in everyday situations such as ordering at a café, shopping, introducing themselves, and asking for directions.

---

## ✨ Features

- **🎙️ Real-Time Voice Practice** — Speak with an AI tutor using LiveKit's browser SDK and Python Agents.
- **🌐 English & Hindi Support** — Choose your interface language. In Hindi mode, the tutor explains concepts in English first, followed by a concise Hindi explanation.
- **💬 Live Subtitles** — View subtitles based on finalized tutor speech transcripts.
- **📚 Dynamic Vocabulary Assistance** — Discover useful words with contextual meanings and automatically appearing vocabulary cards.
- **🗣️ Fluency Coaching** — Receive supportive prompts when you pause while forming a sentence.
- **🎯 Scenario-Based Learning** — Practise café conversations, shopping, self-introductions, directions, and custom situations.
- **💡 Multiple Speaking Prompts** — Choose from several prompts instead of practising only one fixed sentence.
- **📈 Personalized Progress** — Review completed practice sessions, difficult vocabulary, hesitation events, and learning history.
- **🔥 Daily Streaks** — Track your practice consistency.
- **👤 Guest Mode** — Practise without creating an account; guest progress is stored locally.
- **☁️ Optional Cloud Sync** — Supabase Auth and PostgreSQL support account-based progress synchronization with row-level security.
- **🔒 Privacy-Conscious Design** — Learning summaries are stored without retaining raw audio or full transcripts.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS |
| Voice & Real-Time Communication | LiveKit Browser SDK |
| AI Agent | Python, LiveKit Agents |
| Backend API | FastAPI |
| Speech Recognition | LiveKit Inference STT |
| Language Model | LiveKit Inference LLM |
| Text-to-Speech | LiveKit Inference TTS |
| Authentication | Supabase Auth (optional) |
| Database | Supabase PostgreSQL |
| Database Security | Row Level Security (RLS) |
| Testing | Pytest, frontend linting, type checking, and build tests |

---

## 🏗️ Project Architecture

```text
FluenZ/
├── apps/
│   └── web/                  # React + Vite frontend
├── services/
│   └── agent/
│       ├── fluenz_api/       # FastAPI session and health APIs
│       └── agent.py          # LiveKit voice agent
├── contracts/
│   └── events.md             # Browser-agent event protocol
└── supabase/
    ├── migrations/           # Database schema and RLS policies
    └── tests/                # Database isolation tests
```

### How FluenZ Works

1. **Choose a language:** Select English or Hindi for the interface.
2. **Choose a scenario:** Select a real-life situation or create a custom one.
3. **Start speaking:** The frontend connects to the LiveKit voice agent.
4. **Learn in context:** The AI tutor guides the conversation, provides explanations, and supports vocabulary learning.
5. **Improve fluency:** The coach can detect significant pauses and offer help when a thought appears unfinished.
6. **Track progress:** Completed lessons and learning records are saved locally or synchronized to Supabase when configured.

---

## ⚙️ Prerequisites

Install the following before running the project:

- Windows with PowerShell (commands below are Windows-oriented).
- **Node.js 20.19+** and npm.
- **Python 3.10+**.
- A configured LiveKit Cloud project with Agents and the required Inference speech-to-text, language-model, and text-to-speech models enabled.
- A Supabase project for optional authentication and cloud progress synchronization.

LiveKit model availability and billing depend on your project configuration.

---

## 🚀 Installation & Setup

### 1. Clone the repository

```powershell
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd <YOUR_REPOSITORY_FOLDER>
```

Replace the placeholders with your repository URL and folder name.

### 2. Configure environment files

Run these commands from the repository root:

```powershell
Copy-Item .\services\agent\.env.example .\services\agent\.env
Copy-Item .\apps\web\.env.example .\apps\web\.env.local
```

Fill in the required values privately in the local environment files. **Never commit credentials or secret keys to GitHub.**

### 3. Set up the Python backend

```powershell
Set-Location .\services\agent

py -3 -m venv .venv

.\.venv\Scripts\python.exe -m pip install -e '.[test]'

Set-Location ..\..
```

Configure these server-side settings in `services\agent\.env`:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- The required LiveKit model and voice settings.
- `CORS_ORIGINS`
- Any other settings required by the provided environment template.

Do not place LiveKit API secrets in frontend variables.

### 4. Set up the frontend

```powershell
Set-Location .\apps\web

npm ci

Set-Location ..\..
```

### 5. Configure optional Supabase

In `apps\web\.env.local`, configure:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_public_anon_or_publishable_key
```

These frontend values are public configuration, not secrets. **Never use a Supabase service-role key in the browser.**

Apply the versioned migrations in `supabase/migrations/` in timestamp order. Configure email/password authentication and the appropriate local application URL.

Without Supabase configuration, the application can remain usable in guest mode.

---

## ▶️ Running FluenZ Locally

Start the following processes in **three separate PowerShell terminals**, from the repository root.

### Terminal 1 — FastAPI backend

```powershell
Set-Location .\services\agent

.\.venv\Scripts\python.exe -m uvicorn fluenz_api.main:app --reload --port 8000
```

Health endpoint:

[http://localhost:8000/health](http://localhost:8000/health)

### Terminal 2 — LiveKit Agent

```powershell
Set-Location .\services\agent

.\.venv\Scripts\python.exe agent.py dev
```

### Terminal 3 — React frontend

```powershell
Set-Location .\apps\web

npm run dev
```

Open the Vite development URL shown in the terminal, normally:

[http://localhost:5173](http://localhost:5173)

Allow microphone access when prompted to begin voice practice.

---

## 🧪 Running Tests

### Frontend checks

```powershell
Set-Location .\apps\web

npm run lint
npm run typecheck
npm test
npm run build
```

### Backend tests

```powershell
Set-Location .\services\agent

.\.venv\Scripts\python.exe -m pytest -q
```

### Supabase database tests

For database isolation tests, start a disposable local Supabase environment and run the tests from the `supabase` directory:

```powershell
Set-Location .\supabase

supabase start
supabase test db
```

Do not run fixture-based database tests against production data.

Unit tests do not guarantee that LiveKit inference models, microphone access, or hosted Supabase synchronization will work end to end. Verify these separately before a live demo.

---

## 🎬 Demo Workflow

1. Open the web app and choose English or Hindi.
2. Select a scenario, such as café ordering or shopping.
3. Choose a speaking prompt and start a voice session.
4. Listen to the tutor and respond through your microphone.
5. Use vocabulary cards, subtitles, and fluency hints to support your speaking.
6. Complete the lesson and review your saved progress.

If voice connectivity is unavailable, do not present simulated responses as a working live AI session. Check the health endpoint, LiveKit Agent process, model access, network, and browser microphone permissions.

---

## 🔐 Security & Privacy

- LiveKit API credentials remain on the server.
- Supabase handles authentication and password verification.
- User progress is associated with authenticated user IDs.
- Row Level Security restricts access to user-owned database records.
- Raw audio and full transcripts are not retained as learning history by this demo.
- Guest progress remains local to the browser.
- Cloud synchronization is best-effort and should not prevent normal voice practice.

Before public deployment, verify the database policies with at least two separate authenticated test users and rotate any credentials that may previously have been exposed.

---

## 🗺️ Roadmap

Potential future improvements include:

- More everyday conversation scenarios.
- Better personalized revision for difficult words and sentences.
- Expanded pronunciation feedback when reliable speech assessment is available.
- More detailed progress insights based on measured speaking data.
- Additional regional-language explanations.
- Improved accessibility and mobile experience.

---

## 🤝 Contributing

Contributions, bug reports, and suggestions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make focused changes and add relevant tests.
4. Run the project checks.
5. Open a pull request describing the change.

Never include `.env` files, API credentials, access tokens, or private user data in commits.

---

## 📄 License

Add your chosen open-source license before distributing the project publicly.

---

**FluenZ — Practise speaking. Build confidence. Find your voice.**
