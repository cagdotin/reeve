import type { rules } from "@reeve/contract/catalog";

type RuleInput = (typeof rules)["create_rule"]["input"]["Type"];

/** The contract's rule schemas as types, read off the catalog entries. */
export type RuleCondition = RuleInput["conditions"][number];
export type RuleAction = RuleInput["actions"][number];
export type RuleStage = NonNullable<RuleInput["stage"]>;
export type RuleEntity = (typeof rules)["get_rule"]["success"]["Type"];
