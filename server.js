const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const questions = JSON.parse(fs.readFileSync('questions.json', 'utf8'));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/app.js', (req, res) => {
    console.log(`Serving app.js from: ${path.join(__dirname, 'public', 'app.js')}`);
    res.sendFile(path.join(__dirname, 'public', 'app.js'), (err) => {
        if (err) {
            console.error(`Error serving app.js: ${err}`);
            res.status(404).send('app.js not found');
        }
    });
});
app.get('/', (req, res) => {
    console.log(`Serving index.html`);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const games = {};

function generateGameId() {
    return Math.random().toString(36).substring(2, 9);
}

function selectQuestion(usedQuestionIds) {
    const availableQuestions = questions.filter(q => !usedQuestionIds.includes(q.id));
    if (availableQuestions.length === 0) return null;
    return availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
}

io.on('connection', (socket) => {
    socket.on('createGame', (playerName) => {
        const gameId = generateGameId();
        games[gameId] = {
            players: [playerName],
            state: 'waiting',
            owner: playerName,
            usedQuestionIds: [],
            mainQuestion: '',
            specialPlayer: null,
            specialQuestion: '',
            votes: {}
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

    socket.on('startGame', (gameId) => {
        if (!games[gameId] || games[gameId].owner !== socket.playerName) return;
        const game = games[gameId];
        game.state = 'question';
        game.votes = {};
        const questionObj = selectQuestion(game.usedQuestionIds);
        if (questionObj) {
            game.usedQuestionIds.push(questionObj.id);
            game.mainQuestion = questionObj.question;
            console.log(`Game ${gameId}: All players: ${game.players}`);
            game.specialPlayer = game.players[Math.floor(Math.random() * game.players.length)];
            game.specialQuestion = questionObj.specialQuestion;
            console.log(`Game ${gameId}: Special player selected: ${game.specialPlayer}`);
        } else {
            game.state = 'reveal';
            game.noMoreQuestions = true;
        }
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

    socket.on('nextQuestion', (gameId) => {
        if (!games[gameId] || games[gameId].owner !== socket.playerName) return;
        const game = games[gameId];
        game.state = 'question';
        game.votes = {};
        const questionObj = selectQuestion(game.usedQuestionIds);
        if (questionObj) {
            game.usedQuestionIds.push(questionObj.id);
            game.mainQuestion = questionObj.question;
            console.log(`Game ${gameId}: All players: ${game.players}`);
            game.specialPlayer = game.players[Math.floor(Math.random() * game.players.length)];
            game.specialQuestion = questionObj.specialQuestion;
            console.log(`Game ${gameId}: Special player selected: ${game.specialPlayer}`);
        } else {
            game.state = 'reveal';
            game.noMoreQuestions = true;
        }
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