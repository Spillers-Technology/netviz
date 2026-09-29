// friendlyError turns a raw backend or network error into one plain sentence
// a technician can act on, and keeps the original text as details underneath
// — it is never thrown away.
export type FriendlyError = { lead: string; details: string };

const RULES: { test: RegExp; lead: string }[] = [
  { test: /invalid CIDR|only IPv4 CIDR|CIDR is required/i, lead: "That network range isn't valid. Use a range like 192.168.1.0/24." },
  { test: /too many ports/i, lead: "Too many ports are selected. Choose 64 or fewer in scan ports." },
  { test: /scan (is )?already running|already scanning/i, lead: "A scan is already running. Wait for it to finish or cancel it first." },
  { test: /access is denied|permission denied|operation not permitted|requires elevation|administrator/i, lead: "NetViz needs administrator rights for that. Run it as an administrator and try again." },
  { test: /not found|no such file|cannot find/i, lead: "A file NetViz needs wasn't found." },
  { test: /failed to fetch|networkerror|net::|ECONNREFUSED|status 5\d\d/i, lead: "NetViz couldn't reach the server." },
  { test: /status 401|status 403|unauthorized|forbidden/i, lead: "Your sign-in has expired. Sign in again to continue." },
  { test: /deadline exceeded|timed? ?out/i, lead: "That took too long and was stopped." },
  { test: /checksum/i, lead: "The download didn't match its published checksum, so nothing was installed." },
];

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err ?? "");
}

export function friendlyError(err: unknown, action = "That"): FriendlyError {
  const details = errorText(err).trim();
  const rule = RULES.find((candidate) => candidate.test.test(details));
  return { lead: rule ? rule.lead : `${action} didn't work.`, details };
}
