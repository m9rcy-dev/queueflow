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
 *
 * Every suite calls `app.listen(0)` in beforeAll rather than `app.init()`.
 * Given an unbound server, supertest binds a fresh ephemeral port for each
 * request and closes it afterwards; with all suites running in parallel
 * (each with its own Postgres container), a just-released port can be
 * handed to another process before the next request, which then talks to
 * the wrong server ("Parse Error: Expected HTTP/", or another suite's app
 * answering 404). A port bound once per suite is reused and never
 * released mid-suite. Found in Phase 13, when the suite count grew enough
 * to make the flake regular.
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
