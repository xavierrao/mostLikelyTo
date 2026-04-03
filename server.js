const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const axios = require('axios');
const os = require('os');
const stringSimilarity = require('string-similarity');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));
app.get('/app.js', (req, res) => {
    console.log(`Serving app.js from: public/app.js`);
    res.sendFile('app.js', { root: 'public' }, (err) => {
        if (err) {
            console.error(`Error serving app.js: ${err}`);
            res.status(404).send('app.js not found');
        }
    });
});
app.get('/', (req, res) => {
    console.log(`Serving index.html`);
    res.sendFile('index.html', { root: 'public' });
});
app.get('/faq', (req, res) => {
    res.sendFile('faq.html', { root: 'public' });
});
app.get('/game/:gameId', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
});

const games = {};
const gameTimeouts = {};
const disconnectTimers = {}; // grace-period timers keyed by "gameId:playerName"
const GAME_TIMEOUT_MS = 60 * 60 * 1000;
const DISCONNECT_GRACE_MS = 15 * 1000; // 15s to reconnect before being removed

function resetGameTimeout(gameId) {
    if (gameTimeouts[gameId]) clearTimeout(gameTimeouts[gameId]);
    gameTimeouts[gameId] = setTimeout(() => {
        console.log(`Game ${gameId}: Deleting due to inactivity`);
        io.to(gameId).emit('gameExpired');
        delete games[gameId];
        delete gameTimeouts[gameId];
    }, GAME_TIMEOUT_MS);
}

let questionPool = [];
try {
    const data = fs.readFileSync('questions.json', 'utf8');
    questionPool = JSON.parse(data);
    console.log(`Loaded ${questionPool.length} questions from questions.json`);
} catch (err) {
    console.error('Error loading questions.json:', err.message);
    questionPool = [];
}

const getExampleQuestions = () => {
    if (questionPool.length === 0) return [];
    const shuffled = [...questionPool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(3, questionPool.length)).map(q => ({
        question: q.question,
        specialQuestion: q.specialQuestion
    }));
};

const fallbackQuestions = [
    { question: "Who is the most likely to become a famous inventor?", specialQuestion: "Who is the most likely to forget their own birthday?" },
    { question: "Who is the most likely to win a marathon?", specialQuestion: "Who is the most likely to trip over their own shoelaces?" },
    { question: "Who is the most likely to start a successful company?", specialQuestion: "Who is the most likely to lose their keys in their own house?" }
];

function generateGameId() {
    return Math.random().toString(36).substring(2, 9);
}

// Global set and cache for questions across all games
const globalUsedQuestions = new Set();
const questionCache = []; // Cache to store unique questions

async function selectQuestion(gameId) {
    const game = games[gameId];
    if (!game) {
        console.error(`Game ${gameId} not found`);
        return null;
    }

    if (!process.env.GROQ_API_KEY) {
        console.error(`Game ${gameId}: GROQ_API_KEY environment variable is not set`);
        return selectFromQuestionPool(gameId, game);
    }

    const usedQuestions = game.usedQuestions || new Set();
    game.usedQuestions = usedQuestions;
    const maxRetries = 10; // Increased for more attempts at unique questions

    console.log(`Game ${gameId}: Free memory: ${os.freemem() / 1024 / 1024} MB, Total memory: ${os.totalmem() / 1024 / 1024} MB`);

    // Check cache for unique questions
    while (questionCache.length > 0) {
        const cachedQuestion = questionCache.shift();
        const questionKey = `${cachedQuestion.question}|${cachedQuestion.specialQuestion}`;
        if (!usedQuestions.has(questionKey) && !globalUsedQuestions.has(questionKey)) {
            usedQuestions.add(questionKey);
            globalUsedQuestions.add(questionKey);
            console.log(`Game ${gameId}: Used cached question: ${cachedQuestion.question}`);
            return cachedQuestion;
        }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const timestamp = Date.now();
            const randomSeed = `${timestamp}-${Math.random().toString(36).substring(2)}`; // Enhanced random seed
            const examples = getExampleQuestions();
            const exampleText = examples
                .sort(() => Math.random() - 0.5) // Shuffle examples for variety
                .map((ex, i) => `Example ${i + 1}: {"question": "${ex.question}", "specialQuestion": "${ex.specialQuestion}"}`)
                .join('\n');

            const prompt = `
                You are a creative party game question generator. Your job is to produce ONE unique JSON object per call.

                Return ONLY a valid JSON object with exactly two fields: "question" and "specialQuestion".

                Rules for BOTH "question" and "specialQuestion":
                - Must start with "Who is most likely to"
                - Must be equally plausible, interesting, and socially engaging
                - Cover a wide range of themes: career achievements, travel, relationships, hobbies, talents, life milestones, fame, sports, food, technology, nature, art — rotate unpredictably
                - Neither should be obviously funnier, sillier, or more serious than the other — a person seeing both without labels should have no idea which is which
                - Must be thematically unrelated to each other to avoid giving either away

                Do NOT output markdown, backticks, code blocks, comments, or any text outside the JSON object.
                Do NOT repeat themes or phrasings you have used before in this session.
                If you cannot comply, return {}.

                Examples of good question pairs:
                ${exampleText}

                Random seed for uniqueness: ${randomSeed}
            `;

            console.log(`Game ${gameId}: Prompt sent to Groq API (attempt ${attempt}):`, prompt);

            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 500,
                    temperature: 1.2,
                    top_p: 1.0,
                    frequency_penalty: 0.5,
                    presence_penalty: 0.5
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            let responseText = response.data.choices[0]?.message?.content || '{}';
            console.log(`Game ${gameId}: Raw response:`, responseText);

            // Strip Markdown code blocks
            responseText = responseText.replace(/```json\n|```\n/g, '').trim();
            console.log(`Game ${gameId}: Cleaned response:`, responseText);

            if (responseText.includes("I'm not sure") || responseText.includes("Could you explain")) {
                console.error(`Game ${gameId}: API returned conversational response: ${responseText} (attempt ${attempt})`);
                continue;
            }

            if (responseText === '{}' || !responseText.trim()) {
                console.error(`Game ${gameId}: Empty or invalid response from Groq API (attempt ${attempt})`);
                continue;
            }

            let questionData;
            try {
                questionData = JSON.parse(responseText);
                if (!questionData.question || !questionData.specialQuestion) {
                    throw new Error('Missing required fields in JSON');
                }
                if (!questionData.question.startsWith('Who is most likely to') || !questionData.specialQuestion.startsWith('Who is most likely to')) {
                    throw new Error('Questions do not follow required "Who is most likely to..." format');
                }
            } catch (parseError) {
                console.error(`Game ${gameId}: JSON parse error: ${parseError.message}`);
                continue;
            }

            const questionKey = `${questionData.question}|${questionData.specialQuestion}`;

            // Check for exact duplicates
            if (usedQuestions.has(questionKey) || globalUsedQuestions.has(questionKey)) {
                console.log(`Game ${gameId}: Generated question is an exact duplicate, retrying (${attempt}/${maxRetries})`);
                continue;
            }

            // Check for similar questions (using string-similarity)
            let isSimilar = false;
            for (const existingKey of globalUsedQuestions) {
                const [existingQuestion, existingSpecial] = existingKey.split('|');
                const qSimilarity = stringSimilarity.compareTwoStrings(questionData.question, existingQuestion);
                const sSimilarity = stringSimilarity.compareTwoStrings(questionData.specialQuestion, existingSpecial);
                if (qSimilarity > 0.7 || sSimilarity > 0.7) { // Threshold for similarity (adjust as needed)
                    isSimilar = true;
                    console.log(`Game ${gameId}: Generated question is too similar to existing (${existingKey}), similarity scores: Q=${qSimilarity}, S=${sSimilarity}. Retrying (${attempt}/${maxRetries})`);
                    break;
                }
            }

            if (isSimilar) {
                continue;
            }

            // Add to cache for future rounds
            questionCache.push(questionData);
            usedQuestions.add(questionKey);
            globalUsedQuestions.add(questionKey);
            console.log(`Game ${gameId}: Generated question: ${questionData.question}, Special question: ${questionData.specialQuestion}`);
            return questionData;
        } catch (error) {
            console.error(`Game ${gameId}: Error generating question with Groq API (attempt ${attempt}):`, {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
        }
    }

    // Fallback to questions.json
    return selectFromQuestionPool(gameId, game);
}

function selectFromQuestionPool(gameId, game) {
    const usedQuestions = game.usedQuestions || new Set();
    const availableQuestions = questionPool.filter(
        q => !usedQuestions.has(`${q.question}|${q.specialQuestion}`) && !globalUsedQuestions.has(`${q.question}|${q.specialQuestion}`)
    );

    if (availableQuestions.length === 0) {
        const availableFallbacks = fallbackQuestions.filter(
            q => !usedQuestions.has(`${q.question}|${q.specialQuestion}`) && !globalUsedQuestions.has(`${q.question}|${q.specialQuestion}`)
        );
        if (availableFallbacks.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableFallbacks.length);
            const selectedQuestion = availableFallbacks[randomIndex];
            const questionKey = `${selectedQuestion.question}|${selectedQuestion.specialQuestion}`;
            usedQuestions.add(questionKey);
            globalUsedQuestions.add(questionKey);
            console.log(`Game ${gameId}: Using fallback question: ${selectedQuestion.question}`);
            return selectedQuestion;
        }
        console.log(`Game ${gameId}: No more unique questions available`);
        io.to(gameId).emit('gameState', { ...game, noMoreQuestions: true });
        return null;
    }

    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    const selectedQuestion = availableQuestions[randomIndex];
    const questionKey = `${selectedQuestion.question}|${selectedQuestion.specialQuestion}`;
    usedQuestions.add(questionKey);
    globalUsedQuestions.add(questionKey);
    console.log(`Game ${gameId}: Selected question from pool: ${selectedQuestion.question}`);
    return selectedQuestion;
}

// Broadcast current game state to all active (non-spectator) players in the room,
// sending each player their personalised isSpecialPlayer flag.
function broadcastGameState(gameId) {
    const game = games[gameId];
    if (!game) return;
    const everyone = [...game.players, ...game.spectators];
    everyone.forEach(player => {
        const playerSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.playerName === player && s.rooms.has(gameId));
        if (playerSocket) {
            playerSocket.emit('gameState', {
                ...game,
                gameId,
                isSpecialPlayer: player === game.specialPlayer,
                // Only reveal specialPlayer identity during finalReveal
                specialPlayer: game.state === 'finalReveal' ? game.specialPlayer : null
            });
        }
    });
}

// Check if all active players have voted/guessed and advance the phase if so.
// "active" means in game.players (not spectators) and not in the grace-period queue.
function checkVoteCompletion(gameId) {
    const game = games[gameId];
    if (!game) return;

    if (game.state === 'question') {
        const activeVotes = Object.keys(game.votes).filter(p => game.players.includes(p));
        if (activeVotes.length === game.players.length) {
            game.state = 'guessFake';
            game.guessVotes = {};
            broadcastGameState(gameId);
        }
    } else if (game.state === 'guessFake') {
        const activeGuesses = Object.keys(game.guessVotes).filter(p => game.players.includes(p));
        if (activeGuesses.length === game.players.length) {
            resolveRound(gameId);
        }
    }
}

// Tally scores and move to finalReveal.
function resolveRound(gameId) {
    const game = games[gameId];
    if (!game) return;

    const votesForImposter = Object.keys(game.guessVotes)
        .filter(p => game.players.includes(p) && game.guessVotes[p] === game.specialPlayer);
    const otherPlayers = game.players.filter(p => p !== game.specialPlayer);
    const majorityGuessedImposter = votesForImposter.length >= Math.ceil(otherPlayers.length / 2);

    if (majorityGuessedImposter) {
        votesForImposter
            .filter(voter => voter !== game.specialPlayer)
            .forEach(voter => { game.points[voter] = (game.points[voter] || 0) + 1; });
    } else {
        const nonVoters = game.players.filter(p => game.guessVotes[p] !== game.specialPlayer);
        if (game.players.includes(game.specialPlayer)) {
            game.points[game.specialPlayer] = (game.points[game.specialPlayer] || 0) + nonVoters.length;
        }
    }

    game.players.sort((a, b) => (game.points[b] || 0) - (game.points[a] || 0));
    game.state = 'finalReveal';
    broadcastGameState(gameId);
}

// Remove a player from a game immediately, handling all side effects.
function removePlayerFromGame(gameId, playerName) {
    const g = games[gameId];
    if (!g) return;

    const playerIdx = g.players.indexOf(playerName);
    const spectatorIdx = g.spectators.indexOf(playerName);
    if (playerIdx === -1 && spectatorIdx === -1) return;

    if (spectatorIdx !== -1) {
        g.spectators.splice(spectatorIdx, 1);
        delete g.points[playerName];
        console.log(`Game ${gameId}: spectator ${playerName} removed`);
        return;
    }

    g.players.splice(playerIdx, 1);
    delete g.votes[playerName];
    delete g.guessVotes[playerName];
    delete g.points[playerName];
    console.log(`Game ${gameId}: ${playerName} removed`);

    if (g.players.length === 0) {
        delete games[gameId];
        return;
    }

    if (g.owner === playerName) {
        g.owner = g.players[0];
        console.log(`Game ${gameId}: Owner left — reassigned to ${g.owner}`);
        io.to(gameId).emit('ownerChanged', { newOwner: g.owner });
    }

    const wasSpecialPlayer = g.specialPlayer === playerName;
    const midRound = g.state === 'question' || g.state === 'guessFake';

    if (wasSpecialPlayer && midRound) {
        console.log(`Game ${gameId}: Special player left — forcing reveal`);
        g.players.forEach(p => { if (!g.guessVotes[p]) g.guessVotes[p] = null; });
        resolveRound(gameId);
        return;
    }

    if (midRound) {
        checkVoteCompletion(gameId);
    } else {
        broadcastGameState(gameId);
    }
}

io.on('connection', (socket) => {
    socket.on('createGame', (playerName) => {
        const gameId = generateGameId();
        games[gameId] = {
            players: [playerName],
            spectators: [],
            points: { [playerName]: 0 },
            state: 'waiting',
            owner: playerName,
            usedQuestions: new Set(),
            mainQuestion: '',
            specialPlayer: null,
            specialQuestion: '',
            votes: {},
            guessVotes: {},
            noMoreQuestions: false
        };
        socket.join(gameId);
        socket.playerName = playerName;
        broadcastGameState(gameId);
        resetGameTimeout(gameId);
    });

    socket.on('joinGame', ({ gameId, playerName }) => {
        if (!games[gameId]) {
            socket.emit('error', 'Game not found');
            return;
        }
        const game = games[gameId];
        if (game.players.includes(playerName) || game.spectators.includes(playerName)) {
            socket.emit('error', 'Name already taken');
            return;
        }
        socket.join(gameId);
        socket.playerName = playerName;

        if (game.state !== 'waiting') {
            // Round in progress — join as spectator
            game.spectators.push(playerName);
            game.points[playerName] = 0;
            console.log(`Game ${gameId}: ${playerName} joined as spectator (round in progress)`);
            socket.emit('gameState', {
                ...game,
                gameId,
                isSpecialPlayer: false,
                specialPlayer: game.state === 'finalReveal' ? game.specialPlayer : null,
                isSpectator: true
            });
            // Tell existing players someone joined to watch
            socket.to(gameId).emit('spectatorJoined', { playerName });
        } else {
            game.players.push(playerName);
            game.points[playerName] = 0;
            broadcastGameState(gameId);
        }
        resetGameTimeout(gameId);
    });

    socket.on('startGame', async (gameId) => {
        if (!games[gameId] || games[gameId].owner !== socket.playerName) {
            socket.emit('error', 'Only the game owner can start the game');
            return;
        }
        const game = games[gameId];
        // Promote any spectators who were waiting in the lobby
        if (game.spectators.length > 0) {
            game.players.push(...game.spectators);
            game.spectators = [];
        }
        game.state = 'question';
        game.votes = {};
        game.guessVotes = {};
        const questionObj = await selectQuestion(gameId);
        if (!questionObj) {
            socket.emit('error', 'No more unique questions available.');
            return;
        }
        game.mainQuestion = questionObj.question;
        game.specialPlayer = game.players[Math.floor(Math.random() * game.players.length)];
        game.specialQuestion = questionObj.specialQuestion;
        console.log(`Game ${gameId}: Started. Special player: ${game.specialPlayer}`);
        broadcastGameState(gameId);
        resetGameTimeout(gameId);
    });

    socket.on('vote', ({ gameId, votedPlayer }) => {
        if (!games[gameId] || !games[gameId].players.includes(socket.playerName)) return;
        const game = games[gameId];
        if (game.state !== 'question') return;
        if (!game.players.includes(votedPlayer)) {
            socket.emit('error', 'Invalid player selected');
            return;
        }
        game.votes[socket.playerName] = votedPlayer;
        console.log(`Game ${gameId}: ${socket.playerName} voted for ${votedPlayer}`);
        broadcastGameState(gameId);
        checkVoteCompletion(gameId);
        resetGameTimeout(gameId);
    });

    socket.on('guessVote', ({ gameId, guessedPlayer }) => {
        if (!games[gameId] || !games[gameId].players.includes(socket.playerName)) return;
        const game = games[gameId];
        if (game.state !== 'guessFake') return;
        if (!game.players.includes(guessedPlayer)) {
            socket.emit('error', 'Invalid player selected');
            return;
        }
        game.guessVotes[socket.playerName] = guessedPlayer;
        console.log(`Game ${gameId}: ${socket.playerName} guessed ${guessedPlayer} had the fake question`);
        broadcastGameState(gameId);
        checkVoteCompletion(gameId);
        resetGameTimeout(gameId);
    });

    socket.on('nextQuestion', async (gameId) => {
        if (!games[gameId] || games[gameId].owner !== socket.playerName) {
            socket.emit('error', 'Only the game owner can advance to the next question');
            return;
        }
        const game = games[gameId];
        if (game.state !== 'finalReveal') return;

        // Promote spectators into the next round
        if (game.spectators.length > 0) {
            game.players.push(...game.spectators);
            game.spectators = [];
        }

        game.state = 'question';
        game.votes = {};
        game.guessVotes = {};
        const questionObj = await selectQuestion(gameId);
        if (!questionObj) {
            socket.emit('error', 'No more unique questions available.');
            return;
        }
        game.mainQuestion = questionObj.question;
        game.specialPlayer = game.players[Math.floor(Math.random() * game.players.length)];
        game.specialQuestion = questionObj.specialQuestion;
        console.log(`Game ${gameId}: Next round. Special player: ${game.specialPlayer}`);
        broadcastGameState(gameId);
        resetGameTimeout(gameId);
    });

    socket.on('rejoinGame', ({ gameId, playerName }) => {
        const game = games[gameId];
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }

        // Cancel any pending removal for this player
        const timerKey = `${gameId}:${playerName}`;
        if (disconnectTimers[timerKey]) {
            clearTimeout(disconnectTimers[timerKey]);
            delete disconnectTimers[timerKey];
            console.log(`Game ${gameId}: ${playerName} rejoined before grace period expired`);
        }

        socket.join(gameId);
        socket.playerName = playerName;

        const isPlayer = game.players.includes(playerName);
        const isSpectator = game.spectators.includes(playerName);

        if (!isPlayer && !isSpectator) {
            // Grace period expired and they were fully removed — re-add appropriately
            if (game.state === 'waiting') {
                game.players.push(playerName);
                game.points[playerName] = 0;
            } else {
                // Mid-round: re-add as spectator
                game.spectators.push(playerName);
                game.points[playerName] = 0;
                socket.emit('gameState', {
                    ...game,
                    gameId,
                    isSpecialPlayer: false,
                    specialPlayer: game.state === 'finalReveal' ? game.specialPlayer : null,
                    isSpectator: true
                });
                console.log(`Game ${gameId}: ${playerName} re-added as spectator after grace period`);
                return;
            }
        }

        // Send personalised state — spectators get isSpectator flag
        const spectating = game.spectators.includes(playerName);
        socket.emit('gameState', {
            ...game,
            gameId,
            isSpecialPlayer: !spectating && game.specialPlayer === playerName,
            specialPlayer: game.state === 'finalReveal' ? game.specialPlayer : null,
            isSpectator: spectating
        });
        resetGameTimeout(gameId);
        console.log(`Game ${gameId}: ${playerName} successfully rejoined (spectator: ${spectating})`);
    });

    socket.on('leaveGame', ({ gameId, playerName: payloadName }) => {
        const game = games[gameId];
        if (!game) return;
        const playerName = socket.playerName || payloadName;
        if (!playerName) return;

        socket.leave(gameId);
        socket.playerName = null;

        // Start grace period — same as a disconnect
        const timerKey = `${gameId}:${playerName}`;
        if (disconnectTimers[timerKey]) {
            clearTimeout(disconnectTimers[timerKey]);
        }
        console.log(`Game ${gameId}: ${playerName} left — starting ${DISCONNECT_GRACE_MS / 1000}s grace period`);
        disconnectTimers[timerKey] = setTimeout(() => {
            delete disconnectTimers[timerKey];
            removePlayerFromGame(gameId, playerName);
        }, DISCONNECT_GRACE_MS);
    });

    socket.on('disconnect', () => {
        for (const gameId in games) {
            const game = games[gameId];
            const isPlayer = game.players.includes(socket.playerName);
            const isSpectator = game.spectators.includes(socket.playerName);
            if (!isPlayer && !isSpectator) continue;

            const playerName = socket.playerName;
            const timerKey = `${gameId}:${playerName}`;

            // If leaveGame already started a grace period, don't start another
            if (disconnectTimers[timerKey]) continue;

            console.log(`Game ${gameId}: ${playerName} disconnected — starting ${DISCONNECT_GRACE_MS / 1000}s grace period`);
            disconnectTimers[timerKey] = setTimeout(() => {
                delete disconnectTimers[timerKey];
                removePlayerFromGame(gameId, playerName);
            }, DISCONNECT_GRACE_MS);
        }
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});