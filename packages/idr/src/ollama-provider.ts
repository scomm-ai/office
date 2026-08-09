import { IdrConnectionError } from "@scomm-office/core";
import type { IdrTransport } from "./transport.js";

export interface AiGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: Record<string, unknown>;
}

export interface AiGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export interface AiProvider {
  generate(request: AiGenerateRequest): Promise<AiGenerateResponse>;
}

const ollamaTagsSchema = {
  parse(input: unknown): { models: Array<{ name: string }> } {
    if (typeof input !== "object" || input === null || !("models" in input)) {
      throw new IdrConnectionError("Invalid Ollama /api/tags response");
    }
    const models = (input as { models: unknown }).models;
    if (!Array.isArray(models)) {
      throw new IdrConnectionError("Invalid Ollama /api/tags response: models is not an array");
    }
    return {
      models: models.map((entry) => {
        if (typeof entry !== "object" || entry === null || !("name" in entry)) {
          throw new IdrConnectionError("Invalid Ollama model entry");
        }
        const name = (entry as { name: unknown }).name;
        if (typeof name !== "string") {
          throw new IdrConnectionError("Invalid Ollama model name");
        }
        return { name };
      }),
    };
  },
};

export class OllamaViaIdrProvider implements AiProvider {
  constructor(private readonly transport: IdrTransport) {}

  async listModels(): Promise<string[]> {
    const response = await this.transport.fetch({ path: "/api/tags", method: "GET" });
    if (!response.ok) {
      throw new IdrConnectionError(`Ollama listModels failed (${response.status})`);
    }
    const json = await response.json();
    const parsed = ollamaTagsSchema.parse(json);
    return parsed.models.map((model) => model.name);
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const response = await this.transport.fetch({
      path: "/api/generate",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        stream: request.stream ?? false,
        options: request.options,
      }),
    });

    if (!response.ok) {
      throw new IdrConnectionError(`Ollama generate failed (${response.status})`);
    }

    const json = (await response.json()) as {
      model?: string;
      response?: string;
      done?: boolean;
    };

    return {
      model: json.model ?? request.model,
      response: json.response ?? "",
      done: json.done ?? true,
    };
  }
}
