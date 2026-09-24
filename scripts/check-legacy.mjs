import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "src");
const ignoredDirectories = new Set([".svelte-kit", "build", "node_modules"]);

async function collectFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(path)));
		else if (/\.(ts|tsx|svelte)$/.test(entry.name)) files.push(path);
	}
	return files;
}

const forbiddenPatterns = [
	["TaskAck", /\bTaskAck\b/],
	["TakeOrderResult", /\bTakeOrderResult\b/],
	["NextDishResult", /\bNextDishResult\b/],
	["RecipeShowResult", /\bRecipeShowResult\b/],
	["ISimEvents", /\bISimEvents\b/],
	[
		"legacy sync operation",
		/\.(takeOrder|nextDish|putIngredient|serve|bin|onTimeout)\s*\(/,
	],
	[
		"legacy IncomingOrders operation",
		/incomingOrders\.(start|stop|spawn|takeOrder)\s*\(/,
	],
	["ad-hoc ok result", /\{\s*ok\s*:/],
	["unbounded queue or PubSub", /\b(?:Queue|PubSub)\.unbounded\b/],
	["unscoped fiber", /\bEffect\.fork\s*\(/],
];

const files = await collectFiles(sourceRoot);
const violations = [];

for (const path of files) {
	if (/\.test\.(ts|tsx)$/.test(path)) continue;
	const source = await readFile(path, "utf8");
	const file = relative(root, path);
	for (const [name, pattern] of forbiddenPatterns) {
		if (pattern.test(source)) violations.push(`${file}: ${name}`);
	}
	if (
		(file.includes("src/lib/core") || file.includes("src/lib/sim")) &&
		/\b(setTimeout|setInterval)\s*\(/.test(source)
	) {
		violations.push(`${file}: manual timer in core/SIM`);
	}
	if (
		(file.includes("src/lib/core") || file.includes("src/lib/sim")) &&
		/\bEffect\.catchDefect\s*\(/.test(source)
	) {
		violations.push(`${file}: swallowed Effect defect`);
	}
}

if (violations.length > 0) {
	console.error(violations.join("\n"));
	process.exit(1);
}
