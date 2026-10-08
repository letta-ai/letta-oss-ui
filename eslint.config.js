import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ ignores: ['dist', 'dist-react', 'dist-electron'] },
	{
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		files: ['**/*.{ts,tsx,cts}'],
		languageOptions: {
			ecmaVersion: 2023,
		},
	},
	{
		files: ['src/ui/**/*.{ts,tsx}'],
		languageOptions: {
			globals: globals.browser,
		},
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			'react-refresh/only-export-components': [
				'warn',
				{ allowConstantExport: true },
			],
		},
	},
	{
		files: ['src/electron/**/*.{ts,cts}'],
		languageOptions: {
			globals: globals.node,
		},
	},
)
