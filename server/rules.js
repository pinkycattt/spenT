import { applyTagFromRule, enabledRules, untaggedIds } from "./db.js";

function matches(rule, haystack) {
  const text = (haystack || "").toLowerCase();
  const pattern = String(rule.pattern);
  if (rule.match_type === "equals") return text === pattern.toLowerCase();
  if (rule.match_type === "regex") {
    try {
      return new RegExp(pattern, "i").test(haystack || "");
    } catch {
      return false;
    }
  }
  return text.includes(pattern.toLowerCase());
}

/**
 * Highest-priority matching rule wins, since a spend carries a single tag.
 * Only untagged spends are touched, so hand-picked tags survive re-runs.
 */
export function applyRules(ids = null) {
  const rules = enabledRules();
  const candidates = untaggedIds(ids);
  let tagged = 0;

  for (const txn of candidates) {
    const hit = rules.find(
      (rule) => matches(rule, txn.description) || matches(rule, txn.merchant)
    );
    if (hit) {
      applyTagFromRule(txn.id, hit.tag_id);
      tagged += 1;
    }
  }
  return { considered: candidates.length, tagged, untagged: candidates.length - tagged };
}

/** A short, reusable keyword for "always tag things like this". */
export function suggestPattern(text) {
  const cleaned = String(text || "")
    .replace(/[*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const skip = new Set(["the", "and", "for", "from", "with", "pty", "ltd", "inc"]);
  const token = cleaned
    .split(" ")
    .find((t) => /[a-z]/i.test(t) && t.length > 2 && !skip.has(t.toLowerCase()));
  return (token || cleaned.split(" ")[0] || "").replace(/[^a-z0-9.&'-]/gi, "").toLowerCase();
}
