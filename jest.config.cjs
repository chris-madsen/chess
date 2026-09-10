module.exports = {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["@swc/jest", {
      jsc: {
        parser: { syntax: "typescript", tsx: false },
        target: "es2022"
      },
      module: { type: "es6" }
    }],
    "^.+\\.js$": ["@swc/jest", {
      jsc: {
        parser: { syntax: "ecmascript", jsx: false },
        target: "es2022"
      },
      module: { type: "es6" }
    }]
  },
  testMatch: ["**/tests/**/*.test.js"],
  testPathIgnorePatterns: ["/node_modules/"],
  collectCoverageFrom: ["src/**/*.ts"],
  coverageReporters: ["text", "text-summary"],
  forceExit: true,
  openHandlesTimeout: 1000,
  setupFiles: ["./jest.setup.js"]
};
