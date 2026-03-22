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

const games = {};
const gameTimeouts = {};
const GAME_TIMEOUT_MS = 60 * 60 * 1000;

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

io.on('connection', (socket) => {
    socket.on('createGame', (playerName) => {
        const gameId = generateGameId();
        games[gameId] = {
            players: [playerName],
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
        socket.emit('gameState', { ...games[gameId], gameId });
        resetGameTimeout(gameId);
    });

    socket.on('joinGame', ({ gameId, playerName }) => {
        if (!games[gameId]) {
            socket.emit('error', 'Game not found');
            return;
        }
        if (games[gameId].players.includes(playerName)) {
            socket.emit('error', 'Name already taken');
            return;
        }
        games[gameId].players.push(playerName);
        games[gameId].points[playerName] = 0;
        games[gameId].state = 'waiting';
        socket.join(gameId);
        socket.playerName = playerName;
        io.to(gameId).emit('gameState', games[gameId]);
        resetGameTimeout(gameId);
    });

    socket.on('startGame', async (gameId) => {
        if (!games[gameId] || games[gameId].owner !== socket.playerName) {
            socket.emit('error', 'Only the game owner can start the game');
            return;
        }
        const game = games[gameId];
        game.state = 'question';
        game.votes = {};
        game.guessVotes = {};
        const questionObj = await selectQuestion(gameId);
        if (!questionObj) {
            socket.emit('error', 'No more unique questions available.');
            return;
        }
        game.mainQuestion = questionObj.question;
        console.log(`Game ${gameId}: Set mainQuestion to ${game.mainQuestion}`);
        game.specialPlayer = game.players[Math.floor(Math.random() * game.players.length)];
        game.specialQuestion = questionObj.specialQuestion;
        console.log(`Game ${gameId}: Special player selected: ${game.specialPlayer}`);
        game.players.forEach(player => {
            const playerSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.playerName === player && s.rooms.has(gameId));
            if (playerSocket) {
                playerSocket.emit('gameState', {
                    ...game,
                    isSpecialPlayer: player === game.specialPlayer,
                    specialPlayer: game.specialPlayer
                });
            }
        });
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
        if (Object.keys(game.votes).length === game.players.length) {
            game.state = 'guessFake';
            game.guessVotes = {};
            game.players.forEach(player => {
                const playerSocket = Array.from(io.sockets.sockets.values())
                    .find(s => s.playerName === player && s.rooms.has(gameId));
                if (playerSocket) {
                    playerSocket.emit('gameState', {
                        ...game,
                        isSpecialPlayer: player === game.specialPlayer,
                        specialPlayer: game.specialPlayer
                    });
                }
            });
        } else {
            game.players.forEach(player => {
                const playerSocket = Array.from(io.sockets.sockets.values())
                    .find(s => s.playerName === player && s.rooms.has(gameId));
                if (playerSocket) {
                    playerSocket.emit('gameState', {
                        ...game,
                        isSpecialPlayer: player === game.specialPlayer,
                        specialPlayer: game.specialPlayer
                    });
                }
            });
        }
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
        if (Object.keys(game.guessVotes).length === game.players.length) {
            const votesForImposter = Object.keys(game.guessVotes)
                .filter(p => game.guessVotes[p] === game.specialPlayer);
            const otherPlayers = game.players.filter(p => p !== game.specialPlayer);
            const majorityGuessedImposter = votesForImposter.length >= Math.ceil(otherPlayers.length / 2);

            if (majorityGuessedImposter) {
                votesForImposter
                    .filter(voter => voter !== game.specialPlayer)
                    .forEach(voter => {
                        game.points[voter] = (game.points[voter] || 0) + 1;
                    });
            } else {
                const nonVoters = game.players.filter(p => game.guessVotes[p] !== game.specialPlayer);
                game.points[game.specialPlayer] = (game.points[game.specialPlayer] || 0) + nonVoters.length;
            }
            game.players.sort((a, b) => (game.points[b] || 0) - (game.points[a] || 0));
            game.state = 'finalReveal';
            game.players.forEach(player => {
                const playerSocket = Array.from(io.sockets.sockets.values())
                    .find(s => s.playerName === player && s.rooms.has(gameId));
                if (playerSocket) {
                    playerSocket.emit('gameState', {
                        ...game,
                        isSpecialPlayer: player === game.specialPlayer,
                        specialPlayer: game.specialPlayer
                    });
                }
            });
        } else {
            game.players.forEach(player => {
                const playerSocket = Array.from(io.sockets.sockets.values())
                    .find(s => s.playerName === player && s.rooms.has(gameId));
                if (playerSocket) {
                    playerSocket.emit('gameState', {
                        ...game,
                        isSpecialPlayer: player === game.specialPlayer,
                        specialPlayer: game.specialPlayer
                    });
                }
            });
        }
        resetGameTimeout(gameId);
    });

    socket.on('nextQuestion', async (gameId) => {
        if (!games[gameId] || games[gameId].owner !== socket.playerName) {
            socket.emit('error', 'Only the game owner can advance to the next question');
            return;
        }
        const game = games[gameId];
        if (game.state !== 'finalReveal') return;
        game.state = 'question';
        game.votes = {};
        game.guessVotes = {};
        const questionObj = await selectQuestion(gameId);
        if (!questionObj) {
            socket.emit('error', 'No more unique questions available.');
            return;
        }
        game.mainQuestion = questionObj.question;
        console.log(`Game ${gameId}: Set mainQuestion to ${game.mainQuestion}`);
        game.specialPlayer = game.players[Math.floor(Math.random() * game.players.length)];
        game.specialQuestion = questionObj.specialQuestion;
        console.log(`Game ${gameId}: Special player selected: ${game.specialPlayer}`);
        game.players.forEach(player => {
            const playerSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.playerName === player && s.rooms.has(gameId));
            if (playerSocket) {
                playerSocket.emit('gameState', {
                    ...game,
                    isSpecialPlayer: player === game.specialPlayer,
                    specialPlayer: game.specialPlayer
                });
            }
        });
        resetGameTimeout(gameId);
    });

    socket.on('disconnect', () => {
        for (const gameId in games) {
            const game = games[gameId];
            const index = game.players.indexOf(socket.playerName);
            if (index !== -1) {
                game.players.splice(index, 1);
                delete game.votes[socket.playerName];
                delete game.guessVotes[socket.playerName];
                delete game.points[socket.playerName];
                if (game.players.length === 0) {
                    delete games[gameId];
                } else {
                    game.state = game.players.length > 1 ? 'waiting' : 'joining';
                    game.players.sort((a, b) => (game.points[b] || 0) - (game.points[a] || 0));
                    io.to(gameId).emit('gameState', { ...game, specialPlayer: game.specialPlayer });
                }
            }
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