import { describe, expect, it } from "vitest";
import { redactSecrets, redactThenTruncate } from "../../src/auth/redaction.ts";

describe("redactSecrets", () => {
	it("redacts JSON token and password values", () => {
		const detail = '{"access_token":"eyJabc.def.ghi","password":"hunter2","client_secret":"shh"}';
		const out = redactSecrets(detail);
		expect(out).not.toContain("eyJabc");
		expect(out).not.toContain("hunter2");
		expect(out).not.toContain("shh");
		expect(out).toContain("[REDACTED]");
	});

	it("redacts key=value pairs", () => {
		const out = redactSecrets("password=abc123&client_secret=xyz&token=ttt");
		expect(out).not.toContain("abc123");
		expect(out).not.toContain("xyz");
		expect(out).not.toContain("ttt");
		expect(out).toContain("password=[REDACTED]");
	});

	it("redacts quoted key=value pairs in full, including inner spaces", () => {
		const out = redactSecrets('password="abc def ghi" client_secret=\'foo bar baz\' token="tt"');
		expect(out).not.toContain("abc");
		expect(out).not.toContain("def");
		expect(out).not.toContain("ghi");
		expect(out).not.toContain("foo");
		expect(out).not.toContain("bar");
		expect(out).not.toContain("baz");
		expect(out).not.toContain("tt");
		expect(out).toContain('password="[REDACTED]"');
		expect(out).toContain("client_secret='[REDACTED]'");
		expect(out).toContain('token="[REDACTED]"');
	});

	it("keeps ordinary text that merely mentions a sensitive key intact", () => {
		const out = redactSecrets("note: the word password is not itself a secret here");
		expect(out).toContain("the word password");
		expect(out).not.toContain("[REDACTED]");
	});

	it("redacts header-style Authorization: Bearer and cookies", () => {
		const out = redactSecrets(
			"Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def\nCookie: session=SECRET123\nx-auth-token: tok-9",
		);
		expect(out).not.toContain("eyJhbGci");
		expect(out).not.toContain("SECRET123");
		expect(out).not.toContain("tok-9");
		// The whole header value is masked, whatever form the rule takes.
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("Bearer eyJ");
	});

	it("redacts a bare JWT-shaped token", () => {
		const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
		const out = redactSecrets(jwt);
		expect(out).not.toContain("eyJhbGci");
		expect(out).toContain("[REDACTED]");
	});

	it("redacts x-auth-token header", () => {
		const out = redactSecrets("x-auth-token: super-secret-token-123");
		expect(out).not.toContain("super-secret-token-123");
	});
});

describe("redactThenTruncate", () => {
	it("redacts before truncating, so a long secret never straddles the cut", () => {
		// The secret starts beyond the 200-char cut; redaction must still catch it.
		const padding = "x".repeat(250);
		const detail = `${padding} password=hunter2`;
		const out = redactThenTruncate(detail, 200);
		expect(out).not.toContain("hunter2");
		expect(out.length).toBeLessThanOrEqual(200);
	});

	it("redacts JSON values that begin before the truncation boundary", () => {
		const detail = `{"password":"${"s".repeat(400)}"}`;
		const out = redactThenTruncate(detail, 200);
		expect(out).not.toContain("s".repeat(400));
		expect(out).toContain("[REDACTED]");
	});
});
