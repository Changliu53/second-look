import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";

/**
 * Prints how many tokens the reviews stored in the database have used, and a
 * rough cost. It reads the database only and calls no model.
 *
 *   npm run usage
 *
 * Eval runs and example builds are not stored in the database, so they are
 * not counted here.
 */

// Dollars per million tokens. Adjust when the model or its price changes.
const INPUT_PRICE = 4;
const OUTPUT_PRICE = 20;

type UsageRow = {
  source: string;
  reviews: number;
  input_tokens: number;
  output_tokens: number;
};

try {
  process.loadEnvFile(".env.local");
} catch {
  // DATABASE_URL may come from the shell instead.
}

const result: unknown = await getDb().execute(sql`
  select
    source,
    count(*)::int as reviews,
    coalesce(sum(input_tokens), 0)::int as input_tokens,
    coalesce(sum(output_tokens), 0)::int as output_tokens
  from reviews
  group by source
  order by source
`);
// The Neon driver returns { rows }, the test driver returns the array itself.
const rows = (
  Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
) as UsageRow[];

let total = 0;
for (const row of rows) {
  const cost = (row.input_tokens * INPUT_PRICE + row.output_tokens * OUTPUT_PRICE) / 1_000_000;
  total += cost;
  console.log(
    `${row.source.padEnd(7)} ${String(row.reviews).padStart(4)} reviews  ` +
      `${String(row.input_tokens).padStart(9)} in  ${String(row.output_tokens).padStart(8)} out  ` +
      `about $${cost.toFixed(2)}`,
  );
}
console.log(`total about $${total.toFixed(2)} at $${INPUT_PRICE}/$${OUTPUT_PRICE} per million tokens`);
