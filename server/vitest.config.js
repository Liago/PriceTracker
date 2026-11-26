const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.js', 'test/**/*.test.mts'],
		coverage: {
			provider: 'v8',
			include: ['services/**/*.js', 'services/**/*.mts', 'utils/**/*.js', 'config/**/*.js'],
		},
	},
});
