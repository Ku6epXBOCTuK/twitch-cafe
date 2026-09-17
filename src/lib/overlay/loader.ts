import { Assets, type Texture } from "pixi.js";

let loaded: Record<string, Texture> = {};

export async function loadAssets(): Promise<void> {
	await Assets.init({ manifest: "/assets/manifest.json" });
	const bundle = await Assets.loadBundle("overlay");
	loaded = bundle as Record<string, Texture>;
}

export function getTexture(alias: string): Texture | undefined {
	return loaded[alias];
}
