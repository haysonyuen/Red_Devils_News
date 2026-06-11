import axios from "axios";

interface LlmJsonOptions {
  model?: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export async function callLlmJson(
  systemPrompt: string,
  userPrompt: string,
  options: LlmJsonOptions
): Promise<unknown> {
  const baseUrl = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
  const model = options.model || process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!model) throw new Error("LLM_MODEL is not set");

  const response = await axios.post(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: options.schemaName,
          strict: true,
          schema: options.schema,
        },
      },
      temperature: 0.2,
    },
    {
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      timeout: 120_000,
    }
  );

  const raw = response.data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    throw new Error("LLM returned no message content");
  }

  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 300)}`);
  }
}
