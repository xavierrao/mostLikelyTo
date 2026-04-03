# Most Likely To

A fun, real-time multiplayer game where players vote on "Who is most likely to..." questions, with a twist: one player gets a fake question, and others must guess who the imposter is. Questions are generated dynamically using AI (via Groq API) for uniqueness, with a fallback to a predefined pool in `questions.json`.

The game is built with Node.js, Express, Socket.io for real-time interactions, and React for the frontend. It's designed for casual group play among friends.

## Live Demo

Play the game at: [https://mostlikelyto.xavierrao.com/](https://mostlikelyto.xavierrao.com/)

*Note: Hosted on Render.com's free tier, which may have limitations like occasional cold starts (delays on first load) and resource constraints. If the site is slow or unresponsive, try refreshing after a minute.*

## Features

- **Multiplayer Support**: Create or join games using a unique game ID (tap to copy).
- **Dynamic Questions**: AI-generated questions for endless variety (requires Groq API key). Falls back to a static JSON file if API is unavailable.
- **Game Mechanics**:
  - Players vote on a main question.
  - One random player (the imposter) gets a different fake question — designed to be indistinguishable in tone from the real one.
  - All players, including the imposter, then guess who had the fake question.
  - The reveal shows who the imposter was, both questions, and all votes.
- **Real-Time Updates**: Votes, guesses, and reveals happen in real-time via WebSockets.
- **Scoring**:
  - If the majority correctly identifies the imposter, each correct guesser earns 1 point. The imposter earns nothing.
  - If the majority fails to identify the imposter, the imposter earns 1 point per incorrect guess.
  - The imposter cannot earn points from guessing themselves correctly.
- **Reconnection & Grace Period**: Players who disconnect, close the tab, navigate away, or click the home button are given a 15-second grace period to rejoin before being removed from the game.
- **Persistent Game URLs**: Each game has a unique URL (e.g. `/game/abc1234`). Refreshing or sharing the link lets players return to their game automatically.
- **Spectator Mode**: Players who join mid-round spectate until the next round begins, without disrupting the current game.
- **Owner Reassignment**: If the game owner leaves, the next player automatically becomes the new owner.
- **Responsive UI**: Mobile-friendly React interface.
- **Automatic Cleanup**: Inactive games are automatically deleted after 1 hour to prevent memory buildup.

## Prerequisites

- Node.js (v14 or higher recommended)
- A [Groq API key](https://console.groq.com/keys) for AI question generation (optional but recommended for better experience)

## Installation (Local Development)

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd mostLikelyTo
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   - Create a `.env` file in the root directory.
   - Add your Groq API key:
     ```bash
     GROQ_API_KEY=your_groq_api_key_here
     ```
   - If no API key is set, the game will use fallback questions from `questions.json`.

4. Start the server:
   ```bash
   node server.js
   ```

5. Open the game in your browser: [http://localhost:3000](http://localhost:3000)

> **Note**: Do not open `index.html` directly in a browser — it must be served over HTTP. Use `node server.js` or `npx serve public` for local development.

## Usage

1. **Create a Game**: Enter your name and click "Create Game" to generate a unique game ID. Tap the game ID badge to copy it to your clipboard.
2. **Join a Game**: Share the game ID or the full game URL with friends. They enter their name and the ID to join.
3. **Start Playing**:
   - The game owner starts the round.
   - Each player sees a question — one player secretly sees a different one.
   - Vote on who you think the question describes.
   - In the guess phase, vote on who you think had the fake question.
   - Scores are awarded and the imposter is revealed.
4. **Next Round**: The game owner advances to the next question. Any spectators are promoted to players at the start of each round.
5. **Leaving & Rejoining**: Closing the tab, navigating away, or clicking the home button gives you a 15-second window to return. Navigate back to the game URL or re-enter the game ID to rejoin. Your name is saved automatically.
6. **FAQ**: Visit `/faq` for a full how-to-play guide and frequently asked questions.

*Tip: Best experienced with 3+ players.*

## Project Structure

```
├── server.js          # Server, Socket.io events, game logic, AI question generation
├── public/
│   ├── index.html     # Frontend entry point
│   ├── faq.html       # FAQ & How to Play page (served at /faq)
│   ├── app.js         # React UI
│   └── styles.css     # Forest & Clay theme styles
├── questions.json     # Fallback question pool
├── package.json       # Dependencies and scripts
└── package-lock.json  # Exact dependency versions
```

## Dependencies

- **Express**: Web server
- **Socket.io**: Real-time communication
- **Axios**: API requests (for Groq)
- **String-similarity**: Duplicate question detection
- **React & React DOM**: Frontend (loaded via CDN)

See `package.json` for full list and versions.

## AI Question Generation

Questions are generated using the Groq API (`llama-3.3-70b-versatile`). The prompt enforces:
- Both questions start with "Who is most likely to"
- Both are equally plausible and tonally identical — neither should give away which is fake
- Themes rotate unpredictably across careers, travel, relationships, hobbies, food, sports, etc.
- A random seed and high temperature settings ensure variety across rounds

A similarity check (`string-similarity`) prevents near-duplicate questions from appearing. Generated questions are cached server-side for reuse across games.

## Deployment on Render.com

This project is deployed on Render.com as a Node.js web service. To deploy your own instance:

1. Create a free Render.com account.
2. New > Web Service > Build from Git repo.
3. Set build command: `npm install`
4. Set start command: `node server.js`
5. Add environment variable: `GROQ_API_KEY` with your key.
6. Deploy! Render will provide a URL like `your-service.onrender.com`.

> **Note**: Make sure your `server.js` includes a route for `/faq` — `app.get('/faq', (req, res) => res.sendFile('faq.html', { root: 'public' }))` — otherwise the FAQ page will return a 404.

*Free Tier Notes*: Sleeps after 15 minutes of inactivity, may take 30-60 seconds to wake. Upgrade for always-on.

## Troubleshooting

- **No Questions Loading**: Ensure `questions.json` is valid JSON. If using AI, check your Groq API key and quota.
- **Connection Issues**: Verify the server is running and ports are open (default: 3000).
- **Styles not loading**: Make sure you're accessing the app via `http://localhost:3000` and not opening `index.html` directly as a file.
- **Duplicate Questions**: The server uses string similarity checks and a global set to avoid repeats, but with heavy use it may fall back to the JSON pool.
- **Errors in Console**: Check for API rate limits or memory issues (free Render tier has limits).
- **Can't rejoin a game**: Your player name is saved in `localStorage` — make sure you're using the same browser. If the game expired (1 hour of inactivity) you'll be returned to the home screen.

## Contributing

Feel free to fork and submit pull requests! Ideas: add more fallback questions, improve the AI prompt for better variety, or add a formal end-game screen.

## License

This project is licensed under the ISC License. See `package.json` for details.