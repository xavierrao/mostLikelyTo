const { useState, useEffect, useRef } = React;


// Read game ID from URL path: /game/<id>
function getGameIdFromUrl() {
    const parts = window.location.pathname.split('/');
    if (parts[1] === 'game' && parts[2]) return parts[2];
    return '';
}

// Read ?join=GAMEID query param for pre-filling the join input
function getJoinParamFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('join') || '';
}

// Update the URL without a page reload
function setUrlGameId(gameId) {
    const newPath = gameId ? `/game/${gameId}` : '/';
    if (window.location.pathname !== newPath) {
        window.history.pushState({}, '', newPath);
    }
}

const HomeButton = ({ onClick }) => (
    <button onClick={onClick} title="Go home" className="home-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        Home
    </button>
);

const App = () => {
    const [socket, setSocket] = useState(null);
    const [gameId, setGameId] = useState(() => getGameIdFromUrl() || getJoinParamFromUrl());
    const [playerName, setPlayerName] = useState(() => localStorage.getItem('mlt_playerName') || '');
    const [isOwner, setIsOwner] = useState(false);
    const [players, setPlayers] = useState([]);
    const [gameState, setGameState] = useState('joining');
    const [mainQuestion, setMainQuestion] = useState('');
    const [specialQuestion, setSpecialQuestion] = useState('');
    const [isSpecialPlayer, setIsSpecialPlayer] = useState(false);
    const [error, setError] = useState('');
    const [noMoreQuestions, setNoMoreQuestions] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showCopyMenu, setShowCopyMenu] = useState(false);
    const copyMenuRef = useRef(null);

    useEffect(() => {
        if (!showCopyMenu) return;
        const handleClickOutside = (e) => {
            if (copyMenuRef.current && !copyMenuRef.current.contains(e.target)) {
                setShowCopyMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showCopyMenu]);
    const [votes, setVotes] = useState({});
    const [guessVotes, setGuessVotes] = useState({});
    const [specialPlayer, setSpecialPlayer] = useState(null);
    const [points, setPoints] = useState({});
    const [hasAttemptedRejoin, setHasAttemptedRejoin] = useState(false);
    const [isSpectator, setIsSpectator] = useState(false);
    const [spectatorCount, setSpectatorCount] = useState(0);
    const [inGame, setInGame] = useState(false);

    // Ref so socket event handlers always see the latest playerName without recreating the socket
    const playerNameRef = useRef(playerName);
    useEffect(() => { playerNameRef.current = playerName; }, [playerName]);

    // Keep a ref to goHome so the popstate listener can call it without going stale
    const goHomeRef = useRef(null);

    useEffect(() => {
        const handlePopState = () => {
            const urlGameId = getGameIdFromUrl();
            if (!urlGameId) {
                // Navigated back to '/' — treat as home button press
                if (goHomeRef.current) goHomeRef.current();
            } else {
                // Navigated forward to a game URL — try to rejoin
                const savedName = localStorage.getItem('mlt_playerName');
                if (savedName && socket) {
                    setInGame(true);
                    socket.emit('rejoinGame', { gameId: urlGameId, playerName: savedName });
                }
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [socket]);

    useEffect(() => {
        const newSocket = io();
        setSocket(newSocket);

        // Auto-rejoin if we have a game ID in the URL and a saved name
        const urlGameId = getGameIdFromUrl();
        const savedName = localStorage.getItem('mlt_playerName');
        if (urlGameId && savedName && !hasAttemptedRejoin) {
            setHasAttemptedRejoin(true);
            newSocket.once('connect', () => {
                newSocket.emit('rejoinGame', { gameId: urlGameId, playerName: savedName });
            });
            // If already connected (reconnect scenario), emit immediately
            if (newSocket.connected) {
                newSocket.emit('rejoinGame', { gameId: urlGameId, playerName: savedName });
            }
        }

        newSocket.on('gameState', ({ state, players, spectators, mainQuestion, specialQuestion, gameId: receivedGameId, isSpecialPlayer, isSpectator: spectatorFlag, noMoreQuestions, owner, votes, guessVotes, specialPlayer, points }) => {
            setGameState(state);
            setPlayers(players);
            setMainQuestion(mainQuestion || '');
            setSpecialQuestion(specialQuestion || '');
            setIsSpecialPlayer(isSpecialPlayer || false);
            if (spectatorFlag) setIsSpectator(true);
            if (state === 'finalReveal') setIsSpectator(false);
            setIsOwner(playerNameRef.current === owner);
            setSpectatorCount((spectators || []).length);
            if (receivedGameId) {
                setGameId(receivedGameId);
                setUrlGameId(receivedGameId);
                setInGame(true);
            }
            setNoMoreQuestions(noMoreQuestions || false);
            setVotes(votes || {});
            setGuessVotes(guessVotes || {});
            setSpecialPlayer(specialPlayer || null);
            setPoints(points || {});
        });

        newSocket.on('spectatorJoined', ({ playerName: name }) => {
            setSpectatorCount(c => c + 1);
        });

        newSocket.on('ownerChanged', ({ newOwner }) => {
            setIsOwner(newOwner === playerNameRef.current);
        });

        newSocket.on('error', (message) => {
            setError(message);
            setInGame(false);
            setTimeout(() => setError(''), 5000);
        });

        newSocket.on('connect_error', () => {
            setError('Failed to connect to server');
            setTimeout(() => setError(''), 5000);
        });

        newSocket.on('gameExpired', () => {
            setGameState('joining');
            setInGame(false);
            setGameId('');
            setPlayers([]);
            setPoints({});
            setIsSpectator(false);
            setError('Game ended due to inactivity');
            setTimeout(() => setError(''), 5000);
        });

        return () => newSocket.disconnect();
    }, []);

    const goHome = () => {
        if (socket && gameId) socket.emit('leaveGame', { gameId, playerName });
        setGameState('joining');
        setInGame(false);
        setGameId('');
        setPlayers([]);
        setPoints({});
        setVotes({});
        setGuessVotes({});
        setSpecialPlayer(null);
        setUrlGameId('');
        setIsSpectator(false);
    };
    goHomeRef.current = goHome;

    const createGame = () => {
        if (playerName.trim()) {
            localStorage.setItem('mlt_playerName', playerName.trim());
            setInGame(true);
            socket.emit('createGame', playerName);
        } else { setError('Please enter your name'); setTimeout(() => setError(''), 5000); }
    };

    const joinGame = () => {
        if (playerName.trim() && gameId.trim()) {
            localStorage.setItem('mlt_playerName', playerName.trim());
            setInGame(true);
            socket.emit('joinGame', { gameId, playerName });
        } else { setError('Please enter your name and game ID'); setTimeout(() => setError(''), 5000); }
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
            {inGame && <HomeButton onClick={goHome} />}

            <h1 className="page-title">Most Likely To</h1>
            <p className="page-subtitle">The Social Deduction Party Game</p>

            {gameId && inGame && (
                <div className="copy-badge-wrap" ref={copyMenuRef}>
                    <div
                        className="game-id-badge"
                        onClick={() => setShowCopyMenu(m => !m)}
                        title="Share game"
                    >
                        🎮 Game ID: <strong>{gameId}</strong>
                        {copied ? (
                            <span className="copied-label">Copied!</span>
                        ) : (
                            <svg className="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        )}
                    </div>
                    {showCopyMenu && (
                        <div className="copy-menu">
                            {[
                                {
                                    label: '🔢 Copy ID',
                                    action: () => {
                                        navigator.clipboard.writeText(gameId);
                                        setCopied(true);
                                        setShowCopyMenu(false);
                                        setTimeout(() => setCopied(false), 2000);
                                    }
                                },
                                {
                                    label: '🔗 Copy Link',
                                    action: () => {
                                        const link = `${window.location.origin}/?join=${gameId}`;
                                        navigator.clipboard.writeText(link);
                                        setCopied(true);
                                        setShowCopyMenu(false);
                                        setTimeout(() => setCopied(false), 2000);
                                    }
                                }
                            ].map(({ label, action }) => (
                                <button
                                    key={label}
                                    onClick={action}
                                    className="copy-menu-btn"
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {error && <div className="alert alert-error">⚠️ {error}</div>}
            {noMoreQuestions && (
                <div className="alert alert-warning">
                    🃏 No more questions available. Start a new game!
                </div>
            )}
            {isSpectator && gameState !== 'finalReveal' && (
                <div className="alert alert-warning">
                    👀 You joined mid-round — you're spectating. You'll be added as a player at the start of the next round.
                </div>
            )}
            {!isSpectator && spectatorCount > 0 && inGame && gameState !== 'waiting' && (
                <div className="spectator-bar">
                    👀 {spectatorCount} spectator{spectatorCount !== 1 ? 's' : ''} watching
                </div>
            )}
            {!inGame && (
                <div>
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
                            placeholder="Game ID (optional — leave blank to create)"
                            value={gameId}
                            onChange={(e) => setGameId(e.target.value)}
                        />
                        <div className="btn-row btn-row-top">
                            {gameId.trim() ? (
                                <button onClick={joinGame} className="btn btn-primary btn-full">Join Game</button>
                            ) : (
                                <button onClick={createGame} className="btn btn-primary btn-full">Create Game</button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {gameState === 'waiting' && (
                <div>
                    <div className="card">
                        <div className="players-header">
                            <div className="section-label">Players</div>
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
                </div>
            )}
            {(gameState === 'waiting' || !inGame) && (
                <p className="player-count-tip">🎯 Best played with 3 or more players</p>
            )}
            {gameState === 'question' && !noMoreQuestions && (
                <div>
                    <div className="card">
                        <div className="players-header players-header--mb14">
                            <div className="section-label">Players</div>
                            <span className="count-badge">{players.length}</span>
                        </div>
                        <PlayerList />
                    </div>

                    <div className="question-card">
                        <div className="question-tag">❓ {isSpectator ? 'The Question' : 'Your Question'}</div>
                        <div className="question-text">
                            {isSpectator ? mainQuestion : (isSpecialPlayer ? specialQuestion : mainQuestion)}
                        </div>
                    </div>

                    {isSpectator ? (
                        <p className="waiting-hint">👀 Watching this round — you'll play next round.</p>
                    ) : (
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
                    )}
                </div>
            )}
            {gameState === 'guessFake' && !noMoreQuestions && (
                <div>
                    <div className="card">
                        <div className="players-header players-header--mb14">
                            <div className="section-label">Votes cast</div>
                        </div>
                        <PlayerList showVotes />
                    </div>

                    <div className="question-card">
                        <div className="question-tag">❓ {isSpectator ? 'The Question' : 'Your Question'}</div>
                        <div className="question-text">
                            {isSpectator ? mainQuestion : (isSpecialPlayer ? specialQuestion : mainQuestion)}
                        </div>
                    </div>

                    {!isSpectator && (
                        <div className="question-secondary">
                            <div className="question-tag">📢 The Main Question</div>
                            <div className="question-text question-text--sm">{mainQuestion}</div>
                        </div>
                    )}

                    {isSpectator ? (
                        <p className="waiting-hint">👀 Watching this round — you'll play next round.</p>
                    ) : (
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
                    )}
                </div>
            )}
            {gameState === 'finalReveal' && !noMoreQuestions && (
                <div>
                    <div className="reveal-imposter">
                        <div className="reveal-imposter-label">The Imposter Was</div>
                        <div className="reveal-imposter-name">{specialPlayer || 'Unknown'}</div>
                    </div>

                    <div className="card">
                        <div className="question-tag question-tag--mb6">Main Question</div>
                        <div className="question-text question-text--sm question-text--mb16">{mainQuestion}</div>
                        <div className="question-tag question-tag--accent">Fake Question</div>
                        <div className="question-text question-text--accent">{specialQuestion}</div>
                    </div>

                    <div className="card">
                        <div className="players-header players-header--mb14">
                            <div className="section-label">Results</div>
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