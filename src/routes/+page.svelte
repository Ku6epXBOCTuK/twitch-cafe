<script lang="ts">
	import { loadAssets } from "#lib/overlay/loader";
	import { createBoards, type OverlayBoards } from "#lib/overlay/pixi-boards";
	import { createScene } from "#lib/overlay/pixi-scene";
	import { connect, disconnect, snapshot } from "#lib/overlay/overlay-store";
	import { Application } from "pixi.js";
	import { onMount } from "svelte";

	let canvas = $state<HTMLCanvasElement | null>(null);
	let initError = $state<string | null>(null);

	onMount(() => {
		const app = new Application();
		let unsubscribe: (() => void) | null = null;
		let boards: OverlayBoards | null = null;
		let disposed = false;
		let appReady = false;

		(async () => {
			try {
				if (!canvas) throw new Error("Canvas unavailable");
				await app.init({
					canvas,
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
					initError = "Не удалось загрузить оверлей. Обновите страницу.";
					console.error(
						"[overlay] initialization failed:",
						error instanceof Error ? error.name : "UnknownError",
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

{#if initError}
	<div class="overlay-error" role="alert">{initError}</div>
{/if}

<canvas bind:this={canvas}></canvas>

<style>
	.overlay-error {
		position: fixed;
		inset: 1rem auto auto 1rem;
		z-index: 1;
		max-width: min(32rem, calc(100vw - 2rem));
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: #7f1d1d;
		color: #fff;
		font:
			600 1rem/1.4 system-ui,
			sans-serif;
	}

	canvas {
		display: block;
		width: 100vw;
		height: 100vh;
	}
</style>
