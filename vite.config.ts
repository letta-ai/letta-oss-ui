import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

// Keep the port in sync with DEV_PORT in src/electron/util.ts.
// Dev-only: index.html ships a strict CSP (script-src 'self'), which blocks
// @vitejs/plugin-react's inline refresh preamble — the module graph dies
// before React mounts and the window stays blank with zero main-process
// errors. This transform relaxes script-src only when `vite` serves (dev);
// production builds keep the strict CSP untouched.
function relaxDevCsp(): Plugin {
	return {
		name: "relax-dev-csp",
		apply: "serve",
		transformIndexHtml(html) {
			const devCsp = "script-src 'self' 'unsafe-inline'";
			if (!/script-src 'self'/.test(html)) {
				this.warn(
					"relax-dev-csp: CSP pattern /script-src 'self'/ not found in index.html — dev window may stay blank",
				);
			}
			return html.replace(/script-src 'self'/, devCsp);
		},
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss(), relaxDevCsp()],
	base: './',
	build: {
		outDir: 'dist-react',
		// A desktop app loads its bundle from disk, so one large chunk is fine.
		chunkSizeWarningLimit: 1500,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
