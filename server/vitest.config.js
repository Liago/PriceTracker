const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.js'],
		coverage: {
			provider: 'v8',
			include: ['services/**/*.js', 'utils/**/*.js', 'config/**/*.js'],
		},
	},
});
