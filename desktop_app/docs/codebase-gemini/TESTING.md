# Testing Patterns

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: xUnit 2.9.3 with Visual Studio test runner 3.1.4 and Microsoft.NET.Test.Sdk 17.14.1
- Assertion/mocking tools: Built-in `Xunit.Assert`, custom loopback TCP servers (`TcpListener`), custom stream implementations (`TimeoutThenFrameStream`)
- Commands:

```bash
# Run all tests
dotnet test AugmentScale.slnx -c Debug

# Run a specific test class
dotnet test AugmentScale.slnx -c Debug --filter "FullyQualifiedName~ProtocolTests"

# Run tests with detailed console logger
dotnet test AugmentScale.slnx -c Debug --logger "console;verbosity=detailed"
```

### 2) Test Layout

- Test file placement pattern: Separate test project located at `AugmentScale.Tests/` referencing production projects (`AugmentScale`, `AugmentScale.Protocol`, `AugmentScale.ScaleSimulator`).
- Naming convention: Files named `*Tests.cs` (`DatabaseTests.cs`, `ProtocolTests.cs`, `SimulatorEngineTests.cs`, `SimulatorProtocolTests.cs`).
- Setup files and where they run:
  - `DatabaseTests.cs:8-36` defines `TempDatabase : IDisposable`, initializing an isolated SQLCipher instance in `%TEMP%\AugmentScaleTests\<guid>` per test fixture and cleaning it up on disposal.

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Yes | `AugmentScale.Protocol` (decoders, splitters, encoders, stability variance) | Fast, pure CPU tests for Yaohua continuous frame protocol |
| Integration | Yes | `DatabaseService`, `ConfigService`, `ScaleReaderService` TCP stream | Executes real migrations, transactions, PBKDF2 hashing, and loopback TCP sockets |
| E2E | No | WebView2 full user interface rendering | [TODO] WebUI interactions currently manually tested in browser and desktop shell |

### 4) Mocking and Isolation Strategy

- Main mocking approach:
  - SQLite/Database isolation: Unique temporary directory created per test run via `TempDatabase`.
  - Serial port isolation: `ScaleReaderService` supports `TCP:host:port` connections, allowing tests to run against an in-process `TcpListener` rather than physical COM ports.
  - Stream simulation: Subclasses of `System.IO.Stream` (e.g. `TimeoutThenFrameStream`) used to verify serial timeout recovery without hardware.
- Isolation guarantees: Each `TempDatabase` creates isolated encryption keys, schema, and tables. No test touches production data located at `%LOCALAPPDATA%\AugmentScale`.
- Common failure mode in tests: File locking on temporary directory deletion (`IOException` in `TempDatabase.Dispose`, handled gracefully).

### 5) Coverage and Quality Signals

- Coverage tool + threshold: `[TODO]` (No automated code coverage tool or threshold configured in build scripts).
- Current reported coverage: 77 tests passing (0 failed, 0 skipped, total execution time ~1m 3s across 4 test classes).
- Known gaps/flaky areas: Full test suite takes >60 seconds because multiple database tests each perform PBKDF2 key derivations (100,000 iterations per seeded operator).

### 6) Evidence

- `AugmentScale.Tests/AugmentScale.Tests.csproj`
- `AugmentScale.Tests/DatabaseTests.cs`
- `AugmentScale.Tests/ProtocolTests.cs`
- `AugmentScale.Tests/SimulatorEngineTests.cs`
- `AugmentScale.Tests/SimulatorProtocolTests.cs`
- Terminal execution output of `dotnet test AugmentScale.slnx -c Debug`
