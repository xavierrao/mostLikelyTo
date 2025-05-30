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

    useEffect(() => {
        const newSocket = io(); // Relative path, connects to the same host
        setSocket(newSocket);

        newSocket.on('gameState', ({ state, players, mainQuestion, specialQuestion, gameId: receivedGameId, isSpecialPlayer, noMoreQuestions, owner, votes }) => {
            console.log(`Player ${playerName}: State=${state}, isSpecialPlayer=${isSpecialPlayer}`);
            setGameState(state);
            setPlayers(players);
            setMainQuestion(mainQuestion || '');
            setSpecialQuestion(specialQuestion || '');
            setIsSpecialPlayer(isSpecialPlayer || false);
            setIsOwner(playerName === owner);
            if (receivedGameId) setGameId(receivedGameId);
            setNoMoreQuestions(noMoreQuestions || false);
            setVotes(votes || {});
        });

        newSocket.on('error', (message) => {
            setError(message);
        });

        newSocket.on('connect_error', () => {
            setError('Failed to connect to server');
        });

        return () => newSocket.disconnect();
    }, [playerName]);

    const createGame = () => {
        if (playerName.trim()) {
            socket.emit('createGame', playerName);
        } else {
            setError('Please enter your name');
        }
    };

    const joinGame = () => {
        if (playerName.trim() && gameId.trim()) {
            socket.emit('joinGame', { gameId, playerName });
        } else {
            setError('Please enter your name and game ID');
        }
    };

    const startGame = () => {
        socket.emit('startGame', gameId);
    };

    const vote = (votedPlayer) => {
        socket.emit('vote', { gameId, playerName, votedPlayer });
    };

    const nextQuestion = () => {
        socket.emit('nextQuestion', gameId);
    };

    return (
        <div className="container">
            <h1>Most Likely To Game</h1>
            {gameId && <p>Game ID: {gameId}</p>}
            {error && <p className="error">{error}</p>}

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
                    <ul>
                        {players.map((player) => (
                            <li key={player}>{player}</li>
                        ))}
                    </ul>
                    {isOwner ? (
                        <button onClick={startGame}>Start Game</button>
                    ) : (
                        <p>Waiting for the game owner to start...</p>
                    )}
                </div>
            )}

            {gameState === 'question' && (
                <div>
                    <h2>Players: {players.length}</h2>
                    <ul>
                        {players.map((player) => (
                            <li key={player}>{player}</li>
                        ))}
                    </ul>
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

            {gameState === 'reveal' && (
                <div>
                    <h2>Players: {players.length}</h2>
                    <ul>
                        {players.map((player) => (
                            <li key={player}>
                                {player} {votes[player] ? `(voted for ${votes[player]})` : '(no vote)'}
                            </li>
                        ))}
                    </ul>
                    <p><strong>Your Question: </strong>{isSpecialPlayer ? specialQuestion : mainQuestion}</p>
                    <p><strong>Main Question: </strong>{mainQuestion}</p>
                    {isOwner && (
                        <>
                            {noMoreQuestions ? (
                                <p className="error">No more questions available!</p>
                            ) : (
                                <button onClick={nextQuestion}>Next Question</button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);