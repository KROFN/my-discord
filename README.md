# NetherCord / Discord Lite

Discord-style realtime chat prototype with Supabase auth, rooms, messages, presence and WebRTC voice experiments.

> **Status:** Prototype / experiment.  
> This project is kept public as a web app experiment, not as a production communication platform.

## What it does

The app explores a compact Discord-like interface with:

- email/password authentication through Supabase
- room list and room creation
- realtime text messages through Supabase subscriptions
- presence tracking for active room users
- WebRTC voice connection experiments
- screen sharing controls
- simple connection stats display
- dark chat-oriented UI

## Stack

- Next.js
- TypeScript
- React
- Tailwind CSS
- Supabase Auth / Realtime
- WebRTC browser APIs
- lucide-react

## Environment

The app expects Supabase public environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Run locally

```bash
npm install
npm run dev
```

or:

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

## Notes

This repository is mainly useful as a prototype for realtime app UI, Supabase-backed chat flows and browser voice/screen-sharing experiments.
