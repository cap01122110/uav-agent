/**
 * Credential redaction for auth diagnostics.
 *
 * Server-supplied error detail may embed passwords, tokens, JWTs, cookies or
 * authorization headers. These helpers scrub known secret shapes BEFORE any
 * truncation, so a secret split across a truncation boundary can never leak
 * the remaining characters.
 */

const SENSITIVE_KEYS = [
	"password",
	"passwd",
	"pwd",
	"token",
	"access_token",
	"accessToken",
	"refresh_token",
	"refreshToken",
	"x-auth-token",
	"client_secret",
	"clientSecret",
	"secret",
	"api_key",
	"apiKey",
	"authorization",
	"auth",
	"cookie",
	"set-cookie",
	"set_cookie",
];

const KEY_ALTERNATION = SENSITIVE_KEYS.map(escapeRegExp).join("|");

/**
 * Replace known secret material with [REDACTED]. Handles JSON quoted values,
 * key=value pairs, header-style "Key: value" lines, "Bearer <token>" and
 * bare JWT-shaped tokens. Not a parser - it errs toward redacting too much.
 */
export function redactSecrets(detail: string): string {
	return (
		detail
			// JSON: "key": "value"
			.replace(new RegExp(`("(?:${KEY_ALTERNATION})"\\s*:\\s*")[^"]*(")`, "gi"), "$1[REDACTED]$2")
			// key=value (optionally quoted, terminated by & ; whitespace)
			.replace(new RegExp(`((?:${KEY_ALTERNATION})\\s*=\\s*["']?)[^"'&;\\s]+`, "gi"), "$1[REDACTED]")
			// Header-style: Key: value (colon followed by whitespace only)
			.replace(new RegExp(`((?:${KEY_ALTERNATION})\\s*:\\s+)[^\\r\\n]*`, "gi"), "$1[REDACTED]")
			// Authorization: Bearer <token>
			.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
			// Bare JWT: eyJ<header>.<payload>.<signature>
			.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, "[REDACTED]")
	);
}

/** Redact first, then truncate - a secret can never straddle the cut. */
export function redactThenTruncate(detail: string, maxLength = 200): string {
	const sanitized = redactSecrets(detail);
	return sanitized.length > maxLength ? sanitized.slice(0, maxLength) : sanitized;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
