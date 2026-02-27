const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

/**
 * @type {import('esbuild').Plugin}
 */
const textLoaderPlugin = {
    name: 'text-loader',
    setup(build) {
        build.onLoad({ filter: /views[\\/].*\.js$/ }, async (args) => {
            const fs = require('fs');
            const text = await fs.promises.readFile(args.path, 'utf8');
            return { contents: text, loader: 'text' };
        });
    }
};

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    minify: false,
    loader: {
        '.html': 'text',
        '.css': 'text',
    },
    plugins: [
        esbuildProblemMatcherPlugin,
        textLoaderPlugin,
    ],
};

async function build() {
    if (isWatch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('[watch] Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
        console.log('Build complete.');
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
