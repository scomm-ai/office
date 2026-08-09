import type { SemanticMailDocument } from "@scomm-office/semantics";
import type { Pool } from "pg";
import type { SemanticRepository } from "./types.js";

export class PostgresSemanticRepository implements SemanticRepository {
  constructor(private readonly pool: Pool) {}

  async save(id: string, document: SemanticMailDocument, digest: string): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO semantic_documents (id, document, digest)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (id)
        DO UPDATE SET document = EXCLUDED.document, digest = EXCLUDED.digest
      `,
      [id, JSON.stringify(document), digest],
    );
  }

  async findById(id: string): Promise<SemanticMailDocument | null> {
    const result = await this.pool.query<{ document: SemanticMailDocument }>(
      `
        SELECT document
        FROM semantic_documents
        WHERE id = $1
      `,
      [id],
    );
    return result.rows[0]?.document ?? null;
  }
}
