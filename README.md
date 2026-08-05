# CrelioHealth Flow

Internal Escalation Tracking Tool for CS and Product teams.

## Quick Start

### 1. Supabase Setup

1. Go to [supabase.com](https://supabase.com) and create a new project (free tier).
2. Once the project is ready, go to **SQL Editor** and run:
   - First: `supabase/migrations/001_schema.sql` (creates tables, enums, RLS policies)
   - Then: `supabase/migrations/002_seed_data.sql` (creates the auto-signup trigger)

3. Go to **Authentication > Settings**:
   - Under "Email Auth", **disable** "Confirm email" (for testing — users can sign in immediately).
   - This is important for local testing with the test accounts.

4. Copy your project credentials from **Settings > API**:
   - Project URL
   - anon/public key

### 2. Environment Variables

Create a `.env` file in the project root:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### 4. Create Test Users

Sign up via the app with these accounts:

| Email | Name | Role |
|-------|------|------|
| csm1@iett.local | CS Manager 1 | CS Manager |
| csm2@iett.local | CS Manager 2 | CS Manager |
| csm3@iett.local | CS Manager 3 | CS Manager |
| cslead@iett.local | CS Lead | CS Lead |
| prodlead@iett.local | Product Lead | Product Lead |

Password for all: `Test1234!`

The auto-trigger will create the app_users profile automatically on signup.

### 5. Deploy to Vercel

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. Done.

## Architecture

- **Frontend:** React + TypeScript + Tailwind CSS + Vite
- **Backend:** Supabase (Postgres + Auth + RLS)
- **State Machine:** Application-layer enforced transitions
- **Audit Log:** Immutable update_logs table (no UPDATE/DELETE policies)

## Roles

| Role | Can Do |
|------|--------|
| CS Manager | Create tickets, view everything |
| CS Lead | All CS Manager + Solve Internally, Escalate to Product |
| Product Lead | Accept into Scope, Put on Hold, Post Update, Mark Completed |
