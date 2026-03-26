# Task 01: Setup Project

## Specification
Initialize the project structure for the RAG system:
- Configure TypeScript
- Install required dependencies
- Set up build scripts

## Plan
1. Update `tsconfig.json` with strict TypeScript settings (target ES2020, commonjs, strict mode, esModuleInterop)
2. Add `better-sqlite3` as a dependency for SQLite storage
3. Add `ts-node` and `@types/better-sqlite3` as dev dependencies
4. Update `package.json` scripts: `start` runs via `ts-node`, `build` compiles via `tsc`

## Result
- `tsconfig.json` updated with full compiler options
- Dependencies installed: `better-sqlite3`, `ts-node`, `@types/better-sqlite3`
- `yarn build` passes cleanly
