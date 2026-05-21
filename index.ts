import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/serve-static";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";

const app = new Hono();

// CORS
app.use("*", cors());

// PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Liste des joueurs
const playersList = [
  { name: "Lorik", birth_date: "13/05/2008" },
  { name: "Guilhem", birth_date: "24/11/2008" },
  { name: "Thomas", birth_date: "20/10/2008" },
  { name: "Mathias", birth_date: "30/05/2008" },
  { name: "Timéo", birth_date: "28/05/2008" },
  { name: "Dorian", birth_date: "05/08/2008" },
  { name: "Elias", birth_date: "19/08/2009" },
  { name: "Rafaël", birth_date: "17/11/2008" }
];

// Init DB
async function initDB() {
  const client = await pool.connect();
  try {
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'photos'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      await client.query(`
        CREATE TABLE photos (
          id UUID PRIMARY KEY,
          player_name VARCHAR(255) NOT NULL,
          url TEXT NOT NULL,
          elo_rating INT DEFAULT 1200,
          created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE votes (
          id UUID PRIMARY KEY,
          photo1_id UUID NOT NULL REFERENCES photos(id),
          photo2_id UUID NOT NULL REFERENCES photos(id),
          winner_id UUID NOT NULL REFERENCES photos(id),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log("Tables created");
    } else {
      console.log("Tables already exist");
    }
  } finally {
    client.release();
  }
}

await initDB();

// Serve frontend
app.get("/*", serveStatic({ root: "./frontend", index: "index.html" }));

// Auth login
app.post("/api/auth/login", async (c) => {
  try {
    const { name, birth_date } = await c.req.json();
    const player = playersList.find(
      p => p.name.toLowerCase() === name.toLowerCase() && p.birth_date === birth_date
    );
    if (!player) return c.json({ error: "Joueur non trouvé" }, 401);
    return c.json({ name: player.name });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Get all photos
app.get("/api/photos", async (c) => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT id, url, elo_rating, player_name FROM photos ORDER BY elo_rating DESC"
    );
    return c.json(res.rows);
  } finally {
    client.release();
  }
});

// Upload photo
app.post("/api/photos", async (c) => {
  const { player_name, url } = await c.req.json();
  const client = await pool.connect();
  try {
    const id = uuidv4();
    await client.query(
      "INSERT INTO photos (id, player_name, url) VALUES ($1, $2, $3)",
      [id, player_name, url]
    );
    return c.json({ id, player_name, url, elo_rating: 1200 });
  } finally {
    client.release();
  }
});

// Vote
app.post("/api/vote", async (c) => {
  const { photo1_id, photo2_id, winner_id } = await c.req.json();
  const client = await pool.connect();
  try {
    // Check if duel already happened
    const check = await client.query(
      "SELECT * FROM votes WHERE (photo1_id=$1 AND photo2_id=$2) OR (photo1_id=$2 AND photo2_id=$1)",
      [photo1_id, photo2_id]
    );
    if (check.rows.length > 0) {
      return c.json({ error: "Ce duel a déjà eu lieu" }, 400);
    }

    const voteId = uuidv4();
    await client.query(
      "INSERT INTO votes (id, photo1_id, photo2_id, winner_id) VALUES ($1, $2, $3, $4)",
      [voteId, photo1_id, photo2_id, winner_id]
    );

    const loser_id = winner_id === photo1_id ? photo2_id : photo1_id;
    await client.query(
      "UPDATE photos SET elo_rating = elo_rating + 16 WHERE id = $1",
      [winner_id]
    );
    await client.query(
      "UPDATE photos SET elo_rating = elo_rating - 16 WHERE id = $1",
      [loser_id]
    );

    return c.json({ success: true });
  } finally {
    client.release();
  }
});

export default app;
