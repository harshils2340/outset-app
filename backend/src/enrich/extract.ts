import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { CrawledPage } from "./crawl.ts";

/**
 * AI extraction. The model sees only the operator's own pages and fills a fixed schema.
 * Every field is nullable or an empty list. The prompt forbids guessing, and each fact carries the page it came from.
 */

/** Provider is picked from whichever key is present. OPENAI_API_KEY wins when both are set unless OUTSET_EXTRACT_PROVIDER says otherwise. */
export type Provider = "openai" | "anthropic";
export function provider(): Provider {
  const forced = process.env.OUTSET_EXTRACT_PROVIDER as Provider | undefined;
  if (forced === "openai" || forced === "anthropic") return forced;
  if (process.env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}
export function model(): string {
  return process.env.OUTSET_EXTRACT_MODEL || (provider() === "openai" ? "gpt-4.1-mini" : "claude-haiku-4-5-20251001");
}

/** List prices per million tokens. Batch runs are half of this. */
export function priceFor(m: string): { in: number; out: number } {
  if (/gpt-4\.1-nano/.test(m)) return { in: 0.1, out: 0.4 };
  if (/gpt-4\.1-mini/.test(m)) return { in: 0.4, out: 1.6 };
  if (/gpt-4\.1/.test(m)) return { in: 2, out: 8 };
  if (/gpt-5-mini/.test(m)) return { in: 0.25, out: 2 };
  if (/gpt-5/.test(m)) return { in: 1.25, out: 10 };
  if (/haiku/.test(m)) return { in: 1, out: 5 };
  if (/sonnet/.test(m)) return { in: 3, out: 15 };
  return { in: 5, out: 25 };
}

const Money = z.object({
  amount: z.number().nullable().describe("Price as a number in local currency, or null if not stated"),
  unit: z.enum(["person", "group", "hour", "half_day", "full_day", "boat", "vehicle", "room", "trip", "other"]).nullable(),
  currency: z.enum(["USD", "CAD"]).nullable(),
});

const Offering = z.object({
  name: z.string().describe("The service as the operator names it"),
  detail: z.string().nullable().describe("One line: what it is, e.g. '2 hr guided mangrove tour'"),
  duration: z.string().nullable().describe("As stated, e.g. '90 min', '2 hours', 'half day'"),
  price: Money,
  source_url: z.string().describe("Page URL where this offering appears"),
});

const Fact = z.object({
  value: z.string().describe("Short, quoted or closely paraphrased from the page"),
  source_url: z.string(),
});

export const Extraction = z.object({
  business_name: z.string().nullable(),
  one_line: z.string().nullable().describe("What they do, in one plain sentence, from their own words"),
  description: z.string().nullable().describe("At most 3 plain sentences on what guests do. Only what the site says."),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.object({
    street: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable().describe("State or province code, e.g. FL, BC"),
    postal: z.string().nullable(),
  }),
  meeting_point: z.string().nullable().describe("Where guests check in or launch, if different from the address"),
  hours: z.array(z.string()).describe("Opening hours lines as stated, e.g. 'Mon-Fri 9am-5pm'. Empty if not stated."),
  season: z.string().nullable().describe("Operating season if stated, e.g. 'March through October'"),
  offerings: z.array(Offering),
  includes: z.array(Fact).describe("What is included in the price: gear, guide, photos, fuel"),
  requirements: z.array(Fact).describe("Age, weight, height, license, experience, swimming, health rules"),
  policies: z.array(Fact).describe("Cancellation, refund, deposit, weather, late arrival, tipping"),
  what_to_bring: z.array(Fact),
  group_info: z.array(Fact).describe("Capacity, private groups, parties, corporate"),
  highlights: z.array(Fact).describe("Concrete selling points the site states: wildlife, altitude, track length, awards"),
  booking: z.object({
    online_booking: z.boolean().nullable().describe("True if the site has a live online booking flow"),
    vendor: z.string().nullable().describe("Booking software if identifiable: fareharbor, peek, xola, rezdy, checkfront, bookeo, other"),
    booking_url: z.string().nullable(),
  }),
  confidence: z.enum(["high", "medium", "low"]).describe("How clearly the pages state these facts"),
  gaps: z.array(z.string()).describe("Important things a guest would want that the site does not state"),
});

export type ExtractionT = z.infer<typeof Extraction>;

const SYSTEM = `You extract facts about a local experience business from its own website pages, into a fixed form.

Rules:
- Only what the text states. Never add outside knowledge. Never guess, round or convert prices. Empty is correct, invented is a failure.
- Prices: copy the number. "from $85" means amount 85. A range means the low end, with the range in detail.
- Be terse. Values are short phrases or one sentence. No marketing copy. description is at most 3 plain sentences.
- Limits: at most 12 offerings, and at most 6 items in each list. Prefer the facts a guest needs to decide and to show up: price, duration, age, weight, licence, deposit, cancellation, weather, what is included, what to bring.
- Every offering and fact carries the URL of the page it came from.
- gaps: what a guest would still have to ask, e.g. "age minimum not stated".`;

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

export function hasApiKey(): boolean {
  return provider() === "openai"
    ? !!process.env.OPENAI_API_KEY
    : !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getAnthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI();
  return openaiClient;
}

export type ExtractUsage = { input: number; output: number; cacheRead: number };

export function buildDoc(name: string, pages: CrawledPage[]): string {
  const doc = pages.map((p) => `=== PAGE: ${p.url}\nTITLE: ${p.title}\n${p.text}`).join("\n\n").slice(0, 40000);
  return `Business as listed in our directory: ${name}\n\nPages from their website:\n\n${doc}`;
}

/** The exact OpenAI request body, shared by live calls and batch files so both cost and behave the same. */
export function openaiRequestBody(name: string, pages: CrawledPage[]): Record<string, unknown> {
  return {
    model: model(),
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildDoc(name, pages) },
    ],
    response_format: zodResponseFormat(Extraction, "operator_extraction"),
    max_tokens: 3000,
    temperature: 0,
  };
}

/** Parse a raw OpenAI chat completion (live or from a batch file) into the schema. */
export function parseOpenAI(completion: { choices?: { message?: { content?: string | null; refusal?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }): { data: ExtractionT | null; usage: ExtractUsage; refused: boolean } {
  const usage: ExtractUsage = {
    input: completion.usage?.prompt_tokens ?? 0,
    output: completion.usage?.completion_tokens ?? 0,
    cacheRead: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
  const msg = completion.choices?.[0]?.message;
  if (!msg || msg.refusal) return { data: null, usage, refused: !!msg?.refusal };
  try {
    const parsed = Extraction.parse(JSON.parse(msg.content || ""));
    return { data: parsed, usage, refused: false };
  } catch {
    return { data: null, usage, refused: false };
  }
}

export async function extractFromPages(
  name: string,
  pages: CrawledPage[],
): Promise<{ data: ExtractionT | null; usage: ExtractUsage; refused: boolean }> {
  const doc = buildDoc(name, pages);

  if (provider() === "openai") {
    const completion = await getOpenAI().chat.completions.parse({
      model: model(),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: doc },
      ],
      response_format: zodResponseFormat(Extraction, "operator_extraction"),
      max_tokens: 3000,
      temperature: 0,
    });
    const choice = completion.choices[0];
    const usage: ExtractUsage = {
      input: completion.usage?.prompt_tokens ?? 0,
      output: completion.usage?.completion_tokens ?? 0,
      cacheRead: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
    if (choice?.message.refusal) return { data: null, usage, refused: true };
    return { data: (choice?.message.parsed as ExtractionT | null) ?? null, usage, refused: false };
  }

  const response = await getAnthropic().messages.parse({
    model: model(),
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: doc }],
    output_config: { format: zodOutputFormat(Extraction), effort: "low" },
  });

  const usage: ExtractUsage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") return { data: null, usage, refused: true };
  return { data: response.parsed_output ?? null, usage, refused: false };
}
