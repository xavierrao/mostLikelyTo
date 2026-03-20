const { useState, useEffect, useCallback } = React;

const COLORS = {
    accent: '#52796f',
    accentGreen: '#bc6c25',
    textMuted: '#7a8c82',
};

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
    const [copied, setCopied] = useState(false);
    const [votes, setVotes] = useState({});
    const [guessVotes, setGuessVotes] = useState({});
    const [specialPlayer, setSpecialPlayer] = useState(null);
    const [points, setPoints] = useState({});

    useEffect(() => {
        const newSocket = io();
        setSocket(newSocket);

        newSocket.on('gameState', ({ state, players, mainQuestion, specialQuestion, gameId: receivedGameId, isSpecialPlayer, noMoreQuestions, owner, votes, guessVotes, specialPlayer, points }) => {
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

        newSocket.on('gameExpired', () => {
            setGameState('joining');
            setGameId('');
            setPlayers([]);
            setPoints({});
            setError('Game ended due to inactivity');
            setTimeout(() => setError(''), 5000);
        });

        return () => newSocket.disconnect();
    }, [playerName]);

    const createGame = () => {
        if (playerName.trim()) socket.emit('createGame', playerName);
        else { setError('Please enter your name'); setTimeout(() => setError(''), 5000); }
    };

    const joinGame = () => {
        if (playerName.trim() && gameId.trim()) socket.emit('joinGame', { gameId, playerName });
        else { setError('Please enter your name and game ID'); setTimeout(() => setError(''), 5000); }
    };

    const vote = (p) => socket.emit('vote', { gameId, votedPlayer: p });
    const guessVote = (p) => socket.emit('guessVote', { gameId, guessedPlayer: p });
    const startGame = () => socket.emit('startGame', gameId);
    const nextQuestion = () => socket.emit('nextQuestion', gameId);

    const PlayerList = ({ showVotes = false, showGuesses = false }) => (
        <div className="player-list">
            {players.map((player) => (
                <div key={player} className={`player-row ${player === playerName ? 'is-me' : ''}`}>
                    <div className="player-score">{points[player] || 0}</div>
                    <span className={`player-name ${player === playerName ? 'me' : ''}`}>
                        {player}{player === playerName ? ' (you)' : ''}
                    </span>
                    {showVotes && votes[player] && (
                        <span className="player-vote-label">voted</span>
                    )}
                    {showVotes && (
                        <span className="player-vote-val">{votes[player] || '—'}</span>
                    )}
                    {showGuesses && (
                        <span className="player-guess-val">{guessVotes[player] || '—'}</span>
                    )}
                </div>
            ))}
        </div>
    );

    return (
        <div className="app-wrap">
            <h1 className="page-title">Most Likely To</h1>
            <p className="page-subtitle">The Social Deduction Party Game</p>

            {gameId && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div
                        className="game-id-badge"
                        onClick={() => {
                            navigator.clipboard.writeText(gameId);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        }}
                        title="Click to copy"
                        style={{ cursor: 'pointer' }}
                    >
                        🎮 Game ID: <strong>{gameId}</strong>
                        {copied ? (
                            <span style={{ marginLeft: 6, color: '#bc6c25', fontSize: '0.8rem', fontWeight: 600 }}>Copied!</span>
                        ) : (
                            <svg style={{ marginLeft: 6, width: 14, height: 14, opacity: 0.5, flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        )}
                    </div>
                </div>
            )}

            {error && <div className="alert alert-error">⚠️ {error}</div>}
            {noMoreQuestions && (
                <div className="alert alert-warning">
                    🃏 No more questions available. Start a new game!
                </div>
            )}
            {gameState === 'joining' && (
                <div className="card">
                    <div className="section-label">Enter the game</div>
                    <input
                        className="input-field"
                        type="text"
                        placeholder="Your name"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                    />
                    <input
                        className="input-field"
                        type="text"
                        placeholder="Game ID (leave blank to create)"
                        value={gameId}
                        onChange={(e) => setGameId(e.target.value)}
                    />
                    <div className="btn-row" style={{ marginTop: 4 }}>
                        <button onClick={createGame} className="btn btn-primary">Create Game</button>
                        <button onClick={joinGame} className="btn btn-secondary">Join Game</button>
                    </div>
                </div>
            )}
            {gameState === 'waiting' && (
                <div className="card">
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
                        <div className="section-label" style={{ marginBottom: 0 }}>Players</div>
                        <span className="count-badge">{players.length}</span>
                    </div>
                    <PlayerList />
                    <hr className="divider" />
                    {isOwner ? (
                        <button onClick={startGame} className="btn btn-primary btn-full">
                            🚀 Start Game
                        </button>
                    ) : (
                        <p className="waiting-hint">⏳ Waiting for the host to start…</p>
                    )}
                </div>
            )}
            {gameState === 'question' && !noMoreQuestions && (
                <div>
                    <div className="card">
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
                            <div className="section-label" style={{ marginBottom: 0 }}>Players</div>
                            <span className="count-badge">{players.length}</span>
                        </div>
                        <PlayerList />
                    </div>

                    <div className="question-card">
                        <div className="question-tag">❓ Your Question</div>
                        <div className="question-text">
                            {isSpecialPlayer ? specialQuestion : mainQuestion}
                        </div>
                    </div>

                    <div className="card">
                        <div className="section-label">Vote — who does this describe?</div>
                        <div className="vote-grid">
                            {players.map((player) => (
                                <button
                                    key={player}
                                    onClick={() => vote(player)}
                                    className={`vote-btn ${votes[playerName] === player ? 'selected' : ''}`}
                                >
                                    {player}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {gameState === 'guessFake' && !noMoreQuestions && (
                <div>
                    <div className="card">
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
                            <div className="section-label" style={{ marginBottom: 0 }}>Votes cast</div>
                        </div>
                        <PlayerList showVotes />
                    </div>

                    <div className="question-card">
                        <div className="question-tag">❓ Your Question</div>
                        <div className="question-text">
                            {isSpecialPlayer ? specialQuestion : mainQuestion}
                        </div>
                    </div>

                    <div className="question-secondary">
                        <div className="question-tag">📢 The Main Question</div>
                        <div className="question-text" style={{ fontSize: '1rem' }}>{mainQuestion}</div>
                    </div>

                    <div className="card">
                        <div className="section-label">Who had the fake question?</div>
                        <div className="vote-grid">
                            {players.map((player) => (
                                <button
                                    key={player}
                                    onClick={() => guessVote(player)}
                                    className={`vote-btn ${guessVotes[playerName] === player ? 'guess-selected' : ''}`}
                                >
                                    {player}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {gameState === 'finalReveal' && !noMoreQuestions && (
                <div>
                    <div className="reveal-imposter">
                        <div className="reveal-imposter-label">The Imposter Was</div>
                        <div className="reveal-imposter-name">{specialPlayer || 'Unknown'}</div>
                    </div>

                    <div className="card">
                        <div className="question-tag" style={{ marginBottom: 6 }}>Main Question</div>
                        <div className="question-text" style={{ fontSize: '1rem', marginBottom: 16 }}>{mainQuestion}</div>
                        <div className="question-tag" style={{ color: COLORS.accentGreen, marginBottom: 6 }}>Fake Question</div>
                        <div className="question-text" style={{ fontSize: '1rem', color: COLORS.accentGreen }}>{specialQuestion}</div>
                    </div>

                    <div className="card">
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
                            <div className="section-label" style={{ marginBottom: 0 }}>Results</div>
                        </div>
                        <PlayerList showVotes showGuesses />
                    </div>

                    {isOwner && (
                        <button onClick={nextQuestion} className="btn btn-green btn-full">
                            ➡️ Next Question
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);