import { redirect } from "next/navigation";

/** The example review moved to /example. Old links keep working. */
export default function DemoPage(): never {
  redirect("/example");
}
