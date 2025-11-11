import React, { useState, useEffect } from "react";
import { Chess } from "chess.js";
import "../src/App.css";

const ChessBoardGame = () => {
  const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const numbers = [8, 7, 6, 5, 4, 3, 2, 1];

  const [game, setGame] = useState(new Chess());
  const [isThinking, setIsThinking] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [lastMoveSquares, setLastMoveSquares] = useState([]);

  const unicodePieces = {
    p: { w: "♙", b: "♟︎" },
    r: { w: "♖", b: "♜" },
    n: { w: "♘", b: "♞" },
    b: { w: "♗", b: "♝" },
    q: { w: "♕", b: "♛" },
    k: { w: "♔", b: "♚" },
  };

  const highlightMove = (from, to) => {
    setLastMoveSquares([from, to]);
    setTimeout(() => setLastMoveSquares([]), 3000);
  };

  const checkGameOver = (chess) => {
    if (chess.isCheckmate()) {
      setGameOver(true);
      setWinner(chess.turn() === "w" ? "Black (Stockfish) 🏆" : "White (GPT-5) 🏆");
      return true;
    } else if (chess.isDraw() || chess.isStalemate()) {
      setGameOver(true);
      setWinner("Draw 🤝");
      return true;
    }
    return false;
  };

  const restartGame = () => {
    setGame(new Chess());
    setGameOver(false);
    setWinner(null);
    setMoveHistory([]);
    setLastMoveSquares([]);
  };

  // 🧠 GPT move
  const getGptMove = async (fen, uciHistory) => {
    const res = await fetch("http://localhost:5000/api/gpt-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, history: uciHistory }),
    });
    const data = await res.json();
    return data.move;
  };

  // ♟️ Stockfish move
  const getStockfishMove = async (fen, uciHistory) => {
    const res = await fetch("http://localhost:5000/api/ai-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, history: uciHistory }),
    });
    const data = await res.json();
    return data.move;
  };

  // 🎮 Auto-play effect: GPT (white) vs Stockfish (black)
  useEffect(() => {
    if (gameOver || isThinking) return;

    const playTurn = async () => {
      const chess = new Chess(game.fen());
      chess.loadPgn(game.pgn());

      if (checkGameOver(chess)) return;

      setIsThinking(true);
      const historySnapshot = chess
        .history({ verbose: true })
        .map((m) => m.from + m.to + (m.promotion || ""));

      let moveUci;
      if (chess.turn() === "w") {
        // GPT-5 plays as White
        console.log("🤖 GPT-5 thinking...");
        moveUci = await getGptMove(chess.fen(), historySnapshot);
      } else {
        // Stockfish plays as Black
        console.log("🧠 Stockfish thinking...");
        moveUci = await getStockfishMove(chess.fen(), historySnapshot);
      }

      if (moveUci) {
        try {
          const move = chess.move({
            from: moveUci.slice(0, 2),
            to: moveUci.slice(2, 4),
            promotion: moveUci[4] || "q",
          });

          if (move) {
            highlightMove(move.from, move.to);
            setGame(new Chess(chess.fen()));
            setMoveHistory((prev) => [...prev, move.san]);
            checkGameOver(chess);
          }
        } catch (err) {
          console.warn("Invalid move:", moveUci, err.message);
        }
      }
      setIsThinking(false);
    };

    // play one move at a time with small delay
    const delay = setTimeout(playTurn, 800); // 🕒 0.8s pause between moves
    return () => clearTimeout(delay);
  }, [game, gameOver]);

  // ♟️ UI rendering (same as before)
  return (
    <div style={{ overflow: "hidden" }}>
      <h1 className="Title">🤖 GPT-5 (White) vs ♟️ Stockfish (Black)</h1>
      <h2 style={{ textAlign: "center" }}>
        {gameOver
          ? `Game Over — ${winner}`
          : isThinking
          ? "Thinking..."
          : `Turn: ${game.turn() === "w" ? "GPT-5 (White)" : "Stockfish (Black)"}`}
      </h2>

      <div className="ChessBoardGame">
        <div style={{ position: "relative" }}>
          <div className="ChessBoxes">
            {numbers.map((num, row) =>
              letters.map((_, col) => {
                const square = `${letters[col]}${num}`;
                const piece = game.get(square);
                const isDark = (row + col) % 2 === 1;
                const isLastMove = lastMoveSquares.includes(square);

                const pieceSymbol =
                  piece?.type && unicodePieces[piece.type][piece.color];
                const pieceColor =
                  piece?.color === "w" ? "#FFD700" : "#0e39e9ff";

                return (
                  <div
                    key={square}
                    className="Box"
                    style={{
                      backgroundColor: isLastMove
                        ? "#90EE90"
                        : isDark
                        ? "#000"
                        : "#fff",
                      boxShadow: isLastMove
                        ? "0 0 10px 3px rgba(0,255,0,0.5)"
                        : "none",
                      color: pieceColor,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      fontSize: "2.2rem",
                      cursor: "default",
                      transition: "background-color 0.5s ease",
                    }}
                  >
                    {pieceSymbol}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {gameOver && (
        <div className="overlay">
          <div className="gameover-card">
            <h1 className="winner-text">{winner}</h1>
            <button onClick={restartGame} className="btn restart">
              🔄 Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChessBoardGame;
