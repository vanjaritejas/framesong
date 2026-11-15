// Turns API errors into messages a person can act on.
export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status)
      : undefined;

  if (/ANTHROPIC_API_KEY|FAL_KEY/.test(message)) return message;
  if (/credit balance/i.test(message)) {
    return "Your Anthropic account is out of API credits. Add credits in the Claude Console under Billing, then try again.";
  }
  if (/exhausted balance|user is locked/i.test(message)) {
    return "Your fal.ai account is out of credit. Add credit at fal.ai under Billing, then try again.";
  }
  if (status === 401 || status === 403) {
    return "An API key was rejected. Check ANTHROPIC_API_KEY and FAL_KEY in .env.local, then restart npm run dev.";
  }
  if (status === 429) return "Too many requests right now. Wait a minute, then try again.";
  if (status === 529 || status === 503) return "Claude is busy right now. Try again in a minute.";
  return message || "Something went wrong. Try again.";
}
