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

// fal.ai puts the real reason for a failed job in the error's body, not its message.
export function falErrorMessage(err: unknown, fallback: string): string {
  const body =
    typeof err === "object" && err !== null && "body" in err ? (err as { body?: unknown }).body : undefined;
  const detail =
    typeof body === "object" && body !== null && "detail" in body ? (body as { detail?: unknown }).detail : body;

  let text = "";
  if (typeof detail === "string") {
    text = detail;
  } else if (Array.isArray(detail)) {
    text = detail
      .map((d) =>
        typeof d === "object" && d !== null && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d),
      )
      .join("; ");
  } else if (detail) {
    text = JSON.stringify(detail);
  }
  if (!text && err instanceof Error) text = err.message;
  return (text || fallback).slice(0, 300);
}
