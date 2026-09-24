<script lang="ts">
	import { loadAssets } from "#lib/overlay/loader";
	import { createBoards, type OverlayBoards } from "#lib/overlay/pixi-boards";
	import { createScene } from "#lib/overlay/pixi-scene";
	import { connect, disconnect, snapshot } from "#lib/overlay/overlay-store";
	import { Application } from "pixi.js";
	import { onMount } from "svelte";

	let canvas = $state<HTMLCanvasElement | null>(null);

	onMount(() => {
		const app = new Application();
		let unsubscribe: (() => void) | null = null;
		let boards: OverlayBoards | null = null;
		let disposed = false;
		let appReady = false;

		(async () => {
			try {
				await app.init({
					canvas: canvas!,
					resizeTo: window,
					backgroundAlpha: 0,
				});
				if (disposed) {
					app.destroy(true);
					return;
				}
				appReady = true;
				await loadAssets();
				if (disposed) return;
				createScene(app);
				boards = createBoards(app);
				unsubscribe = snapshot.subscribe((value) => boards!.update(value));
				connect();
			} catch (error) {
				if (!disposed) {
					console.error(
						"[overlay] initialization failed:",
						error instanceof Error ? error.message : "unknown error",
					);
				}
			}
		})();

		return () => {
			disposed = true;
			disconnect();
			unsubscribe?.();
			boards?.destroy();
			if (appReady) app.destroy(true);
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
