// Ambient types for Host-runtime-provided peer modules (qoder spike, mirroring
// the mainstream sensenova layout). DSH ships the private @deepseek-ai/* scope
// with the runtime itself; this checkout's node_modules has no copy to resolve
// types from, so these declarations assert only EXISTENCE so @ts-check can
// resolve the specifier without pretending to know the real shape.
//
// Dev-only: package.json#files does not include types/, so nothing here ships.
// Keep entries in sync with the peer imports actually used by src/host/*.ts.
//
// `react` / `react/jsx-runtime` are deliberately NOT listed here any more. A
// bare `declare module 'react';` is an EMPTY shell: it makes the specifier
// resolve while typing every member as `any`, which is why the client's 104
// implicit-any sites were invisible to the ratchet. The client now has a real
// (if minimal) declaration at `src/client/react-shim.d.ts`, and two
// declarations for one module name would be an ambiguity rather than a merge.

declare module "@deepseek-ai/dsh-home-paths";
declare module "@deepseek-ai/dsh-llm";
declare module "@deepseek-ai/dsh-llm-pi-ai";
declare module "@deepseek-ai/schemastery";
declare module "@earendil-works/pi-ai";
declare module "@earendil-works/pi-ai/api/openai-completions.lazy";
