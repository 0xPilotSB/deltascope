import { z } from "zod";

export const PlacePredictionSchema = z.object({
  asset: z.enum(["BTC", "ETH", "SOL", "HYPE", "ARB", "DOGE", "AVAX", "LINK"]),
  direction: z.enum(["up", "down"]),
  duration: z.coerce.number().refine(v => [60, 300].includes(v), "Invalid duration"),
  wager: z.coerce.number().refine(v => [10, 25, 50, 100].includes(v), "Invalid wager"),
});

export const SetDisplayNameSchema = z.object({
  displayName: z.string().min(1).max(20).trim(),
});
