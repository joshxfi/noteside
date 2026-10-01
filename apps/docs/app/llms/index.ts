import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export async function loader() {
  return new Response(await llms(source).index());
}
