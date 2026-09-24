import { Cause } from "effect";

export function safeErrorType(error: unknown): string {
	if (error instanceof Error) return error.name;
	if (error && typeof error === "object" && "_tag" in error) {
		const tag = (error as { readonly _tag?: unknown })._tag;
		if (typeof tag === "string") return tag;
	}
	return "UnknownError";
}

export function safeCause(cause: Cause.Cause<unknown>): string {
	return safeErrorType(Cause.squash(cause));
}
