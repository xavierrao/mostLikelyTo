# Most Likely To Game

A fun, real-time multiplayer game where players vote on "Who is most likely to..." questions, with a twist: one player gets a fake (humorous or quirky) question, and others must guess who the imposter is. Questions are generated dynamically using AI (via Groq API) for uniqueness, with a fallback to a predefined pool in `questions.json`.

The game is built with Node.js, Express, Socket.io for real-time interactions, and React for the frontend. It's designed for casual group play among friends.

## Live Demo

Play the game at: [https://mostlikelyto.xavierrao.com/](https://mostlikelyto.xavierrao.com/)

*Note: Hosted on Render.com's free tier, which may have limitations like occasional cold starts (delays on first load) and resource constraints. If the site is slow or unresponsive, try refreshing after a minute.*

## Features

- **Multiplayer Support**: Create or join games using a unique game ID.
- **Dynamic Questions**: AI-generated questions for endless variety (requires Groq API key). Falls back to a static JSON file if API is unavailable.
- **Game Mechanics**:
  - Players vote on a main question.
  - One random player gets a "special" (fake) question.
  - Others guess who had the fake question to score points.
- **Real-Time Updates**: Votes, guesses, and reveals happen in real-time via WebSockets.
- **Scoring**: Points awarded based on correct guesses and successful imposters.
- **Responsive UI**: Simple React-based interface for voting and viewing game state.

## Prerequisites

- Node.js (v14 or higher recommended)
- A [Groq API key](https://console.groq.com/keys) for AI question generation (optional but recommended for better experience)

## Installation (Local Development)

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd most-likely-to-game
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
   npm start
   ```

5. Open the game in your browser: [http://localhost:3000](http://localhost:3000)

## Usage

1. **Create a Game**: Enter your name and click "Create Game" to generate a unique game ID.
2. **Join a Game**: Share the game ID with friends. They enter their name and the ID to join.
3. **Start Playing**:
   - The game owner starts the round.
   - Vote on the question displayed (or the special one if you're the imposter).
   - In the guess phase, non-imposters vote on who they think had the fake question.
   - Reveal scores and proceed to the next question.
4. **Ending the Game**: The game continues until players disconnect or the owner advances rounds. No formal "end" button—refresh or close the tab to leave.

*Tip: For best experience, play with 3+ players. Questions are designed to be positive/aspirational (main) or humorous/quirky (special).*

## Project Structure

- `server.js`: Main server file handling Socket.io events, game logic, and AI question generation.
- `app.js`: Client-side React application for the UI.
- `index.html`: Entry point for the frontend.
- `questions.json`: Fallback pool of predefined questions.
- `package.json`: Dependencies and scripts.
- `package-lock.json`: Lockfile specifying exact versions of dependencies and their sub-dependencies.
- `public/`: Static assets (served by Express).

## Dependencies

- Express: Web server
- Socket.io: Real-time communication
- Axios: API requests (for Groq)
- String-similarity: Duplicate question checking
- React & React DOM: Frontend (client-side)

See `package.json` for full list and versions.

## Deployment on Render.com

This project is deployed on Render.com as a Node.js web service. To deploy your own instance:

1. Create a free Render.com account.
2. New > Web Service > Build from Git repo.
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add environment variable: `GROQ_API_KEY` with your key.
6. Deploy! Render will provide a URL like `your-service.onrender.com`.

*Free Tier Notes*: Sleeps after 15 minutes of inactivity, may take 30-60 seconds to wake. Upgrade for always-on.

## Troubleshooting

- **No Questions Loading**: Ensure `questions.json` is valid JSON. If using AI, check your Groq API key and quota.
- **Connection Issues**: Verify the server is running and ports are open (default: 3000).
- **Duplicates in Questions**: The server uses string similarity checks and a global set to avoid repeats, but with heavy use, it may fall back to the JSON pool.
- **Errors in Console**: Check for API rate limits or memory issues (free Render tier has limits).

## Contributing

Feel free to fork and submit pull requests! Ideas: Add more fallback questions, improve UI, or enhance AI prompt for better variety.

## License

This project is licensed under the ISC License. See `package.json` for details.
