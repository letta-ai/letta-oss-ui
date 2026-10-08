import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Keep the port in sync with DEV_PORT in src/electron/util.ts.
export default defineConfig({
	plugins: [react(), tailwindcss()],
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
