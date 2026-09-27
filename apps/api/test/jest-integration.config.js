/**
 * Integration test config — separate from the unit test config in
 * package.json so integration tests (which need a real Postgres via
 * Testcontainers, per AGENTS.md §5) don't run as part of the fast unit suite.
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
