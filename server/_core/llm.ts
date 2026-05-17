import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

/**
 * callType hints help the LLM helper pick a sensible default max_tokens.
 * Callers can always override with an explicit maxTokens value.
 *
 * Defaults:
 *   chat / advisor        → 1024   (conversational, should be snappy)
 *   war_room_agent        → 512    (one agent's focused output)
 *   weekly_briefing       → 2048   (longer narrative report)
 *   retrospective         → 1536   (career / season review)
 *   json_structured       → 1024   (JSON schema responses)
 *   fallback              → 1024
 */
export type LLMCallType =
  | "chat"
  | "advisor"
  | "war_room_agent"
  | "weekly_briefing"
  | "retrospective"
  | "json_structured"
  | "draft_helper";

const CALL_TYPE_DEFAULTS: Record<LLMCallType, number> = {
  chat: 1024,
  advisor: 1024,
  war_room_agent: 512,
  weekly_briefing: 2048,
  retrospective: 1536,
  json_structured: 1024,
  draft_helper: 1024,
};

const DEFAULT_MAX_TOKENS = 1024;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  /** Optional model override. Defaults to "gemini-2.5-flash". */
  model?: string;
  /** Optional temperature override (0.0–2.0). */
  temperature?: number;
  /** Hint used to pick a sensible default max_tokens when none is specified. */
  callType?: LLMCallType;
  /**
   * Optional callback to persist usage metrics to the DB.
   * Keeps llm.ts infrastructure-free — callers decide whether to persist.
   * Called after the response completes (or after the stream closes).
   */
  persistUsage?: (usage: {
    callType: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    streaming: boolean;
  }) => void;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const resolveApiUrl = () =>
  ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : "https://forge.manus.im/v1/chat/completions";

const assertApiKey = () => {
  if (!ENV.forgeApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

/**
 * Resolve the effective max_tokens for a call.
 * Priority: explicit maxTokens/max_tokens > callType default > global default.
 */
function resolveMaxTokens(params: InvokeParams): number {
  const explicit = params.maxTokens ?? params.max_tokens;
  if (explicit != null && explicit > 0) return explicit;
  if (params.callType) return CALL_TYPE_DEFAULTS[params.callType] ?? DEFAULT_MAX_TOKENS;
  return DEFAULT_MAX_TOKENS;
}

/**
 * Safe usage logger — logs model, callType, token counts, and durationMs.
 * Never logs message content or API keys.
 */
function logUsage(opts: {
  model: string;
  callType?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs: number;
}) {
  const { model, callType, promptTokens, completionTokens, totalTokens, durationMs } = opts;
  console.log(
    `[LLM] model=${model} callType=${callType ?? "unspecified"} ` +
    `prompt=${promptTokens ?? "?"} completion=${completionTokens ?? "?"} ` +
    `total=${totalTokens ?? "?"} durationMs=${durationMs}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Standard (non-streaming) LLM invocation.
 * All existing callers continue to work without changes.
 */
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    model,
    temperature,
    callType,
  } = params;

  const resolvedModel = model ?? "gemini-2.5-flash";
  const resolvedMaxTokens = resolveMaxTokens(params);

  const payload: Record<string, unknown> = {
    model: resolvedModel,
    messages: messages.map(normalizeMessage),
    max_tokens: resolvedMaxTokens,
    thinking: { budget_tokens: 128 },
  };

  if (temperature != null) {
    payload.temperature = temperature;
  }

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const startMs = Date.now();

  const response = await fetch(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  const result = (await response.json()) as InvokeResult;
  const durationMs = Date.now() - startMs;

  const usageData = {
    callType: callType ?? "unspecified",
    model: result.model ?? resolvedModel,
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
    durationMs,
    streaming: false,
  };

  logUsage({
    model: usageData.model,
    callType,
    promptTokens: usageData.promptTokens,
    completionTokens: usageData.completionTokens,
    totalTokens: usageData.totalTokens,
    durationMs,
  });

  // Fire-and-forget DB persistence if caller provided a hook
  if (params.persistUsage) {
    try { params.persistUsage(usageData); } catch { /* never throw */ }
  }

  // Global usage tracking — always fires, zero changes needed at call sites
  try {
    const { trackLLMEvent } = await import("../usageTracker");
    trackLLMEvent({
      featureName: callType ?? "llm.unspecified",
      callType: callType ?? "unspecified",
      model: usageData.model,
      promptTokens: usageData.promptTokens,
      completionTokens: usageData.completionTokens,
      totalTokens: usageData.totalTokens,
      durationMs: usageData.durationMs,
      streaming: false,
    });
  } catch { /* never block */ }

  return result;
}

/**
 * Streaming LLM invocation — yields text delta chunks via an async generator.
 *
 * Usage:
 *   for await (const chunk of invokeLLMStream({ messages, callType: "advisor" })) {
 *     res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
 *   }
 *
 * Only use this for the GM Advisor chat endpoint. All other callers use invokeLLM.
 */
export async function* invokeLLMStream(
  params: InvokeParams
): AsyncGenerator<string, void, unknown> {
  assertApiKey();

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    model,
    temperature,
    callType,
  } = params;

  const resolvedModel = model ?? "gemini-2.5-flash";
  const resolvedMaxTokens = resolveMaxTokens(params);

  const payload: Record<string, unknown> = {
    model: resolvedModel,
    messages: messages.map(normalizeMessage),
    max_tokens: resolvedMaxTokens,
    stream: true,
    thinking: { budget_tokens: 128 },
  };

  if (temperature != null) {
    payload.temperature = temperature;
  }

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  const startMs = Date.now();

  const response = await fetch(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM stream failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  if (!response.body) {
    throw new Error("LLM stream: response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let totalTokens: number | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
          };

          // Capture usage if present (often on the final chunk)
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens;
            completionTokens = parsed.usage.completion_tokens;
            totalTokens = parsed.usage.total_tokens;
          }

          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        } catch {
          // Malformed SSE chunk — skip silently
        }
      }
    }
  } finally {
    reader.releaseLock();
    const finalDurationMs = Date.now() - startMs;
    logUsage({
      model: resolvedModel,
      callType,
      promptTokens,
      completionTokens,
      totalTokens,
      durationMs: finalDurationMs,
    });

    // Fire-and-forget DB persistence if caller provided a hook
    if (params.persistUsage) {
      try {
        params.persistUsage({
          callType: callType ?? "unspecified",
          model: resolvedModel,
          promptTokens: promptTokens ?? 0,
          completionTokens: completionTokens ?? 0,
          totalTokens: totalTokens ?? 0,
          durationMs: finalDurationMs,
          streaming: true,
        });
      } catch { /* never throw */ }
    }
    // Global usage tracking for streaming calls
    try {
      const { trackLLMEvent } = await import("../usageTracker");
      trackLLMEvent({
        featureName: callType ?? "llm.unspecified",
        callType: callType ?? "unspecified",
        model: resolvedModel,
        promptTokens: promptTokens ?? 0,
        completionTokens: completionTokens ?? 0,
        totalTokens: totalTokens ?? 0,
        durationMs: finalDurationMs,
        streaming: true,
      });
    } catch { /* never block */ }
  }
}
