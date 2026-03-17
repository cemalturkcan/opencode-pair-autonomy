export function nowIso() {
  return new Date().toISOString();
}

export function elapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}
