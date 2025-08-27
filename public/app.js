const { useState, useEffect } = React;

const App = () => {
    const [socket, setSocket] = useState(null);
    const [gameId, setGameId] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [isOwner, setIsOwner] = useState(false);
    const [players, setPlayers] = useState([]);
    const [gameState, setGameState] = useState('joining');
    const [mainQuestion, setMainQuestion] = useState('');
    const [specialQuestion, setSpecialQuestion] = useState('');
    const [isSpecialPlayer, setIsSpecialPlayer] = useState(false);
    const [error, setError] = useState('');
    const [noMoreQuestions, setNoMoreQuestions] = useState(false);
    const [votes, setVotes] = useState({});
    const [guessVotes, setGuessVotes] = useState({});
    const [specialPlayer, setSpecialPlayer] = useState(null);
    const [points, setPoints] = useState({});

    useEffect(() => {
        const newSocket = io();
        setSocket(newSocket);

        newSocket.on('gameState', ({ state, players, mainQuestion, specialQuestion, gameId: receivedGameId, isSpecialPlayer, noMoreQuestions, owner, votes, guessVotes, specialPlayer, points }) => {
            console.log(`Player ${playerName}: State=${state}, isSpecialPlayer=${isSpecialPlayer}, mainQuestion=${mainQuestion}, specialPlayer=${specialPlayer}`);
            setGameState(state);
            setPlayers(players);
            setMainQuestion(mainQuestion || '');
            setSpecialQuestion(specialQuestion || '');
            setIsSpecialPlayer(isSpecialPlayer || false);
            setIsOwner(playerName === owner);
            if (receivedGameId) setGameId(receivedGameId);
            setNoMoreQuestions(noMoreQuestions || false);
            setVotes(votes || {});
            setGuessVotes(guessVotes || {});
            setSpecialPlayer(specialPlayer || null);
            setPoints(points || {});
        });

        newSocket.on('error', (message) => {
            setError(message);
            setTimeout(() => setError(''), 5000);
        });

        newSocket.on('connect_error', () => {
            setError('Failed to connect to server');
            setTimeout(() => setError(''), 5000);
        });

        return () => newSocket.disconnect();
    }, [playerName]);

    const createGame = () => {
        if (playerName.trim()) {
            socket.emit('createGame', playerName);
        } else {
            setError('Please enter your name');
            setTimeout(() => setError(''), 5000);
        }
    };

    const joinGame = () => {
        if (playerName.trim() && gameId.trim()) {
            socket.emit('joinGame', { gameId, playerName });
        } else {
            setError('Please enter your name and game ID');
            setTimeout(() => setError(''), 5000);
        }
    };

    const startGame = () => {
        console.log('Start Game clicked');
        socket.emit('startGame', gameId);
    };

    const vote = (votedPlayer) => {
        socket.emit('vote', { gameId, votedPlayer });
    };

    const guessVote = (guessedPlayer) => {
        socket.emit('guessVote', { gameId, guessedPlayer });
    };

    const nextQuestion = () => {
        console.log('Next Question clicked');
        socket.emit('nextQuestion', gameId);
    };

    return (
        <div className="container mx-auto p-4 max-w-2xl">
            <style>{`
                .player-grid {
                    display: grid !important;
                    grid-template-columns: 50px 1fr 70px 100px 70px 100px !important;
                }
            `}</style>
            <h1 className="text-3xl font-bold mb-4 text-center">Most Likely To Game</h1>
            {gameId && <p className="text-lg mb-2">Game ID: {gameId}</p>}
            {error && <p className="text-red-500 mb-2">{error}</p>}

            {noMoreQuestions && (
                <p className="text-red-500 mb-2">No more unique questions available. Please end the game or start a new one.</p>
            )}

            {gameState === 'joining' && (
                <div className="space-y-4">
                    <input
                        type="text"
                        placeholder="Your Name"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="border p-2 w-full rounded"
                    />
                    <input
                        type="text"
                        placeholder="Game ID (leave blank to create)"
                        value={gameId}
                        onChange={(e) => setGameId(e.target.value)}
                        className="border p-2 w-full rounded"
                    />
                    <div className="flex gap-4 justify-center">
                        <button onClick={createGame} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Create Game</button>
                        <button onClick={joinGame} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Join Game</button>
                    </div>
                </div>
            )}

            {gameState === 'waiting' && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-semibold">Players: {players.length}</h2>
                    <div className="space-y-2">
                        {players.map((player) => (
                            <div key={player} className="text-lg">
                                <span className="font-bold">({points[player] || 0})</span> <span className={player === playerName ? 'underline truncate' : 'truncate'}>{player}</span>
                            </div>
                        ))}
                    </div>
                    {isOwner ? (
                        <button onClick={startGame} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Start Game</button>
                    ) : (
                        <p className="text-lg">Waiting for the game owner to start...</p>
                    )}
                </div>
            )}

            {gameState === 'question' && !noMoreQuestions && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-semibold">Players: {players.length}</h2>
                    <div className="space-y-2">
                        {players.map((player) => (
                            <div key={player} className="text-lg">
                                <span className="font-bold">({points[player] || 0})</span> <span className={player === playerName ? 'underline truncate' : 'truncate'}>{player}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-lg"><strong>Your Question: </strong>{isSpecialPlayer ? specialQuestion : mainQuestion}</p>
                    <p className="text-lg">Vote for who you think this is:</p>
                    <div className="flex flex-wrap gap-2">
                        {players.map((player) => (
                            <button
                                key={player}
                                onClick={() => vote(player)}
                                className={`px-4 py-2 rounded text-white ${votes[playerName] === player ? 'bg-green-500' : 'bg-blue-500 hover:bg-blue-600'}`}
                            >
                                {player}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {gameState === 'guessFake' && !noMoreQuestions && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-semibold">Players: {players.length}</h2>
                    <div className="space-y-2">
                        {players.map((player) => (
                            <div key={player} className="grid grid-cols-[50px_1fr_70px_100px] gap-2 text-lg items-center player-grid">
                                <span className="font-bold">({points[player] || 0})</span>
                                <span className={player === playerName ? 'underline truncate' : 'truncate'}>{player}</span>
                                <span className="italic text text-right">Voted:</span>
                                <span className="italic text truncate">{votes[player] || 'No vote'}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-lg"><strong>Your Question: </strong>{isSpecialPlayer ? specialQuestion : mainQuestion}</p>
                    <p className="text-lg"><strong>Main Question: </strong>{mainQuestion}</p>
                    {isSpecialPlayer ? (
                        <p className="text-lg">Wait for everyone to finish voting</p>
                    ) : (
                        <>
                            <p className="text-lg">Guess who had the fake question:</p>
                            <div className="flex flex-wrap gap-2">
                                {players.map((player) => (
                                    <button
                                        key={player}
                                        onClick={() => guessVote(player)}
                                        className={`px-4 py-2 rounded text-white ${guessVotes[playerName] === player ? 'bg-green-500' : 'bg-blue-500 hover:bg-blue-600'}`}
                                    >
                                        {player}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {gameState === 'finalReveal' && !noMoreQuestions && (
                <div className="space-y-4">
                    <h2 className="text-2xl font-semibold">Players: {players.length}</h2>
                    <div className="space-y-2">
                        {players.map((player) => (
                            <div key={player} className="grid grid-cols-[50px_1fr_70px_100px_70px_100px] gap-2 text-lg items-center player-grid">
                                <span className="font-bold">({points[player] || 0})</span>
                                <span className={player === playerName ? 'underline truncate' : 'truncate'}>{player}</span>
                                <span className="italic text text-right">Voted:</span>
                                <span className="italic text truncate">{votes[player] || 'None'}</span>
                                <span className="italic text text-right">Guessed:</span>
                                <span className="italic text truncate">{guessVotes[player] || 'None'}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-lg"><strong>Your Question: </strong>{isSpecialPlayer ? specialQuestion : mainQuestion}</p>
                    <p className="text-lg"><strong>Main Question: </strong>{mainQuestion}</p>
                    <p className="text-lg"><strong>Fake Question: </strong>{specialQuestion}</p>
                    <p className="text-lg"><strong>Imposter: </strong>{specialPlayer || 'Unknown'}</p>
                    {isOwner && (
                        <button onClick={nextQuestion} className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Next Question</button>
                    )}
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);