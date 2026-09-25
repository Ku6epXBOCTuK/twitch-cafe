import {
	Application,
	Container,
	Graphics,
	Sprite,
	Text,
	TextStyle,
} from "pixi.js";
import { COMMAND_HINTS } from "#lib/twitch/command-hints";
import { getTexture } from "./loader";
import type { OverlaySnapshot } from "./types";

const SLOT_WIDTH = 150;
const SLOT_HEIGHT = 190;
const SLOT_HEADER_HEIGHT = 20;
const SLOT_HEADER_GAP = 4;
const SLOT_BODY_TOP = 44;
const SLOT_GAP = 12;
const BOARD_MARGIN = 16;
const BOARD_PADDING = 10;

const HINTS_WIDTH = 300;
const HINT_LINE_HEIGHT = 18;

const BOARD_COLOR = 0x2b2b2b;
const SLOT_COLOR = 0x404040;

const TITLE_STYLE = new TextStyle({
	fontFamily: "Arial, sans-serif",
	fontSize: 22,
	fontWeight: "bold",
	fill: 0xffffff,
});

const HEADER_STYLE = new TextStyle({
	fontFamily: "Arial, sans-serif",
	fontSize: 14,
	fontWeight: "bold",
	fill: 0xffd166,
	align: "center",
	wordWrap: true,
	wordWrapWidth: SLOT_WIDTH - 16,
	breakWords: true,
});

const LABEL_STYLE = new TextStyle({
	fontFamily: "Arial, sans-serif",
	fontSize: 16,
	fill: 0xffffff,
	align: "center",
	wordWrap: true,
	wordWrapWidth: SLOT_WIDTH - 16,
	breakWords: true,
});

const HINT_STYLE = new TextStyle({
	fontFamily: "Arial, sans-serif",
	fontSize: 14,
	fill: 0xffffff,
	lineHeight: HINT_LINE_HEIGHT,
	wordWrap: true,
	wordWrapWidth: HINTS_WIDTH - BOARD_PADDING * 2,
	breakWords: true,
});

interface Board {
	container: Container;
	headers: Text[];
	texts: Text[];
	width: number;
	height: number;
}

function createBoard(title: string, slotCount: number): Board {
	const container = new Container();
	container.label = `board.${title}`;

	const slotsWidth = slotCount * (SLOT_WIDTH + SLOT_GAP) - SLOT_GAP;
	const titleText = new Text({ text: title, style: TITLE_STYLE });
	titleText.position.set(BOARD_PADDING, BOARD_PADDING);
	const slotsTop =
		BOARD_PADDING +
		titleText.height +
		SLOT_GAP +
		SLOT_HEADER_HEIGHT +
		SLOT_HEADER_GAP;

	const panel = new Graphics();
	panel.roundRect(
		0,
		0,
		slotsWidth + BOARD_PADDING * 2,
		slotsTop + SLOT_HEIGHT + BOARD_PADDING,
		10,
	);
	panel.fill(BOARD_COLOR);
	container.addChild(panel);
	container.addChild(titleText);

	const frameTexture = getTexture("boards.frame");
	const headers: Text[] = [];
	const texts: Text[] = [];
	for (let i = 0; i < slotCount; i++) {
		const slot = new Container();
		slot.position.set(BOARD_PADDING + i * (SLOT_WIDTH + SLOT_GAP), slotsTop);

		const background = new Graphics();
		background.roundRect(0, 0, SLOT_WIDTH, SLOT_HEIGHT, 8);
		background.fill(SLOT_COLOR);
		slot.addChild(background);

		if (frameTexture) {
			const frame = new Sprite(frameTexture);
			frame.width = SLOT_WIDTH;
			frame.height = SLOT_HEIGHT;
			slot.addChild(frame);
		}

		const header = new Text({ text: "", style: HEADER_STYLE });
		header.position.set(
			BOARD_PADDING + i * (SLOT_WIDTH + SLOT_GAP),
			slotsTop - SLOT_HEADER_HEIGHT - SLOT_HEADER_GAP,
		);
		container.addChild(header);
		headers.push(header);

		const text = new Text({ text: "", style: LABEL_STYLE });
		text.position.set(BOARD_PADDING, SLOT_BODY_TOP);
		slot.addChild(text);
		texts.push(text);
		container.addChild(slot);
	}

	const width = slotsWidth + BOARD_PADDING * 2;
	const height = slotsTop + SLOT_HEIGHT + BOARD_PADDING;
	return { container, headers, texts, width, height };
}

/** Окно с одним текстовым блоком (подсказки): высота — по высоте контента. */
function createTextBoard(title: string, content: string, width: number): Board {
	const container = new Container();
	container.label = `board.${title}`;

	const titleText = new Text({ text: title, style: TITLE_STYLE });
	titleText.position.set(BOARD_PADDING, BOARD_PADDING);
	const textTop = BOARD_PADDING + titleText.height + SLOT_GAP;

	const text = new Text({ text: content, style: HINT_STYLE });
	text.position.set(BOARD_PADDING, textTop);

	const height = textTop + text.height + BOARD_PADDING;
	const panel = new Graphics();
	panel.roundRect(0, 0, width, height, 10);
	panel.fill(BOARD_COLOR);
	container.addChild(panel);
	container.addChild(titleText);
	container.addChild(text);

	return { container, headers: [], texts: [text], width, height };
}

function updateText(text: Text, content: string): void {
	text.text = content;
	text.position.set((SLOT_WIDTH - text.width) / 2, SLOT_BODY_TOP);
}

function updateHeader(text: Text, content: string, left: number): void {
	text.text = content;
	text.position.set(left + (SLOT_WIDTH - text.width) / 2, text.position.y);
}

function formatTimeLeft(deadline: number): string {
	const totalSeconds = Math.max(0, Math.round((deadline - Date.now()) / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function incomingText(
	dishes: string[],
	strictnessStars: number,
	deadline: number,
): string {
	return [
		dishes.join("\n"),
		`Строгость ${strictnessStars}/5`,
		`осталось ${formatTimeLeft(deadline)}`,
	].join("\n");
}

function executionText(
	dishes: { name: string; done: boolean }[],
	deadline: number,
): string {
	return [
		dishes.map((d) => `${d.done ? "✓" : "•"} ${d.name}`).join("\n"),
		`осталось ${formatTimeLeft(deadline)}`,
	].join("\n");
}

function recipeText(name: string, ingredients: string[]): string {
	return [name, "", ...ingredients].join("\n");
}

function hintLines(): string {
	return COMMAND_HINTS.map(
		(hint) => `${hint.usage} — ${hint.description}`,
	).join("\n");
}

export interface OverlayBoards {
	update(snapshot: OverlaySnapshot): void;
	destroy(): void;
}

export function createBoards(app: Application): OverlayBoards {
	const incoming = createBoard("Входящие", 3);
	const execution = createBoard("Исполнение", 3);
	const recipe = createBoard("Рецепт", 1);
	const hints = createTextBoard("Подсказки", hintLines(), HINTS_WIDTH);
	app.stage.addChild(
		incoming.container,
		execution.container,
		recipe.container,
		hints.container,
	);

	const layout = () => {
		const width = app.renderer.width;
		// Второй ряд: подсказки слева и рецепт справа — зеркально друг другу.
		const secondRow =
			BOARD_MARGIN + Math.max(incoming.height, execution.height) + SLOT_GAP;
		incoming.container.position.set(BOARD_MARGIN, BOARD_MARGIN);
		execution.container.position.set(
			width - BOARD_MARGIN - execution.width,
			BOARD_MARGIN,
		);
		hints.container.position.set(BOARD_MARGIN, secondRow);
		recipe.container.position.set(
			width - BOARD_MARGIN - recipe.width,
			secondRow,
		);
	};

	layout();
	app.renderer.on("resize", layout);

	return {
		update(snapshot) {
			incoming.texts.forEach((text, index) => {
				const order = snapshot.incoming.find(
					(entry) => entry.slot === index + 1,
				);
				updateHeader(
					incoming.headers[index],
					order ? `Слот ${order.slot}` : "",
					BOARD_PADDING + index * (SLOT_WIDTH + SLOT_GAP),
				);
				updateText(
					text,
					order
						? incomingText(order.dishes, order.strictnessStars, order.deadline)
						: "",
				);
			});
			for (let i = 0; i < execution.texts.length; i++) {
				const order = snapshot.execution[i];
				updateHeader(
					execution.headers[i],
					order?.performer ?? "",
					BOARD_PADDING + i * (SLOT_WIDTH + SLOT_GAP),
				);
				updateText(
					execution.texts[i],
					order ? executionText(order.dishes, order.deadline) : "",
				);
			}
			updateHeader(
				recipe.headers[0],
				snapshot.recipe ? "Сейчас готовим" : "",
				BOARD_PADDING,
			);
			updateText(
				recipe.texts[0],
				snapshot.recipe
					? recipeText(snapshot.recipe.name, snapshot.recipe.ingredients)
					: "",
			);
		},
		destroy() {
			app.renderer.off("resize", layout);
		},
	};
}
