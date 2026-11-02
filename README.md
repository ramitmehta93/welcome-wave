# Welcome Wave

A tiny Twitch raid game: when a raid arrives, chat gets 30 seconds to send `!welcome`. Each chatter counts once. Complete the wave to reveal a shared mascot souvenir on the stream overlay.

## Run the demo

Requires Node.js 20 or newer.

1. Run `npm start` in this folder.
2. Open [http://localhost:3000](http://localhost:3000).
3. Click **Simulate a raid**, then use the demo chat box to send `!welcome` as different chatter names.
4. Open [http://localhost:3000/overlay](http://localhost:3000/overlay) in OBS as a Browser Source.

The target scales gently with the raid size and is capped at eight distinct chatters. For tiny raids, one welcome can complete the wave; repeated messages from the same chatter do not count again. The overlay shows a partial mascot if time runs out, so small communities still get a souvenir.

## Twitch connection

Create a Twitch application, copy `.env.example` to `.env`, fill in the client ID and secret, and set `http://localhost:3000/auth/callback` as its OAuth redirect URL. Start the server and select **Connect Twitch**. The local app uses EventSub WebSocket for incoming raids and chat. Chat sending is not required for the game.

## How Codex was used

Codex session ID: `01a187a6-0a5b-7d03-9cb6-9721497d9de2`

- Built a local Node server with the control page, overlay routes, JSON APIs, and live updates (`src/server.mjs`).
- Added Twitch OAuth, token refresh, and EventSub subscriptions for raids and chat messages (`src/server.mjs`).
- Implemented the 30-second welcome round, raid-size goal scaling, and one counted welcome per chatter (`src/server.mjs`).
- Added overlapping-raid merging, souvenir clearing, EventSub reconnect handling, and 400 responses for malformed JSON (`src/server.mjs`).
- Built the control page with the raid simulator, dynamic goal preview, demo chat, and exact `!welcome` validation (`public/control.html`, `public/control.js`).
- Built the OBS overlay with live progress, a countdown, and the Welcome Wisp mascot (`public/overlay.html`, `public/overlay.js`, `public/style.css`).
- Added setup instructions and an environment-variable template for Twitch credentials (`README.md`, `.env.example`).
