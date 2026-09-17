import { Application, Container, Sprite } from "pixi.js";
import { getTexture } from "./loader";

const STATION_HEIGHT = 96;
const GROUND_OFFSET = 24;
const STATIONS = [
	"station.shelf",
	"station.trash",
	"station.serve",
	"station.recipe",
];

export function createScene(app: Application): Container {
	const scene = new Container();
	scene.label = "scene";

	const sprites: Sprite[] = [];
	for (const alias of STATIONS) {
		const texture = getTexture(alias);
		if (!texture) continue;
		const sprite = new Sprite(texture);
		sprite.scale.set(STATION_HEIGHT / texture.height);
		sprite.anchor.set(0.5, 1);
		sprites.push(sprite);
		scene.addChild(sprite);
	}

	const layout = () => {
		const width = app.renderer.width;
		const height = app.renderer.height;
		const step = width / (sprites.length + 1);
		sprites.forEach((sprite, i) =>
			sprite.position.set(step * (i + 1), height - GROUND_OFFSET),
		);
	};

	layout();
	app.renderer.on("resize", layout);
	app.stage.addChild(scene);

	return scene;
}
