<script lang="ts">
	import { loadAssets } from "#lib/overlay/loader";
	import { createScene } from "#lib/overlay/pixi-scene";
	import { connect } from "#lib/overlay/overlay-store";
	import { Application } from "pixi.js";
	import { onMount } from "svelte";

	let canvas = $state<HTMLCanvasElement | null>(null);

	onMount(() => {
		const app = new Application();

		(async () => {
			await app.init({ canvas: canvas!, resizeTo: window, backgroundAlpha: 0 });
			await loadAssets();
			createScene(app);
			connect();
		})();

		return () => {
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
