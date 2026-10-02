// Ambient types for Host-runtime-provided peer modules (qoder spike, mirroring
// the mainstream sensenova layout). DSH ships the private @deepseek-ai/* scope
// with the runtime itself; this checkout's node_modules has no copy to resolve
// types from, so these declarations assert only EXISTENCE so @ts-check can
// resolve the specifier without pretending to know the real shape.
//
// Dev-only: package.json#files does not include types/, so nothing here ships.
// Keep entries in sync with the peer imports actually used by src/host/*.ts.

declare module "@deepseek-ai/dsh-home-paths";
declare module "@deepseek-ai/dsh-llm";
declare module "@deepseek-ai/dsh-llm-pi-ai";
declare module "@deepseek-ai/schemastery";
declare module "@earendil-works/pi-ai";
declare module "@earendil-works/pi-ai/api/openai-completions.lazy";
declare module "react";
declare module "react/jsx-runtime";
