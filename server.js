const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const { InferenceClient } = require('@huggingface/inference');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Initialize InferenceClient with HF_TOKEN
const client = new InferenceClient({
    token: process.env.HF_TOKEN || '' // Fallback to empty string to avoid undefined errors
});

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Serve app.js
app.get('/app.js', (req, res) => {
    console.log(`Serving app.js from: public/app.js`);
    res.sendFile('app.js', { root: 'public' }, (err) => {
        if (err) {
            console.error(`Error serving app.js: ${err}`);
            res.status(404).send('app.js not found');
        }
    });
});

// Serve index.html
app.get('/', (req, res) => {
    console.log(`Serving index.html`);
    res.sendFile('index.html', { root: 'public' });
});

const games = {};

// Load questions.json for examples and fallback
let questionPool = [];
try {
    const data = fs.readFileSync('questions.json', 'utf8');
    questionPool = JSON.parse(data);
    console.log(`Loaded ${questionPool.length} questions from questions.json`);
} catch (err) {
    console.error('Error loading questions.json:', err.message);
    questionPool = [];
}

// Select a few examples to include in the prompt (e.g., 3 diverse questions)
const getExampleQuestions = () => {
    if (questionPool.length === 0) return [];
    const shuffled = [...questionPool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(3, questionPool.length)).map(q => ({
        question: q.question,
        specialQuestion: q.specialQuestion
    }));
};

// Fallback questions
const fallbackQuestions = [
    { question: "Who is the most likely to become a famous inventor?", specialQuestion: "Who is the most likely to forget their own birthday?" },
    { question: "Who is the most likely to win a marathon?", specialQuestion: "Who is the most likely to trip over their own shoelaces?" },
    { question: "Who is the most likely to start a successful company?", specialQuestion: "Who is the most likely to lose their keys in their own house?" },
    { question: "Who is the most likely to paint a masterpiece?", specialQuestion: "Who is the most likely to spill paint on their clothes?" },
    { question: "Who is the most likely to perform stand-up comedy?", specialQuestion: "Who is the most likely to laugh at their own joke?" },
    { question: "Who is the most likely to discover a new species?", specialQuestion: "Who is the most likely to scream at a bug?" }
];

function generateGameId() {
    return Math.random().toString(36).substring(2, 9);
}

// Select a unique question using Hugging Face API or fallback to questions.json
async function selectQuestion(gameId) {
    const game = games[gameId];
    if (!game) {
        console.error(`Game ${gameId} not found`);
        return null;
    }

    const usedQuestions = game.usedQuestions || new Set();
    game.usedQuestions = usedQuestions;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const timestamp = Date.now();
            const seed = `${gameId}-${timestamp}-${attempt}`;
            const examples = getExampleQuestions();
            const exampleText = examples.length > 0
                ? examples.map((ex, i) =>
                    `Example ${i + 1}: {"question": "${ex.question}", "specialQuestion": "${ex.specialQuestion}"}`
                ).join('\n')
                : 'No examples available.';

            const prompt = `
                Return ONLY a valid JSON object with exactly two fields: "question" and "specialQuestion". Do NOT include any text, markdown, backticks, comments, or explanations outside the JSON object. The "question" must be positive and aspirational, suitable for a group game (e.g., "Who is the most likely to win a Nobel Prize?"). The "specialQuestion" must be humorous or quirky, suitable for a group game (e.g., "Who is the most likely to forget their own name?"). Ensure the questions are unique in wording and align with the provided examples.
                ${exampleText}
                Seed: ${seed}
                Example output:
                {"question": "Who is the most likely to become a famous scientist?", "specialQuestion": "Who is the most likely to trip over their own feet?"}
            `;

            const chatCompletion = await client.chatCompletion({
                provider: "fireworks-ai",
                model: "deepseek-ai/DeepSeek-V3.1",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 300, // Increased to ensure complete JSON
                temperature: 0.7, // Reduced for more structured output
                top_p: 0.9
            });

            let responseText = chatCompletion.choices[0].message.content.trim();
            console.log(`Game ${gameId}: Raw InferenceClient response (attempt ${attempt}): ${responseText}`);

            // Try to parse the response directly as JSON
            let questionData;
            try {
                questionData = JSON.parse(responseText);
            } catch (parseError) {
                // If direct parsing fails, try extracting JSON with a robust regex
                const jsonMatch = responseText.match(/\{(?:[^{}]|\{[^{}]*\})*\}/);
                if (!jsonMatch) throw new Error('Invalid JSON response: No valid JSON found');
                responseText = jsonMatch[0];
                questionData = JSON.parse(responseText);
            }

            // Validate JSON structure
            if (!questionData.question || !questionData.specialQuestion) {
                throw new Error('Missing required fields in JSON');
            }

            const questionKey = `${questionData.question}|${questionData.specialQuestion}`;
            if (usedQuestions.has(questionKey)) {
                console.log(`Game ${gameId}: Generated question is a duplicate, retrying (${attempt}/${maxRetries})`);
                continue;
            }

            usedQuestions.add(questionKey);
            console.log(`Game ${gameId}: Generated question: ${questionData.question}`);
            return questionData;
        } catch (error) {
            console.error(`Game ${gameId}: Error generating question with InferenceClient (attempt ${attempt}): ${error.message}`);
        }
    }

    // Fallback to questions.json
    const availableQuestions = questionPool.filter(
        q => !usedQuestions.has(`${q.question}|${q.specialQuestion}`)
    );

    if (availableQuestions.length === 0) {
        const availableFallbacks = fallbackQuestions.filter(
            q => !usedQuestions.has(`${q.question}|${q.specialQuestion}`)
        );
        if (availableFallbacks.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableFallbacks.length);
            const selectedQuestion = availableFallbacks[randomIndex];
            usedQuestions.add(`${selectedQuestion.question}|${selectedQuestion.specialQuestion}`);
            console.log(`Game ${gameId}: Using fallback question: ${selectedQuestion.question}`);
            return selectedQuestion;
        }
        console.log(`Game ${gameId}: No more unique questions available`);
        io.to(gameId).emit('gameState', { ...game, noMoreQuestions: true });
        return null;
    }

    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    const selectedQuestion = availableQuestions[randomIndex];
    usedQuestions.add(`${selectedQuestion.question}|${selectedQuestion.specialQuestion}`);
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
            // Award points
            Object.keys(game.guessVotes).forEach(voter => {
                if (game.guessVotes[voter] === game.specialPlayer) {
                    game.points[voter] = (game.points[voter] || 0) + 1; // 1 point for correct guess
                }
            });
            const nonVoters = nonSpecialPlayers.filter(p => game.guessVotes[p] !== game.specialPlayer);
            game.points[game.specialPlayer] = (game.points[game.specialPlayer] || 0) + nonVoters.length; // 1 point per player who didn't guess specialPlayer
            // Sort players by points (descending)
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
                    // Re-sort players by points after removal
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