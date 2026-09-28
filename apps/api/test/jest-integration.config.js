/**
 * Integration test config — separate from the unit test config in
 * package.json so integration tests (which need a real Postgres via
 * Testcontainers, per AGENTS.md §5) don't run as part of the fast unit suite.
 *
 * The `test:integration` script sets TESTCONTAINERS_RYUK_DISABLED=true: in
 * some sandboxed/restricted-Docker environments, Testcontainers' Ryuk
 * cleanup sidecar hangs on startup (each container start then waits out
 * Jest's 120s hook timeout instead of the normal ~1-2s). Every spec file's
 * afterAll already calls container.stop() explicitly, so disabling Ryuk only
 * gives up its extra safety net (cleanup after an unclean process kill), not
 * normal test-run cleanup.
 */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "../",
  testEnvironment: "node",
  testRegex: "test/.*\\.integration-spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
};
