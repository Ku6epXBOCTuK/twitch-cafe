import type { OverlaySnapshot } from "#lib/overlay/types";

const ENCODER = new TextEncoder();
const FRAME_INTERVAL_MS = 250;

/** O3: проекция будет собирать кадр из SimSnapshot. Пока — демо-данные. */
function stubSnapshot(): OverlaySnapshot {
	return {
		incoming: [
			{
				id: "demo-in-1",
				dishes: ["Маргарита", "Пепперони"],
				strictness: 3,
				deadline: Date.now() + 5 * 60_000,
			},
			{
				id: "demo-in-2",
				dishes: ["Гавайская"],
				strictness: 1,
				deadline: Date.now() + 3 * 60_000,
			},
		],
		execution: [
			{
				id: "demo-ex-1",
				performer: "Ku6epXBOCTuK",
				dishes: [
					{ name: "Маргарита", done: true },
					{ name: "Пепперони", done: false },
				],
				deadline: Date.now() + 2 * 60_000,
			},
		],
		players: [],
		recipe: {
			id: "demo-recipe",
			name: "Пепперони",
			ingredients: ["тесто", "соус", "сыр", "пепперони"],
		},
	};
}

function frame(snapshot: OverlaySnapshot): Uint8Array {
	return ENCODER.encode(`data: ${JSON.stringify(snapshot)}\n\n`);
}

export function GET(): Response {
	let timer: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(frame(stubSnapshot()));
			timer = setInterval(() => {
				controller.enqueue(frame(stubSnapshot()));
			}, FRAME_INTERVAL_MS);
		},
		cancel() {
			if (timer) clearInterval(timer);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
		},
	});
}
