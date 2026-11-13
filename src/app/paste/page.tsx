import { redirect } from "next/navigation";

/** Paste mode moved to the home page. Old links keep working. */
export default function PastePage(): never {
  redirect("/");
}
