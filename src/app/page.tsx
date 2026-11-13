import { EXAMPLES, findExample } from "@/examples/examples";
import { getSavedResult } from "@/examples/saved";
import { Workbench } from "./workbench";

type PageProps = {
  searchParams: Promise<{ example?: string }>;
};

/**
 * The landing route is the product itself, not a description of it.
 * /?example=<id> opens an example with its saved review, so a link to one can
 * be shared and the server sends the full result in the first response.
 */
export default async function HomePage({ searchParams }: PageProps) {
  // With no example in the URL the first one is shown, so a first-time
  // visitor lands on a working review instead of an empty screen.
  const requested = (await searchParams).example;
  const selected = requested === "none" ? null : (findExample(requested) ?? EXAMPLES[0] ?? null);
  const saved = selected ? getSavedResult(selected.id) : null;

  // The key resets the workbench's state when the visitor switches examples.
  return (
    <Workbench
      key={selected?.id ?? "none"}
      examples={EXAMPLES}
      selected={selected}
      saved={saved}
    />
  );
}
