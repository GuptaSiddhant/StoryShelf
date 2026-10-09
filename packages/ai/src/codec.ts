/** Evidence → messages, one structured call, one schema-repair retry. */
import { AiError, type AiEvidence, type AiTask, type AiUsageReport } from "@storyshelf/core/ai";
import {
  APICallError,
  generateText,
  JSONParseError,
  NoObjectGeneratedError,
  Output,
  TypeValidationError,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";
import type { z } from "zod";
import type { SlotProviderOptions } from "./types.ts";

/** One structured call's parameters. */
export interface StructuredCall<T> {
  model: LanguageModel;
  task: AiTask;
  system: string;
  evidence: AiEvidence;
  schema: z.ZodType<T>;
  maxTokens: number;
  /** Provider-specific settings from the slot (forwarded unchanged). */
  providerOptions?: SlotProviderOptions | undefined;
  signal: AbortSignal;
  /** Send images (false = text-only fallback). */
  withImages: boolean;
}

/** Parsed result plus accumulated usage. */
export interface StructuredResult<T> {
  object: T;
  usage: AiUsageReport;
  imagesSent: number;
}

function userMessage(evidence: AiEvidence, withImages: boolean): ModelMessage {
  const images = withImages ? evidence.images : [];
  return {
    role: "user",
    content: [
      { type: "text", text: evidence.text },
      ...images.flatMap((image) => [
        { type: "text" as const, text: `Screenshot: ${image.label}` },
        { type: "image" as const, image: image.data, mediaType: image.mediaType },
      ]),
    ],
  };
}

/** Provider-reported usage, or a char/4 estimate flagged `estimated`. */
export function toUsage(fallbackChars: number, usage?: LanguageModelUsage): AiUsageReport {
  if (usage?.inputTokens !== undefined || usage?.outputTokens !== undefined) {
    return {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      estimated: false,
    };
  }
  return { inputTokens: Math.ceil(fallbackChars / 4), outputTokens: 0, estimated: true };
}

function sum(
  a: AiUsageReport | undefined,
  b: AiUsageReport | undefined,
): AiUsageReport | undefined {
  if (!a || !b) {
    return a ?? b;
  }
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimated: a.estimated || b.estimated,
  };
}

/** True for failures a "reply with valid JSON" retry can fix. */
export function isSchemaFailure(error: unknown): boolean {
  return (
    NoObjectGeneratedError.isInstance(error) ||
    TypeValidationError.isInstance(error) ||
    JSONParseError.isInstance(error)
  );
}

function classify(error: unknown): AiError["code"] {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError") {
    return "timeout";
  }
  if (name === "AbortError") {
    return "aborted";
  }
  if (APICallError.isInstance(error)) {
    return "provider";
  }
  return isSchemaFailure(error) ? "schema" : "unknown";
}

/** Map any thrown value to an {@link AiError} (carrying known usage). */
export function toAiError(error: unknown, usage?: AiUsageReport): AiError {
  if (error instanceof AiError) {
    return error;
  }
  const message = error instanceof Error ? error.message.slice(0, 300) : "unknown error";
  return new AiError(classify(error), message, usage, { cause: error });
}

type Attempt<T> =
  | { ok: true; object: T; usage: AiUsageReport }
  | { ok: false; error: unknown; usage: AiUsageReport | undefined };

async function attempt<T>(
  call: StructuredCall<T>,
  messages: ModelMessage[],
  chars: number,
): Promise<Attempt<T>> {
  try {
    const result = await generateText({
      model: call.model,
      instructions: call.system,
      messages,
      output: Output.object({ schema: call.schema }),
      maxOutputTokens: call.maxTokens,
      ...(call.providerOptions ? { providerOptions: call.providerOptions } : {}),
      maxRetries: 0,
      abortSignal: call.signal,
      telemetry: {
        functionId: `storyshelf-${call.task}`,
        recordInputs: false,
        recordOutputs: false,
      },
    });
    return { ok: true, object: result.output, usage: toUsage(chars, result.usage) };
  } catch (error) {
    const usage = NoObjectGeneratedError.isInstance(error)
      ? toUsage(chars, error.usage)
      : undefined;
    return { ok: false, error, usage };
  }
}

const REPAIR: ModelMessage = {
  role: "user",
  content: [
    {
      type: "text",
      text: "Your previous reply was not valid. Reply with only a JSON object matching the schema.",
    },
  ],
};

async function retryOnce<T>(
  call: StructuredCall<T>,
  messages: ModelMessage[],
  chars: number,
  first: Extract<Attempt<T>, { ok: false }>,
): Promise<{ object: T; usage: AiUsageReport }> {
  const second = await attempt(call, [...messages, REPAIR], chars);
  if (second.ok) {
    return { object: second.object, usage: sum(first.usage, second.usage) ?? second.usage };
  }
  throw toAiError(second.error, sum(first.usage, second.usage));
}

/** Run the call; on a schema failure retry once asking for valid JSON only. */
export async function runStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const chars = call.system.length + call.evidence.text.length;
  const messages: ModelMessage[] = [userMessage(call.evidence, call.withImages)];
  const imagesSent = call.withImages ? call.evidence.images.length : 0;
  const first = await attempt(call, messages, chars);
  if (first.ok) {
    return { object: first.object, usage: first.usage, imagesSent };
  }
  if (!isSchemaFailure(first.error)) {
    throw toAiError(first.error, first.usage);
  }
  return { ...(await retryOnce(call, messages, chars, first)), imagesSent };
}
