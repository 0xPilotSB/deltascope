import { DurableObject } from "cloudflare:workers";

// ─── Types ─────────────────────────────────────────────────

interface UserRow {
  id: string;
  display_name: string;
  points: number;
  wins: number;
  losses: number;
  streak: number;
  best_streak: number;
  created_at: string;
}

interface PredictionRow {
  id: number;
  user_id: string;
  asset: string;
  direction: string;
  entry_price: number;
  target_time: number;
  duration: number;
  wager: number;
  status: string;
  exit_price: number | null;
  points_delta: number | null;
  created_at: string;
  resolved_at: string | null;
}

interface LeaderboardEntry extends UserRow {
  rank: number;
  win_rate: number;
}

const VALID_ASSETS = ["BTC", "ETH", "SOL", "HYPE", "ARB", "DOGE", "AVAX", "LINK"];
const VALID_DURATIONS = [60, 300];
const VALID_WAGERS = [10, 25, 50, 100];
const STARTING_POINTS = 1000;
const RESET_POINTS = 500;

// ─── PredictionGame DO ─────────────────────────────────────

export class PredictionGame extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT 'Anon',
        points INTEGER NOT NULL DEFAULT ${STARTING_POINTS},
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        asset TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry_price REAL NOT NULL,
        target_time INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        wager INTEGER NOT NULL DEFAULT 10,
        status TEXT NOT NULL DEFAULT 'pending',
        exit_price REAL,
        points_delta INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_predictions_pending
        ON predictions(status, target_time) WHERE status = 'pending';

      CREATE INDEX IF NOT EXISTS idx_predictions_user
        ON predictions(user_id, created_at DESC);
    `);
  }

  // ─── RPC Methods ───────────────────────────────────────

  async ensureUser(userId: string): Promise<UserRow> {
    this.sql.exec(
      `INSERT OR IGNORE INTO users (id) VALUES (?)`,
      userId
    );
    const rows = [...this.sql.exec<UserRow>(
      `SELECT * FROM users WHERE id = ?`,
      userId
    )];
    return rows[0];
  }

  async placePrediction(
    userId: string,
    asset: string,
    direction: string,
    duration: number,
    wager: number
  ): Promise<{ prediction?: PredictionRow; error?: string }> {
    // Validate inputs
    if (!VALID_ASSETS.includes(asset)) return { error: "Invalid asset" };
    if (direction !== "up" && direction !== "down") return { error: "Invalid direction" };
    if (!VALID_DURATIONS.includes(duration)) return { error: "Invalid duration" };
    if (!VALID_WAGERS.includes(wager)) return { error: "Invalid wager" };

    // Ensure user exists and check balance
    const user = await this.ensureUser(userId);
    if (user.points < wager) return { error: "Insufficient points" };

    // Check max active predictions (limit to 5)
    const activeCount = [...this.sql.exec<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM predictions WHERE user_id = ? AND status = 'pending'`,
      userId
    )][0].cnt;
    if (activeCount >= 5) return { error: "Max 5 active predictions" };

    // Fetch current price from PriceAggregator
    const entryPrice = await this.fetchCurrentPrice(asset);
    if (!entryPrice) return { error: "Price unavailable" };

    const now = Date.now();
    const targetTime = now + duration * 1000;

    // Deduct wager atomically with insert
    this.sql.exec(
      `UPDATE users SET points = points - ? WHERE id = ? AND points >= ?`,
      wager, userId, wager
    );

    this.sql.exec(
      `INSERT INTO predictions (user_id, asset, direction, entry_price, target_time, duration, wager)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId, asset, direction, entryPrice, targetTime, duration, wager
    );

    const prediction = [...this.sql.exec<PredictionRow>(
      `SELECT * FROM predictions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      userId
    )][0];

    // Schedule settlement alarm
    await this.scheduleAlarm(targetTime);

    return { prediction };
  }

  async getActivePredictions(userId: string): Promise<PredictionRow[]> {
    return [...this.sql.exec<PredictionRow>(
      `SELECT * FROM predictions WHERE user_id = ? AND status = 'pending' ORDER BY target_time ASC`,
      userId
    )];
  }

  async getUserHistory(userId: string, limit: number = 10): Promise<PredictionRow[]> {
    return [...this.sql.exec<PredictionRow>(
      `SELECT * FROM predictions WHERE user_id = ? AND status != 'pending' ORDER BY resolved_at DESC LIMIT ?`,
      userId, limit
    )];
  }

  async getLeaderboard(limit: number = 20): Promise<LeaderboardEntry[]> {
    const rows = [...this.sql.exec<UserRow>(
      `SELECT * FROM users ORDER BY points DESC LIMIT ?`,
      limit
    )];
    return rows.map((row, i) => ({
      ...row,
      rank: i + 1,
      win_rate: (row.wins + row.losses) > 0
        ? Math.round((row.wins / (row.wins + row.losses)) * 100)
        : 0,
    }));
  }

  async setDisplayName(userId: string, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) return;
    await this.ensureUser(userId);
    this.sql.exec(
      `UPDATE users SET display_name = ? WHERE id = ?`,
      trimmed, userId
    );
  }

  async resetPoints(userId: string): Promise<UserRow> {
    const user = await this.ensureUser(userId);
    if (user.points > 0) return user; // Only reset when broke
    this.sql.exec(
      `UPDATE users SET points = ?, streak = 0 WHERE id = ?`,
      RESET_POINTS, userId
    );
    return { ...user, points: RESET_POINTS, streak: 0 };
  }

  async getUserStats(userId: string): Promise<UserRow> {
    return this.ensureUser(userId);
  }

  // ─── Settlement ────────────────────────────────────────

  async alarm(): Promise<void> {
    const now = Date.now();

    const pending = [...this.sql.exec<PredictionRow>(
      `SELECT * FROM predictions WHERE status = 'pending' AND target_time <= ?`,
      now
    )];

    if (pending.length === 0) {
      // Check if there are future pending predictions to schedule for
      const next = [...this.sql.exec<{ target_time: number }>(
        `SELECT target_time FROM predictions WHERE status = 'pending' ORDER BY target_time ASC LIMIT 1`
      )];
      if (next.length > 0) {
        await this.scheduleAlarm(next[0].target_time);
      }
      return;
    }

    // Fetch current prices for all needed assets
    const assets = [...new Set(pending.map(p => p.asset))];
    const prices = await this.fetchPrices(assets);

    for (const pred of pending) {
      const exitPrice = prices.get(pred.asset);
      if (!exitPrice) {
        // Price unavailable — refund
        this.sql.exec(
          `UPDATE predictions SET status = 'expired', resolved_at = datetime('now') WHERE id = ?`,
          pred.id
        );
        this.sql.exec(
          `UPDATE users SET points = points + ? WHERE id = ?`,
          pred.wager, pred.user_id
        );
        continue;
      }

      const wentUp = exitPrice > pred.entry_price;
      const wentDown = exitPrice < pred.entry_price;
      const isExactlyEqual = exitPrice === pred.entry_price;

      let won: boolean;
      if (isExactlyEqual) {
        // Price didn't move — refund
        this.sql.exec(
          `UPDATE predictions SET status = 'expired', exit_price = ?, points_delta = 0, resolved_at = datetime('now') WHERE id = ?`,
          exitPrice, pred.id
        );
        this.sql.exec(
          `UPDATE users SET points = points + ? WHERE id = ?`,
          pred.wager, pred.user_id
        );
        continue;
      }

      won = (pred.direction === "up" && wentUp) || (pred.direction === "down" && wentDown);

      if (won) {
        // Get current streak for bonus calculation
        const user = [...this.sql.exec<UserRow>(
          `SELECT * FROM users WHERE id = ?`,
          pred.user_id
        )][0];

        const newStreak = user.streak + 1;
        const streakBonus = newStreak >= 3 ? Math.floor(pred.wager * 0.1 * (newStreak - 2)) : 0;
        const pointsDelta = pred.wager + streakBonus;
        const bestStreak = Math.max(user.best_streak, newStreak);

        this.sql.exec(
          `UPDATE predictions SET status = 'won', exit_price = ?, points_delta = ?, resolved_at = datetime('now') WHERE id = ?`,
          exitPrice, pointsDelta, pred.id
        );
        // Return original wager + winnings (wager + streakBonus)
        this.sql.exec(
          `UPDATE users SET points = points + ?, wins = wins + 1, streak = ?, best_streak = ? WHERE id = ?`,
          pred.wager + pointsDelta, newStreak, bestStreak, pred.user_id
        );
      } else {
        this.sql.exec(
          `UPDATE predictions SET status = 'lost', exit_price = ?, points_delta = ?, resolved_at = datetime('now') WHERE id = ?`,
          exitPrice, -pred.wager, pred.id
        );
        this.sql.exec(
          `UPDATE users SET losses = losses + 1, streak = 0 WHERE id = ?`,
          pred.user_id
        );
      }
    }

    // Reschedule if more pending predictions exist
    const nextPending = [...this.sql.exec<{ target_time: number }>(
      `SELECT target_time FROM predictions WHERE status = 'pending' ORDER BY target_time ASC LIMIT 1`
    )];
    if (nextPending.length > 0) {
      await this.scheduleAlarm(nextPending[0].target_time);
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  private async scheduleAlarm(targetTime: number): Promise<void> {
    // Schedule alarm for 1 second after target_time to allow price to settle
    const alarmTime = new Date(targetTime + 1000);
    const current = await this.ctx.storage.getAlarm();
    if (!current || alarmTime.getTime() < current) {
      await this.ctx.storage.setAlarm(alarmTime);
    }
  }

  private async fetchCurrentPrice(asset: string): Promise<number | null> {
    try {
      const id = this.env.PRICE_AGGREGATOR.idFromName("global");
      const stub = this.env.PRICE_AGGREGATOR.get(id);
      const res = await stub.fetch(new Request("https://internal/prices"));
      const data: any = await res.json();
      const found = data.assets?.find((a: any) => a.symbol === asset);
      return found?.pythPrice ?? found?.markPrice ?? null;
    } catch {
      return null;
    }
  }

  private async fetchPrices(assets: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    try {
      const id = this.env.PRICE_AGGREGATOR.idFromName("global");
      const stub = this.env.PRICE_AGGREGATOR.get(id);
      const res = await stub.fetch(new Request("https://internal/prices"));
      const data: any = await res.json();
      for (const a of data.assets ?? []) {
        if (assets.includes(a.symbol)) {
          prices.set(a.symbol, a.pythPrice ?? a.markPrice);
        }
      }
    } catch {
      // Return empty map — predictions will be refunded
    }
    return prices;
  }

  // ─── HTTP handler (for direct fetch if needed) ─────────

  async fetch(request: Request): Promise<Response> {
    return new Response("PredictionGame DO — use RPC methods", { status: 200 });
  }
}
