import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const emptyMarker = new URL('./server-only-empty.cjs', import.meta.url);

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'server-only') return { url: fileURLToPath(emptyMarker), shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
