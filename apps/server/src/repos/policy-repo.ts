import { DEFAULT_POLICY_RULES, type PolicyRule } from "@scomm-office/policy";
import type { PolicyRepository } from "./types.js";

export class InMemoryPolicyRepository implements PolicyRepository {
  constructor(private readonly rules: PolicyRule[] = DEFAULT_POLICY_RULES) {}

  listRules(): PolicyRule[] {
    return this.rules;
  }
}
