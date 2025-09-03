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

const games = {};
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
        You are a game question generator. Return ONLY a valid JSON object with two fields: "question" and "specialQuestion". The "question" must be positive and aspirational, phrased as "Who is most likely to..." (e.g., "Who is most likely to win a Nobel Prize?"). The "specialQuestion" must be humorous or quirky, phrased as "Who is most likely to..." (e.g., "Who is most likely to forget their own name?"). Generate highly unique and varied questions, avoiding any repetition or similarity to previous outputs, examples, or common themes. Do NOT include any text, markdown, backticks, code blocks (e.g., \`\`\`json or \`\`\`), comments, explanations, or conversational responses like "I'm not sure" or "Could you explain". If you cannot generate the requested output, return an empty JSON object {}.
        Examples:
        ${exampleText}
        Random seed for uniqueness: ${randomSeed}
        Output: {"question": "<your unique question>", "specialQuestion": "<your unique special question>"}
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
    });

    socket.on('guessVote', ({ gameId, guessedPlayer }) => {
        if (!games[gameId] || !games[gameId].players.includes(socket.playerName)) return;
        const game = games[gameId];
        if (game.state !== 'guessFake') return;
        if (socket.playerName === game.specialPlayer) {
            socket.emit('error', 'You cannot vote as the special player');
            return;
        }
        if (!game.players.includes(guessedPlayer)) {
            socket.emit('error', 'Invalid player selected');
            return;
        }
        game.guessVotes[socket.playerName] = guessedPlayer;
        console.log(`Game ${gameId}: ${socket.playerName} guessed ${guessedPlayer} had the fake question`);
        const nonSpecialPlayers = game.players.filter(p => p !== game.specialPlayer);
        if (Object.keys(game.guessVotes).length === nonSpecialPlayers.length) {
            Object.keys(game.guessVotes).forEach(voter => {
                if (game.guessVotes[voter] === game.specialPlayer) {
                    game.points[voter] = (game.points[voter] || 0) + 1;
                }
            });
            const nonVoters = nonSpecialPlayers.filter(p => game.guessVotes[p] !== game.specialPlayer);
            game.points[game.specialPlayer] = (game.points[game.specialPlayer] || 0) + nonVoters.length;
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