const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const fs = require('fs'); // Add fs to read questions.json

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

// Load questions.json to use as examples for Ollama
let questionExamples = [];
try {
    const data = fs.readFileSync('questions.json', 'utf8');
    questionExamples = JSON.parse(data);
    console.log(`Loaded ${questionExamples.length} question examples from questions.json`);
} catch (err) {
    console.error('Error loading questions.json:', err.message);
    questionExamples = []; // Fallback to empty array if file read fails
}

// Select a few examples to include in the prompt (e.g., 3 random questions)
const getExampleQuestions = () => {
    if (questionExamples.length === 0) return [];
    const shuffled = [...questionExamples].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(3, questionExamples.length)).map(q => ({
        question: q.question,
        specialQuestion: q.specialQuestion
    }));
};

// Pool of fallback questions
const fallbackQuestions = [
    {
        id: Date.now(),
        question: "Who is the most likely to become a famous inventor?",
        specialQuestion: "Who is the most likely to forget their own birthday?"
    },
    {
        id: Date.now() + 1,
        question: "Who is the most likely to win a marathon?",
        specialQuestion: "Who is the most likely to trip over their own shoelaces?"
    },
    {
        id: Date.now() + 2,
        question: "Who is the most likely to start a successful company?",
        specialQuestion: "Who is the most likely to lose their keys in their own house?"
    }
];

function generateGameId() {
    return Math.random().toString(36).substring(2, 9);
}

// Generate a unique question using Ollama, guided by questions.json examples
async function selectQuestion(gameId) {
    const game = games[gameId];
    if (!game) {
        console.error(`Game ${gameId} not found`);
        return null;
    }

    // Track used questions by content to ensure uniqueness
    const usedQuestions = game.usedQuestions || new Set();
    game.usedQuestions = usedQuestions; // Initialize if not present
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const timestamp = Date.now();
            const seed = `${gameId}-${timestamp}-${attempt}`; // Unique seed per attempt
            const examples = getExampleQuestions();
            const exampleText = examples.length > 0
                ? examples.map((ex, i) => 
                    `Example ${i + 1}: {"question": "${ex.question}", "specialQuestion": "${ex.specialQuestion}"}`
                  ).join('\n')
                : 'No examples available.';

            // List previously used questions to avoid duplicates
            const usedQuestionsText = Array.from(usedQuestions).length > 0
                ? `Previously used questions to avoid:\n${Array.from(usedQuestions).map(q => 
                    `{"question": "${q.question}", "specialQuestion": "${q.specialQuestion}"}`
                  ).join('\n')}`
                : 'No previously used questions.';

            const prompt = `
                Return a JSON object with exactly three fields: "id", "question", and "specialQuestion". Do NOT include markdown code fences, comments, or any text outside the JSON object. The output must be valid JSON only.
                {
                    "id": "<unique number, e.g., ${timestamp}>",
                    "question": "<Positive, aspirational, or impressive question in the style of the examples below>",
                    "specialQuestion": "<Humorous, mildly embarrassing, or quirky question in the style of the examples below>"
                }
                The "question" should be positive and aspirational, suitable for a group game, e.g., "Who is the most likely to write a hit song?"
                The "specialQuestion" should be humorous or quirky, suitable for a group game, e.g., "Who is the most likely to get lost in a mall for hours?"
                Ensure the questions are unique, fun, and suitable for groups. Do not repeat any of the previously used questions listed below.
                Examples from questions.json to guide the style:
                ${exampleText}
                ${usedQuestionsText}
                Generate unique questions for this request (seed: ${seed}).
            `;

            const response = await axios.post('http://127.0.0.1:11434/api/generate', {
                model: 'llama3.1',
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 1.2, // High temperature for more randomness
                    no_cache: true // Disable caching
                }
            });

            let responseText = response.data.response.trim();
            responseText = responseText.replace(/^```json\s*|\s*```$/g, '');
            console.log(`Game ${gameId}: Ollama response (attempt ${attempt}): ${responseText}`);
            const questionData = JSON.parse(responseText);

            const questionKey = `${questionData.question}|${questionData.specialQuestion}`;
            if (usedQuestions.has(questionKey)) {
                console.log(`Game ${gameId}: Generated question is a duplicate, retrying (${attempt}/${maxRetries})`);
                continue; // Retry if the question is a duplicate
            }

            // Add to used questions
            usedQuestions.add(questionKey);
            game.usedQuestionIds.push(questionData.id || timestamp); // Track ID for compatibility
            console.log(`Game ${gameId}: Generated question: ${questionData.question}`);
            return {
                id: questionData.id || timestamp,
                question: questionData.question,
                specialQuestion: questionData.specialQuestion
            };
        } catch (error) {
            console.error(`Game ${gameId}: Error generating question with Ollama (attempt ${attempt}): ${error.message}`);
            if (attempt === maxRetries) {
                // Select a random fallback question that hasn't been used
                const availableFallbacks = fallbackQuestions.filter(
                    q => !usedQuestions.has(`${q.question}|${q.specialQuestion}`)
                );
                if (availableFallbacks.length > 0) {
                    const randomIndex = Math.floor(Math.random() * availableFallbacks.length);
                    const selectedQuestion = availableFallbacks[randomIndex];
                    usedQuestions.add(`${selectedQuestion.question}|${selectedQuestion.specialQuestion}`);
                    game.usedQuestionIds.push(selectedQuestion.id);
                    console.log(`Game ${gameId}: Using fallback question: ${selectedQuestion.question}`);
                    return selectedQuestion;
                }

                // No unique questions available
                console.log(`Game ${gameId}: No more unique questions available`);
                io.to(gameId).emit('gameState', { ...game, noMoreQuestions: true });
                return null;
            }
        }
    }

    return null; // Return null if all retries fail and no fallback is available
}

io.on('connection', (socket) => {
    socket.on('createGame', (playerName) => {
        const gameId = generateGameId();
        games[gameId] = {
            players: [playerName],
            state: 'waiting',
            owner: playerName,
            usedQuestionIds: [],
            usedQuestions: new Set(), // Track used question content
            mainQuestion: '',
            specialPlayer: null,
            specialQuestion: '',
            votes: {},
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
                    isSpecialPlayer: player === game.specialPlayer
                });
            }
        });
    });

    socket.on('vote', ({ gameId, votedPlayer }) => {
        if (!games[gameId] || !games[gameId].players.includes(socket.playerName)) return;
        const game = games[gameId];
        if (game.state !== 'question') return;
        if (!games[gameId].players.includes(votedPlayer)) {
            socket.emit('error', 'Invalid player selected');
            return;
        }
        game.votes[socket.playerName] = votedPlayer;
        console.log(`Game ${gameId}: ${socket.playerName} voted for ${votedPlayer}`);
        if (Object.keys(game.votes).length === game.players.length) {
            game.state = 'reveal';
            game.players.forEach(player => {
                const playerSocket = Array.from(io.sockets.sockets.values())
                    .find(s => s.playerName === player && s.rooms.has(gameId));
                if (playerSocket) {
                    playerSocket.emit('gameState', {
                        ...game,
                        isSpecialPlayer: player === game.specialPlayer
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
                        isSpecialPlayer: player === game.specialPlayer
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
        game.state = 'question';
        game.votes = {};
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
                    isSpecialPlayer: player === game.specialPlayer
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
                if (game.players.length === 0) {
                    delete games[gameId];
                } else {
                    game.state = game.players.length > 0 ? 'waiting' : 'joining';
                    io.to(gameId).emit('gameState', games[gameId]);
                }
            }
        }
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});