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
        <div className="container">
            <h1>Most Likely To Game</h1>
            {gameId && <p>Game ID: {gameId}</p>}
            {error && <p className="error">{error}</p>}

            {noMoreQuestions && (
                <p className="error">No more unique questions available. Please end the game or start a new one.</p>
            )}

            {gameState === 'joining' && (
                <div>
                    <input
                        type="text"
                        placeholder="Your Name"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                    />
                    <input
                        type="text"
                        placeholder="Game ID (leave blank to create)"
                        value={gameId}
                        onChange={(e) => setGameId(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={createGame}>Create Game</button>
                        <button onClick={joinGame}>Join Game</button>
                    </div>
                </div>
            )}

            {gameState === 'waiting' && (
                <div>
                    <h2>Players: {players.length}</h2>
                    <div>
                        {players.map((player) => (
                            <div key={player}>({points[player] || 0}) {player}</div>
                        ))}
                    </div>
                    {isOwner ? (
                        <button onClick={startGame}>Start Game</button>
                    ) : (
                        <p>Waiting for the game owner to start...</p>
                    )}
                </div>
            )}

            {gameState === 'question' && !noMoreQuestions && (
                <div>
                    <h2>Players: {players.length}</h2>
                    <div>
                        {players.map((player) => (
                            <div key={player}>({points[player] || 0}) {player}</div>
                        ))}
                    </div>
                    <p><strong>Your Question: </strong>{isSpecialPlayer ? specialQuestion : mainQuestion}</p>
                    <p>Vote for who you think this is:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {players.map((player) => (
                            <button
                                key={player}
                                onClick={() => vote(player)}
                                style={{ backgroundColor: votes[playerName] === player ? '#28a745' : '#007bff' }}
                            >
                                {player}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {gameState === 'guessFake' && !noMoreQuestions && (
                <div>
                    <h2>Players: {players.length}</h2>
                    <div>
                        {players.map((player) => (
                            <div key={player}>
                                ({points[player] || 0}) {player} {votes[player] ? `(voted for ${votes[player]})` : '(no vote)'}
                            </div>
                        ))}
                    </div>
                    <p><strong>Your Question: </strong>{isSpecialPlayer ? specialQuestion : mainQuestion}</p>
                    <p><strong>Main Question: </strong>{mainQuestion}</p>
                    {isSpecialPlayer ? (
                        <p>Wait for everyone to finish voting</p>
                    ) : (
                        <>
                            <p>Guess who had the fake question:</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                {players.map((player) => (
                                    <button
                                        key={player}
                                        onClick={() => guessVote(player)}
                                        style={{ backgroundColor: guessVotes[playerName] === player ? '#28a745' : '#007bff' }}
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
                <div>
                    <h2>Players: {players.length}</h2>
                    <div>
                        {players.map((player) => (
                            <div key={player}>
                                ({points[player] || 0}) {player} {votes[player] ? `(voted for ${votes[player]})` : '(no vote)'}
                                {guessVotes[player] ? ` (guessed ${guessVotes[player]})` : ' (no guess)'}
                            </div>
                        ))}
                    </div>
                    <p><strong>Your Question: </strong>{isSpecialPlayer ? specialQuestion : mainQuestion}</p>
                    <p><strong>Main Question: </strong>{mainQuestion}</p>
                    <p><strong>Fake Question: </strong>{specialQuestion}</p>
                    <p><strong>Imposter: </strong>{specialPlayer || 'Unknown'}</p>
                    {isOwner && (
                        <button onClick={nextQuestion}>Next Question</button>
                    )}
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);