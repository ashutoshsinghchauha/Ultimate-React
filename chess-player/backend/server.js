import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import { Chess } from "chess.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Utility to pick a random legal move
function randomMove(chess) {
  const moves = chess.moves({ verbose: true });
  const m = moves[Math.floor(Math.random() * moves.length)];
  return m.from + m.to + (m.promotion || "");
}

app.post("/api/gpt-move", async (req, res) => {
  try {
    //using Chat Gpt
    const { fen, history = [] } = req.body;
    const chess = new Chess(fen);

    if (chess.isGameOver()) {
      return res.json({ move: "none", status: "game-over" });
    }

    const color = chess.turn() === "w" ? "White" : "Black";

    const prompt = `
    You are a champion chess engine, not a human and you know all chess rules.
    Your goal is to select one valid legal move in UCI notation based on the current position.

    FEN: ${fen}
    Color to move: ${color}
    Recent moves: ${history.join(", ") || "none"}

    Rules:
    - Only output one legal move in UCI format (e.g., "e2e4" or "g8f6").
    - Do not use SAN format like "Nf6".
    - Do not include punctuation, explanations, or extra words.
    - The move must be valid given the FEN.
    - If no moves are available, respond only with "none".
    - move should not be invalid.

    Your response must be exactly one line containing only the move.
    `;
  
    console.log("GPT prompt:", prompt);

    const completion = await client.chat.completions.create({
      model: "gpt-5",
      messages: [{
        role: "system",
        content: "You are a strict chess engine. Output only one legal move in UCI format (e2e4).",
      },{ role: "user", content: prompt }]
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    console.log("GPT raw:", completion.choices?.[0]?.message);

    let legalMove = null;
    let uci = raw.match(/[a-h][1-8][a-h][1-8][nbrq]?/i)?.[0]?.toLowerCase() || null;

    if (!uci && raw.match(/^[nbrqk]?[a-h][1-8]/i)) {
      try {
        legalMove = chess.move(raw, { sloppy: true });
        if (legalMove) uci = legal.from + legal.to + (legal.promotion || "");
      } catch {}
    }

    // If invalid or null → fallback to random move
    if (uci && !legalMove) {
      try {
        legalMove = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4] || "q",
        });
      } catch (err) {
        console.warn("UCI apply failed:", err.message);
      }
    }

    // ✅ If still invalid → fallback to random move
    if (!legalMove) {
      console.warn("❌ Invalid GPT move, picking random legal move...");
      uci = randomMove(chess);
      legalMove = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || "q",
      });
    }

    // Log for debugging
    console.log({
      raw,
      parsedUci: uci,
      verified: !!legalMove,
      fenAfter: chess.fen(),
    });

    // ✅ Respond
    res.json({
      move: uci,
      fen: chess.fen(),
      verified: !!legalMove,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ai-move", async (req, res) => {

  const { fen, depth = 12 } = req.body;
  const chess = new Chess(fen);
  let responded = false;

  console.log("♟️ Starting Stockfish for FEN:", fen);

  // Use absolute path to Stockfish if needed
  const engine = spawn("/usr/games/stockfish", [], { stdio: ["pipe", "pipe", "pipe"] });

  // Readable stream buffers
  let buffer = "";

  // Handle STDOUT line-by-line
  engine.stdout.on("data", (data) => {
    buffer += data.toString();

    // Split into complete lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // keep incomplete line in buffer

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      console.log("🧠", text);

      if (text.includes("uciok")) {
        console.log("✅ Stockfish ready, sending FEN...");
        engine.stdin.write(`position fen ${fen}\n`);
        engine.stdin.write(`go depth ${depth}\n`);
      }

      if (text.startsWith("bestmove")) {
        const bestMove = text.split(" ")[1];
        console.log("✅ Best move:", bestMove);

        let status = "playing";
        let winner = null;

        try {
          chess.move({
            from: bestMove.slice(0, 2),
            to: bestMove.slice(2, 4),
            promotion: bestMove[4] || "q",
          });
          console.log("✅ Move applied:", bestMove.slice(0, 2),bestMove.slice(2, 4), bestMove[4]);
          if (chess.isCheckmate()) {
            status = "game-over";
            winner = chess.turn() === "w" ? "black" : "white";
          } else if (chess.isDraw() || chess.isStalemate()) {
            status = "draw";
          }
        } catch (err) {
          console.error("❌ Invalid move:", err.message);
          if (!responded) {
            res.status(400).json({ error: "Invalid move" });
            responded = true;
          }
        }

        if (!responded) {
          res.json({
            move: bestMove,
            fen: chess.fen(),
            status,
            winner,
          });
          responded = true;
        }

        engine.stdin.write("quit\n");
        engine.kill();
      }
    }
  });

  engine.stderr.on("data", (data) => {
    console.error("⚠️ STDERR:", data.toString());
  });

  engine.on("error", (err) => {
    console.error("❌ Engine spawn failed:", err);
    if (!responded) {
      res.status(500).json({ error: "Stockfish failed to start" });
      responded = true;
    }
  });

  // Init Stockfish
  engine.stdin.write("uci\n");

  // Timeout in case of hang
  setTimeout(() => {
    if (!responded) {
      console.warn("⚠️ Timeout: No Stockfish response.");
      res.status(504).json({ error: "Stockfish timeout" });
      responded = true;
      engine.kill();
    }
  }, 5000);

  // try {
  //   //using Chat Gpt
  //   const { fen, history = [] } = req.body;
  //   const chess = new Chess(fen);

  //   if (chess.isGameOver()) {
  //     return res.json({ move: "none", status: "game-over" });
  //   }

  //   const color = chess.turn() === "w" ? "White" : "Black";

  //   const prompt = `
  //   You are a champion chess engine, not a human and you know all chess rules.
  //   Your goal is to select one valid legal move in UCI notation based on the current position.

  //   FEN: ${fen}
  //   Color to move: ${color}
  //   Recent moves: ${history.join(", ") || "none"}

  //   Rules:
  //   - Only output one legal move in UCI format (e.g., "e2e4" or "g8f6").
  //   - Do not use SAN format like "Nf6".
  //   - Do not include punctuation, explanations, or extra words.
  //   - The move must be valid given the FEN.
  //   - If no moves are available, respond only with "none".
  //   - move should not be invalid.

  //   Your response must be exactly one line containing only the move.
  //   `;
  
  //   console.log("GPT prompt:", prompt);

  //   const completion = await client.chat.completions.create({
  //     model: "gpt-4o",
  //     messages: [{
  //       role: "system",
  //       content: "You are a strict chess engine. Output only one legal move in UCI format (e2e4).",
  //     },{ role: "user", content: prompt }]
  //   });

  //   const raw = completion.choices?.[0]?.message?.content || "";
  //   console.log("GPT raw:", completion.choices?.[0]?.message);

  //   let legalMove = null;
  //   let uci = raw.match(/[a-h][1-8][a-h][1-8][nbrq]?/i)?.[0]?.toLowerCase() || null;

  //   if (!uci && raw.match(/^[nbrqk]?[a-h][1-8]/i)) {
  //     try {
  //       legalMove = chess.move(raw, { sloppy: true });
  //       if (legalMove) uci = legal.from + legal.to + (legal.promotion || "");
  //     } catch {}
  //   }

  //   // If invalid or null → fallback to random move
  //   if (uci && !legalMove) {
  //     try {
  //       legalMove = chess.move({
  //         from: uci.slice(0, 2),
  //         to: uci.slice(2, 4),
  //         promotion: uci[4] || "q",
  //       });
  //     } catch (err) {
  //       console.warn("UCI apply failed:", err.message);
  //     }
  //   }

  //   // ✅ If still invalid → fallback to random move
  //   if (!legalMove) {
  //     console.warn("❌ Invalid GPT move, picking random legal move...");
  //     uci = randomMove(chess);
  //     legalMove = chess.move({
  //       from: uci.slice(0, 2),
  //       to: uci.slice(2, 4),
  //       promotion: uci[4] || "q",
  //     });
  //   }

  //   // Log for debugging
  //   console.log({
  //     raw,
  //     parsedUci: uci,
  //     verified: !!legalMove,
  //     fenAfter: chess.fen(),
  //   });

  //   // ✅ Respond
  //   res.json({
  //     move: uci,
  //     fen: chess.fen(),
  //     verified: !!legalMove,
  //   });
  // } catch (err) {
  //   console.error(err);
  //   res.status(500).json({ error: err.message });
  // }
});


// app.get("/api/ai-comments", async (req,res)=>{
//   // i want to get the file content of the file /var/www/html/Ultimate-React/chess-player/src/ChessBoardGame.jsx
//   // and return it as a response
//   try {
//     const filePath =
//       "/var/www/html/Ultimate-React/chess-player/src/ChessBoardGame.jsx";
//     const content = fs.readFileSync(filePath, "utf8");

//     const commentprompt = `you are a good assistant and you have to provide help comment each function of this code ${content}  so that a user can understand the functionality of the code.`
//     const helpcomment = await client.chat.completions.create({
//           model: "gpt-5",
//           messages: [{ role: "user", content: commentprompt }],
//         });

//         console.log("GPT:", helpcomment);
//     const outputcode = helpcomment.choices[0].message.content.trim();
//     console.log("GPT:", outputcode);
//     res.type("text/plain").send(outputcode);
//   } catch (err) {
//     console.error("File read error:", err);
//     res.status(500).json({ error: err.message });
//   }
// })

app.listen(5000, () => console.log("✅ AI server running on port 5000"));
