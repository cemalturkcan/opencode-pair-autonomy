type IdPrefix = "session" | "context" | "page" | "task" | "action" | "artifact";

function randomPart() {
  return Math.random().toString(36).slice(2, 10);
}

export function createId(prefix: IdPrefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomPart()}`;
}
