<script lang="ts">
	import { loadAssets } from "#lib/overlay/loader";
	import { createBoards, type OverlayBoards } from "#lib/overlay/pixi-boards";
	import { createScene } from "#lib/overlay/pixi-scene";
	import { connect, snapshot } from "#lib/overlay/overlay-store";
	import { Application } from "pixi.js";
	import { onMount } from "svelte";

	let canvas = $state<HTMLCanvasElement | null>(null);

	onMount(() => {
		const app = new Application();
		let unsubscribe: (() => void) | null = null;
		let boards: OverlayBoards | null = null;

		(async () => {
			await app.init({ canvas: canvas!, resizeTo: window, backgroundAlpha: 0 });
			await loadAssets();
			createScene(app);
			boards = createBoards(app);
			unsubscribe = snapshot.subscribe((s) => boards!.update(s));
			connect();
		})();

		return () => {
			unsubscribe?.();
			boards?.destroy();
			app.destroy(true);
		};
	});
</script>

<canvas bind:this={canvas}></canvas>

<style>
	canvas {
		display: block;
		width: 100vw;
		height: 100vh;
	}
</style>
