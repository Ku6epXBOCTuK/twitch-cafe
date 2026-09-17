import {
	Application,
	Container,
	Graphics,
	Sprite,
	Text,
	TextStyle,
} from "pixi.js";
import { getTexture } from "./loader";
import type { OverlaySnapshot } from "./types";

const SLOT_WIDTH = 150;
const SLOT_HEIGHT = 190;
const SLOT_GAP = 12;
const BOARD_MARGIN = 16;
const BOARD_PADDING = 10;

const BOARD_COLOR = 0x2b2b2b;
const SLOT_COLOR = 0x404040;

const TITLE_STYLE = new TextStyle({
	fontFamily: "Arial, sans-serif",
	fontSize: 22,
	fontWeight: "bold",
	fill: 0xffffff,
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

interface Board {
	container: Container;
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
	const slotsTop = BOARD_PADDING + titleText.height + SLOT_GAP;

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

		const text = new Text({ text: "", style: LABEL_STYLE });
		slot.addChild(text);
		texts.push(text);
		container.addChild(slot);
	}

	const width = slotsWidth + BOARD_PADDING * 2;
	const height = slotsTop + SLOT_HEIGHT + BOARD_PADDING;
	return { container, texts, width, height };
}

function updateText(text: Text, content: string): void {
	text.text = content;
	text.position.set(
		(SLOT_WIDTH - text.width) / 2,
		(SLOT_HEIGHT - text.height) / 2,
	);
}

function formatTimeLeft(deadline: number): string {
	const totalSeconds = Math.max(0, Math.round((deadline - Date.now()) / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function incomingText(
	dishes: string[],
	strictness: number,
	deadline: number,
): string {
	return [
		dishes.join("\n"),
		`придирчивость ${strictness}/5`,
		`осталось ${formatTimeLeft(deadline)}`,
	].join("\n");
}

function executionText(
	performer: string,
	dishes: { name: string; done: boolean }[],
	deadline: number,
): string {
	return [
		performer,
		dishes.map((d) => `${d.done ? "✓" : "•"} ${d.name}`).join("\n"),
		`осталось ${formatTimeLeft(deadline)}`,
	].join("\n");
}

function recipeText(name: string, ingredients: string[]): string {
	return [name, "", ...ingredients].join("\n");
}

export interface OverlayBoards {
	update(snapshot: OverlaySnapshot): void;
	destroy(): void;
}

export function createBoards(app: Application): OverlayBoards {
	const incoming = createBoard("Входящие", 3);
	const execution = createBoard("Исполнение", 3);
	const recipe = createBoard("Рецепт", 1);
	app.stage.addChild(incoming.container, execution.container, recipe.container);

	const layout = () => {
		const width = app.renderer.width;
		incoming.container.position.set(BOARD_MARGIN, BOARD_MARGIN);
		execution.container.position.set(
			width - BOARD_MARGIN - execution.width,
			BOARD_MARGIN,
		);
		recipe.container.position.set(
			width - BOARD_MARGIN - recipe.width,
			BOARD_MARGIN + execution.height + SLOT_GAP,
		);
	};

	layout();
	app.renderer.on("resize", layout);

	return {
		update(snapshot) {
			for (let i = 0; i < incoming.texts.length; i++) {
				const order = snapshot.incoming[i];
				updateText(
					incoming.texts[i],
					order
						? incomingText(order.dishes, order.strictness, order.deadline)
						: "",
				);
			}
			for (let i = 0; i < execution.texts.length; i++) {
				const order = snapshot.execution[i];
				updateText(
					execution.texts[i],
					order
						? executionText(order.performer, order.dishes, order.deadline)
						: "",
				);
			}
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
