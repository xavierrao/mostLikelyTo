const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const fs = require('fs');

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

// Define themes for semantic filtering
const themeKeywords = {
    'writing': ['novel', 'book', 'author', 'publish', 'write', 'poet', 'playwright'],
    'food': ['pizza', 'eat', 'cook', 'chef', 'cooking', 'snack', 'ice cream', 'toast'],
    'athletics': ['run', 'marathon', 'sport', 'dance', 'skateboard', 'surf', 'olympic'],
    'technology': ['app', 'gadget', 'invent', 'game', 'program'],
    'creativity': ['photograph', 'design', 'meme', 'film', 'art', 'sculpt'],
    'performance': ['sing', 'concert', 'act', 'movie', 'voice', 'comedian', 'magician'],
    'travel': ['travel', 'vlog', 'navigation', 'city'],
    'embarrassment': ['forget', 'trip', 'lose', 'mispronounce', 'mismatch', 'oversleep'],
    'science': ['scientist', 'astronomer', 'nobel'],
    'charity': ['charity', 'philanthropist', 'conservation'],
    'business': ['company', 'entrepreneur']
};

// Function to determine the theme of a question
const getQuestionTheme = (question) => {
    question = question.toLowerCase();
    for (const [theme, keywords] of Object.entries(themeKeywords)) {
        if (keywords.some(keyword => question.includes(keyword))) {
            return theme;
        }
    }
    return 'other';
};

// Select a few examples to include in the prompt (e.g., 3 diverse questions)
const getExampleQuestions = () => {
    if (questionPool.length === 0) return [];
    const shuffled = [...questionPool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(3, questionPool.length)).map(q => ({
        question: q.question,
        specialQuestion: q.specialQuestion
    }));
};

// Fallback questions with diverse themes
const fallbackQuestions = [
    { id: Date.now(), question: "Who is the most likely to become a famous inventor?", specialQuestion: "Who is the most likely to forget their own birthday?", theme: 'technology' },
    { id: Date.now() + 1, question: "Who is the most likely to win a marathon?", specialQuestion: "Who is the most likely to trip over their own shoelaces?", theme: 'athletics' },
    { id: Date.now() + 2, question: "Who is the most likely to start a successful company?", specialQuestion: "Who is the most likely to lose their keys in their own house?", theme: 'business' },
    { id: Date.now() + 3, question: "Who is the most likely to paint a masterpiece?", specialQuestion: "Who is the most likely to spill paint on their clothes?", theme: 'creativity' },
    { id: Date.now() + 4, question: "Who is the most likely to perform stand-up comedy?", specialQuestion: "Who is the most likely to laugh at their own joke?", theme: 'performance' },
    { id: Date.now() + 5, question: "Who is the most likely to discover a new species?", specialQuestion: "Who is the most likely to scream at a bug?", theme: 'science' }
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
    const usedThemes = game.usedThemes || new Set();
    game.usedQuestions = usedQuestions;
    game.usedThemes = usedThemes;
    const maxRetries = 3;

    // Try Hugging Face API
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
            const usedThemesText = Array.from(usedThemes).length > 0
                ? `Avoid themes: ${Array.from(usedThemes).join(', ')}`
                : 'No themes to avoid yet.';

            const prompt = `
                Return a JSON object with exactly three fields: "id", "question", and "specialQuestion". The output must be valid JSON only, with no markdown, comments, or extra text.
                {
                    "id": "${timestamp}",
                    "question": "<Positive, aspirational question in the style of the examples below>",
                    "specialQuestion": "<Humorous, quirky question in the style of the examples below>"
                }
                The "question" should be positive and aspirational, suitable for a group game, e.g., "Who is the most likely to win a cooking competition?"
                The "specialQuestion" should be humorous or quirky, suitable for a group game, e.g., "Who is the most likely to lose their phone in their own house?"
                Ensure questions are unique in both wording and theme. Avoid themes: ${usedThemesText}.
                Examples to guide the style:
                ${exampleText}
                Generate unique questions for this request (seed: ${seed}).
            `;

            const response = await axios.post('https://api-inference.huggingface.co/models/distilgpt2', {
                inputs: prompt,
                parameters: {
                    max_new_tokens: 200,
                    temperature: 1.2,
                    top_p: 0.9,
                    do_sample: true
                }
            }, {
                headers: { 'Content-Type': 'application/json' }
            });

            let responseText = response.data[0].generated_text.trim();
            // Extract JSON from response (model may include extra text)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('Invalid JSON response');
            responseText = jsonMatch[0];
            console.log(`Game ${gameId}: Hugging Face response (attempt ${attempt}): ${responseText}`);
            const questionData = JSON.parse(responseText);

            const questionKey = `${questionData.question}|${questionData.specialQuestion}`;
            const mainQuestionTheme = getQuestionTheme(questionData.question);
            const specialQuestionTheme = getQuestionTheme(questionData.specialQuestion);

            if (usedQuestions.has(questionKey) || 
                usedThemes.has(mainQuestionTheme) || 
                usedThemes.has(specialQuestionTheme)) {
                console.log(`Game ${gameId}: Generated question is a duplicate or has used theme (${mainQuestionTheme}, ${specialQuestionTheme}), retrying (${attempt}/${maxRetries})`);
                continue;
            }

            usedQuestions.add(questionKey);
            usedThemes.add(mainQuestionTheme);
            usedThemes.add(specialQuestionTheme);
            game.usedQuestionIds.push(questionData.id || timestamp);
            console.log(`Game ${gameId}: Generated question: ${questionData.question} (theme: ${mainQuestionTheme})`);
            return {
                id: questionData.id || timestamp,
                question: questionData.question,
                specialQuestion: questionData.specialQuestion
            };
        } catch (error) {
            console.error(`Game ${gameId}: Error generating question with Hugging Face (attempt ${attempt}): ${error.message}`);
        }
    }

    // Fallback to questions.json
    const availableQuestions = questionPool.filter(
        q => !game.usedQuestionIds.includes(q.id) &&
             !usedThemes.has(getQuestionTheme(q.question)) &&
             !usedThemes.has(getQuestionTheme(q.specialQuestion))
    );

    if (availableQuestions.length === 0) {
        // Try fallback questions
        const availableFallbacks = fallbackQuestions.filter(
            q => !usedThemes.has(q.theme) && !usedQuestions.has(`${q.question}|${q.specialQuestion}`)
        );
        if (availableFallbacks.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableFallbacks.length);
            const selectedQuestion = availableFallbacks[randomIndex];
            usedQuestions.add(`${selectedQuestion.question}|${selectedQuestion.specialQuestion}`);
            usedThemes.add(selectedQuestion.theme);
            game.usedQuestionIds.push(selectedQuestion.id);
            console.log(`Game ${gameId}: Using fallback question: ${selectedQuestion.question} (theme: ${selectedQuestion.theme})`);
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
    usedThemes.add(getQuestionTheme(selectedQuestion.question));
    usedThemes.add(getQuestionTheme(selectedQuestion.specialQuestion));
    game.usedQuestionIds.push(selectedQuestion.id);
    console.log(`Game ${gameId}: Selected question from pool: ${selectedQuestion.question} (theme: ${getQuestionTheme(selectedQuestion.question)})`);
    return selectedQuestion;
}

io.on('connection', (socket) => {
    socket.on('createGame', (playerName) => {
        const gameId = generateGameId();
        games[gameId] = {
            players: [playerName],
            state: 'waiting',
            owner: playerName,
            usedQuestionIds: [],
            usedQuestions: new Set(),
            usedThemes: new Set(),
            mainQuestion: '',
            specialPlayer: null,
            specialQuestion: '',
            votes: {},
            guessVotes: {}, // New: For guessing the special player
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
        game.guessVotes = {}; // Reset for new round
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
        if (!game.players.includes(votedPlayer)) {
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

    socket.on('startGuess', (gameId) => {
        if (!games[gameId] || games[gameId].owner !== socket.playerName) {
            socket.emit('error', 'Only the game owner can start the guess phase');
            return;
        }
        const game = games[gameId];
        if (game.state !== 'reveal') return;
        game.state = 'guessFake';
        game.guessVotes = {};
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
            game.state = 'finalReveal';
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
        if (game.state !== 'finalReveal') return; // Ensure it's after final reveal
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
                delete game.guessVotes[socket.playerName];
                if (game.players.length === 0) {
                    delete games[gameId];
                } else {
                    game.state = game.players.length > 1 ? 'waiting' : 'joining';
                    io.to(gameId).emit('gameState', games[gameId]);
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