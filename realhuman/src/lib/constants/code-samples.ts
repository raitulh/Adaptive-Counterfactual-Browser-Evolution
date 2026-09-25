import type { CodeLanguage } from "@/lib/utils/highlight";

export interface CodeSample {
  id: string;
  label: string;
  filename: string;
  language: CodeLanguage;
  code: string;
  /** Zero-based line indexes highlighted in sequence by the active-line indicator. */
  focusLines?: readonly number[];
}

export const serverSample: CodeSample = {
  id: "node",
  label: "Node.js",
  filename: "app/api/signup/route.ts",
  language: "ts",
  code: `import { RealHuman } from "@realhuman/sdk";

const realhuman = new RealHuman({
  secretKey: process.env.REALHUMAN_SECRET_KEY,
});

export async function POST(request: Request) {
  const { token } = await request.json();
  const verification = await realhuman.verify(token);

  if (verification.verified) {
    return allowUser();
  }

  return requireStepUp(verification.signals);
}`,
  focusLines: [2, 8, 10, 11, 14],
};

export const restSample: CodeSample = {
  id: "rest",
  label: "REST",
  filename: "terminal",
  language: "bash",
  code: `curl -X POST "$REALHUMAN_API_URL/v1/verify" \\
  -H "Authorization: Bearer $REALHUMAN_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "token": "rh_vt_2k9QfL7xM4" }'`,
  focusLines: [0, 1, 3],
};

export const responseSample: CodeSample = {
  id: "response",
  label: "Response",
  filename: "200 OK · application/json",
  language: "json",
  code: `{
  "session": "sess_7f3a9c2e41d8",
  "verified": true,
  "decision": "allow",
  "risk": "low",
  "score": 0.93,
  "signals": [
    { "id": "interaction_pattern", "status": "pass" },
    { "id": "challenge_response", "status": "pass" },
    { "id": "session_consistency", "status": "pass" },
    { "id": "request_behavior", "status": "pass" }
  ],
  "redeemedAt": "2026-09-24T12:04:31Z"
}`,
};

export const widgetSample: CodeSample = {
  id: "widget",
  label: "React",
  filename: "components/signup-form.tsx",
  language: "ts",
  code: `import { RealHumanWidget } from "@realhuman/react";

export function SignupForm() {
  const [token, setToken] = useState<string | null>(null);

  return (
    <form action={signup}>
      <RealHumanWidget
        siteKey={process.env.NEXT_PUBLIC_REALHUMAN_SITE_KEY}
        onVerified={setToken}
      />
      <input type="hidden" name="token" value={token ?? ""} />
      <button disabled={!token}>Create account</button>
    </form>
  );
}`,
};

export const pythonSample: CodeSample = {
  id: "python",
  label: "Python",
  filename: "app/verification.py",
  language: "python",
  code: `import os
import httpx

async def verify_token(token: str) -> dict:
    async with httpx.AsyncClient(base_url=os.environ["REALHUMAN_API_URL"]) as client:
        response = await client.post(
            "/v1/verify",
            json={"token": token},
            headers={"Authorization": f"Bearer {os.environ['REALHUMAN_SECRET_KEY']}"},
        )
        response.raise_for_status()
        return response.json()`,
};

export const envSample: CodeSample = {
  id: "env",
  label: ".env",
  filename: ".env.local",
  language: "bash",
  code: `# Public — safe to ship to the browser
NEXT_PUBLIC_REALHUMAN_SITE_KEY=pk_test_your_site_key

# Secret — server only, never commit
REALHUMAN_SECRET_KEY=rh_test_sk_your_secret_key
REALHUMAN_API_URL=http://localhost:8000`,
};
